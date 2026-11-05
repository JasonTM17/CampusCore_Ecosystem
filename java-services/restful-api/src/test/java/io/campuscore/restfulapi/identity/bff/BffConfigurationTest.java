package io.campuscore.restfulapi.identity.bff;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;

import org.junit.jupiter.api.Test;
import org.springframework.mock.env.MockEnvironment;

import io.campuscore.restfulapi.identity.IdentityProperties;

class BffConfigurationTest {
    @Test
    void edgeOptInRejectsEmptyShortAndPublishedTokensEvenInDev() {
        for (String profile : List.of("persistence", "test")) {
            MockEnvironment environment = new MockEnvironment()
                    .withProperty("CAMPUSCORE_TRUST_EDGE_HEADERS", "true");
            environment.setActiveProfiles(profile);
            for (String token : List.of("", "short", "x".repeat(31), "sso-preview-proxy-token-0123456789")) {
                var error = assertThrows(IllegalStateException.class,
                        () -> new BffConfiguration(properties(), environment, token));
                assertThat(error.getMessage()).contains("CAMPUSCORE_TRUST_EDGE_HEADERS", "32", "unpublished");
            }
            assertThrows(IllegalStateException.class,
                    () -> new BffConfiguration(properties(), environment, null));
            assertDoesNotThrow(() -> new BffConfiguration(properties(), environment, "x".repeat(32)));
        }
    }

    @Test
    void defaultModePreservesTheExistingBffStartupContract() {
        MockEnvironment environment = new MockEnvironment();
        environment.setActiveProfiles("persistence");
        assertDoesNotThrow(() -> new BffConfiguration(properties(), environment, "legacy-token"));
        assertThrows(IllegalStateException.class, () -> new BffConfiguration(properties(), environment, ""));
        environment.setActiveProfiles("test");
        assertDoesNotThrow(() -> new BffConfiguration(properties(), environment, ""));
    }

    private static IdentityProperties properties() {
        IdentityProperties properties = new IdentityProperties();
        properties.getOidc().setEnabled(true);
        IdentityProperties.Surface surface = new IdentityProperties.Surface();
        surface.setId("portal");
        surface.setClientId("cu-portal");
        surface.setClientSecret("test-client-secret");
        surface.setProxySecret("test-surface-secret");
        surface.setPublicBaseUrl("https://portal.test");
        properties.getBff().setSurfaces(List.of(surface));
        return properties;
    }
}
