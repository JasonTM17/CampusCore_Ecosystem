package io.campuscore.restfulapi.engagement;

import static org.assertj.core.api.Assertions.assertThat;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.util.HashMap;
import java.util.Map;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIf;

/** Fresh PostgreSQL chain applies one summary per announcement id. */
@EnabledIf("localTargetConfigured")
class NewsSummaryDistinctPostgresIT {
    static boolean localTargetConfigured() {
        String url = System.getenv("NEWS_SUMMARY_FRESH_POSTGRES_URL");
        String user = System.getenv("NEWS_SUMMARY_FRESH_POSTGRES_USER");
        String password = System.getenv("NEWS_SUMMARY_FRESH_POSTGRES_PASSWORD");
        return url != null
                && url.matches("jdbc:postgresql://(127\\.0\\.0\\.1|localhost):[0-9]+/campuscore_news_summary_fresh_test")
                && user != null && !user.isBlank()
                && password != null && !password.isEmpty();
    }

    @Test
    void freshChainGivesEachAnnouncementItsOwnSummary() throws Exception {
        String url = System.getenv("NEWS_SUMMARY_FRESH_POSTGRES_URL");
        String user = System.getenv("NEWS_SUMMARY_FRESH_POSTGRES_USER");
        String password = System.getenv("NEWS_SUMMARY_FRESH_POSTGRES_PASSWORD");
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

        Map<String, String> summaries = new HashMap<>();
        Map<String, String> titles = new HashMap<>();
        try (Connection connection = DriverManager.getConnection(url, user, password);
             PreparedStatement query = connection.prepareStatement(
                     "SELECT \"id\", title, \"summary\" FROM engagement.\"Announcement\" WHERE \"id\" = ANY (?)")) {
            query.setArray(1, connection.createArrayOf("text", DistinctAnnouncementSummaries.BY_ID.keySet().toArray()));
            try (ResultSet rows = query.executeQuery()) {
                while (rows.next()) {
                    summaries.put(rows.getString(1), rows.getString(3));
                    titles.put(rows.getString(1), rows.getString(2));
                }
            }
        }
        assertThat(summaries).isEqualTo(DistinctAnnouncementSummaries.BY_ID);
        assertThat(titles).isEqualTo(DistinctAnnouncementSummaries.TITLES);
    }
}
