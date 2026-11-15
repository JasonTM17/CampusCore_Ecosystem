package io.campuscore.bursarapi.config;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * Service-to-service gate for /internal/bursar/** calls (same pattern as the
 * rag-service's X-Rag-Service-Token). Without a matching token the request is
 * rejected before it reaches the controller; with it the request proceeds.
 */
@Component
public class InternalTokenFilter extends OncePerRequestFilter {

    private static final String HEADER = "X-Bursar-Service-Token";

    private final String expectedToken;

    public InternalTokenFilter(@Value("${bursar.internal-token:}") String expectedToken) {
        this.expectedToken = expectedToken;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
            FilterChain chain) throws ServletException, IOException {
        if (!request.getRequestURI().startsWith("/internal/bursar/")) {
            chain.doFilter(request, response);
            return;
        }
        String presented = request.getHeader(HEADER);
        if (expectedToken.isEmpty() || presented == null
                || !MessageDigest.isEqual(
                        expectedToken.getBytes(StandardCharsets.UTF_8),
                        presented.getBytes(StandardCharsets.UTF_8))) {
            response.sendError(HttpServletResponse.SC_UNAUTHORIZED, "invalid internal token");
            return;
        }
        chain.doFilter(request, response);
    }
}
