package io.campuscore.restfulapi.thesis;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doAnswer;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import io.campuscore.restfulapi.events.web.ListPaging;
import io.campuscore.restfulapi.thesis.ThesisArchiveSearchOracle.Case;
import io.campuscore.restfulapi.thesis.ThesisArchiveSearchOracle.Fixture;
import io.campuscore.restfulapi.testsupport.AccountAuthorityFixture;
import io.campuscore.restfulapi.thesis.service.ThesisReportService;
import io.campuscore.restfulapi.thesis.service.ThesisReportService.RepositoryArchivePage;
import io.campuscore.restfulapi.thesis.service.ThesisReportService.RepositoryReportResponse;
import java.nio.charset.StandardCharsets;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIf;
import org.mockito.Mockito;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.jdbc.core.namedparam.SqlParameterSource;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.RequestPostProcessor;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * Real-PostgreSQL twin of {@link ThesisArchiveSearchContractTest}. H2 cannot
 * prove three things this suite exists for: the production Flyway schema and its
 * group/roster triggers, the repeatable-read snapshot that keeps the aggregate
 * and the page consistent under a concurrent insert, and that
 * {@code REGEXP_REPLACE}/{@code TRANSLATE} folding behaves the same as on
 * PostgreSQL as it does in the browser.
 *
 * <p><b>NFD stored text (W16).</b> PostgreSQL {@code TRANSLATE(LOWER(...))} does
 * not reproduce JavaScript NFD folding by itself. Here the server strips
 * combining marks with {@code REGEXP_REPLACE(..., '[\u0300-\u036f]', '', 'g')}
 * before translating the precomposed letters, so a topic title stored
 * decomposed ({@code e + U+0302 + U+0303}) matches the same ASCII query as the
 * composed spelling. {@code decomposedStoredTitleStillMatches} asserts this on a
 * row the fixture explicitly stores in NFD; normalising at write time is out of
 * scope for this wave.
 *
 * <p><b>Environment contract</b> (opt-in, same as the sibling thesis
 * {@code *PostgresIT} classes): runs ONLY when
 * {@code CAMPUSCORE_E2E_POSTGRES_URL} is a {@code jdbc:postgresql:} URL pointing
 * at a disposable database - the real migrations run on context startup.
 * Optional {@code CAMPUSCORE_E2E_POSTGRES_USER} /
 * {@code CAMPUSCORE_E2E_POSTGRES_PASSWORD}. Fixture ids carry an
 * {@code arspg-} marker and are removed after every test.
 */
@EnabledIf("postgresTargetConfigured")
@SpringBootTest(properties = { "spring.flyway.locations=classpath:db/migration", "deepseek.enabled=false" })
@AutoConfigureMockMvc
@ActiveProfiles({"test", "persistence"})
class ThesisArchiveSearchPostgresIT {

    private static final String TOTAL = "X-Total-Count";
    private static final String ARCHIVE_TOTAL = "X-Archive-Total-Count";
    private static final String ARCHIVE_FILES = "X-Archive-File-Count";
    private static final String ARCHIVE_URLS = "X-Archive-Url-Count";

    private static final Fixture FIXTURE = ThesisArchiveSearchOracle.load();

    @Autowired private JdbcTemplate jdbc;
    @Autowired private MockMvc mvc;
    @Autowired private ObjectMapper mapper;
    @Autowired private ThesisReportService reports;
    @MockitoSpyBean private NamedParameterJdbcTemplate namedJdbc;

