package io.campuscore.restfulapi.identity.bff;

import io.campuscore.restfulapi.identity.IdentityProperties;
import io.campuscore.restfulapi.identity.IdentityProperties.Surface;
import io.campuscore.restfulapi.identity.bff.BffSessionService.CallbackResult;
import io.campuscore.restfulapi.identity.bff.BffSessionService.LogoutResult;
import io.campuscore.restfulapi.identity.bff.BffSessionService.ResolvedSession;
import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseCookie;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.util.UriComponentsBuilder;

/**
 * Browser-facing session endpoints (host-policy §3). Every response is
 * no-store: session state and 302 redirects must never be cached by a
 * shared sibling cache. The cookie contract is enforced here — host-only
 * (no Domain attribute ever), __Host- prefix in TLS mode, Path=/.
 */
@ConditionalOnProperty(prefix = "identity.bff", name = "enabled", havingValue = "true")
@RestController
@RequestMapping("/session")
public class BffSessionController {

    static final String SESSION_COOKIE = "__Host-cu_session";
    static final String SESSION_COOKIE_DEV = "cu_session_dev";
    /**
     * Session-hint + double-submit cookie the SPA already owns on the
     * direct lane (AuthContext bootstrap + X-CSRF-Token echo). On BFF
     * surfaces the callback mints it with the session's csrfToken so the
     * same frontend machinery works unchanged — it is the `cc_*` legacy
     * row the cookie matrix reserves for business surfaces.
     */
    static final String CSRF_COOKIE = "cc_csrf";
    static final String TX_COOKIE_PREFIX = "cu_bff_tx_";
    static final String TX_COOKIE_PREFIX_DEV = "cu_bff_tx_dev_";

    private final IdentityProperties properties;
    private final BffSurfaceRegistry registry;
    private final BffSessionService sessions;

    public BffSessionController(IdentityProperties properties,
            BffSurfaceRegistry registry, BffSessionService sessions) {
        this.properties = properties;
        this.registry = registry;
        this.sessions = sessions;
    }

    @GetMapping("/login")
    public Object login(@RequestParam(name = "return", required = false) String returnPath,
            HttpServletRequest request, HttpServletResponse response) {
        Surface surface = requireBffSurface(registry.resolve(request));
        if (surface == null) {
            return problem(HttpStatus.NOT_FOUND, "SURFACE_UNKNOWN", "unknown surface");
        }
        String base = registry.baseFor(surface, request);
        var start = sessions.startLogin(surface, base,
                registry.safeReturnPath(surface, returnPath));
        noStore(response);
        // tx cookie: Lax so the top-level callback GET carries it, short
        // path so it dies with the transaction, name scoped per-login.
        response.addHeader(HttpHeaders.SET_COOKIE, cookie(
                txCookieName(start.txCookieName()), start.txCookieValue(),
                "/session/callback", "Lax", start.txCookieMaxAge(), false));
        return ResponseEntity.status(HttpStatus.FOUND)
                .header(HttpHeaders.LOCATION, start.authorizeUrl())
                .build();
    }

    @GetMapping("/callback")
    public Object callback(@RequestParam(name = "code", required = false) String code,
            @RequestParam(name = "state", required = false) String state,
            HttpServletRequest request, HttpServletResponse response) {
        Surface surface = registry.resolve(request);
        noStore(response);
        if (surface == null || !"BFF".equals(surface.getMode())) {
            return problem(HttpStatus.NOT_FOUND, "SURFACE_UNKNOWN", "unknown surface");
        }
        if (code == null || state == null) {
            return problem(HttpStatus.BAD_REQUEST, "CALLBACK_PARAMS", "missing code/state");
        }
        String base = registry.baseFor(surface, request);
        CallbackResult result = sessions.finishLogin(surface, base, code, state,
                request);
        // The tx cookie is dead either way — the browser must not carry it.
        expireTxCookies(request, response);
        if (!result.ok()) {
            return problem(HttpStatus.UNAUTHORIZED, result.failure(),
                    "sso callback rejected");
        }
        response.addHeader(HttpHeaders.SET_COOKIE, cookie(
                sessionCookieName(), result.cookieValue(), "/", "Strict",
                properties.getBff().getSessionTtl().toSeconds(), true));
        // Readable hint carrying the session csrfToken: AuthContext treats
        // its presence as "session exists" and the axios layer echoes it as
        // X-CSRF-Token — which is exactly what csrfGuard verifies.
        // SameSite=Strict mirrors the session cookie: the callback response
        // is cross-site (the browser just came back from the id host), and a
        // Lax cookie set there is stored "lax-allowing" — eligible only on
        // top-level navigations, never on same-site fetches or
        // document.cookie. Strict rides every same-site request once landed.
        response.addHeader(HttpHeaders.SET_COOKIE, readableCookie(
                CSRF_COOKIE, result.csrfToken(), "/", "Strict",
                properties.getBff().getSessionTtl().toSeconds()));
        return ResponseEntity.status(HttpStatus.FOUND)
                .header(HttpHeaders.LOCATION, base + result.redirectTo())
                .build();
    }

