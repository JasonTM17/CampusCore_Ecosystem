package io.campuscore.restfulapi.thesis;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import io.campuscore.restfulapi.thesis.service.ThesisReportService.RepositoryMemberResponse;
import io.campuscore.restfulapi.thesis.service.ThesisReportService.RepositoryReportResponse;
import io.campuscore.restfulapi.thesis.service.ThesisReportService.RepositorySupervisorResponse;
import java.nio.charset.StandardCharsets;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
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
import org.springframework.test.web.servlet.request.RequestPostProcessor;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * Q06 archive contract: the additive {@code page}/{@code limit} window must
 * keep the legacy bare-array body, the full nested {@code RepositoryReportResponse},
 * the legacy child ordering and the exact authorization matrix while counting
 * unique report roots rather than multiplied child rows.
 *
 * <p>The nested {@link LegacyArchiveOracle} is a test-only copy of the old
 * fan-out implementation. It is compared against the new split read so field
 * and child-order drift is caught independently of the production code.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles({"test", "persistence"})
@TestPropertySource(properties = {
        "spring.datasource.url=jdbc:h2:mem:restful_api_archive_contract;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1",
        "spring.datasource.username=sa",
        "spring.datasource.password=",
        "spring.flyway.enabled=true",
        "spring.flyway.locations=classpath:db/migration-h2",
        "thesis.report.storage.local-root=target/test-report-storage"
})
class ThesisArchivePagingContractTest {

    private static final byte[] REPORT_BYTES = "%PDF-1.7\narchive fixture\n%%EOF\n"
            .getBytes(StandardCharsets.US_ASCII);

    @Autowired
    private JdbcTemplate jdbc;

    @Autowired
    private MockMvc mvc;

    @Autowired
    private ObjectMapper mapper;

    private String tag;

    @BeforeEach
    void newFixtureTag() {
        tag = "arq" + UUID.randomUUID().toString().replace("-", "").substring(0, 10);
    }

    @Test
    void legacyArchiveKeepsResponseShapeChildrenAndHeaderAbsence() throws Exception {
        UUID round = insertRound();
        UUID topic = insertTopic(round, "department-demo", "Archive shape topic");
        UUID fullGroup = insertGroup(round, topic, "SUBMITTED", "APPROVED");
        insertStudent(tag + "-leader", "Archive", "Leader", "curriculum-demo");
        insertMember(fullGroup, round, tag + "-leader", 1, true);
        for (int order = 2; order <= 3; order++) {
            String studentId = tag + "-member-" + order;
            insertStudent(studentId, "Member", "Number" + order, "curriculum-demo");
            insertMember(fullGroup, round, studentId, order, false);
        }
        // The fourth member has no linked Student profile: the external display
        // name and null student number must survive the split read.
        jdbc.update("INSERT INTO thesis.thesis_group_member "
                        + "(id, group_id, round_id, student_id, member_order, is_leader, display_name, is_external) "
                        + "VALUES (?, ?, ?, ?, 4, FALSE, 'External Four', TRUE)",
                UUID.randomUUID(), fullGroup, round, tag + "-external-four");
        ensureLecturer(tag + "-sup-1", "department-demo", "Supervisor", "One");
        ensureLecturer(tag + "-sup-2", "department-demo", "Supervisor", "Two");
        insertSupervisor(topic, tag + "-sup-1", 1);
        insertSupervisor(topic, tag + "-sup-2", 2);
        Instant base = Instant.parse("2031-03-01T10:00:00Z");
        UUID fullReport = insertReport(round, fullGroup, base, "Full archive report", "full.pdf");

        UUID simpleGroup = insertGroup(round, topic, "SUBMITTED", "APPROVED");
        insertStudent(tag + "-leader-2", "Archive", "Second", "curriculum-demo");
        insertMember(simpleGroup, round, tag + "-leader-2", 1, true);
        UUID simpleReport = insertReport(round, simpleGroup, base.minusSeconds(60), "Simple report", "simple.pdf");

        // A topicless pending group with no roster and no supervisors exercises
        // the empty-children path (the old join produced one all-null child row).
        UUID emptyGroup = insertGroup(round, null, "PENDING", "PENDING");
        UUID emptyReport = insertReport(round, emptyGroup, base.minusSeconds(120), "Topicless report", null);

        var result = mvc.perform(get("/api/v1/thesis/rounds/{id}/repository", round).with(admin()))
                .andExpect(status().isOk())
                .andExpect(header().doesNotExist("X-Total-Count"))
                .andExpect(jsonPath("$.length()").value(3))
                .andReturn();

        List<RepositoryReportResponse> oracle = new LegacyArchiveOracle(jdbc).read(round);
        assertThat(readJson(result)).isEqualTo(mapper.readTree(mapper.writeValueAsString(oracle)));
        assertThat(oracle).extracting(RepositoryReportResponse::reportId)
                .containsExactly(fullReport, simpleReport, emptyReport);

        JsonNode full = readJson(result).get(0);
        assertThat(full.path("title").asText()).isEqualTo("Full archive report");
        assertThat(full.path("submittedBy").isMissingNode()).isTrue();
        assertThat(full.path("fileData").isMissingNode()).isTrue();
        assertThat(full.path("storageKey").isMissingNode()).isTrue();
        assertThat(full.path("members").size()).isEqualTo(4);
        assertThat(full.path("members").get(0).path("displayName").asText()).isEqualTo("Leader Archive");
        assertThat(full.path("members").get(0).path("studentNumber").asText()).isEqualTo("CODE-" + tag + "-leader");
        assertThat(full.path("members").get(0).path("isLeader").asBoolean()).isTrue();
        assertThat(full.path("members").get(3).path("displayName").asText()).isEqualTo("External Four");
        assertThat(full.path("members").get(3).path("studentNumber").isNull()).isTrue();
        assertThat(full.path("members").get(3).path("isExternal").asBoolean()).isTrue();
        assertThat(full.path("supervisors").size()).isEqualTo(2);
        assertThat(full.path("supervisors").get(0).path("displayName").asText()).isEqualTo("One Supervisor");
        assertThat(full.path("supervisors").get(0).path("supervisorOrder").asInt()).isEqualTo(1);
        assertThat(full.path("supervisors").get(1).path("displayName").asText()).isEqualTo("Two Supervisor");

        JsonNode empty = readJson(result).get(2);
        assertThat(empty.path("members")).isEmpty();
        assertThat(empty.path("supervisors")).isEmpty();
        assertThat(empty.path("topicTitle").isNull()).isTrue();
        assertThat(empty.path("departmentName").isNull()).isTrue();
    }

