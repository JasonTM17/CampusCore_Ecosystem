package io.campuscore.restfulapi.security.matrix;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import io.campuscore.restfulapi.thesis.ThesisAuthorityFixture;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.RequestPostProcessor;

/**
 * Cross-group / cross-supervisor authorization matrix for thesis reports,
 * progress and review.
 *
 * <p>A student outside a group reads its report as 403 GROUP_MEMBER_REQUIRED
 * and cannot write its report or progress (403 GROUP_OWNER_REQUIRED). A
 * lecturer who is neither a supervisor, council member, assigned reviewer nor
 * in the topic's department gets the non-disclosing 404 REPORT_NOT_FOUND on the
 * report and 403 GROUP_REVIEWER_REQUIRED on review. Supervisors, members and
 * admins keep their lanes.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles({"test", "persistence"})
@TestPropertySource(properties = {
        "spring.datasource.url=jdbc:h2:mem:authz_thesis;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1",
        "spring.datasource.username=sa",
        "spring.datasource.password=",
        "spring.flyway.enabled=true",
        "spring.flyway.locations=classpath:db/migration-h2"
})
class ThesisReportAuthorizationMatrixTest {

    private static final String LEADER_A = "mx-thx-leader-a";
    private static final String LEADER_B = "mx-thx-leader-b";
    private static final String PEER_A1 = "mx-thx-peer-a1";
    private static final String PEER_A2 = "mx-thx-peer-a2";
    private static final String PEER_B1 = "mx-thx-peer-b1";
    private static final String PEER_B2 = "mx-thx-peer-b2";
    private static final String SUPERVISOR = "mx-thx-supervisor";
    private static final String OTHER_LECTURER = "mx-thx-other-lecturer";
    private static final String ADMIN = "mx-thx-admin";

    @Autowired
    private JdbcTemplate jdbc;

    @Autowired
    private MockMvc mvc;

    private UUID roundId;
    private UUID groupA;
    private UUID groupB;

    @BeforeEach
    void prepareThesisFixture() {
        cleanThesisTables();
        roundId = insertRound("Authz Matrix Round", "REGISTRATION_CLOSED");

        UUID topicA = insertPublishedTopic();
        UUID topicB = insertPublishedTopic();
        ThesisAuthorityFixture.lecturer(jdbc, SUPERVISOR);
        ThesisAuthorityFixture.lecturer(jdbc, OTHER_LECTURER);
        jdbc.update("UPDATE campuscore_auth.\"Lecturer\" SET \"departmentId\" = 'mx-thx-foreign-department'"
                + " WHERE \"id\" = ?", OTHER_LECTURER);
        jdbc.update("INSERT INTO thesis.thesis_topic_supervisor (id, topic_id, lecturer_id, supervisor_order)"
                        + " VALUES (?, ?, ?, 1)",
                UUID.randomUUID(), topicA, SUPERVISOR);

        groupA = insertGroup(topicA, LEADER_A, "APPROVED", PEER_A1, PEER_A2);
        groupB = insertGroup(topicB, LEADER_B, "PENDING", PEER_B1, PEER_B2);
        insertReport(groupA, LEADER_A, "Report A");
        insertReport(groupB, LEADER_B, "Report B");
    }

    @Test
    void student_reads_own_group_report() throws Exception {
        mvc.perform(get("/api/v1/thesis/groups/" + groupA + "/report").with(studentJwt(LEADER_A)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.groupId").value(groupA.toString()))
                .andExpect(jsonPath("$.title").value("Report A"));
    }

    @Test
    void supervisor_reads_assigned_group_report() throws Exception {
        mvc.perform(get("/api/v1/thesis/groups/" + groupA + "/report").with(lecturerJwt(SUPERVISOR)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.title").value("Report A"));
    }

    @Test
    void student_cannot_read_another_groups_report() throws Exception {
        mvc.perform(get("/api/v1/thesis/groups/" + groupA + "/report").with(studentJwt(LEADER_B)))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("GROUP_MEMBER_REQUIRED"));
    }

    @Test
    void student_cannot_modify_another_groups_report() throws Exception {
        mvc.perform(post("/api/v1/thesis/groups/" + groupA + "/report")
                        .with(studentJwt(LEADER_B))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"title\":\"Overwritten\",\"url\":\"https://evil.example/report\"}"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("GROUP_OWNER_REQUIRED"));

        org.assertj.core.api.Assertions.assertThat(reportTitle(groupA)).isEqualTo("Report A");
    }

    @Test
    void student_cannot_update_another_groups_milestones() throws Exception {
        mvc.perform(patch("/api/v1/thesis/groups/" + groupA + "/progress")
                        .with(studentJwt(LEADER_B))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"CANCELLED\"}"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("GROUP_OWNER_REQUIRED"));

        org.assertj.core.api.Assertions.assertThat(groupStatus(groupA)).isEqualTo("SUBMITTED");
    }

    @Test
    void lecturer_cannot_read_a_foreign_department_report() throws Exception {
        mvc.perform(get("/api/v1/thesis/groups/" + groupA + "/report").with(lecturerJwt(OTHER_LECTURER)))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("REPORT_NOT_FOUND"));
    }

    @Test
    void lecturer_cannot_review_a_group_they_do_not_supervise() throws Exception {
        mvc.perform(post("/api/v1/thesis/groups/" + groupB + "/approve").with(lecturerJwt(OTHER_LECTURER)))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("GROUP_REVIEWER_REQUIRED"));

        org.assertj.core.api.Assertions.assertThat(approvalStatus(groupB)).isEqualTo("PENDING");
    }

    @Test
    void student_cannot_review_a_group() throws Exception {
        mvc.perform(post("/api/v1/thesis/groups/" + groupB + "/approve").with(studentJwt(LEADER_B)))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("ACCESS_DENIED"));
    }

    @Test
    void admin_reads_and_reviews_any_group() throws Exception {
        mvc.perform(get("/api/v1/thesis/groups/" + groupA + "/report").with(adminJwt()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.title").value("Report A"));

        mvc.perform(post("/api/v1/thesis/groups/" + groupB + "/approve").with(adminJwt()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.approvalStatus").value("APPROVED"));

        org.assertj.core.api.Assertions.assertThat(approvalStatus(groupB)).isEqualTo("APPROVED");
    }

    private void cleanThesisTables() {
        jdbc.update("DELETE FROM thesis.thesis_group_report");
        jdbc.update("DELETE FROM thesis.thesis_group_member");
        jdbc.update("DELETE FROM thesis.thesis_group");
        jdbc.update("DELETE FROM thesis.thesis_topic_supervisor");
        jdbc.update("DELETE FROM thesis.thesis_topic");
        jdbc.update("DELETE FROM thesis.thesis_council_topic");
        jdbc.update("DELETE FROM thesis.thesis_council_member");
        jdbc.update("DELETE FROM thesis.thesis_council");
        jdbc.update("DELETE FROM thesis.thesis_registration_round");
        jdbc.update("DELETE FROM campuscore_auth.\"Student\" WHERE \"id\" LIKE 'mx-thx-%'");
        jdbc.update("DELETE FROM campuscore_auth.\"Lecturer\" WHERE \"id\" LIKE 'mx-thx-%'");
        jdbc.update("DELETE FROM campuscore_auth.\"User\" WHERE \"id\" LIKE 'mx-thx-%'"
                + " OR \"id\" LIKE 'thesis-fixture-lecturer-mx-thx-%'");
    }

    private UUID insertRound(String name, String status) {
        UUID id = UUID.randomUUID();
        Instant windowStart = Instant.now().minusSeconds(3_600);
        Instant windowEnd = Instant.now().plusSeconds(3_600);
        jdbc.update(
                "INSERT INTO thesis.thesis_registration_round "
                        + "(id, name, thesis_type, lecturer_submit_start, lecturer_submit_end, "
                        + "registration_start, registration_end, status) "
                        + "VALUES (?, ?, 'KLTN', ?, ?, ?, ?, ?)",
                id, name, Timestamp.from(windowStart.minusSeconds(7_200)),
                Timestamp.from(windowStart.minusSeconds(3_600)),
                Timestamp.from(windowStart), Timestamp.from(windowEnd), status);
        return id;
    }

    private UUID insertPublishedTopic() {
        UUID topicId = UUID.randomUUID();
        jdbc.update(
                "INSERT INTO thesis.thesis_topic (id, round_id, department_id, title, description, max_groups,"
                        + " status, created_by) VALUES (?, ?, 'department-demo', ?, 'matrix fixture', 1,"
                        + " 'PUBLISHED', ?)",
                topicId, roundId, "Matrix Topic " + topicId, UUID.randomUUID());
        return topicId;
    }

    private UUID insertGroup(UUID topicId, String leaderStudentId, String approvalStatus,
            String peerOne, String peerTwo) {
        UUID groupId = UUID.randomUUID();
        jdbc.update(
                "INSERT INTO thesis.thesis_group (id, round_id, leader_student_id, topic_id, status, approval_status)"
                        + " VALUES (?, ?, ?, ?, 'SUBMITTED', ?)",
                groupId, roundId, leaderStudentId, topicId, approvalStatus);
        insertMember(groupId, leaderStudentId, 1, true);
        insertMember(groupId, peerOne, 2, false);
        insertMember(groupId, peerTwo, 3, false);
        ThesisAuthorityFixture.student(jdbc, leaderStudentId);
        ThesisAuthorityFixture.student(jdbc, peerOne);
        ThesisAuthorityFixture.student(jdbc, peerTwo);
        return groupId;
    }

    private void insertMember(UUID groupId, String studentId, int order, boolean leader) {
        jdbc.update("INSERT INTO thesis.thesis_group_member"
                        + " (id, group_id, round_id, student_id, member_order, is_leader)"
                        + " VALUES (?, ?, ?, ?, ?, ?)",
                UUID.randomUUID(), groupId, roundId, studentId, order, leader);
    }

    private void insertReport(UUID groupId, String submittedBy, String title) {
        jdbc.update("INSERT INTO thesis.thesis_group_report"
                        + " (id, group_id, round_id, submitted_by, title, url, note)"
                        + " VALUES (?, ?, ?, ?, ?, ?, ?)",
                UUID.randomUUID(), groupId, roundId, submittedBy, title,
                "https://reports.example/" + groupId, "matrix fixture");
    }

    private String reportTitle(UUID groupId) {
        return jdbc.queryForObject(
                "SELECT title FROM thesis.thesis_group_report WHERE group_id = ?", String.class, groupId);
    }

    private String groupStatus(UUID groupId) {
        return jdbc.queryForObject(
                "SELECT status FROM thesis.thesis_group WHERE id = ?", String.class, groupId);
    }

    private String approvalStatus(UUID groupId) {
        return jdbc.queryForObject(
                "SELECT approval_status FROM thesis.thesis_group WHERE id = ?", String.class, groupId);
    }

    private RequestPostProcessor studentJwt(String studentId) {
        return ThesisAuthorityFixture.student(jdbc, studentId);
    }

    private RequestPostProcessor lecturerJwt(String lecturerId) {
        return ThesisAuthorityFixture.lecturer(jdbc, lecturerId);
    }

    private RequestPostProcessor adminJwt() {
        return ThesisAuthorityFixture.role(jdbc, ADMIN, "ADMIN");
    }
}
