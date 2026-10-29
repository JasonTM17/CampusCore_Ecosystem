package io.campuscore.restfulapi.identity;

import com.nimbusds.jwt.JWTParser;
import io.campuscore.restfulapi.auth.repository.AuthUserRepository;
import java.text.ParseException;
import java.time.Instant;
import java.util.Map;
import java.util.Optional;
import org.springframework.jdbc.core.JdbcOperations;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.oauth2.core.OAuth2AccessToken;
import org.springframework.security.oauth2.core.OAuth2AuthenticationException;
import org.springframework.security.oauth2.core.OAuth2Error;
import org.springframework.security.oauth2.core.OAuth2ErrorCodes;
import org.springframework.security.oauth2.core.AuthorizationGrantType;
import org.springframework.security.oauth2.core.endpoint.OAuth2AuthorizationRequest;
import org.springframework.security.oauth2.server.authorization.authentication.OAuth2AuthorizationCodeRequestAuthenticationException;
import org.springframework.security.oauth2.server.authorization.authentication.OAuth2AuthorizationCodeRequestAuthenticationToken;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.security.oauth2.server.authorization.OAuth2AuthorizationCode;
import org.springframework.security.oauth2.core.OAuth2DeviceCode;
import org.springframework.security.oauth2.core.OAuth2RefreshToken;
import org.springframework.security.oauth2.core.OAuth2Token;
import org.springframework.security.oauth2.core.OAuth2UserCode;
import org.springframework.security.oauth2.core.oidc.OidcIdToken;
import org.springframework.security.oauth2.server.authorization.JdbcOAuth2AuthorizationService;
import org.springframework.security.oauth2.server.authorization.OAuth2Authorization;
import org.springframework.security.oauth2.server.authorization.OAuth2AuthorizationService;
import org.springframework.security.oauth2.server.authorization.OAuth2TokenType;
import org.springframework.security.oauth2.server.authorization.client.RegisteredClientRepository;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * SAS persistence with the unified-authority semantics layered on
 * (identity-contract.md §2.3):
 *
 * <ul>
 *   <li><b>Lock order:</b> every save/remove takes the account's User row
 *       lock first, inside a primary-datasource transaction. A concurrent
 *       {@link UnifiedSessionAuthority#revokeAccount} holds that lock through
 *       its delete+commit, so a stale save blocks on the lock and is then
 *       rejected: the account-state + freshness assertion under the lock
 *       compares the request's presented credentialVersion (captured at
 *       authorize time) to the post-revoke row — mint-time claims alone
 *       cannot prove request-start freshness.</li>
 *   <li><b>At-rest encryption:</b> every {@code *_token_value} is AES-256-GCM
 *       ciphertext (deterministic nonce so {@code findByToken} still matches
 *       one value against every token column — AAD is a fixed class tag, not
 *       the column name).</li>
 *   <li><b>Session mirror:</b> grants carrying a refresh token upsert an
 *       OIDC-lane row into {@code campuscore_auth."Session"} (primary tx);
 *       removes delete it.</li>
 * </ul>
 */
public class LockingIdentityAuthorizationService extends JdbcOAuth2AuthorizationService {

    /** Deterministic-AEAD class tag shared by every token column. */
    static final String TOKEN_AAD = "oauth2_authorization.token_value";

    private final DeterministicTokenCipher cipher;
    private final AuthUserRepository users;
    private final IdentitySessionMirror mirror;
    private final RegisteredClientRepository clients;

    public LockingIdentityAuthorizationService(JdbcOperations jdbcOperations,
            RegisteredClientRepository registeredClientRepository,
            DeterministicTokenCipher cipher, AuthUserRepository users,
            IdentitySessionMirror mirror) {
        super(jdbcOperations, registeredClientRepository);
        this.cipher = cipher;
        this.users = users;
        this.mirror = mirror;
        this.clients = registeredClientRepository;
    }

