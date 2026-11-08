package io.campuscore.restfulapi.thesis.assistant;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.URI;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;

/**
 * Forward-only PostgreSQL proof on a caller-supplied disposable database: the
 * active assistant corpus must document the same 10-point letter bands the
 * application assigns (A+ from 9.0, A from 8.5) rather than a single 8.5-10.0
 * grade-A band.
 */
@EnabledIfEnvironmentVariable(named = "CAMPUSCORE_E2E_POSTGRES_URL", matches = "jdbc:postgresql:.+")
class GpaLetterConversionBandPostgresIT {
    private static final UUID V160_RELEASE = UUID.fromString("00000000-0000-0000-0000-000000000160");

    @Test
    void activeCorpusDocumentsTheApplicationLetterBands() throws Exception {
        String url = required("CAMPUSCORE_E2E_POSTGRES_URL");
        URI target = URI.create(url.replaceFirst("^jdbc:", ""));
        assertThat(target.getScheme()).isEqualTo("postgresql");
        assertThat(target.getHost()).isIn("localhost", "127.0.0.1", "::1");
        String user = valueOr("CAMPUSCORE_E2E_POSTGRES_USER", "postgres");
        String password = valueOr("CAMPUSCORE_E2E_POSTGRES_PASSWORD", "postgres");

        Flyway.configure()
                .dataSource(url, user, password)
                .locations("classpath:db/migration")
                .createSchemas(true)
                .defaultSchema("thesis")
                .schemas("thesis")
                .cleanDisabled(true)
                .load()
                .migrate();

        try (Connection connection = DriverManager.getConnection(url, user, password)) {
            List<String> offending = offendingRows(connection);
            System.out.println("GPA_BAND_OFFENDING " + offending);
            assertThat(offending)
                    .as("no active public revision may still document 8.5-10.0 as grade A without the A+ band")
                    .isEmpty();

            for (String locale : List.of("vi", "en")) {
                assertThat(activeRevisionContent(connection, "gpa-letter-conversion-faq-" + locale))
                        .as("active %s conversion FAQ revision", locale)
                        .contains("A+", "9.0");
                assertThat(activeRevisionContent(connection, "curriculum-gpa-weighting-and-credit-system-" + locale))
                        .as("active %s curriculum revision", locale)
                        .contains("A+", "9.0");
            }

            assertThat(activeRelease(connection)).isEqualTo(V160_RELEASE.toString());

            String before = activeFingerprint(connection);
            reapplyMigration(url, user, password);
            assertThat(activeFingerprint(connection))
                    .as("re-running the correction must not archive or republish anything")
                    .isEqualTo(before);
        }
    }

    private static String activeFingerprint(Connection connection) throws SQLException {
        List<String> rows = new ArrayList<>();
        String sql = """
                SELECT d.slug || '|' || r.version || '|' || r.state
                  FROM assistant.knowledge_document d
                  JOIN assistant.knowledge_document_revision r
                    ON r.document_id = d.id AND r.state = 'PUBLISHED'
                 WHERE d.slug IN ('curriculum-gpa-weighting-and-credit-system-vi',
                                  'curriculum-gpa-weighting-and-credit-system-en',
                                  'gpa-letter-conversion-faq-vi',
                                  'gpa-letter-conversion-faq-en')
                 ORDER BY d.slug
                """;
        try (PreparedStatement statement = connection.prepareStatement(sql);
             ResultSet result = statement.executeQuery()) {
            while (result.next()) rows.add(result.getString(1));
        }
        rows.add("release=" + activeRelease(connection));
        return String.join("\n", rows);
    }

    private static void reapplyMigration(String url, String user, String password) throws Exception {
        String script = Files.readString(Path.of(
                "src/main/resources/db/migration/V160__correct_gpa_letter_conversion_bands.sql"));
        String simpleUrl = url + (url.contains("?") ? "&" : "?") + "preferQueryMode=simple";
        try (Connection connection = DriverManager.getConnection(simpleUrl, user, password);
             Statement statement = connection.createStatement()) {
            statement.execute("SET search_path TO thesis");
            statement.execute(script);
        }
    }

    private static List<String> offendingRows(Connection connection) throws SQLException {
        List<String> rows = new ArrayList<>();
        String sql = """
                SELECT d.id::text || '|' || d.slug || '|' || d.locale || '|v' || r.version
                  FROM assistant.knowledge_document d
                  JOIN assistant.knowledge_document_revision r
                    ON r.document_id = d.id AND r.state = 'PUBLISHED'
                 WHERE d.active = TRUE AND d.visibility = 'PUBLIC'
                   AND r.content LIKE '%8.5-10.0%'
                   AND r.content NOT LIKE '%A+%'
                 ORDER BY d.slug
                """;
        try (PreparedStatement statement = connection.prepareStatement(sql);
             ResultSet result = statement.executeQuery()) {
            while (result.next()) rows.add(result.getString(1));
        }
        return rows;
    }

    private static String activeRevisionContent(Connection connection, String slug) throws SQLException {
        String sql = """
                SELECT r.content
                  FROM assistant.knowledge_document d
                  JOIN assistant.knowledge_document_revision r
                    ON r.document_id = d.id AND r.state = 'PUBLISHED'
                 WHERE d.slug = ?
                """;
        try (PreparedStatement statement = connection.prepareStatement(sql)) {
            statement.setString(1, slug);
            try (ResultSet result = statement.executeQuery()) {
                assertThat(result.next()).as("active published revision for %s", slug).isTrue();
                return result.getString(1);
            }
        }
    }

    private static String activeRelease(Connection connection) throws SQLException {
        try (PreparedStatement statement = connection.prepareStatement(
                "SELECT active_release_id::text FROM assistant.knowledge_runtime_state WHERE singleton = TRUE");
             ResultSet result = statement.executeQuery()) {
            assertThat(result.next()).isTrue();
            return result.getString(1);
        }
    }

    private static String required(String name) {
        String value = System.getenv(name);
        if (value == null || value.isBlank()) throw new IllegalStateException(name + " is required");
        return value;
    }

    private static String valueOr(String name, String fallback) {
        String value = System.getenv(name);
        return value == null || value.isBlank() ? fallback : value;
    }
}
