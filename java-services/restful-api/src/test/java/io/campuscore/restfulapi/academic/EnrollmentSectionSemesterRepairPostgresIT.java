package io.campuscore.restfulapi.academic;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.InputStream;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.nio.charset.StandardCharsets;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

class EnrollmentSectionSemesterRepairPostgresIT {
    private static final String MIGRATION_RESOURCE = "/db/migration/V161__repair_history_enrollment_sections.sql";
    private static final String STUDENT_ONE = "student-profile";
    private static final String STUDENT_TWO = "student-profile-002";

    private static final int EXPECTED_HISTORY_ENROLLMENTS = 1296;
    private static final int EXPECTED_HISTORY_STUDENT_GRADES = 2592;
    private static final int EXPECTED_SOURCE_SECTIONS = 6;
    private static final int EXPECTED_SOURCE_GRADE_ITEMS = 12;
    private static final int EXPECTED_SOURCE_SCHEDULES = 6;
    private static final String EXPECTED_ORIGINAL_SECTION_SNAPSHOT = "section-java-demo|course-java-demo|SE401|semester-demo|SE401-01|lecturer-profile|classroom-a101|45|OPEN|classroom-a101|2|07:00|09:30;section-web-demo|course-web-demo|SE402|semester-demo|SE402-01|lecturer-profile|classroom-a102|35|OPEN|classroom-a102|4|13:00|15:30;section-algorithms-demo|course-algorithms-demo|SE403|semester-demo|SE403-01|lecturer-profile|classroom-a103|45|OPEN|classroom-a103|2|09:45|11:45;section-database-demo|course-database-demo|SE404|semester-demo|SE404-01|lecturer-profile|classroom-a104|40|OPEN|classroom-a104|3|07:00|09:30;section-architecture-demo|course-software-architecture-demo|SE405|semester-demo|SE405-01|lecturer-profile|classroom-a105|36|OPEN|classroom-a105|4|07:00|09:30;section-testing-demo|course-testing-demo|SE406|semester-demo|SE406-01|lecturer-profile|classroom-a106|36|OPEN|classroom-a106|5|07:00|09:30";
    private static final String EXPECTED_CURRENT_TERM_ENROLLMENTS = "0";
    private static final List<String> EXPECTED_STUDENT_ONE_TRANSCRIPT = List.of(
            "semester-history-demo-1|Semester 1 2025-2026|attemptedCredits=19|earnedCredits=19|gpa=3.16",
            "semester-history-demo|Semester 2 2025-2026|attemptedCredits=38|earnedCredits=38|gpa=3.03");
    private static final List<String> EXPECTED_STUDENT_TWO_TRANSCRIPT = List.of(
            "semester-history-demo-1|Semester 1 2025-2026|attemptedCredits=19|earnedCredits=19|gpa=3.18",
            "semester-history-demo|Semester 2 2025-2026|attemptedCredits=38|earnedCredits=38|gpa=3.17");

    @BeforeAll
    static void migrateFreshChain() {
        SeedPostgresITSupport.migrate();
    }

