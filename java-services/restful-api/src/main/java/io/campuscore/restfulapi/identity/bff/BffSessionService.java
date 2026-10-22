package io.campuscore.restfulapi.identity.bff;

import com.nimbusds.jwt.JWT;
import com.nimbusds.jwt.JWTParser;
import io.campuscore.restfulapi.identity.DeterministicTokenCipher;
import io.campuscore.restfulapi.identity.IdentityProperties;
import io.campuscore.restfulapi.identity.IdentityProperties.Surface;
import io.campuscore.restfulapi.identity.UnifiedSessionAuthority;
import io.campuscore.restfulapi.auth.repository.AuthUserRepository;
import io.campuscore.restfulapi.identity.bff.BffSessionStore.Session;
import io.campuscore.restfulapi.identity.bff.BffSessionStore.Transaction;
import jakarta.servlet.http.HttpServletRequest;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.text.ParseException;
import java.time.Instant;
import java.util.Base64;
import java.util.List;
import java.util.Optional;
import org.springframework.security.oauth2.server.authorization.OAuth2TokenType;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtException;
import org.springframework.security.oauth2.server.authorization.OAuth2Authorization;
import org.springframework.security.oauth2.server.authorization.OAuth2AuthorizationService;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * BFF session lifecycle (host-policy §3/§5). The browser holds only the
 * opaque host-only cookie; every OAuth2 artifact lives server-side in the
 * SAS grant row this service binds to. All mutating paths take the account
 * User row lock or the session row lock so they serialize against
 * UnifiedSessionAuthority revokes and against concurrent refreshes.
 */
@ConditionalOnProperty(prefix = "identity.bff", name = "enabled", havingValue = "true")
@Service
public class BffSessionService {

    private static final String CODE_VERIFIER_AAD = "bff_tx.verifier";
    private static final String CSRF_AAD = "bff_session.csrf";

    private final IdentityProperties properties;
    private final BffSessionStore store;
    private final BffTokenClient tokens;
    private final DeterministicTokenCipher cipher;
    private final OAuth2AuthorizationService authorizations;
    private final AuthUserRepository users;
    private final UnifiedSessionAuthority authority;
    private final io.campuscore.restfulapi.identity.IdentityJwtDecoder decoder;
    /** Per-session single-flight locks — see resolveForBusiness. */
    private final java.util.concurrent.ConcurrentHashMap<String, Object> refreshLocks =
            new java.util.concurrent.ConcurrentHashMap<>();

    public BffSessionService(IdentityProperties properties, BffSessionStore store,
            BffTokenClient tokens, DeterministicTokenCipher cipher,
            OAuth2AuthorizationService authorizations, AuthUserRepository users,
            UnifiedSessionAuthority authority,
            io.campuscore.restfulapi.identity.IdentityJwtDecoder decoder) {
        this.properties = properties;
        this.store = store;
        this.tokens = tokens;
        this.cipher = cipher;
        this.authorizations = authorizations;
        this.users = users;
        this.authority = authority;
        this.decoder = decoder;
    }

    // ---- login leg -------------------------------------------------------

    public record LoginStart(String authorizeUrl, String txCookieName,
            String txCookieValue, long txCookieMaxAge) {
    }

    /** Builds the authorize leg for a surface: one transaction row, one
     * tx-scoped cookie (concurrent login tabs never collide — KM-M6). */
    public LoginStart startLogin(Surface surface, String base, String returnPath) {
        String state = BffSessionStore.randomId(32);
        String nonce = BffSessionStore.randomId(24);
        String txId = BffSessionStore.randomId(12);
        String verifier = BffSessionStore.randomId(48);
        Instant expires = Instant.now().plus(properties.getBff().getTransactionTtl());
        store.insertTransaction(state, txId, surface.getId(), nonce,
                cipher.encrypt(verifier, CODE_VERIFIER_AAD), returnPath, expires);
        String challenge = Base64.getUrlEncoder().withoutPadding()
                .encodeToString(sha256(verifier));
        String url = properties.getBff().getIssuerPublic() + "/oauth2/authorize"
                + "?response_type=code&client_id=" + enc(surface.getClientId())
                + "&redirect_uri=" + enc(base + "/session/callback")
                + "&scope=openid&state=" + enc(state)
                + "&nonce=" + enc(nonce)
                + "&code_challenge=" + enc(challenge)
                + "&code_challenge_method=S256";
        return new LoginStart(url, "cu_bff_tx_" + txId, txId,
                properties.getBff().getTransactionTtl().toSeconds());
    }

    // ---- callback leg ----------------------------------------------------

    public record CallbackResult(boolean ok, String redirectTo, String cookieValue,
            String csrfToken, String failure) {
    }