    @Test
    void pagesConcatenateWithoutSplittingRootsAndKeepTheUniqueReportTotal() throws Exception {
        UUID round = insertRound();
        UUID topic = insertTopic(round, "department-demo", "Paging topic");
        ensureLecturer(tag + "-sup-a", "department-demo", "Paging", "Supervisor A");
        ensureLecturer(tag + "-sup-b", "department-demo", "Paging", "Supervisor B");
        insertSupervisor(topic, tag + "-sup-a", 1);
        insertSupervisor(topic, tag + "-sup-b", 2);
        Instant base = Instant.parse("2031-04-01T10:00:00Z");
        List<UUID> reportIds = new ArrayList<>();
        for (int i = 0; i < 7; i++) {
            UUID group = insertGroup(round, topic, "SUBMITTED", "APPROVED");
            String leader = tag + "-page-" + i + "-leader";
            insertStudent(leader, "Page", "Leader " + i, "curriculum-demo");
            insertMember(group, round, leader, 1, true);
            for (int order = 2; order <= 4; order++) {
                String member = tag + "-page-" + i + "-member-" + order;
                insertStudent(member, "Page", "Member " + i + "-" + order, "curriculum-demo");
                insertMember(group, round, member, order, false);
            }
            reportIds.add(insertReport(round, group, base.minusSeconds(i * 60L), "Paged report " + i, "p" + i + ".pdf"));
        }

        List<UUID> legacy = reportIds(mvc.perform(get("/api/v1/thesis/rounds/{id}/repository", round).with(admin()))
                .andExpect(status().isOk())
                .andExpect(header().doesNotExist("X-Total-Count"))
                .andReturn());
        assertThat(legacy).containsExactlyElementsOf(reportIds);

        List<UUID> paged = new ArrayList<>();
        int[] expectedSizes = {2, 2, 2, 1};
        for (int page = 0; page < expectedSizes.length; page++) {
            MvcResult result = mvc.perform(get("/api/v1/thesis/rounds/{id}/repository", round)
                            .param("page", String.valueOf(page))
                            .param("limit", "2")
                            .with(admin()))
                    .andExpect(status().isOk())
                    .andExpect(header().string("X-Total-Count", "7"))
                    .andReturn();
            List<UUID> pageIds = reportIds(result);
            assertThat(pageIds).hasSize(expectedSizes[page]);
            paged.addAll(pageIds);
        }
        assertThat(paged).containsExactlyElementsOf(legacy);
        assertThat(paged).doesNotHaveDuplicates();

        List<UUID> limitOnly = reportIds(mvc.perform(get("/api/v1/thesis/rounds/{id}/repository", round)
                        .param("limit", "3").with(admin()))
                .andExpect(status().isOk())
                .andExpect(header().string("X-Total-Count", "7"))
                .andReturn());
        assertThat(limitOnly).containsExactlyElementsOf(legacy.subList(0, 3));

        List<UUID> outOfRange = reportIds(mvc.perform(get("/api/v1/thesis/rounds/{id}/repository", round)
                        .param("page", "99").param("limit", "2").with(admin()))
                .andExpect(status().isOk())
                .andExpect(header().string("X-Total-Count", "7"))
                .andReturn());
        assertThat(outOfRange).isEmpty();
    }

