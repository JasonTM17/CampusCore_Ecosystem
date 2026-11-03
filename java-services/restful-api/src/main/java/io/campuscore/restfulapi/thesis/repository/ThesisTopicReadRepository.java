package io.campuscore.restfulapi.thesis.repository;

import io.campuscore.restfulapi.thesis.domain.TopicStatus;
import io.campuscore.restfulapi.thesis.web.ThesisTopicDtos.TopicResponse;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.springframework.context.annotation.Profile;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

/**
 * Focused JDBC projection for the paged thesis topic catalogue.
 *
 * <p>The paged read keeps the legacy Java title order without loading JPA
 * entities: one lightweight query covers every visible match, the service sorts
 * and slices that list, and only the selected page is hydrated into
 * {@link TopicResponse}. The legacy unpaged path in {@code ThesisTopicService}
 * remains on the JPA repository.
 *
 * <p>Catalogue search adds one column to the same lightweight projection
 * ({@code description}) and filters in Java, so the searchable set is exactly
 * the authorised one and no full row is hydrated before paging. The plain
 * paging path keeps the narrower {@code (id, title)} read.
 */
@Repository
@Profile("persistence")
public class ThesisTopicReadRepository {

    private final NamedParameterJdbcTemplate jdbc;

    public ThesisTopicReadRepository(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /**
     * Identity, title and (only for catalogue search) description of one visible
     * topic. The plain title scan leaves {@code description} null; the search
     * scan reads it so the catalogue predicate can run in Java over exactly the
     * visible set without hydrating full rows.
     */
    public record TopicRef(UUID id, String title, String description) {
    }

    /**
     * The caller scope resolved by {@code ThesisTopicService}; each variant
     * mirrors one branch of the legacy visibility filter exactly.
     */
    public record Visibility(Scope scope, String subject, String departmentId,
            String facultyId, List<String> ownerKeys, String lecturerId) {

        public enum Scope {
            ALL,
            OWNER,
            DEPARTMENT,
            FACULTY,
            NONE
        }

        public static Visibility all() {
            return new Visibility(Scope.ALL, null, null, null, List.of(), "");
        }

        public static Visibility owner(String subject) {
            return new Visibility(Scope.OWNER, subject, null, null, List.of(), "");
        }

        public static Visibility department(String departmentId) {
            return new Visibility(Scope.DEPARTMENT, null, departmentId, null, List.of(), "");
        }

        public static Visibility faculty(String facultyId, List<String> ownerKeys, String lecturerId) {
            return new Visibility(Scope.FACULTY, null, null, facultyId,
                    List.copyOf(ownerKeys), lecturerId == null ? "" : lecturerId);
        }

        public static Visibility none() {
            return new Visibility(Scope.NONE, null, null, null, List.of(), "");
        }
    }

    /**
     * Reads {@code (id, title)} for every topic the caller may see. The SQL
     * predicates are the same owner/department/faculty/supervisor rules the
     * legacy service applied in Java after loading the entities.
     */
    public List<TopicRef> findVisibleRefs(UUID roundId, List<TopicStatus> statuses,
            Visibility visibility) {
        return queryVisibleRefs(roundId, statuses, visibility, false);
    }

    /**
     * Same authorised set, plus {@code description} for the catalogue search
     * predicate. This is the only extra column the search path reads before
     * paging: it is a bounded-memory projection over visible rows, not a
     * full-row hydration. The plain paging path keeps the narrower read.
     */
    public List<TopicRef> findVisibleRefsWithDescription(UUID roundId, List<TopicStatus> statuses,
            Visibility visibility) {
        return queryVisibleRefs(roundId, statuses, visibility, true);
    }

    private List<TopicRef> queryVisibleRefs(UUID roundId, List<TopicStatus> statuses,
            Visibility visibility, boolean withDescription) {
        if (visibility.scope() == Visibility.Scope.NONE || statuses.isEmpty()) {
            return List.of();
        }
        MapSqlParameterSource params = new MapSqlParameterSource()
                .addValue("roundId", roundId)
                .addValue("statuses", statuses.stream().map(Enum::name).toList());
        StringBuilder sql = new StringBuilder("SELECT t.id, t.title")
                .append(withDescription ? ", t.description" : "")
                .append(" FROM thesis.thesis_topic t")
                .append(" WHERE t.round_id = :roundId AND t.status IN (:statuses)");
        switch (visibility.scope()) {
            case ALL -> {
                // Global admin: no additional predicate.
            }
            case OWNER -> {
                sql.append(" AND t.created_by = :subject");
                params.addValue("subject", visibility.subject());
            }
            case DEPARTMENT -> {
                sql.append(" AND t.department_id = :departmentId");
                params.addValue("departmentId", visibility.departmentId());
            }
            case FACULTY -> appendFacultyFilter(sql, params, visibility);
            case NONE -> {
                return List.of();
            }
        }
        return jdbc.query(sql.toString(), params,
                (row, index) -> new TopicRef(row.getObject("id", UUID.class), row.getString("title"),
                        withDescription ? row.getString("description") : null));
    }

    private static void appendFacultyFilter(StringBuilder sql, MapSqlParameterSource params,
            Visibility visibility) {
        List<String> clauses = new ArrayList<>();
        if (visibility.facultyId() != null) {
            clauses.add("t.department_id IN (SELECT d.\"id\" FROM academic.\"Department\" d"
                    + " WHERE d.\"facultyId\" = :facultyId)");
            params.addValue("facultyId", visibility.facultyId());
        }
        if (!visibility.ownerKeys().isEmpty()) {
            clauses.add("t.created_by IN (:ownerKeys)");
            params.addValue("ownerKeys", visibility.ownerKeys());
        }
        if (!visibility.lecturerId().isEmpty()) {
            clauses.add("EXISTS (SELECT 1 FROM thesis.thesis_topic_supervisor s"
                    + " WHERE s.topic_id = t.id AND s.lecturer_id = :lecturerId)");
            params.addValue("lecturerId", visibility.lecturerId());
        }
        sql.append(clauses.isEmpty() ? " AND 1 = 0" : " AND (" + String.join(" OR ", clauses) + ")");
    }

    /** Full topic rows for exactly the page ids; the caller restores page order. */
    public List<TopicResponse> findResponsesByIds(List<UUID> ids) {
        if (ids.isEmpty()) {
            return List.of();
        }
        return jdbc.query(
                "SELECT id, round_id, department_id, title, description,"
                        + " max_groups, status, created_by, final_score, result_status, result_reason, "
                        + "result_resolved_at, gvpb_lecturer_id"
                        + " FROM thesis.thesis_topic WHERE id IN (:ids)",
                new MapSqlParameterSource("ids", ids),
                (row, index) -> new TopicResponse(
                        row.getObject("id", UUID.class),
                        row.getObject("round_id", UUID.class),
                        row.getString("department_id"),
                        row.getString("title"),
                        row.getString("description"),
                        row.getInt("max_groups"),
                        TopicStatus.valueOf(row.getString("status")),
                        row.getString("created_by"),
                        row.getBigDecimal("final_score"),
                        row.getString("result_status"),
                        row.getString("result_reason"),
                        instantOf(row.getObject("result_resolved_at")),
                        row.getString("gvpb_lecturer_id")));
    }

    private static java.time.Instant instantOf(Object value) {
        if (value == null) return null;
        if (value instanceof java.time.Instant instant) return instant;
        if (value instanceof java.sql.Timestamp timestamp) return timestamp.toInstant();
        if (value instanceof java.time.OffsetDateTime offsetDateTime) return offsetDateTime.toInstant();
        return null;
    }
}
