package io.campuscore.restfulapi.thesis;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import io.campuscore.restfulapi.thesis.ThesisArchiveSearchOracle.Case;
import io.campuscore.restfulapi.thesis.ThesisArchiveSearchOracle.Fixture;
import java.nio.charset.StandardCharsets;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
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
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * W19 archive search contract.
 *
 * <p>Every assertion is written against the HTTP surface only, so the same suite
 * failed before the endpoint accepted {@code search} or emitted the archive
 * headers: an unknown query parameter was ignored and the summary headers did
 * not exist. The expected rows come from the frozen web predicate
 * ({@link ThesisArchiveSearchOracle}), not from the server implementation.
 *
 * <p>The four mandatory headers are always asserted on a paged call:
 * {@code X-Total-Count} is the filtered total and the three
 * {@code X-Archive-*} values are the unfiltered authorized round totals.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles({"test", "persistence"})
@TestPropertySource(properties = {
        "spring.datasource.url=jdbc:h2:mem:restful_api_archive_search_contract;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1",
        "spring.datasource.username=sa",
        "spring.datasource.password=",
        "spring.flyway.enabled=true",
        "spring.flyway.locations=classpath:db/migration-h2",
        "thesis.report.storage.local-root=target/test-report-storage"
})
class ThesisArchiveSearchContractTest {

    private static final String TOTAL = "X-Total-Count";
    private static final String ARCHIVE_TOTAL = "X-Archive-Total-Count";
    private static final String ARCHIVE_FILES = "X-Archive-File-Count";
    private static final String ARCHIVE_URLS = "X-Archive-Url-Count";

    private static final Fixture FIXTURE = ThesisArchiveSearchOracle.load();

    @Autowired
    private JdbcTemplate jdbc;

    @Autowired
    private MockMvc mvc;

    @Autowired
    private ObjectMapper mapper;

    private String tag;
    private UUID round;
    private RequestPostProcessor admin;
    private Map<String, UUID> reportIds;

    @BeforeEach
    void seedFixtureArchive() {
        tag = "ars" + UUID.randomUUID().toString().replace("-", "").substring(0, 10);
        cleanFixtures();
        round = insertRound(tag + "-round");
        reportIds = ThesisArchiveSearchOracle.seed(jdbc, round, tag, FIXTURE);
        admin = admin();
    }

    @AfterEach
    void cleanFixtures() {
        // Clean by the suite prefix so a previous test's unique student numbers
        // cannot collide with this one's fixture.
        String prefix = "ars%";
        String rounds = "SELECT id FROM thesis.thesis_registration_round WHERE name LIKE '" + prefix + "'";
        jdbc.update("DELETE FROM thesis.thesis_group_report WHERE round_id IN (" + rounds + ")");
        jdbc.update("DELETE FROM thesis.thesis_group WHERE round_id IN (" + rounds + ")");
        jdbc.update("DELETE FROM thesis.thesis_topic_supervisor "
                + "WHERE topic_id IN (SELECT id FROM thesis.thesis_topic WHERE round_id IN (" + rounds + "))");
        jdbc.update("DELETE FROM thesis.thesis_topic WHERE round_id IN (" + rounds + ")");
        jdbc.update("DELETE FROM thesis.thesis_registration_round WHERE name LIKE ?", prefix);
        jdbc.update("DELETE FROM campuscore_auth.\"Student\" WHERE \"id\" LIKE ?", prefix);
        jdbc.update("DELETE FROM campuscore_auth.\"Lecturer\" WHERE \"id\" LIKE ?", prefix);
        jdbc.update("DELETE FROM campuscore_auth.\"User\" WHERE \"id\" LIKE ?", prefix);
        jdbc.update("DELETE FROM academic.\"Department\" WHERE \"id\" LIKE ?", prefix);
        jdbc.update("DELETE FROM academic.\"Faculty\" WHERE \"id\" LIKE ?", prefix);
    }

    // --- equivalence -----------------------------------------------------

