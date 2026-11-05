package io.campuscore.restfulapi.security.ratelimit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.Mockito.mock;

import java.nio.charset.StandardCharsets;
import java.util.List;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.core.context.SecurityContextHolder;

import io.campuscore.restfulapi.identity.IdentityProperties;
import io.campuscore.restfulapi.web.ApiErrorWriter;
import jakarta.servlet.FilterChain;
import tools.jackson.databind.ObjectMapper;

class RateLimitEdgeTrustTest {
    private static final String TOKEN = "test-edge-token-0123456789abcdef0123456789";
    private static final String PREVIEW_TOKEN = "sso-preview-proxy-token-0123456789";
    private final ApplicationContextRunner context = new ApplicationContextRunner()
            .withUserConfiguration(RateLimitProperties.class);

    @Test
    void edgeOptInRejectsEmptyShortAndPublishedTokensAtStartup() {
        for (String token : List.of("", "   ", "short", "x".repeat(31), PREVIEW_TOKEN)) {
            context.withPropertyValues("CAMPUSCORE_TRUST_EDGE_HEADERS=true",
                    "app.rate-limit.proxy-token=" + token).run(application -> {
                        assertThat(application).hasFailed();
                        assertThat(application.getStartupFailure()).hasRootCauseMessage(
                                "CAMPUSCORE_TRUST_EDGE_HEADERS=true requires app.rate-limit.proxy-token"
                                        + " (RATE_LIMIT_PROXY_TOKEN) with at least 32 characters and an unpublished value");
                    });
        }
        context.withPropertyValues("CAMPUSCORE_TRUST_EDGE_HEADERS=true")
                .run(application -> assertThat(application).hasFailed());
    }

    @Test
    void edgeOptInAcceptsStrongTokensAndDefaultsToOff() {
        context.withPropertyValues("CAMPUSCORE_TRUST_EDGE_HEADERS=true",
                "app.rate-limit.proxy-token=" + "x".repeat(32))
                .run(application -> assertThat(application).hasNotFailed());
        for (String token : List.of("", "short", PREVIEW_TOKEN)) {
            context.withPropertyValues("app.rate-limit.proxy-token=" + token)
                    .run(application -> assertThat(application).hasNotFailed());
        }
    }

    @Test
    void authenticatedEdgeClientsHaveSeparateBucketsButForgedPreviewTokensDoNot() throws Exception {
        SecurityContextHolder.clearContext();
        RateLimitProperties properties = new RateLimitProperties(true, false, false, TOKEN, 2, 40, 60);
        RateLimiterService limiter = new RateLimiterService();
        RateLimitFilter filter = new RateLimitFilter(limiter, properties,
                new ApiErrorWriter(new ObjectMapper()), new ClientIpResolver(properties), new IdentityProperties());
        for (String ip : List.of("203.0.113.9", "2001:db8::2")) {
            MockHttpServletResponse response = new MockHttpServletResponse();
            filter.doFilter(request(TOKEN, ip), response, mock(FilterChain.class));
            assertEquals("1", response.getHeader("X-RateLimit-Remaining"));
        }
        assertEquals(2, limiter.getActiveKeyCount());
        for (int i = 0; i < 3; i++) {
            MockHttpServletResponse response = new MockHttpServletResponse();
            filter.doFilter(request(PREVIEW_TOKEN, "198.51.100." + i), response, mock(FilterChain.class));
            assertEquals(i == 2 ? 429 : 200, response.getStatus());
        }
        assertEquals(3, limiter.getActiveKeyCount());
    }

    @Test
    void tokenComparisonUsesTheConstantTimePrimitiveAndRejectsPrefixSuffixAndMissingTokens() throws Exception {
        RateLimitProperties properties = new RateLimitProperties(true, false, false, TOKEN, 2, 40, 60);
        ClientIpResolver resolver = new ClientIpResolver(properties);
        assertEquals("203.0.113.9", resolver.resolve(request(TOKEN, "203.0.113.9")));
        for (String token : List.of("", TOKEN.substring(1), TOKEN + "x", "X" + TOKEN.substring(1), PREVIEW_TOKEN)) {
            assertEquals("10.0.0.4", resolver.resolve(request(token, "198.51.100.42")));
        }
        assertEquals("10.0.0.4", resolver.resolve(request(null, "198.51.100.42")));
        // Behavioral equality checks cannot establish timing; guard use of the JDK primitive too.
        try (var bytecode = ClientIpResolver.class.getResourceAsStream("ClientIpResolver.class")) {
            assertThat(bytecode).isNotNull();
            String constants = new String(bytecode.readAllBytes(), StandardCharsets.ISO_8859_1);
            assertThat(constants).contains("java/security/MessageDigest", "isEqual");
        }
    }

    private static MockHttpServletRequest request(String token, String ip) {
        MockHttpServletRequest request = new MockHttpServletRequest("POST", "/api/v1/auth/login");
        request.setRemoteAddr("10.0.0.4");
        if (token != null) request.addHeader("X-Campuscore-Proxy-Token", token);
        request.addHeader("X-Campuscore-Client-Ip", ip);
        return request;
    }
}
