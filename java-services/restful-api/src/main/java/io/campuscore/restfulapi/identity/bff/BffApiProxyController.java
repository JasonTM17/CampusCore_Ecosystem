package io.campuscore.restfulapi.identity.bff;

import io.campuscore.restfulapi.identity.IdentityProperties;
import io.campuscore.restfulapi.identity.IdentityProperties.Surface;
import io.campuscore.restfulapi.identity.bff.BffSessionService.ResolvedSession;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.ByteArrayOutputStream;
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
import org.springframework.util.unit.DataSize;
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
            "x-campuscore-client-ip", "x-assistant-owner",
            "x-assistant-owner-assertion", "host", "content-length",
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

    /**
     * Largest body any allowlisted route legitimately accepts. Multipart
     * uploads are bounded by spring.servlet.multipart.max-request-size (21 MB
     * in production, one megabyte above the 20 MB file limit); every other
     * write is JSON, which the resource lane caps at 1 MB. The same sizes
     * bound upstream responses: the largest legitimate one is a 20 MB file
     * download. Bodies above their ceiling are answered 413 before the proxy
     * buffers them, so an authenticated caller cannot hand the heap an
     * arbitrary body (the JSON filter deliberately ignores non-JSON types and
     * the servlet multipart limits only run once a part is parsed).
     */
    private static final long MAX_JSON_BODY_BYTES = 1024 * 1024L;
    private static final long DEFAULT_MULTIPART_BYTES = 1024 * 1024L;
    private static final int READ_CHUNK_BYTES = 8192;

    private final IdentityProperties properties;
    private final BffSurfaceRegistry registry;
    private final BffSessionService sessions;
    private final BffSessionController sessionEndpoints;
    private final int loopbackPort;
    private final long maxMultipartRequestBytes;
    private final long maxUpstreamResponseBytes;
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
        this.maxMultipartRequestBytes = dataSize(environment,
                "spring.servlet.multipart.max-request-size", DEFAULT_MULTIPART_BYTES);
        this.maxUpstreamResponseBytes = Math.max(maxMultipartRequestBytes,
                dataSize(environment, "spring.servlet.multipart.max-file-size",
                        DEFAULT_MULTIPART_BYTES));
    }

    private static long dataSize(org.springframework.core.env.Environment environment,
            String property, long fallback) {
        String configured = environment.getProperty(property);
        if (configured == null || configured.isBlank()) {
            return fallback;
        }
        try {
            return DataSize.parse(configured).toBytes();
        } catch (IllegalArgumentException invalid) {
            return fallback;
        }
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
        byte[] requestBody = null;
        if (!"GET".equals(method) && !"HEAD".equals(method)) {
            long ceiling = requestBodyCeiling(request);
            long declared = request.getContentLengthLong();
            if (declared > ceiling) {
                return tooLarge();
            }
            requestBody = readWithinCeiling(request.getInputStream(), ceiling);
            if (requestBody == null) {
                return tooLarge();
            }
        }
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
            if (stripsRequestHeader(lower) || JDK_RESTRICTED.contains(lower)) {
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
            long declared = upstreamResponse.headers()
                    .firstValueAsLong(HttpHeaders.CONTENT_LENGTH).orElse(-1);
            if (declared > maxUpstreamResponseBytes) {
                return json(HttpStatus.BAD_GATEWAY, "UPSTREAM_RESPONSE_TOO_LARGE");
            }
            payload = body == null ? new byte[0]
                    : readWithinCeiling(body, maxUpstreamResponseBytes);
        }
        if (payload == null) {
            return json(HttpStatus.BAD_GATEWAY, "UPSTREAM_RESPONSE_TOO_LARGE");
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

    private long requestBodyCeiling(HttpServletRequest request) {
        String contentType = request.getContentType();
        if (contentType != null
                && contentType.toLowerCase(Locale.ROOT).startsWith("multipart/")) {
            return maxMultipartRequestBytes;
        }
        return MAX_JSON_BODY_BYTES;
    }

    private static ResponseEntity<byte[]> tooLarge() {
        return json(HttpStatus.PAYLOAD_TOO_LARGE, "REQUEST_BODY_TOO_LARGE");
    }

    /**
     * Returns the body, or null as soon as it exceeds the ceiling. The
     * declared length only allows the cheap rejection above; the bytes are
     * counted while buffering here so a lying or chunked length cannot make
     * the proxy read an unbounded body.
     */
    private static byte[] readWithinCeiling(InputStream input, long ceiling)
            throws IOException {
        ByteArrayOutputStream buffer = new ByteArrayOutputStream(
                (int) Math.min(ceiling, READ_CHUNK_BYTES));
        byte[] chunk = new byte[READ_CHUNK_BYTES];
        long total = 0;
        int read;
        while ((read = input.read(chunk)) != -1) {
            total += read;
            if (total > ceiling) {
                return null;
            }
            buffer.write(chunk, 0, read);
        }
        return buffer.toByteArray();
    }

    static boolean stripsRequestHeader(String name) {
        return name != null && STRIP_REQUEST.contains(name.toLowerCase(Locale.ROOT));
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
                .body(("{\"error\":\"" + code + "\",\"code\":\"" + code + "\"}").getBytes(
                        java.nio.charset.StandardCharsets.UTF_8));
    }
}
