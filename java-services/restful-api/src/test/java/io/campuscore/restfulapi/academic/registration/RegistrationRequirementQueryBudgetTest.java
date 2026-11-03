package io.campuscore.restfulapi.academic.registration;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;

import io.campuscore.restfulapi.academic.service.AcademicEnrollmentReadService;
import io.campuscore.restfulapi.web.DomainException;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.jdbc.core.namedparam.SqlParameterSource;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.transaction.PlatformTransactionManager;

/**
 * Requirement evaluation happens while the student's enrollment rows are
 * locked, so its statement count must not grow with the requirement count.
 */
class RegistrationRequirementQueryBudgetTest {

    private TrackingJdbc jdbc;
    private RegistrationService registration;
    private Method assertPrereqAndCoreq;

    @BeforeEach
    void setUp() throws Exception {
        jdbc = new TrackingJdbc(new JdbcTemplate(new DriverManagerDataSource(
                "jdbc:h2:mem:registration_requirement_budget;MODE=PostgreSQL;"
                        + "DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1", "sa", "")));
        jdbc.getJdbcOperations().execute("CREATE SCHEMA IF NOT EXISTS academic");
        jdbc.getJdbcOperations().execute("DROP TABLE IF EXISTS academic.\"CourseRequirement\"");
        jdbc.getJdbcOperations().execute("DROP TABLE IF EXISTS academic.\"Enrollment\"");
        jdbc.getJdbcOperations().execute("DROP TABLE IF EXISTS academic.\"Section\"");
        jdbc.getJdbcOperations().execute("""
                CREATE TABLE academic."CourseRequirement" (
                    "id" VARCHAR(120) PRIMARY KEY,
                    "courseId" VARCHAR(120) NOT NULL,
                    "requiredCourseId" VARCHAR(120) NOT NULL,
                    "kind" VARCHAR(16) NOT NULL,
                    "minLetterGrade" VARCHAR(16)
                )
                """);
        jdbc.getJdbcOperations().execute("""
                CREATE TABLE academic."Enrollment" (
                    "id" VARCHAR(120) PRIMARY KEY,
                    "studentId" VARCHAR(120) NOT NULL,
                    "courseId" VARCHAR(120) NOT NULL,
                    "semesterId" VARCHAR(120) NOT NULL,
                    "status" VARCHAR(40) NOT NULL,
                    "gradeStatus" VARCHAR(40) NOT NULL,
                    "letterGrade" VARCHAR(16)
                )
                """);
        jdbc.getJdbcOperations().execute("""
                CREATE TABLE academic."Section" (
                    "id" VARCHAR(120) PRIMARY KEY,
                    "courseId" VARCHAR(120) NOT NULL
                )
                """);
        registration = new RegistrationService(
                jdbc,
                mock(AcademicEnrollmentReadService.class),
                mock(RegistrationPdfRenderer.class),
                mock(CreditLimitApplicationService.class),
                mock(PlatformTransactionManager.class));
        assertPrereqAndCoreq = RegistrationService.class.getDeclaredMethod(
                "assertPrereqAndCoreq", String.class, String.class, String.class, List.class);
        assertPrereqAndCoreq.setAccessible(true);
    }

    @Test
    void prerequisiteStatementCountDoesNotGrowWithRequirementCount() {
        int single = statementsFor(1, "PREREQ", "B");
        int many = statementsFor(6, "PREREQ", "B");

        assertThat(many).isEqualTo(single);
    }

    @Test
    void corequisiteStatementCountDoesNotGrowWithRequirementCount() {
        int single = statementsFor(1, "COREQ", null);
        int many = statementsFor(6, "COREQ", null);

        assertThat(many).isEqualTo(single);
    }

    @Test
    void prerequisiteFailureKeepsItsCodeStatusAndMessage() {
        seedRequirements(1, "PREREQ", "B");
        jdbc.getJdbcOperations().update(
                "UPDATE academic.\"Enrollment\" SET \"letterGrade\" = 'C' WHERE \"studentId\" = 'student-1'");

        assertThatThrownBy(this::evaluate)
                .isInstanceOf(DomainException.class)
                .satisfies(error -> {
                    DomainException domain = (DomainException) error;
                    assertThat(domain.code()).isEqualTo("PREREQUISITE_UNMET");
                    assertThat(domain.getStatus()).isEqualTo(HttpStatus.UNPROCESSABLE_ENTITY);
                    assertThat(domain.getMessage()).isEqualTo("A required prerequisite is missing");
                });
    }

    @Test
    void corequisiteFailureKeepsItsCodeStatusAndMessage() {
        seedRequirements(1, "COREQ", null);
        jdbc.getJdbcOperations().update(
                "UPDATE academic.\"Enrollment\" SET \"status\" = 'DROPPED' WHERE \"studentId\" = 'student-1'");

        assertThatThrownBy(this::evaluate)
                .isInstanceOf(DomainException.class)
                .satisfies(error -> {
                    DomainException domain = (DomainException) error;
                    assertThat(domain.code()).isEqualTo("COREQUISITE_UNMET");
                    assertThat(domain.getStatus()).isEqualTo(HttpStatus.UNPROCESSABLE_ENTITY);
                    assertThat(domain.getMessage()).isEqualTo("A required corequisite is missing");
                });
    }

