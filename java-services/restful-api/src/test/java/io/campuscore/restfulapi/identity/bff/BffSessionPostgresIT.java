package io.campuscore.restfulapi.identity.bff;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doAnswer;

import java.time.Instant;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIf;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.oauth2.core.AuthorizationGrantType;
import org.springframework.security.oauth2.core.OAuth2AccessToken;
import org.springframework.security.oauth2.core.OAuth2RefreshToken;
import org.springframework.security.oauth2.jwt.JwsHeader;
import org.springframework.security.oauth2.jwt.JwtClaimsSet;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.security.oauth2.jwt.JwtEncoderParameters;
import org.springframework.security.oauth2.server.authorization.OAuth2Authorization;
import org.springframework.security.oauth2.server.authorization.OAuth2AuthorizationCode;
import org.springframework.security.oauth2.server.authorization.OAuth2AuthorizationService;
import org.springframework.security.oauth2.server.authorization.client.RegisteredClientRepository;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import io.campuscore.restfulapi.identity.DeterministicTokenCipher;
import io.campuscore.restfulapi.identity.IdentityGrantRetentionJob;
import io.campuscore.restfulapi.identity.IdentityProperties;
import io.campuscore.restfulapi.identity.UnifiedSessionAuthority;

/**
 * P05 BFF race/lock proofs on real Postgres (host-policy §5/§7): concurrent
 * refresh single-flight, logout vs refresh, grant deletion vs session
 * insert, account-wide and per-client cleanup, atomic transaction consume,
 * and bounded retention. BffTokenClient is mocked because there is no HTTP
 * loopback here — the stub still writes grants through the real
 * LockingIdentityAuthorizationService so the lock discipline being raced
 * is the production one.
 */
@EnabledIf("postgresTargetConfigured")
@SpringBootTest(properties = {
        "spring.flyway.locations=classpath:db/migration",
        "deepseek.enabled=false",
        "identity.oidc.enabled=true",
        "identity.oidc.dev-keygen=true",
        "identity.oidc.issuer-uri=http://127.0.0.1:4010",
        "identity.oidc.token-encryption-key=dGVzdC1rZXktMDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY=",
        "identity.bff.enabled=true",
        "identity.bff.dev-http=true",
        "identity.bff.surfaces[0].id=portal",
        "identity.bff.surfaces[0].mode=BFF",
        "identity.bff.surfaces[0].client-id=cu-portal",
        "identity.bff.surfaces[0].client-secret=bff-portal-secret-0123456789abcdef",
        "identity.bff.surfaces[0].proxy-secret=proxy-portal-secret-0123456789ab",
        "identity.bff.surfaces[0].public-base-url=http://portal.test",
        "identity.bff.surfaces[0].hosts[0]=portal.test",
        "identity.bff.surfaces[1].id=learn",
        "identity.bff.surfaces[1].mode=BFF",
        "identity.bff.surfaces[1].client-id=cu-learn",
        "identity.bff.surfaces[1].client-secret=bff-learn-secret-0123456789abcdef",
        "identity.bff.surfaces[1].proxy-secret=proxy-learn-secret-0123456789abc",
        "identity.bff.surfaces[1].public-base-url=http://learn.test",
        "identity.bff.surfaces[1].hosts[0]=learn.test"
})
@ActiveProfiles({"test", "persistence"})
class BffSessionPostgresIT {

    private static final int WAIT_SECONDS = 30;
    private static final String CLIENT = "cu-portal";
    private static final String CLIENT_LEARN = "cu-learn";

    private final JdbcTemplate jdbc;
    @Autowired private UnifiedSessionAuthority authority;
    @Autowired private OAuth2AuthorizationService authorizationService;
    @Autowired private RegisteredClientRepository registeredClients;
    @Autowired private BffSessionStore store;
    @Autowired private BffSessionService sessions;
    @Autowired private IdentityProperties properties;
    @Autowired private IdentityGrantRetentionJob retentionJob;
    @Autowired private JwtEncoder identityJwtEncoder;
    @Autowired private DeterministicTokenCipher cipher;
    @Autowired private PasswordEncoder passwordEncoder;
    @Autowired private PlatformTransactionManager transactionManager;
    @MockitoBean private BffTokenClient tokenClient;