    @Test
    void equalTimestampsPageDeterministicallyByGroupId() throws Exception {
        UUID round = insertRound();
        UUID topic = insertTopic(round, "department-demo", "Tied topic");
        Instant tied = Instant.parse("2031-05-01T10:00:00Z");
        for (int i = 0; i < 5; i++) {
            UUID group = insertGroup(round, topic, "SUBMITTED", "APPROVED");
            String leader = tag + "-tie-" + i;
            insertStudent(leader, "Tie", "Leader " + i, "curriculum-demo");
            insertMember(group, round, leader, 1, true);
            insertReport(round, group, tied, "Tied report " + i, "t" + i + ".pdf");
        }
        List<UUID> expected = jdbc.query(
                "SELECT id FROM thesis.thesis_group_report WHERE round_id = ? "
                        + "ORDER BY submitted_at DESC, group_id ASC",
                (rs, row) -> rs.getObject("id", UUID.class), round);
        List<UUID> paged = new ArrayList<>();
        for (int page = 0; page <= 2; page++) {
            paged.addAll(reportIds(mvc.perform(get("/api/v1/thesis/rounds/{id}/repository", round)
                            .param("page", String.valueOf(page))
                            .param("limit", "2")
                            .with(admin()))
                    .andExpect(status().isOk())
                    .andExpect(header().string("X-Total-Count", "5"))
                    .andReturn()));
        }
        assertThat(paged).containsExactlyElementsOf(expected);
        assertThat(paged).doesNotHaveDuplicates();
    }

    @Test
    void emptyRoundStillAnswersArrayAndExactZeroTotal() throws Exception {
        UUID round = insertRound();
        mvc.perform(get("/api/v1/thesis/rounds/{id}/repository", round)
                        .param("page", "0").param("limit", "20").with(admin()))
                .andExpect(status().isOk())
                .andExpect(header().string("X-Total-Count", "0"))
                .andExpect(jsonPath("$.length()").value(0));
        mvc.perform(get("/api/v1/thesis/rounds/{id}/repository", round).with(admin()))
                .andExpect(status().isOk())
                .andExpect(header().doesNotExist("X-Total-Count"))
                .andExpect(jsonPath("$.length()").value(0));
    }

