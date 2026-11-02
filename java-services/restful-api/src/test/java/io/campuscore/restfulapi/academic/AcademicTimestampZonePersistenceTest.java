package io.campuscore.restfulapi.academic;

import static org.assertj.core.api.Assertions.assertThat;

import io.campuscore.restfulapi.academic.repository.AcademicEnrollmentReadRepository;
import io.campuscore.restfulapi.academic.repository.AcademicEnrollmentReadRepository.EnrollmentRow;
import io.campuscore.restfulapi.academic.repository.AcademicEnrollmentReadRepository.GradeItemRow;
import io.campuscore.restfulapi.academic.repository.AcademicReadRepository;
import io.campuscore.restfulapi.academic.repository.AcademicSectionReadRepository;
import io.campuscore.restfulapi.academic.repository.AcademicSectionReadRepository.SectionRow;
import io.campuscore.restfulapi.academic.web.AcademicReadDtos.SemesterResponse;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.TimeZone;
import java.util.function.Function;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.ConnectionCallback;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;

/**
 * DSJ-02: every academic read serializes a UTC {@link Instant}. A
 * {@code java.sql.Timestamp} already represents an instant, so the mapper must
 * use {@code toInstant()} instead of reinterpreting its local wall-clock fields
 * as UTC. These reads run under UTC, a UTC+7 campus zone and a DST zone against
 * production-shaped {@code TIMESTAMP WITH TIME ZONE} fixtures.
 */
@SpringBootTest
@ActiveProfiles({"test", "persistence"})
@TestPropertySource(properties = {
        "spring.flyway.enabled=false",
        "spring.datasource.url=jdbc:h2:mem:academic_timestamp_zones;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1"
})
class AcademicTimestampZonePersistenceTest {

    private static final List<String> ZONES = List.of("UTC", "Asia/Ho_Chi_Minh", "America/New_York");
    private static final Instant SEMESTER_START = Instant.parse("2026-09-01T00:00:00Z");
    private static final Instant SEMESTER_END = Instant.parse("2027-01-15T00:00:00Z");
    // 2026-03-08T07:00Z is the America/New_York spring-forward window.
    private static final Instant ENROLLED_AT = Instant.parse("2026-03-08T07:00:00Z");
    private static final Instant GRADED_AT = Instant.parse("2026-03-09T12:30:00Z");
    private static final Instant FIXTURE_TIME = Instant.parse("2026-01-05T08:15:00Z");

    @Autowired
    private JdbcTemplate jdbc;

    @Autowired
    private AcademicReadRepository academic;

    @Autowired
    private AcademicEnrollmentReadRepository enrollments;

    @Autowired
    private AcademicSectionReadRepository sections;

    @BeforeEach
    void prepareZonedFixture() {
        jdbc.execute("CREATE SCHEMA IF NOT EXISTS \"campuscore_auth\"");
        jdbc.execute("CREATE SCHEMA IF NOT EXISTS \"academic\"");
        createTables();
        clearTables();
        insertFixture();
    }

    @Test
    void semesterBoundariesKeepTheSameInstantAndNullsInEveryJvmZone() {
        List<SemesterResponse> reads = readInEveryZone(
                zone -> academic.findSemesterById("semester-1").orElseThrow());

        assertThat(reads).hasSize(ZONES.size()).allSatisfy(semester -> {
            assertThat(semester.startDate()).isEqualTo(SEMESTER_START);
            assertThat(semester.endDate()).isEqualTo(SEMESTER_END);
            assertThat(semester.registrationStart()).isNull();
            assertThat(semester.registrationEnd()).isNull();
            assertThat(semester.addDropStart()).isNull();
            assertThat(semester.addDropEnd()).isNull();
            assertThat(semester.createdAt()).isEqualTo(FIXTURE_TIME);
        });
    }

