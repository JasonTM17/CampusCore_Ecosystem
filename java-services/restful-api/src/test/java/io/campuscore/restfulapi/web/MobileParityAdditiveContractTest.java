package io.campuscore.restfulapi.web;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import io.campuscore.restfulapi.events.web.ListPaging;
import io.campuscore.restfulapi.testsupport.AccountAuthorityFixture;
import io.campuscore.restfulapi.testsupport.CurrentAccountJwt;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.core.io.ClassPathResource;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.init.ScriptUtils;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.RequestPostProcessor;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * H2 contract test for the additive mobile surface: optional {@code page} /
 * {@code limit} on bare-array lists (legacy shape untouched when absent) and
 * the multipart twins of the base64 attachment operations in admissions,
 * careers and learning (same ownership, checksum, size and idempotency rules).
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles({"test", "persistence"})
@TestPropertySource(properties = {
        "spring.flyway.enabled=false",
        "spring.datasource.url=jdbc:h2:mem:mobile_parity_additive;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1"
})
class MobileParityAdditiveContractTest {

    private static final String TOTAL = ListPaging.TOTAL_COUNT_HEADER;
    private static final byte[] PDF = "%PDF-1.4 synthetic".getBytes(StandardCharsets.UTF_8);
    private static final byte[] PNG = {(byte) 0x89, 'P', 'N', 'G', 0x0D, 0x0A};
    /** One byte over the 5 MiB attachment ceiling. */
    private static final int OVER_LIMIT = 5 * 1024 * 1024 + 1;

    @Autowired
    private JdbcTemplate jdbc;

    @Autowired
    private MockMvc mvc;

    @Autowired
    private ObjectMapper objectMapper;

    private RequestPostProcessor student1;
    private RequestPostProcessor student2;
    private RequestPostProcessor student3;
    private RequestPostProcessor lecturer1;
    private RequestPostProcessor lecturer2;

