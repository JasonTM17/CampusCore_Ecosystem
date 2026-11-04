package io.campuscore.restfulapi.notification.repository;

import io.campuscore.restfulapi.notification.web.NotificationReadDtos.NotificationResponse;
import io.campuscore.restfulapi.notification.push.DeliveryOutboxRepository;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.TimeUnit;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Profile;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.dao.PessimisticLockingFailureException;
import org.springframework.dao.QueryTimeoutException;
import org.springframework.jdbc.core.ConnectionCallback;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.jdbc.core.namedparam.SqlParameterSource;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

/** JDBC write adapter for the notification inbox. */
@Repository
@Profile("persistence")
public class NotificationWriteRepository {

    private static final String TABLE = "notifications.notification";

    private static final String INSERT_SQL = "INSERT INTO " + TABLE
            + " (id, user_id, title, message, type, link, is_read, read_at, created_at, updated_at)"
            + " VALUES (:id, :userId, :title, :message, :type, :link, FALSE, NULL, :createdAt, :createdAt)";

    private static final String SELECT_COLUMNS = """
            id, user_id, title, message, type, link, is_read, read_at, created_at, updated_at
            """;

    private static final RowMapper<NotificationResponse> ROW_MAPPER =
            NotificationWriteRepository::mapRow;

    private final NamedParameterJdbcTemplate jdbc;
    private final DeliveryOutboxRepository deliveryOutbox;
    private volatile Boolean postgres;

    @Autowired
    public NotificationWriteRepository(
            NamedParameterJdbcTemplate jdbc, DeliveryOutboxRepository deliveryOutbox) {
        this.jdbc = jdbc;
        this.deliveryOutbox = deliveryOutbox;
    }

    /** Compatibility constructor for focused repository fixtures outside Spring. */
    public NotificationWriteRepository(NamedParameterJdbcTemplate jdbc) {
        this(jdbc, null);
    }

    public Optional<NotificationResponse> findOwned(String userId, String notificationId) {
        return jdbc.query(
                        "SELECT " + SELECT_COLUMNS
                                + " FROM " + TABLE
                                + " WHERE id = :id AND user_id = :userId",
                        new MapSqlParameterSource()
                                .addValue("id", notificationId)
                                .addValue("userId", userId),
                        ROW_MAPPER)
                .stream()
                .findFirst();
    }

    public Optional<NotificationResponse> findById(String notificationId) {
        return findById(notificationId, false);
    }

    /** Admin mutation snapshot; the caller's transaction holds the lock through write/audit. */
    public Optional<NotificationResponse> findByIdForUpdate(String notificationId) {
        return findById(notificationId, true);
    }

    private Optional<NotificationResponse> findById(String notificationId, boolean forUpdate) {
        return jdbc.query(
                        "SELECT " + SELECT_COLUMNS
                                + " FROM " + TABLE
                                + " WHERE id = :id" + (forUpdate ? " FOR UPDATE" : ""),
                        new MapSqlParameterSource("id", notificationId),
                        ROW_MAPPER)
                .stream()
                .findFirst();
    }

    @Transactional
    public NotificationResponse create(CreateNotificationCommand command) {
        jdbc.update(INSERT_SQL, insertParameters(command));
        if (deliveryOutbox != null) {
            deliveryOutbox.enqueue(command.id(), command.userId(), command.createdAt());
        }
        return findById(command.id())
                .orElseThrow(() -> new IllegalStateException("created notification was not found"));
    }

    /**
     * Insert behind the client-supplied idempotency contract: returns the new
     * row, or empty when a row already holds the derived id (a replayed
     * request). The push outbox enqueue runs only on a real insert, so a
     * replay cannot queue a second delivery round either.
     */
    @Transactional
    public Optional<NotificationResponse> createIfAbsent(CreateNotificationCommand command) {
        // ON CONFLICT keeps a racing duplicate's transaction valid on
        // PostgreSQL. The non-PostgreSQL mirror reports the same race as a
        // duplicate key, or as a lock timeout while the winner is still
        // uncommitted; both mean the committed row is the answer.
        boolean postgres = isPostgres();
        String insert = INSERT_SQL + (postgres ? " ON CONFLICT (id) DO NOTHING" : "");
        try {
            if (jdbc.update(insert, insertParameters(command)) == 0) {
                return Optional.empty();
            }
        } catch (DuplicateKeyException duplicate) {
            return Optional.empty();
        } catch (QueryTimeoutException | PessimisticLockingFailureException locked) {
            if (postgres) {
                throw locked;
            }
            awaitCommitted(command.id());
            return Optional.empty();
        }
        if (deliveryOutbox != null) {
            deliveryOutbox.enqueue(command.id(), command.userId(), command.createdAt());
        }
        return findById(command.id());
    }

