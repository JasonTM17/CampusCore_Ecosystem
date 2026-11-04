package io.campuscore.restfulapi.engagement;

import static io.campuscore.restfulapi.testsupport.CurrentAccountJwt.fixtureJwt;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.sql.PreparedStatement;
import java.sql.Types;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.ConnectionCallback;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.RequestPostProcessor;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles({"test", "persistence"})
@TestPropertySource(properties = {
        "spring.flyway.enabled=false",
        "spring.datasource.url=jdbc:h2:mem:repair_AnnouncementPinOptionsPersistenceTest;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1"
})
class AnnouncementPinOptionsPersistenceTest {

    private static final Instant PAST = Instant.parse("2020-01-01T00:00:00Z");
    private static final Instant FUTURE = Instant.parse("2100-01-01T00:00:00Z");

    @Autowired
    private JdbcTemplate jdbc;

    @Autowired
    private MockMvc mvc;

    @BeforeEach
    void prepareFixture() {
        io.campuscore.restfulapi.security.DatabaseAvailabilityTracker.recordSuccess();
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
        jdbc.execute("DROP TABLE IF EXISTS \"engagement\".\"AnnouncementAudit\"");
        jdbc.execute("DROP TABLE IF EXISTS \"engagement\".\"Announcement\"");
        jdbc.execute("""
                CREATE TABLE "engagement"."Announcement" (
                    "id" VARCHAR(120) PRIMARY KEY,
                    "title" VARCHAR(240) NOT NULL,
                    "content" TEXT NOT NULL,
                    "slug" VARCHAR(240),
                    "summary" VARCHAR(400),
                    "coverImageUrl" VARCHAR(500),
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
                    "foldedTitle" VARCHAR
                        GENERATED ALWAYS AS (TRANSLATE(LOWER(COALESCE("title", '')), 'áàảãạăằắẳẵặâầấẩẫậéèẻẽẹêềếểễệíìỉĩịóòỏõọôồốổỗộơờớởỡợúùủũụưừứửữựýỳỷỹỵđ', 'aaaaaaaaaaaaaaaaaeeeeeeeeeeeiiiiiooooooooooooooooouuuuuuuuuuuyyyyyd')),
                    "foldedContent" VARCHAR
                        GENERATED ALWAYS AS (TRANSLATE(LOWER(COALESCE("content", '')), 'áàảãạăằắẳẵặâầấẩẫậéèẻẽẹêềếểễệíìỉĩịóòỏõọôồốổỗộơờớởỡợúùủũụưừứửữựýỳỷỹỵđ', 'aaaaaaaaaaaaaaaaaeeeeeeeeeeeiiiiiooooooooooooooooouuuuuuuuuuuyyyyyd'))
                )
                """);
        fixtureJwt(jdbc, "admin-user", "ADMIN");
        fixtureJwt(jdbc, "student-user", "STUDENT");
        fixtureJwt(jdbc, "lecturer-user", "LECTURER");
    }

    private RequestPostProcessor admin() {
        return fixtureJwt(jdbc, "admin-user", token -> token
                        .subject("admin-user")
                        .claim("email", "admin@campuscore.edu")
                        .claim("roles", List.of("ADMIN")), "ADMIN")
                .authorities(new SimpleGrantedAuthority("ROLE_ADMIN"));
    }

