package io.campuscore.restfulapi.identity.bff;

import io.campuscore.restfulapi.identity.IdentityProperties;
import io.campuscore.restfulapi.identity.IdentityProperties.Surface;
import io.campuscore.restfulapi.identity.bff.BffSessionService.ResolvedSession;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.Enumeration;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.web.bind.annotation.RestController;

/**
 * Same-origin business proxy (host-policy §5): resolves the opaque session,
 * single-flights any needed refresh in-process (no DB locks are held across
 * loopback calls — the resource lane takes its own locks on its own
 * connection), then forwards to the resource API over loopback with the
 * grant's access token and the per-surface BFF credential. The browser never
 * sees a token body, an upstream credential, or a Set-Cookie from the
 * business lane.
 */
@ConditionalOnProperty(prefix = "identity.bff", name = "enabled", havingValue = "true")
@RestController
public class BffApiProxyController {

    private static final String PREFIX = "/bff/api/";
    private static final List<String> STRIP_REQUEST = List.of(
            "cookie", "authorization", "x-forwarded-for", "x-forwarded-host",
            "x-forwarded-proto", "x-real-ip", "x-campuscore-surface",
            "x-campuscore-scheme", "x-campuscore-host",
            "x-campuscore-proxy-token", "x-campuscore-bff-secret",
            "x-campuscore-client-ip", "host", "content-length",
            "transfer-encoding", "connection");
    // Hop-by-hop plus anything that could carry credentials downstream —
    // an upstream Set-Cookie or WWW-Authenticate must never reach a BFF
    // browser (host-policy §5).
    private static final List<String> STRIP_RESPONSE = List.of(
            "transfer-encoding", "content-length", "connection", "set-cookie",
            "keep-alive", "te", "trailer", "upgrade",
            "www-authenticate", "proxy-authenticate", "authorization");
    // The JDK transport reserves these names (it owns them per exchange);
    // setting them manually throws, so they are dropped like the stripped
    // hop-by-hop headers above. Nothing else the STRIP list misses may pass.
    private static final List<String> JDK_RESTRICTED = List.of(
            "connection", "content-length", "expect", "host", "upgrade");

    private final IdentityProperties properties;
    private final BffSurfaceRegistry registry;
    private final BffSessionService sessions;
    private final BffSessionController sessionEndpoints;
    private final int loopbackPort;
    // Loopback-only transport: HTTP/1.1, no redirect chasing, and the same
    // 5s connect / 30s response ceilings the previous per-request wiring had.
    // Unlike HttpURLConnection it supports every verb (PATCH included).
    private final HttpClient http = HttpClient.newBuilder()
            .version(HttpClient.Version.HTTP_1_1)
            .connectTimeout(Duration.ofMillis(5000))
            .followRedirects(HttpClient.Redirect.NEVER)
            .build();

    public BffApiProxyController(IdentityProperties properties,
            BffSurfaceRegistry registry, BffSessionService sessions,
            BffSessionController sessionEndpoints,
            org.springframework.core.env.Environment environment) {
        this.properties = properties;
        this.registry = registry;
        this.sessions = sessions;
        this.sessionEndpoints = sessionEndpoints;
        String port = environment.getProperty("local.server.port",
                environment.getProperty("server.port", "4010"));
        this.loopbackPort = Integer.parseInt(port);
    }

    @RequestMapping("/bff/api/**")
    public ResponseEntity<byte[]> proxy(HttpServletRequest request,
            HttpServletResponse response) throws IOException {
        Surface surface = registry.resolve(request);
        if (surface == null || !"BFF".equals(surface.getMode())) {
            return json(HttpStatus.NOT_FOUND, "SURFACE_UNKNOWN");
        }
        String upstream = upstreamPath(request);
        if (upstream == null) {
            return json(HttpStatus.NOT_FOUND, "PATH_NOT_ALLOWED");
        }
        // Origin-presence check on EVERY method (R1 hardening): a credentialed
        // same-site sibling fetch always carries its own Origin — a foreign
        // one must never read session-scoped data even when CORS is wide.
        String originError = sessionEndpoints.originGuard(request, surface);
        if (originError != null) {
            return json(HttpStatus.FORBIDDEN, originError);
        }
        String opaque = sessionCookieValue(request);
        String method = request.getMethod();
        if (!"GET".equals(method) && !"HEAD".equals(method)) {
            String csrfError = sessionEndpoints.csrfGuard(request, surface, opaque);
            if (csrfError != null) {
                return json(HttpStatus.FORBIDDEN, csrfError);
            }
        }
        ResolvedSession resolved = sessions.resolveForBusiness(surface, opaque);
        if (!resolved.ok()) {
            // Anonymous public lane (P06, host-policy §5a): with NO session
            // cookie at all, a GET/HEAD onto the public allowlist proxies
            // without a bearer — upstream permitAll is the authority. A
            // present-but-invalid cookie still fails closed so a stale
            // session never silently downgrades to anonymous.
            if (opaque == null && isPublicPath(upstream)
                    && ("GET".equals(method) || "HEAD".equals(method))) {
                return forward(request, upstream, surface, null);
            }
            HttpStatus status = "ACCOUNT_INELIGIBLE".equals(resolved.failure())
                    || "PASSWORD_CHANGE_REQUIRED".equals(resolved.failure())
                    ? HttpStatus.FORBIDDEN : HttpStatus.UNAUTHORIZED;
            return json(status, resolved.failure());
        }
        return forward(request, upstream, surface, resolved.accessToken());
    }

