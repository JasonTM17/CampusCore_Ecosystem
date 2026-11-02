package io.campuscore.restfulapi.identity;

import java.sql.Timestamp;
import java.time.Instant;

/** Shared encoding for the durable per-client BFF logout fence. */
public final class BffLogoutMarker {

    public static final String TX_ID = "$logout_pending$";
    public static final String SURFACE = "$logout_pending$";
    public static final String CLEARED_SURFACE = "$logout_clear$";
    /** Value written by the pre-epoch sentinel; read as epoch one for compatibility. */
    public static final String VERIFIER = "$logout_pending$";

    private static final Instant EXPIRES_AT = Instant.parse("9999-12-31T23:59:59Z");

    private BffLogoutMarker() {
    }

    /** Digest only; the table does not retain the user's or client's raw id. */
    public static String nonce(String userId, String clientId) {
        return IdentitySessionMirror.sha256Hex(
                "bff-logout-pending\n" + userId.length() + ":" + userId
                        + clientId.length() + ":" + clientId);
    }

    /** A missing fence is epoch zero. Legacy sentinel rows already represent epoch one. */
    public static long epoch(String stored) {
        if (stored == null) {
            return 0;
        }
        if (VERIFIER.equals(stored)) {
            return 1;
        }
        try {
            long epoch = Long.parseLong(stored);
            if (epoch < 0) {
                throw new IllegalStateException("logout fence epoch is negative");
            }
            return epoch;
        } catch (NumberFormatException exception) {
            throw new IllegalStateException("logout fence epoch is invalid", exception);
        }
    }

    public static long nextEpoch(String stored) {
        return Math.addExact(epoch(stored), 1);
    }

    public static String encodeEpoch(long epoch) {
        if (epoch < 1) {
            throw new IllegalArgumentException("logout fence epoch must be positive");
        }
        return Long.toString(epoch);
    }

    public static Timestamp expiresAt() {
        return Timestamp.from(EXPIRES_AT);
    }
}
