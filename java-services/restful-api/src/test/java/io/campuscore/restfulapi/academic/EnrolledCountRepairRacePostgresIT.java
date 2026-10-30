package io.campuscore.restfulapi.academic;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doAnswer;

import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import io.campuscore.restfulapi.academic.registration.RegistrationService;
import io.campuscore.restfulapi.academic.service.AcademicMutationService;
import io.campuscore.restfulapi.academic.service.EnrolledCountReconcileJob;
import io.campuscore.restfulapi.academic.web.AcademicMutationDtos.GradeUpdate;
import java.math.BigDecimal;
import java.sql.Connection;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import javax.sql.DataSource;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIf;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.jdbc.core.namedparam.SqlParameterSource;
import org.springframework.jdbc.datasource.SingleConnectionDataSource;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;

/** Real writer transactions, with repair observed waiting inside PostgreSQL. */
@EnabledIf("postgresTargetConfigured")
@SpringBootTest(properties = {
        "spring.flyway.locations=classpath:db/migration",
        "spring.jpa.hibernate.ddl-auto=none",
        "spring.datasource.hikari.maximum-pool-size=12",
        "academic.enrolled-count.enabled=false",
        "deepseek.enabled=false"
})
@ActiveProfiles({"test", "persistence"})
class EnrolledCountRepairRacePostgresIT {
    @Autowired private RegistrationService registration;
    @Autowired private AcademicMutationService mutations;
    @Autowired private DataSource dataSource;
    @MockitoSpyBean private NamedParameterJdbcTemplate jdbc;

    @Test
    void repairRecountsAfterWaitingForEnroll() throws Exception {
        runWriterRace("enroll", 1);
    }

    @Test
    void repairRecountsAfterWaitingForDrop() throws Exception {
        runWriterRace("drop", 1);
    }

    @Test
    void repairPreservesCompletedOccupancyAfterPublish() throws Exception {
        runWriterRace("publish", 1);
    }

    @Test
    void competingRepairsCannotOverwriteTheCommittedEnrollmentCount() throws Exception {
        runWriterRace("enroll", 2);
    }