    @Test
    void historicalEnrollmentsUseTheirOwnSemesterWithoutChangingTranscripts() throws Exception {
        try (Connection connection = connect()) {
            Snapshot snapshot = snapshot(connection);
            printSnapshot(snapshot);

            assertThat(snapshot.mismatchedEnrollments())
                    .as("history enrollments must reference a section from their own semester")
                    .isZero();
            assertThat(snapshot.historyEnrollments()).isEqualTo(EXPECTED_HISTORY_ENROLLMENTS);
            assertThat(snapshot.historyStudentGrades()).isEqualTo(EXPECTED_HISTORY_STUDENT_GRADES);
            assertThat(snapshot.sectionReferences()).hasSize(EXPECTED_SOURCE_SECTIONS);
            assertThat(snapshot.sectionReferences()).allMatch(value -> value.startsWith("section-hist-v161-"));
            assertThat(snapshot.originalSections()).isEqualTo(EXPECTED_ORIGINAL_SECTION_SNAPSHOT);
            assertThat(snapshot.currentTermEnrollments()).isEqualTo(EXPECTED_CURRENT_TERM_ENROLLMENTS);
            assertThat(snapshot.sourceGradeItems()).isEqualTo(EXPECTED_SOURCE_GRADE_ITEMS);
            assertThat(snapshot.sourceSchedules()).isEqualTo(EXPECTED_SOURCE_SCHEDULES);
            assertThat(snapshot.copiedGradeItems()).isEqualTo(EXPECTED_SOURCE_GRADE_ITEMS);
            assertThat(snapshot.copiedSchedules()).isEqualTo(EXPECTED_SOURCE_SCHEDULES);
            assertThat(snapshot.studentGradeSectionMismatches()).isZero();
            assertThat(snapshot.sectionCopyMismatches()).isZero();
            assertThat(snapshot.scheduleCopyMismatches()).isZero();
            assertThat(snapshot.gradeItemCopyMismatches()).isZero();
            assertThat(snapshot.studentOneTranscript()).containsExactlyElementsOf(EXPECTED_STUDENT_ONE_TRANSCRIPT);
            assertThat(snapshot.studentTwoTranscript()).containsExactlyElementsOf(EXPECTED_STUDENT_TWO_TRANSCRIPT);

            List<RowsFingerprint> beforeRerun = affectedFingerprints(connection);
            executeV161(connection);
            List<RowsFingerprint> afterRerun = affectedFingerprints(connection);
            assertThat(afterRerun).as("a second execution of V161 must not change affected rows").isEqualTo(beforeRerun);
        }
    }

    private static Connection connect() throws SQLException {
        return DriverManager.getConnection(required("CAMPUSCORE_E2E_POSTGRES_URL"),
                required("CAMPUSCORE_E2E_POSTGRES_USER"), required("CAMPUSCORE_E2E_POSTGRES_PASSWORD"));
    }