    /**
     * Consumes the transaction exactly once, exchanges the code server-side
     * (loopback → real SAS chain: PKCE, single-use code, replay hooks), then
     * inserts the session under the User lock with a live-grant check so a
     * revoke landing between exchange and insert cannot bind a cookie to a
     * dead grant (KM-M9).
     */
    @Transactional(propagation = Propagation.REQUIRED)
    public CallbackResult finishLogin(Surface surface, String base,
            String code, String state, HttpServletRequest request) {
        Transaction tx = store.consumeTransaction(state);
        if (tx == null || !tx.surface().equals(surface.getId())
                || tx.expiresAt().isBefore(Instant.now())) {
            return new CallbackResult(false, null, null, null, "TX_INVALID");
        }
        // The tx cookie is bound by NAME (cu_bff_tx_<txId>), not merely by
        // prefix — a cookie tossed onto the surface by a sibling/subdomain
        // carries a foreign txId and can never match this transaction, so
        // it is inert instead of an ordering gamble between prefix-matched
        // cookies.
        String txCookieValue = txCookieValue(request, tx.txId());
        if (txCookieValue == null || !MessageDigest.isEqual(
                txCookieValue.getBytes(StandardCharsets.UTF_8),
                tx.txId().getBytes(StandardCharsets.UTF_8))) {
            return new CallbackResult(false, null, null, null, "TX_COOKIE_MISSING");
        }

        BffTokenClient.TokenResponse tokenResponse;
        try {
            tokenResponse = tokens.exchangeCode(surface, code,
                    base + "/session/callback",
                    cipher.decrypt(tx.verifierCiphertext(), CODE_VERIFIER_AAD));
        } catch (RuntimeException exception) {
            return new CallbackResult(false, null, null, null, "EXCHANGE_FAILED");
        }

        // Nonce/audience check on the issued id_token (KM-L12): signature and
        // expiry are already validated by the decoder's JWK lane; the nonce
        // must match the transaction so a stolen id_token cannot be replayed
        // into a different authorize leg.
        if (!verifyIdToken(tokenResponse.idToken(), tx.nonce(),
                surface.getClientId())) {
            return new CallbackResult(false, null, null, null, "ID_TOKEN_INVALID");
        }

        OAuth2Authorization grant = authorizations.findByToken(
                tokenResponse.accessToken(), OAuth2TokenType.ACCESS_TOKEN);
        if (grant == null) {
            return new CallbackResult(false, null, null, null, "GRANT_MISSING");
        }
        String userId = grant.getPrincipalName();

        // Session insert under the User row lock with the live-grant
        // re-assert: a revoke that committed between the exchange and now
        // deleted the grant row, and binding a cookie to it would resurrect
        // its usefulness.
        users.lockUserRow(userId);
        Optional<AuthUserRepository.AccountAuthorization> account =
                users.findAccountAuthorization(userId);
        if (account.isEmpty() || !"ACTIVE".equals(account.get().status())
                || account.get().mustChangePassword()) {
            return new CallbackResult(false, null, null, null, "ACCOUNT_INELIGIBLE");
        }
        if (authorizations.findById(grant.getId()) == null) {
            return new CallbackResult(false, null, null, null, "GRANT_GONE");
        }

        String opaque = BffSessionStore.randomId(32);
        String csrf = BffSessionStore.randomId(32);
        String ip = request == null ? null : request.getRemoteAddr();
        String ua = request == null ? null
                : truncate(request.getHeader("User-Agent"), 290);
        Instant expires = Instant.now().plus(properties.getBff().getSessionTtl());
        store.insertSession(opaque, userId, surface.getId(), surface.getClientId(),
                grant.getId(), cipher.encrypt(csrf, CSRF_AAD), ip, ua, expires);
        return new CallbackResult(true, tx.returnPath(), opaque, csrf, null);
    }

    /** Exact-name lookup: the only cookie that authenticates a callback is
     *  the one minted for this transaction id. */
    private String txCookieValue(HttpServletRequest request, String txId) {
        jakarta.servlet.http.Cookie[] cookies = request == null
                ? null : request.getCookies();
        if (cookies == null) {
            return null;
        }
        String expected = (properties.getBff().isDevHttp()
                ? BffSessionController.TX_COOKIE_PREFIX_DEV
                : BffSessionController.TX_COOKIE_PREFIX) + txId;
        for (jakarta.servlet.http.Cookie cookie : cookies) {
            if (expected.equals(cookie.getName())) {
                return cookie.getValue();
            }
        }
        return null;
    }

