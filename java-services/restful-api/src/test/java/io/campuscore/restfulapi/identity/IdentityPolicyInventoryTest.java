package io.campuscore.restfulapi.identity;

import static org.assertj.core.api.Assertions.assertThat;

import java.lang.reflect.Method;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.util.Map;
import java.util.TreeMap;
import org.junit.jupiter.api.Test;
import org.springframework.core.MethodIntrospector;
import org.springframework.core.io.support.PathMatchingResourcePatternResolver;
import org.springframework.core.type.classreading.CachingMetadataReaderFactory;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.RequestMappingInfo;
import org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerMapping;

/**
 * Reviewed identity policy exceptions. Public means filter-permitted, not
 * unauthenticated business access. Keep reasons here and identity-contract §5
 * in sync. A new handler or a changed bypass predicate requires an explicit
 * inventory review; behavior tests remain the authority for correctness.
 */
class IdentityPolicyInventoryTest {
    private static final String BASE = "io.campuscore.restfulapi.identity.";
    private record PublicPolicy(String route, String reason) {}
    private static final Map<String, PublicPolicy> PUBLIC_HANDLERS = Map.of(
            "IdentityLoginPageController#loginPage", new PublicPolicy("GET /login", "Public login HTML; return restricted to local authorize path"),
            "bff.BffSessionController#login", new PublicPolicy("GET /session/login", "Public SSO start; relative return allowlist and transaction binding"),
            "bff.BffSessionController#callback", new PublicPolicy("GET /session/callback", "Public callback; one-use state, transaction cookie, PKCE and nonce"),
            "bff.BffSessionController#loggedOut", new PublicPolicy("GET /session/logged-out", "Public static landing; performs no revocation"),
            "bff.BffSessionController#state", new PublicPolicy("GET /session/state", "Opaque-session authentication and Origin guard inside handler"),
            "bff.BffSessionController#logout", new PublicPolicy("POST /session/logout", "Live session triple-check; dead session Origin-only idempotence"),
            "bff.BffApiProxyController#proxy", new PublicPolicy("ANY /bff/api/**", "Opaque-session/CSRF authority; no-cookie public GET/HEAD allowlist"));

    private record ExceptionPolicy(String file, String method, String digest, String reason) {}