    /**
     * Joins the caller's transaction when one exists (none does inside SAS
     * grant providers, so REQUIRED opens a primary-datasource tx that holds
     * the User lock through the mirror write). The identity-datasource
     * {@code super.save} is autocommit on a second pool — it runs LAST so a
     * failure leaves the primary tx to roll the mirror back cleanly; a
     * post-commit primary failure can still orphan the grant row, which is
     * why the lock+freshness gate (not the transaction) is the
     * anti-resurrection mechanism.
     */
    @Override
    @Transactional(propagation = Propagation.REQUIRED)
    public void save(OAuth2Authorization authorization) {
        String userId = authorization.getPrincipalName();
        users.lockUserRow(userId);
        OAuth2Authorization prepared = portablePrincipal(authorization);
        try {
            assertCurrentCredentials(prepared, userId);
        } catch (OAuth2AuthenticationException exception) {
            // SAS's authorize failure handler requires its endpoint-specific
            // exception type; a generic persistence rejection causes a cast
            // failure / HTTP 500. Translate only the initial code stage, leaving
            // token exchange/refresh error handling and under-lock checks intact.
            OAuth2AuthorizationRequest request = prepared.getAttribute(
                    OAuth2AuthorizationRequest.class.getName());
            if (prepared.getAccessToken() == null && request != null
                    && AuthorizationGrantType.AUTHORIZATION_CODE.equals(prepared.getAuthorizationGrantType())) {
                var client = clients.findById(prepared.getRegisteredClientId());
                var redirectContext = client != null
                        && client.getClientId().equals(request.getClientId())
                        && client.getRedirectUris().contains(request.getRedirectUri())
                        ? new OAuth2AuthorizationCodeRequestAuthenticationToken(
                                request.getAuthorizationUri(), request.getClientId(),
                                prepared.getAttribute(java.security.Principal.class.getName()),
                                request.getRedirectUri(), request.getState(), request.getScopes(),
                                request.getAdditionalParameters())
                        : null;
                throw new OAuth2AuthorizationCodeRequestAuthenticationException(
                        new OAuth2Error("login_required"), redirectContext);
            }
            throw exception;
        }
        mirrorGrant(prepared);
        super.save(encrypt(prepared));
    }

    @Override
    @Transactional(propagation = Propagation.REQUIRED)
    public void remove(OAuth2Authorization authorization) {
        users.lockUserRow(authorization.getPrincipalName());
        mirror.deleteByAuthorizationId(authorization.getId());
        super.remove(authorization);
    }

    @Override
    public OAuth2Authorization findById(String id) {
        return decrypt(super.findById(id));
    }

    @Override
    public OAuth2Authorization findByToken(String token, OAuth2TokenType tokenType) {
        // Deterministic encryption keeps the single-value lookup valid across
        // every token column in SAS's fixed WHERE clause.
        return decrypt(super.findByToken(cipher.encrypt(token, TOKEN_AAD), tokenType));
    }

    /**
     * Authorization attribute holding the credentialVersion the
     * <em>presenting</em> session JWT carried when the grant was created —
     * captured at authorize time and persisted with the grant, so every
     * later save (code stage, exchange, refresh) can prove the request did
     * not start before a concurrent {@link UnifiedSessionAuthority#revokeAccount}
     * bumped the account revision. A mint-time claim alone cannot prove
     * this: tokens minted after the bump already carry the new version.
     */
    static final String PRESENTED_VERSION_ATTRIBUTE =
            "io.campuscore.identity.presentedCredentialVersion";

