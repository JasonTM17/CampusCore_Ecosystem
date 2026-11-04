package io.campuscore.restfulapi.thesis.assistant;

import io.campuscore.restfulapi.web.DomainException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import com.nimbusds.jose.jwk.source.ImmutableSecret;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.security.oauth2.jwt.JwtEncoderParameters;
import org.springframework.security.oauth2.jwt.JwsHeader;
import org.springframework.security.oauth2.jwt.JwtClaimsSet;
import org.springframework.security.oauth2.jwt.JwtException;
import org.springframework.security.oauth2.jwt.JwtValidators;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;
import org.springframework.security.oauth2.jwt.NimbusJwtEncoder;
import javax.crypto.SecretKey;
import javax.crypto.spec.SecretKeySpec;

/** Signs short-lived, capability-scoped assertions for the private RAG boundary. */
public final class AssistantOwnerAssertion {
    public static final String HEADER = "X-Assistant-Owner-Assertion";
    public static final String ASSISTANT_CAPABILITY = "assistant";
    public static final String KNOWLEDGE_ADMIN_CAPABILITY = "knowledge-admin";

    private static final String ISSUER = "https://campuscore.invalid/restful-api";
    private static final String AUDIENCE = "campuscore-internal-rag";
    private static final Duration ASSERTION_LIFETIME = Duration.ofSeconds(30);
    private static final Duration CLOCK_SKEW = Duration.ofSeconds(5);
    private static final String ERROR_CODE = "RAG_OWNER_ASSERTION_INVALID";
    private static final String MISSING_KEY_CODE = "RAG_OWNER_ASSERTION_KEY_MISSING";

    private final Clock clock;
    private final JwtEncoder encoder;
    private final JwtDecoder decoder;

    public AssistantOwnerAssertion(AssistantRagProperties properties) {
        this(properties.ownerAssertionSecret(), properties.serviceToken(), Clock.systemUTC());
    }

    AssistantOwnerAssertion(String secret, Clock clock) {
        this(secret, "", clock);
    }

    private AssistantOwnerAssertion(String secret, String serviceToken, Clock clock) {
        String normalizedSecret = secret == null ? "" : secret.trim();
        String normalizedServiceToken = serviceToken == null ? "" : serviceToken.trim();
        this.clock = clock;
        byte[] keyBytes = normalizedSecret.getBytes(StandardCharsets.UTF_8);
        boolean reusesServiceToken = !normalizedServiceToken.isBlank()
                && MessageDigest.isEqual(keyBytes, normalizedServiceToken.getBytes(StandardCharsets.UTF_8));
        if (keyBytes.length < 32 || reusesServiceToken) {
            this.encoder = null;
            this.decoder = null;
            return;
        }
        SecretKey key = new SecretKeySpec(keyBytes, "HmacSHA256");
        this.encoder = new NimbusJwtEncoder(new ImmutableSecret<>(key));
        NimbusJwtDecoder jwtDecoder = NimbusJwtDecoder.withSecretKey(key)
                .macAlgorithm(MacAlgorithm.HS256)
                .build();
        jwtDecoder.setJwtValidator(JwtValidators.createDefault());
        this.decoder = jwtDecoder;
    }

    public boolean configured() {
        return encoder != null && decoder != null;
    }

    /** Mints only for the authenticated JWT subject that the caller passed through. */
    public String issueAssistant(String ownerId) {
        authenticatedSubject(ownerId);
        return issue(ownerId, ASSISTANT_CAPABILITY);
    }

    /** Knowledge administration is delegated only from an authenticated admin request. */
    public String issueKnowledgeAdmin(String actorId) {
        Authentication authentication = authenticatedSubject(actorId);
        boolean administrator = authentication.getAuthorities().stream()
                .map(GrantedAuthority::getAuthority)
                .anyMatch(authority -> "ROLE_ADMIN".equals(authority) || "ROLE_SUPER_ADMIN".equals(authority));
        if (!administrator) {
            throw new DomainException(HttpStatus.FORBIDDEN, "ACCESS_DENIED", "Administrator access is required");
        }
        return issue(actorId, KNOWLEDGE_ADMIN_CAPABILITY);
    }

