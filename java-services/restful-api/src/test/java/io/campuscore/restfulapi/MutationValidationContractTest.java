package io.campuscore.restfulapi;

import static io.campuscore.restfulapi.testsupport.CurrentAccountJwt.fixtureJwt;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;

import io.campuscore.restfulapi.admissions.web.MultipartAttachment;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.RequestBuilder;
import org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.JwtRequestPostProcessor;
import tools.jackson.databind.ObjectMapper;

/** H2 MockMvc negative matrix for high-risk mutation boundaries. */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles({"test", "persistence"})
@TestPropertySource(properties = {
        "spring.datasource.url=jdbc:h2:mem:mutation_validation_contract;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1",
        "spring.datasource.username=sa",
        "spring.datasource.password=",
        "spring.flyway.enabled=true",
        "spring.flyway.locations=classpath:db/migration-h2"
})
class MutationValidationContractTest {

    private static final String APPLICANT_ID = "aud12-applicant";
    private static final String OTHER_APPLICANT_ID = "aud12-other-applicant";
    private static final String REVIEWER_ID = "aud12-reviewer";
    private static final String ADMIN_ID = "aud12-admin";
    private static final List<String> WRITE_TABLES = List.of(
            "admissions.\"Application\"",
            "admissions.\"Attachment\"",
            "admissions.\"FileObject\"",
            "admissions.\"Review\"",
            "admissions.\"Audit\"",
            "admissions.\"Idempotency\"",
            "engagement.\"Announcement\"",
            "engagement.\"AnnouncementAudit\"",
            "engagement.\"PublicDocument\"",
            "engagement.\"PublicDocumentRevision\"",
            "engagement.\"PublicDocumentAttachment\"",
            "engagement.\"PublicDocumentTagMap\"",
            "engagement.\"PublicDocumentAudit\"",
            "thesis.thesis_topic",
            "thesis.thesis_topic_supervisor");

    @Autowired
    private JdbcTemplate jdbc;

    @Autowired
    private MockMvc mvc;

    @Autowired
    private ObjectMapper objectMapper;

    private JwtRequestPostProcessor applicantJwt;
    private JwtRequestPostProcessor otherApplicantJwt;
    private JwtRequestPostProcessor reviewerJwt;
    private JwtRequestPostProcessor adminJwt;
    private String applicationId;

