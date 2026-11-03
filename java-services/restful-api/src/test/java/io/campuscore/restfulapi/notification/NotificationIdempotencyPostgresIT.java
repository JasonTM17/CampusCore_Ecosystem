package io.campuscore.restfulapi.notification;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.catchThrowable;

import io.campuscore.restfulapi.notification.push.PushDeviceDtos.PushDeviceRegistrationRequest;
import io.campuscore.restfulapi.notification.push.PushDeviceService;
import io.campuscore.restfulapi.notification.push.PushProperties;
import io.campuscore.restfulapi.notification.service.NotificationWriteService;
import io.campuscore.restfulapi.notification.web.NotificationReadDtos.NotificationResponse;
import io.campuscore.restfulapi.notification.web.NotificationWriteDtos.CreateNotificationRequest;
import io.campuscore.restfulapi.web.DomainException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIf;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/**
 * PostgreSQL authority test for the optional Idempotency-Key contract on
 * POST /api/v1/notifications: the derived notification id, the
 * {@code INSERT ... ON CONFLICT (id) DO NOTHING} claim, the single audit row
 * and the single push-outbox fan-out are real only on PostgreSQL — the H2
 * suite exercises the non-PostgreSQL fallback, which cannot prove the
 * conflict path.
 *
 * <p><b>Environment contract</b> (opt-in, identical to the sibling
 * *PostgresIT classes): runs ONLY when {@code CAMPUSCORE_E2E_POSTGRES_URL} is
 * a {@code jdbc:postgresql:} URL, with optional
 * {@code CAMPUSCORE_E2E_POSTGRES_USER} / {@code CAMPUSCORE_E2E_POSTGRES_PASSWORD}
 * overrides. CI without the env skips the IT.
 */
@EnabledIf(value = "io.campuscore.restfulapi.notification.NotificationIdempotencyPostgresIT#postgresTargetConfigured")
@SpringBootTest(properties = {
        "spring.flyway.locations=classpath:db/migration",
        "deepseek.enabled=false",
        "spring.jpa.hibernate.ddl-auto=none",
        "spring.datasource.hikari.maximum-pool-size=16"
})
@ActiveProfiles({"test", "persistence"})
class NotificationIdempotencyPostgresIT {

    private static final int CONCURRENT_CREATES = 8;

    @Autowired
    private NotificationWriteService notificationWrites;

    @Autowired
    private PushDeviceService deviceService;

    @Autowired
    private PushProperties pushProperties;

    @Autowired
    private NamedParameterJdbcTemplate jdbc;

    private String suffix;
    private String recipient;
    private String actor;
    private CreateNotificationRequest request;

