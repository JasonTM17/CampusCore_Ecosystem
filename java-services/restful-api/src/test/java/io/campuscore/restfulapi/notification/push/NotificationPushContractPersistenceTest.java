package io.campuscore.restfulapi.notification.push;

import static io.campuscore.restfulapi.testsupport.CurrentAccountJwt.fixtureJwt;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.junit.jupiter.api.Assertions.assertTimeoutPreemptively;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import io.campuscore.restfulapi.notification.push.DeliveryOutboxRepository.OutboxState;
import io.campuscore.restfulapi.notification.push.PushDeviceDtos.PushDeviceRegistrationRequest;
import io.campuscore.restfulapi.notification.push.PushProvider.DeliveryReceipt;
import io.campuscore.restfulapi.notification.push.PushProvider.PushPayload;
import io.campuscore.restfulapi.notification.repository.NotificationWriteRepository;
import io.campuscore.restfulapi.notification.repository.NotificationWriteRepository.CreateNotificationCommand;
import io.campuscore.restfulapi.testsupport.AccountAuthorityFixture;
import java.nio.charset.StandardCharsets;
import java.sql.Timestamp;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.util.Base64;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Semaphore;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.core.io.ClassPathResource;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.init.ScriptUtils;
import org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.JwtRequestPostProcessor;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles({"test", "persistence"})
@TestPropertySource(properties = {
        "spring.flyway.enabled=false",
        "spring.datasource.url=jdbc:h2:mem:contract_NotificationPushContractPersistenceTest;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1"
})
class NotificationPushContractPersistenceTest {

    private static final String OWNER = "push-owner";
    private static final String OTHER = "push-other";

    @DynamicPropertySource
    static void pushSettings(DynamicPropertyRegistry registry) {
        registry.add("app.notifications.push.token-key", NotificationPushContractPersistenceTest::testKey);
        registry.add("app.notifications.push.enabled", () -> "false");
        registry.add("app.notifications.push.dispatcher-enabled", () -> "false");
    }

    @Autowired private JdbcTemplate jdbc;
    @Autowired private MockMvc mvc;
    @Autowired private PushProperties properties;
    @Autowired private PushTokenCryptography cryptography;
    @Autowired private PushDeviceService devices;
    @Autowired private DeliveryOutboxRepository outbox;
    @Autowired private PushProvider defaultProvider;
    @Autowired private NotificationWriteRepository notifications;
    @Autowired private PlatformTransactionManager transactionManager;

    private JwtRequestPostProcessor ownerJwt;
    private JwtRequestPostProcessor otherJwt;
    private TransactionTemplate transaction;

