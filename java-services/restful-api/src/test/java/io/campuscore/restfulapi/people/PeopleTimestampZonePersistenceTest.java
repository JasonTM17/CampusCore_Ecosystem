package io.campuscore.restfulapi.people;

import static org.assertj.core.api.Assertions.assertThat;

import io.campuscore.restfulapi.people.repository.PeopleReadRepository;
import io.campuscore.restfulapi.people.web.PeopleReadDtos.LecturerResponse;
import io.campuscore.restfulapi.people.web.PeopleReadDtos.StudentResponse;
import java.sql.Types;
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
 * Every directory read serializes a UTC {@link Instant}. A
 * {@code java.sql.Timestamp} already represents an instant, so the mapper must
 * use {@code toInstant()} instead of reinterpreting its local wall-clock fields
 * as UTC. These reads run under UTC, a UTC+7 campus zone and a DST zone against
 * production-shaped {@code TIMESTAMP WITH TIME ZONE} fixtures.
 */
@SpringBootTest
@ActiveProfiles({"test", "persistence"})
@TestPropertySource(properties = {
        "spring.flyway.enabled=false",
        "spring.datasource.url=jdbc:h2:mem:people_timestamp_zones;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1"
})
class PeopleTimestampZonePersistenceTest {

    private static final List<String> ZONES = List.of("UTC", "Asia/Ho_Chi_Minh", "America/New_York");
    private static final Instant ADMISSION_DATE = Instant.parse("2025-08-20T00:00:00Z");
    // 2026-03-08T07:00Z is the America/New_York spring-forward window.
    private static final Instant FIXTURE_TIME = Instant.parse("2026-03-08T07:00:00Z");

    @Autowired
    private JdbcTemplate jdbc;

    @Autowired
    private PeopleReadRepository people;

    @BeforeEach
    void prepareZonedFixture() {
        jdbc.execute("CREATE SCHEMA IF NOT EXISTS \"campuscore_auth\"");
        jdbc.execute("CREATE SCHEMA IF NOT EXISTS \"academic\"");
        createTables();
        clearTables();
        insertFixture();
    }

    @Test
    void studentTimestampsKeepTheSameInstantInEveryJvmZone() {
        List<StudentResponse> reads =
                readInEveryZone(zone -> people.findStudentById("student-1").orElseThrow());

        assertThat(reads).hasSize(ZONES.size()).allSatisfy(row -> {
            assertThat(row.admissionDate()).isEqualTo(ADMISSION_DATE);
            assertThat(row.createdAt()).isEqualTo(FIXTURE_TIME);
            assertThat(row.updatedAt()).isEqualTo(FIXTURE_TIME);
        });
    }

    @Test
    void lecturerTimestampsKeepTheSameInstantInEveryJvmZone() {
        List<LecturerResponse> reads =
                readInEveryZone(zone -> people.findLecturerById("lecturer-1").orElseThrow());

        assertThat(reads).hasSize(ZONES.size()).allSatisfy(row -> {
            assertThat(row.createdAt()).isEqualTo(FIXTURE_TIME);
            assertThat(row.updatedAt()).isEqualTo(FIXTURE_TIME);
        });
    }