    private boolean verifyIdToken(String idTokenValue, String expectedNonce,
            String expectedAudience) {
        if (idTokenValue == null) {
            return false;
        }
        try {
            Jwt decoded = decoder.decodeOidc(idTokenValue);
            Object nonce = decoded.getClaims().get("nonce");
            Object aud = decoded.getClaims().get("aud");
            boolean nonceOk = expectedNonce.equals(nonce);
            boolean audOk = aud instanceof List<?> list ? list.contains(expectedAudience)
                    : expectedAudience.equals(aud);
            return nonceOk && audOk;
        } catch (JwtException | IllegalArgumentException exception) {
            return false;
        }
    }

    // ---- request-time session authority ---------------------------------

    public record ResolvedSession(Session session, String userId,
            String accessToken, boolean ok, String failure) {
    }

    /**
     * Resolves + asserts the session for a /bff/api request (host-policy §5
     * steps 2-4). Single-flight refresh is serialized by an in-process
     * striped lock per session — NOT a DB row lock: the loopback
     * /oauth2/token call executes the real SAS chain, which takes the
     * account User lock on its own connection, so holding User or
     * bff_session locks across that call would deadlock against it or
     * against a concurrent revoke (User → bff_session). With no DB locks
     * held across the loopback every interleaving is fail-closed: a revoke
     * landing before the refresh makes SAS reject the rotated-away token;
     * one landing after deletes the new grant and the session we re-check.
     */
    public ResolvedSession resolveForBusiness(Surface surface, String opaqueValue) {
        if (opaqueValue == null || opaqueValue.isBlank()) {
            return fail("SESSION_REQUIRED");
        }
        String lockKey = surface.getId() + "|" + BffSessionStore.sha256Hex(opaqueValue);
        Object lock = refreshLocks.computeIfAbsent(lockKey, k -> new Object());
        synchronized (lock) {
            try {
                return resolveLocked(surface, opaqueValue);
            } finally {
                refreshLocks.remove(lockKey, lock);
            }
        }
    }

    private ResolvedSession resolveLocked(Surface surface, String opaqueValue) {
        Session session = store.findSession(opaqueValue, surface.getId());
        if (session == null || session.revokedAt() != null
                || session.expiresAt().isBefore(Instant.now())) {
            return fail("SESSION_REQUIRED");
        }
        String userId = session.userId();
        Optional<AuthUserRepository.AccountAuthorization> account =
                users.findAccountAuthorization(userId);
        if (account.isEmpty() || !"ACTIVE".equals(account.get().status())) {
            return fail("ACCOUNT_INELIGIBLE");
        }
        if (account.get().mustChangePassword()) {
            return fail("PASSWORD_CHANGE_REQUIRED");
        }
        OAuth2Authorization grant = authorizations.findById(session.authorizationId());
        if (grant == null) {
            // The authority deleted the grant (logout/revoke/replay): this
            // session is dead — kill it so the cookie fails closed.
            store.revokeSession(opaqueValue, surface.getId());
            return fail("SESSION_REQUIRED");
        }
        Long tokenVersion = credentialVersion(grant);
        if (tokenVersion != null
                && tokenVersion != account.get().credentialVersion()) {
            // Stale-grant belt: account revocation should have deleted the
            // grant and the session with it; a survivor means the row was
            // written by pre-gate code — kill it rather than trust it.
            store.revokeSession(opaqueValue, surface.getId());
            return fail("SESSION_REQUIRED");
        }

        String accessToken = accessTokenValue(grant);
        if (accessToken == null || accessExpired(grant)) {
            String refreshValue = refreshTokenValue(grant);
            if (refreshValue == null) {
                store.revokeSession(opaqueValue, surface.getId());
                return fail("SESSION_REQUIRED");
            }
            try {
                BffTokenClient.TokenResponse rotated = tokens.refresh(
                        surface, refreshValue);
                OAuth2Authorization refreshed = authorizations.findByToken(
                        rotated.accessToken(), OAuth2TokenType.ACCESS_TOKEN);
                if (refreshed == null) {
                    store.revokeSession(opaqueValue, surface.getId());
                    return fail("SESSION_REQUIRED");
                }
                grant = refreshed;
                accessToken = rotated.accessToken();
            } catch (RuntimeException exception) {
                // A refresh failure after a committed revoke (replay or
                // account kill) means this lane is dead — revoke the row.
                // RuntimeException covers TokenExchangeException plus any
                // SAS-side rejection the loopback surfaces (a deleted grant
                // row makes the locking save fail with an auth error rather
                // than an HTTP error body).
                store.revokeSession(opaqueValue, surface.getId());
                return fail("SESSION_REQUIRED");
            }
            // Re-check the session after the loopback: a logout or revoke
            // could have landed while the SAS chain ran — the session row
            // must still be live for this request to proceed.
            Session reRead = store.findSession(opaqueValue, surface.getId());
            if (reRead == null || reRead.revokedAt() != null) {
                return fail("SESSION_REQUIRED");
            }
            session = reRead;
        }
        store.touch(session.id());
        return new ResolvedSession(session, userId, accessToken, true, null);
    }