    private static Snapshot snapshot(Connection connection) throws SQLException {
        int enrollmentRows = count(connection, """
                SELECT COUNT(*) FROM academic."Enrollment"
                WHERE "id" LIKE 'enrollment-history-v27-%'
                """);
        int mismatchRows = count(connection, """
                SELECT COUNT(*)
                FROM academic."Enrollment" enrollment
                JOIN academic."Section" section ON section."id" = enrollment."sectionId"
                WHERE enrollment."id" LIKE 'enrollment-history-v27-%'
                  AND enrollment."semesterId" <> section."semesterId"
                """);
        int gradeRows = count(connection, """
                SELECT COUNT(*)
                FROM academic."StudentGrade" grade
                JOIN academic."Enrollment" enrollment ON enrollment."id" = grade."enrollmentId"
                WHERE enrollment."id" LIKE 'enrollment-history-v27-%'
                """);
        List<String> sectionReferences = rows(connection, """
                SELECT section."id", section."semesterId", course."code", section."sectionNumber",
                       section."capacity", section."enrolledCount", COUNT(enrollment."id")
                FROM academic."Enrollment" enrollment
                JOIN academic."Section" section ON section."id" = enrollment."sectionId"
                JOIN academic."Course" course ON course."id" = section."courseId"
                WHERE enrollment."id" LIKE 'enrollment-history-v27-%'
                GROUP BY section."id", section."semesterId", course."code", section."sectionNumber",
                         section."capacity", section."enrolledCount"
                ORDER BY course."code", section."id"
                """);
        List<String> foreignKeyDependents = foreignKeyDependents(connection);
        String originalSections = originalSectionSnapshot(connection);
        String currentTermEnrollments = currentTermEnrollmentSnapshot(connection);
        int sourceGradeItems = count(connection, """
                SELECT COUNT(*)
                FROM academic."GradeItem" item
                WHERE item."sectionId" IN ('section-java-demo', 'section-web-demo', 'section-algorithms-demo',
                                            'section-database-demo', 'section-architecture-demo', 'section-testing-demo')
                """);
        int sourceSchedules = count(connection, """
                SELECT COUNT(*)
                FROM academic."SectionSchedule" schedule
                WHERE schedule."sectionId" IN ('section-java-demo', 'section-web-demo', 'section-algorithms-demo',
                                                'section-database-demo', 'section-architecture-demo', 'section-testing-demo')
                """);
        int copiedGradeItems = count(connection, """
                SELECT COUNT(*) FROM academic."GradeItem" WHERE "id" LIKE 'grade-hist-v161-%'
                """);
        int copiedSchedules = count(connection, """
                SELECT COUNT(*) FROM academic."SectionSchedule" WHERE "id" LIKE 'schedule-hist-v161-%'
                """);
        int gradeSectionMismatches = count(connection, """
                SELECT COUNT(*)
                FROM academic."StudentGrade" grade
                JOIN academic."Enrollment" enrollment ON enrollment."id" = grade."enrollmentId"
                JOIN academic."GradeItem" item ON item."id" = grade."gradeItemId"
                WHERE enrollment."id" LIKE 'enrollment-history-v27-%'
                  AND item."sectionId" <> enrollment."sectionId"
                """);
        int sectionCopyMismatches = count(connection, sectionCopyMismatchesQuery());
        int scheduleCopyMismatches = count(connection, scheduleCopyMismatchesQuery());
        int gradeItemCopyMismatches = count(connection, gradeItemCopyMismatchesQuery());
        List<String> studentOneTranscript = transcript(connection, STUDENT_ONE);
        List<String> studentTwoTranscript = transcript(connection, STUDENT_TWO);
        return new Snapshot(enrollmentRows, mismatchRows, gradeRows, sectionReferences, foreignKeyDependents,
                originalSections, currentTermEnrollments, sourceGradeItems, sourceSchedules,
                copiedGradeItems, copiedSchedules, gradeSectionMismatches,
                sectionCopyMismatches, scheduleCopyMismatches, gradeItemCopyMismatches,
                studentOneTranscript, studentTwoTranscript);
    }

    private static void printSnapshot(Snapshot snapshot) {
        System.out.println("ENROLLMENT_BASELINE historyEnrollments=" + snapshot.historyEnrollments()
                + " mismatchEnrollments=" + snapshot.mismatchedEnrollments()
                + " studentGrades=" + snapshot.historyStudentGrades());
        System.out.println("ENROLLMENT_BASELINE sectionCourseReferences=" + snapshot.sectionReferences());
        System.out.println("ENROLLMENT_BASELINE foreignKeyDependents=" + snapshot.foreignKeyDependents());
        System.out.println("ENROLLMENT_BASELINE originalSections=" + snapshot.originalSections());
        System.out.println("ENROLLMENT_BASELINE currentTermEnrollments=" + snapshot.currentTermEnrollments());
        System.out.println("ENROLLMENT_BASELINE sourceGradeItems=" + snapshot.sourceGradeItems()
                + " sourceSchedules=" + snapshot.sourceSchedules());
        System.out.println("ENROLLMENT_BASELINE sectionCopyMismatches=" + snapshot.sectionCopyMismatches()
                + " scheduleCopyMismatches=" + snapshot.scheduleCopyMismatches()
                + " gradeItemCopyMismatches=" + snapshot.gradeItemCopyMismatches());
        System.out.println("ENROLLMENT_BASELINE transcript." + STUDENT_ONE + "=" + snapshot.studentOneTranscript());
        System.out.println("ENROLLMENT_BASELINE transcript." + STUDENT_TWO + "=" + snapshot.studentTwoTranscript());
    }

