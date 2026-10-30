package io.campuscore.restfulapi.academic.registration;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.HexFormat;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;

@SpringBootTest
@ActiveProfiles({"test", "persistence"})
@TestPropertySource(properties = {
        "spring.flyway.enabled=false",
        "spring.datasource.url=jdbc:h2:mem:registration_slip_content;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1"
})
class RegistrationSlipContentPersistenceTest {

    private static final String STUDENT_ID = "student-1";
    private static final String SEMESTER_ID = "semester-1";
    private static final String ROUND_ID = "round-1";

    @Autowired
    private JdbcTemplate jdbc;

    @Autowired
    private RegistrationService registrationService;

    @Autowired
    private RegistrationPdfRenderer pdfRenderer;

    @BeforeEach
    void prepareFixture() {
        jdbc.execute("CREATE SCHEMA IF NOT EXISTS \"campuscore_auth\"");
        jdbc.execute("CREATE SCHEMA IF NOT EXISTS \"academic\"");
        createTables();
        clearTables();

        jdbc.update(
                "INSERT INTO \"campuscore_auth\".\"User\" (\"id\", \"email\", \"firstName\", \"lastName\") VALUES (?, ?, ?, ?)",
                "student-user-1", "student1@campuscore.edu", "An", "Student");
        jdbc.update(
                "INSERT INTO \"academic\".\"Student\" (\"id\", \"userId\", \"studentId\", \"curriculumId\", \"year\", \"status\") VALUES (?, ?, ?, ?, ?, ?)",
                STUDENT_ID, "student-user-1", "S001", "curriculum-1", 2, "ACTIVE");
        jdbc.update(
                "INSERT INTO \"academic\".\"Semester\" (\"id\", \"name\", \"nameEn\", \"nameVi\", \"startDate\") VALUES (?, ?, ?, ?, ?)",
                SEMESTER_ID, "Fall 2026", "Fall 2026", "Hoc ky Thu 2026", Timestamp.from(Instant.now()));
        jdbc.update(
                "INSERT INTO \"academic\".\"RegistrationRound\""
                        + " (\"id\", \"semesterId\", \"kind\", \"status\", \"windowStart\", \"windowEnd\", \"creditLimit\")"
                        + " VALUES (?, ?, ?, ?, ?, ?, ?)",
                ROUND_ID,
                SEMESTER_ID,
                "REGISTRATION",
                "OPEN",
                Timestamp.from(Instant.now().minus(1, ChronoUnit.DAYS)),
                Timestamp.from(Instant.now().plus(1, ChronoUnit.DAYS)),
                28);
    }

    @Test
    void cachedSlipAfterTwoEnrollmentsContainsBothCoursesAndTheirCredits() throws Exception {
        enrollCourse("course-a", "SE101", "section-a", 3, "enroll-a");
        enrollCourse("course-b", "CS201", "section-b", 4, "enroll-b");

        RegistrationService.SlipPayload cached = registrationService.slip(STUDENT_ID, SEMESTER_ID);
        String text = extractPdfText(cached.payload());

        assertThat(text).contains("SE101", "CS201", "7 TC");
        assertThat(registrationService.slip(STUDENT_ID, SEMESTER_ID).sha256()).isEqualTo(cached.sha256());
    }

    @Test
    void uncachedSlipAfterTwoEnrollmentsContainsBothCoursesAndTheirCredits() throws Exception {
        enrollCourse("course-a", "SE101", "section-a", 3, "uncached-a");
        enrollCourse("course-b", "CS201", "section-b", 4, "uncached-b");
        jdbc.update("DELETE FROM \"academic\".\"RegistrationSlip\" WHERE \"studentId\" = ?", STUDENT_ID);

        String text = extractPdfText(registrationService.slip(STUDENT_ID, SEMESTER_ID).payload());

        assertThat(text).contains("SE101", "CS201", "7 TC");
    }

