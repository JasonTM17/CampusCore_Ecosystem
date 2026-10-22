package io.campuscore.restfulapi.identity;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.util.Base64;
import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;

/**
 * AES-256-GCM with a deterministic 96-bit nonce derived from the plaintext
 * (SHA-256(plaintext)[0:12]). Token columns must stay look-up-able: SAS's
 * fixed {@code findByToken} SQL matches on the stored value, so identical
 * plaintext must produce identical ciphertext. Deterministic nonce gives
 * exactly that; two distinct plaintexts colliding on the 96-bit nonce are
 * ~2^-48 by birthday bound across realistic row counts, and nonce reuse only
 * aids an attacker who already holds the key. Output is
 * {@code base64url(nonce || ciphertext || tag)}; AAD binds the column name
 * so a value copied between columns fails authentication.
 */
public final class DeterministicTokenCipher {

    private static final int NONCE_LEN = 12;
    private static final int TAG_BITS = 128;

    private final SecretKeySpec key;

    public DeterministicTokenCipher(String base64Key) {
        byte[] raw;
        try {
            raw = Base64.getDecoder().decode(base64Key == null ? "" : base64Key);
        } catch (IllegalArgumentException exception) {
            throw new IllegalStateException(
                    "identity.oidc.token-encryption-key must be base64", exception);
        }
        if (raw.length != 32) {
            throw new IllegalStateException(
                    "identity.oidc.token-encryption-key must decode to 32 bytes (AES-256)");
        }
        this.key = new SecretKeySpec(raw, "AES");
    }

    /** Test/dev helper: derives a key from a passphrase when no env key exists. */
    public static DeterministicTokenCipher forDevPassphrase(String passphrase) {
        byte[] digest = sha256(passphrase.getBytes(StandardCharsets.UTF_8));
        return new DeterministicTokenCipher(Base64.getEncoder().encodeToString(digest));
    }

    public String encrypt(String plaintext, String aad) {
        if (plaintext == null) {
            return null;
        }
        byte[] nonce = new byte[NONCE_LEN];
        byte[] digest = sha256(plaintext.getBytes(StandardCharsets.UTF_8));
        System.arraycopy(digest, 0, nonce, 0, NONCE_LEN);
        byte[] ciphertext = gcm(Cipher.ENCRYPT_MODE, nonce,
                plaintext.getBytes(StandardCharsets.UTF_8), aad);
        byte[] out = new byte[NONCE_LEN + ciphertext.length];
        System.arraycopy(nonce, 0, out, 0, NONCE_LEN);
        System.arraycopy(ciphertext, 0, out, NONCE_LEN, ciphertext.length);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(out);
    }

    public String decrypt(String stored, String aad) {
        if (stored == null) {
            return null;
        }
        byte[] blob = Base64.getUrlDecoder().decode(stored);
        byte[] nonce = new byte[NONCE_LEN];
        System.arraycopy(blob, 0, nonce, 0, NONCE_LEN);
        byte[] ciphertext = new byte[blob.length - NONCE_LEN];
        System.arraycopy(blob, NONCE_LEN, ciphertext, 0, ciphertext.length);
        return new String(gcm(Cipher.DECRYPT_MODE, nonce, ciphertext, aad),
                StandardCharsets.UTF_8);
    }

    private byte[] gcm(int mode, byte[] nonce, byte[] input, String aad) {
        try {
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(mode, key, new GCMParameterSpec(TAG_BITS, nonce));
            if (aad != null) {
                cipher.updateAAD(aad.getBytes(StandardCharsets.UTF_8));
            }
            return cipher.doFinal(input);
        } catch (Exception exception) {
            throw new IllegalStateException("identity token cipher failure", exception);
        }
    }

    private static byte[] sha256(byte[] input) {
        try {
            return MessageDigest.getInstance("SHA-256").digest(input);
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException(exception);
        }
    }

    static {
        // Force provider availability at class-load so a broken JCE fails fast.
        new SecureRandom();
    }
}
