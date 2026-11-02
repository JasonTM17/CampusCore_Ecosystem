package io.campuscore.restfulapi.thesis;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.reset;

import io.campuscore.restfulapi.events.web.ListPaging;
import io.campuscore.restfulapi.thesis.domain.TopicStatus;
import io.campuscore.restfulapi.thesis.repository.ThesisTopicReadRepository;
import io.campuscore.restfulapi.thesis.service.ThesisTopicService;
import io.campuscore.restfulapi.thesis.web.ThesisTopicDtos.TopicResponse;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
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
 * Real-PostgreSQL port of the topic paging contract. Runs only against a
 * disposable PostgreSQL 15 database supplied through the existing opt-in
 * environment contract; an absent target is NOT_RUN, never a pass.
 *
 * <p>Seed markers are {@code twc-pg-}; cleanup is marker-scoped so a shared
 * disposable database stays reusable.
 */
@EnabledIf("postgresTargetConfigured")
@SpringBootTest(properties = { "spring.flyway.locations=classpath:db/migration", "deepseek.enabled=false" })
@ActiveProfiles({"test", "persistence"})
class ThesisTopicPagingPostgresIT {

    private static final String ROUND_NAME = "twc-pg-round";
    private static final String OWNER = "twc-pg-owner";

    @Autowired
    private JdbcTemplate jdbc;

    @Autowired
    private ThesisTopicService topics;

    @MockitoSpyBean
    private ThesisTopicReadRepository reads;

