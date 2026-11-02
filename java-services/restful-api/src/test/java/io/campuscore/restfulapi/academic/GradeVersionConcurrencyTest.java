package io.campuscore.restfulapi.academic;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;

import io.campuscore.restfulapi.academic.registration.RegistrationService;
import io.campuscore.restfulapi.academic.service.AcademicEnrollmentReadService;
import io.campuscore.restfulapi.academic.service.AcademicMutationService;
import io.campuscore.restfulapi.academic.web.AcademicMutationDtos.GradeUpdate;
import io.campuscore.restfulapi.audit.AdminAuditRecorder;
import java.math.BigDecimal;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import javax.sql.DataSource;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.jdbc.core.namedparam.SqlParameterSource;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.test.context.junit.jupiter.SpringJUnitConfig;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.EnableTransactionManagement;

/**
 * DSJ-04 deterministic schedule: a save holds the section lock while a publish
 * waits. Both writes still advance the enrollment version in order.
 */
@SpringJUnitConfig(GradeVersionConcurrencyTest.Config.class)
class GradeVersionConcurrencyTest {

    @Autowired JdbcTemplate jdbc;
    @Autowired TrackingJdbc named;
    @Autowired AcademicMutationService service;

    @BeforeEach
    void seed() {
        named.disarm();
        jdbc.execute("CREATE SCHEMA IF NOT EXISTS \"academic\"");
        jdbc.execute("CREATE TABLE IF NOT EXISTS \"academic\".\"Section\" ("
                + "\"id\" VARCHAR PRIMARY KEY, \"semesterId\" VARCHAR, \"lecturerId\" VARCHAR,"
                + " \"capacity\" INT, \"enrolledCount\" INT, \"status\" VARCHAR)");
        jdbc.execute("CREATE TABLE IF NOT EXISTS \"academic\".\"Student\" ("
                + "\"id\" VARCHAR PRIMARY KEY, \"userId\" VARCHAR)");
        jdbc.execute("CREATE TABLE IF NOT EXISTS \"academic\".\"Enrollment\" ("
                + "\"id\" VARCHAR PRIMARY KEY, \"studentId\" VARCHAR, \"sectionId\" VARCHAR,"
                + " \"status\" VARCHAR, \"gradeStatus\" VARCHAR, \"finalGrade\" NUMERIC(5,2),"
                + " \"letterGrade\" VARCHAR, \"updatedAt\" TIMESTAMP,"
                + " \"version\" INTEGER NOT NULL DEFAULT 0)");
        jdbc.execute("CREATE TABLE IF NOT EXISTS \"academic\".\"GradeItem\" ("
                + "\"id\" VARCHAR PRIMARY KEY, \"sectionId\" VARCHAR, \"name\" VARCHAR,"
                + " \"type\" VARCHAR, \"maxScore\" NUMERIC(5,2), \"weight\" NUMERIC(5,2),"
                + " \"gradedAt\" TIMESTAMP)");
        jdbc.execute("CREATE TABLE IF NOT EXISTS \"academic\".\"StudentGrade\" ("
                + "\"id\" VARCHAR PRIMARY KEY, \"enrollmentId\" VARCHAR, \"gradeItemId\" VARCHAR,"
                + " \"score\" NUMERIC(5,2))");
        for (String table : List.of("StudentGrade", "GradeItem", "Enrollment", "Student", "Section")) {
            jdbc.execute("DELETE FROM \"academic\".\"" + table + "\"");
        }
        jdbc.execute("INSERT INTO \"academic\".\"Section\" VALUES ('section', 'semester', 'lecturer', 30, 1, 'ACTIVE')");
        jdbc.execute("INSERT INTO \"academic\".\"Student\" VALUES ('student', 'student-user')");
        jdbc.execute("INSERT INTO \"academic\".\"Enrollment\" VALUES"
                + " ('enrollment', 'student', 'section', 'ENROLLED', 'DRAFT', 8, 'B+', CURRENT_TIMESTAMP, 0)");
        jdbc.execute("INSERT INTO \"academic\".\"GradeItem\" (\"id\", \"sectionId\", \"name\", \"type\") VALUES"
                + " ('section-process-50', 'section', 'DQT', 'PROCESS'),"
                + " ('section-final-50', 'section', 'DKTHP', 'FINAL')");
        jdbc.execute("INSERT INTO \"academic\".\"StudentGrade\" VALUES"
                + " ('p', 'enrollment', 'section-process-50', 8),"
                + " ('f', 'enrollment', 'section-final-50', 8)");
    }