    private void insert(String id, String status, String createdAt, Integer displayOrder) {
        jdbc.execute((ConnectionCallback<Void>) connection -> {
            try (PreparedStatement statement = connection.prepareStatement("""
                    INSERT INTO "engagement"."Announcement" (
                        "id", "title", "content", "priority", "targetRoles", "targetYears",
                        "isGlobal", "publishAt", "expiresAt", "createdAt", "updatedAt",
                        "status", "displayOrder"
                    ) VALUES (?, ?, ?, 'NORMAL', ?, ?, TRUE, ?, ?, ?, ?, ?, ?)
                    """)) {
                statement.setString(1, id);
                statement.setString(2, "Title " + id);
                statement.setString(3, "Body " + id);
                statement.setArray(4, connection.createArrayOf("VARCHAR", new String[0]));
                statement.setArray(5, connection.createArrayOf("INTEGER", new Integer[0]));
                statement.setObject(6, OffsetDateTime.ofInstant(PAST, ZoneOffset.UTC), Types.TIMESTAMP_WITH_TIMEZONE);
                statement.setObject(7, OffsetDateTime.ofInstant(FUTURE, ZoneOffset.UTC), Types.TIMESTAMP_WITH_TIMEZONE);
                statement.setObject(8, OffsetDateTime.ofInstant(Instant.parse(createdAt), ZoneOffset.UTC), Types.TIMESTAMP_WITH_TIMEZONE);
                statement.setObject(9, OffsetDateTime.ofInstant(Instant.parse(createdAt), ZoneOffset.UTC), Types.TIMESTAMP_WITH_TIMEZONE);
                statement.setString(10, status);
                if (displayOrder == null) {
                    statement.setNull(11, Types.INTEGER);
                } else {
                    statement.setInt(11, displayOrder);
                }
                statement.executeUpdate();
            }
            return null;
        });
    }

    @Test
    void pinOptionsReturnThePickerProjectionAndNeverTheBody() throws Exception {
        insert("pin-a", "PUBLISHED", "2026-08-20T10:00:00Z", 1);
        insert("pin-b", "PUBLISHED", "2026-08-20T11:00:00Z", 2);

        mvc.perform(get("/api/v1/announcements/pin-options").with(admin()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.length()").value(2))
                .andExpect(jsonPath("$.data[0].id").value("pin-a"))
                .andExpect(jsonPath("$.data[0].title").value("Title pin-a"))
                .andExpect(jsonPath("$.data[0].status").value("PUBLISHED"))
                .andExpect(jsonPath("$.data[0].isGlobal").value(true))
                .andExpect(jsonPath("$.data[0].publishAt").value("2020-01-01T00:00:00.000Z"))
                .andExpect(jsonPath("$.data[0].createdAt").value("2026-08-20T10:00:00.000Z"))
                .andExpect(jsonPath("$.data[0].content").doesNotExist())
                .andExpect(jsonPath("$.data[0].summary").doesNotExist())
                .andExpect(jsonPath("$.data[0].coverImageUrl").doesNotExist())
                .andExpect(jsonPath("$.data[0].targetRoles").doesNotExist())
                .andExpect(jsonPath("$.data[0].targetYears").doesNotExist())
                .andExpect(jsonPath("$.data[0].section").doesNotExist())
                .andExpect(jsonPath("$.data[0].lecturer").doesNotExist())
                .andExpect(jsonPath("$.meta.total").value(2))
                .andExpect(jsonPath("$.meta.page").value(1))
                .andExpect(jsonPath("$.meta.totalPages").value(1));
    }

    @Test
    void pinOptionsKeepTheAppearanceEditorGate() throws Exception {
        insert("pin-a", "PUBLISHED", "2026-08-20T10:00:00Z", null);

        mvc.perform(get("/api/v1/announcements/pin-options"))
                .andExpect(status().isUnauthorized());
        mvc.perform(get("/api/v1/announcements/pin-options")
                        .with(fixtureJwt(jdbc, "student-user", "STUDENT")))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("ACCESS_DENIED"));
        mvc.perform(get("/api/v1/announcements/pin-options")
                        .with(fixtureJwt(jdbc, "lecturer-user", "LECTURER")))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("ACCESS_DENIED"));
    }

