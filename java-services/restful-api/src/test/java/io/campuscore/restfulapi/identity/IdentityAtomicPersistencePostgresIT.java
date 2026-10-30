package io.campuscore.restfulapi.identity;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.PlainJWT;
import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;
import io.campuscore.restfulapi.auth.repository.AuthUserRepository;
import java.net.URI;
import java.time.Instant;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.function.Consumer;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIf;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.ConnectionCallback;
import org.springframework.jdbc.core.JdbcOperations;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.oauth2.core.AuthorizationGrantType;
import org.springframework.security.oauth2.core.OAuth2AccessToken;
import org.springframework.security.oauth2.core.OAuth2RefreshToken;
import org.springframework.security.oauth2.server.authorization.OAuth2Authorization;
import org.springframework.security.oauth2.server.authorization.OAuth2AuthorizationCode;
import org.springframework.security.oauth2.server.authorization.OAuth2AuthorizationService;
import org.springframework.security.oauth2.server.authorization.client.RegisteredClientRepository;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Real-PostgreSQL commit-boundary evidence for OIDC persistence
 * (identity-contract.md §2.3): the oauth2_authorization row, the mirrored
 * campuscore_auth."Session" row and the refresh lineage row must share one
 * commit. A fault after the grant write but before commit removes every
 * store; a fault after the mirror delete restores every store. Runs the
 * production migration set against the disposable council database.
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
class IdentityAtomicPersistencePostgresIT {

    private static final String CLIENT = "cu-hub";

    @Autowired private PasswordEncoder passwordEncoder;
    @Autowired private OAuth2AuthorizationService authorizationService;
    @Autowired private RegisteredClientRepository registeredClients;
    @Autowired private PlatformTransactionManager transactionManager;
    @Autowired private DeterministicTokenCipher cipher;
    @Autowired private AuthUserRepository users;
    @Autowired private IdentitySessionMirror mirror;
    @Autowired @Qualifier("identityJdbcOperations") private JdbcOperations identityJdbc;
    private final JdbcTemplate jdbc;

