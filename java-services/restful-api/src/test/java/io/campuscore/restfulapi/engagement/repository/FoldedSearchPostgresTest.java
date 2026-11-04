package io.campuscore.restfulapi.engagement.repository;

import static org.assertj.core.api.Assertions.assertThat;

import io.campuscore.restfulapi.common.LikePattern;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.function.LongSupplier;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIf;
import org.springframework.core.io.ClassPathResource;
import org.springframework.core.io.support.EncodedResource;
import org.springframework.jdbc.core.ConnectionCallback;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.jdbc.datasource.init.ScriptUtils;

/**
 * PostgreSQL proof for V147. Enabled only when a disposable local database is
 * supplied through {@code -Dw16.folded.postgres.url/user/password} (or the
 * matching {@code W16_FOLDED_POSTGRES_*} environment variables). CI without
 * that target skips instead of pretending the PostgreSQL DDL ran.
 */
@EnabledIf("configured")
class FoldedSearchPostgresTest {

    private JdbcTemplate jdbc;
    private NamedParameterJdbcTemplate namedJdbc;

    static boolean configured() {
        String url = value("w16.folded.postgres.url", "W16_FOLDED_POSTGRES_URL");
        return url != null
                && url.matches("jdbc:postgresql://(127\\.0\\.0\\.1|localhost):[0-9]+/w16fold.*")
                && value("w16.folded.postgres.user", "W16_FOLDED_POSTGRES_USER") != null
                && value("w16.folded.postgres.password", "W16_FOLDED_POSTGRES_PASSWORD") != null;
    }

    @BeforeEach
    void setUp() {
        DriverManagerDataSource dataSource = new DriverManagerDataSource(
                value("w16.folded.postgres.url", "W16_FOLDED_POSTGRES_URL"),
                value("w16.folded.postgres.user", "W16_FOLDED_POSTGRES_USER"),
                value("w16.folded.postgres.password", "W16_FOLDED_POSTGRES_PASSWORD"));
        dataSource.setDriverClassName("org.postgresql.Driver");
        jdbc = new JdbcTemplate(dataSource);
        namedJdbc = new NamedParameterJdbcTemplate(jdbc);

        jdbc.execute("DROP SCHEMA IF EXISTS engagement CASCADE");
        jdbc.execute("CREATE SCHEMA engagement");
        jdbc.execute("""
                CREATE TABLE engagement."Announcement" (
                    "id" VARCHAR(120) PRIMARY KEY,
                    "title" VARCHAR(240) NOT NULL,
                    "content" TEXT NOT NULL,
                    "slug" VARCHAR(240),
                    "courseCode" VARCHAR(80),
                    "courseName" VARCHAR(200),
                    "semesterName" VARCHAR(200),
                    "lecturerDisplayName" VARCHAR(200)
                )
                """);
        jdbc.execute("""
                CREATE TABLE engagement."PublicDocumentRevision" (
                    "documentId" VARCHAR(120) NOT NULL,
                    "revision" INTEGER NOT NULL,
                    "titleVi" VARCHAR(240) NOT NULL,
                    "titleEn" VARCHAR(240) NOT NULL,
                    "summaryVi" VARCHAR(500),
                    "summaryEn" VARCHAR(500),
                    "bodyVi" TEXT NOT NULL,
                    "bodyEn" TEXT NOT NULL,
                    PRIMARY KEY ("documentId", "revision")
                )
                """);
        jdbc.execute((ConnectionCallback<Void>) connection -> {
            ScriptUtils.executeSqlScript(
                    connection,
                    new EncodedResource(
                            new ClassPathResource("db/migration/V147__engagement_folded_search_columns.sql"),
                            StandardCharsets.UTF_8));
            return null;
        });
    }

