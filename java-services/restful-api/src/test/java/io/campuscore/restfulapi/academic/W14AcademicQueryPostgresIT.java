package io.campuscore.restfulapi.academic;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import io.campuscore.restfulapi.academic.repository.AcademicEnrollmentReadRepository;
import io.campuscore.restfulapi.academic.repository.AcademicSectionReadRepository;
import io.campuscore.restfulapi.academic.service.AcademicMutationService;
import io.campuscore.restfulapi.common.LikePattern;
import java.math.BigDecimal;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIf;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.web.server.ResponseStatusException;

@EnabledIf("io.campuscore.restfulapi.academic.W14AcademicQueryPostgresIT#postgresTargetConfigured")
@SpringBootTest(properties = {
        "spring.flyway.locations=classpath:db/migration",
        "deepseek.enabled=false",
        "spring.jpa.hibernate.ddl-auto=none",
        "spring.datasource.hikari.maximum-pool-size=8"
})
@ActiveProfiles({"test", "persistence"})
class W14AcademicQueryPostgresIT {

    private static final Instant NOW = Instant.parse("2026-09-15T12:00:00Z");

    @Autowired
    private NamedParameterJdbcTemplate jdbc;

    @Autowired
    private AcademicSectionReadRepository sections;

    @Autowired
    private AcademicEnrollmentReadRepository enrollments;

    @Autowired
    private AcademicMutationService mutations;

