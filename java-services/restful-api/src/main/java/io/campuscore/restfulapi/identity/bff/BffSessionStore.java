package io.campuscore.restfulapi.identity.bff;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.Base64;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import io.campuscore.restfulapi.identity.BffLogoutMarker;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

/**
 * JDBC store for the BFF tables (host-policy §3). Uses the PRIMARY
 * NamedParameterJdbcTemplate with schema-qualified names so every write
 * joins the caller's transaction — the User row lock serializes session
 * create/revoke against UnifiedSessionAuthority exactly like the OIDC
 * mirror. Opaque cookie values and CSRF secrets are stored only as
 * sha256 digests; the PKCE verifier and session-bound CSRF secret are
 * recoverable AES-GCM ciphertext produced by DeterministicTokenCipher.
 */
@ConditionalOnProperty(prefix = "identity.bff", name = "enabled", havingValue = "true")
@Component
public class BffSessionStore {

    private static final SecureRandom RANDOM = new SecureRandom();
    private static final String SESSION = "campuscore_identity.bff_session";
    private static final String TX = "campuscore_identity.bff_transaction";

    private final NamedParameterJdbcTemplate jdbc;

    public BffSessionStore(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public static String randomId(int bytes) {
        byte[] raw = new byte[bytes];
        RANDOM.nextBytes(raw);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(raw);
    }

    public static String sha256Hex(String value) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            return HexFormat.of().formatHex(
                    digest.digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException(exception);
        }
    }

    // ---- bff_transaction -------------------------------------------------

    public record Transaction(String stateHash, String txId, String surface,
            String nonce, String verifierCiphertext, String returnPath,
            Instant expiresAt) {
    }

    private record LogoutFence(String stateHash, String surface, String verifier) {
    }

    public void insertTransaction(String state, String txId, String surface,
            String nonce, String verifierCiphertext, String returnPath,
            Instant expiresAt) {
        jdbc.update("INSERT INTO " + TX + " (state_hash, tx_id, surface, nonce,"
                        + " verifier, return_path, expires_at)"
                        + " VALUES (:h, :tx, :s, :n, :v, :r, :e)",
                new MapSqlParameterSource()
                        .addValue("h", sha256Hex(state))
                        .addValue("tx", txId)
                        .addValue("s", surface)
                        .addValue("n", nonce)
                        .addValue("v", verifierCiphertext)
                        .addValue("r", returnPath)
                        .addValue("e", Timestamp.from(expiresAt)));
    }

    /**
     * Persists a client-scoped pending fence and advances its epoch. The
     * reserved tx id cannot be generated for a login transaction; the random
     * state hash is unrelated to callback state, and nonce holds only a digest.
     * Call under the User row lock so concurrent logout requests serialize.
     */
    public void markClientLogoutPending(String userId, String clientId) {
        LogoutFence fence = lockLogoutFence(userId, clientId);
        if (fence == null) {
            insertLogoutFence(userId, clientId, BffLogoutMarker.SURFACE, 1);
        } else {
            updateLogoutFence(fence, BffLogoutMarker.SURFACE,
                    BffLogoutMarker.nextEpoch(fence.verifier()));
        }
    }

    public boolean isClientLogoutPending(String userId, String clientId) {
        LogoutFence fence = readLogoutFence(userId, clientId, false);
        return fence != null && BffLogoutMarker.SURFACE.equals(fence.surface());
    }

    /** Epoch retained after accepted end-session so an older grant save stays stale. */
    public long clientLogoutEpoch(String userId, String clientId) {
        LogoutFence fence = readLogoutFence(userId, clientId, false);
        return fence == null ? 0 : BffLogoutMarker.epoch(fence.verifier());
    }

    private LogoutFence lockLogoutFence(String userId, String clientId) {
        return readLogoutFence(userId, clientId, true);
    }

    private LogoutFence readLogoutFence(String userId, String clientId, boolean lock) {
        List<LogoutFence> rows = jdbc.query(
                "SELECT state_hash, surface, verifier FROM " + TX
                        + " WHERE tx_id = :tx AND nonce = :nonce"
                        + (lock ? " FOR UPDATE" : ""),
                logoutMarkerParams(userId, clientId),
                (rs, i) -> new LogoutFence(rs.getString("state_hash"),
                        rs.getString("surface"), rs.getString("verifier")));
        return rows.isEmpty() ? null : rows.get(0);
    }