    private static List<String> foreignKeyDependents(Connection connection) throws SQLException {
        String foreignKeys = """
                SELECT source_namespace.nspname, source_table.relname, source_column.attname,
                       referenced_namespace.nspname, referenced_table.relname, referenced_column.attname,
                       referenced_table.oid = 'academic."Enrollment"'::regclass AS references_enrollment,
                       constraint_row.conname
                FROM pg_constraint constraint_row
                JOIN pg_class source_table ON source_table.oid = constraint_row.conrelid
                JOIN pg_namespace source_namespace ON source_namespace.oid = source_table.relnamespace
                JOIN pg_class referenced_table ON referenced_table.oid = constraint_row.confrelid
                JOIN pg_namespace referenced_namespace ON referenced_namespace.oid = referenced_table.relnamespace
                JOIN LATERAL unnest(constraint_row.conkey) WITH ORDINALITY source_key(attnum, position) ON TRUE
                JOIN LATERAL unnest(constraint_row.confkey) WITH ORDINALITY referenced_key(attnum, position)
                  ON referenced_key.position = source_key.position
                JOIN pg_attribute source_column
                  ON source_column.attrelid = constraint_row.conrelid AND source_column.attnum = source_key.attnum
                JOIN pg_attribute referenced_column
                  ON referenced_column.attrelid = constraint_row.confrelid AND referenced_column.attnum = referenced_key.attnum
                WHERE constraint_row.contype = 'f'
                  AND constraint_row.confrelid IN ('academic."Enrollment"'::regclass, 'academic."Section"'::regclass)
                ORDER BY source_namespace.nspname, source_table.relname, constraint_row.conname, source_key.position
                """;
        List<String> dependents = new ArrayList<>();
        try (var statement = connection.createStatement(); ResultSet rows = statement.executeQuery(foreignKeys)) {
            while (rows.next()) {
                String sourceSchema = rows.getString(1);
                String sourceTable = rows.getString(2);
                String sourceColumn = rows.getString(3);
                String referencedSchema = rows.getString(4);
                String referencedTable = rows.getString(5);
                String referencedColumn = rows.getString(6);
                boolean referencesEnrollment = rows.getBoolean(7);
                String constraintName = rows.getString(8);
                String relation = quoteIdentifier(sourceSchema) + "." + quoteIdentifier(sourceTable);
                String target = quoteIdentifier(referencedSchema) + "." + quoteIdentifier(referencedTable);
                String predicate = referencesEnrollment
                        ? "target.\"id\" LIKE 'enrollment-history-v27-%'"
                        : "target.\"id\" IN (SELECT DISTINCT enrollment.\"sectionId\""
                                + " FROM academic.\"Enrollment\" enrollment"
                                + " WHERE enrollment.\"id\" LIKE 'enrollment-history-v27-%')";
                String query = "SELECT COUNT(*) FROM " + relation + " source_row WHERE EXISTS (SELECT 1 FROM "
                        + target + " target WHERE source_row." + quoteIdentifier(sourceColumn)
                        + " = target." + quoteIdentifier(referencedColumn) + " AND " + predicate + ")";
                int count = count(connection, query);
                dependents.add(sourceSchema + "." + sourceTable + "." + sourceColumn + " -> "
                        + referencedSchema + "." + referencedTable + "." + referencedColumn
                        + " [" + constraintName + "]: " + count);
            }
        }
        return dependents;
    }

    private static String originalSectionSnapshot(Connection connection) throws SQLException {
        List<String> sections = rows(connection, """
                SELECT section."id", section."courseId", course."code", section."semesterId",
                       section."sectionNumber", COALESCE(section."lecturerId", ''),
                       COALESCE(section."classroomId", ''), section."capacity",
                       section."status",
                       COALESCE((
                           SELECT string_agg(
                               concat_ws('|', schedule."classroomId", schedule."dayOfWeek",
                                         schedule."startTime", schedule."endTime"), ','
                               ORDER BY schedule."dayOfWeek", schedule."startTime", schedule."id")
                           FROM academic."SectionSchedule" schedule
                           WHERE schedule."sectionId" = section."id"
                       ), '')
                FROM academic."Section" section
                JOIN academic."Course" course ON course."id" = section."courseId"
                WHERE section."id" IN ('section-java-demo', 'section-web-demo', 'section-algorithms-demo',
                                        'section-database-demo', 'section-architecture-demo', 'section-testing-demo')
                ORDER BY course."code", section."id"
                """);
        return String.join(";", sections);
    }

