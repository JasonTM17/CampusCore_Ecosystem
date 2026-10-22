package io.campuscore.restfulapi.identity;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.PlainJWT;
import io.campuscore.restfulapi.auth.service.AuthLoginService;
import java.net.URI;
import java.time.Instant;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIf;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.oauth2.core.AuthorizationGrantType;
import org.springframework.security.oauth2.core.OAuth2AccessToken;
import org.springframework.security.oauth2.core.OAuth2RefreshToken;
import org.springframework.security.oauth2.server.authorization.OAuth2Authorization;
import org.springframework.security.oauth2.server.authorization.OAuth2AuthorizationService;
import org.springframework.security.oauth2.server.authorization.client.RegisteredClientRepository;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/**
 * Real-PostgreSQL race + replay evidence for the unified session authority
 * (identity-contract.md §3): a replayed legacy refresh kills the OIDC lane,
 * an in-flight OIDC save cannot resurrect a grant after revoke, and a
 * per-client logout leaves other lanes untouched. Runs the production
 * migration set against the disposable council database.
 */
@EnabledIf("postgresTargetConfigured")
@SpringBootTest(properties = {
        "spring.flyway.locations=classpath:db/migration",
        "deepseek.enabled=false",
        "identity.oidc.enabled=true",
        "identity.oidc.dev-keygen=true",
        "identity.oidc.issuer-uri=http://127.0.0.1:4010",
        "identity.oidc.token-encryption-key=dGVzdC1rZXktMDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY=",
        "identity.clients[0].client-id=cu-hub",
        "identity.clients[0].client-secret=it-secret-0123456789abcdef0123456789",
        "identity.clients[0].redirect-uris[0]=http://127.0.0.1:3100/session/callback",
        "identity.clients[0].post-logout-redirect-uris[0]=http://127.0.0.1:3100/",
        "identity.clients[0].scopes[0]=openid"
})
@ActiveProfiles({"test", "persistence"})
class UnifiedSessionRevocationPostgresIT {

    private static final int WAIT_SECONDS = 20;
    private static final String CLIENT = "cu-hub";

    @Autowired private AuthLoginService authLogin;
    @Autowired private PasswordEncoder passwordEncoder;
    private final JdbcTemplate jdbc;
    @Autowired private UnifiedSessionAuthority authority;
    @Autowired private OAuth2AuthorizationService authorizationService;
    @Autowired private RegisteredClientRepository registeredClients;

