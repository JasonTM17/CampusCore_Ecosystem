package io.campuscore.restfulapi.thesis.service;

import java.math.BigDecimal;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;

final class ThesisGvpbEvidenceValidator {

    private ThesisGvpbEvidenceValidator() { }

    static Optional<Evidence> findCanonicalScore(NamedParameterJdbcTemplate jdbc,
            UUID topicId, String assignedReviewerId) {
        if (assignedReviewerId == null || assignedReviewerId.isBlank()) {
            return Optional.empty();
        }
        List<Row> rows = jdbc.query(
                "SELECT id, council_id, lecturer_id, score FROM thesis.thesis_topic_score "
                        + "WHERE topic_id = :topicId AND component = 'GVPB'",
                new MapSqlParameterSource("topicId", topicId), ROW_MAPPER);
        if (rows.size() != 1) {
            return Optional.empty();
        }
        Row row = rows.getFirst();
        if (row.councilId() != null || !assignedReviewerId.equals(row.lecturerId()) || row.score() == null) {
            return Optional.empty();
        }
        return Optional.of(new Evidence(row.id(), row.score()));
    }

    private static final RowMapper<Row> ROW_MAPPER = ThesisGvpbEvidenceValidator::mapRow;

    private static Row mapRow(ResultSet resultSet, int rowNum) throws SQLException {
        return new Row(resultSet.getObject("id", UUID.class),
                resultSet.getObject("council_id", UUID.class),
                resultSet.getString("lecturer_id"), resultSet.getBigDecimal("score"));
    }

    record Evidence(UUID id, BigDecimal score) { }

    private record Row(UUID id, UUID councilId, String lecturerId, BigDecimal score) { }
}
