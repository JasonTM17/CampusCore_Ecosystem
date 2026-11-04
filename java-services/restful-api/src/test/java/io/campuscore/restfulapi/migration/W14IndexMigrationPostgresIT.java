package io.campuscore.restfulapi.migration;

import static org.assertj.core.api.Assertions.assertThat;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIf;

/**
 * V146 index authority on a disposable PostgreSQL 15 database.
 *
 * <p>The six ordinary B-tree indexes trade read work for write maintenance:
 * every insert or key update pays index tuple, WAL and vacuum cost. This test
 * proves migration definitions, key order and planner eligibility only; it does
 * not measure production write throughput.
 */
@EnabledIf("localTargetsConfigured")
class W14IndexMigrationPostgresIT {
    private record IndexSpec(String schema, String table, List<String> columns, List<String> descending, String explain) {}

    private record IndexDefinition(String schema, String table, List<String> columns, List<String> descending,
                                   boolean valid, boolean unique, boolean partial, String definition) {}

    private static final Map<String, IndexSpec> INDEXES = Map.ofEntries(
            Map.entry("academic_enrollment_enrolled_at_idx", new IndexSpec("academic", "Enrollment",
                    List.of("enrolledAt", "id"), List.of("DESC", "DESC"),
                    "SELECT id FROM academic.\"Enrollment\" ORDER BY \"enrolledAt\" DESC, id DESC LIMIT 100")),
            Map.entry("academic_attendance_date_id_idx", new IndexSpec("academic", "Attendance",
                    List.of("date", "id"), List.of("DESC", "ASC"),
                    "SELECT id FROM academic.\"Attendance\" ORDER BY \"date\" DESC, id ASC LIMIT 100")),
            Map.entry("attendance_checkin_session_created_idx", new IndexSpec("academic", "AttendanceCheckin",
                    List.of("sessionId", "createdAt", "id"), List.of("ASC", "ASC", "ASC"),
                    "SELECT id FROM academic.\"AttendanceCheckin\" WHERE \"sessionId\"='session' ORDER BY \"createdAt\", id LIMIT 100")),
            Map.entry("thesis_topic_supervisor_lecturer_idx", new IndexSpec("thesis", "thesis_topic_supervisor",
                    List.of("lecturer_id"), List.of("ASC"),
                    "SELECT id FROM thesis.thesis_topic_supervisor WHERE lecturer_id='lecturer'")),
            Map.entry("thesis_group_member_student_idx", new IndexSpec("thesis", "thesis_group_member",
                    List.of("student_id"), List.of("ASC"),
                    "SELECT id FROM thesis.thesis_group_member WHERE student_id='student'")),
            Map.entry("notification_user_created_id_idx", new IndexSpec("notifications", "notification",
                    List.of("user_id", "created_at", "id"), List.of("ASC", "DESC", "DESC"),
                    "SELECT id FROM notifications.notification WHERE user_id='user' ORDER BY created_at DESC, id DESC LIMIT 100")));

    static boolean localTargetsConfigured() {
        return localUrl(System.getenv("W14_INDEX_FRESH_POSTGRES_URL"), "campuscore_w14_index_fresh_test")
                && localUrl(System.getenv("W14_INDEX_UPGRADE_POSTGRES_URL"), "campuscore_w14_index_upgrade_test")
                && credentialsConfigured("W14_INDEX_FRESH_POSTGRES")
                && credentialsConfigured("W14_INDEX_UPGRADE_POSTGRES");
    }

    private static boolean localUrl(String url, String database) {
        return url != null && url.matches("jdbc:postgresql://(127\\.0\\.0\\.1|localhost):[0-9]+/" + database);
    }

    private static boolean credentialsConfigured(String prefix) {
        String user = System.getenv(prefix + "_USER");
        String password = System.getenv(prefix + "_PASSWORD");
        return user != null && !user.isBlank() && password != null && !password.isEmpty();
    }

    @Test
    void freshMigrationChainAppliesV146AndDefinesAllSixIndexes() throws Exception {
        String prefix = "W14_INDEX_FRESH_POSTGRES";
        String url = System.getenv(prefix + "_URL");
        String user = System.getenv(prefix + "_USER");
        String password = System.getenv(prefix + "_PASSWORD");
        assertFreshDatabase(url, user, password);

        Flyway flyway = configured(prefix, "146");
        flyway.migrate();

        assertThat(flyway.validateWithResult().validationSuccessful).isTrue();
        assertThat(currentVersion(url, user, password)).isEqualTo("146");
        assertIndexes(url, user, password);
        assertPlansCanUseEachIndex(url, user, password);
    }