    UnifiedSessionRevocationPostgresIT(@Autowired javax.sql.DataSource dataSource) {
        this.jdbc = new JdbcTemplate(dataSource);
    }

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", () -> System.getenv("CAMPUSCORE_COUNCIL_POSTGRES_URL"));
        registry.add("spring.datasource.username", () -> valueOr("CAMPUSCORE_COUNCIL_POSTGRES_USER", "campuscore"));
        registry.add("spring.datasource.password", () -> valueOr("CAMPUSCORE_COUNCIL_POSTGRES_PASSWORD", "postgres"));
    }

    @Test
    void legacyRefreshReplayRevokesEveryLane() throws Exception {
        String suffix = UUID.randomUUID().toString().substring(0, 8);
        String userId = insertUser(suffix);
        String email = "it-" + suffix + "@campuscore.edu";
        String password = "Race-" + suffix;

        String refreshToken = authLogin.login(email, password, "127.0.0.1", "race-it")
                .response().refreshToken();
        // Seed an OIDC grant + mirror row as if a prior SSO sign-in existed.
        saveOidcGrant(userId, currentVersion(userId));
        assertThat(countAuthz(userId)).isEqualTo(1);

        // Rotate once legitimately, then replay the consumed token.
        String rotated = authLogin.refresh(refreshToken, "127.0.0.1", "race-it")
                .response().refreshToken();
        assertThatThrownBy(() -> authLogin.refresh(refreshToken, "127.0.0.1", "race-it"))
                .isInstanceOf(BadCredentialsException.class);

        // Replay must kill every lane: sessions, mirrored rows, grants,
        // lineage — and bump the credential revision so live access dies.
        assertThat(countSessions(userId)).isEqualTo(0);
        assertThat(countAuthz(userId)).isEqualTo(0);
        assertThat(countLineage(userId)).isEqualTo(0);
        // A second replay (already-rotated token) must not resurrect anything.
        assertThatThrownBy(() -> authLogin.refresh(rotated, "127.0.0.1", "race-it"))
                .isInstanceOf(BadCredentialsException.class);
        assertThat(countSessions(userId)).isEqualTo(0);
    }

    @Test
    void staleOidcSaveCannotResurrectAfterAccountRevoke() throws Exception {
        String suffix = UUID.randomUUID().toString().substring(0, 8);
        String userId = insertUser(suffix);
        long version = currentVersion(userId);

        // Account-level kill first: any save carrying the pre-revoke
        // credential version must be refused by the post-lock assertion.
        authority.revokeAccount(userId, "OIDC", "TEST_REVOKE", "it-req-1");

        OAuth2Authorization stale = oidcGrant(userId, version);
        assertThatThrownBy(() -> authorizationService.save(stale))
                .hasMessageContaining("credential");
        assertThat(countAuthz(userId)).isEqualTo(0);
        assertThat(countSessions(userId)).isEqualTo(0);
    }

    @Test
    void oidcSaveThenRevokeSerializesWithoutResurrection() throws Exception {
        String suffix = UUID.randomUUID().toString().substring(0, 8);
        String userId = insertUser(suffix);
        long version = currentVersion(userId);

        // A second-stage save() and revokeAccount() race on the same User
        // row; whichever wins the lock first, the committed outcome must
        // leave no live grant behind.
        OAuth2Authorization racing = saveOidcGrant(userId, version);
        ExecutorService pool = Executors.newFixedThreadPool(2);
        CountDownLatch start = new CountDownLatch(1);
        try {
            Future<?> saver = pool.submit(() -> {
                await(start);
                try {
                    authorizationService.save(racing);
                } catch (org.springframework.security.oauth2.core.OAuth2AuthenticationException superseded) {
                    // Legitimate outcome: revoke won the lock first and the
                    // freshness or existence assertion refused the save.
                }
                return null;
            });
            Future<?> revoker = pool.submit(() -> {
                await(start);
                authority.revokeAccount(userId, "OIDC", "RACE", "it-req-2");
                return null;
            });
            start.countDown();
            saver.get(WAIT_SECONDS, TimeUnit.SECONDS);
            revoker.get(WAIT_SECONDS, TimeUnit.SECONDS);
        } finally {
            pool.shutdownNow();
            assertThat(pool.awaitTermination(WAIT_SECONDS, TimeUnit.SECONDS)).isTrue();
        }
        // Both orders are legitimate: save-then-revoke deletes the fresh
        // grant; revoke-then-save is refused by the version assertion. The
        // only forbidden outcome is a grant outliving the revoke.
        assertThat(countAuthz(userId)).isEqualTo(0);
        assertThat(countSessions(userId)).isEqualTo(0);
    }

    @Test
    void perClientLogoutKeepsOtherLanesAlive() throws Exception {
        String suffix = UUID.randomUUID().toString().substring(0, 8);
        String userId = insertUser(suffix);
        String email = "it-" + suffix + "@campuscore.edu";
        String password = "Race-" + suffix;

        authLogin.login(email, password, "127.0.0.1", "race-it");
        saveOidcGrant(userId, currentVersion(userId));
        assertThat(countSessions(userId)).isEqualTo(2); // legacy + oidc mirror
        assertThat(countAuthz(userId)).isEqualTo(1);

        int revoked = authority.revokeClientGrants(userId, CLIENT, "OIDC_LOGOUT", "it-req-3");
        assertThat(revoked).isEqualTo(1);
        assertThat(countAuthz(userId)).isEqualTo(0);
        // Legacy session survives the per-client OIDC logout.
        assertThat(countSessions(userId)).isEqualTo(1);
        // Idempotent: a repeated revoke of the same client is a no-op.
        assertThat(authority.revokeClientGrants(userId, CLIENT, "OIDC_LOGOUT", "it-req-3"))
                .isEqualTo(0);
    }

    @Test
    void codeStageSaveWithoutFreshnessSignalIsRejected() throws Exception {
        // Wukong mechanism A: a code-stage grant (only an
        // OAuth2AuthorizationCode, no access token) previously skipped the
        // version gate entirely. Without a request-start freshness signal
        // the save must now fail closed.
        String suffix = UUID.randomUUID().toString().substring(0, 8);
        String userId = insertUser(suffix);
        OAuth2Authorization codeStage = codeStageGrant(userId, null);
        assertThatThrownBy(() -> authorizationService.save(codeStage))
                .hasMessageContaining("freshness");
        assertThat(countAuthz(userId)).isEqualTo(0);
    }

    @Test
    void codeStageSaveAfterCommittedRevokeIsRejected() throws Exception {
        // Mechanism A with the freshness attribute: a request that started
        // before the revoke carries the pre-bump presentedVersion and must
        // die under the lock; a request that starts after the bump carries
        // the current version and is legitimately allowed.
        String suffix = UUID.randomUUID().toString().substring(0, 8);
        String userId = insertUser(suffix);
        long stale = currentVersion(userId);
        authority.revokeAccount(userId, "OIDC", "TEST_REVOKE", "it-req-4");

        OAuth2Authorization staleRequest = codeStageGrant(userId, stale);
        assertThatThrownBy(() -> authorizationService.save(staleRequest))
                .hasMessageContaining("superseded");
        assertThat(countAuthz(userId)).isEqualTo(0);

        OAuth2Authorization freshRequest = codeStageGrant(userId, currentVersion(userId));
        authorizationService.save(freshRequest);
        assertThat(countAuthz(userId)).isEqualTo(1);
        // The freshness attribute must survive the attributes-column
        // round-trip — a silent serialization loss would reopen the
        // mint-time-claim fallback on every later exchange/refresh save.
        OAuth2Authorization reloaded = authorizationService.findById(freshRequest.getId());
        Object presented = reloaded.getAttribute(
                LockingIdentityAuthorizationService.PRESENTED_VERSION_ATTRIBUTE);
        assertThat(presented).isEqualTo(String.valueOf(currentVersion(userId)));
    }

    @Test
    void grantMintedAfterRevokeStillDiesOnExchange() throws Exception {
        // Mechanism B: the grant was created pre-revoke (presentedVersion
        // frozen at request start). The revoke bumps the account version,
        // then an exchange-stage save arrives whose freshly minted access
        // token already carries the post-bump version — the claim check
        // alone would pass, the persisted presentedVersion still refuses.
        String suffix = UUID.randomUUID().toString().substring(0, 8);
        String userId = insertUser(suffix);
        long version = currentVersion(userId);
        OAuth2Authorization grant = saveOidcGrant(userId, version);
        assertThat(countAuthz(userId)).isEqualTo(1);

        authority.revokeAccount(userId, "OIDC", "TEST_REVOKE", "it-req-5");
        assertThat(countAuthz(userId)).isEqualTo(0);

        // Rebuild the exchange-stage save as if the row had survived:
        // access token minted with the NEW version, presentedVersion stale.
        OAuth2Authorization resurrecting = OAuth2Authorization.from(grant)
                .accessToken(oidcGrant(userId, currentVersion(userId)).getAccessToken().getToken())
                .build();
        assertThatThrownBy(() -> authorizationService.save(resurrecting))
                .hasMessageContaining("superseded");
        assertThat(countAuthz(userId)).isEqualTo(0);

        // Pre-repair rows lack the freshness attribute: the mint-time claim
        // then equals the post-revoke version, so the stale-row existence
        // check under the User lock is what refuses the resurrecting insert.
        OAuth2Authorization attributeless = OAuth2Authorization.from(grant)
                .accessToken(oidcGrant(userId, currentVersion(userId)).getAccessToken().getToken())
                .attributes(attrs -> attrs.remove(
                        LockingIdentityAuthorizationService.PRESENTED_VERSION_ATTRIBUTE))
                .build();
        assertThatThrownBy(() -> authorizationService.save(attributeless))
                .hasMessageContaining("no longer exists");
        assertThat(countAuthz(userId)).isEqualTo(0);
    }

    @Test
    void secondStageSaveCannotResurrectAfterPerClientLogout() throws Exception {
        // Wukong falsification: revokeClientGrants (per-client OIDC logout),
        // the logout provider's remove(), /oauth2/revoke, and admin session
        // revokes all delete grant rows WITHOUT bumping credentialVersion.
        // A second-stage save that loaded the grant pre-delete (the refresh
        // path) carries presentedVersion == current and so passes the
        // version gate — only the missing-row check refuses the
        // resurrecting re-insert of grant + mirror + lineage.
        String suffix = UUID.randomUUID().toString().substring(0, 8);
        String userId = insertUser(suffix);
        OAuth2Authorization grant = saveOidcGrant(userId, currentVersion(userId));
        assertThat(countAuthz(userId)).isEqualTo(1);

        assertThat(authority.revokeClientGrants(userId, CLIENT, "OIDC_LOGOUT", "it-req-6"))
                .isEqualTo(1);
        assertThat(countAuthz(userId)).isEqualTo(0);
        assertThat(countSessions(userId)).isEqualTo(0);

        // The in-memory grant still carries presentedVersion == current:
        // version compare passes, but the row is gone — a save with an
        // access token on a missing row is always a second-stage update
        // and must die here.
        assertThatThrownBy(() -> authorizationService.save(grant))
                .hasMessageContaining("no longer exists");
        assertThat(countAuthz(userId)).isEqualTo(0);
        assertThat(countSessions(userId)).isEqualTo(0);
        // Lineage for the dead grant stays by design — replay attribution
        // for tokens minted pre-logout — and is bounded by the retention
        // job; it is inert because a dead grant's token never reaches
        // replay detection (findByToken fails first). The rejected save
        // must not have added a second row.
        assertThat(countLineage(userId)).isEqualTo(1);
    }

    @Test
    void suspendedAccountGrantSaveIsRejected() throws Exception {
        String suffix = UUID.randomUUID().toString().substring(0, 8);
        String userId = insertUser(suffix);
        jdbc.update("UPDATE campuscore_auth.\"User\" SET \"status\" = 'SUSPENDED' WHERE \"id\" = ?",
                userId);
        OAuth2Authorization grant = oidcGrant(userId, currentVersion(userId));
        assertThatThrownBy(() -> authorizationService.save(grant))
                .hasMessageContaining("grant-eligible");
        assertThat(countAuthz(userId)).isEqualTo(0);
    }

    // ---- fixtures -----------------------------------------------------------

    /** A code-stage grant: authorization code only, like the authorize save. */
    private OAuth2Authorization codeStageGrant(String userId, Long presentedVersion) {
        Instant now = Instant.now();
        var client = registeredClients.findByClientId(CLIENT);
        OAuth2Authorization.Builder builder = OAuth2Authorization.withRegisteredClient(client)
                .id(UUID.randomUUID().toString())
                .principalName(userId)
                .authorizationGrantType(AuthorizationGrantType.AUTHORIZATION_CODE)
                .authorizedScopes(Set.of("openid"))
                .attribute(java.security.Principal.class.getName(),
                        new UsernamePasswordAuthenticationToken(userId, "n/a",
                                List.of(new SimpleGrantedAuthority("ROLE_STUDENT"))))
                .token(new org.springframework.security.oauth2.server.authorization
                        .OAuth2AuthorizationCode("code-" + UUID.randomUUID(),
                                now, now.plusSeconds(120)));
        if (presentedVersion != null) {
            builder.attribute(LockingIdentityAuthorizationService.PRESENTED_VERSION_ATTRIBUTE,
                    String.valueOf(presentedVersion));
        }
        return builder.build();
    }

    private String insertUser(String suffix) {
        String userId = "identity-it-" + suffix;
        String email = "it-" + suffix + "@campuscore.edu";
        jdbc.update("INSERT INTO campuscore_auth.\"User\""
                        + " (\"id\", \"email\", \"password\", \"firstName\", \"lastName\", \"status\","
                        + " \"emailVerified\", \"isSuperAdmin\", \"failedLoginAttempts\", \"createdAt\", \"updatedAt\")"
                        + " VALUES (?, ?, ?, 'Race', 'User', 'ACTIVE', TRUE, FALSE, 0,"
                        + " CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)",
                userId, email, passwordEncoder.encode("Race-" + suffix));
        return userId;
    }

    /**
     * Persist a full grant the way SAS really does: code-stage insert
     * first, then a token-stage update of the same row. A direct
     * save-with-access-token on a missing row is a resurrecting insert
     * and the locking service now refuses it by construction.
     */
    private OAuth2Authorization saveOidcGrant(String userId, long credentialVersion) {
        OAuth2Authorization code = codeStageGrant(userId, credentialVersion);
        authorizationService.save(code);
        OAuth2Authorization full = oidcGrant(userId, credentialVersion);
        OAuth2Authorization updated = OAuth2Authorization.from(code)
                .accessToken(full.getAccessToken().getToken())
                .refreshToken(full.getRefreshToken().getToken())
                .build();
        authorizationService.save(updated);
        return authorizationService.findById(updated.getId());
    }

    /** A grant whose access token carries a parseable credentialVersion. */
    private OAuth2Authorization oidcGrant(String userId, long credentialVersion) {
        Instant now = Instant.now();
        PlainJWT accessJwt = new PlainJWT(new JWTClaimsSet.Builder()
                .subject(userId).claim("credentialVersion", credentialVersion)
                .expirationTime(java.util.Date.from(now.plusSeconds(900)))
                .build());
        OAuth2AccessToken access = new OAuth2AccessToken(
                OAuth2AccessToken.TokenType.BEARER, accessJwt.serialize(), now,
                now.plusSeconds(900), Set.of("openid"));
        OAuth2RefreshToken refresh = new OAuth2RefreshToken(
                "rt-" + UUID.randomUUID(), now, now.plusSeconds(604800));
        var client = registeredClients.findByClientId(CLIENT);
        return OAuth2Authorization.withRegisteredClient(client)
                .id(UUID.randomUUID().toString())
                .principalName(userId)
                .authorizationGrantType(AuthorizationGrantType.AUTHORIZATION_CODE)
                .authorizedScopes(Set.of("openid"))
                .attribute(java.security.Principal.class.getName(),
                        new UsernamePasswordAuthenticationToken(userId, "n/a",
                                List.of(new SimpleGrantedAuthority("ROLE_STUDENT"))))
                // Real post-repair grants carry the request-start freshness
                // attribute captured at authorize time.
                .attribute(LockingIdentityAuthorizationService.PRESENTED_VERSION_ATTRIBUTE,
                        String.valueOf(credentialVersion))
                .accessToken(access)
                .refreshToken(refresh)
                .build();
    }

    private long currentVersion(String userId) {
        Long version = jdbc.queryForObject(
                "SELECT \"credentialVersion\" FROM campuscore_auth.\"User\" WHERE \"id\" = ?",
                Long.class, userId);
        return version == null ? -1 : version;
    }

    private int countAuthz(String userId) {
        Integer count = jdbc.queryForObject(
                "SELECT COUNT(*) FROM campuscore_identity.oauth2_authorization"
                        + " WHERE principal_name = ?",
                Integer.class, userId);
        return count == null ? 0 : count;
    }

    private int countSessions(String userId) {
        Integer count = jdbc.queryForObject(
                "SELECT COUNT(*) FROM campuscore_auth.\"Session\" WHERE \"userId\" = ?",
                Integer.class, userId);
        return count == null ? 0 : count;
    }

    private int countLineage(String userId) {
        Integer count = jdbc.queryForObject(
                "SELECT COUNT(*) FROM campuscore_identity.oidc_refresh_lineage WHERE user_id = ?",
                Integer.class, userId);
        return count == null ? 0 : count;
    }

    private static void await(CountDownLatch latch) {
        try {
            if (!latch.await(WAIT_SECONDS, TimeUnit.SECONDS)) {
                throw new IllegalStateException("race barrier timeout");
            }
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException(exception);
        }
    }

    static boolean postgresTargetConfigured() {
        String url = System.getenv("CAMPUSCORE_COUNCIL_POSTGRES_URL");
        if (url == null || !url.startsWith("jdbc:postgresql:")) {
            return false;
        }
        try {
            URI uri = URI.create(url.substring("jdbc:".length()));
            String host = uri.getHost();
            boolean loopback = "localhost".equalsIgnoreCase(host)
                    || "127.0.0.1".equals(host) || "::1".equals(host) || "[::1]".equals(host);
            String path = uri.getPath();
            String database = path != null && path.startsWith("/") ? path.substring(1) : null;
            return loopback && database != null && database.startsWith("campuscore_council_race_");
        } catch (IllegalArgumentException exception) {
            return false;
        }
    }

    private static String valueOr(String key, String fallback) {
        String value = System.getenv(key);
        return value == null || value.isBlank() ? fallback : value;
    }
}
