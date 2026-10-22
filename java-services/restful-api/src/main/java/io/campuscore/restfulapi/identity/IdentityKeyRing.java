package io.campuscore.restfulapi.identity;

import com.nimbusds.jose.jwk.JWKSet;
import com.nimbusds.jose.jwk.RSAKey;
import com.nimbusds.jose.jwk.source.ImmutableJWKSet;
import com.nimbusds.jose.jwk.source.JWKSource;
import com.nimbusds.jose.proc.SecurityContext;
import java.security.KeyFactory;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.interfaces.RSAPrivateKey;
import java.security.interfaces.RSAPublicKey;
import java.security.spec.PKCS8EncodedKeySpec;
import java.security.spec.X509EncodedKeySpec;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;

/**
 * Asymmetric signing ring (identity-contract.md §2.1). Keys come from env
 * PEM material — never repo/DB. The active key is placed first so the
 * Nimbus encoder selects it for signing; the JWKS endpoint exposes the
 * whole public ring, which is what makes rollover overlap work.
 */
public final class IdentityKeyRing {

    private IdentityKeyRing() {
    }

    public static JWKSource<SecurityContext> jwkSource(IdentityProperties properties) {
        List<RSAKey> ring = new ArrayList<>();
        List<RSAKey> inactive = new ArrayList<>();
        if (properties.getOidc().isDevKeygen()) {
            ring.add(devKey("dev-active"));
            inactive.add(devKey("dev-previous"));
        }
        for (IdentityProperties.Key key : properties.getKeys()) {
            RSAKey jwk = new RSAKey.Builder(
                    (RSAPublicKey) parsePublic(key.getPublicKeyPem()))
                    .privateKey((RSAPrivateKey) parsePrivate(key.getPrivateKeyPem()))
                    .keyID(key.getKid())
                    .build();
            (key.isActive() ? ring : inactive).add(jwk);
        }
        if (ring.isEmpty()) {
            throw new IllegalStateException(
                    "identity.oidc.enabled requires one active signing key "
                            + "(identity.keys[].active) or identity.oidc.dev-keygen");
        }
        // Active first: NimbusJwtEncoder picks the first RSA JWK for signing;
        // the full set still publishes to JWKS for verification overlap.
        ring.addAll(inactive);
        return new ImmutableJWKSet<>(new JWKSet(new ArrayList<>(ring)));
    }

    private static RSAKey devKey(String kid) {
        try {
            KeyPairGenerator generator = KeyPairGenerator.getInstance("RSA");
            generator.initialize(2048);
            KeyPair pair = generator.generateKeyPair();
            return new RSAKey.Builder((RSAPublicKey) pair.getPublic())
                    .privateKey((RSAPrivateKey) pair.getPrivate())
                    .keyID(kid)
                    .build();
        } catch (Exception exception) {
            throw new IllegalStateException("identity dev keygen failed", exception);
        }
    }

    private static java.security.PublicKey parsePublic(String pem) {
        return parse(pem, bytes -> {
            try {
                return KeyFactory.getInstance("RSA").generatePublic(new X509EncodedKeySpec(bytes));
            } catch (Exception exception) {
                throw new IllegalStateException("bad identity RSA public key PEM", exception);
            }
        });
    }

    private static java.security.PrivateKey parsePrivate(String pem) {
        return parse(pem, bytes -> {
            try {
                return KeyFactory.getInstance("RSA").generatePrivate(new PKCS8EncodedKeySpec(bytes));
            } catch (Exception exception) {
                throw new IllegalStateException("bad identity RSA private key PEM", exception);
            }
        });
    }

    private static <T> T parse(String pem, java.util.function.Function<byte[], T> factory) {
        if (pem == null || pem.isBlank()) {
            throw new IllegalStateException("identity.keys[] entries require PEM material");
        }
        String normalized = pem.replaceAll("-----BEGIN [A-Z ]+-----", "")
                .replaceAll("-----END [A-Z ]+-----", "")
                .replaceAll("\\s", "");
        byte[] der = Base64.getDecoder().decode(normalized);
        return factory.apply(der);
    }
}
