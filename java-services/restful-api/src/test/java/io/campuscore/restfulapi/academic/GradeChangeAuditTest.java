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
import java.util.Map;
import javax.sql.DataSource;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
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
import org.springframework.transaction.support.TransactionTemplate;

/** Grade history uses the same transaction and authority as the grade mutation. */
@SpringJUnitConfig(GradeChangeAuditTest.Config.class)
class GradeChangeAuditTest {
    @Autowired JdbcTemplate jdbc;
    @Autowired TrackingJdbc named;
    @Autowired AcademicMutationService service;
    @Autowired PlatformTransactionManager transactions;

    @BeforeEach
    void seed() {
        named.failAuditAt = 0;
        named.auditWrites = 0;
        named.batchReads = 0;
        jdbc.execute("CREATE SCHEMA IF NOT EXISTS academic");
        jdbc.execute("CREATE SCHEMA IF NOT EXISTS campuscore_audit");
        jdbc.execute("CREATE TABLE IF NOT EXISTS academic.\"Section\" (\"id\" VARCHAR PRIMARY KEY, \"semesterId\" VARCHAR, \"lecturerId\" VARCHAR, \"capacity\" INT, \"enrolledCount\" INT, \"status\" VARCHAR)");
        jdbc.execute("CREATE TABLE IF NOT EXISTS academic.\"Enrollment\" (\"id\" VARCHAR PRIMARY KEY, \"studentId\" VARCHAR, \"sectionId\" VARCHAR, \"status\" VARCHAR, \"gradeStatus\" VARCHAR, \"finalGrade\" NUMERIC(5,2), \"letterGrade\" VARCHAR, \"updatedAt\" TIMESTAMP)");
        jdbc.execute("CREATE TABLE IF NOT EXISTS academic.\"GradeItem\" (\"id\" VARCHAR PRIMARY KEY, \"type\" VARCHAR, \"sectionId\" VARCHAR, \"name\" VARCHAR, \"maxScore\" DECIMAL, \"weight\" DECIMAL, \"gradedAt\" TIMESTAMP)");
        jdbc.execute("CREATE TABLE IF NOT EXISTS academic.\"StudentGrade\" (\"id\" VARCHAR PRIMARY KEY, \"enrollmentId\" VARCHAR, \"gradeItemId\" VARCHAR, \"score\" NUMERIC(5,2), UNIQUE (\"enrollmentId\", \"gradeItemId\"))");
        jdbc.execute("CREATE TABLE IF NOT EXISTS campuscore_audit.\"AdminAudit\" (\"id\" VARCHAR PRIMARY KEY, \"actorId\" VARCHAR, \"actorLabel\" VARCHAR(240), \"action\" VARCHAR, \"entityType\" VARCHAR, \"entityId\" VARCHAR, \"summary\" VARCHAR(500), \"beforeState\" VARCHAR, \"afterState\" VARCHAR)");
        for (String table : List.of("StudentGrade", "GradeItem", "Enrollment", "Section")) {
            jdbc.execute("DELETE FROM academic.\"" + table + "\"");
        }
        jdbc.execute("DELETE FROM campuscore_audit.\"AdminAudit\"");
        jdbc.execute("INSERT INTO academic.\"Section\" VALUES ('section', 'semester', 'lecturer', 100, 1, 'ACTIVE')");
        jdbc.execute("INSERT INTO academic.\"GradeItem\" (\"id\", \"type\", \"sectionId\") VALUES ('section-process-50', 'PROCESS', 'section'), ('section-final-50', 'FINAL', 'section')");
        enrollment("enrollment");
    }

    @Test
    void draftChangeRetainsPreviousAndAcceptedValuesWithActorAndReason() {
        save("enrollment", "8", "9", false);
        assertThat(auditText("beforeState")).contains("enrollmentId=enrollment", "processScore=6", "finalExamScore=8", "finalGrade=7", "letterGrade=B", "gradeStatus=DRAFT");
        assertThat(auditText("afterState")).contains("processScore=8", "finalExamScore=9", "finalGrade=8.50", "letterGrade=A", "gradeStatus=DRAFT", "reason=DRAFT_SAVE");
        assertThat(auditText("actorId")).isEqualTo("actor");
        assertThat(auditText("action")).isEqualTo("GRADE_UPDATE");
        assertThat(auditText("entityId")).isEqualTo("section");
    }

