package io.campuscore.restfulapi.site;

import static io.campuscore.restfulapi.testsupport.CurrentAccountJwt.fixtureJwt;

import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import io.campuscore.restfulapi.web.DomainException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import java.time.Instant;
import java.util.List;
import javax.sql.DataSource;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.jdbc.core.namedparam.SqlParameterSource;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.JwtRequestPostProcessor;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

/**
 * The site-appearance KV contract: anonymous browsers read the public homepage
 * chrome, only administrators write it, and whatever an administrator saves is
 * exactly what anonymous readers get back — with a write stamp that makes the
 * save visible to every other browser.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles({"test", "persistence"})
@TestPropertySource(properties = {
        "spring.flyway.enabled=false",
        "spring.datasource.url=jdbc:h2:mem:site_appearance;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1"
})
class SiteAppearancePersistenceTest {

    private static final ObjectMapper JSON = new ObjectMapper();

    @Autowired
    private JdbcTemplate jdbc;

    @Autowired
    private DataSource dataSource;

    @Autowired
    private MockMvc mvc;

    @BeforeEach
    void prepareTables() {
        jdbc.execute("CREATE SCHEMA IF NOT EXISTS \"site\"");
        jdbc.execute("DROP TABLE IF EXISTS \"site\".\"Appearance\"");
        jdbc.execute("""
                CREATE TABLE "site"."Appearance" (
                    "id" VARCHAR(40) PRIMARY KEY,
                    "payload" TEXT NOT NULL,
                    "updatedBy" VARCHAR(255),
                    "updatedAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    CONSTRAINT site_appearance_payload_ck CHECK (length("payload") <= 131072)
                )
                """);
        // Every /api/v1/** request passes AccountStateFilter, which reads the
        // account row from the database when a token is presented.
        jdbc.execute("CREATE SCHEMA IF NOT EXISTS \"campuscore_auth\"");
        jdbc.execute("DROP TABLE IF EXISTS \"campuscore_auth\".\"User\"");
        jdbc.execute("""
                CREATE TABLE "campuscore_auth"."User" (
                    "id" VARCHAR(512) PRIMARY KEY,
                    "email" VARCHAR(320) NOT NULL,
                    "firstName" VARCHAR(200),
                    "lastName" VARCHAR(200),
                    "status" VARCHAR(40) NOT NULL DEFAULT 'ACTIVE',
                    "mustChangePassword" BOOLEAN NOT NULL DEFAULT FALSE,
                    "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    "updatedAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
                """);
        jdbc.update("""
                INSERT INTO "campuscore_auth"."User" ("id", "email") VALUES (?, ?)
                """, "admin-1", "admin-1@campuscore.edu");
    }

    private JwtRequestPostProcessor admin() {
        return fixtureJwt(jdbc, "admin-1", token -> token
                        .subject("admin-1")
                        .claim("email", "admin-1@campuscore.edu")
                        .claim("roles", List.of("ADMIN")), "ADMIN")
                .authorities(new SimpleGrantedAuthority("ROLE_ADMIN"));
    }

    private MvcResult save(String payload) throws Exception {
        return mvc.perform(put("/api/v1/site-appearance")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(payload)
                        .with(admin()))
                .andExpect(status().isOk())
                .andReturn();
    }

    private static JsonNode bodyOf(MvcResult result) throws Exception {
        return JSON.readTree(result.getResponse().getContentAsString());
    }

    @Test
    @DisplayName("anonymous GET returns an empty object before anything is saved")
    void anonymousGetStartsEmpty() throws Exception {
        mvc.perform(get("/api/v1/site-appearance"))
                .andExpect(status().isOk())
                .andExpect(header().string("Cache-Control", "max-age=300, public, stale-while-revalidate=600"))
                .andExpect(content().json("{}"));
    }

    @Test
    @DisplayName("only administrators save; what they save is what anonymous readers get")
    void adminSavesAndAnonymousReads() throws Exception {
        String payload = """
                {"version":42,"accent":"campus-gold","hero":{"en":{"title":"Welcome"},"vi":{"title":"Chao mung"}},"postOrder":["a1","b2"]}
                """;
        save(payload);

        mvc.perform(get("/api/v1/site-appearance"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.accent").value("campus-gold"))
                .andExpect(jsonPath("$.hero.en.title").value("Welcome"))
                .andExpect(jsonPath("$.postOrder.length()").value(2))
                .andExpect(jsonPath("$.version").exists())
                .andExpect(jsonPath("$.updatedAt").exists());

        // A second save upserts the single row instead of appending.
        save("{\"version\":43,\"postOrder\":[\"c3\"]}");

        mvc.perform(get("/api/v1/site-appearance"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.postOrder.length()").value(1));

        var rows = jdbc.queryForList(
                "SELECT \"id\" FROM \"site\".\"Appearance\"", String.class);
        Assertions.assertEquals(List.of(SiteAppearanceStore.ROW_ID), rows);
    }

    @Test
    @DisplayName("every save restamps version and updatedAt, even for an identical payload")
    void writeStampsChangeDetectionFields() throws Exception {
        String payload = "{\"version\":7,\"accent\":\"river-blue\",\"postOrder\":[\"a1\"]}";
        JsonNode first = bodyOf(save(payload));
        JsonNode second = bodyOf(save(payload));

        long firstVersion = first.path("version").asLong();
        long secondVersion = second.path("version").asLong();

        // The caller's own version number is never trusted: a browser that
        // re-sends the payload it already has must still publish a change.
        Assertions.assertTrue(firstVersion > 7, "the write must replace a stale caller version");
        Assertions.assertTrue(
                secondVersion > firstVersion,
                "two saves of the same payload must carry different versions");
        Assertions.assertNotEquals(first.path("updatedAt").asText(), second.path("updatedAt").asText());
        Assertions.assertFalse(
                Instant.parse(second.path("updatedAt").asText()).isBefore(Instant.EPOCH));

        // The stored row is the single source of truth: the stamp a writer is
        // told about is the stamp the next anonymous reader is told about.
        JsonNode readBack = bodyOf(mvc.perform(get("/api/v1/site-appearance"))
                .andExpect(status().isOk())
                .andReturn());
        Assertions.assertEquals(secondVersion, readBack.path("version").asLong());
        Assertions.assertEquals(
                secondVersion,
                JSON.readTree(jdbc.queryForObject(
                        "SELECT \"payload\" FROM \"site\".\"Appearance\" WHERE \"id\" = ?",
                        String.class,
                        SiteAppearanceStore.ROW_ID)).path("version").asLong());
    }

    @Test
    @DisplayName("anonymous PUT is refused while anonymous GET is allowed")
    void anonymousPutIsNotPermitted() throws Exception {
        mvc.perform(get("/api/v1/site-appearance")).andExpect(status().isOk());

        // The filter chain opens only the GET verb, so an anonymous write never
        // reaches the controller: it is an authentication failure, not a
        // permission decision.
        mvc.perform(put("/api/v1/site-appearance")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"version\":9}"))
                .andExpect(status().isUnauthorized());

        Assertions.assertEquals(
                0,
                jdbc.queryForObject("SELECT COUNT(*) FROM \"site\".\"Appearance\"", Integer.class));
    }

    @Test
    @DisplayName("non-admin writes are refused")
    void writesStayPrivileged() throws Exception {
        mvc.perform(put("/api/v1/site-appearance")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"version\":9}")
                        .with(fixtureJwt(jdbc, "student-1", token -> token
                                .subject("student-1")
                                .claim("email", "student-1@campuscore.edu")
                                .claim("roles", List.of("STUDENT")), "STUDENT")
                                .authorities(new SimpleGrantedAuthority("ROLE_STUDENT"))))
                .andExpect(status().isForbidden());
    }

    @Test
    @DisplayName("a JWT subject longer than the actor column clips instead of failing")
    void longActorSubjectIsClipped() throws Exception {
        String subject = "s".repeat(300);
        io.campuscore.restfulapi.testsupport.AccountAuthorityFixture.ensureSchema(jdbc);
        jdbc.execute("ALTER TABLE campuscore_auth.\"UserRole\" ALTER COLUMN \"userId\" VARCHAR(512)");
        mvc.perform(put("/api/v1/site-appearance")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"version\":1,\"accent\":\"campus-gold\"}")
                        .with(fixtureJwt(jdbc, subject, token -> token
                                .subject(subject)
                                .claim("email", "long-subject@campuscore.edu")
                                .claim("roles", List.of("ADMIN")), "ADMIN")
                                .authorities(new SimpleGrantedAuthority("ROLE_ADMIN"))))
                .andExpect(status().isOk());

        String storedActor = jdbc.queryForObject(
                "SELECT \"updatedBy\" FROM \"site\".\"Appearance\" WHERE \"id\" = ?",
                String.class,
                SiteAppearanceStore.ROW_ID);
        Assertions.assertEquals(SiteAppearanceStore.MAX_UPDATED_BY_CHARS, storedActor.length());
        Assertions.assertTrue(storedActor.length() < subject.length());
    }

    @Test
    @DisplayName("non-object payloads are rejected with 400")
    void nonObjectPayloadRejected() throws Exception {
        mvc.perform(put("/api/v1/site-appearance")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("[1,2,3]")
                        .with(admin()))
                .andExpect(status().isBadRequest());
    }

    @Test
    @DisplayName("a save carrying a version another administrator already replaced is refused")
    void staleExpectedVersionIsRejected() throws Exception {
        JsonNode first = bodyOf(save("{\"accent\":\"campus-gold\"}"));
        long openedVersion = first.path("version").asLong();
        JsonNode concurrent = bodyOf(save("{\"accent\":\"river-blue\"}"));

        mvc.perform(put("/api/v1/site-appearance")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"accent\":\"paper-red\",\"expectedVersion\":" + openedVersion + "}")
                        .with(admin()))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("STALE_VERSION"));

        mvc.perform(get("/api/v1/site-appearance"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.accent").value("river-blue"))
                .andExpect(jsonPath("$.version").value(concurrent.path("version").asLong()));
    }

    @Test
    @DisplayName("a save carrying the current version is applied and advances the stored version")
    void matchingExpectedVersionIsApplied() throws Exception {
        JsonNode first = bodyOf(save("{\"accent\":\"campus-gold\"}"));
        long openedVersion = first.path("version").asLong();

        JsonNode saved = bodyOf(save(
                "{\"accent\":\"river-blue\",\"expectedVersion\":" + openedVersion + "}"));

        Assertions.assertTrue(
                saved.path("version").asLong() > openedVersion,
                "a successful write must advance the version");
        Assertions.assertFalse(
                saved.has("expectedVersion"),
                "the precondition field is request metadata, not part of the saved document");
        mvc.perform(get("/api/v1/site-appearance"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.accent").value("river-blue"))
                .andExpect(jsonPath("$.expectedVersion").doesNotExist());
    }

    @Test
    @DisplayName("a client that sends no expected version keeps last-write-wins")
    void legacySaveStaysLastWriteWins() throws Exception {
        save("{\"accent\":\"campus-gold\"}");
        save("{\"accent\":\"river-blue\"}");

        mvc.perform(get("/api/v1/site-appearance"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.accent").value("river-blue"));
    }

    @Test
    @DisplayName("a conditional save cannot invent the version of a document that was never stored")
    void conditionalSaveRequiresAStoredDocument() throws Exception {
        mvc.perform(put("/api/v1/site-appearance")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"accent\":\"campus-gold\",\"expectedVersion\":1}")
                        .with(admin()))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("STALE_VERSION"));

        Assertions.assertEquals(
                0,
                jdbc.queryForObject("SELECT COUNT(*) FROM \"site\".\"Appearance\"", Integer.class));
    }

    @Test
    @DisplayName("expectedVersion must be a whole non-negative number")
    void invalidExpectedVersionIsRejected() throws Exception {
        save("{\"accent\":\"campus-gold\"}");

        mvc.perform(put("/api/v1/site-appearance")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"accent\":\"river-blue\",\"expectedVersion\":\"nope\"}")
                        .with(admin()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("appearance_expected_version_invalid"));
        mvc.perform(put("/api/v1/site-appearance")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"accent\":\"river-blue\",\"expectedVersion\":-1}")
                        .with(admin()))
                .andExpect(status().isBadRequest());
    }

    @Test
    @DisplayName("the version check runs inside the update, so a write that slips in behind the read still conflicts")
    void conditionalWriteDetectsAPayloadReplacedAfterTheRead() throws Exception {
        JsonNode first = bodyOf(save("{\"accent\":\"campus-gold\"}"));
        long openedVersion = first.path("version").asLong();

        NamedParameterJdbcTemplate racing = new NamedParameterJdbcTemplate(dataSource) {
            private boolean raced;

            @Override
            public int update(String sql, SqlParameterSource params) {
                if (!raced && sql.contains("\"payload\" = :expectedPayload")) {
                    raced = true;
                    // A competing writer lands between this store's read and
                    // its conditional update, without changing the version the
                    // stale editor is holding.
                    jdbc.update("UPDATE \"site\".\"Appearance\" SET \"payload\" = ? WHERE \"id\" = ?",
                            "{\"version\":" + openedVersion + ",\"accent\":\"paper-red\"}",
                            SiteAppearanceStore.ROW_ID);
                }
                return super.update(sql, params);
            }
        };
        SiteAppearanceStore racingStore = new SiteAppearanceStore(racing, JSON);

        var failure = Assertions.assertThrows(
                DomainException.class,
                () -> racingStore.write(
                        "{\"accent\":\"river-blue\"}", "admin-1", openedVersion));
        Assertions.assertEquals(HttpStatus.CONFLICT, failure.getStatus());
        Assertions.assertEquals("STALE_VERSION", failure.getCode());

        mvc.perform(get("/api/v1/site-appearance"))
                .andExpect(jsonPath("$.accent").value("paper-red"));
    }
}
