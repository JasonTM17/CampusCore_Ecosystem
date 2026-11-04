package io.campuscore.restfulapi.learning;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import io.campuscore.restfulapi.learning.service.LearningService;
import io.campuscore.restfulapi.learning.service.LearningStudentService;
import io.campuscore.restfulapi.learning.web.LearningDtos.AssignmentResponse;
import io.campuscore.restfulapi.learning.web.LearningDtos.MaterialResponse;
import io.campuscore.restfulapi.learning.web.LearningDtos.RosterRowResponse;
import io.campuscore.restfulapi.web.DomainException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.jdbc.datasource.init.ScriptUtils;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;

/**
 * Golden old-vs-new equivalence for the W14 P3 learning read rewrite. The old
 * query text is kept here as the oracle only: every fixture is evaluated with
 * the pre-rewrite SQL and with the current service method, and both must
 * return the same rows. Fixtures cover retake histories (status priority,
 * latest {@code enrolledAt}, identical timestamps), draft assignments, empty
 * sections, null submissions, dropped seats and non-enrolled callers.
 */
@SpringBootTest
@ActiveProfiles({"test", "persistence"})
@TestPropertySource(properties = {
        "spring.flyway.enabled=false",
        "spring.datasource.url=jdbc:h2:mem:learning_read_equivalence;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1"
})
class LearningReadEquivalenceTest {

    private static final String OLD_MY_SECTIONS_SQL =
            "SELECT e.\"sectionId\" AS section_id, sec.\"sectionNumber\" AS section_number,"
                    + " c.\"code\" AS course_code, c.\"name\" AS course_name,"
                    + " e.\"status\" AS enrollment_status,"
                    + " (SELECT COUNT(*) FROM learning.\"Material\" m WHERE m.\"sectionId\" = e.\"sectionId\") AS material_count,"
                    + " (SELECT COUNT(*) FROM learning.\"Assignment\" a WHERE a.\"sectionId\" = e.\"sectionId\""
                    + "   AND a.\"status\" <> 'DRAFT') AS assignment_count"
                    + " FROM academic.\"Enrollment\" e"
                    + " JOIN academic.\"Section\" sec ON sec.\"id\" = e.\"sectionId\""
                    + " JOIN academic.\"Course\" c ON c.\"id\" = sec.\"courseId\""
                    + " WHERE e.\"studentId\" = :studentId"
                    + " AND e.\"status\" NOT IN ('DROPPED','CANCELLED')"
                    + " AND e.\"id\" = (SELECT e2.\"id\" FROM academic.\"Enrollment\" e2"
                    + "   WHERE e2.\"studentId\" = e.\"studentId\" AND e2.\"sectionId\" = e.\"sectionId\""
                    + "   AND e2.\"status\" NOT IN ('DROPPED','CANCELLED')"
                    + "   ORDER BY CASE e2.\"status\" WHEN 'ENROLLED' THEN 0 WHEN 'CONFIRMED' THEN 1"
                    + "     WHEN 'PENDING' THEN 2 ELSE 3 END, e2.\"enrolledAt\" DESC"
                    + "   LIMIT 1)"
                    + " ORDER BY c.\"code\", sec.\"sectionNumber\"";

    private static final String OLD_ROSTER_SQL =
            "SELECT e.\"id\" AS enrollment_id, e.\"studentId\" AS student_id,"
                    + " student_user.\"lastName\" || ' ' || student_user.\"firstName\" AS student_name,"
                    + " student_user.\"email\" AS student_email, e.\"status\" AS enrollment_status,"
                    + " s.\"id\" AS submission_id, s.\"status\" AS submission_status,"
                    + " s.\"submittedAt\" AS submitted_at"
                    + " FROM academic.\"Enrollment\" e"
                    + " JOIN academic.\"Student\" student ON student.\"id\" = e.\"studentId\""
                    + " JOIN campuscore_auth.\"User\" student_user ON student_user.\"id\" = student.\"userId\""
                    + " LEFT JOIN learning.\"Submission\" s ON s.\"assignmentId\" = :assignmentId"
                    + " AND s.\"studentId\" = e.\"studentId\""
                    + " WHERE e.\"sectionId\" = :sectionId"
                    + " AND e.\"status\" IN ('ENROLLED','PENDING','CONFIRMED','COMPLETED')"
                    + " AND e.\"id\" = (SELECT e2.\"id\" FROM academic.\"Enrollment\" e2"
                    + "   WHERE e2.\"studentId\" = e.\"studentId\" AND e2.\"sectionId\" = e.\"sectionId\""
                    + "   AND e2.\"status\" IN ('ENROLLED','PENDING','CONFIRMED','COMPLETED')"
                    + "   ORDER BY CASE e2.\"status\" WHEN 'ENROLLED' THEN 0 WHEN 'CONFIRMED' THEN 1"
                    + "     WHEN 'PENDING' THEN 2 ELSE 3 END, e2.\"enrolledAt\" DESC"
                    + "   LIMIT 1)"
                    + " ORDER BY student_user.\"lastName\", student_user.\"firstName\"";