    @Test
    void postgresGeneratedColumnsMatchEveryMappingAndRefreshOnWrite() {
        insertAnnouncement(
                "all-map",
                LikePattern.FOLD_FROM,
                LikePattern.FOLD_FROM,
                LikePattern.FOLD_FROM,
                LikePattern.FOLD_FROM,
                LikePattern.FOLD_FROM,
                LikePattern.FOLD_FROM,
                LikePattern.FOLD_FROM);
        assertThat(foldedAnnouncementValues("all-map")).containsOnly(LikePattern.FOLD_TO);

        insertRevision(
                "all-map-doc",
                LikePattern.FOLD_FROM,
                LikePattern.FOLD_FROM,
                LikePattern.FOLD_FROM,
                LikePattern.FOLD_FROM,
                LikePattern.FOLD_FROM,
                LikePattern.FOLD_FROM);
        assertThat(foldedRevisionValues("all-map-doc")).containsOnly(LikePattern.FOLD_TO);

        jdbc.update("UPDATE engagement.\"Announcement\""
                + " SET \"title\" = 'ĐƯỜNG VỀ NHÀ', \"content\" = 'MỚI',"
                + " \"slug\" = 'duong-ve-nha', \"courseCode\" = 'IT_101',"
                + " \"courseName\" = 'Hệ điều hành', \"semesterName\" = 'Học kỳ 2',"
                + " \"lecturerDisplayName\" = 'ThS. Lê Văn An'"
                + " WHERE \"id\" = 'all-map'");
        assertThat(foldedAnnouncementValues("all-map"))
                .containsExactly("duong ve nha", "moi", "duong-ve-nha",
                        "it_101", "he dieu hanh", "hoc ky 2", "ths. le van an");

        jdbc.update("UPDATE engagement.\"PublicDocumentRevision\""
                + " SET \"titleVi\" = 'ĐƯỜNG', \"bodyEn\" = 'NEW BODY'"
                + " WHERE \"documentId\" = 'all-map-doc' AND \"revision\" = 1");
        assertThat(foldedRevisionValues("all-map-doc").get(0)).isEqualTo("duong");
        assertThat(foldedRevisionValues("all-map-doc").get(5)).isEqualTo("new body");

        insertAnnouncement("null-fields", "x", "y", null, null, null, null, null);
        assertThat(foldedAnnouncementValues("null-fields"))
                .containsExactly("x", "y", "", "", "", "", "");
        insertRevision("null-fields-doc", "x", "y", null, null, "z", "w");
        assertThat(foldedRevisionValues("null-fields-doc"))
                .containsExactly("x", "y", "", "", "z", "w");
    }

    @Test
    void postgresLegacyAndFoldedPredicatesReturnTheSameRows() {
        seedRows();
        for (String term : terms()) {
            assertThat(foldedAnnouncementIds(term))
                    .as("announcements for <%s>", term)
                    .containsExactlyElementsOf(legacyAnnouncementIds(term));
            assertThat(foldedAnnouncementCount(term))
                    .isEqualTo(legacyAnnouncementCount(term));
            assertThat(foldedRevisionKeys(term))
                    .as("revisions for <%s>", term)
                    .containsExactlyElementsOf(legacyRevisionKeys(term));
            assertThat(foldedRevisionCount(term))
                    .isEqualTo(legacyRevisionCount(term));
        }
    }