    private void insertLogoutFence(String userId, String clientId,
            String surface, long epoch) {
        insertTransaction(randomId(32), BffLogoutMarker.TX_ID, surface,
                BffLogoutMarker.nonce(userId, clientId),
                BffLogoutMarker.encodeEpoch(epoch), "/",
                BffLogoutMarker.expiresAt().toInstant());
    }

    private void updateLogoutFence(LogoutFence fence, String surface, long epoch) {
        jdbc.update("UPDATE " + TX
                        + " SET surface = :surface, verifier = :verifier, expires_at = :expiresAt"
                        + " WHERE state_hash = :stateHash",
                new MapSqlParameterSource()
                        .addValue("surface", surface)
                        .addValue("verifier", BffLogoutMarker.encodeEpoch(epoch))
                        .addValue("expiresAt", BffLogoutMarker.expiresAt())
                        .addValue("stateHash", fence.stateHash()));
    }

    private static MapSqlParameterSource logoutMarkerParams(String userId, String clientId) {
        return new MapSqlParameterSource()
                .addValue("tx", BffLogoutMarker.TX_ID)
                .addValue("nonce", BffLogoutMarker.nonce(userId, clientId));
    }

    /**
     * Atomic one-time consume (KM-L14): the FOR UPDATE lock serializes
     * concurrent callbacks — the loser re-reads an empty set — and the row
     * exists at most once, so a replayed state can never complete a second
     * login leg. Portable across H2 and Postgres (no RETURNING clause).
     */
    public Transaction consumeTransaction(String state) {
        List<Transaction> rows = jdbc.query(
                "SELECT state_hash, tx_id, surface, nonce, verifier,"
                        + " return_path, expires_at FROM " + TX
                        + " WHERE state_hash = :h AND tx_id <> :markerTx FOR UPDATE",
                new MapSqlParameterSource()
                        .addValue("h", sha256Hex(state))
                        .addValue("markerTx", BffLogoutMarker.TX_ID),
                (rs, i) -> new Transaction(rs.getString("state_hash"),
                        rs.getString("tx_id"), rs.getString("surface"),
                        rs.getString("nonce"), rs.getString("verifier"),
                        rs.getString("return_path"),
                        rs.getTimestamp("expires_at").toInstant()));
        if (rows.isEmpty()) {
            return null;
        }
        jdbc.update("DELETE FROM " + TX
                        + " WHERE state_hash = :h AND tx_id <> :markerTx",
                new MapSqlParameterSource()
                        .addValue("h", rows.get(0).stateHash())
                        .addValue("markerTx", BffLogoutMarker.TX_ID));
        return rows.get(0);
    }

    // ---- bff_session -----------------------------------------------------

    public record Session(String id, String userId, String surface,
            String clientId, String authorizationId, String csrfCiphertext,
            Instant expiresAt, Instant revokedAt) {
    }

    public void insertSession(String opaqueValue, String userId, String surface,
            String clientId, String authorizationId, String csrfCiphertext, String ip,
            String userAgent, Instant expiresAt) {
        jdbc.update("INSERT INTO " + SESSION + " (id, user_id, surface, client_id,"
                        + " authorization_id, csrf_ciphertext, ip, user_agent,"
                        + " expires_at) VALUES (:id, :u, :s, :cl, :a, :c, :ip, :ua, :e)",
                new MapSqlParameterSource()
                        .addValue("id", sha256Hex(opaqueValue))
                        .addValue("u", userId)
                        .addValue("s", surface)
                        .addValue("cl", clientId)
                        .addValue("a", authorizationId)
                        .addValue("c", csrfCiphertext)
                        .addValue("ip", ip)
                        .addValue("ua", userAgent)
                        .addValue("e", Timestamp.from(expiresAt)));
    }