    /**
     * Under the User lock, every save must prove three things: the account
     * still exists in a grant-eligible state (ACTIVE, no forced password
     * rotation), and the request's freshness version matches the row.
     * Freshness comes from the persisted presented-version attribute when
     * available (request start), else the access token's credentialVersion
     * claim; a save with neither signal is refused. A concurrent
     * revokeAccount bumps credentialVersion after deleting grants, so a
     * stale save — code-stage or refresh — mismatches and dies here.
     */
    private void assertCurrentCredentials(OAuth2Authorization authorization, String userId) {
        Optional<AuthUserRepository.AccountAuthorization> state =
                users.findAccountAuthorization(userId);
        if (state.isEmpty() || !"ACTIVE".equals(state.get().status())) {
            throw new OAuth2AuthenticationException(new OAuth2Error(
                    OAuth2ErrorCodes.ACCESS_DENIED, "account not grant-eligible", null));
        }
        if (state.get().mustChangePassword()) {
            throw new OAuth2AuthenticationException(new OAuth2Error(
                    OAuth2ErrorCodes.ACCESS_DENIED, "account requires password rotation", null));
        }
        Long freshVersion = presentedVersion(authorization);
        boolean requestStart = freshVersion != null;
        if (freshVersion == null) {
            OAuth2Authorization.Token<OAuth2AccessToken> access = authorization.getAccessToken();
            if (access != null) {
                freshVersion = credentialVersionClaim(access.getToken().getTokenValue());
            }
        }
        if (freshVersion == null) {
            // The grant carries no request-start freshness signal at all —
            // treat it as unverifiable rather than letting an unversioned
            // write bypass the current-account gate.
            throw new OAuth2AuthenticationException(new OAuth2Error(
                    OAuth2ErrorCodes.INVALID_GRANT,
                    "identity grant missing freshness signal", null));
        }
        if (state.get().credentialVersion() != freshVersion) {
            throw new OAuth2AuthenticationException(new OAuth2Error(
                    OAuth2ErrorCodes.INVALID_GRANT,
                    "identity grant superseded by a newer account credential revision",
                    null));
        }
        // A save carrying an access token is by construction a second-stage
        // update of the row the code stage already inserted — the real SAS
        // flow never mints an access token before the first save. A missing
        // row at this point means a delete committed underneath us. The
        // version compare above only catches deletes that bump
        // (revokeAccount); per-client logout (revokeClientGrants), the OIDC
        // logout provider's remove(), /oauth2/revoke, and admin session
        // revokes all delete WITHOUT bumping, and a matching
        // presentedVersion cannot distinguish those from a live row. So
        // the only legal missing-row save is the first code stage:
        // request-start freshness + no access token yet. Pre-attribute
        // rows have no presentedVersion at all — for them any missing row
        // is a resurrecting insert. (Every grant-row delete except the
        // retention sweep holds this User lock; the sweep's victim set is
        // disjoint — all four token expiries must be past the grace
        // cutoff, which no live save can satisfy.)
        if (super.findById(authorization.getId()) == null
                && (!requestStart || authorization.getAccessToken() != null)) {
            throw new OAuth2AuthenticationException(new OAuth2Error(
                    OAuth2ErrorCodes.INVALID_GRANT,
                    "identity grant no longer exists for this account", null));
        }
    }

    /**
     * The persisted request-start freshness signal. An attribute that is
     * present but unreadable is worse than absent — absent falls back to
     * the mint-time claim, unreadable must never silently upgrade to it.
     */
    private static Long presentedVersion(OAuth2Authorization authorization) {
        Object value = authorization.getAttribute(PRESENTED_VERSION_ATTRIBUTE);
        if (value == null) {
            return null;
        }
        if (value instanceof Number number) {
            return number.longValue();
        }
        if (value instanceof String text) {
            try {
                return Long.valueOf(text);
            } catch (NumberFormatException ignored) {
                return Long.MIN_VALUE;
            }
        }
        return Long.MIN_VALUE;
    }

    /**
     * The stored {@code java.security.Principal} attribute must survive the
     * attributes-column serialization. A {@code JwtAuthenticationToken} wraps
     * the decoded {@code Jwt}, whose {@code getIssuer()} converts {@code iss}
     * to a URL — the legacy issuer {@code campuscore-restful-api} is not one,
     * so the write would fail. A {@code UsernamePasswordAuthenticationToken}
     * keeps the same name/authorities and is the shape SAS itself persists.
     * While here, the presenting token's credentialVersion is copied into
     * {@link #PRESENTED_VERSION_ATTRIBUTE} as the request-start freshness
     * signal for {@link #assertCurrentCredentials}.
     */
    private static OAuth2Authorization portablePrincipal(OAuth2Authorization authorization) {
        Object principal = authorization.getAttribute(java.security.Principal.class.getName());
        if (!(principal instanceof org.springframework.security.core.Authentication authentication)
                || principal instanceof UsernamePasswordAuthenticationToken) {
            return authorization;
        }
        OAuth2Authorization.Builder builder = OAuth2Authorization.from(authorization)
                .attribute(java.security.Principal.class.getName(),
                        new UsernamePasswordAuthenticationToken(
                                authentication.getName(), "n/a",
                                authentication.getAuthorities()));
        if (authentication instanceof JwtAuthenticationToken jwtAuth
                && authorization.getAttribute(PRESENTED_VERSION_ATTRIBUTE) == null) {
            Object claim = jwtAuth.getToken().getClaims().get("credentialVersion");
            if (claim instanceof Number number) {
                builder.attribute(PRESENTED_VERSION_ATTRIBUTE,
                        String.valueOf(number.longValue()));
            }
        }
        return builder.build();
    }

