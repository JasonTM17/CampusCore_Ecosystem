package io.campuscore.restfulapi.academic;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.catchThrowable;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;

import io.campuscore.restfulapi.academic.registration.RegistrationService;
import io.campuscore.restfulapi.academic.service.AcademicEnrollmentReadService;
import io.campuscore.restfulapi.academic.service.AcademicMutationService;
import io.campuscore.restfulapi.audit.AdminAuditRecorder;
import io.campuscore.restfulapi.engagement.service.GradePublishNotifier;
import io.campuscore.restfulapi.exception.ErrorResponse;
import io.campuscore.restfulapi.exception.GlobalExceptionHandler;
import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import javax.sql.DataSource;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.dao.DataAccessException;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.jdbc.core.namedparam.SqlParameterSource;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.test.context.junit.jupiter.SpringJUnitConfig;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.EnableTransactionManagement;

/**
 * DSJ-05: an audience lookup failure must fail the publication instead of
 * silently publishing to nobody. Empty-but-successful audiences stay valid,
 * and the post-commit notifier failure suppression stays best-effort.
 */
@SpringJUnitConfig(GradePublishAudienceTest.Config.class)
class GradePublishAudienceTest {

    @Autowired JdbcTemplate jdbc;
    @Autowired TrackingJdbc named;
    @Autowired AcademicMutationService service;
    @Autowired NotifierHolder notifierHolder;

    private GradePublishNotifier notifier;

    @BeforeEach
    void seed() {
        named.failAudience = false;
        notifier = notifierHolder.notifier;
        org.mockito.Mockito.reset(notifier);
        jdbc.execute("CREATE SCHEMA IF NOT EXISTS \"academic\"");
        jdbc.execute("CREATE SCHEMA IF NOT EXISTS \"campuscore_audit\"");
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
        jdbc.execute("CREATE TABLE IF NOT EXISTS \"campuscore_audit\".\"AdminAudit\" ("
                + "\"id\" VARCHAR PRIMARY KEY, \"actorId\" VARCHAR, \"actorLabel\" VARCHAR(240),"
                + " \"action\" VARCHAR, \"entityType\" VARCHAR, \"entityId\" VARCHAR,"
                + " \"summary\" VARCHAR(500), \"beforeState\" VARCHAR, \"afterState\" VARCHAR,"
                + " \"createdAt\" TIMESTAMP DEFAULT CURRENT_TIMESTAMP)");
        for (String table : List.of("StudentGrade", "GradeItem", "Enrollment", "Student", "Section")) {
            jdbc.execute("DELETE FROM \"academic\".\"" + table + "\"");
        }
        jdbc.execute("DELETE FROM \"campuscore_audit\".\"AdminAudit\"");
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
    void audienceLookupFailureRollsBackPublicationAndUsesTheSanitized500Handler() {
        named.failAudience = true;

        Throwable failure = catchThrowable(() -> service.publishGrades("section", "lecturer", false, "actor"));

        assertThat(failure).isInstanceOf(DataAccessException.class);
        assertUnchangedDraft();
        assertThat(auditCount()).isZero();
        verifyNoInteractions(notifier);

        MockHttpServletRequest request = new MockHttpServletRequest(
                "POST", "/api/v1/sections/section/grades/publish");
        var response = new GlobalExceptionHandler().handleUnhandledException((Exception) failure, request);
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.INTERNAL_SERVER_ERROR);
        ErrorResponse body = response.getBody();
        assertThat(body).isNotNull();
        assertThat(body.status()).isEqualTo(500);
        assertThat(body.code()).isEqualTo("INTERNAL_ERROR");
        assertThat(body.message()).isEqualTo("An unexpected internal error occurred");
        assertThat(body.message()).doesNotContain("audience store unavailable");
        assertThat(body.path()).isEqualTo("/api/v1/sections/section/grades/publish");
    }

    @Test
    void successfullyEmptyAudienceStillPublishes() {
        jdbc.execute("UPDATE \"academic\".\"Student\" SET \"userId\" = NULL WHERE \"id\" = 'student'");

        service.publishGrades("section", "lecturer", false, "actor");

        assertThat(jdbc.queryForObject(
                "SELECT \"status\" FROM \"academic\".\"Enrollment\" WHERE \"id\" = 'enrollment'",
                String.class)).isEqualTo("COMPLETED");
        assertThat(jdbc.queryForObject(
                "SELECT \"gradeStatus\" FROM \"academic\".\"Enrollment\" WHERE \"id\" = 'enrollment'",
                String.class)).isEqualTo("PUBLISHED");
        assertThat(version()).isEqualTo(1);
        assertThat(auditCount()).isEqualTo(1);
        verifyNoInteractions(notifier);
    }

