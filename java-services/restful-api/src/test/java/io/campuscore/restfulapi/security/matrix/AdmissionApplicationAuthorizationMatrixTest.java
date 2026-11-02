package io.campuscore.restfulapi.security.matrix;

import static io.campuscore.restfulapi.testsupport.CurrentAccountJwt.fixtureJwt;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import io.campuscore.restfulapi.testsupport.AccountAuthorityFixture;
import java.sql.Connection;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.core.io.ClassPathResource;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.init.ScriptUtils;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.RequestPostProcessor;
import tools.jackson.databind.ObjectMapper;

/**
 * Cross-applicant authorization matrix for the self-service admissions lane.
 *
 * <p>Every id-taking applicant route resolves the row with
 * {@code WHERE id = :id AND applicantUserId = :owner}, so a foreign id is an
 * indistinguishable 404 APPLICATION_NOT_FOUND (never 403, never a body). The
 * staff lane is a separate grant-gated surface and is asserted here only as the
 * role boundary a plain applicant/student must not cross.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles({"test", "persistence"})
@TestPropertySource(properties = {
        "spring.flyway.enabled=false",
        "spring.datasource.url=jdbc:h2:mem:authz_admissions;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1"
})
class AdmissionApplicationAuthorizationMatrixTest {

    private static final String APPLICANT_A = "mx-adm-applicant-a";
    private static final String APPLICANT_B = "mx-adm-applicant-b";
    private static final String ADMIN = "mx-adm-admin";
    private static final String STUDENT = "mx-adm-student";
    private static final String CYCLE = "2026-AUTHZ-MATRIX";

    @Autowired
    private JdbcTemplate jdbc;

    @Autowired
    private MockMvc mvc;

    @Autowired
    private ObjectMapper objectMapper;

    private RequestPostProcessor applicantA;
    private RequestPostProcessor applicantB;
    private RequestPostProcessor adminJwt;
    private RequestPostProcessor studentJwt;

    @BeforeEach
    void prepareAdmissionsFixture() throws Exception {
        jdbc.execute("CREATE SCHEMA IF NOT EXISTS campuscore_auth");
        jdbc.execute("CREATE SCHEMA IF NOT EXISTS notifications");
        jdbc.execute("DROP SCHEMA IF EXISTS admissions CASCADE");
        jdbc.execute("""
                CREATE TABLE IF NOT EXISTS notifications.notification (
                    id VARCHAR(120) PRIMARY KEY,
                    user_id VARCHAR(120) NOT NULL,
                    title VARCHAR(240) NOT NULL,
                    message VARCHAR(2000) NOT NULL,
                    type VARCHAR(60) NOT NULL,
                    link VARCHAR(500),
                    is_read BOOLEAN NOT NULL DEFAULT FALSE,
                    read_at TIMESTAMP WITH TIME ZONE,
                    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
                )""");
        try (Connection connection = jdbc.getDataSource().getConnection()) {
            ScriptUtils.executeSqlScript(connection,
                    new ClassPathResource("db/migration-h2/V140__admissions_schema.sql"));
        }
        applicantA = fixtureJwt(jdbc, APPLICANT_A);
        applicantB = fixtureJwt(jdbc, APPLICANT_B);
        adminJwt = fixtureJwt(jdbc, ADMIN, "ADMIN");
        studentJwt = fixtureJwt(jdbc, STUDENT, "STUDENT");
        jdbc.update("DELETE FROM admissions.\"StaffGrant\"");
        AccountAuthorityFixture.replaceRoles(jdbc, APPLICANT_A);
        AccountAuthorityFixture.replaceRoles(jdbc, APPLICANT_B);
    }

    @Test
    void applicant_reads_saves_and_submits_own_application() throws Exception {
        String id = createApplication(applicantA, "mx-adm-create-own");

        mvc.perform(get("/api/v1/admissions/applications/" + id).with(applicantA))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(id))
                .andExpect(jsonPath("$.applicantUserId").value(APPLICANT_A));

        mvc.perform(put("/api/v1/admissions/applications/" + id)
                        .with(applicantA)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(saveBody(1)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.fullName").value("Matrix Applicant"));

        mvc.perform(post("/api/v1/admissions/applications/" + id + "/submit")
                        .with(applicantA)
                        .header("Idempotency-Key", "mx-adm-submit-own")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"expectedVersion\":2}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("SUBMITTED"));

        mvc.perform(get("/api/v1/admissions/applications/my").with(applicantA))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].id").value(id));
    }

    @Test
    void applicant_cannot_read_another_applicants_application() throws Exception {
        String id = createApplication(applicantA, "mx-adm-create-read");

        mvc.perform(get("/api/v1/admissions/applications/" + id).with(applicantB))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("APPLICATION_NOT_FOUND"));

        mvc.perform(get("/api/v1/admissions/applications/my").with(applicantB))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(0));
    }

    @Test
    void applicant_cannot_save_another_applicants_application() throws Exception {
        String id = createApplication(applicantA, "mx-adm-create-save");

        mvc.perform(put("/api/v1/admissions/applications/" + id)
                        .with(applicantB)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(saveBody(1)))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("APPLICATION_NOT_FOUND"));

        assertThat(applicationField(id, "fullName")).isNull();
    }

    @Test
    void applicant_cannot_submit_or_withdraw_another_applicants_application() throws Exception {
        String id = createApplication(applicantA, "mx-adm-create-lifecycle");

        mvc.perform(post("/api/v1/admissions/applications/" + id + "/submit")
                        .with(applicantB)
                        .header("Idempotency-Key", "mx-adm-submit-foreign")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"expectedVersion\":1}"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("APPLICATION_NOT_FOUND"));

        mvc.perform(post("/api/v1/admissions/applications/" + id + "/withdraw")
                        .with(applicantB)
                        .header("Idempotency-Key", "mx-adm-withdraw-foreign")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"expectedVersion\":1}"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("APPLICATION_NOT_FOUND"));

        assertThat(applicationField(id, "status")).isEqualTo("DRAFT");
    }

    @Test
    void applicant_cannot_attach_to_another_applicants_application() throws Exception {
        String id = createApplication(applicantA, "mx-adm-create-attach");

        mvc.perform(post("/api/v1/admissions/applications/" + id + "/attachments")
                        .with(applicantB)
                        .header("Idempotency-Key", "mx-adm-attach-foreign")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(attachmentBody()))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("APPLICATION_NOT_FOUND"));

        assertThat(attachmentCount(id)).isZero();

        // The owner can attach, and the foreign applicant still cannot read
        // the stored file or delete it.
        mvc.perform(post("/api/v1/admissions/applications/" + id + "/attachments")
                        .with(applicantA)
                        .header("Idempotency-Key", "mx-adm-attach-own")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(attachmentBody()))
                .andExpect(status().isCreated());
        assertThat(attachmentCount(id)).isEqualTo(1);
        String attachmentId = jdbc.queryForObject(
                "SELECT \"id\" FROM admissions.\"Attachment\" WHERE \"applicationId\" = ?",
                String.class, id);

        mvc.perform(get("/api/v1/admissions/applications/" + id + "/attachments/" + attachmentId + "/file")
                        .with(applicantB))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("APPLICATION_NOT_FOUND"));

        mvc.perform(delete("/api/v1/admissions/applications/" + id + "/attachments/" + attachmentId)
                        .with(applicantB)
                        .header("Idempotency-Key", "mx-adm-delete-foreign"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("APPLICATION_NOT_FOUND"));

        assertThat(attachmentCount(id)).isEqualTo(1);
    }

    @Test
    void student_cannot_read_the_admissions_staff_queue() throws Exception {
        mvc.perform(get("/api/v1/admissions/staff/queue").with(studentJwt))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("ADMISSIONS_STAFF_REQUIRED"));
    }

    @Test
    void admin_cannot_read_another_applicants_application() throws Exception {
        String id = createApplication(applicantA, "mx-adm-create-admin");

        // Admin authority lives on the staff lane; the applicant lane stays
        // owner-scoped for every caller, admin included.
        mvc.perform(get("/api/v1/admissions/applications/" + id).with(adminJwt))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("APPLICATION_NOT_FOUND"));
    }

    private String createApplication(RequestPostProcessor jwt, String key) throws Exception {
        MvcResult created = mvc.perform(post("/api/v1/admissions/applications")
                        .with(jwt)
                        .header("Idempotency-Key", key)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"cycle\":\"" + CYCLE + "\"}"))
                .andExpect(status().isCreated())
                .andReturn();
        return objectMapper.readTree(created.getResponse().getContentAsString()).get("id").asText();
    }

    private static String saveBody(int expectedVersion) {
        return """
                {"fullName":"Matrix Applicant","dateOfBirth":"2004-05-06",
                 "schoolName":"UTE High School","intendedMajor":"Software Engineering",
                 "essay":"Authorization matrix fixture","expectedVersion":%d}
                """.formatted(expectedVersion);
    }

    private static String attachmentBody() {
        return "{\"fileName\":\"cv.txt\",\"contentType\":\"text/plain\",\"dataBase64\":\"aGVsbG8=\"}";
    }

    private String applicationField(String id, String column) {
        return jdbc.queryForObject(
                "SELECT \"" + column + "\" FROM admissions.\"Application\" WHERE \"id\" = ?",
                String.class, id);
    }

    private int attachmentCount(String applicationId) {
        Integer count = jdbc.queryForObject(
                "SELECT COUNT(*) FROM admissions.\"Attachment\" WHERE \"applicationId\" = ?",
                Integer.class, applicationId);
        return count == null ? 0 : count;
    }
}
