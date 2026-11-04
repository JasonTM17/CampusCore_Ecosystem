package io.campuscore.restfulapi.thesis.assistant;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;

import io.campuscore.restfulapi.web.DomainException;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import javax.crypto.SecretKey;
import javax.crypto.spec.SecretKeySpec;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import com.nimbusds.jose.jwk.source.ImmutableSecret;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.JwsHeader;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtClaimsSet;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.security.oauth2.jwt.JwtEncoderParameters;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;
import org.springframework.security.oauth2.jwt.NimbusJwtEncoder;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;

class AssistantOwnerAssertionTest {
    private static final String KEY = "unit-test-owner-assertion-secret-material";
    private static final String ISSUER = "https://campuscore.invalid/restful-api";
    private static final String AUDIENCE = "campuscore-internal-rag";

    @AfterEach
    void clearSecurityContext() {
        SecurityContextHolder.clearContext();
    }

    @Test
    void issuesShortLivedCompactHs256AssertionForAuthenticatedSubject() {
        authenticate("owner-a");
        AssistantOwnerAssertion assertions = new AssistantOwnerAssertion(properties(KEY));

        String token = assertions.issueAssistant("owner-a");
        SecretKey key = key();
        JwtDecoder decoder = NimbusJwtDecoder.withSecretKey(key).macAlgorithm(MacAlgorithm.HS256).build();
        Jwt jwt = decoder.decode(token);

        assertEquals(3, token.split("\\.").length);
        assertEquals("owner-a", jwt.getSubject());
        assertEquals(List.of(AUDIENCE), jwt.getAudience());
        assertEquals(ISSUER, jwt.getIssuer().toString());
        assertEquals(AssistantOwnerAssertion.ASSISTANT_CAPABILITY, jwt.getClaimAsString("capability"));
        assertEquals(Duration.ofSeconds(30), Duration.between(jwt.getIssuedAt(), jwt.getExpiresAt()));
        assertEquals("owner-a", assertions.verifyAssistant(token, "owner-a"));
    }

    @Test
    void rejectsMismatchedOwnerExpiredTamperedAndWrongCapabilityAssertions() {
        authenticate("owner-a");
        AssistantOwnerAssertion assertions = new AssistantOwnerAssertion(properties(KEY));
        String assistant = assertions.issueAssistant("owner-a");

        assertInvalid(() -> assertions.verifyAssistant(assistant, "owner-b"));
        assertInvalid(() -> assertions.verifyKnowledgeAdmin(assistant, "owner-a"));
        assertInvalid(() -> assertions.verifyAssistant(tamper(assistant), "owner-a"));

        Instant now = Instant.now();
        String expired = signed("owner-a", AssistantOwnerAssertion.ASSISTANT_CAPABILITY,
                now.minusSeconds(60), now.minusSeconds(30));
        assertInvalid(() -> assertions.verifyAssistant(expired, "owner-a"));
    }

    @Test
    void knowledgeAdminCapabilityRequiresAuthenticatedAdministrator() {
        AssistantOwnerAssertion assertions = new AssistantOwnerAssertion(properties(KEY));
        authenticate("admin-a", "ROLE_ADMIN");
        String knowledgeAdmin = assertions.issueKnowledgeAdmin("admin-a");

        assertEquals("admin-a", assertions.verifyKnowledgeAdmin(knowledgeAdmin, "admin-a"));
        assertInvalid(() -> assertions.verifyAssistant(knowledgeAdmin, "admin-a"));

        authenticate("staff-a", "ROLE_USER");
        DomainException denied = assertThrows(DomainException.class,
                () -> assertions.issueKnowledgeAdmin("staff-a"));
        assertEquals(HttpStatus.FORBIDDEN, denied.status());
        assertEquals("ACCESS_DENIED", denied.code());
    }

    @Test
    void missingOrShortKeyFailsClosedForSigningAndVerification() {
        authenticate("owner-a");
        AssistantOwnerAssertion missing = new AssistantOwnerAssertion(properties(""));

        assertFalse(missing.configured());
        assertEquals("RAG_OWNER_ASSERTION_KEY_MISSING", assertThrows(DomainException.class,
                () -> missing.issueAssistant("owner-a")).code());
        assertEquals("RAG_OWNER_ASSERTION_KEY_MISSING", assertThrows(DomainException.class,
                () -> missing.verifyAssistant("", "owner-a")).code());
        assertFalse(new AssistantOwnerAssertion(properties("too-short")).configured());
        assertFalse(new AssistantOwnerAssertion(new AssistantRagProperties(
                "", KEY, KEY, true, 1_000, 30_000)).configured());
    }

    @Test
    void signingRejectsAnOwnerThatDiffersFromAuthenticatedSubject() {
        authenticate("owner-a");
        DomainException denied = assertThrows(DomainException.class,
                () -> new AssistantOwnerAssertion(properties(KEY)).issueAssistant("owner-b"));

        assertEquals(HttpStatus.FORBIDDEN, denied.status());
        assertEquals("ACCESS_DENIED", denied.code());
    }

    private static void assertInvalid(Runnable action) {
        DomainException failure = assertThrows(DomainException.class, action::run);
        assertEquals(HttpStatus.FORBIDDEN, failure.status());
        assertEquals("RAG_OWNER_ASSERTION_INVALID", failure.code());
    }

    private static String tamper(String token) {
        // The first signature character carries six significant bits; the last one carries
        // padding bits, so changing only the last character can leave the signature valid.
        int first = token.lastIndexOf('.') + 1;
        char original = token.charAt(first);
        return token.substring(0, first) + (original == 'A' ? 'B' : 'A') + token.substring(first + 1);
    }

    private static String signed(String subject, String capability, Instant issuedAt, Instant expiresAt) {
        JwtClaimsSet claims = JwtClaimsSet.builder()
                .issuer(ISSUER)
                .subject(subject)
                .audience(List.of(AUDIENCE))
                .issuedAt(issuedAt)
                .expiresAt(expiresAt)
                .claim("capability", capability)
                .build();
        JwtEncoder encoder = new NimbusJwtEncoder(new ImmutableSecret<>(key()));
        return encoder.encode(JwtEncoderParameters.from(
                JwsHeader.with(MacAlgorithm.HS256).build(), claims)).getTokenValue();
    }

    private static SecretKey key() {
        return new SecretKeySpec(KEY.getBytes(StandardCharsets.UTF_8), "HmacSHA256");
    }

    private static AssistantRagProperties properties(String key) {
        return new AssistantRagProperties("", "internal-token", key, true, 1_000, 30_000);
    }

    private static void authenticate(String subject, String... authorities) {
        Jwt jwt = Jwt.withTokenValue("fixture")
                .header("alg", "none")
                .subject(subject)
                .build();
        var grantedAuthorities = java.util.Arrays.stream(authorities)
                .map(SimpleGrantedAuthority::new)
                .toList();
        SecurityContextHolder.getContext().setAuthentication(new JwtAuthenticationToken(jwt, grantedAuthorities));
    }
}