    IdentityAtomicPersistencePostgresIT(@Autowired javax.sql.DataSource dataSource) {
        this.jdbc = new JdbcTemplate(dataSource);
    }

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", () -> System.getenv("CAMPUSCORE_COUNCIL_POSTGRES_URL"));
        registry.add("spring.datasource.username", () -> valueOr("CAMPUSCORE_COUNCIL_POSTGRES_USER", "campuscore"));
        registry.add("spring.datasource.password", () -> valueOr("CAMPUSCORE_COUNCIL_POSTGRES_PASSWORD", "postgres"));
    }

    @Test
    void faultAfterCodeStageSaveRollsBackGrantWrite() {
        String suffix = UUID.randomUUID().toString().substring(0, 8);
        String userId = insertUser(suffix);
        OAuth2Authorization codeStage = codeStageGrant(userId, currentVersion(userId));

        // A failure between the grant write and commit must remove every
        // store — an independently committed grant row is exactly the
        // resurrection window the single commit boundary exists to close.
        failBeforeCommit(writer -> writer.save(codeStage), "post-save fault");

        assertThat(countAuthz(userId)).isZero();
        assertThat(countSessions(userId)).isZero();
        assertThat(countLineage(userId)).isZero();
    }

    @Test
    void faultAfterRefreshStageSaveRollsBackTokenMirrorAndLineage() {
        String suffix = UUID.randomUUID().toString().substring(0, 8);
        String userId = insertUser(suffix);
        long version = currentVersion(userId);
        OAuth2Authorization codeStage = codeStageGrant(userId, version);
        authorizationService.save(codeStage);
        assertThat(countAuthz(userId)).isEqualTo(1);

        // The refresh-carrying save is the one that upserts the session
        // mirror and records LIVE lineage: rolling it back must restore the
        // grant to its code-stage shape and leave both side tables empty.
        OAuth2Authorization tokens = refreshStageGrant(userId, version);
        OAuth2Authorization refreshStage = OAuth2Authorization.from(codeStage)
                .accessToken(tokens.getAccessToken().getToken())
                .refreshToken(tokens.getRefreshToken().getToken())
                .build();
        failBeforeCommit(writer -> writer.save(refreshStage), "post-save fault");

        assertThat(countAuthz(userId)).isEqualTo(1);
        assertThat(countTokenizedAuthz(userId)).isZero();
        assertThat(countSessions(userId)).isZero();
        assertThat(countLineage(userId)).isZero();
    }

    @Test
    void faultAfterRemoveRestoresGrantAndMirror() {
        String suffix = UUID.randomUUID().toString().substring(0, 8);
        String userId = insertUser(suffix);
        OAuth2Authorization saved = saveRefreshGrant(userId, currentVersion(userId));
        assertThat(countAuthz(userId)).isEqualTo(1);
        assertThat(countSessions(userId)).isEqualTo(1);
        assertThat(countLineage(userId)).isEqualTo(1);

        // The mirror delete and the grant delete are one operation: a
        // failure before commit may lose neither, or the mirror would point
        // at a grant that no longer exists.
        failBeforeCommit(writer -> writer.remove(saved), "post-remove fault");

        assertThat(countAuthz(userId)).isEqualTo(1);
        assertThat(countSessions(userId)).isEqualTo(1);
        assertThat(countLineage(userId)).isEqualTo(1);
    }

    @Test
    void grantDeleteFailureRestoresAlreadyDeletedMirror() {
        String userId = insertUser(UUID.randomUUID().toString().substring(0, 8));
        OAuth2Authorization saved = saveRefreshGrant(userId, currentVersion(userId));

        // Transactional DDL rolls the temporary trigger back with the fault.
        // AFTER DELETE reaches the actual grant SQL after the mirror delete.
        assertThatThrownBy(() -> transactions().executeWithoutResult(tx -> {
            jdbc.execute("CREATE FUNCTION pg_temp.reject_grant_delete() RETURNS trigger"
                    + " LANGUAGE plpgsql AS $$ BEGIN"
                    + " RAISE EXCEPTION 'injected grant-delete failure'; END $$");
            jdbc.execute("CREATE TRIGGER reject_grant_delete AFTER DELETE ON"
                    + " campuscore_identity.oauth2_authorization FOR EACH ROW"
                    + " EXECUTE FUNCTION pg_temp.reject_grant_delete()");
            authorizationService.remove(saved);
        })).hasStackTraceContaining("injected grant-delete failure");

        assertThat(countAuthz(userId)).isEqualTo(1);
        assertThat(countSessions(userId)).isEqualTo(1);
        assertThat(countLineage(userId)).isEqualTo(1);
        assertThat(authorizationService.findById(saved.getId())).isNotNull();
    }

    @Test
    void committedSaveThenRemovePersistsAndClearsAllStores() {
        String suffix = UUID.randomUUID().toString().substring(0, 8);
        String userId = insertUser(suffix);
        long version = currentVersion(userId);
        OAuth2Authorization saved = saveRefreshGrant(userId, version);

        assertThat(countAuthz(userId)).isEqualTo(1);
        assertThat(countSessions(userId)).isEqualTo(1);
        assertThat(countLineage(userId)).isEqualTo(1);

        // The stored token ciphertext must round-trip back to the minted
        // value through the same connection the write committed on.
        OAuth2Authorization loaded = authorizationService.findById(saved.getId());
        assertThat(loaded).isNotNull();
        assertThat(loaded.getAccessToken().getToken().getTokenValue())
                .isEqualTo(saved.getAccessToken().getToken().getTokenValue());
        assertThat(loaded.getRefreshToken().getToken().getTokenValue())
                .isEqualTo(saved.getRefreshToken().getToken().getTokenValue());
        assertThat(authorizationService.findByToken(
                saved.getRefreshToken().getToken().getTokenValue(),
                org.springframework.security.oauth2.server.authorization.OAuth2TokenType.REFRESH_TOKEN)
                .getId()).isEqualTo(saved.getId());

        authorizationService.remove(loaded);
        assertThat(countAuthz(userId)).isZero();
        assertThat(countSessions(userId)).isZero();
        // Lineage outlives its grant by design (replay attribution); a
        // committed remove removes exactly the grant and the session mirror.
        assertThat(countLineage(userId)).isEqualTo(1);
    }

    @Test
    void grantPersistenceLeavesSessionStateUntouched() {
        String suffix = UUID.randomUUID().toString().substring(0, 8);
        String userId = insertUser(suffix);
        transactions().executeWithoutResult(tx -> {
            // Pin both observations to the same physical transaction connection.
            Integer backend = jdbc.queryForObject("SELECT pg_backend_pid()", Integer.class);
            assertThat(identityJdbc.queryForObject("SELECT pg_backend_pid()", Integer.class))
                    .isEqualTo(backend);
            String searchPathBefore = jdbc.queryForObject("SHOW search_path", String.class);
            var stateBefore = connectionState();

            OAuth2Authorization saved = saveRefreshGrant(userId, currentVersion(userId));
            authorizationService.remove(authorizationService.findById(saved.getId()));

            assertThat(identityJdbc.queryForObject("SELECT pg_backend_pid()", Integer.class))
                    .isEqualTo(backend);
            assertThat(jdbc.queryForObject("SHOW search_path", String.class))
                    .isEqualTo(searchPathBefore);
            assertThat(connectionState()).isEqualTo(stateBefore);
        });
        assertThat(countAuthz(userId)).isZero();
        assertThat(countSessions(userId)).isZero();
    }

    // ---- fixtures -----------------------------------------------------------

    private TransactionTemplate transactions() {
        return new TransactionTemplate(transactionManager);
    }

    private List<Object> connectionState() {
        return jdbc.execute((ConnectionCallback<List<Object>>) connection -> List.of(
                connection.getSchema(), connection.getAutoCommit(), connection.isReadOnly(),
                connection.getTransactionIsolation()));
    }

    private void failBeforeCommit(Consumer<OAuth2AuthorizationService> mutation, String fault) {
        // Opt-in negative control recreates the former independent pool without
        // replacing another worker's production adapter. The same assertions
        // must fail with -Didentity.atomic-test.independent-pool=true.
        try (HikariDataSource independent = independentPoolProbe()) {
            OAuth2AuthorizationService writer = independent == null ? authorizationService
                    : new LockingIdentityAuthorizationService(new JdbcTemplate(independent),
                            registeredClients, cipher, users, mirror);
            assertThatThrownBy(() -> transactions().executeWithoutResult(tx -> {
                mutation.accept(writer);
                throw new IllegalStateException(fault);
            })).isInstanceOf(IllegalStateException.class).hasMessage(fault);
        }
    }

    private HikariDataSource independentPoolProbe() {
        if (!Boolean.getBoolean("identity.atomic-test.independent-pool")) {
            return null;
        }
        HikariConfig config = new HikariConfig();
        config.setJdbcUrl(System.getenv("CAMPUSCORE_COUNCIL_POSTGRES_URL"));
        config.setUsername(valueOr("CAMPUSCORE_COUNCIL_POSTGRES_USER", "campuscore"));
        config.setPassword(valueOr("CAMPUSCORE_COUNCIL_POSTGRES_PASSWORD", "postgres"));
        config.setConnectionInitSql("SET search_path TO campuscore_identity");
        config.setMaximumPoolSize(1);
        config.setMinimumIdle(0);
        return new HikariDataSource(config);
    }

    /** A code-stage grant: authorization code only, like the authorize save. */
    private OAuth2Authorization codeStageGrant(String userId, long presentedVersion) {
        Instant now = Instant.now();
        var client = registeredClients.findByClientId(CLIENT);
        return OAuth2Authorization.withRegisteredClient(client)
                .id(UUID.randomUUID().toString())
                .principalName(userId)
                .authorizationGrantType(AuthorizationGrantType.AUTHORIZATION_CODE)
                .authorizedScopes(Set.of("openid"))
                .attribute(java.security.Principal.class.getName(),
                        new UsernamePasswordAuthenticationToken(userId, "n/a",
                                List.of(new SimpleGrantedAuthority("ROLE_STUDENT"))))
                .attribute(LockingIdentityAuthorizationService.PRESENTED_VERSION_ATTRIBUTE,
                        String.valueOf(presentedVersion))
                .token(new OAuth2AuthorizationCode("code-" + UUID.randomUUID(),
                        now, now.plusSeconds(120)))
                .build();
    }

    /** A second-stage grant: access token carrying credentialVersion + refresh. */
    private OAuth2Authorization refreshStageGrant(String userId, long credentialVersion) {
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
                .attribute(LockingIdentityAuthorizationService.PRESENTED_VERSION_ATTRIBUTE,
                        String.valueOf(credentialVersion))
                .accessToken(access)
                .refreshToken(refresh)
                .build();
    }

    /**
     * Persist a full grant the way SAS really does: code-stage insert
     * first, then a token-stage update of the same row. A direct
     * save-with-access-token on a missing row is refused as a resurrecting
     * insert by the under-lock existence check.
     */
    private OAuth2Authorization saveRefreshGrant(String userId, long credentialVersion) {
        OAuth2Authorization code = codeStageGrant(userId, credentialVersion);
        authorizationService.save(code);
        OAuth2Authorization full = refreshStageGrant(userId, credentialVersion);
        OAuth2Authorization updated = OAuth2Authorization.from(code)
                .accessToken(full.getAccessToken().getToken())
                .refreshToken(full.getRefreshToken().getToken())
                .build();
        authorizationService.save(updated);
        return updated;
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

    /** Grant rows that carry minted token material — second-stage writes only. */
    private int countTokenizedAuthz(String userId) {
        Integer count = jdbc.queryForObject(
                "SELECT COUNT(*) FROM campuscore_identity.oauth2_authorization"
                        + " WHERE principal_name = ?"
                        + " AND (access_token_value IS NOT NULL OR refresh_token_value IS NOT NULL)",
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

/** Local connection-participation spike; does not establish PostgreSQL acceptance. */
class IdentityConnectionParticipationTest {

    @Test
    void rollbackAfterGrantSaveRemovesBothWrites() {
        try (ConnectionFixture fixture = new ConnectionFixture()) {
            assertThatThrownBy(() -> fixture.transactions.executeWithoutResult(tx -> {
                fixture.primaryJdbc.update("INSERT INTO campuscore_auth.session_mirror VALUES ('grant')");
                fixture.identityJdbc.update("INSERT INTO oauth2_authorization VALUES ('grant')");
                throw new IllegalStateException("post-save fault");
            })).hasMessage("post-save fault");

            assertThat(fixture.count("campuscore_auth.session_mirror")).isZero();
            assertThat(fixture.count("campuscore_identity.oauth2_authorization")).isZero();
        }
    }

    @Test
    void rollbackAfterGrantRemoveRestoresBothRows() {
        try (ConnectionFixture fixture = new ConnectionFixture()) {
            fixture.primaryJdbc.update("INSERT INTO campuscore_auth.session_mirror VALUES ('grant')");
            fixture.identityJdbc.update("INSERT INTO oauth2_authorization VALUES ('grant')");
            assertThatThrownBy(() -> fixture.transactions.executeWithoutResult(tx -> {
                fixture.primaryJdbc.update("DELETE FROM campuscore_auth.session_mirror");
                fixture.identityJdbc.update("DELETE FROM oauth2_authorization");
                throw new IllegalStateException("post-remove fault");
            })).hasMessage("post-remove fault");

            assertThat(fixture.count("campuscore_auth.session_mirror")).isEqualTo(1);
            assertThat(fixture.count("campuscore_identity.oauth2_authorization")).isEqualTo(1);
        }
    }

    @Test
    void identityAndPrimaryReuseConnectionWithoutChangingPooledState() {
        try (ConnectionFixture fixture = new ConnectionFixture()) {
            var stateBefore = fixture.state();
            fixture.transactions.executeWithoutResult(tx -> {
                assertThat(fixture.identityJdbc.queryForObject("SELECT SESSION_ID()", Integer.class))
                        .isEqualTo(fixture.primaryJdbc.queryForObject("SELECT SESSION_ID()", Integer.class));
                fixture.identityJdbc.update("INSERT INTO oauth2_authorization VALUES ('grant')");
            });
            // The primary pool has exactly one physical connection, so this
            // also verifies the state after returning it to the pool.
            assertThat(fixture.state()).isEqualTo(stateBefore);
            assertThat(fixture.count("campuscore_identity.oauth2_authorization")).isEqualTo(1);
        }
    }

    private static final class ConnectionFixture implements AutoCloseable {
        private final HikariDataSource primary;
        private final HikariDataSource independent;
        private final JdbcTemplate primaryJdbc;
        private final JdbcOperations identityJdbc;
        private final TransactionTemplate transactions;

        ConnectionFixture() {
            String url = "jdbc:h2:mem:identity_" + UUID.randomUUID() + ";MODE=PostgreSQL";
            primary = pool(url);
            primaryJdbc = new JdbcTemplate(primary);
            primaryJdbc.execute("CREATE SCHEMA campuscore_auth");
            primaryJdbc.execute("CREATE SCHEMA campuscore_identity");
            primaryJdbc.execute("CREATE TABLE campuscore_auth.session_mirror (id VARCHAR PRIMARY KEY)");
            primaryJdbc.execute("CREATE TABLE campuscore_identity.oauth2_authorization (id VARCHAR PRIMARY KEY)");
            independent = Boolean.getBoolean("identity.atomic-test.independent-pool") ? pool(url) : null;
            IdentityDataSourceConfig config = new IdentityDataSourceConfig();
            identityJdbc = config.identityJdbcOperations(independent != null ? independent
                    : config.identityDataSource(primary));
            transactions = new TransactionTemplate(new DataSourceTransactionManager(primary));
        }

        private static HikariDataSource pool(String url) {
            HikariConfig config = new HikariConfig();
            config.setJdbcUrl(url);
            config.setMaximumPoolSize(1);
            config.setMinimumIdle(0);
            return new HikariDataSource(config);
        }

        int count(String table) {
            return primaryJdbc.queryForObject("SELECT COUNT(*) FROM " + table, Integer.class);
        }

        List<Object> state() {
            return primaryJdbc.execute((ConnectionCallback<List<Object>>) connection -> List.of(
                    connection.getSchema(), connection.getAutoCommit(), connection.isReadOnly(),
                    connection.getTransactionIsolation()));
        }

        @Override
        public void close() {
            if (independent != null) {
                independent.close();
            }
            primary.close();
        }
    }
}
