package io.campuscore.restfulapi.academic;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doAnswer;

import io.campuscore.restfulapi.academic.registration.RegistrationService;
import io.campuscore.restfulapi.academic.service.AcademicMutationService;
import io.campuscore.restfulapi.academic.web.AcademicMutationDtos.GradeUpdate;
import io.campuscore.restfulapi.web.DomainException;
import java.math.BigDecimal;
import java.sql.SQLException;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIf;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.dao.DeadlockLoserDataAccessException;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.jdbc.core.namedparam.SqlParameterSource;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;

/**
 * Real-PostgreSQL wait-graph proof for the module-wide writer lock order.
 * Every writer that touches an Enrollment row must already hold the owning
 * Section row — Student, then Section, then Enrollment, the same order
 * attendance check-in uses. A writer may skip a prefix of that order but may
 * never invert it.
 *
 * <p>The legacy drop and admin hard-delete paths inverted the order: each of
 * the schedules below is a deterministic ABBA deadlock (40P01) on the old
 * code and a clean serialization on the new one. No production hook is used;
 * latches inside the JDBC spy park a worker right after it wins a row lock,
 * and pg_blocking_pids shows who is queued behind whom.
 */
@EnabledIf("postgresTargetConfigured")
@SpringBootTest(properties = {
        "spring.flyway.locations=classpath:db/migration",
        "spring.jpa.hibernate.ddl-auto=none",
        "spring.datasource.hikari.maximum-pool-size=12",
        "deepseek.enabled=false"
})
@ActiveProfiles({"test", "persistence"})
class AcademicMixedMutationLockOrderPostgresIT {

    @Autowired private RegistrationService registration;
    @Autowired private AcademicMutationService mutations;
    @MockitoSpyBean private NamedParameterJdbcTemplate jdbc;

    /**
     * Grade save (Section, then Enrollment) versus drop (inverted order used
     * to hold Enrollment, then wait on Section). The save commits first; the
     * drop then succeeds on the still-active enrollment.
     */
    @Test
    void dropAndGradeSaveSerializeOnTheSectionRow() throws Exception {
        var fixture = AcademicEnrollmentPostgresFixture.seed(jdbc, 10);
        String student = fixture.seedStudent(1);
        String enrollment = registration.enroll(student, fixture.sectionId,
                List.of("STUDENT"), "seed-" + student).id();

        Race race = armRace("race-grade-save", "race-drop");
        Outcome[] outcomes = run(race,
                () -> mutations.updateGrades(fixture.sectionId, null, true, null,
                        List.of(new GradeUpdate(enrollment, new BigDecimal("8"), new BigDecimal("9")))),
                () -> registration.drop(enrollment, student, List.of("STUDENT"),
                        "drop-vs-save-" + enrollment));

        assertNoDeadlock(outcomes);
        assertThat(outcomes[0].error()).as("grade save completes while holding the section").isNull();
        assertThat(outcomes[1].error()).as("drop commits after the save releases the section").isNull();
        Map<String, Object> row = enrollmentRow(enrollment);
        assertThat(row)
                .containsEntry("status", "DROPPED")
                .containsEntry("grade_status", "DRAFT");
        // The grade write is atomic: both components or none, never a partial batch.
        assertThat(row.get("final_grade")).isNotNull();
        assertThat(componentCount(enrollment)).isEqualTo(2);
        assertThat(enrolledCount(fixture.sectionId)).isZero();
    }

    /**
     * Grade publish (Section, then Enrollment) versus drop. Publish commits
     * first; the queued drop is then rejected because a COMPLETED enrollment
     * is no longer droppable — the published record is not resurrected.
     */
    @Test
    void dropAndGradePublishSerializeOnTheSectionRow() throws Exception {
        var fixture = AcademicEnrollmentPostgresFixture.seed(jdbc, 10);
        String student = fixture.seedStudent(1);
        String enrollment = seedGradedEnrollment(fixture, student);

        Race race = armRace("race-grade-publish", "race-drop");
        Outcome[] outcomes = run(race,
                () -> mutations.publishGrades(fixture.sectionId, null, true, null),
                () -> registration.drop(enrollment, student, List.of("STUDENT"),
                        "drop-vs-publish-" + enrollment));

        assertNoDeadlock(outcomes);
        assertThat(outcomes[0].error()).as("publish completes while holding the section").isNull();
        assertConflict(outcomes[1].error(), "ENROLLMENT_NOT_ACTIVE");
        Map<String, Object> row = enrollmentRow(enrollment);
        assertThat(row)
                .containsEntry("status", "COMPLETED")
                .containsEntry("grade_status", "PUBLISHED");
        assertThat(enrolledCount(fixture.sectionId)).isEqualTo(1);
    }

