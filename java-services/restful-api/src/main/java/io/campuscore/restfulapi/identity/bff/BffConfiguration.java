package io.campuscore.restfulapi.identity.bff;

import java.util.List;
import java.util.Set;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.env.Environment;

import io.campuscore.restfulapi.identity.IdentityProperties;

/**
 * Startup invariants for the BFF lane (host-policy §8 flag matrix). A
 * misconfigured lane must refuse to boot rather than run degraded: silent
 * fallbacks here are exactly how cookie isolation dies in production.
 */
@Configuration
@ConditionalOnProperty(prefix = "identity.bff", name = "enabled", havingValue = "true")
public class BffConfiguration {

    /**
     * Profiles where dev conveniences are allowed: plain-HTTP cookies,
     * unprefixed names, the Host-header surface fallback, and an unset
     * shared proxy token. The production profile here is `persistence`, so
     * it is deliberately ABSENT — on a real deployment every convenience
     * fails closed. Any deployment running one of these profiles (or none)
     * is a dev/test lane.
     */
    static final Set<String> DEV_PROFILES = Set.of(
            "local", "dev", "test", "e2e", "h2");

    public BffConfiguration(IdentityProperties properties, Environment environment,
            @org.springframework.beans.factory.annotation.Value(
                    "${app.rate-limit.proxy-token:}") String proxyToken) {
        IdentityProperties.Bff bff = properties.getBff();
        if (!properties.getOidc().isEnabled()) {
            throw new IllegalStateException(
                    "identity.bff.enabled requires identity.oidc.enabled=true —"
                            + " the BFF is a confidential client of this SAS");
        }
        boolean devEnvironment = isDevEnvironment(environment);
        if (bff.isDevHttp() && !devEnvironment) {
            throw new IllegalStateException(
                    "identity.bff.dev-http is forbidden outside profiles "
                            + DEV_PROFILES + " — production cookies must"
                            + " be Secure and __Host- prefixed");
        }
        if (!devEnvironment && (proxyToken == null || proxyToken.isBlank())) {
            throw new IllegalStateException(
                    "identity.bff.enabled outside dev profiles requires"
                            + " app.rate-limit.proxy-token — without it the"
                            + " edge-stamped x-campuscore-* headers cannot be"
                            + " authenticated and the lane runs unverified");
        }
        if (bff.getSurfaces().isEmpty()) {
            throw new IllegalStateException(
                    "identity.bff.enabled requires at least one surface entry");
        }
        for (IdentityProperties.Surface surface : bff.getSurfaces()) {
            if (surface.getId() == null || surface.getId().isBlank()) {
                throw new IllegalStateException("BFF surface missing id");
            }
            if ("BFF".equals(surface.getMode())) {
                require(surface.getClientId(), surface.getId(), "client-id");
                require(surface.getClientSecret(), surface.getId(), "client-secret");
                // The proxy secret is the only thing separating a browser's
                // self-declared surface header from the real loopback proxy —
                // per-surface, never shared (host-policy §2.2).
                require(surface.getProxySecret(), surface.getId(), "proxy-secret");
                require(surface.getPublicBaseUrl(), surface.getId(), "public-base-url");
            } else if ("REDIRECT".equals(surface.getMode())) {
                require(surface.getRedirectTarget(), surface.getId(), "redirect-target");
            }
        }
    }

    /** True when any active profile is a dev/test lane (or none configured). */
    static boolean isDevEnvironment(Environment environment) {
        String[] active = environment.getActiveProfiles();
        if (active.length == 0) {
            return true;
        }
        for (String profile : active) {
            if (DEV_PROFILES.contains(profile)) {
                return true;
            }
        }
        return false;
    }

    private static void require(String value, String surfaceId, String field) {
        if (value == null || value.isBlank()) {
            throw new IllegalStateException(
                    "BFF surface " + surfaceId + " requires " + field);
        }
    }
}
