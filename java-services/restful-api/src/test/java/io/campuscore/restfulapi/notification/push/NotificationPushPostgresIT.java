package io.campuscore.restfulapi.notification.push;

import static org.assertj.core.api.Assertions.assertThat;

import io.campuscore.restfulapi.notification.push.DeliveryOutboxRepository.Claim;
import io.campuscore.restfulapi.notification.push.PushDeviceDtos.RegistrationRequest;
import java.nio.charset.StandardCharsets;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Base64;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIf;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/** PostgreSQL authority tests for push lease fencing and concurrent token rebind. */
@EnabledIf(value = "io.campuscore.restfulapi.notification.push.NotificationPushPostgresIT#postgresTargetConfigured")
@SpringBootTest(properties = {
        "spring.flyway.locations=classpath:db/migration",
        "deepseek.enabled=false",
        "spring.jpa.hibernate.ddl-auto=none",
        "spring.datasource.hikari.maximum-pool-size=16"
})
@ActiveProfiles({"test", "persistence"})
class NotificationPushPostgresIT {

    @Autowired
    private DeliveryOutboxRepository outbox;

    @Autowired
    private PushDeviceService deviceService;

    @Autowired
    private PushProperties pushProperties;

    @Autowired
    private PushTokenCryptography cryptography;

    @Autowired
    private NamedParameterJdbcTemplate jdbc;

    @Autowired
    private PlatformTransactionManager transactionManager;

    private TransactionTemplate transactions;
    private String suffix;
    private String userA;
    private String userB;

