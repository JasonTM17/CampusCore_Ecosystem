package io.campuscore.restfulapi.academic;

import static org.assertj.core.api.Assertions.assertThat;

import io.campuscore.restfulapi.academic.service.AdminCatalogMutationService;
import io.campuscore.restfulapi.web.DomainException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
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
 * PostgreSQL proof that concurrent semester writes in one academic year
 * serialize on the year row. The holder models a first writer mid-flight: its
 * uncommitted semester takes the same implicit FOR KEY SHARE on the
 * AcademicYear row that any writer takes. Without a shared serialization
 * lock the second writer's overlap count reads a committed world lacking
 * that row, and both overlapping terms commit.
 */
@EnabledIf(value = "io.campuscore.restfulapi.academic.AdminSemesterRacePostgresIT#postgresTargetConfigured")
@SpringBootTest(properties = {
        "spring.flyway.locations=classpath:db/migration",
        "deepseek.enabled=false",
        "spring.jpa.hibernate.ddl-auto=none",
        "spring.datasource.hikari.maximum-pool-size=8"
})
@ActiveProfiles({"test", "persistence"})
class AdminSemesterRacePostgresIT {

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
    void concurrentSemesterWritesCannotOverlapInOneAcademicYear() throws Exception {
        AcademicEnrollmentPostgresFixture fixture = AcademicEnrollmentPostgresFixture.seed(jdbc, 30);
        String semesterA = "semester-a-" + fixture.sectionId;
        String semesterB = "semester-b-" + fixture.sectionId;

        ExecutorService pool = Executors.newFixedThreadPool(2);
        CountDownLatch writerAInFlight = new CountDownLatch(1);
        CountDownLatch commitWriterA = new CountDownLatch(1);
        Future<?> holder = null;
        Future<Throwable> writer = null;
        boolean waitObserved = false;
        try {
            holder = pool.submit(() -> new TransactionTemplate(transactionManager)
                    .executeWithoutResult(status -> {
                        insertSemester(semesterA, fixture, "2026-08-01", "2026-12-31");
                        writerAInFlight.countDown();
                        awaitLatch(commitWriterA);
                    }));
            assertThat(writerAInFlight.await(10, TimeUnit.SECONDS)).isTrue();

            writer = pool.submit(() -> {
                try {
                    catalog.createSemester(Map.of(
                            "id", semesterB,
                            "name", "Overlapping Term " + semesterB,
                            "type", "SECOND",
                            "academicYearId", fixture.academicYearId,
                            "startDate", "2026-11-01",
                            "endDate", "2027-03-31"));
                    return null;
                } catch (Throwable failure) {
                    return failure;
                }
            });
            // The second writer must queue on the AcademicYear row instead of
            // counting zero committed siblings and inserting a second overlap.
            waitObserved = awaitLockWait("%AcademicYear%");
        } finally {
            commitWriterA.countDown();
            pool.shutdown();
            assertThat(pool.awaitTermination(30, TimeUnit.SECONDS)).isTrue();
        }

        holder.get(1, TimeUnit.SECONDS);
        Throwable failure = writer.get(1, TimeUnit.SECONDS);
        assertThat(waitObserved)
                .as("the second writer must queue on the AcademicYear row").isTrue();
        assertThat(failure).isInstanceOf(DomainException.class);
        DomainException conflict = (DomainException) failure;
        assertThat(conflict.getStatus().value()).isEqualTo(409);
        assertThat(conflict.code()).isEqualTo("SEMESTER_DATES_OVERLAP");

        Integer overlapping = jdbc.queryForObject(
                "SELECT COUNT(*) FROM academic.\"Semester\" WHERE \"id\" IN (:ids)"
                        + " AND \"startDate\" < :endDate AND \"endDate\" > :startDate",
                new MapSqlParameterSource()
                        .addValue("ids", List.of(semesterA, semesterB))
                        .addValue("startDate", Timestamp.from(Instant.parse("2026-08-01T00:00:00Z")))
                        .addValue("endDate", Timestamp.from(Instant.parse("2026-12-31T00:00:00Z"))),
                Integer.class);
        assertThat(overlapping).isEqualTo(1);
        assertThat(jdbc.queryForObject(
                "SELECT COUNT(*) FROM academic.\"Semester\" WHERE \"id\" = :id",
                Map.of("id", semesterB), Integer.class)).isZero();
    }

    private void insertSemester(String id, AcademicEnrollmentPostgresFixture fixture,
            String startDate, String endDate) {
        jdbc.update("INSERT INTO academic.\"Semester\""
                        + " (\"id\", \"name\", \"type\", \"academicYearId\", \"startDate\", \"endDate\", \"status\")"
                        + " VALUES (:id, :name, 'FIRST', :academicYearId,"
                        + " CAST(:startDate AS TIMESTAMP WITH TIME ZONE),"
                        + " CAST(:endDate AS TIMESTAMP WITH TIME ZONE), 'DRAFT')",
                new MapSqlParameterSource()
                        .addValue("id", id)
                        .addValue("name", "Term " + id)
                        .addValue("academicYearId", fixture.academicYearId)
                        .addValue("startDate", startDate)
                        .addValue("endDate", endDate));
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
