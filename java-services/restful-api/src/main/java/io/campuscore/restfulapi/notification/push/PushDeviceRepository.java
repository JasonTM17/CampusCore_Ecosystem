package io.campuscore.restfulapi.notification.push;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.TreeSet;
import org.springframework.context.annotation.Profile;
import org.springframework.dao.EmptyResultDataAccessException;
import org.springframework.jdbc.core.ConnectionCallback;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

/** Owner-scoped registration persistence, including R23 token rebind fencing. */
@Repository
@Profile("persistence")
public class PushDeviceRepository {

    private static final String TABLE = "notifications.device_registration";
    private static final RowMapper<RegistrationRow> ROW_MAPPER = PushDeviceRepository::mapRegistration;

    private final NamedParameterJdbcTemplate jdbc;
    private volatile Boolean postgres;

    public PushDeviceRepository(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Transactional
    public RegistrationMutation register(
            String userId,
            String installationId,
            String provider,
            String platform,
            String ciphertext,
            String fingerprint,
            Instant now) {
        long credentialVersion = currentCredentialVersion(userId);
        lockRegistrationKeys(userId, installationId, provider, fingerprint);

        RegistrationRow tokenOwner = findByFingerprint(provider, fingerprint).orElse(null);
        RegistrationRow installation = findByInstallation(userId, installationId).orElse(null);
        RegistrationRow foreignInstallation = findForeignInstallation(userId, installationId).orElse(null);
        if (foreignInstallation != null
                && (tokenOwner == null || !foreignInstallation.id().equals(tokenOwner.id()))) {
            throw new io.campuscore.restfulapi.exception.AppException(
                    org.springframework.http.HttpStatus.NOT_FOUND, "NOT_FOUND", "Device not found");
        }

        if (tokenOwner != null) {
            if (tokenOwner.userId().equals(userId)
                    && tokenOwner.installationId().equals(installationId)
                    && tokenOwner.platform().equals(platform)
                    && tokenOwner.status().equals("ACTIVE")
                    && tokenOwner.credentialVersion() == credentialVersion) {
                return new RegistrationMutation(tokenOwner.id(), tokenOwner.provider(),
                        tokenOwner.platform(), tokenOwner.status(), tokenOwner.updatedAt(), null);
            }
            if (installation != null && !installation.id().equals(tokenOwner.id())) {
                jdbc.update("DELETE FROM " + TABLE + " WHERE id=:id AND user_id=:userId",
                        new MapSqlParameterSource().addValue("id", installation.id())
                                .addValue("userId", userId));
            }
            jdbc.update("UPDATE " + TABLE
                            + " SET user_id=:userId, installation_id=:installationId, provider=:provider,"
                            + " platform=:platform, token_ciphertext=:ciphertext, token_fingerprint=:fingerprint,"
                            + " credential_version=:credentialVersion, status='ACTIVE', revoked_at=NULL, updated_at=:now"
                            + " WHERE id=:id",
                    new MapSqlParameterSource()
                            .addValue("userId", userId)
                            .addValue("installationId", installationId)
                            .addValue("provider", provider)
                            .addValue("platform", platform)
                            .addValue("ciphertext", ciphertext)
                            .addValue("fingerprint", fingerprint)
                            .addValue("credentialVersion", credentialVersion)
                            .addValue("now", Timestamp.from(now))
                            .addValue("id", tokenOwner.id()));
            String previousOwner = tokenOwner.userId().equals(userId) ? null : tokenOwner.userId();
            return new RegistrationMutation(
                    tokenOwner.id(), provider, platform, "ACTIVE", now, previousOwner);
        }

        if (installation != null) {
            jdbc.update("UPDATE " + TABLE
                            + " SET provider=:provider, platform=:platform, token_ciphertext=:ciphertext,"
                            + " token_fingerprint=:fingerprint, credential_version=:credentialVersion,"
                            + " status='ACTIVE', revoked_at=NULL, updated_at=:now WHERE id=:id",
                    new MapSqlParameterSource()
                            .addValue("provider", provider)
                            .addValue("platform", platform)
                            .addValue("ciphertext", ciphertext)
                            .addValue("fingerprint", fingerprint)
                            .addValue("credentialVersion", credentialVersion)
                            .addValue("now", Timestamp.from(now))
                            .addValue("id", installation.id()));
            return new RegistrationMutation(
                    installation.id(), provider, platform, "ACTIVE", now, null);
        }

        String id = java.util.UUID.randomUUID().toString();
        jdbc.update("INSERT INTO " + TABLE
                        + " (id,user_id,installation_id,provider,platform,token_ciphertext,token_fingerprint,"
                        + " credential_version,status,created_at,updated_at)"
                        + " VALUES (:id,:userId,:installationId,:provider,:platform,:ciphertext,:fingerprint,"
                        + " :credentialVersion,'ACTIVE',:now,:now)",
                new MapSqlParameterSource()
                        .addValue("id", id)
                        .addValue("userId", userId)
                        .addValue("installationId", installationId)
                        .addValue("provider", provider)
                        .addValue("platform", platform)
                        .addValue("ciphertext", ciphertext)
                        .addValue("fingerprint", fingerprint)
                        .addValue("credentialVersion", credentialVersion)
                        .addValue("now", Timestamp.from(now)));
        return new RegistrationMutation(id, provider, platform, "ACTIVE", now, null);
    }

    @Transactional
    public boolean revoke(String userId, String installationId, Instant now) {
        RegistrationRow owned = findByInstallation(userId, installationId).orElse(null);
        if (owned == null) {
            Integer foreign = jdbc.queryForObject(
                    "SELECT COUNT(*) FROM " + TABLE
                            + " WHERE installation_id=:installationId AND user_id<>:userId",
                    new MapSqlParameterSource().addValue("installationId", installationId)
                            .addValue("userId", userId),
                    Integer.class);
            if (foreign != null && foreign > 0) {
                throw new io.campuscore.restfulapi.exception.AppException(
                        org.springframework.http.HttpStatus.NOT_FOUND, "NOT_FOUND", "Device not found");
            }
            return false;
        }
        jdbc.update("UPDATE " + TABLE
                        + " SET status='REVOKED', revoked_at=COALESCE(revoked_at,:now), updated_at=:now"
                        + " WHERE id=:id AND user_id=:userId",
                new MapSqlParameterSource().addValue("now", Timestamp.from(now))
                        .addValue("id", owned.id()).addValue("userId", userId));
        return true;
    }

    private long currentCredentialVersion(String userId) {
        try {
            return jdbc.queryForObject(
                    "SELECT \"credentialVersion\" FROM campuscore_auth.\"User\" WHERE \"id\"=:userId",
                    new MapSqlParameterSource("userId", userId), Long.class);
        } catch (EmptyResultDataAccessException missing) {
            throw new io.campuscore.restfulapi.exception.AppException(
                    org.springframework.http.HttpStatus.NOT_FOUND, "NOT_FOUND", "Account not found");
        }
    }

    private Optional<RegistrationRow> findByFingerprint(String provider, String fingerprint) {
        return jdbc.query("SELECT * FROM " + TABLE
                        + " WHERE provider=:provider AND token_fingerprint=:fingerprint FOR UPDATE",
                        new MapSqlParameterSource().addValue("provider", provider)
                                .addValue("fingerprint", fingerprint), ROW_MAPPER)
                .stream().findFirst();
    }

    private Optional<RegistrationRow> findByInstallation(String userId, String installationId) {
        return jdbc.query("SELECT * FROM " + TABLE
                        + " WHERE user_id=:userId AND installation_id=:installationId FOR UPDATE",
                        new MapSqlParameterSource().addValue("userId", userId)
                                .addValue("installationId", installationId), ROW_MAPPER)
                .stream().findFirst();
    }

    private Optional<RegistrationRow> findForeignInstallation(String userId, String installationId) {
        return jdbc.query("SELECT * FROM " + TABLE
                        + " WHERE installation_id=:installationId AND user_id<>:userId FOR UPDATE",
                        new MapSqlParameterSource().addValue("userId", userId)
                                .addValue("installationId", installationId), ROW_MAPPER)
                .stream().findFirst();
    }

    private void lockRegistrationKeys(
            String userId, String installationId, String provider, String fingerprint) {
        if (!isPostgres()) {
            return;
        }
        List<String> keys = new TreeSet<>(List.of(
                "push-install-id:" + installationId,
                "push-install:" + userId + ":" + installationId,
                "push-token:" + provider + ":" + fingerprint)).stream().toList();
        for (String key : keys) {
            jdbc.query("SELECT pg_advisory_xact_lock(hashtextextended(:lockKey, 0))",
                    new MapSqlParameterSource("lockKey", key),
                    (resultSet, rowNumber) -> resultSet.getObject(1));
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
                        (ConnectionCallback<Boolean>) connection ->
                                connection.getMetaData().getDatabaseProductName()
                                        .equalsIgnoreCase("PostgreSQL")));
            }
            return postgres;
        }
    }

    private static RegistrationRow mapRegistration(ResultSet rs, int rowNumber) throws SQLException {
        return new RegistrationRow(
                rs.getString("id"),
                rs.getString("user_id"),
                rs.getString("installation_id"),
                rs.getString("provider"),
                rs.getString("platform"),
                rs.getString("token_ciphertext"),
                rs.getString("token_fingerprint"),
                rs.getLong("credential_version"),
                rs.getString("status"),
                instant(rs.getTimestamp("created_at")),
                instant(rs.getTimestamp("updated_at")),
                instant(rs.getTimestamp("revoked_at")));
    }

    private static Instant instant(Timestamp timestamp) {
        return timestamp == null ? null : timestamp.toInstant();
    }

    public record RegistrationMutation(
            String deviceId,
            String provider,
            String platform,
            String status,
            Instant updatedAt,
            String previousOwnerId) { }

    public record RegistrationRow(
            String id,
            String userId,
            String installationId,
            String provider,
            String platform,
            String tokenCiphertext,
            String tokenFingerprint,
            long credentialVersion,
            String status,
            Instant createdAt,
            Instant updatedAt,
            Instant revokedAt) { }
}