    @BeforeEach
    void prepareFixture() throws Exception {
        properties.setEnabled(false);
        properties.setTokenKey(testKey());
        properties.setLeaseSeconds(60);
        properties.setSendTimeoutMs(20_000);
        jdbc.execute("CREATE SCHEMA IF NOT EXISTS notifications");
        jdbc.execute("DROP TABLE IF EXISTS notifications.delivery_outbox");
        jdbc.execute("DROP TABLE IF EXISTS notifications.device_registration");
        jdbc.execute("DROP TABLE IF EXISTS notifications.notification");
        jdbc.execute("""
                CREATE TABLE notifications.notification (
                    id VARCHAR(120) PRIMARY KEY,
                    user_id VARCHAR(120) NOT NULL,
                    title VARCHAR(240) NOT NULL,
                    message VARCHAR(2000) NOT NULL,
                    type VARCHAR(60) NOT NULL,
                    link VARCHAR(500),
                    is_read BOOLEAN NOT NULL DEFAULT FALSE,
                    read_at TIMESTAMP WITH TIME ZONE,
                    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
                )
                """);
        try (var connection = jdbc.getDataSource().getConnection()) {
            ScriptUtils.executeSqlScript(connection,
                    new ClassPathResource("db/migration-h2/V143__notification_push_delivery.sql"));
        }

        AccountAuthorityFixture.ensureSchema(jdbc);
        jdbc.update("DELETE FROM campuscore_auth.\"UserRole\" WHERE \"userId\" IN (?,?)", OWNER, OTHER);
        jdbc.update("DELETE FROM campuscore_auth.\"User\" WHERE \"id\" IN (?,?)", OWNER, OTHER);
        ownerJwt = fixtureJwt(jdbc, OWNER, "STUDENT");
        otherJwt = fixtureJwt(jdbc, OTHER, "STUDENT");

        jdbc.execute("CREATE SCHEMA IF NOT EXISTS campuscore_audit");
        jdbc.execute("""
                CREATE TABLE IF NOT EXISTS campuscore_audit."AdminAudit" (
                    "id" VARCHAR(120) PRIMARY KEY,
                    "actorId" VARCHAR(120),
                    "actorLabel" VARCHAR(240),
                    "action" VARCHAR(48) NOT NULL,
                    "entityType" VARCHAR(48) NOT NULL,
                    "entityId" VARCHAR(120),
                    "summary" VARCHAR(500),
                    "beforeState" TEXT,
                    "afterState" TEXT,
                    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
                )
                """);
        jdbc.update("DELETE FROM campuscore_audit.\"AdminAudit\"");
        transaction = new TransactionTemplate(transactionManager);
    }

    @Test
    void registrationIsOwnerScopedIdempotentAndNeverEchoesTheToken() throws Exception {
        String token = "push-fixture-token-one";
        String first = register(ownerJwt, "install-one", token);
        String second = register(ownerJwt, "install-one", token);
        assertThat(second).isEqualTo(first);
        assertThat(first).doesNotContain(token).doesNotContain("token_fingerprint");
        assertThat(second).doesNotContain(token);
        assertThat(jdbc.queryForObject(
                "SELECT COUNT(*) FROM notifications.device_registration WHERE user_id=? AND installation_id=?",
                Integer.class, OWNER, "install-one")).isEqualTo(1);
        String ciphertext = jdbc.queryForObject(
                "SELECT token_ciphertext FROM notifications.device_registration WHERE user_id=?",
                String.class, OWNER);
        assertThat(ciphertext).startsWith("v1:").doesNotContain(token);
        assertThat(cryptography.decrypt(ciphertext)).isEqualTo(token);
        register(ownerJwt, "install-one", "push-fixture-token-one-updated");
        assertThat(jdbc.queryForObject(
                "SELECT COUNT(*) FROM notifications.device_registration WHERE user_id=? AND installation_id=?",
                Integer.class, OWNER, "install-one")).isEqualTo(1);
        assertThat(cryptography.decrypt(jdbc.queryForObject(
                "SELECT token_ciphertext FROM notifications.device_registration WHERE user_id=?",
                String.class, OWNER))).isEqualTo("push-fixture-token-one-updated");

        mvc.perform(delete("/api/v1/notifications/my/devices/install-one").with(ownerJwt))
                .andExpect(status().isNoContent());
        mvc.perform(delete("/api/v1/notifications/my/devices/install-one").with(ownerJwt))
                .andExpect(status().isNoContent());
        assertThat(jdbc.queryForObject(
                "SELECT status FROM notifications.device_registration WHERE user_id=?",
                String.class, OWNER)).isEqualTo("REVOKED");
    }

