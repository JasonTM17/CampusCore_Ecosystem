package io.campuscore.restfulapi.thesis;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import io.campuscore.restfulapi.events.web.ListPaging;
import io.campuscore.restfulapi.thesis.domain.TopicStatus;
import io.campuscore.restfulapi.thesis.search.ThesisTopicCatalogSearch;
import io.campuscore.restfulapi.thesis.web.ThesisTopicDtos.TopicResponse;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.UUID;
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
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.test.web.servlet.request.RequestPostProcessor;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.ObjectMapper;

/**
 * W19 catalogue-search contract. The shared golden fixture is executed by the
 * real browser function in {@code frontend/tests/thesis-catalog-search-oracle.test.js};
 * here the same ids are asserted through the Java oracle, the production policy
 * and the HTTP endpoint. The HTTP assertions are deliberately written before
 * the endpoint grew the parameter, so they are the fail-first lane.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles({"test", "persistence"})
@TestPropertySource(properties = {
        "spring.datasource.url=jdbc:h2:mem:thesis_topic_search_contract;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1",
        "spring.datasource.username=sa",
        "spring.datasource.password=",
        "spring.flyway.enabled=true",
        "spring.flyway.locations=classpath:db/migration-h2"
})
class ThesisTopicSearchContractTest {

    private static final String TOTAL_COUNT_HEADER = ListPaging.TOTAL_COUNT_HEADER;
    private static final String CATALOG_TOTAL_HEADER = ThesisTopicCatalogSearch.CATALOG_TOTAL_COUNT_HEADER;
    private static final String LECT_A = "ts-lect-a";
    private static final String LECT_B = "ts-lect-b";
    private static final String DEPT_HEAD = "ts-dept-head";
    private static final String REVIEWER = "ts-reviewer";

    @Autowired private JdbcTemplate jdbc;
    @Autowired private MockMvc mvc;
    @Autowired private ObjectMapper objectMapper;

    private ThesisTopicSearchOracle.Fixture fixture;
    private Map<String, UUID> seededIds = Map.of();

    @BeforeEach
    void loadFixture() throws Exception {
        fixture = ThesisTopicSearchOracle.fixture();
    }

    // ---------- oracle / fixture ----------

    @Test
    void theSharedFixtureMatchesTheJavaOracleAndTheProductionPolicy() {
        assertThat(fixture.dictionary()).isEqualTo(ThesisTopicCatalogSearch.bilingualKeywords());
        assertThat(fixture.dictionary()).hasSize(7);
        assertThat(fixture.cases()).hasSizeGreaterThanOrEqualTo(30);

        for (ThesisTopicSearchOracle.Case item : fixture.cases()) {
            assertThat(ThesisTopicSearchOracle.matchingIds(fixture.topics(), item.search()))
                    .as("oracle: " + item.name())
                    .containsExactlyElementsOf(item.expectedIds());
            ThesisTopicCatalogSearch policy = ThesisTopicCatalogSearch.parse(item.search());
            assertThat(policy.isActive())
                    .as("blank and all are the view-all state: " + item.name())
                    .isEqualTo(!item.showAll());
            assertThat(fixture.topics().stream()
                    .filter(topic -> policy.matches(topic.title(), topic.description()))
                    .map(ThesisTopicSearchOracle.Topic::id)
                    .toList())
                    .as("production policy: " + item.name())
                    .containsExactlyElementsOf(item.expectedIds());
        }
        for (ThesisTopicSearchOracle.Case item : fixture.emptyCatalogueCases()) {
            assertThat(ThesisTopicSearchOracle.matchingIds(List.of(), item.search()))
                    .as("empty oracle: " + item.name())
                    .isEmpty();
            assertThat(ThesisTopicCatalogSearch.parse(item.search()).isActive()).isEqualTo(!item.showAll());
        }
    }

    @Test
    void everyFixtureCaseIsReproducedByThePagedEndpointInJavaOrder() throws Exception {
        UUID roundId = seedFixtureRound();
        int catalogueTotal = fixture.topics().size();

        for (ThesisTopicSearchOracle.Case item : fixture.cases()) {
            MvcResult result = page(roundId, item.search(), 0, 100, student());
            assertThat(result.getResponse().getStatus()).as(item.name()).isEqualTo(200);
            assertThat(result.getResponse().getHeader(TOTAL_COUNT_HEADER))
                    .as("filtered total: " + item.name())
                    .isEqualTo(String.valueOf(item.expectedIds().size()));
            assertThat(result.getResponse().getHeader(CATALOG_TOTAL_HEADER))
                    .as("catalogue total: " + item.name())
                    .isEqualTo(String.valueOf(catalogueTotal));
            assertThat(body(result)).extracting(TopicResponse::id)
                    .as("page ids: " + item.name())
                    .containsExactlyElementsOf(expectedJavaOrder(item.expectedIds()));
        }
    }

    @Test
    void concatenatedSearchPagesCoverTheFilteredSetExactlyOnce() throws Exception {
        UUID roundId = seedFixtureRound();
        ThesisTopicSearchOracle.Case item = fixture.cases().stream()
                .filter(entry -> entry.name().equals("dictionary key: artificial intelligence"))
                .findFirst().orElseThrow();
        assertThat(item.expectedIds()).hasSizeGreaterThan(1);

        List<UUID> collected = new ArrayList<>();
        int limit = 2;
        int pages = (item.expectedIds().size() + limit - 1) / limit;
        for (int index = 0; index < pages; index++) {
            MvcResult result = page(roundId, item.search(), index, limit, student());
            assertThat(result.getResponse().getHeader(TOTAL_COUNT_HEADER))
                    .isEqualTo(String.valueOf(item.expectedIds().size()));
            assertThat(result.getResponse().getHeader(CATALOG_TOTAL_HEADER))
                    .isEqualTo(String.valueOf(fixture.topics().size()));
            collected.addAll(body(result).stream().map(TopicResponse::id).toList());
        }
        assertThat(collected).containsExactlyElementsOf(expectedJavaOrder(item.expectedIds()));

        MvcResult beyond = page(roundId, item.search(), pages + 1, limit, student());
        assertThat(beyond.getResponse().getHeader(TOTAL_COUNT_HEADER))
                .isEqualTo(String.valueOf(item.expectedIds().size()));
        assertThat(beyond.getResponse().getHeader(CATALOG_TOTAL_HEADER))
                .isEqualTo(String.valueOf(fixture.topics().size()));
        assertThat(body(beyond)).isEmpty();
    }

    @Test
    void unpagedSearchIsTheLegacyArrayFilteredWithNoHeaders() throws Exception {
        UUID roundId = seedFixtureRound();
        List<UUID> legacyOrder = body(unpaged(roundId, null, student())).stream()
                .map(TopicResponse::id).toList();
        assertThat(legacyOrder).hasSize(fixture.topics().size());

        for (ThesisTopicSearchOracle.Case item : fixture.cases()) {
            MvcResult result = unpagedRequest(roundId, item.search(), student());
            assertThat(result.getResponse().getStatus()).as(item.name()).isEqualTo(200);
            assertThat(result.getResponse().getHeader(TOTAL_COUNT_HEADER)).as(item.name()).isNull();
            assertThat(result.getResponse().getHeader(CATALOG_TOTAL_HEADER)).as(item.name()).isNull();
            List<UUID> ids = body(result).stream().map(TopicResponse::id).toList();
            List<UUID> seededExpected = item.expectedIds().stream().map(seededIds::get).toList();
            assertThat(ids).as(item.name())
                    .containsExactlyElementsOf(legacyOrder.stream()
                            .filter(seededExpected::contains)
                            .toList());
        }
    }

    @Test
    void anEmptyCatalogueKeepsBothTotalsAtZeroForEveryFixtureCase() throws Exception {
        UUID roundId = round("DRAFT");
        for (ThesisTopicSearchOracle.Case item : fixture.emptyCatalogueCases()) {
            MvcResult result = page(roundId, item.search(), 0, 20, student());
            assertThat(result.getResponse().getHeader(TOTAL_COUNT_HEADER)).as(item.name()).isEqualTo("0");
            assertThat(result.getResponse().getHeader(CATALOG_TOTAL_HEADER)).as(item.name()).isEqualTo("0");
            assertThat(body(result)).as(item.name()).isEmpty();
        }
    }

    @Test
    void aSearchWithNoMatchesKeepsTheAuthorizedCatalogueTotal() throws Exception {
        UUID roundId = seedFixtureRound();

        MvcResult result = page(roundId, "quantum annealing", 0, 20, student());

        assertThat(result.getResponse().getHeader(TOTAL_COUNT_HEADER)).isEqualTo("0");
        assertThat(result.getResponse().getHeader(CATALOG_TOTAL_HEADER))
                .isEqualTo(String.valueOf(fixture.topics().size()));
        assertThat(body(result)).isEmpty();
    }

    @Test
    void omittedSearchKeepsLegacyBehaviourAndEqualTotals() throws Exception {
        UUID roundId = seedFixtureRound();

        MvcResult legacy = unpagedRequest(roundId, null, student());
        assertThat(legacy.getResponse().getHeader(TOTAL_COUNT_HEADER)).isNull();
        assertThat(legacy.getResponse().getHeader(CATALOG_TOTAL_HEADER)).isNull();
        assertThat(body(legacy)).hasSize(fixture.topics().size());

        MvcResult paged = page(roundId, null, 0, 5, student());
        assertThat(paged.getResponse().getHeader(TOTAL_COUNT_HEADER))
                .isEqualTo(String.valueOf(fixture.topics().size()));
        assertThat(paged.getResponse().getHeader(CATALOG_TOTAL_HEADER))
                .isEqualTo(String.valueOf(fixture.topics().size()));
        assertThat(body(paged)).hasSize(5);
    }

    @Test
    void repeatedSearchIsRejectedOnPagedAndUnpagedCalls() throws Exception {
        UUID roundId = seedFixtureRound();

        mvc.perform(get("/api/v1/thesis/topics")
                        .queryParam("roundId", roundId.toString())
                        .queryParam("search", "ai", "web")
                        .queryParam("page", "0").queryParam("limit", "20").with(student()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_SEARCH"));

        mvc.perform(get("/api/v1/thesis/topics")
                        .queryParam("roundId", roundId.toString())
                        .queryParam("search", "ai", "web").with(student()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_SEARCH"));
    }

    @Test
    void publishedStatusStillIncludesApprovedTopicsUnderSearch() throws Exception {
        UUID roundId = round("DRAFT");
        UUID published = topic(roundId, "Searchable published", "", TopicStatus.PUBLISHED,
                "department-demo", subject(LECT_B));
        UUID approved = topic(roundId, "Searchable approved", "", TopicStatus.APPROVED,
                "department-demo", subject(LECT_B));
        topic(roundId, "Searchable draft", "", TopicStatus.DRAFT, "department-demo", subject(LECT_B));

        for (String status : new String[]{null, "PUBLISHED"}) {
            MvcResult result = status == null
                    ? page(roundId, "searchable", 0, 20, student())
                    : page(roundId, "searchable", 0, 20, student(), status);
            assertThat(result.getResponse().getHeader(TOTAL_COUNT_HEADER)).isEqualTo("2");
            assertThat(result.getResponse().getHeader(CATALOG_TOTAL_HEADER)).isEqualTo("2");
            assertThat(body(result)).extracting(TopicResponse::id)
                    .containsExactlyInAnyOrder(published, approved);
        }

        MvcResult approvedOnly = page(roundId, "searchable", 0, 20, student(), "APPROVED");
        assertThat(approvedOnly.getResponse().getHeader(TOTAL_COUNT_HEADER)).isEqualTo("1");
        assertThat(approvedOnly.getResponse().getHeader(CATALOG_TOTAL_HEADER)).isEqualTo("1");
        assertThat(body(approvedOnly)).extracting(TopicResponse::id).containsExactly(approved);
    }

    @Test
    void searchNeverWidensVisibilityOrLeaksForeignDescriptions() throws Exception {
        UUID roundId = round("DRAFT");
        String ownerA = subject(LECT_A);
        String ownerB = subject(LECT_B);
        UUID own = topic(roundId, "Own draft", "<p>Mô tả riêng</p>", TopicStatus.DRAFT,
                "department-demo", ownerA);
        UUID foreign = topic(roundId, "Foreign draft", "<p>Mô tả riêng</p>", TopicStatus.DRAFT,
                "department-demo", ownerB);

        MvcResult ownPage = page(roundId, "mo ta rieng", 0, 20, lecturer(LECT_A), "DRAFT");
        assertThat(body(ownPage)).extracting(TopicResponse::id).containsExactly(own);
        assertThat(ownPage.getResponse().getHeader(TOTAL_COUNT_HEADER)).isEqualTo("1");
        assertThat(ownPage.getResponse().getHeader(CATALOG_TOTAL_HEADER)).isEqualTo("1");

        MvcResult studentPage = page(roundId, "mo ta rieng", 0, 20, student(), "DRAFT");
        assertThat(body(studentPage)).isEmpty();
        assertThat(studentPage.getResponse().getHeader(TOTAL_COUNT_HEADER)).isEqualTo("0");
        assertThat(studentPage.getResponse().getHeader(CATALOG_TOTAL_HEADER)).isEqualTo("0");

        // The foreign row exists and matches the same query; it stays invisible.
        assertThat(foreign).isNotNull();
        MvcResult adminPage = page(roundId, "mo ta rieng", 0, 20, admin(), "DRAFT");
        assertThat(body(adminPage)).extracting(TopicResponse::id)
                .containsExactlyInAnyOrder(own, foreign);
        assertThat(adminPage.getResponse().getHeader(TOTAL_COUNT_HEADER)).isEqualTo("2");
        assertThat(adminPage.getResponse().getHeader(CATALOG_TOTAL_HEADER)).isEqualTo("2");
    }

    @Test
    void pagedSearchKeepsScoreAndReviewerMaskingUnchanged() throws Exception {
        UUID roundId = seedFixtureRound();
        UUID topicId = seededIds.get(fixture.topics().getFirst().id());
        jdbc.update("UPDATE thesis.thesis_topic SET final_score=8.5, result_status='GRADED',"
                + " gvpb_lecturer_id=? WHERE id=?", REVIEWER, topicId);

        MvcResult before = page(roundId, "tri tue nhan tao", 0, 20, student());
        TopicResponse masked = body(before).getFirst();
        assertThat(masked.finalScore()).isNull();
        assertThat(masked.resultStatus()).isNull();
        assertThat(masked.gvpbLecturerId()).isNull();

        jdbc.update("UPDATE thesis.thesis_registration_round SET status='RESULTS_PUBLISHED' WHERE id=?", roundId);

        MvcResult after = page(roundId, "tri tue nhan tao", 0, 20, student());
        TopicResponse visible = body(after).getFirst();
        assertThat(visible.finalScore()).isEqualByComparingTo("8.5");
        assertThat(visible.resultStatus()).isEqualTo("GRADED");
        assertThat(visible.gvpbLecturerId()).isNull();
    }

    @Test
    void departmentScopeKeepsItsOwnCatalogueTotalUnderSearch() throws Exception {
        UUID roundId = round("DRAFT");
        UUID ownDepartment = topic(roundId, "Own department searchable", "", TopicStatus.PUBLISHED,
                "department-demo", subject(LECT_B));
        UUID foreignDepartment = topic(roundId, "Foreign department searchable", "", TopicStatus.PUBLISHED,
                "department-other", subject(LECT_B));
        UUID foreignFaculty = topic(roundId, "Foreign faculty searchable", "", TopicStatus.PUBLISHED,
                "department-foreign-scope", subject(LECT_B));

        MvcResult result = page(roundId, "searchable", 0, 20, departmentHead());

        assertThat(result.getResponse().getHeader(TOTAL_COUNT_HEADER)).isEqualTo("1");
        assertThat(result.getResponse().getHeader(CATALOG_TOTAL_HEADER)).isEqualTo("1");
        assertThat(body(result)).extracting(TopicResponse::id)
                .containsExactly(ownDepartment)
                .doesNotContain(foreignDepartment);
        assertThat(foreignFaculty).isNotNull();
    }

    // ---------- fixture helpers ----------

    private UUID seedFixtureRound() {
        UUID roundId = round("DRAFT");
        Map<String, UUID> ids = new java.util.LinkedHashMap<>();
        for (ThesisTopicSearchOracle.Topic topic : fixture.topics()) {
            UUID id = UUID.randomUUID();
            ids.put(topic.id(), id);
            jdbc.update("INSERT INTO thesis.thesis_topic"
                            + " (id,round_id,department_id,title,description,max_groups,status,created_by)"
                            + " VALUES (?,?,?,?,?,2,?,?)",
                    id, roundId, "department-demo", topic.title(),
                    topic.description() == null ? "" : topic.description(),
                    TopicStatus.PUBLISHED.name(), subject(LECT_B));
        }
        seededIds = Map.copyOf(ids);
        return roundId;
    }

    private List<UUID> expectedJavaOrder(List<String> ids) {
        Map<String, String> titles = fixture.topics().stream()
                .collect(java.util.stream.Collectors.toMap(
                        ThesisTopicSearchOracle.Topic::id, ThesisTopicSearchOracle.Topic::title));
        return ids.stream()
                .sorted(Comparator.comparing((String id) -> titles.get(id)).thenComparing(id -> id))
                .map(seededIds::get)
                .toList();
    }

    // ---------- HTTP ----------

    private MvcResult page(UUID roundId, String search, int page, int limit, RequestPostProcessor actor)
            throws Exception {
        return perform(pageRequest(roundId, search, page, limit), actor);
    }

    private MvcResult page(UUID roundId, String search, int page, int limit, RequestPostProcessor actor,
            String status) throws Exception {
        return perform(pageRequest(roundId, search, page, limit).queryParam("status", status), actor);
    }

    private MockHttpServletRequestBuilder pageRequest(UUID roundId, String search, int page, int limit) {
        MockHttpServletRequestBuilder request = get("/api/v1/thesis/topics")
                .queryParam("roundId", roundId.toString())
                .queryParam("page", String.valueOf(page))
                .queryParam("limit", String.valueOf(limit));
        return search == null ? request : request.queryParam("search", search);
    }

    private MvcResult unpaged(UUID roundId, String status, RequestPostProcessor actor) throws Exception {
        MockHttpServletRequestBuilder request = get("/api/v1/thesis/topics")
                .queryParam("roundId", roundId.toString());
        if (status != null) {
            request.queryParam("status", status);
        }
        return perform(request, actor);
    }

    private MvcResult unpagedRequest(UUID roundId, String search, RequestPostProcessor actor) throws Exception {
        MockHttpServletRequestBuilder request = get("/api/v1/thesis/topics")
                .queryParam("roundId", roundId.toString());
        if (search != null) {
            request.queryParam("search", search);
        }
        return perform(request, actor);
    }

    private MvcResult perform(MockHttpServletRequestBuilder request, RequestPostProcessor actor)
            throws Exception {
        return mvc.perform(request.with(actor)).andExpect(status().isOk()).andReturn();
    }

    private List<TopicResponse> body(MvcResult result) throws Exception {
        return objectMapper.readValue(result.getResponse().getContentAsString(),
                new TypeReference<List<TopicResponse>>() { });
    }

    // ---------- fixtures ----------

    private UUID round(String status) {
        UUID roundId = UUID.randomUUID();
        Instant now = Instant.now();
        jdbc.update("INSERT INTO thesis.thesis_registration_round "
                        + "(id,name,thesis_type,lecturer_submit_start,lecturer_submit_end,"
                        + "registration_start,registration_end,status) VALUES (?,?,'KLTN',?,?,?,?,?)",
                roundId, "topic-search-" + roundId, Timestamp.from(now.minusSeconds(7_200)),
                Timestamp.from(now.minusSeconds(3_600)), Timestamp.from(now.minusSeconds(3_600)),
                Timestamp.from(now.plusSeconds(86_400 * 30L)), status);
        return roundId;
    }

    private UUID topic(UUID roundId, String title, String description, TopicStatus status,
            String departmentId, String createdBy) {
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO thesis.thesis_topic "
                        + "(id,round_id,department_id,title,description,max_groups,status,created_by)"
                        + " VALUES (?,?,?,?,?,2,?,?)",
                id, roundId, departmentId, title, description, status.name(), createdBy);
        return id;
    }

    private RequestPostProcessor admin() {
        return ThesisAuthorityFixture.role(jdbc, "ts-admin", "ADMIN");
    }

    private RequestPostProcessor student() {
        return ThesisAuthorityFixture.role(jdbc, "ts-student", "STUDENT");
    }

    private RequestPostProcessor lecturer(String lecturerId) {
        return ThesisAuthorityFixture.lecturer(jdbc, lecturerId);
    }

    private RequestPostProcessor departmentHead() {
        ThesisAuthorityFixture.lecturer(jdbc, DEPT_HEAD);
        jdbc.update("UPDATE campuscore_auth.\"Lecturer\" SET \"departmentId\"='department-demo' WHERE \"id\"=?",
                DEPT_HEAD);
        ThesisAuthorityFixture.role(jdbc, subject(DEPT_HEAD), "TRUONG_BO_MON");
        return ThesisAuthorityFixture.lecturer(jdbc, DEPT_HEAD);
    }

    private static String subject(String lecturerId) {
        return "thesis-fixture-lecturer-" + lecturerId;
    }
}