    // Digests cover executable policy bodies, ignoring comments and whitespace.
    // They intentionally require review even for a contract-preserving policy edit.
    private static final java.util.List<ExceptionPolicy> EXCEPTIONS = java.util.List.of(
            new ExceptionPolicy("identity/IdentitySecurityConfig.java", "identityServerChain", "96b0524911d1c0bbdf36507b817c9b057e692ea73e0f987643b59dd4af922e70",
                    "SAS framework CSRF disabled for protocol clients; cookie filter runs before endpoints; GET is safe-method exempt"),
            new ExceptionPolicy("identity/IdentitySecurityConfig.java", "handleLogout", "a41823ad839bbe50d65146509a491e66f77f20118ac107750a5d5d6aca09ed80",
                    "GET/POST exact registered redirect; best-effort revoke failure still reports success (AUD-06 proposal)"),
            new ExceptionPolicy("security/CsrfCookieFilter.java", "doFilterInternal", "ec3dd921a2eefda5e92a4ab20958e74f99f8a1dd2265c356b64f42764f6bdc22",
                    "Safe methods, Bearer, no legacy auth cookies, /bff/ and /session/ bypass legacy double-submit"),
            new ExceptionPolicy("security/AccountStateFilter.java", "isSessionCleanupEndpoint", "60104c1a3af7f0832756cd39ff1221442b29efdadf3af871f0d439f2ae394226",
                    "Legacy login, 2FA, recovery, logout and refresh exempt from current credential-state check"),
            new ExceptionPolicy("identity/bff/BffSessionController.java", "logout", "a8732a4b402deafdd1e6dd6d34464a5d873eaf7c8dc5197255067b60d820d867",
                    "Dead-session logout skips token check, Origin-only idempotence; no-cookie logout public"),
            new ExceptionPolicy("identity/bff/BffSessionController.java", "csrfGuard", "3b48f741506f2de0cedd875b541213bf34073ab262c48b1f93b898e4edec85ec",
                    "Absent Origin accepted only with same-origin Fetch Metadata; Referer not consulted"),
            new ExceptionPolicy("identity/bff/BffSessionController.java", "originGuard", "d0617549fa2692e24cb5c4fae6f274753feefa60eb11c94032670b7fe652ffb9",
                    "Absent Origin allowed on reads and dead-session logout; Referer not consulted"),
            new ExceptionPolicy("identity/bff/BffApiProxyController.java", "proxy", "247b1cab0ad5d7edebf5c538f1db4cd5541114c458292797eb9a14189511a899",
                    "No-cookie GET/HEAD configured public paths may proxy anonymously; stale cookie cannot downgrade"),
            new ExceptionPolicy("identity/bff/BffSurfaceRegistry.java", "safeReturnPath", "15931a3c2ee34bc75d77fdb1a222a4184f8cdcd687b70156fe301fa3453aa5c4",
                    "Configured root prefix permits relative local paths; reserved prefixes rejected; invalid input falls back to root"),
            new ExceptionPolicy("security/CsrfCookieFilter.java", "isSafeMethod", "7c983b3a3a474ab60392bd4e58810ce2f38ab4338af6456dd9bb2c2284760232",
                    "Only GET, HEAD and OPTIONS are legacy cookie-CSRF safe methods"),
            new ExceptionPolicy("security/CsrfCookieFilter.java", "hasBearerHeader", "1999c88ee472ec1215795cbb1655449490c4bde07a2703951fdd270211aba1d9",
                    "Explicit Bearer transport exempts double-submit even if legacy cookies coexist"),
            new ExceptionPolicy("security/CsrfCookieFilter.java", "hasSessionCookie", "65f1a4cbf9b48f2c4aa249cc67ee5a49545dc729231ef75732dbcf81f71d8db1",
                    "Only access/refresh cookies trigger legacy double-submit; BFF cookies use their own authority"),
            new ExceptionPolicy("identity/bff/BffConfiguration.java", "isDevEnvironment", "e88e295632ca3fca620a20b21838b1726cb26bc98bcd14093bce7dfddb2c7cce",
                    "Explicit dev/test profiles or no active profile permit non-TLS dev cookies and Host fallback"),
            new ExceptionPolicy("identity/bff/BffSurfaceRegistry.java", "resolve", "2604d2a09d8f7d2eb4f781ca6f4a394024e7c196c589cfb535733a10bc09bca2",
                    "Host fallback only in dev/test; production requires trusted edge surface context"),
            new ExceptionPolicy("identity/bff/BffSurfaceRegistry.java", "baseFor", "e3662050c8d1251357be51095acec990c0e23e8531a268bb5623e31d8b267d6d",
                    "Trusted registered edge host or dev request may set base; other input uses configured canonical base"),
            new ExceptionPolicy("identity/bff/BffProxyAuthFilter.java", "shouldNotFilter", "d02aa80f1f487b5ee40308787dbd453ac90d0b16a3cbf0178ed8da0532477e2d",
                    "Legacy no-surface requests and paths outside /api/v1/ skip per-surface proxy credential check"));

    @Test
    void everyIdentityPublicHandlerIsInventoriedEvenWhenItsFlagIsDisabled() throws Exception {
        var resolver = new PathMatchingResourcePatternResolver();
        var metadata = new CachingMetadataReaderFactory(resolver);
        var mappings = new DeclaredMappings();
        Map<String, String> actual = new TreeMap<>();
        for (var resource : resolver.getResources("classpath*:io/campuscore/restfulapi/identity/**/*.class")) {
            var reader = metadata.getMetadataReader(resource);
            var annotations = reader.getAnnotationMetadata();
            if (!annotations.hasAnnotation(RestController.class.getName())
                    && !annotations.hasMetaAnnotation(RestController.class.getName())) continue;
            Class<?> controller = Class.forName(reader.getClassMetadata().getClassName(), false, getClass().getClassLoader());
            MethodIntrospector.selectMethods(controller,
                    (MethodIntrospector.MetadataLookup<RequestMappingInfo>) method -> mappings.forMethod(method, controller))
                    .forEach((method, mapping) -> actual.put(controller.getName().substring(BASE.length())
                            + "#" + method.getName(), (mapping.getMethodsCondition().getMethods().isEmpty()
                                    ? "ANY" : mapping.getMethodsCondition().getMethods().stream()
                                            .map(Enum::name).sorted().collect(java.util.stream.Collectors.joining("|")))
                            + " " + mapping.getPatternValues().stream().sorted()
                                    .collect(java.util.stream.Collectors.joining("|"))));
        }
        assertThat(actual).as("public identity mappings and aliases require explicit policy inventory")
                .isEqualTo(PUBLIC_HANDLERS.entrySet().stream().collect(java.util.stream.Collectors.toMap(
                        Map.Entry::getKey, entry -> entry.getValue().route())));
        assertThat(PUBLIC_HANDLERS.values()).allMatch(policy -> !policy.reason().isBlank());
    }