    @Test
    void postgresTimingComparesLegacyAndFoldedPredicates() {
        int rows = 5_000;
        jdbc.update("""
                INSERT INTO engagement."Announcement"
                    ("id", "title", "content", "slug", "courseCode", "courseName",
                     "semesterName", "lecturerDisplayName")
                SELECT 'bulk-' || g, 'Thông báo ' || g, 'Nội dung thường ' || g,
                       'bulk-' || g, 'SE' || g, 'Môn học ' || g, 'Học kỳ 1',
                       'Giảng viên zzbulk ' || g
                  FROM generate_series(1, ?) AS g
                """,
                rows);
        jdbc.update("""
                INSERT INTO engagement."PublicDocumentRevision"
                    ("documentId", "revision", "titleVi", "titleEn", "summaryVi",
                     "summaryEn", "bodyVi", "bodyEn")
                SELECT 'doc-' || g, 1, 'Tài liệu ' || g, 'Document ' || g,
                       'Tóm tắt ' || g, 'Summary ' || g, 'Nội dung thường ' || g,
                       'Body zzbulk ' || g
                  FROM generate_series(1, ?) AS g
                """,
                rows);

        assertThat(legacyAnnouncementCount("zzbulk")).isEqualTo(rows);
        assertThat(foldedAnnouncementCount("zzbulk")).isEqualTo(rows);
        assertThat(legacyRevisionCount("zzbulk")).isEqualTo(rows);
        assertThat(foldedRevisionCount("zzbulk")).isEqualTo(rows);

        Timing legacyAnnouncement = measure(() -> legacyAnnouncementCount("zzbulk"), 3, 8);
        Timing foldedAnnouncement = measure(() -> foldedAnnouncementCount("zzbulk"), 3, 8);
        Timing legacyRevision = measure(() -> legacyRevisionCount("zzbulk"), 3, 8);
        Timing foldedRevision = measure(() -> foldedRevisionCount("zzbulk"), 3, 8);

        System.out.printf(Locale.ROOT,
                "PostgreSQL folded-search JDBC count timings (best of %d after %d warmups, %d rows):%n"
                        + "  announcements legacy min=%.3f ms median=%.3f ms | folded min=%.3f ms median=%.3f ms%n"
                        + "  revisions     legacy min=%.3f ms median=%.3f ms | folded min=%.3f ms median=%.3f ms%n",
                8, 3, rows,
                legacyAnnouncement.minMillis(), legacyAnnouncement.medianMillis(),
                foldedAnnouncement.minMillis(), foldedAnnouncement.medianMillis(),
                legacyRevision.minMillis(), legacyRevision.medianMillis(),
                foldedRevision.minMillis(), foldedRevision.medianMillis());

        assertThat(foldedAnnouncement.minMillis()).isLessThan(legacyAnnouncement.minMillis());
        assertThat(foldedRevision.minMillis()).isLessThan(legacyRevision.minMillis());
    }

    private void seedRows() {
        insertAnnouncement("a-folded", "Lịch thi giữa kỳ", "Nội dung chính thức",
                "lich-thi-giua-ky", "SE401", "Lập trình Java nâng cao",
                "Học kỳ 1", "GS.TS. Trần Đình Khôi");
        insertAnnouncement("b-null", "Thông báo chung", "Không có gì",
                null, null, null, null, null);
        insertAnnouncement("c-wild", "Mức 100% và mã a_b", "Đường dẫn C:\\back\\slash",
                "muc-100-va-a_b", "IT_101", "Hệ điều hành", null, null);
        insertAnnouncement("d-unicode", "Đường về nhà", "日本語 😀",
                "duong-ve-nha", null, null, null, null);
        insertAnnouncement("e-map", LikePattern.FOLD_FROM, "x", "map", null, null, null, null);

        insertRevision("doc-quy-dinh", "Quy định học vụ", "Academic regulations",
                "Tóm tắt học vụ", "Academic summary", "<p>Nội dung học vụ</p>",
                "<p>Academic body</p>");
        insertRevision("doc-thu-vien", "Hướng dẫn thư viện", "Library guide",
                null, null, "Mượn sách", "Borrowing books");
        insertRevision("doc-literal", "Mức 100% a_b", "Literal document",
                null, null, "Đường dẫn C:\\back\\slash", "日本語 body");
    }

    private List<String> terms() {
        return List.of(
                "",
                "lich thi",
                "Lịch thi",
                "SE401 java",
                "GS.TS. Trần",
                "100%",
                "a_b",
                "back\\slash",
                "Đường",
                "日本語",
                "😀",
                LikePattern.FOLD_FROM,
                "tuyet-doi-khong-trung");
    }

    private List<String> foldedAnnouncementIds(String term) {
        List<String> tokens = LikePattern.tokens(term);
        MapSqlParameterSource parameters = new MapSqlParameterSource();
        String where = foldedAnnouncementWhere(tokens, parameters);
        return namedJdbc.query(
                "SELECT \"id\" FROM engagement.\"Announcement\"" + where
                        + " ORDER BY \"id\" DESC LIMIT 100",
                parameters,
                (resultSet, ignored) -> resultSet.getString(1));
    }

    private long foldedAnnouncementCount(String term) {
        List<String> tokens = LikePattern.tokens(term);
        MapSqlParameterSource parameters = new MapSqlParameterSource();
        String where = foldedAnnouncementWhere(tokens, parameters);
        Long count = namedJdbc.queryForObject(
                "SELECT COUNT(*) FROM engagement.\"Announcement\"" + where,
                parameters,
                Long.class);
        return count == null ? 0 : count;
    }