    private void runWriterRace(String operation, int repairRunners) throws Exception {
        var fixture = AcademicEnrollmentPostgresFixture.seed(jdbc, 10);
        String student = fixture.seedStudent(1);
        String enrollment = registration.enroll(student, fixture.sectionId,
                List.of("STUDENT"), "seed-" + student).id();
        String nextStudent = fixture.seedStudent(2);
        if (operation.equals("publish")) {
            mutations.updateGrades(fixture.sectionId, null, true,
                    List.of(new GradeUpdate(enrollment, new BigDecimal("8"), new BigDecimal("9"))));
        }
        // There must be drift before repair starts, while the writer still has work to commit.
        jdbc.update("UPDATE academic.\"Section\" SET \"enrolledCount\"=:count WHERE \"id\"=:id",
                Map.of("count", operation.equals("drop") ? 3 : 0, "id", fixture.sectionId));
        CountDownLatch writerLocked = new CountDownLatch(1);
        CountDownLatch releaseWriter = new CountDownLatch(1);
        AtomicInteger writerPid = new AtomicInteger();
        doAnswer(call -> {
            Object result = call.callRealMethod();
            String sql = call.getArgument(0);
            if (Thread.currentThread().getName().equals("counter-writer")
                    && sql.contains("\"Section\"") && sql.contains("FOR UPDATE")) {
                writerPid.set(jdbc.getJdbcOperations().queryForObject("SELECT pg_backend_pid()", Integer.class));
                writerLocked.countDown();
                if (!releaseWriter.await(20, TimeUnit.SECONDS)) {
                    throw new IllegalStateException("writer barrier timed out");
                }
            }
            return result;
        }).when(jdbc).queryForMap(anyString(), any(SqlParameterSource.class));

        ExecutorService pool = Executors.newFixedThreadPool(3);
        // Dedicated real connections make backend identity stable even on the original autocommit job.
        try (Connection first = dataSource.getConnection(); Connection second = dataSource.getConnection()) {
            try {
                configureTimeouts(first);
                configureTimeouts(second);
                NamedParameterJdbcTemplate firstJdbc = repairJdbc(first);
                NamedParameterJdbcTemplate secondJdbc = repairJdbc(second);
                int firstPid = pid(firstJdbc);
                int secondPid = pid(secondJdbc);
                Future<?> writer = pool.submit(() -> {
                    Thread.currentThread().setName("counter-writer");
                    switch (operation) {
                        case "enroll" -> registration.enroll(nextStudent, fixture.sectionId,
                                List.of("STUDENT"), "race-" + nextStudent);
                        case "drop" -> registration.drop(enrollment, student,
                                List.of("STUDENT"), "drop-" + enrollment);
                        case "publish" -> mutations.publishGrades(fixture.sectionId, null, true, null);
                        default -> throw new IllegalArgumentException(operation);
                    }
                });
                assertThat(writerLocked.await(15, TimeUnit.SECONDS)).as("writer holds Section row").isTrue();
                Future<?> firstRepair = pool.submit(() -> new EnrolledCountReconcileJob(firstJdbc, true).reconcile());
                awaitBlocked(firstPid, writerPid.get());
                Future<?> secondRepair = repairRunners == 2
                        ? pool.submit(() -> new EnrolledCountReconcileJob(secondJdbc, true).reconcile()) : null;
                if (secondRepair != null) {
                    awaitBlocked(secondPid, writerPid.get(), firstPid);
                }
                releaseWriter.countDown();
                writer.get(20, TimeUnit.SECONDS);
                firstRepair.get(20, TimeUnit.SECONDS);
                if (secondRepair != null) {
                    secondRepair.get(20, TimeUnit.SECONDS);
                }
                int expected = operation.equals("enroll") ? 2 : operation.equals("drop") ? 0 : 1;
                assertThat(occupancy(fixture.sectionId)).as("authoritative committed occupancy").isEqualTo(expected);
                assertThat(counter(fixture.sectionId)).as("repair must use occupancy committed after its lock wait")
                        .isEqualTo(expected);
                if (operation.equals("publish")) {
                    assertThat(jdbc.queryForObject("SELECT \"status\" FROM academic.\"Enrollment\" WHERE \"id\"=:id",
                            Map.of("id", enrollment), String.class)).isEqualTo("COMPLETED");
                }
                Object updatedAt = updatedAt(fixture.sectionId);
                new EnrolledCountReconcileJob(firstJdbc, true).reconcile();
                assertThat(counter(fixture.sectionId)).isEqualTo(expected);
                assertThat(updatedAt(fixture.sectionId)).as("repeat repair has no duplicate write").isEqualTo(updatedAt);
            } finally {
                releaseWriter.countDown();
                pool.shutdownNow();
                assertThat(pool.awaitTermination(30, TimeUnit.SECONDS)).isTrue();
                resetTimeouts(first);
                resetTimeouts(second);
            }
        } finally {
            pool.shutdownNow();
        }
    }

    @Test
    void dryRunLeavesDriftUntouchedAndRepairKeepsEveryOccupyingStatus() {
        var fixture = AcademicEnrollmentPostgresFixture.seed(jdbc, 10);
        List<String> statuses = List.of("ENROLLED", "PENDING", "CONFIRMED", "COMPLETED", "DROPPED");
        for (int i = 0; i < statuses.size(); i++) {
            String student = fixture.seedStudent(i + 1);
            String enrollment = registration.enroll(student, fixture.sectionId,
                    List.of("STUDENT"), "seed-" + student).id();
            jdbc.update("UPDATE academic.\"Enrollment\" SET \"status\"=:status WHERE \"id\"=:id",
                    Map.of("status", statuses.get(i), "id", enrollment));
        }
        jdbc.update("UPDATE academic.\"Section\" SET \"enrolledCount\"=0 WHERE \"id\"=:id", Map.of("id", fixture.sectionId));
        Object before = updatedAt(fixture.sectionId);
        new EnrolledCountReconcileJob(jdbc, false).reconcile();
        new EnrolledCountReconcileJob(jdbc, false).reconcile();
        assertThat(counter(fixture.sectionId)).isZero();
        assertThat(updatedAt(fixture.sectionId)).isEqualTo(before);
        new EnrolledCountReconcileJob(jdbc, true).reconcile();
        assertThat(counter(fixture.sectionId)).isEqualTo(4);
        Object repairedAt = updatedAt(fixture.sectionId);
        new EnrolledCountReconcileJob(jdbc, true).reconcile();
        assertThat(updatedAt(fixture.sectionId)).isEqualTo(repairedAt);
    }

