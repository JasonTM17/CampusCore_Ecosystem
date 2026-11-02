package io.campuscore.restfulapi.thesis;

import io.campuscore.restfulapi.thesis.domain.ApprovalStatus;
import io.campuscore.restfulapi.thesis.domain.GroupStatus;
import io.campuscore.restfulapi.thesis.web.ThesisGroupReadDtos.GroupMemberResponse;
import io.campuscore.restfulapi.thesis.web.ThesisGroupReadDtos.GroupResponse;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.RowCallbackHandler;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;

/**
 * Frozen, test-only copy of the pre-W17 {@code ThesisGroupReadService} +
 * {@code ThesisGroupReadRepository} read path. It is deliberately independent
 * of production code so the paging change can be compared against the exact
 * legacy SQL, ordering and masking behaviour it replaces.
 *
 * <p>Do not improve this class. Any behavioural change here invalidates the
 * equivalence oracle.
 */
final class ThesisGroupLegacyOracle {

    private final NamedParameterJdbcTemplate jdbc;

    ThesisGroupLegacyOracle(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    List<GroupResponse> list(UUID roundId, List<String> roles, String studentId,
            String lecturerId, String subject) {
        if (isFacultyAdmin(roles)) {
            return findByRoundId(roundId);
        }
        if (roles.contains("TRUONG_KHOA") || roles.contains("TRUONG_BO_MON")) {
            LecturerScope scope = lecturerScope(roles, lecturerId, subject);
            if (scope == null) {
                return List.of();
            }
            List<GroupResponse> scoped = roles.contains("TRUONG_KHOA")
                    ? findByRoundIdAndFacultyId(roundId, scope.facultyId())
                    : findByRoundIdAndDepartmentId(roundId, scope.departmentId());
            List<GroupResponse> supervised = lecturerId == null || lecturerId.isBlank()
                    ? List.of()
                    : findByRoundIdAndSupervisorId(roundId, lecturerId);
            return mergeScopedWithSupervised(scoped, supervised, lecturerId);
        }
        if (roles.contains("LECTURER")) {
            return findByRoundIdAndSupervisorId(roundId, requireLecturerId(lecturerId));
        }
        return findByRoundIdAndStudentId(roundId, requireStudentId(roles, studentId));
    }

    List<GroupResponse> listMine(List<String> roles, String studentId, String lecturerId) {
        if (roles.contains("STUDENT")) {
            return findByStudentId(requireStudentId(roles, studentId));
        }
        if (roles.contains("LECTURER")) {
            return findBySupervisorId(requireLecturerId(lecturerId));
        }
        return List.of();
    }

    private List<GroupResponse> findByRoundId(UUID roundId) {
        List<GroupRow> rows = jdbc.query("SELECT id, round_id, leader_student_id, topic_id, status, approval_status, rejection_reason FROM thesis.thesis_group WHERE round_id = :roundId ORDER BY created_at DESC, id", new MapSqlParameterSource("roundId", roundId), ThesisGroupLegacyOracle::row);
        return hydrate(rows);
    }

    private List<GroupResponse> findByRoundIdAndStudentId(UUID roundId, String studentId) {
        List<GroupRow> rows = jdbc.query(
                "SELECT g.id, g.round_id, g.leader_student_id, g.topic_id, g.status, "
                        + "g.approval_status, g.rejection_reason FROM thesis.thesis_group g "
                        + "JOIN thesis.thesis_group_member m ON m.group_id = g.id "
                        + "WHERE g.round_id = :roundId AND m.student_id = :studentId "
                        + "ORDER BY CASE WHEN g.status = 'CANCELLED' THEN 1 ELSE 0 END, "
                        + "g.created_at DESC, g.id",
                new MapSqlParameterSource("roundId", roundId).addValue("studentId", studentId),
                ThesisGroupLegacyOracle::row);
        return hydrate(rows);
    }

    private List<GroupResponse> findByStudentId(String studentId) {
        List<GroupRow> rows = jdbc.query(
                "SELECT g.id, g.round_id, g.leader_student_id, g.topic_id, g.status, "
                        + "g.approval_status, g.rejection_reason FROM thesis.thesis_group g "
                        + "JOIN thesis.thesis_group_member m ON m.group_id = g.id "
                        + "WHERE m.student_id = :studentId "
                        + "ORDER BY CASE WHEN g.status = 'CANCELLED' THEN 1 ELSE 0 END, "
                        + "g.created_at DESC, g.id",
                new MapSqlParameterSource("studentId", studentId),
                ThesisGroupLegacyOracle::row);
        return hydrate(rows);
    }

    private List<GroupResponse> findBySupervisorId(String lecturerId) {
        List<GroupRow> rows = jdbc.query(
                "SELECT g.id, g.round_id, g.leader_student_id, g.topic_id, g.status, "
                        + "g.approval_status, g.rejection_reason FROM thesis.thesis_group g "
                        + "JOIN thesis.thesis_topic t ON t.id = g.topic_id "
                        + "WHERE EXISTS ("
                        + "  SELECT 1 FROM thesis.thesis_topic_supervisor ts "
                        + "  JOIN campuscore_auth.\"Lecturer\" l "
                        + "    ON (l.\"id\" = :lecturerId OR l.\"userId\" = :lecturerId) "
                        + "   AND l.\"isActive\" = TRUE "
                        + "   AND (ts.lecturer_id = l.\"id\" OR ts.lecturer_id = l.\"userId\") "
                        + "  WHERE ts.topic_id = t.id) "
                        + "ORDER BY g.created_at DESC, g.id",
                new MapSqlParameterSource("lecturerId", lecturerId),
                ThesisGroupLegacyOracle::row);
        return hydrate(rows);
    }

    private List<GroupResponse> findByRoundIdAndSupervisorId(UUID roundId, String lecturerId) {
        List<GroupRow> rows = jdbc.query(
                "SELECT g.id, g.round_id, g.leader_student_id, g.topic_id, g.status, "
                        + "g.approval_status, g.rejection_reason FROM thesis.thesis_group g "
                        + "JOIN thesis.thesis_topic t ON t.id = g.topic_id "
                        + "WHERE g.round_id = :roundId AND EXISTS ("
                        + "  SELECT 1 FROM thesis.thesis_topic_supervisor ts "
                        + "  JOIN campuscore_auth.\"Lecturer\" l "
                        + "    ON (l.\"id\" = :lecturerId OR l.\"userId\" = :lecturerId) "
                        + "   AND l.\"isActive\" = TRUE "
                        + "   AND (ts.lecturer_id = l.\"id\" OR ts.lecturer_id = l.\"userId\") "
                        + "  WHERE ts.topic_id = t.id) "
                        + "ORDER BY g.created_at DESC, g.id",
                new MapSqlParameterSource("roundId", roundId).addValue("lecturerId", lecturerId),
                ThesisGroupLegacyOracle::row);
        return hydrate(rows);
    }

    private record LecturerScope(String departmentId, String facultyId) { }

    private LecturerScope lecturerScope(List<String> roles, String lecturerId, String subject) {
        if (subject == null || subject.isBlank()) {
            return null;
        }
        String id = requireLecturerId(lecturerId);
        List<LecturerScope> rows = jdbc.query(
                "SELECT d.\"id\" AS department_id, f.\"id\" AS faculty_id "
                        + "FROM campuscore_auth.\"Lecturer\" l "
                        + "JOIN campuscore_auth.\"User\" u ON u.\"id\" = l.\"userId\" "
                        + "JOIN academic.\"Department\" d ON d.\"id\" = l.\"departmentId\" "
                        + "JOIN academic.\"Faculty\" f ON f.\"id\" = d.\"facultyId\" "
                        + "WHERE l.\"id\" = :lecturerId AND l.\"userId\" = :subject "
                        + "AND l.\"isActive\" = TRUE AND u.\"status\" = 'ACTIVE' AND d.\"isActive\" = TRUE "
                        + "AND f.\"isActive\" = TRUE",
                new MapSqlParameterSource("lecturerId", id).addValue("subject", subject),
                (rs, ignored) -> new LecturerScope(rs.getString("department_id"), rs.getString("faculty_id")));
        return rows.stream().findFirst().orElse(null);
    }

    private List<GroupResponse> findByRoundIdAndFacultyId(UUID roundId, String facultyId) {
        List<GroupRow> rows = jdbc.query(
                "SELECT g.id, g.round_id, g.leader_student_id, g.topic_id, g.status, "
                        + "g.approval_status, g.rejection_reason FROM thesis.thesis_group g "
                        + "LEFT JOIN thesis.thesis_topic t ON t.id = g.topic_id "
                        + "LEFT JOIN academic.\"Department\" dept ON dept.\"id\" = t.department_id "
                        + "WHERE g.round_id = :roundId AND ("
                        + "  dept.\"facultyId\" = :facultyId "
                        + "  OR (g.topic_id IS NULL AND EXISTS ("
                        + "    SELECT 1 FROM thesis.thesis_group_member m "
                        + "    JOIN campuscore_auth.\"Student\" s ON s.\"id\" = m.student_id "
                        + "    JOIN academic.\"Curriculum\" c ON c.\"id\" = s.\"curriculumId\" "
                        + "    JOIN academic.\"Department\" md ON md.\"id\" = c.\"departmentId\" "
                        + "    WHERE m.group_id = g.id AND md.\"facultyId\" = :facultyId)) "
                        + ") ORDER BY g.created_at DESC, g.id",
                new MapSqlParameterSource("roundId", roundId).addValue("facultyId", facultyId),
                ThesisGroupLegacyOracle::row);
        return hydrate(rows);
    }

    private List<GroupResponse> findByRoundIdAndDepartmentId(UUID roundId, String departmentId) {
        List<GroupRow> rows = jdbc.query(
                "SELECT g.id, g.round_id, g.leader_student_id, g.topic_id, g.status, "
                        + "g.approval_status, g.rejection_reason FROM thesis.thesis_group g "
                        + "LEFT JOIN thesis.thesis_topic t ON t.id = g.topic_id "
                        + "LEFT JOIN academic.\"Department\" dept ON dept.\"id\" = t.department_id "
                        + "WHERE g.round_id = :roundId AND ("
                        + "  dept.\"id\" = :departmentId "
                        + "  OR (g.topic_id IS NULL AND EXISTS ("
                        + "    SELECT 1 FROM thesis.thesis_group_member m "
                        + "    JOIN campuscore_auth.\"Student\" s ON s.\"id\" = m.student_id "
                        + "    JOIN academic.\"Curriculum\" c ON c.\"id\" = s.\"curriculumId\" "
                        + "    JOIN academic.\"Department\" md ON md.\"id\" = c.\"departmentId\" "
                        + "    WHERE m.group_id = g.id AND md.\"id\" = :departmentId)) "
                        + ") ORDER BY g.created_at DESC, g.id",
                new MapSqlParameterSource("roundId", roundId).addValue("departmentId", departmentId),
                ThesisGroupLegacyOracle::row);
        return hydrate(rows);
    }

    private boolean isTopicSupervisedBy(UUID topicId, String lecturerId) {
        Integer count = jdbc.queryForObject(
                "SELECT COUNT(*) FROM thesis.thesis_topic_supervisor ts "
                        + "JOIN campuscore_auth.\"Lecturer\" l "
                        + "  ON (l.\"id\" = :lecturerId OR l.\"userId\" = :lecturerId) "
                        + " AND l.\"isActive\" = TRUE "
                        + " AND (ts.lecturer_id = l.\"id\" OR ts.lecturer_id = l.\"userId\") "
                        + "WHERE ts.topic_id = :topicId",
                new MapSqlParameterSource("topicId", topicId).addValue("lecturerId", lecturerId),
                Integer.class);
        return count != null && count > 0;
    }

    private List<GroupResponse> mergeScopedWithSupervised(
            List<GroupResponse> scoped, List<GroupResponse> supervised, String lecturerId) {
        Map<UUID, GroupResponse> merged = new LinkedHashMap<>();
        for (GroupResponse group : scoped) {
            merged.put(group.id(), group);
        }
        for (GroupResponse group : supervised) {
            merged.putIfAbsent(group.id(), group);
        }
        return merged.values().stream()
                .map(group -> isSupervisedGroup(group, lecturerId) ? group : withoutContacts(group))
                .toList();
    }

    private boolean isSupervisedGroup(GroupResponse group, String lecturerId) {
        return group != null && lecturerId != null && !lecturerId.isBlank()
                && group.topicId() != null
                && isTopicSupervisedBy(group.topicId(), lecturerId);
    }

    private static GroupResponse withoutContacts(GroupResponse group) {
        return new GroupResponse(
                group.id(),
                group.roundId(),
                group.leaderStudentId(),
                group.topicId(),
                group.status(),
                group.approvalStatus(),
                group.rejectionReason(),
                group.memberStudentIds(),
                group.members().stream()
                        .map(m -> new GroupMemberResponse(
                                m.studentId(), m.studentNumber(), m.displayName(), null,
                                m.isExternal(), m.isLeader(), m.memberOrder()))
                        .toList());
    }

    private static String requireLecturerId(String lecturerId) {
        if (lecturerId == null || lecturerId.isBlank()) {
            throw new IllegalStateException("LECTURER_PROFILE_REQUIRED");
        }
        return lecturerId;
    }

    private static String requireStudentId(List<String> roles, String studentId) {
        if (!roles.contains("STUDENT")) {
            throw new IllegalStateException("ROLE_FORBIDDEN");
        }
        if (studentId == null || studentId.isBlank()) {
            throw new IllegalStateException("STUDENT_PROFILE_REQUIRED");
        }
        return studentId;
    }

    private static boolean isFacultyAdmin(List<String> roles) {
        return roles.contains("ADMIN") || roles.contains("SUPER_ADMIN");
    }

    private List<GroupResponse> hydrate(List<GroupRow> rows) {
        if (rows.isEmpty()) {
            return List.of();
        }
        Map<UUID, List<String>> members = new LinkedHashMap<>();
        Map<UUID, List<GroupMemberResponse>> memberDetails = new LinkedHashMap<>();
        for (GroupRow row : rows) {
            members.put(row.id(), new ArrayList<>());
            memberDetails.put(row.id(), new ArrayList<>());
        }
        jdbc.query("SELECT m.group_id, m.student_id, m.display_name, m.contact, m.is_external, m.is_leader, m.member_order, "
                + "s.\"studentId\" AS student_number, u.\"firstName\" AS first_name, u.\"lastName\" AS last_name, u.\"email\" AS email "
                + "FROM thesis.thesis_group_member m "
                + "LEFT JOIN campuscore_auth.\"Student\" s ON s.\"id\" = m.student_id "
                + "LEFT JOIN campuscore_auth.\"User\" u ON u.\"id\" = s.\"userId\" "
                + "WHERE m.group_id IN (:ids) "
                + "ORDER BY m.group_id, m.member_order", new MapSqlParameterSource("ids", members.keySet()), (RowCallbackHandler) rs -> {
            UUID groupId = rs.getObject("group_id", UUID.class);
            String studentId = rs.getString("student_id");
            boolean external = rs.getBoolean("is_external");
            String displayName = rs.getString("display_name");
            String contact = rs.getString("contact");
            String profileName = blankToNull(joinName(rs.getString("first_name"), rs.getString("last_name")));
            members.get(groupId).add(studentId);
            memberDetails.get(groupId).add(new GroupMemberResponse(
                    studentId,
                    external ? null : rs.getString("student_number"),
                    external ? displayName : profileName,
                    external ? contact : rs.getString("email"),
                    external,
                    rs.getBoolean("is_leader"),
                    rs.getInt("member_order")));
        });
        return rows.stream().map(row -> new GroupResponse(row.id(), row.roundId(), row.leaderStudentId(), row.topicId(), row.status(), row.approvalStatus(), row.rejectionReason(), List.copyOf(members.get(row.id())), List.copyOf(memberDetails.get(row.id())))).toList();
    }

    private static String joinName(String firstName, String lastName) {
        String first = firstName == null ? "" : firstName.trim();
        String last = lastName == null ? "" : lastName.trim();
        return (last + " " + first).trim();
    }

    private static String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value;
    }

    private static GroupRow row(ResultSet rs, int ignored) throws SQLException {
        return new GroupRow(rs.getObject("id", UUID.class), rs.getObject("round_id", UUID.class), rs.getString("leader_student_id"), rs.getObject("topic_id", UUID.class), GroupStatus.valueOf(rs.getString("status")), ApprovalStatus.valueOf(rs.getString("approval_status")), rs.getString("rejection_reason"));
    }

    private record GroupRow(UUID id, UUID roundId, String leaderStudentId, UUID topicId,
            GroupStatus status, ApprovalStatus approvalStatus, String rejectionReason) { }
}
