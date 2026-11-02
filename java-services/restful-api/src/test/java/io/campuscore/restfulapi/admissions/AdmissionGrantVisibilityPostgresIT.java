package io.campuscore.restfulapi.admissions;

import static org.assertj.core.api.Assertions.assertThat;

import io.campuscore.restfulapi.admissions.service.AdmissionService;
import io.campuscore.restfulapi.events.web.ListPaging;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIf;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/** PostgreSQL coverage for admissions staff-grant visibility and paging. */
@EnabledIf("postgresTargetConfigured")
@SpringBootTest(properties = { "spring.flyway.locations=classpath:db/migration", "deepseek.enabled=false" })
@ActiveProfiles({"test", "persistence"})
class AdmissionGrantVisibilityPostgresIT {

    @Autowired
    private AdmissionService admissions;

    @Autowired
    private JdbcTemplate jdbc;

    private String staffUserId;
    private String siblingUserId;
    private List<String> grantIds = List.of();

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", () -> System.getenv("CAMPUSCORE_E2E_POSTGRES_URL"));
        registry.add("spring.datasource.username", () -> valueOr("CAMPUSCORE_E2E_POSTGRES_USER", "campuscore"));
        registry.add("spring.datasource.password", () -> valueOr("CAMPUSCORE_E2E_POSTGRES_PASSWORD", "postgres"));
    }

    @BeforeEach
    void seedGrants() {
        List<String> availableUsers = jdbc.queryForList("""
                SELECT u."id" FROM campuscore_auth."User" u
                WHERE NOT EXISTS (
                    SELECT 1 FROM admissions."StaffGrant" g
                    WHERE g."userId" = u."id" AND g."scope" = 'admissions'
                )
                ORDER BY u."id"
                LIMIT 2
                """, String.class);
        assertThat(availableUsers).hasSize(2);
        staffUserId = availableUsers.get(0);
        siblingUserId = availableUsers.get(1);
        grantIds = List.of(UUID.randomUUID().toString(), UUID.randomUUID().toString());
        jdbc.update("INSERT INTO admissions.\"StaffGrant\" (\"id\", \"userId\", \"scope\", \"grantedBy\")"
                        + " VALUES (?, ?, 'admissions', ?)",
                grantIds.get(0), staffUserId, "pgit-admin");
        jdbc.update("INSERT INTO admissions.\"StaffGrant\" (\"id\", \"userId\", \"scope\", \"grantedBy\")"
                        + " VALUES (?, ?, 'admissions', ?)",
                grantIds.get(1), siblingUserId, "pgit-admin");
    }

    @AfterEach
    void removeGrants() {
        if (!grantIds.isEmpty()) {
            jdbc.update("DELETE FROM admissions.\"StaffGrant\" WHERE \"id\" IN (?, ?)",
                    grantIds.get(0), grantIds.get(1));
        }
    }

    @Test
    void staffGrantListScopesRowsAndCountByUser() {
        var staffPage = admissions.listGrants(staffUserId, List.of("LECTURER"),
                ListPaging.Window.of(0, 20));
        assertThat(staffPage.total()).isEqualTo(1);
        assertThat(staffPage.items()).extracting(item -> item.userId()).containsExactly(staffUserId);

        var adminRows = admissions.listGrants("pgit-admin", List.of("ADMIN"));
        assertThat(adminRows).extracting(item -> item.userId()).contains(staffUserId, siblingUserId);
    }

    static boolean postgresTargetConfigured() {
        String url = System.getenv("CAMPUSCORE_E2E_POSTGRES_URL");
        return url != null && url.startsWith("jdbc:postgresql:");
    }

    private static String valueOr(String key, String fallback) {
        String value = System.getenv(key);
        return value == null || value.isBlank() ? fallback : value;
    }
}