    private static String currentTermEnrollmentSnapshot(Connection connection) throws SQLException {
        return String.valueOf(count(connection, """
                SELECT COUNT(*)
                FROM academic."Enrollment" enrollment
                WHERE enrollment."id" NOT LIKE 'enrollment-history-v27-%'
                  AND enrollment."sectionId" LIKE 'section-hist-v161-%'
                """));
    }

    private static String sectionPairsCte() {
        return """
                WITH section_pairs AS (
                    SELECT source_section."id" AS source_id, historical_section."id" AS historical_id
                    FROM academic."Section" source_section
                    JOIN academic."Course" course ON course."id" = source_section."courseId"
                    JOIN academic."Section" historical_section
                      ON historical_section."courseId" = source_section."courseId"
                     AND historical_section."sectionNumber" = source_section."sectionNumber"
                     AND historical_section."id" LIKE 'section-hist-v161-%'
                    WHERE source_section."id" IN ('section-java-demo', 'section-web-demo', 'section-algorithms-demo',
                                                   'section-database-demo', 'section-architecture-demo', 'section-testing-demo')
                )
                """;
    }

    private static String sectionCopyMismatchesQuery() {
        return sectionPairsCte() + """
                SELECT COUNT(*)
                FROM section_pairs pair
                JOIN academic."Section" source_section ON source_section."id" = pair.source_id
                JOIN academic."Section" historical_section ON historical_section."id" = pair.historical_id
                WHERE historical_section."semesterId" <> 'semester-history-demo-1'
                   OR historical_section."courseId" <> source_section."courseId"
                   OR historical_section."sectionNumber" <> source_section."sectionNumber"
                   OR historical_section."lecturerId" IS DISTINCT FROM source_section."lecturerId"
                   OR historical_section."classroomId" IS DISTINCT FROM source_section."classroomId"
                   OR historical_section."capacity" <> source_section."capacity"
                   OR historical_section."status" <> source_section."status"
                """;
    }

    private static String scheduleCopyMismatchesQuery() {
        return sectionPairsCte() + """
                SELECT COUNT(*)
                FROM section_pairs pair
                WHERE COALESCE((
                    SELECT jsonb_agg(jsonb_build_array(schedule."classroomId", schedule."dayOfWeek",
                                                      schedule."startTime", schedule."endTime")
                                     ORDER BY schedule."classroomId", schedule."dayOfWeek",
                                              schedule."startTime", schedule."endTime")
                    FROM academic."SectionSchedule" schedule
                    WHERE schedule."sectionId" = pair.source_id
                ), '[]'::jsonb) IS DISTINCT FROM COALESCE((
                    SELECT jsonb_agg(jsonb_build_array(schedule."classroomId", schedule."dayOfWeek",
                                                      schedule."startTime", schedule."endTime")
                                     ORDER BY schedule."classroomId", schedule."dayOfWeek",
                                              schedule."startTime", schedule."endTime")
                    FROM academic."SectionSchedule" schedule
                    WHERE schedule."sectionId" = pair.historical_id
                ), '[]'::jsonb)
                """;
    }

    private static String gradeItemCopyMismatchesQuery() {
        return sectionPairsCte() + """
                SELECT COUNT(*)
                FROM section_pairs pair
                WHERE COALESCE((
                    SELECT jsonb_agg(jsonb_build_array(item."name", item."type", item."maxScore",
                                                      item."weight", item."gradedAt")
                                     ORDER BY item."type", item."name", item."maxScore",
                                              item."weight", item."gradedAt")
                    FROM academic."GradeItem" item
                    WHERE item."sectionId" = pair.source_id
                ), '[]'::jsonb) IS DISTINCT FROM COALESCE((
                    SELECT jsonb_agg(jsonb_build_array(item."name", item."type", item."maxScore",
                                                      item."weight", item."gradedAt")
                                     ORDER BY item."type", item."name", item."maxScore",
                                              item."weight", item."gradedAt")
                    FROM academic."GradeItem" item
                    WHERE item."sectionId" = pair.historical_id
                ), '[]'::jsonb)
                """;
    }

