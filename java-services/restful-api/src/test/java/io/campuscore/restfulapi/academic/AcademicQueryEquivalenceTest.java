package io.campuscore.restfulapi.academic;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import io.campuscore.restfulapi.academic.service.AcademicMutationService;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import javax.sql.DataSource;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.web.server.ResponseStatusException;

class AcademicQueryEquivalenceTest {

    private JdbcTemplate jdbc;
    private NamedParameterJdbcTemplate namedJdbc;
    private AcademicMutationService service;
    private AtomicInteger fetchSize;

    @BeforeEach
    void createFixture() {
        DriverManagerDataSource delegate = new DriverManagerDataSource(
                "jdbc:h2:mem:academic_query_equivalence_" + UUID.randomUUID()
                        + ";MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1",
                "sa",
                "");
        fetchSize = new AtomicInteger();
        DataSource observed = observeFetchSize(delegate, fetchSize);
        jdbc = new JdbcTemplate(observed);
        namedJdbc = new NamedParameterJdbcTemplate(jdbc);
        createTables();
        service = new AcademicMutationService(namedJdbc, null, null, null);
    }

    @Test
    void csvBytesMatchLegacyQueryForQuotesCommasNewlinesAndFormulaCells() {
        insertCsvFixture();

        List<Map<String, Object>> oldRows = namedJdbc.queryForList(
                "SELECT e.\"id\", student.\"studentId\" AS student_number,"
                        + " student_user.\"email\", student_user.\"firstName\", student_user.\"lastName\","
                        + " course.\"code\" AS course_code, course.\"name\" AS course_name,"
                        + " section.\"sectionNumber\", semester.\"name\" AS semester_name,"
                        + " e.\"status\", e.\"enrolledAt\", e.\"finalGrade\", e.\"letterGrade\""
                        + " FROM \"academic\".\"Enrollment\" e"
                        + " JOIN \"academic\".\"Student\" student ON student.\"id\" = e.\"studentId\""
                        + " JOIN \"campuscore_auth\".\"User\" student_user ON student_user.\"id\" = student.\"userId\""
                        + " JOIN \"academic\".\"Section\" section ON section.\"id\" = e.\"sectionId\""
                        + " JOIN \"academic\".\"Course\" course ON course.\"id\" = section.\"courseId\""
                        + " JOIN \"academic\".\"Semester\" semester ON semester.\"id\" = e.\"semesterId\""
                        + " ORDER BY e.\"enrolledAt\" DESC, e.\"id\" DESC LIMIT :exportLimit",
                Map.of("exportLimit", 50_001));

        String expected = legacyCsv(oldRows);
        String actual = service.exportEnrollments(null, null, null, null);

        assertThat(actual.getBytes(java.nio.charset.StandardCharsets.UTF_8))
                .isEqualTo(expected.getBytes(java.nio.charset.StandardCharsets.UTF_8));
        assertThat(fetchSize).hasValue(256);
    }

    @Test
    void csvReturnsExactly50000RowsAndRejects50001BeforeReturningAnyString() {
        insertCsvFixture();
        jdbc.update("""
                INSERT INTO \"academic\".\"Enrollment\"
                    (\"id\", \"studentId\", \"sectionId\", \"semesterId\", \"status\", \"enrolledAt\")
                SELECT 'bulk-' || "X", 'student-1', 'section-1', 'semester-1', 'ENROLLED',
                       TIMESTAMP '2026-08-21 00:00:00'
                FROM SYSTEM_RANGE(1, 49999)
                """);

        String accepted = service.exportEnrollments(null, null, null, null);
        assertThat(accepted.split("\\r\\n").length).isEqualTo(50_001);
        assertThat(fetchSize).hasValue(256);

        jdbc.update("""
                INSERT INTO \"academic\".\"Enrollment\"
                    (\"id\", \"studentId\", \"sectionId\", \"semesterId\", \"status\", \"enrolledAt\")
                VALUES ('bulk-50000', 'student-1', 'section-1', 'semester-1',
                        'ENROLLED', TIMESTAMP '2026-08-21 00:00:00')
                """);
        java.util.concurrent.atomic.AtomicReference<String> returned = new java.util.concurrent.atomic.AtomicReference<>();

        assertThatThrownBy(() -> returned.set(service.exportEnrollments(null, null, null, null)))
                .isInstanceOf(ResponseStatusException.class)
                .satisfies(error -> assertThat(((ResponseStatusException) error).getStatusCode().value()).isEqualTo(413));
        assertThat(returned).hasValue(null);
        assertThat(fetchSize).hasValue(256);
    }