    @DynamicPropertySource
    static void postgresProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", () -> valueOr(
                "CAMPUSCORE_E2E_POSTGRES_URL", "jdbc:postgresql://localhost:5432/campuscore_e2e"));
        registry.add("spring.datasource.username", () -> valueOr("CAMPUSCORE_E2E_POSTGRES_USER", "postgres"));
        registry.add("spring.datasource.password", () -> valueOr("CAMPUSCORE_E2E_POSTGRES_PASSWORD", "postgres"));
        registry.add("app.notifications.push.token-key", NotificationPushPostgresIT::testKey);
        registry.add("app.notifications.push.enabled", () -> "true");
        registry.add("app.notifications.push.dispatcher-enabled", () -> "false");
    }

    static boolean postgresTargetConfigured() {
        String url = System.getenv("CAMPUSCORE_E2E_POSTGRES_URL");
        return url != null && url.startsWith("jdbc:postgresql:");
    }

    private static String valueOr(String name, String fallback) {
        String value = System.getenv(name);
        return value == null || value.isBlank() ? fallback : value;
    }

    private static String testKey() {
        return Base64.getEncoder().encodeToString(
                "0123456789abcdef0123456789abcdef".getBytes(StandardCharsets.UTF_8));
    }

    @BeforeEach
    void seedUsers() {
        suffix = UUID.randomUUID().toString();
        userA = "push-a-" + suffix;
        userB = "push-b-" + suffix;
        pushProperties.setEnabled(true);
        pushProperties.setDispatcherEnabled(false);
        transactions = new TransactionTemplate(transactionManager);
        seedUser(userA);
        seedUser(userB);
    }

    @Test
    void parallelWorkersClaimDisjointRowsAndOldLeaseCannotAcknowledgeAfterFencing() throws Exception {
        for (int index = 0; index < 20; index++) {
            insertOutbox("parallel-" + index, userA);
        }

        CountDownLatch start = new CountDownLatch(1);
        try (var workers = Executors.newFixedThreadPool(2)) {
            var first = workers.submit(() -> {
                if (!start.await(5, TimeUnit.SECONDS)) {
                    throw new AssertionError("Timed out waiting to start worker A");
                }
                return transactions.execute(status -> outbox.claim(
                        "worker-a-" + suffix, 10, Instant.now(), 60, 5));
            });
            var second = workers.submit(() -> {
                if (!start.await(5, TimeUnit.SECONDS)) {
                    throw new AssertionError("Timed out waiting to start worker B");
                }
                return transactions.execute(status -> outbox.claim(
                        "worker-b-" + suffix, 10, Instant.now(), 60, 5));
            });
            start.countDown();

            List<Claim> claimsA = first.get(20, TimeUnit.SECONDS);
            List<Claim> claimsB = second.get(20, TimeUnit.SECONDS);
            Set<String> idsA = claimsA.stream().map(Claim::id)
                    .collect(java.util.stream.Collectors.toSet());
            Set<String> idsB = claimsB.stream().map(Claim::id)
                    .collect(java.util.stream.Collectors.toSet());
            // SKIP LOCKED may legitimately hand a worker fewer rows than its limit under contention.
            assertThat(claimsA).isNotEmpty();
            assertThat(claimsB).isNotEmpty();
            assertThat(claimsA.size() + claimsB.size()).isLessThanOrEqualTo(20);
            assertThat(java.util.Collections.disjoint(idsA, idsB)).isTrue();
        }

        List<Claim> drained;
        do {
            drained = transactions.execute(status -> outbox.claim(
                    "drain-" + suffix, 250, Instant.now(), 60, 5));
        } while (!drained.isEmpty());
        Integer stillPending = jdbc.queryForObject(
                "SELECT COUNT(*) FROM notifications.delivery_outbox WHERE id LIKE :p AND status='PENDING'",
                new MapSqlParameterSource().addValue("p", suffix + "-parallel-%"), Integer.class);
        assertThat(stillPending).isZero();
        Integer distinctOwners = jdbc.queryForObject(
                "SELECT COUNT(*) FROM notifications.delivery_outbox WHERE id LIKE :p AND lease_generation=1"
                        + " AND lease_owner IS NOT NULL",
                new MapSqlParameterSource().addValue("p", suffix + "-parallel-%"), Integer.class);
        assertThat(distinctOwners).isEqualTo(20);

        String fencedRow = insertOutbox("fenced-row", userA);
        Claim oldWorker = transactions.execute(status -> outbox.claim(
                "old-worker-" + suffix, 1, Instant.now(), 1, 5)).getFirst();
        assertThat(oldWorker.id()).isEqualTo(fencedRow);

        awaitLeaseExpiry(oldWorker);
        Claim newWorker = transactions.execute(status -> outbox.claim(
                "new-worker-" + suffix, 1, Instant.now(), 60, 5)).getFirst();
        assertThat(newWorker.generation()).isEqualTo(oldWorker.generation() + 1);
        Boolean oldWorkerAcknowledged =
                transactions.execute(status -> outbox.acknowledgeSent(oldWorker, Instant.now()));
        Boolean newWorkerAcknowledged =
                transactions.execute(status -> outbox.acknowledgeSent(newWorker, Instant.now()));
        assertThat(oldWorkerAcknowledged).isFalse();
        assertThat(newWorkerAcknowledged).isTrue();
        assertThat(outbox.state(fencedRow).orElseThrow().status()).isEqualTo("SENT");
    }

    @Test
    void transactionStartedBeforeExpiryCannotAcknowledgeAfterWaitingForRowLock() throws Exception {
        String rowId = insertOutbox("transaction-clock-row", userA);
        Claim claim = transactions.execute(status -> outbox.claim(
                "clock-worker-" + suffix, 1, Instant.now(), 5, 5)).getFirst();
        assertThat(claim.id()).isEqualTo(rowId);

        CountDownLatch holderLocked = new CountDownLatch(1);
        CountDownLatch releaseHolder = new CountDownLatch(1);
        CountDownLatch acknowledgementTransactionStarted = new CountDownLatch(1);
        AtomicInteger holderPid = new AtomicInteger();
        AtomicInteger acknowledgementPid = new AtomicInteger();

        try (var workers = Executors.newFixedThreadPool(2)) {
            var holder = workers.submit(() -> transactions.execute(status -> {
                jdbc.queryForObject(
                        "SELECT id FROM notifications.delivery_outbox WHERE id=:id FOR UPDATE",
                        new MapSqlParameterSource("id", claim.id()), String.class);
                holderPid.set(jdbc.getJdbcTemplate()
                        .queryForObject("SELECT pg_backend_pid()", Integer.class));
                holderLocked.countDown();
                boolean released;
                try {
                    released = releaseHolder.await(20, TimeUnit.SECONDS);
                } catch (InterruptedException interrupted) {
                    Thread.currentThread().interrupt();
                    throw new IllegalStateException("Interrupted while holding the outbox row lock", interrupted);
                }
                if (!released) {
                    throw new AssertionError("Timed out waiting to release the outbox row lock");
                }
                return null;
            }));
            assertThat(holderLocked.await(10, TimeUnit.SECONDS)).isTrue();

            var acknowledgement = workers.submit(() -> transactions.execute(status -> {
                Timestamp transactionStart = jdbc.getJdbcTemplate()
                        .queryForObject("SELECT CURRENT_TIMESTAMP", Timestamp.class);
                assertThat(transactionStart.toInstant()).isBefore(claim.leaseUntil());
                acknowledgementPid.set(jdbc.getJdbcTemplate()
                        .queryForObject("SELECT pg_backend_pid()", Integer.class));
                acknowledgementTransactionStarted.countDown();
                return outbox.acknowledgeSent(claim, claim.leaseUntil().minusSeconds(5));
            }));
            assertThat(acknowledgementTransactionStarted.await(10, TimeUnit.SECONDS)).isTrue();
            awaitBlocked(acknowledgementPid.get(), holderPid.get());
            awaitLeaseExpiry(claim);

            releaseHolder.countDown();
            holder.get(20, TimeUnit.SECONDS);
            assertThat(acknowledgement.get(20, TimeUnit.SECONDS)).isFalse();
        } finally {
            releaseHolder.countDown();
        }

        var state = outbox.state(rowId).orElseThrow();
        assertThat(state.status()).isEqualTo("CLAIMED");
        assertThat(state.leaseGeneration()).isEqualTo(claim.generation());
        assertThat(state.sentAt()).isNull();
    }

    @Test
    void concurrentRebindLeavesOneOwnerAndAuditsThePreviousOwner() throws Exception {
        String token = "shared-token-" + suffix;
        CountDownLatch start = new CountDownLatch(1);
        try (var workers = Executors.newFixedThreadPool(2)) {
            var registrationA = workers.submit(() -> {
                if (!start.await(5, TimeUnit.SECONDS)) {
                    throw new AssertionError("Timed out waiting to start registration A");
                }
                return transactions.execute(status -> deviceService.register(
                        userA, "install-a-" + suffix,
                        new RegistrationRequest("FCM", "ANDROID", token)));
            });
            var registrationB = workers.submit(() -> {
                if (!start.await(5, TimeUnit.SECONDS)) {
                    throw new AssertionError("Timed out waiting to start registration B");
                }
                return transactions.execute(status -> deviceService.register(
                        userB, "install-b-" + suffix,
                        new RegistrationRequest("FCM", "ANDROID", token)));
            });
            start.countDown();
            assertThat(registrationA.get(20, TimeUnit.SECONDS)).isNotNull();
            assertThat(registrationB.get(20, TimeUnit.SECONDS)).isNotNull();
        }

        String fingerprint = cryptography.fingerprint(token);
        MapSqlParameterSource tokenKey = new MapSqlParameterSource("fingerprint", fingerprint);
        assertThat(jdbc.queryForObject(
                "SELECT COUNT(*) FROM notifications.device_registration WHERE token_fingerprint=:fingerprint",
                tokenKey, Integer.class)).isEqualTo(1);
        String owner = jdbc.queryForObject(
                "SELECT user_id FROM notifications.device_registration WHERE token_fingerprint=:fingerprint",
                tokenKey, String.class);
        assertThat(owner).isIn(userA, userB);

        String deviceId = jdbc.queryForObject(
                "SELECT id FROM notifications.device_registration WHERE token_fingerprint=:fingerprint",
                tokenKey, String.class);
        List<AuditSnapshot> audits = jdbc.query(
                "SELECT \"actorId\", \"beforeState\", \"afterState\" FROM campuscore_audit.\"AdminAudit\""
                        + " WHERE \"action\"='PUSH_DEVICE_REBOUND' AND \"entityId\"=:deviceId",
                new MapSqlParameterSource("deviceId", deviceId),
                (rs, rowNumber) -> new AuditSnapshot(
                        rs.getString("actorId"), rs.getString("beforeState"), rs.getString("afterState")));
        assertThat(audits).hasSize(1);
        String previousOwner = owner.equals(userA) ? userB : userA;
        assertThat(audits.getFirst().actorId()).isEqualTo(owner);
        assertThat(audits.getFirst().beforeState()).contains("ownerId=" + previousOwner);
        assertThat(audits.getFirst().afterState()).contains("ownerId=" + owner);
    }

    private void seedUser(String userId) {
        jdbc.update("INSERT INTO campuscore_auth.\"User\""
                        + " (\"id\",\"email\",\"password\",\"firstName\",\"lastName\",\"status\")"
                        + " VALUES (:id,:email,'x','It','User','ACTIVE')",
                new MapSqlParameterSource("id", userId).addValue("email", userId + "@it.local"));
    }

    private String insertOutbox(String label, String recipientUserId) {
        String id = suffix + "-" + label;
        Instant createdAt = Instant.now().minusSeconds(2).truncatedTo(ChronoUnit.MICROS);
        jdbc.update("""
                INSERT INTO notifications.delivery_outbox
                    (id,notification_id,device_id,recipient_user_id,status,attempt_count,
                     next_attempt_at,lease_generation,created_at,updated_at)
                VALUES (:id,:notificationId,:deviceId,:recipientUserId,'PENDING',0,
                        :createdAt,0,:createdAt,:createdAt)
                """,
                new MapSqlParameterSource()
                        .addValue("id", id)
                        .addValue("notificationId", "notice-" + id)
                        .addValue("deviceId", "device-" + id)
                        .addValue("recipientUserId", recipientUserId)
                        .addValue("createdAt", Timestamp.from(createdAt)));
        return id;
    }

    private void awaitLeaseExpiry(Claim claim) throws InterruptedException {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(15);
        while (System.nanoTime() < deadline) {
            Timestamp databaseNow = jdbc.getJdbcTemplate()
                    .queryForObject("SELECT clock_timestamp()", Timestamp.class);
            if (databaseNow != null && databaseNow.toInstant().isAfter(claim.leaseUntil())) {
                return;
            }
            Thread.sleep(10);
        }
        throw new AssertionError("Outbox lease did not expire within the test deadline");
    }

    private void awaitBlocked(int waitingPid, int blockerPid) throws InterruptedException {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(15);
        while (System.nanoTime() < deadline) {
            Integer waiting = jdbc.queryForObject(
                    "SELECT COUNT(*) FROM pg_stat_activity"
                            + " WHERE pid=:waitingPid AND :blockerPid=ANY(pg_blocking_pids(pid))",
                    new MapSqlParameterSource().addValue("waitingPid", waitingPid)
                            .addValue("blockerPid", blockerPid), Integer.class);
            if (waiting != null && waiting > 0) {
                return;
            }
            Thread.sleep(20);
        }
        throw new AssertionError("Acknowledgement did not wait on the held outbox row");
    }

    private record AuditSnapshot(String actorId, String beforeState, String afterState) { }
}