    @DynamicPropertySource
    static void postgresProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", () -> valueOr(
                "CAMPUSCORE_E2E_POSTGRES_URL", "jdbc:postgresql://localhost:5432/campuscore_e2e"));
        registry.add("spring.datasource.username", () -> valueOr(
                "CAMPUSCORE_E2E_POSTGRES_USER", "postgres"));
        registry.add("spring.datasource.password", () -> valueOr(
                "CAMPUSCORE_E2E_POSTGRES_PASSWORD", "postgres"));
    }

    @Test
    void optimizedAcademicQueriesMatchLegacyPostgresRowsCountsAndOrdering() {
        String suffix = UUID.randomUUID().toString().replace("-", "").substring(0, 10);
        AcademicEnrollmentPostgresFixture fixture = AcademicEnrollmentPostgresFixture.seed(jdbc, 20);
        String otherSemesterId = "p2-sem-" + suffix;
        String otherSectionId = "p2-section-" + suffix;
        String emptySectionId = "p2-empty-" + suffix;
        createOtherSemester(fixture.academicYearId, otherSemesterId);
        createSection(fixture.courseId, otherSemesterId, otherSectionId, "02");
        createSection(fixture.courseId, fixture.semesterId, emptySectionId, "03");

        List<String> students = new ArrayList<>();
        for (int index = 1; index <= 8; index++) {
            students.add(fixture.seedStudent(index));
        }
        String enrolledId = "p2-enrolled-" + suffix;
        String confirmedId = "p2-confirmed-" + suffix;
        insertEnrollment(fixture, enrolledId, students.get(0), fixture.sectionId, fixture.semesterId, "ENROLLED");
        insertEnrollment(fixture, confirmedId, students.get(1), fixture.sectionId, fixture.semesterId, "CONFIRMED");
        insertEnrollment(fixture, "p2-completed-" + suffix, students.get(2), fixture.sectionId, fixture.semesterId, "COMPLETED");
        insertEnrollment(fixture, "p2-pending-" + suffix, students.get(3), fixture.sectionId, fixture.semesterId, "PENDING");
        insertEnrollment(fixture, "p2-dropped-" + suffix, students.get(4), fixture.sectionId, fixture.semesterId, "DROPPED");
        insertEnrollment(fixture, "p2-cancelled-" + suffix, students.get(5), fixture.sectionId, fixture.semesterId, "CANCELLED");
        insertEnrollment(fixture, "p2-semester-mismatch-" + suffix, students.get(6), fixture.sectionId, otherSemesterId, "ENROLLED");
        insertEnrollment(fixture, "p2-other-section-" + suffix, students.get(7), otherSectionId, otherSemesterId, "ENROLLED");

        String processOne = "p2-process-one-" + suffix;
        String processTwo = "p2-process-two-" + suffix;
        String finalOne = "p2-final-one-" + suffix;
        String finalTwo = "p2-final-two-" + suffix;
        String otherProcess = "p2-other-process-" + suffix;
        insertGradeItem(processOne, fixture.sectionId, "PROCESS");
        insertGradeItem(processTwo, fixture.sectionId, "PROCESS");
        insertGradeItem(finalOne, fixture.sectionId, "FINAL");
        insertGradeItem(finalTwo, fixture.sectionId, "FINAL");
        insertGradeItem(otherProcess, otherSectionId, "PROCESS");
        insertStudentGrade("p2-grade-process-one-" + suffix, enrolledId, processOne, "7.00");
        insertStudentGrade("p2-grade-process-two-" + suffix, enrolledId, processTwo, "9.50");
        insertStudentGrade("p2-grade-final-one-" + suffix, enrolledId, finalOne, "8.50");
        insertStudentGrade("p2-grade-final-two-" + suffix, enrolledId, finalTwo, "9.00");
        insertStudentGrade("p2-grade-cross-section-" + suffix, enrolledId, otherProcess, "9.90");

        List<LegacyGradeScores> oldGrades = jdbc.query(
                "SELECT enrollment.\"id\","
                        + " (SELECT MAX(sg.\"score\") FROM academic.\"StudentGrade\" sg"
                        + " JOIN academic.\"GradeItem\" gi ON gi.\"id\" = sg.\"gradeItemId\""
                        + " WHERE sg.\"enrollmentId\" = enrollment.\"id\" AND gi.\"type\" = 'PROCESS') AS process_score,"
                        + " (SELECT MAX(sg.\"score\") FROM academic.\"StudentGrade\" sg"
                        + " JOIN academic.\"GradeItem\" gi ON gi.\"id\" = sg.\"gradeItemId\""
                        + " WHERE sg.\"enrollmentId\" = enrollment.\"id\" AND gi.\"type\" = 'FINAL') AS final_exam_score"
                        + " FROM academic.\"Enrollment\" enrollment"
                        + " JOIN academic.\"Student\" student ON student.\"id\" = enrollment.\"studentId\""
                        + " JOIN campuscore_auth.\"User\" student_user ON student_user.\"id\" = student.\"userId\""
                        + " WHERE enrollment.\"sectionId\" = :sectionId"
                        + " AND enrollment.\"semesterId\" = (SELECT section_scope.\"semesterId\""
                        + " FROM academic.\"Section\" section_scope WHERE section_scope.\"id\" = :sectionId)"
                        + " AND enrollment.\"status\" IN ('ENROLLED', 'CONFIRMED', 'COMPLETED')"
                        + " ORDER BY student_user.\"firstName\" ASC, student_user.\"lastName\" ASC, enrollment.\"id\" ASC",
                Map.of("sectionId", fixture.sectionId),
                (rs, ignored) -> new LegacyGradeScores(
                        rs.getString("id"), rs.getBigDecimal("process_score"), rs.getBigDecimal("final_exam_score")));
        List<LegacyGradeScores> newGrades = sections.findSectionGradeEnrollments(fixture.sectionId)
                .stream()
                .map(row -> new LegacyGradeScores(row.id(), row.processScore(), row.finalExamScore()))
                .toList();
        assertThat(newGrades).containsExactlyElementsOf(oldGrades);
        assertThat(newGrades).contains(
                new LegacyGradeScores(enrolledId, new BigDecimal("9.90"), new BigDecimal("9.00")),
                new LegacyGradeScores(confirmedId, null, null));

        List<LegacySectionCount> oldSectionCounts = jdbc.query(
                "SELECT section.\"id\", (SELECT COUNT(*) FROM academic.\"Enrollment\" active_enrollment"
                        + " WHERE active_enrollment.\"sectionId\" = section.\"id\""
                        + " AND active_enrollment.\"semesterId\" = section.\"semesterId\""
                        + " AND active_enrollment.\"status\" IN ('ENROLLED', 'PENDING', 'CONFIRMED', 'COMPLETED'))"
                        + " AS active_enrollment_count FROM academic.\"Section\" section"
                        + " JOIN academic.\"Course\" course ON course.\"id\" = section.\"courseId\""
                        + " JOIN academic.\"Department\" department ON department.\"id\" = course.\"departmentId\""
                        + " JOIN academic.\"Semester\" semester ON semester.\"id\" = section.\"semesterId\""
                        + " LEFT JOIN academic.\"Lecturer\" lecturer ON lecturer.\"id\" = section.\"lecturerId\""
                        + " LEFT JOIN campuscore_auth.\"User\" lecturer_user ON lecturer_user.\"id\" = lecturer.\"userId\""
                        + " LEFT JOIN academic.\"Classroom\" classroom ON classroom.\"id\" = section.\"classroomId\""
                        + " WHERE section.\"courseId\" = :courseId"
                        + " ORDER BY section.\"sectionNumber\" ASC, section.\"id\" ASC",
                Map.of("courseId", fixture.courseId),
                (rs, ignored) -> new LegacySectionCount(rs.getString("id"), rs.getLong("active_enrollment_count")));
        List<LegacySectionCount> newSectionCounts = sections.findSections(0, 100, null, null, fixture.courseId)
                .stream()
                .map(row -> new LegacySectionCount(row.id(), row.activeEnrollmentCount()))
                .toList();
        assertThat(newSectionCounts).containsExactlyElementsOf(oldSectionCounts);
        assertThat(newSectionCounts).contains(
                new LegacySectionCount(fixture.sectionId, 4),
                new LegacySectionCount(otherSectionId, 1),
                new LegacySectionCount(emptySectionId, 0));

        assertThat(enrollments.countEnrollments(null, null, null, null, fixture.sectionId))
                .isEqualTo(legacyCount(fixture.sectionId, null, null));
        assertThat(enrollments.countEnrollments(null, null, null, fixture.courseId, null))
                .isEqualTo(legacyCount(null, fixture.courseId, null));
        long searchCount = enrollments.countEnrollments(null, null, null, null, null, "Race");
        assertThat(searchCount).isPositive();
        assertThat(searchCount).isEqualTo(legacyCount(null, null, "Race"));
    }

    @Test
    void csvExportMatchesLegacyBytesAndHonoursThe50000RowBoundaryOnPostgres() {
        String suffix = UUID.randomUUID().toString().replace("-", "").substring(0, 10);
        AcademicEnrollmentPostgresFixture fixture = AcademicEnrollmentPostgresFixture.seed(jdbc, 20);
        String studentId = fixture.seedStudent(1);
        String userId = jdbc.queryForObject(
                "SELECT \"userId\" FROM academic.\"Student\" WHERE \"id\" = :id",
                Map.of("id", studentId),
                String.class);
        jdbc.update("UPDATE campuscore_auth.\"User\""
                        + " SET \"email\" = :email, \"firstName\" = :firstName, \"lastName\" = :lastName"
                        + " WHERE \"id\" = :id",
                Map.of("id", userId,
                        "email", "student," + suffix + ",\"mail\"\n@example.edu",
                        "firstName", "First\n=SUM(1,2)",
                        "lastName", "Last, \"" + suffix + "\" Quoted"));
        jdbc.update("UPDATE academic.\"Student\" SET \"studentId\" = :studentNumber WHERE \"id\" = :id",
                Map.of("id", studentId, "studentNumber", "=SUM(1,2)-" + suffix));
        jdbc.update("UPDATE academic.\"Course\" SET \"code\" = :code, \"name\" = :name WHERE \"id\" = :id",
                Map.of("id", fixture.courseId,
                        "code", "CS,101-" + suffix,
                        "name", "Course, \"Quoted\"\nsecond line " + suffix));
        jdbc.update("UPDATE academic.\"Section\" SET \"sectionNumber\" = :number WHERE \"id\" = :id",
                Map.of("id", fixture.sectionId, "number", "A,\"1\"\n" + suffix));
        jdbc.update("UPDATE academic.\"Semester\" SET \"name\" = :name WHERE \"id\" = :id",
                Map.of("id", fixture.semesterId, "name", "Fall, \"2026\"\nSemester " + suffix));

        String specialId = "p2-csv-special-" + suffix;
        insertEnrollment(fixture, specialId, studentId, fixture.sectionId, fixture.semesterId, "COMPLETED");
        jdbc.update("UPDATE academic.\"Enrollment\" SET \"finalGrade\" = 9.50, \"letterGrade\" = 'A'"
                + " WHERE \"id\" = :id", Map.of("id", specialId));

        List<Map<String, Object>> oldRows = jdbc.queryForList(
                "SELECT e.\"id\", student.\"studentId\" AS student_number,"
                        + " student_user.\"email\", student_user.\"firstName\", student_user.\"lastName\","
                        + " course.\"code\" AS course_code, course.\"name\" AS course_name,"
                        + " section.\"sectionNumber\", semester.\"name\" AS semester_name,"
                        + " e.\"status\", e.\"enrolledAt\", e.\"finalGrade\", e.\"letterGrade\""
                        + " FROM academic.\"Enrollment\" e"
                        + " JOIN academic.\"Student\" student ON student.\"id\" = e.\"studentId\""
                        + " JOIN campuscore_auth.\"User\" student_user ON student_user.\"id\" = student.\"userId\""
                        + " JOIN academic.\"Section\" section ON section.\"id\" = e.\"sectionId\""
                        + " JOIN academic.\"Course\" course ON course.\"id\" = section.\"courseId\""
                        + " JOIN academic.\"Semester\" semester ON semester.\"id\" = e.\"semesterId\""
                        + " WHERE e.\"studentId\" = :studentId"
                        + " ORDER BY e.\"enrolledAt\" DESC, e.\"id\" DESC LIMIT :exportLimit",
                Map.of("studentId", studentId, "exportLimit", 50_001));
        String expected = legacyCsv(oldRows);
        String actual = mutations.exportEnrollments(null, null, studentId, null);
        assertThat(actual.getBytes(java.nio.charset.StandardCharsets.UTF_8))
                .isEqualTo(expected.getBytes(java.nio.charset.StandardCharsets.UTF_8));

        jdbc.update("""
                INSERT INTO academic."Enrollment"
                    ("id", "studentId", "sectionId", "semesterId", "status", "enrolledAt",
                     "gradeStatus", "courseId", "creditsSnapshot")
                SELECT 'p2-csv-bulk-' || :suffix || '-' || g, :studentId, :sectionId, :semesterId, 'COMPLETED',
                       :enrolledAt, 'DRAFT', :courseId, 3
                FROM generate_series(1, 49999) AS g
                """,
                new MapSqlParameterSource("studentId", studentId)
                        .addValue("suffix", suffix)
                        .addValue("sectionId", fixture.sectionId)
                        .addValue("semesterId", fixture.semesterId)
                        .addValue("enrolledAt", Timestamp.from(NOW))
                        .addValue("courseId", fixture.courseId));
        String accepted = mutations.exportEnrollments(null, null, studentId, null);
        assertThat(accepted.split("\\r\\n").length).isEqualTo(50_001);

        jdbc.update("INSERT INTO academic.\"Enrollment\""
                        + " (\"id\", \"studentId\", \"sectionId\", \"semesterId\", \"status\", \"enrolledAt\","
                        + " \"gradeStatus\", \"courseId\", \"creditsSnapshot\")"
                        + " VALUES (:id, :studentId, :sectionId, :semesterId, 'COMPLETED', :enrolledAt,"
                        + " 'DRAFT', :courseId, 3)",
                new MapSqlParameterSource("id", "p2-csv-overflow-" + suffix)
                        .addValue("studentId", studentId)
                        .addValue("sectionId", fixture.sectionId)
                        .addValue("semesterId", fixture.semesterId)
                        .addValue("enrolledAt", Timestamp.from(NOW))
                        .addValue("courseId", fixture.courseId));
        AtomicReference<String> returned = new AtomicReference<>();
        assertThatThrownBy(() -> returned.set(mutations.exportEnrollments(null, null, studentId, null)))
                .isInstanceOf(ResponseStatusException.class)
                .satisfies(error -> assertThat(
                        ((ResponseStatusException) error).getStatusCode().value()).isEqualTo(413));
        assertThat(returned).hasValue(null);
    }

    private long legacyCount(String sectionId, String courseId, String search) {
        MapSqlParameterSource parameters = new MapSqlParameterSource();
        List<String> filters = new ArrayList<>();
        if (sectionId != null) {
            filters.add("e.\"sectionId\" = :sectionId");
            parameters.addValue("sectionId", sectionId);
        }
        if (courseId != null) {
            filters.add("section.\"courseId\" = :courseId");
            parameters.addValue("courseId", courseId);
        }
        List<String> tokens = LikePattern.tokens(search);
        if (!tokens.isEmpty()) {
            parameters.addValue("foldFrom", LikePattern.FOLD_FROM);
            parameters.addValue("foldTo", LikePattern.FOLD_TO);
            for (int i = 0; i < tokens.size(); i++) {
                String name = "searchToken" + i;
                parameters.addValue(name, tokens.get(i));
                filters.add("(TRANSLATE(LOWER(student.\"studentId\"), :foldFrom, :foldTo) LIKE :" + name + " ESCAPE '\\'"
                        + " OR TRANSLATE(LOWER(student_user.\"firstName\"), :foldFrom, :foldTo) LIKE :" + name + " ESCAPE '\\'"
                        + " OR TRANSLATE(LOWER(student_user.\"lastName\"), :foldFrom, :foldTo) LIKE :" + name + " ESCAPE '\\'"
                        + " OR TRANSLATE(LOWER(student_user.\"email\"), :foldFrom, :foldTo) LIKE :" + name + " ESCAPE '\\'"
                        + " OR TRANSLATE(LOWER(section.\"sectionNumber\"), :foldFrom, :foldTo) LIKE :" + name + " ESCAPE '\\'"
                        + " OR TRANSLATE(LOWER(course.\"code\"), :foldFrom, :foldTo) LIKE :" + name + " ESCAPE '\\'"
                        + " OR TRANSLATE(LOWER(course.\"name\"), :foldFrom, :foldTo) LIKE :" + name + " ESCAPE '\\'"
                        + " OR TRANSLATE(LOWER(COALESCE(lecturer_user.\"firstName\", '')), :foldFrom, :foldTo) LIKE :" + name + " ESCAPE '\\'"
                        + " OR TRANSLATE(LOWER(COALESCE(lecturer_user.\"lastName\", '')), :foldFrom, :foldTo) LIKE :" + name + " ESCAPE '\\')");
            }
        }
        String where = filters.isEmpty() ? "" : " WHERE " + String.join(" AND ", filters);
        Long count = jdbc.queryForObject(
                "SELECT COUNT(*) FROM academic.\"Enrollment\" e"
                        + " JOIN academic.\"Section\" section ON section.\"id\" = e.\"sectionId\""
                        + " JOIN academic.\"Course\" course ON course.\"id\" = section.\"courseId\""
                        + " JOIN academic.\"Semester\" semester ON semester.\"id\" = e.\"semesterId\""
                        + " JOIN academic.\"Student\" student ON student.\"id\" = e.\"studentId\""
                        + " JOIN campuscore_auth.\"User\" student_user ON student_user.\"id\" = student.\"userId\""
                        + " LEFT JOIN academic.\"Lecturer\" lecturer ON lecturer.\"id\" = section.\"lecturerId\""
                        + " LEFT JOIN campuscore_auth.\"User\" lecturer_user ON lecturer_user.\"id\" = lecturer.\"userId\""
                        + where,
                parameters,
                Long.class);
        return count == null ? 0L : count;
    }

    private void createOtherSemester(String academicYearId, String semesterId) {
        jdbc.update("INSERT INTO academic.\"Semester\""
                        + " (\"id\", \"name\", \"type\", \"academicYearId\", \"startDate\", \"endDate\", \"status\")"
                        + " VALUES (:id, :name, 'SPRING', :academicYearId, :start, :end, 'ACTIVE')",
                new MapSqlParameterSource("id", semesterId)
                        .addValue("name", "Other P2 semester " + semesterId)
                        .addValue("academicYearId", academicYearId)
                        .addValue("start", Timestamp.from(NOW))
                        .addValue("end", Timestamp.from(NOW.plusSeconds(15_552_000))));
    }

    private void createSection(String courseId, String semesterId, String sectionId, String sectionNumber) {
        jdbc.update("INSERT INTO academic.\"Section\""
                        + " (\"id\", \"sectionNumber\", \"courseId\", \"semesterId\", \"capacity\", \"enrolledCount\", \"status\", \"version\")"
                        + " VALUES (:id, :sectionNumber, :courseId, :semesterId, 20, 0, 'OPEN', 0)",
                new MapSqlParameterSource("id", sectionId)
                        .addValue("sectionNumber", sectionNumber)
                        .addValue("courseId", courseId)
                        .addValue("semesterId", semesterId));
    }

    private void insertEnrollment(
            AcademicEnrollmentPostgresFixture fixture,
            String enrollmentId,
            String studentId,
            String sectionId,
            String semesterId,
            String status) {
        jdbc.update("INSERT INTO academic.\"Enrollment\""
                        + " (\"id\", \"studentId\", \"sectionId\", \"semesterId\", \"status\", \"enrolledAt\","
                        + " \"gradeStatus\", \"courseId\", \"creditsSnapshot\")"
                        + " VALUES (:id, :studentId, :sectionId, :semesterId, :status, :enrolledAt, 'DRAFT', :courseId, 3)",
                new MapSqlParameterSource("id", enrollmentId)
                        .addValue("studentId", studentId)
                        .addValue("sectionId", sectionId)
                        .addValue("semesterId", semesterId)
                        .addValue("status", status)
                        .addValue("enrolledAt", Timestamp.from(NOW))
                        .addValue("courseId", fixture.courseId));
    }

    private void insertGradeItem(String id, String sectionId, String type) {
        jdbc.update("INSERT INTO academic.\"GradeItem\""
                        + " (\"id\", \"sectionId\", \"name\", \"type\", \"maxScore\", \"weight\")"
                        + " VALUES (:id, :sectionId, :name, :type, 100, 25)",
                Map.of("id", id, "sectionId", sectionId, "name", id, "type", type));
    }

    private void insertStudentGrade(String id, String enrollmentId, String gradeItemId, String score) {
        jdbc.update("INSERT INTO academic.\"StudentGrade\" (\"id\", \"enrollmentId\", \"gradeItemId\", \"score\")"
                        + " VALUES (:id, :enrollmentId, :gradeItemId, :score)",
                Map.of("id", id, "enrollmentId", enrollmentId, "gradeItemId", gradeItemId, "score", new BigDecimal(score)));
    }

    private static String legacyCsv(List<Map<String, Object>> rows) {
        StringBuilder csv = new StringBuilder(
                "id,studentNumber,email,studentName,courseCode,courseName,section,semester,status,enrolledAt,finalGrade,letterGrade\r\n");
        for (Map<String, Object> row : rows) {
            csv.append(legacyCell(row.get("id"))).append(',')
                    .append(legacyCell(row.get("student_number"))).append(',')
                    .append(legacyCell(row.get("email"))).append(',')
                    .append(legacyCell((String.valueOf(row.get("lastName")) + " "
                            + String.valueOf(row.get("firstName"))).trim())).append(',')
                    .append(legacyCell(row.get("course_code"))).append(',')
                    .append(legacyCell(row.get("course_name"))).append(',')
                    .append(legacyCell(row.get("sectionNumber"))).append(',')
                    .append(legacyCell(row.get("semester_name"))).append(',')
                    .append(legacyCell(row.get("status"))).append(',')
                    .append(legacyCell(row.get("enrolledAt"))).append(',')
                    .append(legacyCell(row.get("finalGrade"))).append(',')
                    .append(legacyCell(row.get("letterGrade"))).append("\r\n");
        }
        return csv.toString();
    }

    private static String legacyCell(Object value) {
        String text = value == null ? "" : value.toString();
        if (!text.isEmpty() && "=+-@\t\r".indexOf(text.charAt(0)) >= 0) {
            text = "'" + text;
        }
        return "\"" + text.replace("\"", "\"\"") + "\"";
    }

    static boolean postgresTargetConfigured() {
        String url = System.getenv("CAMPUSCORE_E2E_POSTGRES_URL");
        return url != null && url.startsWith("jdbc:postgresql:");
    }

    private static String valueOr(String name, String fallback) {
        String value = System.getenv(name);
        return value == null || value.isBlank() ? fallback : value;
    }

    private record LegacySectionCount(String id, long count) {
    }

    private record LegacyGradeScores(String id, BigDecimal processScore, BigDecimal finalExamScore) {
    }
}
