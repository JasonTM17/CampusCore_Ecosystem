package io.campuscore.restfulapi.academic;

import static org.assertj.core.api.Assertions.assertThat;

import io.campuscore.restfulapi.academic.service.AdminCatalogMutationService;
import io.campuscore.restfulapi.web.DomainException;
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
 * PostgreSQL proof that concurrent schedule writers serialize on the room or
 * lecturer they contend for. The holder models a first writer mid-flight: its
 * uncommitted section and schedule rows take the same implicit FOR KEY SHARE
 * on the referenced catalog row that any writer takes. Without a shared
 * serialization lock the second writer's conflict check reads a committed
 * world lacking those rows, and the same slot is booked twice.
 */
@EnabledIf(value = "io.campuscore.restfulapi.academic.AdminSectionScheduleRacePostgresIT#postgresTargetConfigured")
@SpringBootTest(properties = {
        "spring.flyway.locations=classpath:db/migration",
        "deepseek.enabled=false",
        "spring.jpa.hibernate.ddl-auto=none",
        "spring.datasource.hikari.maximum-pool-size=8"
})
@ActiveProfiles({"test", "persistence"})
class AdminSectionScheduleRacePostgresIT {

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
    void concurrentScheduleWritesCannotDoubleBookARoom() throws Exception {
        AcademicEnrollmentPostgresFixture fixture = AcademicEnrollmentPostgresFixture.seed(jdbc, 30);
        String room = "room-" + fixture.sectionId;
        insertClassroom(room, 60);
        String sectionA = fixture.sectionId + "-a";
        String sectionB = fixture.sectionId + "-b";

        Outcome outcome = raceAgainstInFlightWriter(
                () -> {
                    insertSection(sectionA, fixture, null);
                    insertSchedule("schedule-" + sectionA, sectionA, room);
                },
                () -> {
                    try {
                        catalog.createSection(Map.of(
                                "id", sectionB,
                                "sectionNumber", "02",
                                "courseId", fixture.courseId,
                                "semesterId", fixture.semesterId,
                                "capacity", 30,
                                "schedules", List.of(Map.of(
                                        "dayOfWeek", 1,
                                        "startTime", "08:00",
                                        "endTime", "10:00",
                                        "classroomId", room))));
                        return null;
                    } catch (Throwable failure) {
                        return failure;
                    }
                },
                "%Classroom%");

        assertThat(outcome.waitObserved())
                .as("the second writer must queue on the booked Classroom row").isTrue();
        assertThat(outcome.error()).isInstanceOf(DomainException.class);
        DomainException conflict = (DomainException) outcome.error();
        assertThat(conflict.getStatus().value()).isEqualTo(409);
        assertThat(conflict.code()).isEqualTo("SCHEDULE_CONFLICT");
        Integer bookedSlots = jdbc.queryForObject(
                "SELECT COUNT(*) FROM academic.\"SectionSchedule\""
                        + " WHERE \"classroomId\" = :room AND \"dayOfWeek\" = 1"
                        + " AND \"startTime\" = '08:00' AND \"endTime\" = '10:00'",
                Map.of("room", room), Integer.class);
        assertThat(bookedSlots).isEqualTo(1);
        assertThat(jdbc.queryForObject(
                "SELECT COUNT(*) FROM academic.\"Section\" WHERE \"id\" = :id",
                Map.of("id", sectionB), Integer.class)).isZero();
    }

    @Test
    void concurrentScheduleWritesCannotDoubleBookALecturer() throws Exception {
        AcademicEnrollmentPostgresFixture fixture = AcademicEnrollmentPostgresFixture.seed(jdbc, 30);
        String lecturer = "lecturer-" + fixture.sectionId;
        insertLecturer(lecturer, fixture);
        String roomA = "room-a-" + fixture.sectionId;
        String roomB = "room-b-" + fixture.sectionId;
        insertClassroom(roomA, 60);
        insertClassroom(roomB, 60);
        String sectionA = fixture.sectionId + "-a";
        String sectionB = fixture.sectionId + "-b";

        Outcome outcome = raceAgainstInFlightWriter(
                () -> {
                    insertSection(sectionA, fixture, lecturer);
                    insertSchedule("schedule-" + sectionA, sectionA, roomA);
                },
                () -> {
                    try {
                        catalog.createSection(Map.of(
                                "id", sectionB,
                                "sectionNumber", "02",
                                "courseId", fixture.courseId,
                                "semesterId", fixture.semesterId,
                                "lecturerId", lecturer,
                                "capacity", 30,
                                "schedules", List.of(Map.of(
                                        "dayOfWeek", 1,
                                        "startTime", "08:00",
                                        "endTime", "10:00",
                                        "classroomId", roomB))));
                        return null;
                    } catch (Throwable failure) {
                        return failure;
                    }
                },
                "%Lecturer%");

        assertThat(outcome.waitObserved())
                .as("the second writer must queue on the shared Lecturer row").isTrue();
        assertThat(outcome.error()).isInstanceOf(DomainException.class);
        DomainException conflict = (DomainException) outcome.error();
        assertThat(conflict.getStatus().value()).isEqualTo(409);
        assertThat(conflict.code()).isEqualTo("SCHEDULE_CONFLICT");
        Integer lecturerSlots = jdbc.queryForObject(
                "SELECT COUNT(*) FROM academic.\"SectionSchedule\" ss"
                        + " JOIN academic.\"Section\" s ON s.\"id\" = ss.\"sectionId\""
                        + " WHERE s.\"lecturerId\" = :lecturer AND ss.\"dayOfWeek\" = 1"
                        + " AND ss.\"startTime\" = '08:00' AND ss.\"endTime\" = '10:00'",
                Map.of("lecturer", lecturer), Integer.class);
        assertThat(lecturerSlots).isEqualTo(1);
        assertThat(jdbc.queryForObject(
                "SELECT COUNT(*) FROM academic.\"Section\" WHERE \"id\" = :id",
                Map.of("id", sectionB), Integer.class)).isZero();
    }

