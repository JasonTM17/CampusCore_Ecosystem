package io.campuscore.restfulapi.learning;

import static org.assertj.core.api.Assertions.assertThat;

import io.campuscore.restfulapi.learning.service.LearningService;
import io.campuscore.restfulapi.learning.service.LearningStudentService;
import io.campuscore.restfulapi.learning.web.LearningDtos.AssignmentUpsertRequest;
import io.campuscore.restfulapi.learning.web.LearningDtos.SubmissionResponse;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import io.campuscore.restfulapi.learning.web.LearningDtos.SubmissionUpsertRequest;
import io.campuscore.restfulapi.web.DomainException;
import java.util.concurrent.atomic.AtomicInteger;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.namedparam.SqlParameterSource;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.junit.jupiter.api.condition.EnabledIf;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/** PostgreSQL schedules prove draft writes and assignment closure share the
 * Assignment-before-Submission lock order. Only the disposable runner enables it. */
@EnabledIf(value = "io.campuscore.restfulapi.learning.LearningDraftLifecyclePostgresIT#postgresTargetConfigured")
@SpringBootTest(properties = {
        "spring.flyway.locations=classpath:db/migration",
        "deepseek.enabled=false",
        "spring.jpa.hibernate.ddl-auto=none",
        "spring.datasource.hikari.maximum-pool-size=16"
})
@ActiveProfiles({"test", "persistence"})
class LearningDraftLifecyclePostgresIT {

    @Autowired
    private LearningService staff;

    @Autowired
    private LearningStudentService students;

    @Autowired
    private NamedParameterJdbcTemplate jdbc;

    @Autowired
    private PlatformTransactionManager transactions;

    @Autowired
    private tools.jackson.databind.ObjectMapper objectMapper;

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
        suffix = "dlife-" + UUID.randomUUID().toString().substring(0, 8);
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