    private static final String OLD_MATERIALS_SQL =
            "SELECT * FROM learning.\"Material\" WHERE \"sectionId\" = :sectionId"
                    + " ORDER BY \"createdAt\" DESC, \"id\"";

    private static final Instant T0 = Instant.parse("2026-01-01T00:00:00Z");
    private static final Instant T1 = Instant.parse("2026-02-01T00:00:00Z");
    private static final Instant T2 = Instant.parse("2026-03-01T00:00:00Z");
    private static final Instant T3 = Instant.parse("2026-04-01T00:00:00Z");
    private static final Instant T4 = Instant.parse("2026-05-01T00:00:00Z");

    @Autowired
    private JdbcTemplate jdbc;

    @Autowired
    private LearningService staff;

    @Autowired
    private LearningStudentService students;

    private NamedParameterJdbcTemplate named;

    @BeforeEach
    void fixture() throws Exception {
        named = new NamedParameterJdbcTemplate(jdbc);
        jdbc.execute("DROP SCHEMA IF EXISTS campuscore_auth CASCADE");
        jdbc.execute("CREATE SCHEMA campuscore_auth");
        jdbc.execute("DROP SCHEMA IF EXISTS learning CASCADE");
        jdbc.execute("DROP SCHEMA IF EXISTS academic CASCADE");
        jdbc.execute("CREATE SCHEMA IF NOT EXISTS learning");
        jdbc.execute("CREATE SCHEMA IF NOT EXISTS academic");
        jdbc.execute("""
                CREATE TABLE IF NOT EXISTS campuscore_auth."User" (
                    "id" VARCHAR(120) PRIMARY KEY, "email" VARCHAR(320) NOT NULL,
                    "firstName" VARCHAR(120) NOT NULL, "lastName" VARCHAR(120) NOT NULL,
                    "status" VARCHAR(40) NOT NULL DEFAULT 'ACTIVE')""");
        jdbc.execute("""
                CREATE TABLE academic."Course" (
                    "id" VARCHAR(120) PRIMARY KEY, "code" VARCHAR(60) NOT NULL,
                    "name" VARCHAR(240) NOT NULL)""");
        jdbc.execute("""
                CREATE TABLE academic."Section" (
                    "id" VARCHAR(120) PRIMARY KEY, "sectionNumber" VARCHAR(80) NOT NULL,
                    "courseId" VARCHAR(120) NOT NULL, "semesterId" VARCHAR(120) NOT NULL,
                    "lecturerId" VARCHAR(120), "capacity" INTEGER NOT NULL,
                    "status" VARCHAR(40) NOT NULL)""");
        jdbc.execute("""
                CREATE TABLE academic."Student" (
                    "id" VARCHAR(120) PRIMARY KEY, "userId" VARCHAR(120) NOT NULL UNIQUE,
                    "studentId" VARCHAR(120) NOT NULL, "status" VARCHAR(40) NOT NULL DEFAULT 'ACTIVE')""");
        jdbc.execute("""
                CREATE TABLE academic."Enrollment" (
                    "id" VARCHAR(120) PRIMARY KEY, "studentId" VARCHAR(120) NOT NULL,
                    "sectionId" VARCHAR(120) NOT NULL, "semesterId" VARCHAR(120) NOT NULL,
                    "status" VARCHAR(40) NOT NULL, "enrolledAt" TIMESTAMP WITH TIME ZONE)""");
        try (java.sql.Connection connection = jdbc.getDataSource().getConnection()) {
            ScriptUtils.executeSqlScript(connection,
                    new ClassPathResource("db/migration-h2/V139__learning_schema.sql"));
        }

        jdbc.update("INSERT INTO academic.\"Course\" VALUES ('course-oop','OOP101','Lap trinh OOP')");
        jdbc.update("INSERT INTO academic.\"Course\" VALUES ('course-db','DB201','Co so du lieu')");
        jdbc.update("INSERT INTO academic.\"Section\" VALUES"
                + " ('sec-a','01','course-oop','sem-1','lec-1',40,'OPEN')");
        jdbc.update("INSERT INTO academic.\"Section\" VALUES"
                + " ('sec-b','02','course-db','sem-1','lec-2',40,'OPEN')");
        jdbc.update("INSERT INTO academic.\"Section\" VALUES"
                + " ('sec-empty','03','course-db','sem-1','lec-2',40,'OPEN')");

        student("stu-1", "student-1", "SR001", "An");
        student("stu-2", "student-2", "SR002", "Binh");
        student("stu-3", "student-3", "SR003", "Chi");
        student("stu-4", "student-4", "SR004", "Dung");
        student("stu-5", "student-5", "SR005", "Em");
        student("stu-6", "student-6", "SR006", "Phong");
        student("stu-outside", "student-outside", "SR007", "Guest");

        // stu-1: an active seat plus a later historical retake — ENROLLED wins
        // on status priority even though the retake is newer.
        enrollment("enr-1a", "stu-1", "sec-a", "ENROLLED", T1);
        enrollment("enr-1b", "stu-1", "sec-a", "COMPLETED", T2);
        enrollment("enr-1c", "stu-1", "sec-b", "COMPLETED", T0);
        // stu-2: CONFIRMED beats the newer COMPLETED retake.
        enrollment("enr-2a", "stu-2", "sec-a", "CONFIRMED", T1);
        enrollment("enr-2b", "stu-2", "sec-a", "COMPLETED", T3);
        // stu-3: two COMPLETED seats, the latest enrolledAt wins; sec-empty has
        // no materials or assignments.
        enrollment("enr-3a", "stu-3", "sec-a", "COMPLETED", T1);
        enrollment("enr-3b", "stu-3", "sec-a", "COMPLETED", T2);
        enrollment("enr-3c", "stu-3", "sec-empty", "ENROLLED", T1);
        // stu-4: identical timestamps — the legacy tie rule is under-defined.
        enrollment("enr-4a", "stu-4", "sec-a", "COMPLETED", T2);
        enrollment("enr-4b", "stu-4", "sec-a", "COMPLETED", T2);
        // stu-5: roster-visible PENDING seat with no submission.
        enrollment("enr-5a", "stu-5", "sec-a", "PENDING", T1);
        // stu-6: dropped seats never surface.
        enrollment("enr-6a", "stu-6", "sec-a", "DROPPED", T4);

        material("mat-old", "sec-a", "Tuan 1", T1, 10L, "checksum-old");
        material("mat-new", "sec-a", "Tuan 2", T2, 20L, "checksum-new");
        material("mat-empty", "sec-empty", "Khong thuoc sec-a", T3, 30L, "checksum-empty");

        assignment("asg-pub", "sec-a", "Published", "PUBLISHED", T4);
        assignment("asg-draft", "sec-a", "Draft", "DRAFT", null);
        assignment("asg-closed", "sec-a", "Closed", "CLOSED", null);
        assignment("asg-b", "sec-b", "Other section", "PUBLISHED", T4);

        jdbc.update("INSERT INTO learning.\"Submission\""
                        + " (\"id\", \"assignmentId\", \"studentId\", \"status\", \"submittedAt\")"
                        + " VALUES ('sub-1','asg-pub','stu-1','SUBMITTED',?)",
                Timestamp.from(T3));
    }