    private void createTables() {
        jdbc.execute("CREATE SCHEMA \"campuscore_auth\"");
        jdbc.execute("CREATE SCHEMA \"academic\"");
        jdbc.execute("""
                CREATE TABLE \"campuscore_auth\".\"User\" (
                    \"id\" VARCHAR(120) PRIMARY KEY,
                    \"email\" VARCHAR(240),
                    \"firstName\" VARCHAR(240),
                    \"lastName\" VARCHAR(240)
                )
                """);
        jdbc.execute("""
                CREATE TABLE \"academic\".\"Student\" (
                    \"id\" VARCHAR(120) PRIMARY KEY,
                    \"userId\" VARCHAR(120),
                    \"studentId\" VARCHAR(120)
                )
                """);
        jdbc.execute("""
                CREATE TABLE \"academic\".\"Semester\" (
                    \"id\" VARCHAR(120) PRIMARY KEY,
                    \"name\" VARCHAR(400)
                )
                """);
        jdbc.execute("""
                CREATE TABLE \"academic\".\"Course\" (
                    \"id\" VARCHAR(120) PRIMARY KEY,
                    \"code\" VARCHAR(120),
                    \"name\" VARCHAR(400)
                )
                """);
        jdbc.execute("""
                CREATE TABLE \"academic\".\"Section\" (
                    \"id\" VARCHAR(120) PRIMARY KEY,
                    \"courseId\" VARCHAR(120),
                    \"sectionNumber\" VARCHAR(120)
                )
                """);
        jdbc.execute("""
                CREATE TABLE \"academic\".\"Enrollment\" (
                    \"id\" VARCHAR(120) PRIMARY KEY,
                    \"studentId\" VARCHAR(120),
                    \"sectionId\" VARCHAR(120),
                    \"semesterId\" VARCHAR(120),
                    \"status\" VARCHAR(40),
                    \"enrolledAt\" TIMESTAMP,
                    \"finalGrade\" DECIMAL(8, 2),
                    \"letterGrade\" VARCHAR(16)
                )
                """);
    }

    private void insertCsvFixture() {
        jdbc.update("INSERT INTO \"campuscore_auth\".\"User\""
                        + " (\"id\", \"email\", \"firstName\", \"lastName\") VALUES (?, ?, ?, ?)",
                "user-1", "student,\"mail\"\n@example.edu", "First\n=NAME()", "Last, \"Quoted\"");
        jdbc.update("INSERT INTO \"academic\".\"Student\" (\"id\", \"userId\", \"studentId\") VALUES (?, ?, ?)",
                "student-1", "user-1", "=SUM(1,2)");
        jdbc.update("INSERT INTO \"academic\".\"Semester\" (\"id\", \"name\") VALUES (?, ?)",
                "semester-1", "Fall, \"2026\"\nSemester");
        jdbc.update("INSERT INTO \"academic\".\"Course\" (\"id\", \"code\", \"name\") VALUES (?, ?, ?)",
                "course-1", "CS,101", "Course, \"Quoted\"\nsecond line");
        jdbc.update("INSERT INTO \"academic\".\"Section\" (\"id\", \"courseId\", \"sectionNumber\") VALUES (?, ?, ?)",
                "section-1", "course-1", "A,\"1\"\n");
        jdbc.update("INSERT INTO \"academic\".\"Enrollment\""
                        + " (\"id\", \"studentId\", \"sectionId\", \"semesterId\", \"status\", \"enrolledAt\", \"finalGrade\", \"letterGrade\")"
                        + " VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                "enrollment-1", "student-1", "section-1", "semester-1", "COMPLETED",
                java.sql.Timestamp.valueOf("2026-08-21 00:00:00"), new java.math.BigDecimal("92.50"), "A");
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

    private static DataSource observeFetchSize(DataSource delegate, AtomicInteger fetchSize) {
        return (DataSource) java.lang.reflect.Proxy.newProxyInstance(
                DataSource.class.getClassLoader(),
                new Class<?>[] {DataSource.class},
                (proxy, method, args) -> {
                    Object result = invoke(delegate, method, args);
                    if (!method.getName().equals("getConnection")) {
                        return result;
                    }
                    Connection connection = (Connection) result;
                    return java.lang.reflect.Proxy.newProxyInstance(
                            Connection.class.getClassLoader(),
                            new Class<?>[] {Connection.class},
                            (connectionProxy, connectionMethod, connectionArgs) -> {
                                Object statementResult = invoke(connection, connectionMethod, connectionArgs);
                                if (!connectionMethod.getName().equals("prepareStatement")
                                        || connectionArgs == null
                                        || connectionArgs.length == 0
                                        || !(connectionArgs[0] instanceof String)) {
                                    return statementResult;
                                }
                                PreparedStatement statement = (PreparedStatement) statementResult;
                                return java.lang.reflect.Proxy.newProxyInstance(
                                        PreparedStatement.class.getClassLoader(),
                                        new Class<?>[] {PreparedStatement.class},
                                        (statementProxy, statementMethod, statementArgs) -> {
                                            if (statementMethod.getName().equals("setFetchSize")) {
                                                fetchSize.set((Integer) statementArgs[0]);
                                            }
                                            return invoke(statement, statementMethod, statementArgs);
                                        });
                            });
                });
    }

    private static Object invoke(Object target, Method method, Object[] args) throws Throwable {
        try {
            return method.invoke(target, args);
        } catch (InvocationTargetException error) {
            throw error.getCause();
        }
    }
}