    @Test
    void directoryListTimestampsKeepTheSameInstantInEveryJvmZone() {
        List<List<StudentResponse>> studentLists =
                readInEveryZone(zone -> people.findStudents(0, 10, null));
        List<List<LecturerResponse>> lecturerLists =
                readInEveryZone(zone -> people.findLecturers(0, 10, null));

        assertThat(studentLists).hasSize(ZONES.size()).allSatisfy(rows -> {
            assertThat(rows).hasSize(1);
            assertThat(rows.getFirst().admissionDate()).isEqualTo(ADMISSION_DATE);
            assertThat(rows.getFirst().createdAt()).isEqualTo(FIXTURE_TIME);
        });
        assertThat(lecturerLists).hasSize(ZONES.size()).allSatisfy(rows -> {
            assertThat(rows).hasSize(1);
            assertThat(rows.getFirst().createdAt()).isEqualTo(FIXTURE_TIME);
            assertThat(rows.getFirst().updatedAt()).isEqualTo(FIXTURE_TIME);
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
                    "email" VARCHAR(320) NOT NULL,
                    "firstName" VARCHAR(120) NOT NULL,
                    "lastName" VARCHAR(120) NOT NULL
                )
                """);
        jdbc.execute("""
                CREATE TABLE IF NOT EXISTS "academic"."Department" (
                    "id" VARCHAR(120) PRIMARY KEY,
                    "code" VARCHAR(40) NOT NULL,
                    "name" VARCHAR(200) NOT NULL,
                    "facultyId" VARCHAR(120)
                )
                """);
        jdbc.execute("""
                CREATE TABLE IF NOT EXISTS "academic"."Curriculum" (
                    "id" VARCHAR(120) PRIMARY KEY,
                    "code" VARCHAR(40) NOT NULL,
                    "name" VARCHAR(200) NOT NULL,
                    "departmentId" VARCHAR(120) NOT NULL
                )
                """);
        jdbc.execute("""
                CREATE TABLE IF NOT EXISTS "academic"."Student" (
                    "id" VARCHAR(120) PRIMARY KEY,
                    "userId" VARCHAR(120) UNIQUE NOT NULL,
                    "studentId" VARCHAR(120) UNIQUE NOT NULL,
                    "curriculumId" VARCHAR(120) NOT NULL,
                    "year" INTEGER NOT NULL,
                    "status" VARCHAR(40) NOT NULL,
                    "admissionDate" TIMESTAMP WITH TIME ZONE NOT NULL,
                    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL,
                    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL
                )
                """);
        jdbc.execute("""
                CREATE TABLE IF NOT EXISTS "academic"."Lecturer" (
                    "id" VARCHAR(120) PRIMARY KEY,
                    "userId" VARCHAR(120) UNIQUE NOT NULL,
                    "departmentId" VARCHAR(120) NOT NULL,
                    "employeeId" VARCHAR(120) UNIQUE NOT NULL,
                    "title" VARCHAR(120),
                    "specialization" VARCHAR(200),
                    "office" VARCHAR(120),
                    "phone" VARCHAR(80),
                    "isActive" BOOLEAN NOT NULL,
                    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL,
                    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL
                )
                """);
    }

    private void clearTables() {
        jdbc.update("DELETE FROM \"academic\".\"Student\"");
        jdbc.update("DELETE FROM \"academic\".\"Lecturer\"");
        jdbc.update("DELETE FROM \"academic\".\"Curriculum\"");
        jdbc.update("DELETE FROM \"academic\".\"Department\"");
        jdbc.update("DELETE FROM \"campuscore_auth\".\"User\"");
    }

    private void insertFixture() {
        jdbc.update("INSERT INTO \"campuscore_auth\".\"User\" (\"id\", \"email\", \"firstName\", \"lastName\")"
                        + " VALUES (?, ?, ?, ?)",
                "student-user", "student@campuscore.edu", "An", "Student");
        jdbc.update("INSERT INTO \"campuscore_auth\".\"User\" (\"id\", \"email\", \"firstName\", \"lastName\")"
                        + " VALUES (?, ?, ?, ?)",
                "lecturer-user", "lecturer@campuscore.edu", "Lan", "Lecturer");
        jdbc.update("INSERT INTO \"academic\".\"Department\" (\"id\", \"code\", \"name\", \"facultyId\")"
                        + " VALUES (?, ?, ?, ?)",
                "department-1", "CS", "Computer Science", "faculty-1");
        jdbc.update("INSERT INTO \"academic\".\"Curriculum\" (\"id\", \"code\", \"name\", \"departmentId\")"
                        + " VALUES (?, ?, ?, ?)",
                "curriculum-1", "CS2024", "Computer Science 2024", "department-1");
        zonedUpdate("INSERT INTO \"academic\".\"Student\""
                        + " (\"id\", \"userId\", \"studentId\", \"curriculumId\", \"year\", \"status\","
                        + " \"admissionDate\", \"createdAt\", \"updatedAt\")"
                        + " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                "student-1", "student-user", "S001", "curriculum-1", 2, "ACTIVE",
                ADMISSION_DATE, FIXTURE_TIME, FIXTURE_TIME);
        zonedUpdate("INSERT INTO \"academic\".\"Lecturer\""
                        + " (\"id\", \"userId\", \"departmentId\", \"employeeId\", \"title\","
                        + " \"specialization\", \"office\", \"phone\", \"isActive\", \"createdAt\", \"updatedAt\")"
                        + " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                "lecturer-1", "lecturer-user", "department-1", "L001", "Dr.",
                "Distributed Systems", "A-101", "+84123456789", true, FIXTURE_TIME, FIXTURE_TIME);
    }

    private void zonedUpdate(String sql, Object... values) {
        jdbc.execute((ConnectionCallback<Void>) connection -> {
            try (var statement = connection.prepareStatement(sql)) {
                for (int index = 0; index < values.length; index++) {
                    Object value = values[index];
                    if (value instanceof Instant instant) {
                        statement.setObject(index + 1,
                                OffsetDateTime.ofInstant(instant, ZoneOffset.UTC),
                                Types.TIMESTAMP_WITH_TIMEZONE);
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
