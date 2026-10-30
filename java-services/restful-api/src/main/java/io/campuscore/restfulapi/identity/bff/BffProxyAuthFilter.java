package io.campuscore.restfulapi.identity.bff;

import java.io.IOException;
import java.security.MessageDigest;
import java.util.Optional;

import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.http.HttpStatus;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import io.campuscore.restfulapi.identity.IdentityProperties;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

/**
 * Resource-side half of the BFF loopback contract (host-policy §2.2): a
 * caller that presents {@code X-Campuscore-Surface} claims to be the
 * per-surface proxy, and must prove it with that surface's
 * {@code X-Campuscore-Bff-Secret}. A browser can spoof the surface header but
 * cannot learn the configured secret — so the pair is verified before the
 * request is allowed to carry proxy context into business endpoints.
 * Requests without the surface header are untouched (legacy cookie lane).
 */
@ConditionalOnProperty(prefix = "identity.bff", name = "enabled", havingValue = "true")
@Component
@Order(Ordered.HIGHEST_PRECEDENCE + 30)
public class BffProxyAuthFilter extends OncePerRequestFilter {

    static final String SURFACE_HEADER = "X-Campuscore-Surface";
    static final String SECRET_HEADER = "X-Campuscore-Bff-Secret";

    private final IdentityProperties properties;

    public BffProxyAuthFilter(IdentityProperties properties) {
        this.properties = properties;
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        return request.getHeader(SURFACE_HEADER) == null
                || !request.getRequestURI().startsWith("/api/v1/");
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
            FilterChain chain) throws ServletException, IOException {
        Optional<IdentityProperties.Surface> surface = properties.getBff().getSurfaces().stream()
                .filter(s -> s.getId() != null && s.getId().equals(request.getHeader(SURFACE_HEADER)))
                .findFirst();
        // Unknown surface, or a surface whose proxy secret is unconfigured:
        // the header pair is untrusted and must not ride into the endpoint.
        if (surface.isEmpty() || surface.get().getProxySecret().isBlank()
                || !constantTimeEquals(surface.get().getProxySecret(),
                        request.getHeader(SECRET_HEADER))) {
            response.setStatus(HttpStatus.FORBIDDEN.value());
            response.setContentType("application/json");
            response.getWriter().write(
                    "{\"error\":{\"code\":\"PROXY_CONTEXT_REJECTED\",\"message\":\"Invalid surface credential\"}}");
            return;
        }
        chain.doFilter(request, response);
    }

    private static boolean constantTimeEquals(String expected, String provided) {
        if (provided == null) {
            return false;
        }
        return MessageDigest.isEqual(expected.getBytes(java.nio.charset.StandardCharsets.UTF_8),
                provided.getBytes(java.nio.charset.StandardCharsets.UTF_8));
    }
}
