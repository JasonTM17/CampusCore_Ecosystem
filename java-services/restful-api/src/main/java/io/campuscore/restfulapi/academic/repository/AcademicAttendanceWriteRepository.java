package io.campuscore.restfulapi.academic.repository;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Set;
import org.springframework.context.annotation.Profile;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.jdbc.core.namedparam.SqlParameterSource;
import org.springframework.stereotype.Repository;

/** JDBC repository for academic attendance writes and mutations. */
@Repository
@Profile("persistence")
public class AcademicAttendanceWriteRepository {
    private static final String ATTENDANCE = "\"academic\".\"Attendance\"";
    private static final String SECTION = "\"academic\".\"Section\"";
    private static final String ENROLLMENT = "\"academic\".\"Enrollment\"";

    private final NamedParameterJdbcTemplate jdbc;

    public AcademicAttendanceWriteRepository(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public boolean sectionExists(String sectionId) {
        Long count = jdbc.queryForObject(
                "SELECT COUNT(*) FROM " + SECTION + " WHERE \"id\" = :sectionId",
                new MapSqlParameterSource("sectionId", sectionId),
                Long.class);
        return count != null && count > 0;
    }

    /** Shared lock with student check-in; serialize manual replacement and automatic insert. */
    public void lockSectionForAttendance(String sectionId) {
        jdbc.queryForList("SELECT \"id\" FROM " + SECTION + " WHERE \"id\"=:id FOR UPDATE",
                new MapSqlParameterSource("id", sectionId), String.class);
    }

    /** Global lock order Student -> Section (shared with registration): target
     * students lock in stable id order before the section lock is taken. */
    public void lockStudentsForAttendance(List<String> studentIds) {
        if (studentIds == null || studentIds.isEmpty()) return;
        jdbc.queryForList("SELECT \"id\" FROM \"academic\".\"Student\" WHERE \"id\" IN (:ids) ORDER BY \"id\" FOR UPDATE",
                new MapSqlParameterSource("ids", studentIds), String.class);
    }

    public boolean attendanceExists(String sectionId, String studentId, Instant date) {
        Long count = jdbc.queryForObject("SELECT COUNT(*) FROM " + ATTENDANCE
                + " WHERE \"sectionId\"=:section AND \"studentId\"=:student AND \"date\"=:date",
                new MapSqlParameterSource("section", sectionId).addValue("student", studentId)
                        .addValue("date", utcTimestamp(date)), Long.class);
        return count != null && count > 0;
    }

    public void linkCheckin(String attendanceId, String checkinId) {
        jdbc.update("UPDATE " + ATTENDANCE + " SET \"checkinId\"=:checkin WHERE \"id\"=:id",
                new MapSqlParameterSource("id", attendanceId).addValue("checkin", checkinId));
    }

    public boolean isSectionOwnedByLecturer(String sectionId, String lecturerId) {
        Long count = jdbc.queryForObject(
                "SELECT COUNT(*) FROM " + SECTION + " WHERE \"id\" = :sectionId AND \"lecturerId\" = :lecturerId",
                new MapSqlParameterSource()
                        .addValue("sectionId", sectionId)
                        .addValue("lecturerId", lecturerId),
                Long.class);
        return count != null && count > 0;
    }

    public Set<String> findActiveEnrolledStudentIds(String sectionId) {
        List<String> ids = jdbc.queryForList(
                "SELECT \"studentId\" FROM " + ENROLLMENT
                        + " WHERE \"sectionId\" = :sectionId AND \"status\" NOT IN ('DROPPED', 'CANCELLED')",
                new MapSqlParameterSource("sectionId", sectionId),
                String.class);
        return Set.copyOf(ids);
    }

    public void deleteAttendanceRecords(String sectionId, Instant date, List<String> studentIds) {
        if (studentIds == null || studentIds.isEmpty()) {
            return;
        }
        jdbc.update(
                "DELETE FROM " + ATTENDANCE
                        + " WHERE \"sectionId\" = :sectionId AND \"date\" >= :dayStart AND \"date\" < :dayEnd"
                        + " AND \"studentId\" IN (:studentIds)",
                new MapSqlParameterSource()
                        .addValue("sectionId", sectionId)
                        .addValue("dayStart", utcTimestamp(date.truncatedTo(java.time.temporal.ChronoUnit.DAYS)))
                        .addValue("dayEnd", utcTimestamp(date.truncatedTo(java.time.temporal.ChronoUnit.DAYS).plusSeconds(86400)))
                        .addValue("studentIds", studentIds));
    }

    public void insertAttendanceBatch(List<AttendanceInsertRow> rows) {
        if (rows == null || rows.isEmpty()) {
            return;
        }
        SqlParameterSource[] batch = rows.stream().map(row -> new MapSqlParameterSource()
                .addValue("id", row.id())
                .addValue("studentId", row.studentId())
                .addValue("sectionId", row.sectionId())
                .addValue("date", utcTimestamp(row.date()))
                .addValue("status", row.status())
                .addValue("notes", row.notes())
                .addValue("createdAt", Timestamp.from(row.createdAt()))
                .addValue("updatedAt", Timestamp.from(row.updatedAt())))
                .toArray(SqlParameterSource[]::new);

        jdbc.batchUpdate(
                "INSERT INTO " + ATTENDANCE + " (\"id\", \"studentId\", \"sectionId\", \"date\", \"status\", \"notes\", \"createdAt\", \"updatedAt\")"
                        + " VALUES (:id, :studentId, :sectionId, :date, :status, :notes, :createdAt, :updatedAt)",
                batch);
    }

    public record AttendanceInsertRow(
            String id,
            String studentId,
            String sectionId,
            Instant date,
            String status,
            String notes,
            Instant createdAt,
            Instant updatedAt) {
    }

    private static java.time.OffsetDateTime utcTimestamp(Instant date) {
        // V8 uses TIMESTAMPTZ: retain the instant independently of JVM/DB zone.
        return date.atOffset(java.time.ZoneOffset.UTC);
    }
}