    /**
     * Grade publish versus admin hard delete. Publish commits first; the
     * queued delete then removes the published row and leaves its
     * ADMIN_DELETE event behind.
     */
    @Test
    void deleteAndGradePublishSerializeOnTheSectionRow() throws Exception {
        var fixture = AcademicEnrollmentPostgresFixture.seed(jdbc, 10);
        String student = fixture.seedStudent(1);
        String enrollment = seedGradedEnrollment(fixture, student);

        Race race = armRace("race-grade-publish", "race-delete");
        Outcome[] outcomes = run(race,
                () -> mutations.publishGrades(fixture.sectionId, null, true, null),
                () -> mutations.deleteEnrollment(enrollment, "admin-user"));

        assertNoDeadlock(outcomes);
        assertThat(outcomes[0].error()).as("publish completes while holding the section").isNull();
        assertThat(outcomes[1].error()).as("delete commits after the publish releases the section").isNull();
        assertThat(enrollmentExists(enrollment)).isFalse();
        assertThat(jdbc.queryForList(
                "SELECT \"action\" FROM academic.\"EnrollmentEvent\" WHERE \"enrollmentId\" = :id",
                Map.of("id", enrollment), String.class)).contains("ADMIN_DELETE");
        // A COMPLETED enrollment holds no seat, so the counter is untouched.
        assertThat(enrolledCount(fixture.sectionId)).isEqualTo(1);
    }

    /**
     * Enroll (Student, Section, then active Enrollments) versus admin hard
     * delete of an existing enrollment in the same section. The duplicate
     * enroll is rejected and rolls back; the queued delete then commits.
     */
    @Test
    void deleteAndEnrollSerializeOnTheSectionRow() throws Exception {
        var fixture = AcademicEnrollmentPostgresFixture.seed(jdbc, 10);
        String student = fixture.seedStudent(1);
        String enrollment = registration.enroll(student, fixture.sectionId,
                List.of("STUDENT"), "seed-" + student).id();

        Race race = armRace("race-enroll", "race-delete");
        Outcome[] outcomes = run(race,
                () -> registration.enroll(student, fixture.sectionId,
                        List.of("STUDENT"), "re-enroll-" + student),
                () -> mutations.deleteEnrollment(enrollment, "admin-user"));

        assertNoDeadlock(outcomes);
        assertConflict(outcomes[0].error(), "ENROLLMENT_DUPLICATE");
        assertThat(outcomes[1].error()).as("delete commits after the duplicate enroll rolls back").isNull();
        assertThat(enrollmentExists(enrollment)).isFalse();
        assertThat(enrolledCount(fixture.sectionId)).isZero();
    }

    /**
     * A drop that commits before the publish starts must not be resurrected:
     * publish skips DROPPED rows and answers GRADES_EMPTY.
     */
    @Test
    void publishAfterACommittedDropLeavesTheRowUntouched() {
        var fixture = AcademicEnrollmentPostgresFixture.seed(jdbc, 10);
        String student = fixture.seedStudent(1);
        String enrollment = seedGradedEnrollment(fixture, student);

        registration.drop(enrollment, student, List.of("STUDENT"), "drop-then-publish-" + enrollment);

        assertThatThrownBy(() -> mutations.publishGrades(fixture.sectionId, null, true, null))
                .isInstanceOf(DomainException.class)
                .extracting("code").isEqualTo("GRADES_EMPTY");
        Map<String, Object> row = enrollmentRow(enrollment);
        assertThat(row)
                .containsEntry("status", "DROPPED")
                .containsEntry("grade_status", "DRAFT");
        assertThat(enrolledCount(fixture.sectionId)).isZero();
    }

