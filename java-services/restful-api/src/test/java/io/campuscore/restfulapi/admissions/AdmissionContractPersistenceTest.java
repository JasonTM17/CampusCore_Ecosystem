package io.campuscore.restfulapi.admissions;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import io.campuscore.restfulapi.testsupport.CurrentAccountJwt;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
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
 * H2 contract test for the P10 simulated admissions domain (contract §7).
 * Proves the application state machine (ADM-T01), indistinguishable
 * applicant isolation (ADM-T02), append-only review/checklist history
 * (ADM-T03), one-active-application-per-cycle (ADM-T04), the SIMULATED
 * decision label (ADM-T05), optimistic version conflicts, terminal
 * immutability, scoped STAFF:admissions grants, idempotent replays, and
 * checksum-bound attachments with orphan-free cleanup on the real
 * controllers + service + H2 mirror DDL.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles({"test", "persistence"})
@TestPropertySource(properties = {
        "spring.flyway.enabled=false",
        "spring.datasource.url=jdbc:h2:mem:admissions_contract;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1"
})
class AdmissionContractPersistenceTest {

    private static final String CYCLE = "2026-Q1-DEMO";

    @Autowired
    private JdbcTemplate jdbc;

    @Autowired
    private MockMvc mvc;

    @Autowired
    private ObjectMapper objectMapper;

    private RequestPostProcessor applicantJwt;
    private RequestPostProcessor applicant2Jwt;
    private RequestPostProcessor staffJwt;
    private RequestPostProcessor staff2Jwt;
    private RequestPostProcessor adminJwt;
    private RequestPostProcessor outsiderJwt;

    @BeforeEach
    void fixture() throws Exception {
        jdbc.execute("CREATE SCHEMA IF NOT EXISTS campuscore_auth");
        jdbc.execute("CREATE SCHEMA IF NOT EXISTS notifications");
        jdbc.execute("DROP SCHEMA IF EXISTS admissions CASCADE");
        jdbc.execute("DROP TABLE IF EXISTS notifications.notification");
        jdbc.execute("CREATE SCHEMA IF NOT EXISTS admissions");
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
        try (java.sql.Connection connection = jdbc.getDataSource().getConnection()) {
            ScriptUtils.executeSqlScript(connection,
                    new ClassPathResource("db/migration-h2/V140__admissions_schema.sql"));
        }

        applicantJwt = CurrentAccountJwt.fixtureJwt(jdbc, "applicant-1", "STUDENT");
        applicant2Jwt = CurrentAccountJwt.fixtureJwt(jdbc, "applicant-2", "STUDENT");
        staffJwt = CurrentAccountJwt.fixtureJwt(jdbc, "staff-1", "STUDENT");
        staff2Jwt = CurrentAccountJwt.fixtureJwt(jdbc, "staff-2", "STUDENT");
        adminJwt = CurrentAccountJwt.fixtureJwt(jdbc, "admin-user", "ADMIN");
        outsiderJwt = CurrentAccountJwt.fixtureJwt(jdbc, "student-9", "STUDENT");

        // Staff grants are authority assignments — seeded per-test like the
        // events fixture (grant/revoke API itself is covered below).
        jdbc.update("DELETE FROM admissions.\"StaffGrant\"");
        jdbc.update("INSERT INTO admissions.\"StaffGrant\" (\"id\", \"userId\", \"scope\", \"grantedBy\")"
                + " VALUES ('g-1', 'staff-1', 'admissions', 'admin-user')");
        jdbc.update("INSERT INTO admissions.\"StaffGrant\" (\"id\", \"userId\", \"scope\", \"grantedBy\")"
                + " VALUES ('g-2', 'staff-2', 'admissions', 'admin-user')");
    }

    // ---------------------------------------------------------------
    // helpers
    // ---------------------------------------------------------------