    @Test
    void foreignInstallationIsNotVisibleAndDeleteRemainsIdempotentForUnknownIds() throws Exception {
        register(ownerJwt, "private-install", "push-fixture-token-two");
        mvc.perform(put("/api/v1/notifications/my/devices/private-install").with(otherJwt)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(registrationBody("push-fixture-token-three")))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("NOT_FOUND"));
        mvc.perform(delete("/api/v1/notifications/my/devices/private-install").with(otherJwt))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("NOT_FOUND"));
        mvc.perform(delete("/api/v1/notifications/my/devices/unknown-install").with(otherJwt))
                .andExpect(status().isNoContent());
    }

    @Test
    void missingKeyReturns503BeforeAnyRegistrationWrite() throws Exception {
        String key = properties.getTokenKey();
        try {
            properties.setTokenKey("");
            mvc.perform(put("/api/v1/notifications/my/devices/install-no-key").with(ownerJwt)
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(registrationBody("push-fixture-token-no-key")))
                    .andExpect(status().isServiceUnavailable())
                    .andExpect(jsonPath("$.code").value("PUSH_NOT_CONFIGURED"));
            assertThat(jdbc.queryForObject(
                    "SELECT COUNT(*) FROM notifications.device_registration", Integer.class)).isZero();
        } finally {
            properties.setTokenKey(key);
        }
    }

    @Test
    void malformedRegistrationAndInvalidTokenUseTheContract400Codes() throws Exception {
        mvc.perform(put("/api/v1/notifications/my/devices/install-invalid").with(ownerJwt)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"provider\":\"FCM\",\"platform\":\"ANDROID\",\"extra\":true}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_REQUEST"));
        mvc.perform(put("/api/v1/notifications/my/devices/install-invalid").with(ownerJwt)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(registrationBody("")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("DEVICE_TOKEN_INVALID"));
        assertThat(jdbc.queryForObject(
                "SELECT COUNT(*) FROM notifications.device_registration", Integer.class)).isZero();
    }

    @Test
    void openApiDeclaresTypedRegistrationBodyWithAWriteOnlyToken() throws Exception {
        mvc.perform(get("/v3/api-docs"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.paths['/api/v1/notifications/my/devices/{installationId}']"
                        + ".put.requestBody.content['application/json'].schema['$ref']")
                        .value("#/components/schemas/PushDeviceRegistrationRequest"))
                .andExpect(jsonPath("$.components.schemas.PushDeviceRegistrationRequest.properties.provider.type")
                        .value("string"))
                .andExpect(jsonPath("$.components.schemas.PushDeviceRegistrationRequest.properties.platform.type")
                        .value("string"))
                .andExpect(jsonPath("$.components.schemas.PushDeviceRegistrationRequest.properties.token.type")
                        .value("string"))
                .andExpect(jsonPath("$.components.schemas.PushDeviceRegistrationRequest.properties.token.writeOnly")
                        .value(true));
    }

    @Test
    void rebindTransfersTokenOwnershipAndAuditsOnlyTheAllowedIdentifiers() throws Exception {
        String token = "push-fixture-rebind-token";
        register(ownerJwt, "owner-install", token);
        String response = register(otherJwt, "other-install", token);
        assertThat(response).doesNotContain(token);
        assertThat(jdbc.queryForObject(
                "SELECT COUNT(*) FROM notifications.device_registration WHERE provider='FCM' AND token_fingerprint=?",
                Integer.class, cryptography.fingerprint(token))).isEqualTo(1);
        assertThat(jdbc.queryForObject(
                "SELECT user_id FROM notifications.device_registration WHERE token_fingerprint=?",
                String.class, cryptography.fingerprint(token))).isEqualTo(OTHER);
        assertThat(jdbc.queryForObject(
                "SELECT COUNT(*) FROM notifications.device_registration WHERE user_id=?",
                Integer.class, OWNER)).isZero();
        assertThat(jdbc.queryForObject(
                "SELECT COUNT(*) FROM campuscore_audit.\"AdminAudit\""
                        + " WHERE \"action\"='PUSH_DEVICE_REBOUND' AND \"actorId\"=?",
                Integer.class, OTHER)).isEqualTo(1);
        String deviceId = jdbc.queryForObject(
                "SELECT id FROM notifications.device_registration WHERE token_fingerprint=?",
                String.class, cryptography.fingerprint(token));
        assertThat(jdbc.queryForObject(
                "SELECT \"entityId\" FROM campuscore_audit.\"AdminAudit\""
                        + " WHERE \"action\"='PUSH_DEVICE_REBOUND'",
                String.class)).isEqualTo(deviceId);
        assertThat(jdbc.queryForObject(
                "SELECT \"summary\" FROM campuscore_audit.\"AdminAudit\""
                        + " WHERE \"action\"='PUSH_DEVICE_REBOUND'",
                String.class)).isNull();
        String audit = jdbc.queryForObject(
                "SELECT COALESCE(\"beforeState\",'') || COALESCE(\"afterState\",'')"
                        + " FROM campuscore_audit.\"AdminAudit\" WHERE \"action\"='PUSH_DEVICE_REBOUND'",
                String.class);
        assertThat(audit).contains(OWNER, OTHER).doesNotContain(token, cryptography.fingerprint(token));
    }

    @Test
    void disabledPushCreatesNoOutboxButBatchAndSingleWriteShareTheTransactionalSeam() throws Exception {
        register(ownerJwt, "disabled-install", "push-fixture-disabled-token");
        register(ownerJwt, "disabled-install-two", "push-fixture-disabled-token-two");
        properties.setEnabled(false);
        createNotification("disabled-notice", OWNER, Instant.now());
        assertThat(countOutbox("disabled-notice")).isZero();

        properties.setEnabled(true);
        Instant createdAt = Instant.now();
        assertThatThrownBy(() -> transaction.executeWithoutResult(ignored -> {
            notifications.create(command("rolled-back-notice", OWNER, createdAt));
            throw new IllegalStateException("force caller rollback");
        })).isInstanceOf(IllegalStateException.class);
        assertThat(countNotification("rolled-back-notice")).isZero();
        assertThat(countOutbox("rolled-back-notice")).isZero();

        createNotification("single-notice", OWNER, createdAt);
        assertThat(countOutbox("single-notice")).isEqualTo(2);
        outbox.enqueue("single-notice", OWNER, createdAt);
        outbox.enqueue("single-notice", OWNER, createdAt);
        assertThat(countOutbox("single-notice")).isEqualTo(2);

        notifications.createBatch(List.of(
                command("batch-notice-one", OWNER, createdAt),
                command("batch-notice-two", OWNER, createdAt)));
        assertThat(countOutbox("batch-notice-one")).isEqualTo(2);
        assertThat(countOutbox("batch-notice-two")).isEqualTo(2);
    }

    @Test
    void inactiveAccountCredentialRotationRebindAndRevocationSuppressBeforeProviderSend() throws Exception {
        properties.setEnabled(true);
        RecordingProvider provider = new RecordingProvider(false);
        MutableClock clock = new MutableClock(Instant.now().minusSeconds(2));

        createDelivery("inactive-notice", OWNER, "inactive-install", "token-inactive", clock.instant());
        jdbc.update("UPDATE campuscore_auth.\"User\" SET \"status\"='INACTIVE' WHERE \"id\"=?", OWNER);
        assertSuppressed(provider, clock, "inactive-notice");
        jdbc.update("UPDATE campuscore_auth.\"User\" SET \"status\"='ACTIVE' WHERE \"id\"=?", OWNER);

        createDelivery("credential-notice", OWNER, "credential-install", "token-credential", clock.instant());
        jdbc.update("UPDATE campuscore_auth.\"User\" SET \"credentialVersion\"=1 WHERE \"id\"=?", OWNER);
        assertSuppressed(provider, clock, "credential-notice");
        jdbc.update("UPDATE campuscore_auth.\"User\" SET \"credentialVersion\"=0 WHERE \"id\"=?", OWNER);

        createDelivery("rebind-notice", OWNER, "rebind-install", "token-rebind", clock.instant());
        devices.register(OTHER, "new-owner-install",
                new PushDeviceRegistrationRequest("FCM", "ANDROID", "token-rebind"));
        assertSuppressed(provider, clock, "rebind-notice");

        createDelivery("revoked-notice", OWNER, "revoked-install", "token-revoked", clock.instant());
        devices.delete(OWNER, "revoked-install");
        assertSuppressed(provider, clock, "revoked-notice");
        assertThat(provider.sendCount()).isZero();
    }

    @Test
    void missingProviderBlocksAndTimeoutRetriesWithFiveAttemptCeiling() throws Exception {
        properties.setEnabled(true);
        MutableClock clock = new MutableClock(Instant.now().minusSeconds(2));
        createDelivery("blocked-notice", OWNER, "blocked-install", "token-blocked", clock.instant());
        try (var dispatcher = new PushDispatcher(outbox, cryptography, defaultProvider, properties, clock)) {
            dispatcher.dispatchBatch();
        }
        OutboxState blocked = state("blocked-notice");
        assertThat(blocked.status()).isEqualTo("BLOCKED");
        assertThat(blocked.sentAt()).isNull();

        createDelivery("timeout-notice", OWNER, "timeout-install", "token-timeout", clock.instant());
        RecordingProvider timeoutProvider = new RecordingProvider(true);
        try (var dispatcher = new PushDispatcher(outbox, cryptography, timeoutProvider, properties, clock)) {
            for (int attempt = 1; attempt <= 5; attempt++) {
                dispatcher.dispatchBatch();
                OutboxState state = state("timeout-notice");
                assertThat(state.attemptCount()).isEqualTo(attempt);
                assertThat(state.sentAt()).isNull();
                if (attempt < 5) {
                    assertThat(state.status()).isEqualTo("RETRY_WAIT");
                    assertThat(state.nextAttemptAt()).isAfter(clock.instant());
                    long baseDelay = Math.min(300_000L, 1_000L << (attempt - 1));
                    long actualDelay = Duration.between(clock.instant(), state.nextAttemptAt()).toMillis();
                    assertThat(actualDelay).isBetween((long) (baseDelay * 0.8),
                            (long) Math.min(300_000, baseDelay * 1.2));
                    makeRetryDue(notificationId("timeout-notice"));
                } else {
                    assertThat(state.status()).isEqualTo("FAILED");
                    assertThat(state.lastErrorCode()).isEqualTo("RETRY_EXHAUSTED");
                }
            }
        }
        assertThat(timeoutProvider.sendCount()).isEqualTo(5);
    }

    @Test
    void blockingProviderIsInterruptedAndRetriesWithTheSameOutboxDeliveryKey() throws Exception {
        properties.setEnabled(true);
        properties.setSendTimeoutMs(100);
        MutableClock clock = new MutableClock(Instant.now().minusSeconds(2));
        createDelivery("blocking-notice", OWNER, "blocking-install", "token-blocking", clock.instant());
        String outboxId = notificationId("blocking-notice");
        BlockingProvider provider = new BlockingProvider();

        try (var dispatcher = new PushDispatcher(outbox, cryptography, provider, properties, clock)) {
            for (int attempt = 1; attempt <= 2; attempt++) {
                int sent = assertTimeoutPreemptively(Duration.ofSeconds(3), dispatcher::dispatchBatch);
                assertThat(sent).isZero();
                assertThat(provider.interruptedSends.tryAcquire(3, TimeUnit.SECONDS)).isTrue();
                OutboxState state = outbox.state(outboxId).orElseThrow();
                assertThat(state.status()).isEqualTo("RETRY_WAIT");
                assertThat(state.lastErrorCode()).isEqualTo("PROVIDER_TIMEOUT");
                assertThat(state.attemptCount()).isEqualTo(attempt);
                assertThat(state.sentAt()).isNull();
                assertThat(provider.deliveryKeys).hasSize(attempt).containsOnly(outboxId);
                if (attempt < 2) {
                    makeRetryDue(outboxId);
                }
            }
        }

        for (Thread sendThread : provider.sendThreads) {
            sendThread.join(3_000);
            assertThat(sendThread.isAlive()).isFalse();
        }
    }

    @Test
    void confirmedProviderReceiptIsRequiredForSent() throws Exception {
        properties.setEnabled(true);
        MutableClock clock = new MutableClock(Instant.now().minusSeconds(2));
        createDelivery("confirmed-notice", OWNER, "confirmed-install", "token-confirmed", clock.instant());
        RecordingProvider provider = new RecordingProvider(false);
        try (var dispatcher = new PushDispatcher(outbox, cryptography, provider, properties, clock)) {
            assertThat(dispatcher.dispatchBatch()).isEqualTo(1);
        }
        assertThat(state("confirmed-notice").status()).isEqualTo("SENT");
        assertThat(state("confirmed-notice").sentAt()).isNotNull();
        assertThat(provider.lastToken()).isEqualTo("token-confirmed");
        assertThat(provider.lastDeliveryKey()).isEqualTo(notificationId("confirmed-notice"));
    }

    @Test
    void providerReceivesOnlyGenericTextAndTheNotificationId() throws Exception {
        properties.setEnabled(true);
        String notificationId = "generic-payload-notice";
        String titleSentinel = "SENTINEL_TITLE_xyz";
        String bodySentinel = "SENTINEL_BODY_xyz";
        String linkSentinel = "/private/SENTINEL_LINK_xyz";
        register(ownerJwt, "generic-payload-install", "token-generic-payload");
        notifications.create(new CreateNotificationCommand(notificationId, OWNER,
                titleSentinel, bodySentinel, "INFO", linkSentinel,
                Instant.now().minusSeconds(2)));

        RecordingProvider provider = new RecordingProvider(false);
        try (var dispatcher = new PushDispatcher(outbox, cryptography, provider, properties)) {
            assertThat(dispatcher.dispatchBatch()).isEqualTo(1);
        }

        PushPayload payload = provider.lastPayload();
        assertThat(payload.title()).isEqualTo(PushPayload.GENERIC_TITLE);
        assertThat(payload.body()).isEqualTo(PushPayload.GENERIC_BODY);
        assertThat(payload.notificationId()).isEqualTo(notificationId);
        assertThat(payload.toString()).doesNotContain(titleSentinel, bodySentinel, linkSentinel);
    }

    private void assertSuppressed(RecordingProvider provider, MutableClock clock, String notificationId) {
        try (var dispatcher = new PushDispatcher(outbox, cryptography, provider, properties, clock)) {
            dispatcher.dispatchBatch();
        }
        assertThat(state(notificationId).status()).isEqualTo("SUPPRESSED");
        assertThat(state(notificationId).sentAt()).isNull();
    }

    private void createDelivery(
            String notificationId, String owner, String installationId, String token, Instant createdAt)
            throws Exception {
        // Each scenario owns exactly one active device so its outbox row is unambiguous.
        jdbc.update("UPDATE notifications.device_registration SET status='REVOKED', revoked_at=CURRENT_TIMESTAMP WHERE user_id=? AND status='ACTIVE'", owner);
        register(owner.equals(OWNER) ? ownerJwt : otherJwt, installationId, token);
        createNotification(notificationId, owner, createdAt);
    }

    private String register(JwtRequestPostProcessor jwt, String installationId, String token) throws Exception {
        MvcResult result = mvc.perform(put("/api/v1/notifications/my/devices/" + installationId)
                        .with(jwt)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(registrationBody(token)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.installationId").value(installationId))
                .andExpect(jsonPath("$.token").doesNotExist())
                .andReturn();
        String response = result.getResponse().getContentAsString();
        assertThat(response).doesNotContain(token);
        return response;
    }

    private static String registrationBody(String token) {
        return "{\"provider\":\"FCM\",\"platform\":\"ANDROID\",\"token\":\"" + token + "\"}";
    }

    private void createNotification(String id, String owner, Instant createdAt) {
        notifications.create(command(id, owner, createdAt));
    }

    private static CreateNotificationCommand command(String id, String owner, Instant createdAt) {
        return new CreateNotificationCommand(id, owner, "Fixture title", "Fixture message",
                "INFO", null, createdAt);
    }

    private int countOutbox(String notificationId) {
        return jdbc.queryForObject(
                "SELECT COUNT(*) FROM notifications.delivery_outbox WHERE notification_id=?",
                Integer.class, notificationId);
    }

    private int countNotification(String id) {
        return jdbc.queryForObject(
                "SELECT COUNT(*) FROM notifications.notification WHERE id=?", Integer.class, id);
    }

    private OutboxState state(String notificationId) {
        String id = notificationId(notificationId);
        return outbox.state(id).orElseThrow();
    }

    private String notificationId(String notificationId) {
        return jdbc.queryForObject(
                "SELECT id FROM notifications.delivery_outbox WHERE notification_id=?",
                String.class, notificationId);
    }

    private void makeRetryDue(String id) {
        jdbc.update("UPDATE notifications.delivery_outbox SET next_attempt_at=? WHERE id=?",
                Timestamp.from(Instant.now().minusSeconds(1)), id);
    }

    private static String testKey() {
        return Base64.getEncoder().encodeToString(
                "0123456789abcdef0123456789abcdef".getBytes(StandardCharsets.UTF_8));
    }

    private static final class RecordingProvider implements PushProvider {
        private final boolean timeout;
        private int sendCount;
        private String lastToken;
        private PushPayload lastPayload;
        private String lastDeliveryKey;

        private RecordingProvider(boolean timeout) {
            this.timeout = timeout;
        }

        @Override
        public boolean isConfigured() {
            return true;
        }

        @Override
        public DeliveryReceipt send(String provider, String token, PushPayload payload, String deliveryKey)
                throws Exception {
            sendCount++;
            lastToken = token;
            lastPayload = payload;
            lastDeliveryKey = deliveryKey;
            if (timeout) {
                throw new TimeoutException("synthetic timeout");
            }
            return new DeliveryReceipt(true);
        }

        int sendCount() { return sendCount; }
        String lastToken() { return lastToken; }
        PushPayload lastPayload() { return lastPayload; }
        String lastDeliveryKey() { return lastDeliveryKey; }
    }

    private static final class BlockingProvider implements PushProvider {
        private final List<String> deliveryKeys = new CopyOnWriteArrayList<>();
        private final List<Thread> sendThreads = new CopyOnWriteArrayList<>();
        private final Semaphore interruptedSends = new Semaphore(0);
        private final CountDownLatch release = new CountDownLatch(1);

        @Override
        public boolean isConfigured() {
            return true;
        }

        @Override
        public DeliveryReceipt send(String provider, String token, PushPayload payload, String deliveryKey)
                throws Exception {
            deliveryKeys.add(deliveryKey);
            sendThreads.add(Thread.currentThread());
            try {
                if (!release.await(10, TimeUnit.SECONDS)) {
                    throw new TimeoutException("Synthetic provider wait expired");
                }
            } catch (InterruptedException interrupted) {
                interruptedSends.release();
                // Even a late accepted receipt after cancellation must never mark this attempt SENT.
                return new DeliveryReceipt(true);
            }
            return new DeliveryReceipt(true);
        }
    }

    private static final class MutableClock extends Clock {
        private Instant instant;

        private MutableClock(Instant instant) {
            this.instant = instant;
        }

        @Override public ZoneId getZone() { return ZoneId.of("UTC"); }
        @Override public Clock withZone(ZoneId zone) { return this; }
        @Override public Instant instant() { return instant; }
    }
}