    @Test
    void letterFloorIsDecidedByTheBestPassingAttempt() {
        seedRequirements(1, "PREREQ", "B-");
        jdbc.getJdbcOperations().update(
                "INSERT INTO academic.\"Enrollment\" "
                        + "(\"id\",\"studentId\",\"courseId\",\"semesterId\",\"status\",\"gradeStatus\",\"letterGrade\") "
                        + "VALUES ('retry','student-1','required-0','sem-1','COMPLETED','COMPLETED','D')");

        assertThat(evaluate()).isNull();
    }

    @Test
    void corequisiteCanBeSatisfiedByTheRequestedSection() {
        jdbc.getJdbcOperations().update("DELETE FROM academic.\"CourseRequirement\"");
        jdbc.getJdbcOperations().update("DELETE FROM academic.\"Enrollment\"");
        jdbc.getJdbcOperations().update("DELETE FROM academic.\"Section\"");
        jdbc.getJdbcOperations().update(
                "INSERT INTO academic.\"CourseRequirement\" "
                        + "(\"id\",\"courseId\",\"requiredCourseId\",\"kind\",\"minLetterGrade\") "
                        + "VALUES ('req-coreq','course-target','course-requested','COREQ',NULL)");
        jdbc.getJdbcOperations().update(
                "INSERT INTO academic.\"Section\" (\"id\",\"courseId\") "
                        + "VALUES ('section-request','course-requested')");

        assertThat(evaluate()).isNull();
    }

    @Test
    void appealedPassingGradeStillSatisfiesPrerequisite() {
        // An appealed grade is still the official, student-visible record, so
        // it must keep satisfying prerequisites while the appeal is pending.
        seedRequirements(1, "PREREQ", null);
        jdbc.getJdbcOperations().update(
                "UPDATE academic.\"Enrollment\" SET \"gradeStatus\" = 'APPEALED' WHERE \"studentId\" = 'student-1'");

        assertThat(evaluate()).isNull();
    }

    private int statementsFor(int requirementCount, String kind, String floor) {
        seedRequirements(requirementCount, kind, floor);
        jdbc.statements = 0;
        evaluate();
        return jdbc.statements;
    }

    private void seedRequirements(int requirementCount, String kind, String floor) {
        jdbc.getJdbcOperations().update("DELETE FROM academic.\"CourseRequirement\"");
        jdbc.getJdbcOperations().update("DELETE FROM academic.\"Enrollment\"");
        jdbc.getJdbcOperations().update("DELETE FROM academic.\"Section\"");
        for (int i = 0; i < requirementCount; i++) {
            String required = "required-" + i;
            jdbc.getJdbcOperations().update(
                    "INSERT INTO academic.\"CourseRequirement\" "
                            + "(\"id\",\"courseId\",\"requiredCourseId\",\"kind\",\"minLetterGrade\") "
                            + "VALUES (?, 'course-target', ?, ?, ?)",
                    "requirement-" + i, required, kind, floor);
            if ("PREREQ".equals(kind)) {
                jdbc.getJdbcOperations().update(
                        "INSERT INTO academic.\"Enrollment\" "
                                + "(\"id\",\"studentId\",\"courseId\",\"semesterId\",\"status\",\"gradeStatus\","
                                + "\"letterGrade\") VALUES (?, 'student-1', ?, 'sem-1', 'COMPLETED', "
                                + "'COMPLETED', 'B')",
                        "completed-" + i, required);
            } else {
                jdbc.getJdbcOperations().update(
                        "INSERT INTO academic.\"Enrollment\" "
                                + "(\"id\",\"studentId\",\"courseId\",\"semesterId\",\"status\",\"gradeStatus\","
                                + "\"letterGrade\") VALUES (?, 'student-1', ?, 'sem-1', 'ENROLLED', "
                                + "'NOT_GRADED', NULL)",
                        "active-" + i, required);
            }
        }
    }

    private Object evaluate() {
        try {
            return assertPrereqAndCoreq.invoke(
                    registration, "student-1", "course-target", "sem-1", List.of("section-request"));
        } catch (InvocationTargetException exception) {
            throw (RuntimeException) exception.getCause();
        } catch (IllegalAccessException exception) {
            throw new IllegalStateException(exception);
        }
    }

    static final class TrackingJdbc extends NamedParameterJdbcTemplate {
        int statements;

        TrackingJdbc(JdbcTemplate jdbc) {
            super(jdbc);
        }

        @Override
        public List<Map<String, Object>> queryForList(String sql, SqlParameterSource params) {
            statements++;
            return super.queryForList(sql, params);
        }

        @Override
        public <T> List<T> queryForList(String sql, SqlParameterSource params, Class<T> elementType) {
            statements++;
            return super.queryForList(sql, params, elementType);
        }

        @Override
        public <T> T queryForObject(String sql, SqlParameterSource params, Class<T> requiredType) {
            statements++;
            return super.queryForObject(sql, params, requiredType);
        }

        @Override
        public int update(String sql, SqlParameterSource params) {
            statements++;
            return super.update(sql, params);
        }

        @Override
        public <T> List<T> query(String sql, SqlParameterSource params, RowMapper<T> mapper) {
            statements++;
            return super.query(sql, params, mapper);
        }
    }
}
