package io.campuscore.restfulapi.academic;

import static org.assertj.core.api.Assertions.assertThat;

import io.campuscore.restfulapi.academic.service.AdminCatalogMutationService;
import io.campuscore.restfulapi.web.DomainException;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIf;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

@EnabledIf(value = "io.campuscore.restfulapi.academic.AdminSectionCapacityRacePostgresIT#postgresTargetConfigured")
@SpringBootTest(properties = {
        "spring.flyway.locations=classpath:db/migration",
        "deepseek.enabled=false",
        "spring.jpa.hibernate.ddl-auto=none",
        "spring.datasource.hikari.maximum-pool-size=8"
})
@ActiveProfiles({"test", "persistence"})
class AdminSectionCapacityRacePostgresIT {

    @Autowired
    private AdminCatalogMutationService catalog;

    @Autowired
    private NamedParameterJdbcTemplate jdbc;

    @Autowired
    private PlatformTransactionManager transactionManager;

    @DynamicPropertySource
    static void postgresProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", () -> valueOr(
                "CAMPUSCORE_E2E_POSTGRES_URL", "jdbc:postgresql://localhost:5432/campuscore_e2e"));
        registry.add("spring.datasource.username", () -> valueOr("CAMPUSCORE_E2E_POSTGRES_USER", "postgres"));
        registry.add("spring.datasource.password", () -> valueOr("CAMPUSCORE_E2E_POSTGRES_PASSWORD", "postgres"));
    }

    @Test
    void capacityUpdateCannotCommitBelowAConcurrentSeatCount() throws Exception {
        AcademicEnrollmentPostgresFixture fixture = AcademicEnrollmentPostgresFixture.seed(jdbc, 30);
        jdbc.update("UPDATE academic.\"Section\" SET \"enrolledCount\" = 20 WHERE \"id\" = :id",
                Map.of("id", fixture.sectionId));

        ExecutorService pool = Executors.newFixedThreadPool(2);
        CountDownLatch countUpdateReady = new CountDownLatch(1);
        CountDownLatch allowCountUpdateCommit = new CountDownLatch(1);
        Future<?> countUpdate = null;
        Future<Throwable> capacityUpdate = null;
        try {
            countUpdate = pool.submit(() -> new TransactionTemplate(transactionManager).executeWithoutResult(status -> {
                jdbc.update("UPDATE academic.\"Section\" SET \"enrolledCount\" = 22 WHERE \"id\" = :id",
                        Map.of("id", fixture.sectionId));
                countUpdateReady.countDown();
                try {
                    if (!allowCountUpdateCommit.await(10, TimeUnit.SECONDS)) {
                        throw new AssertionError("seat update was not released");
                    }
                } catch (InterruptedException failure) {
                    Thread.currentThread().interrupt();
                    throw new AssertionError(failure);
                }
            }));
            assertThat(countUpdateReady.await(10, TimeUnit.SECONDS)).isTrue();

            capacityUpdate = pool.submit(() -> {
                try {
                    catalog.update("\"academic\".\"Section\"", fixture.sectionId, Map.of("capacity", 21));
                    return null;
                } catch (Throwable failure) {
                    return failure;
                }
            });
            assertThat(awaitCapacityUpdateLock()).isTrue();
        } finally {
            allowCountUpdateCommit.countDown();
            pool.shutdown();
            assertThat(pool.awaitTermination(30, TimeUnit.SECONDS)).isTrue();
        }

        if (countUpdate != null) {
            countUpdate.get(1, TimeUnit.SECONDS);
        }
        assertThat(capacityUpdate).isNotNull();
        Throwable failure = capacityUpdate.get(1, TimeUnit.SECONDS);
        assertThat(failure).isInstanceOf(DomainException.class);
        DomainException conflict = (DomainException) failure;
        assertThat(conflict.getStatus().value()).isEqualTo(409);
        assertThat(conflict.code()).isEqualTo("CAPACITY_BELOW_ENROLLED");

        Map<String, Object> section = jdbc.queryForMap(
                "SELECT \"capacity\", \"enrolledCount\" FROM academic.\"Section\" WHERE \"id\" = :id",
                Map.of("id", fixture.sectionId));
        assertThat(section).containsEntry("capacity", 30).containsEntry("enrolledCount", 22);
    }

    static boolean postgresTargetConfigured() {
        String url = System.getenv("CAMPUSCORE_E2E_POSTGRES_URL");
        return url != null && url.startsWith("jdbc:postgresql:");
    }

    private boolean awaitCapacityUpdateLock() throws InterruptedException {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(10);
        while (System.nanoTime() < deadline) {
            Integer waiting = jdbc.queryForObject(
                    "SELECT COUNT(*) FROM pg_stat_activity WHERE pid <> pg_backend_pid()"
                            + " AND wait_event_type = 'Lock'"
                            + " AND query ILIKE 'SELECT * FROM \"academic\".\"Section\"%FOR UPDATE%'",
                    Map.of(), Integer.class);
            if (waiting != null && waiting > 0) {
                return true;
            }
            Thread.sleep(25);
        }
        return false;
    }

    private static String valueOr(String name, String fallback) {
        String value = System.getenv(name);
        return value == null || value.isBlank() ? fallback : value;
    }
}
