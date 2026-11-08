package io.campuscore.restfulapi.academic;

import static org.assertj.core.api.Assertions.assertThat;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.Statement;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIf;

/**
 * Fresh PostgreSQL chain keeps the demo conduct seed internally consistent: the
 * career fair activity date matches the day stated by the event announcement,
 * and every conduct activity date lies inside the semester it is attached to.
 */
@EnabledIf("localTargetConfigured")
class ConductSeedIntegrityPostgresIT {
    private static final String TITLE = "Tham gia Ngày hội việc làm UTE Career Expo 2026";
    private static final String ANNOUNCEMENT_ID = "announcement-ute-career-fair-tech-2026";
    private static final Pattern DAY_PATTERN = Pattern.compile("(\\d{1,2})/(\\d{1,2})/(\\d{4})");

    static boolean localTargetConfigured() {
        String url = System.getenv("CAMPUSCORE_E2E_POSTGRES_URL");
        String user = System.getenv("CAMPUSCORE_E2E_POSTGRES_USER");
        String password = System.getenv("CAMPUSCORE_E2E_POSTGRES_PASSWORD");
        return url != null && url.startsWith("jdbc:postgresql://")
                && user != null && !user.isBlank()
                && password != null && !password.isEmpty();
    }

    @Test
    void careerFairActivityDateMatchesAnnouncementDay() throws Exception {
        migrate();
        Map<String, String> announcement = announcement();
        String summary = announcement.get("summary");
        String content = announcement.get("content");

        LocalDate day = dayFrom(summary);
        if (day == null) day = dayFrom(content);
        assertThat(day).as("announcement %s states a day in summary or body", ANNOUNCEMENT_ID).isNotNull();
        String dayText = String.format("%02d/%02d/%04d", day.getDayOfMonth(), day.getMonthValue(), day.getYear());
        assertThat(summary.contains(dayText) || content.contains(dayText))
                .as("announcement %s summary or body states %s", ANNOUNCEMENT_ID, dayText)
                .isTrue();

        Map<String, Integer> dates = new LinkedHashMap<>();
        try (Connection connection = connection();
             Statement statement = connection.createStatement();
             ResultSet result = statement.executeQuery(
                     "SELECT activity_date, COUNT(*) FROM academic.conduct_activity"
                             + " WHERE title = '" + TITLE + "' GROUP BY activity_date ORDER BY activity_date")) {
            while (result.next()) {
                dates.put(String.valueOf(result.getDate(1)), result.getInt(2));
            }
        }
        assertThat(dates).as("activity rows titled '%s' exist", TITLE).isNotEmpty();
        assertThat(dates.keySet())
                .as("every '%s' activity date equals the announcement day %s", TITLE, day)
                .containsExactly(String.valueOf(java.sql.Date.valueOf(day)));
    }

    @Test
    void namedConductActivitiesSitInsideTheirSemester() throws Exception {
        migrate();
        List<String> violations = new ArrayList<>();
        try (Connection connection = connection();
             Statement statement = connection.createStatement();
             ResultSet result = statement.executeQuery(
                     "SELECT a.id, a.semester_id, a.activity_date, s.\"startDate\"::date, s.\"endDate\"::date,"
                             + " a.title FROM academic.conduct_activity a"
                             + " JOIN academic.\"Semester\" s ON s.\"id\" = a.semester_id"
                             + " WHERE a.activity_date < s.\"startDate\"::date"
                             + " OR a.activity_date > s.\"endDate\"::date"
                             + " ORDER BY a.semester_id, a.activity_date, a.id")) {
            while (result.next()) {
                violations.add(String.join("|", result.getString(1), result.getString(2),
                        String.valueOf(result.getDate(3)), String.valueOf(result.getDate(4)),
                        String.valueOf(result.getDate(5)), result.getString(6)));
            }
        }
        List<String> namedViolations = violations.stream()
                .filter(violation -> violation.startsWith("act-drl-ute-van-nghe-20-11|")
                        || violation.startsWith("act-drl-ute-chu-nhat-xanh-2025|")
                        || violation.startsWith("act-drl-ute-hoi-thao-cloud-aws|"))
                .toList();
        assertThat(namedViolations)
                .as("violations for the three named activities (all rows: %s)", violations)
                .isEmpty();

        Map<String, String> named = new LinkedHashMap<>();
        try (Connection connection = connection();
             Statement statement = connection.createStatement();
             ResultSet result = statement.executeQuery(
                     "SELECT id, semester_id, activity_date FROM academic.conduct_activity"
                             + " WHERE id IN ('act-drl-ute-van-nghe-20-11', 'act-drl-ute-chu-nhat-xanh-2025',"
                             + " 'act-drl-ute-hoi-thao-cloud-aws') ORDER BY id")) {
            while (result.next()) {
                named.put(result.getString(1), result.getString(2) + "|" + result.getDate(3));
            }
        }
        assertThat(named.get("act-drl-ute-van-nghe-20-11"))
                .as("act-drl-ute-van-nghe-20-11 sits in semester-history-demo-1 on 2025-11-18")
                .isEqualTo("semester-history-demo-1|2025-11-18");
        assertThat(named.get("act-drl-ute-chu-nhat-xanh-2025"))
                .as("act-drl-ute-chu-nhat-xanh-2025 sits in semester-history-demo-1 on 2025-10-15")
                .isEqualTo("semester-history-demo-1|2025-10-15");
        assertThat(named.get("act-drl-ute-hoi-thao-cloud-aws"))
                .as("act-drl-ute-hoi-thao-cloud-aws sits in semester-history-demo-1 on 2025-10-10")
                .isEqualTo("semester-history-demo-1|2025-10-10");
    }

    private static void migrate() {
        Flyway.configure()
                .dataSource(System.getenv("CAMPUSCORE_E2E_POSTGRES_URL"),
                        System.getenv("CAMPUSCORE_E2E_POSTGRES_USER"),
                        System.getenv("CAMPUSCORE_E2E_POSTGRES_PASSWORD"))
                .locations("classpath:db/migration")
                .createSchemas(true)
                .defaultSchema("thesis")
                .schemas("thesis", "academic", "campuscore_auth", "campuscore_identity")
                .cleanDisabled(true)
                .load()
                .migrate();
    }

    private static Connection connection() throws Exception {
        return DriverManager.getConnection(System.getenv("CAMPUSCORE_E2E_POSTGRES_URL"),
                System.getenv("CAMPUSCORE_E2E_POSTGRES_USER"),
                System.getenv("CAMPUSCORE_E2E_POSTGRES_PASSWORD"));
    }

    private static Map<String, String> announcement() throws Exception {
        Map<String, String> values = new LinkedHashMap<>();
        try (Connection connection = connection();
             Statement statement = connection.createStatement();
             ResultSet result = statement.executeQuery(
                     "SELECT \"summary\", content FROM engagement.\"Announcement\" WHERE \"id\" = '"
                             + ANNOUNCEMENT_ID + "'")) {
            assertThat(result.next()).as("announcement %s exists", ANNOUNCEMENT_ID).isTrue();
            values.put("summary", result.getString(1));
            values.put("content", result.getString(2));
        }
        return values;
    }

    private static LocalDate dayFrom(String text) {
        if (text == null) return null;
        Matcher matcher = DAY_PATTERN.matcher(text);
        if (!matcher.find()) return null;
        return LocalDate.of(Integer.parseInt(matcher.group(3)),
                Integer.parseInt(matcher.group(2)), Integer.parseInt(matcher.group(1)));
    }
}