    @Test
    void exceptionPredicatesCannotChangeWithoutInventoryReview() throws Exception {
        Path sourceRoot = Path.of("src/main/java/io/campuscore/restfulapi");
        for (ExceptionPolicy policy : EXCEPTIONS) {
            assertThat(policy.reason()).isNotBlank();
            String source = Files.readString(sourceRoot.resolve(policy.file()));
            String body = policyBody(source, policy.method());
            String digest = java.util.HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                    .digest(body.getBytes(StandardCharsets.UTF_8)));
            assertThat(digest).as("Unreviewed exception policy: %s#%s (%s)",
                    policy.file(), policy.method(), policy.reason()).isEqualTo(policy.digest());
        }
    }

    @Test
    void anonymousProxyDefaultAllowlistCannotGrowWithoutInventoryReview() {
        var yaml = new org.springframework.beans.factory.config.YamlPropertiesFactoryBean();
        yaml.setResources(new org.springframework.core.io.FileSystemResource("src/main/resources/application.yml"));
        var properties = yaml.getObject();
        assertThat(properties).isNotNull();
        var publicPaths = properties.stringPropertyNames().stream()
                .filter(key -> key.startsWith("identity.bff.public-api-allowlist["))
                .map(properties::getProperty).toList();
        assertThat(publicPaths).containsExactlyInAnyOrder(
                "/api/v1/announcements/public", "/api/v1/public/docs",
                "/api/v1/article-taxonomy/v2/categories", "/api/v1/site-appearance");
    }

    @Test
    void policyInventoryMeasuresTheDeclarationRatherThanAnEarlierBypassCall() {
        String sample = "class Policy {\n public void filter() {\n"
                + " if (exceptionAllowed()) { return; }\n }\n"
                + " private boolean exceptionAllowed() { return false; }\n}";
        assertThat(policyBody(sample, "exceptionAllowed")).isEqualTo("{returnfalse;}");
        assertThat(policyBody(sample.replace("return false", "return true"), "exceptionAllowed"))
                .isNotEqualTo(policyBody(sample, "exceptionAllowed"));
    }

    private static String policyBody(String source, String method) {
        // Restrict comment removal to line starts: "/**" inside a route
        // literal is executable policy, not a Java block comment.
        String stripped = source.replaceAll("(?ms)^\\s*/\\*.*?\\*/", "").replaceAll("(?m)^\\s*//.*$", "");
        var declaration = java.util.regex.Pattern.compile("(?m)^[ \\t]*"
                + "(?:(?:public|private|protected|static|final)[ \\t]+)*"
                + "[\\w.$<>?,\\[\\] \\t]+[ \\t]+\\b"
                + method + "\\s*\\([^;{}]*?\\)\\s*(?:throws[^{}]+)?\\{").matcher(stripped);
        assertThat(declaration.find()).as("policy declaration exists: %s", method).isTrue();
        int start = declaration.end() - 1;
        int depth = 0;
        boolean quoted = false;
        boolean escaped = false;
        for (int i = start; i < stripped.length(); i++) {
            char ch = stripped.charAt(i);
            if (quoted) {
                if (escaped) escaped = false;
                else if (ch == '\\') escaped = true;
                else if (ch == '"') quoted = false;
            } else if (ch == '"') quoted = true;
            else if (ch == '{') depth++;
            else if (ch == '}' && --depth == 0) return stripped.substring(start, i + 1).replaceAll("\\s+", "");
        }
        throw new AssertionError("Unclosed policy body: " + method);
    }

    private static class DeclaredMappings extends RequestMappingHandlerMapping {
        RequestMappingInfo forMethod(Method method, Class<?> controller) {
            return getMappingForMethod(method, controller);
        }
    }
}