    // ---- logout ----------------------------------------------------------

    public record LogoutResult(String logoutUrl) {
    }

    /**
     * Per-surface logout (KM-M5 ordering): read the id_token BEFORE the
     * grant delete — the hint is stored inside the grant row and is
     * unrecoverable afterwards. Revokes the BFF session and the OIDC grant
     * through the unified authority; repeated calls are no-ops.
     */
    @Transactional(propagation = Propagation.REQUIRED)
    public LogoutResult logout(Surface surface, String base, String opaqueValue) {
        Session session = opaqueValue == null ? null
                : store.findSession(opaqueValue, surface.getId());
        String idTokenHint = null;
        String userId = null;
        if (session != null) {
            userId = session.userId();
            OAuth2Authorization grant =
                    authorizations.findById(session.authorizationId());
            if (grant != null) {
                idTokenHint = idTokenValue(grant);
            }
            users.lockUserRow(userId);
            store.revokeSession(opaqueValue, surface.getId());
            authority.revokeClientGrants(userId, surface.getClientId(),
                    "BFF_LOGOUT", null);
        }
        StringBuilder url = new StringBuilder(
                properties.getBff().getIssuerPublic() + "/connect/logout");
        String sep = "?";
        if (idTokenHint != null) {
            url.append(sep).append("id_token_hint=").append(enc(idTokenHint));
            sep = "&";
        }
        url.append(sep).append("post_logout_redirect_uri=")
                .append(enc(base + "/session/logged-out"));
        return new LogoutResult(url.toString());
    }

    /** Read-side session lookup used by the CSRF guard. */
    public Session findByOpaque(Surface surface, String opaqueValue) {
        return store.findSession(opaqueValue, surface.getId());
    }

    /**
     * The session-bound CSRF token is recoverable — /bff/session/state hands
     * it to the owning browser while a sibling attacker cannot read it.
     */
    public String csrfTokenFor(Session session) {
        return session == null ? null
                : cipher.decrypt(session.csrfCiphertext(), CSRF_AAD);
    }

    public boolean verifyCsrf(Session session, String presentedToken) {
        String expected = csrfTokenFor(session);
        return expected != null && presentedToken != null
                && MessageDigest.isEqual(
                        expected.getBytes(StandardCharsets.UTF_8),
                        presentedToken.getBytes(StandardCharsets.UTF_8));
    }

    // ---- grant introspection ---------------------------------------------

    private static Long credentialVersion(OAuth2Authorization grant) {
        String access = accessTokenValue(grant);
        if (access == null) {
            return null;
        }
        try {
            Object claim = JWTParser.parse(access).getJWTClaimsSet()
                    .getClaim("credentialVersion");
            return claim instanceof Number number ? number.longValue() : null;
        } catch (ParseException exception) {
            return null;
        }
    }

    private static String accessTokenValue(OAuth2Authorization grant) {
        OAuth2Authorization.Token<?> token = grant.getAccessToken();
        return token == null ? null : token.getToken().getTokenValue();
    }

    private static String refreshTokenValue(OAuth2Authorization grant) {
        OAuth2Authorization.Token<?> token = grant.getRefreshToken();
        return token == null ? null : token.getToken().getTokenValue();
    }

    private static String idTokenValue(OAuth2Authorization grant) {
        OAuth2Authorization.Token<?> token = grant.getToken(
                org.springframework.security.oauth2.core.oidc.OidcIdToken.class);
        return token == null ? null : token.getToken().getTokenValue();
    }

    private static boolean accessExpired(OAuth2Authorization grant) {
        OAuth2Authorization.Token<?> token = grant.getAccessToken();
        if (token == null || token.getToken().getExpiresAt() == null) {
            return true;
        }
        return token.getToken().getExpiresAt()
                .isBefore(Instant.now().plusSeconds(30));
    }

    private ResolvedSession fail(String code) {
        return new ResolvedSession(null, null, null, false, code);
    }

    private static byte[] sha256(String value) {
        try {
            return MessageDigest.getInstance("SHA-256")
                    .digest(value.getBytes(StandardCharsets.UTF_8));
        } catch (java.security.NoSuchAlgorithmException exception) {
            throw new IllegalStateException(exception);
        }
    }

    private static String enc(String value) {
        return URLEncoder.encode(value, StandardCharsets.UTF_8);
    }

    private static String truncate(String value, int max) {
        return value == null ? null
                : value.length() <= max ? value : value.substring(0, max);
    }
}
