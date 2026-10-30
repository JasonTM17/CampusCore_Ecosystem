package io.campuscore.restfulapi.notification.push;

import io.campuscore.restfulapi.exception.AppException;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.HexFormat;
import javax.crypto.Cipher;
import javax.crypto.Mac;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

/** AES-GCM token storage and deterministic HMAC lookup fingerprint. */
@Component
public class PushTokenCryptography {

    private static final int KEY_BYTES = 32;
    private static final int NONCE_BYTES = 12;
    private static final int TAG_BITS = 128;
    private static final SecureRandom RANDOM = new SecureRandom();

    private final PushProperties properties;

    public PushTokenCryptography(PushProperties properties) {
        this.properties = properties;
    }

    public String encrypt(String token) {
        byte[] key = requireKey();
        byte[] nonce = new byte[NONCE_BYTES];
        RANDOM.nextBytes(nonce);
        try {
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, new SecretKeySpec(key, "AES"),
                    new GCMParameterSpec(TAG_BITS, nonce));
            byte[] ciphertext = cipher.doFinal(token.getBytes(StandardCharsets.UTF_8));
            return "v1:" + Base64.getUrlEncoder().withoutPadding()
                    .encodeToString(ByteBuffer.allocate(nonce.length + ciphertext.length)
                            .put(nonce).put(ciphertext).array());
        } catch (GeneralSecurityException exception) {
            throw new IllegalStateException("Push token encryption failed");
        }
    }

    public String decrypt(String encrypted) {
        byte[] key = requireKey();
        if (encrypted == null || !encrypted.startsWith("v1:")) {
            throw new IllegalStateException("Unsupported push token ciphertext");
        }
        try {
            byte[] packed = Base64.getUrlDecoder().decode(encrypted.substring(3));
            if (packed.length <= NONCE_BYTES) {
                throw new IllegalStateException("Invalid push token ciphertext");
            }
            ByteBuffer buffer = ByteBuffer.wrap(packed);
            byte[] nonce = new byte[NONCE_BYTES];
            buffer.get(nonce);
            byte[] ciphertext = new byte[buffer.remaining()];
            buffer.get(ciphertext);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, new SecretKeySpec(key, "AES"),
                    new GCMParameterSpec(TAG_BITS, nonce));
            return new String(cipher.doFinal(ciphertext), StandardCharsets.UTF_8);
        } catch (GeneralSecurityException | IllegalArgumentException exception) {
            throw new IllegalStateException("Push token decryption failed");
        }
    }

    public String fingerprint(String token) {
        byte[] key = requireKey();
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(key, "HmacSHA256"));
            return HexFormat.of().formatHex(mac.doFinal(token.getBytes(StandardCharsets.UTF_8)));
        } catch (GeneralSecurityException exception) {
            throw new IllegalStateException("Push token fingerprint failed");
        }
    }

    private byte[] requireKey() {
        String encoded = properties.getTokenKey();
        if (encoded == null || encoded.isBlank()) {
            throw notConfigured();
        }
        try {
            byte[] key = Base64.getDecoder().decode(encoded);
            if (key.length != KEY_BYTES) {
                throw notConfigured();
            }
            return key;
        } catch (IllegalArgumentException exception) {
            throw notConfigured();
        }
    }

    private static AppException notConfigured() {
        return new AppException(HttpStatus.SERVICE_UNAVAILABLE,
                "PUSH_NOT_CONFIGURED", "Push registration is not configured");
    }
}
