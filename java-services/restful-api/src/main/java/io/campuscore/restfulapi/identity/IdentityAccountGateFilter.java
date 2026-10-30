package io.campuscore.restfulapi.identity;

import io.campuscore.restfulapi.auth.repository.AuthUserRepository;
import io.campuscore.restfulapi.security.DatabaseAvailabilityTracker;
import io.campuscore.restfulapi.web.ApiErrorWriter;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.Optional;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * Current-account gate for the SAS chain (identity-contract.md §2.4). Runs
 * after authentication on every {@code /oauth2/*} user path:
 * Missing/inactive accounts restart login on authorize (401/403 elsewhere).
 * {@code mustChangePassword} → 403
 * {@code PASSWORD_CHANGE_REQUIRED} — SSO authorize is not a rotation
 * bypass. Client-credential flows carry no user principal and skip the gate;
 * public endpoints (jwks, discovery) reach it unauthenticated and skip.
 * Same fail-closed posture as {@code AccountStateFilter}.
 */
public class IdentityAccountGateFilter extends OncePerRequestFilter {

    private final AuthUserRepository users;
    private final ApiErrorWriter errorWriter;
    private final boolean authorizePaused;
    private final String loginPage;

    public IdentityAccountGateFilter(AuthUserRepository users, ApiErrorWriter errorWriter,
            boolean authorizePaused, String loginPage) {
        this.users = users;
        this.errorWriter = errorWriter;
        this.authorizePaused = authorizePaused;
        this.loginPage = loginPage;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
            FilterChain chain) throws ServletException, IOException {
        if (authorizePaused && "/oauth2/authorize".equals(request.getRequestURI())) {
            errorWriter.write(request, response, HttpStatus.SERVICE_UNAVAILABLE,
                    "AUTHORIZE_PAUSED", "Sign-on is temporarily paused");
            return;
        }
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        if (!(authentication instanceof JwtAuthenticationToken jwtToken)) {
            chain.doFilter(request, response);
            return;
        }
        if (DatabaseAvailabilityTracker.isRecentlyUnavailable()) {
            errorWriter.write(request, response, HttpStatus.SERVICE_UNAVAILABLE,
                    "DATABASE_UNAVAILABLE", "Database service is temporarily unavailable");
            return;
        }
        Optional<AuthUserRepository.AccountAuthorization> state;
        try {
            state = users.findAccountAuthorization(jwtToken.getToken().getSubject());
            DatabaseAvailabilityTracker.recordSuccess();
        } catch (org.springframework.dao.DataAccessException exception) {
            DatabaseAvailabilityTracker.recordFailure();
            errorWriter.write(request, response, HttpStatus.SERVICE_UNAVAILABLE,
                    "DATABASE_UNAVAILABLE", "Database service is temporarily unavailable");
            return;
        }
        if (state.isEmpty()) {
            if ("/oauth2/authorize".equals(request.getRequestURI())) {
                IdentitySecurityConfig.redirectToLogin(request, response, loginPage);
                return;
            }
            errorWriter.write(request, response, HttpStatus.UNAUTHORIZED,
                    "SESSION_INVALID", "Sign in again to continue");
            return;
        }
        if (!"ACTIVE".equals(state.get().status())) {
            if ("/oauth2/authorize".equals(request.getRequestURI())) {
                IdentitySecurityConfig.redirectToLogin(request, response, loginPage);
                return;
            }
            errorWriter.write(request, response, HttpStatus.FORBIDDEN,
                    "ACCOUNT_INACTIVE", "This account is not active");
            return;
        }
        if (state.get().mustChangePassword()) {
            errorWriter.write(request, response, HttpStatus.FORBIDDEN,
                    "PASSWORD_CHANGE_REQUIRED",
                    "Rotate the issued temporary password before using single sign-on");
            return;
        }
        chain.doFilter(request, response);
    }
}