    @Test
    void everyFrozenWebCaseReturnsTheSameRowsAndSummaryFromTheServer() throws Exception {
        assertThat(FIXTURE.cases()).hasSizeGreaterThanOrEqualTo(25);
        for (Case item : FIXTURE.cases()) {
            MvcResult result = mvc.perform(get("/api/v1/thesis/rounds/{id}/repository", round)
                            .param("search", item.search())
                            .param("page", "0")
                            .param("limit", "100")
                            .with(admin))
                    .andExpect(status().isOk())
                    .andExpect(header().string(TOTAL, String.valueOf(item.expect().size())))
                    .andExpect(header().string(ARCHIVE_TOTAL, String.valueOf(FIXTURE.total())))
                    .andExpect(header().string(ARCHIVE_FILES, String.valueOf(FIXTURE.files())))
                    .andExpect(header().string(ARCHIVE_URLS, String.valueOf(FIXTURE.urls())))
                    .andReturn();
            assertThat(reportIds(result))
                    .as("case %s (%s)", item.name(), item.search())
                    .containsExactlyElementsOf(expect(item));
        }
    }

    @Test
    void matchesBeyondTheFirstPageAreReachableAndPagesConcatenateToTheOracle() throws Exception {
        // "co ban" matches eight rounds of the department name, including the last
        // two roots, so a first-page-only filter would miss them entirely.
        List<UUID> fromOracle = ThesisArchiveSearchOracle.matches(FIXTURE, "co ban").stream()
                .map(reportIds::get).toList();
        assertThat(fromOracle).hasSize(8).contains(reportIds.get("r03"), reportIds.get("r12"));
        assertThat(fromOracle.subList(0, 2)).doesNotContain(reportIds.get("r12"));

        List<UUID> concatenated = new ArrayList<>();
        int[] sizes = {2, 2, 2, 2};
        for (int page = 0; page < sizes.length; page++) {
            MvcResult result = mvc.perform(get("/api/v1/thesis/rounds/{id}/repository", round)
                            .param("search", "co ban")
                            .param("page", String.valueOf(page))
                            .param("limit", "2")
                            .with(admin))
                    .andExpect(status().isOk())
                    .andExpect(header().string(TOTAL, "8"))
                    .andExpect(header().string(ARCHIVE_TOTAL, "13"))
                    .andReturn();
            List<UUID> pageIds = reportIds(result);
            assertThat(pageIds).as("page %d", page).hasSize(sizes[page]);
            concatenated.addAll(pageIds);
        }
        assertThat(concatenated).containsExactlyElementsOf(fromOracle);
        assertThat(concatenated).doesNotHaveDuplicates();
    }

    @Test
    void emptyAndOutOfRangePagesStillCarryAllFourHeaders() throws Exception {
        mvc.perform(get("/api/v1/thesis/rounds/{id}/repository", round)
                        .param("search", "zzz-none")
                        .param("page", "0").param("limit", "5").with(admin))
                .andExpect(status().isOk())
                .andExpect(header().string(TOTAL, "0"))
                .andExpect(header().string(ARCHIVE_TOTAL, "13"))
                .andExpect(header().string(ARCHIVE_FILES, "11"))
                .andExpect(header().string(ARCHIVE_URLS, "10"))
                .andExpect(jsonPath("$.length()").value(0));

        mvc.perform(get("/api/v1/thesis/rounds/{id}/repository", round)
                        .param("search", "nguyen")
                        .param("page", "99").param("limit", "5").with(admin))
                .andExpect(status().isOk())
                .andExpect(header().string(TOTAL, "5"))
                .andExpect(header().string(ARCHIVE_TOTAL, "13"))
                .andExpect(header().string(ARCHIVE_FILES, "11"))
                .andExpect(header().string(ARCHIVE_URLS, "10"))
                .andExpect(jsonPath("$.length()").value(0));

        // No search at all: the same paged read still reports the unfiltered set.
        mvc.perform(get("/api/v1/thesis/rounds/{id}/repository", round)
                        .param("page", "99").param("limit", "5").with(admin))
                .andExpect(status().isOk())
                .andExpect(header().string(TOTAL, "13"))
                .andExpect(header().string(ARCHIVE_TOTAL, "13"))
                .andExpect(header().string(ARCHIVE_FILES, "11"))
                .andExpect(header().string(ARCHIVE_URLS, "10"));
    }

    @Test
    void blankSearchAddsNoPredicateButStillReportsTheSummary() throws Exception {
        for (String blank : List.of("", "   ", "\u00a0", "\t\n", "\u3000")) {
            MvcResult result = mvc.perform(get("/api/v1/thesis/rounds/{id}/repository", round)
                            .param("search", blank)
                            .param("page", "0").param("limit", "5").with(admin))
                    .andExpect(status().isOk())
                    .andExpect(header().string(TOTAL, "13"))
                    .andExpect(header().string(ARCHIVE_TOTAL, "13"))
                    .andReturn();
            assertThat(reportIds(result)).hasSize(5);
        }
    }

