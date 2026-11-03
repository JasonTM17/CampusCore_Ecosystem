package io.campuscore.restfulapi.thesis;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import io.campuscore.restfulapi.thesis.domain.TopicStatus;
import io.campuscore.restfulapi.thesis.web.ThesisTopicDtos.TopicResponse;
import java.math.BigDecimal;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.RequestPostProcessor;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.ObjectMapper;

/**
 * Q09 paging contract: every paged response is the legacy authorised list with
 * the old title/UUID tie-break applied before slicing, and concatenating all
 * pages reproduces the legacy paged result. The oracle is the endpoint's own
 * unpaged branch, which keeps the legacy service implementation.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles({"test", "persistence"})
@TestPropertySource(properties = {
        "spring.datasource.url=jdbc:h2:mem:thesis_topic_paging_contract;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1",
        "spring.datasource.username=sa",
        "spring.datasource.password=",
        "spring.flyway.enabled=true",
        "spring.flyway.locations=classpath:db/migration-h2"
})
class ThesisTopicPagingContractTest {

    private static final String TOTAL_COUNT_HEADER = "X-Total-Count";
    private static final String LECT_A = "tp-lect-a";
    private static final String LECT_B = "tp-lect-b";
    private static final String DEAN = "tp-dean";
    private static final String DEPT_HEAD = "tp-head";
    private static final String REVIEWER = "tp-reviewer";
    private static final String GRADER = "tp-grader";
    private static final String FOREIGN_FACULTY = "tp-faculty-foreign";
    private static final String FOREIGN_DEPARTMENT = "tp-dept-foreign";

    @Autowired private JdbcTemplate jdbc;
    @Autowired private MockMvc mvc;
    @Autowired private ObjectMapper objectMapper;

    @BeforeEach
    void ensureForeignScope() {
        if (count("SELECT COUNT(*) FROM academic.\"Faculty\" WHERE \"id\" = ?", FOREIGN_FACULTY) == 0) {
            jdbc.update("INSERT INTO academic.\"Faculty\" (\"id\",\"name\",\"isActive\") VALUES (?,?,TRUE)",
                    FOREIGN_FACULTY, "Foreign Faculty");
        }
        if (count("SELECT COUNT(*) FROM academic.\"Department\" WHERE \"id\" = ?", FOREIGN_DEPARTMENT) == 0) {
            jdbc.update("INSERT INTO academic.\"Department\" "
                            + "(\"id\",\"name\",\"code\",\"facultyId\",\"isActive\") VALUES (?,?,?,?,TRUE)",
                    FOREIGN_DEPARTMENT, "Foreign Department", "TPF", FOREIGN_FACULTY);
        }
    }

    @Test
    void publishedAndApprovedPagesMatchTheLegacyOrderForEveryRole() throws Exception {
        UUID roundId = round("DRAFT");
        String other = subject(LECT_B);
        topic(roundId, "Alpha", TopicStatus.PUBLISHED, "department-demo", other);
        topic(roundId, "Beta", TopicStatus.APPROVED, "department-demo", other);
        topic(roundId, "Same title", TopicStatus.PUBLISHED, "department-demo", other);
        topic(roundId, "Same title", TopicStatus.APPROVED, "department-demo", other);
        topic(roundId, "Same title", TopicStatus.PUBLISHED, "department-demo", other);
        topic(roundId, "Charlie", TopicStatus.APPROVED, "department-demo", other);
        topic(roundId, "Hidden draft", TopicStatus.DRAFT, "department-demo", other);

        for (RequestPostProcessor actor : List.of(student(), lecturer(LECT_A), departmentHead(),
                facultyHead(), admin())) {
            assertPagedMatchesLegacy(roundId, null, actor, 2, 6);
            assertPagedMatchesLegacy(roundId, "PUBLISHED", actor, 3, 6);
            assertPagedMatchesLegacy(roundId, "APPROVED", actor, 1, 3);
        }
    }

    @Test
    void publishedAndApprovedPagesStillApplyDepartmentAndFacultyGovernanceScope() throws Exception {
        UUID roundId = round("DRAFT");
        String other = subject(LECT_B);
        UUID ownDepartmentPublished = topic(roundId, "A own department published", TopicStatus.PUBLISHED,
                "department-demo", other);
        UUID ownDepartmentApproved = topic(roundId, "B own department approved", TopicStatus.APPROVED,
                "department-demo", other);
        UUID sameFacultyPublished = topic(roundId, "C same faculty published", TopicStatus.PUBLISHED,
                "department-other", other);
        UUID sameFacultyApproved = topic(roundId, "D same faculty approved", TopicStatus.APPROVED,
                "department-other", other);
        UUID foreignPublished = topic(roundId, "E foreign published", TopicStatus.PUBLISHED,
                FOREIGN_DEPARTMENT, other);

        assertThat(ids(roundId, null, departmentHead()))
                .containsExactlyInAnyOrder(ownDepartmentPublished, ownDepartmentApproved);
        assertThat(ids(roundId, "APPROVED", departmentHead())).containsExactly(ownDepartmentApproved);
        assertThat(ids(roundId, null, facultyHead())).containsExactlyInAnyOrder(
                ownDepartmentPublished, ownDepartmentApproved, sameFacultyPublished, sameFacultyApproved);

        // Explicit PUBLISHED still merges APPROVED, but the governance filter
        // runs after that branch in the legacy read, so it must narrow here too.
        assertPagedMatchesLegacy(roundId, "PUBLISHED", departmentHead(), 1, 2);
        assertPagedMatchesLegacy(roundId, "APPROVED", departmentHead(), 1, 1);
        assertPagedMatchesLegacy(roundId, "PUBLISHED", facultyHead(), 1, 4);
        assertPagedMatchesLegacy(roundId, "APPROVED", facultyHead(), 1, 2);
        assertThat(ids(roundId, null, lecturer(LECT_A))).containsExactlyInAnyOrder(
                ownDepartmentPublished, ownDepartmentApproved, sameFacultyPublished, sameFacultyApproved,
                foreignPublished);
        assertThat(ids(roundId, null, student())).containsExactlyInAnyOrder(
                ownDepartmentPublished, ownDepartmentApproved, sameFacultyPublished, sameFacultyApproved,
                foreignPublished);

        for (RequestPostProcessor actor : List.of(departmentHead(), facultyHead(), lecturer(LECT_A),
                student(), admin())) {
            assertPagedMatchesLegacy(roundId, null, actor, 2,
                    ids(roundId, null, actor).size());
        }
    }

    @Test
    void privateStatusesKeepOwnerFacultyAndDepartmentDistinctions() throws Exception {
        UUID roundId = round("DRAFT");
        String owner = subject(LECT_A);
        String other = subject(LECT_B);
        String deanSubject = subject(DEAN);
        UUID own = topic(roundId, "A own draft", TopicStatus.DRAFT, "department-demo", owner);
        UUID sameDepartment = topic(roundId, "B other draft", TopicStatus.DRAFT, "department-demo", other);
        UUID sameFaculty = topic(roundId, "C faculty draft", TopicStatus.DRAFT, "department-other", other);
        UUID foreign = topic(roundId, "D foreign draft", TopicStatus.DRAFT, FOREIGN_DEPARTMENT, other);
        UUID deanOwnForeign = topic(roundId, "E dean own foreign draft", TopicStatus.DRAFT,
                FOREIGN_DEPARTMENT, deanSubject);
        UUID deanSupervisedForeign = topic(roundId, "F dean supervised foreign draft", TopicStatus.DRAFT,
                FOREIGN_DEPARTMENT, other);
        supervise(deanSupervisedForeign, DEAN);
        // Created with the lecturerId claim, not the user subject: the ordinary
        // lecturer branch only matches the subject in the legacy read, so this
        // row must not widen that branch. A faculty head owner check accepts
        // either key, so the dean-owned row stays visible to the dean.
        UUID lecturerClaimOwnedForeign = topic(roundId, "G lecturer claim-owned foreign draft",
                TopicStatus.DRAFT, FOREIGN_DEPARTMENT, LECT_A);
        UUID deanClaimOwnedForeign = topic(roundId, "H dean claim-owned foreign draft",
                TopicStatus.DRAFT, FOREIGN_DEPARTMENT, DEAN);

        assertThat(ids(roundId, "DRAFT", student())).isEmpty();

        assertThat(ids(roundId, "DRAFT", lecturer(LECT_A))).containsExactly(own);
        assertThat(ids(roundId, "DRAFT", lecturer(LECT_B)))
                .containsExactlyInAnyOrder(sameDepartment, sameFaculty, foreign, deanSupervisedForeign);
        assertThat(ids(roundId, "DRAFT", lecturer(LECT_A))).doesNotContain(sameDepartment, sameFaculty, foreign,
                deanOwnForeign, deanSupervisedForeign, lecturerClaimOwnedForeign, deanClaimOwnedForeign);

        assertThat(ids(roundId, "DRAFT", departmentHead()))
                .containsExactlyInAnyOrder(own, sameDepartment);
        assertThat(ids(roundId, "DRAFT", facultyHead()))
                .containsExactlyInAnyOrder(own, sameDepartment, sameFaculty, deanOwnForeign, deanSupervisedForeign,
                        deanClaimOwnedForeign);
        assertThat(ids(roundId, "DRAFT", admin())).containsExactlyInAnyOrder(
                own, sameDepartment, sameFaculty, foreign, deanOwnForeign, deanSupervisedForeign,
                lecturerClaimOwnedForeign, deanClaimOwnedForeign);

        for (RequestPostProcessor actor : List.of(student(), lecturer(LECT_A), lecturer(LECT_B),
                departmentHead(), facultyHead(), admin())) {
            assertThat(legacyUnpaged(roundId, "DRAFT", actor)).allMatch(topic -> topic.status() == TopicStatus.DRAFT);
            assertPagedMatchesLegacy(roundId, "DRAFT", actor, 2,
                    ids(roundId, "DRAFT", actor).size());
        }
    }

    @ParameterizedTest
    @EnumSource(value = TopicStatus.class, names = {"DRAFT", "REJECTED", "ARCHIVED"})
    void everyPrivateStatusKeepsOrdinaryLecturersScopedToTheirOwnProposals(TopicStatus status) throws Exception {
        UUID roundId = round("DRAFT");
        UUID own = topic(roundId, "Own " + status, status, "department-demo", subject(LECT_A));
        UUID other = topic(roundId, "Other " + status, status, "department-demo", subject(LECT_B));

        List<TopicResponse> visible = legacyUnpaged(roundId, status.name(), lecturer(LECT_A));
        assertThat(visible).extracting(TopicResponse::id).containsExactly(own).doesNotContain(other);
        assertPagedMatchesLegacy(roundId, status.name(), lecturer(LECT_A), 1, 1);
    }

    @Test
    void governanceRolesWithoutAnActiveProfileFailClosedEvenWhenPaged() throws Exception {
        UUID roundId = round("DRAFT");
        topic(roundId, "No profile may see this", TopicStatus.DRAFT, "department-demo", subject(LECT_B));

        RequestPostProcessor profilelessDean = ThesisAuthorityFixture.role(
                jdbc, "tp-profileless-dean", "TRUONG_KHOA");
        RequestPostProcessor profilelessHead = ThesisAuthorityFixture.role(
                jdbc, "tp-profileless-head", "TRUONG_BO_MON");

        assertThat(ids(roundId, "DRAFT", profilelessDean)).isEmpty();
        assertPagedMatchesLegacy(roundId, "DRAFT", profilelessDean, 2, 0);
        assertThat(ids(roundId, "DRAFT", profilelessHead)).isEmpty();
        assertPagedMatchesLegacy(roundId, "DRAFT", profilelessHead, 2, 0);
    }

    @Test
    void equalTitlesAcrossPublishedAndApprovedTieOnUuidStringOrder() throws Exception {
        UUID roundId = round("DRAFT");
        List<UUID> expected = new ArrayList<>();
        for (int i = 0; i < 6; i++) {
            expected.add(topic(roundId, "Collision title", TopicStatus.PUBLISHED,
                    "department-demo", subject(LECT_B)));
        }
        for (int i = 0; i < 3; i++) {
            expected.add(topic(roundId, "Collision title", TopicStatus.APPROVED,
                    "department-demo", subject(LECT_B)));
        }
        expected.sort(Comparator.comparing(UUID::toString));

        assertPagedMatchesLegacy(roundId, null, student(), 2, 9);

        List<UUID> concatenated = new ArrayList<>();
        for (int page = 0; page < 5; page++) {
            concatenated.addAll(ids(roundId, null, student(), page, 2));
        }
        assertThat(concatenated).containsExactlyElementsOf(expected);
    }

    @Test
    void unicodeTitlesUseTheLegacyJavaComparatorInsteadOfSqlCollation() throws Exception {
        UUID roundId = round("DRAFT");
        List<String> titles = List.of("Zeta", "Ánh", "apple", "Äpfel", "10", "_x", "đề");
        for (String title : titles) {
            topic(roundId, title, TopicStatus.PUBLISHED, "department-demo", subject(LECT_B));
        }
        List<String> expected = new ArrayList<>(titles);
        expected.sort(Comparator.naturalOrder());

        List<TopicResponse> page = body(page(roundId, null, student(), 0, 100));
        assertThat(page).extracting(TopicResponse::title).containsExactlyElementsOf(expected);
    }

    @Test
    void scoreAndReviewerMaskingMatchesLegacyBeforeResultsPublication() throws Exception {
        UUID roundId = round("DRAFT");
        UUID masked = scoredTopic(roundId, "Masked score", 8.5, "GRADED", REVIEWER);
        council(roundId, masked, GRADER);

        assertThat(single(roundId, student())).satisfies(topic -> {
            assertThat(topic.finalScore()).isNull();
            assertThat(topic.resultStatus()).isNull();
            assertThat(topic.gvpbLecturerId()).isNull();
        });
        assertThat(single(roundId, lecturer(LECT_B))).satisfies(topic -> {
            assertThat(topic.finalScore()).isNull();
            assertThat(topic.resultStatus()).isNull();
            assertThat(topic.gvpbLecturerId()).isNull();
        });
        // A department head is governance staff but not a grading stakeholder
        // here; the legacy list does not treat that role as a score reader.
        assertThat(single(roundId, departmentHead())).satisfies(topic -> {
            assertThat(topic.finalScore()).isNull();
            assertThat(topic.resultStatus()).isNull();
            assertThat(topic.gvpbLecturerId()).isNull();
        });
        for (RequestPostProcessor actor : List.of(lecturer(REVIEWER), lecturer(GRADER),
                facultyHead(), admin())) {
            assertThat(single(roundId, actor)).satisfies(topic -> {
                assertThat(topic.finalScore()).isEqualByComparingTo("8.50");
                assertThat(topic.resultStatus()).isEqualTo("GRADED");
                assertThat(topic.gvpbLecturerId()).isEqualTo(REVIEWER);
            });
        }
        for (RequestPostProcessor actor : List.of(student(), lecturer(LECT_B), departmentHead(),
                lecturer(REVIEWER), lecturer(GRADER), facultyHead(), admin())) {
            assertThat(single(roundId, actor)).usingRecursiveComparison()
                    .isEqualTo(legacyUnpaged(roundId, null, actor).getFirst());
        }
    }

    @Test
    void resultsPublicationRevealsScoresButKeepsReviewerIdentityMaskedForNonGraders() throws Exception {
        UUID roundId = round("RESULTS_PUBLISHED");
        scoredTopic(roundId, "Published score", 9.25, "GRADED", REVIEWER);

        assertThat(single(roundId, student())).satisfies(topic -> {
            assertThat(topic.finalScore()).isNull();
            assertThat(topic.resultStatus()).isNull();
            assertThat(topic.gvpbLecturerId()).isNull();
        });
        assertThat(single(roundId, lecturer(LECT_B))).satisfies(topic -> {
            assertThat(topic.finalScore()).isNull();
            assertThat(topic.resultStatus()).isNull();
            assertThat(topic.gvpbLecturerId()).isNull();
        });
        assertThat(single(roundId, lecturer(REVIEWER))).satisfies(topic -> {
            assertThat(topic.finalScore()).isEqualByComparingTo("9.25");
            assertThat(topic.resultStatus()).isEqualTo("GRADED");
            assertThat(topic.gvpbLecturerId()).isEqualTo(REVIEWER);
        });
        assertThat(single(roundId, departmentHead())).satisfies(topic -> {
            assertThat(topic.finalScore()).isNull();
            assertThat(topic.resultStatus()).isNull();
            assertThat(topic.gvpbLecturerId()).isNull();
        });
        assertThat(single(roundId, facultyHead())).satisfies(topic -> {
            assertThat(topic.finalScore()).isEqualByComparingTo("9.25");
            assertThat(topic.resultStatus()).isEqualTo("GRADED");
            assertThat(topic.gvpbLecturerId()).isEqualTo(REVIEWER);
        });
        assertThat(single(roundId, admin())).satisfies(topic -> {
            assertThat(topic.finalScore()).isEqualByComparingTo("9.25");
            assertThat(topic.resultStatus()).isEqualTo("GRADED");
            assertThat(topic.gvpbLecturerId()).isEqualTo(REVIEWER);
        });
        for (RequestPostProcessor actor : List.of(student(), lecturer(LECT_B), lecturer(REVIEWER),
                departmentHead(), facultyHead(), admin())) {
            assertThat(single(roundId, actor)).usingRecursiveComparison()
                    .isEqualTo(legacyUnpaged(roundId, null, actor).getFirst());
        }
    }

    @Test
    void publishedResultsRequireAnActiveApprovedMembershipAcrossEveryCatalogueRead() throws Exception {
        UUID gradedRound = round("RESULTS_PUBLISHED");
        UUID gradedTopic = scoredTopic(gradedRound, "Published graded result", 9.25, "GRADED", REVIEWER);
        UUID nonQualifiedRound = round("RESULTS_PUBLISHED");
        UUID nonQualifiedTopic = topic(nonQualifiedRound, "Published non-qualified result", TopicStatus.PUBLISHED,
                "department-demo", subject(LECT_B));
        jdbc.update("UPDATE thesis.thesis_topic SET result_status = 'NOT_QUALIFIED', "
                        + "result_reason = 'GVPB_BELOW_THRESHOLD', result_resolved_by = 'fixture-publisher', "
                        + "result_resolved_at = CURRENT_TIMESTAMP WHERE id = ?",
                nonQualifiedTopic);

        String activeMemberId = "tp-result-active-member";
        String rejectedMemberId = "tp-result-rejected-member";
        String cancelledMemberId = "tp-result-cancelled-member";
        String inactiveMemberId = "tp-result-inactive-member";
        resultGroup(gradedRound, gradedTopic, activeMemberId, "APPROVED", "APPROVED", true);
        resultGroup(nonQualifiedRound, nonQualifiedTopic, activeMemberId, "APPROVED", "APPROVED", true);
        resultGroup(gradedRound, gradedTopic, rejectedMemberId, "REJECTED", "REJECTED", true);
        resultGroup(gradedRound, gradedTopic, cancelledMemberId, "CANCELLED", "APPROVED", true);
        resultGroup(gradedRound, gradedTopic, inactiveMemberId, "APPROVED", "APPROVED", false);

        var activeMember = ThesisAuthorityFixture.student(jdbc, activeMemberId);
        assertResultVisible(gradedRound, gradedTopic, activeMember,
                new BigDecimal("9.25"), "GRADED", null, false);
        assertResultVisible(nonQualifiedRound, nonQualifiedTopic, activeMember,
                null, "NOT_QUALIFIED", "GVPB_BELOW_THRESHOLD", true);

        List<RequestPostProcessor> unauthorized = List.of(
                ThesisAuthorityFixture.student(jdbc, "tp-result-outsider"),
                lecturer(LECT_B),
                ThesisAuthorityFixture.student(jdbc, rejectedMemberId),
                ThesisAuthorityFixture.student(jdbc, cancelledMemberId),
                ThesisAuthorityFixture.student(jdbc, inactiveMemberId));
        for (RequestPostProcessor actor : unauthorized) {
            assertResultMasked(gradedRound, gradedTopic, actor);
            assertResultMasked(nonQualifiedRound, nonQualifiedTopic, actor);
        }
    }

    @Test
    void pagingParametersKeepTheLegacyUnpagedContractAndRejectInvalidWindows() throws Exception {
        UUID roundId = round("DRAFT");
        for (int i = 0; i < 7; i++) {
            topic(roundId, "Param topic " + i, TopicStatus.PUBLISHED, "department-demo", subject(LECT_B));
        }

        MvcResult legacy = mvc.perform(get("/api/v1/thesis/topics")
                        .queryParam("roundId", roundId.toString()).with(student()))
                .andExpect(status().isOk()).andReturn();
        assertThat(legacy.getResponse().getHeader(TOTAL_COUNT_HEADER)).isNull();
        List<TopicResponse> legacyBody = body(legacy);
        assertThat(legacyBody).hasSize(7);

        MvcResult pageOne = mvc.perform(get("/api/v1/thesis/topics")
                        .queryParam("roundId", roundId.toString())
                        .queryParam("page", "0").queryParam("limit", "3").with(student()))
                .andExpect(status().isOk()).andReturn();
        assertThat(pageOne.getResponse().getHeader(TOTAL_COUNT_HEADER)).isEqualTo("7");
        assertThat(body(pageOne)).hasSize(3);

        MvcResult limitOnly = mvc.perform(get("/api/v1/thesis/topics")
                        .queryParam("roundId", roundId.toString())
                        .queryParam("limit", "3").with(student()))
                .andExpect(status().isOk()).andReturn();
        assertThat(limitOnly.getResponse().getHeader(TOTAL_COUNT_HEADER)).isEqualTo("7");
        assertThat(body(limitOnly)).isEqualTo(body(pageOne));

        mvc.perform(get("/api/v1/thesis/topics")
                        .queryParam("roundId", roundId.toString())
                        .queryParam("page", "1").with(student()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_PAGING"));
        mvc.perform(get("/api/v1/thesis/topics")
                        .queryParam("roundId", roundId.toString())
                        .queryParam("limit", "0").with(student()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_PAGING"));
        mvc.perform(get("/api/v1/thesis/topics")
                        .queryParam("roundId", roundId.toString())
                        .queryParam("limit", "101").with(student()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_PAGING"));
        mvc.perform(get("/api/v1/thesis/topics")
                        .queryParam("roundId", roundId.toString())
                        .queryParam("page", "-1").queryParam("limit", "2").with(student()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_PAGING"));

        MvcResult outOfRange = mvc.perform(get("/api/v1/thesis/topics")
                        .queryParam("roundId", roundId.toString())
                        .queryParam("page", String.valueOf(Integer.MAX_VALUE))
                        .queryParam("limit", "100").with(student()))
                .andExpect(status().isOk()).andReturn();
        assertThat(outOfRange.getResponse().getHeader(TOTAL_COUNT_HEADER)).isEqualTo("7");
        assertThat(body(outOfRange)).isEmpty();

        MvcResult boundary = mvc.perform(get("/api/v1/thesis/topics")
                        .queryParam("roundId", roundId.toString())
                        .queryParam("page", "3").queryParam("limit", "3").with(student()))
                .andExpect(status().isOk()).andReturn();
        assertThat(boundary.getResponse().getHeader(TOTAL_COUNT_HEADER)).isEqualTo("7");
        assertThat(body(boundary)).isEmpty();

        // W17 does not tighten the existing two-argument validator: repeated
        // paging parameters stay accepted on these legacy thesis routes.
        mvc.perform(get("/api/v1/thesis/topics")
                        .queryParam("roundId", roundId.toString())
                        .queryParam("page", "0", "1").queryParam("limit", "1", "2").with(student()))
                .andExpect(status().isOk());
    }

    @Test
    void unknownRoundStillFailsBeforePagingIsApplied() throws Exception {
        mvc.perform(get("/api/v1/thesis/topics")
                        .queryParam("roundId", UUID.randomUUID().toString())
                        .queryParam("page", "0").queryParam("limit", "20").with(admin()))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.message").value("Thesis registration round not found"));
    }

    // ---------- paging assertions ----------

    private void assertPagedMatchesLegacy(UUID roundId, String status, RequestPostProcessor actor,
            int limit, int expectedTotal) throws Exception {
        List<TopicResponse> legacy = legacyUnpaged(roundId, status, actor);
        assertThat(legacy).hasSize(expectedTotal);
        List<TopicResponse> ordered = legacyTieBreak(legacy);
        int pages = expectedTotal == 0 ? 1 : (expectedTotal + limit - 1) / limit;
        for (int page = 0; page < pages + 1; page++) {
            MvcResult result = page(roundId, status, actor, page, limit);
            assertThat(result.getResponse().getStatus()).isEqualTo(200);
            assertThat(result.getResponse().getHeader(TOTAL_COUNT_HEADER)).isEqualTo(String.valueOf(expectedTotal));
            List<TopicResponse> expected = legacyPage(ordered, page, limit);
            assertThat(body(result)).usingRecursiveComparison().isEqualTo(expected);
        }
    }

    private List<TopicResponse> legacyPage(List<TopicResponse> ordered, int page, int limit) {
        long from = (long) page * limit;
        if (from >= ordered.size()) {
            return List.of();
        }
        int to = (int) Math.min(ordered.size(), from + limit);
        return List.copyOf(ordered.subList((int) from, to));
    }

    /**
     * Test-only copy of the old tie-break in {@code ListPaging.respond(items,
     * window, title, id)}: equal-title runs are ordered by the UUID string and
     * nothing else moves.
     */
    private static List<TopicResponse> legacyTieBreak(List<TopicResponse> items) {
        Comparator<TopicResponse> byId = Comparator.comparing(topic -> String.valueOf(topic.id()));
        List<TopicResponse> result = new ArrayList<>(items.size());
        int start = 0;
        while (start < items.size()) {
            int end = start + 1;
            String title = items.get(start).title();
            while (end < items.size() && Objects.equals(title, items.get(end).title())) {
                end++;
            }
            List<TopicResponse> run = new ArrayList<>(items.subList(start, end));
            run.sort(byId);
            result.addAll(run);
            start = end;
        }
        return result;
    }

    private MvcResult page(UUID roundId, String status, RequestPostProcessor actor, int page, int limit)
            throws Exception {
        var request = get("/api/v1/thesis/topics")
                .queryParam("roundId", roundId.toString())
                .queryParam("page", String.valueOf(page))
                .queryParam("limit", String.valueOf(limit));
        if (status != null) {
            request.queryParam("status", status);
        }
        return mvc.perform(request.with(actor)).andExpect(status().isOk()).andReturn();
    }

    private List<TopicResponse> legacyUnpaged(UUID roundId, String status, RequestPostProcessor actor)
            throws Exception {
        var request = get("/api/v1/thesis/topics").queryParam("roundId", roundId.toString());
        if (status != null) {
            request.queryParam("status", status);
        }
        MvcResult result = mvc.perform(request.with(actor)).andExpect(status().isOk()).andReturn();
        assertThat(result.getResponse().getHeader(TOTAL_COUNT_HEADER)).isNull();
        return body(result);
    }

    private List<TopicResponse> body(MvcResult result) throws Exception {
        return objectMapper.readValue(result.getResponse().getContentAsString(),
                new TypeReference<List<TopicResponse>>() { });
    }

    private List<UUID> ids(UUID roundId, String status, RequestPostProcessor actor) throws Exception {
        return legacyUnpaged(roundId, status, actor).stream().map(TopicResponse::id).toList();
    }

    private List<UUID> ids(UUID roundId, String status, RequestPostProcessor actor, int page, int limit)
            throws Exception {
        return body(page(roundId, status, actor, page, limit)).stream().map(TopicResponse::id).toList();
    }

    private TopicResponse single(UUID roundId, RequestPostProcessor actor) throws Exception {
        List<TopicResponse> page = body(page(roundId, null, actor, 0, 20));
        assertThat(page).hasSize(1);
        return page.getFirst();
    }

    private void assertResultVisible(UUID roundId, UUID topicId, RequestPostProcessor actor,
            BigDecimal finalScore, String resultStatus, String resultReason, boolean hasResolvedAt) throws Exception {
        assertTopicResult(detail(topicId, actor), finalScore, resultStatus, resultReason, hasResolvedAt);
        assertTopicResult(findTopic(legacyUnpaged(roundId, null, actor), topicId),
                finalScore, resultStatus, resultReason, hasResolvedAt);
        assertTopicResult(findTopic(body(page(roundId, null, actor, 0, 20)), topicId),
                finalScore, resultStatus, resultReason, hasResolvedAt);
    }

    private void assertResultMasked(UUID roundId, UUID topicId, RequestPostProcessor actor) throws Exception {
        TopicResponse detail = detail(topicId, actor);
        assertTopicResult(detail, null, null, null, false);
        assertThat(detail.gvpbLecturerId()).isNull();
        TopicResponse unpaged = findTopic(legacyUnpaged(roundId, null, actor), topicId);
        assertTopicResult(unpaged, null, null, null, false);
        assertThat(unpaged.gvpbLecturerId()).isNull();
        TopicResponse paged = findTopic(body(page(roundId, null, actor, 0, 20)), topicId);
        assertTopicResult(paged, null, null, null, false);
        assertThat(paged.gvpbLecturerId()).isNull();
    }

    private TopicResponse detail(UUID topicId, RequestPostProcessor actor) throws Exception {
        MvcResult result = mvc.perform(get("/api/v1/thesis/topics/{id}", topicId).with(actor))
                .andExpect(status().isOk()).andReturn();
        return objectMapper.readValue(result.getResponse().getContentAsString(), TopicResponse.class);
    }

    private static TopicResponse findTopic(List<TopicResponse> topics, UUID topicId) {
        return topics.stream().filter(topic -> topic.id().equals(topicId)).findFirst().orElseThrow();
    }

    private static void assertTopicResult(TopicResponse topic, BigDecimal finalScore,
            String resultStatus, String resultReason, boolean hasResolvedAt) {
        assertThat(topic.finalScore()).isEqualTo(finalScore);
        assertThat(topic.resultStatus()).isEqualTo(resultStatus);
        assertThat(topic.resultReason()).isEqualTo(resultReason);
        if (hasResolvedAt) {
            assertThat(topic.resultResolvedAt()).isNotNull();
        } else {
            assertThat(topic.resultResolvedAt()).isNull();
        }
    }

    // ---------- fixtures ----------

    private UUID round(String status) {
        UUID roundId = UUID.randomUUID();
        Instant now = Instant.now();
        jdbc.update("INSERT INTO thesis.thesis_registration_round "
                        + "(id,name,thesis_type,lecturer_submit_start,lecturer_submit_end,"
                        + "registration_start,registration_end,status) VALUES (?,?,'KLTN',?,?,?,?,?)",
                roundId, "topic-paging-" + roundId, Timestamp.from(now.minusSeconds(7_200)),
                Timestamp.from(now.minusSeconds(3_600)), Timestamp.from(now.minusSeconds(3_600)),
                Timestamp.from(now.plusSeconds(86_400 * 30L)), status);
        return roundId;
    }

    private UUID topic(UUID roundId, String title, TopicStatus status, String departmentId, String createdBy) {
        return topic(roundId, title, status, departmentId, createdBy, null, null, null);
    }

    private UUID scoredTopic(UUID roundId, String title, double score, String resultStatus, String reviewer) {
        return topic(roundId, title, TopicStatus.PUBLISHED, "department-demo", subject(LECT_B),
                BigDecimal.valueOf(score), resultStatus, reviewer);
    }

    private UUID topic(UUID roundId, String title, TopicStatus status, String departmentId, String createdBy,
            BigDecimal finalScore, String resultStatus, String reviewer) {
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO thesis.thesis_topic "
                        + "(id,round_id,department_id,title,description,max_groups,status,created_by,"
                        + "final_score,result_status,gvpb_lecturer_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                id, roundId, departmentId, title, "Paging fixture description", 2, status.name(), createdBy,
                finalScore, resultStatus, reviewer);
        return id;
    }

    private void resultGroup(UUID roundId, UUID topicId, String studentId,
            String status, String approvalStatus, boolean activeParticipation) {
        UUID groupId = UUID.randomUUID();
        jdbc.update("INSERT INTO thesis.thesis_group "
                        + "(id, round_id, leader_student_id, topic_id, status, approval_status) "
                        + "VALUES (?, ?, ?, ?, ?, ?)",
                groupId, roundId, studentId, topicId, status, approvalStatus);
        jdbc.update("INSERT INTO thesis.thesis_group_member "
                        + "(id, group_id, round_id, student_id, member_order, is_leader, active_participation) "
                        + "VALUES (?, ?, ?, ?, 1, TRUE, ?)",
                UUID.randomUUID(), groupId, roundId, studentId, activeParticipation);
    }

    private void supervise(UUID topicId, String lecturerId) {
        jdbc.update("INSERT INTO thesis.thesis_topic_supervisor "
                        + "(id,topic_id,lecturer_id,supervisor_order) VALUES (?,?,?,1)",
                UUID.randomUUID(), topicId, lecturerId);
    }

    private void council(UUID roundId, UUID topicId, String lecturerId) {
        UUID councilId = UUID.randomUUID();
        jdbc.update("INSERT INTO thesis.thesis_council (id,round_id,name,status,created_by) "
                + "VALUES (?,?,'Paging council','ACTIVE',?)", councilId, roundId, subject(DEAN));
        jdbc.update("INSERT INTO thesis.thesis_council_member (id,council_id,lecturer_id,member_role) "
                + "VALUES (?,?,?,'MEMBER')", UUID.randomUUID(), councilId, lecturerId);
        jdbc.update("INSERT INTO thesis.thesis_council_topic (id,council_id,topic_id,assigned_by) "
                + "VALUES (?,?,?,?)", UUID.randomUUID(), councilId, topicId, subject(DEAN));
    }

    private RequestPostProcessor admin() {
        return ThesisAuthorityFixture.role(jdbc, "tp-admin", "ADMIN");
    }

    private RequestPostProcessor student() {
        return ThesisAuthorityFixture.role(jdbc, "tp-student", "STUDENT");
    }

    private RequestPostProcessor lecturer(String lecturerId) {
        return ThesisAuthorityFixture.lecturer(jdbc, lecturerId);
    }

    private RequestPostProcessor facultyHead() {
        ThesisAuthorityFixture.lecturer(jdbc, DEAN);
        jdbc.update("UPDATE campuscore_auth.\"Lecturer\" SET \"departmentId\"='department-demo' WHERE \"id\"=?",
                DEAN);
        ThesisAuthorityFixture.role(jdbc, subject(DEAN), "TRUONG_KHOA");
        return ThesisAuthorityFixture.lecturer(jdbc, DEAN);
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

    private int count(String sql, Object... args) {
        Integer count = jdbc.queryForObject(sql, Integer.class, args);
        return count == null ? 0 : count;
    }
}