    private String foldedAnnouncementWhere(List<String> tokens, MapSqlParameterSource parameters) {
        if (tokens.isEmpty()) {
            return "";
        }
        List<String> conditions = new ArrayList<>();
        for (int index = 0; index < tokens.size(); index++) {
            String parameter = "searchToken" + index;
            parameters.addValue(parameter, tokens.get(index));
            conditions.add("(\"foldedTitle\" LIKE :" + parameter + " ESCAPE '\\'"
                    + " OR \"foldedContent\" LIKE :" + parameter + " ESCAPE '\\'"
                    + " OR \"foldedSlug\" LIKE :" + parameter + " ESCAPE '\\'"
                    + " OR \"foldedCourseCode\" LIKE :" + parameter + " ESCAPE '\\'"
                    + " OR \"foldedCourseName\" LIKE :" + parameter + " ESCAPE '\\'"
                    + " OR \"foldedSemesterName\" LIKE :" + parameter + " ESCAPE '\\'"
                    + " OR \"foldedLecturerDisplayName\" LIKE :" + parameter + " ESCAPE '\\')");
        }
        return " WHERE " + String.join(" AND ", conditions);
    }

    private List<String> foldedRevisionKeys(String term) {
        List<String> tokens = LikePattern.tokens(term);
        MapSqlParameterSource parameters = new MapSqlParameterSource();
        String where = foldedRevisionWhere(tokens, parameters);
        return namedJdbc.query(
                "SELECT \"documentId\" || '#' || \"revision\" FROM engagement.\"PublicDocumentRevision\""
                        + where + " ORDER BY \"documentId\" DESC LIMIT 100",
                parameters,
                (resultSet, ignored) -> resultSet.getString(1));
    }

    private long foldedRevisionCount(String term) {
        List<String> tokens = LikePattern.tokens(term);
        MapSqlParameterSource parameters = new MapSqlParameterSource();
        String where = foldedRevisionWhere(tokens, parameters);
        Long count = namedJdbc.queryForObject(
                "SELECT COUNT(*) FROM engagement.\"PublicDocumentRevision\"" + where,
                parameters,
                Long.class);
        return count == null ? 0 : count;
    }

    private String foldedRevisionWhere(List<String> tokens, MapSqlParameterSource parameters) {
        if (tokens.isEmpty()) {
            return "";
        }
        List<String> conditions = new ArrayList<>();
        for (int index = 0; index < tokens.size(); index++) {
            String parameter = "search" + index;
            parameters.addValue(parameter, tokens.get(index));
            conditions.add("(\"foldedTitleVi\" LIKE :" + parameter + " ESCAPE '\\'"
                    + " OR \"foldedTitleEn\" LIKE :" + parameter + " ESCAPE '\\'"
                    + " OR \"foldedSummaryVi\" LIKE :" + parameter + " ESCAPE '\\'"
                    + " OR \"foldedSummaryEn\" LIKE :" + parameter + " ESCAPE '\\'"
                    + " OR \"foldedBodyVi\" LIKE :" + parameter + " ESCAPE '\\'"
                    + " OR \"foldedBodyEn\" LIKE :" + parameter + " ESCAPE '\\')");
        }
        return " WHERE " + String.join(" AND ", conditions);
    }

    private List<String> legacyAnnouncementIds(String term) {
        List<String> tokens = LikePattern.tokens(term);
        MapSqlParameterSource parameters = new MapSqlParameterSource();
        String where = legacyAnnouncementWhere(tokens, parameters);
        return namedJdbc.query(
                "SELECT \"id\" FROM engagement.\"Announcement\"" + where
                        + " ORDER BY \"id\" DESC LIMIT 100",
                parameters,
                (resultSet, ignored) -> resultSet.getString(1));
    }

    private long legacyAnnouncementCount(String term) {
        List<String> tokens = LikePattern.tokens(term);
        MapSqlParameterSource parameters = new MapSqlParameterSource();
        String where = legacyAnnouncementWhere(tokens, parameters);
        Long count = namedJdbc.queryForObject(
                "SELECT COUNT(*) FROM engagement.\"Announcement\"" + where,
                parameters,
                Long.class);
        return count == null ? 0 : count;
    }