    @Test
    void postCommitNotifierFailureLeavesGradesCommitted() {
        doThrow(new IllegalStateException("notification store unavailable"))
                .when(notifier).fanOutToSection(anyString(), anyList());

        service.publishGrades("section", "lecturer", false, "actor");

        assertThat(jdbc.queryForObject(
                "SELECT \"status\" FROM \"academic\".\"Enrollment\" WHERE \"id\" = 'enrollment'",
                String.class)).isEqualTo("COMPLETED");
        assertThat(jdbc.queryForObject(
                "SELECT \"gradeStatus\" FROM \"academic\".\"Enrollment\" WHERE \"id\" = 'enrollment'",
                String.class)).isEqualTo("PUBLISHED");
        assertThat(version()).isEqualTo(1);
        assertThat(auditCount()).isEqualTo(1);
        verify(notifier).fanOutToSection(anyString(), anyList());
    }

    private void assertUnchangedDraft() {
        Map<String, Object> row = jdbc.queryForMap(
                "SELECT \"status\", \"gradeStatus\", \"finalGrade\", \"letterGrade\", \"version\""
                        + " FROM \"academic\".\"Enrollment\" WHERE \"id\" = 'enrollment'");
        assertThat(row)
                .containsEntry("status", "ENROLLED")
                .containsEntry("gradeStatus", "DRAFT")
                .containsEntry("version", 0);
        assertThat((BigDecimal) row.get("finalGrade")).isEqualByComparingTo("8");
        assertThat(row.get("letterGrade")).isEqualTo("B+");
        assertThat(jdbc.queryForObject(
                "SELECT COUNT(*) FROM \"academic\".\"StudentGrade\" WHERE \"enrollmentId\" = 'enrollment'",
                Integer.class)).isEqualTo(2);
    }

    private int version() {
        return jdbc.queryForObject(
                "SELECT \"version\" FROM \"academic\".\"Enrollment\" WHERE \"id\" = 'enrollment'",
                Integer.class);
    }

    private int auditCount() {
        return jdbc.queryForObject("SELECT COUNT(*) FROM \"campuscore_audit\".\"AdminAudit\"", Integer.class);
    }

    /** Keeps the Mockito mock outside Spring's transaction auto-proxy. */
    static class NotifierHolder {
        final GradePublishNotifier notifier = mock(GradePublishNotifier.class);
    }

    static class TrackingJdbc extends NamedParameterJdbcTemplate {
        volatile boolean failAudience;

        TrackingJdbc(JdbcTemplate jdbc) {
            super(jdbc);
        }

        @Override
        public <T> List<T> queryForList(String sql, SqlParameterSource params, Class<T> elementType) {
            if (failAudience && sql.contains("SELECT DISTINCT student.\"userId\"")) {
                throw new DataAccessResourceFailureException("audience store unavailable");
            }
            return super.queryForList(sql, params, elementType);
        }
    }

    @Configuration
    @EnableTransactionManagement
    static class Config {
        @Bean DataSource dataSource() {
            return new DriverManagerDataSource(
                    "jdbc:h2:mem:grade_publish_audience;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1",
                    "sa", "");
        }
        @Bean JdbcTemplate jdbc(DataSource source) { return new JdbcTemplate(source); }
        @Bean TrackingJdbc named(JdbcTemplate jdbc) { return new TrackingJdbc(jdbc); }
        @Bean PlatformTransactionManager transactions(DataSource source) { return new DataSourceTransactionManager(source); }
        @Bean AdminAuditRecorder audit(NamedParameterJdbcTemplate named) { return new AdminAuditRecorder(named); }
        @Bean NotifierHolder notifierHolder() { return new NotifierHolder(); }
        @Bean AcademicMutationService service(
                NamedParameterJdbcTemplate named, AdminAuditRecorder audit, NotifierHolder holder) {
            return new AcademicMutationService(
                    named,
                    mock(AcademicEnrollmentReadService.class),
                    mock(RegistrationService.class),
                    audit,
                    holder.notifier);
        }
    }
}