    @DynamicPropertySource
    static void postgresProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", () -> valueOr(
                "CAMPUSCORE_E2E_POSTGRES_URL", "jdbc:postgresql://localhost:5432/campuscore_e2e"));
        registry.add("spring.datasource.username", () -> valueOr("CAMPUSCORE_E2E_POSTGRES_USER", "postgres"));
        registry.add("spring.datasource.password", () -> valueOr("CAMPUSCORE_E2E_POSTGRES_PASSWORD", "postgres"));
        registry.add("app.notifications.push.token-key", NotificationIdempotencyPostgresIT::testKey);
        registry.add("app.notifications.push.enabled", () -> "true");
        registry.add("app.notifications.push.dispatcher-enabled", () -> "false");
    }

    /** Opt-in like the existing Postgres ITs: runs only when the URL env is a jdbc:postgresql: target. */
    static boolean postgresTargetConfigured() {
        String url = System.getenv("CAMPUSCORE_E2E_POSTGRES_URL");
        return url != null && url.startsWith("jdbc:postgresql:");
    }

    @BeforeEach
    void seedRecipientWithOneActiveDevice() {
        suffix = UUID.randomUUID().toString();
        recipient = "notif-recipient-" + suffix;
        actor = "notif-admin-" + suffix;
        request = new CreateNotificationRequest(recipient,
                "Grade published", "Your course grade is now available.", "INFO", "/dashboard/grades");
        pushProperties.setEnabled(true);
        pushProperties.setDispatcherEnabled(false);
        seedUser(recipient);
        deviceService.register(recipient, "install-" + suffix,
                new PushDeviceRegistrationRequest("FCM", "ANDROID", "token-" + suffix));
    }

    @AfterEach
    void drainOutboxRows() {
        // PENDING rows left behind would be claimed by any later dispatch test.
        jdbc.update("DELETE FROM notifications.delivery_outbox WHERE recipient_user_id=:u",
                new MapSqlParameterSource("u", recipient));
    }

    @Test
    void firstKeyedCreatePersistsOneNotificationOneAuditAndOneOutboxRow() {
        NotificationResponse created = notificationWrites.create(request, actor, "key-" + suffix);

        assertThat(notificationRows(created.id())).isEqualTo(1);
        assertThat(createAuditRows(created.id())).isEqualTo(1);
        assertThat(outboxRows(created.id())).isEqualTo(1);
    }

    @Test
    void sequentialReplayReturnsTheSameNotificationWithoutNewEffects() {
        String key = "key-" + suffix;
        NotificationResponse first = notificationWrites.create(request, actor, key);

        NotificationResponse replayed = notificationWrites.create(request, actor, key);

        assertThat(replayed.id()).isEqualTo(first.id());
        assertThat(replayed.userId()).isEqualTo(recipient);
        assertThat(replayed.title()).isEqualTo(request.title());
        assertThat(notificationRows(first.id())).isEqualTo(1);
        assertThat(createAuditRows(first.id())).isEqualTo(1);
        assertThat(outboxRows(first.id())).isEqualTo(1);
    }

    @Test
    void sameKeyWithADifferentPayloadConflictsWithoutChangingAnything() {
        String key = "key-" + suffix;
        NotificationResponse first = notificationWrites.create(request, actor, key);

        Throwable thrown = catchThrowable(() -> notificationWrites.create(
                new CreateNotificationRequest(recipient, "Different title",
                        request.message(), request.type(), request.link()),
                actor, key));

        assertThat(thrown).isInstanceOf(DomainException.class);
        DomainException conflict = (DomainException) thrown;
        assertThat(conflict.getStatus()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(conflict.code()).isEqualTo("IDEMPOTENCY_CONFLICT");
        assertThat(notificationRows(first.id())).isEqualTo(1);
        assertThat(createAuditRows(first.id())).isEqualTo(1);
        assertThat(outboxRows(first.id())).isEqualTo(1);
    }

    @Test
    void sameKeyFromADifferentActorDerivesASeparateNotification() {
        String key = "shared-" + suffix;
        NotificationResponse first = notificationWrites.create(request, "admin-first-" + suffix, key);

        NotificationResponse second = notificationWrites.create(request, "admin-second-" + suffix, key);

        assertThat(second.id()).isNotEqualTo(first.id());
        for (String id : List.of(first.id(), second.id())) {
            assertThat(notificationRows(id)).isEqualTo(1);
            assertThat(createAuditRows(id)).isEqualTo(1);
            assertThat(outboxRows(id)).isEqualTo(1);
        }
    }

    @Test
    void colonInsideActorOrKeyCannotShiftTheDerivedIdBoundary() {
        NotificationResponse first = notificationWrites.create(request, "a", "b:c");
        NotificationResponse second = notificationWrites.create(request, "a:b", "c");

        assertThat(second.id()).isNotEqualTo(first.id());
        assertThat(notificationRows(first.id())).isEqualTo(1);
        assertThat(notificationRows(second.id())).isEqualTo(1);
        assertThat(createAuditRows(first.id())).isEqualTo(1);
        assertThat(createAuditRows(second.id())).isEqualTo(1);
    }

    @Test
    void eightConcurrentCreatesWithTheSameKeyPersistExactlyOneNotification() throws Exception {
        String key = "storm-" + suffix;
        ExecutorService pool = Executors.newFixedThreadPool(CONCURRENT_CREATES);
        CountDownLatch ready = new CountDownLatch(CONCURRENT_CREATES);
        CountDownLatch start = new CountDownLatch(1);
        List<Future<Outcome>> futures = new ArrayList<>();
        try {
            for (int index = 0; index < CONCURRENT_CREATES; index++) {
                futures.add(pool.submit(() -> {
                    ready.countDown();
                    if (!start.await(10, TimeUnit.SECONDS)) {
                        return new Outcome(null, "start barrier timeout");
                    }
                    try {
                        // Same actor, same key, same payload — a pure replay storm.
                        return new Outcome(notificationWrites.create(request, actor, key).id(), null);
                    } catch (Throwable failure) {
                        return new Outcome(null,
                                failure.getClass().getName() + ": " + failure.getMessage());
                    }
                }));
            }
            assertThat(ready.await(10, TimeUnit.SECONDS)).isTrue();
            start.countDown();
            List<Outcome> outcomes = new ArrayList<>();
            for (Future<Outcome> future : futures) {
                outcomes.add(future.get(60, TimeUnit.SECONDS));
            }

            // Every caller must get the committed notification back — a unique
            // violation or lock error leaking to a caller is a defect.
            assertThat(outcomes).hasSize(CONCURRENT_CREATES);
            assertThat(outcomes).allMatch(outcome -> outcome.failure() == null,
                    "every caller must replay successfully: " + outcomes);
            List<String> ids = outcomes.stream().map(Outcome::notificationId).distinct().toList();
            assertThat(ids).hasSize(1);
            assertThat(ids.getFirst()).isNotNull();
            assertThat(notificationRows(ids.getFirst())).isEqualTo(1);
            assertThat(createAuditRows(ids.getFirst())).isEqualTo(1);
            assertThat(outboxRows(ids.getFirst())).isEqualTo(1);
        } finally {
            pool.shutdownNow();
            assertThat(pool.awaitTermination(10, TimeUnit.SECONDS)).isTrue();
        }
    }

    @Test
    void createWithoutAKeyKeepsCreatingNewRows() {
        NotificationResponse first = notificationWrites.create(request, actor);
        NotificationResponse second = notificationWrites.create(request, actor);

        assertThat(second.id()).isNotEqualTo(first.id());
        for (String id : List.of(first.id(), second.id())) {
            assertThat(notificationRows(id)).isEqualTo(1);
            assertThat(createAuditRows(id)).isEqualTo(1);
            assertThat(outboxRows(id)).isEqualTo(1);
        }
    }

    private void seedUser(String userId) {
        jdbc.update("INSERT INTO campuscore_auth.\"User\""
                        + " (\"id\",\"email\",\"password\",\"firstName\",\"lastName\",\"status\")"
                        + " VALUES (:id,:email,'x','It','User','ACTIVE')",
                new MapSqlParameterSource("id", userId).addValue("email", userId + "@it.local"));
    }

    private int notificationRows(String id) {
        Integer count = jdbc.queryForObject(
                "SELECT COUNT(*) FROM notifications.notification WHERE id=:id",
                new MapSqlParameterSource("id", id), Integer.class);
        return count == null ? 0 : count;
    }

    private int createAuditRows(String notificationId) {
        Integer count = jdbc.queryForObject(
                "SELECT COUNT(*) FROM campuscore_audit.\"AdminAudit\""
                        + " WHERE \"entityId\"=:id AND \"action\"='NOTIFICATION_CREATED'",
                new MapSqlParameterSource("id", notificationId), Integer.class);
        return count == null ? 0 : count;
    }

    private int outboxRows(String notificationId) {
        Integer count = jdbc.queryForObject(
                "SELECT COUNT(*) FROM notifications.delivery_outbox WHERE notification_id=:id",
                new MapSqlParameterSource("id", notificationId), Integer.class);
        return count == null ? 0 : count;
    }

    private static String testKey() {
        return Base64.getEncoder().encodeToString(
                "0123456789abcdef0123456789abcdef".getBytes(StandardCharsets.UTF_8));
    }

    private static String valueOr(String name, String fallback) {
        String value = System.getenv(name);
        return value == null || value.isBlank() ? fallback : value;
    }

    private record Outcome(String notificationId, String failure) {
    }
}