    @Test
    void pinOptionsCapThePageSizeAndTheIdList() throws Exception {
        insert("pin-a", "PUBLISHED", "2026-08-20T10:00:00Z", null);

        mvc.perform(get("/api/v1/announcements/pin-options")
                        .queryParam("limit", "201")
                        .with(admin()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_REQUEST"));

        mvc.perform(get("/api/v1/announcements/pin-options")
                        .queryParam("limit", "200")
                        .with(admin()))
                .andExpect(status().isOk());

        mvc.perform(get("/api/v1/announcements/pin-options")
                        .queryParam("page", "0")
                        .with(admin()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_REQUEST"));

        mvc.perform(get("/api/v1/announcements/pin-options")
                        .queryParam("unknown", "value")
                        .with(admin()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_REQUEST"));

        mvc.perform(get("/api/v1/announcements/pin-options")
                        .queryParam("ids", "pin-a", "pin-b")
                        .with(admin()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_REQUEST"));

        mvc.perform(get("/api/v1/announcements/pin-options")
                        .queryParam("ids", "pin-a,,pin-b")
                        .with(admin()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_REQUEST"));

        String oversized = String.join(",", java.util.Collections.nCopies(201, "pin-a"));
        mvc.perform(get("/api/v1/announcements/pin-options")
                        .queryParam("ids", oversized)
                        .with(admin()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_REQUEST"));
    }

    @Test
    void pinOptionsResolveNamedIdsAndPageThroughTheCatalog() throws Exception {
        insert("pin-a", "PUBLISHED", "2026-08-20T10:00:00Z", null);
        insert("pin-b", "PUBLISHED", "2026-08-20T11:00:00Z", 1);
        insert("pin-c", "PUBLISHED", "2026-08-20T12:00:00Z", null);
        insert("pin-archived", "ARCHIVED", "2026-08-20T13:00:00Z", null);

        // Display order wins first, then newest: pin-b, pin-c, pin-a; the
        // archived row stays out of the default ACTIVE filter even when named.
        mvc.perform(get("/api/v1/announcements/pin-options")
                        .queryParam("limit", "2")
                        .with(admin()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.length()").value(2))
                .andExpect(jsonPath("$.data[0].id").value("pin-b"))
                .andExpect(jsonPath("$.data[1].id").value("pin-c"))
                .andExpect(jsonPath("$.meta.total").value(3))
                .andExpect(jsonPath("$.meta.totalPages").value(2));

        mvc.perform(get("/api/v1/announcements/pin-options")
                        .queryParam("page", "2")
                        .queryParam("limit", "2")
                        .with(admin()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.length()").value(1))
                .andExpect(jsonPath("$.data[0].id").value("pin-a"));

        mvc.perform(get("/api/v1/announcements/pin-options")
                        .queryParam("ids", "pin-c,pin-a,pin-archived")
                        .with(admin()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.length()").value(2))
                .andExpect(jsonPath("$.data[0].id").value("pin-c"))
                .andExpect(jsonPath("$.data[1].id").value("pin-a"))
                .andExpect(jsonPath("$.meta.total").value(2));

        mvc.perform(get("/api/v1/announcements/pin-options")
                        .queryParam("ids", "pin-archived")
                        .queryParam("status", "ALL")
                        .with(admin()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.length()").value(1))
                .andExpect(jsonPath("$.data[0].status").value("ARCHIVED"));
    }

    @Test
    void pinOptionsSearchMatchesFoldedTitlesOnly() throws Exception {
        insert("exam-notice", "PUBLISHED", "2026-08-20T10:00:00Z", null);
        insert("body-only", "PUBLISHED", "2026-08-20T11:00:00Z", null);
        jdbc.update("UPDATE \"engagement\".\"Announcement\" SET \"title\" = 'Lịch thi giữa kỳ' WHERE \"id\" = 'exam-notice'");
        jdbc.update("UPDATE \"engagement\".\"Announcement\" SET \"content\" = 'Nội dung về lịch thi' WHERE \"id\" = 'body-only'");

        mvc.perform(get("/api/v1/announcements/pin-options")
                        .queryParam("search", "lich thi")
                        .with(admin()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.length()").value(1))
                .andExpect(jsonPath("$.data[0].id").value("exam-notice"))
                .andExpect(jsonPath("$.meta.total").value(1));
    }
}