    @Test
    void enrollmentTimestampsKeepTheSameInstantInEveryJvmZone() {
        List<EnrollmentRow> reads = readInEveryZone(
                zone -> enrollments.findEnrollmentById("enrollment-1").orElseThrow());

        assertThat(reads).hasSize(ZONES.size()).allSatisfy(row -> {
            assertThat(row.enrolledAt()).isEqualTo(ENROLLED_AT);
            assertThat(row.droppedAt()).isNull();
            assertThat(row.createdAt()).isEqualTo(FIXTURE_TIME);
            assertThat(row.updatedAt()).isEqualTo(FIXTURE_TIME);
            assertThat(row.semesterStartDate()).isEqualTo(SEMESTER_START);
        });
    }

    @Test
    void sectionDatesKeepTheSameInstantInEveryJvmZone() {
        List<SectionRow> reads = readInEveryZone(
                zone -> sections.findSectionById("section-1").orElseThrow());

        assertThat(reads).hasSize(ZONES.size()).allSatisfy(row ->
                assertThat(row.semesterStartDate()).isEqualTo(SEMESTER_START));
    }

    @Test
    void gradeItemDatesKeepTheSameInstantAndNullGradedAtStaysNullInEveryJvmZone() {
        List<List<GradeItemRow>> reads = readInEveryZone(
                zone -> enrollments.findGradeItemsBySection("section-1"));

        assertThat(reads).hasSize(ZONES.size()).allSatisfy(items -> {
            assertThat(items).hasSize(2);
            GradeItemRow graded = items.stream()
                    .filter(item -> "graded".equals(item.id()))
                    .findFirst()
                    .orElseThrow();
            GradeItemRow ungraded = items.stream()
                    .filter(item -> "ungraded".equals(item.id()))
                    .findFirst()
                    .orElseThrow();
            assertThat(graded.gradedAt()).isEqualTo(GRADED_AT);
            assertThat(graded.createdAt()).isEqualTo(FIXTURE_TIME);
            assertThat(graded.semesterStartDate()).isEqualTo(SEMESTER_START);
            assertThat(ungraded.gradedAt()).isNull();
        });
    }

    /**
     * Restores the JVM default zone even when a read fails, so a broken run
     * cannot leak a zone into another test class sharing this JVM.
     */
    private <T> List<T> readInEveryZone(Function<String, T> read) {
        TimeZone original = TimeZone.getDefault();
        try {
            List<T> results = new ArrayList<>(ZONES.size());
            for (String zone : ZONES) {
                TimeZone.setDefault(TimeZone.getTimeZone(ZoneId.of(zone)));
                results.add(read.apply(zone));
            }
            return results;
        } finally {
            TimeZone.setDefault(original);
        }
    }