    @ParameterizedTest
    @ValueSource(booleans = {false, true})
    void closeOwningAssignmentLockRejectsDraftWithoutWrites(boolean save) throws Exception {
        String assignmentId = publishedAssignment(Instant.now().plus(1, ChronoUnit.HOURS));
        String submissionId = save ? students.ensureDraft(studentId, assignmentId, "seed").id() : null;
        var before = snapshot(assignmentId);
        CountDownLatch closed = new CountDownLatch(1);
        CountDownLatch releaseClose = new CountDownLatch(1);
        AtomicInteger closerPid = new AtomicInteger();
        AtomicInteger writerPid = new AtomicInteger();
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            Future<?> closer = pool.submit(() -> new TransactionTemplate(transactions).execute(status -> {
                closerPid.set(backendPid());
                staff.close(lecturerId, assignmentId);
                closed.countDown();
                await(releaseClose);
                return null;
            }));
            assertThat(closed.await(10, TimeUnit.SECONDS)).as("close holds Assignment lock").isTrue();
            Future<Object> writer = pool.submit(() -> {
                try {
                    return new TransactionTemplate(transactions).execute(status -> {
                        writerPid.set(backendPid());
                        return mutate(students, save, assignmentId, submissionId);
                    });
                } catch (DomainException failure) {
                    return failure;
                }
            });
            assertThat(waitingOn(writer, writerPid, closerPid)).as("draft waits on close's Assignment lock").isTrue();
            if (save) {
                // Waiting for Assignment must not already own Submission.
                assertThat(jdbc.queryForObject("SELECT \"id\" FROM learning.\"Submission\""
                                + " WHERE \"id\"=:id FOR UPDATE NOWAIT", Map.of("id", submissionId), String.class))
                        .isEqualTo(submissionId);
            }
            releaseClose.countDown();
            closer.get(10, TimeUnit.SECONDS);
            Object result = writer.get(10, TimeUnit.SECONDS);
            assertThat(result).isInstanceOfSatisfying(DomainException.class, failure -> {
                assertThat(failure.code()).isEqualTo("ASSIGNMENT_NOT_OPEN");
                assertThat(failure.status()).isEqualTo(HttpStatus.CONFLICT);
            });
            // Closure adds its own audit, but no draft, file or retry claim can survive.
            assertThat(snapshot(assignmentId)).isEqualTo(before);
        } finally {
            releaseClose.countDown();
            pool.shutdownNow();
            assertThat(pool.awaitTermination(15, TimeUnit.SECONDS)).isTrue();
        }
    }

    @ParameterizedTest
    @ValueSource(booleans = {false, true})
    void draftOwningAssignmentLockMakesCloseWait(boolean save) throws Exception {
        String assignmentId = publishedAssignment(Instant.now().plus(1, ChronoUnit.HOURS));
        String submissionId = save ? students.ensureDraft(studentId, assignmentId, "seed").id() : null;
        CountDownLatch wrote = new CountDownLatch(1);
        CountDownLatch releaseWriter = new CountDownLatch(1);
        AtomicInteger writerPid = new AtomicInteger();
        AtomicInteger closerPid = new AtomicInteger();
        // Pause after the actual INSERT/UPDATE, inside the writer transaction.
        // This seam never grants a lock the service itself did not acquire.
        var pausedJdbc = new NamedParameterJdbcTemplate(jdbc.getJdbcTemplate()) {
            @Override
            public int update(String sql, SqlParameterSource parameters) {
                int count = super.update(sql, parameters);
                if (sql.startsWith("INSERT INTO learning.\"Submission\" ")
                        || sql.startsWith("UPDATE learning.\"Submission\" ")) {
                    wrote.countDown();
                    await(releaseWriter);
                }
                return count;
            }
        };
        var pausedStudents = new LearningStudentService(pausedJdbc, staff, objectMapper);
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            Future<SubmissionResponse> writer = pool.submit(() -> new TransactionTemplate(transactions).execute(status -> {
                writerPid.set(backendPid());
                return mutate(pausedStudents, save, assignmentId, submissionId);
            }));
            assertThat(wrote.await(10, TimeUnit.SECONDS)).as("draft mutation paused before commit").isTrue();
            Future<?> closer = pool.submit(() -> new TransactionTemplate(transactions).execute(status -> {
                closerPid.set(backendPid());
                return staff.close(lecturerId, assignmentId);
            }));
            assertThat(waitingOn(closer, closerPid, writerPid)).as("close waits on draft's Assignment lock").isTrue();
            releaseWriter.countDown();
            assertThat(writer.get(10, TimeUnit.SECONDS).status()).isEqualTo("DRAFT");
            closer.get(10, TimeUnit.SECONDS);
            assertThat(jdbc.queryForObject("SELECT \"status\" FROM learning.\"Assignment\" WHERE \"id\"=:id",
                    Map.of("id", assignmentId), String.class)).isEqualTo("CLOSED");
        } finally {
            releaseWriter.countDown();
            pool.shutdownNow();
            assertThat(pool.awaitTermination(15, TimeUnit.SECONDS)).isTrue();
        }
    }

    private SubmissionResponse mutate(LearningStudentService service, boolean save,
            String assignmentId, String submissionId) {
        return save ? service.saveDraft(studentId, submissionId,
                new SubmissionUpsertRequest("new text", "draft.txt", "text/plain", "ZHJhZnQ=", null))
                : service.ensureDraft(studentId, assignmentId, "draft-write");
    }

    private Object snapshot(String assignmentId) {
        return java.util.List.of(
                jdbc.queryForList("SELECT * FROM learning.\"Submission\" WHERE \"assignmentId\"=:id ORDER BY \"id\"",
                        Map.of("id", assignmentId)),
                jdbc.queryForList("SELECT * FROM learning.\"Idempotency\" WHERE \"ownerId\"=:id ORDER BY \"id\"",
                        Map.of("id", studentId)),
                jdbc.queryForList("SELECT * FROM learning.\"Audit\" WHERE \"assignmentId\"=:id"
                                + " AND \"action\"='DRAFT_OPENED' ORDER BY \"id\"", Map.of("id", assignmentId)),
                jdbc.queryForObject("SELECT COUNT(*) FROM learning.\"FileObject\"", Map.of(), Integer.class));
    }

    private int backendPid() {
        return jdbc.queryForObject("SELECT pg_backend_pid()", Map.of(), Integer.class);
    }

    private boolean waitingOn(Future<?> future, AtomicInteger waiter, AtomicInteger holder) throws Exception {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(10);
        while (System.nanoTime() < deadline) {
            if (waiter.get() != 0 && Boolean.TRUE.equals(jdbc.queryForObject(
                    "SELECT :holder = ANY(pg_blocking_pids(:waiter))",
                    Map.of("holder", holder.get(), "waiter", waiter.get()), Boolean.class))) {
                return true;
            }
            if (future.isDone()) {
                future.get(1, TimeUnit.SECONDS);
                return false;
            }
            Thread.sleep(20);
        }
        return false;
    }

    private static void await(CountDownLatch latch) {
        try {
            if (!latch.await(20, TimeUnit.SECONDS)) {
                throw new AssertionError("transaction barrier timed out");
            }
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            throw new AssertionError("transaction barrier interrupted", interrupted);
        }
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