    private static List<String> transcript(Connection connection, String studentId) throws SQLException {
        String query = """
                SELECT enrollment."semesterId", semester."nameEn", course."code", enrollment."creditsSnapshot",
                       enrollment."letterGrade", enrollment."status"
                FROM academic."Enrollment" enrollment
                JOIN academic."Section" section ON section."id" = enrollment."sectionId"
                JOIN academic."Course" course ON course."id" = section."courseId"
                JOIN academic."Semester" semester ON semester."id" = enrollment."semesterId"
                WHERE enrollment."studentId" = ?
                  AND enrollment."gradeStatus" IN ('PUBLISHED', 'APPEALED')
                  AND (enrollment."id" LIKE 'enrollment-history-v27-%'
                       OR enrollment."id" LIKE 'enrollment-history-demo-%')
                ORDER BY semester."startDate", course."code", enrollment."id"
                """;
        Map<String, TranscriptAccumulator> semesters = new LinkedHashMap<>();
        try (var statement = connection.prepareStatement(query)) {
            statement.setString(1, studentId);
            try (ResultSet rows = statement.executeQuery()) {
                while (rows.next()) {
                    String semesterId = rows.getString(1);
                    TranscriptAccumulator semester = semesters.computeIfAbsent(semesterId,
                            ignored -> new TranscriptAccumulator(rowsString(rows, 1), rowsString(rows, 2)));
                    int credits = rows.getInt(4);
                    if (rows.wasNull()) credits = 0;
                    String letterGrade = rows.getString(5);
                    String status = rows.getString(6);
                    BigDecimal gradePoint = gradePoint(letterGrade);
                    if (gradePoint != null) {
                        semester.attemptedCredits += credits;
                        semester.gpaCredits += credits;
                        semester.weightedPoints = semester.weightedPoints.add(gradePoint.multiply(BigDecimal.valueOf(credits)));
                        if (!"F".equals(letterGrade)) semester.earnedCredits += credits;
                    } else if ("COMPLETED".equals(status)) {
                        semester.attemptedCredits += credits;
                        semester.earnedCredits += credits;
                    }
                }
            }
        }
        return semesters.values().stream().map(TranscriptAccumulator::snapshot).toList();
    }

    private static String rowsString(ResultSet rows, int column) {
        try {
            return rows.getString(column);
        } catch (SQLException failure) {
            throw new IllegalStateException(failure);
        }
    }

    private static BigDecimal gradePoint(String letterGrade) {
        if (letterGrade == null) return null;
        return switch (letterGrade) {
            case "A+", "A" -> new BigDecimal("4.0");
            case "A-" -> new BigDecimal("3.7");
            case "B+" -> new BigDecimal("3.5");
            case "B" -> new BigDecimal("3.0");
            case "B-" -> new BigDecimal("2.7");
            case "C+" -> new BigDecimal("2.5");
            case "C" -> new BigDecimal("2.0");
            case "C-" -> new BigDecimal("1.7");
            case "D+" -> new BigDecimal("1.5");
            case "D" -> new BigDecimal("1.0");
            case "D-" -> new BigDecimal("0.7");
            case "F" -> BigDecimal.ZERO;
            default -> null;
        };
    }

    private static List<RowsFingerprint> affectedFingerprints(Connection connection) throws SQLException {
        return List.of(
                fingerprint(connection, "academic.\"Enrollment\"", "\"id\" LIKE 'enrollment-history-v27-%'"),
                fingerprint(connection, "academic.\"StudentGrade\"", "\"enrollmentId\" LIKE 'enrollment-history-v27-%'"),
                fingerprint(connection, "academic.\"Section\"", "\"id\" LIKE 'section-hist-v161-%'"),
                fingerprint(connection, "academic.\"GradeItem\"", "\"id\" LIKE 'grade-hist-v161-%'"),
                fingerprint(connection, "academic.\"SectionSchedule\"", "\"id\" LIKE 'schedule-hist-v161-%'"));
    }

