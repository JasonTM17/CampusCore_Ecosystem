package io.campuscore.restfulapi.security;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.List;
import org.springframework.context.annotation.Profile;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * Narrows a container booted with the `enrollment` profile to its registrarial
 * slice: registration rounds/catalog/enroll actions, enrollments, admin
 * registration, and health probes. Everything else answers 404 so the edge's
 * dedicated upstream cannot be used to reach unrelated API surface.
 */
@Component
@Profile("enrollment")
@Order(Ordered.HIGHEST_PRECEDENCE + 10)
public class EnrollmentSliceFilter extends OncePerRequestFilter {

    public static final String SERVED_BY_HEADER = "X-Served-By";
    public static final String SERVED_BY_VALUE = "enrollment-api";

    static final List<String> ALLOWED_PREFIXES = List.of(
            "/api/v1/me/registration",
            "/api/v1/me/enrollments",
            "/api/v1/admin/registration",
            "/api/v1/health");

    static boolean isAllowed(String path) {
        if (path == null) {
            return false;
        }
        for (String prefix : ALLOWED_PREFIXES) {
            if (path.equals(prefix) || path.startsWith(prefix + "/")) {
                return true;
            }
        }
        return false;
    }

    @Override
    protected void doFilterInternal(
            HttpServletRequest request,
            HttpServletResponse response,
            FilterChain filterChain) throws ServletException, IOException {
        response.setHeader(SERVED_BY_HEADER, SERVED_BY_VALUE);
        String path = request.getRequestURI();
        if (isAllowed(path) || "OPTIONS".equalsIgnoreCase(request.getMethod())) {
            filterChain.doFilter(request, response);
            return;
        }
        response.setStatus(HttpServletResponse.SC_NOT_FOUND);
        response.setContentType("application/json");
        response.getWriter().write(
                "{\"code\":\"ENROLLMENT_API_SLICE\",\"message\":\"Route is not served by enrollment-api\"}");
    }
}