    BffSessionPostgresIT(@Autowired javax.sql.DataSource dataSource) {
        this.jdbc = new JdbcTemplate(dataSource);
    }

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", () -> System.getenv("CAMPUSCORE_COUNCIL_POSTGRES_URL"));
        registry.add("spring.datasource.username", () -> valueOr("CAMPUSCORE_COUNCIL_POSTGRES_USER", "campuscore"));
        registry.add("spring.datasource.password", () -> valueOr("CAMPUSCORE_COUNCIL_POSTGRES_PASSWORD", "postgres"));
    }

    private static String valueOr(String name, String fallback) {
        String value = System.getenv(name);
        return value == null || value.isBlank() ? fallback : value;
    }

    static boolean postgresTargetConfigured() {
        String url = System.getenv("CAMPUSCORE_COUNCIL_POSTGRES_URL");
        if (url == null || !url.startsWith("jdbc:postgresql:")) {
            return false;
        }
        try {
            java.net.URI uri = java.net.URI.create(url.substring("jdbc:".length()));
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

    // ---- single-flight refresh ---------------------------------------------

    @Test
    void concurrentRefreshRotatesExactlyOnce() throws Exception {
        String userId = insertUser(UUID.randomUUID().toString().substring(0, 8));
        OAuth2Authorization grant = saveGrant(userId, currentVersion(userId),
                Instant.now().minusSeconds(60));
        String opaque = BffSessionStore.randomId(24);
        insertSession(opaque, userId, "portal", CLIENT, grant.getId());

        AtomicInteger refreshCalls = new AtomicInteger();
        doAnswer(invocation -> {
            refreshCalls.incrementAndGet();
            Thread.sleep(120); // widen the race window
            return rotateGrant(grant.getId());
        }).when(tokenClient).refresh(any(), anyString());

        ExecutorService pool = Executors.newFixedThreadPool(4);
        CountDownLatch start = new CountDownLatch(1);
        try {
            List<Future<BffSessionService.ResolvedSession>> futures = new java.util.ArrayList<>();
            for (int i = 0; i < 4; i++) {
                futures.add(pool.submit(() -> {
                    await(start);
                    return sessions.resolveForBusiness(surface("portal"), opaque);
                }));
            }
            start.countDown();
            int ok = 0;
            for (Future<BffSessionService.ResolvedSession> future : futures) {
                if (future.get(WAIT_SECONDS, TimeUnit.SECONDS).ok()) {
                    ok++;
                }
            }
            assertThat(ok).isEqualTo(4);
            // Single-flight: only the first resolver presented the refresh
            // token; the queued siblings saw the rotated fresh access token.
            assertThat(refreshCalls.get()).isEqualTo(1);
        } finally {
            pool.shutdownNow();
        }
    }

    @Test
    void logoutVsRefreshLeavesSessionDead() throws Exception {
        String userId = insertUser(UUID.randomUUID().toString().substring(0, 8));
        OAuth2Authorization grant = saveGrant(userId, currentVersion(userId),
                Instant.now().minusSeconds(60));
        String opaque = BffSessionStore.randomId(24);
        insertSession(opaque, userId, "portal", CLIENT, grant.getId());

        doAnswer(invocation -> {
            Thread.sleep(150); // give logout time to commit mid-refresh
            return rotateGrant(grant.getId());
        }).when(tokenClient).refresh(any(), anyString());

        ExecutorService pool = Executors.newFixedThreadPool(2);
        CountDownLatch start = new CountDownLatch(1);
        try {
            AtomicReference<Object> resolveOutcome = new AtomicReference<>();
            Future<?> refresher = pool.submit(() -> {
                await(start);
                try {
                    resolveOutcome.set(sessions.resolveForBusiness(surface("portal"), opaque));
                } catch (RuntimeException error) {
                    resolveOutcome.set(error);
                }
            });
            Future<?> logger = pool.submit(() -> {
                await(start);
                Thread.sleep(40);
                sessions.logout(surface("portal"), "http://portal.test", opaque);
                return null;
            });
            start.countDown();
            refresher.get(WAIT_SECONDS, TimeUnit.SECONDS);
            logger.get(WAIT_SECONDS, TimeUnit.SECONDS);

            // Whatever the interleaving, the session must end dead and the
            // grant must not be resurrected by the in-flight rotation.
            assertThat(countLiveSessions(userId)).isEqualTo(0);
            assertThat(countAuthz(userId)).isEqualTo(0);
        } finally {
            pool.shutdownNow();
        }
    }

    // ---- insertion consistency ---------------------------------------------

    @Test
    void callbackCannotBindSessionToMissingGrant() throws Exception {
        String userId = insertUser(UUID.randomUUID().toString().substring(0, 8));
        OAuth2Authorization grant = saveGrant(userId, currentVersion(userId),
                Instant.now().plusSeconds(900));
        String state = BffSessionStore.randomId(24);
        String txId = "tx" + UUID.randomUUID().toString().substring(0, 8);
        String nonce = "nonce-" + txId;
        store.insertTransaction(state, txId, "portal", nonce,
                cipher.encrypt("verifier", "bff_tx.verifier"), "/",
                Instant.now().plusSeconds(300));
        String idToken = mintIdToken(userId, nonce, CLIENT);

        doAnswer(invocation -> {
            // Revoke lands between the browser legs: the grant row the
            // exchange would have produced is already gone.
            jdbc.update("DELETE FROM campuscore_identity.oauth2_authorization"
                    + " WHERE id = ?", grant.getId());
            return new BffTokenClient.TokenResponse("at-gone", "rt-gone",
                    idToken, null, 3600);
        }).when(tokenClient).exchangeCode(any(), anyString(), anyString(), anyString());

        org.springframework.mock.web.MockHttpServletRequest callbackRequest =
                new org.springframework.mock.web.MockHttpServletRequest();
        callbackRequest.setCookies(new jakarta.servlet.http.Cookie(
                "cu_bff_tx_dev_" + txId, txId));
        BffSessionService.CallbackResult result = sessions.finishLogin(
                surface("portal"), "http://portal.test", "code-x", state,
                callbackRequest);
        assertThat(result.ok()).isFalse();
        assertThat(countBffSessions(userId)).isEqualTo(0);
    }

    @Test
    void revokeAccountSweepsBffSessionsWithGrants() throws Exception {
        String userId = insertUser(UUID.randomUUID().toString().substring(0, 8));
        OAuth2Authorization grant = saveGrant(userId, currentVersion(userId),
                Instant.now().plusSeconds(900));
        insertSession(BffSessionStore.randomId(24), userId, "portal", CLIENT, grant.getId());
        assertThat(countBffSessions(userId)).isEqualTo(1);

        authority.revokeAccount(userId, "OIDC", "TEST_ACCOUNT_KILL", "it-bff-1");
        assertThat(countBffSessions(userId)).isEqualTo(0);
        assertThat(countAuthz(userId)).isEqualTo(0);
    }

    @Test
    void perClientLogoutLeavesOtherSurfaceSessions() throws Exception {
        String userId = insertUser(UUID.randomUUID().toString().substring(0, 8));
        OAuth2Authorization portalGrant = saveGrant(userId, currentVersion(userId),
                Instant.now().plusSeconds(900));
        OAuth2Authorization learnGrant = saveGrantForClient(userId,
                currentVersion(userId), CLIENT_LEARN, Instant.now().plusSeconds(900));
        insertSession(BffSessionStore.randomId(24), userId, "portal", CLIENT, portalGrant.getId());
        String learnOpaque = BffSessionStore.randomId(24);
        insertSession(learnOpaque, userId, "learn", CLIENT_LEARN, learnGrant.getId());

        authority.revokeClientGrants(userId, CLIENT, "OIDC_LOGOUT", "it-bff-2");
        // Portal lane dead — grant and bound session together.
        Integer portalLive = jdbc.queryForObject(
                "SELECT COUNT(*) FROM campuscore_identity.bff_session"
                        + " WHERE client_id = ? AND revoked_at IS NULL",
                Integer.class, CLIENT);
        assertThat(portalLive).isEqualTo(0);
        // The learn surface session survives — client-scoped kill only.
        assertThat(store.findSession(learnOpaque, "learn")).isNotNull();
        assertThat(countAuthz(userId)).isEqualTo(1);
    }

    // ---- transaction + retention ---------------------------------------------

    @Test
    void transactionConsumeIsOneTimeOnly() throws Exception {
        String state = BffSessionStore.randomId(24);
        store.insertTransaction(state, "txonce", "portal", "n1",
                cipher.encrypt("v", "bff_tx.verifier"), "/",
                Instant.now().plusSeconds(300));

        // consumeTransaction joins the caller's transaction by design
        // (finishLogin is @Transactional); wrap the raced calls so the
        // SELECT FOR UPDATE + DELETE pair is atomic like production.
        TransactionTemplate txTemplate = new TransactionTemplate(transactionManager);
        ExecutorService pool = Executors.newFixedThreadPool(2);
        CountDownLatch start = new CountDownLatch(1);
        try {
            AtomicInteger wins = new AtomicInteger();
            Runnable consumer = () -> {
                await(start);
                Boolean won = txTemplate.execute(tx ->
                        store.consumeTransaction(state) != null);
                if (Boolean.TRUE.equals(won)) {
                    wins.incrementAndGet();
                }
            };
            Future<?> a = pool.submit(consumer);
            Future<?> b = pool.submit(consumer);
            start.countDown();
            a.get(WAIT_SECONDS, TimeUnit.SECONDS);
            b.get(WAIT_SECONDS, TimeUnit.SECONDS);
            assertThat(wins.get()).isEqualTo(1);
        } finally {
            pool.shutdownNow();
        }
    }

    @Test
    void retentionSweepsDeadBffRows() throws Exception {
        String userId = insertUser(UUID.randomUUID().toString().substring(0, 8));
        OAuth2Authorization grant = saveGrant(userId, currentVersion(userId),
                Instant.now().plusSeconds(900));
        String dead = BffSessionStore.randomId(24);
        insertSession(dead, userId, "portal", CLIENT, grant.getId());
        jdbc.update("UPDATE campuscore_identity.bff_session"
                        + " SET expires_at = ? WHERE user_id = ?",
                java.sql.Timestamp.from(Instant.now().minusSeconds(86400 * 10)), userId);
        jdbc.update("INSERT INTO campuscore_identity.bff_transaction"
                        + " (state_hash, tx_id, surface, nonce, verifier, return_path, expires_at)"
                        + " VALUES (?, ?, 'portal', 'n', 'v', '/', ?)",
                BffSessionStore.sha256Hex("stale"), "txstale",
                java.sql.Timestamp.from(Instant.now().minusSeconds(86400 * 10)));

        retentionJob.purgeExpired();
        Integer sessionsLeft = jdbc.queryForObject(
                "SELECT COUNT(*) FROM campuscore_identity.bff_session WHERE user_id = ?",
                Integer.class, userId);
        Integer txLeft = jdbc.queryForObject(
                "SELECT COUNT(*) FROM campuscore_identity.bff_transaction"
                        + " WHERE tx_id = 'txstale'", Integer.class);
        assertThat(sessionsLeft).isEqualTo(0);
        assertThat(txLeft).isEqualTo(0);
    }

    // ---- fixtures -------------------------------------------------------------

    private IdentityProperties.Surface surface(String id) {
        return properties.getBff().getSurfaces().stream()
                .filter(s -> s.getId().equals(id)).findFirst().orElseThrow();
    }

    private String mintIdToken(String userId, String nonce, String clientId) {
        Instant now = Instant.now();
        return identityJwtEncoder.encode(JwtEncoderParameters.from(
                JwsHeader.with(org.springframework.security.oauth2.jose.jws
                        .SignatureAlgorithm.RS256).build(),
                JwtClaimsSet.builder()
                        .issuer("http://127.0.0.1:4010")
                        .subject(userId)
                        .audience(List.of(clientId))
                        .issuedAt(now)
                        .expiresAt(now.plusSeconds(3600))
                        .claim("nonce", nonce)
                        .build())).getTokenValue();
    }

    private String insertUser(String suffix) {
        String userId = "bff-it-" + suffix;
        jdbc.update("INSERT INTO campuscore_auth.\"User\""
                        + " (\"id\", \"email\", \"password\", \"firstName\", \"lastName\", \"status\","
                        + " \"emailVerified\", \"isSuperAdmin\", \"failedLoginAttempts\", \"createdAt\", \"updatedAt\")"
                        + " VALUES (?, ?, ?, 'Bff', 'It', 'ACTIVE', TRUE, FALSE, 0,"
                        + " CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)",
                userId, "bff-" + suffix + "@campuscore.edu",
                passwordEncoder.encode("Race-" + suffix));
        return userId;
    }

    private void insertSession(String opaque, String userId, String surface,
            String clientId, String authorizationId) {
        store.insertSession(opaque, userId, surface, clientId, authorizationId,
                cipher.encrypt("csrf", "bff_session.csrf"), "127.0.0.1", "it",
                Instant.now().plusSeconds(3600));
    }

    /** Persist a grant the way SAS does: code-stage insert, token-stage update. */
    private OAuth2Authorization saveGrant(String userId, long version,
            Instant accessExpires) {
        return saveGrantForClient(userId, version, CLIENT, accessExpires);
    }

    private OAuth2Authorization saveGrantForClient(String userId, long version,
            String clientId, Instant accessExpires) {
        Instant now = Instant.now();
        var client = registeredClients.findByClientId(clientId);
        OAuth2Authorization code = OAuth2Authorization.withRegisteredClient(client)
                .id(UUID.randomUUID().toString())
                .principalName(userId)
                .authorizationGrantType(AuthorizationGrantType.AUTHORIZATION_CODE)
                .authorizedScopes(Set.of("openid"))
                .attribute(java.security.Principal.class.getName(),
                        new UsernamePasswordAuthenticationToken(userId, "n/a",
                                List.of(new SimpleGrantedAuthority("ROLE_STUDENT"))))
                .attribute(// LockingIdentityAuthorizationService
                        // .PRESENTED_VERSION_ATTRIBUTE (package-private)
                        "io.campuscore.identity.presentedCredentialVersion",
                        String.valueOf(version))
                .token(new OAuth2AuthorizationCode("code-" + UUID.randomUUID(),
                        now, now.plusSeconds(120)))
                .build();
        authorizationService.save(code);
        // issuedAt must precede expiresAt — for expired-token fixtures the
        // issue instant is shifted back rather than staying at now.
        Instant issued = accessExpires.isBefore(now)
                ? accessExpires.minusSeconds(900) : now;
        OAuth2AccessToken access = new OAuth2AccessToken(
                OAuth2AccessToken.TokenType.BEARER,
                "at-" + UUID.randomUUID(), issued, accessExpires, Set.of("openid"));
        OAuth2RefreshToken refresh = new OAuth2RefreshToken(
                "rt-" + UUID.randomUUID(), now, now.plusSeconds(604800));
        OAuth2Authorization full = OAuth2Authorization.from(code)
                .accessToken(access).refreshToken(refresh).build();
        authorizationService.save(full);
        return authorizationService.findById(full.getId());
    }

    /** What the token endpoint would have persisted: a rotated grant row. */
    private BffTokenClient.TokenResponse rotateGrant(String grantId) {
        OAuth2Authorization grant = authorizationService.findById(grantId);
        if (grant == null) {
            throw new BffTokenClient.TokenExchangeException("grant gone");
        }
        Instant now = Instant.now();
        String newAccess = "at-rot-" + UUID.randomUUID();
        OAuth2AccessToken access = new OAuth2AccessToken(
                OAuth2AccessToken.TokenType.BEARER, newAccess, now,
                now.plusSeconds(900), Set.of("openid"));
        OAuth2RefreshToken refresh = new OAuth2RefreshToken(
                "rt-rot-" + UUID.randomUUID(), now, now.plusSeconds(604800));
        OAuth2Authorization rotated = OAuth2Authorization.from(grant)
                .accessToken(access).refreshToken(refresh).build();
        authorizationService.save(rotated);
        return new BffTokenClient.TokenResponse(newAccess,
                rotated.getRefreshToken().getToken().getTokenValue(),
                null, null, 900);
    }

    private long currentVersion(String userId) {
        Long version = jdbc.queryForObject(
                "SELECT \"credentialVersion\" FROM campuscore_auth.\"User\" WHERE \"id\" = ?",
                Long.class, userId);
        return version == null ? 0 : version;
    }

    private int countBffSessions(String userId) {
        Integer count = jdbc.queryForObject(
                "SELECT COUNT(*) FROM campuscore_identity.bff_session WHERE user_id = ?",
                Integer.class, userId);
        return count == null ? 0 : count;
    }

    private int countLiveSessions(String userId) {
        Integer count = jdbc.queryForObject(
                "SELECT COUNT(*) FROM campuscore_identity.bff_session"
                        + " WHERE user_id = ? AND revoked_at IS NULL",
                Integer.class, userId);
        return count == null ? 0 : count;
    }

    private int countAuthz(String userId) {
        Integer count = jdbc.queryForObject(
                "SELECT COUNT(*) FROM campuscore_identity.oauth2_authorization"
                        + " WHERE principal_name = ?",
                Integer.class, userId);
        return count == null ? 0 : count;
    }

    private static void await(CountDownLatch latch) {
        try {
            latch.await();
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException(interrupted);
        }
    }
}