    @Test
    void repeatedSearchIsRejectedBeforeAnyDataIsRead() throws Exception {
        mvc.perform(get("/api/v1/thesis/rounds/{id}/repository", round)
                        .param("search", "nguyen").param("search", "nguyen")
                        .param("page", "0").param("limit", "5").with(admin))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_SEARCH"));

        mvc.perform(get("/api/v1/thesis/rounds/{id}/repository", round)
                        .param("search", "nguyen").param("search", "duc").with(admin))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_SEARCH"));
    }

    @Test
    void unpagedReadsKeepTheLegacyArrayAndAddNoHeaders() throws Exception {
        MvcResult legacy = mvc.perform(get("/api/v1/thesis/rounds/{id}/repository", round).with(admin))
                .andExpect(status().isOk())
                .andExpect(header().doesNotExist(TOTAL))
                .andExpect(header().doesNotExist(ARCHIVE_TOTAL))
                .andExpect(header().doesNotExist(ARCHIVE_FILES))
                .andExpect(header().doesNotExist(ARCHIVE_URLS))
                .andExpect(jsonPath("$.length()").value(13))
                .andReturn();
        assertThat(reportIds(legacy)).containsExactlyElementsOf(allReportIds());

        MvcResult filtered = mvc.perform(get("/api/v1/thesis/rounds/{id}/repository", round)
                        .param("search", "nguyen").with(admin))
                .andExpect(status().isOk())
                .andExpect(header().doesNotExist(TOTAL))
                .andExpect(header().doesNotExist(ARCHIVE_TOTAL))
                .andExpect(jsonPath("$.length()").value(5))
                .andReturn();
        assertThat(reportIds(filtered)).containsExactlyElementsOf(expect(
                FIXTURE.cases().stream().filter(item -> item.name().equals("ascii-across-fields"))
                        .findFirst().orElseThrow()));

        // A blank search is still the legacy read.
        mvc.perform(get("/api/v1/thesis/rounds/{id}/repository", round).param("search", "  ").with(admin))
                .andExpect(status().isOk())
                .andExpect(header().doesNotExist(TOTAL))
                .andExpect(jsonPath("$.length()").value(13));
    }

    @Test
    void searchRunsAfterAuthorizationAndBeforeTheTotal() throws Exception {
        // A lecturer-only scope: one visible report, one foreign report that also
        // contains the searched word. The word must not leak the foreign row or
        // change the authorized summary.
        UUID scopeRound = insertRound(tag + "-scope");
        UUID localTopic = insertTopic(scopeRound, "department-demo", "Local topic", "local searchable");
        UUID foreignTopic = insertTopic(scopeRound, tag + "-dept-0", "Foreign topic", "local searchable");
        UUID localGroup = insertGroup(scopeRound, localTopic, "SUBMITTED", "APPROVED");
        UUID foreignGroup = insertGroup(scopeRound, foreignTopic, "SUBMITTED", "APPROVED");
        insertReport(scopeRound, localGroup, Instant.parse("2032-02-01T10:00:00Z"), "Local report", "local.pdf",
                "https://example.test/local");
        insertReport(scopeRound, foreignGroup, Instant.parse("2032-02-01T09:00:00Z"), "Foreign report",
                "foreign.pdf", "https://example.test/foreign");
        String lecturerId = tag + "-scope-lecturer";
        ThesisAuthorityFixture.lecturer(jdbc, lecturerId);
        jdbc.update("UPDATE campuscore_auth.\"Lecturer\" SET \"departmentId\" = 'department-demo' WHERE \"id\" = ?",
                lecturerId);
        RequestPostProcessor lecturer = scopeRole(lecturerId);

        mvc.perform(get("/api/v1/thesis/rounds/{id}/repository", scopeRound)
                        .param("search", "local searchable").param("page", "0").param("limit", "20")
                        .with(lecturer))
                .andExpect(status().isOk())
                .andExpect(header().string(TOTAL, "1"))
                .andExpect(header().string(ARCHIVE_TOTAL, "1"))
                .andExpect(header().string(ARCHIVE_FILES, "1"))
                .andExpect(header().string(ARCHIVE_URLS, "1"));

        mvc.perform(get("/api/v1/thesis/rounds/{id}/repository", scopeRound)
                        .param("search", "foreign report").param("page", "0").param("limit", "20")
                        .with(lecturer))
                .andExpect(status().isOk())
                .andExpect(header().string(TOTAL, "0"))
                .andExpect(header().string(ARCHIVE_TOTAL, "1"))
                .andExpect(jsonPath("$.length()").value(0));

        // The admin still sees both rows for the same predicate.
        mvc.perform(get("/api/v1/thesis/rounds/{id}/repository", scopeRound)
                        .param("search", "local searchable").param("page", "0").param("limit", "20").with(admin()))
                .andExpect(status().isOk())
                .andExpect(header().string(TOTAL, "2"))
                .andExpect(header().string(ARCHIVE_TOTAL, "2"));
    }

