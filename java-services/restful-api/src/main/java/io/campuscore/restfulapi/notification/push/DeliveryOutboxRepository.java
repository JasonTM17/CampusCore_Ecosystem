package io.campuscore.restfulapi.notification.push;

import java.sql.Timestamp;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.context.annotation.Profile;
import org.springframework.jdbc.core.ConnectionCallback;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

/** Transactional notification fan-out, lease claim, and fenced acknowledgements. */
@Repository
@Profile("persistence")
public class DeliveryOutboxRepository {

    private static final String OUTBOX = "notifications.delivery_outbox";
    private final NamedParameterJdbcTemplate jdbc;
    private final PushProperties properties;
    private volatile Boolean postgres;

    public DeliveryOutboxRepository(NamedParameterJdbcTemplate jdbc, PushProperties properties) {
        this.jdbc = jdbc;
        this.properties = properties;
    }

    /** Called by the notification insert seam while that notification transaction is open. */
    @Transactional
    public int enqueue(String notificationId, String recipientUserId, Instant createdAt) {
        if (!properties.isEnabled()) {
            return 0;
        }
        List<String> devices = jdbc.query(
                "SELECT id FROM notifications.device_registration"
                        + " WHERE user_id=:userId AND status='ACTIVE' ORDER BY id",
                new MapSqlParameterSource("userId", recipientUserId),
                (rs, rowNumber) -> rs.getString(1));
        int inserted = 0;
        for (String deviceId : devices) {
            String conflictClause = isPostgres()
                    ? " ON CONFLICT (notification_id,device_id) DO NOTHING"
                    : "";
            inserted += jdbc.update("INSERT INTO " + OUTBOX
                            + " (id,notification_id,device_id,recipient_user_id,status,attempt_count,"
                            + " next_attempt_at,lease_generation,created_at,updated_at)"
                            + " SELECT :id,:notificationId,d.id,:recipientUserId,'PENDING',0,"
                            + " :createdAt,0,:createdAt,:createdAt"
                            + " FROM notifications.device_registration d"
                            + " WHERE d.id=:deviceId AND d.user_id=:recipientUserId AND d.status='ACTIVE'"
                            + " AND NOT EXISTS (SELECT 1 FROM " + OUTBOX
                            + " o WHERE o.notification_id=:notificationId AND o.device_id=d.id)"
                            + conflictClause,
                    new MapSqlParameterSource()
                            .addValue("id", UUID.randomUUID().toString())
                            .addValue("notificationId", notificationId)
                            .addValue("deviceId", deviceId)
                            .addValue("recipientUserId", recipientUserId)
                            .addValue("createdAt", Timestamp.from(createdAt)));
        }
        return inserted;
    }

    @Transactional
    public List<Claim> claim(
            String workerId, int requestedLimit, Instant now, long leaseSeconds, int maxAttempts) {
        return claim(workerId, requestedLimit, now, leaseSeconds, maxAttempts, List.of());
    }

    @Transactional
    public List<Claim> claim(
            String workerId, int requestedLimit, Instant now, long leaseSeconds, int maxAttempts,
            List<String> excludedIds) {
        int limit = Math.max(1, Math.min(requestedLimit, 250));
        int attempts = Math.max(1, maxAttempts);
        String databaseClock = databaseClockSql();
        jdbc.update("UPDATE " + OUTBOX
                        + " SET status='FAILED', last_error_code='RETRY_EXHAUSTED',"
                        + " lease_owner=NULL, lease_until=NULL, updated_at=:now"
                        + " WHERE attempt_count>=:maxAttempts AND"
                        + " ((status IN ('PENDING','RETRY_WAIT')) OR"
                        + " (status='CLAIMED' AND lease_until<=" + databaseClock + "))",
                new MapSqlParameterSource().addValue("now", Timestamp.from(now))
                        .addValue("maxAttempts", attempts));

        String lockingClause = isPostgres() ? " FOR UPDATE SKIP LOCKED" : "";
        String exclusionClause = excludedIds.isEmpty() ? "" : " AND id NOT IN (:excludedIds)";
        List<ClaimCandidate> candidates = jdbc.query(
                "SELECT id, device_id, attempt_count, lease_generation FROM " + OUTBOX
                        + " WHERE attempt_count<:maxAttempts AND"
                        + " ((status IN ('PENDING','RETRY_WAIT') AND next_attempt_at<=" + databaseClock + ")"
                        + " OR (status='CLAIMED' AND lease_until<=" + databaseClock + "))"
                        + exclusionClause
                        + " ORDER BY created_at,id LIMIT :limit" + lockingClause,
                new MapSqlParameterSource()
                        .addValue("maxAttempts", attempts)
                        .addValue("excludedIds", excludedIds)
                        .addValue("limit", limit),
                (rs, rowNumber) -> new ClaimCandidate(
                        rs.getString("id"), rs.getString("device_id"),
                        rs.getInt("attempt_count"), rs.getLong("lease_generation")));
        List<Claim> claimed = new ArrayList<>();
        for (ClaimCandidate candidate : candidates) {
            Instant leaseUntil = databaseNow().plusSeconds(Math.max(1, leaseSeconds))
                    .truncatedTo(ChronoUnit.MICROS);
            int changed = jdbc.update("UPDATE " + OUTBOX
                            + " SET status='CLAIMED', lease_owner=:workerId,"
                            + " lease_generation=lease_generation+1, lease_until=:leaseUntil,"
                            + " attempt_count=attempt_count+1, last_error_code=NULL, updated_at=:now"
                            + " WHERE id=:id AND attempt_count=:attemptCount"
                            + " AND lease_generation=:previousGeneration AND attempt_count<:maxAttempts"
                            + " AND ((status IN ('PENDING','RETRY_WAIT') AND next_attempt_at<=" + databaseClock + ")"
                            + " OR (status='CLAIMED' AND lease_until<=" + databaseClock + "))",
                    new MapSqlParameterSource()
                            .addValue("workerId", workerId)
                            .addValue("leaseUntil", Timestamp.from(leaseUntil))
                            .addValue("now", Timestamp.from(now))
                            .addValue("id", candidate.id())
                            .addValue("attemptCount", candidate.attemptCount())
                            .addValue("previousGeneration", candidate.leaseGeneration())
                            .addValue("maxAttempts", attempts));
            if (changed == 1) {
                claimed.add(new Claim(candidate.id(), candidate.deviceId(), workerId,
                        candidate.leaseGeneration() + 1, leaseUntil, candidate.attemptCount() + 1));
            }
        }
        return claimed;
    }

