package io.campuscore.restfulapi.notification.push;

import static org.assertj.core.api.Assertions.assertThat;

import io.campuscore.restfulapi.notification.repository.NotificationWriteRepository;
import io.campuscore.restfulapi.notification.repository.NotificationWriteRepository.CreateNotificationCommand;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Proxy;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.SQLException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.stream.IntStream;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.jdbc.datasource.DelegatingDataSource;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.jdbc.datasource.init.ScriptUtils;

class NotificationPushBatchEnqueueTest {

    private final List<String> statements = new ArrayList<>();
    private NamedParameterJdbcTemplate jdbc;
    private PushProperties properties;
    private DeliveryOutboxRepository outbox;
    private NotificationWriteRepository notifications;

    @BeforeEach
    void fixture() throws Exception {
        DriverManagerDataSource source = new DriverManagerDataSource(
                "jdbc:h2:mem:push_batch_" + UUID.randomUUID()
                        + ";MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1",
                "sa", "");
        DelegatingDataSource measured = new DelegatingDataSource(source) {
            @Override
            public Connection getConnection() throws SQLException {
                Connection connection = super.getConnection();
                return (Connection) Proxy.newProxyInstance(getClass().getClassLoader(),
                        new Class<?>[]{Connection.class}, (proxy, method, args) -> {
                            Object result = invoke(connection, method, args);
                            if (method.getName().equals("prepareStatement")) {
                                String sql = (String) args[0];
                                return Proxy.newProxyInstance(getClass().getClassLoader(),
                                        new Class<?>[]{PreparedStatement.class}, (p, m, a) -> {
                                            if (m.getName().startsWith("execute")) {
                                                statements.add(sql);
                                            }
                                            return invoke(result, m, a);
                                        });
                            }
                            return result;
                        });
            }
        };
        jdbc = new NamedParameterJdbcTemplate(measured);
        try (Connection connection = source.getConnection()) {
            ScriptUtils.executeSqlScript(connection,
                    new ClassPathResource("db/migration-h2/V143__notification_push_delivery.sql"));
            try (var statement = connection.createStatement()) {
                statement.execute("""
                        CREATE TABLE notifications.notification (
                            id VARCHAR(120) PRIMARY KEY,
                            user_id VARCHAR(120) NOT NULL,
                            title VARCHAR(240) NOT NULL,
                            message VARCHAR(2000) NOT NULL,
                            type VARCHAR(60) NOT NULL,
                            link VARCHAR(500),
                            is_read BOOLEAN NOT NULL DEFAULT FALSE,
                            read_at TIMESTAMP WITH TIME ZONE,
                            created_at TIMESTAMP WITH TIME ZONE NOT NULL,
                            updated_at TIMESTAMP WITH TIME ZONE NOT NULL
                        )
                        """);
            }
        }
        properties = new PushProperties();
        properties.setEnabled(true);
        outbox = new DeliveryOutboxRepository(jdbc, properties);
        notifications = new NotificationWriteRepository(jdbc, outbox);
        statements.clear();
    }

    @Test
    void fanOutStatementsScaleWithChunksInsteadOfRecipients() {
        int recipients = 501;
        for (int index = 0; index < recipients; index++) {
            registerDevice("budget-device-" + index, "budget-user-" + index, true);
        }
        Instant createdAt = Instant.parse("2026-10-30T08:00:00Z");
        List<CreateNotificationCommand> commands = IntStream.range(0, recipients)
                .mapToObj(index -> command(
                        "budget-notice-" + index, "budget-user-" + index, createdAt))
                .toList();
        statements.clear();

        assertThat(notifications.createBatch(commands)).isEqualTo(recipients);

        assertThat(countOutbox()).isEqualTo(recipients);
        // One notification batch plus one device SELECT and one outbox batch
        // for each 500-recipient chunk; per-recipient fan-out needs 1003.
        assertThat(statements)
                .as("outbox enqueue statements for %s recipients", recipients)
                .hasSize(1 + 2 * 2);
    }

    @Test
    void batchedFanOutWritesTheSameOutboxRowsAsPerRecipientWrites() {
        registerDevice("one-device", "set-one", true);
        registerDevice("multi-a", "set-multi", true);
        registerDevice("multi-b", "set-multi", true);
        registerDevice("multi-c", "set-multi", true);
        registerDevice("mixed-active", "set-mixed", true);
        registerDevice("mixed-revoked", "set-mixed", false);

        Instant createdAt = Instant.parse("2026-10-30T09:00:00Z");
        List<CreateNotificationCommand> commands = List.of(
                command("notice-none", "set-none", createdAt),
                command("notice-one", "set-one", createdAt),
                command("notice-multi", "set-multi", createdAt),
                command("notice-mixed", "set-mixed", createdAt),
                command("notice-one-again", "set-one", createdAt.plusSeconds(1)),
                command("notice-mixed-again", "set-mixed", createdAt.plusSeconds(2)));

        for (CreateNotificationCommand command : commands) {
            notifications.create(command);
        }
        List<OutboxRow> perRecipient = outboxRows();
        clearInbox();

        notifications.createBatch(commands);

        assertThat(outboxRows()).containsExactlyInAnyOrderElementsOf(perRecipient);
        assertThat(outboxRows()).hasSize(7);
        assertThat(outboxRows()).extracting(OutboxRow::recipientUserId)
                .doesNotContain("set-none");
    }