    @Test
    void clearRetainsRemovedComponentsAndExplicitNullAfterValues() {
        save("enrollment", null, null, true);
        assertThat(auditText("beforeState")).contains("processScore=6", "finalExamScore=8", "finalGrade=7");
        assertThat(auditText("afterState")).contains("processScore=null", "finalExamScore=null", "finalGrade=null", "letterGrade=null", "gradeStatus=NOT_GRADED", "reason=DRAFT_CLEAR");
        assertThat(auditText("action")).isEqualTo("GRADE_UPDATE_BY_ADMIN");
        assertThat(componentCount()).isZero();
    }

    @Test
    void midtermDraftAndDuplicateInputDescribeOnlyTheEffectiveWrite() {
        service.updateGrades("section", "lecturer", false, "actor", List.of(
                update("enrollment", "2", "2"), update("enrollment", "9", null)));
        assertThat(auditCount()).isEqualTo(1);
        assertThat(auditText("beforeState")).contains("finalExamScore=8");
        assertThat(auditText("afterState")).contains("processScore=9", "finalExamScore=null", "finalGrade=null", "gradeStatus=DRAFT");
        assertThat(componentCount()).isEqualTo(1);
    }

    @Test
    void firstDraftRetainsNullBeforeValues() {
        jdbc.execute("DELETE FROM academic.\"StudentGrade\"");
        jdbc.execute("UPDATE academic.\"Enrollment\" SET \"finalGrade\" = NULL, \"letterGrade\" = NULL, \"gradeStatus\" = 'NOT_GRADED'");
        save("enrollment", "8", "9", true);
        assertThat(auditText("beforeState")).contains("processScore=null", "finalExamScore=null", "finalGrade=null", "letterGrade=null", "gradeStatus=NOT_GRADED");
        assertThat(auditText("afterState")).contains("processScore=8.00", "finalExamScore=9.00", "finalGrade=8.50", "gradeStatus=DRAFT");
    }

    @Test
    void auditDescribesStoredComponentPrecisionInsteadOfRequestPrecision() {
        save("enrollment", "8.004", "9.004", true);
        assertThat(auditText("afterState")).contains("processScore=8.00", "finalExamScore=9.00")
                .doesNotContain("8.004", "9.004");
        assertThat(jdbc.queryForObject("SELECT \"score\" FROM academic.\"StudentGrade\" WHERE \"gradeItemId\" = 'section-process-50'", BigDecimal.class))
                .isEqualByComparingTo("8.00");
    }

    @ParameterizedTest
    @ValueSource(booleans = {false, true})
    void publishCapturesOnlyTransitionedRowsWithUnchangedFinalValues(boolean admin) {
        enrollment("official");
        enrollment("dropped");
        jdbc.execute("UPDATE academic.\"Enrollment\" SET \"gradeStatus\" = 'PUBLISHED', \"status\" = 'COMPLETED' WHERE \"id\" = 'official'");
        jdbc.execute("UPDATE academic.\"Enrollment\" SET \"status\" = 'DROPPED' WHERE \"id\" = 'dropped'");
        service.publishGrades("section", "lecturer", admin, "actor");
        assertThat(auditCount()).isEqualTo(1);
        assertThat(auditText("beforeState")).contains("enrollmentId=enrollment", "gradeStatus=DRAFT", "enrollmentStatus=ENROLLED", "finalGrade=7", "letterGrade=B");
        assertThat(auditText("afterState")).contains("gradeStatus=PUBLISHED", "enrollmentStatus=COMPLETED", "finalGrade=7", "letterGrade=B", "reason=PUBLISH");
        assertThat(auditText("actorId")).isEqualTo("actor");
        assertThat(auditText("action")).isEqualTo(admin ? "GRADE_PUBLISH_BY_ADMIN" : "GRADE_PUBLISH");
    }

    @Test
    void unauthorizedSaveAndPublishLeaveNeitherGradeChangesNorAudit() {
        assertThatThrownBy(() -> service.updateGrades("section", "other", false, "actor", List.of(update("enrollment", "1", "1"))))
                .hasMessageContaining("not assigned");
        assertThatThrownBy(() -> service.publishGrades("section", "other", false, "actor"))
                .hasMessageContaining("not assigned");
        assertOriginalGradeAndNoAudit();
    }

