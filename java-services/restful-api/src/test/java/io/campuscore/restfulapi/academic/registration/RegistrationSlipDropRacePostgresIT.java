package io.campuscore.restfulapi.academic.registration;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doAnswer;

import io.campuscore.restfulapi.web.DomainException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIf;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * BH3-API-02 / BH2-T3: a GET paused at PDF rendering must serialize with the
 * last drop. The old implementation lets drop commit before GET reinserts its
 * stale PDF. The repaired implementation holds Student through GET commit, so
 * drop waits and then invalidates that PDF. Uses the opt-in PostgreSQL/Flyway
 * convention and observed wait graph of the academic/LearningAuthority ITs.
 * Set CAMPUSCORE_E2E_POSTGRES_URL to a disposable migrated PostgreSQL database;
 * optional CAMPUSCORE_E2E_POSTGRES_USER/PASSWORD default to postgres.
 * No production test hook and no outer test transaction.
 */
@EnabledIf("postgresTargetConfigured")
@SpringBootTest(properties = {
        "spring.flyway.locations=classpath:db/migration",
        "spring.jpa.hibernate.ddl-auto=none",
        "spring.datasource.hikari.maximum-pool-size=8",
        "deepseek.enabled=false"
})
@ActiveProfiles({"test", "persistence"})
class RegistrationSlipDropRacePostgresIT {

    @Autowired private RegistrationService registration;
    @Autowired private NamedParameterJdbcTemplate jdbc;
    @Autowired private PlatformTransactionManager transactionManager;
    @MockitoSpyBean private RegistrationPdfRenderer renderer;

    private String studentId;
    private String semesterId;
    private String sectionId;
    private String roundId;
    private String enrollmentId;

