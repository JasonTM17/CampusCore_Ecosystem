package io.campuscore.restfulapi.learning;

import static org.assertj.core.api.Assertions.assertThat;

import io.campuscore.restfulapi.learning.service.LearningService;
import io.campuscore.restfulapi.learning.service.LearningStudentService;
import io.campuscore.restfulapi.learning.web.LearningDtos.AssignmentUpsertRequest;
import io.campuscore.restfulapi.learning.web.LearningDtos.SubmissionUpsertRequest;
import io.campuscore.restfulapi.web.DomainException;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIf;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/**
 * PostgreSQL authority test for LMS-X01/LMS-T03 (contract §6). The H2 contract
 * test proves the business logic; only the real engine proves that the
 * server-clock deadline is evaluated under the assignment row lock and that
 * concurrent same-key submits never produce a second revision.
 *
 * <p><b>Environment contract</b>: runs ONLY when
 * {@code CAMPUSCORE_E2E_POSTGRES_URL} points at a {@code jdbc:postgresql:}
 * database, same opt-in convention as the events/academic ITs.
 */
@EnabledIf(value = "io.campuscore.restfulapi.learning.LearningAuthorityPostgresIT#postgresTargetConfigured")
@SpringBootTest(properties = {
        "spring.flyway.locations=classpath:db/migration",
        "deepseek.enabled=false",
        "spring.jpa.hibernate.ddl-auto=none",
        "spring.datasource.hikari.maximum-pool-size=16"
})
@ActiveProfiles({"test", "persistence"})
class LearningAuthorityPostgresIT {

    @Autowired
    private LearningService staff;

    @Autowired
    private LearningStudentService students;

    @Autowired
    private NamedParameterJdbcTemplate jdbc;

