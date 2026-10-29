package io.campuscore.restfulapi.security;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.EnumMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import org.junit.jupiter.api.Test;
import org.springframework.core.MethodIntrospector;
import org.springframework.core.annotation.AnnotatedElementUtils;
import org.springframework.core.io.support.PathMatchingResourcePatternResolver;
import org.springframework.core.type.classreading.CachingMetadataReaderFactory;
import org.springframework.http.server.PathContainer;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.RequestMappingInfo;
import org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerMapping;
import org.springframework.web.util.pattern.PathPatternParser;

/**
 * Every declared MVC handler needs a reviewable policy, even in an inactive profile or
 * conditional identity/internal lane. Method-level PreAuthorize overrides class-level
 * PreAuthorize. Otherwise every declared path/verb must be explicitly filter-permitted
 * by SecurityConfig's actual matchers, or carry a reason-bearing ServiceEnforced marker.
 * The global authenticated fallback is deliberately NOT an explicit handler policy.
 * Filter-permitted does not mean anonymous business access: BFF sessions, internal
 * shared secrets, readiness keys and publication filtering retain their own checks.
 * Counting unit: Java handler method, not URL aliases, implicit HEAD or MVC OPTIONS.
 * This is a metadata-only scan: no application, database or provider is started.
 */
class AuthorizationPolicyInventoryTest {
    private static final String BASE = "io/campuscore/restfulapi";
    private static final Map<String, String> REVIEWED_SERVICE_AUTHORITY = Map.of(
            "io.campuscore.restfulapi.admissions.web.AdmissionStaffController#grants",
            "Authenticated endpoint; ADMIN may list grant metadata, otherwise STAFF:admissions is required");

    @Test
    void everyMappedControllerMethodHasAnExplicitPolicy() throws Exception {
        var resolver = new PathMatchingResourcePatternResolver();
        var metadata = new CachingMetadataReaderFactory(resolver);
        var mapping = new DeclaredMappings();
        Map<String, Policy> inventory = new TreeMap<>();
        int controllers = 0;
        // Scan annotation metadata directly, rather than component scanning: the latter
        // evaluates @Profile/@Conditional and would silently omit disabled controllers.
        for (var resource : resolver.getResources("classpath*:" + BASE + "/**/*.class")) {
            var reader = metadata.getMetadataReader(resource);
            var annotations = reader.getAnnotationMetadata();
            if (!annotations.hasAnnotation(RestController.class.getName())
                    && !annotations.hasMetaAnnotation(RestController.class.getName())) {
                continue;
            }
            Class<?> controller = Class.forName(reader.getClassMetadata().getClassName(), false,
                    getClass().getClassLoader());
            controllers++;
            var handlers = MethodIntrospector.selectMethods(controller,
                    (MethodIntrospector.MetadataLookup<RequestMappingInfo>) method -> mapping.forMethod(method, controller));
            handlers.forEach((method, info) -> inventory.put(
                    controller.getName() + "#" + method.getName() + " " + info, classify(method, controller, info)));
        }
        assertFalse(inventory.isEmpty(), "Controller scan must not pass vacuously");
        Map<Policy, Integer> counts = new EnumMap<>(Policy.class);
        inventory.values().forEach(policy -> counts.merge(policy, 1, Integer::sum));
        System.out.println("Authorization inventory: controllers=" + controllers + ", methods=" + inventory.size()
                + ", counts=" + counts);
        List<String> missing = new ArrayList<>();
        inventory.forEach((handler, policy) -> {
            if (policy == Policy.UNCLASSIFIED) {
                missing.add(handler);
            }
        });
        assertTrue(missing.isEmpty(), "Mappings without explicit policy:\n" + String.join("\n", missing));
    }

    @Test
    void admissionsGrantListingRetainsItsReviewedServiceAuthorityPolicy() throws Exception {
        Class<?> controller = io.campuscore.restfulapi.admissions.web.AdmissionStaffController.class;
        Method method = controller.getDeclaredMethod("grants", org.springframework.security.oauth2.jwt.Jwt.class);
        RequestMappingInfo mapping = new DeclaredMappings().forMethod(method, controller);
        String handler = controller.getName() + "#" + method.getName();
        PreAuthorize annotation = AnnotatedElementUtils.findMergedAnnotation(method, PreAuthorize.class);

        assertEquals(Policy.METHOD_ANNOTATED, classify(method, controller, mapping));
        assertEquals("isAuthenticated()", annotation.value());
        assertEquals("Authenticated endpoint; ADMIN may list grant metadata, otherwise STAFF:admissions is required",
                REVIEWED_SERVICE_AUTHORITY.get(handler));
    }