    @Transactional
    public Optional<DeliverySnapshot> loadForSend(Claim claim, Instant now) {
        String sql = """
                SELECT o.id AS outbox_id, o.recipient_user_id, o.lease_until,
                       d.id AS found_device_id, d.user_id AS device_user_id,
                       d.provider, d.platform, d.status AS device_status,
                       d.token_ciphertext, d.credential_version AS device_credential_version,
                       n.id AS found_notification_id, n.user_id AS notification_user_id,
                       u."id" AS found_user_id, u."status" AS user_status,
                       u."credentialVersion" AS user_credential_version
                FROM notifications.delivery_outbox o
                LEFT JOIN notifications.device_registration d ON d.id=o.device_id
                LEFT JOIN notifications.notification n ON n.id=o.notification_id
                LEFT JOIN campuscore_auth."User" u ON u."id"=o.recipient_user_id
                WHERE o.id=:id AND o.status='CLAIMED' AND o.lease_owner=:workerId
                  AND o.lease_generation=:generation AND o.lease_until=:leaseUntil
                  AND o.lease_until>
                """ + databaseClockSql();
        List<DeliverySnapshot> rows = jdbc.query(sql,
                claimParameters(claim),
                (rs, rowNumber) -> new DeliverySnapshot(
                        rs.getString("outbox_id"),
                        rs.getString("recipient_user_id"),
                        rs.getString("found_device_id"),
                        rs.getString("device_user_id"),
                        rs.getString("provider"),
                        rs.getString("platform"),
                        rs.getString("device_status"),
                        rs.getString("token_ciphertext"),
                        rs.getLong("device_credential_version"),
                        rs.getString("found_notification_id"),
                        rs.getString("notification_user_id"),
                        rs.getString("found_user_id"),
                        rs.getString("user_status"),
                        rs.getLong("user_credential_version")));
        if (rows.isEmpty()) {
            return Optional.empty();
        }
        DeliverySnapshot row = rows.getFirst();
        if (row.deviceId() == null || row.notificationId() == null || row.userId() == null
                || !row.recipientUserId().equals(row.deviceUserId())
                || !row.recipientUserId().equals(row.notificationUserId())
                || !"ACTIVE".equals(row.deviceStatus())
                || !"ACTIVE".equals(row.userStatus())
                || row.deviceCredentialVersion() != row.userCredentialVersion()) {
            mark(claim, "SUPPRESSED", "SUPPRESSED", now, null, null);
            return Optional.empty();
        }
        return Optional.of(row);
    }

    @Transactional
    public boolean acknowledgeSent(Claim claim, Instant now) {
        return mark(claim, "SENT", null, now, now, null);
    }

    @Transactional
    public boolean block(Claim claim, String reasonCode, Instant now) {
        return mark(claim, "BLOCKED", safeCode(reasonCode), now, null, null);
    }