    @Test
    void upgradeFromV145AddsIndexesWithoutChangingConstraints() throws Exception {
        String prefix = "W14_INDEX_UPGRADE_POSTGRES";
        String url = System.getenv(prefix + "_URL");
        String user = System.getenv(prefix + "_USER");
        String password = System.getenv(prefix + "_PASSWORD");
        assertFreshDatabase(url, user, password);

        configured(prefix, "145").migrate();
        assertThat(currentVersion(url, user, password)).isEqualTo("145");
        List<String> constraintsBefore = constraints(url, user, password);
        assertThat(constraintsBefore).isNotEmpty();

        Flyway flyway = configured(prefix, "146");
        flyway.migrate();

        assertThat(flyway.validateWithResult().validationSuccessful).isTrue();
        assertThat(currentVersion(url, user, password)).isEqualTo("146");
        assertThat(constraints(url, user, password)).isEqualTo(constraintsBefore);
        assertIndexes(url, user, password);
    }

    private static Flyway configured(String prefix, String target) {
        var configuration = Flyway.configure()
                .dataSource(System.getenv(prefix + "_URL"), System.getenv(prefix + "_USER"), System.getenv(prefix + "_PASSWORD"))
                .locations("classpath:db/migration")
                .createSchemas(true)
                .defaultSchema("thesis")
                .schemas("thesis", "academic", "campuscore_auth", "campuscore_identity")
                .cleanDisabled(true);
        if (target != null) configuration.target(target);
        return configuration.load();
    }

    private static void assertFreshDatabase(String url, String user, String password) throws Exception {
        try (Connection connection = DriverManager.getConnection(url, user, password);
             Statement statement = connection.createStatement();
             ResultSet result = statement.executeQuery("SELECT to_regclass('thesis.flyway_schema_history')")) {
            assertThat(result.next()).isTrue();
            assertThat(result.getString(1)).isNull();
        }
    }

    private static String currentVersion(String url, String user, String password) throws Exception {
        try (Connection connection = DriverManager.getConnection(url, user, password);
             Statement statement = connection.createStatement();
             ResultSet result = statement.executeQuery("SELECT version FROM thesis.flyway_schema_history WHERE success ORDER BY installed_rank DESC LIMIT 1")) {
            assertThat(result.next()).isTrue();
            return result.getString(1);
        }
    }

    private static void assertIndexes(String url, String user, String password) throws Exception {
        Map<String, IndexDefinition> definitions = indexDefinitions(url, user, password);
        Map<String, String> pgIndexes = pgIndexDefinitions(url, user, password);
        assertThat(definitions.keySet()).containsExactlyInAnyOrderElementsOf(INDEXES.keySet());
        assertThat(pgIndexes.keySet()).containsExactlyInAnyOrderElementsOf(INDEXES.keySet());
        INDEXES.forEach((name, spec) -> {
            IndexDefinition actual = definitions.get(name);
            assertThat(actual.schema()).isEqualTo(spec.schema());
            assertThat(actual.table()).isEqualTo(spec.table());
            assertThat(actual.columns()).containsExactlyElementsOf(spec.columns());
            assertThat(actual.descending()).containsExactlyElementsOf(spec.descending());
            assertThat(actual.valid()).isTrue();
            assertThat(actual.unique()).isFalse();
            assertThat(actual.partial()).isFalse();
            assertThat(actual.definition()).startsWith("CREATE INDEX").contains("USING btree");
            assertThat(pgIndexes.get(name)).startsWith("CREATE INDEX").contains("USING btree");
            assertThat(pgIndexes.get(name)).contains(spec.schema() + ".").contains(spec.table());
        });
    }