    @Test
    void validLegacyPlaceholderCacheDoesNotHideTheActiveRoster() throws Exception {
        enrollCourse("course-a", "SE101", "section-a", 3, "legacy-a");
        enrollCourse("course-b", "CS201", "section-b", 4, "legacy-b");
        byte[] placeholder = pdfRenderer.render(STUDENT_ID, SEMESTER_ID, "legacy-enrollment", "legacy-section");
        jdbc.update(
                "INSERT INTO \"academic\".\"RegistrationSlip\""
                        + " (\"id\", \"studentId\", \"semesterId\", \"roundId\", \"sha256\", \"byteSize\", \"payload\", \"createdAt\")"
                        + " VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                "legacy-slip",
                STUDENT_ID,
                SEMESTER_ID,
                ROUND_ID,
                sha256(placeholder),
                placeholder.length,
                placeholder,
                Timestamp.valueOf("2035-01-01 00:00:00"));

        String text = extractPdfText(registrationService.slip(STUDENT_ID, SEMESTER_ID).payload());

        assertThat(text).contains("SE101", "CS201", "7 TC");
        assertThat(jdbc.queryForObject(
                        "SELECT COUNT(*) FROM \"academic\".\"RegistrationSlip\" WHERE \"id\" = ?",
                        Integer.class,
                        "legacy-slip"))
                .isZero();
    }

    @Test
    void serviceEnrollmentPathRendersAllThirteenCoursesAcrossPages() throws Exception {
        for (int index = 1; index <= 13; index++) {
            String suffix = String.format("%02d", index);
            enrollCourse("course-" + suffix, "COURSE-" + suffix, "section-" + suffix, 1, "multi-" + suffix);
        }

        String text = extractPdfText(registrationService.slip(STUDENT_ID, SEMESTER_ID).payload());

        for (int index = 1; index <= 13; index++) {
            assertThat(text).contains("COURSE-" + String.format("%02d", index));
        }
        assertThat(text).contains("__PAGE_COUNT__=2", "13 TC");
    }

    private void enrollCourse(String courseId, String courseCode, String sectionId, int credits, String key) {
        jdbc.update(
                "INSERT INTO \"academic\".\"Course\" (\"id\", \"code\", \"name\", \"nameEn\", \"nameVi\", \"credits\") VALUES (?, ?, ?, ?, ?, ?)",
                courseId, courseCode, "Course " + courseCode, "Course " + courseCode, "Course " + courseCode, credits);
        jdbc.update(
                "INSERT INTO \"academic\".\"Section\""
                        + " (\"id\", \"sectionNumber\", \"courseId\", \"semesterId\", \"capacity\", \"enrolledCount\", \"status\")"
                        + " VALUES (?, ?, ?, ?, ?, ?, ?)",
                sectionId, "01", courseId, SEMESTER_ID, 35, 0, "OPEN");

        registrationService.enroll(STUDENT_ID, sectionId, List.of("STUDENT"), key);
    }