    @Test
    void mySectionsMatchesLegacyCountsForRetakesAndZeroCountSections() {
        for (String studentId : List.of("stu-1", "stu-2", "stu-3", "stu-4", "stu-6", "stu-outside")) {
            List<Map<String, Object>> legacy = named.query(OLD_MY_SECTIONS_SQL,
                    new MapSqlParameterSource("studentId", studentId),
                    (row, n) -> Map.of(
                            "sectionId", row.getString("section_id"),
                            "sectionNumber", row.getString("section_number"),
                            "courseCode", row.getString("course_code"),
                            "courseName", row.getString("course_name"),
                            "enrollmentStatus", row.getString("enrollment_status"),
                            "materialCount", row.getLong("material_count"),
                            "assignmentCount", row.getLong("assignment_count")));
            assertThat(students.mySections(studentId))
                    .as("mySections shipped result for %s", studentId)
                    .isEqualTo(legacy);
        }

        List<Map<String, Object>> stu1 = students.mySections("stu-1");
        assertThat(stu1).extracting(row -> row.get("sectionId")).containsExactly("sec-b", "sec-a");
        assertThat(stu1).extracting(row -> row.get("enrollmentStatus"))
                .containsExactly("COMPLETED", "ENROLLED");
        assertThat(stu1).extracting(row -> row.get("materialCount")).containsExactly(0L, 2L);
        assertThat(stu1).extracting(row -> row.get("assignmentCount")).containsExactly(1L, 2L);

        List<Map<String, Object>> stu3 = students.mySections("stu-3");
        assertThat(stu3).extracting(row -> row.get("sectionId")).containsExactly("sec-empty", "sec-a");
        assertThat(stu3).extracting(row -> row.get("materialCount")).containsExactly(1L, 2L);
        assertThat(stu3).extracting(row -> row.get("assignmentCount")).containsExactly(0L, 2L);

        assertThat(students.mySections("stu-6")).isEmpty();
        assertThat(students.mySections("stu-outside")).isEmpty();
    }