    @DynamicPropertySource
    static void postgresProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", () -> valueOr(
                "CAMPUSCORE_E2E_POSTGRES_URL", "jdbc:postgresql://localhost:5432/campuscore_e2e"));
        registry.add("spring.datasource.username", () -> valueOr("CAMPUSCORE_E2E_POSTGRES_USER", "postgres"));
        registry.add("spring.datasource.password", () -> valueOr("CAMPUSCORE_E2E_POSTGRES_PASSWORD", "postgres"));
    }

    private String suffix;
    private String sectionId;
    private String otherSectionId;
    private String lecturerId;
    private String otherLecturerId;
    private String studentId;
    private String otherStudentId;

    @BeforeEach
    void seed() {
        suffix = "lms-" + UUID.randomUUID().toString().substring(0, 8);
        String yearId = "ay-" + suffix;
        String facultyId = "fac-" + suffix;
        String departmentId = "dept-" + suffix;
        String curriculumId = "cur-" + suffix;
        String courseId = "course-" + suffix;
        String semesterId = "sem-" + suffix;
        sectionId = "sec-" + suffix;
        otherSectionId = "sec2-" + suffix;
        lecturerId = "lec-" + suffix;
        otherLecturerId = "lec2-" + suffix;
        studentId = "stu-" + suffix;
        otherStudentId = "stu2-" + suffix;
        Timestamp now = Timestamp.from(Instant.now());
        Timestamp farPast = Timestamp.from(Instant.parse("2020-01-01T00:00:00Z"));
        Timestamp farFuture = Timestamp.from(Instant.parse("2099-01-01T00:00:00Z"));

        jdbc.update("INSERT INTO academic.\"AcademicYear\" (\"id\",\"year\",\"startDate\",\"endDate\",\"isCurrent\")"
                        + " VALUES (:id, 2026, :start, :end, TRUE)",
                new MapSqlParameterSource("id", yearId).addValue("start", now).addValue("end", farFuture));
        jdbc.update("INSERT INTO academic.\"Faculty\" (\"id\",\"name\",\"code\") VALUES (:id,:name,:code)",
                new MapSqlParameterSource("id", facultyId).addValue("name", "IT " + suffix).addValue("code", "F-" + suffix));
        jdbc.update("INSERT INTO academic.\"Department\" (\"id\",\"name\",\"code\",\"facultyId\")"
                        + " VALUES (:id,:name,:code,:facultyId)",
                new MapSqlParameterSource("id", departmentId).addValue("name", "SE " + suffix)
                        .addValue("code", "D-" + suffix).addValue("facultyId", facultyId));
        jdbc.update("INSERT INTO academic.\"Curriculum\" (\"id\",\"name\",\"code\",\"departmentId\",\"academicYearId\",\"totalCredits\",\"isActive\")"
                        + " VALUES (:id,:name,:code,:dept,:ay,150,TRUE)",
                new MapSqlParameterSource("id", curriculumId).addValue("name", "Cur " + suffix)
                        .addValue("code", "C-" + suffix).addValue("dept", departmentId).addValue("ay", yearId));
        jdbc.update("INSERT INTO academic.\"Course\" (\"id\",\"code\",\"name\",\"credits\",\"departmentId\",\"isActive\")"
                        + " VALUES (:id,:code,:name,3,:dept,TRUE)",
                new MapSqlParameterSource("id", courseId).addValue("code", "IT" + suffix)
                        .addValue("name", "LMS Course " + suffix).addValue("dept", departmentId));
        jdbc.update("INSERT INTO academic.\"Semester\" (\"id\",\"name\",\"type\",\"academicYearId\",\"startDate\",\"endDate\",\"status\")"
                        + " VALUES (:id,:name,'FALL',:ay,:start,:end,'ACTIVE')",
                new MapSqlParameterSource("id", semesterId).addValue("name", "Sem " + suffix)
                        .addValue("ay", yearId).addValue("start", now).addValue("end", farFuture));

        seedLecturer(lecturerId, "lecturer-" + suffix, departmentId);
        seedLecturer(otherLecturerId, "lecturer2-" + suffix, departmentId);
        jdbc.update("INSERT INTO academic.\"Section\" (\"id\",\"sectionNumber\",\"courseId\",\"semesterId\",\"lecturerId\",\"capacity\",\"enrolledCount\",\"status\",\"version\")"
                        + " VALUES (:id,'01',:course,:sem,:lec,40,0,'OPEN',0)",
                new MapSqlParameterSource("id", sectionId).addValue("course", courseId)
                        .addValue("sem", semesterId).addValue("lec", lecturerId));
        jdbc.update("INSERT INTO academic.\"Section\" (\"id\",\"sectionNumber\",\"courseId\",\"semesterId\",\"lecturerId\",\"capacity\",\"enrolledCount\",\"status\",\"version\")"
                        + " VALUES (:id,'02',:course,:sem,:lec,40,0,'OPEN',0)",
                new MapSqlParameterSource("id", otherSectionId).addValue("course", courseId)
                        .addValue("sem", semesterId).addValue("lec", otherLecturerId));

        seedStudent(studentId, "student-" + suffix, curriculumId);
        seedStudent(otherStudentId, "student2-" + suffix, curriculumId);
        enroll(studentId, sectionId, semesterId, "ENROLLED");
        enroll(otherStudentId, sectionId, semesterId, "CONFIRMED");
        // A revoked seat in the assigned lecturer's section.
        enroll(otherStudentId, otherSectionId, semesterId, "DROPPED");
    }

    private void seedLecturer(String id, String userId, String departmentId) {
        jdbc.update("INSERT INTO campuscore_auth.\"User\" (\"id\",\"email\",\"password\",\"firstName\",\"lastName\",\"status\")"
                        + " VALUES (:id,:email,'x','It','Lecturer','ACTIVE')",
                new MapSqlParameterSource("id", userId).addValue("email", userId + "@it.local"));
        jdbc.update("INSERT INTO academic.\"Lecturer\" (\"id\",\"userId\",\"departmentId\",\"employeeId\")"
                        + " VALUES (:id,:user,:dept,:emp)",
                new MapSqlParameterSource("id", id).addValue("user", userId)
                        .addValue("dept", departmentId).addValue("emp", "E-" + id));
    }

    private void seedStudent(String id, String userId, String curriculumId) {
        jdbc.update("INSERT INTO campuscore_auth.\"User\" (\"id\",\"email\",\"password\",\"firstName\",\"lastName\",\"status\")"
                        + " VALUES (:id,:email,'x','It','Student','ACTIVE')",
                new MapSqlParameterSource("id", userId).addValue("email", userId + "@it.local"));
        jdbc.update("INSERT INTO academic.\"Student\" (\"id\",\"userId\",\"studentId\",\"curriculumId\",\"year\",\"status\",\"admissionDate\")"
                        + " VALUES (:id,:user,:sid,:cur,2,'ACTIVE',:now)",
                new MapSqlParameterSource("id", id).addValue("user", userId)
                        .addValue("sid", "SR-" + id).addValue("cur", curriculumId)
                        .addValue("now", Timestamp.from(Instant.now())));
    }

    private void enroll(String student, String section, String semester, String status) {
        jdbc.update("INSERT INTO academic.\"Enrollment\" (\"id\",\"studentId\",\"sectionId\",\"semesterId\",\"status\",\"enrolledAt\",\"gradeStatus\",\"courseId\",\"creditsSnapshot\")"
                        + " VALUES (:id,:stu,:sec,:sem,:status,:now,'NOT_GRADED',:course,3)",
                new MapSqlParameterSource("id", "enr-" + student + "-" + section.substring(0, 8))
                        .addValue("stu", student).addValue("sec", section).addValue("sem", semester)
                        .addValue("status", status).addValue("now", Timestamp.from(Instant.now()))
                        .addValue("course", "course-" + suffix));
    }

    private String publishedAssignment(Instant deadline) {
        var created = staff.createAssignment(lecturerId, sectionId,
                new AssignmentUpsertRequest("IT assignment", "desc", deadline, 10.0, null));
        return staff.publish(lecturerId, created.id()).id();
    }

    // ------------------------------------------------------------------
    // LMS-X01 on Postgres: a submit that ARRIVES before the deadline but
    // only acquires the assignment lock after it passes must be rejected —
    // the clock oracle is evaluated at mutation time under the row lock.
    // ------------------------------------------------------------------

    @Test
    void submitBlockedPastDeadlineUnderRowLockIsRejectedOnPostgres() throws Exception {
        String assignmentId = publishedAssignment(Instant.now().plus(2, ChronoUnit.SECONDS));
        var draft = students.ensureDraft(studentId, assignmentId, "it-draft-deadline");

        try (var anchor = jdbc.getJdbcTemplate().getDataSource().getConnection()) {
            anchor.setAutoCommit(false);
            try (var lock = anchor.prepareStatement(
                    "SELECT \"id\" FROM learning.\"Assignment\" WHERE \"id\"=? FOR UPDATE")) {
                lock.setString(1, assignmentId);
                try (var rows = lock.executeQuery()) {
                    assertThat(rows.next()).isTrue();
                }
            }
            ExecutorService pool = Executors.newSingleThreadExecutor();
            try {
                Future<Outcome> blocked = pool.submit((Callable<Outcome>) () -> {
                    try {
                        students.submit(studentId, assignmentId, "it-submit-deadline");
                        return new Outcome(true, 200, "");
                    } catch (DomainException rejection) {
                        return new Outcome(false, rejection.getStatus().value(), rejection.code());
                    }
                });
                // Confirm the submitter is actually waiting on the row lock,
                // then let the deadline pass while it is queued.
                int waiting = 0;
                long pollDeadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(10);
                while (System.nanoTime() < pollDeadline) {
                    waiting = jdbc.queryForObject(
                            "SELECT COUNT(*) FROM pg_stat_activity WHERE datname=current_database()"
                                    + " AND wait_event_type='Lock' AND state='active'",
                            Map.of(), Integer.class);
                    if (waiting >= 1) {
                        break;
                    }
                    Thread.sleep(20);
                }
                assertThat(waiting).as("submitter observed at the assignment lock").isGreaterThanOrEqualTo(1);
                Thread.sleep(2500); // server clock now past deadlineAt
                anchor.commit();
                Outcome outcome = blocked.get(30, TimeUnit.SECONDS);
                assertThat(outcome.registered()).isFalse();
                assertThat(outcome.status()).isEqualTo(409);
                assertThat(outcome.code()).isEqualTo("DEADLINE_PASSED");
            } finally {
                pool.shutdownNow();
            }
        }
        // And no revision row leaked from the rejected submit.
        Integer revisions = jdbc.queryForObject(
                "SELECT COUNT(*) FROM learning.\"SubmissionRevision\" WHERE \"submissionId\" = :id",
                Map.of("id", draft.id()), Integer.class);
        assertThat(revisions).isZero();
    }

    // ------------------------------------------------------------------
    // Concurrent same-key submit: exactly one revision regardless of which
    // lane wins the idempotency claim (§1.3 + LMS-X02 on the real engine).
    // ------------------------------------------------------------------

    @Test
    void concurrentSameKeySubmitYieldsSingleRevisionOnPostgres() throws Exception {
        String assignmentId = publishedAssignment(Instant.now().plus(1, ChronoUnit.HOURS));
        var draft = students.ensureDraft(studentId, assignmentId, "it-draft-race");
        students.saveDraft(studentId, draft.id(),
                new SubmissionUpsertRequest("race fixture content", null, null, null, null));
        ExecutorService pool = Executors.newFixedThreadPool(2);
        CountDownLatch ready = new CountDownLatch(2);
        CountDownLatch start = new CountDownLatch(1);
        List<Future<Outcome>> futures = new ArrayList<>();
        try {
            for (int lane = 0; lane < 2; lane++) {
                futures.add(pool.submit((Callable<Outcome>) () -> {
                    ready.countDown();
                    if (!start.await(10, TimeUnit.SECONDS)) {
                        return new Outcome(false, -1, "start barrier timeout");
                    }
                    try {
                        students.submit(studentId, assignmentId, "same-submit-key");
                        return new Outcome(true, 200, "");
                    } catch (DomainException rejection) {
                        return new Outcome(false, rejection.getStatus().value(), rejection.code());
                    }
                }));
            }
            assertThat(ready.await(10, TimeUnit.SECONDS)).isTrue();
            start.countDown();
            List<Outcome> outcomes = new ArrayList<>();
            for (Future<Outcome> future : futures) {
                outcomes.add(future.get(60, TimeUnit.SECONDS));
            }
            // At least one lane succeeds; a loser can only hit a business
            // conflict (in-progress/state), never a 500 or duplicate write.
            assertThat(outcomes.stream().anyMatch(Outcome::registered))
                    .as("submit outcomes: %s", outcomes)
                    .isTrue();
            assertThat(outcomes.stream().filter(o -> !o.registered())
                            .allMatch(o -> o.status() == 409 || o.status() == 403))
                    .as("submit outcomes: %s", outcomes)
                    .isTrue();
            Integer submissions = jdbc.queryForObject(
                    "SELECT COUNT(*) FROM learning.\"Submission\" WHERE \"assignmentId\" = :a AND \"studentId\" = :s",
                    Map.of("a", assignmentId, "s", studentId), Integer.class);
            Integer revisions = jdbc.queryForObject(
                    "SELECT COUNT(*) FROM learning.\"SubmissionRevision\" r"
                            + " JOIN learning.\"Submission\" sub ON sub.\"id\" = r.\"submissionId\""
                            + " WHERE sub.\"assignmentId\" = :a AND sub.\"studentId\" = :s",
                    Map.of("a", assignmentId, "s", studentId), Integer.class);
            assertThat(submissions)
                    .as("submit outcomes: %s", outcomes)
                    .isEqualTo(1);
            assertThat(revisions)
                    .as("submit outcomes: %s", outcomes)
                    .isEqualTo(1);
        } finally {
            pool.shutdownNow();
            assertThat(pool.awaitTermination(10, TimeUnit.SECONDS)).isTrue();
        }
    }

    // ------------------------------------------------------------------
    // Concurrent same-key draft open: the unique (assignment, student)
    // backstop plus the idempotency claim must yield exactly one row.
    // ------------------------------------------------------------------

    @Test
    void concurrentSameKeyDraftYieldsSingleSubmissionOnPostgres() throws Exception {
        String assignmentId = publishedAssignment(Instant.now().plus(1, ChronoUnit.HOURS));
        ExecutorService pool = Executors.newFixedThreadPool(2);
        CountDownLatch ready = new CountDownLatch(2);
        CountDownLatch start = new CountDownLatch(1);
        List<Future<Outcome>> futures = new ArrayList<>();
        try {
            for (int lane = 0; lane < 2; lane++) {
                futures.add(pool.submit((Callable<Outcome>) () -> {
                    ready.countDown();
                    if (!start.await(10, TimeUnit.SECONDS)) {
                        return new Outcome(false, -1, "start barrier timeout");
                    }
                    try {
                        students.ensureDraft(studentId, assignmentId, "same-draft-key");
                        return new Outcome(true, 200, "");
                    } catch (DomainException rejection) {
                        return new Outcome(false, rejection.getStatus().value(), rejection.code());
                    }
                }));
            }
            assertThat(ready.await(10, TimeUnit.SECONDS)).isTrue();
            start.countDown();
            List<Outcome> outcomes = new ArrayList<>();
            for (Future<Outcome> future : futures) {
                outcomes.add(future.get(60, TimeUnit.SECONDS));
            }
            assertThat(outcomes.stream().anyMatch(Outcome::registered)).isTrue();
            Integer rows = jdbc.queryForObject(
                    "SELECT COUNT(*) FROM learning.\"Submission\" WHERE \"assignmentId\" = :a AND \"studentId\" = :s",
                    Map.of("a", assignmentId, "s", studentId), Integer.class);
            assertThat(rows).isEqualTo(1);
        } finally {
            pool.shutdownNow();
            assertThat(pool.awaitTermination(10, TimeUnit.SECONDS)).isTrue();
        }
    }

    // ------------------------------------------------------------------
    // Section authority on the real schema: the other section's lecturer
    // cannot mutate, and a dropped enrollment cannot post work.
    // ------------------------------------------------------------------

    @Test
    void crossSectionAuthorityAndRevokedEnrollmentOnPostgres() {
        String assignmentId = publishedAssignment(Instant.now().plus(1, ChronoUnit.HOURS));
        org.assertj.core.api.Assertions.assertThatThrownBy(
                        () -> staff.close(otherLecturerId, assignmentId))
                .isInstanceOf(DomainException.class)
                .extracting(e -> ((DomainException) e).code())
                .isEqualTo("SECTION_NOT_ASSIGNED");
        // otherStudent's sec-b seat is DROPPED — draft open on sec-b's
        // assignment is refused even though the seat row exists.
        var secB = staff.createAssignment(otherLecturerId, otherSectionId,
                new AssignmentUpsertRequest("sec-b", null, null, null, null));
        staff.publish(otherLecturerId, secB.id());
        org.assertj.core.api.Assertions.assertThatThrownBy(
                        () -> students.ensureDraft(otherStudentId, secB.id(), "it-dropped"))
                .isInstanceOf(DomainException.class)
                .extracting(e -> ((DomainException) e).code())
                .isEqualTo("NOT_ENROLLED");
    }

    static boolean postgresTargetConfigured() {
        String url = System.getenv("CAMPUSCORE_E2E_POSTGRES_URL");
        return url != null && url.startsWith("jdbc:postgresql:");
    }

    private record Outcome(boolean registered, int status, String code) {
    }

    private static String valueOr(String name, String fallback) {
        String value = System.getenv(name);
        return value == null || value.isBlank() ? fallback : value;
    }
}