    private static Policy classify(Method method, Class<?> controller, RequestMappingInfo mapping) {
        if (AnnotatedElementUtils.hasAnnotation(method, PreAuthorize.class)) {
            return Policy.METHOD_ANNOTATED;
        }
        if (AnnotatedElementUtils.hasAnnotation(controller, PreAuthorize.class)) {
            return Policy.CLASS_ANNOTATED;
        }
        ServiceEnforced service = AnnotatedElementUtils.findMergedAnnotation(method, ServiceEnforced.class);
        if (service == null) {
            service = AnnotatedElementUtils.findMergedAnnotation(controller, ServiceEnforced.class);
        }
        if (service != null) {
            assertFalse(service.value().isBlank(), "Service policy reason is required: " + method);
            return Policy.SERVICE_ENFORCED;
        }
        return isExplicitlyPublic(mapping) ? Policy.EXPLICIT_PUBLIC : Policy.UNCLASSIFIED;
    }

    private static boolean isExplicitlyPublic(RequestMappingInfo mapping) {
        var verbs = mapping.getMethodsCondition().getMethods();
        // An unrestricted @RequestMapping must be covered for every verb, not just GET.
        var effectiveVerbs = verbs.isEmpty() ? Arrays.asList(RequestMethod.values()) : verbs;
        return mapping.getPatternValues().stream().allMatch(path -> effectiveVerbs.stream().allMatch(verb ->
                SecurityConfig.publicEndpoints().stream().anyMatch(endpoint ->
                        (endpoint.method() == null || endpoint.method().name().equals(verb.name()))
                                && covers(endpoint.path(), path))));
    }

    private static boolean covers(String allowed, String declared) {
        if (allowed.equals(declared)) {
            return true;
        }
        // The reviewed allow-list's subtree prefixes are literal. Compare the
        // whole declared subtree, rather than probing one URL and misclassifying
        // a catch-all handler under a single-segment public exception.
        if (allowed.endsWith("/**")) {
            String prefix = allowed.substring(0, allowed.length() - 3);
            if (!PathPatternParser.defaultInstance.parse(prefix).hasPatternSyntax()) {
                return declared.equals(prefix) || declared.startsWith(prefix + "/");
            }
        }
        if (declared.contains("**") || declared.contains("{*")) {
            return false;
        }
        return PathPatternParser.defaultInstance.parse(allowed).matches(PathContainer.parsePath(declared));
    }

    @Test
    void publicClassificationRequiresEveryAliasAndVerbAndDoesNotExpandSubtrees() {
        assertTrue(isExplicitlyPublic(RequestMappingInfo.paths("/api/v1/site-appearance")
                .methods(RequestMethod.GET).build()));
        assertFalse(isExplicitlyPublic(RequestMappingInfo.paths("/api/v1/site-appearance")
                .methods(RequestMethod.GET, RequestMethod.PUT).build()));
        assertFalse(isExplicitlyPublic(RequestMappingInfo.paths("/api/v1/site-appearance").build()));
        assertFalse(isExplicitlyPublic(RequestMappingInfo.paths("/api/v1/announcements/public", "/api/v1/private")
                .methods(RequestMethod.GET).build()));
        assertTrue(isExplicitlyPublic(RequestMappingInfo.paths("/api/v1/announcements/public/{id}")
                .methods(RequestMethod.GET).build()));
        assertFalse(isExplicitlyPublic(RequestMappingInfo.paths("/api/v1/announcements/public/**")
                .methods(RequestMethod.GET).build()));
        assertFalse(isExplicitlyPublic(RequestMappingInfo.paths("/api/v1/announcements/public/{*tail}")
                .methods(RequestMethod.GET).build()));
        assertTrue(isExplicitlyPublic(RequestMappingInfo.paths("/bff/api/**").build()));
        assertFalse(isExplicitlyPublic(RequestMappingInfo.paths("/api/v1/contract/ping")
                .methods(RequestMethod.POST).build()));
    }

    @Test
    void globalFallbackIsNotAPolicyAndServiceReasonsCannotBeBlank() throws Exception {
        var mapping = RequestMappingInfo.paths("/api/v1/private").methods(RequestMethod.GET).build();
        assertEquals(Policy.UNCLASSIFIED, classify(PolicyExamples.class.getDeclaredMethod("unclassified"),
                PolicyExamples.class, mapping));
        assertEquals(Policy.SERVICE_ENFORCED, classify(PolicyExamples.class.getDeclaredMethod("service"),
                PolicyExamples.class, mapping));
        assertThrows(AssertionError.class, () -> classify(PolicyExamples.class.getDeclaredMethod("blank"),
                PolicyExamples.class, mapping));
    }

    private static final class PolicyExamples {
        void unclassified() { }

        @ServiceEnforced("ExampleService checks the authenticated recipient's ownership")
        void service() { }

        @ServiceEnforced(" ")
        void blank() { }
    }

    private enum Policy { METHOD_ANNOTATED, CLASS_ANNOTATED, EXPLICIT_PUBLIC, SERVICE_ENFORCED, UNCLASSIFIED }

    private static final class DeclaredMappings extends RequestMappingHandlerMapping {
        RequestMappingInfo forMethod(Method method, Class<?> controller) {
            return getMappingForMethod(method, controller);
        }
    }
}