    private static Long credentialVersionClaim(String tokenValue) {
        try {
            Object claim = JWTParser.parse(tokenValue).getJWTClaimsSet()
                    .getClaim("credentialVersion");
            return claim instanceof Number number ? number.longValue() : null;
        } catch (ParseException exception) {
            return null;
        }
    }

    /**
     * Mirrors the grant into the Session table on the primary tx when a
     * refresh token exists; grants without one just mark a rotation so the
     * mirror does not go stale.
     */
    private void mirrorGrant(OAuth2Authorization authorization) {
        OAuth2Authorization.Token<OAuth2RefreshToken> refresh = authorization.getRefreshToken();
        if (refresh != null) {
            Instant expiresAt = refresh.getToken().getExpiresAt();
            mirror.upsertOidcSession(
                    authorization.getPrincipalName(),
                    authorization.getId(),
                    authorization.getRegisteredClientId(),
                    refresh.getToken().getTokenValue(),
                    expiresAt != null ? expiresAt : Instant.now().plusSeconds(604800));
            mirror.recordRefreshLineage(authorization.getId(),
                    authorization.getPrincipalName(), refresh.getToken().getTokenValue());
        } else {
            mirror.markRotated(authorization.getId());
        }
    }

    private OAuth2Authorization encrypt(OAuth2Authorization authorization) {
        return transformTokens(authorization, true);
    }

    private OAuth2Authorization decrypt(OAuth2Authorization authorization) {
        return authorization == null ? null : transformTokens(authorization, false);
    }

    /** Rebuilds the authorization with every token value encrypted/decrypted. */
    private OAuth2Authorization transformTokens(OAuth2Authorization authorization, boolean encrypting) {
        OAuth2Authorization.Builder builder = OAuth2Authorization.from(authorization);
        replaceToken(builder, authorization.getToken(OAuth2AuthorizationCode.class),
                value -> new OAuth2AuthorizationCode(value,
                        authorization.getToken(OAuth2AuthorizationCode.class).getToken().getIssuedAt(),
                        authorization.getToken(OAuth2AuthorizationCode.class).getToken().getExpiresAt()),
                encrypting);
        replaceAccessToken(builder, authorization, encrypting);
        replaceToken(builder, authorization.getToken(OAuth2RefreshToken.class),
                value -> new OAuth2RefreshToken(value,
                        authorization.getToken(OAuth2RefreshToken.class).getToken().getIssuedAt(),
                        authorization.getToken(OAuth2RefreshToken.class).getToken().getExpiresAt()),
                encrypting);
        replaceIdToken(builder, authorization, encrypting);
        replaceToken(builder, authorization.getToken(OAuth2UserCode.class),
                value -> new OAuth2UserCode(value,
                        authorization.getToken(OAuth2UserCode.class).getToken().getIssuedAt(),
                        authorization.getToken(OAuth2UserCode.class).getToken().getExpiresAt()),
                encrypting);
        replaceToken(builder, authorization.getToken(OAuth2DeviceCode.class),
                value -> new OAuth2DeviceCode(value,
                        authorization.getToken(OAuth2DeviceCode.class).getToken().getIssuedAt(),
                        authorization.getToken(OAuth2DeviceCode.class).getToken().getExpiresAt()),
                encrypting);
        return builder.build();
    }

    private <T extends OAuth2Token> void replaceToken(OAuth2Authorization.Builder builder,
            OAuth2Authorization.Token<T> token,
            java.util.function.Function<String, T> rebuild, boolean encrypting) {
        if (token == null) {
            return;
        }
        String transformed = transform(token.getToken().getTokenValue(), encrypting);
        builder.token(rebuild.apply(transformed),
                metadata -> metadata.putAll(portableMetadata(token.getMetadata(), encrypting)));
    }

