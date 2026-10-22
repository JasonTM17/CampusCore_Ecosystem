package io.campuscore.restfulapi.identity;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.security.core.AuthenticationException;
import org.springframework.security.oauth2.core.OAuth2AuthenticationException;
import org.springframework.security.oauth2.core.OAuth2Error;
import org.springframework.security.oauth2.core.OAuth2ErrorCodes;
import org.springframework.security.oauth2.server.authorization.web.authentication.OAuth2ErrorAuthenticationFailureHandler;
import org.springframework.security.web.authentication.AuthenticationFailureHandler;

/**
 * OIDC-side replay detection (identity-contract.md §2.3): SAS keeps only the
 * current refresh token per authorization, so a rotated-away token surfaces
 * here as {@code invalid_grant} on the refresh grant. The lineage table
 * distinguishes "rotated away" (USED → replay → account-wide revoke) from
 * "never issued" (forged → plain rejection). Revocation delegates to
 * {@link UnifiedSessionAuthority}, so a replayed OIDC refresh kills the
 * legacy lane too — the symmetric half of legacy replay killing OIDC.
 */
public class OidcRefreshReplayHandler implements AuthenticationFailureHandler {

    private static final Logger log = LoggerFactory.getLogger(OidcRefreshReplayHandler.class);

    private final IdentitySessionMirror mirror;
    private final UnifiedSessionAuthority authority;
    private final AuthenticationFailureHandler delegate;

    public OidcRefreshReplayHandler(IdentitySessionMirror mirror,
            UnifiedSessionAuthority authority, AuthenticationFailureHandler delegate) {
        this.mirror = mirror;
        this.authority = authority;
        this.delegate = delegate;
    }

    @Override
    public void onAuthenticationFailure(HttpServletRequest request, HttpServletResponse response,
            AuthenticationException exception) throws java.io.IOException, jakarta.servlet.ServletException {
        if (isRefreshGrantInvalidGrant(request, exception)) {
            String presented = request.getParameter("refresh_token");
            if (presented != null && "USED".equals(mirror.refreshLineageState(presented))) {
                String userId = mirror.refreshLineageUser(presented);
                if (userId != null) {
                    try {
                        authority.revokeAccount(userId, "OIDC", "REFRESH_REPLAY",
                                request.getHeader("X-Request-Id"));
                    } catch (RuntimeException revokeFailure) {
                        log.warn("OIDC refresh replay revoke failed user={}: {}",
                                userId, revokeFailure.toString());
                    }
                    log.warn("REFRESH_TOKEN_REPLAY oidc lane user={}", userId);
                }
            }
        }
        delegate.onAuthenticationFailure(request, response, exception);
    }

    private static boolean isRefreshGrantInvalidGrant(HttpServletRequest request,
            AuthenticationException exception) {
        if (!"refresh_token".equals(request.getParameter("grant_type"))
                || !(exception instanceof OAuth2AuthenticationException oauth)) {
            return false;
        }
        OAuth2Error error = oauth.getError();
        return error != null && OAuth2ErrorCodes.INVALID_GRANT.equals(error.getErrorCode());
    }

    /** Default failure response matching SAS's JSON error contract. */
    public static AuthenticationFailureHandler defaultDelegate() {
        return new OAuth2ErrorAuthenticationFailureHandler();
    }
}
