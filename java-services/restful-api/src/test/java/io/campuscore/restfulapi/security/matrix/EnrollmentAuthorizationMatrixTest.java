package io.campuscore.restfulapi.security.matrix;

import static io.campuscore.restfulapi.testsupport.CurrentAccountJwt.fixtureJwt;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import io.campuscore.restfulapi.testsupport.AccountAuthorityFixture;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.RequestPostProcessor;

/**
 * Cross-user authorization matrix for student-owned academic records:
 * enrollments (list/detail/drop), grade components and attendance.
 *
 * <p>Every id-taking route below answers a foreign id the way the current code
 * does: 404 for the enrollment/grade reads, 403 ENROLLMENT_FORBIDDEN for the
 * drop, 403 HTTP_403 for an attendance row. Positive owner and admin rows are
 * included so a symmetric over-restriction is caught as well.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles({"test", "persistence"})
@TestPropertySource(properties = {
        "spring.flyway.enabled=false",
        "spring.datasource.url=jdbc:h2:mem:authz_enrollment;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1"
})
class EnrollmentAuthorizationMatrixTest {

    private static final String STUDENT_A = "mx-enr-user-a";
    private static final String STUDENT_B = "mx-enr-user-b";
    private static final String STUDENT_A_ID = "mx-enr-student-a";
    private static final String STUDENT_B_ID = "mx-enr-student-b";
    private static final String ADMIN = "mx-enr-admin";
    private static final String LECTURER = "mx-enr-lecturer-user";
    private static final Instant NOW = Instant.parse("2026-08-21T01:00:00Z");

    @Autowired
    private JdbcTemplate jdbc;

    @Autowired
    private MockMvc mvc;

    @BeforeEach
    void prepareAcademicFixture() {
        jdbc.execute("CREATE SCHEMA IF NOT EXISTS \"campuscore_auth\"");
        jdbc.execute("CREATE SCHEMA IF NOT EXISTS \"academic\"");
        createTables();
        AccountAuthorityFixture.ensureSchema(jdbc);
        clearTables();
        insertFixture();
    }

    @Test
    void student_reads_only_own_enrollments_attendance_and_grades() throws Exception {
        mvc.perform(get("/api/v1/enrollments/my").with(studentJwt(STUDENT_A)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].id").value("mx-enr-a"))
                .andExpect(jsonPath("$[0].studentId").value(STUDENT_A_ID));

        mvc.perform(get("/api/v1/enrollments/mx-enr-a").with(studentJwt(STUDENT_A)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value("mx-enr-a"));

        mvc.perform(get("/api/v1/grades/student-grades/enrollment/mx-enr-a")
                        .with(studentJwt(STUDENT_A)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.enrollment.id").value("mx-enr-a"))
                .andExpect(jsonPath("$.grades.length()").value(1));

        mvc.perform(get("/api/v1/attendance/my").with(studentJwt(STUDENT_A)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].id").value("mx-att-a"));

        mvc.perform(get("/api/v1/attendance/mx-att-a").with(studentJwt(STUDENT_A)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value("mx-att-a"));
    }

    @Test
    void student_cannot_read_another_students_enrollment() throws Exception {
        mvc.perform(get("/api/v1/enrollments/mx-enr-b").with(studentJwt(STUDENT_A)))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("NOT_FOUND"));
    }

    @Test
    void student_cannot_read_another_students_grades() throws Exception {
        mvc.perform(get("/api/v1/grades/student-grades/enrollment/mx-enr-b")
                        .with(studentJwt(STUDENT_A)))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("NOT_FOUND"));
    }

    @Test
    void student_cannot_read_another_students_attendance() throws Exception {
        mvc.perform(get("/api/v1/attendance/mx-att-b").with(studentJwt(STUDENT_A)))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("HTTP_403"));
    }

    @Test
    void student_cannot_drop_another_students_enrollment() throws Exception {
        mvc.perform(post("/api/v1/me/enrollments/mx-enr-b/drop")
                        .header("Idempotency-Key", "mx-drop-foreign")
                        .with(studentJwt(STUDENT_A)))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("ENROLLMENT_FORBIDDEN"));

        assertThat(enrollmentStatus("mx-enr-b")).isEqualTo("ENROLLED");
    }

    @Test
    void lecturer_cannot_use_student_only_enrollment_surfaces() throws Exception {
        mvc.perform(get("/api/v1/enrollments/my").with(lecturerJwt()))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("ACCESS_DENIED"));

        mvc.perform(post("/api/v1/me/enrollments/mx-enr-a/drop")
                        .header("Idempotency-Key", "mx-drop-lecturer")
                        .with(lecturerJwt()))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("ACCESS_DENIED"));

        assertThat(enrollmentStatus("mx-enr-a")).isEqualTo("ENROLLED");
    }

    @Test
    void admin_reads_any_students_enrollment_and_attendance() throws Exception {
        mvc.perform(get("/api/v1/enrollments/mx-enr-b").with(adminJwt()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value("mx-enr-b"))
                .andExpect(jsonPath("$.studentId").value(STUDENT_B_ID));

        mvc.perform(get("/api/v1/attendance/mx-att-b").with(adminJwt()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value("mx-att-b"));
    }

    private void createTables() {
        jdbc.execute("""
                CREATE TABLE IF NOT EXISTS "campuscore_auth"."User" (
                    "id" VARCHAR(120) PRIMARY KEY,
                    "email" VARCHAR(320) NOT NULL,
                    "password" VARCHAR(200) NOT NULL DEFAULT 'password',
                    "firstName" VARCHAR(120) NOT NULL,
                    "lastName" VARCHAR(120) NOT NULL,
                    "status" VARCHAR(40) NOT NULL DEFAULT 'ACTIVE',
                    "mustChangePassword" BOOLEAN NOT NULL DEFAULT FALSE,
                    "twoFactorEnabled" BOOLEAN NOT NULL DEFAULT FALSE,
                    "emailVerified" BOOLEAN NOT NULL DEFAULT TRUE,
                    "isSuperAdmin" BOOLEAN NOT NULL DEFAULT FALSE,
                    "failedLoginAttempts" INTEGER NOT NULL DEFAULT 0,
                    "credentialVersion" BIGINT NOT NULL DEFAULT 0,
                    "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    "updatedAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
                """);
        jdbc.execute("""
                CREATE TABLE IF NOT EXISTS "academic"."Student" (
                    "id" VARCHAR(120) PRIMARY KEY,
                    "userId" VARCHAR(120) NOT NULL,
                    "studentId" VARCHAR(120) NOT NULL,
                    "curriculumId" VARCHAR(120) NOT NULL,
                    "year" INTEGER NOT NULL,
                    "status" VARCHAR(40) NOT NULL,
                    "admissionDate" TIMESTAMP NOT NULL,
                    "createdAt" TIMESTAMP NOT NULL,
                    "updatedAt" TIMESTAMP NOT NULL
                )
                """);
        jdbc.execute("""
                CREATE TABLE IF NOT EXISTS "academic"."Department" (
                    "id" VARCHAR(120) PRIMARY KEY,
                    "facultyId" VARCHAR(120) NOT NULL
                )
                """);
        jdbc.execute("""
                CREATE TABLE IF NOT EXISTS "academic"."Lecturer" (
                    "id" VARCHAR(120) PRIMARY KEY,
                    "userId" VARCHAR(120) NOT NULL,
                    "departmentId" VARCHAR(120) NOT NULL,
                    "employeeId" VARCHAR(120) NOT NULL,
                    "isActive" BOOLEAN NOT NULL
                )
                """);
        jdbc.execute("""
                CREATE TABLE IF NOT EXISTS "academic"."AcademicYear" (
                    "id" VARCHAR(120) PRIMARY KEY,
                    "year" INTEGER NOT NULL,
                    "startDate" TIMESTAMP NOT NULL,
                    "endDate" TIMESTAMP NOT NULL,
                    "isCurrent" BOOLEAN NOT NULL,
                    "createdAt" TIMESTAMP NOT NULL,
                    "updatedAt" TIMESTAMP NOT NULL
                )
                """);
        jdbc.execute("""
                CREATE TABLE IF NOT EXISTS "academic"."Semester" (
                    "id" VARCHAR(120) PRIMARY KEY,
                    "name" VARCHAR(120) NOT NULL,
                    "nameEn" VARCHAR(120),
                    "nameVi" VARCHAR(120),
                    "type" VARCHAR(40) NOT NULL,
                    "academicYearId" VARCHAR(120) NOT NULL,
                    "startDate" TIMESTAMP NOT NULL,
                    "endDate" TIMESTAMP NOT NULL,
                    "registrationStart" TIMESTAMP,
                    "registrationEnd" TIMESTAMP,
                    "addDropStart" TIMESTAMP,
                    "addDropEnd" TIMESTAMP,
                    "status" VARCHAR(40) NOT NULL,
                    "createdAt" TIMESTAMP NOT NULL,
                    "updatedAt" TIMESTAMP NOT NULL
                )
                """);
        jdbc.execute("""
                CREATE TABLE IF NOT EXISTS "academic"."Course" (
                    "id" VARCHAR(120) PRIMARY KEY,
                    "code" VARCHAR(40) NOT NULL,
                    "name" VARCHAR(200) NOT NULL,
                    "nameEn" VARCHAR(200),
                    "nameVi" VARCHAR(200),
                    "description" VARCHAR(1000),
                    "descriptionEn" VARCHAR(1000),
                    "descriptionVi" VARCHAR(1000),
                    "credits" INTEGER NOT NULL,
                    "departmentId" VARCHAR(120) NOT NULL,
                    "semesterId" VARCHAR(120),
                    "isActive" BOOLEAN NOT NULL,
                    "createdAt" TIMESTAMP NOT NULL,
                    "updatedAt" TIMESTAMP NOT NULL
                )
                """);
        jdbc.execute("""
                CREATE TABLE IF NOT EXISTS "academic"."Classroom" (
                    "id" VARCHAR(120) PRIMARY KEY,
                    "building" VARCHAR(120) NOT NULL,
                    "roomNumber" VARCHAR(120) NOT NULL
                )
                """);
        jdbc.execute("""
                CREATE TABLE IF NOT EXISTS "academic"."Section" (
                    "id" VARCHAR(120) PRIMARY KEY,
                    "sectionNumber" VARCHAR(40) NOT NULL,
                    "courseId" VARCHAR(120) NOT NULL,
                    "semesterId" VARCHAR(120) NOT NULL,
                    "lecturerId" VARCHAR(120),
                    "classroomId" VARCHAR(120),
                    "capacity" INTEGER NOT NULL,
                    "enrolledCount" INTEGER NOT NULL,
                    "status" VARCHAR(40) NOT NULL
                )
                """);
        jdbc.execute("""
                CREATE TABLE IF NOT EXISTS "academic"."SectionSchedule" (
                    "id" VARCHAR(120) PRIMARY KEY,
                    "sectionId" VARCHAR(120) NOT NULL,
                    "classroomId" VARCHAR(120) NOT NULL,
                    "dayOfWeek" INTEGER NOT NULL,
                    "startTime" VARCHAR(20) NOT NULL,
                    "endTime" VARCHAR(20) NOT NULL
                )
                """);
        jdbc.execute("""
                CREATE TABLE IF NOT EXISTS "academic"."Enrollment" (
                    "id" VARCHAR(120) PRIMARY KEY,
                    "studentId" VARCHAR(120) NOT NULL,
                    "sectionId" VARCHAR(120) NOT NULL,
                    "semesterId" VARCHAR(120) NOT NULL,
                    "status" VARCHAR(40) NOT NULL,
                    "enrolledAt" TIMESTAMP NOT NULL,
                    "droppedAt" TIMESTAMP,
                    "gradeStatus" VARCHAR(40) NOT NULL,
                    "finalGrade" DECIMAL(5, 2),
                    "letterGrade" VARCHAR(10),
                    "createdAt" TIMESTAMP NOT NULL,
                    "updatedAt" TIMESTAMP NOT NULL
                )
                """);
        jdbc.execute("""
                CREATE TABLE IF NOT EXISTS "academic"."GradeItem" (
                    "id" VARCHAR(120) PRIMARY KEY,
                    "sectionId" VARCHAR(120) NOT NULL,
                    "name" VARCHAR(120) NOT NULL,
                    "type" VARCHAR(40) NOT NULL,
                    "maxScore" DECIMAL(5, 2) NOT NULL,
                    "weight" DECIMAL(5, 2) NOT NULL,
                    "gradedAt" TIMESTAMP,
                    "createdAt" TIMESTAMP NOT NULL
                )
                """);
        jdbc.execute("""
                CREATE TABLE IF NOT EXISTS "academic"."StudentGrade" (
                    "id" VARCHAR(120) PRIMARY KEY,
                    "gradeItemId" VARCHAR(120) NOT NULL,
                    "enrollmentId" VARCHAR(120) NOT NULL,
                    "score" DECIMAL(5, 2)
                )
                """);
        jdbc.execute("""
                CREATE TABLE IF NOT EXISTS "academic"."Attendance" (
                    "id" VARCHAR(120) PRIMARY KEY,
                    "studentId" VARCHAR(120) NOT NULL,
                    "sectionId" VARCHAR(120) NOT NULL,
                    "date" TIMESTAMP WITH TIME ZONE NOT NULL,
                    "status" VARCHAR(40) NOT NULL,
                    "notes" VARCHAR(1000),
                    "createdAt" TIMESTAMP NOT NULL
                )
                """);
        // RegistrationService.drop claims its idempotency row before the
        // ownership check, so the table must exist even for the refused call.
        jdbc.execute("""
                CREATE TABLE IF NOT EXISTS "academic"."RegistrationIdempotency" (
                    "id" VARCHAR(120) PRIMARY KEY,
                    "ownerId" VARCHAR(120) NOT NULL,
                    "idempotencyKey" VARCHAR(200) NOT NULL,
                    "requestHash" CHAR(64) NOT NULL,
                    "state" VARCHAR(40) NOT NULL,
                    "enrollmentId" VARCHAR(120),
                    "responseBody" TEXT,
                    "slipSha256" CHAR(64),
                    "version" INTEGER NOT NULL DEFAULT 0,
                    "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    "updatedAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE ("ownerId", "idempotencyKey")
                )
                """);
    }

    private void clearTables() {
        jdbc.update("DELETE FROM \"academic\".\"Attendance\"");
        jdbc.update("DELETE FROM \"academic\".\"StudentGrade\"");
        jdbc.update("DELETE FROM \"academic\".\"GradeItem\"");
        jdbc.update("DELETE FROM \"academic\".\"RegistrationIdempotency\"");
        jdbc.update("DELETE FROM \"academic\".\"Enrollment\"");
        jdbc.update("DELETE FROM \"academic\".\"SectionSchedule\"");
        jdbc.update("DELETE FROM \"academic\".\"Section\"");
        jdbc.update("DELETE FROM \"academic\".\"Course\"");
        jdbc.update("DELETE FROM \"academic\".\"Semester\"");
        jdbc.update("DELETE FROM \"academic\".\"AcademicYear\"");
        jdbc.update("DELETE FROM \"academic\".\"Student\"");
        jdbc.update("DELETE FROM \"academic\".\"Lecturer\"");
        jdbc.update("DELETE FROM \"academic\".\"Department\"");
        jdbc.update("DELETE FROM \"campuscore_auth\".\"User\"");
    }

    private void insertFixture() {
        jdbc.update("INSERT INTO \"campuscore_auth\".\"User\" (\"id\", \"email\", \"firstName\", \"lastName\")"
                        + " VALUES (?, ?, ?, ?)",
                STUDENT_A, "mx-enr-a@campuscore.edu", "An", "Nguyen");
        jdbc.update("INSERT INTO \"campuscore_auth\".\"User\" (\"id\", \"email\", \"firstName\", \"lastName\")"
                        + " VALUES (?, ?, ?, ?)",
                STUDENT_B, "mx-enr-b@campuscore.edu", "Binh", "Tran");
        jdbc.update("INSERT INTO \"campuscore_auth\".\"User\" (\"id\", \"email\", \"firstName\", \"lastName\")"
                        + " VALUES (?, ?, ?, ?)",
                ADMIN, "mx-enr-admin@campuscore.edu", "Admin", "User");
        jdbc.update("INSERT INTO \"campuscore_auth\".\"User\" (\"id\", \"email\", \"firstName\", \"lastName\")"
                        + " VALUES (?, ?, ?, ?)",
                LECTURER, "mx-enr-lect@campuscore.edu", "Lect", "Urer");

        insertStudent(STUDENT_A_ID, STUDENT_A, "MXA001");
        insertStudent(STUDENT_B_ID, STUDENT_B, "MXB002");
        // The JWT fixture reads the profile ids from campuscore_auth."Student"
        // / "Lecturer"; keeping them equal to the academic rows is what makes
        // the token claims match the rows these endpoints authorize against.
        AccountAuthorityFixture.student(jdbc, STUDENT_A, STUDENT_A_ID, 2);
        AccountAuthorityFixture.student(jdbc, STUDENT_B, STUDENT_B_ID, 2);
        AccountAuthorityFixture.lecturer(jdbc, LECTURER, "mx-enr-lecturer");

        jdbc.update("INSERT INTO \"academic\".\"Department\" (\"id\", \"facultyId\") VALUES (?, ?)",
                "mx-enr-department", "mx-enr-faculty");
        jdbc.update("INSERT INTO \"academic\".\"AcademicYear\" (\"id\", \"year\", \"startDate\", \"endDate\","
                        + " \"isCurrent\", \"createdAt\", \"updatedAt\") VALUES (?, ?, ?, ?, ?, ?, ?)",
                "mx-enr-year", 2026, timestamp(NOW.minusSeconds(86_400)),
                timestamp(NOW.plusSeconds(86_400)), true, timestamp(NOW), timestamp(NOW));
        jdbc.update("INSERT INTO \"academic\".\"Semester\" (\"id\", \"name\", \"nameEn\", \"nameVi\", \"type\","
                        + " \"academicYearId\", \"startDate\", \"endDate\", \"status\", \"createdAt\", \"updatedAt\")"
                        + " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                "mx-enr-semester", "HK1 2026", "Fall 2026", "HK1 2026", "REGULAR", "mx-enr-year",
                timestamp(NOW.minusSeconds(86_400)), timestamp(NOW.plusSeconds(86_400)), "ACTIVE",
                timestamp(NOW), timestamp(NOW));
        jdbc.update("INSERT INTO \"academic\".\"Course\" (\"id\", \"code\", \"name\", \"nameEn\", \"nameVi\","
                        + " \"credits\", \"departmentId\", \"isActive\", \"createdAt\", \"updatedAt\")"
                        + " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                "mx-enr-course", "MX101", "Matrix Course", "Matrix Course", "Matrix Course", 3,
                "mx-enr-department", true, timestamp(NOW), timestamp(NOW));
        jdbc.update("INSERT INTO \"academic\".\"Section\" (\"id\", \"sectionNumber\", \"courseId\", \"semesterId\","
                        + " \"capacity\", \"enrolledCount\", \"status\") VALUES (?, ?, ?, ?, ?, ?, ?)",
                "mx-enr-section", "01", "mx-enr-course", "mx-enr-semester", 40, 2, "OPEN");

        insertEnrollment("mx-enr-a", STUDENT_A_ID, "PUBLISHED", "B");
        insertEnrollment("mx-enr-b", STUDENT_B_ID, "PUBLISHED", "C");

        jdbc.update("INSERT INTO \"academic\".\"GradeItem\" (\"id\", \"sectionId\", \"name\", \"type\","
                        + " \"maxScore\", \"weight\", \"createdAt\") VALUES (?, ?, ?, ?, ?, ?, ?)",
                "mx-enr-item", "mx-enr-section", "Final exam", "FINAL", 100, 100, timestamp(NOW));
        jdbc.update("INSERT INTO \"academic\".\"StudentGrade\" (\"id\", \"gradeItemId\", \"enrollmentId\", \"score\")"
                        + " VALUES (?, ?, ?, ?)",
                "mx-enr-grade", "mx-enr-item", "mx-enr-a", 88.5);

        insertAttendance("mx-att-a", STUDENT_A_ID);
        insertAttendance("mx-att-b", STUDENT_B_ID);
    }

    private void insertStudent(String id, String userId, String studentNumber) {
        jdbc.update("INSERT INTO \"academic\".\"Student\" (\"id\", \"userId\", \"studentId\", \"curriculumId\","
                        + " \"year\", \"status\", \"admissionDate\", \"createdAt\", \"updatedAt\")"
                        + " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                id, userId, studentNumber, "mx-enr-curriculum", 2, "ACTIVE",
                timestamp(NOW.minusSeconds(31_536_000)), timestamp(NOW), timestamp(NOW));
    }

    private void insertEnrollment(String id, String studentId, String gradeStatus, String letterGrade) {
        jdbc.update("INSERT INTO \"academic\".\"Enrollment\" (\"id\", \"studentId\", \"sectionId\", \"semesterId\","
                        + " \"status\", \"enrolledAt\", \"gradeStatus\", \"letterGrade\", \"createdAt\", \"updatedAt\")"
                        + " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                id, studentId, "mx-enr-section", "mx-enr-semester", "ENROLLED", timestamp(NOW),
                gradeStatus, letterGrade, timestamp(NOW), timestamp(NOW));
    }

    private void insertAttendance(String id, String studentId) {
        jdbc.update("INSERT INTO \"academic\".\"Attendance\" (\"id\", \"studentId\", \"sectionId\", \"date\","
                        + " \"status\", \"notes\", \"createdAt\") VALUES (?, ?, ?, ?, ?, ?, ?)",
                id, studentId, "mx-enr-section", Timestamp.from(NOW), "PRESENT", null, timestamp(NOW));
    }

    private static Timestamp timestamp(Instant value) {
        return Timestamp.from(value);
    }

    private String enrollmentStatus(String id) {
        return jdbc.queryForObject(
                "SELECT \"status\" FROM \"academic\".\"Enrollment\" WHERE \"id\" = ?", String.class, id);
    }

    private RequestPostProcessor studentJwt(String subject) {
        return fixtureJwt(jdbc, subject, token -> token.subject(subject), "STUDENT")
                .authorities(new SimpleGrantedAuthority("ROLE_STUDENT"));
    }

    private RequestPostProcessor lecturerJwt() {
        return fixtureJwt(jdbc, LECTURER, token -> token.subject(LECTURER), "LECTURER")
                .authorities(new SimpleGrantedAuthority("ROLE_LECTURER"));
    }

    private RequestPostProcessor adminJwt() {
        return fixtureJwt(jdbc, ADMIN, token -> token
                        .subject(ADMIN)
                        .claim("roles", List.of("ADMIN")), "ADMIN")
                .authorities(new SimpleGrantedAuthority("ROLE_ADMIN"));
    }
}