    private String legacyAnnouncementWhere(List<String> tokens, MapSqlParameterSource parameters) {
        if (tokens.isEmpty()) {
            return "";
        }
        parameters.addValue("foldFrom", LikePattern.FOLD_FROM);
        parameters.addValue("foldTo", LikePattern.FOLD_TO);
        List<String> conditions = new ArrayList<>();
        for (int index = 0; index < tokens.size(); index++) {
            String parameter = "searchToken" + index;
            parameters.addValue(parameter, tokens.get(index));
            conditions.add("(TRANSLATE(LOWER(COALESCE(\"title\", '')), :foldFrom, :foldTo) LIKE :" + parameter + " ESCAPE '\\'"
                    + " OR TRANSLATE(LOWER(COALESCE(\"content\", '')), :foldFrom, :foldTo) LIKE :" + parameter + " ESCAPE '\\'"
                    + " OR TRANSLATE(LOWER(COALESCE(\"slug\", '')), :foldFrom, :foldTo) LIKE :" + parameter + " ESCAPE '\\'"
                    + " OR TRANSLATE(LOWER(COALESCE(\"courseCode\", '')), :foldFrom, :foldTo) LIKE :" + parameter + " ESCAPE '\\'"
                    + " OR TRANSLATE(LOWER(COALESCE(\"courseName\", '')), :foldFrom, :foldTo) LIKE :" + parameter + " ESCAPE '\\'"
                    + " OR TRANSLATE(LOWER(COALESCE(\"semesterName\", '')), :foldFrom, :foldTo) LIKE :" + parameter + " ESCAPE '\\'"
                    + " OR TRANSLATE(LOWER(COALESCE(\"lecturerDisplayName\", '')), :foldFrom, :foldTo) LIKE :" + parameter + " ESCAPE '\\')");
        }
        return " WHERE " + String.join(" AND ", conditions);
    }

    private List<String> legacyRevisionKeys(String term) {
        List<String> tokens = LikePattern.tokens(term);
        MapSqlParameterSource parameters = new MapSqlParameterSource();
        String where = legacyRevisionWhere(tokens, parameters);
        return namedJdbc.query(
                "SELECT \"documentId\" || '#' || \"revision\" FROM engagement.\"PublicDocumentRevision\""
                        + where + " ORDER BY \"documentId\" DESC LIMIT 100",
                parameters,
                (resultSet, ignored) -> resultSet.getString(1));
    }

    private long legacyRevisionCount(String term) {
        List<String> tokens = LikePattern.tokens(term);
        MapSqlParameterSource parameters = new MapSqlParameterSource();
        String where = legacyRevisionWhere(tokens, parameters);
        Long count = namedJdbc.queryForObject(
                "SELECT COUNT(*) FROM engagement.\"PublicDocumentRevision\"" + where,
                parameters,
                Long.class);
        return count == null ? 0 : count;
    }

    private String legacyRevisionWhere(List<String> tokens, MapSqlParameterSource parameters) {
        if (tokens.isEmpty()) {
            return "";
        }
        parameters.addValue("foldFrom", LikePattern.FOLD_FROM);
        parameters.addValue("foldTo", LikePattern.FOLD_TO);
        List<String> conditions = new ArrayList<>();
        for (int index = 0; index < tokens.size(); index++) {
            String parameter = "search" + index;
            parameters.addValue(parameter, tokens.get(index));
            conditions.add("(TRANSLATE(LOWER(COALESCE(\"titleVi\", '')), :foldFrom, :foldTo) LIKE :" + parameter + " ESCAPE '\\'"
                    + " OR TRANSLATE(LOWER(COALESCE(\"titleEn\", '')), :foldFrom, :foldTo) LIKE :" + parameter + " ESCAPE '\\'"
                    + " OR TRANSLATE(LOWER(COALESCE(\"summaryVi\", '')), :foldFrom, :foldTo) LIKE :" + parameter + " ESCAPE '\\'"
                    + " OR TRANSLATE(LOWER(COALESCE(\"summaryEn\", '')), :foldFrom, :foldTo) LIKE :" + parameter + " ESCAPE '\\'"
                    + " OR TRANSLATE(LOWER(COALESCE(\"bodyVi\", '')), :foldFrom, :foldTo) LIKE :" + parameter + " ESCAPE '\\'"
                    + " OR TRANSLATE(LOWER(COALESCE(\"bodyEn\", '')), :foldFrom, :foldTo) LIKE :" + parameter + " ESCAPE '\\')");
        }
        return " WHERE " + String.join(" AND ", conditions);
    }