    private static Map<String, IndexDefinition> indexDefinitions(String url, String user, String password) throws Exception {
        String names = INDEXES.keySet().stream().map(name -> "'" + name + "'").reduce((left, right) -> left + "," + right).orElseThrow();
        String sql = """
                SELECT ic.relname AS index_name, n.nspname AS schema_name, c.relname AS table_name,
                       i.indisvalid, i.indisunique, i.indpred IS NOT NULL AS partial,
                       pg_get_indexdef(i.indexrelid) AS definition,
                       array_agg(a.attname ORDER BY keys.ord) AS columns,
                       array_agg(pg_index_column_has_property(i.indexrelid, keys.ord + 1, 'desc') ORDER BY keys.ord) AS descending
                  FROM pg_index i
                  JOIN pg_class ic ON ic.oid = i.indexrelid
                  JOIN pg_class c ON c.oid = i.indrelid
                  JOIN pg_namespace n ON n.oid = c.relnamespace
                  CROSS JOIN LATERAL generate_series(0, i.indnkeyatts - 1) AS keys(ord)
                  JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = i.indkey[keys.ord]
                 WHERE ic.relname IN (%s)
                 GROUP BY ic.relname, n.nspname, c.relname, i.indexrelid, i.indisvalid, i.indisunique, i.indpred
                 ORDER BY ic.relname
                """.formatted(names);
        Map<String, IndexDefinition> definitions = new HashMap<>();
        try (Connection connection = DriverManager.getConnection(url, user, password);
             Statement statement = connection.createStatement();
             ResultSet result = statement.executeQuery(sql)) {
            while (result.next()) {
                definitions.put(result.getString("index_name"), new IndexDefinition(
                        result.getString("schema_name"), result.getString("table_name"),
                        strings(result, "columns"), directions(result, "descending"),
                        result.getBoolean("indisvalid"), result.getBoolean("indisunique"),
                        result.getBoolean("partial"), result.getString("definition")));
            }
        }
        return definitions;
    }

    private static Map<String, String> pgIndexDefinitions(String url, String user, String password) throws Exception {
        String names = INDEXES.keySet().stream().map(name -> "'" + name + "'").reduce((left, right) -> left + "," + right).orElseThrow();
        Map<String, String> definitions = new HashMap<>();
        try (Connection connection = DriverManager.getConnection(url, user, password);
             Statement statement = connection.createStatement();
             ResultSet result = statement.executeQuery("SELECT indexname, indexdef FROM pg_indexes WHERE indexname IN (" + names + ")")) {
            while (result.next()) definitions.put(result.getString("indexname"), result.getString("indexdef"));
        }
        return definitions;
    }

    private static List<String> strings(ResultSet result, String column) throws Exception {
        Object[] values = (Object[]) result.getArray(column).getArray();
        List<String> valuesList = new ArrayList<>(values.length);
        for (Object value : values) valuesList.add(String.valueOf(value));
        return valuesList;
    }

    private static List<String> directions(ResultSet result, String column) throws Exception {
        Object raw = result.getArray(column).getArray();
        List<String> values = new ArrayList<>();
        if (raw instanceof boolean[] primitives) {
            for (boolean value : primitives) values.add(value ? "DESC" : "ASC");
        } else {
            for (Object value : (Object[]) raw) values.add(Boolean.parseBoolean(String.valueOf(value)) ? "DESC" : "ASC");
        }
        return values;
    }

    private static void assertPlansCanUseEachIndex(String url, String user, String password) throws Exception {
        try (Connection connection = DriverManager.getConnection(url, user, password);
             Statement statement = connection.createStatement()) {
            statement.execute("SET enable_seqscan = off");
            for (var entry : INDEXES.entrySet()) {
                StringBuilder plan = new StringBuilder();
                try (ResultSet result = statement.executeQuery("EXPLAIN (FORMAT TEXT) " + entry.getValue().explain())) {
                    while (result.next()) plan.append(result.getString(1)).append('\n');
                }
                assertThat(plan.toString()).as(entry.getKey()).contains(entry.getKey());
            }
        }
    }

    private static List<String> constraints(String url, String user, String password) throws Exception {
        String sql = """
                SELECT n.nspname, c.relname, con.conname, con.contype,
                       con.convalidated, pg_get_constraintdef(con.oid, true)
                  FROM pg_constraint con
                  JOIN pg_class c ON c.oid = con.conrelid
                  JOIN pg_namespace n ON n.oid = c.relnamespace
                 WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
                   AND n.nspname NOT LIKE 'pg_toast%'
                 ORDER BY n.nspname, c.relname, con.conname
                """;
        List<String> values = new ArrayList<>();
        try (Connection connection = DriverManager.getConnection(url, user, password);
             Statement statement = connection.createStatement();
             ResultSet result = statement.executeQuery(sql)) {
            while (result.next()) {
                values.add(String.join("|", result.getString(1), result.getString(2), result.getString(3),
                        result.getString(4), result.getString(5), result.getString(6)));
            }
        }
        return values;
    }
}
