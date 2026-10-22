package io.campuscore.restfulapi.identity.bff;

import io.campuscore.restfulapi.identity.IdentityProperties;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Base64;
import java.util.Map;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.MediaType;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;
import org.springframework.web.client.RestClient;

/**
 * Server-side OAuth2 token endpoint client for the loopback leg (host-policy
 * §3/§5). The BFF is a confidential client: the browser never sees code
 * exchange or refresh traffic. Calls go to the configured issuer loopback
 * (same JVM — the SAS endpoints run here) so the full SAS provider chain —
 * PKCE verify, code one-time consume, refresh rotation, replay detection —
 * executes exactly as it would for an external client.
 */
@ConditionalOnProperty(prefix = "identity.bff", name = "enabled", havingValue = "true")
@Component
public class BffTokenClient {

    public record TokenResponse(String accessToken, String refreshToken,
            String idToken, String authorizationId, long expiresIn) {
    }

    public static class TokenExchangeException extends RuntimeException {
        public TokenExchangeException(String message) {
            super(message);
        }
    }

    private final RestClient rest;
    private final IdentityProperties properties;

    public BffTokenClient(IdentityProperties properties) {
        this.properties = properties;
        this.rest = RestClient.builder()
                .requestFactory(new org.springframework.http.client
                        .SimpleClientHttpRequestFactory())
                .build();
    }

    /** authorization_code + PKCE exchange at callback. */
    public TokenResponse exchangeCode(IdentityProperties.Surface surface,
            String code, String redirectUri, String verifier) {
        MultiValueMap<String, String> form = new LinkedMultiValueMap<>();
        form.add("grant_type", "authorization_code");
        form.add("code", code);
        form.add("redirect_uri", redirectUri);
        form.add("code_verifier", verifier);
        return call(surface, form);
    }

    /** refresh_token rotation under the session row lock. */
    public TokenResponse refresh(IdentityProperties.Surface surface,
            String refreshToken) {
        MultiValueMap<String, String> form = new LinkedMultiValueMap<>();
        form.add("grant_type", "refresh_token");
        form.add("refresh_token", refreshToken);
        return call(surface, form);
    }

    private TokenResponse call(IdentityProperties.Surface surface,
            MultiValueMap<String, String> form) {
        String basic = Base64.getEncoder().encodeToString(
                (surface.getClientId() + ":" + surface.getClientSecret())
                        .getBytes(StandardCharsets.UTF_8));
        Map<?, ?> body = rest.post()
                .uri(properties.getBff().getIssuerLoopback() + "/oauth2/token")
                .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                .header("Authorization", "Basic " + basic)
                // Loopback self-identification: the surface credential pair
                // exempts this call from the generic ip-keyed POST bucket
                // (RateLimitFilter validates it constant-time).
                .header("X-Campuscore-Surface", surface.getId())
                .header("X-Campuscore-Bff-Secret", surface.getProxySecret())
                .body(form)
                .retrieve()
                .onStatus(HttpStatusCode::isError, (req, res) -> {
                    throw new TokenExchangeException(
                            "token endpoint " + res.getStatusCode().value());
                })
                .body(Map.class);
        if (body == null || body.get("access_token") == null) {
            throw new TokenExchangeException("token endpoint returned no access_token");
        }
        Object expires = body.get("expires_in");
        return new TokenResponse(
                String.valueOf(body.get("access_token")),
                body.get("refresh_token") == null ? null
                        : String.valueOf(body.get("refresh_token")),
                body.get("id_token") == null ? null
                        : String.valueOf(body.get("id_token")),
                null,
                expires instanceof Number number ? number.longValue()
                        : Duration.ofMinutes(15).toSeconds());
    }
}
