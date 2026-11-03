package io.campuscore.restfulapi.academic;

import static org.assertj.core.api.Assertions.assertThat;

import io.campuscore.restfulapi.academic.service.AdminCatalogMutationService;
import io.campuscore.restfulapi.web.DomainException;
import java.sql.Timestamp;
import java.time.Instant;
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
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * PostgreSQL proof for the section-placement race: an admin course/semester
 * change must serialize behind an in-flight enrollment that holds the Section
 * row. On the unlocked code the placement count sees zero committed rows, the
 * UPDATE lands after the enrollment commits, and the enrollment keeps the old
 * placement snapshot while the section moves on.
 */
@EnabledIf(value = "io.campuscore.restfulapi.academic.AdminSectionPlacementRacePostgresIT#postgresTargetConfigured")
@SpringBootTest(properties = {
        "spring.flyway.locations=classpath:db/migration",
        "deepseek.enabled=false",
        "spring.jpa.hibernate.ddl-auto=none",
        "spring.datasource.hikari.maximum-pool-size=8"
})
@ActiveProfiles({"test", "persistence"})
class AdminSectionPlacementRacePostgresIT {

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
    void placementUpdateQueuesBehindACommittingEnrollment() throws Exception {
        AcademicEnrollmentPostgresFixture fixture = AcademicEnrollmentPostgresFixture.seed(jdbc, 30);
        String student = fixture.seedStudent(1);
        String enrollmentId = "enrollment-" + fixture.sectionId;
        String courseNew = "course-new-" + fixture.sectionId;
        jdbc.update("INSERT INTO academic.\"Course\""
                        + " (\"id\", \"code\", \"name\", \"credits\", \"departmentId\", \"isActive\")"
                        + " VALUES (:id, :code, :name, 4, :departmentId, TRUE)",
                new MapSqlParameterSource()
                        .addValue("id", courseNew)
                        .addValue("code", courseNew)
                        .addValue("name", "Replacement " + courseNew)
                        .addValue("departmentId", fixture.departmentId));

        ExecutorService pool = Executors.newFixedThreadPool(2);
        CountDownLatch enrollmentHoldsSection = new CountDownLatch(1);
        CountDownLatch commitEnrollment = new CountDownLatch(1);
        Future<?> enrollmentWrite = null;
        Future<Throwable> placementUpdate = null;
        try {
            // An in-flight enrollment: the Section row lock plus an uncommitted
            // ENROLLED row, exactly what RegistrationService.enrollLocked holds
            // between its seat update and commit.
            enrollmentWrite = pool.submit(() -> new TransactionTemplate(transactionManager)
                    .executeWithoutResult(status -> {
                        jdbc.queryForList(
                                "SELECT \"id\" FROM academic.\"Section\" WHERE \"id\" = :id FOR UPDATE",
                                Map.of("id", fixture.sectionId), String.class);
                        jdbc.update("INSERT INTO academic.\"Enrollment\""
                                        + " (\"id\", \"studentId\", \"sectionId\", \"semesterId\", \"status\","
                                        + " \"enrolledAt\", \"gradeStatus\", \"courseId\", \"creditsSnapshot\")"
                                        + " VALUES (:id, :studentId, :sectionId, :semesterId, 'ENROLLED',"
                                        + " :enrolledAt, 'NOT_GRADED', :courseId, 3)",
                                new MapSqlParameterSource()
                                        .addValue("id", enrollmentId)
                                        .addValue("studentId", student)
                                        .addValue("sectionId", fixture.sectionId)
                                        .addValue("semesterId", fixture.semesterId)
                                        .addValue("enrolledAt", Timestamp.from(Instant.now()))
                                        .addValue("courseId", fixture.courseId));
                        jdbc.update("UPDATE academic.\"Section\" SET \"enrolledCount\" = 1 WHERE \"id\" = :id",
                                Map.of("id", fixture.sectionId));
                        enrollmentHoldsSection.countDown();
                        awaitLatch(commitEnrollment);
                    }));
            assertThat(enrollmentHoldsSection.await(10, TimeUnit.SECONDS)).isTrue();

            placementUpdate = pool.submit(() -> {
                try {
                    catalog.update("\"academic\".\"Section\"", fixture.sectionId,
                            Map.of("courseId", courseNew));
                    return null;
                } catch (Throwable failure) {
                    return failure;
                }
            });
            // The update must queue on the Section row — either at the guard's
            // FOR UPDATE read or at the final UPDATE — never slip its count
            // between the enrollment's uncommitted row and its write.
            assertThat(awaitLockWait("%Section%")).isTrue();
        } finally {
            commitEnrollment.countDown();
            pool.shutdown();
            assertThat(pool.awaitTermination(30, TimeUnit.SECONDS)).isTrue();
        }

        enrollmentWrite.get(1, TimeUnit.SECONDS);
        Throwable failure = placementUpdate.get(1, TimeUnit.SECONDS);
        assertThat(failure).isInstanceOf(DomainException.class);
        DomainException conflict = (DomainException) failure;
        assertThat(conflict.getStatus().value()).isEqualTo(409);
        assertThat(conflict.code()).isEqualTo("SECTION_HAS_ENROLLMENTS");

        Map<String, Object> section = jdbc.queryForMap(
                "SELECT \"courseId\", \"semesterId\" FROM academic.\"Section\" WHERE \"id\" = :id",
                Map.of("id", fixture.sectionId));
        assertThat(section)
                .containsEntry("courseId", fixture.courseId)
                .containsEntry("semesterId", fixture.semesterId);
        Map<String, Object> enrollment = jdbc.queryForMap(
                "SELECT \"courseId\", \"semesterId\" FROM academic.\"Enrollment\" WHERE \"id\" = :id",
                Map.of("id", enrollmentId));
        assertThat(enrollment)
                .containsEntry("courseId", fixture.courseId)
                .containsEntry("semesterId", fixture.semesterId);
    }

    static boolean postgresTargetConfigured() {
        String url = System.getenv("CAMPUSCORE_E2E_POSTGRES_URL");
        return url != null && url.startsWith("jdbc:postgresql:");
    }

    private boolean awaitLockWait(String queryPattern) throws InterruptedException {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(10);
        while (System.nanoTime() < deadline) {
            Integer waiting = jdbc.queryForObject(
                    "SELECT COUNT(*) FROM pg_stat_activity WHERE pid <> pg_backend_pid()"
                            + " AND wait_event_type = 'Lock' AND query ILIKE :pattern",
                    Map.of("pattern", queryPattern), Integer.class);
            if (waiting != null && waiting > 0) {
                return true;
            }
            Thread.sleep(25);
        }
        return false;
    }

    private static void awaitLatch(CountDownLatch latch) {
        try {
            if (!latch.await(15, TimeUnit.SECONDS)) {
                throw new IllegalStateException("race barrier timeout");
            }
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("interrupted at race barrier", interrupted);
        }
    }

    private static String valueOr(String name, String fallback) {
        String value = System.getenv(name);
        return value == null || value.isBlank() ? fallback : value;
    }
}
