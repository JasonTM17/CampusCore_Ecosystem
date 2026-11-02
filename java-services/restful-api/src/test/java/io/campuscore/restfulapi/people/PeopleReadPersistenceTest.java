package io.campuscore.restfulapi.people;

import static io.campuscore.restfulapi.testsupport.CurrentAccountJwt.fixtureJwt;
import io.campuscore.restfulapi.testsupport.AccountAuthorityFixture;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.RequestPostProcessor;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles({"test", "persistence"})
@TestPropertySource(properties = {
        "spring.flyway.enabled=false",
        "spring.datasource.url=jdbc:h2:mem:people_read;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1"
})
class PeopleReadPersistenceTest {

    private static final Instant BASE_TIME = Instant.parse("2026-08-20T00:00:00Z");

    @Autowired
    private JdbcTemplate jdbc;

    @Autowired
    private MockMvc mvc;

    @BeforeEach
    void preparePeopleFixture() {
        jdbc.execute("CREATE SCHEMA IF NOT EXISTS \"campuscore_auth\"");
        jdbc.execute("CREATE SCHEMA IF NOT EXISTS \"academic\"");
        createTables();
        jdbc.update("DELETE FROM \"academic\".\"Student\"");
        jdbc.update("DELETE FROM \"academic\".\"Lecturer\"");
        jdbc.update("DELETE FROM \"academic\".\"Curriculum\"");
        jdbc.update("DELETE FROM \"academic\".\"Department\"");
        jdbc.update("DELETE FROM \"campuscore_auth\".\"User\"");
        insertDepartment("department-se", "SE", "Software Engineering", "fac-eng");
        insertDepartment("department-cs", "CS", "Computer Science", "fac-sci");
    }