    /**
     * Holds writer A's transaction open with its uncommitted rows while a
     * second writer runs the real create path: the first writer's FK checks
     * hold FOR KEY SHARE on the contended catalog row, so only an explicit
     * serialization lock on that row makes the second writer queue.
     */
    private Outcome raceAgainstInFlightWriter(
            Runnable writerA, java.util.concurrent.Callable<Throwable> writerB, String waitPattern)
            throws Exception {
        ExecutorService pool = Executors.newFixedThreadPool(2);
        CountDownLatch writerAInFlight = new CountDownLatch(1);
        CountDownLatch commitWriterA = new CountDownLatch(1);
        Future<?> holder = null;
        Future<Throwable> writer = null;
        boolean waitObserved = false;
        try {
            holder = pool.submit(() -> new TransactionTemplate(transactionManager)
                    .executeWithoutResult(status -> {
                        writerA.run();
                        writerAInFlight.countDown();
                        awaitLatch(commitWriterA);
                    }));
            assertThat(writerAInFlight.await(10, TimeUnit.SECONDS)).isTrue();

            writer = pool.submit(writerB::call);
            waitObserved = awaitLockWait(waitPattern);
        } finally {
            commitWriterA.countDown();
            pool.shutdown();
            assertThat(pool.awaitTermination(30, TimeUnit.SECONDS)).isTrue();
        }
        holder.get(1, TimeUnit.SECONDS);
        return new Outcome(waitObserved, writer.get(1, TimeUnit.SECONDS));
    }

    private void insertClassroom(String id, int capacity) {
        jdbc.update("INSERT INTO academic.\"Classroom\""
                        + " (\"id\", \"building\", \"roomNumber\", \"capacity\", \"type\", \"isActive\")"
                        + " VALUES (:id, 'A', :roomNumber, :capacity, 'LECTURE', TRUE)",
                new MapSqlParameterSource()
                        .addValue("id", id)
                        .addValue("roomNumber", id)
                        .addValue("capacity", capacity));
    }

    private void insertLecturer(String id, AcademicEnrollmentPostgresFixture fixture) {
        jdbc.update("INSERT INTO campuscore_auth.\"User\""
                        + " (\"id\", \"email\", \"password\", \"firstName\", \"lastName\", \"status\")"
                        + " VALUES (:id, :email, '{noop}not-a-real-credential', 'Race', 'Lecturer', 'ACTIVE')",
                new MapSqlParameterSource()
                        .addValue("id", id + "-user")
                        .addValue("email", id + "@campuscore.test"));
        jdbc.update("INSERT INTO academic.\"Lecturer\""
                        + " (\"id\", \"userId\", \"departmentId\", \"employeeId\", \"isActive\")"
                        + " VALUES (:id, :userId, :departmentId, :employeeId, TRUE)",
                new MapSqlParameterSource()
                        .addValue("id", id)
                        .addValue("userId", id + "-user")
                        .addValue("departmentId", fixture.departmentId)
                        .addValue("employeeId", id));
    }

    private void insertSection(String id, AcademicEnrollmentPostgresFixture fixture, String lecturerId) {
        jdbc.update("INSERT INTO academic.\"Section\""
                        + " (\"id\", \"sectionNumber\", \"courseId\", \"semesterId\", \"lecturerId\","
                        + " \"capacity\", \"enrolledCount\", \"status\", \"version\")"
                        + " VALUES (:id, '01', :courseId, :semesterId, :lecturerId, 30, 0, 'OPEN', 0)",
                new MapSqlParameterSource()
                        .addValue("id", id)
                        .addValue("courseId", fixture.courseId)
                        .addValue("semesterId", fixture.semesterId)
                        .addValue("lecturerId", lecturerId));
    }

    private void insertSchedule(String id, String sectionId, String room) {
        jdbc.update("INSERT INTO academic.\"SectionSchedule\""
                        + " (\"id\", \"sectionId\", \"classroomId\", \"dayOfWeek\", \"startTime\", \"endTime\")"
                        + " VALUES (:id, :sectionId, :room, 1, '08:00', '10:00')",
                new MapSqlParameterSource()
                        .addValue("id", id)
                        .addValue("sectionId", sectionId)
                        .addValue("room", room));
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

    private record Outcome(boolean waitObserved, Throwable error) {
    }

    private static String valueOr(String name, String fallback) {
        String value = System.getenv(name);
        return value == null || value.isBlank() ? fallback : value;
    }
}
