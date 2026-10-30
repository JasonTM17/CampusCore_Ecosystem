package io.campuscore.restfulapi.engagement;

import static io.campuscore.restfulapi.testsupport.CurrentAccountJwt.fixtureJwt;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.RequestPostProcessor;

/**
 * Attachment and media-gallery parent gating (publication-policy §4, ANN-T05):
 * every read joins {@code engagement."Announcement"} — a published parent's
 * assets follow the caller's audience, an unpublished parent's assets are
 * writer-set-only, and a missing or invisible parent answers the same 404 as
 * absent data on scoped routes (and is filtered out on unscoped ones).
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles({"test", "persistence"})
@TestPropertySource(properties = {
        "spring.flyway.enabled=false",
        "spring.datasource.url=jdbc:h2:mem:article_asset_gate;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1"
})
class ArticleAssetGatePersistenceTest {

    private static final Instant PAST = Instant.parse("2020-01-01T00:00:00Z");
    private static final Instant FUTURE = Instant.parse("2100-01-01T00:00:00Z");

    @Autowired
    private JdbcTemplate jdbc;

    @Autowired
    private MockMvc mvc;

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
                    "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
                )
                """);
        jdbc.execute("DELETE FROM \"campuscore_auth\".\"User\"");
        jdbc.execute("CREATE SCHEMA IF NOT EXISTS academic");
        jdbc.execute("DROP TABLE IF EXISTS academic.\"Enrollment\"");
        jdbc.execute("""
                CREATE TABLE academic."Enrollment" (
                    "id" VARCHAR(120) PRIMARY KEY,
                    "studentId" VARCHAR(120) NOT NULL,
                    "sectionId" VARCHAR(120) NOT NULL,
                    "semesterId" VARCHAR(120),
                    "status" VARCHAR(40) NOT NULL
                )
                """);
        jdbc.execute("DROP TABLE IF EXISTS \"engagement\".\"ArticleAttachment\"");
        jdbc.execute("DROP TABLE IF EXISTS \"engagement\".\"ArticleMediaGallery\"");
        jdbc.execute("DROP TABLE IF EXISTS \"engagement\".\"Announcement\"");
        jdbc.execute("""
                CREATE TABLE "engagement"."Announcement" (
                    "id" VARCHAR(120) PRIMARY KEY,
                    "title" VARCHAR(240) NOT NULL,
                    "content" TEXT NOT NULL,
                    "slug" VARCHAR(240),
                    "priority" VARCHAR(20) NOT NULL,
                    "targetRoles" VARCHAR ARRAY NOT NULL,
                    "targetYears" INTEGER ARRAY NOT NULL,
                    "isGlobal" BOOLEAN NOT NULL,
                    "publishAt" TIMESTAMP WITH TIME ZONE,
                    "expiresAt" TIMESTAMP WITH TIME ZONE,
                    "publishedBy" VARCHAR(120),
                    "sectionId" VARCHAR(120),
                    "lecturerId" VARCHAR(120),
                    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL,
                    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL,
                    "archivedAt" TIMESTAMP WITH TIME ZONE,
                    "archivedBy" VARCHAR(120),
                    "status" VARCHAR(30) NOT NULL DEFAULT 'DRAFT',
                    "authorId" VARCHAR(120),
                    "reviewerId" VARCHAR(120),
                    "reviewedAt" TIMESTAMP WITH TIME ZONE,
                    "reviewNote" VARCHAR(500),
                    "publishedRevision" INTEGER
                )
                """);
        jdbc.execute("""
                CREATE TABLE "engagement"."ArticleMediaGallery" (
                    "id" VARCHAR(120) PRIMARY KEY,
                    "announcementId" VARCHAR(120) NOT NULL,
                    "mediaUrl" VARCHAR(500) NOT NULL,
                    "thumbnailUrl" VARCHAR(500),
                    "captionVi" VARCHAR(500) NOT NULL,
                    "captionEn" VARCHAR(500),
                    "altText" VARCHAR(255) NOT NULL,
                    "mediaType" VARCHAR(30) NOT NULL DEFAULT 'IMAGE',
                    "aspectRatio" VARCHAR(20) NOT NULL DEFAULT '16:9',
                    "width" INTEGER,
                    "height" INTEGER,
                    "fileSizeBytes" BIGINT,
                    "displayOrder" INTEGER NOT NULL DEFAULT 0,
                    "isCover" BOOLEAN NOT NULL DEFAULT FALSE,
                    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
                )
                """);
        jdbc.execute("""
                CREATE TABLE "engagement"."ArticleAttachment" (
                    "id" VARCHAR(120) PRIMARY KEY,
                    "announcementId" VARCHAR(120) NOT NULL,
                    "fileName" VARCHAR(255) NOT NULL,
                    "fileUrl" VARCHAR(500) NOT NULL,
                    "fileSizeBytes" BIGINT NOT NULL,
                    "mimeType" VARCHAR(120) NOT NULL,
                    "checksumSha256" VARCHAR(64),
                    "downloadCount" INTEGER NOT NULL DEFAULT 0,
                    "isPublic" BOOLEAN NOT NULL DEFAULT TRUE,
                    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
                )
                """);

        // Parents across the visibility matrix — one attachment + one gallery each.
        seedParent("pub-global", "PUBLISHED", true, new String[0], new Integer[0],
                PAST, null, null, null, "admin-1");
        seedParent("pub-lecturer", "PUBLISHED", false, new String[]{"LECTURER"}, new Integer[0],
                PAST, null, null, null, "admin-1");
        seedParent("pub-year2", "PUBLISHED", false, new String[]{"STUDENT"}, new Integer[]{2},
                PAST, null, null, null, "admin-1");
        seedParent("pub-section", "PUBLISHED", false, new String[]{"STUDENT"}, new Integer[0],
                PAST, null, "section-enrolled", null, "admin-1");
        seedParent("pub-expired", "PUBLISHED", true, new String[0], new Integer[0],
                PAST, PAST.plusSeconds(3600), null, null, "admin-1");
        seedParent("draft-own", "DRAFT", false, new String[]{"STUDENT"}, new Integer[0],
                PAST, null, null, null, "lecturer-user");
        seedParent("review-queue", "IN_REVIEW", false, new String[]{"STUDENT"}, new Integer[0],
                PAST, null, null, null, "lecturer-other");
        seedParent("archived", "ARCHIVED", true, new String[0], new Integer[0],
                PAST, null, null, null, "admin-1");

        for (String parent : List.of(
                "pub-global", "pub-lecturer", "pub-year2", "pub-section",
                "pub-expired", "draft-own", "review-queue", "archived")) {
            insertAttachment("att-" + parent, parent, true);
            insertGallery("gal-" + parent, parent, 1);
        }
        insertAttachment("att-hidden", "pub-global", false);
        // An orphan asset row pointing at a parent that does not exist.
        insertAttachment("att-ghost", "ghost-parent", true);
        insertGallery("gal-ghost", "ghost-parent", 9);

        // Profile rows — the session filter validates profile claims against
        // persisted identity, so students/lecturers need their DB records.
        fixtureJwt(jdbc, "admin-1", "ADMIN");
        io.campuscore.restfulapi.testsupport.AccountAuthorityFixture
                .student(jdbc, "student-1", "student-profile", 2);
        io.campuscore.restfulapi.testsupport.AccountAuthorityFixture
                .student(jdbc, "student-y3", "student-profile-y3", 3);
        io.campuscore.restfulapi.testsupport.AccountAuthorityFixture
                .student(jdbc, "student-sec", "student-profile-sec", 2);
        io.campuscore.restfulapi.testsupport.AccountAuthorityFixture
                .lecturer(jdbc, "lecturer-user", "lecturer-1");
        io.campuscore.restfulapi.testsupport.AccountAuthorityFixture
                .lecturer(jdbc, "lecturer-other", "lecturer-2");
    }

    // ------------------------------------------------------------------
    // Fixtures
    // ------------------------------------------------------------------

    private void seedParent(String id, String status, boolean isGlobal,
            String[] targetRoles, Integer[] targetYears,
            Instant publishAt, Instant expiresAt, String sectionId,
            String lecturerId, String authorId) {
        jdbc.execute((org.springframework.jdbc.core.ConnectionCallback<Void>) connection -> {
            try (java.sql.PreparedStatement statement = connection.prepareStatement("""
                    INSERT INTO "engagement"."Announcement" (
                        "id", "title", "content", "priority", "targetRoles", "targetYears",
                        "isGlobal", "publishAt", "expiresAt", "sectionId", "lecturerId",
                        "createdAt", "updatedAt", "status", "authorId",
                        "archivedAt", "archivedBy")
                    VALUES (?, ?, '<p>x</p>', 'NORMAL', ?, ?, ?, ?, ?, ?, ?,
                            CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, ?, ?, ?, ?)
                    """)) {
                statement.setString(1, id);
                statement.setString(2, "Parent " + id);
                statement.setArray(3, connection.createArrayOf("VARCHAR", targetRoles));
                statement.setArray(4, connection.createArrayOf("INTEGER", targetYears));
                statement.setBoolean(5, isGlobal);
                timestamp(statement, 6, publishAt);
                timestamp(statement, 7, expiresAt);
                statement.setString(8, sectionId);
                statement.setString(9, lecturerId);
                statement.setString(10, status);
                statement.setString(11, authorId);
                if ("ARCHIVED".equals(status)) {
                    timestamp(statement, 12, PAST.plusSeconds(7200));
                    statement.setString(13, authorId);
                } else {
                    timestamp(statement, 12, null);
                    statement.setNull(13, java.sql.Types.VARCHAR);
                }
                statement.executeUpdate();
            }
            return null;
        });
    }

    private void insertAttachment(String id, String parentId, boolean isPublic) {
        jdbc.update("""
                INSERT INTO "engagement"."ArticleAttachment" (
                    "id", "announcementId", "fileName", "fileUrl", "fileSizeBytes",
                    "mimeType", "downloadCount", "isPublic", "createdAt")
                VALUES (?, ?, ?, ?, 1024, 'application/pdf', 0, ?, CURRENT_TIMESTAMP)
                """, id, parentId, id + ".pdf", "https://files.test/" + id + ".pdf", isPublic);
    }

    private void insertGallery(String id, String parentId, int displayOrder) {
        jdbc.update("""
                INSERT INTO "engagement"."ArticleMediaGallery" (
                    "id", "announcementId", "mediaUrl", "captionVi", "altText",
                    "displayOrder", "createdAt")
                VALUES (?, ?, ?, 'caption', 'alt', ?, CURRENT_TIMESTAMP)
                """, id, parentId, "https://cdn.test/" + id + ".jpg", displayOrder);
    }

    private static void timestamp(java.sql.PreparedStatement statement, int index, Instant value)
            throws java.sql.SQLException {
        if (value == null) {
            statement.setNull(index, java.sql.Types.TIMESTAMP_WITH_TIMEZONE);
        } else {
            statement.setObject(
                    index,
                    java.time.OffsetDateTime.ofInstant(value, java.time.ZoneOffset.UTC),
                    java.sql.Types.TIMESTAMP_WITH_TIMEZONE);
        }
    }

    private RequestPostProcessor admin() {
        return fixtureJwt(jdbc, "admin-1", token -> token
                .subject("admin-1")
                .claim("email", "admin-1@campuscore.edu")
                .claim("roles", List.of("ADMIN")), "ADMIN");
    }

    private RequestPostProcessor lecturer(String subject, String lecturerId) {
        return fixtureJwt(jdbc, subject, token -> token
                .subject(subject)
                .claim("email", subject + "@campuscore.edu")
                .claim("roles", List.of("LECTURER"))
                .claim("lecturerId", lecturerId), "LECTURER");
    }

    private RequestPostProcessor student(String subject, String studentId, int year) {
        return fixtureJwt(jdbc, subject, token -> token
                .subject(subject)
                .claim("email", subject + "@campuscore.edu")
                .claim("roles", List.of("STUDENT"))
                .claim("studentId", studentId)
                .claim("student", Map.of("year", year)), "STUDENT");
    }

    // ------------------------------------------------------------------
    // Published parent — audience follows the announcement's own scoping
    // ------------------------------------------------------------------

    @Test
    void publishedGlobalParentServesAssetsToAnyAuthenticatedCaller() throws Exception {
        mvc.perform(get("/api/v1/article-attachments")
                        .queryParam("announcementId", "pub-global")
                        .with(student("student-1", "student-profile", 2)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].id").value("att-pub-global"))
                .andExpect(jsonPath("$.length()").value(1)); // isPublic=false stays hidden

        mvc.perform(get("/api/v1/article-media-galleries")
                        .queryParam("announcementId", "pub-global")
                        .with(student("student-1", "student-profile", 2)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].id").value("gal-pub-global"));
    }

    @Test
    void scopedParentHonoursRoleAndYearAudience() throws Exception {
        // A LECTURER-scoped post: the student caller gets the same 404 as a
        // missing parent on the scoped form, and the row is filtered on the
        // unscoped form.
        mvc.perform(get("/api/v1/article-attachments")
                        .queryParam("announcementId", "pub-lecturer")
                        .with(student("student-1", "student-profile", 2)))
                .andExpect(status().isNotFound());
        mvc.perform(get("/api/v1/article-taxonomy/v2/media-galleries")
                        .queryParam("announcementId", "pub-lecturer")
                        .with(student("student-1", "student-profile", 2)))
                .andExpect(status().isNotFound());

        // The lecturer audience does see them — v1 and v2 both.
        mvc.perform(get("/api/v1/article-attachments")
                        .queryParam("announcementId", "pub-lecturer")
                        .with(lecturer("lecturer-user", "lecturer-1")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].id").value("att-pub-lecturer"));
        mvc.perform(get("/api/v1/article-taxonomy/v2/attachments")
                        .queryParam("announcementId", "pub-lecturer")
                        .with(lecturer("lecturer-user", "lecturer-1")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data[0].id").value("att-pub-lecturer"))
                .andExpect(jsonPath("$.meta.total").value(1));

        // Year narrowing: the year-3 student is outside the year-2 cohort.
        mvc.perform(get("/api/v1/article-attachments")
                        .queryParam("announcementId", "pub-year2")
                        .with(student("student-y3", "student-profile-y3", 3)))
                .andExpect(status().isNotFound());
        mvc.perform(get("/api/v1/article-attachments")
                        .queryParam("announcementId", "pub-year2")
                        .with(student("student-1", "student-profile", 2)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].id").value("att-pub-year2"));
    }

    @Test
    void sectionScopedParentOnlyReachesEnrolledStudents() throws Exception {
        jdbc.update("INSERT INTO academic.\"Enrollment\""
                        + " (\"id\", \"studentId\", \"sectionId\", \"semesterId\", \"status\")"
                        + " VALUES ('en-1', 'student-profile', 'section-enrolled', 'sem-1', 'ENROLLED')");
        jdbc.update("INSERT INTO academic.\"Enrollment\""
                        + " (\"id\", \"studentId\", \"sectionId\", \"semesterId\", \"status\")"
                        + " VALUES ('en-2', 'student-profile-sec', 'section-enrolled', 'sem-1', 'DROPPED')");

        mvc.perform(get("/api/v1/article-attachments")
                        .queryParam("announcementId", "pub-section")
                        .with(student("student-1", "student-profile", 2)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].id").value("att-pub-section"));

        // A DROPPED enrollment does not count — same 404 as a missing parent.
        mvc.perform(get("/api/v1/article-attachments")
                        .queryParam("announcementId", "pub-section")
                        .with(student("student-sec", "student-profile-sec", 2)))
                .andExpect(status().isNotFound());
    }

    // ------------------------------------------------------------------
    // Unpublished parents — writer set only
    // ------------------------------------------------------------------

    @Test
    void draftParentIsInvisibleToStudentsAndForeignLecturers() throws Exception {
        // Student: scoped 404, and the unscoped list must filter it out too.
        mvc.perform(get("/api/v1/article-attachments")
                        .queryParam("announcementId", "draft-own")
                        .with(student("student-1", "student-profile", 2)))
                .andExpect(status().isNotFound());

        // The authoring lecturer previews own draft assets.
        mvc.perform(get("/api/v1/article-attachments")
                        .queryParam("announcementId", "draft-own")
                        .with(lecturer("lecturer-user", "lecturer-1")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].id").value("att-draft-own"));

        // Another lecturer does not see someone else's draft (not yet queued).
        mvc.perform(get("/api/v1/article-attachments")
                        .queryParam("announcementId", "draft-own")
                        .with(lecturer("lecturer-other", "lecturer-2")))
                .andExpect(status().isNotFound());

        // Governance previews everything.
        mvc.perform(get("/api/v1/article-attachments")
                        .queryParam("announcementId", "draft-own")
                        .with(admin()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].id").value("att-draft-own"));
    }

    @Test
    void inReviewParentIsVisibleToEveryLecturerReviewerButNotStudents() throws Exception {
        // The IN_REVIEW queue is the lecturer read surface — any lecturer
        // reviewer may inspect the assets, students never may.
        mvc.perform(get("/api/v1/article-attachments")
                        .queryParam("announcementId", "review-queue")
                        .with(lecturer("lecturer-user", "lecturer-1")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].id").value("att-review-queue"));
        mvc.perform(get("/api/v1/article-media-galleries")
                        .queryParam("announcementId", "review-queue")
                        .with(lecturer("lecturer-other", "lecturer-2")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].id").value("gal-review-queue"));
        mvc.perform(get("/api/v1/article-attachments")
                        .queryParam("announcementId", "review-queue")
                        .with(student("student-1", "student-profile", 2)))
                .andExpect(status().isNotFound());
    }

    @Test
    void archivedAndExpiredParentsAreWriterPreviewOnly() throws Exception {
        mvc.perform(get("/api/v1/article-attachments")
                        .queryParam("announcementId", "archived")
                        .with(admin()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].id").value("att-archived"));
        mvc.perform(get("/api/v1/article-attachments")
                        .queryParam("announcementId", "archived")
                        .with(student("student-1", "student-profile", 2)))
                .andExpect(status().isNotFound());

        // Expired published post: still manageable by writers, not public.
        mvc.perform(get("/api/v1/article-attachments")
                        .queryParam("announcementId", "pub-expired")
                        .with(admin()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].id").value("att-pub-expired"));
        mvc.perform(get("/api/v1/article-attachments")
                        .queryParam("announcementId", "pub-expired")
                        .with(student("student-1", "student-profile", 2)))
                .andExpect(status().isNotFound());
    }

    // ------------------------------------------------------------------
    // No-oracle + unscoped forms
    // ------------------------------------------------------------------

    @Test
    void missingParentIs404ScopedAndFilteredUnscoped() throws Exception {
        mvc.perform(get("/api/v1/article-attachments")
                        .queryParam("announcementId", "ghost-parent")
                        .with(admin()))
                .andExpect(status().isNotFound());
        mvc.perform(get("/api/v1/article-taxonomy/v2/media-galleries")
                        .queryParam("announcementId", "ghost-parent")
                        .with(admin()))
                .andExpect(status().isNotFound());
    }

    @Test
    void unscopedListsApplyTheSameParentJoinPerRow() throws Exception {
        // Student's unscoped attachment feed: only the assets of visible
        // published parents — no draft/review/archived/expired/ghost rows.
        mvc.perform(get("/api/v1/article-taxonomy/v2/attachments")
                        .with(student("student-1", "student-profile", 2)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data[*].id",
                        org.hamcrest.Matchers.containsInAnyOrder("att-pub-global", "att-pub-year2")))
                .andExpect(jsonPath("$.meta.total").value(2));

        mvc.perform(get("/api/v1/article-media-galleries")
                        .with(student("student-1", "student-profile", 2)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[*].id",
                        org.hamcrest.Matchers.containsInAnyOrder("gal-pub-global", "gal-pub-year2")));

        // Admin's unscoped feed additionally carries the writer-preview tier:
        // drafts, the review queue, archived and expired parents — but never
        // the ghost row (no parent) and never isPublic=false assets of a
        // published parent.
        mvc.perform(get("/api/v1/article-taxonomy/v2/attachments")
                        .with(admin()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data[*].id",
                        org.hamcrest.Matchers.containsInAnyOrder(
                                "att-pub-global", "att-pub-lecturer", "att-pub-year2",
                                "att-pub-section", "att-pub-expired", "att-draft-own",
                                "att-review-queue", "att-archived")))
                .andExpect(jsonPath("$.meta.total").value(8));
    }
}
