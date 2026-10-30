package io.campuscore.restfulapi.careers;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import io.campuscore.restfulapi.testsupport.CurrentAccountJwt;
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
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * H2 contract test for the P12 careers/applications domain (contract §9).
 * Proves the opportunity state machine (CAR-T01..T03), the application
 * progression (CAR-T05..T07), organization-scoped recruiter authority
 * (CAR-X01 — cross-org is impossible at the service layer), reviewer !=
 * submitter separation (CAR-T02), one-active-application-per-opportunity
 * (CAR-T04 service path), attachment ownership (CAR-X02), idempotent
 * apply/withdraw replays (§1.3), moderation-reason visibility, the
 * no-admin-without-grant negative and the no-academic-admissions-bleed
 * invariant on the real controllers + service + H2 mirror DDL.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles({"test", "persistence"})
@TestPropertySource(properties = {
        "spring.flyway.enabled=false",
        "spring.datasource.url=jdbc:h2:mem:careers_contract;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1"
})
class CareerContractPersistenceTest {

    @Autowired
    private JdbcTemplate jdbc;

    @Autowired
    private MockMvc mvc;

    @Autowired
    private ObjectMapper objectMapper;

    private RequestPostProcessor candidate1;
    private RequestPostProcessor candidate2;
    private RequestPostProcessor recruiterAlpha;
    private RequestPostProcessor recruiterBeta;
    private RequestPostProcessor reviewer;
    private RequestPostProcessor reviewerInAlpha;
    private RequestPostProcessor adminJwt;
    private RequestPostProcessor suspended;

