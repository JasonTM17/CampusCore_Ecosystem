package io.campuscore.restfulapi.engagement;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.Map;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIf;

/** A fresh PostgreSQL chain keeps each restored body equal to its original insert. */
@EnabledIf("localTargetConfigured")
class NewsBodyRestorePostgresIT {
    static boolean localTargetConfigured() {
        String url = System.getenv("NEWS_BODY_FRESH_POSTGRES_URL");
        String user = System.getenv("NEWS_BODY_FRESH_POSTGRES_USER");
        String password = System.getenv("NEWS_BODY_FRESH_POSTGRES_PASSWORD");
        return url != null
                && url.matches("jdbc:postgresql://(127\\.0\\.0\\.1|localhost):[0-9]+/campuscore_news_body_fresh_test")
                && user != null && !user.isBlank()
                && password != null && !password.isEmpty();
    }

    @Test
    void freshChainRestoresTheTenBodiesWithoutChangingTitleOrSummary() throws Exception {
        String url = System.getenv("NEWS_BODY_FRESH_POSTGRES_URL");
        String user = System.getenv("NEWS_BODY_FRESH_POSTGRES_USER");
        String password = System.getenv("NEWS_BODY_FRESH_POSTGRES_PASSWORD");
        try (Connection connection = DriverManager.getConnection(url, user, password);
             PreparedStatement history = connection.prepareStatement(
                     "SELECT to_regclass('thesis.flyway_schema_history')");
             ResultSet result = history.executeQuery()) {
            assertThat(result.next()).isTrue();
            assertThat(result.getString(1)).isNull();
        }

        Flyway flyway = Flyway.configure()
                .dataSource(url, user, password)
                .locations("classpath:db/migration")
                .createSchemas(true)
                .defaultSchema("thesis")
                .schemas("thesis", "academic", "campuscore_auth", "campuscore_identity")
                .cleanDisabled(true)
                .load();
        flyway.migrate();
        assertThat(flyway.validateWithResult().validationSuccessful).isTrue();

        Path dir = Path.of("src/main/resources/db/migration");
        Map<String, String> sources = new LinkedHashMap<>();
        for (String filename : OriginalAnnouncementBodies.SOURCE_FILES.values()) {
            sources.putIfAbsent(filename, Files.readString(dir.resolve(filename)));
        }
        Map<String, String> expected = OriginalAnnouncementBodies.fromInserts(sources);

        Map<String, String> bodies = new HashMap<>();
        Map<String, String> titles = new HashMap<>();
        Map<String, String> summaries = new HashMap<>();
        try (Connection connection = DriverManager.getConnection(url, user, password);
             PreparedStatement query = connection.prepareStatement(
                     "SELECT \"id\", title, content, \"summary\" FROM engagement.\"Announcement\" WHERE \"id\" = ANY (?)")) {
            query.setArray(1, connection.createArrayOf("text", expected.keySet().toArray()));
            try (ResultSet rows = query.executeQuery()) {
                while (rows.next()) {
                    bodies.put(rows.getString(1), rows.getString(3));
                    titles.put(rows.getString(1), rows.getString(2));
                    summaries.put(rows.getString(1), rows.getString(4));
                }
            }
        }
        assertThat(bodies).isEqualTo(expected);
        for (String id : expected.keySet()) {
            assertThat(titles.get(id)).isEqualTo(DistinctAnnouncementSummaries.TITLES.get(id));
            assertThat(summaries.get(id)).isEqualTo(DistinctAnnouncementSummaries.BY_ID.get(id));
        }
    }
}