    @Test
    void rosterFanOutCountsOneRootAndHydratesEveryChild() throws Exception {
        MvcResult result = mvc.perform(get("/api/v1/thesis/rounds/{id}/repository", round)
                        .param("search", "member alpha")
                        .param("page", "0").param("limit", "10").with(admin))
                .andExpect(status().isOk())
                .andExpect(header().string(TOTAL, "1"))
                .andExpect(jsonPath("$.length()").value(1))
                .andReturn();
        JsonNode row = readJson(result).get(0);
        assertThat(row.path("reportId").asString()).isEqualTo(reportIds.get("r04").toString());
        assertThat(row.path("members").size()).isEqualTo(4);
        assertThat(row.path("supervisors").size()).isEqualTo(2);

        // A supervisor token and a member token in different children still match
        // the same root; a token that only matches another report does not.
        mvc.perform(get("/api/v1/thesis/rounds/{id}/repository", round)
                        .param("search", "beta two").param("page", "0").param("limit", "10").with(admin))
                .andExpect(status().isOk())
                .andExpect(header().string(TOTAL, "1"))
                .andExpect(jsonPath("$[0].reportId").value(reportIds.get("r04").toString()));
        mvc.perform(get("/api/v1/thesis/rounds/{id}/repository", round)
                        .param("search", "alpha kim").param("page", "0").param("limit", "10").with(admin))
                .andExpect(status().isOk())
                .andExpect(header().string(TOTAL, "0"));
    }

    @Test
    void searchNeverReachesUrlOrIdentifiers() throws Exception {
        mvc.perform(get("/api/v1/thesis/rounds/{id}/repository", round)
                        .param("search", "drive.example.com")
                        .param("page", "0").param("limit", "10").with(admin))
                .andExpect(status().isOk())
                .andExpect(header().string(TOTAL, "0"));
        mvc.perform(get("/api/v1/thesis/rounds/{id}/repository", round)
                        .param("search", reportIds.get("r04").toString())
                        .param("page", "0").param("limit", "10").with(admin))
                .andExpect(status().isOk())
                .andExpect(header().string(TOTAL, "0"));
    }

    @Test
    void policyNeverTruncatesTheTermOrTheTokenCount() throws Exception {
        String fileName = FIXTURE.reports().stream()
                .filter(report -> report.id().equals("r06")).findFirst().orElseThrow().fileName();
        assertThat(fileName.length()).isGreaterThan(64);
        // The first 64 characters alone do match r06; the extra tail must be
        // applied, so a truncating policy would wrongly return r06 here.
        mvc.perform(get("/api/v1/thesis/rounds/{id}/repository", round)
                        .param("search", fileName.substring(0, 64) + "zzzzzzzzzzzzzzzz")
                        .param("page", "0").param("limit", "10").with(admin))
                .andExpect(status().isOk())
                .andExpect(header().string(TOTAL, "0"));
        mvc.perform(get("/api/v1/thesis/rounds/{id}/repository", round)
                        .param("search", fileName)
                        .param("page", "0").param("limit", "10").with(admin))
                .andExpect(status().isOk())
                .andExpect(header().string(TOTAL, "1"));

        // Nine tokens: the ninth is decisive, so an eight-token cap would match.
        mvc.perform(get("/api/v1/thesis/rounds/{id}/repository", round)
                        .param("search", "alpha bravo charlie delta echo foxtrot golf hotel nomatchzzz")
                        .param("page", "0").param("limit", "10").with(admin))
                .andExpect(status().isOk())
                .andExpect(header().string(TOTAL, "0"));
        mvc.perform(get("/api/v1/thesis/rounds/{id}/repository", round)
                        .param("search", "alpha bravo charlie delta echo foxtrot golf hotel india juliet")
                        .param("page", "0").param("limit", "10").with(admin))
                .andExpect(status().isOk())
                .andExpect(header().string(TOTAL, "1"));
    }

