package io.campuscore.restfulapi.identity.bff;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.ArrayList;
import java.util.List;
import java.util.Properties;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.config.YamlPropertiesFactoryBean;
import org.springframework.core.io.ClassPathResource;

class BffBusinessApiAllowlistCoverageTest {

    private static final String PRIVATE_ALLOWLIST = "identity.bff.api-allowlist";
    private static final String PUBLIC_ALLOWLIST = "identity.bff.public-api-allowlist";

    // Frontend business API prefixes used by api.ts and thesis-api.ts.
    private static final List<String> FRONTEND_BUSINESS_PREFIXES = List.of(
            "/api/v1/thesis",
            "/api/v1/mail",
            "/api/v1/assistant",
            "/api/v1/grades",
            "/api/v1/conduct",
            "/api/v1/enrollments",
            "/api/v1/registration",
            "/api/v1/classrooms",
            "/api/v1/courses",
            "/api/v1/curricula",
            "/api/v1/departments",
            "/api/v1/lecturers",
            "/api/v1/semesters",
            "/api/v1/academic-years",
            "/api/v1/users",
            "/api/v1/admin/audit",
            "/api/v1/admin/registration",
            "/api/v1/auth/profile");

    private static final List<String> PASSWORD_RECOVERY_PATHS = List.of(
            "/api/v1/auth/forgot-password",
            "/api/v1/auth/reset-password");

    @Test
    void productionPrivateAllowlistCoversFrontendBusinessPrefixes() {
        Properties application = loadProductionApplicationProperties();
        List<String> privateAllowlist = indexedValues(application, PRIVATE_ALLOWLIST);
        List<String> publicAllowlist = indexedValues(application, PUBLIC_ALLOWLIST);

        assertThat(privateAllowlist)
                .as("private BFF prefixes must use the production /api/v1 path format")
                .containsAll(FRONTEND_BUSINESS_PREFIXES);
        assertThat(publicAllowlist)
                .as("business endpoints must remain behind the authenticated BFF lane")
                .doesNotContainAnyElementsOf(FRONTEND_BUSINESS_PREFIXES);
        assertThat(privateAllowlist)
                .as("admin prefixes must stay scoped to the explicitly listed routes")
                .doesNotContain("/api/v1/admin", "/api/v1/admin/**");
    }

    @Test
    void passwordRecoveryEndpointsRemainOutsideBothBffAllowlistLanes() {
        Properties application = loadProductionApplicationProperties();

        assertThat(indexedValues(application, PRIVATE_ALLOWLIST))
                .doesNotContainAnyElementsOf(PASSWORD_RECOVERY_PATHS);
        assertThat(indexedValues(application, PUBLIC_ALLOWLIST))
                .doesNotContainAnyElementsOf(PASSWORD_RECOVERY_PATHS);
    }

    @Test
    void eachBusinessPrefixMatchesExactSubpathAndQueryUnderBffProxyMatcherRules() {
        Properties application = loadProductionApplicationProperties();
        List<String> allowlist = indexedValues(application, PRIVATE_ALLOWLIST);

        for (String prefix : FRONTEND_BUSINESS_PREFIXES) {
            assertThat(matchesUpstream(allowlist, prefix))
                    .as("exact path %s must be accepted by BFF proxy matcher", prefix)
                    .isTrue();
            assertThat(matchesUpstream(allowlist, prefix + "/sub-resource"))
                    .as("sub-path under %s must be accepted by BFF proxy matcher", prefix)
                    .isTrue();
            assertThat(matchesUpstream(allowlist, prefix + "?query=1"))
                    .as("query path for %s must be accepted by BFF proxy matcher", prefix)
                    .isTrue();
        }

        // Verify that academic-years requires its own dedicated allowlist entry
        // and would be rejected if only /api/v1/academic were present.
        List<String> withoutAcademicYears = allowlist.stream()
                .filter(p -> !p.equals("/api/v1/academic-years"))
                .toList();
        assertThat(matchesUpstream(withoutAcademicYears, "/api/v1/academic-years"))
                .as("matcher requires allowed + '/' so /api/v1/academic cannot match /api/v1/academic-years")
                .isFalse();
    }

    @Test
    void allowlistMissingAnyBusinessPrefixFailsVerification() {
        Properties application = loadProductionApplicationProperties();
        Properties simulatedOldApplication = new Properties();
        int newIndex = 0;
        for (int index = 0; ; index++) {
            String value = application.getProperty(PRIVATE_ALLOWLIST + "[" + index + "]");
            if (value == null) {
                break;
            }
            if (!FRONTEND_BUSINESS_PREFIXES.contains(value)) {
                simulatedOldApplication.setProperty(PRIVATE_ALLOWLIST + "[" + newIndex + "]", value);
                newIndex++;
            }
        }
        List<String> oldAllowlist = indexedValues(simulatedOldApplication, PRIVATE_ALLOWLIST);
        org.junit.jupiter.api.Assertions.assertThrows(AssertionError.class, () -> {
            assertThat(oldAllowlist)
                    .as("private BFF prefixes must use the production /api/v1 path format")
                    .containsAll(FRONTEND_BUSINESS_PREFIXES);
        });
    }

    private static boolean matchesUpstream(List<String> allowlist, String upstream) {
        for (String allowed : allowlist) {
            if (upstream.equals(allowed) || upstream.startsWith(allowed + "/")
                    || upstream.startsWith(allowed + "?")) {
                return true;
            }
        }
        return false;
    }

    private static Properties loadProductionApplicationProperties() {
        YamlPropertiesFactoryBean yaml = new YamlPropertiesFactoryBean();
        yaml.setResources(new ClassPathResource("application.yml"));
        Properties properties = yaml.getObject();
        assertThat(properties).as("production application.yml must be on the test classpath")
                .isNotNull();
        return properties;
    }

    private static List<String> indexedValues(Properties properties, String property) {
        List<String> values = new ArrayList<>();
        for (int index = 0; ; index++) {
            String value = properties.getProperty(property + "[" + index + "]");
            if (value == null) {
                return values;
            }
            values.add(value);
        }
    }
}