    private void replaceAccessToken(OAuth2Authorization.Builder builder,
            OAuth2Authorization authorization, boolean encrypting) {
        OAuth2Authorization.Token<OAuth2AccessToken> token = authorization.getAccessToken();
        if (token == null) {
            return;
        }
        OAuth2AccessToken original = token.getToken();
        String transformed = transform(original.getTokenValue(), encrypting);
        builder.token(new OAuth2AccessToken(original.getTokenType(), transformed,
                        original.getIssuedAt(), original.getExpiresAt(), original.getScopes()),
                metadata -> metadata.putAll(portableMetadata(token.getMetadata(), encrypting)));
    }

    private void replaceIdToken(OAuth2Authorization.Builder builder,
            OAuth2Authorization authorization, boolean encrypting) {
        OAuth2Authorization.Token<OidcIdToken> token = authorization.getToken(OidcIdToken.class);
        if (token == null) {
            return;
        }
        OidcIdToken original = token.getToken();
        String transformed = transform(original.getTokenValue(), encrypting);
        builder.token(OidcIdToken.withTokenValue(transformed)
                        .issuedAt(original.getIssuedAt())
                        .expiresAt(original.getExpiresAt())
                        .claims(claims -> claims.putAll(original.getClaims()))
                        .build(),
                metadata -> metadata.putAll(portableMetadata(token.getMetadata(), encrypting)));
    }

    private String transform(String value, boolean encrypting) {
        return encrypting ? cipher.encrypt(value, TOKEN_AAD) : cipher.decrypt(value, TOKEN_AAD);
    }

    /**
     * SAS persists {@code metadata.token.claims} through a polymorphic-type
     * mapper whose allowlist only admits SAS types, String, Instant,
     * Duration, URL and the common java.util containers — a Long
     * credentialVersion or java.util.ImmutableCollections map fails the
     * read-back validator. On save, claim values narrow to portable forms;
     * on load, the claims this lane mints are restored to their typed
     * values. The on-wire JWT is unaffected — this only touches the stored
     * metadata copy.
     */
    private static Map<String, Object> portableMetadata(
            Map<String, Object> metadata, boolean encrypting) {
        Object claims = metadata.get(OAuth2Authorization.Token.CLAIMS_METADATA_NAME);
        if (!(claims instanceof Map<?, ?> claimMap)) {
            return metadata;
        }
        Map<String, Object> portableClaims = new java.util.LinkedHashMap<>();
        claimMap.forEach((name, value) -> portableClaims.put(String.valueOf(name),
                encrypting ? portableClaimValue(value)
                        : restoredClaimValue(String.valueOf(name), value)));
        Map<String, Object> portable = new java.util.LinkedHashMap<>(metadata);
        portable.put(OAuth2Authorization.Token.CLAIMS_METADATA_NAME, portableClaims);
        return portable;
    }

    private static Object portableClaimValue(Object value) {
        if (value == null || value instanceof String || value instanceof Instant
                || value instanceof java.net.URL || value instanceof java.time.Duration) {
            return value;
        }
        if (value instanceof Map<?, ?> map) {
            Map<String, Object> copy = new java.util.LinkedHashMap<>();
            map.forEach((key, item) -> copy.put(String.valueOf(key), portableClaimValue(item)));
            return copy;
        }
        if (value instanceof java.util.Collection<?> collection) {
            java.util.List<Object> copy = new java.util.ArrayList<>(collection.size());
            collection.forEach(item -> copy.add(portableClaimValue(item)));
            return copy;
        }
        return String.valueOf(value);
    }

    private static Object restoredClaimValue(String path, Object value) {
        if (value instanceof Map<?, ?> map) {
            Map<String, Object> copy = new java.util.LinkedHashMap<>();
            map.forEach((key, item) -> copy.put(String.valueOf(key),
                    restoredClaimValue(path + "." + key, item)));
            return copy;
        }
        if (("credentialVersion".equals(path) || "student.year".equals(path))
                && value instanceof String text) {
            try {
                return Long.valueOf(text);
            } catch (NumberFormatException ignored) {
                return value;
            }
        }
        return value;
    }
}