    /** Enroll plus a complete draft grade so publish has something to flip. */
    private String seedGradedEnrollment(AcademicEnrollmentPostgresFixture fixture, String student) {
        String enrollment = registration.enroll(student, fixture.sectionId,
                List.of("STUDENT"), "seed-" + student).id();
        mutations.updateGrades(fixture.sectionId, null, true,
                List.of(new GradeUpdate(enrollment, new BigDecimal("8"), new BigDecimal("9"))));
        return enrollment;
    }

    /**
     * Arms the JDBC spy for one deterministic schedule: the first named
     * worker pauses after it wins the Section row lock (the "holder"), the
     * second named worker pauses after it wins the Enrollment row lock (the
     * "waiter"). On the unified order the waiter never reaches that second
     * latch — it queues on the holder's Section lock inside the database.
     */
    private Race armRace(String holderThread, String waiterThread) {
        Race race = new Race(holderThread, waiterThread);
        doAnswer(call -> {
            String worker = Thread.currentThread().getName();
            String sql = call.getArgument(0);
            Object result = call.callRealMethod();
            if (worker.equals(race.holderThread)) {
                race.holderPid.compareAndSet(0, backendPid());
                if (isLockOn(sql, "Section")) {
                    race.holderReady.countDown();
                    awaitLatch(race.holderRelease);
                }
            }
            if (worker.equals(race.waiterThread)) {
                race.waiterPid.compareAndSet(0, backendPid());
                if (isLockOn(sql, "Enrollment")) {
                    race.waiterReady.countDown();
                    awaitLatch(race.waiterRelease);
                }
            }
            return result;
        }).when(jdbc).queryForMap(anyString(), any(SqlParameterSource.class));
        return race;
    }

