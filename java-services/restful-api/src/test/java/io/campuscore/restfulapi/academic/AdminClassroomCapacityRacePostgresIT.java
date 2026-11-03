package io.campuscore.restfulapi.academic;

import static org.assertj.core.api.Assertions.assertThat;

import io.campuscore.restfulapi.academic.service.AdminCatalogMutationService;
import io.campuscore.restfulapi.web.DomainException;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIf;
import org.mockito.ArgumentMatchers;
import org.mockito.Mockito;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.jdbc.core.namedparam.SqlParameterSource;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

@EnabledIf(value = "io.campuscore.restfulapi.academic.AdminClassroomCapacityRacePostgresIT#postgresTargetConfigured")
@SpringBootTest(properties = {
        "spring.flyway.locations=classpath:db/migration",
        "deepseek.enabled=false",
        "spring.jpa.hibernate.ddl-auto=none",
        "spring.datasource.hikari.maximum-pool-size=8"
})
@ActiveProfiles({"test", "persistence"})
class AdminClassroomCapacityRacePostgresIT {

    private static final String CLASSROOM = "\"academic\".\"Classroom\"";
    private static final String SECTION = "\"academic\".\"Section\"";

    @Autowired
    private AdminCatalogMutationService catalog;

    @MockitoSpyBean
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
    void classroomShrinkWaitsForASectionCapacityIncrease() throws Exception {
        AcademicEnrollmentPostgresFixture fixture = AcademicEnrollmentPostgresFixture.seed(jdbc, 30);
        String classroomId = seedClassroom(fixture);
        jdbc.update("UPDATE " + SECTION + " SET \"classroomId\" = :classroomId WHERE \"id\" = :sectionId",
                new MapSqlParameterSource().addValue("classroomId", classroomId)
                        .addValue("sectionId", fixture.sectionId));

        assertShrinkSerializes(classroomId, () -> catalog.update(
                SECTION, fixture.sectionId, Map.of("capacity", 40)));
    }

    @Test
    void classroomShrinkWaitsForASectionCreatedInTheRoom() throws Exception {
        AcademicEnrollmentPostgresFixture fixture = AcademicEnrollmentPostgresFixture.seed(jdbc, 30);
        String classroomId = seedClassroom(fixture);
        String newSectionId = fixture.sectionId + "-new";

        assertShrinkSerializes(classroomId, () -> catalog.createSection(Map.of(
                "id", newSectionId,
                "courseId", fixture.courseId,
                "semesterId", fixture.semesterId,
                "classroomId", classroomId,
                "capacity", 40)));
    }

    @Test
    void classroomShrinkWaitsForASectionAssignedToTheRoom() throws Exception {
        AcademicEnrollmentPostgresFixture fixture = AcademicEnrollmentPostgresFixture.seed(jdbc, 40);
        String classroomId = seedClassroom(fixture);

        assertShrinkSerializes(classroomId, () -> catalog.update(
                SECTION, fixture.sectionId, Map.of("classroomId", classroomId)));
    }

    static boolean postgresTargetConfigured() {
        String url = System.getenv("CAMPUSCORE_E2E_POSTGRES_URL");
        return url != null && url.startsWith("jdbc:postgresql:");
    }