    public String verifyAssistant(String assertion, String ownerHeader) {
        return verify(assertion, ownerHeader, ASSISTANT_CAPABILITY);
    }

    public String verifyKnowledgeAdmin(String assertion, String ownerHeader) {
        return verify(assertion, ownerHeader, KNOWLEDGE_ADMIN_CAPABILITY);
    }

    private String issue(String subject, String capability) {
        requireConfigured();
        requireSubject(subject, true);
        Instant issuedAt = clock.instant();
        JwtClaimsSet claims = JwtClaimsSet.builder()
                .issuer(ISSUER)
                .subject(subject)
                .audience(List.of(AUDIENCE))
                .issuedAt(issuedAt)
                .expiresAt(issuedAt.plus(ASSERTION_LIFETIME))
                .claim("capability", capability)
                .build();
        JwsHeader header = JwsHeader.with(MacAlgorithm.HS256).build();
        return encoder.encode(JwtEncoderParameters.from(header, claims)).getTokenValue();
    }

    private String verify(String assertion, String ownerHeader, String requiredCapability) {
        requireConfigured();
        requireSubject(ownerHeader, false);
        if (assertion == null || assertion.isBlank()) {
            throw invalidAssertion();
        }

        final Jwt jwt;
        try {
            jwt = decoder.decode(assertion);
        } catch (JwtException | IllegalArgumentException invalid) {
            throw invalidAssertion();
        }

        Instant now = clock.instant();
        Instant issuedAt = jwt.getIssuedAt();
        Instant expiresAt = jwt.getExpiresAt();
        String subject = jwt.getSubject();
        if (jwt.getIssuer() == null || !ISSUER.equals(jwt.getIssuer().toString())
                || jwt.getAudience() == null || !jwt.getAudience().equals(List.of(AUDIENCE))
                || !requiredCapability.equals(jwt.getClaimAsString("capability"))
                || issuedAt == null || expiresAt == null
                || issuedAt.isAfter(now.plus(CLOCK_SKEW))
                || issuedAt.isBefore(now.minus(ASSERTION_LIFETIME).minus(CLOCK_SKEW))
                || !expiresAt.isAfter(now)
                || expiresAt.isAfter(issuedAt.plus(ASSERTION_LIFETIME))) {
            throw invalidAssertion();
        }
        requireSubject(subject, false);
        if (!MessageDigest.isEqual(subject.getBytes(StandardCharsets.UTF_8),
                ownerHeader.getBytes(StandardCharsets.UTF_8))) {
            throw invalidAssertion();
        }
        return subject;
    }

    private Authentication authenticatedSubject(String requestedSubject) {
        requireConfigured();
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        if (authentication == null || !authentication.isAuthenticated()
                || !(authentication.getPrincipal() instanceof Jwt jwt)) {
            throw new DomainException(HttpStatus.UNAUTHORIZED, "UNAUTHENTICATED", "Authentication is required");
        }
        String authenticatedSubject = jwt.getSubject();
        requireSubject(authenticatedSubject, true);
        requireSubject(requestedSubject, true);
        if (!MessageDigest.isEqual(authenticatedSubject.getBytes(StandardCharsets.UTF_8),
                requestedSubject.getBytes(StandardCharsets.UTF_8))) {
            throw new DomainException(HttpStatus.FORBIDDEN, "ACCESS_DENIED",
                    "Assistant owner must match the authenticated subject");
        }
        return authentication;
    }

    private void requireConfigured() {
        if (!configured()) {
            throw new DomainException(HttpStatus.SERVICE_UNAVAILABLE, MISSING_KEY_CODE,
                    "Assistant owner assertion signing key is not configured");
        }
    }

    private static void requireSubject(String subject, boolean outbound) {
        if (subject == null || subject.isBlank() || subject.length() > 120) {
            if (outbound) {
                throw new DomainException(HttpStatus.UNAUTHORIZED, "UNAUTHENTICATED", "Authentication is required");
            }
            throw invalidAssertion();
        }
    }

    private static DomainException invalidAssertion() {
        return new DomainException(HttpStatus.FORBIDDEN, ERROR_CODE, "Assistant owner assertion is invalid");
    }
}
