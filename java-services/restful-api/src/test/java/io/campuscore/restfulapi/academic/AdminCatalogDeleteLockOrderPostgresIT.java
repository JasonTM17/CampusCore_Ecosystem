package io.campuscore.restfulapi.academic;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doAnswer;

import io.campuscore.restfulapi.academic.service.AdminCatalogMutationService;
import io.campuscore.restfulapi.web.DomainException;
import java.sql.SQLException;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.function.Supplier;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIf;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.jdbc.core.namedparam.SqlParameterSource;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/** Real-PostgreSQL regression for deleting a parent while its Section is being edited. */
@EnabledIf(value = "io.campuscore.restfulapi.academic.AdminCatalogDeleteLockOrderPostgresIT#postgresTargetConfigured")
@SpringBootTest(properties = {
        "spring.flyway.locations=classpath:db/migration",
        "deepseek.enabled=false",
        "spring.jpa.hibernate.ddl-auto=none",
        "spring.datasource.hikari.maximum-pool-size=8"
})
@ActiveProfiles({"test", "persistence"})
class AdminCatalogDeleteLockOrderPostgresIT {

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
    void classroomDeleteLocksReferencingSectionsBeforeTheParentRow() throws Exception {
        AcademicEnrollmentPostgresFixture fixture = AcademicEnrollmentPostgresFixture.seed(jdbc, 30);
        String classroomId = fixture.sectionId + "-room";
        jdbc.update("INSERT INTO " + CLASSROOM
                        + " (\"id\", \"building\", \"roomNumber\", \"capacity\", \"type\")"
                        + " VALUES (:id, 'A', '101', 40, 'LECTURE')",
                new MapSqlParameterSource("id", classroomId));
        jdbc.update("UPDATE " + SECTION + " SET \"classroomId\"=:classroom WHERE \"id\"=:section",
                new MapSqlParameterSource().addValue("classroom", classroomId).addValue("section", fixture.sectionId));
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM " + SECTION
                        + " WHERE \"id\"=:section AND \"classroomId\"=:classroom",
                new MapSqlParameterSource().addValue("section", fixture.sectionId).addValue("classroom", classroomId),
                Integer.class)).isEqualTo(1);

        String suffix = UUID.randomUUID().toString().replace("-", "").substring(0, 12);
        String sectionApplication = "section-edit-" + suffix;
        String deleteApplication = "classroom-delete-" + suffix;
        CountDownLatch sectionLockHeld = new CountDownLatch(1);
        CountDownLatch allowSectionEdit = new CountDownLatch(1);
        doAnswer(invocation -> {
            String sql = invocation.getArgument(0, String.class);
            SqlParameterSource parameters = invocation.getArgument(1, SqlParameterSource.class);
            @SuppressWarnings("unchecked")
            Map<String, Object> row = (Map<String, Object>) invocation.callRealMethod();
            if (sql.startsWith("SELECT * FROM " + SECTION)
                    && sql.contains("FOR UPDATE")
                    && fixture.sectionId.equals(parameters.getValue("id"))) {
                sectionLockHeld.countDown();
                awaitLatch(allowSectionEdit);
            }
            return row;
        }).when(jdbc).queryForMap(anyString(), any(SqlParameterSource.class));

        ExecutorService pool = Executors.newFixedThreadPool(2);
        Future<Throwable> sectionEdit = null;
        Future<Throwable> classroomDelete = null;
        boolean deleteWaitedForSection = false;
        Boolean parentLockAvailableWhileDeleteWaits = null;
        try {
            sectionEdit = pool.submit(() -> capture(() -> inNamedTransaction(sectionApplication,
                    () -> catalog.update(SECTION, fixture.sectionId, Map.of("capacity", 35)))));
            assertThat(sectionLockHeld.await(10, TimeUnit.SECONDS))
                    .as("the Section edit is parked after acquiring its row lock")
                    .isTrue();
            CountDownLatch deleteStarted = new CountDownLatch(1);
            classroomDelete = pool.submit(() -> capture(() -> inNamedTransaction(deleteApplication, () -> {
                deleteStarted.countDown();
                catalog.delete(CLASSROOM, classroomId);
                return null;
            })));
            assertThat(deleteStarted.await(10, TimeUnit.SECONDS)).isTrue();
            deleteWaitedForSection = awaitLockWait(deleteApplication, sectionApplication, classroomDelete);
            if (deleteWaitedForSection) {
                parentLockAvailableWhileDeleteWaits = tryLockClassroomWithoutWaiting(classroomId);
            }
        } finally {
            allowSectionEdit.countDown();
            pool.shutdown();
            assertThat(pool.awaitTermination(30, TimeUnit.SECONDS)).isTrue();
        }

        String deleteOutcome = classroomDelete != null && classroomDelete.isDone()
                ? String.valueOf(classroomDelete.get(1, TimeUnit.SECONDS)) : "still running";
        assertThat(deleteWaitedForSection)
                .as("the delete lock wait is observed through pg_blocking_pids; delete result=%s", deleteOutcome)
                .isTrue();
        assertThat(parentLockAvailableWhileDeleteWaits)
                .as("the parent row remains unlocked while the delete waits for the referencing Section")
                .isTrue();
        assertThat(sectionEdit).isNotNull();
        assertThat(sectionEdit.get(1, TimeUnit.SECONDS)).as("Section edit completes without a deadlock").isNull();
        assertThat(classroomDelete).isNotNull();
        Throwable deleteFailure = classroomDelete.get(1, TimeUnit.SECONDS);
        assertThat(deleteFailure).isInstanceOf(DomainException.class);
        DomainException conflict = (DomainException) deleteFailure;
        assertThat(conflict.getStatus().value()).isEqualTo(409);
        assertThat(conflict.code()).isEqualTo("RESOURCE_IN_USE");

        Integer capacity = jdbc.queryForObject("SELECT \"capacity\" FROM " + SECTION + " WHERE \"id\"=:id",
                new MapSqlParameterSource("id", fixture.sectionId), Integer.class);
        assertThat(capacity).isEqualTo(35);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM " + CLASSROOM + " WHERE \"id\"=:id",
                new MapSqlParameterSource("id", classroomId), Integer.class)).isEqualTo(1);
    }

    static boolean postgresTargetConfigured() {
        String url = System.getenv("CAMPUSCORE_E2E_POSTGRES_URL");
        return url != null && url.startsWith("jdbc:postgresql:");
    }

    private <T> T inNamedTransaction(String applicationName, Supplier<T> work) {
        return new TransactionTemplate(transactionManager).execute(status -> {
            jdbc.getJdbcTemplate().queryForObject(
                    "SELECT set_config('application_name', ?, true)", String.class, applicationName);
            return work.get();
        });
    }

    private Throwable capture(Supplier<?> work) {
        try {
            work.get();
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
                            + " WHERE waiting.application_name=:waiter AND waiting.wait_event_type='Lock'"
                            + " AND EXISTS (SELECT 1 FROM unnest(pg_blocking_pids(waiting.pid)) AS blockers(pid)"
                            + " JOIN pg_stat_activity blocker ON blocker.pid=blockers.pid"
                            + " WHERE blocker.application_name=:blocker)",
                    new MapSqlParameterSource().addValue("waiter", waiter).addValue("blocker", blocker),
                    Integer.class);
            if (waiting != null && waiting > 0) return true;
            if (waiterFuture.isDone()) return false;
            Thread.onSpinWait();
        }
        return false;
    }

    private boolean tryLockClassroomWithoutWaiting(String classroomId) {
        try {
            jdbc.queryForObject("SELECT \"id\" FROM " + CLASSROOM
                            + " WHERE \"id\"=:id FOR UPDATE NOWAIT",
                    new MapSqlParameterSource("id", classroomId), String.class);
            return true;
        } catch (DataAccessException failure) {
            SQLException sqlFailure = findSqlException(failure);
            if (sqlFailure != null && "55P03".equals(sqlFailure.getSQLState())) return false;
            throw failure;
        }
    }

    private static SQLException findSqlException(Throwable failure) {
        for (Throwable current = failure; current != null; current = current.getCause()) {
            if (current instanceof SQLException sqlFailure) return sqlFailure;
        }
        return null;
    }

    private static void awaitLatch(CountDownLatch latch) {
        try {
            if (!latch.await(15, TimeUnit.SECONDS)) {
                throw new IllegalStateException("section edit barrier timed out");
            }
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("interrupted at section edit barrier", interrupted);
        }
    }

    private static String valueOr(String name, String fallback) {
        String value = System.getenv(name);
        return value == null || value.isBlank() ? fallback : value;
    }
}