    private static String extractPdfText(byte[] payload) throws Exception {
        Path file = Files.createTempFile("registration-slip-content-", ".pdf");
        try {
            Files.write(file, payload);
            Process process = new ProcessBuilder(
                    "python",
                    "-c",
                    "import sys; from pypdf import PdfReader; reader=PdfReader(sys.argv[1]); "
                            + "print('__PAGE_COUNT__=' + str(len(reader.pages))); "
                            + "print('\\n'.join(page.extract_text() or '' for page in reader.pages))",
                    file.toString())
                    .redirectErrorStream(true)
                    .start();
            String output = new String(process.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
            int exitCode = process.waitFor();
            assertThat(exitCode).withFailMessage("PDF parser failed: %s", output).isZero();
            return output;
        } finally {
            Files.deleteIfExists(file);
        }
    }

    private static String sha256(byte[] value) throws Exception {
        return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value));
    }

    private void createTables() {
        jdbc.execute("CREATE TABLE IF NOT EXISTS \"campuscore_auth\".\"User\" (\"id\" VARCHAR(120) PRIMARY KEY, \"email\" VARCHAR(200) NOT NULL, \"firstName\" VARCHAR(120) NOT NULL, \"lastName\" VARCHAR(120) NOT NULL)");
        jdbc.execute("CREATE TABLE IF NOT EXISTS \"academic\".\"Student\" (\"id\" VARCHAR(120) PRIMARY KEY, \"userId\" VARCHAR(120) NOT NULL, \"studentId\" VARCHAR(120) NOT NULL, \"curriculumId\" VARCHAR(120) NOT NULL, \"year\" INTEGER NOT NULL, \"status\" VARCHAR(40) NOT NULL)");
        jdbc.execute("CREATE TABLE IF NOT EXISTS \"academic\".\"Semester\" (\"id\" VARCHAR(120) PRIMARY KEY, \"name\" VARCHAR(120) NOT NULL, \"nameEn\" VARCHAR(120), \"nameVi\" VARCHAR(120), \"startDate\" TIMESTAMP)");
        jdbc.execute("CREATE TABLE IF NOT EXISTS \"academic\".\"Course\" (\"id\" VARCHAR(120) PRIMARY KEY, \"code\" VARCHAR(40) NOT NULL, \"name\" VARCHAR(200) NOT NULL, \"nameEn\" VARCHAR(200), \"nameVi\" VARCHAR(200), \"credits\" INTEGER NOT NULL)");
        jdbc.execute("CREATE TABLE IF NOT EXISTS \"academic\".\"Section\" (\"id\" VARCHAR(120) PRIMARY KEY, \"sectionNumber\" VARCHAR(40) NOT NULL, \"courseId\" VARCHAR(120) NOT NULL, \"semesterId\" VARCHAR(120) NOT NULL, \"lecturerId\" VARCHAR(120), \"classroomId\" VARCHAR(120), \"capacity\" INTEGER NOT NULL, \"enrolledCount\" INTEGER NOT NULL, \"status\" VARCHAR(40) NOT NULL, \"version\" INTEGER NOT NULL DEFAULT 0, \"updatedAt\" TIMESTAMP DEFAULT CURRENT_TIMESTAMP)");
        jdbc.execute("CREATE TABLE IF NOT EXISTS \"academic\".\"SectionSchedule\" (\"id\" VARCHAR(120) PRIMARY KEY, \"sectionId\" VARCHAR(120) NOT NULL, \"classroomId\" VARCHAR(120) NOT NULL, \"dayOfWeek\" INTEGER NOT NULL, \"startTime\" VARCHAR(20) NOT NULL, \"endTime\" VARCHAR(20) NOT NULL)");
        jdbc.execute("CREATE TABLE IF NOT EXISTS \"academic\".\"Classroom\" (\"id\" VARCHAR(120) PRIMARY KEY, \"building\" VARCHAR(120) NOT NULL, \"roomNumber\" VARCHAR(120) NOT NULL)");
        jdbc.execute("CREATE TABLE IF NOT EXISTS \"academic\".\"Lecturer\" (\"id\" VARCHAR(120) PRIMARY KEY, \"userId\" VARCHAR(120) NOT NULL, \"departmentId\" VARCHAR(120) NOT NULL, \"employeeId\" VARCHAR(120) NOT NULL, \"isActive\" BOOLEAN NOT NULL)");
        jdbc.execute("CREATE TABLE IF NOT EXISTS \"academic\".\"RegistrationRound\" (\"id\" VARCHAR(120) PRIMARY KEY, \"semesterId\" VARCHAR(120) NOT NULL, \"kind\" VARCHAR(40) NOT NULL, \"status\" VARCHAR(40) NOT NULL, \"windowStart\" TIMESTAMP NOT NULL, \"windowEnd\" TIMESTAMP NOT NULL, \"creditLimit\" INTEGER NOT NULL)");
        jdbc.execute("CREATE TABLE IF NOT EXISTS \"academic\".\"RegistrationRoundCohort\" (\"id\" VARCHAR(120) PRIMARY KEY, \"roundId\" VARCHAR(120) NOT NULL, \"curriculumId\" VARCHAR(120), \"year\" INTEGER, \"departmentId\" VARCHAR(120))");
        jdbc.execute("CREATE TABLE IF NOT EXISTS \"academic\".\"CreditLimitApplication\" (\"id\" VARCHAR(120) PRIMARY KEY, \"studentId\" VARCHAR(120) NOT NULL, \"roundId\" VARCHAR(120) NOT NULL, \"requestedLimit\" INTEGER NOT NULL, \"status\" VARCHAR(24) NOT NULL, \"reviewedAt\" TIMESTAMP)");
        jdbc.execute("CREATE TABLE IF NOT EXISTS \"academic\".\"CourseRequirement\" (\"id\" VARCHAR(120) PRIMARY KEY, \"courseId\" VARCHAR(120) NOT NULL, \"requiredCourseId\" VARCHAR(120) NOT NULL, \"kind\" VARCHAR(16) NOT NULL, \"minLetterGrade\" VARCHAR(16))");
        jdbc.execute("CREATE TABLE IF NOT EXISTS \"academic\".\"Enrollment\" (\"id\" VARCHAR(120) PRIMARY KEY, \"studentId\" VARCHAR(120) NOT NULL, \"sectionId\" VARCHAR(120) NOT NULL, \"semesterId\" VARCHAR(120) NOT NULL, \"status\" VARCHAR(40) NOT NULL, \"enrolledAt\" TIMESTAMP NOT NULL, \"droppedAt\" TIMESTAMP, \"gradeStatus\" VARCHAR(40) NOT NULL, \"finalGrade\" DECIMAL(5,2), \"letterGrade\" VARCHAR(10), \"courseId\" VARCHAR(120) NOT NULL, \"roundId\" VARCHAR(120), \"creditsSnapshot\" INTEGER NOT NULL, \"version\" INTEGER NOT NULL DEFAULT 0, \"createdAt\" TIMESTAMP DEFAULT CURRENT_TIMESTAMP, \"updatedAt\" TIMESTAMP DEFAULT CURRENT_TIMESTAMP)");
        jdbc.execute("CREATE TABLE IF NOT EXISTS \"academic\".\"RegistrationIdempotency\" (\"id\" VARCHAR(120) PRIMARY KEY, \"ownerId\" VARCHAR(120) NOT NULL, \"idempotencyKey\" VARCHAR(200) NOT NULL, \"requestHash\" CHAR(64) NOT NULL, \"state\" VARCHAR(40) NOT NULL, \"enrollmentId\" VARCHAR(120), \"responseBody\" TEXT, \"slipSha256\" CHAR(64), \"version\" INTEGER NOT NULL DEFAULT 0, \"createdAt\" TIMESTAMP DEFAULT CURRENT_TIMESTAMP, \"updatedAt\" TIMESTAMP DEFAULT CURRENT_TIMESTAMP, UNIQUE (\"ownerId\", \"idempotencyKey\"))");
        jdbc.execute("CREATE TABLE IF NOT EXISTS \"academic\".\"EnrollmentEvent\" (\"id\" VARCHAR(120) PRIMARY KEY, \"enrollmentId\" VARCHAR(120) NOT NULL, \"studentId\" VARCHAR(120) NOT NULL, \"sectionId\" VARCHAR(120) NOT NULL, \"action\" VARCHAR(16) NOT NULL, \"actorId\" VARCHAR(120) NOT NULL, \"requestHash\" CHAR(64), \"createdAt\" TIMESTAMP DEFAULT CURRENT_TIMESTAMP)");
        jdbc.execute("CREATE TABLE IF NOT EXISTS \"academic\".\"RegistrationSlip\" (\"id\" VARCHAR(120) PRIMARY KEY, \"studentId\" VARCHAR(120) NOT NULL, \"semesterId\" VARCHAR(120) NOT NULL, \"roundId\" VARCHAR(120) NOT NULL, \"sha256\" CHAR(64) NOT NULL, \"byteSize\" INTEGER NOT NULL, \"payload\" BYTEA NOT NULL, \"createdAt\" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)");
    }

    private void clearTables() {
        jdbc.update("DELETE FROM \"academic\".\"RegistrationSlip\"");
        jdbc.update("DELETE FROM \"academic\".\"EnrollmentEvent\"");
        jdbc.update("DELETE FROM \"academic\".\"RegistrationIdempotency\"");
        jdbc.update("DELETE FROM \"academic\".\"Enrollment\"");
        jdbc.update("DELETE FROM \"academic\".\"SectionSchedule\"");
        jdbc.update("DELETE FROM \"academic\".\"CourseRequirement\"");
        jdbc.update("DELETE FROM \"academic\".\"RegistrationRoundCohort\"");
        jdbc.update("DELETE FROM \"academic\".\"CreditLimitApplication\"");
        jdbc.update("DELETE FROM \"academic\".\"Section\"");
        jdbc.update("DELETE FROM \"academic\".\"Course\"");
        jdbc.update("DELETE FROM \"academic\".\"RegistrationRound\"");
        jdbc.update("DELETE FROM \"academic\".\"Semester\"");
        jdbc.update("DELETE FROM \"academic\".\"Student\"");
        jdbc.update("DELETE FROM \"academic\".\"Lecturer\"");
        jdbc.update("DELETE FROM \"academic\".\"Classroom\"");
        jdbc.update("DELETE FROM \"campuscore_auth\".\"User\"");
    }
}