    private static RowsFingerprint fingerprint(Connection connection, String table, String predicate) throws SQLException {
        String query = "SELECT COUNT(*), md5(COALESCE(string_agg(to_jsonb(row_value)::text, E'\\n'"
                + " ORDER BY row_value.\"id\"), '')) FROM " + table + " row_value WHERE " + predicate;
        try (var statement = connection.createStatement(); ResultSet rows = statement.executeQuery(query)) {
            if (!rows.next()) throw new SQLException("Fingerprint query returned no row: " + table);
            return new RowsFingerprint(rows.getLong(1), rows.getString(2));
        }
    }

    private static void executeV161(Connection connection) throws Exception {
        try (InputStream resource = EnrollmentSectionSemesterRepairPostgresIT.class.getResourceAsStream(MIGRATION_RESOURCE)) {
            if (resource == null) throw new IllegalStateException("Missing migration resource " + MIGRATION_RESOURCE);
            String sql = new String(resource.readAllBytes(), StandardCharsets.UTF_8);
            try (Statement statement = connection.createStatement()) {
                statement.execute(sql);
            }
        }
    }

    private static List<String> rows(Connection connection, String query) throws SQLException {
        List<String> results = new ArrayList<>();
        try (var statement = connection.createStatement(); ResultSet rows = statement.executeQuery(query)) {
            int columns = rows.getMetaData().getColumnCount();
            while (rows.next()) {
                List<String> values = new ArrayList<>();
                for (int column = 1; column <= columns; column++) values.add(rows.getString(column));
                results.add(String.join("|", values));
            }
        }
        return results;
    }

    private static int count(Connection connection, String query) throws SQLException {
        try (var statement = connection.createStatement(); ResultSet rows = statement.executeQuery(query)) {
            if (!rows.next()) throw new SQLException("Count query returned no row");
            return rows.getInt(1);
        }
    }

    private static String quoteIdentifier(String identifier) {
        return "\"" + identifier.replace("\"", "\"\"") + "\"";
    }

    private static String required(String name) {
        String value = System.getenv(name);
        if (value == null || value.isBlank()) throw new IllegalStateException("Required disposable test setting: " + name);
        return value;
    }

    private record Snapshot(
            int historyEnrollments,
            int mismatchedEnrollments,
            int historyStudentGrades,
            List<String> sectionReferences,
            List<String> foreignKeyDependents,
            String originalSections,
            String currentTermEnrollments,
            int sourceGradeItems,
            int sourceSchedules,
            int copiedGradeItems,
            int copiedSchedules,
            int studentGradeSectionMismatches,
            int sectionCopyMismatches,
            int scheduleCopyMismatches,
            int gradeItemCopyMismatches,
            List<String> studentOneTranscript,
            List<String> studentTwoTranscript) {
    }

    private record RowsFingerprint(long count, String checksum) {
    }

    private static final class TranscriptAccumulator {
        private final String id;
        private final String name;
        private int attemptedCredits;
        private int earnedCredits;
        private int gpaCredits;
        private BigDecimal weightedPoints = BigDecimal.ZERO;

        private TranscriptAccumulator(String id, String name) {
            this.id = id;
            this.name = name;
        }

        private String snapshot() {
            BigDecimal gpa = gpaCredits == 0 ? null
                    : weightedPoints.divide(BigDecimal.valueOf(gpaCredits), 2, RoundingMode.HALF_UP);
            return id + "|" + name + "|attemptedCredits=" + attemptedCredits
                    + "|earnedCredits=" + earnedCredits + "|gpa=" + (gpa == null ? "null" : gpa.toPlainString());
        }
    }
}