    @Test
    void archiveRoleMatrixAndActiveProfilesStayUnchanged() throws Exception {
        UUID round = insertRound();
        String demoFaculty = jdbc.queryForObject(
                "SELECT \"facultyId\" FROM academic.\"Department\" WHERE \"id\" = 'department-demo'", String.class);
        jdbc.update("INSERT INTO academic.\"Curriculum\" (\"id\", \"name\", \"departmentId\") "
                + "SELECT 'curriculum-demo', 'Software Engineering', 'department-demo' "
                + "WHERE NOT EXISTS (SELECT 1 FROM academic.\"Curriculum\" WHERE \"id\" = 'curriculum-demo')");
        String siblingDepartment = tag + "-dept-sibling";
        String foreignFaculty = tag + "-faculty-foreign";
        String foreignDepartment = tag + "-dept-foreign";
        jdbc.update("INSERT INTO academic.\"Department\" (\"id\", \"name\", \"code\", \"facultyId\", \"isActive\") "
                        + "VALUES (?, 'Sibling Department', 'SIB', ?, TRUE)",
                siblingDepartment, demoFaculty);
        jdbc.update("INSERT INTO academic.\"Curriculum\" (\"id\", \"name\", \"departmentId\") "
                        + "VALUES (?, 'Sibling Curriculum', ?)", tag + "-curr-sibling", siblingDepartment);
        jdbc.update("INSERT INTO academic.\"Faculty\" (\"id\", \"name\", \"isActive\") "
                        + "VALUES (?, 'Foreign Faculty', TRUE)", foreignFaculty);
        jdbc.update("INSERT INTO academic.\"Department\" (\"id\", \"name\", \"code\", \"facultyId\", \"isActive\") "
                        + "VALUES (?, 'Foreign Department', 'FRG', ?, TRUE)",
                foreignDepartment, foreignFaculty);
        jdbc.update("INSERT INTO academic.\"Curriculum\" (\"id\", \"name\", \"departmentId\") "
                        + "VALUES (?, 'Foreign Curriculum', ?)", tag + "-curr-foreign", foreignDepartment);

        String deanId = tag + "-dean";
        ensureLecturer(deanId, "department-demo", "Dean", "Scope");
        // A faculty head is also a lecturer: the existing archive filter applies
        // the explicit GVPB/supervisor/council exceptions only for that pairing.
        roleForLecturer(deanId, "TRUONG_KHOA");
        RequestPostProcessor dean = roleForLecturer(deanId, "LECTURER");
        String demoLecturerId = tag + "-lecturer";
        ensureLecturer(demoLecturerId, "department-demo", "Demo", "Lecturer");
        RequestPostProcessor demoLecturer = roleForLecturer(demoLecturerId, "LECTURER");
        String departmentHeadId = tag + "-department-head";
        ensureLecturer(departmentHeadId, "department-demo", "Department", "Head");
        RequestPostProcessor departmentHead = roleForLecturer(departmentHeadId, "TRUONG_BO_MON");

        Instant base = Instant.parse("2031-06-01T10:00:00Z");
        Map<String, UUID> visible = new LinkedHashMap<>();
        visible.put("demo-approved", reportFor(round, insertTopic(round, "department-demo", "Demo approved"),
                "SUBMITTED", "APPROVED", base, "approved"));
        visible.put("demo-pending", reportFor(round, insertTopic(round, "department-demo", "Demo pending"),
                "SUBMITTED", "PENDING", base.minusSeconds(10), "pending"));
        visible.put("demo-cancelled", reportFor(round, insertTopic(round, "department-demo", "Demo cancelled"),
                "CANCELLED", "APPROVED", base.minusSeconds(20), "cancelled"));
        UUID topiclessDemo = insertGroup(round, null, "SUBMITTED", "APPROVED");
        insertStudent(tag + "-topicless-demo", "Topicless", "Demo", "curriculum-demo");
        insertMember(topiclessDemo, round, tag + "-topicless-demo", 1, true);
        assertThat(jdbc.queryForObject(
                "SELECT \"departmentId\" FROM academic.\"Curriculum\" WHERE \"id\" = 'curriculum-demo'",
                String.class)).isEqualTo("department-demo");
        assertThat(jdbc.queryForObject(
                "SELECT COUNT(*) FROM thesis.thesis_group_member gm "
                        + "JOIN campuscore_auth.\"Student\" s ON s.\"id\" = gm.student_id "
                        + "JOIN academic.\"Curriculum\" c ON c.\"id\" = s.\"curriculumId\" "
                        + "JOIN academic.\"Department\" d ON d.\"id\" = c.\"departmentId\" "
                        + "WHERE gm.group_id = ? AND d.\"facultyId\" = ?",
                Integer.class, topiclessDemo, demoFaculty)).isEqualTo(1);
        visible.put("topicless-demo", insertReport(round, topiclessDemo, base.minusSeconds(30), "Topicless demo", null));
        visible.put("sibling", reportFor(round, insertTopic(round, siblingDepartment, "Sibling approved"),
                "SUBMITTED", "APPROVED", base.minusSeconds(40), "sibling"));
        UUID topiclessForeign = insertGroup(round, null, "SUBMITTED", "APPROVED");
        insertStudent(tag + "-topicless-foreign", "Topicless", "Foreign", tag + "-curr-foreign");
        insertMember(topiclessForeign, round, tag + "-topicless-foreign", 1, true);
        visible.put("topicless-foreign", insertReport(round, topiclessForeign, base.minusSeconds(50),
                "Topicless foreign", null));
        UUID foreignPlain = reportFor(round, insertTopic(round, foreignDepartment, "Foreign plain"),
                "SUBMITTED", "APPROVED", base.minusSeconds(60), "foreign-plain");

        UUID gvpbTopic = insertTopic(round, foreignDepartment, "Foreign GVPB");
        jdbc.update("UPDATE thesis.thesis_topic SET gvpb_lecturer_id = ? WHERE id = ?", deanId, gvpbTopic);
        visible.put("foreign-gvpb", reportFor(round, gvpbTopic, "SUBMITTED", "APPROVED",
                base.minusSeconds(70), "foreign-gvpb"));
        UUID supervisorTopic = insertTopic(round, foreignDepartment, "Foreign supervisor");
        insertSupervisor(supervisorTopic, deanId, 1);
        visible.put("foreign-supervisor", reportFor(round, supervisorTopic, "SUBMITTED", "APPROVED",
                base.minusSeconds(80), "foreign-supervisor"));
        UUID councilTopic = insertTopic(round, foreignDepartment, "Foreign council");
        UUID council = UUID.randomUUID();
        jdbc.update("INSERT INTO thesis.thesis_council (id, round_id, name, created_by) VALUES (?, ?, 'Scope council', ?)",
                council, round, deanId);
        jdbc.update("INSERT INTO thesis.thesis_council_member (id, council_id, lecturer_id, member_role) "
                + "VALUES (?, ?, ?, 'MEMBER')", UUID.randomUUID(), council, deanId);
        jdbc.update("INSERT INTO thesis.thesis_council_topic (id, council_id, topic_id, assigned_by) "
                + "VALUES (?, ?, ?, ?)", UUID.randomUUID(), council, councilTopic, deanId);
        visible.put("foreign-council", reportFor(round, councilTopic, "SUBMITTED", "APPROVED",
                base.minusSeconds(90), "foreign-council"));

        List<UUID> adminIds = reportIds(mvc.perform(get("/api/v1/thesis/rounds/{id}/repository", round).with(admin()))
                .andExpect(status().isOk()).andReturn());
        assertThat(adminIds).hasSize(10).containsAll(visible.values()).contains(foreignPlain);

        List<UUID> deanIds = reportIds(mvc.perform(get("/api/v1/thesis/rounds/{id}/repository", round).with(dean))
                .andExpect(status().isOk()).andReturn());
        assertThat(deanIds).contains(
                visible.get("demo-approved"), visible.get("demo-pending"), visible.get("demo-cancelled"),
                visible.get("topicless-demo"), visible.get("sibling"), visible.get("foreign-gvpb"),
                visible.get("foreign-supervisor"), visible.get("foreign-council"));
        assertThat(deanIds).hasSize(8);
        assertThat(deanIds).doesNotContain(foreignPlain, visible.get("topicless-foreign"));

        List<UUID> lecturerIds = reportIds(mvc.perform(get("/api/v1/thesis/rounds/{id}/repository", round)
                        .with(demoLecturer))
                .andExpect(status().isOk()).andReturn());
        assertThat(lecturerIds).containsExactly(visible.get("demo-approved"));
        List<UUID> headIds = reportIds(mvc.perform(get("/api/v1/thesis/rounds/{id}/repository", round)
                        .with(departmentHead))
                .andExpect(status().isOk()).andReturn());
        assertThat(headIds).containsExactly(visible.get("demo-approved"));

        // A profile that is no longer active fails closed even when the token
        // still carries the role claim.
        jdbc.update("UPDATE campuscore_auth.\"Lecturer\" SET \"isActive\" = FALSE WHERE \"id\" = ?", deanId);
        mvc.perform(get("/api/v1/thesis/rounds/{id}/repository", round).with(dean))
                .andExpect(status().is4xxClientError());
        jdbc.update("UPDATE campuscore_auth.\"Lecturer\" SET \"isActive\" = TRUE WHERE \"id\" = ?", deanId);
        jdbc.update("UPDATE campuscore_auth.\"Lecturer\" SET \"isActive\" = FALSE WHERE \"id\" = ?", demoLecturerId);
        mvc.perform(get("/api/v1/thesis/rounds/{id}/repository", round).with(demoLecturer))
                .andExpect(status().is4xxClientError());

        RequestPostProcessor bareDean = ThesisAuthorityFixture.role(jdbc, tag + "-bare-dean", "TRUONG_KHOA");
        mvc.perform(get("/api/v1/thesis/rounds/{id}/repository", round).with(bareDean))
                .andExpect(status().isForbidden());
    }