    /**
     * A non-PostgreSQL winner may still be uncommitted when the racing insert
     * hits its lock timeout; wait briefly for the committed row instead of
     * turning a legitimate replay into a failure.
     */
    private void awaitCommitted(String id) {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5);
        while (System.nanoTime() < deadline) {
            if (findById(id).isPresent()) {
                return;
            }
            try {
                Thread.sleep(50);
            } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
                return;
            }
        }
    }

    private boolean isPostgres() {
        Boolean detected = postgres;
        if (detected != null) {
            return detected;
        }
        synchronized (this) {
            if (postgres == null) {
                postgres = Boolean.TRUE.equals(jdbc.getJdbcTemplate().execute(
                        (ConnectionCallback<Boolean>) connection -> connection.getMetaData()
                                .getDatabaseProductName().equalsIgnoreCase("PostgreSQL")));
            }
            return postgres;
        }
    }

    /**
     * Multi-row insert for the announcement fan-out (R7). One JDBC batch keeps
     * a campus-wide broadcast to a handful of round-trips instead of one
     * {@link #create(CreateNotificationCommand)} per student (which would also
     * re-SELECT every row it wrote). Returns the number of commands sent:
     * drivers may report {@code SUCCESS_NO_INFO} per row, so the request count
     * is the honest contract to callers. A failed batch throws and the caller
     * transaction is expected to roll the whole fan-out back.
     */
    @Transactional
    public int createBatch(List<CreateNotificationCommand> commands) {
        if (commands == null || commands.isEmpty()) {
            return 0;
        }
        SqlParameterSource[] batch = commands.stream()
                .map(NotificationWriteRepository::insertParameters)
                .toArray(SqlParameterSource[]::new);
        jdbc.batchUpdate(INSERT_SQL, batch);
        if (deliveryOutbox != null) {
            deliveryOutbox.enqueueBatch(commands.stream()
                    .map(command -> new DeliveryOutboxRepository.EnqueueRequest(
                            command.id(), command.userId(), command.createdAt()))
                    .toList());
        }
        return commands.size();
    }

    public Set<String> findExistingIds(List<String> ids) {
        if (ids == null || ids.isEmpty()) {
            return Set.of();
        }
        return new HashSet<>(jdbc.queryForList(
                "SELECT id FROM " + TABLE + " WHERE id IN (:ids)",
                new MapSqlParameterSource("ids", ids), String.class));
    }

    public Set<String> findMatchingUsers(
            List<String> userIds,
            String title,
            String message,
            String type,
            String link,
            Instant createdAfter,
            Instant createdBefore) {
        if (userIds == null || userIds.isEmpty()) {
            return Set.of();
        }
        return new HashSet<>(jdbc.queryForList(
                "SELECT DISTINCT user_id FROM " + TABLE
                        + " WHERE user_id IN (:userIds) AND title = :title AND message = :message"
                        + " AND type = :type AND link = :link AND created_at >= :createdAfter AND created_at <= :createdBefore",
                new MapSqlParameterSource()
                        .addValue("userIds", userIds)
                        .addValue("title", title)
                        .addValue("message", message)
                        .addValue("type", type)
                        .addValue("link", link)
                        .addValue("createdAfter", Timestamp.from(createdAfter))
                        .addValue("createdBefore", Timestamp.from(createdBefore)),
                String.class));
    }

    private static MapSqlParameterSource insertParameters(CreateNotificationCommand command) {
        return new MapSqlParameterSource()
                .addValue("id", command.id())
                .addValue("userId", command.userId())
                .addValue("title", command.title())
                .addValue("message", command.message())
                .addValue("type", command.type())
                .addValue("link", command.link())
                .addValue("createdAt", Timestamp.from(command.createdAt()));
    }

    /**
     * Returns the number of rows updated: 0 means the row either vanished or
     * belongs to another user. The ownership predicate lives in the SQL itself
     * (same contract as findOwned), so a caller that skips the service-layer
     * SELECT guard still cannot mutate another user's notification.
     */
    public int markRead(String userId, String notificationId) {
        return jdbc.update(
                "UPDATE " + TABLE
                        + " SET is_read = TRUE, read_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP"
                        + " WHERE id = :id AND user_id = :userId",
                new MapSqlParameterSource()
                        .addValue("id", notificationId)
                        .addValue("userId", userId));
    }

    public int markAllRead(String userId) {
        return jdbc.update(
                "UPDATE " + TABLE
                        + " SET is_read = TRUE, read_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP"
                        + " WHERE user_id = :userId AND is_read = FALSE",
                new MapSqlParameterSource("userId", userId));
    }

    /** Ownership-scoped like {@link #markRead(String, String)}: returns 0 for a foreign or missing row. */
    public int delete(String userId, String notificationId) {
        return jdbc.update(
                "DELETE FROM " + TABLE + " WHERE id = :id AND user_id = :userId",
                new MapSqlParameterSource()
                        .addValue("id", notificationId)
                        .addValue("userId", userId));
    }

    /** Admin path: unscoped by design, guarded by the ADMIN-only route. */
    public int deleteAny(String notificationId) {
        return jdbc.update(
                "DELETE FROM " + TABLE + " WHERE id = :id",
                new MapSqlParameterSource("id", notificationId));
    }

    public void update(UpdateNotificationCommand command) {
        List<String> assignments = new ArrayList<>();
        MapSqlParameterSource parameters = new MapSqlParameterSource("id", command.id());
        add(assignments, parameters, "user_id", "userId", command.userId());
        add(assignments, parameters, "title", "title", command.title());
        add(assignments, parameters, "message", "message", command.message());
        add(assignments, parameters, "type", "type", command.type());
        add(assignments, parameters, "link", "link", command.link());
        if (command.userId().present()) {
            assignments.add("is_read = CASE WHEN user_id <> :userId THEN FALSE ELSE is_read END");
            assignments.add("read_at = CASE WHEN user_id <> :userId THEN NULL ELSE read_at END");
        }
        if (assignments.isEmpty()) {
            return;
        }
        assignments.add("updated_at = CURRENT_TIMESTAMP");
        jdbc.update(
                "UPDATE " + TABLE + " SET " + String.join(", ", assignments) + " WHERE id = :id",
                parameters);
    }

    private static void add(
            List<String> assignments,
            MapSqlParameterSource parameters,
            String column,
            String parameter,
            PatchValue<String> value) {
        if (!value.present()) {
            return;
        }
        assignments.add(column + " = :" + parameter);
        parameters.addValue(parameter, value.value());
    }

    private static NotificationResponse mapRow(ResultSet resultSet, int rowNumber)
            throws SQLException {
        return new NotificationResponse(
                resultSet.getString("id"),
                resultSet.getString("user_id"),
                resultSet.getString("title"),
                resultSet.getString("message"),
                resultSet.getString("type"),
                resultSet.getString("link"),
                resultSet.getBoolean("is_read"),
                instant(resultSet.getTimestamp("read_at")),
                instant(resultSet.getTimestamp("created_at")),
                instant(resultSet.getTimestamp("updated_at")));
    }

    private static java.time.Instant instant(Timestamp timestamp) {
        return timestamp == null ? null : timestamp.toInstant();
    }

    public record CreateNotificationCommand(
            String id,
            String userId,
            String title,
            String message,
            String type,
            String link,
            java.time.Instant createdAt) {
    }

    public record UpdateNotificationCommand(
            String id,
            PatchValue<String> userId,
            PatchValue<String> title,
            PatchValue<String> message,
            PatchValue<String> type,
            PatchValue<String> link) {
    }

    public record PatchValue<T>(boolean present, T value) {

        public static <T> PatchValue<T> omitted() {
            return new PatchValue<>(false, null);
        }

        public static <T> PatchValue<T> present(T value) {
            return new PatchValue<>(true, value);
        }
    }
}