    private List<String> foldedAnnouncementValues(String id) {
        return jdbc.queryForObject(
                "SELECT \"foldedTitle\", \"foldedContent\", \"foldedSlug\", \"foldedCourseCode\","
                        + " \"foldedCourseName\", \"foldedSemesterName\", \"foldedLecturerDisplayName\""
                        + " FROM engagement.\"Announcement\" WHERE \"id\" = ?",
                (resultSet, ignored) -> List.of(
                        resultSet.getString(1),
                        resultSet.getString(2),
                        resultSet.getString(3),
                        resultSet.getString(4),
                        resultSet.getString(5),
                        resultSet.getString(6),
                        resultSet.getString(7)),
                id);
    }

    private List<String> foldedRevisionValues(String documentId) {
        return jdbc.queryForObject(
                "SELECT \"foldedTitleVi\", \"foldedTitleEn\", \"foldedSummaryVi\","
                        + " \"foldedSummaryEn\", \"foldedBodyVi\", \"foldedBodyEn\""
                        + " FROM engagement.\"PublicDocumentRevision\""
                        + " WHERE \"documentId\" = ? AND \"revision\" = 1",
                (resultSet, ignored) -> List.of(
                        resultSet.getString(1),
                        resultSet.getString(2),
                        resultSet.getString(3),
                        resultSet.getString(4),
                        resultSet.getString(5),
                        resultSet.getString(6)),
                documentId);
    }

    private void insertAnnouncement(
            String id,
            String title,
            String content,
            String slug,
            String courseCode,
            String courseName,
            String semesterName,
            String lecturerDisplayName) {
        jdbc.update(
                "INSERT INTO engagement.\"Announcement\""
                        + " (\"id\", \"title\", \"content\", \"slug\", \"courseCode\","
                        + " \"courseName\", \"semesterName\", \"lecturerDisplayName\")"
                        + " VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                id, title, content, slug, courseCode, courseName, semesterName, lecturerDisplayName);
    }

    private void insertRevision(
            String documentId,
            String titleVi,
            String titleEn,
            String summaryVi,
            String summaryEn,
            String bodyVi,
            String bodyEn) {
        jdbc.update(
                "INSERT INTO engagement.\"PublicDocumentRevision\""
                        + " (\"documentId\", \"revision\", \"titleVi\", \"titleEn\", \"summaryVi\","
                        + " \"summaryEn\", \"bodyVi\", \"bodyEn\")"
                        + " VALUES (?, 1, ?, ?, ?, ?, ?, ?)",
                documentId, titleVi, titleEn, summaryVi, summaryEn, bodyVi, bodyEn);
    }

    private Timing measure(LongSupplier operation, int warmups, int iterations) {
        for (int index = 0; index < warmups; index++) {
            operation.getAsLong();
        }
        List<Long> nanos = new ArrayList<>(iterations);
        for (int index = 0; index < iterations; index++) {
            long start = System.nanoTime();
            operation.getAsLong();
            nanos.add(System.nanoTime() - start);
        }
        nanos.sort(Long::compare);
        return new Timing(
                nanos.get(0) / 1_000_000.0,
                nanos.get(nanos.size() / 2) / 1_000_000.0);
    }

    private static String value(String property, String environment) {
        String propertyValue = System.getProperty(property);
        if (propertyValue != null && !propertyValue.isBlank()) {
            return propertyValue;
        }
        String environmentValue = System.getenv(environment);
        return environmentValue == null || environmentValue.isBlank() ? null : environmentValue;
    }

    private record Timing(double minMillis, double medianMillis) {
    }
}