    private void assertShrinkSerializes(String classroomId, Runnable sectionMutation) throws Exception {
        CountDownLatch sectionWriteReady = new CountDownLatch(1);
        CountDownLatch allowSectionWrite = new CountDownLatch(1);
        Mockito.doAnswer(invocation -> {
            String sql = invocation.getArgument(0, String.class);
            if (isSectionWrite(sql)) {
                sectionWriteReady.countDown();
                awaitLatch(allowSectionWrite);
            }
            return invocation.callRealMethod();
        }).when(jdbc).update(ArgumentMatchers.anyString(), ArgumentMatchers.any(SqlParameterSource.class));

        String suffix = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
        String sectionApplication = "room-section-" + suffix;
        String classroomApplication = "room-shrink-" + suffix;
        ExecutorService pool = Executors.newFixedThreadPool(2);
        Future<Throwable> sectionWrite = null;
        Future<Throwable> classroomShrink = null;
        boolean classroomWaitedForSection = false;
        try {
            sectionWrite = pool.submit(() -> inNamedTransaction(sectionApplication, sectionMutation));
            assertThat(sectionWriteReady.await(10, TimeUnit.SECONDS))
                    .as("section write reaches the database after taking its classroom locks")
                    .isTrue();

            classroomShrink = pool.submit(() -> inNamedTransaction(classroomApplication,
                    () -> catalog.update(CLASSROOM, classroomId, Map.of("capacity", 35))));
            classroomWaitedForSection = awaitLockWait(classroomApplication, sectionApplication, classroomShrink);
        } finally {
            allowSectionWrite.countDown();
            pool.shutdown();
            assertThat(pool.awaitTermination(30, TimeUnit.SECONDS)).isTrue();
        }

        assertThat(sectionWrite).isNotNull();
        assertThat(sectionWrite.get(1, TimeUnit.SECONDS)).isNull();
        assertThat(classroomShrink).isNotNull();
        Throwable failure = classroomShrink.get(1, TimeUnit.SECONDS);

        Integer violatingSections = jdbc.queryForObject(
                "SELECT COUNT(DISTINCT section.\"id\") FROM " + SECTION + " section"
                        + " WHERE EXISTS (SELECT 1 FROM " + CLASSROOM + " room"
                        + " WHERE room.\"id\" = section.\"classroomId\" AND room.\"id\" = :classroomId"
                        + " AND section.\"capacity\" > room.\"capacity\")"
                        + " OR EXISTS (SELECT 1 FROM academic.\"SectionSchedule\" schedule"
                        + " JOIN " + CLASSROOM + " room ON room.\"id\" = schedule.\"classroomId\""
                        + " WHERE schedule.\"sectionId\" = section.\"id\" AND room.\"id\" = :classroomId"
                        + " AND section.\"capacity\" > room.\"capacity\")",
                new MapSqlParameterSource("classroomId", classroomId), Integer.class);
        assertThat(violatingSections).as("no section exceeds any room it is assigned to or scheduled in").isZero();
        assertThat(classroomWaitedForSection).as("the classroom writer observes the competing row lock").isTrue();
        assertThat(failure).isInstanceOf(DomainException.class);
        DomainException conflict = (DomainException) failure;
        assertThat(conflict.getStatus().value()).isEqualTo(409);
        assertThat(conflict.code()).isEqualTo("ROOM_BELOW_SECTION_CAPACITY");
    }

    private Throwable inNamedTransaction(String applicationName, Runnable mutation) {
        try {
            new TransactionTemplate(transactionManager).executeWithoutResult(status -> {
                jdbc.getJdbcTemplate().queryForObject(
                        "SELECT set_config('application_name', ?, true)", String.class, applicationName);
                mutation.run();
            });
            return null;
        } catch (Throwable failure) {
            return failure;
        }
    }

    private boolean awaitLockWait(String waiter, String blocker, Future<?> waiterFuture)
            throws InterruptedException {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(10);
        while (System.nanoTime() < deadline) {
            Integer waiting = jdbc.queryForObject(
                    "SELECT COUNT(*) FROM pg_stat_activity waiting"
                            + " WHERE waiting.application_name = :waiter AND waiting.wait_event_type = 'Lock'"
                            + " AND EXISTS (SELECT 1 FROM unnest(pg_blocking_pids(waiting.pid)) AS blockers(pid)"
                            + " JOIN pg_stat_activity blocker ON blocker.pid = blockers.pid"
                            + " WHERE blocker.application_name = :blocker)",
                    new MapSqlParameterSource().addValue("waiter", waiter).addValue("blocker", blocker),
                    Integer.class);
            if (waiting != null && waiting > 0) {
                return true;
            }
            if (waiterFuture.isDone()) {
                return false;
            }
            Thread.sleep(25);
        }
        return false;
    }

    private String seedClassroom(AcademicEnrollmentPostgresFixture fixture) {
        String classroomId = fixture.sectionId + "-room";
        jdbc.update("INSERT INTO " + CLASSROOM
                        + " (\"id\", \"building\", \"roomNumber\", \"capacity\", \"type\")"
                        + " VALUES (:id, 'A', '101', 40, 'LECTURE')",
                new MapSqlParameterSource("id", classroomId));
        return classroomId;
    }

    private static boolean isSectionWrite(String sql) {
        return sql.startsWith("INSERT INTO \"academic\".\"Section\"")
                || sql.startsWith("UPDATE \"academic\".\"Section\" SET \"capacity\"")
                || sql.startsWith("UPDATE \"academic\".\"Section\" SET \"classroomId\"");
    }

    private static void awaitLatch(CountDownLatch latch) {
        try {
            if (!latch.await(15, TimeUnit.SECONDS)) {
                throw new IllegalStateException("section write barrier timed out");
            }
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("interrupted at section write barrier", interrupted);
        }
    }

    private static String valueOr(String name, String fallback) {
        String value = System.getenv(name);
        return value == null || value.isBlank() ? fallback : value;
    }
}
