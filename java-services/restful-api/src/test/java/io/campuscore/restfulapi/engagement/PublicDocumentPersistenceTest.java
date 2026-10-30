package io.campuscore.restfulapi.engagement;

import static io.campuscore.restfulapi.testsupport.CurrentAccountJwt.fixtureJwt;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.TimeZone;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.HttpHeaders;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.RequestPostProcessor;

/**
 * The public-documentation lane (publication-policy §5): a document is a
 * lifecycle shell whose content lives on revisions, the anonymous surface is
 * pinned to {@code publishedRevision} only, and unpublished or unknown slugs
 * answer the same 404. This suite is the {@code content-docs} gate evidence.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles({"test", "persistence"})
@TestPropertySource(properties = {
        "spring.flyway.enabled=false",
        "spring.datasource.url=jdbc:h2:mem:public_document;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1"
})
class PublicDocumentPersistenceTest {

    @Autowired
    private JdbcTemplate jdbc;

    @Autowired
    private MockMvc mvc;

    @Autowired
    private tools.jackson.databind.ObjectMapper objectMapper;

    @BeforeEach
    void prepareFixture() {
        jdbc.execute("CREATE SCHEMA IF NOT EXISTS \"engagement\"");
        jdbc.execute("CREATE SCHEMA IF NOT EXISTS \"campuscore_auth\"");
        jdbc.execute("""
                CREATE TABLE IF NOT EXISTS "campuscore_auth"."User" (
                    "id" VARCHAR(120) PRIMARY KEY,
                    "email" VARCHAR(320) NOT NULL,
                    "password" VARCHAR(200),
                    "firstName" VARCHAR(120),
                    "lastName" VARCHAR(120),
                    "status" VARCHAR(40) NOT NULL DEFAULT 'ACTIVE',
                    "mustChangePassword" BOOLEAN NOT NULL DEFAULT FALSE,
                    "isSuperAdmin" BOOLEAN,
                    "failedLoginAttempts" INTEGER,
                    "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    "updatedAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
                """);
        jdbc.execute("DELETE FROM \"campuscore_auth\".\"User\"");
        // Mirrors V136 — the real production shape, minus the Flyway history.
        jdbc.execute("DROP TABLE IF EXISTS \"engagement\".\"PublicDocumentAudit\"");
        jdbc.execute("DROP TABLE IF EXISTS \"engagement\".\"PublicDocumentTagMap\"");
        jdbc.execute("DROP TABLE IF EXISTS \"engagement\".\"PublicDocumentAttachment\"");
        jdbc.execute("DROP TABLE IF EXISTS \"engagement\".\"PublicDocumentRevision\"");
        jdbc.execute("DROP TABLE IF EXISTS \"engagement\".\"PublicDocument\"");
        jdbc.execute("DROP TABLE IF EXISTS \"engagement\".\"ArticleTag\"");
        // A look-alike private knowledge/RAG row must never surface through the
        // public document queries — the RAG-leak negative proves it.
        jdbc.execute("DROP TABLE IF EXISTS \"engagement\".\"AssistantKnowledge\"");
        jdbc.execute("""
                CREATE TABLE "engagement"."AssistantKnowledge" (
                    "id" VARCHAR(120) PRIMARY KEY,
                    "title" VARCHAR(240) NOT NULL,
                    "body" CLOB NOT NULL
                )
                """);
        jdbc.execute("""
                CREATE TABLE "engagement"."ArticleTag" (
                    "id" VARCHAR(60) PRIMARY KEY,
                    "name" VARCHAR(120)
                )
                """);
        jdbc.execute("""
                CREATE TABLE "engagement"."PublicDocument" (
                    "id" VARCHAR(120) PRIMARY KEY,
                    "slug" VARCHAR(240) NOT NULL,
                    "status" VARCHAR(30) NOT NULL DEFAULT 'DRAFT',
                    "authorId" VARCHAR(120) NOT NULL,
                    "currentRevision" INTEGER NOT NULL DEFAULT 1,
                    "publishedRevision" INTEGER,
                    "categoryId" VARCHAR(60),
                    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    CONSTRAINT public_document_status_ck
                        CHECK ("status" IN ('DRAFT', 'IN_REVIEW', 'PUBLISHED', 'ARCHIVED')),
                    CONSTRAINT public_document_revision_ck
                        CHECK ("publishedRevision" IS NULL OR "publishedRevision" <= "currentRevision")
                )
                """);
        jdbc.execute("""
                CREATE TABLE "engagement"."PublicDocumentRevision" (
                    "documentId" VARCHAR(120) NOT NULL
                        REFERENCES "engagement"."PublicDocument"("id") ON DELETE CASCADE,
                    "revision" INTEGER NOT NULL,
                    "state" VARCHAR(30) NOT NULL DEFAULT 'DRAFT',
                    "titleVi" VARCHAR(240) NOT NULL,
                    "titleEn" VARCHAR(240) NOT NULL,
                    "summaryVi" VARCHAR(500),
                    "summaryEn" VARCHAR(500),
                    "bodyVi" CLOB NOT NULL,
                    "bodyEn" CLOB NOT NULL,
                    "authorId" VARCHAR(120) NOT NULL,
                    "reviewerId" VARCHAR(120),
                    "reviewedAt" TIMESTAMP WITH TIME ZONE,
                    "reviewNote" VARCHAR(500),
                    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    PRIMARY KEY ("documentId", "revision"),
                    CONSTRAINT public_doc_revision_state_ck
                        CHECK ("state" IN ('DRAFT', 'IN_REVIEW', 'PUBLISHED', 'SUPERSEDED'))
                )
                """);
        jdbc.execute("""
                CREATE TABLE "engagement"."PublicDocumentAttachment" (
                    "id" VARCHAR(120) PRIMARY KEY,
                    "documentId" VARCHAR(120) NOT NULL
                        REFERENCES "engagement"."PublicDocument"("id") ON DELETE CASCADE,
                    "fileName" VARCHAR(255) NOT NULL,
                    "fileUrl" VARCHAR(500) NOT NULL,
                    "mimeType" VARCHAR(120) NOT NULL,
                    "fileSizeBytes" BIGINT NOT NULL,
                    "checksumSha256" VARCHAR(64),
                    "isPublic" BOOLEAN NOT NULL DEFAULT TRUE,
                    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    CONSTRAINT public_doc_attachment_mime_ck CHECK ("mimeType" IN (
                        'application/pdf',
                        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                        'application/zip'
                    )),
                    CONSTRAINT public_doc_attachment_size_ck
                        CHECK ("fileSizeBytes" > 0 AND "fileSizeBytes" <= 52428800)
                )
                """);
        jdbc.execute("""
                CREATE TABLE "engagement"."PublicDocumentTagMap" (
                    "documentId" VARCHAR(120) NOT NULL
                        REFERENCES "engagement"."PublicDocument"("id") ON DELETE CASCADE,
                    "tagId" VARCHAR(60) NOT NULL
                        REFERENCES "engagement"."ArticleTag"("id") ON DELETE CASCADE,
                    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    PRIMARY KEY ("documentId", "tagId")
                )
                """);
        jdbc.execute("""
                CREATE TABLE "engagement"."PublicDocumentAudit" (
                    "id" VARCHAR(120) PRIMARY KEY,
                    "documentId" VARCHAR(120) NOT NULL
                        REFERENCES "engagement"."PublicDocument"("id") ON DELETE CASCADE,
                    "action" VARCHAR(20) NOT NULL,
                    "actorId" VARCHAR(120) NOT NULL,
                    "actorLabel" VARCHAR(240),
                    "reason" VARCHAR(500) NOT NULL DEFAULT '',
                    "version" INTEGER NOT NULL,
                    "beforeState" CLOB,
                    "afterState" CLOB,
                    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    CONSTRAINT public_doc_audit_action_ck
                        CHECK ("action" IN ('CREATED', 'REVISED', 'SUBMITTED', 'APPROVED',
                                            'RETURNED', 'ARCHIVED', 'RESTORED'))
                )
                """);
        jdbc.update("INSERT INTO \"engagement\".\"ArticleTag\" (\"id\", \"name\") VALUES ('tag-guide', 'Hướng dẫn')");
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    private RequestPostProcessor admin(String subject) {
        return fixtureJwt(jdbc, subject, token -> token
                .subject(subject)
                .claim("email", subject + "@campuscore.edu")
                .claim("roles", java.util.List.of("ADMIN")), "ADMIN")
                .authorities(new SimpleGrantedAuthority("ROLE_ADMIN"));
    }

    private RequestPostProcessor lecturer(String subject) {
        return fixtureJwt(jdbc, subject, token -> token
                .subject(subject)
                .claim("email", subject + "@campuscore.edu")
                .claim("roles", java.util.List.of("LECTURER")), "LECTURER")
                .authorities(new SimpleGrantedAuthority("ROLE_LECTURER"));
    }

    private RequestPostProcessor student(String subject) {
        return fixtureJwt(jdbc, subject, token -> token
                .subject(subject)
                .claim("email", subject + "@campuscore.edu")
                .claim("roles", java.util.List.of("STUDENT")), "STUDENT")
                .authorities(new SimpleGrantedAuthority("ROLE_STUDENT"));
    }

    private static String contentJson(String slug, String titleVi, String titleEn, String bodyVi, String bodyEn) {
        return "{"
                + "\"slug\": \"" + slug + "\","
                + "\"titleVi\": \"" + titleVi + "\","
                + "\"titleEn\": \"" + titleEn + "\","
                + "\"summaryVi\": \"Tóm tắt " + titleVi + "\","
                + "\"summaryEn\": \"Summary " + titleEn + "\","
                + "\"bodyVi\": \"" + bodyVi + "\","
                + "\"bodyEn\": \"" + bodyEn + "\""
                + "}";
    }

    /** Creates a doc as {@code author}, submits it, and approves it as admin. */
    private String publishDoc(String slug, String titleVi, String titleEn, String bodyVi, String bodyEn)
            throws Exception {
        String id = createDoc(slug, "lecturer-1", titleVi, titleEn, bodyVi, bodyEn);
        submit(id, "lecturer-1");
        approve(id, "admin-1");
        return id;
    }

    private String createDoc(String slug, String author, String titleVi, String titleEn,
            String bodyVi, String bodyEn) throws Exception {
        String response = mvc.perform(post("/api/v1/docs")
                        .contentType("application/json")
                        .content(contentJson(slug, titleVi, titleEn, bodyVi, bodyEn))
                        .with(author.startsWith("admin") ? admin(author) : lecturer(author)))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        return objectMapper.readTree(response).get("id").asText();
    }

    private void submit(String id, String actor) throws Exception {
        mvc.perform(post("/api/v1/docs/" + id + "/submit")
                        .with(actor.startsWith("admin") ? admin(actor) : lecturer(actor)))
                .andExpect(status().isOk());
    }

    private void approve(String id, String actor) throws Exception {
        mvc.perform(post("/api/v1/docs/" + id + "/approve")
                        .with(admin(actor)))
                .andExpect(status().isOk());
    }

    private void insertAttachment(String id, String documentId, boolean isPublic) {
        jdbc.update("INSERT INTO \"engagement\".\"PublicDocumentAttachment\" ("
                        + "\"id\", \"documentId\", \"fileName\", \"fileUrl\", \"mimeType\","
                        + " \"fileSizeBytes\", \"isPublic\") VALUES (?, ?, ?, ?, 'application/pdf', 1024, ?)",
                id, documentId, "quy-che.pdf", "https://files.example.test/" + id + ".pdf", isPublic);
    }

    // ------------------------------------------------------------------
    // Lifecycle
    // ------------------------------------------------------------------

    @Test
    void createSubmitApprovePublishesAndAnonymousReadIsNoStore() throws Exception {
        String id = createDoc("quy-che-dao-tao", "lecturer-1",
                "Quy chế đào tạo", "Training regulations",
                "<p>Nội dung quy chế</p>", "<p>Regulations body</p>");

        // Fresh create: DRAFT shell + DRAFT head revision 1.
        mvc.perform(get("/api/v1/docs/" + id).with(admin("admin-1")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("DRAFT"))
                .andExpect(jsonPath("$.currentRevision").value(1))
                .andExpect(jsonPath("$.publishedRevision").doesNotExist())
                .andExpect(jsonPath("$.headRevision.revision").value(1))
                .andExpect(jsonPath("$.headRevision.state").value("DRAFT"))
                .andExpect(jsonPath("$.headRevision.authorId").value("lecturer-1"));

        // Anonymous surface: nothing exists yet — a draft slug is a 404.
        mvc.perform(get("/api/v1/public/docs/quy-che-dao-tao"))
                .andExpect(status().isNotFound())
                .andExpect(header().string(HttpHeaders.CACHE_CONTROL, "no-store"));

        submit(id, "lecturer-1");
        mvc.perform(get("/api/v1/docs/" + id).with(admin("admin-1")))
                .andExpect(jsonPath("$.status").value("IN_REVIEW"))
                .andExpect(jsonPath("$.headRevision.state").value("IN_REVIEW"));

        approve(id, "admin-1");
        mvc.perform(get("/api/v1/docs/" + id).with(admin("admin-1")))
                .andExpect(jsonPath("$.status").value("PUBLISHED"))
                .andExpect(jsonPath("$.publishedRevision").value(1))
                .andExpect(jsonPath("$.headRevision.state").value("PUBLISHED"))
                .andExpect(jsonPath("$.headRevision.reviewerId").value("admin-1"));

        // Anonymous detail now serves the published revision, no-store.
        mvc.perform(get("/api/v1/public/docs/quy-che-dao-tao"))
                .andExpect(status().isOk())
                .andExpect(header().string(HttpHeaders.CACHE_CONTROL, "no-store"))
                .andExpect(jsonPath("$.slug").value("quy-che-dao-tao"))
                .andExpect(jsonPath("$.publishedRevision").value(1))
                .andExpect(jsonPath("$.superseded").value(false))
                .andExpect(jsonPath("$.titleVi").value("Quy chế đào tạo"))
                .andExpect(jsonPath("$.bodyEn").value("<p>Regulations body</p>"))
                .andExpect(jsonPath("$.id").doesNotExist())
                .andExpect(jsonPath("$.authorId").doesNotExist())
                .andExpect(jsonPath("$.status").doesNotExist());

        // Anonymous list contains the live doc.
        mvc.perform(get("/api/v1/public/docs"))
                .andExpect(status().isOk())
                .andExpect(header().string(HttpHeaders.CACHE_CONTROL, "no-store"))
                .andExpect(jsonPath("$.meta.total").value(1))
                .andExpect(jsonPath("$.data[0].slug").value("quy-che-dao-tao"))
                .andExpect(jsonPath("$.data[0].bodyVi").doesNotExist());

        // The audit trail captured every transition with the acting subject.
        Integer actions = jdbc.queryForObject(
                "SELECT COUNT(*) FROM \"engagement\".\"PublicDocumentAudit\""
                        + " WHERE \"documentId\" = '" + id + "'"
                        + " AND \"action\" IN ('CREATED', 'SUBMITTED', 'APPROVED')",
                Integer.class);
        org.assertj.core.api.Assertions.assertThat(actions).isEqualTo(3);
    }

    @Test
    void selfApproveIsRejectedAndReturnRequiresReason() throws Exception {
        String id = createDoc("self-approve", "lecturer-1",
                "Tự duyệt", "Self approve", "<p>a</p>", "<p>b</p>");
        submit(id, "lecturer-1");

        // Same subject cannot approve their own revision.
        mvc.perform(post("/api/v1/docs/" + id + "/approve")
                        .with(lecturer("lecturer-1")))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("REVIEWER_EQUALS_AUTHOR"));

        // Return without a reason is a validation failure, not a transition.
        mvc.perform(post("/api/v1/docs/" + id + "/return")
                        .contentType("application/json").content("{}")
                        .with(admin("admin-1")))
                .andExpect(status().isBadRequest());

        mvc.perform(post("/api/v1/docs/" + id + "/return")
                        .contentType("application/json").content("{\"reason\": \"Bổ sung bảng điểm\"}")
                        .with(admin("admin-1")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("DRAFT"))
                .andExpect(jsonPath("$.headRevision.state").value("DRAFT"))
                .andExpect(jsonPath("$.headRevision.reviewNote").value("Bổ sung bảng điểm"))
                .andExpect(jsonPath("$.headRevision.reviewerId").value("admin-1"));
    }

    @Test
    void editingWhilePublishedServesOldRevisionAndPermalinksAreBounded() throws Exception {
        String id = publishDoc("perm-test", "Quy định v1", "Regulation v1",
                "<p>Nội dung v1</p>", "<p>Body v1</p>");

        // A PUT while published creates head revision 2 in DRAFT — the public
        // surface keeps serving revision 1 uninterrupted.
        mvc.perform(put("/api/v1/docs/" + id)
                        .contentType("application/json")
                        .content(contentJson("perm-test", "Quy định v2", "Regulation v2",
                                "<p>Nội dung v2 draft</p>", "<p>Body v2 draft</p>"))
                        .with(lecturer("lecturer-1")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.currentRevision").value(2))
                .andExpect(jsonPath("$.publishedRevision").value(1))
                .andExpect(jsonPath("$.headRevision.revision").value(2))
                .andExpect(jsonPath("$.headRevision.state").value("DRAFT"));

        // Public detail still serves v1 — the draft head text cannot leak.
        mvc.perform(get("/api/v1/public/docs/perm-test"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.titleVi").value("Quy định v1"))
                .andExpect(jsonPath("$.bodyVi").value("<p>Nội dung v1</p>"));

        // Permalink boundary: v1 serves, v2 is beyond publishedRevision -> 404.
        mvc.perform(get("/api/v1/public/docs/perm-test/revisions/1"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.titleVi").value("Quy định v1"))
                .andExpect(jsonPath("$.superseded").value(false));
        mvc.perform(get("/api/v1/public/docs/perm-test/revisions/2"))
                .andExpect(status().isNotFound());

        // Publish v2: v1 becomes SUPERSEDED but stays permalink-addressable.
        submit(id, "lecturer-1");
        approve(id, "admin-1");
        mvc.perform(get("/api/v1/public/docs/perm-test"))
                .andExpect(jsonPath("$.publishedRevision").value(2))
                .andExpect(jsonPath("$.titleVi").value("Quy định v2"))
                .andExpect(jsonPath("$.superseded").value(false));
        mvc.perform(get("/api/v1/public/docs/perm-test/revisions/1"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.titleVi").value("Quy định v1"))
                .andExpect(jsonPath("$.superseded").value(true));
        mvc.perform(get("/api/v1/public/docs/perm-test/revisions/3"))
                .andExpect(status().isNotFound());
    }

    @Test
    void archiveUnpublishesAndRestoreRequiresFreshReview() throws Exception {
        String id = publishDoc("archive-me", "Sẽ lưu trữ", "To archive",
                "<p>đã duyệt</p>", "<p>approved</p>");

        mvc.perform(get("/api/v1/public/docs/archive-me")).andExpect(status().isOk());

        // Archive unpublishes immediately — the public detail is a 404.
        mvc.perform(post("/api/v1/docs/" + id + "/archive")
                        .contentType("application/json").content("{\"reason\": \"Hết hiệu lực\"}")
                        .with(admin("admin-1")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("ARCHIVED"));
        mvc.perform(get("/api/v1/public/docs/archive-me")).andExpect(status().isNotFound());

        // Restore lands the doc back at DRAFT — still 404 publicly — and the
        // old published revision does not resurrect itself.
        mvc.perform(post("/api/v1/docs/" + id + "/restore")
                        .contentType("application/json").content("{\"reason\": \"Tái sử dụng\"}")
                        .with(admin("admin-1")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("DRAFT"));
        mvc.perform(get("/api/v1/public/docs/archive-me")).andExpect(status().isNotFound());

        // Republishing needs a fresh revision cycle: PUT -> submit -> approve.
        mvc.perform(put("/api/v1/docs/" + id)
                        .contentType("application/json")
                        .content(contentJson("archive-me", "Phiên bản mới", "New edition",
                                "<p>bản mới</p>", "<p>new body</p>"))
                        .with(admin("admin-1")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.headRevision.revision").value(2));
        mvc.perform(post("/api/v1/docs/" + id + "/submit").with(admin("admin-1")))
                .andExpect(status().isOk());
        mvc.perform(post("/api/v1/docs/" + id + "/approve").with(admin("admin-2")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.publishedRevision").value(2));
        mvc.perform(get("/api/v1/public/docs/archive-me"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.titleVi").value("Phiên bản mới"));
    }

    @Test
    void publishedAtIsTheApprovalInstantNotTheDraftInstant() throws Exception {
        String earlierDraft = publishDoc("doc-earlier-draft", "Dự thảo sớm", "Earlier draft",
                "<p>bản 1</p>", "<p>body one</p>");
        String laterDraft = publishDoc("doc-later-draft", "Dự thảo muộn", "Later draft",
                "<p>bản 2</p>", "<p>body two</p>");

        // Deterministic history: the first doc was drafted Monday and approved
        // Friday; the second drafted Tuesday and approved Thursday. Written
        // with a non-UTC offset — only the instants matter.
        Instant mondayDraft = Instant.parse("2026-10-26T01:30:00Z");
        Instant tuesdayDraft = Instant.parse("2026-10-27T01:30:00Z");
        Instant thursdayApproval = Instant.parse("2026-10-29T02:15:00Z");
        Instant fridayApproval = Instant.parse("2026-10-30T02:15:00Z");
        jdbc.update("UPDATE \"engagement\".\"PublicDocumentRevision\""
                        + " SET \"createdAt\" = ?, \"reviewedAt\" = ? WHERE \"documentId\" = ?",
                OffsetDateTime.ofInstant(mondayDraft, ZoneOffset.ofHours(7)),
                OffsetDateTime.ofInstant(fridayApproval, ZoneOffset.ofHours(7)),
                earlierDraft);
        jdbc.update("UPDATE \"engagement\".\"PublicDocumentRevision\""
                        + " SET \"createdAt\" = ?, \"reviewedAt\" = ? WHERE \"documentId\" = ?",
                OffsetDateTime.ofInstant(tuesdayDraft, ZoneOffset.ofHours(7)),
                OffsetDateTime.ofInstant(thursdayApproval, ZoneOffset.ofHours(7)),
                laterDraft);

        TimeZone originalZone = TimeZone.getDefault();
        try {
            // A JVM zone far from UTC must not shift the projected instant.
            TimeZone.setDefault(TimeZone.getTimeZone("Pacific/Kiritimati"));

            String detail = mvc.perform(get("/api/v1/public/docs/doc-earlier-draft"))
                    .andExpect(status().isOk())
                    .andReturn().getResponse().getContentAsString();
            org.assertj.core.api.Assertions.assertThat(
                    Instant.parse(objectMapper.readTree(detail).get("publishedAt").asText()))
                    .isEqualTo(fridayApproval);

            String permalink = mvc.perform(get("/api/v1/public/docs/doc-earlier-draft/revisions/1"))
                    .andExpect(status().isOk())
                    .andReturn().getResponse().getContentAsString();
            org.assertj.core.api.Assertions.assertThat(
                    Instant.parse(objectMapper.readTree(permalink).get("publishedAt").asText()))
                    .isEqualTo(fridayApproval);

            // The list both reports and orders by the approval instant: the
            // Friday approval outranks the later-drafted Thursday approval.
            String list = mvc.perform(get("/api/v1/public/docs"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.meta.total").value(2))
                    .andExpect(jsonPath("$.data[0].slug").value("doc-earlier-draft"))
                    .andExpect(jsonPath("$.data[1].slug").value("doc-later-draft"))
                    .andReturn().getResponse().getContentAsString();
            org.assertj.core.api.Assertions.assertThat(
                    Instant.parse(objectMapper.readTree(list).get("data").get(0).get("publishedAt").asText()))
                    .isEqualTo(fridayApproval);
        } finally {
            TimeZone.setDefault(originalZone);
        }

        // While the next revision sits in review the live row is untouched:
        // still the approved content and still the same approval instant.
        mvc.perform(put("/api/v1/docs/" + earlierDraft)
                        .contentType("application/json")
                        .content(contentJson("doc-earlier-draft", "Bản nháp hai", "Draft two",
                                "<p>nháp 2</p>", "<p>draft two body</p>"))
                        .with(lecturer("lecturer-1")))
                .andExpect(status().isOk());
        mvc.perform(post("/api/v1/docs/" + earlierDraft + "/submit").with(lecturer("lecturer-1")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("PUBLISHED"))
                .andExpect(jsonPath("$.headRevision.state").value("IN_REVIEW"));
        String stillLive = mvc.perform(get("/api/v1/public/docs/doc-earlier-draft"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.titleVi").value("Dự thảo sớm"))
                .andExpect(jsonPath("$.bodyEn").value("<p>body one</p>"))
                .andReturn().getResponse().getContentAsString();
        org.assertj.core.api.Assertions.assertThat(
                Instant.parse(objectMapper.readTree(stillLive).get("publishedAt").asText()))
                .isEqualTo(fridayApproval);
    }

    @Test
    void restoredLiveDocumentReentersReviewQueue() throws Exception {
        String id = publishDoc("restore-queue", "Quy chế cũ", "Old regulation",
                "<p>bản cũ</p>", "<p>old body</p>");

        mvc.perform(post("/api/v1/docs/" + id + "/archive")
                        .contentType("application/json").content("{\"reason\": \"Tạm ngưng\"}")
                        .with(admin("admin-1")))
                .andExpect(status().isOk());
        mvc.perform(post("/api/v1/docs/" + id + "/restore")
                        .contentType("application/json").content("{\"reason\": \"Soạn lại\"}")
                        .with(admin("admin-1")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("DRAFT"));

        // The restored doc keeps publishedRevision only as history — a fresh
        // revision cycle is required, and its submitted head must re-enter
        // the review queue despite that history row.
        mvc.perform(put("/api/v1/docs/" + id)
                        .contentType("application/json")
                        .content(contentJson("restore-queue", "Quy chế mới", "New regulation",
                                "<p>nháp mới</p>", "<p>new draft body</p>"))
                        .with(lecturer("lecturer-1")))
                .andExpect(status().isOk());
        mvc.perform(post("/api/v1/docs/" + id + "/submit").with(lecturer("lecturer-1")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("IN_REVIEW"))
                .andExpect(jsonPath("$.headRevision.state").value("IN_REVIEW"));

        // Discovery: the staff IN_REVIEW filter and a foreign lecturer's
        // queue scope both see it; the anonymous surface still answers 404.
        mvc.perform(get("/api/v1/docs").queryParam("status", "IN_REVIEW").with(admin("admin-1")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.meta.total").value(1))
                .andExpect(jsonPath("$.data[0].slug").value("restore-queue"));
        mvc.perform(get("/api/v1/docs").with(lecturer("lecturer-2")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.meta.total").value(1))
                .andExpect(jsonPath("$.data[0].slug").value("restore-queue"));
        mvc.perform(get("/api/v1/public/docs/restore-queue")).andExpect(status().isNotFound());

        // Self-approval stays refused; a return must drop the shell back to
        // DRAFT even though a history publishedRevision row remains.
        mvc.perform(post("/api/v1/docs/" + id + "/approve").with(lecturer("lecturer-1")))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("REVIEWER_EQUALS_AUTHOR"));
        mvc.perform(post("/api/v1/docs/" + id + "/return")
                        .contentType("application/json").content("{\"reason\": \"Bổ sung nội dung\"}")
                        .with(admin("admin-1")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("DRAFT"))
                .andExpect(jsonPath("$.headRevision.state").value("DRAFT"));
        mvc.perform(get("/api/v1/docs").queryParam("status", "IN_REVIEW").with(admin("admin-1")))
                .andExpect(jsonPath("$.meta.total").value(0));

        // Resubmit and approve by a different reviewer: revision 2 goes live
        // and revision 1 stays permalink-addressable as superseded history.
        submit(id, "lecturer-1");
        approve(id, "admin-2");
        mvc.perform(get("/api/v1/docs/" + id).with(admin("admin-1")))
                .andExpect(jsonPath("$.status").value("PUBLISHED"))
                .andExpect(jsonPath("$.publishedRevision").value(2));
        mvc.perform(get("/api/v1/public/docs/restore-queue"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.titleVi").value("Quy chế mới"))
                .andExpect(jsonPath("$.bodyEn").value("<p>new draft body</p>"));
        mvc.perform(get("/api/v1/public/docs/restore-queue/revisions/1"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.superseded").value(true));
    }

    @Test
    void restoredInReviewHeadRejoinsReviewQueue() throws Exception {
        String id = createDoc("mid-review", "lecturer-1", "Đang chờ duyệt", "Awaiting review",
                "<p>nháp</p>", "<p>draft body</p>");
        submit(id, "lecturer-1");

        mvc.perform(post("/api/v1/docs/" + id + "/archive")
                        .contentType("application/json").content("{\"reason\": \"Tạm cất\"}")
                        .with(admin("admin-1")))
                .andExpect(status().isOk());

        // The head never left review — restoring must land the shell back in
        // IN_REVIEW so the queue finds it again; nothing becomes public.
        mvc.perform(post("/api/v1/docs/" + id + "/restore")
                        .contentType("application/json").content("{\"reason\": \"Duyệt tiếp\"}")
                        .with(admin("admin-1")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("IN_REVIEW"))
                .andExpect(jsonPath("$.headRevision.state").value("IN_REVIEW"));

        mvc.perform(get("/api/v1/docs").queryParam("status", "IN_REVIEW").with(admin("admin-1")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.meta.total").value(1))
                .andExpect(jsonPath("$.data[0].slug").value("mid-review"));
        mvc.perform(get("/api/v1/public/docs/mid-review")).andExpect(status().isNotFound());

        approve(id, "admin-1");
        mvc.perform(get("/api/v1/public/docs/mid-review"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.publishedRevision").value(1));
    }

    // ------------------------------------------------------------------
    // Anonymous surface invariants
    // ------------------------------------------------------------------

    @Test
    void unknownAndUnpublishedSlugsShareOne404() throws Exception {
        createDoc("draft-only", "lecturer-1", "Bản nháp", "Draft only", "<p>x</p>", "<p>y</p>");

        // Unknown slug, draft slug, malformed slug — all the same 404.
        mvc.perform(get("/api/v1/public/docs/does-not-exist")).andExpect(status().isNotFound());
        mvc.perform(get("/api/v1/public/docs/draft-only")).andExpect(status().isNotFound());
        mvc.perform(get("/api/v1/public/docs/UPPERCASE_SLUG!!")).andExpect(status().isNotFound());
        mvc.perform(get("/api/v1/public/docs/draft-only/revisions/1")).andExpect(status().isNotFound());
    }

    @Test
    void publicSearchFoldsVietnameseDiacriticsAndNeverTouchesKnowledgeRows() throws Exception {
        publishDoc("quy-dinh-hoc-vu", "Quy định học vụ", "Academic regulations",
                "<p>Nội dung học vụ chi tiết</p>", "<p>Academic body</p>");
        publishDoc("thu-vien", "Hướng dẫn thư viện", "Library guide",
                "<p>Mượn sách</p>", "<p>Borrowing books</p>");

        // A private RAG/knowledge row carrying a unique term must be invisible
        // to document search — the query only reads PublicDocument* tables.
        jdbc.update("INSERT INTO \"engagement\".\"AssistantKnowledge\" (\"id\", \"title\", \"body\")"
                + " VALUES ('rag-1', 'internal memo', 'ragleaksecretterm top secret')");

        // Diacritic-folded VI search: "hoc vu" finds "học vụ".
        mvc.perform(get("/api/v1/public/docs").queryParam("search", "hoc vu"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.meta.total").value(1))
                .andExpect(jsonPath("$.data[0].slug").value("quy-dinh-hoc-vu"));

        // Full VI spelling also matches.
        mvc.perform(get("/api/v1/public/docs").queryParam("search", "học vụ"))
                .andExpect(jsonPath("$.meta.total").value(1));

        // EN search reaches titleEn/summaryEn/bodyEn columns.
        mvc.perform(get("/api/v1/public/docs").queryParam("search", "regulations"))
                .andExpect(jsonPath("$.meta.total").value(1))
                .andExpect(jsonPath("$.data[0].slug").value("quy-dinh-hoc-vu"));
        mvc.perform(get("/api/v1/public/docs").queryParam("search", "borrowing"))
                .andExpect(jsonPath("$.meta.total").value(1))
                .andExpect(jsonPath("$.data[0].slug").value("thu-vien"));

        // The knowledge-table term finds nothing — no leak across lanes.
        mvc.perform(get("/api/v1/public/docs").queryParam("search", "ragleaksecretterm"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.meta.total").value(0))
                .andExpect(jsonPath("$.data.length()").value(0));
    }

    @Test
    void attachmentGateFollowsParentPublicationState() throws Exception {
        String id = createDoc("attach-doc", "lecturer-1", "Tài liệu đính kèm", "Attached doc",
                "<p>x</p>", "<p>y</p>");
        insertAttachment("att-public", id, true);
        insertAttachment("att-private", id, false);

        // Draft parent: attachments are invisible even though the rows exist.
        mvc.perform(get("/api/v1/public/docs/attach-doc/attachments/att-public"))
                .andExpect(status().isNotFound());

        submit(id, "lecturer-1");
        approve(id, "admin-1");

        // Published parent + isPublic row: metadata serves, no-store.
        mvc.perform(get("/api/v1/public/docs/attach-doc/attachments/att-public"))
                .andExpect(status().isOk())
                .andExpect(header().string(HttpHeaders.CACHE_CONTROL, "no-store"))
                .andExpect(jsonPath("$.id").value("att-public"))
                .andExpect(jsonPath("$.fileName").value("quy-che.pdf"))
                .andExpect(jsonPath("$.mimeType").value("application/pdf"));

        // isPublic=false stays hidden even on a live document.
        mvc.perform(get("/api/v1/public/docs/attach-doc/attachments/att-private"))
                .andExpect(status().isNotFound());

        // Archive re-hides the attachment instantly.
        mvc.perform(post("/api/v1/docs/" + id + "/archive")
                        .contentType("application/json").content("{\"reason\": \"gone\"}")
                        .with(admin("admin-1")))
                .andExpect(status().isOk());
        mvc.perform(get("/api/v1/public/docs/attach-doc/attachments/att-public"))
                .andExpect(status().isNotFound());
    }

    // ------------------------------------------------------------------
    // Staff scope
    // ------------------------------------------------------------------

    @Test
    void lecturerListIsScopedToOwnDocsAndReviewQueue() throws Exception {
        String own = createDoc("lec-own", "lecturer-1", "Của giảng viên 1", "Lecturer one",
                "<p>1</p>", "<p>1</p>");
        String queue = createDoc("lec-queue", "lecturer-2", "Hàng chờ", "Queue doc",
                "<p>2</p>", "<p>2</p>");
        String otherPublished = publishDoc("lec-other", "Của người khác", "Other doc",
                "<p>3</p>", "<p>3</p>"); // author lecturer-1? no — publishDoc creates as lecturer-1
        // otherPublished was authored by lecturer-1 via publishDoc — recreate a
        // doc authored by lecturer-2 and published to be truly foreign.
        jdbc.update("DELETE FROM \"engagement\".\"PublicDocument\" WHERE \"id\" = '" + otherPublished + "'");
        String foreign = createDoc("lec-foreign", "lecturer-2", "Người khác xuất bản", "Foreign published",
                "<p>4</p>", "<p>4</p>");
        submit(foreign, "lecturer-2");
        approve(foreign, "admin-1");
        submit(queue, "lecturer-2");

        // lecturer-1 sees: own draft + the in-review queue doc — not the
        // foreign PUBLISHED doc.
        mvc.perform(get("/api/v1/docs").with(lecturer("lecturer-1")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.meta.total").value(2))
                .andExpect(jsonPath("$.data[?(@.slug == 'lec-own')]").exists())
                .andExpect(jsonPath("$.data[?(@.slug == 'lec-queue')]").exists())
                .andExpect(jsonPath("$.data[?(@.slug == 'lec-foreign')]").doesNotExist());

        // Admin sees all three.
        mvc.perform(get("/api/v1/docs").with(admin("admin-1")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.meta.total").value(3));

        // lecturer-1 cannot mutate a doc authored by lecturer-2.
        mvc.perform(put("/api/v1/docs/" + foreign)
                        .contentType("application/json")
                        .content(contentJson("lec-foreign", "T", "T", "<p>x</p>", "<p>y</p>"))
                        .with(lecturer("lecturer-1")))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("DOCUMENT_NOT_AUTHOR"));

        // Students have no staff lane at all.
        mvc.perform(get("/api/v1/docs").with(student("student-1")))
                .andExpect(status().isForbidden());
    }

    @Test
    void wrongStateTransitionsAndSlugConflictsAreRejected() throws Exception {
        String id = createDoc("state-test", "lecturer-1", "Trạng thái", "State",
                "<p>x</p>", "<p>y</p>");

        // Approve on a DRAFT head: wrong-state, not a silent no-op.
        mvc.perform(post("/api/v1/docs/" + id + "/approve").with(admin("admin-1")))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("DOCUMENT_INVALID_STATE"));

        // Submit by a non-author, non-governance lecturer is refused.
        mvc.perform(post("/api/v1/docs/" + id + "/submit").with(lecturer("lecturer-2")))
                .andExpect(status().isForbidden());

        // Duplicate slug rejected on create.
        mvc.perform(post("/api/v1/docs")
                        .contentType("application/json")
                        .content(contentJson("state-test", "Khác", "Other", "<p>a</p>", "<p>b</p>"))
                        .with(admin("admin-1")))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("DOCUMENT_SLUG_TAKEN"));

        // Slug mutation on PUT is refused — permalinks must stay stable.
        mvc.perform(put("/api/v1/docs/" + id)
                        .contentType("application/json")
                        .content(contentJson("state-test-renamed", "T", "T", "<p>a</p>", "<p>b</p>"))
                        .with(lecturer("lecturer-1")))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("DOCUMENT_SLUG_IMMUTABLE"));
    }

    @Test
    void sanitizedBodiesStripScriptOnWrite() throws Exception {
        String id = publishDoc("san-doc", "Vệ sinh", "Sanitized",
                "<p>ok</p><script>alert(1)</script>", "<p>fine</p><iframe src=x></iframe>");
        mvc.perform(get("/api/v1/public/docs/san-doc"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.bodyVi").value("<p>ok</p>"))
                .andExpect(jsonPath("$.bodyEn").value("<p>fine</p>"));
        String stored = jdbc.queryForObject(
                "SELECT \"bodyVi\" FROM \"engagement\".\"PublicDocumentRevision\""
                        + " WHERE \"documentId\" = '" + id + "' AND \"revision\" = 1",
                String.class);
        org.assertj.core.api.Assertions.assertThat(stored).doesNotContain("script");
    }
}