    @BeforeEach
    void fixture() throws Exception {
        jdbc.execute("CREATE SCHEMA IF NOT EXISTS campuscore_auth");
        jdbc.execute("CREATE SCHEMA IF NOT EXISTS notifications");
        jdbc.execute("DROP SCHEMA IF EXISTS careers CASCADE");
        jdbc.execute("DROP TABLE IF EXISTS notifications.notification");
        jdbc.execute("CREATE SCHEMA IF NOT EXISTS careers");
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
                    new ClassPathResource("db/migration-h2/V142__careers_schema.sql"));
        }

        candidate1 = CurrentAccountJwt.fixtureJwt(jdbc, "candidate-1", "STUDENT");
        candidate2 = CurrentAccountJwt.fixtureJwt(jdbc, "candidate-2", "STUDENT");
        recruiterAlpha = CurrentAccountJwt.fixtureJwt(jdbc, "recruiter-alpha", "STUDENT");
        recruiterBeta = CurrentAccountJwt.fixtureJwt(jdbc, "recruiter-beta", "STUDENT");
        reviewer = CurrentAccountJwt.fixtureJwt(jdbc, "reviewer-1", "STUDENT");
        reviewerInAlpha = CurrentAccountJwt.fixtureJwt(jdbc, "reviewer-alpha", "STUDENT");
        adminJwt = CurrentAccountJwt.fixtureJwt(jdbc, "admin-user", "ADMIN");
        suspended = CurrentAccountJwt.fixtureJwt(jdbc, "candidate-suspended", "STUDENT");
        jdbc.update("UPDATE campuscore_auth.\"User\" SET \"status\" = 'SUSPENDED'"
                + " WHERE \"id\" = 'candidate-suspended'");

        jdbc.update("INSERT INTO careers.\"Organization\" (\"id\", \"name\")"
                + " VALUES ('org-alpha', 'Alpha Demo Co')");
        jdbc.update("INSERT INTO careers.\"Organization\" (\"id\", \"name\")"
                + " VALUES ('org-beta', 'Beta Demo Co')");

        // Org-scoped recruiter grants + platform reviewer grant (orgId '').
        jdbc.update("INSERT INTO careers.\"StaffGrant\""
                + " (\"id\", \"userId\", \"scope\", \"organizationId\", \"grantedBy\")"
                + " VALUES ('g-ra', 'recruiter-alpha', 'careers', 'org-alpha', 'admin-user')");
        jdbc.update("INSERT INTO careers.\"StaffGrant\""
                + " (\"id\", \"userId\", \"scope\", \"organizationId\", \"grantedBy\")"
                + " VALUES ('g-rb', 'recruiter-beta', 'careers', 'org-beta', 'admin-user')");
        jdbc.update("INSERT INTO careers.\"StaffGrant\""
                + " (\"id\", \"userId\", \"scope\", \"organizationId\", \"grantedBy\")"
                + " VALUES ('g-rev', 'reviewer-1', 'careers', '', 'admin-user')");
        // reviewer-alpha holds BOTH an org grant and the reviewer grant —
        // the CAR-T02 self-moderation negative.
        jdbc.update("INSERT INTO careers.\"StaffGrant\""
                + " (\"id\", \"userId\", \"scope\", \"organizationId\", \"grantedBy\")"
                + " VALUES ('g-ra2', 'reviewer-alpha', 'careers', 'org-alpha', 'admin-user')");
        jdbc.update("INSERT INTO careers.\"StaffGrant\""
                + " (\"id\", \"userId\", \"scope\", \"organizationId\", \"grantedBy\")"
                + " VALUES ('g-ra3', 'reviewer-alpha', 'careers', '', 'admin-user')");
    }

    // ---------------------------------------------------------------
    // helpers
    // ---------------------------------------------------------------

    private String createDraft(RequestPostProcessor recruiter, String orgId, String title)
            throws Exception {
        MvcResult result = mvc.perform(post("/api/v1/careers/staff/opportunities")
                        .with(recruiter).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"organizationId\":\"" + orgId + "\",\"title\":\""
                                + title + "\",\"description\":\"Demo posting\"}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.status").value("DRAFT"))
                .andReturn();
        return objectMapper.readTree(result.getResponse().getContentAsString())
                .get("id").asText();
    }

    private int versionOf(String entity, String id) {
        return jdbc.queryForObject(
                "SELECT \"version\" FROM careers.\"" + entity + "\" WHERE \"id\" = ?",
                Integer.class, id);
    }

    private void submitAndPublish(String opportunityId) throws Exception {
        mvc.perform(post("/api/v1/careers/staff/opportunities/" + opportunityId
                        + "/submit-review").with(recruiterAlpha)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"expectedVersion\":" + versionOf("Opportunity", opportunityId) + "}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("IN_REVIEW"));
        mvc.perform(post("/api/v1/careers/staff/opportunities/" + opportunityId
                        + "/publish").with(reviewer)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"expectedVersion\":" + versionOf("Opportunity", opportunityId) + "}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("PUBLISHED"));
    }

    private String apply(String opportunityId, String key) throws Exception {
        MvcResult result = mvc.perform(post("/api/v1/careers/applications")
                        .with(candidate1).header("Idempotency-Key", key)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"opportunityId\":\"" + opportunityId
                                + "\",\"coverLetter\":\"I am interested\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("SUBMITTED"))
                .andReturn();
        return objectMapper.readTree(result.getResponse().getContentAsString())
                .get("id").asText();
    }

    private void transitionApp(String applicationId, String to) throws Exception {
        mvc.perform(post("/api/v1/careers/staff/applications/" + applicationId + "/transition")
                        .with(recruiterAlpha).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"toStatus\":\"" + to + "\",\"expectedVersion\":"
                                + versionOf("Application", applicationId) + "}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value(to));
    }

    // ---------------------------------------------------------------
    // contract coverage
    // ---------------------------------------------------------------

    @Test
    void fullLifecycleDraftToOffer() throws Exception {
        // CAR-T01: recruiter drafts inside its own org and submits for review.
        String opp = createDraft(recruiterAlpha, "org-alpha", "Backend Intern");

        // A draft is invisible to candidates.
        mvc.perform(get("/api/v1/careers/opportunities").with(candidate1))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(0));
        mvc.perform(get("/api/v1/careers/opportunities/" + opp).with(candidate1))
                .andExpect(status().isNotFound());

        // CAR-T02: platform reviewer publishes (reviewer != submitter).
        submitAndPublish(opp);

        // Candidate browse sees the published posting.
        mvc.perform(get("/api/v1/careers/opportunities").with(candidate1))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].id").value(opp))
                .andExpect(jsonPath("$[0].organizationName").value("Alpha Demo Co"));

        // CAR-T04 + CAR-T05: apply, then forward-only progression to OFFER.
        String applicationId = apply(opp, "car-apply-1");
        transitionApp(applicationId, "REVIEWING");
        transitionApp(applicationId, "INTERVIEW");
        transitionApp(applicationId, "OFFER");

        // Notifications on every staff transition + publish (§11).
        Integer candidateNotifications = jdbc.queryForObject(
                "SELECT COUNT(*) FROM notifications.notification WHERE user_id = 'candidate-1'",
                Integer.class);
        assertThat(candidateNotifications).isEqualTo(3);
        Integer recruiterNotifications = jdbc.queryForObject(
                "SELECT COUNT(*) FROM notifications.notification WHERE user_id = 'recruiter-alpha'",
                Integer.class);
        assertThat(recruiterNotifications).isEqualTo(1);

        // Audit chain covers every transition.
        Integer audits = jdbc.queryForObject(
                "SELECT COUNT(*) FROM careers.\"Audit\" WHERE \"entityId\" IN (?, ?)",
                Integer.class, opp, applicationId);
        assertThat(audits).isGreaterThanOrEqualTo(6);
    }

    @Test
    void reviewerCannotModerateOwnSubmission() throws Exception {
        // reviewer-alpha submits inside org-alpha (legit org grant)…
        MvcResult draft = mvc.perform(post("/api/v1/careers/staff/opportunities")
                        .with(reviewerInAlpha).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"organizationId\":\"org-alpha\",\"title\":\"Self Post\"}"))
                .andExpect(status().isCreated()).andReturn();
        String opp = objectMapper.readTree(draft.getResponse().getContentAsString())
                .get("id").asText();
        mvc.perform(post("/api/v1/careers/staff/opportunities/" + opp + "/submit-review")
                        .with(reviewerInAlpha).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"expectedVersion\":" + versionOf("Opportunity", opp) + "}"))
                .andExpect(status().isOk());

        // …but cannot self-publish despite holding the reviewer grant.
        mvc.perform(post("/api/v1/careers/staff/opportunities/" + opp + "/publish")
                        .with(reviewerInAlpha).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"expectedVersion\":" + versionOf("Opportunity", opp) + "}"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("SELF_PUBLISH_FORBIDDEN"));
        mvc.perform(post("/api/v1/careers/staff/opportunities/" + opp + "/reject")
                        .with(reviewerInAlpha).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"expectedVersion\":" + versionOf("Opportunity", opp)
                                + ",\"reason\":\"policy\"}"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("SELF_PUBLISH_FORBIDDEN"));

        // A different reviewer can publish it.
        mvc.perform(post("/api/v1/careers/staff/opportunities/" + opp + "/publish")
                        .with(reviewer).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"expectedVersion\":" + versionOf("Opportunity", opp) + "}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("PUBLISHED"));
    }

    @Test
    void organizationIsolationIsTotal() throws Exception {
        String opp = createDraft(recruiterAlpha, "org-alpha", "Alpha Only");
        submitAndPublish(opp);
        String applicationId = apply(opp, "car-iso-apply");

        // CAR-X01: recruiter-beta sees neither the posting nor the application.
        mvc.perform(get("/api/v1/careers/staff/opportunities").with(recruiterBeta))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(0));
        mvc.perform(get("/api/v1/careers/staff/opportunities/" + opp).with(recruiterBeta))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("CAREERS_STAFF_REQUIRED"));
        mvc.perform(get("/api/v1/careers/staff/applications").with(recruiterBeta))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(0));
        mvc.perform(get("/api/v1/careers/staff/applications/" + applicationId)
                        .with(recruiterBeta))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("CAREERS_STAFF_REQUIRED"));

        // Cross-org writes are denied too — beta cannot transition or reject.
        mvc.perform(post("/api/v1/careers/staff/applications/" + applicationId + "/transition")
                        .with(recruiterBeta).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"toStatus\":\"REVIEWING\",\"expectedVersion\":1}"))
                .andExpect(status().isForbidden());
        mvc.perform(post("/api/v1/careers/staff/applications/" + applicationId + "/reject")
                        .with(recruiterBeta).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"expectedVersion\":1,\"reason\":\"nope\"}"))
                .andExpect(status().isForbidden());

        // Beta cannot create a posting inside org-alpha either.
        mvc.perform(post("/api/v1/careers/staff/opportunities")
                        .with(recruiterBeta).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"organizationId\":\"org-alpha\",\"title\":\"Intrusion\"}"))
                .andExpect(status().isForbidden());

        // Scope check precedes the state check: a cross-org close on a DRAFT
        // answers 403 — never a 409 that would leak the posting's state.
        String draft = createDraft(recruiterAlpha, "org-alpha", "Hidden Draft");
        mvc.perform(post("/api/v1/careers/staff/opportunities/" + draft + "/close")
                        .with(recruiterBeta).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"expectedVersion\":1,\"reason\":\"probe\"}"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("CAREERS_STAFF_REQUIRED"));
        mvc.perform(post("/api/v1/careers/staff/opportunities/" + draft + "/close")
                        .with(candidate1).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"expectedVersion\":1,\"reason\":\"probe\"}"))
                .andExpect(status().isForbidden());
    }

    @Test
    void scopedGrantIsTheOnlyAuthority() throws Exception {
        // ADMIN role alone is not domain authority (§1.1).
        mvc.perform(get("/api/v1/careers/staff/opportunities").with(adminJwt))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("CAREERS_STAFF_REQUIRED"));
        mvc.perform(get("/api/v1/careers/staff/review-queue").with(adminJwt))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("CAREERS_REVIEWER_REQUIRED"));
        mvc.perform(get("/api/v1/careers/staff/applications").with(candidate1))
                .andExpect(status().isForbidden());

        // A non-admin grant holder cannot administer grants.
        mvc.perform(post("/api/v1/careers/staff/grants")
                        .with(recruiterAlpha).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"userId\":\"candidate-2\",\"organizationId\":\"org-alpha\"}"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("CAREERS_ADMIN_REQUIRED"));

        // Reviewer grant alone does not confer org-recruiter rights.
        mvc.perform(get("/api/v1/careers/staff/opportunities").with(reviewer))
                .andExpect(status().isForbidden());

        // Admin can grant; the new grantee immediately gains org access.
        mvc.perform(post("/api/v1/careers/staff/grants")
                        .with(adminJwt).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"userId\":\"candidate-2\",\"organizationId\":\"org-alpha\"}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.organizationId").value("org-alpha"));
        mvc.perform(get("/api/v1/careers/staff/opportunities").with(candidate2))
                .andExpect(status().isOk());
    }

    @Test
    void repeatedGrantsReplayStoredProvenance() throws Exception {
        RequestPostProcessor secondAdmin = CurrentAccountJwt.fixtureJwt(jdbc, "admin-user-2", "ADMIN");
        MvcResult first = mvc.perform(post("/api/v1/careers/staff/grants")
                        .with(adminJwt).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"userId\":\"candidate-2\",\"organizationId\":\"org-alpha\"}"))
                .andExpect(status().isCreated())
                .andReturn();
        MvcResult repeat = mvc.perform(post("/api/v1/careers/staff/grants")
                        .with(secondAdmin).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"userId\":\"candidate-2\",\"organizationId\":\"org-alpha\"}"))
                .andExpect(status().isCreated())
                .andReturn();
        JsonNode firstGrant = objectMapper.readTree(first.getResponse().getContentAsString());
        JsonNode repeatGrant = objectMapper.readTree(repeat.getResponse().getContentAsString());
        // A repeat replays the stored row — original grantor and grant
        // instant — never the repeating admin's identity or a fresh clock.
        assertThat(repeatGrant.get("id").asText()).isEqualTo(firstGrant.get("id").asText());
        assertThat(repeatGrant.get("grantedBy").asText()).isEqualTo("admin-user");
        assertThat(repeatGrant.get("organizationId").asText()).isEqualTo("org-alpha");
        assertThat(repeatGrant.get("createdAt").asText()).isEqualTo(firstGrant.get("createdAt").asText());

        // The reviewer grant (organizationId omitted) follows the same rule.
        MvcResult reviewerFirst = mvc.perform(post("/api/v1/careers/staff/grants")
                        .with(adminJwt).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"userId\":\"candidate-2\"}"))
                .andExpect(status().isCreated())
                .andReturn();
        MvcResult reviewerRepeat = mvc.perform(post("/api/v1/careers/staff/grants")
                        .with(secondAdmin).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"userId\":\"candidate-2\"}"))
                .andExpect(status().isCreated())
                .andReturn();
        JsonNode reviewerRepeatGrant = objectMapper.readTree(
                reviewerRepeat.getResponse().getContentAsString());
        assertThat(reviewerRepeatGrant.get("id").asText())
                .isEqualTo(objectMapper.readTree(reviewerFirst.getResponse().getContentAsString())
                        .get("id").asText());
        assertThat(reviewerRepeatGrant.get("grantedBy").asText()).isEqualTo("admin-user");
        assertThat(reviewerRepeatGrant.get("organizationId").asText()).isEmpty();

        assertThat(jdbc.queryForObject(
                "SELECT COUNT(*) FROM careers.\"StaffGrant\" WHERE \"userId\" = 'candidate-2'",
                Integer.class)).isEqualTo(2);
        assertThat(jdbc.queryForObject(
                "SELECT COUNT(*) FROM careers.\"Audit\" WHERE \"action\" = 'STAFF_GRANTED'"
                        + " AND \"detail\" LIKE '%candidate-2%'",
                Integer.class)).isEqualTo(2);
    }

    @Test
    void closedAndPausedJobsAcceptNoApplications() throws Exception {
        String opp = createDraft(recruiterAlpha, "org-alpha", "Closing Soon");
        submitAndPublish(opp);

        // CAR-T03: pause with a visible reason; candidates cannot apply.
        mvc.perform(post("/api/v1/careers/staff/opportunities/" + opp + "/pause")
                        .with(recruiterAlpha).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"expectedVersion\":" + versionOf("Opportunity", opp)
                                + ",\"reason\":\"hiring freeze\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("PAUSED"))
                .andExpect(jsonPath("$.moderationReason").value("hiring freeze"));
        mvc.perform(post("/api/v1/careers/applications")
                        .with(candidate1).header("Idempotency-Key", "car-paused")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"opportunityId\":\"" + opp + "\"}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("OPPORTUNITY_NOT_OPEN"));

        // Resume then close with reason — closed is terminal for applicants.
        mvc.perform(post("/api/v1/careers/staff/opportunities/" + opp + "/resume")
                        .with(recruiterAlpha).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"expectedVersion\":" + versionOf("Opportunity", opp) + "}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("PUBLISHED"));
        mvc.perform(post("/api/v1/careers/staff/opportunities/" + opp + "/close")
                        .with(recruiterAlpha).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"expectedVersion\":" + versionOf("Opportunity", opp)
                                + ",\"reason\":\"position filled\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("CLOSED"));
        mvc.perform(post("/api/v1/careers/applications")
                        .with(candidate1).header("Idempotency-Key", "car-closed")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"opportunityId\":\"" + opp + "\"}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("OPPORTUNITY_NOT_OPEN"));

        // Terminal: no further opportunity transitions.
        mvc.perform(post("/api/v1/careers/staff/opportunities/" + opp + "/pause")
                        .with(recruiterAlpha).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"expectedVersion\":" + versionOf("Opportunity", opp)
                                + ",\"reason\":\"again\"}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("OPPORTUNITY_TERMINAL"));
    }

    @Test
    void oneActiveApplicationPerOpportunity() throws Exception {
        String opp = createDraft(recruiterAlpha, "org-alpha", "Single Shot");
        submitAndPublish(opp);
        String applicationId = apply(opp, "car-uniq-1");

        // Second apply to the same opportunity conflicts (CAR-T04).
        mvc.perform(post("/api/v1/careers/applications")
                        .with(candidate1).header("Idempotency-Key", "car-uniq-2")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"opportunityId\":\"" + opp + "\"}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("APPLICATION_ACTIVE"));

        // A different opportunity in the same org is fine.
        String opp2 = createDraft(recruiterAlpha, "org-alpha", "Other Role");
        submitAndPublish(opp2);
        apply(opp2, "car-uniq-3");

        // Withdraw then re-apply to the first opportunity works — the
        // unique index only guards the active states.
        mvc.perform(post("/api/v1/careers/applications/" + applicationId + "/withdraw")
                        .with(candidate1).header("Idempotency-Key", "car-wd-1")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"expectedVersion\":1}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("WITHDRAWN"));
        apply(opp, "car-uniq-4");
    }

    @Test
    void idempotentApplyAndWithdrawReplay() throws Exception {
        String opp = createDraft(recruiterAlpha, "org-alpha", "Replay Job");
        submitAndPublish(opp);

        // Same key + same body replays the stored response, no second row.
        MvcResult first = mvc.perform(post("/api/v1/careers/applications")
                        .with(candidate1).header("Idempotency-Key", "car-replay")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"opportunityId\":\"" + opp + "\"}"))
                .andExpect(status().isOk()).andReturn();
        String id = objectMapper.readTree(first.getResponse().getContentAsString())
                .get("id").asText();
        MvcResult replay = mvc.perform(post("/api/v1/careers/applications")
                        .with(candidate1).header("Idempotency-Key", "car-replay")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"opportunityId\":\"" + opp + "\"}"))
                .andExpect(status().isOk()).andReturn();
        assertThat(objectMapper.readTree(replay.getResponse().getContentAsString())
                .get("id").asText()).isEqualTo(id);
        Integer count = jdbc.queryForObject(
                "SELECT COUNT(*) FROM careers.\"Application\" WHERE \"candidateUserId\" = 'candidate-1'",
                Integer.class);
        assertThat(count).isEqualTo(1);

        // Same key bound to a different request conflicts (§1.3).
        mvc.perform(post("/api/v1/careers/applications")
                        .with(candidate1).header("Idempotency-Key", "car-replay")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"opportunityId\":\"different-opp\"}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("IDEMPOTENCY_CONFLICT"));

        // The cover letter is bound into the hash too — same key + same
        // opportunity but a different letter is a different request.
        mvc.perform(post("/api/v1/careers/applications")
                        .with(candidate1).header("Idempotency-Key", "car-replay")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"opportunityId\":\"" + opp
                                + "\",\"coverLetter\":\"changed letter\"}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("IDEMPOTENCY_CONFLICT"));

        // Withdraw replay returns the same response.
        mvc.perform(post("/api/v1/careers/applications/" + id + "/withdraw")
                        .with(candidate1).header("Idempotency-Key", "car-wd-replay")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"expectedVersion\":1}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("WITHDRAWN"));
        mvc.perform(post("/api/v1/careers/applications/" + id + "/withdraw")
                        .with(candidate1).header("Idempotency-Key", "car-wd-replay")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"expectedVersion\":1}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("WITHDRAWN"));
    }

    @Test
    void rejectionRequiresReasonVisibleToCandidate() throws Exception {
        String opp = createDraft(recruiterAlpha, "org-alpha", "Rejection Path");
        submitAndPublish(opp);
        String applicationId = apply(opp, "car-rej-1");

        // CAR-T06: reject without a reason is rejected itself.
        mvc.perform(post("/api/v1/careers/staff/applications/" + applicationId + "/reject")
                        .with(recruiterAlpha).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"expectedVersion\":1}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("MODERATION_REASON_REQUIRED"));

        // Reject with reason — visible to the candidate, never hidden.
        mvc.perform(post("/api/v1/careers/staff/applications/" + applicationId + "/reject")
                        .with(recruiterAlpha).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"expectedVersion\":1,\"reason\":\"skills mismatch\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("REJECTED"))
                .andExpect(jsonPath("$.moderationReason").value("skills mismatch"));
        mvc.perform(get("/api/v1/careers/applications/" + applicationId).with(candidate1))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.moderationReason").value("skills mismatch"));

        // Terminal: no transitions, no withdraw.
        mvc.perform(post("/api/v1/careers/staff/applications/" + applicationId + "/transition")
                        .with(recruiterAlpha).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"toStatus\":\"REVIEWING\",\"expectedVersion\":2}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("APPLICATION_TERMINAL"));
        mvc.perform(post("/api/v1/careers/applications/" + applicationId + "/withdraw")
                        .with(candidate1).header("Idempotency-Key", "car-wd-term")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"expectedVersion\":2}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("APPLICATION_TERMINAL"));
    }

    @Test
    void applicationProgressionIsStrictlyForward() throws Exception {
        String opp = createDraft(recruiterAlpha, "org-alpha", "Stepper");
        submitAndPublish(opp);
        String applicationId = apply(opp, "car-fwd-1");

        // Skipping steps is invalid — SUBMITTED → INTERVIEW is a conflict.
        mvc.perform(post("/api/v1/careers/staff/applications/" + applicationId + "/transition")
                        .with(recruiterAlpha).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"toStatus\":\"INTERVIEW\",\"expectedVersion\":1}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("APPLICATION_STATE_INVALID"));

        // Stale version is a conflict too (optimistic guard).
        mvc.perform(post("/api/v1/careers/staff/applications/" + applicationId + "/transition")
                        .with(recruiterAlpha).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"toStatus\":\"REVIEWING\",\"expectedVersion\":99}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("STALE_VERSION"));

        transitionApp(applicationId, "REVIEWING");
        // Backwards is invalid as well.
        mvc.perform(post("/api/v1/careers/staff/applications/" + applicationId + "/transition")
                        .with(recruiterAlpha).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"toStatus\":\"SUBMITTED\",\"expectedVersion\":"
                                + versionOf("Application", applicationId) + "}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("APPLICATION_STATE_INVALID"));
    }

    @Test
    void attachmentOwnershipAndChecksum() throws Exception {
        String opp = createDraft(recruiterAlpha, "org-alpha", "Attachment Job");
        submitAndPublish(opp);
        String applicationId = apply(opp, "car-att-1");
        String cv = java.util.Base64.getEncoder().encodeToString("fake-cv".getBytes());
        String sha = sha256("fake-cv".getBytes());

        // Idempotency-Key is required on the attachment lane.
        mvc.perform(post("/api/v1/careers/applications/" + applicationId + "/attachments")
                        .with(candidate1).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"fileName\":\"cv.txt\",\"contentType\":\"text/plain\","
                                + "\"dataBase64\":\"" + cv + "\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("IDEMPOTENCY_KEY_REQUIRED"));

        // Declared checksum is verified when provided (field/content error → 400).
        mvc.perform(post("/api/v1/careers/applications/" + applicationId + "/attachments")
                        .with(candidate1).header("Idempotency-Key", "car-att-up1")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"fileName\":\"cv.txt\",\"contentType\":\"text/plain\","
                                + "\"dataBase64\":\"" + cv + "\",\"checksum\":\"deadbeef\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("FILE_CHECKSUM_MISMATCH"));

        // Valid upload bumps the application version.
        mvc.perform(post("/api/v1/careers/applications/" + applicationId + "/attachments")
                        .with(candidate1).header("Idempotency-Key", "car-att-up2")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"fileName\":\"cv.txt\",\"contentType\":\"text/plain\","
                                + "\"dataBase64\":\"" + cv + "\",\"checksum\":\"" + sha + "\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.attachments.length()").value(1))
                .andExpect(jsonPath("$.attachments[0].checksum").value(sha))
                .andExpect(jsonPath("$.version").value(2));

        // Same key + identical request replays the stored upload (§1.3).
        mvc.perform(post("/api/v1/careers/applications/" + applicationId + "/attachments")
                        .with(candidate1).header("Idempotency-Key", "car-att-up2")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"fileName\":\"cv.txt\",\"contentType\":\"text/plain\","
                                + "\"dataBase64\":\"" + cv + "\",\"checksum\":\"" + sha + "\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.attachments.length()").value(1));

        // Same key + different bytes conflicts — the hash binds content, so a
        // divergent retry can never silently replay a stale success.
        String other = java.util.Base64.getEncoder().encodeToString("revised-cv".getBytes());
        mvc.perform(post("/api/v1/careers/applications/" + applicationId + "/attachments")
                        .with(candidate1).header("Idempotency-Key", "car-att-up2")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"fileName\":\"cv.txt\",\"contentType\":\"text/plain\","
                                + "\"dataBase64\":\"" + other + "\"}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("IDEMPOTENCY_CONFLICT"));

        String attachmentId = jdbc.queryForObject(
                "SELECT \"id\" FROM careers.\"Attachment\" WHERE \"applicationId\" = ?",
                String.class, applicationId);

        // CAR-X02: owner + owning-org recruiter read; foreign candidates
        // and cross-org recruiters get indistinguishable 404/403.
        mvc.perform(get("/api/v1/careers/applications/" + applicationId
                        + "/attachments/" + attachmentId + "/download").with(candidate1))
                .andExpect(status().isOk());
        mvc.perform(get("/api/v1/careers/staff/applications/" + applicationId
                        + "/attachments/" + attachmentId + "/download").with(recruiterAlpha))
                .andExpect(status().isOk());
        mvc.perform(get("/api/v1/careers/applications/" + applicationId
                        + "/attachments/" + attachmentId + "/download").with(candidate2))
                .andExpect(status().isNotFound());
        mvc.perform(get("/api/v1/careers/staff/applications/" + applicationId
                        + "/attachments/" + attachmentId + "/download").with(recruiterBeta))
                .andExpect(status().isForbidden());
    }

    @Test
    void candidateIsolationIsIndistinguishableNotFound() throws Exception {
        String opp = createDraft(recruiterAlpha, "org-alpha", "Isolation Job");
        submitAndPublish(opp);
        String applicationId = apply(opp, "car-own-1");

        // Foreign application id answers the same 404 as a missing id.
        mvc.perform(get("/api/v1/careers/applications/" + applicationId).with(candidate2))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("APPLICATION_NOT_FOUND"));
        mvc.perform(get("/api/v1/careers/applications/no-such-app").with(candidate2))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("APPLICATION_NOT_FOUND"));

        // Foreign withdraw is indistinguishable too.
        mvc.perform(post("/api/v1/careers/applications/" + applicationId + "/withdraw")
                        .with(candidate2).header("Idempotency-Key", "car-iso-wd")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"expectedVersion\":1}"))
                .andExpect(status().isNotFound());

        // my-applications only lists own rows.
        mvc.perform(get("/api/v1/careers/applications/my").with(candidate2))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(0));
    }

    @Test
    void suspendedUserCannotApply() throws Exception {
        String opp = createDraft(recruiterAlpha, "org-alpha", "Suspended Test");
        submitAndPublish(opp);
        mvc.perform(post("/api/v1/careers/applications")
                        .with(suspended).header("Idempotency-Key", "car-sus-1")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"opportunityId\":\"" + opp + "\"}"))
                .andExpect(status().isForbidden())
                // The upstream account-status guard denies before the domain
                // service — defense in depth, same posture as the library.
                .andExpect(jsonPath("$.code").value("ACCOUNT_INACTIVE"));
    }

    @Test
    void noAcademicOrAdmissionsBleedIntoRecruiterLane() throws Exception {
        // Contract §9: recruiters do not receive academic/admissions access
        // through the careers surface — the staff endpoints expose only
        // careers.* data and the candidate email for contact purposes.
        String opp = createDraft(recruiterAlpha, "org-alpha", "No Bleed");
        submitAndPublish(opp);
        apply(opp, "car-bleed-1");
        MvcResult result = mvc.perform(get("/api/v1/careers/staff/applications")
                        .with(recruiterAlpha))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].candidateEmail").isNotEmpty())
                .andReturn();
        String body = result.getResponse().getContentAsString();
        assertThat(body).doesNotContain("studentId", "gpa", "grade", "admission");
    }

    private static String sha256(byte[] bytes) {
        try {
            byte[] digest = java.security.MessageDigest.getInstance("SHA-256").digest(bytes);
            StringBuilder hex = new StringBuilder(digest.length * 2);
            for (byte value : digest) {
                hex.append(String.format("%02x", value));
            }
            return hex.toString();
        } catch (java.security.NoSuchAlgorithmException exception) {
            throw new IllegalStateException(exception);
        }
    }
}
