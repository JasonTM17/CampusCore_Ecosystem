package io.campuscore.restfulapi.academic.web;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.util.List;
import io.campuscore.restfulapi.academic.service.AcademicConductService;
import io.campuscore.restfulapi.academic.web.AcademicConductDtos.StudentConductSummaryDto;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcOperations;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.server.ResponseStatusException;

/**
 * LEC-P1-5: the conduct read must not become a directory of the student body.
 *
 * <p>The attendance endpoints already scoped a lecturer to their own sections, while
 * this one accepted any student id from any lecturer. The sweep's ledger initially
 * recorded this as fixed when it was not — the cited helper exists only in the
 * attendance service and no conduct file was touched — so the guard and this test
 * exist to make the claim checkable.
 *
 * <p>The deny paths are the security-relevant half and need no further stubbing,
 * because the guard runs before any record is assembled.
 */
class AcademicConductReadScopeTest {

    private static final String STUDENT = "student-profile-001";
    private static final String LECTURER_DIRECTORY_ID = "lecturer-001";

    private NamedParameterJdbcTemplate jdbc;
    private AcademicConductController controller;

    @BeforeEach
    void setUp() {
        jdbc = mock(NamedParameterJdbcTemplate.class);
        controller = new AcademicConductController(new AcademicConductService(jdbc));
    }

    private void targetIsTaughtBy(int enrollmentMatches) {
        when(jdbc.queryForObject(anyString(), any(MapSqlParameterSource.class), eq(Integer.class)))
                .thenReturn(enrollmentMatches);
        // Nothing else is reached on the deny paths.
        when(jdbc.queryForList(anyString(), any(MapSqlParameterSource.class))).thenReturn(List.of());
    }

    @Test
    void lecturerWhoDoesNotTeachTheStudentIsRefused() {
        targetIsTaughtBy(0);

        ResponseStatusException denied = assertThrows(ResponseStatusException.class,
                () -> controller.getStudentConductSummary(STUDENT, lecturer( "LECTURER")));

        assertThat(denied.getStatusCode().value()).isEqualTo(403);
        assertThat(denied.getReason()).isEqualTo("CONDUCT_READ_REQUIRES_SECTION_OWNERSHIP");
    }

    @Test
    void lecturerWithoutALecturerClaimIsRefusedRatherThanTrusted() {
        targetIsTaughtBy(1);

        // No lecturerId claim means the ownership question cannot be answered at all,
        // so the safe answer is refusal — not falling through to the full read.
        Jwt withoutClaim = Jwt.withTokenValue("token-value")
                .header("alg", "HS256")
                .subject("lecturer-user-002")
                .claim("roles", List.of("LECTURER"))
                .build();

        ResponseStatusException denied = assertThrows(ResponseStatusException.class,
                () -> controller.getStudentConductSummary(STUDENT, withoutClaim));

        assertThat(denied.getReason()).isEqualTo("CONDUCT_READ_REQUIRES_SECTION_OWNERSHIP");
    }

    @Test
    void lecturerTeachingTheStudentIsAllowed() {
        targetIsTaughtBy(1);

        // The guard passes; the record assembly then fails for lack of fixtures, so
        // what is asserted is that the refusal is not the ownership refusal.
        Throwable thrown = assertThrows(Throwable.class,
                () -> controller.getStudentConductSummary(STUDENT, lecturer("LECTURER")));

        if (thrown instanceof ResponseStatusException statusException) {
            assertThat(statusException.getReason())
                    .as("a teaching lecturer must not be refused on ownership grounds")
                    .isNotEqualTo("CONDUCT_READ_REQUIRES_SECTION_OWNERSHIP");
        }
    }

    @Test
    void staffKeepTheFullRead() {
        targetIsTaughtBy(0);

        Throwable thrown = assertThrows(Throwable.class,
                () -> controller.getStudentConductSummary(STUDENT, lecturer("ADMIN")));

        if (thrown instanceof ResponseStatusException statusException) {
            assertThat(statusException.getReason())
                    .as("staff must not be scoped to section ownership")
                    .isNotEqualTo("CONDUCT_READ_REQUIRES_SECTION_OWNERSHIP");
        }
    }

    /*
     * The ownership guard is only as strong as the COUNT it runs, so these
     * cases exercise the real query against H2 instead of stubbing the count.
     * A seat that never took effect (dropped or cancelled enrollment, or a
     * cancelled section that never met) is not a teaching relationship; an
     * active or finished seat is.
     */