    private String createDraft(RequestPostProcessor applicant, String key) throws Exception {
        MvcResult result = mvc.perform(post("/api/v1/admissions/applications")
                        .with(applicant).header("Idempotency-Key", key)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"cycle\":\"" + CYCLE + "\"}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.status").value("DRAFT"))
                .andExpect(jsonPath("$.applicantUserId").isNotEmpty())
                .andReturn();
        return objectMapper.readTree(result.getResponse().getContentAsString()).get("id").asText();
    }

    private void saveForm(String id, RequestPostProcessor applicant, int version) throws Exception {
        mvc.perform(put("/api/v1/admissions/applications/" + id)
                        .with(applicant).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"fullName\":\"Nguyen Van A\",\"dateOfBirth\":\"2008-01-15\","
                                + "\"schoolName\":\"THPT Demo\",\"intendedMajor\":\"CNTT\","
                                + "\"essay\":\"synthetic essay\",\"expectedVersion\":" + version + "}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.version").value(version + 1));
    }

    private String submitted(String key, RequestPostProcessor applicant) throws Exception {
        String id = createDraft(applicant, key + "-create");
        saveForm(id, applicant, 1);
        mvc.perform(post("/api/v1/admissions/applications/" + id + "/submit")
                        .with(applicant).header("Idempotency-Key", key + "-submit")
                        .contentType(MediaType.APPLICATION_JSON).content("{\"expectedVersion\":2}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("SUBMITTED"));
        return id;
    }

    private void claim(String id, RequestPostProcessor staff, int version) throws Exception {
        mvc.perform(post("/api/v1/admissions/staff/applications/" + id + "/claim")
                        .with(staff).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"expectedVersion\":" + version + "}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("IN_REVIEW"))
                .andExpect(jsonPath("$.version").value(version + 1));
    }

    private static String b64(String text) {
        return java.util.Base64.getEncoder().encodeToString(text.getBytes(StandardCharsets.UTF_8));
    }

    // ---------------------------------------------------------------
    // ADM-T01 — full state machine + terminal immutability + SIMULATED label
    // ---------------------------------------------------------------

    @Test
    void fullLifecycleSubmitReturnResubmitAccept() throws Exception {
        String id = createDraft(applicantJwt, "lc-create");

        // Draft is editable; submit requires the form fields.
        mvc.perform(post("/api/v1/admissions/applications/" + id + "/submit")
                        .with(applicantJwt).header("Idempotency-Key", "lc-submit-early")
                        .contentType(MediaType.APPLICATION_JSON).content("{\"expectedVersion\":1}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("APPLICATION_INCOMPLETE"));

        saveForm(id, applicantJwt, 1);
        mvc.perform(post("/api/v1/admissions/applications/" + id + "/submit")
                        .with(applicantJwt).header("Idempotency-Key", "lc-submit")
                        .contentType(MediaType.APPLICATION_JSON).content("{\"expectedVersion\":2}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("SUBMITTED"))
                .andExpect(jsonPath("$.submittedAt").isNotEmpty());

        // Owner edits freeze while under review.
        mvc.perform(put("/api/v1/admissions/applications/" + id)
                        .with(applicantJwt).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"fullName\":\"X\",\"expectedVersion\":3}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("APPLICATION_STATE_INVALID"));

        claim(id, staffJwt, 3);

        // ADM-T03: a return without checklist or note is rejected outright —
        // an empty review row is not a valid return.
        mvc.perform(post("/api/v1/admissions/staff/applications/" + id + "/return")
                        .with(staffJwt).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"expectedVersion\":4}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("RETURN_REASON_REQUIRED"));

        // RETURN carries a checklist + reason; both are preserved.
        mvc.perform(post("/api/v1/admissions/staff/applications/" + id + "/return")
                        .with(staffJwt).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"checklist\":[{\"item\":\"Bang diem\",\"result\":\"FAIL\",\"note\":\"thieu\"}],"
                                + "\"note\":\"Bo sung bang diem\",\"expectedVersion\":4}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("RETURNED"))
                .andExpect(jsonPath("$.reviews.length()").value(2))
                .andExpect(jsonPath("$.reviews[1].action").value("RETURN"));

        // RETURNED reopens owner edits; resubmit goes straight back.
        saveForm(id, applicantJwt, 5);
        mvc.perform(post("/api/v1/admissions/applications/" + id + "/submit")
                        .with(applicantJwt).header("Idempotency-Key", "lc-resubmit")
                        .contentType(MediaType.APPLICATION_JSON).content("{\"expectedVersion\":6}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("SUBMITTED"));

        claim(id, staffJwt, 7);
        mvc.perform(post("/api/v1/admissions/staff/applications/" + id + "/decision")
                        .with(staffJwt).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"decision\":\"ACCEPTED\",\"note\":\"dat yeu cau\","
                                + "\"expectedVersion\":8}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("ACCEPTED"))
                .andExpect(jsonPath("$.decision").value("ACCEPTED"))
                .andExpect(jsonPath("$.decisionLabel").value("SIMULATED"))
                .andExpect(jsonPath("$.decisionAt").isNotEmpty());

        // Terminal: every owner/staff mutation now conflicts.
        mvc.perform(put("/api/v1/admissions/applications/" + id)
                        .with(applicantJwt).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"fullName\":\"X\",\"expectedVersion\":9}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("APPLICATION_TERMINAL"));
        mvc.perform(post("/api/v1/admissions/applications/" + id + "/withdraw")
                        .with(applicantJwt).header("Idempotency-Key", "lc-wd")
                        .contentType(MediaType.APPLICATION_JSON).content("{\"expectedVersion\":9}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("APPLICATION_TERMINAL"));
        mvc.perform(post("/api/v1/admissions/staff/applications/" + id + "/decision")
                        .with(staffJwt).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"decision\":\"REJECTED\",\"expectedVersion\":9}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("APPLICATION_TERMINAL"));

        // Review history survived the terminal transition (ADM-T03).
        mvc.perform(get("/api/v1/admissions/applications/" + id).with(applicantJwt))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.reviews.length()").value(4))
                .andExpect(jsonPath("$.reviews[3].action").value("DECISION"))
                .andExpect(jsonPath("$.reviews[3].decision").value("ACCEPTED"));

        // Return + decision notified the applicant (auth user id) same-tx.
        Integer notices = jdbc.queryForObject(
                "SELECT COUNT(*) FROM notifications.notification WHERE user_id = 'applicant-1'",
                Integer.class);
        assertThat(notices).isEqualTo(2);
    }

    @Test
    void rejectDecisionIsAlsoTerminalAndSimulated() throws Exception {
        String id = submitted("rej", applicantJwt);
        claim(id, staffJwt, 3);
        mvc.perform(post("/api/v1/admissions/staff/applications/" + id + "/decision")
                        .with(staffJwt).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"decision\":\"REJECTED\",\"note\":\"khong dat\","
                                + "\"expectedVersion\":4}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("REJECTED"))
                .andExpect(jsonPath("$.decisionLabel").value("SIMULATED"));
        mvc.perform(post("/api/v1/admissions/applications/" + id + "/submit")
                        .with(applicantJwt).header("Idempotency-Key", "rej-again")
                        .contentType(MediaType.APPLICATION_JSON).content("{\"expectedVersion\":5}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("APPLICATION_TERMINAL"));
    }

    // ---------------------------------------------------------------
    // ADM-T02 — applicant isolation is indistinguishable 404
    // ---------------------------------------------------------------

    @Test
    void applicantIsolationIsIndistinguishable() throws Exception {
        String id = createDraft(applicantJwt, "iso-create");

        for (String path : new String[]{
                "/api/v1/admissions/applications/" + id}) {
            mvc.perform(get(path).with(applicant2Jwt))
                    .andExpect(status().isNotFound())
                    .andExpect(jsonPath("$.code").value("APPLICATION_NOT_FOUND"));
        }
        // Mutations on a foreign id get the same 404 — no existence oracle.
        mvc.perform(put("/api/v1/admissions/applications/" + id)
                        .with(applicant2Jwt).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"fullName\":\"Hax\",\"expectedVersion\":1}"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("APPLICATION_NOT_FOUND"));
        mvc.perform(post("/api/v1/admissions/applications/" + id + "/withdraw")
                        .with(applicant2Jwt).header("Idempotency-Key", "iso-wd")
                        .contentType(MediaType.APPLICATION_JSON).content("{\"expectedVersion\":1}"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("APPLICATION_NOT_FOUND"));

        // Foreign attachment reads are also 404 (file never reaches B).
        mvc.perform(post("/api/v1/admissions/applications/" + id + "/attachments")
                        .with(applicantJwt).header("Idempotency-Key", "iso-att")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"fileName\":\"score.pdf\",\"contentType\":\"application/pdf\","
                                + "\"dataBase64\":\"" + b64("synthetic-score") + "\"}"))
                .andExpect(status().isCreated());
        String attachmentId = jdbc.queryForObject(
                "SELECT \"id\" FROM admissions.\"Attachment\" WHERE \"applicationId\" = ?",
                String.class, id);
        mvc.perform(get("/api/v1/admissions/applications/" + id
                        + "/attachments/" + attachmentId + "/file").with(applicant2Jwt))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("APPLICATION_NOT_FOUND"));

        // My list shows only my own applications.
        mvc.perform(get("/api/v1/admissions/applications/my").with(applicant2Jwt))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[?(@.id=='" + id + "')]").isEmpty());
    }

    // ---------------------------------------------------------------
    // ADM-T04 — one active application per (applicant, cycle)
    // ---------------------------------------------------------------

    @Test
    void oneActiveApplicationPerCycle() throws Exception {
        createDraft(applicantJwt, "cyc-create");
        mvc.perform(post("/api/v1/admissions/applications")
                        .with(applicantJwt).header("Idempotency-Key", "cyc-dup")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"cycle\":\"" + CYCLE + "\"}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("APPLICATION_CYCLE_ACTIVE"));

        // A second applicant may hold a draft in the same cycle.
        createDraft(applicant2Jwt, "cyc-other");

        // Withdraw frees the slot — the owner may apply again in that cycle.
        String id = jdbc.queryForObject(
                "SELECT \"id\" FROM admissions.\"Application\""
                        + " WHERE \"applicantUserId\" = 'applicant-1'",
                String.class);
        mvc.perform(post("/api/v1/admissions/applications/" + id + "/withdraw")
                        .with(applicantJwt).header("Idempotency-Key", "cyc-wd")
                        .contentType(MediaType.APPLICATION_JSON).content("{\"expectedVersion\":1}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("WITHDRAWN"));
        createDraft(applicantJwt, "cyc-create-2");
    }

    // ---------------------------------------------------------------
    // Scoped staff authority (§1.1 — role alone never implies domain right)
    // ---------------------------------------------------------------

    @Test
    void staffGrantIsTheAuthority() throws Exception {
        String id = submitted("auth", applicantJwt);

        // Authenticated non-grantee: 403 on every staff lane.
        mvc.perform(get("/api/v1/admissions/staff/queue").with(outsiderJwt))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("ADMISSIONS_STAFF_REQUIRED"));
        mvc.perform(post("/api/v1/admissions/staff/applications/" + id + "/claim")
                        .with(outsiderJwt).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"expectedVersion\":3}"))
                .andExpect(status().isForbidden());

        // ADMIN role alone does NOT confer staff rights.
        mvc.perform(get("/api/v1/admissions/staff/queue").with(adminJwt))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("ADMISSIONS_STAFF_REQUIRED"));

        // Admin grants STAFF:admissions → the lane opens; revoke closes it.
        MvcResult grant = mvc.perform(post("/api/v1/admissions/staff/grants")
                        .with(adminJwt).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"userId\":\"student-9\"}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.scope").value("admissions"))
                .andReturn();
        String grantId = objectMapper.readTree(grant.getResponse().getContentAsString())
                .get("id").asText();
        mvc.perform(get("/api/v1/admissions/staff/queue").with(outsiderJwt))
                .andExpect(status().isOk());
        mvc.perform(delete("/api/v1/admissions/staff/grants/" + grantId).with(adminJwt))
                .andExpect(status().isOk());
        mvc.perform(get("/api/v1/admissions/staff/queue").with(outsiderJwt))
                .andExpect(status().isForbidden());

        // Grant admin writes audit rows (events convention): GRANTED + REVOKED.
        assertThat(jdbc.queryForObject(
                "SELECT COUNT(*) FROM admissions.\"Audit\""
                        + " WHERE \"action\" = 'STAFF_GRANTED'"
                        + " AND \"detail\" LIKE '%student-9%'",
                Integer.class)).isEqualTo(1);
        assertThat(jdbc.queryForObject(
                "SELECT COUNT(*) FROM admissions.\"Audit\""
                        + " WHERE \"action\" = 'STAFF_REVOKED'"
                        + " AND \"detail\" LIKE '%student-9%'",
                Integer.class)).isEqualTo(1);

        // Grant admin itself requires ADMIN — a staff grantee cannot grant.
        mvc.perform(post("/api/v1/admissions/staff/grants")
                        .with(staffJwt).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"userId\":\"student-9\"}"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("ADMISSIONS_ADMIN_REQUIRED"));
    }

    @Test
    void claimOwnershipScopesReviewActions() throws Exception {
        String id = submitted("own", applicantJwt);
        claim(id, staffJwt, 3);

        // staff-2 holds the grant but did not claim — review lanes deny.
        mvc.perform(post("/api/v1/admissions/staff/applications/" + id + "/return")
                        .with(staff2Jwt).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"note\":\"x\",\"expectedVersion\":4}"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("APPLICATION_REVIEW_NOT_OWNED"));
        mvc.perform(post("/api/v1/admissions/staff/applications/" + id + "/decision")
                        .with(staff2Jwt).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"decision\":\"ACCEPTED\",\"expectedVersion\":4}"))
                .andExpect(status().isForbidden());

        // Queue visibility is scope-wide — every grantee may read.
        mvc.perform(get("/api/v1/admissions/staff/applications/" + id).with(staff2Jwt))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("IN_REVIEW"));

        // Re-claiming an in-review application is a state conflict.
        mvc.perform(post("/api/v1/admissions/staff/applications/" + id + "/claim")
                        .with(staffJwt).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"expectedVersion\":4}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("APPLICATION_STATE_INVALID"));
    }

    // ---------------------------------------------------------------
    // Optimistic version conflicts
    // ---------------------------------------------------------------

    @Test
    void staleVersionConflictsEverywhere() throws Exception {
        String id = createDraft(applicantJwt, "ver-create");
        saveForm(id, applicantJwt, 1); // version now 2

        mvc.perform(put("/api/v1/admissions/applications/" + id)
                        .with(applicantJwt).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"fullName\":\"Late\",\"expectedVersion\":1}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("STALE_VERSION"));
        mvc.perform(post("/api/v1/admissions/applications/" + id + "/submit")
                        .with(applicantJwt).header("Idempotency-Key", "ver-sub")
                        .contentType(MediaType.APPLICATION_JSON).content("{\"expectedVersion\":1}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("STALE_VERSION"));
        // Missing expectedVersion is a domain 400, not a silent pass.
        mvc.perform(post("/api/v1/admissions/applications/" + id + "/submit")
                        .with(applicantJwt).header("Idempotency-Key", "ver-sub2")
                        .contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("APPLICATION_VERSION_REQUIRED"));
    }

    // ---------------------------------------------------------------
    // §1.3 — idempotent replays
    // ---------------------------------------------------------------

    @Test
    void idempotentCreateAndSubmitReplay() throws Exception {
        MvcResult first = mvc.perform(post("/api/v1/admissions/applications")
                        .with(applicantJwt).header("Idempotency-Key", "rp-create")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"cycle\":\"" + CYCLE + "\"}"))
                .andExpect(status().isCreated())
                .andReturn();
        String id = objectMapper.readTree(first.getResponse().getContentAsString())
                .get("id").asText();

        // Same key + same request replays the stored response — no second row.
        MvcResult replay = mvc.perform(post("/api/v1/admissions/applications")
                        .with(applicantJwt).header("Idempotency-Key", "rp-create")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"cycle\":\"" + CYCLE + "\"}"))
                .andExpect(status().isCreated())
                .andReturn();
        assertThat(objectMapper.readTree(replay.getResponse().getContentAsString())
                .get("id").asText()).isEqualTo(id);
        assertThat(jdbc.queryForObject(
                "SELECT COUNT(*) FROM admissions.\"Application\" WHERE \"applicantUserId\"='applicant-1'",
                Integer.class)).isEqualTo(1);

        // Same key + different request is a conflict, not a replay.
        mvc.perform(post("/api/v1/admissions/applications")
                        .with(applicantJwt).header("Idempotency-Key", "rp-create")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"cycle\":\"OTHER-CYCLE\"}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("IDEMPOTENCY_CONFLICT"));

        // Submit with a retried key does not double-transition.
        saveForm(id, applicantJwt, 1);
        mvc.perform(post("/api/v1/admissions/applications/" + id + "/submit")
                        .with(applicantJwt).header("Idempotency-Key", "rp-submit")
                        .contentType(MediaType.APPLICATION_JSON).content("{\"expectedVersion\":2}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("SUBMITTED"))
                .andExpect(jsonPath("$.version").value(3));
        mvc.perform(post("/api/v1/admissions/applications/" + id + "/submit")
                        .with(applicantJwt).header("Idempotency-Key", "rp-submit")
                        .contentType(MediaType.APPLICATION_JSON).content("{\"expectedVersion\":2}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("SUBMITTED"))
                .andExpect(jsonPath("$.version").value(3));
        // Same key + a different expectedVersion is a different request —
        // conflict, never a stale SUBMITTED replay (Wukong falsification: a
        // resubmit must not silently replay the earlier submit's response).
        mvc.perform(post("/api/v1/admissions/applications/" + id + "/submit")
                        .with(applicantJwt).header("Idempotency-Key", "rp-submit")
                        .contentType(MediaType.APPLICATION_JSON).content("{\"expectedVersion\":3}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("IDEMPOTENCY_CONFLICT"));
        assertThat(jdbc.queryForObject(
                "SELECT COUNT(*) FROM admissions.\"Audit\""
                        + " WHERE \"applicationId\" = ? AND \"action\" = 'SUBMITTED'",
                Integer.class, id)).isEqualTo(1);
    }

    // ---------------------------------------------------------------
    // Checksum-bound attachments + orphan-free cleanup
    // ---------------------------------------------------------------

    @Test
    void attachmentsChecksumDownloadAndCleanup() throws Exception {
        String id = createDraft(applicantJwt, "att-create");
        String payload = "synthetic-transcript-bytes";
        String expectedSha = HexFormat.of().formatHex(
                MessageDigest.getInstance("SHA-256").digest(payload.getBytes(StandardCharsets.UTF_8)));

        // Declared checksum is verified when supplied — wrong bytes rejected.
        mvc.perform(post("/api/v1/admissions/applications/" + id + "/attachments")
                        .with(applicantJwt).header("Idempotency-Key", "att-bad")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"fileName\":\"hoc-ba.pdf\",\"contentType\":\"application/pdf\","
                                + "\"dataBase64\":\"" + b64(payload) + "\","
                                + "\"checksum\":\"0000000000000000000000000000000000000000000000000000000000000000\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("FILE_CHECKSUM_MISMATCH"));

        MvcResult uploaded = mvc.perform(post("/api/v1/admissions/applications/" + id + "/attachments")
                        .with(applicantJwt).header("Idempotency-Key", "att-upload")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"fileName\":\"hoc-ba.pdf\",\"contentType\":\"application/pdf\","
                                + "\"dataBase64\":\"" + b64(payload) + "\","
                                + "\"checksum\":\"" + expectedSha + "\"}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.attachments.length()").value(1))
                .andExpect(jsonPath("$.attachments[0].checksum").value(expectedSha))
                .andExpect(jsonPath("$.version").value(2))
                .andReturn();
        String attachmentId = objectMapper.readTree(uploaded.getResponse().getContentAsString())
                .get("attachments").get(0).get("id").asText();

        // Same-key upload replays — no duplicate attachment row appears.
        mvc.perform(post("/api/v1/admissions/applications/" + id + "/attachments")
                        .with(applicantJwt).header("Idempotency-Key", "att-upload")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"fileName\":\"hoc-ba.pdf\",\"contentType\":\"application/pdf\","
                                + "\"dataBase64\":\"" + b64(payload) + "\","
                                + "\"checksum\":\"" + expectedSha + "\"}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.attachments.length()").value(1));

        // Owner download returns the exact bytes.
        MvcResult file = mvc.perform(get("/api/v1/admissions/applications/" + id
                        + "/attachments/" + attachmentId + "/file").with(applicantJwt))
                .andExpect(status().isOk())
                .andReturn();
        assertThat(file.getResponse().getContentAsByteArray())
                .isEqualTo(payload.getBytes(StandardCharsets.UTF_8));

        // Staff may read the file for review (after submit). Attachment writes
        // bump version: save is now against version 2, submit against 3.
        saveForm(id, applicantJwt, 2);
        mvc.perform(post("/api/v1/admissions/applications/" + id + "/submit")
                        .with(applicantJwt).header("Idempotency-Key", "att-submit")
                        .contentType(MediaType.APPLICATION_JSON).content("{\"expectedVersion\":3}"))
                .andExpect(status().isOk());
        mvc.perform(get("/api/v1/admissions/staff/applications/" + id
                        + "/attachments/" + attachmentId + "/file").with(staffJwt))
                .andExpect(status().isOk());

        // Attachment writes freeze once submitted.
        mvc.perform(delete("/api/v1/admissions/applications/" + id
                        + "/attachments/" + attachmentId)
                        .with(applicantJwt).header("Idempotency-Key", "att-del"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("APPLICATION_STATE_INVALID"));

        // Orphan cleanup: removing an attachment deletes its FileObject too.
        String id2 = createDraft(applicant2Jwt, "att2-create");
        mvc.perform(post("/api/v1/admissions/applications/" + id2 + "/attachments")
                        .with(applicant2Jwt).header("Idempotency-Key", "att2-upload")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"fileName\":\"tmp.pdf\",\"contentType\":\"application/pdf\","
                                + "\"dataBase64\":\"" + b64("orphan-check") + "\"}"))
                .andExpect(status().isCreated());
        String att2 = jdbc.queryForObject(
                "SELECT \"id\" FROM admissions.\"Attachment\" WHERE \"applicationId\" = ?",
                String.class, id2);
        mvc.perform(delete("/api/v1/admissions/applications/" + id2
                        + "/attachments/" + att2)
                        .with(applicant2Jwt).header("Idempotency-Key", "att2-del"))
                .andExpect(status().isOk());
        assertThat(jdbc.queryForObject(
                "SELECT COUNT(*) FROM admissions.\"FileObject\" f"
                        + " WHERE NOT EXISTS (SELECT 1 FROM admissions.\"Attachment\" a"
                        + " WHERE a.\"fileKey\" = f.\"key\")",
                Integer.class)).isZero();
    }

    // ---------------------------------------------------------------
    // Forbidden-write scan — admissions never creates academic Students
    // ---------------------------------------------------------------

    @Test
    void acceptedDecisionNeverCreatesAcademicStudent() throws Exception {
        String id = submitted("stu", applicantJwt);
        claim(id, staffJwt, 3);
        mvc.perform(post("/api/v1/admissions/staff/applications/" + id + "/decision")
                        .with(staffJwt).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"decision\":\"ACCEPTED\",\"expectedVersion\":4}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.decisionLabel").value("SIMULATED"));
        // The H2 mirror has no academic schema for this suite; the static
        // forbidden-write scan in the e2e + source review proves no service
        // path writes academic."Student". Assert the API surface instead:
        // an ACCEPTED application still exposes no student link.
        mvc.perform(get("/api/v1/admissions/applications/" + id).with(applicantJwt))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("ACCEPTED"))
                .andExpect(jsonPath("$.studentId").doesNotExist());
    }
}