    private ResponseEntity<byte[]> forward(HttpServletRequest request,
            String upstream, Surface surface, String accessToken)
            throws IOException {
        String method = request.getMethod();
        byte[] requestBody = "GET".equals(method) || "HEAD".equals(method)
                ? null
                : request.getInputStream().readAllBytes();
        HttpRequest.Builder builder = HttpRequest.newBuilder()
                .uri(URI.create("http://127.0.0.1:" + loopbackPort + upstream
                        + (request.getQueryString() == null ? "" : "?" + request.getQueryString())))
                .timeout(Duration.ofMillis(30000))
                .method(method, requestBody == null
                        ? HttpRequest.BodyPublishers.noBody()
                        : HttpRequest.BodyPublishers.ofByteArray(requestBody));

        Enumeration<String> names = request.getHeaderNames();
        while (names.hasMoreElements()) {
            String name = names.nextElement();
            String lower = name.toLowerCase(Locale.ROOT);
            if (STRIP_REQUEST.contains(lower) || JDK_RESTRICTED.contains(lower)) {
                continue;
            }
            Enumeration<String> values = request.getHeaders(name);
            while (values.hasMoreElements()) {
                builder.header(name, values.nextElement());
            }
        }
        if (accessToken != null) {
            builder.header("Authorization", "Bearer " + accessToken);
        }
        builder.header(BffSurfaceRegistry.SURFACE_HEADER, surface.getId());
        if (!surface.getProxySecret().isEmpty()) {
            builder.header("X-Campuscore-Bff-Secret", surface.getProxySecret());
        }
        // The BFF is the edge for this lane: upstream rate-limit/audit must
        // see the real caller IP, not the loopback. The shared proxy token
        // rides along so the upstream trust gate actually honors the pair —
        // the caller's X-Campuscore-Client-Ip is only re-forwarded when the
        // inbound edge authenticated with that same token; anything else is
        // a client-controlled value we replace with the socket peer.
        String clientIp = registry.proxyTokenValid(request)
                && request.getHeader("X-Campuscore-Client-Ip") != null
                ? request.getHeader("X-Campuscore-Client-Ip")
                : request.getRemoteAddr();
        if (!registry.proxyToken().isEmpty()) {
            builder.header(BffSurfaceRegistry.PROXY_TOKEN_HEADER,
                    registry.proxyToken());
        }
        builder.header("X-Campuscore-Client-Ip", clientIp);

        HttpResponse<InputStream> upstreamResponse;
        try {
            upstreamResponse = http.send(builder.build(),
                    HttpResponse.BodyHandlers.ofInputStream());
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            return json(HttpStatus.BAD_GATEWAY, "UPSTREAM_UNREACHABLE");
        } catch (IOException exception) {
            return json(HttpStatus.BAD_GATEWAY, "UPSTREAM_UNREACHABLE");
        }
        int status = upstreamResponse.statusCode();
        byte[] payload;
        try (InputStream body = upstreamResponse.body()) {
            payload = body == null ? new byte[0] : body.readAllBytes();
        }
        org.springframework.http.HttpHeaders headers = new org.springframework.http.HttpHeaders();
        upstreamResponse.headers().map().forEach((name, values) -> {
            if (name == null || STRIP_RESPONSE.contains(name.toLowerCase(Locale.ROOT))) {
                return;
            }
            values.forEach(value -> headers.add(name, value));
        });
        // Private BFF responses never carry a cache directive from upstream
        // defaults — force no-store for session-scoped traffic.
        if (headers.getFirst(HttpHeaders.CACHE_CONTROL) == null) {
            headers.set(HttpHeaders.CACHE_CONTROL, "no-store");
        }
        return ResponseEntity.status(status).headers(headers).body(payload);
    }

    /**
     * Allowlist gate: /bff/api/** maps onto /api/v1/** only when the suffix
     * matches a configured prefix — no path reaches upstream unaudited.
     */
    private String upstreamPath(HttpServletRequest request) {
        String path = request.getRequestURI();
        if (!path.startsWith(PREFIX)) {
            return null;
        }
        String suffix = path.substring(PREFIX.length() - 1); // keep leading '/'
        String upstream = "/api/v1" + suffix;
        for (String allowed : properties.getBff().getApiAllowlist()) {
            if (upstream.equals(allowed) || upstream.startsWith(allowed + "/")
                    || upstream.startsWith(allowed + "?")) {
                return upstream;
            }
        }
        for (String allowed : properties.getBff().getPublicApiAllowlist()) {
            if (upstream.equals(allowed) || upstream.startsWith(allowed + "/")
                    || upstream.startsWith(allowed + "?")) {
                return upstream;
            }
        }
        return null;
    }

    /** Same prefix semantics as {@link #upstreamPath} — the anonymous set. */
    private boolean isPublicPath(String upstream) {
        for (String allowed : properties.getBff().getPublicApiAllowlist()) {
            if (upstream.equals(allowed) || upstream.startsWith(allowed + "/")
                    || upstream.startsWith(allowed + "?")) {
                return true;
            }
        }
        return false;
    }

    private String sessionCookieValue(HttpServletRequest request) {
        jakarta.servlet.http.Cookie[] cookies = request.getCookies();
        if (cookies == null) {
            return null;
        }
        String name = sessionEndpoints.sessionCookieName();
        for (jakarta.servlet.http.Cookie cookie : cookies) {
            if (name.equals(cookie.getName())) {
                return cookie.getValue();
            }
        }
        return null;
    }

    private static ResponseEntity<byte[]> json(HttpStatus status, String code) {
        return ResponseEntity.status(status)
                .header(HttpHeaders.CONTENT_TYPE, "application/json")
                .body(("{\"error\":\"" + code + "\"}").getBytes(
                        java.nio.charset.StandardCharsets.UTF_8));
    }
}