    @Test
    void droppedEnrollmentDoesNotCreateATeachingRelationship() {
        NamedParameterJdbcTemplate realJdbc = conductSchema();
        JdbcOperations seed = realJdbc.getJdbcOperations();
        seedStudent(seed, STUDENT);
        seedSection(seed, "sec-dropped", LECTURER_DIRECTORY_ID, "OPEN");
        seedEnrollment(seed, "enr-dropped", STUDENT, "sec-dropped", "DROPPED");

        ResponseStatusException denied = assertThrows(ResponseStatusException.class,
                () -> realController(realJdbc).getStudentConductSummary(STUDENT, lecturer("LECTURER")));

        assertThat(denied.getStatusCode().value()).isEqualTo(403);
        assertThat(denied.getReason()).isEqualTo("CONDUCT_READ_REQUIRES_SECTION_OWNERSHIP");
    }

    @Test
    void cancelledEnrollmentDoesNotCreateATeachingRelationship() {
        NamedParameterJdbcTemplate realJdbc = conductSchema();
        JdbcOperations seed = realJdbc.getJdbcOperations();
        seedStudent(seed, STUDENT);
        seedSection(seed, "sec-cancelled", LECTURER_DIRECTORY_ID, "OPEN");
        seedEnrollment(seed, "enr-cancelled", STUDENT, "sec-cancelled", "CANCELLED");

        ResponseStatusException denied = assertThrows(ResponseStatusException.class,
                () -> realController(realJdbc).getStudentConductSummary(STUDENT, lecturer("LECTURER")));

        assertThat(denied.getStatusCode().value()).isEqualTo(403);
        assertThat(denied.getReason()).isEqualTo("CONDUCT_READ_REQUIRES_SECTION_OWNERSHIP");
    }

    @Test
    void cancelledSectionDoesNotCreateATeachingRelationship() {
        NamedParameterJdbcTemplate realJdbc = conductSchema();
        JdbcOperations seed = realJdbc.getJdbcOperations();
        seedStudent(seed, STUDENT);
        seedSection(seed, "sec-never-met", LECTURER_DIRECTORY_ID, "CANCELLED");
        seedEnrollment(seed, "enr-never-met", STUDENT, "sec-never-met", "ENROLLED");

        ResponseStatusException denied = assertThrows(ResponseStatusException.class,
                () -> realController(realJdbc).getStudentConductSummary(STUDENT, lecturer("LECTURER")));

        assertThat(denied.getStatusCode().value()).isEqualTo(403);
        assertThat(denied.getReason()).isEqualTo("CONDUCT_READ_REQUIRES_SECTION_OWNERSHIP");
    }

    @Test
    void enrollmentUnderADifferentLecturerIsRefused() {
        NamedParameterJdbcTemplate realJdbc = conductSchema();
        JdbcOperations seed = realJdbc.getJdbcOperations();
        seedStudent(seed, STUDENT);
        seedSection(seed, "sec-other", "lecturer-other-999", "OPEN");
        seedEnrollment(seed, "enr-other", STUDENT, "sec-other", "ENROLLED");

        ResponseStatusException denied = assertThrows(ResponseStatusException.class,
                () -> realController(realJdbc).getStudentConductSummary(STUDENT, lecturer("LECTURER")));

        assertThat(denied.getStatusCode().value()).isEqualTo(403);
        assertThat(denied.getReason()).isEqualTo("CONDUCT_READ_REQUIRES_SECTION_OWNERSHIP");
    }

    @Test
    void activeEnrollmentKeepsTheLecturerRead() {
        NamedParameterJdbcTemplate realJdbc = conductSchema();
        JdbcOperations seed = realJdbc.getJdbcOperations();
        seedStudent(seed, STUDENT);
        seedSection(seed, "sec-active", LECTURER_DIRECTORY_ID, "OPEN");
        seedEnrollment(seed, "enr-active", STUDENT, "sec-active", "ENROLLED");

        StudentConductSummaryDto summary =
                realController(realJdbc).getStudentConductSummary(STUDENT, lecturer("LECTURER"));

        assertThat(summary).isNotNull();
        assertThat(summary.studentId()).isEqualTo(STUDENT);
    }

    @Test
    void completedEnrollmentKeepsTheLecturerRead() {
        NamedParameterJdbcTemplate realJdbc = conductSchema();
        JdbcOperations seed = realJdbc.getJdbcOperations();
        seedStudent(seed, STUDENT);
        seedSection(seed, "sec-completed", LECTURER_DIRECTORY_ID, "CLOSED");
        seedEnrollment(seed, "enr-completed", STUDENT, "sec-completed", "COMPLETED");

        StudentConductSummaryDto summary =
                realController(realJdbc).getStudentConductSummary(STUDENT, lecturer("LECTURER"));

        assertThat(summary).isNotNull();
        assertThat(summary.studentId()).isEqualTo(STUDENT);
    }

    @Test
    void staffReadIsNotScopedByEnrollmentState() {
        NamedParameterJdbcTemplate realJdbc = conductSchema();
        JdbcOperations seed = realJdbc.getJdbcOperations();
        seedStudent(seed, STUDENT);
        seedSection(seed, "sec-staff", LECTURER_DIRECTORY_ID, "OPEN");
        seedEnrollment(seed, "enr-staff", STUDENT, "sec-staff", "DROPPED");

        StudentConductSummaryDto summary =
                realController(realJdbc).getStudentConductSummary(STUDENT, lecturer("ADMIN"));

        assertThat(summary).isNotNull();
        assertThat(summary.studentId()).isEqualTo(STUDENT);
    }

