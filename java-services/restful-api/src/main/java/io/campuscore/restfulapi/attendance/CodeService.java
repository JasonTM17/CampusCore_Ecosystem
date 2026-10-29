package io.campuscore.restfulapi.attendance;

import io.campuscore.restfulapi.identity.DeterministicTokenCipher;
import io.campuscore.restfulapi.web.DomainException;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Instant;
import java.util.Base64;
import java.util.Locale;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

@Service
public class CodeService {
    public static final int STEP_SECONDS = 30;
    private final Clock clock;
    private final AttendanceCheckinProperties properties;
    private final SecureRandom random = new SecureRandom();
    public CodeService(@Qualifier("attendanceClock") Clock clock, AttendanceCheckinProperties properties) {
        this.clock = clock; this.properties = properties;
    }
    public String newSecret(String sessionId) {
        byte[] value = new byte[32]; random.nextBytes(value);
        return cipher().encrypt(Base64.getEncoder().encodeToString(value), "attendance:" + sessionId);
    }
    public String current(String sessionId, String ciphertext) {
        return atStep(sessionId, ciphertext, clock.instant().getEpochSecond() / STEP_SECONDS);
    }
    public Instant expiresAt() {
        return Instant.ofEpochSecond((clock.instant().getEpochSecond() / STEP_SECONDS + 1) * STEP_SECONDS);
    }
    public boolean accepts(String sessionId, String ciphertext, String supplied) {
        long step = clock.instant().getEpochSecond() / STEP_SECONDS;
        byte[] candidate = (supplied != null && supplied.matches("[0-9]{6}") ? supplied : "!!!!!!")
                .getBytes(StandardCharsets.US_ASCII);
        // Evaluate both comparisons, even when the first matches.
        return MessageDigest.isEqual(candidate, atStep(sessionId, ciphertext, step).getBytes(StandardCharsets.US_ASCII))
                | MessageDigest.isEqual(candidate, atStep(sessionId, ciphertext, step - 1).getBytes(StandardCharsets.US_ASCII));
    }
    private String atStep(String sessionId, String ciphertext, long step) {
        byte[] key = Base64.getDecoder().decode(cipher().decrypt(ciphertext, "attendance:" + sessionId));
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(key, "HmacSHA256"));
            byte[] digest = mac.doFinal(ByteBuffer.allocate(8).putLong(step).array());
            int offset = digest[digest.length - 1] & 15;
            int truncated = ByteBuffer.wrap(digest, offset, 4).getInt() & 0x7fffffff;
            return String.format(Locale.ROOT, "%06d", truncated % 1_000_000);
        } catch (java.security.GeneralSecurityException failure) {
            throw new IllegalStateException("Attendance code provider unavailable");
        }
    }
    private DeterministicTokenCipher cipher() {
        try { return new DeterministicTokenCipher(properties.getEncryptionKey()); }
        catch (IllegalStateException failure) {
            throw new DomainException(HttpStatus.SERVICE_UNAVAILABLE, "CHECKIN_NOT_CONFIGURED", "Attendance encryption is not configured");
        }
    }
}
