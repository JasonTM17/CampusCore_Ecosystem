package io.campuscore.restfulapi.thesis;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import io.campuscore.restfulapi.events.web.ListPaging;
import io.campuscore.restfulapi.thesis.service.ThesisGroupReadService;
import io.campuscore.restfulapi.thesis.web.ThesisGroupReadDtos.GroupMemberResponse;
import io.campuscore.restfulapi.thesis.web.ThesisGroupReadDtos.GroupResponse;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.RequestPostProcessor;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ArrayNode;

/**
 * Q01/Q13 paging contract: the window is applied to the same authorized set as
 * the legacy read, totals are pre-pagination, Q13's scope rank keeps faculty
 * rows before supervised outsiders, and governance contact masking survives.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles({"test", "persistence"})
@TestPropertySource(properties = {
        "spring.datasource.url=jdbc:h2:mem:thesis_group_paging;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1",
        "spring.datasource.username=sa",
        "spring.datasource.password=",
        "spring.flyway.enabled=true",
        "spring.flyway.locations=classpath:db/migration-h2"
})
class ThesisGroupPagingContractTest {

    private static final String DEPT = "department-demo";
    private static final String FACULTY = "faculty-demo";
    private static final String SIBLING_DEPT = "gpaging-dept-sibling";
    private static final String FOREIGN_DEPT = "gpaging-dept-foreign";
    private static final String FOREIGN_CURRICULUM = "gpaging-curr-foreign";

    @Autowired
    private JdbcTemplate jdbc;

    @Autowired
    private MockMvc mvc;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private ThesisGroupReadService groupReads;

    @Autowired
    private NamedParameterJdbcTemplate namedJdbc;

    @BeforeEach
    void cleanDatabase() {
        jdbc.update("DELETE FROM thesis.thesis_group_report");
        jdbc.update("DELETE FROM thesis.thesis_council");
        jdbc.update("DELETE FROM thesis.thesis_group_member");
        jdbc.update("DELETE FROM thesis.thesis_group");
        jdbc.update("DELETE FROM thesis.thesis_topic_supervisor");
        jdbc.update("DELETE FROM thesis.thesis_topic");
        jdbc.update("DELETE FROM thesis.thesis_registration_round");
        jdbc.update("DELETE FROM campuscore_auth.\"Student\" WHERE \"id\" LIKE 'gpaging-%'");
        jdbc.update("DELETE FROM campuscore_auth.\"Lecturer\" WHERE \"id\" LIKE 'gpaging-%'");
        jdbc.update("DELETE FROM campuscore_auth.\"UserRole\" WHERE \"userId\" LIKE 'gpaging-%'");
        jdbc.update("DELETE FROM campuscore_auth.\"User\" WHERE \"id\" LIKE 'gpaging-%'");
        jdbc.update("DELETE FROM academic.\"Curriculum\" WHERE \"id\" LIKE 'gpaging-%'");
        jdbc.update("DELETE FROM academic.\"Department\" WHERE \"id\" LIKE 'gpaging-%'");
        jdbc.update("DELETE FROM academic.\"Faculty\" WHERE \"id\" LIKE 'gpaging-%'");
    }

    @Test
    void adminPagingKeepsCreatedDescIdAscAndExactPrePaginationTotal() throws Exception {
        UUID round = round("Admin paging");
        UUID otherRound = round("Admin paging other");
        UUID[] ids = new UUID[5];
        Instant base = Instant.parse("2030-02-01T00:00:00Z");
        for (int i = 0; i < ids.length; i++) {
            ids[i] = group(round, null, "gpaging-admin-leader", base.plusSeconds(i), "SUBMITTED");
        }
        group(otherRound, null, "gpaging-admin-leader", base.plusSeconds(20), "SUBMITTED");
        RequestPostProcessor admin = ThesisAuthorityFixture.role(jdbc, "gpaging-admin", "ADMIN");

        MvcResult first = mvc.perform(get("/api/v1/thesis/groups").queryParam("roundId", round.toString())
                        .queryParam("page", "0").queryParam("limit", "2").with(admin))
                .andExpect(status().isOk()).andReturn();
        assertThat(first.getResponse().getHeader("X-Total-Count")).isEqualTo("5");
        assertThat(ids(first)).containsExactly(ids[4].toString(), ids[3].toString());

        MvcResult second = mvc.perform(get("/api/v1/thesis/groups").queryParam("roundId", round.toString())
                        .queryParam("page", "1").queryParam("limit", "2").with(admin))
                .andExpect(status().isOk()).andReturn();
        assertThat(second.getResponse().getHeader("X-Total-Count")).isEqualTo("5");
        assertThat(ids(second)).containsExactly(ids[2].toString(), ids[1].toString());

        MvcResult third = mvc.perform(get("/api/v1/thesis/groups").queryParam("roundId", round.toString())
                        .queryParam("page", "2").queryParam("limit", "2").with(admin))
                .andExpect(status().isOk()).andReturn();
        assertThat(third.getResponse().getHeader("X-Total-Count")).isEqualTo("5");
        assertThat(ids(third)).containsExactly(ids[0].toString());

        MvcResult beyond = mvc.perform(get("/api/v1/thesis/groups").queryParam("roundId", round.toString())
                        .queryParam("page", "9").queryParam("limit", "2").with(admin))
                .andExpect(status().isOk()).andReturn();
        assertThat(beyond.getResponse().getHeader("X-Total-Count")).isEqualTo("5");
        assertThat(ids(beyond)).isEmpty();

        MvcResult legacy = mvc.perform(get("/api/v1/thesis/groups").queryParam("roundId", round.toString())
                        .with(admin))
                .andExpect(status().isOk()).andReturn();
        assertThat(legacy.getResponse().getHeader("X-Total-Count")).isNull();
        assertThat(ids(legacy)).containsExactly(
                ids[4].toString(), ids[3].toString(), ids[2].toString(), ids[1].toString(), ids[0].toString());
        assertThat(ids(legacy)).isEqualTo(oracleIds(round, List.of("ADMIN"), null, null, null));
        assertThat(groupReads.list(round, List.of("ADMIN"), null, null, null))
                .isEqualTo(new ThesisGroupLegacyOracle(namedJdbc)
                        .list(round, List.of("ADMIN"), null, null, null));
    }

    @Test
    void q13FacultyScopeIsOneDeduplicatedSetRankedBeforeSupervisedOutsiders() throws Exception {
        UUID round = round("Faculty paging");
        ensureSiblingAndForeignDepartments();
        String deanUser = ensureLecturer("gpaging-dean", DEPT);
        RequestPostProcessor dean = ThesisAuthorityFixture.role(jdbc, deanUser, "TRUONG_KHOA");

        Instant base = Instant.parse("2030-03-01T00:00:00Z");
        UUID f1 = group(round, topic(round, DEPT, "Faculty one"), "gpaging-dean-leader", base.plusSeconds(1), "SUBMITTED");
        UUID overlap = group(round, topic(round, DEPT, "Faculty overlap"), "gpaging-dean-leader", base.plusSeconds(2), "SUBMITTED");
        UUID f2 = group(round, topic(round, DEPT, "Faculty two"), "gpaging-dean-leader", base.plusSeconds(3), "SUBMITTED");
        UUID s1 = group(round, topic(round, FOREIGN_DEPT, "Outsider one"), "gpaging-dean-leader", base.plusSeconds(4), "SUBMITTED");
        UUID s2 = group(round, topic(round, FOREIGN_DEPT, "Outsider two"), "gpaging-dean-leader", base.plusSeconds(5), "SUBMITTED");
        UUID x1 = group(round, topic(round, FOREIGN_DEPT, "Foreign unrelated"), "gpaging-dean-leader", base.plusSeconds(6), "SUBMITTED");
        group(round, topic(round, FOREIGN_DEPT, "Foreign unrelated two"), "gpaging-dean-leader", base.plusSeconds(7), "SUBMITTED");
        // Topicless groups derive faculty membership from the members'
        // curricula: one inside the dean's faculty, one outside it.
        UUID topiclessOwn = group(round, null, "gpaging-topicless-own", base.plusSeconds(8), "SUBMITTED");
        member(topiclessOwn, round, ensureStudent("gpaging-topicless-own", "curriculum-demo"), 1, true);
        UUID topiclessForeign = group(round, null, "gpaging-topicless-foreign", base.plusSeconds(9), "SUBMITTED");
        member(topiclessForeign, round, ensureStudent("gpaging-topicless-foreign", FOREIGN_CURRICULUM), 1, true);
        supervise(topicOf(overlap), "gpaging-dean");
        supervise(topicOf(s1), "gpaging-dean");
        supervise(topicOf(s2), "gpaging-dean");
        externalMember(f1, round, "contact-f1@fixture.test");
        externalMember(overlap, round, "contact-overlap@fixture.test");
        externalMember(f2, round, "contact-f2@fixture.test");
        externalMember(s1, round, "contact-s1@fixture.test");
        externalMember(s2, round, "contact-s2@fixture.test");

        var serviceFirst = groupReads.listPage(round, List.of("TRUONG_KHOA"), null,
                "gpaging-dean", deanUser, ListPaging.Window.of(0, 2));
        assertThat(serviceFirst.items().get(0).members())
                .extracting(GroupMemberResponse::contact).containsOnlyNulls();
        assertThat(serviceFirst.items().get(1).members())
                .extracting(GroupMemberResponse::contact).containsOnlyNulls();

        MvcResult second = page(round, dean, 1, 2);
        assertThat(second.getResponse().getHeader("X-Total-Count")).isEqualTo("6");
        assertThat(ids(second)).containsExactly(overlap.toString(), f1.toString());
        var serviceSecond = groupReads.listPage(round, List.of("TRUONG_KHOA"), null,
                "gpaging-dean", deanUser, ListPaging.Window.of(1, 2));
        assertThat(serviceSecond.items().get(0).members())
                .extracting(GroupMemberResponse::contact).contains("contact-overlap@fixture.test");

        MvcResult third = page(round, dean, 2, 2);
        assertThat(third.getResponse().getHeader("X-Total-Count")).isEqualTo("6");
        assertThat(ids(third)).containsExactly(s2.toString(), s1.toString());
        var serviceThird = groupReads.listPage(round, List.of("TRUONG_KHOA"), null,
                "gpaging-dean", deanUser, ListPaging.Window.of(2, 2));
        assertThat(serviceThird.items().get(0).members())
                .extracting(GroupMemberResponse::contact).contains("contact-s2@fixture.test");

        MvcResult legacy = mvc.perform(get("/api/v1/thesis/groups").queryParam("roundId", round.toString())
                        .with(dean))
                .andExpect(status().isOk()).andReturn();
        assertThat(ids(legacy)).containsExactly(
                topiclessOwn.toString(), f2.toString(), overlap.toString(), f1.toString(),
                s2.toString(), s1.toString());
        assertThat(ids(legacy)).isEqualTo(
                oracleIds(round, List.of("TRUONG_KHOA"), null, "gpaging-dean", deanUser));
        assertThat(groupReads.list(round, List.of("TRUONG_KHOA"), null, "gpaging-dean", deanUser))
                .isEqualTo(new ThesisGroupLegacyOracle(namedJdbc)
                        .list(round, List.of("TRUONG_KHOA"), null, "gpaging-dean", deanUser));
        assertThat(ids(legacy)).doesNotContain(x1.toString(), topiclessForeign.toString());
        assertThat(ids(legacy).stream().filter(overlap.toString()::equals)).hasSize(1);
    }

    @Test
    void concatenatedPagesMatchLegacyJsonIncludingNestedFields() throws Exception {
        UUID round = round("Full equivalence");
        ensureSiblingAndForeignDepartments();
        String deanUser = ensureLecturer("gpaging-equiv-dean", DEPT);
        RequestPostProcessor dean = ThesisAuthorityFixture.role(jdbc, deanUser, "TRUONG_KHOA");
        Instant base = Instant.parse("2030-11-01T00:00:00Z");
        UUID inFaculty = group(round, topic(round, DEPT, "Equivalence faculty"),
                "gpaging-equiv-leader", base.plusSeconds(1), "SUBMITTED");
        UUID overlap = group(round, topic(round, SIBLING_DEPT, "Equivalence overlap"),
                "gpaging-equiv-leader", base.plusSeconds(2), "SUBMITTED");
        UUID outsider = group(round, topic(round, FOREIGN_DEPT, "Equivalence outsider"),
                "gpaging-equiv-leader", base.plusSeconds(3), "SUBMITTED");
        group(round, topic(round, FOREIGN_DEPT, "Equivalence foreign"),
                "gpaging-equiv-leader", base.plusSeconds(4), "SUBMITTED");
        UUID topicless = group(round, null, "gpaging-equiv-topicless",
                base.plusSeconds(5), "SUBMITTED");
        member(topicless, round, ensureStudent("gpaging-equiv-topicless", "curriculum-demo"), 1, true);
        supervise(topicOf(overlap), "gpaging-equiv-dean");
        externalMember(inFaculty, round, "equiv-in@fixture.test");
        externalMember(overlap, round, "equiv-overlap@fixture.test");
        externalMember(outsider, round, "equiv-out@fixture.test");

        JsonNode legacy = objectMapper.readTree(mvc.perform(get("/api/v1/thesis/groups")
                        .queryParam("roundId", round.toString()).with(dean))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString());
        ArrayNode concatenated = objectMapper.createArrayNode();
        long total = -1;
        for (int page = 0; page < 3; page++) {
            MvcResult result = page(round, dean, page, 2);
            total = Long.parseLong(result.getResponse().getHeader("X-Total-Count"));
            objectMapper.readTree(result.getResponse().getContentAsString())
                    .forEach(concatenated::add);
        }
        assertThat(total).isEqualTo(legacy.size());
        assertThat(concatenated).isEqualTo(legacy);
    }

    @Test
    void studentPagingKeepsNonCancelledBeforeCancelledThenCreationAndId() throws Exception {
        UUID round = round("Student paging");
        String student = ensureStudent("gpaging-student", "curriculum-demo");
        RequestPostProcessor actor = ThesisAuthorityFixture.student(jdbc, student);
        Instant base = Instant.parse("2030-04-01T00:00:00Z");
        UUID olderActive = group(round, null, student, base.plusSeconds(1), "SUBMITTED");
        UUID cancelledNewest = group(round, null, student, base.plusSeconds(4), "CANCELLED");
        UUID cancelledOlder = group(round, null, student, base.plusSeconds(3), "CANCELLED");
        group(round, null, "gpaging-other-leader", base.plusSeconds(5), "SUBMITTED");
        member(olderActive, round, student, 1, true);
        member(cancelledNewest, round, student, 1, false);
        member(cancelledOlder, round, student, 1, false);

        MvcResult first = page(round, actor, 0, 1);
        assertThat(first.getResponse().getHeader("X-Total-Count")).isEqualTo("3");
        assertThat(ids(first)).containsExactly(olderActive.toString());
        MvcResult second = page(round, actor, 1, 1);
        assertThat(ids(second)).containsExactly(cancelledNewest.toString());
        MvcResult third = page(round, actor, 2, 1);
        assertThat(ids(third)).containsExactly(cancelledOlder.toString());

        MvcResult legacy = mvc.perform(get("/api/v1/thesis/groups").queryParam("roundId", round.toString())
                        .with(actor)).andExpect(status().isOk()).andReturn();
        assertThat(ids(legacy)).containsExactly(
                olderActive.toString(), cancelledNewest.toString(), cancelledOlder.toString());
        assertThat(ids(legacy)).isEqualTo(
                oracleIds(round, List.of("STUDENT"), student, null, null));
        assertThat(groupReads.list(round, List.of("STUDENT"), student, null, null))
                .isEqualTo(new ThesisGroupLegacyOracle(namedJdbc)
                        .list(round, List.of("STUDENT"), student, null, null));
    }

    @Test
    void lecturerPagingKeepsOnlySupervisedGroupsAndTheirContacts() throws Exception {
        UUID round = round("Lecturer paging");
        String lecturer = "gpaging-lecturer";
        ensureLecturer(lecturer, DEPT);
        RequestPostProcessor actor = ThesisAuthorityFixture.lecturer(jdbc, lecturer);
        Instant base = Instant.parse("2030-05-01T00:00:00Z");
        UUID ownTopic = topic(round, DEPT, "Lecturer supervised");
        supervise(ownTopic, lecturer);
        UUID own1 = group(round, ownTopic, "gpaging-lecturer-leader", base.plusSeconds(1), "SUBMITTED");
        UUID own2 = group(round, ownTopic, "gpaging-lecturer-leader", base.plusSeconds(2), "SUBMITTED");
        UUID own3 = group(round, ownTopic, "gpaging-lecturer-leader", base.plusSeconds(3), "SUBMITTED");
        group(round, topic(round, DEPT, "Lecturer other"), "gpaging-lecturer-leader", base.plusSeconds(4), "SUBMITTED");
        externalMember(own1, round, "lecturer-contact@fixture.test");

        MvcResult first = page(round, actor, 0, 2);
        assertThat(first.getResponse().getHeader("X-Total-Count")).isEqualTo("3");
        assertThat(ids(first)).containsExactly(own3.toString(), own2.toString());
        MvcResult second = page(round, actor, 1, 2);
        assertThat(ids(second)).containsExactly(own1.toString());
        assertThat(ids(second)).isEqualTo(
                oracleIds(round, List.of("LECTURER"), null, lecturer, null).subList(2, 3));
        var serviceSecond = groupReads.listPage(round, List.of("LECTURER"), null,
                lecturer, null, ListPaging.Window.of(1, 2));
        assertThat(serviceSecond.items().get(0).members())
                .extracting(GroupMemberResponse::contact).contains("lecturer-contact@fixture.test");
    }

    @Test
    void departmentHeadPagingMergesDepartmentScopeWithSupervisedOutsiders() throws Exception {
        UUID round = round("Department paging");
        ensureSiblingAndForeignDepartments();
        String headUser = ensureLecturer("gpaging-head", SIBLING_DEPT);
        RequestPostProcessor head = ThesisAuthorityFixture.role(jdbc, headUser, "TRUONG_BO_MON");
        Instant base = Instant.parse("2030-06-01T00:00:00Z");
        UUID d1 = group(round, topic(round, SIBLING_DEPT, "Department one"), "gpaging-head-leader", base.plusSeconds(1), "SUBMITTED");
        UUID overlap = group(round, topic(round, SIBLING_DEPT, "Department overlap"), "gpaging-head-leader", base.plusSeconds(2), "SUBMITTED");
        UUID d2 = group(round, topic(round, SIBLING_DEPT, "Department two"), "gpaging-head-leader", base.plusSeconds(3), "SUBMITTED");
        UUID outsider = group(round, topic(round, FOREIGN_DEPT, "Department outsider"), "gpaging-head-leader", base.plusSeconds(4), "SUBMITTED");
        group(round, topic(round, FOREIGN_DEPT, "Department foreign"), "gpaging-head-leader", base.plusSeconds(5), "SUBMITTED");
        supervise(topicOf(overlap), "gpaging-head");
        supervise(topicOf(outsider), "gpaging-head");

        MvcResult first = page(round, head, 0, 3);
        assertThat(first.getResponse().getHeader("X-Total-Count")).isEqualTo("4");
        assertThat(ids(first)).containsExactly(d2.toString(), overlap.toString(), d1.toString());
        MvcResult second = page(round, head, 1, 3);
        assertThat(ids(second)).containsExactly(outsider.toString());
        assertThat(ids(first)).isEqualTo(
                oracleIds(round, List.of("TRUONG_BO_MON"), null, "gpaging-head", headUser).subList(0, 3));
        assertThat(ids(second)).isEqualTo(
                oracleIds(round, List.of("TRUONG_BO_MON"), null, "gpaging-head", headUser).subList(3, 4));
    }

    @Test
    void governanceProfilesFailClosedWhenInactiveOrNotBoundToTheSubject() throws Exception {
        UUID round = round("Governance profile paging");
        UUID group = group(round, topic(round, DEPT, "Governance profile group"),
                "gpaging-profile-leader", Instant.parse("2030-07-01T00:00:00Z"), "SUBMITTED");

        String inactiveUser = ensureLecturer("gpaging-inactive-dean", DEPT);
        jdbc.update("UPDATE campuscore_auth.\"Lecturer\" SET \"isActive\"=FALSE WHERE \"id\"='gpaging-inactive-dean'");
        mvc.perform(get("/api/v1/thesis/groups").queryParam("roundId", round.toString())
                        .with(ThesisAuthorityFixture.role(jdbc, inactiveUser, "TRUONG_KHOA")))
                .andExpect(status().isForbidden());

        // A token carrying another subject's lecturer profile must not borrow
        // that profile's faculty scope.
        String lecturerUser = ensureLecturer("gpaging-mismatch-lecturer", DEPT);
        ThesisAuthorityFixture.role(jdbc, "gpaging-mismatch-subject", "TRUONG_KHOA");
        // The live filter rejects a token that carries another profile's
        // lecturer claim, and the service itself fails closed to an empty
        // page even when that check is bypassed.
        RequestPostProcessor borrowed = jwt()
                .jwt(token -> token.subject("gpaging-mismatch-subject")
                        .claim("roles", List.of("TRUONG_KHOA"))
                        .claim("lecturerId", "gpaging-mismatch-lecturer"))
                .authorities(new SimpleGrantedAuthority("ROLE_TRUONG_KHOA"));
        mvc.perform(get("/api/v1/thesis/groups").queryParam("roundId", round.toString())
                        .queryParam("page", "0").queryParam("limit", "10").with(borrowed))
                .andExpect(status().isUnauthorized());

        ListPaging.Result<GroupResponse> direct = groupReads.listPage(
                round, List.of("TRUONG_KHOA"), null, "gpaging-mismatch-lecturer",
                "gpaging-mismatch-subject", ListPaging.Window.of(0, 10));
        assertThat(direct.total()).isZero();
        assertThat(direct.items()).isEmpty();
        assertThat(lecturerUser).isNotEqualTo("gpaging-mismatch-subject");
    }

    @Test
    void mineEndpointKeepsItsExistingInMemoryPaging() throws Exception {
        UUID roundOne = round("Mine one");
        UUID roundTwo = round("Mine two");
        String student = ensureStudent("gpaging-mine-student", "curriculum-demo");
        RequestPostProcessor actor = ThesisAuthorityFixture.student(jdbc, student);
        UUID older = group(roundOne, null, student, Instant.parse("2030-08-01T00:00:00Z"), "SUBMITTED");
        UUID newer = group(roundTwo, null, student, Instant.parse("2030-08-02T00:00:00Z"), "SUBMITTED");
        member(older, roundOne, student, 1, true);
        member(newer, roundTwo, student, 1, true);

        MvcResult page = mvc.perform(get("/api/v1/thesis/groups/mine")
                        .queryParam("page", "0").queryParam("limit", "1").with(actor))
                .andExpect(status().isOk()).andReturn();
        assertThat(page.getResponse().getHeader("X-Total-Count")).isEqualTo("2");
        assertThat(ids(page)).containsExactly(newer.toString());
        MvcResult legacy = mvc.perform(get("/api/v1/thesis/groups/mine").with(actor))
                .andExpect(status().isOk()).andReturn();
        assertThat(legacy.getResponse().getHeader("X-Total-Count")).isNull();
        assertThat(ids(legacy)).containsExactly(newer.toString(), older.toString());
    }

    @Test
    void pagingParameterEdgesAnswerBeforeAnyWindowIsApplied() throws Exception {
        UUID round = round("Parameter paging");
        group(round, null, "gpaging-param-leader", Instant.parse("2030-09-01T00:00:00Z"), "SUBMITTED");
        RequestPostProcessor admin = ThesisAuthorityFixture.role(jdbc, "gpaging-param-admin", "ADMIN");

        for (String[] query : new String[][]{
                {"page", "0"},
                {"limit", "0"},
                {"limit", "101"},
                {"page", "-1", "limit", "10"},
                {"page", "abc", "limit", "10"}}) {
            var request = get("/api/v1/thesis/groups").queryParam("roundId", round.toString()).with(admin);
            for (int i = 0; i < query.length; i += 2) {
                request.queryParam(query[i], query[i + 1]);
            }
            mvc.perform(request).andExpect(status().isBadRequest());
        }

        MvcResult limitOnly = mvc.perform(get("/api/v1/thesis/groups").queryParam("roundId", round.toString())
                        .queryParam("limit", "100").with(admin))
                .andExpect(status().isOk()).andReturn();
        assertThat(limitOnly.getResponse().getHeader("X-Total-Count")).isEqualTo("1");
        assertThat(ids(limitOnly)).hasSize(1);

        // W17 keeps the existing two-argument validator: repeated paging
        // parameters are not rejected (the first value wins).
        MvcResult repeated = mvc.perform(get("/api/v1/thesis/groups").queryParam("roundId", round.toString())
                        .queryParam("page", "0").queryParam("page", "1")
                        .queryParam("limit", "100").with(admin))
                .andExpect(status().isOk()).andReturn();
        assertThat(repeated.getResponse().getHeader("X-Total-Count")).isEqualTo("1");
        assertThat(ids(repeated)).hasSize(1);

        // A very large page is a long offset, not an int overflow: it must
        // answer [] with the exact total rather than fail or clamp.
        MvcResult overflow = mvc.perform(get("/api/v1/thesis/groups").queryParam("roundId", round.toString())
                        .queryParam("page", String.valueOf(Integer.MAX_VALUE))
                        .queryParam("limit", "100").with(admin))
                .andExpect(status().isOk()).andReturn();
        assertThat(overflow.getResponse().getHeader("X-Total-Count")).isEqualTo("1");
        assertThat(ids(overflow)).isEmpty();
    }

    // ---------- fixtures ----------

    private List<String> oracleIds(UUID round, List<String> roles, String studentId,
            String lecturerId, String subject) {
        return new ThesisGroupLegacyOracle(namedJdbc)
                .list(round, roles, studentId, lecturerId, subject).stream()
                .map(group -> group.id().toString())
                .toList();
    }

    private MvcResult page(UUID round, RequestPostProcessor actor, int page, int limit) throws Exception {
        return mvc.perform(get("/api/v1/thesis/groups").queryParam("roundId", round.toString())
                        .queryParam("page", String.valueOf(page))
                        .queryParam("limit", String.valueOf(limit))
                        .with(actor))
                .andExpect(status().isOk()).andReturn();
    }

    private List<String> ids(MvcResult result) throws Exception {
        JsonNode body = objectMapper.readTree(result.getResponse().getContentAsString());
        List<String> ids = new ArrayList<>();
        body.forEach(node -> ids.add(node.get("id").asText()));
        return ids;
    }

    private UUID round(String name) {
        UUID roundId = UUID.randomUUID();
        Instant now = Instant.now();
        jdbc.update("INSERT INTO thesis.thesis_registration_round "
                        + "(id, name, thesis_type, lecturer_submit_start, lecturer_submit_end, "
                        + "registration_start, registration_end, status) "
                        + "VALUES (?, ?, 'KLTN', ?, ?, ?, ?, 'REGISTRATION_OPEN')",
                roundId, name,
                Timestamp.from(now.minusSeconds(7_200)), Timestamp.from(now.minusSeconds(3_600)),
                Timestamp.from(now.minusSeconds(3_600)), Timestamp.from(now.plusSeconds(3_600)));
        return roundId;
    }

    private UUID topic(UUID round, String departmentId, String title) {
        UUID topicId = UUID.randomUUID();
        jdbc.update("INSERT INTO thesis.thesis_topic "
                        + "(id, round_id, department_id, title, description, max_groups, status, created_by) "
                        + "VALUES (?, ?, ?, ?, 'paging fixture topic', 20, 'PUBLISHED', ?)",
                topicId, round, departmentId, title, UUID.randomUUID());
        return topicId;
    }

    private UUID group(UUID round, UUID topicId, String leader, Instant createdAt, String status) {
        UUID groupId = UUID.randomUUID();
        jdbc.update("INSERT INTO thesis.thesis_group "
                        + "(id, round_id, leader_student_id, topic_id, status, approval_status, created_at) "
                        + "VALUES (?, ?, ?, ?, ?, 'PENDING', ?)",
                groupId, round, leader, topicId, status, Timestamp.from(createdAt));
        return groupId;
    }

    private UUID topicOf(UUID groupId) {
        return jdbc.queryForObject("SELECT topic_id FROM thesis.thesis_group WHERE id=?", UUID.class, groupId);
    }

    private void supervise(UUID topicId, String lecturerId) {
        jdbc.update("INSERT INTO thesis.thesis_topic_supervisor (id, topic_id, lecturer_id, supervisor_order) "
                + "VALUES (?, ?, ?, 1)", UUID.randomUUID(), topicId, lecturerId);
    }

    private void member(UUID groupId, UUID round, String studentId, int order, boolean active) {
        jdbc.update("INSERT INTO thesis.thesis_group_member "
                        + "(id, group_id, round_id, student_id, member_order, is_leader, active_participation) "
                        + "VALUES (?, ?, ?, ?, ?, TRUE, ?)",
                UUID.randomUUID(), groupId, round, studentId, order, active);
    }

    private void externalMember(UUID groupId, UUID round, String contact) {
        jdbc.update("INSERT INTO thesis.thesis_group_member "
                        + "(id, group_id, round_id, student_id, member_order, is_leader, display_name, contact, is_external) "
                        + "VALUES (?, ?, ?, ?, 2, FALSE, 'External Member', ?, TRUE)",
                UUID.randomUUID(), groupId, round, "gpaging-external-" + UUID.randomUUID(), contact);
    }

    private String ensureStudent(String studentId, String curriculumId) {
        ensureUser(studentId);
        jdbc.update("INSERT INTO campuscore_auth.\"Student\" "
                        + "(\"id\", \"userId\", \"studentId\", \"curriculumId\", \"year\", \"admissionDate\") "
                        + "VALUES (?, ?, ?, ?, 2, CURRENT_TIMESTAMP)",
                studentId, studentId, "GPAGING-" + Integer.toUnsignedString(studentId.hashCode(), 36), curriculumId);
        return studentId;
    }

    private String ensureLecturer(String lecturerId, String departmentId) {
        String userId = "gpaging-user-" + lecturerId;
        ensureUser(userId);
        jdbc.update("INSERT INTO campuscore_auth.\"Lecturer\" "
                        + "(\"id\", \"userId\", \"departmentId\", \"employeeId\", \"isActive\") "
                        + "VALUES (?, ?, ?, ?, TRUE)",
                lecturerId, userId, departmentId, "GPAGING-" + Integer.toUnsignedString(lecturerId.hashCode(), 36));
        return userId;
    }

    private void ensureUser(String userId) {
        jdbc.update("INSERT INTO campuscore_auth.\"User\" "
                        + "(\"id\", \"email\", \"password\", \"firstName\", \"lastName\", \"status\", "
                        + "\"emailVerified\", \"isSuperAdmin\", \"failedLoginAttempts\", \"createdAt\", \"updatedAt\") "
                        + "VALUES (?, ?, 'test-password', 'Paging', 'Fixture', 'ACTIVE', FALSE, FALSE, 0, "
                        + "CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)",
                userId, userId + "@fixture.test");
    }

    private void ensureSiblingAndForeignDepartments() {
        jdbc.update("INSERT INTO academic.\"Department\" (\"id\", \"name\", \"code\", \"facultyId\", \"isActive\") "
                + "VALUES (?, 'Paging sibling department', 'GPS', ?, TRUE)", SIBLING_DEPT, FACULTY);
        jdbc.update("INSERT INTO academic.\"Curriculum\" (\"id\", \"name\", \"departmentId\") "
                + "VALUES ('gpaging-curr-sibling', 'Paging sibling curriculum', ?)", SIBLING_DEPT);
        jdbc.update("INSERT INTO academic.\"Faculty\" (\"id\", \"name\", \"isActive\") "
                + "VALUES ('gpaging-faculty-foreign', 'Paging foreign faculty', TRUE)");
        jdbc.update("INSERT INTO academic.\"Department\" (\"id\", \"name\", \"code\", \"facultyId\", \"isActive\") "
                + "VALUES (?, 'Paging foreign department', 'GPF', 'gpaging-faculty-foreign', TRUE)", FOREIGN_DEPT);
        jdbc.update("INSERT INTO academic.\"Curriculum\" (\"id\", \"name\", \"departmentId\") "
                + "VALUES (?, 'Paging foreign curriculum', ?)", FOREIGN_CURRICULUM, FOREIGN_DEPT);
        jdbc.update("INSERT INTO academic.\"Curriculum\" (\"id\", \"name\", \"departmentId\") "
                + "SELECT 'curriculum-demo', 'Software Engineering', ? "
                + "WHERE NOT EXISTS (SELECT 1 FROM academic.\"Curriculum\" WHERE \"id\" = 'curriculum-demo')", DEPT);
    }
}