    @Test
    void rosterMatchesLegacyRetakeSelectionAndNullSubmissions() {
        List<RosterRowResponse> legacy = named.query(OLD_ROSTER_SQL,
                new MapSqlParameterSource("sectionId", "sec-a").addValue("assignmentId", "asg-pub"),
                (row, n) -> new RosterRowResponse(
                        row.getString("enrollment_id"), row.getString("student_id"),
                        row.getString("student_name"), row.getString("student_email"),
                        row.getString("enrollment_status"), row.getString("submission_id"),
                        row.getString("submission_status"), instant(row.getTimestamp("submitted_at"))));
        List<RosterRowResponse> current = staff.roster("lec-1", "asg-pub");

        assertThat(current).hasSameSizeAs(legacy);
        for (int i = 0; i < legacy.size(); i++) {
            RosterRowResponse oldRow = legacy.get(i);
            RosterRowResponse newRow = current.get(i);
            assertThat(newRow.studentId()).isEqualTo(oldRow.studentId());
            if ("stu-4".equals(oldRow.studentId())) {
                // Equal timestamps: the old query had no SQL tiebreaker, so the
                // id may legitimately differ; every other field must not.
                assertThat(newRow.enrollmentId()).isIn("enr-4a", "enr-4b");
                assertThat(oldRow.enrollmentId()).isIn("enr-4a", "enr-4b");
                assertThat(new RosterRowResponse(
                        oldRow.enrollmentId(), newRow.studentId(), newRow.studentName(),
                        newRow.studentEmail(), newRow.enrollmentStatus(), newRow.submissionId(),
                        newRow.submissionStatus(), newRow.submittedAt())).isEqualTo(oldRow);
            } else {
                assertThat(newRow).isEqualTo(oldRow);
            }
        }

        assertThat(current).extracting(RosterRowResponse::studentId)
                .containsExactly("stu-1", "stu-2", "stu-3", "stu-4", "stu-5");
        assertThat(current).extracting(RosterRowResponse::enrollmentStatus)
                .containsExactly("ENROLLED", "CONFIRMED", "COMPLETED", "COMPLETED", "PENDING");
        RosterRowResponse stu1 = current.get(0);
        assertThat(stu1.submissionId()).isEqualTo("sub-1");
        assertThat(stu1.submissionStatus()).isEqualTo("SUBMITTED");
        assertThat(current.get(1).submissionId()).isNull();
        assertThat(current.get(2).submissionId()).isNull();
        assertThat(current).extracting(RosterRowResponse::studentId).doesNotContain("stu-6");
    }