    @Test
    void overCapacityOccupancyIsReportedWithoutIncreasingCapacity() {
        var fixture = AcademicEnrollmentPostgresFixture.seed(jdbc, 2);
        for (int i = 1; i <= 2; i++) {
            String student = fixture.seedStudent(i);
            registration.enroll(student, fixture.sectionId, List.of("STUDENT"), "seed-" + student);
        }
        jdbc.update("UPDATE academic.\"Section\" SET \"capacity\"=1, \"enrolledCount\"=0 WHERE \"id\"=:id",
                Map.of("id", fixture.sectionId));
        Logger logger = (Logger) LoggerFactory.getLogger(EnrolledCountReconcileJob.class);
        ListAppender<ILoggingEvent> capture = new ListAppender<>();
        capture.start();
        logger.addAppender(capture);
        try {
            new EnrolledCountReconcileJob(jdbc, true).reconcile();
            assertThat(jdbc.queryForObject("SELECT \"capacity\" FROM academic.\"Section\" WHERE \"id\"=:id",
                    Map.of("id", fixture.sectionId), Integer.class)).isEqualTo(1);
            assertThat(counter(fixture.sectionId)).isEqualTo(2);
            assertThat(capture.list).anySatisfy(event -> assertThat(event.getFormattedMessage())
                    .contains("over-capacity", fixture.sectionId));
        } finally {
            logger.detachAppender(capture);
            capture.stop();
        }
    }

    private void awaitBlocked(int waiter, int... owners) throws Exception {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(10);
        while (System.nanoTime() < deadline) {
            List<Integer> blockers = jdbc.queryForList("SELECT unnest(pg_blocking_pids(:pid))",
                    Map.of("pid", waiter), Integer.class);
            for (int owner : owners) {
                if (blockers.contains(owner)) {
                    return;
                }
            }
            Thread.sleep(20);
        }
        throw new AssertionError("repair did not reach the expected PostgreSQL row-lock wait");
    }

    private static void configureTimeouts(Connection connection) throws Exception {
        try (var statement = connection.createStatement()) {
            statement.execute("SET lock_timeout='15s'");
            statement.execute("SET statement_timeout='18s'");
        }
    }

    private static void resetTimeouts(Connection connection) throws Exception {
        try (var statement = connection.createStatement()) {
            statement.execute("RESET lock_timeout");
            statement.execute("RESET statement_timeout");
        }
    }

    private static NamedParameterJdbcTemplate repairJdbc(Connection connection) {
        return new NamedParameterJdbcTemplate(new SingleConnectionDataSource(connection, true));
    }

    private static int pid(NamedParameterJdbcTemplate template) {
        return template.getJdbcOperations().queryForObject("SELECT pg_backend_pid()", Integer.class);
    }

    private int counter(String id) {
        return jdbc.queryForObject("SELECT \"enrolledCount\" FROM academic.\"Section\" WHERE \"id\"=:id",
                Map.of("id", id), Integer.class);
    }

    private long occupancy(String id) {
        return jdbc.queryForObject("SELECT COUNT(*) FROM academic.\"Enrollment\" WHERE \"sectionId\"=:id"
                        + " AND \"status\" IN ('ENROLLED','PENDING','CONFIRMED','COMPLETED')",
                Map.of("id", id), Long.class);
    }

    private Object updatedAt(String id) {
        return jdbc.queryForObject("SELECT \"updatedAt\" FROM academic.\"Section\" WHERE \"id\"=:id",
                Map.of("id", id), Object.class);
    }

    static boolean postgresTargetConfigured() {
        String url = System.getenv("CAMPUSCORE_E2E_POSTGRES_URL");
        return url != null && url.matches("jdbc:postgresql://127\\.0\\.0\\.1:[0-9]+/campuscore_restful_e2e");
    }

    @DynamicPropertySource
    static void postgresProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", () -> System.getenv("CAMPUSCORE_E2E_POSTGRES_URL"));
        registry.add("spring.datasource.username", () -> System.getenv("CAMPUSCORE_E2E_POSTGRES_USER"));
        registry.add("spring.datasource.password", () -> System.getenv("CAMPUSCORE_E2E_POSTGRES_PASSWORD"));
    }
}
