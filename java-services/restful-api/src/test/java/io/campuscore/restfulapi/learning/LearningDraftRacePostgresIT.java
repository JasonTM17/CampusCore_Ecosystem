package io.campuscore.restfulapi.learning;

import static org.assertj.core.api.Assertions.assertThat;

import io.campuscore.restfulapi.learning.service.LearningService;
import io.campuscore.restfulapi.learning.service.LearningStudentService;
import io.campuscore.restfulapi.learning.web.LearningDtos.AssignmentUpsertRequest;
import io.campuscore.restfulapi.learning.web.LearningDtos.SubmissionResponse;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
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
 * PostgreSQL authority for first-draft creation: two requests that reach the
 * same (assignment, student) pair under different retry keys race on the
 * unique backstop. The losing insert must not poison its transaction —
 * PostgreSQL aborts the whole transaction on a plain unique violation, so a
 * catch-then-reread in the same transaction can never return the winner's
 * draft on the real engine.
 *
 * <p><b>Environment contract</b>: runs ONLY when
 * {@code CAMPUSCORE_E2E_POSTGRES_URL} points at a {@code jdbc:postgresql:}
 * database, same opt-in convention as the events/academic ITs.
 */
@EnabledIf(value = "io.campuscore.restfulapi.learning.LearningDraftRacePostgresIT#postgresTargetConfigured")
@SpringBootTest(properties = {
        "spring.flyway.locations=classpath:db/migration",
        "deepseek.enabled=false",
        "spring.jpa.hibernate.ddl-auto=none",
        "spring.datasource.hikari.maximum-pool-size=16"
})
@ActiveProfiles({"test", "persistence"})
class LearningDraftRacePostgresIT {

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
    private String lecturerId;
    private String studentId;

    @BeforeEach
    void seed() {
        suffix = "drace-" + UUID.randomUUID().toString().substring(0, 8);
        String yearId = "ay-" + suffix;
        String facultyId = "fac-" + suffix;
        String departmentId = "dept-" + suffix;
        String curriculumId = "cur-" + suffix;
        String courseId = "course-" + suffix;
        String semesterId = "sem-" + suffix;
        sectionId = "sec-" + suffix;
        lecturerId = "lec-" + suffix;
        studentId = "stu-" + suffix;
        Timestamp now = Timestamp.from(Instant.now());
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

        jdbc.update("INSERT INTO campuscore_auth.\"User\" (\"id\",\"email\",\"password\",\"firstName\",\"lastName\",\"status\")"
                        + " VALUES (:id,:email,'x','It','Lecturer','ACTIVE')",
                new MapSqlParameterSource("id", "user-" + lecturerId)
                        .addValue("email", "user-" + lecturerId + "@it.local"));
        jdbc.update("INSERT INTO academic.\"Lecturer\" (\"id\",\"userId\",\"departmentId\",\"employeeId\")"
                        + " VALUES (:id,:user,:dept,:emp)",
                new MapSqlParameterSource("id", lecturerId).addValue("user", "user-" + lecturerId)
                        .addValue("dept", departmentId).addValue("emp", "E-" + lecturerId));
        jdbc.update("INSERT INTO academic.\"Section\" (\"id\",\"sectionNumber\",\"courseId\",\"semesterId\",\"lecturerId\",\"capacity\",\"enrolledCount\",\"status\",\"version\")"
                        + " VALUES (:id,'01',:course,:sem,:lec,40,0,'OPEN',0)",
                new MapSqlParameterSource("id", sectionId).addValue("course", courseId)
                        .addValue("sem", semesterId).addValue("lec", lecturerId));

        jdbc.update("INSERT INTO campuscore_auth.\"User\" (\"id\",\"email\",\"password\",\"firstName\",\"lastName\",\"status\")"
                        + " VALUES (:id,:email,'x','It','Student','ACTIVE')",
                new MapSqlParameterSource("id", "user-" + studentId)
                        .addValue("email", "user-" + studentId + "@it.local"));
        jdbc.update("INSERT INTO academic.\"Student\" (\"id\",\"userId\",\"studentId\",\"curriculumId\",\"year\",\"status\",\"admissionDate\")"
                        + " VALUES (:id,:user,:sid,:cur,2,'ACTIVE',:now)",
                new MapSqlParameterSource("id", studentId).addValue("user", "user-" + studentId)
                        .addValue("sid", "SR-" + studentId).addValue("cur", curriculumId).addValue("now", now));
        jdbc.update("INSERT INTO academic.\"Enrollment\" (\"id\",\"studentId\",\"sectionId\",\"semesterId\",\"status\",\"enrolledAt\",\"gradeStatus\",\"courseId\",\"creditsSnapshot\")"
                        + " VALUES (:id,:stu,:sec,:sem,'ENROLLED',:now,'NOT_GRADED',:course,3)",
                new MapSqlParameterSource("id", "enr-" + suffix).addValue("stu", studentId)
                        .addValue("sec", sectionId).addValue("sem", semesterId)
                        .addValue("now", now).addValue("course", courseId));
    }