    @Test
    void invalidLaterRowRollsBackTheWholeBatchAndAudit() {
        enrollment("second");
        assertThatThrownBy(() -> service.updateGrades("section", "lecturer", false, "actor", List.of(
                update("enrollment", "1", "1"), update("second", "11", "8"))))
                .hasMessageContaining("between 0 and 10");
        assertOriginalGradeAndNoAudit();
        assertThat(componentCount()).isEqualTo(4);
    }

    @ParameterizedTest
    @ValueSource(strings = {"PUBLISHED", "APPEALED"})
    void officialGradeEditAndClearRemainLockedWithoutAudit(String status) {
        jdbc.update("UPDATE academic.\"Enrollment\" SET \"gradeStatus\" = ?", status);
        assertThatThrownBy(() -> save("enrollment", "1", "1", true)).hasMessageContaining("can no longer be edited");
        assertThatThrownBy(() -> save("enrollment", null, null, false)).hasMessageContaining("can no longer be edited");
        assertThat(auditCount()).isZero();
        assertThat(componentCount()).isEqualTo(2);
        assertThat(jdbc.queryForObject("SELECT \"gradeStatus\" FROM academic.\"Enrollment\"", String.class)).isEqualTo(status);
    }

    @Test
    void enclosingRollbackRemovesDraftAndPublicationAuditTogetherWithGrades() {
        new TransactionTemplate(transactions).executeWithoutResult(status -> {
            save("enrollment", "9", "9", true);
            service.publishGrades("section", "lecturer", true, "actor");
            assertThat(auditCount()).isEqualTo(2);
            status.setRollbackOnly();
        });
        assertOriginalGradeAndNoAudit();
    }

    @ParameterizedTest
    @ValueSource(booleans = {false, true})
    void secondAuditWriteFailureRollsBackAllGradesAndEarlierAudit(boolean publish) {
        enrollment("second");
        named.failAuditAt = 2;
        assertThatThrownBy(() -> {
            if (publish) service.publishGrades("section", "lecturer", true, "actor");
            else service.updateGrades("section", "lecturer", true, "actor", List.of(
                    update("enrollment", "9", "9"), update("second", "9", "9")));
        }).hasMessageContaining("audit unavailable");
        assertOriginalGradeAndNoAudit();
        assertThat(jdbc.queryForList("SELECT \"gradeStatus\" FROM academic.\"Enrollment\"", String.class)).containsOnly("DRAFT");
    }

    @Test
    void largerBatchKeepsEachAuditStateBoundedAndReadCountConstant() {
        save("enrollment", "9", "9", true);
        int singleReads = named.batchReads;
        jdbc.execute("DELETE FROM campuscore_audit.\"AdminAudit\"");
        for (int i = 0; i < 50; i++) enrollment("batch-" + i);
        named.batchReads = 0;
        service.updateGrades("section", "lecturer", true, "actor", java.util.stream.IntStream.range(0, 50)
                .mapToObj(i -> update("batch-" + i, "8", "9")).toList());
        assertThat(named.batchReads).isEqualTo(singleReads);
        assertThat(auditCount()).isEqualTo(50);
        for (Map<String, Object> row : jdbc.queryForList("SELECT \"beforeState\", \"afterState\", \"summary\" FROM campuscore_audit.\"AdminAudit\"")) {
            assertThat(row.get("beforeState").toString()).hasSizeLessThan(1000).doesNotContain("studentId", "email", "userId");
            assertThat(row.get("afterState").toString()).hasSizeLessThan(1000).doesNotContain("studentId", "email", "userId");
            assertThat(row.get("summary").toString()).doesNotContain("8.50", "processScore", "finalExamScore");
        }
    }

    @Test
    void largerPublicationKeepsReadCountConstantAndAuditsEveryTransition() {
        service.publishGrades("section", "lecturer", true, "actor");
        int singleReads = named.batchReads;
        jdbc.execute("DELETE FROM campuscore_audit.\"AdminAudit\"");
        for (int i = 0; i < 50; i++) enrollment("batch-" + i);
        named.batchReads = 0;
        service.publishGrades("section", "lecturer", true, "actor");
        assertThat(named.batchReads).isEqualTo(singleReads);
        assertThat(auditCount()).isEqualTo(50);
    }