    private void createTables() {
        jdbc.execute("""
                CREATE TABLE IF NOT EXISTS "campuscore_auth"."User" (
                    "id" VARCHAR(120) PRIMARY KEY,
                    "email" VARCHAR(200) NOT NULL,
                    "firstName" VARCHAR(120) NOT NULL,
                    "lastName" VARCHAR(120) NOT NULL
                )
                """);
        jdbc.execute("""
                CREATE TABLE IF NOT EXISTS "academic"."Student" (
                    "id" VARCHAR(120) PRIMARY KEY,
                    "userId" VARCHAR(120) NOT NULL,
                    "studentId" VARCHAR(120) NOT NULL,
                    "curriculumId" VARCHAR(120) NOT NULL,
                    "year" INTEGER NOT NULL,
                    "status" VARCHAR(40) NOT NULL,
                    "admissionDate" TIMESTAMP WITH TIME ZONE NOT NULL,
                    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL,
                    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL
                )
                """);
        jdbc.execute("""
                CREATE TABLE IF NOT EXISTS "academic"."Department" (
                    "id" VARCHAR(120) PRIMARY KEY,
                    "name" VARCHAR(200) NOT NULL,
                    "nameEn" VARCHAR(200),
                    "nameVi" VARCHAR(200),
                    "code" VARCHAR(40) NOT NULL,
                    "facultyId" VARCHAR(120),
                    "isActive" BOOLEAN
                )
                """);
        jdbc.execute("""
                CREATE TABLE IF NOT EXISTS "academic"."Lecturer" (
                    "id" VARCHAR(120) PRIMARY KEY,
                    "userId" VARCHAR(120) NOT NULL,
                    "departmentId" VARCHAR(120) NOT NULL,
                    "employeeId" VARCHAR(120) NOT NULL,
                    "isActive" BOOLEAN NOT NULL
                )
                """);
        jdbc.execute("""
                CREATE TABLE IF NOT EXISTS "academic"."AcademicYear" (
                    "id" VARCHAR(120) PRIMARY KEY,
                    "year" INTEGER NOT NULL,
                    "startDate" TIMESTAMP WITH TIME ZONE NOT NULL,
                    "endDate" TIMESTAMP WITH TIME ZONE NOT NULL,
                    "isCurrent" BOOLEAN NOT NULL,
                    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL,
                    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL
                )
                """);
        jdbc.execute("""
                CREATE TABLE IF NOT EXISTS "academic"."Semester" (
                    "id" VARCHAR(120) PRIMARY KEY,
                    "name" VARCHAR(200) NOT NULL,
                    "nameEn" VARCHAR(200),
                    "nameVi" VARCHAR(200),
                    "type" VARCHAR(40) NOT NULL,
                    "academicYearId" VARCHAR(120) NOT NULL,
                    "startDate" TIMESTAMP WITH TIME ZONE NOT NULL,
                    "endDate" TIMESTAMP WITH TIME ZONE NOT NULL,
                    "registrationStart" TIMESTAMP WITH TIME ZONE,
                    "registrationEnd" TIMESTAMP WITH TIME ZONE,
                    "addDropStart" TIMESTAMP WITH TIME ZONE,
                    "addDropEnd" TIMESTAMP WITH TIME ZONE,
                    "status" VARCHAR(40) NOT NULL,
                    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL,
                    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL
                )
                """);
        jdbc.execute("""
                CREATE TABLE IF NOT EXISTS "academic"."Course" (
                    "id" VARCHAR(120) PRIMARY KEY,
                    "code" VARCHAR(40) NOT NULL,
                    "name" VARCHAR(200) NOT NULL,
                    "nameEn" VARCHAR(200),
                    "nameVi" VARCHAR(200),
                    "credits" INTEGER NOT NULL,
                    "departmentId" VARCHAR(120) NOT NULL,
                    "semesterId" VARCHAR(120),
                    "isActive" BOOLEAN NOT NULL,
                    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL,
                    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL
                )
                """);
        jdbc.execute("""
                CREATE TABLE IF NOT EXISTS "academic"."Classroom" (
                    "id" VARCHAR(120) PRIMARY KEY,
                    "building" VARCHAR(120) NOT NULL,
                    "roomNumber" VARCHAR(120) NOT NULL
                )
                """);
        jdbc.execute("""
                CREATE TABLE IF NOT EXISTS "academic"."Section" (
                    "id" VARCHAR(120) PRIMARY KEY,
                    "sectionNumber" VARCHAR(40) NOT NULL,
                    "courseId" VARCHAR(120) NOT NULL,
                    "semesterId" VARCHAR(120) NOT NULL,
                    "lecturerId" VARCHAR(120),
                    "classroomId" VARCHAR(120),
                    "capacity" INTEGER NOT NULL,
                    "enrolledCount" INTEGER NOT NULL,
                    "status" VARCHAR(40) NOT NULL
                )
                """);
        jdbc.execute("""
                CREATE TABLE IF NOT EXISTS "academic"."Enrollment" (
                    "id" VARCHAR(120) PRIMARY KEY,
                    "studentId" VARCHAR(120) NOT NULL,
                    "sectionId" VARCHAR(120) NOT NULL,
                    "semesterId" VARCHAR(120) NOT NULL,
                    "status" VARCHAR(40) NOT NULL,
                    "enrolledAt" TIMESTAMP WITH TIME ZONE NOT NULL,
                    "droppedAt" TIMESTAMP WITH TIME ZONE,
                    "gradeStatus" VARCHAR(40) NOT NULL,
                    "finalGrade" DECIMAL(5, 2),
                    "letterGrade" VARCHAR(10),
                    "creditsSnapshot" INTEGER NOT NULL,
                    "version" INTEGER NOT NULL DEFAULT 0,
                    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL,
                    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL
                )
                """);
        jdbc.execute("""
                CREATE TABLE IF NOT EXISTS "academic"."GradeItem" (
                    "id" VARCHAR(120) PRIMARY KEY,
                    "sectionId" VARCHAR(120) NOT NULL,
                    "name" VARCHAR(180) NOT NULL,
                    "type" VARCHAR(60) NOT NULL,
                    "maxScore" DECIMAL(5, 2) NOT NULL,
                    "weight" DECIMAL(5, 2) NOT NULL,
                    "gradedAt" TIMESTAMP WITH TIME ZONE,
                    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL
                )
                """);
    }