    private String publishedAssignment(Instant deadline) {
        var created = staff.createAssignment(lecturerId, sectionId,
                new AssignmentUpsertRequest("IT assignment", "desc", deadline, 10.0, null));
        return staff.publish(lecturerId, created.id()).id();
    }

    // ------------------------------------------------------------------
    // Deterministic race: an uncommitted winner holds the unique pair while
    // the losing lane runs the full draft-open path. Its insert blocks on the
    // in-flight row; once the winner commits, the loser must return that
    // committed draft — on the broken path its re-read dies inside the
    // transaction PostgreSQL already aborted.
    // ------------------------------------------------------------------

    @Test
    void racedFirstDraftInsertReturnsTheCommittedSubmission() throws Exception {
        String assignmentId = publishedAssignment(Instant.now().plus(1, ChronoUnit.HOURS));
        String winnerSubmissionId = "sub-anchor-" + UUID.randomUUID();
        try (var anchor = jdbc.getJdbcTemplate().getDataSource().getConnection()) {
            anchor.setAutoCommit(false);
            try (var insert = anchor.prepareStatement(
                    "INSERT INTO learning.\"Submission\""
                            + " (\"id\", \"assignmentId\", \"studentId\", \"status\") VALUES (?, ?, ?, 'DRAFT')")) {
                insert.setString(1, winnerSubmissionId);
                insert.setString(2, assignmentId);
                insert.setString(3, studentId);
                insert.executeUpdate();
            }
            ExecutorService pool = Executors.newSingleThreadExecutor();
            try {
                Future<Object> loser = pool.submit(() -> {
                    try {
                        return students.ensureDraft(studentId, assignmentId, "race-loser-key");
                    } catch (Exception failure) {
                        return failure;
                    }
                });
                // Confirm the losing lane is actually blocked on the raced
                // insert before the winner commits.
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
                assertThat(waiting).as("losing lane observed waiting on the raced insert")
                        .isGreaterThanOrEqualTo(1);
                anchor.commit();
                Object result = loser.get(30, TimeUnit.SECONDS);
                assertThat(result).isInstanceOf(SubmissionResponse.class);
                assertThat(((SubmissionResponse) result).id()).isEqualTo(winnerSubmissionId);
                assertThat(((SubmissionResponse) result).status()).isEqualTo("DRAFT");
            } finally {
                pool.shutdownNow();
            }
        }
        Integer rows = jdbc.queryForObject(
                "SELECT COUNT(*) FROM learning.\"Submission\" WHERE \"assignmentId\" = :a AND \"studentId\" = :s",
                Map.of("a", assignmentId, "s", studentId), Integer.class);
        assertThat(rows).isEqualTo(1);
    }

    // ------------------------------------------------------------------
    // The reported schedule: two tabs open the same student's first draft
    // under different retry keys. Both must succeed and converge to the one
    // submission — never an aborted-transaction error.
    // ------------------------------------------------------------------

    @Test
    void concurrentDistinctKeyDraftsConvergeToOneSubmission() throws Exception {
        String assignmentId = publishedAssignment(Instant.now().plus(1, ChronoUnit.HOURS));
        ExecutorService pool = Executors.newFixedThreadPool(2);
        CountDownLatch ready = new CountDownLatch(2);
        CountDownLatch start = new CountDownLatch(1);
        List<Future<Object>> futures = new ArrayList<>();
        try {
            for (int lane = 0; lane < 2; lane++) {
                String key = "draft-key-lane-" + lane;
                futures.add(pool.submit(() -> {
                    ready.countDown();
                    if (!start.await(10, TimeUnit.SECONDS)) {
                        return new AssertionError("start barrier timeout");
                    }
                    try {
                        return students.ensureDraft(studentId, assignmentId, key);
                    } catch (Exception failure) {
                        return failure;
                    }
                }));
            }
            assertThat(ready.await(10, TimeUnit.SECONDS)).isTrue();
            start.countDown();
            List<String> submissionIds = new ArrayList<>();
            for (Future<Object> future : futures) {
                Object result = future.get(60, TimeUnit.SECONDS);
                assertThat(result).isInstanceOf(SubmissionResponse.class);
                submissionIds.add(((SubmissionResponse) result).id());
            }
            assertThat(java.util.Set.copyOf(submissionIds)).hasSize(1);
        } finally {
            pool.shutdownNow();
            assertThat(pool.awaitTermination(10, TimeUnit.SECONDS)).isTrue();
        }
        Integer rows = jdbc.queryForObject(
                "SELECT COUNT(*) FROM learning.\"Submission\" WHERE \"assignmentId\" = :a AND \"studentId\" = :s",
                Map.of("a", assignmentId, "s", studentId), Integer.class);
        assertThat(rows).isEqualTo(1);
    }

    static boolean postgresTargetConfigured() {
        String url = System.getenv("CAMPUSCORE_E2E_POSTGRES_URL");
        return url != null && url.startsWith("jdbc:postgresql:");
    }

    private static String valueOr(String name, String fallback) {
        String value = System.getenv(name);
        return value == null || value.isBlank() ? fallback : value;
    }
}