    @Test
    void archiveSummaryUsesJavaScriptTruthinessNotBlankTrimmedOrStorageState() throws Exception {
        UUID summaryRound = insertRound(tag + "-summary");
        UUID topic = insertTopic(summaryRound, "department-demo", "Summary topic", null);
        // file only, url only, both, neither, empty strings, whitespace strings.
        insertReport(summaryRound, insertGroup(summaryRound, topic, "SUBMITTED", "APPROVED"),
                Instant.parse("2032-03-01T10:00:00Z"), "file only", "file.pdf", null);
        insertReport(summaryRound, insertGroup(summaryRound, topic, "SUBMITTED", "APPROVED"),
                Instant.parse("2032-03-01T09:00:00Z"), "url only", null, "https://example.test/a");
        insertReport(summaryRound, insertGroup(summaryRound, topic, "SUBMITTED", "APPROVED"),
                Instant.parse("2032-03-01T08:00:00Z"), "both", "both.pdf", "https://example.test/b");
        insertReport(summaryRound, insertGroup(summaryRound, topic, "SUBMITTED", "APPROVED"),
                Instant.parse("2032-03-01T07:00:00Z"), "neither", null, null);
        insertReport(summaryRound, insertGroup(summaryRound, topic, "SUBMITTED", "APPROVED"),
                Instant.parse("2032-03-01T06:00:00Z"), "empty name", "", "");
        insertReport(summaryRound, insertGroup(summaryRound, topic, "SUBMITTED", "APPROVED"),
                Instant.parse("2032-03-01T05:00:00Z"), "whitespace name", " ", " ");

        MvcResult result = mvc.perform(get("/api/v1/thesis/rounds/{id}/repository", summaryRound)
                        .param("page", "0").param("limit", "2").with(admin()))
                .andExpect(status().isOk())
                .andExpect(header().string(TOTAL, "6"))
                .andExpect(header().string(ARCHIVE_TOTAL, "6"))
                .andExpect(header().string(ARCHIVE_FILES, "3"))
                .andExpect(header().string(ARCHIVE_URLS, "3"))
                .andReturn();
        assertThat(reportIds(result)).hasSize(2);

        // The summary ignores search and the page window.
        mvc.perform(get("/api/v1/thesis/rounds/{id}/repository", summaryRound)
                        .param("search", "zzz-none")
                        .param("page", "5").param("limit", "1").with(admin()))
                .andExpect(status().isOk())
                .andExpect(header().string(TOTAL, "0"))
                .andExpect(header().string(ARCHIVE_TOTAL, "6"))
                .andExpect(header().string(ARCHIVE_FILES, "3"))
                .andExpect(header().string(ARCHIVE_URLS, "3"));
    }

    @Test
    void corsExposesTheThreeArchiveHeaders() throws Exception {
        String exposed = mvc.perform(get("/api/v1/thesis/rounds/{id}/repository", round)
                        .header("Origin", "http://localhost:3000")
                        .param("page", "0").param("limit", "5").with(admin))
                .andExpect(status().isOk())
                .andExpect(header().string(ARCHIVE_TOTAL, "13"))
                .andReturn()
                .getResponse()
                .getHeader("Access-Control-Expose-Headers");
        assertThat(exposed).isNotNull();
        assertThat(exposed.toLowerCase(java.util.Locale.ROOT))
                .contains("x-total-count", "x-archive-total-count", "x-archive-file-count", "x-archive-url-count");
    }