    @Test
    void opaqueReportDownloadAuthorizationIsUnchanged() throws Exception {
        UUID round = insertRound();
        UUID topic = insertTopic(round, "department-demo", "Download topic");
        UUID group = insertGroup(round, topic, "SUBMITTED", "APPROVED");
        insertStudent(tag + "-download-leader", "Download", "Leader", "curriculum-demo");
        insertMember(group, round, tag + "-download-leader", 1, true);
        UUID report = insertReport(round, group, Instant.now(), "Download report", "archive.pdf");
        jdbc.update("UPDATE thesis.thesis_group_report SET url = NULL, file_name = 'archive.pdf', "
                        + "file_type = 'application/pdf', file_size = ?, file_data = ?, storage_key = NULL "
                        + "WHERE id = ?",
                (long) REPORT_BYTES.length, REPORT_BYTES, report);

        ensureLecturer(tag + "-same-dept", "department-demo", "Same", "Department");
        ensureLecturer(tag + "-other-dept", "department-other", "Other", "Department");
        RequestPostProcessor sameDept = roleForLecturer(tag + "-same-dept", "LECTURER");
        RequestPostProcessor otherDept = roleForLecturer(tag + "-other-dept", "LECTURER");

        mvc.perform(get("/api/v1/thesis/groups/{id}/report/file", group).with(sameDept))
                .andExpect(status().isOk())
                .andExpect(content().bytes(REPORT_BYTES));
        mvc.perform(get("/api/v1/thesis/reports/{id}/file", report).with(sameDept))
                .andExpect(status().isOk())
                .andExpect(content().bytes(REPORT_BYTES));
        mvc.perform(get("/api/v1/thesis/groups/{id}/report/file", group).with(otherDept))
                .andExpect(status().isNotFound());
        mvc.perform(get("/api/v1/thesis/reports/{id}/file", report).with(otherDept))
                .andExpect(status().isNotFound());
        mvc.perform(get("/api/v1/thesis/groups/{id}/report/file", group).with(admin()))
                .andExpect(status().isOk())
                .andExpect(content().bytes(REPORT_BYTES));
    }

