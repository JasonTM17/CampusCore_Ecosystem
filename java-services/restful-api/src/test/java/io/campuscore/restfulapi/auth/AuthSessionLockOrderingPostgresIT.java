package io.campuscore.restfulapi.auth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doAnswer;

import io.campuscore.restfulapi.auth.service.AdminUserMutationService;
import io.campuscore.restfulapi.auth.service.AuthLoginService;
import java.net.URI;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIf;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.jdbc.core.namedparam.SqlParameterSource;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;

/**
 * PostgreSQL-only regression for the User-vs-Session lock order. Admin
 * mutations lock the User row and then delete its Session rows; refresh used
 * to lock the Session row first and write the User afterwards, so a pause
 * between the two produced a textbook deadlock. Both paths now take the User
 * lock first, so the refresh simply queues behind the admin mutation.
 */
@EnabledIf("postgresTargetConfigured")
@SpringBootTest(properties = { "spring.flyway.locations=classpath:db/migration", "deepseek.enabled=false" })
@ActiveProfiles({"test", "persistence"})
class AuthSessionLockOrderingPostgresIT {

    private static final int WAIT_SECONDS = 20;

    @Autowired private AuthLoginService authLogin;
    @Autowired private AdminUserMutationService adminMutations;
    @Autowired private PasswordEncoder passwordEncoder;
    @Autowired private JdbcTemplate jdbc;
    @MockitoSpyBean private NamedParameterJdbcTemplate namedJdbc;

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", () -> System.getenv("CAMPUSCORE_COUNCIL_POSTGRES_URL"));
        registry.add("spring.datasource.username", () -> valueOr("CAMPUSCORE_COUNCIL_POSTGRES_USER", "campuscore"));
        registry.add("spring.datasource.password", () -> valueOr("CAMPUSCORE_COUNCIL_POSTGRES_PASSWORD", "postgres"));
    }

    @Test
    void refreshQueuesBehindTheAdminUserLockInsteadOfDeadlockingOnSessions() throws Exception {
        String suffix = UUID.randomUUID().toString().substring(0, 8);
        String userId = "lock-user-" + suffix;
        String email = "lock-" + suffix + "@campuscore.edu";
        String rawPassword = "LockRace-" + suffix;
        jdbc.update("INSERT INTO campuscore_auth.\"User\""
                        + " (\"id\", \"email\", \"password\", \"firstName\", \"lastName\", \"status\","
                        + " \"emailVerified\", \"isSuperAdmin\", \"failedLoginAttempts\", \"createdAt\", \"updatedAt\")"
                        + " VALUES (?, ?, ?, ?, ?, 'ACTIVE', TRUE, FALSE, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)",
                userId, email, passwordEncoder.encode(rawPassword), "Lock", "Race");

        String refreshToken = authLogin.login(email, rawPassword, "127.0.0.1", "lock-it")
                .response().refreshToken();
        Integer sessions = jdbc.queryForObject(
                "SELECT COUNT(*) FROM campuscore_auth.\"Session\" WHERE \"userId\" = ?",
                Integer.class, userId);
        assertThat(sessions).isGreaterThan(0);

        CountDownLatch adminHoldsUserLock = new CountDownLatch(1);
        CountDownLatch refreshAtUserLock = new CountDownLatch(1);
        CountDownLatch releaseAdmin = new CountDownLatch(1);
        String adminThread = "pgw-admin-" + suffix;
        String refreshThread = "pgw-refresh-" + suffix;
        doAnswer(invocation -> {
            String sql = invocation.getArgument(0, String.class);
            String thread = Thread.currentThread().getName();
            if (thread.equals(refreshThread) && sql.contains("FOR UPDATE")) {
                // The refresh reached the User row lock while the admin
                // mutation still holds it; from here it can only proceed by
                // queueing on the row.
                refreshAtUserLock.countDown();
            }
            Object result = invocation.callRealMethod();
            if (thread.equals(adminThread)
                    && sql.contains("FOR UPDATE") && sql.contains(":userId")) {
                // The admin transaction now holds the User row lock. Pause
                // before it can touch Session rows; a Session-first refresher
                // would already hold the lock that deadlocks this writer.
                adminHoldsUserLock.countDown();
                if (!releaseAdmin.await(WAIT_SECONDS, TimeUnit.SECONDS)) {
                    throw new IllegalStateException("admin release barrier timeout");
                }
            }
            return result;
        }).when(namedJdbc).queryForList(anyString(), any(SqlParameterSource.class), any(Class.class));

        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            Future<?> admin = pool.submit(() -> {
                Thread.currentThread().setName(adminThread);
                adminMutations.update(userId, Map.<String, Object>of("status", "SUSPENDED"), true, null);
                return null;
            });
            assertThat(adminHoldsUserLock.await(WAIT_SECONDS, TimeUnit.SECONDS))
                    .as("admin must hold the user row lock before refresh starts")
                    .isTrue();

            Future<?> refresher = pool.submit(() -> {
                Thread.currentThread().setName(refreshThread);
                authLogin.refresh(refreshToken, "127.0.0.1", "lock-it");
                return null;
            });
            assertThat(awaitLatchOrDone(refreshAtUserLock, refresher))
                    .as("refresh must reach the user row lock while the admin holds it")
                    .isTrue();
            assertThat(refresher.isDone())
                    .as("refresh must queue behind the admin user lock")
                    .isFalse();

            // While the admin holds the User lock the session row must still
            // be free: under the old Session-first order the blocked refresh
            // would already own it, and a NOWAIT probe would fail here.
            try (Connection probe = DriverManager.getConnection(
                    System.getenv("CAMPUSCORE_COUNCIL_POSTGRES_URL"),
                    valueOr("CAMPUSCORE_COUNCIL_POSTGRES_USER", "campuscore"),
                    valueOr("CAMPUSCORE_COUNCIL_POSTGRES_PASSWORD", "postgres"))) {
                probe.setAutoCommit(false);
                assertThatCode(() -> {
                    try (PreparedStatement statement = probe.prepareStatement(
                            "SELECT \"id\" FROM campuscore_auth.\"Session\" WHERE \"userId\" = ? FOR UPDATE NOWAIT")) {
                        statement.setString(1, userId);
                        try (var ignored = statement.executeQuery()) {
                            // reachable only when the blocked refresh holds no session lock
                        }
                    }
                }).as("session row must be free while refresh waits on the user lock")
                        .doesNotThrowAnyException();
                probe.rollback();
            }

            releaseAdmin.countDown();
            admin.get(WAIT_SECONDS, TimeUnit.SECONDS);

            // The refresh then proceeds against the revoked session and fails
            // with the business rejection — never with a deadlock victim error.
            ExecutionException refreshFailure = null;
            try {
                refresher.get(WAIT_SECONDS, TimeUnit.SECONDS);
            } catch (ExecutionException exception) {
                refreshFailure = exception;
            }
            assertThat(refreshFailure).isNotNull();
            Throwable cursor = refreshFailure;
            boolean badCredentials = false;
            boolean deadlock = false;
            while (cursor != null) {
                if (cursor instanceof BadCredentialsException) {
                    badCredentials = true;
                }
                String message = String.valueOf(cursor.getMessage());
                if (message.contains("deadlock") || message.contains("40P01")) {
                    deadlock = true;
                }
                cursor = cursor.getCause();
            }
            assertThat(deadlock).as("refresh must not be a deadlock victim").isFalse();
            assertThat(badCredentials)
                    .as("refresh must fail with the revoked-session rejection")
                    .isTrue();
        } finally {
            releaseAdmin.countDown();
            pool.shutdownNow();
            assertThat(pool.awaitTermination(WAIT_SECONDS, TimeUnit.SECONDS)).isTrue();
        }
    }

    /**
     * Waits for a worker to reach a barrier, but fails fast when the worker
     * finishes first — a worker that never reaches the barrier must not stall
     * the test for the whole budget.
     */
    private static boolean awaitLatchOrDone(CountDownLatch latch, Future<?> worker)
            throws InterruptedException {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(10);
        while (System.nanoTime() < deadline) {
            if (latch.await(25, TimeUnit.MILLISECONDS)) {
                return true;
            }
            if (worker.isDone()) {
                return false;
            }
        }
        return false;
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