    @Test
    void studentsUseCanonicalAuthAndAcademicIdentityWithStablePaging() throws Exception {
        insertStudent("student-old", "S001", "ACTIVE", 2, BASE_TIME.minusSeconds(60), "department-se");
        insertStudent("student-new", "S002", "INACTIVE", 3, BASE_TIME, "department-se");
        insertStudent("student-other", "S003", "ACTIVE", 4, BASE_TIME.plusSeconds(60), "department-cs");

        mvc.perform(get("/api/v1/students")
                        .queryParam("page", "1")
                        .queryParam("limit", "2")
                        .with(adminJwt()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.length()").value(2))
                .andExpect(jsonPath("$.data[0].id").value("student-other"))
                .andExpect(jsonPath("$.data[0].user.id").value("user-student-other"))
                .andExpect(jsonPath("$.data[0].curriculum.department.code").value("CS"))
                .andExpect(jsonPath("$.data[1].id").value("student-new"))
                .andExpect(jsonPath("$.data[1].curriculum.department.code").value("SE"))
                .andExpect(jsonPath("$.meta.total").value(3))
                .andExpect(jsonPath("$.meta.page").value(1))
                .andExpect(jsonPath("$.meta.limit").value(2))
                .andExpect(jsonPath("$.meta.totalPages").value(2));

        mvc.perform(get("/api/v1/students")
                        .queryParam("status", "ACTIVE")
                        .with(adminJwt()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.length()").value(2))
                .andExpect(jsonPath("$.data[0].id").value("student-other"))
                .andExpect(jsonPath("$.data[1].id").value("student-old"))
                .andExpect(jsonPath("$.meta.total").value(2));

        mvc.perform(get("/api/v1/students/student-old")
                        .with(studentJwt("user-student-old")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value("student-old"))
                .andExpect(jsonPath("$.studentId").value("S001"))
                .andExpect(jsonPath("$.curriculum.id").value("curriculum-student-old"))
                .andExpect(jsonPath("$.curriculum.department.name").value("Software Engineering"))
                .andExpect(jsonPath("$.admissionDate").value("2025-08-20T00:00:00.000Z"));

        mvc.perform(get("/api/v1/students/student-old")
                        .with(fixtureJwt(jdbc, "student-user", "STUDENT")))
                .andExpect(status().isNotFound());
    }

    @Test
    void lecturersUseCanonicalAuthAndAcademicIdentityWithStablePaging() throws Exception {
        insertLecturer("lecturer-old", "E001", BASE_TIME.minusSeconds(60));
        insertLecturer("lecturer-new", "E002", BASE_TIME);

        mvc.perform(get("/api/v1/lecturers")
                        .queryParam("page", "1")
                        .queryParam("limit", "1")
                        .with(adminJwt()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.length()").value(1))
                .andExpect(jsonPath("$.data[0].id").value("lecturer-new"))
                .andExpect(jsonPath("$.data[0].employeeId").value("E002"))
                .andExpect(jsonPath("$.data[0].user.email").value("lecturer-new@campuscore.edu"))
                .andExpect(jsonPath("$.data[0].department.name").value("Software Engineering"))
                .andExpect(jsonPath("$.meta.total").value(2))
                .andExpect(jsonPath("$.meta.totalPages").value(2));

        mvc.perform(get("/api/v1/lecturers/lecturer-old")
                        .with(adminJwt()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value("lecturer-old"))
                .andExpect(jsonPath("$.title").value("Dr."))
                .andExpect(jsonPath("$.specialization").value("Distributed Systems"))
                .andExpect(jsonPath("$.office").value("A-101"))
                .andExpect(jsonPath("$.phone").value("+84123456789"));
    }

    @Test
    void readBoundaryFailsClosedForAnonymousInvalidPagesUnexpectedQueryAndMissingRows() throws Exception {
        mvc.perform(get("/api/v1/students"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("UNAUTHENTICATED"));

        mvc.perform(get("/api/v1/students")
                        .queryParam("limit", "101")
                        .with(adminJwt()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_REQUEST"));

        mvc.perform(get("/api/v1/lecturers")
                        .queryParam("status", "ACTIVE")
                        .with(adminJwt()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_REQUEST"));

        mvc.perform(get("/api/v1/students")
                        .queryParam("page", "1", "2")
                        .with(adminJwt()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_REQUEST"));

        mvc.perform(get("/api/v1/lecturers/missing")
                        .with(adminJwt()))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("NOT_FOUND"));
    }

    @Test
    void studentDirectoryListsRejectRolesWithoutDirectoryAccessWhileSingleItemsStayOwnerScoped() throws Exception {
        insertStudent("student-old", "S001", "ACTIVE", 2, BASE_TIME.minusSeconds(60), "department-se");
        insertStudent("student-other", "S002", "ACTIVE", 2, BASE_TIME.minusSeconds(30), "department-se");
        insertLecturer("lecturer-old", "E001", BASE_TIME.minusSeconds(60));

        mvc.perform(get("/api/v1/students")
                        .with(fixtureJwt(jdbc, "student-user", "STUDENT")))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("ACCESS_DENIED"));

        mvc.perform(get("/api/v1/lecturers")
                        .with(fixtureJwt(jdbc, "student-user", "STUDENT")))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("ACCESS_DENIED"));

        mvc.perform(get("/api/v1/students/student-old")
                        .with(studentJwt("user-student-old")))
                .andExpect(status().isOk());

        mvc.perform(get("/api/v1/students/student-other")
                        .with(studentJwt("user-student-old")))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("NOT_FOUND"));

        mvc.perform(get("/api/v1/lecturers/lecturer-old")
                        .with(studentJwt("user-student-old")))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("ACCESS_DENIED"));

        mvc.perform(get("/api/v1/lecturers/lecturer-old")
                        .with(adminJwt()))
                .andExpect(status().isOk());
    }

    @Test
    void lecturerSearchRunsInDatabaseAndKeepsTheAllowListPerEndpoint() throws Exception {
        insertLecturer("lecturer-alpha", "E001", BASE_TIME.minusSeconds(60));
        insertLecturer("lecturer-beta", "GV_2026/002", BASE_TIME);

        // Employee code, first name and last name all reach the rows an operator
        // would type, wherever those rows sit in the page order.
        mvc.perform(get("/api/v1/lecturers")
                        .queryParam("search", "e001")
                        .with(adminJwt()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.length()").value(1))
                .andExpect(jsonPath("$.data[0].id").value("lecturer-alpha"))
                .andExpect(jsonPath("$.meta.total").value(1));

        mvc.perform(get("/api/v1/lecturers")
                        .queryParam("search", "beta")
                        .with(adminJwt()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data[0].id").value("lecturer-beta"))
                .andExpect(jsonPath("$.meta.total").value(1));

        mvc.perform(get("/api/v1/lecturers")
                        .queryParam("search", "LECTURER")
                        .with(adminJwt()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.length()").value(2))
                .andExpect(jsonPath("$.meta.total").value(2));

        // Full Vietnamese name searches spanning lastName + firstName (with or
        // without diacritics and academic honorifics) match the lecturer row.
        jdbc.update("UPDATE \"campuscore_auth\".\"User\" SET \"firstName\" = 'Khoa', \"lastName\" = 'ThS. Hoàng Thái Xuân'"
                + " WHERE \"id\" = 'user-lecturer-alpha'");
        mvc.perform(get("/api/v1/lecturers")
                        .queryParam("search", "Hoàng Thái Xuân Khoa")
                        .with(adminJwt()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.length()").value(1))
                .andExpect(jsonPath("$.data[0].id").value("lecturer-alpha"))
                .andExpect(jsonPath("$.meta.total").value(1));
        mvc.perform(get("/api/v1/lecturers")
                        .queryParam("search", "hoang thai xuan khoa")
                        .with(adminJwt()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.length()").value(1))
                .andExpect(jsonPath("$.data[0].id").value("lecturer-alpha"));

        // "_" and "%" stay literal: an unescaped "GV_2026" would also match a
        // hypothetical "GVX2026", and "%" alone would return the whole directory.
        mvc.perform(get("/api/v1/lecturers")
                        .queryParam("search", "%")
                        .with(adminJwt()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.length()").value(0))
                .andExpect(jsonPath("$.meta.total").value(0));

        mvc.perform(get("/api/v1/lecturers")
                        .queryParam("search", "GV_2026")
                        .with(adminJwt()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.length()").value(1))
                .andExpect(jsonPath("$.data[0].id").value("lecturer-beta"));

        mvc.perform(get("/api/v1/lecturers")
                        .queryParam("search", "E_01")
                        .with(adminJwt()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.length()").value(0));

        // A blank term is the same request as no term.
        mvc.perform(get("/api/v1/lecturers")
                        .queryParam("search", "  ")
                        .with(adminJwt()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.length()").value(2))
                .andExpect(jsonPath("$.meta.total").value(2));

        // Widening "lecturers" must not widen the sibling student route, and the
        // lecturer route still rejects everything outside its own allow-list.
        mvc.perform(get("/api/v1/students")
                        .queryParam("search", "S001")
                        .with(adminJwt()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_REQUEST"));

        mvc.perform(get("/api/v1/lecturers")
                        .queryParam("sortBy", "employeeId")
                        .with(adminJwt()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_REQUEST"));

        mvc.perform(get("/api/v1/lecturers")
                        .queryParam("search", "E001", "E002")
                        .with(adminJwt()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_REQUEST"));
    }

    @Test
    void studentStatusFilterRejectsUnknownEnumsInsteadOfReturningASilentEmptyPage() throws Exception {
        // Regression for the docs/data enum drift: the endpoint documentation
        // claimed ENROLLED/LEAVE/GRADUATED while the data only ever holds
        // ACTIVE, and an unknown token used to slip through as a filter and
        // return an always-empty 200. Unknown values are client errors now.
        insertStudent("student-active", "S010", "ACTIVE", 2, BASE_TIME, "department-se");

        for (String invalid : java.util.List.of("ENROLLED", "LEAVE", "GRADUATED", "NOT_A_STATUS")) {
            MvcResult rejected = mvc.perform(get("/api/v1/students")
                            .queryParam("status", invalid)
                            .with(adminJwt()))
                    .andExpect(status().isBadRequest())
                    .andReturn();
            assertThat(rejected.getResponse().getContentAsString())
                    .as("status=%s must be rejected with INVALID_REQUEST", invalid)
                    .contains("INVALID_REQUEST");
        }

        // The canonical enum stays functional; input case is normalized.
        mvc.perform(get("/api/v1/students")
                        .queryParam("status", "active")
                        .with(adminJwt()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.meta.total").value(1))
                .andExpect(jsonPath("$.data[0].id").value("student-active"))
                .andExpect(jsonPath("$.data[0].status").value("ACTIVE"));
    }

    private void createTables() {
        jdbc.execute("""
                CREATE TABLE IF NOT EXISTS "campuscore_auth"."User" (
                    "id" VARCHAR(120) PRIMARY KEY,
                    "email" VARCHAR(320) NOT NULL,
                    "firstName" VARCHAR(120) NOT NULL,
                    "lastName" VARCHAR(120) NOT NULL,
                    "status" VARCHAR(40) NOT NULL DEFAULT 'ACTIVE',
                    "mustChangePassword" BOOLEAN NOT NULL DEFAULT FALSE
                )
                """);
        jdbc.execute("""
                CREATE TABLE IF NOT EXISTS "academic"."Department" (
                    "id" VARCHAR(120) PRIMARY KEY,
                    "code" VARCHAR(40) NOT NULL,
                    "name" VARCHAR(200) NOT NULL,
                    "facultyId" VARCHAR(120)
                )
                """);
        jdbc.execute("""
                CREATE TABLE IF NOT EXISTS "campuscore_auth"."Lecturer" (
                    "id" VARCHAR(120) PRIMARY KEY,
                    "userId" VARCHAR(120) UNIQUE,
                    "isActive" BOOLEAN NOT NULL DEFAULT TRUE
                )
                """);
        jdbc.execute("""
                CREATE TABLE IF NOT EXISTS "academic"."Course" (
                    "id" VARCHAR(120) PRIMARY KEY,
                    "departmentId" VARCHAR(120) NOT NULL
                )
                """);
        jdbc.execute("""
                CREATE TABLE IF NOT EXISTS "academic"."Section" (
                    "id" VARCHAR(120) PRIMARY KEY,
                    "courseId" VARCHAR(120) NOT NULL,
                    "lecturerId" VARCHAR(120)
                )
                """);
        jdbc.execute("""
                CREATE TABLE IF NOT EXISTS "academic"."Enrollment" (
                    "id" VARCHAR(120) PRIMARY KEY,
                    "studentId" VARCHAR(120) NOT NULL,
                    "sectionId" VARCHAR(120) NOT NULL,
                    "status" VARCHAR(40) NOT NULL
                )
                """);
        jdbc.execute("""
                CREATE TABLE IF NOT EXISTS "academic"."Curriculum" (
                    "id" VARCHAR(120) PRIMARY KEY,
                    "code" VARCHAR(40) NOT NULL,
                    "name" VARCHAR(200) NOT NULL,
                    "departmentId" VARCHAR(120) NOT NULL
                )
                """);
        jdbc.execute("""
                CREATE TABLE IF NOT EXISTS "academic"."Student" (
                    "id" VARCHAR(120) PRIMARY KEY,
                    "userId" VARCHAR(120) UNIQUE NOT NULL,
                    "studentId" VARCHAR(120) UNIQUE NOT NULL,
                    "curriculumId" VARCHAR(120) NOT NULL,
                    "year" INTEGER NOT NULL,
                    "status" VARCHAR(40) NOT NULL,
                    "admissionDate" TIMESTAMP WITH TIME ZONE NOT NULL,
                    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL,
                    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL
                )
                """);
        jdbc.execute("""
                CREATE TABLE IF NOT EXISTS "academic"."Lecturer" (
                    "id" VARCHAR(120) PRIMARY KEY,
                    "userId" VARCHAR(120) UNIQUE NOT NULL,
                    "departmentId" VARCHAR(120) NOT NULL,
                    "employeeId" VARCHAR(120) UNIQUE NOT NULL,
                    "title" VARCHAR(120),
                    "specialization" VARCHAR(200),
                    "office" VARCHAR(120),
                    "phone" VARCHAR(80),
                    "isActive" BOOLEAN NOT NULL,
                    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL,
                    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL
                )
                """);
    }

    private void insertDepartment(String id, String code, String name, String facultyId) {
        jdbc.update("INSERT INTO \"academic\".\"Department\" (\"id\", \"code\", \"name\", \"facultyId\") VALUES (?, ?, ?, ?)",
                id, code, name, facultyId);
    }

    private void insertSectionScope(String sectionId, String courseId, String departmentId, String lecturerId) {
        jdbc.update("INSERT INTO \"academic\".\"Course\" (\"id\", \"departmentId\") VALUES (?, ?)", courseId, departmentId);
        jdbc.update("INSERT INTO \"academic\".\"Section\" (\"id\", \"courseId\", \"lecturerId\") VALUES (?, ?, ?)",
                sectionId, courseId, lecturerId);
    }

    private void enroll(String enrollmentId, String studentId, String sectionId) {
        jdbc.update("INSERT INTO \"academic\".\"Enrollment\" (\"id\", \"studentId\", \"sectionId\", \"status\") VALUES (?, ?, ?, ?)",
                enrollmentId, studentId, sectionId, "ENROLLED");
    }

    private void insertStudent(
            String id,
            String studentId,
            String status,
            int year,
            Instant createdAt,
            String departmentId) {
        String userId = "user-" + id;
        String curriculumId = "curriculum-" + id;
        insertUser(userId, id + "@campuscore.edu", "Student", id.substring(id.indexOf('-') + 1));
        jdbc.update(
                "INSERT INTO \"academic\".\"Curriculum\" (\"id\", \"code\", \"name\", \"departmentId\")"
                        + " VALUES (?, ?, ?, ?)",
                curriculumId, departmentCode(departmentId), "Curriculum " + studentId, departmentId);
        jdbc.update(
                "INSERT INTO \"academic\".\"Student\""
                        + " (\"id\", \"userId\", \"studentId\", \"curriculumId\", \"year\", \"status\","
                        + " \"admissionDate\", \"createdAt\", \"updatedAt\") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                id, userId, studentId, curriculumId, year, status,
                zonedDateTime(BASE_TIME.minusSeconds(31_536_000)),
                zonedDateTime(createdAt), zonedDateTime(createdAt));
    }

    private void insertLecturer(String id, String employeeId, Instant createdAt) {
        String userId = "user-" + id;
        insertUser(userId, id + "@campuscore.edu", "Lecturer", id.substring(id.indexOf('-') + 1));
        jdbc.update(
                "INSERT INTO \"academic\".\"Lecturer\""
                        + " (\"id\", \"userId\", \"departmentId\", \"employeeId\", \"title\","
                        + " \"specialization\", \"office\", \"phone\", \"isActive\", \"createdAt\", \"updatedAt\")"
                        + " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                id, userId, "department-se", employeeId, "Dr.", "Distributed Systems", "A-101",
                "+84123456789", true, zonedDateTime(createdAt), zonedDateTime(createdAt));
    }

    private void insertUser(String id, String email, String firstName, String lastName) {
        jdbc.update(
                "INSERT INTO \"campuscore_auth\".\"User\" (\"id\", \"email\", \"firstName\", \"lastName\")"
                        + " VALUES (?, ?, ?, ?)",
                id, email, firstName, lastName);
    }

    private RequestPostProcessor lecturerJwt() {
        return fixtureJwt(jdbc, "lecturer-user", token -> token
                        .subject("lecturer-user")
                        .claim("roles", java.util.List.of("LECTURER")), "LECTURER")
                .authorities(new SimpleGrantedAuthority("ROLE_LECTURER"));
    }

    private RequestPostProcessor adminJwt() {
        return fixtureJwt(jdbc, "admin-user", token -> token
                        .subject("admin-user")
                        .claim("roles", java.util.List.of("ADMIN")), "ADMIN")
                .authorities(new SimpleGrantedAuthority("ROLE_ADMIN"));
    }

    private RequestPostProcessor studentJwt(String subject) {
        return fixtureJwt(jdbc, subject, token -> token
                        .subject(subject)
                        .claim("roles", java.util.List.of("STUDENT")), "STUDENT")
                .authorities(new SimpleGrantedAuthority("ROLE_STUDENT"));
    }

    private static String departmentCode(String departmentId) {
        return departmentId.endsWith("cs") ? "CS" : "SE";
    }

    private static OffsetDateTime zonedDateTime(Instant value) {
        return OffsetDateTime.ofInstant(value, ZoneOffset.UTC);
    }
    @Test
    void lecturerDirectoryScopeIsLimitedToOwnSections() throws Exception {
        AccountAuthorityFixture.lecturer(jdbc, "user-lect-a", "lect-a");
        AccountAuthorityFixture.lecturer(jdbc, "user-lect-b", "lect-b");
        insertLecturer("lect-a", "E501", BASE_TIME);
        insertLecturer("lect-b", "E502", BASE_TIME);
        insertStudent("student-scoped", "S010", "ACTIVE", 1, BASE_TIME, "department-se");
        insertStudent("student-foreign", "S011", "ACTIVE", 2, BASE_TIME.plusSeconds(10), "department-se");
        insertSectionScope("section-a", "course-a", "department-se", "lect-a");
        insertSectionScope("section-b", "course-b", "department-cs", "lect-b");
        enroll("en-1", "student-scoped", "section-a");
        enroll("en-2", "student-foreign", "section-b");

        mvc.perform(get("/api/v1/students")
                        .queryParam("page", "1").queryParam("limit", "20")
                        .with(fixtureJwt(jdbc, "user-lect-a", "LECTURER")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.meta.total").value(1))
                .andExpect(jsonPath("$.data[0].id").value("student-scoped"));

        mvc.perform(get("/api/v1/students")
                        .with(fixtureJwt(jdbc, "user-lect-b", "LECTURER")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.meta.total").value(1))
                .andExpect(jsonPath("$.data[0].id").value("student-foreign"));

        mvc.perform(get("/api/v1/students/student-scoped")
                        .with(fixtureJwt(jdbc, "user-lect-b", "LECTURER")))
                .andExpect(status().isNotFound());
        mvc.perform(get("/api/v1/students/student-scoped")
                        .with(fixtureJwt(jdbc, "user-lect-a", "LECTURER")))
                .andExpect(status().isOk());
        mvc.perform(get("/api/v1/students/student-scoped")
                        .with(adminJwt()))
                .andExpect(status().isOk());
    }

    @Test
    void departmentHeadSeesStudentsOfDepartmentCourseSections() throws Exception {
        AccountAuthorityFixture.lecturer(jdbc, "user-lect-head", "lect-head");
        insertLecturer("lect-head", "E777", BASE_TIME);
        insertStudent("student-dept", "S020", "ACTIVE", 1, BASE_TIME, "department-cs");
        insertStudent("student-out", "S021", "ACTIVE", 2, BASE_TIME.plusSeconds(10), "department-cs");
        insertSectionScope("section-d1", "course-d1", "department-se", "lect-other");
        insertSectionScope("section-d2", "course-d2", "department-cs", "lect-other2");
        enroll("en-3", "student-dept", "section-d1");
        enroll("en-4", "student-out", "section-d2");

        mvc.perform(get("/api/v1/students")
                        .with(fixtureJwt(jdbc, "user-lect-head", "LECTURER", "TRUONG_BO_MON")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.meta.total").value(1))
                .andExpect(jsonPath("$.data[0].id").value("student-dept"));
    }

}
