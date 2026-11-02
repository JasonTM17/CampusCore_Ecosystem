package io.campuscore.restfulapi.security.matrix;

import static io.campuscore.restfulapi.testsupport.CurrentAccountJwt.fixtureJwt;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import io.campuscore.restfulapi.mail.service.EmailService;
import io.campuscore.restfulapi.mail.web.MailDtos.GradeAlertRequest;
import io.campuscore.restfulapi.testsupport.AccountAuthorityFixture;
import java.sql.Timestamp;
import java.time.Instant;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.RequestPostProcessor;

/**
 * Cross-section authorization matrix for lecturer academic mail.
 *
 * <p>The recipient is not trusted from the request body: a lecturer send
 * resolves the student through {@code MailRecipientScopeRepository}, so a
 * student outside the caller's sections is refused (403
 * MAIL_RECIPIENT_OUT_OF_SCOPE) and an in-scope recipient's address is rebuilt
 * from the database. Admins keep the unscoped lane. EmailService is mocked so
 * only the authorization boundary runs.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles({"test", "persistence"})
@TestPropertySource(properties = {
        "spring.flyway.enabled=false",
        "spring.datasource.url=jdbc:h2:mem:authz_mail;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1"
})
class MailRecipientAuthorizationMatrixTest {

    private static final String LECTURER_X = "mx-mail-lecturer-x-user";
    private static final String LECTURER_X_ID = "mx-mail-lecturer-x";
    private static final String LECTURER_Y = "mx-mail-lecturer-y-user";
    private static final String LECTURER_Y_ID = "mx-mail-lecturer-y";
    private static final String STUDENT_USER = "mx-mail-student-user";
    private static final String ADMIN = "mx-mail-admin";
    private static final Instant NOW = Instant.parse("2026-08-21T01:00:00Z");

    @Autowired
    private JdbcTemplate jdbc;

    @Autowired
    private MockMvc mvc;

    @MockitoBean
    private EmailService emailService;

    @BeforeEach
    void prepareMailFixture() {
        jdbc.execute("CREATE SCHEMA IF NOT EXISTS \"campuscore_auth\"");
        jdbc.execute("CREATE SCHEMA IF NOT EXISTS \"academic\"");
        createTables();
        AccountAuthorityFixture.ensureSchema(jdbc);
        clearTables();
        insertFixture();
    }

    @Test
    void lecturer_mails_a_student_in_their_own_section() throws Exception {
        // The body asks for an attacker address; the scope rewrites `to` to the
        // enrolled student's database address before EmailService is called.
        mvc.perform(post("/api/v1/mail/grade-alert")
                        .with(lecturerJwt(LECTURER_X))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(gradeAlertBody("SV-X1", "attacker@evil.example")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.recipient").value("mx-mail-x1@campuscore.edu"));

        ArgumentCaptor<GradeAlertRequest> sent = ArgumentCaptor.forClass(GradeAlertRequest.class);
        verify(emailService).sendGradeAlert(sent.capture());
        org.assertj.core.api.Assertions.assertThat(sent.getValue().to())
                .isEqualTo("mx-mail-x1@campuscore.edu")
                .isNotEqualTo("attacker@evil.example");
    }

    @Test
    void lecturer_cannot_mail_a_student_in_another_lecturers_section() throws Exception {
        mvc.perform(post("/api/v1/mail/grade-alert")
                        .with(lecturerJwt(LECTURER_X))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(gradeAlertBody("SV-Y1", null)))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("MAIL_RECIPIENT_OUT_OF_SCOPE"));

        mvc.perform(post("/api/v1/mail/grade-alert")
                        .with(lecturerJwt(LECTURER_X))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(gradeAlertBody("SV-MISSING", null)))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("MAIL_RECIPIENT_OUT_OF_SCOPE"));

        verify(emailService, never()).sendGradeAlert(any());
    }

    @Test
    void student_cannot_send_academic_mail() throws Exception {
        mvc.perform(post("/api/v1/mail/grade-alert")
                        .with(studentJwt())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(gradeAlertBody("SV-X1", null)))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("ACCESS_DENIED"));

        verify(emailService, never()).sendGradeAlert(any());
    }

    @Test
    void admin_mails_any_student_without_section_scope() throws Exception {
        mvc.perform(post("/api/v1/mail/grade-alert")
                        .with(adminJwt())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(gradeAlertBody("SV-Y1", "admin-target@campuscore.edu")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.recipient").value("admin-target@campuscore.edu"));

        verify(emailService).sendGradeAlert(any());
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
                CREATE TABLE IF NOT EXISTS "academic"."Section" (
                    "id" VARCHAR(120) PRIMARY KEY,
                    "lecturerId" VARCHAR(120)
                )
                """);
        jdbc.execute("""
                CREATE TABLE IF NOT EXISTS "academic"."Enrollment" (
                    "id" VARCHAR(120) PRIMARY KEY,
                    "studentId" VARCHAR(120) NOT NULL,
                    "sectionId" VARCHAR(120) NOT NULL,
                    "status" VARCHAR(40) NOT NULL,
                    "enrolledAt" TIMESTAMP NOT NULL
                )
                """);
    }

    private void clearTables() {
        jdbc.update("DELETE FROM \"academic\".\"Enrollment\"");
        jdbc.update("DELETE FROM \"academic\".\"Section\"");
        jdbc.update("DELETE FROM \"academic\".\"Student\"");
        jdbc.update("DELETE FROM \"campuscore_auth\".\"User\"");
    }

    private void insertFixture() {
        AccountAuthorityFixture.ensureUser(jdbc, LECTURER_X);
        AccountAuthorityFixture.ensureUser(jdbc, LECTURER_Y);
        AccountAuthorityFixture.ensureUser(jdbc, STUDENT_USER);
        AccountAuthorityFixture.ensureUser(jdbc, ADMIN);
        AccountAuthorityFixture.lecturer(jdbc, LECTURER_X, LECTURER_X_ID);
        AccountAuthorityFixture.lecturer(jdbc, LECTURER_Y, LECTURER_Y_ID);
        AccountAuthorityFixture.replaceRoles(jdbc, ADMIN, "ADMIN");
        AccountAuthorityFixture.replaceRoles(jdbc, STUDENT_USER, "STUDENT");

        insertUser(STUDENT_USER_IN_X, "mx-mail-x1@campuscore.edu", "Xuan", "One");
        insertUser(STUDENT_USER_IN_Y, "mx-mail-y1@campuscore.edu", "Yen", "Two");
        insertStudent("mx-mail-student-x1", STUDENT_USER_IN_X, "SV-X1");
        insertStudent("mx-mail-student-y1", STUDENT_USER_IN_Y, "SV-Y1");
        jdbc.update("INSERT INTO \"academic\".\"Section\" (\"id\", \"lecturerId\") VALUES (?, ?)",
                "mx-mail-section-x", LECTURER_X_ID);
        jdbc.update("INSERT INTO \"academic\".\"Section\" (\"id\", \"lecturerId\") VALUES (?, ?)",
                "mx-mail-section-y", LECTURER_Y_ID);
        insertEnrollment("mx-mail-enr-x", "mx-mail-student-x1", "mx-mail-section-x", "ENROLLED");
        insertEnrollment("mx-mail-enr-y", "mx-mail-student-y1", "mx-mail-section-y", "ENROLLED");
    }

    private static final String STUDENT_USER_IN_X = "mx-mail-student-x1-user";
    private static final String STUDENT_USER_IN_Y = "mx-mail-student-y1-user";

    private void insertUser(String id, String email, String firstName, String lastName) {
        jdbc.update("INSERT INTO \"campuscore_auth\".\"User\" (\"id\", \"email\", \"firstName\", \"lastName\")"
                        + " VALUES (?, ?, ?, ?)",
                id, email, firstName, lastName);
    }

    private void insertStudent(String id, String userId, String studentNumber) {
        jdbc.update("INSERT INTO \"academic\".\"Student\" (\"id\", \"userId\", \"studentId\", \"curriculumId\","
                        + " \"year\", \"status\", \"admissionDate\", \"createdAt\", \"updatedAt\")"
                        + " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                id, userId, studentNumber, "mx-mail-curriculum", 2, "ACTIVE",
                Timestamp.from(NOW.minusSeconds(31_536_000)), Timestamp.from(NOW), Timestamp.from(NOW));
    }

    private void insertEnrollment(String id, String studentId, String sectionId, String status) {
        jdbc.update("INSERT INTO \"academic\".\"Enrollment\" (\"id\", \"studentId\", \"sectionId\", \"status\","
                        + " \"enrolledAt\") VALUES (?, ?, ?, ?, ?)",
                id, studentId, sectionId, status, Timestamp.from(NOW));
    }

    private static String gradeAlertBody(String studentId, String to) {
        String recipient = to == null ? "ignored@campuscore.edu" : to;
        return """
                {"to":"%s","studentName":"Matrix Student","studentId":"%s",
                 "semester":"HK1 2026","gpa4":3.5,"gpa10":8.0,"academicStanding":"GOOD",
                 "conductScore":85,"conductRank":"GOOD","grades":[]}
                """.formatted(recipient, studentId);
    }

    private RequestPostProcessor lecturerJwt(String subject) {
        return fixtureJwt(jdbc, subject, token -> token.subject(subject), "LECTURER")
                .authorities(new SimpleGrantedAuthority("ROLE_LECTURER"));
    }

    private RequestPostProcessor studentJwt() {
        return fixtureJwt(jdbc, STUDENT_USER, token -> token.subject(STUDENT_USER), "STUDENT")
                .authorities(new SimpleGrantedAuthority("ROLE_STUDENT"));
    }

    private RequestPostProcessor adminJwt() {
        return fixtureJwt(jdbc, ADMIN, token -> token.subject(ADMIN), "ADMIN")
                .authorities(new SimpleGrantedAuthority("ROLE_ADMIN"));
    }
}