    private Outcome[] run(Race race, Runnable holder, Runnable waiter) throws Exception {
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            Future<Throwable> held = pool.submit(() -> {
                Thread.currentThread().setName(race.holderThread);
                try {
                    holder.run();
                    return null;
                } catch (Throwable failure) {
                    return failure;
                }
            });
            assertThat(race.holderReady.await(15, TimeUnit.SECONDS))
                    .as("holder owns the Section row before the waiter starts").isTrue();
            Future<Throwable> waiting = pool.submit(() -> {
                Thread.currentThread().setName(race.waiterThread);
                try {
                    waiter.run();
                    return null;
                } catch (Throwable failure) {
                    return failure;
                }
            });
            // The inverted order lets the waiter take the Enrollment row and
            // fire waiterReady while parked; the unified order makes it queue
            // on the held Section lock, observable only via pg_blocking_pids.
            boolean progressed = false;
            long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(15);
            while (!progressed && System.nanoTime() < deadline) {
                progressed = race.waiterReady.getCount() == 0
                        || (race.waiterPid.get() != 0 && race.holderPid.get() != 0
                            && Boolean.TRUE.equals(jdbc.queryForObject(
                                    "SELECT :owner = ANY(pg_blocking_pids(:waiter))",
                                    Map.of("owner", race.holderPid.get(), "waiter", race.waiterPid.get()),
                                    Boolean.class)));
                if (!progressed) {
                    Thread.sleep(25);
                }
            }
            assertThat(progressed)
                    .as("waiter reached its second lock (inverted order) or queued on the section (unified order)")
                    .isTrue();
            race.holderRelease.countDown();
            race.waiterRelease.countDown();
            return new Outcome[]{
                    new Outcome(held.get(30, TimeUnit.SECONDS)),
                    new Outcome(waiting.get(30, TimeUnit.SECONDS))};
        } finally {
            race.holderRelease.countDown();
            race.waiterRelease.countDown();
            pool.shutdownNow();
            assertThat(pool.awaitTermination(10, TimeUnit.SECONDS)).isTrue();
        }
    }

    private int backendPid() {
        return jdbc.getJdbcOperations().queryForObject("SELECT pg_backend_pid()", Integer.class);
    }

    private static boolean isLockOn(String sql, String table) {
        return sql.contains("\"" + table + "\"") && sql.contains("FOR UPDATE");
    }

    private static void awaitLatch(CountDownLatch latch) {
        try {
            if (!latch.await(20, TimeUnit.SECONDS)) {
                throw new IllegalStateException("race barrier timeout");
            }
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("interrupted at race barrier", interrupted);
        }
    }

    private void assertNoDeadlock(Outcome[] outcomes) {
        for (Outcome outcome : outcomes) {
            assertThat(isDeadlock(outcome.error()))
                    .as("no writer may be chosen as a 40P01 deadlock victim").isFalse();
        }
    }

    private static boolean isDeadlock(Throwable error) {
        for (Throwable cursor = error; cursor != null; cursor = cursor.getCause()) {
            if (cursor instanceof DeadlockLoserDataAccessException
                    || (cursor instanceof SQLException sql && "40P01".equals(sql.getSQLState()))
                    || (cursor.getMessage() != null && cursor.getMessage().contains("40P01"))) {
                return true;
            }
        }
        return false;
    }

    private static void assertConflict(Throwable error, String code) {
        assertThat(error).isInstanceOf(DomainException.class);
        assertThat(((DomainException) error).code()).isEqualTo(code);
    }

    private Map<String, Object> enrollmentRow(String enrollmentId) {
        return jdbc.queryForMap(
                "SELECT \"status\", \"gradeStatus\" AS grade_status, \"finalGrade\" AS final_grade,"
                        + " \"letterGrade\" AS letter_grade FROM academic.\"Enrollment\" WHERE \"id\" = :id",
                Map.of("id", enrollmentId));
    }

    private boolean enrollmentExists(String enrollmentId) {
        Integer count = jdbc.queryForObject(
                "SELECT COUNT(*) FROM academic.\"Enrollment\" WHERE \"id\" = :id",
                Map.of("id", enrollmentId), Integer.class);
        return count != null && count > 0;
    }

    private int enrolledCount(String sectionId) {
        Integer count = jdbc.queryForObject(
                "SELECT \"enrolledCount\" FROM academic.\"Section\" WHERE \"id\" = :id",
                Map.of("id", sectionId), Integer.class);
        return count == null ? -1 : count;
    }

    private int componentCount(String enrollmentId) {
        Integer count = jdbc.queryForObject(
                "SELECT COUNT(*) FROM academic.\"StudentGrade\" WHERE \"enrollmentId\" = :id",
                Map.of("id", enrollmentId), Integer.class);
        return count == null ? 0 : count;
    }

    static boolean postgresTargetConfigured() {
        String url = System.getenv("CAMPUSCORE_E2E_POSTGRES_URL");
        return url != null && url.startsWith("jdbc:postgresql:");
    }

    private record Outcome(Throwable error) {
    }

    /** Latch/pid pair for one deterministic two-writer schedule. */
    private static final class Race {
        final String holderThread;
        final String waiterThread;
        final CountDownLatch holderReady = new CountDownLatch(1);
        final CountDownLatch holderRelease = new CountDownLatch(1);
        final CountDownLatch waiterReady = new CountDownLatch(1);
        final CountDownLatch waiterRelease = new CountDownLatch(1);
        final AtomicInteger holderPid = new AtomicInteger();
        final AtomicInteger waiterPid = new AtomicInteger();

        Race(String holderThread, String waiterThread) {
            this.holderThread = holderThread;
            this.waiterThread = waiterThread;
        }
    }

    private static String valueOr(String name, String fallback) {
        String value = System.getenv(name);
        return value == null || value.isBlank() ? fallback : value;
    }

    @DynamicPropertySource
    static void postgresProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", () -> System.getenv("CAMPUSCORE_E2E_POSTGRES_URL"));
        registry.add("spring.datasource.username", () -> valueOr("CAMPUSCORE_E2E_POSTGRES_USER", "postgres"));
        registry.add("spring.datasource.password", () -> valueOr("CAMPUSCORE_E2E_POSTGRES_PASSWORD", "postgres"));
    }
}