    private UUID roundId;

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", () -> System.getenv("CAMPUSCORE_E2E_POSTGRES_URL"));
        registry.add("spring.datasource.username", () -> valueOr("CAMPUSCORE_E2E_POSTGRES_USER", "campuscore"));
        registry.add("spring.datasource.password", () -> valueOr("CAMPUSCORE_E2E_POSTGRES_PASSWORD", "postgres"));
    }

    @BeforeEach
    void prepare() {
        reset(reads);
        cleanFixtures();
        roundId = UUID.randomUUID();
        Instant now = Instant.now();
        jdbc.update("INSERT INTO thesis.thesis_registration_round"
                        + " (id,name,thesis_type,lecturer_submit_start,lecturer_submit_end,"
                        + " registration_start,registration_end,status)"
                        + " VALUES (?,?,'KLTN',?,?,?,?,'PROPOSAL_OPEN')",
                roundId, ROUND_NAME, Timestamp.from(now.minusSeconds(3600)),
                Timestamp.from(now.plusSeconds(3600)), Timestamp.from(now.plusSeconds(7200)),
                Timestamp.from(now.plusSeconds(14400)));
    }

    @AfterEach
    void cleanFixtures() {
        jdbc.update("DELETE FROM thesis.thesis_topic_supervisor WHERE topic_id IN"
                + " (SELECT id FROM thesis.thesis_topic WHERE created_by LIKE 'twc-pg-%')");
        jdbc.update("DELETE FROM thesis.thesis_council_topic WHERE topic_id IN"
                + " (SELECT id FROM thesis.thesis_topic WHERE created_by LIKE 'twc-pg-%')");
        jdbc.update("DELETE FROM thesis.thesis_topic WHERE created_by LIKE 'twc-pg-%'");
        jdbc.update("DELETE FROM thesis.thesis_registration_round WHERE name = ?", ROUND_NAME);
    }

    @Test
    void concatenatedPagesMatchTheLegacyReadOnPostgres() {
        topic("Alpha", TopicStatus.PUBLISHED, "twc-pg-alpha");
        topic("Bravo", TopicStatus.APPROVED, "twc-pg-bravo");
        topic("Charlie", TopicStatus.PUBLISHED, "twc-pg-charlie");
        topic("Delta", TopicStatus.APPROVED, "twc-pg-delta");
        topic("Echo", TopicStatus.PUBLISHED, "twc-pg-echo");

        Jwt admin = jwt("twc-pg-admin", "ADMIN", null);
        List<TopicResponse> legacy = topics.list(roundId, null, admin);
        List<TopicResponse> paged = collectPages(admin, 2);

        assertThat(paged).extracting(TopicResponse::id)
                .containsExactlyElementsOf(legacy.stream().map(TopicResponse::id).toList());
        assertThat(paged).extracting(TopicResponse::title)
                .containsExactlyElementsOf(legacy.stream().map(TopicResponse::title).toList());
        assertThat(paged).hasSize(5);
    }

    @Test
    void equalTitlesAndUnicodeKeepTheJavaOrderingOnPostgres() {
        UUID third = topicWithId("00000000-0000-0000-0000-000000000003", "Equal", TopicStatus.PUBLISHED, "twc-pg-e3");
        UUID first = topicWithId("00000000-0000-0000-0000-000000000001", "Equal", TopicStatus.PUBLISHED, "twc-pg-e1");
        UUID second = topicWithId("00000000-0000-0000-0000-000000000002", "Equal", TopicStatus.PUBLISHED, "twc-pg-e2");
        topic("Zebra", TopicStatus.PUBLISHED, "twc-pg-z");
        topic("apple", TopicStatus.PUBLISHED, "twc-pg-a");
        topic("Ápple", TopicStatus.PUBLISHED, "twc-pg-accent");
        topic("Đề tài", TopicStatus.PUBLISHED, "twc-pg-viet");

        Jwt admin = jwt("twc-pg-admin", "ADMIN", null);
        List<TopicResponse> paged = collectPages(admin, 2);

        assertThat(paged).extracting(TopicResponse::title)
                .containsExactly("Equal", "Equal", "Equal", "Zebra", "apple", "Ápple", "Đề tài");
        assertThat(paged.subList(0, 3)).extracting(TopicResponse::id)
                .containsExactly(first, second, third);
    }

    @Test
    void maskingMatchesLegacyBeforeAndAfterPublicationOnPostgres() {
        UUID topicId = topic("Masked", TopicStatus.PUBLISHED, "twc-pg-masked");
        jdbc.update("UPDATE thesis.thesis_topic SET final_score=8.5, result_status='GRADED',"
                + " gvpb_lecturer_id='twc-pg-reviewer' WHERE id=?", topicId);
        Jwt student = jwt("twc-pg-student", "STUDENT", null);

        List<TopicResponse> beforeLegacy = topics.list(roundId, null, student);
        List<TopicResponse> beforePaged = collectPages(student, 1);
        assertThat(beforePaged).isEqualTo(beforeLegacy);
        assertThat(beforePaged.getFirst().finalScore()).isNull();
        assertThat(beforePaged.getFirst().resultStatus()).isNull();
        assertThat(beforePaged.getFirst().gvpbLecturerId()).isNull();

        jdbc.update("UPDATE thesis.thesis_registration_round SET status='RESULTS_PUBLISHED' WHERE id=?", roundId);

        List<TopicResponse> afterLegacy = topics.list(roundId, null, student);
        List<TopicResponse> afterPaged = collectPages(student, 1);
        assertThat(afterPaged).isEqualTo(afterLegacy);
        assertThat(afterPaged.getFirst().finalScore()).isEqualByComparingTo("8.5");
        assertThat(afterPaged.getFirst().resultStatus()).isEqualTo("GRADED");
        assertThat(afterPaged.getFirst().gvpbLecturerId()).isNull();
    }

    @Test
    void anOutOfRangePageKeepsTheExactTotalOnPostgres() {
        topic("One", TopicStatus.PUBLISHED, "twc-pg-one");
        topic("Two", TopicStatus.APPROVED, "twc-pg-two");
        Jwt admin = jwt("twc-pg-admin", "ADMIN", null);

        var page = topics.listPage(roundId, null, admin, ListPaging.Window.of(9, 2));

        assertThat(page.total()).isEqualTo(2);
        assertThat(page.items()).isEmpty();
    }

    @Test
    void pagedReadRunsInOneRepeatableReadTransactionOnPostgres() {
        topic("Snapshot", TopicStatus.PUBLISHED, "twc-pg-snapshot");
        Jwt admin = jwt("twc-pg-admin", "ADMIN", null);
        doAnswer(invocation -> {
            // The hydration callback runs inside listPage's transaction on the
            // primary datasource; SHOW reads the transaction bound to it.
            assertThat(jdbc.queryForObject("SHOW transaction_isolation", String.class))
                    .isEqualToIgnoringCase("repeatable read");
            return invocation.callRealMethod();
        }).when(reads).findResponsesByIds(any());

        var page = topics.listPage(roundId, null, admin, ListPaging.Window.of(0, 20));

        assertThat(page.items()).hasSize(1);
        assertThat(page.total()).isEqualTo(1);
    }

    private List<TopicResponse> collectPages(Jwt actor, int limit) {
        var first = topics.listPage(roundId, null, actor, ListPaging.Window.of(0, limit));
        assertThat(first.total()).isNotNull();
        long total = first.total();
        List<TopicResponse> all = new ArrayList<>(first.items());
        int pages = (int) ((total + limit - 1) / limit);
        for (int index = 1; index < pages; index++) {
            var next = topics.listPage(roundId, null, actor, ListPaging.Window.of(index, limit));
            assertThat(next.total()).isEqualTo(total);
            all.addAll(next.items());
        }
        var beyond = topics.listPage(roundId, null, actor, ListPaging.Window.of(Math.max(1, pages), limit));
        assertThat(beyond.total()).isEqualTo(total);
        assertThat(beyond.items()).isEmpty();
        return all;
    }

    private UUID topic(String title, TopicStatus status, String createdBy) {
        return topicWithId(UUID.randomUUID().toString(), title, status, createdBy);
    }

    private UUID topicWithId(String id, String title, TopicStatus status, String createdBy) {
        UUID topicId = UUID.fromString(id);
        jdbc.update("INSERT INTO thesis.thesis_topic"
                        + " (id,round_id,department_id,title,description,max_groups,status,created_by)"
                        + " VALUES (?,?,? ,?,'Postgres paging fixture',2,?,?)",
                topicId, roundId, "department-demo", title, status.name(), createdBy);
        return topicId;
    }

    private static Jwt jwt(String subject, String role, String lecturerId) {
        var builder = Jwt.withTokenValue("twc-pg-token").header("alg", "none").subject(subject)
                .claim("roles", List.of(role));
        if (lecturerId != null) {
            builder.claim("lecturerId", lecturerId);
        }
        return builder.build();
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