    @Test
    void saveHoldingTheSectionLockMakesPublishWaitAndBothAdvanceTheVersion() throws Exception {
        named.armEnrollmentUpdateBlock();
        var executor = Executors.newFixedThreadPool(2);
        try {
            var save = executor.submit(() -> service.updateGrades(
                    "section", null, true, null,
                    List.of(new GradeUpdate("enrollment", new BigDecimal("8"), new BigDecimal("9"), 0))));
            assertThat(named.reachedUpdate.await(5, TimeUnit.SECONDS))
                    .as("save reaches its enrollment update while holding the section lock")
                    .isTrue();

            var publish = executor.submit(() -> service.publishGrades("section", null, true, null));
            assertThatThrownBy(() -> publish.get(150, TimeUnit.MILLISECONDS))
                    .as("publish waits for the section lock held by the save")
                    .isInstanceOf(TimeoutException.class);

            named.releaseUpdate.countDown();
            save.get(5, TimeUnit.SECONDS);
            publish.get(5, TimeUnit.SECONDS);
        } finally {
            named.disarm();
            executor.shutdownNow();
        }

        assertThat(jdbc.queryForObject(
                "SELECT \"version\" FROM \"academic\".\"Enrollment\" WHERE \"id\" = 'enrollment'",
                Integer.class)).isEqualTo(2);
        assertThat(jdbc.queryForObject(
                "SELECT \"status\" FROM \"academic\".\"Enrollment\" WHERE \"id\" = 'enrollment'",
                String.class)).isEqualTo("COMPLETED");
        assertThat(jdbc.queryForObject(
                "SELECT \"gradeStatus\" FROM \"academic\".\"Enrollment\" WHERE \"id\" = 'enrollment'",
                String.class)).isEqualTo("PUBLISHED");
        assertThat(jdbc.queryForObject(
                "SELECT \"finalGrade\" FROM \"academic\".\"Enrollment\" WHERE \"id\" = 'enrollment'",
                BigDecimal.class)).isEqualByComparingTo("8.5");
    }

    static class TrackingJdbc extends NamedParameterJdbcTemplate {
        volatile CountDownLatch reachedUpdate;
        volatile CountDownLatch releaseUpdate;
        volatile boolean blockEnrollmentUpdate;

        TrackingJdbc(JdbcTemplate jdbc) {
            super(jdbc);
        }

        void armEnrollmentUpdateBlock() {
            reachedUpdate = new CountDownLatch(1);
            releaseUpdate = new CountDownLatch(1);
            blockEnrollmentUpdate = true;
        }

        void disarm() {
            blockEnrollmentUpdate = false;
            if (releaseUpdate != null) {
                releaseUpdate.countDown();
            }
        }

        @Override
        public int[] batchUpdate(String sql, SqlParameterSource[] batchArgs) {
            if (blockEnrollmentUpdate
                    && sql.contains("\"Enrollment\"")
                    && sql.contains("\"version\" = \"version\" + 1")) {
                blockEnrollmentUpdate = false;
                reachedUpdate.countDown();
                try {
                    if (!releaseUpdate.await(5, TimeUnit.SECONDS)) {
                        throw new IllegalStateException("test did not release the blocked enrollment update");
                    }
                } catch (InterruptedException interrupted) {
                    Thread.currentThread().interrupt();
                    throw new IllegalStateException(interrupted);
                }
            }
            return super.batchUpdate(sql, batchArgs);
        }
    }

    @Configuration
    @EnableTransactionManagement
    static class Config {
        @Bean DataSource dataSource() {
            return new DriverManagerDataSource(
                    "jdbc:h2:mem:grade_version_concurrency;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;"
                            + "DB_CLOSE_DELAY=-1;LOCK_TIMEOUT=10000",
                    "sa", "");
        }
        @Bean JdbcTemplate jdbc(DataSource source) { return new JdbcTemplate(source); }
        @Bean TrackingJdbc named(JdbcTemplate jdbc) { return new TrackingJdbc(jdbc); }
        @Bean PlatformTransactionManager transactions(DataSource source) { return new DataSourceTransactionManager(source); }
        @Bean AcademicMutationService service(NamedParameterJdbcTemplate named) {
            return new AcademicMutationService(
                    named,
                    mock(AcademicEnrollmentReadService.class),
                    mock(RegistrationService.class),
                    mock(AdminAuditRecorder.class));
        }
    }
}
