package io.campuscore.restfulapi.identity;

import io.campuscore.restfulapi.auth.repository.AuthUserRepository;
import java.time.Instant;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.annotation.Profile;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * One revocation authority across lanes (docs/ecosystem/identity-contract.md
 * §2.3). Lock order: User → Session → oauth2_authorization. Every mutation
 * runs on the primary datasource inside one transaction — the identity
 * schema is reached through fully qualified names, so revokeAccount is
 * atomic across lanes and cannot half-revoke.
 */
@Component
@Profile("persistence")
public class UnifiedSessionAuthority {

    private static final Logger log = LoggerFactory.getLogger(UnifiedSessionAuthority.class);
    private static final String AUTHZ_TABLE = "campuscore_identity.oauth2_authorization";
    private static final String AUDIT_TABLE = "campuscore_identity.logout_audit";
    private static final String SESSION_TABLE = "campuscore_auth.\"Session\"";

    private final AuthUserRepository users;
    private final NamedParameterJdbcTemplate jdbc;
    private final IdentitySessionMirror mirror;

    public UnifiedSessionAuthority(AuthUserRepository users, NamedParameterJdbcTemplate jdbc,
            IdentitySessionMirror mirror) {
        this.users = users;
        this.jdbc = jdbc;
        this.mirror = mirror;
    }

    /**
     * Replay/compromise semantics: every live session of the account dies in
     * every lane, plus a credential-version bump so already-issued access
     * tokens stop passing the current-account gate. Callers that already
     * hold the User row lock (legacy refresh replay) enter re-entrantly —
     * Postgres row locks are held by the transaction, not the statement.
     */
    @Transactional
    public void revokeAccount(String userId, String lane, String reason, String requestId) {
        users.lockUserRow(userId);
        int sessions = countSessions(userId);
        users.deleteAllRefreshSessions(userId);
        mirror.deleteLineageForUser(userId);
        int grants = jdbc.update(
                "DELETE FROM " + AUTHZ_TABLE + " WHERE principal_name = :userId",
                new MapSqlParameterSource("userId", userId));
        deleteBffSessions(userId, null);
        users.bumpCredentialVersion(userId);
        users.clearUserRefreshToken(userId);
        insertAudit(userId, lane, reason, requestId);
        log.info("UNIFIED_SESSION_REVOKE user={} lane={} reason={} sessions={} grants={}",
                userId, lane, reason, sessions, grants);
    }

    /**
     * Session+grant kill without the credential bump — for callers whose own
     * write path already bumps the credential revision (changePassword,
     * resetPassword, admin mutation, 2FA change). Still runs under the
     * caller's User lock and still deletes every lane, so a credential event
     * never leaves an OIDC refresh grant alive.
     */
    @Transactional
    public void revokeGrants(String userId, String lane, String reason, String requestId) {
        users.lockUserRow(userId);
        users.deleteAllRefreshSessions(userId);
        mirror.deleteLineageForUser(userId);
        jdbc.update(
                "DELETE FROM " + AUTHZ_TABLE + " WHERE principal_name = :userId",
                new MapSqlParameterSource("userId", userId));
        deleteBffSessions(userId, null);
        insertAudit(userId, lane, reason, requestId);
    }

    /**
     * Keep-one-session variant (2FA enable/disable): every session except
     * the pinned row dies, and so does the whole OIDC grant set — a grant
     * is never the caller's kept row.
     */
    @Transactional
    public void revokeOtherGrants(String userId, String keepSessionId, String lane,
            String reason, String requestId) {
        users.lockUserRow(userId);
        users.deleteOtherRefreshSessions(userId, keepSessionId);
        mirror.deleteLineageForUser(userId);
        jdbc.update(
                "DELETE FROM " + AUTHZ_TABLE + " WHERE principal_name = :userId",
                new MapSqlParameterSource("userId", userId));
        deleteBffSessions(userId, null);
        insertAudit(userId, lane, reason, requestId);
    }

    /**
     * Per-client OIDC logout: only that client's grants and mirrored
     * sessions die. Account-wide logout stays the business logout path /
     * P05 sibling queue.
     */
    @Transactional
    public int revokeClientGrants(String userId, String clientId, String reason, String requestId) {
        users.lockUserRow(userId);
        MapSqlParameterSource params = new MapSqlParameterSource()
                .addValue("userId", userId)
                .addValue("clientId", clientId);
        int bffSessions = deleteBffSessions(userId, clientId);
        int grants = jdbc.update(
                "DELETE FROM " + AUTHZ_TABLE
                        + " WHERE principal_name = :userId AND registered_client_id = :clientId",
                params);
        int sessions = mirror.deleteOidcSessionsForClient(userId, clientId);
        insertAudit(userId, "OIDC", reason, requestId);
        log.info("UNIFIED_SESSION_CLIENT_REVOKE user={} client={} reason={} sessions={} grants={} bffSessions={}",
                userId, clientId, reason, sessions, grants, bffSessions);
        return grants;
    }

    /**
     * bff_session rows die with their lane: account-wide deletes sweep every
     * surface; per-client deletes only the client-scoped rows. client_id is
     * denormalized on the session row so this stays correct even after the
     * grant rows are already gone (host-policy §3, KM-M4).
     */
    private int deleteBffSessions(String userId, String clientId) {
        if (clientId == null) {
            return jdbc.update(
                    "DELETE FROM campuscore_identity.bff_session WHERE user_id = :userId",
                    new MapSqlParameterSource("userId", userId));
        }
        return jdbc.update(
                "DELETE FROM campuscore_identity.bff_session"
                        + " WHERE user_id = :userId AND client_id = :clientId",
                new MapSqlParameterSource()
                        .addValue("userId", userId)
                        .addValue("clientId", clientId));
    }

    /**
     * One row per revoke event. The audit id is server-generated — a
     * client-supplied request id must never be the dedupe key, or replaying
     * one request id across distinct events would collapse audit rows and
     * let an attacker hide later revokes. {@code requestId} stays as a
     * correlation column only.
     */
    private void insertAudit(String userId, String lane, String reason, String requestId) {
        String auditId = IdentitySessionMirror.sha256Hex(
                userId + "|" + lane + "|" + reason + "|" + java.util.UUID.randomUUID())
                .substring(0, 48);
        MapSqlParameterSource params = new MapSqlParameterSource()
                .addValue("id", auditId)
                .addValue("userId", userId)
                .addValue("lane", lane)
                .addValue("reason", reason)
                .addValue("requestId", requestId)
                .addValue("createdAt", java.sql.Timestamp.from(Instant.now()));
        jdbc.update(
                "INSERT INTO " + AUDIT_TABLE
                        + " (id, user_id, lane, reason, request_id, created_at)"
                        + " VALUES (:id, :userId, :lane, :reason, :requestId, :createdAt)",
                params);
    }

    private int countSessions(String userId) {
        Integer count = jdbc.queryForObject(
                "SELECT COUNT(*) FROM " + SESSION_TABLE + " WHERE \"userId\" = :userId",
                new MapSqlParameterSource("userId", userId), Integer.class);
        return count == null ? 0 : count;
    }
}