    @Test
    void materialListMatchesSelectStarOracleWithEveryMappedField() {
        List<MaterialResponse> legacy = named.query(OLD_MATERIALS_SQL,
                new MapSqlParameterSource("sectionId", "sec-a"),
                (row, n) -> new MaterialResponse(
                        row.getString("id"), row.getString("sectionId"), row.getString("title"),
                        row.getString("description"), row.getString("fileName"),
                        row.getString("contentType"),
                        row.getObject("sizeBytes") instanceof Number number ? number.longValue() : null,
                        row.getString("checksum"), row.getInt("version"),
                        instant(row.getTimestamp("createdAt")),
                        instant(row.getTimestamp("updatedAt"))));
        List<MaterialResponse> current = students.listMaterials("stu-1", "sec-a");

        assertThat(current).isEqualTo(legacy);
        assertThat(current).extracting(MaterialResponse::id).containsExactly("mat-new", "mat-old");
        assertThat(current.get(0).fileName()).isEqualTo("file-mat-new.txt");
        assertThat(current.get(0).contentType()).isEqualTo("text/plain");
        assertThat(current.get(0).sizeBytes()).isEqualTo(20L);
        assertThat(current.get(0).checksum()).isEqualTo("checksum-new");
        assertThat(current.get(0).version()).isEqualTo(1);
        assertThat(current.get(0).createdAt()).isEqualTo(T2);
        assertThat(current.get(0).updatedAt()).isEqualTo(T2);

        assertThatThrownBy(() -> students.listMaterials("stu-outside", "sec-a"))
                .isInstanceOf(DomainException.class)
                .extracting(error -> ((DomainException) error).code())
                .isEqualTo("NOT_ENROLLED");
    }

    @Test
    void draftAssignmentsStayStaffOnlyAndSectionAuthorityIsUnchanged() {
        Set<String> visible = students.listAssignments("stu-1", "sec-a").stream()
                .map(AssignmentResponse::id).collect(Collectors.toSet());
        assertThat(visible).containsExactlyInAnyOrder("asg-pub", "asg-closed");
        assertThat(visible).doesNotContain("asg-draft");

        Set<String> staffVisible = staff.listAssignments("lec-1", "sec-a").stream()
                .map(AssignmentResponse::id).collect(Collectors.toSet());
        assertThat(staffVisible).contains("asg-draft", "asg-pub", "asg-closed");

        assertThatThrownBy(() -> students.listAssignments("stu-outside", "sec-a"))
                .isInstanceOf(DomainException.class)
                .extracting(error -> ((DomainException) error).code())
                .isEqualTo("NOT_ENROLLED");
        assertThatThrownBy(() -> staff.roster("lec-2", "asg-pub"))
                .isInstanceOf(DomainException.class)
                .extracting(error -> ((DomainException) error).code())
                .isEqualTo("SECTION_NOT_ASSIGNED");
    }

    private void student(String id, String userId, String studentId, String lastName) {
        jdbc.update("INSERT INTO campuscore_auth.\"User\" (\"id\",\"email\",\"firstName\",\"lastName\")"
                + " VALUES (?,?,?,?)", userId, userId + "@fixture.invalid", "Test", lastName);
        jdbc.update("INSERT INTO academic.\"Student\" (\"id\",\"userId\",\"studentId\") VALUES (?,?,?)",
                id, userId, studentId);
    }

    private void enrollment(String id, String studentId, String sectionId, String status, Instant at) {
        jdbc.update("INSERT INTO academic.\"Enrollment\""
                        + " (\"id\",\"studentId\",\"sectionId\",\"semesterId\",\"status\",\"enrolledAt\")"
                        + " VALUES (?,?,?,'sem-1',?,?)",
                id, studentId, sectionId, status, Timestamp.from(at));
    }

    private void material(String id, String sectionId, String title, Instant at, long size, String checksum) {
        jdbc.update("INSERT INTO learning.\"Material\""
                        + " (\"id\",\"sectionId\",\"title\",\"description\",\"fileName\",\"contentType\","
                        + " \"sizeBytes\",\"checksum\",\"uploaderId\",\"createdAt\",\"updatedAt\")"
                        + " VALUES (?,?,?,?,'file-' || ? || '.txt','text/plain',?,?,'lec-1',?,?)",
                id, sectionId, title, "Mo ta " + title, id, size, checksum,
                Timestamp.from(at), Timestamp.from(at));
    }

    private void assignment(String id, String sectionId, String title, String status, Instant deadline) {
        jdbc.update("INSERT INTO learning.\"Assignment\""
                        + " (\"id\",\"sectionId\",\"title\",\"status\",\"ownerId\",\"deadlineAt\")"
                        + " VALUES (?,?,?,?,'lec-1',?)",
                id, sectionId, title, status, deadline == null ? null : Timestamp.from(deadline));
    }

    private static Instant instant(Timestamp timestamp) {
        return timestamp == null ? null : timestamp.toInstant();
    }
}
