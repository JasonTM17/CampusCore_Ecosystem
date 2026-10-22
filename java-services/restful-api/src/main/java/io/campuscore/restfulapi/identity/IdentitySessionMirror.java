package io.campuscore.restfulapi.identity;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.sql.Timestamp;
import java.time.Instant;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Component;

/**
 * Mirrors OIDC grants into {@code campuscore_auth."Session"} on the
 * <b>primary</b> datasource so the unified session view (and
 * {@code hasRecentSessionFromIp}) covers every lane. Writes use fully
 * qualified names; the identity schema also lives behind the second pool
 * for SAS's fixed unqualified SQL.
 */
@Component
public class IdentitySessionMirror {

    private static final String SESSION_TABLE = "campuscore_auth.\"Session\"";

    private final NamedParameterJdbcTemplate jdbc;
    private final io.campuscore.restfulapi.security.ratelimit.ClientIpResolver clientIpResolver;

    public IdentitySessionMirror(NamedParameterJdbcTemplate jdbc,
            io.campuscore.restfulapi.security.ratelimit.ClientIpResolver clientIpResolver) {
        this.jdbc = jdbc;
        this.clientIpResolver = clientIpResolver;
    }

    /** Stable session row id for an OIDC authorization. */
    public static String sessionIdFor(String authorizationId) {
        return "oidc-" + authorizationId;
    }