    private static AcademicConductController realController(NamedParameterJdbcTemplate realJdbc) {
        return new AcademicConductController(new AcademicConductService(realJdbc));
    }

    private static NamedParameterJdbcTemplate conductSchema() {
        DriverManagerDataSource dataSource = new DriverManagerDataSource();
        dataSource.setDriverClassName("org.h2.Driver");
        dataSource.setUrl("jdbc:h2:mem:conduct_scope_" + System.nanoTime()
                + ";MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1");
        dataSource.setUsername("sa");
        dataSource.setPassword("");

        JdbcTemplate ddl = new JdbcTemplate(dataSource);
        ddl.execute("CREATE SCHEMA IF NOT EXISTS \"academic\"");
        ddl.execute("CREATE SCHEMA IF NOT EXISTS \"campuscore_auth\"");
        ddl.execute("""
            CREATE TABLE "campuscore_auth"."User" (
                "id" VARCHAR(64) PRIMARY KEY,
                "firstName" VARCHAR(64),
                "lastName" VARCHAR(64)
            )
        """);
        ddl.execute("""
            CREATE TABLE "academic"."Student" (
                "id" VARCHAR(64) PRIMARY KEY,
                "userId" VARCHAR(64),
                "studentId" VARCHAR(32)
            )
        """);
        ddl.execute("""
            CREATE TABLE "academic"."Section" (
                "id" VARCHAR(64) PRIMARY KEY,
                "lecturerId" VARCHAR(64),
                "status" VARCHAR(32) NOT NULL
            )
        """);
        ddl.execute("""
            CREATE TABLE "academic"."Enrollment" (
                "id" VARCHAR(64) PRIMARY KEY,
                "studentId" VARCHAR(64),
                "sectionId" VARCHAR(64),
                "status" VARCHAR(32) NOT NULL
            )
        """);
        ddl.execute("""
            CREATE TABLE "academic"."Semester" (
                "id" VARCHAR(64) PRIMARY KEY,
                "name" VARCHAR(128),
                "startDate" DATE
            )
        """);
        ddl.execute("""
            CREATE TABLE academic.conduct_semester_score (
                id VARCHAR(64) PRIMARY KEY,
                student_id VARCHAR(64),
                semester_id VARCHAR(64),
                criteria1_score NUMERIC(5,2),
                criteria2_score NUMERIC(5,2),
                criteria3_score NUMERIC(5,2),
                criteria4_score NUMERIC(5,2),
                criteria5_score NUMERIC(5,2),
                total_score NUMERIC(5,2),
                classification VARCHAR(64),
                classification_vi VARCHAR(64),
                status VARCHAR(32),
                evaluator_name VARCHAR(128)
            )
        """);
        ddl.execute("""
            CREATE TABLE academic.conduct_activity (
                id VARCHAR(64) PRIMARY KEY,
                student_id VARCHAR(64),
                semester_id VARCHAR(64),
                title VARCHAR(256),
                category VARCHAR(64),
                points NUMERIC(5,2),
                activity_date DATE,
                organizer VARCHAR(128),
                certificate_url VARCHAR(256)
            )
        """);
        return new NamedParameterJdbcTemplate(dataSource);
    }

    private static void seedStudent(JdbcOperations seed, String profileId) {
        seed.update("INSERT INTO \"campuscore_auth\".\"User\" (\"id\", \"firstName\", \"lastName\") VALUES (?, ?, ?)",
                "usr-" + profileId, "Student", "Test");
        seed.update("INSERT INTO \"academic\".\"Student\" (\"id\", \"userId\", \"studentId\") VALUES (?, ?, ?)",
                profileId, "usr-" + profileId, "22110099");
    }

    private static void seedSection(JdbcOperations seed, String sectionId, String lecturerId, String status) {
        seed.update("INSERT INTO \"academic\".\"Section\" (\"id\", \"lecturerId\", \"status\") VALUES (?, ?, ?)",
                sectionId, lecturerId, status);
    }

    private static void seedEnrollment(JdbcOperations seed, String enrollmentId, String profileId,
            String sectionId, String status) {
        seed.update("INSERT INTO \"academic\".\"Enrollment\" (\"id\", \"studentId\", \"sectionId\", \"status\")"
                + " VALUES (?, ?, ?, ?)", enrollmentId, profileId, sectionId, status);
    }

    private static Jwt lecturer(String role) {
        return Jwt.withTokenValue("token-value")
                .header("alg", "HS256")
                .subject("lecturer-user-002")
                .claim("roles", List.of(role))
                .claim("lecturerId", LECTURER_DIRECTORY_ID)
                .build();
    }
}