    @BeforeEach
    void prepareH2ActorsAndDraft() throws Exception {
        applicantJwt = fixtureJwt(jdbc, APPLICANT_ID, "STUDENT");
        otherApplicantJwt = fixtureJwt(jdbc, OTHER_APPLICANT_ID, "STUDENT");
        reviewerJwt = fixtureJwt(jdbc, REVIEWER_ID, "STUDENT");
        adminJwt = fixtureJwt(jdbc, ADMIN_ID, "ADMIN");

        jdbc.update("DELETE FROM admissions.\"StaffGrant\" WHERE \"userId\" = ?", REVIEWER_ID);
        jdbc.update("INSERT INTO admissions.\"StaffGrant\" (\"id\", \"userId\", \"scope\", \"grantedBy\")"
                        + " VALUES (?, ?, 'admissions', ?)",
                UUID.randomUUID().toString(), REVIEWER_ID, ADMIN_ID);

        MvcResult created = mvc.perform(post("/api/v1/admissions/applications")
                        .with(applicantJwt)
                        .header("Idempotency-Key", UUID.randomUUID().toString())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"cycle\":\"AUD12-" + UUID.randomUUID() + "\"}"))
                .andReturn();
        assertEquals(201, created.getResponse().getStatus(), "fixture draft must be created in H2");
        applicationId = objectMapper.readTree(created.getResponse().getContentAsString())
                .get("id").asText();
    }

    @Test
    void invalidMutationMatrixReturnsClientErrorsWithoutChangingAnyStore() throws Exception {
        byte[] validPdf = "%PDF-1.7\nsynthetic document".getBytes(StandardCharsets.UTF_8);
        String validPdfChecksum = sha256(validPdf);
        byte[] oversizedPdf = new byte[MultipartAttachment.MAX_BYTES + 1];

        List<InvalidMutation> cases = List.of(
                new InvalidMutation("missing admission cycle", 400,
                        () -> post("/api/v1/admissions/applications").with(applicantJwt)
                                .header("Idempotency-Key", UUID.randomUUID().toString())
                                .contentType(MediaType.APPLICATION_JSON).content("{}")),
                new InvalidMutation("over-length admission cycle", 400,
                        () -> post("/api/v1/admissions/applications").with(applicantJwt)
                                .header("Idempotency-Key", UUID.randomUUID().toString())
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"cycle\":\"" + "x".repeat(61) + "\"}")),
                new InvalidMutation("over-length admission name", 400,
                        () -> put("/api/v1/admissions/applications/no-such-application").with(applicantJwt)
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"fullName\":\"" + "x".repeat(241)
                                        + "\",\"expectedVersion\":1}")),
                new InvalidMutation("invalid admission calendar date", 400,
                        () -> put("/api/v1/admissions/applications/no-such-application").with(applicantJwt)
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"dateOfBirth\":\"2026-02-31\",\"expectedVersion\":1}")),
                new InvalidMutation("invalid admission review decision enum", 400,
                        () -> post("/api/v1/admissions/staff/applications/no-such-application/decision")
                                .with(reviewerJwt).contentType(MediaType.APPLICATION_JSON)
                                .content("{\"decision\":\"UNSUPPORTED\",\"expectedVersion\":1}")),
                new InvalidMutation("submit incomplete application", 400,
                        () -> post("/api/v1/admissions/applications/" + applicationId + "/submit")
                                .with(applicantJwt).header("Idempotency-Key", UUID.randomUUID().toString())
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"expectedVersion\":1}")),
                new InvalidMutation("announcement missing required title", 400,
                        () -> post("/api/v1/announcements").with(adminJwt)
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"content\":\"body\",\"isGlobal\":true}")),
                new InvalidMutation("announcement blank required title", 400,
                        () -> post("/api/v1/announcements").with(adminJwt)
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"title\":\"   \",\"content\":\"body\",\"isGlobal\":true}")),
                new InvalidMutation("announcement missing required content", 400,
                        () -> post("/api/v1/announcements").with(adminJwt)
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"title\":\"AUD12 matrix\",\"isGlobal\":true}")),
                new InvalidMutation("announcement blank required content", 400,
                        () -> post("/api/v1/announcements").with(adminJwt)
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"title\":\"AUD12 matrix\",\"content\":\"   \",\"isGlobal\":true}")),
                new InvalidMutation("announcement bad priority enum", 400,
                        () -> post("/api/v1/announcements").with(adminJwt)
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"title\":\"AUD12 matrix\",\"content\":\"body\","
                                        + "\"priority\":\"UNSUPPORTED\",\"isGlobal\":true}")),
                new InvalidMutation("over-length announcement title", 400,
                        () -> post("/api/v1/announcements").with(adminJwt)
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"title\":\"" + "x".repeat(241)
                                        + "\",\"content\":\"body\",\"isGlobal\":true}")),
                new InvalidMutation("announcement malformed publish date", 400,
                        () -> post("/api/v1/announcements").with(adminJwt)
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"title\":\"AUD12 matrix\",\"content\":\"body\","
                                        + "\"publishAt\":\"not-a-date\",\"isGlobal\":true}")),
                new InvalidMutation("public document missing required title", 400,
                        () -> post("/api/v1/docs").with(adminJwt)
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"slug\":\"aud12-" + UUID.randomUUID()
                                        + "\",\"titleEn\":\"Valid title\",\"bodyVi\":\"body\","
                                        + "\"bodyEn\":\"body\"}")),
                new InvalidMutation("public document over-length title", 400,
                        () -> post("/api/v1/docs").with(adminJwt)
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"slug\":\"aud12-" + UUID.randomUUID()
                                        + "\",\"titleVi\":\"" + "x".repeat(241)
                                        + "\",\"titleEn\":\"Valid title\",\"bodyVi\":\"body\","
                                        + "\"bodyEn\":\"body\"}")),
                new InvalidMutation("thesis topic missing required round", 400,
                        () -> post("/api/v1/thesis/topics").with(adminJwt)
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"departmentId\":\"dept-a\",\"title\":\"Topic\","
                                        + "\"description\":\"Description\"}")),
                new InvalidMutation("thesis topic over-length title", 400,
                        () -> post("/api/v1/thesis/topics").with(adminJwt)
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"roundId\":\"" + UUID.randomUUID() + "\","
                                        + "\"departmentId\":\"dept-a\",\"title\":\"" + "x".repeat(241)
                                        + "\",\"description\":\"Description\"}")),
                new InvalidMutation("unsupported attachment media type", 415,
                        () -> multipart("/api/v1/admissions/applications/" + applicationId + "/attachments")
                                .file(new MockMultipartFile("file", "document.txt", "text/plain",
                                        "not an accepted document".getBytes(StandardCharsets.UTF_8)))
                                .with(applicantJwt)),
                new InvalidMutation("oversized attachment", 400,
                        () -> multipart("/api/v1/admissions/applications/" + applicationId + "/attachments")
                                .file(new MockMultipartFile("file", "document.pdf", "application/pdf", oversizedPdf))
                                .with(applicantJwt)),
                new InvalidMutation("repeated attachment checksum parameter", 400,
                        () -> multipart("/api/v1/admissions/applications/" + applicationId + "/attachments")
                                .file(new MockMultipartFile("file", "document.pdf", "application/pdf", validPdf))
                                .param("checksum", validPdfChecksum, "conflicting-checksum")
                                .with(applicantJwt)),
                new InvalidMutation("wrong JSON request content type", 415,
                        () -> post("/api/v1/admissions/applications").with(applicantJwt)
                                .contentType(MediaType.TEXT_PLAIN).content("{}")));

        for (InvalidMutation invalid : cases) {
            Map<String, Object> before = writeSnapshot();
            MvcResult result = mvc.perform(invalid.request().build()).andReturn();
            assertEquals(invalid.expectedStatus(), result.getResponse().getStatus(), invalid.name());
            if ("oversized attachment".equals(invalid.name())) {
                assertEquals("ATTACHMENT_SIZE_INVALID",
                        objectMapper.readTree(result.getResponse().getContentAsString()).get("code").asText());
            }
            assertEquals(before, writeSnapshot(), invalid.name() + " must not write domain state");
        }
    }

    @Test
    void foreignOwnerMutationReturnsNotFoundWithoutChangingApplicationOrHistory() throws Exception {
        int versionBefore = jdbc.queryForObject(
                "SELECT \"version\" FROM admissions.\"Application\" WHERE \"id\" = ?",
                Integer.class, applicationId);
        Map<String, Object> before = writeSnapshot();

        MvcResult result = mvc.perform(put("/api/v1/admissions/applications/" + applicationId)
                        .with(otherApplicantJwt).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"fullName\":\"Other user\",\"expectedVersion\":1}"))
                .andReturn();

        assertEquals(404, result.getResponse().getStatus());
        assertEquals(versionBefore, jdbc.queryForObject(
                "SELECT \"version\" FROM admissions.\"Application\" WHERE \"id\" = ?",
                Integer.class, applicationId));
        assertEquals(before, writeSnapshot(), "foreign owner request must not write domain state");
    }

    private Map<String, Object> writeSnapshot() {
        Map<String, Object> snapshot = new LinkedHashMap<>();
        WRITE_TABLES.forEach(table -> snapshot.put(
                table, jdbc.queryForObject("SELECT COUNT(*) FROM " + table, Integer.class)));
        snapshot.put("admissions.Application.rows", jdbc.queryForList(
                "SELECT \"id\", \"status\", \"version\", \"updatedAt\""
                        + " FROM admissions.\"Application\" ORDER BY \"id\""));
        return Map.copyOf(snapshot);
    }

    private static String sha256(byte[] bytes) throws Exception {
        return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
    }

    private record InvalidMutation(String name, int expectedStatus, RequestFactory request) {
    }

    @FunctionalInterface
    private interface RequestFactory {
        RequestBuilder build() throws Exception;
    }
}
