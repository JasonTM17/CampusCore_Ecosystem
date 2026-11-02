package io.campuscore.restfulapi.thesis;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.reset;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;

import io.campuscore.restfulapi.events.web.ListPaging;
import io.campuscore.restfulapi.thesis.domain.TopicStatus;
import io.campuscore.restfulapi.thesis.repository.ThesisTopicReadRepository;
import io.campuscore.restfulapi.thesis.service.ThesisTopicService;
import io.campuscore.restfulapi.thesis.web.ThesisTopicDtos.TopicResponse;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIf;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;

/**
 * Real-PostgreSQL port of the catalogue-search equivalence. The shared golden
 * fixture is seeded verbatim; because the predicate runs in Java over the
 * visible {@code (id, title, description)} projection, PostgreSQL and H2 must
 * return the same ids. This class also proves that search never hydrates more
 * than one page and that the narrower scan is kept when search is omitted.
 *
 * <p>Runs only against a disposable PostgreSQL 15 database supplied through the
 * existing opt-in environment contract; an absent target is NOT_RUN, never a
 * pass. Seed markers are {@code tsc-pg-}; cleanup is marker-scoped.
 */
@EnabledIf("postgresTargetConfigured")
@SpringBootTest(properties = { "spring.flyway.locations=classpath:db/migration", "deepseek.enabled=false" })
@ActiveProfiles({"test", "persistence"})
class ThesisTopicSearchPostgresIT {

    private static final String ROUND_NAME = "tsc-pg-round";
    private static final int PAGE_LIMIT = 100;

    @Autowired
    private JdbcTemplate jdbc;

    @Autowired
    private ThesisTopicService topics;

    @MockitoSpyBean
    private ThesisTopicReadRepository reads;