    /**
     * Post-logout landing (host-policy §6): the BFF owns this page — the
     * edge maps every /session/* path here, so a stale frontend can never
     * shadow the logged-out state. Minimal HTML by design; surfaces may
     * layer richer styling later without touching this contract.
     */
    @GetMapping("/logged-out")
    public ResponseEntity<String> loggedOut(HttpServletRequest request,
            HttpServletResponse response) {
        noStore(response);
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_TYPE, "text/html;charset=UTF-8")
                .body("<!doctype html><html><head><meta charset=\"utf-8\">"
                        + "<title>Đã đăng xuất</title></head><body>"
                        + "<h1>Bạn đã đăng xuất.</h1>"
                        + "<p><a href=\"/\">Về trang chủ</a></p>"
                        + "</body></html>");
    }

    @GetMapping("/state")
    public ResponseEntity<Map<String, Object>> state(HttpServletRequest request,
            HttpServletResponse response) {
        Surface surface = registry.resolve(request);
        noStore(response);
        if (surface == null || !"BFF".equals(surface.getMode())) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND)
                    .body(Map.of("error", "SURFACE_UNKNOWN"));
        }
        String originError = originGuard(request, surface);
        if (originError != null) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN)
                    .body(Map.of("error", originError));
        }
        ResolvedSession resolved = sessions.resolveForBusiness(surface,
                sessionCookieValue(request));
        if (!resolved.ok()) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                    .body(Map.of("error", resolved.failure()));
        }
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("userId", resolved.userId());
        body.put("surface", surface.getId());
        body.put("expiresAt", resolved.session().expiresAt().toString());
        body.put("csrfToken", csrfTokenFor(resolved.session()));
        return ResponseEntity.ok(body);
    }

    @PostMapping("/logout")
    public ResponseEntity<Map<String, Object>> logout(HttpServletRequest request,
            HttpServletResponse response) {
        Surface surface = registry.resolve(request);
        noStore(response);
        if (surface == null || !"BFF".equals(surface.getMode())) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND)
                    .body(Map.of("error", "SURFACE_UNKNOWN"));
        }
        String opaque = sessionCookieValue(request);
        // Idempotent logout (host-policy §3): when the session row is already
        // gone — revoked, expired, or swept by an earlier logout — the token
        // leg is meaningless, so only the Origin check applies and the id
        // logout URL is still returned (hint null). Skipping this left a
        // retried/double logout stranded: the browser never reached
        // /connect/logout and the id session silently re-authenticated.
        BffSessionStore.Session live = opaque == null
                ? null
                : sessions.findByOpaque(surface, opaque);
        boolean dead = live == null || live.revokedAt() != null;
        String csrfError = dead
                ? originGuard(request, surface)
                : csrfGuard(request, surface, opaque);
        if (csrfError != null) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN)
                    .body(Map.of("error", csrfError));
        }
        String base = registry.baseFor(surface, request);
        LogoutResult result = sessions.logout(surface, base, opaque);
        response.addHeader(HttpHeaders.SET_COOKIE, cookie(
                sessionCookieName(), "", "/", "Strict", 0, true));
        response.addHeader(HttpHeaders.SET_COOKIE, readableCookie(
                CSRF_COOKIE, "", "/", "Strict", 0));
        return ResponseEntity.ok(Map.of("logoutUrl", result.logoutUrl()));
    }

    /**
     * CSRF triple-check (host-policy §4): Origin == surface base,
     * Sec-Fetch-Site same-origin, and the session-bound token from
     * /bff/session/state. Returns the failure code or null when clean.
     */
    String csrfGuard(HttpServletRequest request, Surface surface, String opaque) {
        String origin = request.getHeader("Origin");
        String fetchSite = request.getHeader("Sec-Fetch-Site");
        String base = registry.baseFor(surface, request);
        boolean originOk = origin == null
                ? "same-origin".equals(fetchSite)
                : origin.equals(base);
        if (!originOk) {
            return "CSRF_ORIGIN";
        }
        if (fetchSite != null && !"same-origin".equals(fetchSite)) {
            return "CSRF_FETCH_SITE";
        }
        String token = request.getHeader("x-csrf-token");
        if (token == null || opaque == null) {
            return "CSRF_TOKEN";
        }
        BffSessionStore.Session session = sessions.findByOpaque(surface, opaque);
        if (!sessions.verifyCsrf(session, token)) {
            return "CSRF_TOKEN";
        }
        return null;
    }

    /**
     * Origin-presence check for read paths (host-policy §4): any Origin
     * header must equal the surface base — a browser same-site/cross-site
     * fetch always carries its own origin, so a foreign origin on a session
     * read means a sibling or third-party page is probing. Native clients
     * and same-origin navigations send no Origin and pass.
     */
    String originGuard(HttpServletRequest request, Surface surface) {
        String origin = request.getHeader("Origin");
        if (origin == null || origin.equals(registry.baseFor(surface, request))) {
            return null;
        }
        return "ORIGIN_SURFACE_MISMATCH";
    }

    private String csrfTokenFor(BffSessionStore.Session session) {
        return sessions.csrfTokenFor(session);
    }

    // ---- cookie plumbing -------------------------------------------------

    String sessionCookieName() {
        return properties.getBff().isDevHttp() ? SESSION_COOKIE_DEV : SESSION_COOKIE;
    }

    String txCookieName(String txName) {
        if (properties.getBff().isDevHttp()) {
            return txName.replace(TX_COOKIE_PREFIX, TX_COOKIE_PREFIX_DEV);
        }
        return txName;
    }

    private String sessionCookieValue(HttpServletRequest request) {
        Cookie[] cookies = request.getCookies();
        if (cookies == null) {
            return null;
        }
        String name = sessionCookieName();
        for (Cookie cookie : cookies) {
            if (name.equals(cookie.getName())) {
                return cookie.getValue();
            }
        }
        return null;
    }

    private void expireTxCookies(HttpServletRequest request, HttpServletResponse response) {
        Cookie[] cookies = request.getCookies();
        if (cookies == null) {
            return;
        }
        String prefix = properties.getBff().isDevHttp()
                ? TX_COOKIE_PREFIX_DEV : TX_COOKIE_PREFIX;
        for (Cookie cookie : cookies) {
            if (cookie.getName().startsWith(prefix)) {
                response.addHeader(HttpHeaders.SET_COOKIE, cookie(
                        cookie.getName(), "", "/session/callback", "Lax", 0, false));
            }
        }
    }

    private String cookie(String name, String value, String path,
            String sameSite, long maxAgeSeconds, boolean sessionScope) {
        ResponseCookie.ResponseCookieBuilder builder = ResponseCookie
                .from(name, value)
                .httpOnly(true)
                .secure(!properties.getBff().isDevHttp())
                .path(path)
                .sameSite(sameSite)
                .maxAge(maxAgeSeconds);
        // No Domain ever: host-only is the cookie-tossing defense.
        return builder.build().toString();
    }

    /** Non-HttpOnly twin of {@link #cookie} — only the csrf hint uses it. */
    private String readableCookie(String name, String value, String path,
            String sameSite, long maxAgeSeconds) {
        return ResponseCookie.from(name, value)
                .httpOnly(false)
                .secure(!properties.getBff().isDevHttp())
                .path(path)
                .sameSite(sameSite)
                .maxAge(maxAgeSeconds)
                .build().toString();
    }

    private static void noStore(HttpServletResponse response) {
        response.setHeader(HttpHeaders.CACHE_CONTROL, "no-store");
    }

    private Surface requireBffSurface(Surface surface) {
        return surface != null && "BFF".equals(surface.getMode()) ? surface : null;
    }

    private static ResponseEntity<Map<String, Object>> problem(
            HttpStatus status, String code, String message) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("error", code);
        body.put("message", message);
        return ResponseEntity.status(status).body(body);
    }
}
