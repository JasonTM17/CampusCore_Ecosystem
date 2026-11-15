package io.campuscore.bursarapi.config;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.Map;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * Same intent as the SIS core's AccountStateFilter: an access token must not
 * keep billing access after the account is locked or its credentials are
 * rotated. Deactivation and credential revision take effect immediately even
 * for tokens issued earlier.
 */
@Component
public class AccountStateFilter extends OncePerRequestFilter {

    private final JdbcTemplate jdbc;

    public AccountStateFilter(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
            FilterChain chain) throws ServletException, IOException {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        if (!(authentication instanceof JwtAuthenticationToken jwtToken)
                || !request.getRequestURI().startsWith("/api/v1/me/")) {
            chain.doFilter(request, response);
            return;
        }
        Jwt token = jwtToken.getToken();
        Map<String, Object> state;
        try {
            state = jdbc.queryForMap(
                    "SELECT \"status\", \"credentialVersion\" FROM campuscore_auth.\"User\" WHERE \"id\" = ?",
                    token.getSubject());
        } catch (DataAccessException ex) {
            reject(response, HttpServletResponse.SC_UNAUTHORIZED, "SESSION_INVALID");
            return;
        }
        if (!"ACTIVE".equals(state.get("status"))) {
            reject(response, HttpServletResponse.SC_FORBIDDEN, "ACCOUNT_INACTIVE");
            return;
        }
        long current = ((Number) state.get("credentialVersion")).longValue();
        Object claim = token.getClaims().get("credentialVersion");
        boolean matches = claim == null
                ? current == 0
                : (claim instanceof Long || claim instanceof Integer)
                        && ((Number) claim).longValue() == current;
        if (!matches) {
            reject(response, HttpServletResponse.SC_UNAUTHORIZED, "SESSION_INVALID");
            return;
        }
        chain.doFilter(request, response);
    }

    private static void reject(HttpServletResponse response, int status, String code) throws IOException {
        response.setStatus(status);
        response.setContentType("application/json");
        response.getWriter().write("{\"code\":\"" + code + "\"}");
    }
}