    @Test
    void legacyOrderIsStillSubmittedAtDescendingThenGroupId() throws Exception {
        List<UUID> expected = jdbc.query("SELECT id FROM thesis.thesis_group_report WHERE round_id = ? "
                        + "ORDER BY submitted_at DESC, group_id ASC",
                (rs, row) -> rs.getObject("id", UUID.class), round);
        assertThat(reportIds(legacy())).containsExactlyElementsOf(expected);
        assertThat(reportIds(paged(""))).containsExactlyElementsOf(expected.subList(0, 5));
        assertThat(reportIds(paged("FALLBACK"))).hasSize(1);
        List<UUID> filtered = reportIds(paged("nguyen"));
        assertThat(filtered).isSortedAccordingTo(
                (left, right) -> Integer.compare(expected.indexOf(left), expected.indexOf(right)));
    }

    // --- helpers ---------------------------------------------------------

    private MvcResult paged(String search) throws Exception {
        return mvc.perform(get("/api/v1/thesis/rounds/{id}/repository", round)
                        .param("search", search)
                        .param("page", "0").param("limit", "5").with(admin))
                .andExpect(status().isOk())
                .andReturn();
    }

    private MvcResult legacy() throws Exception {
        return mvc.perform(get("/api/v1/thesis/rounds/{id}/repository", round).with(admin))
                .andExpect(status().isOk())
                .andReturn();
    }

    private List<UUID> allReportIds() {
        return FIXTURE.reports().stream().map(report -> reportIds.get(report.id())).toList();
    }

    private List<UUID> expect(Case item) {
        return item.expect().stream().map(reportIds::get).toList();
    }

    private JsonNode readJson(MvcResult result) throws Exception {
        return mapper.readTree(result.getResponse().getContentAsString(StandardCharsets.UTF_8));
    }

    private List<UUID> reportIds(MvcResult result) throws Exception {
        List<UUID> ids = new ArrayList<>();
        for (JsonNode node : readJson(result)) {
            ids.add(UUID.fromString(node.path("reportId").asString()));
        }
        return ids;
    }

    private UUID insertRound(String name) {
        UUID id = UUID.randomUUID();
        Instant now = Instant.now();
        jdbc.update("INSERT INTO thesis.thesis_registration_round "
                        + "(id, name, thesis_type, lecturer_submit_start, lecturer_submit_end, "
                        + "registration_start, registration_end, gvpb_deadline, status) "
                        + "VALUES (?, ?, 'KLTN', ?, ?, ?, ?, ?, 'REGISTRATION_CLOSED')",
                id, name, Timestamp.from(now.minusSeconds(14_400)), Timestamp.from(now.minusSeconds(10_800)),
                Timestamp.from(now.minusSeconds(7_200)), Timestamp.from(now.plusSeconds(3_600)),
                Timestamp.from(now.plusSeconds(86_400)));
        return id;
    }

    private UUID insertTopic(UUID roundId, String department, String title, String description) {
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO thesis.thesis_topic "
                        + "(id, round_id, department_id, title, description, max_groups, status, created_by) "
                        + "VALUES (?, ?, ?, ?, ?, 5, 'PUBLISHED', ?)",
                id, roundId, department, title, description == null ? "" : description, tag);
        return id;
    }

    private UUID insertGroup(UUID roundId, UUID topic, String status, String approval) {
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO thesis.thesis_group "
                        + "(id, round_id, leader_student_id, topic_id, status, approval_status) "
                        + "VALUES (?, ?, ?, ?, ?, ?)",
                id, roundId, tag + "-leader-" + id, topic, status, approval);
        return id;
    }

    private void insertReport(UUID roundId, UUID group, Instant submittedAt, String title, String fileName,
            String url) {
        jdbc.update("INSERT INTO thesis.thesis_group_report "
                        + "(id,group_id,round_id,submitted_by,title,url,note,submitted_at,file_name,"
                        + "file_type,file_size,file_data) VALUES (?,?,?,?,?,?,?,?,?,'application/pdf',?,?)",
                UUID.randomUUID(), group, roundId, tag + "-submitter", title, url, null,
                Timestamp.from(submittedAt), fileName, fileName == null ? null : 4L,
                url == null ? new byte[] {1, 2, 3, 4} : null);
    }

    private RequestPostProcessor admin() {
        return ThesisAuthorityFixture.role(jdbc, tag + "-admin", "ADMIN");
    }

    private RequestPostProcessor scopeRole(String lecturerId) {
        String userId = jdbc.queryForObject(
                "SELECT \"userId\" FROM campuscore_auth.\"Lecturer\" WHERE \"id\" = ?", String.class, lecturerId);
        return ThesisAuthorityFixture.role(jdbc, userId, "LECTURER");
    }
}








