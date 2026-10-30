package io.campuscore.restfulapi.identity.bff;

import io.campuscore.restfulapi.identity.IdentityProperties;
import io.campuscore.restfulapi.identity.IdentityProperties.Surface;
import jakarta.servlet.http.HttpServletRequest;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

/**
 * Server-side host → surface registry (host-policy §1). The surface is never
 * taken from a query parameter or a self-declared Origin: the first-party
 * edge proxy computes it from the public Host header and forwards it as
 * {@code X-Campuscore-Surface}, trusted only when the shared
 * {@code X-Campuscore-Proxy-Token} matches. Direct-to-Java calls are dev/test
 * only — outside dev profiles the literal Host fallback is disabled so a
 * caller reaching the Java origin cannot self-declare a surface.
 */
@ConditionalOnProperty(prefix = "identity.bff", name = "enabled", havingValue = "true")
@Component
public class BffSurfaceRegistry {

    public static final String SURFACE_HEADER = "X-Campuscore-Surface";
    public static final String SCHEME_HEADER = "X-Campuscore-Scheme";
    public static final String HOST_HEADER = "X-Campuscore-Host";
    public static final String PROXY_TOKEN_HEADER = "X-Campuscore-Proxy-Token";

    private final IdentityProperties properties;
    private final String proxyToken;
    private final boolean hostFallbackAllowed;
    private final Map<String, Surface> byId;
    private final Map<String, Surface> byHost;

    public BffSurfaceRegistry(IdentityProperties properties,
            @org.springframework.beans.factory.annotation.Value(
                    "${app.rate-limit.proxy-token:}") String proxyToken,
            org.springframework.core.env.Environment environment) {
        this.properties = properties;
        this.proxyToken = proxyToken == null ? "" : proxyToken.trim();
        this.hostFallbackAllowed = BffConfiguration.isDevEnvironment(environment);
        this.byId = new java.util.LinkedHashMap<>();
        this.byHost = new java.util.LinkedHashMap<>();
        for (Surface surface : properties.getBff().getSurfaces()) {
            if (surface.getId() == null || surface.getId().isBlank()) {
                continue;
            }
            byId.put(surface.getId(), surface);
            for (String host : surface.getHosts()) {
                byHost.put(bareHost(host), surface);
            }
        }
    }

    public List<Surface> surfaces() {
        return List.copyOf(byId.values());
    }

    public Surface byId(String id) {
        return id == null ? null : byId.get(id);
    }

    /** The configured shared edge token — forwarded on trusted loopback calls. */
    public String proxyToken() {
        return proxyToken;
    }

    /** True when this request carries the valid shared edge token. */
    public boolean proxyTokenValid(HttpServletRequest request) {
        return !proxyToken.isEmpty()
                && proxyToken.equals(request.getHeader(PROXY_TOKEN_HEADER));
    }

    /**
     * Resolves the request surface. Proxy header wins only with a valid
     * shared token; otherwise the literal Host is consulted — but only in
     * dev/test profiles, so a forged Host cannot self-declare a surface on
     * a production deployment. Returns null for unknown hosts — callers
     * fail closed.
     */
    public Surface resolve(HttpServletRequest request) {
        if (proxyTokenValid(request)) {
            Surface surface = byId(request.getHeader(SURFACE_HEADER));
            if (surface != null) {
                return surface;
            }
        }
        return hostFallbackAllowed
                ? byHost.get(bareHost(request.getHeader("Host")))
                : null;
    }

    /** Bare hostname — a Host header or registry entry may carry :port. */
    private static String bareHost(String host) {
        if (host == null) {
            return "";
        }
        String bare = host.trim().toLowerCase(Locale.ROOT);
        int colon = bare.indexOf(':');
        return colon > 0 ? bare.substring(0, colon) : bare;
    }

    /** Stamped host is honored only when it is one of the surface's
     * registered hosts — a valid token must not let the edge poison the
     * public base URL onto an arbitrary host. */
    private boolean hostAllowed(Surface surface, String stampedHost) {
        String bare = bareHost(stampedHost);
        for (String configured : surface.getHosts()) {
            if (bareHost(configured).equals(bare)) {
                return true;
            }
        }
        return false;
    }

    /**
     * The public base URL for a surface within a request. In production the
     * edge forwards the original public host/scheme (the Java runtime only
     * sees the internal upstream host), trusted only with a valid proxy
     * token AND only when the stamped host is registered for this surface;
     * anything else degrades to the canonical publicBaseUrl. Direct-to-Java
     * dev calls fall back to the literal request; outside dev profiles a
     * request without a valid token cannot mint a fake base.
     */
    public String baseFor(Surface surface, HttpServletRequest request) {
        if (proxyTokenValid(request)) {
            String scheme = request.getHeader(SCHEME_HEADER);
            String host = request.getHeader(HOST_HEADER);
            if (host != null && ("https".equals(scheme) || "http".equals(scheme))
                    && hostAllowed(surface, host)) {
                return scheme + "://" + host;
            }
            return surface.getPublicBaseUrl();
        }
        if (hostFallbackAllowed) {
            return request.getScheme() + "://" + request.getHeader("Host");
        }
        return surface.getPublicBaseUrl();
    }

    /**
     * Exact callback URI registered for a surface client — must match the
     * OIDC client registration byte for byte.
     */
    public String callbackUri(Surface surface, String base) {
        return base + "/session/callback";
    }

    public String postLogoutUri(Surface surface, String base) {
        return base + "/session/logged-out";
    }

    /**
     * Deep return-path allowlist: relative, single leading slash, no scheme
     * or protocol-relative trickery, and inside the surface's configured
     * prefixes. Anything else falls back to '/'.
     */
    public String safeReturnPath(Surface surface, String candidate) {
        if (candidate == null || candidate.isBlank() || !candidate.startsWith("/")
                || candidate.startsWith("//") || candidate.contains("\\")
                || candidate.toLowerCase(Locale.ROOT).startsWith("/\\")) {
            return "/";
        }
        String lower = candidate.toLowerCase(Locale.ROOT);
        if (lower.startsWith("/session") || lower.startsWith("/bff") || lower.startsWith("/api")) {
            return "/";
        }
        List<String> prefixes = surface.getReturnPrefixes();
        if (prefixes.isEmpty()) {
            return "/";
        }
        for (String prefix : prefixes) {
            if (candidate.equals(prefix) || candidate.startsWith(prefix.endsWith("/")
                    ? prefix : prefix + "/") || candidate.startsWith(prefix + "?")) {
                return candidate;
            }
        }
        return "/";
    }
}