    @Test
    void pagingParameterEdgeCasesFollowTheSharedContract() throws Exception {
        UUID round = insertRound();
        UUID topic = insertTopic(round, "department-demo", "Edge topic");
        UUID group = insertGroup(round, topic, "SUBMITTED", "APPROVED");
        insertStudent(tag + "-edge-leader", "Edge", "Leader", "curriculum-demo");
        insertMember(group, round, tag + "-edge-leader", 1, true);
        insertReport(round, group, Instant.now(), "Edge report", "edge.pdf");

        for (String query : List.of("?page=0", "?limit=0", "?limit=101", "?page=-1&limit=5")) {
            mvc.perform(get("/api/v1/thesis/rounds/{id}/repository" + query, round).with(admin()))
                    .andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.code").value("INVALID_PAGING"));
        }
        mvc.perform(get("/api/v1/thesis/rounds/{id}/repository?page=x&limit=5", round).with(admin()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_REQUEST"));
        // Repeated paging parameters keep the existing two-argument validator
        // behaviour: the first value wins instead of a new duplicate rejection.
        mvc.perform(get("/api/v1/thesis/rounds/{id}/repository?page=0&page=1&limit=2", round).with(admin()))
                .andExpect(status().isOk())
                .andExpect(header().string("X-Total-Count", "1"))
                .andExpect(jsonPath("$.length()").value(1));
        mvc.perform(get("/api/v1/thesis/rounds/{id}/repository", round)
                        .param("page", "2147483647").param("limit", "100").with(admin()))
                .andExpect(status().isOk())
                .andExpect(header().string("X-Total-Count", "1"))
                .andExpect(jsonPath("$.length()").value(0));
        // W17 keeps the existing two-argument validator: repeated values are
        // not rejected, and the first value wins. Tightening this would be a
        // separate contract change.
        mvc.perform(get("/api/v1/thesis/rounds/{id}/repository", round)
                        .param("page", "1").param("page", "0")
                        .param("limit", "1").with(admin()))
                .andExpect(status().isOk())
                .andExpect(header().string("X-Total-Count", "1"))
                .andExpect(jsonPath("$.length()").value(0));
    }

    private JsonNode readJson(MvcResult result) throws Exception {
        return mapper.readTree(result.getResponse().getContentAsString());
    }

    private List<UUID> reportIds(MvcResult result) throws Exception {
        List<UUID> ids = new ArrayList<>();
        for (JsonNode node : readJson(result)) {
            ids.add(UUID.fromString(node.path("reportId").asText()));
        }
        return ids;
    }

    private UUID reportFor(UUID round, UUID topic, String status, String approval, Instant submittedAt, String slug) {
        UUID group = insertGroup(round, topic, status, approval);
        String leader = tag + "-" + slug + "-leader";
        insertStudent(leader, "Archive", "Leader " + slug, "curriculum-demo");
        insertMember(group, round, leader, 1, true);
        return insertReport(round, group, submittedAt, "Archive report " + slug, slug + ".pdf");
    }

    private UUID insertRound() {
        UUID round = UUID.randomUUID();
        Instant now = Instant.now();
        jdbc.update("INSERT INTO thesis.thesis_registration_round "
                        + "(id, name, thesis_type, lecturer_submit_start, lecturer_submit_end, "
                        + "registration_start, registration_end, gvpb_deadline, status) "
                        + "VALUES (?, ?, 'KLTN', ?, ?, ?, ?, ?, 'REGISTRATION_CLOSED')",
                round, "Archive contract round " + tag,
                Timestamp.from(now.minusSeconds(14_400)), Timestamp.from(now.minusSeconds(10_800)),
                Timestamp.from(now.minusSeconds(7_200)), Timestamp.from(now.plusSeconds(3_600)),
                Timestamp.from(now.plusSeconds(86_400)));
        return round;
    }

    private UUID insertTopic(UUID round, String department, String title) {
        UUID topic = UUID.randomUUID();
        jdbc.update("INSERT INTO thesis.thesis_topic "
                        + "(id, round_id, department_id, title, description, max_groups, status, created_by) "
                        + "VALUES (?, ?, ?, ?, 'archive contract fixture', 5, 'PUBLISHED', ?)",
                topic, round, department, title, tag);
        return topic;
    }

    private UUID insertGroup(UUID round, UUID topic, String status, String approval) {
        UUID group = UUID.randomUUID();
        jdbc.update("INSERT INTO thesis.thesis_group "
                        + "(id, round_id, leader_student_id, topic_id, status, approval_status) "
                        + "VALUES (?, ?, ?, ?, ?, ?)",
                group, round, tag + "-leader-" + group, topic, status, approval);
        return group;
    }

    private void insertMember(UUID group, UUID round, String studentId, int order, boolean leader) {
        jdbc.update("INSERT INTO thesis.thesis_group_member "
                        + "(id, group_id, round_id, student_id, member_order, is_leader) "
                        + "VALUES (?, ?, ?, ?, ?, ?)",
                UUID.randomUUID(), group, round, studentId, order, leader);
    }

    private void insertSupervisor(UUID topic, String lecturerId, int order) {
        jdbc.update("INSERT INTO thesis.thesis_topic_supervisor "
                        + "(id, topic_id, lecturer_id, supervisor_order) VALUES (?, ?, ?, ?)",
                UUID.randomUUID(), topic, lecturerId, order);
    }

    private UUID insertReport(UUID round, UUID group, Instant submittedAt, String title, String fileName) {
        UUID report = UUID.randomUUID();
        // ck_report_artifact requires a link or stored bytes, so the row always
        // has a URL even when it carries no attached file name.
        String url = "https://drive.example.com/report-" + report;
        jdbc.update("INSERT INTO thesis.thesis_group_report "
                        + "(id, group_id, round_id, submitted_by, title, url, submitted_at, file_name, file_type, file_size) "
                        + "VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'application/pdf', 4)",
                report, group, round, tag + "-submitter", title, url,
                Timestamp.from(submittedAt), fileName);
        return report;
    }

    private void insertStudent(String studentId, String first, String last, String curriculumId) {
        String userId = "user-" + studentId;
        jdbc.update("INSERT INTO campuscore_auth.\"User\" "
                        + "(\"id\", \"email\", \"password\", \"firstName\", \"lastName\", \"status\", "
                        + "\"emailVerified\", \"isSuperAdmin\", \"failedLoginAttempts\", \"createdAt\", \"updatedAt\") "
                        + "VALUES (?, ?, 'test-password', ?, ?, 'ACTIVE', FALSE, FALSE, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)",
                userId, studentId + "@fixture.test", first, last);
        jdbc.update("INSERT INTO campuscore_auth.\"Student\" "
                        + "(\"id\", \"userId\", \"studentId\", \"curriculumId\", \"year\", \"admissionDate\") "
                        + "VALUES (?, ?, ?, ?, 2, CURRENT_TIMESTAMP)",
                studentId, userId, "CODE-" + studentId, curriculumId);
    }

    private void ensureLecturer(String lecturerId, String departmentId, String first, String last) {
        Integer existing = jdbc.queryForObject(
                "SELECT COUNT(*) FROM campuscore_auth.\"Lecturer\" WHERE \"id\" = ?", Integer.class, lecturerId);
        if (existing != null && existing > 0) {
            return;
        }
        String userId = "lecturer-user-" + lecturerId;
        jdbc.update("INSERT INTO campuscore_auth.\"User\" "
                        + "(\"id\", \"email\", \"password\", \"firstName\", \"lastName\", \"status\", "
                        + "\"emailVerified\", \"isSuperAdmin\", \"failedLoginAttempts\", \"createdAt\", \"updatedAt\") "
                        + "VALUES (?, ?, 'test-password', ?, ?, 'ACTIVE', FALSE, FALSE, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)",
                userId, lecturerId + "@fixture.test", first, last);
        jdbc.update("INSERT INTO campuscore_auth.\"Lecturer\" "
                        + "(\"id\", \"userId\", \"departmentId\", \"employeeId\", \"isActive\") "
                        + "VALUES (?, ?, ?, ?, TRUE)",
                lecturerId, userId, departmentId, "GV-" + lecturerId);
    }

    private RequestPostProcessor roleForLecturer(String lecturerId, String role) {
        String userId = jdbc.queryForObject(
                "SELECT \"userId\" FROM campuscore_auth.\"Lecturer\" WHERE \"id\" = ?", String.class, lecturerId);
        // A faculty head is a lecturer plus the subject-bound TRUONG_KHOA
        // authority; the archive assignment exceptions only apply to that
        // combined actor, exactly as in production tokens.
        ThesisAuthorityFixture.lecturer(jdbc, lecturerId);
        return ThesisAuthorityFixture.role(jdbc, userId, role);
    }

    private RequestPostProcessor admin() {
        return ThesisAuthorityFixture.role(jdbc, tag + "-admin", "ADMIN");
    }

    /**
     * Test-only freeze of the pre-Q06 fan-out implementation. Ordered roots,
     * member/supervisor maps and display-name fallbacks are copied verbatim so
     * the split read is judged against the old behaviour, not against itself.
     */
    private static final class LegacyArchiveOracle {

        private final JdbcTemplate jdbc;

        private LegacyArchiveOracle(JdbcTemplate jdbc) {
            this.jdbc = jdbc;
        }

        private List<RepositoryReportResponse> read(UUID roundId) {
            String sql = """
                    SELECT r.id AS report_id, r.title, r.url, r.note, r.submitted_at, r.updated_at,
                           r.file_name, r.file_type, r.file_size,
                           t.title AS topic_title, t.description AS topic_description,
                           COALESCE(d."name", t.department_id) AS department_name,
                           g.status AS group_status, g.approval_status,
                           gm.student_id, gm.display_name AS external_display_name,
                           gm.is_external, gm.is_leader, gm.member_order,
                           s."studentId" AS student_number,
                           member_user."firstName" AS member_first_name,
                           member_user."lastName" AS member_last_name,
                           sup.lecturer_id, sup.supervisor_order,
                           supervisor_user."firstName" AS supervisor_first_name,
                           supervisor_user."lastName" AS supervisor_last_name,
                           submitted_student."studentId" AS submitter_student_number,
                           submitter_user."firstName" AS submitter_first_name,
                           submitter_user."lastName" AS submitter_last_name
                    FROM thesis.thesis_group_report r
                     JOIN thesis.thesis_group g ON g.id = r.group_id
                     LEFT JOIN thesis.thesis_topic t ON t.id = g.topic_id
                     LEFT JOIN academic."Department" d ON d."id" = t.department_id
                    LEFT JOIN thesis.thesis_group_member gm ON gm.group_id = g.id
                    LEFT JOIN campuscore_auth."Student" s ON s."id" = gm.student_id
                    LEFT JOIN campuscore_auth."User" member_user ON member_user."id" = s."userId"
                    LEFT JOIN thesis.thesis_topic_supervisor sup ON sup.topic_id = t.id
                    LEFT JOIN campuscore_auth."Lecturer" supervisor_profile
                        ON supervisor_profile."id" = sup.lecturer_id
                    LEFT JOIN campuscore_auth."User" supervisor_user
                        ON supervisor_user."id" = supervisor_profile."userId"
                    LEFT JOIN campuscore_auth."Student" submitted_student
                        ON submitted_student."id" = r.submitted_by
                    LEFT JOIN campuscore_auth."User" submitter_user
                        ON submitter_user."id" = submitted_student."userId"
                    WHERE r.round_id = ?
                    ORDER BY r.submitted_at DESC, gm.member_order, sup.supervisor_order
                    """;
            Map<UUID, OracleBuilder> builders = new LinkedHashMap<>();
            jdbc.query(sql, rs -> {
                UUID reportId = UUID.fromString(rs.getString("report_id"));
                OracleBuilder builder = builders.get(reportId);
                if (builder == null) {
                    builder = new OracleBuilder(
                            reportId,
                            rs.getString("title"),
                            rs.getString("url"),
                            rs.getString("note"),
                            instantOf(rs.getObject("submitted_at")),
                            instantOf(rs.getObject("updated_at")),
                            rs.getString("file_name"),
                            rs.getString("file_type"),
                            (Long) rs.getObject("file_size"),
                            rs.getString("topic_title"),
                            rs.getString("topic_description"),
                            rs.getString("department_name"),
                            rs.getString("group_status"),
                            rs.getString("approval_status"),
                            displayName(rs.getString("submitter_first_name"), rs.getString("submitter_last_name")),
                            rs.getString("submitter_student_number"));
                    builders.put(reportId, builder);
                }
                String memberId = rs.getString("student_id");
                if (memberId != null) {
                    builder.members.putIfAbsent(memberId + ":" + rs.getInt("member_order"),
                            new RepositoryMemberResponse(
                                    displayName(rs.getString("member_first_name"),
                                            rs.getString("member_last_name"),
                                            rs.getString("external_display_name"),
                                            rs.getString("student_number")),
                                    rs.getString("student_number"),
                                    rs.getBoolean("is_external"),
                                    rs.getBoolean("is_leader")));
                }
                String supervisorId = rs.getString("lecturer_id");
                if (supervisorId != null) {
                    builder.supervisors.putIfAbsent(supervisorId,
                            new RepositorySupervisorResponse(
                                    displayName(rs.getString("supervisor_first_name"),
                                            rs.getString("supervisor_last_name")),
                                    rs.getInt("supervisor_order")));
                }
            }, roundId);
            return builders.values().stream().map(OracleBuilder::build).toList();
        }

        private static Instant instantOf(Object value) {
            if (value == null) return null;
            if (value instanceof Instant instant) return instant;
            if (value instanceof java.sql.Timestamp timestamp) return timestamp.toInstant();
            if (value instanceof java.time.OffsetDateTime offsetDateTime) return offsetDateTime.toInstant();
            return null;
        }

        private static String displayName(String firstName, String lastName) {
            return displayName(firstName, lastName, null, null);
        }

        private static String displayName(String firstName, String lastName, String fallback, String secondFallback) {
            String first = firstName == null ? "" : firstName.trim();
            String last = lastName == null ? "" : lastName.trim();
            String name = (last + " " + first).trim();
            if (!name.isBlank()) return name;
            if (fallback != null && !fallback.isBlank()) return fallback.trim();
            if (secondFallback != null && !secondFallback.isBlank()) return secondFallback.trim();
            return null;
        }

        private static final class OracleBuilder {
            private final UUID reportId;
            private final String title;
            private final String url;
            private final String note;
            private final Instant submittedAt;
            private final Instant updatedAt;
            private final String fileName;
            private final String fileType;
            private final Long fileSize;
            private final String topicTitle;
            private final String topicDescription;
            private final String departmentName;
            private final String groupStatus;
            private final String approvalStatus;
            private final String submittedByDisplayName;
            private final String submittedByStudentNumber;
            private final Map<String, RepositoryMemberResponse> members = new LinkedHashMap<>();
            private final Map<String, RepositorySupervisorResponse> supervisors = new LinkedHashMap<>();

            private OracleBuilder(UUID reportId, String title, String url, String note, Instant submittedAt,
                    Instant updatedAt, String fileName, String fileType, Long fileSize, String topicTitle,
                    String topicDescription, String departmentName, String groupStatus, String approvalStatus,
                    String submittedByDisplayName, String submittedByStudentNumber) {
                this.reportId = reportId;
                this.title = title;
                this.url = url;
                this.note = note;
                this.submittedAt = submittedAt;
                this.updatedAt = updatedAt;
                this.fileName = fileName;
                this.fileType = fileType;
                this.fileSize = fileSize;
                this.topicTitle = topicTitle;
                this.topicDescription = topicDescription;
                this.departmentName = departmentName;
                this.groupStatus = groupStatus;
                this.approvalStatus = approvalStatus;
                this.submittedByDisplayName = submittedByDisplayName;
                this.submittedByStudentNumber = submittedByStudentNumber;
            }

            private RepositoryReportResponse build() {
                return new RepositoryReportResponse(reportId, title, url, note, submittedAt, updatedAt, fileName,
                        fileType, fileSize, topicTitle, topicDescription, departmentName, groupStatus,
                        approvalStatus, submittedByDisplayName, submittedByStudentNumber,
                        List.copyOf(supervisors.values()), List.copyOf(members.values()));
            }
        }
    }
}