    private void enrollment(String id) {
        jdbc.update("INSERT INTO academic.\"Enrollment\" VALUES (?, 'student', 'section', 'ENROLLED', 'DRAFT', 7, 'B', CURRENT_TIMESTAMP)", id);
        jdbc.update("INSERT INTO academic.\"StudentGrade\" VALUES (?, ?, 'section-process-50', 6), (?, ?, 'section-final-50', 8)", id + "-p", id, id + "-f", id);
    }

    private void save(String id, String process, String exam, boolean admin) {
        service.updateGrades("section", "lecturer", admin, "actor", List.of(update(id, process, exam)));
    }

    private static GradeUpdate update(String id, String process, String exam) {
        return new GradeUpdate(id, process == null ? null : new BigDecimal(process), exam == null ? null : new BigDecimal(exam));
    }

    private int auditCount() { return jdbc.queryForObject("SELECT COUNT(*) FROM campuscore_audit.\"AdminAudit\"", Integer.class); }
    private int componentCount() { return jdbc.queryForObject("SELECT COUNT(*) FROM academic.\"StudentGrade\"", Integer.class); }
    private String auditText(String column) { return jdbc.queryForObject("SELECT \"" + column + "\" FROM campuscore_audit.\"AdminAudit\"", String.class); }
    private void assertOriginalGradeAndNoAudit() {
        assertThat(auditCount()).isZero();
        assertThat(jdbc.queryForObject("SELECT \"finalGrade\" FROM academic.\"Enrollment\" WHERE \"id\" = 'enrollment'", BigDecimal.class)).isEqualByComparingTo("7");
        assertThat(jdbc.queryForObject("SELECT \"score\" FROM academic.\"StudentGrade\" WHERE \"id\" = 'enrollment-p'", BigDecimal.class)).isEqualByComparingTo("6");
        assertThat(jdbc.queryForObject("SELECT \"gradeStatus\" FROM academic.\"Enrollment\" WHERE \"id\" = 'enrollment'", String.class)).isEqualTo("DRAFT");
    }

    static class TrackingJdbc extends NamedParameterJdbcTemplate {
        int batchReads;
        int auditWrites;
        int failAuditAt;
        TrackingJdbc(JdbcTemplate jdbc) { super(jdbc); }
        @Override public List<Map<String, Object>> queryForList(String sql, SqlParameterSource params) {
            batchReads++;
            return super.queryForList(sql, params);
        }
        @Override public <T> List<T> queryForList(String sql, SqlParameterSource params, Class<T> type) {
            batchReads++;
            return super.queryForList(sql, params, type);
        }
        @Override public Map<String, Object> queryForMap(String sql, SqlParameterSource params) {
            batchReads++;
            return super.queryForMap(sql, params);
        }
        @Override public <T> T queryForObject(String sql, SqlParameterSource params, Class<T> type) {
            batchReads++;
            return super.queryForObject(sql, params, type);
        }
        @Override public int update(String sql, SqlParameterSource params) {
            if (sql.startsWith("INSERT INTO campuscore_audit.") && ++auditWrites == failAuditAt) {
                throw new IllegalStateException("audit unavailable");
            }
            return super.update(sql, params);
        }
    }

    @Configuration
    @EnableTransactionManagement
    static class Config {
        @Bean DataSource dataSource() { return new DriverManagerDataSource("jdbc:h2:mem:grade_change_audit;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1", "sa", ""); }
        @Bean JdbcTemplate jdbc(DataSource source) { return new JdbcTemplate(source); }
        @Bean TrackingJdbc named(JdbcTemplate jdbc) { return new TrackingJdbc(jdbc); }
        @Bean PlatformTransactionManager transactions(DataSource source) { return new DataSourceTransactionManager(source); }
        @Bean AdminAuditRecorder audit(NamedParameterJdbcTemplate named) { return new AdminAuditRecorder(named); }
        @Bean AcademicMutationService service(NamedParameterJdbcTemplate named, AdminAuditRecorder audit) {
            return new AcademicMutationService(named, mock(AcademicEnrollmentReadService.class), mock(RegistrationService.class), audit);
        }
    }
}