    private void clearTables() {
        jdbc.update("DELETE FROM \"academic\".\"GradeItem\"");
        jdbc.update("DELETE FROM \"academic\".\"Enrollment\"");
        jdbc.update("DELETE FROM \"academic\".\"Section\"");
        jdbc.update("DELETE FROM \"academic\".\"Classroom\"");
        jdbc.update("DELETE FROM \"academic\".\"Course\"");
        jdbc.update("DELETE FROM \"academic\".\"Semester\"");
        jdbc.update("DELETE FROM \"academic\".\"AcademicYear\"");
        jdbc.update("DELETE FROM \"academic\".\"Lecturer\"");
        jdbc.update("DELETE FROM \"academic\".\"Department\"");
        jdbc.update("DELETE FROM \"academic\".\"Student\"");
        jdbc.update("DELETE FROM \"campuscore_auth\".\"User\"");
    }

    private void insertFixture() {
        jdbc.update("INSERT INTO \"campuscore_auth\".\"User\" (\"id\", \"email\", \"firstName\", \"lastName\")"
                + " VALUES (?, ?, ?, ?)",
                "student-user", "student@campuscore.edu", "An", "Student");
        jdbc.update("INSERT INTO \"campuscore_auth\".\"User\" (\"id\", \"email\", \"firstName\", \"lastName\")"
                + " VALUES (?, ?, ?, ?)",
                "lecturer-user", "lecturer@campuscore.edu", "Lan", "Lecturer");
        zonedUpdate("INSERT INTO \"academic\".\"Student\""
                        + " (\"id\", \"userId\", \"studentId\", \"curriculumId\", \"year\", \"status\","
                        + " \"admissionDate\", \"createdAt\", \"updatedAt\")"
                        + " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                "student-1", "student-user", "S001", "curriculum-1", 2, "ACTIVE",
                FIXTURE_TIME, FIXTURE_TIME, FIXTURE_TIME);
        jdbc.update("INSERT INTO \"academic\".\"Department\""
                        + " (\"id\", \"name\", \"nameEn\", \"nameVi\", \"code\", \"facultyId\", \"isActive\")"
                        + " VALUES (?, ?, ?, ?, ?, ?, ?)",
                "department-1", "Computer Science", "Computer Science", "Khoa hoc may tinh", "CS", "faculty-1", true);
        jdbc.update("INSERT INTO \"academic\".\"Lecturer\""
                        + " (\"id\", \"userId\", \"departmentId\", \"employeeId\", \"isActive\")"
                        + " VALUES (?, ?, ?, ?, ?)",
                "lecturer-1", "lecturer-user", "department-1", "L001", true);
        zonedUpdate("INSERT INTO \"academic\".\"AcademicYear\""
                        + " (\"id\", \"year\", \"startDate\", \"endDate\", \"isCurrent\", \"createdAt\", \"updatedAt\")"
                        + " VALUES (?, ?, ?, ?, ?, ?, ?)",
                "ay-2026", 2026, SEMESTER_START.minusSeconds(31_536_000), SEMESTER_END, true,
                FIXTURE_TIME, FIXTURE_TIME);
        zonedUpdate("INSERT INTO \"academic\".\"Semester\""
                        + " (\"id\", \"name\", \"nameEn\", \"nameVi\", \"type\", \"academicYearId\", \"startDate\","
                        + " \"endDate\", \"registrationStart\", \"registrationEnd\", \"addDropStart\", \"addDropEnd\","
                        + " \"status\", \"createdAt\", \"updatedAt\")"
                        + " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                "semester-1", "Fall 2026", "Fall 2026", "Hoc ky Thu 2026", "FALL", "ay-2026",
                SEMESTER_START, SEMESTER_END, null, null, null, null, "ACTIVE", FIXTURE_TIME, FIXTURE_TIME);
        zonedUpdate("INSERT INTO \"academic\".\"Course\""
                        + " (\"id\", \"code\", \"name\", \"nameEn\", \"nameVi\", \"credits\", \"departmentId\","
                        + " \"semesterId\", \"isActive\", \"createdAt\", \"updatedAt\")"
                        + " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                "course-1", "CS101", "Intro", "Intro", "Nhap mon", 4, "department-1",
                "semester-1", true, FIXTURE_TIME, FIXTURE_TIME);
        jdbc.update("INSERT INTO \"academic\".\"Classroom\" (\"id\", \"building\", \"roomNumber\")"
                + " VALUES (?, ?, ?)", "room-1", "A", "A101");
        jdbc.update("INSERT INTO \"academic\".\"Section\""
                        + " (\"id\", \"sectionNumber\", \"courseId\", \"semesterId\", \"lecturerId\", \"classroomId\","
                        + " \"capacity\", \"enrolledCount\", \"status\")"
                        + " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                "section-1", "A", "course-1", "semester-1", "lecturer-1", "room-1", 30, 1, "OPEN");
        zonedUpdate("INSERT INTO \"academic\".\"Enrollment\""
                        + " (\"id\", \"studentId\", \"sectionId\", \"semesterId\", \"status\", \"enrolledAt\","
                        + " \"droppedAt\", \"gradeStatus\", \"finalGrade\", \"letterGrade\", \"creditsSnapshot\","
                        + " \"version\", \"createdAt\", \"updatedAt\")"
                        + " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                "enrollment-1", "student-1", "section-1", "semester-1", "CONFIRMED", ENROLLED_AT,
                null, "DRAFT", null, null, 4, 0, FIXTURE_TIME, FIXTURE_TIME);
        zonedUpdate("INSERT INTO \"academic\".\"GradeItem\""
                        + " (\"id\", \"sectionId\", \"name\", \"type\", \"maxScore\", \"weight\", \"gradedAt\", \"createdAt\")"
                        + " VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                "graded", "section-1", "Final", "FINAL", 100.00, 50.00, GRADED_AT, FIXTURE_TIME);
        zonedUpdate("INSERT INTO \"academic\".\"GradeItem\""
                        + " (\"id\", \"sectionId\", \"name\", \"type\", \"maxScore\", \"weight\", \"gradedAt\", \"createdAt\")"
                        + " VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                "ungraded", "section-1", "Midterm", "PROCESS", 100.00, 50.00, null, FIXTURE_TIME);
    }

    private void zonedUpdate(String sql, Object... values) {
        jdbc.execute((ConnectionCallback<Void>) connection -> {
            try (var statement = connection.prepareStatement(sql)) {
                for (int index = 0; index < values.length; index++) {
                    Object value = values[index];
                    if (value instanceof Instant instant) {
                        statement.setObject(index + 1,
                                OffsetDateTime.ofInstant(instant, ZoneOffset.UTC),
                                java.sql.Types.TIMESTAMP_WITH_TIMEZONE);
                    } else {
                        statement.setObject(index + 1, value);
                    }
                }
                statement.executeUpdate();
            }
            return null;
        });
    }
}