    @DynamicPropertySource
    static void postgresProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", () -> System.getenv("CAMPUSCORE_E2E_POSTGRES_URL"));
        registry.add("spring.datasource.username", () -> valueOr("CAMPUSCORE_E2E_POSTGRES_USER", "postgres"));
        registry.add("spring.datasource.password", () -> valueOr("CAMPUSCORE_E2E_POSTGRES_PASSWORD", "postgres"));
    }

    @BeforeEach
    void seed() {
        // Same FK chain as AcademicEnrollmentPostgresFixture, kept local
        // because that helper is package-private in the parent test package.
        String suffix = "slip-" + UUID.randomUUID().toString().substring(0, 8);
        String year = "ay-" + suffix;
        String faculty = "fac-" + suffix;
        String department = "dept-" + suffix;
        String curriculum = "cur-" + suffix;
        String course = "course-" + suffix;
        String user = "user-" + suffix;
        studentId = "stu-" + suffix;
        semesterId = "sem-" + suffix;
        sectionId = "sec-" + suffix;
        roundId = "round-" + suffix;
        Timestamp past = Timestamp.from(Instant.parse("2020-01-01T00:00:00Z"));
        Timestamp future = Timestamp.from(Instant.parse("2099-01-01T00:00:00Z"));

        jdbc.update("INSERT INTO academic.\"AcademicYear\" (\"id\",\"year\",\"startDate\",\"endDate\",\"isCurrent\")"
                        + " VALUES (:id,2026,:start,:end,TRUE)",
                new MapSqlParameterSource("id", year).addValue("start", past).addValue("end", future));
        jdbc.update("INSERT INTO academic.\"Faculty\" (\"id\",\"name\",\"code\") VALUES (:id,:id,:id)",
                Map.of("id", faculty));
        jdbc.update("INSERT INTO academic.\"Department\" (\"id\",\"name\",\"code\",\"facultyId\")"
                        + " VALUES (:id,:id,:id,:faculty)", Map.of("id", department, "faculty", faculty));
        jdbc.update("INSERT INTO academic.\"Curriculum\""
                        + " (\"id\",\"name\",\"code\",\"departmentId\",\"academicYearId\",\"totalCredits\",\"isActive\")"
                        + " VALUES (:id,:id,:id,:department,:year,150,TRUE)",
                Map.of("id", curriculum, "department", department, "year", year));
        jdbc.update("INSERT INTO academic.\"Course\" (\"id\",\"code\",\"name\",\"credits\",\"departmentId\",\"isActive\")"
                        + " VALUES (:id,:id,'Course A',3,:department,TRUE)",
                Map.of("id", course, "department", department));
        jdbc.update("INSERT INTO academic.\"Semester\""
                        + " (\"id\",\"name\",\"type\",\"academicYearId\",\"startDate\",\"endDate\",\"status\")"
                        + " VALUES (:id,:id,'FALL',:year,:start,:end,'ACTIVE')",
                new MapSqlParameterSource("id", semesterId).addValue("year", year)
                        .addValue("start", past).addValue("end", future));
        jdbc.update("INSERT INTO academic.\"Section\""
                        + " (\"id\",\"sectionNumber\",\"courseId\",\"semesterId\",\"capacity\",\"enrolledCount\",\"status\")"
                        + " VALUES (:id,'01',:course,:semester,10,0,'OPEN')",
                Map.of("id", sectionId, "course", course, "semester", semesterId));
        jdbc.update("INSERT INTO academic.\"RegistrationRound\""
                        + " (\"id\",\"semesterId\",\"name\",\"kind\",\"status\",\"windowStart\",\"windowEnd\",\"creditLimit\")"
                        + " VALUES (:id,:semester,:id,'REGISTRATION','OPEN',:start,:end,28)",
                new MapSqlParameterSource("id", roundId).addValue("semester", semesterId)
                        .addValue("start", past).addValue("end", future));
        jdbc.update("INSERT INTO campuscore_auth.\"User\""
                        + " (\"id\",\"email\",\"password\",\"firstName\",\"lastName\",\"status\")"
                        + " VALUES (:id,:email,'{noop}test-fixture','Slip','Student','ACTIVE')",
                Map.of("id", user, "email", user + "@campuscore.test"));
        jdbc.update("INSERT INTO academic.\"Student\""
                        + " (\"id\",\"userId\",\"studentId\",\"curriculumId\",\"year\",\"status\",\"admissionDate\")"
                        + " VALUES (:id,:user,:id,:curriculum,2,'ACTIVE',:now)",
                new MapSqlParameterSource("id", studentId).addValue("user", user)
                        .addValue("curriculum", curriculum).addValue("now", Timestamp.from(Instant.now())));
        enrollmentId = registration.enroll(studentId, sectionId, List.of("STUDENT"), "enroll-" + studentId).id();
    }

    @Test
    void uncachedRenderCannotReinsertCourseAAfterLastDrop() throws Exception {
        jdbc.update("DELETE FROM academic.\"RegistrationSlip\" WHERE \"studentId\"=:student",
                Map.of("student", studentId));
        CountDownLatch rendering = new CountDownLatch(1);
        CountDownLatch resumeRender = new CountDownLatch(1);
        AtomicInteger getPid = new AtomicInteger();
        AtomicInteger dropPid = new AtomicInteger();
        doAnswer(call -> {
            byte[] pdf = (byte[]) call.callRealMethod();
            getPid.set(backendPid());
            rendering.countDown();
            if (!resumeRender.await(30, TimeUnit.SECONDS)) {
                throw new IllegalStateException("slip render barrier timeout");
            }
            return pdf;
        }).when(renderer).renderEnriched(anyString(), anyString(), anyString(), anyString(),
                anyString(), anyString(), anyString(), anyList());

        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            Future<RegistrationService.SlipPayload> getting = pool.submit(() -> registration.slip(studentId, semesterId));
            assertThat(rendering.await(10, TimeUnit.SECONDS)).as("GET has read roster [A] and reached render").isTrue();
            Future<?> dropping = pool.submit(() -> new TransactionTemplate(transactionManager).executeWithoutResult(tx -> {
                dropPid.set(backendPid());
                registration.drop(enrollmentId, studentId, List.of("STUDENT"), "drop-" + studentId);
            }));

            // Accept either observable schedule while arranging the race: on
            // old code drop commits before resume; on fixed code PG proves it
            // is blocked by this GET. No timing-only "future is not done" proof.
            boolean dropWaitsForGet = awaitBlockingOrCompletion(getPid, dropPid, dropping);
            if (!dropWaitsForGet) {
                dropping.get(10, TimeUnit.SECONDS); // force old-code drop COMMIT before GET resumes
            }
            resumeRender.countDown();
            assertThat(getting.get(20, TimeUnit.SECONDS).payload()).isNotEmpty();
            dropping.get(20, TimeUnit.SECONDS); // includes outer transaction COMMIT

            assertThat(enrollmentStatus()).isEqualTo("DROPPED");
            assertThat(slipCount()).as("no course-A cache survives committed last drop").isZero();
            assertSlipNotFound(semesterId);
            assertSlipNotFound(null);
            assertThat(slipCount()).as("fresh GETs cannot resurrect the retired cache").isZero();
            assertThat(dropWaitsForGet).as("PostgreSQL proves GET owns Student until persistence commits").isTrue();
        } finally {
            resumeRender.countDown();
            pool.shutdownNow();
            assertThat(pool.awaitTermination(10, TimeUnit.SECONDS)).isTrue();
        }
    }

    @Test
    void emptyActiveRosterWithCompletedHistoryStillReturnsLastValidSlip() {
        RegistrationService.SlipPayload before = registration.slip(studentId, semesterId);
        jdbc.update("UPDATE academic.\"Enrollment\" SET \"status\"='COMPLETED', \"gradeStatus\"='PUBLISHED',"
                        + " \"finalGrade\"=8, \"letterGrade\"='B' WHERE \"id\"=:id",
                Map.of("id", enrollmentId));

        for (String semester : new String[] {semesterId, null}) {
            RegistrationService.SlipPayload historical = registration.slip(studentId, semester);
            assertThat(historical.sha256()).isEqualTo(before.sha256());
            assertThat(historical.payload()).isEqualTo(before.payload());
        }
        assertThat(slipCount()).isEqualTo(1);
        assertThat(enrollmentStatus()).isEqualTo("COMPLETED");
    }

    @Test
    void legacyStaleCacheWithOnlyDroppedHistoryIsNotAHistoricalSlip() {
        RegistrationService.SlipPayload stale = registration.slip(studentId, semesterId);
        registration.drop(enrollmentId, studentId, List.of("STUDENT"), "drop-" + studentId);
        // Simulate a cache row left by the old race/deployment. Valid PDF
        // syntax alone must not let an all-dropped term pass as completed.
        jdbc.update("INSERT INTO academic.\"RegistrationSlip\""
                        + " (\"id\",\"studentId\",\"semesterId\",\"roundId\",\"sha256\",\"byteSize\",\"payload\")"
                        + " VALUES (:id,:student,:semester,:round,:sha,:size,:payload)",
                new MapSqlParameterSource("id", UUID.randomUUID().toString()).addValue("student", studentId)
                        .addValue("semester", semesterId).addValue("round", roundId).addValue("sha", stale.sha256())
                        .addValue("size", stale.payload().length).addValue("payload", stale.payload()));

        assertSlipNotFound(semesterId);
        assertSlipNotFound(null);
    }

    private boolean awaitBlockingOrCompletion(AtomicInteger owner, AtomicInteger waiter, Future<?> dropping)
            throws InterruptedException {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(10);
        while (System.nanoTime() < deadline) {
            if (dropping.isDone()) return false;
            if (waiter.get() != 0 && Boolean.TRUE.equals(jdbc.queryForObject(
                    "SELECT :owner = ANY(pg_blocking_pids(:waiter))",
                    Map.of("owner", owner.get(), "waiter", waiter.get()), Boolean.class))) return true;
            Thread.sleep(20);
        }
        throw new AssertionError("drop neither committed nor waited for GET's Student lock");
    }

    private int backendPid() {
        return jdbc.getJdbcOperations().queryForObject("SELECT pg_backend_pid()", Integer.class);
    }

    private void assertSlipNotFound(String semester) {
        assertThatThrownBy(() -> registration.slip(studentId, semester))
                .isInstanceOf(DomainException.class)
                .satisfies(thrown -> {
                    DomainException rejection = (DomainException) thrown;
                    assertThat(rejection.getStatus()).isEqualTo(HttpStatus.NOT_FOUND);
                    assertThat(rejection.code()).isEqualTo("ROUND_NOT_FOUND");
                });
    }

    private int slipCount() {
        return jdbc.queryForObject("SELECT COUNT(*) FROM academic.\"RegistrationSlip\""
                        + " WHERE \"studentId\"=:student AND \"semesterId\"=:semester",
                Map.of("student", studentId, "semester", semesterId), Integer.class);
    }

    private String enrollmentStatus() {
        return jdbc.queryForObject("SELECT \"status\" FROM academic.\"Enrollment\" WHERE \"id\"=:id",
                Map.of("id", enrollmentId), String.class);
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