    private String tag;
    private UUID roundId;
    private Map<String, UUID> reportIds;
    private RequestPostProcessor admin;

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", () -> System.getenv("CAMPUSCORE_E2E_POSTGRES_URL"));
        registry.add("spring.datasource.username", () -> valueOr("CAMPUSCORE_E2E_POSTGRES_USER", "campuscore"));
        registry.add("spring.datasource.password", () -> valueOr("CAMPUSCORE_E2E_POSTGRES_PASSWORD", "postgres"));
    }

    @BeforeEach
    void prepare() {
        Mockito.reset(namedJdbc);
        tag = "arspg-" + UUID.randomUUID().toString().replace("-", "").substring(0, 8);
        cleanFixtures();
        roundId = UUID.randomUUID();
        Instant now = Instant.now();
        jdbc.update("INSERT INTO thesis.thesis_registration_round "
                        + "(id,name,thesis_type,lecturer_submit_start,lecturer_submit_end,"
                        + "registration_start,registration_end,gvpb_deadline,status) "
                        + "VALUES (?,'" + tag + "-round','KLTN',?,?,?,?,?,'REGISTRATION_CLOSED')",
                roundId, Timestamp.from(now.minusSeconds(14_400)), Timestamp.from(now.minusSeconds(10_800)),
                Timestamp.from(now.minusSeconds(7_200)), Timestamp.from(now.plusSeconds(3_600)),
                Timestamp.from(now.plusSeconds(86_400)));
        reportIds = ThesisArchiveSearchOracle.seed(jdbc, roundId, tag, FIXTURE);
        admin = ThesisAuthorityFixture.role(jdbc, tag + "-admin", "ADMIN");
    }

    @AfterEach
    void cleanFixtures() {
        Mockito.reset(namedJdbc);
        // Clean by the suite prefix, not the current tag: a previous test's
        // Student."studentId" values are still unique in the production schema.
        String prefix = "arspg-%";
        String rounds = "SELECT id FROM thesis.thesis_registration_round WHERE name LIKE '" + prefix + "'";
        // A group's ON DELETE CASCADE removes its roster: cancelled rosters are
        // immutable by trigger, so members are never deleted directly.
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

    @Test
    void everyFrozenWebCaseReturnsTheSameRowsAndSummaryOnPostgres() throws Exception {
        for (Case item : FIXTURE.cases()) {
            MvcResult result = mvc.perform(get("/api/v1/thesis/rounds/{id}/repository", roundId)
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
                    .containsExactlyElementsOf(item.expect().stream().map(reportIds::get).toList());
        }
    }

    @Test
    void decomposedStoredTitleStillMatches() throws Exception {
        String stored = jdbc.queryForObject("SELECT t.title FROM thesis.thesis_topic t "
                + "JOIN thesis.thesis_group g ON g.topic_id = t.id "
                + "JOIN thesis.thesis_group_report r ON r.group_id = g.id WHERE r.id = ?",
                String.class, reportIds.get("r10"));
        // The fixture stores U+0302/U+0303 combining marks, not the composed ễ.
        assertThat(stored).contains("\u0302").contains("\u0303");
        assertThat(stored).isNotEqualTo("Nguy\u1ec5n V\u0103n A");

        // Same three rows the frozen web predicate returns for this query.
        List<UUID> matched = reportIds(searched("nguyen van a"));
        assertThat(matched).containsExactly(reportIds.get("r01"), reportIds.get("r10"), reportIds.get("r12"));
    }

    @Test
    void countAndPageShareOneRepeatableReadSnapshotUnderSearch() throws Exception {
        CountDownLatch paused = new CountDownLatch(1);
        CountDownLatch resume = new CountDownLatch(1);
        doAnswer(invocation -> {
            String sql = invocation.getArgument(0);
            if (sql.startsWith("SELECT r.id AS report_id")
                    && "arspg-worker".equals(Thread.currentThread().getName())) {
                paused.countDown();
                if (!resume.await(10, TimeUnit.SECONDS)) {
                    throw new IllegalStateException("snapshot barrier timeout");
                }
            }
            return invocation.callRealMethod();
        }).when(namedJdbc).query(anyString(), any(SqlParameterSource.class), any(RowMapper.class));

        var pool = Executors.newSingleThreadExecutor();
        try {
            var worker = pool.submit(() -> {
                Thread.currentThread().setName("arspg-worker");
                return reports.listRepository(roundId, adminJwt(), ListPaging.Window.of(0, 100), "nguyen");
            });
            assertThat(paused.await(10, TimeUnit.SECONDS))
                    .as("aggregate finished and the worker is paused before the root page query").isTrue();
            insertLateMatchingReport();
            resume.countDown();
            RepositoryArchivePage page = worker.get(20, TimeUnit.SECONDS);
            assertThat(page.total()).isEqualTo(5L);
            assertThat(page.items()).hasSize(5);
            // The aggregate and the page share the snapshot taken before the
            // insert: the late row is not visible to either of them.
            assertThat(page.summary().archiveTotal()).isEqualTo(13L);
            assertThat(page.summary().filteredTotal()).isEqualTo(5L);
        } finally {
            resume.countDown();
            pool.shutdownNow();
            assertThat(pool.awaitTermination(10, TimeUnit.SECONDS)).isTrue();
        }
        assertThat(jdbc.queryForObject(
                "SELECT COUNT(*) FROM thesis.thesis_group_report WHERE round_id = ?", Integer.class, roundId))
                .isEqualTo(14);
    }

    @Test
    void emptyAndOutOfRangePagesKeepAllFourHeadersOnPostgres() throws Exception {
        mvc.perform(get("/api/v1/thesis/rounds/{id}/repository", roundId)
                        .param("search", "zzz-none")
                        .param("page", "0").param("limit", "5").with(admin))
                .andExpect(status().isOk())
                .andExpect(header().string(TOTAL, "0"))
                .andExpect(header().string(ARCHIVE_TOTAL, "13"))
                .andExpect(header().string(ARCHIVE_FILES, "11"))
                .andExpect(header().string(ARCHIVE_URLS, "10"));
        mvc.perform(get("/api/v1/thesis/rounds/{id}/repository", roundId)
                        .param("search", "nguyen")
                        .param("page", "99").param("limit", "5").with(admin))
                .andExpect(status().isOk())
                .andExpect(header().string(TOTAL, "5"))
                .andExpect(header().string(ARCHIVE_TOTAL, "13"))
                .andExpect(header().string(ARCHIVE_FILES, "11"))
                .andExpect(header().string(ARCHIVE_URLS, "10"));
    }

    @Test
    void likeMetacharactersStayLiteralOnPostgres() throws Exception {
        assertThat(reportIds(searched("%"))).containsExactly(reportIds.get("r07"));
        assertThat(reportIds(searched("0%d"))).isEmpty();
        assertThat(reportIds(searched("_"))).containsExactly(reportIds.get("r02"), reportIds.get("r07"));
        assertThat(reportIds(searched("\\"))).containsExactly(reportIds.get("r06"));
        assertThat(reportIds(searched("\"quoted\""))).containsExactly(reportIds.get("r07"));
        assertThat(reportIds(searched("drive.example.com"))).isEmpty();
    }

    @Test
    void unpagedSearchStillReturnsABareFilteredArrayOnPostgres() throws Exception {
        MvcResult legacy = mvc.perform(get("/api/v1/thesis/rounds/{id}/repository", roundId).with(admin))
                .andExpect(status().isOk())
                .andExpect(header().doesNotExist(ARCHIVE_TOTAL))
                .andReturn();
        assertThat(reportIds(legacy)).hasSize(13);

        MvcResult filtered = mvc.perform(get("/api/v1/thesis/rounds/{id}/repository", roundId)
                        .param("search", "nguyen").with(admin))
                .andExpect(status().isOk())
                .andExpect(header().doesNotExist(TOTAL))
                .andExpect(header().doesNotExist(ARCHIVE_TOTAL))
                .andReturn();
        assertThat(reportIds(filtered)).hasSize(5);
    }

    @Test
    void unauthorizedSearchStillFailsClosedOnPostgres() throws Exception {
        String studentSubject = tag + "-student-subject";
        mvc.perform(get("/api/v1/thesis/rounds/{id}/repository", roundId)
                        .param("search", "nguyen")
                        .param("page", "0").param("limit", "5")
                        .with(ThesisAuthorityFixture.role(jdbc, studentSubject, "STUDENT")))
                .andExpect(status().is4xxClientError());
    }

    // --- helpers ---------------------------------------------------------

    private MvcResult searched(String search) throws Exception {
        return mvc.perform(get("/api/v1/thesis/rounds/{id}/repository", roundId)
                        .param("search", search)
                        .param("page", "0").param("limit", "100").with(admin))
                .andExpect(status().isOk())
                .andReturn();
    }

    private List<UUID> reportIds(MvcResult result) throws Exception {
        JsonNode body = mapper.readTree(result.getResponse().getContentAsString(StandardCharsets.UTF_8));
        List<UUID> ids = new ArrayList<>();
        for (JsonNode node : body) {
            ids.add(UUID.fromString(node.path("reportId").asString()));
        }
        return ids;
    }

    private void insertLateMatchingReport() {
        UUID topic = UUID.randomUUID();
        jdbc.update("INSERT INTO thesis.thesis_topic "
                        + "(id,round_id,department_id,title,description,max_groups,status,created_by) "
                        + "VALUES (?,?,'department-demo','Late nguyen topic','',5,'PUBLISHED',?)",
                topic, roundId, tag);
        UUID group = UUID.randomUUID();
        jdbc.update("INSERT INTO thesis.thesis_group "
                        + "(id,round_id,leader_student_id,topic_id,status,approval_status) "
                        + "VALUES (?,?,?,?,'SUBMITTED','PENDING')",
                group, roundId, tag + "-late-leader", topic);
        jdbc.update("INSERT INTO thesis.thesis_group_report "
                        + "(id,group_id,round_id,submitted_by,title,url,submitted_at,file_name,file_type,file_size) "
                        + "VALUES (?,?,?,?,?,?,?,?,'application/pdf',4)",
                UUID.randomUUID(), group, roundId, tag + "-late", "Late nguyen report",
                "https://drive.example.com/late", Timestamp.from(Instant.now()), "late.pdf");
    }

    private static Jwt adminJwt() {
        return Jwt.withTokenValue("arspg-test").header("alg", "none").subject("arspg-admin")
                .claim("roles", List.of("ADMIN")).build();
    }

    /** Opt-in like the sibling Postgres ITs: runs only for a jdbc:postgresql: target. */
    static boolean postgresTargetConfigured() {
        String url = System.getenv("CAMPUSCORE_E2E_POSTGRES_URL");
        return url != null && url.startsWith("jdbc:postgresql:");
    }

    private static String valueOr(String key, String fallback) {
        String value = System.getenv(key);
        return value == null || value.isBlank() ? fallback : value;
    }
}