    /** Same digest format the legacy lane writes into Session.refreshToken. */
    public static String sha256Hex(String value) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256")
                    .digest(value.getBytes(StandardCharsets.UTF_8));
            return java.util.HexFormat.of().formatHex(digest);
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException("SHA-256 is required", exception);
        }
    }

    /**
     * Upserts the OIDC-lane session for an authorization holding a refresh
     * token. {@code refreshToken} stores the token hash, matching the legacy
     * lane so replay lookups work across lanes.
     */
    public void upsertOidcSession(String userId, String authorizationId, String clientId,
            String refreshTokenValue, Instant expiresAt) {
        MapSqlParameterSource params = new MapSqlParameterSource()
                .addValue("id", sessionIdFor(authorizationId))
                .addValue("userId", userId)
                .addValue("refreshToken", sha256Hex(refreshTokenValue))
                .addValue("clientId", clientId)
                .addValue("authorizationId", authorizationId)
                .addValue("ipAddress", requestIp())
                .addValue("expiresAt", Timestamp.from(expiresAt));
        // Update-then-insert rather than ON CONFLICT: portable across Postgres
        // and the H2 test mirror. Concurrent saves of the same authorization
        // serialize on the account's User row lock held by the caller.
        int updated = jdbc.update(
                "UPDATE " + SESSION_TABLE
                        + " SET \"refreshToken\" = :refreshToken, \"expiresAt\" = :expiresAt,"
                        + " \"ipAddress\" = COALESCE(:ipAddress, \"ipAddress\"),"
                        + " \"rotatedAt\" = CURRENT_TIMESTAMP"
                        + " WHERE \"id\" = :id",
                params);
        if (updated == 0) {
            jdbc.update(
                    "INSERT INTO " + SESSION_TABLE
                            + " (\"id\", \"userId\", \"refreshToken\", \"ipAddress\", \"expiresAt\", \"createdAt\","
                            + " \"lane\", \"clientId\", \"authorizationId\")"
                            + " VALUES (:id, :userId, :refreshToken, :ipAddress, :expiresAt, CURRENT_TIMESTAMP,"
                            + " 'OIDC', :clientId, :authorizationId)",
                    params);
        }
    }

    /**
     * Remote address of the grant-carrying request, when one is bound to
     * this thread (authorize/token calls), resolved with the same
     * proxy-header trust rules as rate limiting so
     * {@code hasRecentSessionFromIp} covers the OIDC lane too.
     */
    private String requestIp() {
        var attrs = org.springframework.web.context.request.RequestContextHolder
                .getRequestAttributes();
        if (attrs instanceof org.springframework.web.context.request.ServletRequestAttributes servlet) {
            return clientIpResolver.resolve(servlet.getRequest());
        }
        return null;
    }

    /** Marks the mirrored session rotated when the grant has no refresh token. */
    public void markRotated(String authorizationId) {
        jdbc.update(
                "UPDATE " + SESSION_TABLE
                        + " SET \"rotatedAt\" = CURRENT_TIMESTAMP WHERE \"authorizationId\" = :authorizationId",
                new MapSqlParameterSource("authorizationId", authorizationId));
    }

    public void deleteByAuthorizationId(String authorizationId) {
        jdbc.update(
                "DELETE FROM " + SESSION_TABLE + " WHERE \"authorizationId\" = :authorizationId",
                new MapSqlParameterSource("authorizationId", authorizationId));
    }

    public int deleteOidcSessionsForClient(String userId, String clientId) {
        MapSqlParameterSource params = new MapSqlParameterSource()
                .addValue("userId", userId)
                .addValue("clientId", clientId);
        return jdbc.update(
                "DELETE FROM " + SESSION_TABLE
                        + " WHERE \"userId\" = :userId AND \"lane\" = 'OIDC' AND \"clientId\" = :clientId",
                params);
    }

    /**
     * Refresh-token lineage (identity-contract.md §2.3): every issued
     * refresh hash is recorded LIVE; when a different hash arrives for the
     * same authorization the prior LIVE hashes turn USED. A USED hash
     * presented at the token endpoint proves rotation-away → replay.
     */
    public void recordRefreshLineage(String authorizationId, String userId,
            String refreshTokenValue) {
        MapSqlParameterSource params = new MapSqlParameterSource()
                .addValue("authorizationId", authorizationId)
                .addValue("userId", userId)
                .addValue("hash", sha256Hex(refreshTokenValue));
        jdbc.update(
                "UPDATE campuscore_identity.oidc_refresh_lineage"
                        + " SET state = 'USED', used_at = CURRENT_TIMESTAMP"
                        + " WHERE authorization_id = :authorizationId"
                        + " AND state = 'LIVE' AND token_hash <> :hash",
                params);
        jdbc.update(
                "INSERT INTO campuscore_identity.oidc_refresh_lineage"
                        + " (token_hash, authorization_id, user_id, state)"
                        + " SELECT :hash, :authorizationId, :userId, 'LIVE'"
                        + " WHERE NOT EXISTS (SELECT 1 FROM"
                        + " campuscore_identity.oidc_refresh_lineage WHERE token_hash = :hash)",
                params);
    }

    /** LIVE → current grant; USED → rotated away (replay on re-present). */
    public String refreshLineageState(String refreshTokenValue) {
        String hash = sha256Hex(refreshTokenValue);
        var states = jdbc.query(
                "SELECT state FROM campuscore_identity.oidc_refresh_lineage"
                        + " WHERE token_hash = :hash",
                new MapSqlParameterSource("hash", hash),
                (rs, rowNum) -> rs.getString(1));
        return states.isEmpty() ? null : states.get(0);
    }

    public String refreshLineageUser(String refreshTokenValue) {
        String hash = sha256Hex(refreshTokenValue);
        var users = jdbc.query(
                "SELECT user_id FROM campuscore_identity.oidc_refresh_lineage"
                        + " WHERE token_hash = :hash",
                new MapSqlParameterSource("hash", hash),
                (rs, rowNum) -> rs.getString(1));
        return users.isEmpty() ? null : users.get(0);
    }

    /** Per-request lineage delete under revokeAccount's User lock. */
    public void deleteLineageForUser(String userId) {
        jdbc.update(
                "DELETE FROM campuscore_identity.oidc_refresh_lineage WHERE user_id = :userId",
                new MapSqlParameterSource("userId", userId));
    }
}
