package io.campuscore.restfulapi.academic;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;

import io.campuscore.restfulapi.academic.registration.RegistrationService;
import io.campuscore.restfulapi.academic.service.AcademicEnrollmentReadService;
import io.campuscore.restfulapi.academic.service.AcademicMutationService;
import io.campuscore.restfulapi.academic.web.AcademicMutationDtos.GradeUpdate;
import io.campuscore.restfulapi.audit.AdminAuditRecorder;
import io.campuscore.restfulapi.exception.ErrorResponse;
import io.campuscore.restfulapi.exception.GlobalExceptionHandler;
import io.campuscore.restfulapi.web.DomainException;
import java.math.BigDecimal;
import java.util.List;
import javax.sql.DataSource;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.test.context.junit.jupiter.SpringJUnitConfig;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.EnableTransactionManagement;

/**
 * DSJ-04: optional enrollment versions for grade saves. Omitted versions stay
 * last-write-wins during the compatibility rollout but every accepted save
 * still advances the stored version; supplied versions detect a stale screen
 * and reject the entire batch.
 */
@SpringJUnitConfig(AcademicGradeVersionTest.Config.class)
class AcademicGradeVersionTest {

    @Autowired JdbcTemplate jdbc;
    @Autowired AcademicMutationService service;

    @BeforeEach
    void seed() {
        jdbc.execute("CREATE SCHEMA IF NOT EXISTS \"academic\"");
        jdbc.execute("CREATE SCHEMA IF NOT EXISTS \"campuscore_audit\"");
        jdbc.execute("CREATE TABLE IF NOT EXISTS \"academic\".\"Section\" ("
                + "\"id\" VARCHAR PRIMARY KEY, \"semesterId\" VARCHAR, \"lecturerId\" VARCHAR,"
                + " \"capacity\" INT, \"enrolledCount\" INT, \"status\" VARCHAR)");
        jdbc.execute("CREATE TABLE IF NOT EXISTS \"academic\".\"Student\" ("
                + "\"id\" VARCHAR PRIMARY KEY, \"userId\" VARCHAR)");
        jdbc.execute("CREATE TABLE IF NOT EXISTS \"academic\".\"Enrollment\" ("
                + "\"id\" VARCHAR PRIMARY KEY, \"studentId\" VARCHAR, \"sectionId\" VARCHAR,"
                + " \"semesterId\" VARCHAR, \"status\" VARCHAR, \"gradeStatus\" VARCHAR, \"finalGrade\" NUMERIC(5,2),"
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
        jdbc.execute("INSERT INTO \"academic\".\"Student\" VALUES ('student-1', 'student-user-1')");
        jdbc.execute("INSERT INTO \"academic\".\"Student\" VALUES ('student-2', 'student-user-2')");
        enrollment("enrollment-1", "student-1", "DRAFT", 0);
        enrollment("enrollment-2", "student-2", "DRAFT", 0);
    }

    @Test
    void legacyVersionlessSaveIsAcceptedAndStillAdvancesTheStoredVersion() {
        service.updateGrades("section", "lecturer", false, "actor", List.of(
                update("enrollment-1", "8", "9", null)));

        assertThat(version("enrollment-1")).isEqualTo(1);
        assertThat(jdbc.queryForObject(
                "SELECT \"finalGrade\" FROM \"academic\".\"Enrollment\" WHERE \"id\" = 'enrollment-1'",
                BigDecimal.class)).isEqualByComparingTo("8.5");
    }

    @Test
    void matchingVersionSucceedsAndIncrementsOnEverySave() {
        service.updateGrades("section", "lecturer", false, "actor", List.of(
                update("enrollment-1", "8", "9", 0)));
        assertThat(version("enrollment-1")).isEqualTo(1);

        service.updateGrades("section", "lecturer", false, "actor", List.of(
                update("enrollment-1", "9", "9", 1)));
        assertThat(version("enrollment-1")).isEqualTo(2);
        assertThat(jdbc.queryForObject(
                "SELECT \"finalGrade\" FROM \"academic\".\"Enrollment\" WHERE \"id\" = 'enrollment-1'",
                BigDecimal.class)).isEqualByComparingTo("9.00");
    }

    @Test
    void oneStaleRowRejectsTheWholeBatchWithoutScoresComponentsOrAudits() {
        // Both rows start from the same baseline; only row 2 has since moved on.
        jdbc.execute("UPDATE \"academic\".\"Enrollment\" SET \"version\" = 3 WHERE \"id\" = 'enrollment-2'");
        jdbc.execute("INSERT INTO \"academic\".\"GradeItem\" VALUES"
                + " ('section-process-50', 'section', 'DQT', 'PROCESS', 10, 50, CURRENT_TIMESTAMP),"
                + " ('section-final-50', 'section', 'DKTHP', 'FINAL', 10, 50, CURRENT_TIMESTAMP)");
        component("enrollment-1-p", "enrollment-1", "section-process-50", "6");
        component("enrollment-1-f", "enrollment-1", "section-final-50", "8");
        component("enrollment-2-p", "enrollment-2", "section-process-50", "6");
        component("enrollment-2-f", "enrollment-2", "section-final-50", "8");

        DomainException failure = (DomainException) org.assertj.core.api.Assertions.catchThrowable(() ->
                service.updateGrades("section", "lecturer", false, "actor", List.of(
                        update("enrollment-1", "9", "9", 0),
                        update("enrollment-2", "1", "1", 0))));

        assertThat(failure).isInstanceOf(DomainException.class);
        assertThat(failure.getStatus()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(failure.getCode()).isEqualTo("STALE_VERSION");
        assertThat(failure.getMessage()).isEqualTo("The record changed; reload before editing");

        assertThat(version("enrollment-1")).isZero();
        assertThat(version("enrollment-2")).isEqualTo(3);
        for (String enrollmentId : List.of("enrollment-1", "enrollment-2")) {
            assertThat(jdbc.queryForObject(
                    "SELECT \"finalGrade\" FROM \"academic\".\"Enrollment\" WHERE \"id\" = '" + enrollmentId + "'",
                    BigDecimal.class)).isNull();
            assertThat(jdbc.queryForObject(
                    "SELECT \"gradeStatus\" FROM \"academic\".\"Enrollment\" WHERE \"id\" = '" + enrollmentId + "'",
                    String.class)).isEqualTo("DRAFT");
        }
        assertThat(jdbc.queryForList(
                "SELECT \"score\" FROM \"academic\".\"StudentGrade\"", BigDecimal.class))
                .extracting(BigDecimal::stripTrailingZeros)
                .containsExactlyInAnyOrder(
                        new BigDecimal("6"), new BigDecimal("8"), new BigDecimal("6"), new BigDecimal("8"));
        assertThat(auditCount()).isZero();
    }

    @Test
    void staleVersionUsesTheExistingConflictEnvelope() {
        jdbc.execute("UPDATE \"academic\".\"Enrollment\" SET \"version\" = 4 WHERE \"id\" = 'enrollment-1'");

        DomainException failure = (DomainException) org.assertj.core.api.Assertions.catchThrowable(() ->
                service.updateGrades("section", "lecturer", false, "actor", List.of(
                        update("enrollment-1", "8", "9", 3))));

        MockHttpServletRequest request = new MockHttpServletRequest("PUT", "/api/v1/sections/section/grades");
        var response = new GlobalExceptionHandler().handleAppException(failure, request);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        ErrorResponse body = response.getBody();
        assertThat(body).isNotNull();
        assertThat(body.status()).isEqualTo(409);
        assertThat(body.code()).isEqualTo("STALE_VERSION");
        assertThat(body.message()).isEqualTo("The record changed; reload before editing");
        assertThat(body.path()).isEqualTo("/api/v1/sections/section/grades");
        assertThat(body.fieldErrors()).isEmpty();
        assertThat(body.fields()).isEmpty();
    }

    @Test
    void legacySaveInvalidatesAnOlderVersionedDraft() {
        service.updateGrades("section", "lecturer", false, "actor", List.of(
                update("enrollment-1", "8", "9", null)));
        assertThat(version("enrollment-1")).isEqualTo(1);

        assertThatThrownBy(() -> service.updateGrades("section", "lecturer", false, "actor", List.of(
                update("enrollment-1", "1", "1", 0))))
                .isInstanceOf(DomainException.class)
                .hasMessage("The record changed; reload before editing");

        assertThat(version("enrollment-1")).isEqualTo(1);
        assertThat(jdbc.queryForObject(
                "SELECT \"finalGrade\" FROM \"academic\".\"Enrollment\" WHERE \"id\" = 'enrollment-1'",
                BigDecimal.class)).isEqualByComparingTo("8.5");
        assertThat(auditCount()).isEqualTo(1);
    }

    @Test
    void clearingADraftStillAdvancesTheVersionAndKeepsClearSemantics() {
        jdbc.execute("INSERT INTO \"academic\".\"GradeItem\" VALUES"
                + " ('section-process-50', 'section', 'DQT', 'PROCESS', 10, 50, CURRENT_TIMESTAMP),"
                + " ('section-final-50', 'section', 'DKTHP', 'FINAL', 10, 50, CURRENT_TIMESTAMP)");
        component("enrollment-1-p", "enrollment-1", "section-process-50", "6");
        component("enrollment-1-f", "enrollment-1", "section-final-50", "8");

        service.updateGrades("section", "lecturer", false, "actor", List.of(
                update("enrollment-1", null, null, 0)));

        assertThat(version("enrollment-1")).isEqualTo(1);
        assertThat(jdbc.queryForObject(
                "SELECT \"gradeStatus\" FROM \"academic\".\"Enrollment\" WHERE \"id\" = 'enrollment-1'",
                String.class)).isEqualTo("NOT_GRADED");
        assertThat(jdbc.queryForObject(
                "SELECT COUNT(*) FROM \"academic\".\"StudentGrade\" WHERE \"enrollmentId\" = 'enrollment-1'",
                Integer.class)).isZero();
    }

    @Test
    void midtermOnlySaveStillAdvancesTheVersionAndKeepsOneComponent() {
        service.updateGrades("section", "lecturer", false, "actor", List.of(
                update("enrollment-1", "8", null, 0)));

        assertThat(version("enrollment-1")).isEqualTo(1);
        assertThat(jdbc.queryForObject(
                "SELECT \"gradeStatus\" FROM \"academic\".\"Enrollment\" WHERE \"id\" = 'enrollment-1'",
                String.class)).isEqualTo("DRAFT");
        assertThat(jdbc.queryForObject(
                "SELECT \"finalGrade\" FROM \"academic\".\"Enrollment\" WHERE \"id\" = 'enrollment-1'",
                BigDecimal.class)).isNull();
        assertThat(jdbc.queryForObject(
                "SELECT COUNT(*) FROM \"academic\".\"StudentGrade\" WHERE \"enrollmentId\" = 'enrollment-1'",
                Integer.class)).isEqualTo(1);
    }

    @Test
    void duplicateRowsKeepLastWriteWinsAndAdvanceTheVersionOnce() {
        service.updateGrades("section", "lecturer", false, "actor", List.of(
                update("enrollment-1", "7", "7", 0),
                update("enrollment-1", "9", "9", 0)));

        assertThat(version("enrollment-1")).isEqualTo(1);
        assertThat(jdbc.queryForObject(
                "SELECT \"finalGrade\" FROM \"academic\".\"Enrollment\" WHERE \"id\" = 'enrollment-1'",
                BigDecimal.class)).isEqualByComparingTo("9.00");
        assertThat(jdbc.queryForObject(
                "SELECT COUNT(*) FROM \"academic\".\"StudentGrade\" WHERE \"enrollmentId\" = 'enrollment-1'",
                Integer.class)).isEqualTo(2);
        assertThat(auditCount()).isEqualTo(1);
    }

    @Test
    void publishAdvancesOnlyTheRowsItTransitions() {
        completeGrade("enrollment-1", 2);
        completeGrade("enrollment-2", 5);
        jdbc.execute("UPDATE \"academic\".\"Enrollment\" SET \"gradeStatus\" = 'PUBLISHED',"
                + " \"status\" = 'COMPLETED' WHERE \"id\" = 'enrollment-2'");

        service.publishGrades("section", "lecturer", false, "actor");

        assertThat(version("enrollment-1")).isEqualTo(3);
        assertThat(jdbc.queryForObject(
                "SELECT \"gradeStatus\" FROM \"academic\".\"Enrollment\" WHERE \"id\" = 'enrollment-1'",
                String.class)).isEqualTo("PUBLISHED");
        assertThat(version("enrollment-2")).isEqualTo(5);
        assertThat(auditCount()).isEqualTo(1);
    }

    @Test
    void twoEditorsStartingFromTheSameBaselineCannotBothSave() {
        service.updateGrades("section", "lecturer", false, "editor-a", List.of(
                update("enrollment-1", "8", "9", 0)));

        assertThatThrownBy(() -> service.updateGrades("section", "lecturer", false, "editor-b", List.of(
                update("enrollment-1", "1", "1", 0))))
                .isInstanceOf(DomainException.class)
                .hasMessage("The record changed; reload before editing");

        assertThat(version("enrollment-1")).isEqualTo(1);
        assertThat(jdbc.queryForObject(
                "SELECT \"finalGrade\" FROM \"academic\".\"Enrollment\" WHERE \"id\" = 'enrollment-1'",
                BigDecimal.class)).isEqualByComparingTo("8.5");
        assertThat(jdbc.queryForObject(
                "SELECT COUNT(*) FROM \"campuscore_audit\".\"AdminAudit\"", Integer.class)).isEqualTo(1);
    }

    private void enrollment(String id, String studentId, String gradeStatus, int version) {
        jdbc.update("INSERT INTO \"academic\".\"Enrollment\""
                        + " (\"id\", \"studentId\", \"sectionId\", \"semesterId\", \"status\", \"gradeStatus\","
                        + " \"finalGrade\", \"letterGrade\", \"updatedAt\", \"version\")"
                        + " VALUES (?, ?, 'section', 'semester', 'ENROLLED', ?, NULL, NULL, CURRENT_TIMESTAMP, ?)",
                id, studentId, gradeStatus, version);
    }

    private void completeGrade(String enrollmentId, int version) {
        jdbc.execute("MERGE INTO \"academic\".\"GradeItem\""
                + " (\"id\", \"sectionId\", \"name\", \"type\", \"maxScore\", \"weight\", \"gradedAt\")"
                + " KEY (\"id\") VALUES ('section-process-50', 'section', 'DQT', 'PROCESS', 10, 50, CURRENT_TIMESTAMP)");
        jdbc.execute("MERGE INTO \"academic\".\"GradeItem\""
                + " (\"id\", \"sectionId\", \"name\", \"type\", \"maxScore\", \"weight\", \"gradedAt\")"
                + " KEY (\"id\") VALUES ('section-final-50', 'section', 'DKTHP', 'FINAL', 10, 50, CURRENT_TIMESTAMP)");
        component(enrollmentId + "-p", enrollmentId, "section-process-50", "8");
        component(enrollmentId + "-f", enrollmentId, "section-final-50", "8");
        jdbc.update("UPDATE \"academic\".\"Enrollment\" SET \"finalGrade\" = 8, \"letterGrade\" = 'B+',"
                + " \"version\" = ? WHERE \"id\" = ?", version, enrollmentId);
    }

    private void component(String id, String enrollmentId, String itemId, String score) {
        jdbc.update("INSERT INTO \"academic\".\"StudentGrade\""
                        + " (\"id\", \"enrollmentId\", \"gradeItemId\", \"score\") VALUES (?, ?, ?, ?)",
                id, enrollmentId, itemId, new BigDecimal(score));
    }

    private static GradeUpdate update(String enrollmentId, String process, String exam, Integer version) {
        return new GradeUpdate(
                enrollmentId,
                process == null ? null : new BigDecimal(process),
                exam == null ? null : new BigDecimal(exam),
                version);
    }

    private int version(String enrollmentId) {
        return jdbc.queryForObject(
                "SELECT \"version\" FROM \"academic\".\"Enrollment\" WHERE \"id\" = ?",
                Integer.class, enrollmentId);
    }

    private int auditCount() {
        return jdbc.queryForObject("SELECT COUNT(*) FROM \"campuscore_audit\".\"AdminAudit\"", Integer.class);
    }

    @Configuration
    @EnableTransactionManagement
    static class Config {
        @Bean DataSource dataSource() {
            return new DriverManagerDataSource(
                    "jdbc:h2:mem:academic_grade_version;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1",
                    "sa", "");
        }
        @Bean JdbcTemplate jdbc(DataSource source) { return new JdbcTemplate(source); }
        @Bean NamedParameterJdbcTemplate named(JdbcTemplate jdbc) { return new NamedParameterJdbcTemplate(jdbc); }
        @Bean PlatformTransactionManager transactions(DataSource source) { return new DataSourceTransactionManager(source); }
        @Bean AdminAuditRecorder audit(NamedParameterJdbcTemplate named) { return new AdminAuditRecorder(named); }
        @Bean AcademicMutationService service(NamedParameterJdbcTemplate named, AdminAuditRecorder audit) {
            return new AcademicMutationService(
                    named,
                    mock(AcademicEnrollmentReadService.class),
                    mock(RegistrationService.class),
                    audit);
        }
    }
}
