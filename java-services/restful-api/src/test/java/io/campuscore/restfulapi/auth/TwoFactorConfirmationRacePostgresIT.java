package io.campuscore.restfulapi.auth;

import java.net.URI;
import org.junit.jupiter.api.condition.EnabledIf;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/** Runs the same deterministic confirmation schedules on the disposable PostgreSQL rig. */
@EnabledIf("postgresTargetConfigured")
@SpringBootTest(properties = {"spring.flyway.enabled=false", "deepseek.enabled=false"})
class TwoFactorConfirmationRacePostgresIT extends TwoFactorConfirmationRaceTest {
    @DynamicPropertySource
    static void postgresProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", () -> System.getenv("CAMPUSCORE_COUNCIL_POSTGRES_URL"));
        registry.add("spring.datasource.username", () -> System.getenv("CAMPUSCORE_COUNCIL_POSTGRES_USER"));
        registry.add("spring.datasource.password", () -> System.getenv("CAMPUSCORE_COUNCIL_POSTGRES_PASSWORD"));
    }

    static boolean postgresTargetConfigured() {
        String url = System.getenv("CAMPUSCORE_COUNCIL_POSTGRES_URL");
        if (url == null || !url.startsWith("jdbc:postgresql:")) return false;
        try {
            URI uri = URI.create(url.substring(5));
            return "127.0.0.1".equals(uri.getHost()) && uri.getPort() == 5452
                    && "/campuscore_council_race_credential_20261016".equals(uri.getPath());
        } catch (IllegalArgumentException invalid) { return false; }
    }
}