    /**
     * Surface binding is part of the lookup key (cookie tossing defense): a
     * session minted for 'learn' never resolves on the 'portal' surface.
     */
    public Session findSession(String opaqueValue, String surface) {
        List<Session> rows = jdbc.query(
                "SELECT id, user_id, surface, client_id, authorization_id,"
                        + " csrf_ciphertext, expires_at, revoked_at FROM " + SESSION
                        + " WHERE id = :id AND surface = :s",
                new MapSqlParameterSource()
                        .addValue("id", sha256Hex(opaqueValue))
                        .addValue("s", surface),
                (rs, i) -> new Session(rs.getString("id"), rs.getString("user_id"),
                        rs.getString("surface"), rs.getString("client_id"),
                        rs.getString("authorization_id"),
                        rs.getString("csrf_ciphertext"),
                        rs.getTimestamp("expires_at").toInstant(),
                        rs.getTimestamp("revoked_at") == null ? null
                                : rs.getTimestamp("revoked_at").toInstant()));
        return rows.isEmpty() ? null : rows.get(0);
    }

    /**
     * Single-flight row lock (KM-H1): concurrent /bff/api calls on one
     * session serialize here so only the lock holder ever presents the
     * session's refresh token to SAS — parallel requests can never
     * double-submit it and trigger a false replay revocation.
     */
    public Session lockSession(String opaqueValue, String surface) {
        List<Session> rows = jdbc.query(
                "SELECT id, user_id, surface, client_id, authorization_id,"
                        + " csrf_ciphertext, expires_at, revoked_at FROM " + SESSION
                        + " WHERE id = :id AND surface = :s FOR UPDATE",
                new MapSqlParameterSource()
                        .addValue("id", sha256Hex(opaqueValue))
                        .addValue("s", surface),
                (rs, i) -> new Session(rs.getString("id"), rs.getString("user_id"),
                        rs.getString("surface"), rs.getString("client_id"),
                        rs.getString("authorization_id"),
                        rs.getString("csrf_ciphertext"),
                        rs.getTimestamp("expires_at").toInstant(),
                        rs.getTimestamp("revoked_at") == null ? null
                                : rs.getTimestamp("revoked_at").toInstant()));
        return rows.isEmpty() ? null : rows.get(0);
    }

    public void touch(String sessionId) {
        jdbc.update("UPDATE " + SESSION + " SET last_seen_at = CURRENT_TIMESTAMP"
                        + " WHERE id = :id",
                new MapSqlParameterSource("id", sessionId));
    }

    public int revokeSession(String opaqueValue, String surface) {
        return jdbc.update("UPDATE " + SESSION + " SET revoked_at = CURRENT_TIMESTAMP"
                        + " WHERE id = :id AND surface = :s AND revoked_at IS NULL",
                new MapSqlParameterSource()
                        .addValue("id", sha256Hex(opaqueValue))
                        .addValue("s", surface));
    }

    public int deleteSessionsForUser(String userId) {
        return jdbc.update("DELETE FROM " + SESSION + " WHERE user_id = :u",
                new MapSqlParameterSource("u", userId));
    }

    /**
     * Per-client sweep for the logout bridge: every session bound to grants
     * issued to this client id. client_id is denormalized on the session row
     * precisely so this works after the grant rows are already deleted.
     */
    public int deleteSessionsForClient(String userId, String clientId) {
        return jdbc.update("DELETE FROM " + SESSION
                        + " WHERE user_id = :u AND client_id = :c",
                new MapSqlParameterSource()
                        .addValue("u", userId)
                        .addValue("c", clientId));
    }

    /** Expired or long-revoked session cleanup for the retention sweep. */
    public int purgeSessions(Instant graceCutoff) {
        return jdbc.update("DELETE FROM " + SESSION
                        + " WHERE expires_at < :now OR revoked_at < :grace",
                new MapSqlParameterSource()
                        .addValue("now", Timestamp.from(Instant.now()))
                        .addValue("grace", Timestamp.from(graceCutoff)));
    }

    /** Abandoned authorize-leg cleanup. */
    public int purgeTransactions() {
        return jdbc.update("DELETE FROM " + TX
                        + " WHERE expires_at < :now AND tx_id <> :markerTx",
                new MapSqlParameterSource()
                        .addValue("now", Timestamp.from(Instant.now()))
                        .addValue("markerTx", BffLogoutMarker.TX_ID));
    }
}
