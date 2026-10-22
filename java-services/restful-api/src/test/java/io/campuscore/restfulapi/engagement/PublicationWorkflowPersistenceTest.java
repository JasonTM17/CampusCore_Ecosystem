package io.campuscore.restfulapi.engagement;

import static io.campuscore.restfulapi.testsupport.CurrentAccountJwt.fixtureJwt;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import io.campuscore.restfulapi.testsupport.AccountAuthorityFixture;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.RequestPostProcessor;

/**
 * content-lifecycle gate (publication-policy §3): the announcement workflow
 * endpoints as one evidence class — DRAFT on create, author-only submit,
 * reviewer-not-author approve binding {@code publishedRevision}, mandatory
 * return reason, expired-window approve guard, archive/restore-to-DRAFT,
 * edit blocked outside DRAFT, notification gating, status filters, and the
 * lecturer review-queue scope. Adjacent suites cover the rest: fan-out roster
 * semantics live in {@code AnnouncementStudentFanoutPersistenceTest}, legacy
 * write shapes in {@code AnnouncementWritePersistenceTest}.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles({"test", "persistence"})
@TestPropertySource(properties = {
        "spring.flyway.enabled=false",
        "spring.datasource.url=jdbc:h2:mem:repair_PublicationWorkflowPersistenceTest;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1"
})
class PublicationWorkflowPersistenceTest {

    @Autowired
    private JdbcTemplate jdbc;

    @Autowired
    private MockMvc mvc;

    @Autowired
    private tools.jackson.databind.ObjectMapper objectMapper;

    @BeforeEach
    void prepareFixture() {
        jdbc.execute("CREATE SCHEMA IF NOT EXISTS \"engagement\"");
        jdbc.execute("CREATE SCHEMA IF NOT EXISTS academic");
        jdbc.execute("CREATE SCHEMA IF NOT EXISTS notifications");
        AccountAuthorityFixture.ensureSchema(jdbc);
        jdbc.execute("DROP TABLE IF EXISTS \"engagement\".\"AnnouncementAudit\"");
        jdbc.execute("DROP TABLE IF EXISTS \"engagement\".\"Announcement\"");
        jdbc.execute("""
                CREATE TABLE "engagement"."Announcement" (
                    "id" VARCHAR(120) PRIMARY KEY,
                    "title" VARCHAR(240) NOT NULL,
                    "content" TEXT NOT NULL,
                    "priority" VARCHAR(20) NOT NULL,
                    "targetRoles" VARCHAR ARRAY NOT NULL,
                    "targetYears" INTEGER ARRAY NOT NULL,
                    "isGlobal" BOOLEAN NOT NULL,
                    "publishAt" TIMESTAMP WITH TIME ZONE,
                    "expiresAt" TIMESTAMP WITH TIME ZONE,
                    "publishedBy" VARCHAR(120),
                    "semesterId" VARCHAR(120),
                    "semesterName" VARCHAR(200),
                    "sectionId" VARCHAR(120),
                    "sectionNumber" VARCHAR(80),
                    "courseCode" VARCHAR(80),
                    "courseName" VARCHAR(200),
                    "lecturerId" VARCHAR(120),
                    "lecturerDisplayName" VARCHAR(200),
                    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL,
                    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL,
                    "version" INTEGER NOT NULL DEFAULT 0,
                    "archivedAt" TIMESTAMP WITH TIME ZONE,
                    "archivedBy" VARCHAR(120),
                    "status" VARCHAR(30) NOT NULL DEFAULT 'DRAFT',
                    "authorId" VARCHAR(120),
                    "reviewerId" VARCHAR(120),
                    "reviewedAt" TIMESTAMP WITH TIME ZONE,
                    "reviewNote" VARCHAR(500),
                    "publishedRevision" INTEGER,
                    "displayOrder" INTEGER,
                    "notifiedAt" TIMESTAMP WITH TIME ZONE
                )
                """);
        jdbc.execute("""
                CREATE TABLE "engagement"."AnnouncementAudit" (
                    "id" VARCHAR(120) PRIMARY KEY,
                    "announcementId" VARCHAR(120) NOT NULL,
                    "action" VARCHAR(20) NOT NULL,
                    "actorId" VARCHAR(120) NOT NULL,
                    "actorLabel" VARCHAR(240),
                    "reason" VARCHAR(500) NOT NULL,
                    "version" INTEGER NOT NULL,
                    "beforeState" CLOB,
                    "afterState" CLOB,
                    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL
                )
                """);
        // Fan-out roster (academic."Student" -> auth account) + inbox table.
        jdbc.execute("DROP TABLE IF EXISTS academic.\"Student\"");
        jdbc.execute("""
                CREATE TABLE academic."Student" (
                    "id" VARCHAR(120) PRIMARY KEY,
                    "userId" VARCHAR(120),
                    "studentId" VARCHAR(120),
                    "year" INTEGER,
                    "status" VARCHAR(40) NOT NULL DEFAULT 'ACTIVE'
                )
                """);
        jdbc.execute("DROP TABLE IF EXISTS academic.\"Enrollment\"");
        jdbc.execute("""
                CREATE TABLE academic."Enrollment" (
                    "id" VARCHAR(120) PRIMARY KEY,
                    "studentId" VARCHAR(120) NOT NULL,
                    "sectionId" VARCHAR(120) NOT NULL,
                    "semesterId" VARCHAR(120) NOT NULL,
                    "status" VARCHAR(40) NOT NULL
                )
                """);
        jdbc.execute("DROP TABLE IF EXISTS notifications.notification");
        jdbc.execute("""
                CREATE TABLE notifications.notification (
                    id VARCHAR(120) PRIMARY KEY,
                    user_id VARCHAR(120) NOT NULL,
                    title VARCHAR(240) NOT NULL,
                    message VARCHAR(2000) NOT NULL,
                    type VARCHAR(40) NOT NULL,
                    link VARCHAR(500),
                    is_read BOOLEAN NOT NULL DEFAULT FALSE,
                    read_at TIMESTAMP,
                    created_at TIMESTAMP NOT NULL,
                    updated_at TIMESTAMP NOT NULL
                )
                """);
        // One ACTIVE student with a live auth account — the only inbox target.
        jdbc.update("""
                INSERT INTO academic."Student" ("id", "userId", "studentId", "year", "status")
                VALUES ('wf-st-1', 'wf-student-u', 'DH01', 1, 'ACTIVE')
                """);
        jdbc.update("""
                INSERT INTO academic."Enrollment" ("id", "studentId", "sectionId", "semesterId", "status")
                VALUES ('wf-en-1', 'wf-st-1', 'section-1', 'semester-1', 'ENROLLED')
                """);
        // The fan-out roster joins academic."Student" to campuscore_auth."User",
        // so the recipient needs the auth account too — the profile row alone
        // only satisfies the account-state gate on student JWTs.
        AccountAuthorityFixture.ensureUser(jdbc, "wf-student-u");
        AccountAuthorityFixture.student(jdbc, "wf-student-u", "wf-st-1", 1);
        AccountAuthorityFixture.lecturer(jdbc, "wf-lect-u", "wf-lect-1");
        AccountAuthorityFixture.lecturer(jdbc, "wf-lect-other", "wf-lect-2");
    }

    // ------------------------------------------------------------------
    // Happy path + audit
    // ------------------------------------------------------------------

    @Test
    void draftSubmitApproveBindsPublishedRevisionAndWritesAuditTrail() throws Exception {
        String id = createDraft(admin("admin-1"), "Orientation week", "Welcome events.", null);

        Map<String, Object> row = jdbc.queryForMap(
                "SELECT \"status\", \"authorId\", \"publishedRevision\", \"notifiedAt\""
                        + " FROM \"engagement\".\"Announcement\" WHERE \"id\" = ?", id);
        assertEquals("DRAFT", row.get("status"));
        assertEquals("admin-1", row.get("authorId"));
        assertNull(row.get("publishedRevision"));

        // A draft never reaches the student feed.
        mvc.perform(get("/api/v1/announcements/my").with(student("wf-student-u")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.length()").value(0));

        mvc.perform(post("/api/v1/announcements/" + id + "/submit").with(admin("admin-1")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("IN_REVIEW"));

        mvc.perform(post("/api/v1/announcements/" + id + "/approve").with(admin("admin-2")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("PUBLISHED"))
                .andExpect(jsonPath("$.reviewerId").value("admin-2"))
                .andExpect(jsonPath("$.reviewedAt").isNotEmpty())
                .andExpect(jsonPath("$.publishedRevision").isNumber());

        row = jdbc.queryForMap(
                "SELECT \"status\", \"reviewerId\", \"publishedRevision\", \"notifiedAt\", \"publishAt\""
                        + " FROM \"engagement\".\"Announcement\" WHERE \"id\" = ?", id);
        assertEquals("PUBLISHED", row.get("status"));
        assertEquals("admin-2", row.get("reviewerId"));
        assertNotNull(row.get("publishedRevision"));
        assertNotNull(row.get("publishAt"));

        mvc.perform(get("/api/v1/announcements/my").with(student("wf-student-u")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data[0].title").value("Orientation week"));

        List<Map<String, Object>> audit = jdbc.queryForList(
                "SELECT \"action\", \"actorId\", \"version\" FROM \"engagement\".\"AnnouncementAudit\""
                        + " WHERE \"announcementId\" = ? ORDER BY \"createdAt\", \"version\", \"id\"", id);
        assertEquals(List.of("CREATED", "SUBMITTED", "APPROVED"),
                audit.stream().map(entry -> entry.get("action")).toList());
        assertEquals(List.of("admin-1", "admin-1", "admin-2"),
                audit.stream().map(entry -> entry.get("actorId")).toList());
    }

    @Test
    void adminListStatusFiltersSliceTheLifecycle() throws Exception {
        String draftId = createDraft(admin("admin-1"), "Draft notice", "Body.", null);
        String publishedId = createDraft(admin("admin-1"), "Published notice", "Body.", null);
        submitAndApprove(publishedId, admin("admin-1"), admin("admin-2"));

        mvc.perform(get("/api/v1/announcements")
                        .queryParam("status", "DRAFT").with(admin("admin-1")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data[0].id").value(draftId))
                .andExpect(jsonPath("$.data.length()").value(1));
        mvc.perform(get("/api/v1/announcements")
                        .queryParam("status", "PUBLISHED").with(admin("admin-1")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data[0].id").value(publishedId))
                .andExpect(jsonPath("$.data.length()").value(1));
        mvc.perform(get("/api/v1/announcements")
                        .queryParam("status", "ALL").with(admin("admin-1")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.length()").value(2));
        mvc.perform(get("/api/v1/announcements")
                        .queryParam("status", "BOGUS").with(admin("admin-1")))
                .andExpect(status().isBadRequest());
    }

    // ------------------------------------------------------------------
    // Guards: state, author/reviewer split, reason, expiry
    // ------------------------------------------------------------------

    @Test
    void reviewerEqualsAuthorAndWrongStateTransitionsAreRejected() throws Exception {
        String id = createDraft(admin("admin-1"), "Guard notice", "Body.", null);

        // Approve a DRAFT — the only live path is IN_REVIEW -> PUBLISHED.
        mvc.perform(post("/api/v1/announcements/" + id + "/approve").with(admin("admin-2")))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("ANNOUNCEMENT_INVALID_STATE"));
        // Return a DRAFT — rework only exists inside the review queue.
        mvc.perform(post("/api/v1/announcements/" + id + "/return")
                        .with(admin("admin-2")).contentType("application/json")
                        .content("{\"reason\":\"too early\"}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("ANNOUNCEMENT_INVALID_STATE"));
        // A non-author lecturer may not push another writer's draft.
        mvc.perform(post("/api/v1/announcements/" + id + "/submit")
                        .with(lecturer("wf-lect-other", "wf-lect-2")))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("ANNOUNCEMENT_NOT_AUTHOR"));

        mvc.perform(post("/api/v1/announcements/" + id + "/submit").with(admin("admin-1")))
                .andExpect(status().isOk());
        // Re-submit inside the queue is itself an invalid transition.
        mvc.perform(post("/api/v1/announcements/" + id + "/submit").with(admin("admin-1")))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("ANNOUNCEMENT_INVALID_STATE"));
        // The author must never be their own reviewer.
        mvc.perform(post("/api/v1/announcements/" + id + "/approve").with(admin("admin-1")))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("REVIEWER_EQUALS_AUTHOR"));
    }

    @Test
    void returnRequiresAReasonAndResetsTheDraft() throws Exception {
        String id = createDraft(admin("admin-1"), "Rework notice", "Body.", null);
        mvc.perform(post("/api/v1/announcements/" + id + "/submit").with(admin("admin-1")))
                .andExpect(status().isOk());

        mvc.perform(post("/api/v1/announcements/" + id + "/return")
                        .with(admin("admin-2")).contentType("application/json")
                        .content("{}"))
                .andExpect(status().isBadRequest());

        mvc.perform(post("/api/v1/announcements/" + id + "/return")
                        .with(admin("admin-2")).contentType("application/json")
                        .content("{\"reason\":\"Fix the headline\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("DRAFT"))
                .andExpect(jsonPath("$.reviewNote").value("Fix the headline"))
                .andExpect(jsonPath("$.reviewerId").value("admin-2"));

        List<Map<String, Object>> audit = jdbc.queryForList(
                "SELECT \"action\", \"reason\" FROM \"engagement\".\"AnnouncementAudit\""
                        + " WHERE \"announcementId\" = ? AND \"action\" = 'RETURNED'", id);
        assertEquals(1, audit.size());
        assertEquals("Fix the headline", audit.get(0).get("reason"));

        // The reworked draft can re-enter the queue and publish normally.
        submitAndApprove(id, admin("admin-1"), admin("admin-2"));
    }

    @Test
    void expiredWindowBlocksApproveUntilTheAuthorFixesIt() throws Exception {
        // expiresAt already in the past at approve time.
        String id = createDraft(admin("admin-1"), "Expired notice", "Body.",
                "\"expiresAt\":\"2020-01-01T00:00:00Z\",");
        mvc.perform(post("/api/v1/announcements/" + id + "/submit").with(admin("admin-1")))
                .andExpect(status().isOk());
        mvc.perform(post("/api/v1/announcements/" + id + "/approve").with(admin("admin-2")))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("ANNOUNCEMENT_ALREADY_EXPIRED"));

        // IN_REVIEW is frozen — the reviewer returns it, the author fixes the
        // window in DRAFT, then the same document publishes.
        mvc.perform(put("/api/v1/announcements/" + id)
                        .with(admin("admin-1")).contentType("application/json")
                        .content(updateBody(id, "{\"expiresAt\":\"2099-01-01T00:00:00Z\"}")))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("ANNOUNCEMENT_NOT_DRAFT"));
        mvc.perform(post("/api/v1/announcements/" + id + "/return")
                        .with(admin("admin-2")).contentType("application/json")
                        .content("{\"reason\":\"Window closed\",\"expectedVersion\":" + versionOf(id) + "}"))
                .andExpect(status().isOk());
        mvc.perform(put("/api/v1/announcements/" + id)
                        .with(admin("admin-1")).contentType("application/json")
                        .content(updateBody(id, "{\"expiresAt\":\"2099-01-01T00:00:00Z\"}")))
                .andExpect(status().isOk());
        submitAndApprove(id, admin("admin-1"), admin("admin-2"));
    }

    @Test
    void publishedContentIsImmutableForOrdinaryEdits() throws Exception {
        String id = createDraft(admin("admin-1"), "Immutable notice", "Body.", null);
        submitAndApprove(id, admin("admin-1"), admin("admin-2"));
        mvc.perform(put("/api/v1/announcements/" + id)
                        .with(admin("admin-1")).contentType("application/json")
                        .content(updateBody(id, "{\"title\":\"Retitled\"}")))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("ANNOUNCEMENT_NOT_DRAFT"));
    }

    @Test
    void archiveAndRestoreRouteThroughDraftWithAudit() throws Exception {
        String id = createDraft(admin("admin-1"), "Archivable notice", "Body.", null);
        submitAndApprove(id, admin("admin-1"), admin("admin-2"));

        mvc.perform(post("/api/v1/announcements/" + id + "/archive")
                        .with(admin("admin-1")).contentType("application/json")
                        .content("{\"reason\":\"Outdated\",\"expectedVersion\":" + versionOf(id) + "}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("ARCHIVED"))
                .andExpect(jsonPath("$.archivedAt").isNotEmpty())
                .andExpect(jsonPath("$.archivedBy").value("admin-1"));

        mvc.perform(get("/api/v1/announcements/my").with(student("wf-student-u")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.length()").value(0));

        // Restore lands on DRAFT — re-publication always needs a fresh review.
        mvc.perform(post("/api/v1/announcements/" + id + "/restore")
                        .with(admin("admin-1")).contentType("application/json")
                        .content("{\"reason\":\"Still relevant\",\"expectedVersion\":" + versionOf(id) + "}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("DRAFT"))
                .andExpect(jsonPath("$.archivedAt").doesNotExist())
                .andExpect(jsonPath("$.archivedBy").doesNotExist());

        mvc.perform(get("/api/v1/announcements/my").with(student("wf-student-u")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.length()").value(0));

        List<String> actions = jdbc.queryForList(
                "SELECT \"action\" FROM \"engagement\".\"AnnouncementAudit\""
                        + " WHERE \"announcementId\" = ? ORDER BY \"createdAt\", \"version\", \"id\"",
                String.class, id);
        assertEquals(List.of("CREATED", "SUBMITTED", "APPROVED", "ARCHIVED", "RESTORED"), actions);
    }

    // ------------------------------------------------------------------
    // Notification gate + lecturer queue
    // ------------------------------------------------------------------

    @Test
    void draftsAndReviewQueueSendZeroNotificationsUntilApprove() throws Exception {
        String id = createDraft(admin("admin-1"), "Inbox notice", "Body.", null);
        assertEquals(0, notificationCount());

        mvc.perform(post("/api/v1/announcements/" + id + "/submit").with(admin("admin-1")))
                .andExpect(status().isOk());
        assertEquals(0, notificationCount());

        mvc.perform(post("/api/v1/announcements/" + id + "/approve").with(admin("admin-2")))
                .andExpect(status().isOk());
        assertEquals(1, notificationCount());
        List<String> recipients = jdbc.queryForList(
                "SELECT user_id FROM notifications.notification", String.class);
        assertEquals(List.of("wf-student-u"), recipients);
        assertNotNull(jdbc.queryForObject(
                "SELECT \"notifiedAt\" FROM \"engagement\".\"Announcement\" WHERE \"id\" = ?",
                java.time.OffsetDateTime.class, id));
    }

    @Test
    void lecturerQueueShowsOwnRowsAndReviewItemsOnly() throws Exception {
        // Lecturer-authored draft stays in their own scope.
        seedRow("lect-draft", "DRAFT", "wf-lect-u");
        // Admin-owned draft is invisible to a foreign lecturer…
        String adminDraft = createDraft(admin("admin-1"), "Hidden admin draft", "Body.", null);
        // …until it enters the review queue.
        String adminReview = createDraft(admin("admin-1"), "Review queue item", "Body.", null);
        mvc.perform(post("/api/v1/announcements/" + adminReview + "/submit").with(admin("admin-1")))
                .andExpect(status().isOk());
        // A published admin post is not part of the lecturer scope either.
        String adminPublished = createDraft(admin("admin-1"), "Live admin post", "Body.", null);
        submitAndApprove(adminPublished, admin("admin-1"), admin("admin-2"));

        MvcResult result = mvc.perform(get("/api/v1/announcements")
                        .queryParam("status", "ALL")
                        .with(lecturer("wf-lect-u", "wf-lect-1")))
                .andExpect(status().isOk())
                .andReturn();
        List<String> ids = objectMapper.readTree(result.getResponse().getContentAsString())
                .path("data").findValues("id").stream().map(node -> node.asText()).toList();
        assertTrue(ids.contains("lect-draft"));
        assertTrue(ids.contains(adminReview));
        assertTrue(!ids.contains(adminDraft));
        assertTrue(!ids.contains(adminPublished));
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    private String createDraft(RequestPostProcessor actor, String title, String content,
            String extraFields) throws Exception {
        String body = "{\"title\":\"" + title + "\",\"content\":\"" + content + "\","
                + "\"isGlobal\":true,\"targetRoles\":[\"STUDENT\"],"
                + (extraFields == null ? "" : extraFields) + "\"priority\":\"NORMAL\"}";
        MvcResult result = mvc.perform(post("/api/v1/announcements")
                        .with(actor).contentType("application/json").content(body))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.status").value("DRAFT"))
                .andReturn();
        return objectMapper.readTree(result.getResponse().getContentAsString())
                .path("id").asText();
    }

    private void submitAndApprove(String id, RequestPostProcessor author,
            RequestPostProcessor reviewer) throws Exception {
        mvc.perform(post("/api/v1/announcements/" + id + "/submit").with(author))
                .andExpect(status().isOk());
        mvc.perform(post("/api/v1/announcements/" + id + "/approve").with(reviewer))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("PUBLISHED"));
    }

    /** Update payloads carry the optimistic-lock pair (reason + expectedVersion). */
    private String updateBody(String id, String fields) {
        String inner = fields.substring(1, fields.length() - 1);
        return "{\"reason\":\"update\",\"expectedVersion\":" + versionOf(id)
                + (inner.isBlank() ? "" : "," + inner) + "}";
    }

    private int versionOf(String id) {
        Integer version = jdbc.queryForObject(
                "SELECT \"version\" FROM \"engagement\".\"Announcement\" WHERE \"id\" = ?",
                Integer.class, id);
        return version == null ? 0 : version;
    }

    private void seedRow(String id, String lifecycleStatus, String authorId) {
        jdbc.update("""
                INSERT INTO "engagement"."Announcement"
                ("id", "title", "content", "priority", "targetRoles", "targetYears",
                 "isGlobal", "publishedBy", "createdAt", "updatedAt", "version", "status",
                 "authorId")
                VALUES (?, ?, 'Body.', 'NORMAL', ARRAY['STUDENT'], ARRAY[],
                 TRUE, 'admin-1', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 0, ?, ?)
                """, id, "Seeded " + id, lifecycleStatus, authorId);
    }

    private int notificationCount() {
        Integer count = jdbc.queryForObject(
                "SELECT COUNT(*) FROM notifications.notification", Integer.class);
        return count == null ? 0 : count;
    }

    private RequestPostProcessor admin(String subject) {
        return fixtureJwt(jdbc, subject, token -> token
                .subject(subject)
                .claim("email", subject + "@campuscore.edu")
                .claim("roles", List.of("ADMIN")), "ADMIN");
    }

    private RequestPostProcessor lecturer(String subject, String lecturerId) {
        return fixtureJwt(jdbc, subject, token -> token
                .subject(subject)
                .claim("email", subject + "@campuscore.edu")
                .claim("roles", List.of("LECTURER"))
                .claim("lecturerId", lecturerId), "LECTURER");
    }

    private RequestPostProcessor student(String subject) {
        return fixtureJwt(jdbc, subject, token -> token
                .subject(subject)
                .claim("email", subject + "@campuscore.edu")
                .claim("roles", List.of("STUDENT"))
                .claim("studentId", "wf-st-1")
                .claim("student", Map.of("year", 1)), "STUDENT");
    }
}