    @Test
    void repeatedBatchEnqueueKeepsOneOutboxRowPerNotificationAndDevice() {
        registerDevice("repeat-device", "repeat-user", true);
        Instant createdAt = Instant.parse("2026-10-30T09:30:00Z");
        List<DeliveryOutboxRepository.EnqueueRequest> requests = List.of(
                new DeliveryOutboxRepository.EnqueueRequest(
                        "repeat-notice", "repeat-user", createdAt),
                new DeliveryOutboxRepository.EnqueueRequest(
                        "repeat-notice", "repeat-user", createdAt));

        outbox.enqueueBatch(requests);

        assertThat(outboxRows()).hasSize(1);
        outbox.enqueueBatch(requests);
        assertThat(outboxRows()).hasSize(1);
    }

    @Test
    void duplicateRecipientsAcrossChunkBoundariesKeepOneOutboxRow() {
        int firstChunk = 500;
        for (int index = 0; index < firstChunk; index++) {
            registerDevice("boundary-device-" + index, "boundary-user-" + index, true);
        }
        Instant createdAt = Instant.parse("2026-10-30T09:45:00Z");
        List<DeliveryOutboxRepository.EnqueueRequest> requests = new ArrayList<>();
        for (int index = 0; index < firstChunk; index++) {
            requests.add(new DeliveryOutboxRepository.EnqueueRequest(
                    "boundary-notice-" + index, "boundary-user-" + index, createdAt));
        }
        requests.add(new DeliveryOutboxRepository.EnqueueRequest(
                "boundary-notice-0", "boundary-user-0", createdAt));

        outbox.enqueueBatch(requests);

        assertThat(outboxRows()).hasSize(firstChunk);
    }

    @Test
    void disabledPushWritesNoOutboxRowsForSingleOrBatchedWrites() {
        registerDevice("disabled-device", "disabled-user", true);
        Instant createdAt = Instant.parse("2026-10-30T10:00:00Z");
        properties.setEnabled(false);

        notifications.createBatch(List.of(
                command("disabled-batch-one", "disabled-user", createdAt),
                command("disabled-batch-two", "disabled-user", createdAt)));
        assertThat(outboxRows()).isEmpty();
        clearInbox();

        notifications.create(command("disabled-single", "disabled-user", createdAt));
        assertThat(outboxRows()).isEmpty();
    }

    private void registerDevice(String deviceId, String userId, boolean active) {
        String fingerprint = ("fingerprint-" + deviceId + "-" + "0".repeat(64)).substring(0, 64);
        jdbc.update("INSERT INTO notifications.device_registration"
                        + " (id,user_id,installation_id,provider,platform,token_ciphertext,"
                        + " token_fingerprint,credential_version,status)"
                        + " VALUES (:id,:userId,:installation,'FCM','ANDROID','v1:fixture',"
                        + " :fingerprint,0,:status)",
                new MapSqlParameterSource()
                        .addValue("id", deviceId)
                        .addValue("userId", userId)
                        .addValue("installation", "install-" + deviceId)
                        .addValue("fingerprint", fingerprint)
                        .addValue("status", active ? "ACTIVE" : "REVOKED"));
    }

    private int countOutbox() {
        Integer count = jdbc.getJdbcTemplate().queryForObject(
                "SELECT COUNT(*) FROM notifications.delivery_outbox", Integer.class);
        return count == null ? 0 : count;
    }

    private List<OutboxRow> outboxRows() {
        return jdbc.query("SELECT notification_id,device_id,recipient_user_id,status,"
                        + "attempt_count,lease_generation FROM notifications.delivery_outbox"
                        + " ORDER BY notification_id,device_id",
                (rs, rowNumber) -> new OutboxRow(
                        rs.getString("notification_id"),
                        rs.getString("device_id"),
                        rs.getString("recipient_user_id"),
                        rs.getString("status"),
                        rs.getInt("attempt_count"),
                        rs.getLong("lease_generation")));
    }

    private void clearInbox() {
        jdbc.getJdbcTemplate().update("DELETE FROM notifications.delivery_outbox");
        jdbc.getJdbcTemplate().update("DELETE FROM notifications.notification");
    }

    private static CreateNotificationCommand command(String id, String userId, Instant createdAt) {
        return new CreateNotificationCommand(id, userId, "Fixture title", "Fixture message",
                "INFO", null, createdAt);
    }

    private static Object invoke(Object target, java.lang.reflect.Method method, Object[] args)
            throws Throwable {
        try {
            return method.invoke(target, args);
        } catch (InvocationTargetException exception) {
            throw exception.getCause();
        }
    }

    private record OutboxRow(
            String notificationId,
            String deviceId,
            String recipientUserId,
            String status,
            int attemptCount,
            long leaseGeneration) { }
}