    @BeforeEach
    void fixture() throws Exception {
        jdbc.execute("CREATE SCHEMA IF NOT EXISTS campuscore_auth");
        jdbc.execute("CREATE SCHEMA IF NOT EXISTS notifications");
        for (String schema : List.of("events", "library", "careers", "admissions", "learning", "academic")) {
            jdbc.execute("DROP SCHEMA IF EXISTS " + schema + " CASCADE");
            jdbc.execute("CREATE SCHEMA " + schema);
        }
        jdbc.execute("DROP TABLE IF EXISTS notifications.notification");
        jdbc.execute("""
                CREATE TABLE notifications.notification (
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
        jdbc.execute("""
                CREATE TABLE academic."Course" (
                    "id" VARCHAR(120) PRIMARY KEY, "code" VARCHAR(60) NOT NULL, "name" VARCHAR(240) NOT NULL)""");
        jdbc.execute("""
                CREATE TABLE academic."Section" (
                    "id" VARCHAR(120) PRIMARY KEY, "sectionNumber" VARCHAR(80) NOT NULL,
                    "courseId" VARCHAR(120) NOT NULL, "semesterId" VARCHAR(120) NOT NULL,
                    "lecturerId" VARCHAR(120), "capacity" INTEGER NOT NULL, "status" VARCHAR(40) NOT NULL)""");
        jdbc.execute("""
                CREATE TABLE academic."Student" (
                    "id" VARCHAR(120) PRIMARY KEY, "userId" VARCHAR(120) NOT NULL UNIQUE,
                    "studentId" VARCHAR(120) NOT NULL, "status" VARCHAR(40) NOT NULL DEFAULT 'ACTIVE')""");
        jdbc.execute("""
                CREATE TABLE academic."Enrollment" (
                    "id" VARCHAR(120) PRIMARY KEY, "studentId" VARCHAR(120) NOT NULL,
                    "sectionId" VARCHAR(120) NOT NULL, "semesterId" VARCHAR(120) NOT NULL,
                    "status" VARCHAR(40) NOT NULL, "enrolledAt" TIMESTAMP WITH TIME ZONE)""");
        try (java.sql.Connection connection = jdbc.getDataSource().getConnection()) {
            for (String script : List.of("V137__events_schema_and_grants", "V139__learning_schema",
                    "V140__admissions_schema", "V141__library_schema", "V142__careers_schema")) {
                ScriptUtils.executeSqlScript(connection,
                        new ClassPathResource("db/migration-h2/" + script + ".sql"));
            }
        }

        AccountAuthorityFixture.ensureSchema(jdbc);
        for (String user : List.of("student-1", "student-2", "student-3", "lecturer-1", "lecturer-2")) {
            AccountAuthorityFixture.ensureUser(jdbc, user);
        }
        AccountAuthorityFixture.student(jdbc, "student-1", "stu-1", 2);
        AccountAuthorityFixture.student(jdbc, "student-2", "stu-2", 2);
        AccountAuthorityFixture.student(jdbc, "student-3", "stu-3", 1);
        AccountAuthorityFixture.lecturer(jdbc, "lecturer-1", "lec-1");
        AccountAuthorityFixture.lecturer(jdbc, "lecturer-2", "lec-2");
        for (int i = 1; i <= 3; i++) {
            jdbc.update("INSERT INTO academic.\"Student\" (\"id\", \"userId\", \"studentId\") VALUES (?, ?, ?)",
                    "stu-" + i, "student-" + i, "SV00" + i);
        }
        jdbc.update("INSERT INTO academic.\"Course\" (\"id\", \"code\", \"name\") VALUES ('c-oop', 'OOP101', 'OOP')");
        jdbc.update("INSERT INTO academic.\"Section\" (\"id\", \"sectionNumber\", \"courseId\", \"semesterId\","
                + " \"lecturerId\", \"capacity\", \"status\") VALUES ('sec-a', '01', 'c-oop', 'sem-1', 'lec-1', 40, 'OPEN')");
        jdbc.update("INSERT INTO academic.\"Section\" (\"id\", \"sectionNumber\", \"courseId\", \"semesterId\","
                + " \"lecturerId\", \"capacity\", \"status\") VALUES ('sec-b', '02', 'c-oop', 'sem-1', 'lec-2', 40, 'OPEN')");
        for (int i = 1; i <= 2; i++) {
            jdbc.update("INSERT INTO academic.\"Enrollment\" (\"id\", \"studentId\", \"sectionId\", \"semesterId\","
                    + " \"status\", \"enrolledAt\") VALUES (?, ?, 'sec-a', 'sem-1', 'ENROLLED', CURRENT_TIMESTAMP)",
                    "enr-" + i, "stu-" + i);
        }
        student1 = CurrentAccountJwt.currentJwt(jdbc, "student-1");
        student2 = CurrentAccountJwt.currentJwt(jdbc, "student-2");
        student3 = CurrentAccountJwt.currentJwt(jdbc, "student-3");
        lecturer1 = CurrentAccountJwt.currentJwt(jdbc, "lecturer-1");
        lecturer2 = CurrentAccountJwt.currentJwt(jdbc, "lecturer-2");
    }

    // ---------------------------------------------------------------
    // helpers
    // ---------------------------------------------------------------

    private static String ts(String value) {
        return "TIMESTAMP WITH TIME ZONE '" + value + "+00'";
    }

    private void event(String id, String status, String startsAt) {
        jdbc.update("INSERT INTO events.\"Event\" (\"id\", \"title\", \"organizer\", \"status\", \"capacity\","
                + " \"startsAt\", \"endsAt\", \"ownerId\") VALUES ('" + id + "', 'Event " + id + "', 'Union', '"
                + status + "', 10, " + ts(startsAt) + ", " + ts("2031-12-31 23:00:00") + ", 'staff-1')");
    }

    private List<String> ids(MvcResult result) throws Exception {
        List<String> ids = new ArrayList<>();
        for (JsonNode row : objectMapper.readTree(result.getResponse().getContentAsString())) {
            ids.add(row.get("id").asText());
        }
        return ids;
    }

    private List<String> pagedIds(String url, int limit, int total) throws Exception {
        List<String> collected = new ArrayList<>();
        for (int page = 0; page * limit < total + limit; page++) {
            MvcResult result = mvc.perform(get(url + (url.contains("?") ? "&" : "?")
                            + "page=" + page + "&limit=" + limit).with(student1))
                    .andExpect(status().isOk())
                    .andExpect(header().string(TOTAL, String.valueOf(total)))
                    .andReturn();
            collected.addAll(ids(result));
        }
        return collected;
    }

    private static String sha256(byte[] bytes) throws Exception {
        return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
    }

    private static byte[] sized(int length) {
        byte[] bytes = new byte[length];
        System.arraycopy(PDF, 0, bytes, 0, PDF.length);
        return bytes;
    }

    private static MockMultipartFile file(String name, String type, byte[] bytes) {
        return new MockMultipartFile("file", name, type, bytes);
    }

    private static String b64(byte[] bytes) {
        return java.util.Base64.getEncoder().encodeToString(bytes);
    }

    // ---------------------------------------------------------------
    // optional paging on bare-array lists
    // ---------------------------------------------------------------

    @Test
    void eventsKeepLegacyShapeAndPageWithTotalCount() throws Exception {
        event("ev-c", "PUBLISHED", "2031-01-01 09:00:00");
        event("ev-a", "PUBLISHED", "2031-01-01 09:00:00");
        event("ev-b", "REGISTRATION_OPEN", "2031-01-01 09:00:00");
        event("ev-e", "PUBLISHED", "2031-02-01 09:00:00");
        event("ev-d", "COMPLETED", "2030-12-01 09:00:00");
        event("ev-draft", "DRAFT", "2030-01-01 09:00:00");

        MvcResult legacy = mvc.perform(get("/api/v1/events").with(student1))
                .andExpect(status().isOk())
                .andExpect(header().doesNotExist(TOTAL))
                .andExpect(jsonPath("$.length()").value(5))
                .andReturn();
        assertThat(objectMapper.readTree(legacy.getResponse().getContentAsString()).isArray()).isTrue();

        // Ties on startsAt order by id, so pages never overlap or skip.
        List<String> expected = List.of("ev-d", "ev-a", "ev-b", "ev-c", "ev-e");
        assertThat(pagedIds("/api/v1/events", 2, 5)).isEqualTo(expected);
        assertThat(pagedIds("/api/v1/events", 2, 5)).isEqualTo(expected);
        assertThat(ids(legacy)).containsExactlyInAnyOrderElementsOf(expected);

        mvc.perform(get("/api/v1/events?page=9&limit=2").with(student1))
                .andExpect(status().isOk())
                .andExpect(header().string(TOTAL, "5"))
                .andExpect(content().json("[]"));
        mvc.perform(get("/api/v1/events?limit=100").with(student1))
                .andExpect(status().isOk())
                .andExpect(header().string(TOTAL, "5"))
                .andExpect(jsonPath("$.length()").value(5));
    }

    @Test
    void eventRegistrationsPageOnlyTheCallersOwnRows() throws Exception {
        event("ev-1", "REGISTRATION_OPEN", "2031-01-01 09:00:00");
        event("ev-2", "REGISTRATION_OPEN", "2031-01-02 09:00:00");
        for (String registration : List.of("r-1", "r-2")) {
            jdbc.update("INSERT INTO events.\"Registration\" (\"id\", \"eventId\", \"studentId\", \"status\","
                    + " \"registeredAt\") VALUES (?, ?, 'student-1', 'REGISTERED', " + ts("2031-01-01 08:00:00") + ")",
                    registration, registration.equals("r-1") ? "ev-1" : "ev-2");
        }
        jdbc.update("INSERT INTO events.\"Registration\" (\"id\", \"eventId\", \"studentId\", \"status\")"
                + " VALUES ('r-other', 'ev-1', 'student-2', 'REGISTERED')");

        mvc.perform(get("/api/v1/events/my/registrations").with(student1))
                .andExpect(status().isOk())
                .andExpect(header().doesNotExist(TOTAL))
                .andExpect(jsonPath("$.length()").value(2));
        mvc.perform(get("/api/v1/events/my/registrations?page=0&limit=1").with(student1))
                .andExpect(status().isOk())
                .andExpect(header().string(TOTAL, "2"))
                .andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].registrationId").value("r-1"));
        mvc.perform(get("/api/v1/events/my/registrations?page=1&limit=1").with(student1))
                .andExpect(jsonPath("$[0].registrationId").value("r-2"));
        mvc.perform(get("/api/v1/events/my/registrations?page=0&limit=10").with(student3))
                .andExpect(header().string(TOTAL, "0"))
                .andExpect(content().json("[]"));
    }

    @Test
    void libraryCatalogueKeepsLegacyShapeAndPagesAfterTheQueryFilter() throws Exception {
        String[][] titles = {{"t-3", "Algorithms"}, {"t-1", "Algorithms"}, {"t-2", "Networks"},
                {"t-4", "Algorithms Advanced"}};
        for (String[] title : titles) {
            jdbc.update("INSERT INTO library.\"Title\" (\"id\", \"title\", \"author\") VALUES (?, ?, 'Synthetic')",
                    title[0], title[1]);
        }

        mvc.perform(get("/api/v1/library/catalogue").with(student1))
                .andExpect(status().isOk())
                .andExpect(header().doesNotExist(TOTAL))
                .andExpect(jsonPath("$.length()").value(4));
        assertThat(pagedIds("/api/v1/library/catalogue", 3, 4))
                .containsExactly("t-1", "t-3", "t-4", "t-2");
        mvc.perform(get("/api/v1/library/catalogue?query=algorithms&page=0&limit=2").with(student1))
                .andExpect(status().isOk())
                .andExpect(header().string(TOTAL, "3"))
                .andExpect(jsonPath("$.length()").value(2));
    }

    @Test
    void careerOpportunitiesPageOnlyPublishedPostings() throws Exception {
        jdbc.update("INSERT INTO careers.\"Organization\" (\"id\", \"name\") VALUES ('org-1', 'Alpha Demo Co')");
        String[][] postings = {{"o-b", "PUBLISHED"}, {"o-a", "PUBLISHED"}, {"o-c", "PUBLISHED"},
                {"o-draft", "DRAFT"}};
        for (String[] posting : postings) {
            jdbc.update("INSERT INTO careers.\"Opportunity\" (\"id\", \"organizationId\", \"title\", \"status\","
                    + " \"submittedBy\", \"publishedAt\") VALUES ('" + posting[0] + "', 'org-1', 'Job " + posting[0]
                    + "', '" + posting[1] + "', 'staff-1', " + ts("2031-01-01 09:00:07") + ")");
        }

        mvc.perform(get("/api/v1/careers/opportunities").with(student1))
                .andExpect(status().isOk())
                .andExpect(header().doesNotExist(TOTAL))
                .andExpect(jsonPath("$.length()").value(3));
        assertThat(pagedIds("/api/v1/careers/opportunities", 2, 3)).containsExactly("o-a", "o-b", "o-c");
    }

    @Test
    void invalidPagingAnswersTheErrorContract() throws Exception {
        for (String url : List.of("/api/v1/events", "/api/v1/library/catalogue", "/api/v1/careers/opportunities")) {
            for (String query : List.of("?limit=0", "?limit=101", "?page=-1&limit=5", "?page=0")) {
                mvc.perform(get(url + query).with(student1))
                        .andExpect(status().isBadRequest())
                        .andExpect(jsonPath("$.code").value("INVALID_PAGING"));
            }
            mvc.perform(get(url + "?page=x&limit=5").with(student1))
                    .andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.code").value("INVALID_REQUEST"));
        }
    }

    @Test
    void pagingKeepsEndpointOrderAndOnlyOrdersTiesById() {
        record Row(String id, int rank) {
        }
        List<Row> rows = List.of(new Row("z", 1), new Row("m", 1), new Row("a", 1), new Row("q", 2), new Row("b", 3),
                new Row("a2", 3));
        List<String> body = ListPaging.respond(rows, ListPaging.Window.of(0, 6), Row::rank, Row::id)
                .getBody().stream().map(Row::id).toList();
        assertThat(body).containsExactly("a", "m", "z", "q", "a2", "b");
        var second = ListPaging.respond(rows, ListPaging.Window.of(1, 4), Row::rank, Row::id);
        assertThat(second.getBody()).extracting(Row::id).containsExactly("a2", "b");
        assertThat(second.getHeaders().getFirst(TOTAL)).isEqualTo("6");
        assertThat(ListPaging.respond(rows, null).getBody()).isSameAs(rows);
        assertThat(ListPaging.respond(rows, null).getHeaders().getFirst(TOTAL)).isNull();
    }

    // ---------------------------------------------------------------
    // multipart attachments
    // ---------------------------------------------------------------

    private String admissionsDraft(RequestPostProcessor applicant, String key) throws Exception {
        MvcResult result = mvc.perform(post("/api/v1/admissions/applications")
                        .with(applicant).header("Idempotency-Key", key)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"cycle\":\"2026-Q1-DEMO\"}"))
                .andExpect(status().isCreated())
                .andReturn();
        return objectMapper.readTree(result.getResponse().getContentAsString()).get("id").asText();
    }

    private int attachmentRows(String table, String id) {
        return jdbc.queryForObject("SELECT COUNT(*) FROM " + table + " WHERE \"applicationId\" = ?",
                Integer.class, id);
    }

    @Test
    void admissionsMultipartReusesOwnershipChecksumIdempotencyAndSizeRules() throws Exception {
        String id = admissionsDraft(student1, "adm-create");
        String url = "/api/v1/admissions/applications/" + id + "/attachments";

        MvcResult uploaded = mvc.perform(multipart(url).file(file("../CV final.pdf", "application/pdf", PDF))
                        .param("checksum", sha256(PDF)).with(student1).header("Idempotency-Key", "adm-up-1"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.attachments.length()").value(1))
                .andExpect(jsonPath("$.attachments[0].fileName").value("CV final.pdf"))
                .andExpect(jsonPath("$.attachments[0].contentType").value("application/pdf"))
                .andExpect(jsonPath("$.attachments[0].checksum").value(sha256(PDF)))
                .andReturn();
        String attachmentId = objectMapper.readTree(uploaded.getResponse().getContentAsString())
                .at("/attachments/0/id").asText();
        mvc.perform(get(url + "/" + attachmentId + "/file").with(student1))
                .andExpect(status().isOk())
                .andExpect(content().bytes(PDF));

        // Same key + same bytes replays; no second row.
        mvc.perform(multipart(url).file(file("CV final.pdf", "application/pdf", PDF))
                        .with(student1).header("Idempotency-Key", "adm-up-1"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.attachments.length()").value(1));
        assertThat(attachmentRows("admissions.\"Attachment\"", id)).isEqualTo(1);

        mvc.perform(multipart(url).file(file("bad.pdf", "application/pdf", PDF))
                        .param("checksum", sha256(PNG)).with(student1).header("Idempotency-Key", "adm-up-2"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("FILE_CHECKSUM_MISMATCH"));
        mvc.perform(multipart(url).file(file("page.html", "text/html", "<html></html>".getBytes(StandardCharsets.UTF_8)))
                        .with(student1).header("Idempotency-Key", "adm-up-3"))
                .andExpect(status().isUnsupportedMediaType())
                .andExpect(jsonPath("$.code").value("ATTACHMENT_TYPE_UNSUPPORTED"));
        mvc.perform(multipart(url).file(file("fake.pdf", "application/pdf", PNG))
                        .with(student1).header("Idempotency-Key", "adm-up-4"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("ATTACHMENT_CONTENT_MISMATCH"));
        mvc.perform(multipart(url).file(file("big.pdf", "application/pdf", sized(OVER_LIMIT)))
                        .with(student1).header("Idempotency-Key", "adm-up-5"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("ATTACHMENT_SIZE_INVALID"));
        mvc.perform(multipart(url).file(file("cv.pdf", "application/pdf", PDF)).with(student1))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("IDEMPOTENCY_KEY_REQUIRED"));
        mvc.perform(multipart(url).with(student1).header("Idempotency-Key", "adm-up-6"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("ATTACHMENT_DATA_REQUIRED"));

        // Another applicant cannot reach the application through the multipart lane.
        mvc.perform(multipart(url).file(file("evil.pdf", "application/pdf", PDF))
                        .with(student2).header("Idempotency-Key", "adm-up-7"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("APPLICATION_NOT_FOUND"));
        mvc.perform(get(url + "/" + attachmentId + "/file").with(student2))
                .andExpect(status().isNotFound());
        assertThat(attachmentRows("admissions.\"Attachment\"", id)).isEqualTo(1);

        // The base64 JSON lane is untouched.
        mvc.perform(post(url).with(student1).header("Idempotency-Key", "adm-json-1")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"fileName\":\"note.txt\",\"contentType\":\"text/plain\",\"dataBase64\":\""
                                + b64("hello".getBytes(StandardCharsets.UTF_8)) + "\"}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.attachments.length()").value(2));
    }

    @Test
    void careersMultipartReusesOwnershipChecksumAndTypeRules() throws Exception {
        jdbc.update("INSERT INTO careers.\"Organization\" (\"id\", \"name\") VALUES ('org-1', 'Alpha Demo Co')");
        jdbc.update("INSERT INTO careers.\"Opportunity\" (\"id\", \"organizationId\", \"title\", \"status\","
                + " \"submittedBy\", \"publishedAt\") VALUES ('opp-1', 'org-1', 'Job', 'PUBLISHED', 'staff-1',"
                + " CURRENT_TIMESTAMP)");
        MvcResult applied = mvc.perform(post("/api/v1/careers/applications").with(student1)
                        .header("Idempotency-Key", "car-apply")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"opportunityId\":\"opp-1\",\"coverLetter\":\"hello\"}"))
                .andExpect(status().isOk())
                .andReturn();
        String id = objectMapper.readTree(applied.getResponse().getContentAsString()).get("id").asText();
        String url = "/api/v1/careers/applications/" + id + "/attachments";

        MvcResult uploaded = mvc.perform(multipart(url).file(file("cv.pdf", "application/pdf", PDF))
                        .param("checksum", sha256(PDF)).with(student1).header("Idempotency-Key", "car-up-1"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.attachments.length()").value(1))
                .andExpect(jsonPath("$.attachments[0].fileName").value("cv.pdf"))
                .andReturn();
        String attachmentId = objectMapper.readTree(uploaded.getResponse().getContentAsString())
                .at("/attachments/0/id").asText();
        mvc.perform(get(url + "/" + attachmentId + "/download").with(student1))
                .andExpect(status().isOk())
                .andExpect(content().bytes(PDF));

        mvc.perform(multipart(url).file(file("cv.pdf", "application/pdf", PDF))
                        .param("checksum", sha256(PNG)).with(student1).header("Idempotency-Key", "car-up-2"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("FILE_CHECKSUM_MISMATCH"));
        mvc.perform(multipart(url).file(file("run.exe", "application/x-msdownload", PDF))
                        .with(student1).header("Idempotency-Key", "car-up-3"))
                .andExpect(status().isUnsupportedMediaType())
                .andExpect(jsonPath("$.code").value("ATTACHMENT_TYPE_UNSUPPORTED"));
        mvc.perform(multipart(url).file(file("big.pdf", "application/pdf", sized(OVER_LIMIT)))
                        .with(student1).header("Idempotency-Key", "car-up-4"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("ATTACHMENT_SIZE_INVALID"));

        mvc.perform(multipart(url).file(file("evil.pdf", "application/pdf", PDF))
                        .with(student2).header("Idempotency-Key", "car-up-5"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("APPLICATION_NOT_FOUND"));
        assertThat(attachmentRows("careers.\"Attachment\"", id)).isEqualTo(1);

        mvc.perform(post(url).with(student1).header("Idempotency-Key", "car-json-1")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"fileName\":\"note.txt\",\"contentType\":\"text/plain\",\"dataBase64\":\""
                                + b64("hello".getBytes(StandardCharsets.UTF_8)) + "\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.attachments.length()").value(2));
    }

    @Test
    void learningMultipartKeepsSectionAndSubmissionOwnership() throws Exception {
        String materials = "/api/v1/learning/staff/sections/sec-a/materials";
        mvc.perform(multipart(materials).file(file("slides.pdf", "application/pdf", PDF))
                        .param("title", "Week 1").param("checksum", sha256(PDF)).with(lecturer1))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.title").value("Week 1"))
                .andExpect(jsonPath("$.fileName").value("slides.pdf"))
                .andExpect(jsonPath("$.checksum").value(sha256(PDF)));
        mvc.perform(multipart(materials).file(file("slides.pdf", "application/pdf", PDF))
                        .param("title", "Week 1").with(lecturer2))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("SECTION_NOT_ASSIGNED"));
        mvc.perform(multipart(materials).file(file("run.exe", "application/x-msdownload", PDF))
                        .param("title", "Week 2").with(lecturer1))
                .andExpect(status().isUnsupportedMediaType())
                .andExpect(jsonPath("$.code").value("ATTACHMENT_TYPE_UNSUPPORTED"));
        mvc.perform(multipart(materials).file(file("slides.pdf", "application/pdf", PDF))
                        .param("title", "Week 2").param("checksum", sha256(PNG)).with(lecturer1))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.code").value("FILE_CHECKSUM_MISMATCH"));
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM learning.\"Material\"", Integer.class)).isEqualTo(1);

        MvcResult assignment = mvc.perform(post("/api/v1/learning/staff/sections/sec-a/assignments")
                        .with(lecturer1).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"title\":\"Report\",\"description\":\"d\",\"deadlineAt\":\""
                                + Instant.now().plus(2, ChronoUnit.DAYS) + "\",\"maxScore\":10.0}"))
                .andExpect(status().isCreated())
                .andReturn();
        String assignmentId = objectMapper.readTree(assignment.getResponse().getContentAsString()).get("id").asText();
        mvc.perform(post("/api/v1/learning/staff/assignments/" + assignmentId + "/publish").with(lecturer1))
                .andExpect(status().isOk());
        MvcResult draft = mvc.perform(post("/api/v1/learning/assignments/" + assignmentId + "/draft")
                        .with(student1).header("Idempotency-Key", "lms-draft"))
                .andExpect(status().isCreated())
                .andReturn();
        String submissionId = objectMapper.readTree(draft.getResponse().getContentAsString()).get("id").asText();
        String draftUrl = "/api/v1/learning/submissions/" + submissionId + "/draft";

        mvc.perform(multipart(HttpMethod.PUT, draftUrl).file(file("report.pdf", "application/pdf", PDF))
                        .param("textBody", "my report").param("checksum", sha256(PDF)).with(student1))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("DRAFT"));
        assertThat(jdbc.queryForObject("SELECT \"draftFileName\" FROM learning.\"Submission\" WHERE \"id\" = ?",
                String.class, submissionId)).isEqualTo("report.pdf");

        // Another enrolled student and an outsider both get the same 404; nothing is written.
        for (RequestPostProcessor other : List.of(student2, student3)) {
            mvc.perform(multipart(HttpMethod.PUT, draftUrl).file(file("steal.pdf", "application/pdf", PDF))
                            .with(other))
                    .andExpect(status().isNotFound())
                    .andExpect(jsonPath("$.code").value("SUBMISSION_NOT_FOUND"));
        }
        mvc.perform(multipart(HttpMethod.PUT, draftUrl).file(file("run.exe", "application/x-msdownload", PDF))
                        .with(student1))
                .andExpect(status().isUnsupportedMediaType());
        mvc.perform(multipart(HttpMethod.PUT, draftUrl).file(file("big.pdf", "application/pdf",
                                sized(OVER_LIMIT)))
                        .with(student1))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("ATTACHMENT_SIZE_INVALID"));
        assertThat(jdbc.queryForObject("SELECT \"draftFileName\" FROM learning.\"Submission\" WHERE \"id\" = ?",
                String.class, submissionId)).isEqualTo("report.pdf");

        // The base64 JSON lane still works.
        mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put(draftUrl)
                        .with(student1).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"textBody\":\"json\",\"fileName\":\"j.txt\",\"contentType\":\"text/plain\","
                                + "\"contentBase64\":\"" + b64("hello".getBytes(StandardCharsets.UTF_8)) + "\"}"))
                .andExpect(status().isOk());
        assertThat(jdbc.queryForObject("SELECT \"draftFileName\" FROM learning.\"Submission\" WHERE \"id\" = ?",
                String.class, submissionId)).isEqualTo("j.txt");
    }

    @Test
    void openApiDocumentsPagingHeaderAndBothUploadEncodings() throws Exception {
        MvcResult docs = mvc.perform(get("/v3/api-docs")).andExpect(status().isOk()).andReturn();
        JsonNode spec = objectMapper.readTree(docs.getResponse().getContentAsString());
        JsonNode events = spec.at("/paths/~1api~1v1~1events/get");
        assertThat(events.at("/responses/200/headers/" + TOTAL).isMissingNode()).isFalse();
        List<String> parameters = new ArrayList<>();
        events.at("/parameters").forEach(parameter -> parameters.add(parameter.get("name").asText()));
        assertThat(parameters).contains("page", "limit");
        JsonNode upload = spec.at("/paths/~1api~1v1~1admissions~1applications~1{applicationId}~1attachments/post");
        assertThat(upload.at("/requestBody/content/application~1json").isMissingNode()).isFalse();
        assertThat(upload.at("/requestBody/content/multipart~1form-data").isMissingNode()).isFalse();
    }
}