    private ThesisTopicSearchOracle.Fixture fixture;
    private Map<String, UUID> seededIds;
    private UUID roundId;

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", () -> System.getenv("CAMPUSCORE_E2E_POSTGRES_URL"));
        registry.add("spring.datasource.username", () -> valueOr("CAMPUSCORE_E2E_POSTGRES_USER", "campuscore"));
        registry.add("spring.datasource.password", () -> valueOr("CAMPUSCORE_E2E_POSTGRES_PASSWORD", "postgres"));
    }

    @BeforeEach
    void prepare() throws Exception {
        fixture = ThesisTopicSearchOracle.fixture();
        reset(reads);
        cleanFixtures();
        UUID roundId = UUID.randomUUID();
        Instant now = Instant.now();
        jdbc.update("INSERT INTO thesis.thesis_registration_round"
                        + " (id,name,thesis_type,lecturer_submit_start,lecturer_submit_end,"
                        + " registration_start,registration_end,status)"
                        + " VALUES (?,?,'KLTN',?,?,?,?,'PROPOSAL_OPEN')",
                roundId, ROUND_NAME, Timestamp.from(now.minusSeconds(3600)),
                Timestamp.from(now.plusSeconds(3600)), Timestamp.from(now.plusSeconds(7200)),
                Timestamp.from(now.plusSeconds(14400)));
        Map<String, UUID> ids = new LinkedHashMap<>();
        for (ThesisTopicSearchOracle.Topic topic : fixture.topics()) {
            UUID id = UUID.randomUUID();
            ids.put(topic.id(), id);
            jdbc.update("INSERT INTO thesis.thesis_topic"
                            + " (id,round_id,department_id,title,description,max_groups,status,created_by)"
                            + " VALUES (?,?,?,?,?,2,?,?)",
                    id, roundId, "department-demo", topic.title(),
                    topic.description() == null ? "" : topic.description(),
                    TopicStatus.PUBLISHED.name(), "tsc-pg-owner");
        }
        seededIds = Map.copyOf(ids);
        this.roundId = roundId;
    }

    @AfterEach
    void cleanFixtures() {
        jdbc.update("DELETE FROM thesis.thesis_topic_supervisor WHERE topic_id IN"
                + " (SELECT id FROM thesis.thesis_topic WHERE created_by LIKE 'tsc-pg-%')");
        jdbc.update("DELETE FROM thesis.thesis_council_topic WHERE topic_id IN"
                + " (SELECT id FROM thesis.thesis_topic WHERE created_by LIKE 'tsc-pg-%')");
        jdbc.update("DELETE FROM thesis.thesis_topic WHERE created_by LIKE 'tsc-pg-%'");
        jdbc.update("DELETE FROM thesis.thesis_registration_round WHERE name = ?", ROUND_NAME);
    }

    @Test
    void everyGoldenCaseMatchesOnPostgres() {
        Jwt admin = adminJwt();
        int catalogueTotal = fixture.topics().size();
        for (ThesisTopicSearchOracle.Case item : fixture.cases()) {
            var page = topics.listPage(roundId, null, admin,
                    ListPaging.Window.of(0, PAGE_LIMIT), item.search());
            assertThat(page.catalogTotal()).as(item.name()).isEqualTo(catalogueTotal);
            assertThat(page.total()).as(item.name()).isEqualTo(item.expectedIds().size());
            assertThat(page.items()).as(item.name())
                    .extracting(TopicResponse::id)
                    .containsExactlyElementsOf(javaOrder(item.expectedIds()));
        }
    }

    @Test
    void unpagedSearchIsTheAuthorisedArrayFilteredOnPostgres() {
        Jwt admin = adminJwt();
        List<UUID> all = topics.list(roundId, null, admin).stream().map(TopicResponse::id).toList();
        assertThat(all).hasSize(fixture.topics().size());

        for (ThesisTopicSearchOracle.Case item : fixture.cases()) {
            List<UUID> expectedInLegacyOrder = all.stream()
                    .filter(seeded(item.expectedIds())::contains)
                    .toList();
            assertThat(topics.list(roundId, null, admin, item.search()))
                    .as(item.name())
                    .extracting(TopicResponse::id)
                    .containsExactlyElementsOf(expectedInLegacyOrder);
        }
    }

    @Test
    void decomposedStoredTextFoldsLikeComposedTextOnPostgres() {
        Jwt admin = adminJwt();
        ThesisTopicSearchOracle.Case titleCase = fixture.cases().stream()
                .filter(item -> item.name().equals("decomposed stored title folds like composed text"))
                .findFirst().orElseThrow();
        ThesisTopicSearchOracle.Case descriptionCase = fixture.cases().stream()
                .filter(item -> item.name().equals("decomposed stored description folds like composed text"))
                .findFirst().orElseThrow();

        var titlePage = topics.listPage(roundId, null, admin, ListPaging.Window.of(0, PAGE_LIMIT),
                titleCase.search());
        assertThat(titlePage.items()).extracting(TopicResponse::id)
                .containsExactly(seededIds.get(fixture.topics().get(18).id()));
        assertThat(titlePage.total()).isEqualTo(1);

        var descriptionPage = topics.listPage(roundId, null, admin, ListPaging.Window.of(0, PAGE_LIMIT),
                descriptionCase.search());
        assertThat(descriptionPage.items()).extracting(TopicResponse::id)
                .containsExactly(seededIds.get(fixture.topics().get(18).id()));
        assertThat(descriptionPage.total()).isEqualTo(1);
    }

    @Test
    void searchHydratesOnlyThePageAndOmittingSearchKeepsTheNarrowerScan() {
        Jwt admin = adminJwt();
        ThesisTopicSearchOracle.Case item = fixture.cases().stream()
                .filter(entry -> entry.name().equals("dictionary key: artificial intelligence"))
                .findFirst().orElseThrow();

        topics.listPage(roundId, null, admin, ListPaging.Window.of(0, 2), item.search());
        verify(reads, times(1)).findVisibleRefsWithDescription(any(), any(), any());
        verify(reads, times(1)).findResponsesByIds(any());
        verify(reads, never()).findVisibleRefs(any(), any(), any());

        reset(reads);
        topics.listPage(roundId, null, admin, ListPaging.Window.of(0, 2), null);
        verify(reads, times(1)).findVisibleRefs(any(), any(), any());
        verify(reads, never()).findVisibleRefsWithDescription(any(), any(), any());
        verify(reads, times(1)).findResponsesByIds(any());
    }

    @Test
    void theSearchScanMeasuresTheExtraDescriptionColumnCost() {
        Integer rows = jdbc.queryForObject(
                "SELECT COUNT(*) FROM thesis.thesis_topic WHERE created_by LIKE 'tsc-pg-%'", Integer.class);
        Long titleBytes = jdbc.queryForObject(
                "SELECT COALESCE(SUM(octet_length(title)),0) FROM thesis.thesis_topic"
                        + " WHERE created_by LIKE 'tsc-pg-%'", Long.class);
        Long descriptionBytes = jdbc.queryForObject(
                "SELECT COALESCE(SUM(octet_length(description)),0) FROM thesis.thesis_topic"
                        + " WHERE created_by LIKE 'tsc-pg-%'", Long.class);
        Long plainBytes = jdbc.queryForObject(
                "SELECT COALESCE(SUM(octet_length(title) + octet_length(description)),0)"
                        + " FROM thesis.thesis_topic WHERE created_by LIKE 'tsc-pg-%'", Long.class);

        assertThat(rows).isEqualTo(fixture.topics().size());
        assertThat(titleBytes).isPositive();
        assertThat(descriptionBytes).isPositive();
        // Recorded for the report: the search scan reads every visible id, title
        // and description before paging, never a full hydrated row.
        System.out.printf("[w19-cat] visible rows=%d titleBytes=%d descriptionBytes=%d scanBytes=%d%n",
                rows, titleBytes, descriptionBytes, plainBytes);
    }

    @Test
    void bothTotalsStayExactForEmptyAndOutOfRangePagesOnPostgres() {
        Jwt admin = adminJwt();
        int catalogueTotal = fixture.topics().size();

        var outOfRange = topics.listPage(roundId, null, admin, ListPaging.Window.of(99, 20), "ai");
        assertThat(outOfRange.items()).isEmpty();
        assertThat(outOfRange.catalogTotal()).isEqualTo(catalogueTotal);
        assertThat(outOfRange.total()).isGreaterThan(0);

        var noMatch = topics.listPage(roundId, null, admin, ListPaging.Window.of(0, 20), "quantum annealing");
        assertThat(noMatch.items()).isEmpty();
        assertThat(noMatch.total()).isZero();
        assertThat(noMatch.catalogTotal()).isEqualTo(catalogueTotal);
    }

    // ---------- helpers ----------

    private List<UUID> javaOrder(List<String> fixtureIds) {
        Map<String, String> titles = new LinkedHashMap<>();
        fixture.topics().forEach(topic -> titles.put(topic.id(), topic.title()));
        return fixtureIds.stream()
                .sorted(java.util.Comparator.comparing(
                                (String id) -> titles.get(id))
                        .thenComparing(id -> id))
                .map(seededIds::get)
                .toList();
    }

    private List<UUID> seeded(List<String> fixtureIds) {
        return fixtureIds.stream().map(seededIds::get).toList();
    }

    private static Jwt adminJwt() {
        return Jwt.withTokenValue("tsc-pg-token").header("alg", "none").subject("tsc-pg-admin")
                .claim("roles", List.of("ADMIN")).build();
    }

    /** Opt-in like the sibling Postgres ITs: only a jdbc:postgresql: target enables this class. */
    static boolean postgresTargetConfigured() {
        String url = System.getenv("CAMPUSCORE_E2E_POSTGRES_URL");
        return url != null && url.startsWith("jdbc:postgresql:");
    }

    private static String valueOr(String key, String fallback) {
        String value = System.getenv(key);
        return value == null || value.isBlank() ? fallback : value;
    }
}