    @Transactional
    public boolean fail(Claim claim, String errorCode, boolean retryable, Instant now, Instant nextAttemptAt) {
        boolean exhausted = claim.attemptCount()
                >= Math.max(1, Math.min(5, properties.getMaxAttempts()));
        String status = retryable && !exhausted ? "RETRY_WAIT" : "FAILED";
        String code = exhausted ? "RETRY_EXHAUSTED" : safeCode(errorCode);
        return mark(claim, status, code, now, null,
                "RETRY_WAIT".equals(status) ? nextAttemptAt : null);
    }

    public Optional<OutboxState> state(String id) {
        return jdbc.query("SELECT status,attempt_count,next_attempt_at,last_error_code,"
                        + "lease_owner,lease_generation,lease_until,sent_at FROM " + OUTBOX + " WHERE id=:id",
                new MapSqlParameterSource("id", id),
                (rs, rowNumber) -> new OutboxState(
                        rs.getString("status"),
                        rs.getInt("attempt_count"),
                        instant(rs.getTimestamp("next_attempt_at")),
                        rs.getString("last_error_code"),
                        rs.getString("lease_owner"),
                        rs.getLong("lease_generation"),
                        instant(rs.getTimestamp("lease_until")),
                        instant(rs.getTimestamp("sent_at"))))
                .stream().findFirst();
    }

    private boolean mark(
            Claim claim,
            String status,
            String errorCode,
            Instant now,
            Instant sentAt,
            Instant nextAttemptAt) {
        if (isPostgres() && !lockClaimedRow(claim)) {
            return false;
        }
        String nextAttemptAssignment = nextAttemptAt == null
                ? ""
                : ",next_attempt_at=:nextAttemptAt";
        MapSqlParameterSource parameters = claimParameters(claim)
                .addValue("status", status)
                .addValue("errorCode", errorCode)
                .addValue("now", Timestamp.from(now))
                .addValue("sentAt", sentAt == null ? null : Timestamp.from(sentAt));
        if (nextAttemptAt != null) {
            parameters.addValue("nextAttemptAt", Timestamp.from(nextAttemptAt));
        }
        return jdbc.update("UPDATE " + OUTBOX
                        + " SET status=:status,last_error_code=:errorCode,updated_at=:now,"
                        + " sent_at=:sentAt" + nextAttemptAssignment
                        + ",lease_owner=NULL,lease_until=NULL"
                        + " WHERE id=:id AND status='CLAIMED' AND lease_owner=:workerId"
                        + " AND lease_generation=:generation AND lease_until=:leaseUntil"
                        + " AND lease_until>" + databaseClockSql(),
                parameters) == 1;
    }

    private boolean lockClaimedRow(Claim claim) {
        return !jdbc.query("SELECT id FROM " + OUTBOX
                        + " WHERE id=:id AND status='CLAIMED' AND lease_owner=:workerId"
                        + " AND lease_generation=:generation AND lease_until=:leaseUntil FOR UPDATE",
                claimParameters(claim),
                (rs, rowNumber) -> rs.getString(1)).isEmpty();
    }

    private MapSqlParameterSource claimParameters(Claim claim) {
        return new MapSqlParameterSource()
                .addValue("id", claim.id())
                .addValue("workerId", claim.workerId())
                .addValue("generation", claim.generation())
                .addValue("leaseUntil", Timestamp.from(claim.leaseUntil()));
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

    private Instant databaseNow() {
        Timestamp timestamp = jdbc.getJdbcTemplate()
                .queryForObject("SELECT " + databaseClockSql(), Timestamp.class);
        if (timestamp == null) {
            throw new IllegalStateException("Database clock did not return a timestamp");
        }
        return timestamp.toInstant();
    }

    private String databaseClockSql() {
        return isPostgres() ? "clock_timestamp()" : "CURRENT_TIMESTAMP";
    }

    private static String safeCode(String value) {
        if (value == null || !value.matches("[A-Z0-9_]{1,48}")) {
            return "PROVIDER_ERROR";
        }
        return value;
    }

    private static Instant instant(Timestamp value) {
        return value == null ? null : value.toInstant();
    }

    public record Claim(
            String id,
            String deviceId,
            String workerId,
            long generation,
            Instant leaseUntil,
            int attemptCount) { }

    private record ClaimCandidate(String id, String deviceId, int attemptCount, long leaseGeneration) { }

    public record DeliverySnapshot(
            String outboxId,
            String recipientUserId,
            String deviceId,
            String deviceUserId,
            String provider,
            String platform,
            String deviceStatus,
            String tokenCiphertext,
            long deviceCredentialVersion,
            String notificationId,
            String notificationUserId,
            String userId,
            String userStatus,
            long userCredentialVersion) { }

    public record OutboxState(
            String status,
            int attemptCount,
            Instant nextAttemptAt,
            String lastErrorCode,
            String leaseOwner,
            long leaseGeneration,
            Instant leaseUntil,
            Instant sentAt) { }
}
