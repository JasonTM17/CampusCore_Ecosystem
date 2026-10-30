package io.campuscore.restfulapi.identity.bff;

import java.io.IOException;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.http.HttpHeaders;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import io.campuscore.restfulapi.identity.IdentityProperties;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

/**
 * Canonical redirect for REDIRECT-mode surfaces (host-policy §1): the apex
 * host bounces every GET/HEAD to its configured target surface preserving
 * path and query. Runs as a plain servlet filter ahead of the security
 * chains so anonymous apex traffic never touches the authenticated
 * resource layer at all — a surface marked REDIRECT serves nothing else.
 */
@ConditionalOnProperty(prefix = "identity.bff", name = "enabled", havingValue = "true")
@Component
@Order(Ordered.HIGHEST_PRECEDENCE + 20)
public class BffRedirectFilter extends OncePerRequestFilter {

    private final BffSurfaceRegistry registry;

    public BffRedirectFilter(BffSurfaceRegistry registry) {
        this.registry = registry;
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        String method = request.getMethod();
        return !("GET".equals(method) || "HEAD".equals(method));
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request,
            HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        IdentityProperties.Surface surface = registry.resolve(request);
        if (surface == null || !"REDIRECT".equals(surface.getMode())) {
            chain.doFilter(request, response);
            return;
        }
        String query = request.getQueryString();
        response.setStatus(HttpServletResponse.SC_FOUND);
        response.setHeader(HttpHeaders.LOCATION,
                surface.getRedirectTarget() + request.getRequestURI()
                        + (query == null ? "" : "?" + query));
        response.setHeader(HttpHeaders.CACHE_CONTROL, "no-store");
    }
}
