package io.campuscore.restfulapi.engagement.repository;

import static org.assertj.core.api.Assertions.assertThat;

import io.campuscore.restfulapi.common.LikePattern;
import io.campuscore.restfulapi.engagement.repository.AnnouncementReadRepository.AnnouncementFilter;
import io.campuscore.restfulapi.engagement.repository.AnnouncementReadRepository.UserVisibility;
import io.campuscore.restfulapi.engagement.repository.PublicDocumentRepository.PublicListRow;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.Types;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import java.util.function.LongSupplier;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.core.io.ClassPathResource;
import org.springframework.core.io.support.EncodedResource;
import org.springframework.jdbc.core.ConnectionCallback;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.jdbc.datasource.init.ScriptUtils;

/**
 * V147 proof on H2: the generated-column DDL applies to the trimmed H2 chain,
 * every one of the 67 fold mappings is exercised in all seven announcement and
 * six revision columns, values refresh on writes, and the rewritten repository
 * predicates return exactly the same rows, counts and order as the legacy
 * {@code TRANSLATE(LOWER(...))} predicates.
 */
class FoldedSearchColumnTest {

    private static final String ANNOUNCEMENT_MIGRATION =
            "src/main/resources/db/migration/V147__engagement_folded_search_columns.sql";
    private static final String H2_MIGRATION =
            "src/test/resources/db/migration-h2/V147__engagement_folded_search_columns.sql";

    private JdbcTemplate jdbc;
    private NamedParameterJdbcTemplate namedJdbc;
    private AnnouncementReadRepository announcements;
    private PublicDocumentRepository documents;

    @BeforeEach
    void setUp() {
        String database = "folded_search_" + UUID.randomUUID().toString().replace("-", "");
        DriverManagerDataSource dataSource = new DriverManagerDataSource(
                "jdbc:h2:mem:" + database
                        + ";MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1",
                "sa",
                "");
        dataSource.setDriverClassName("org.h2.Driver");
        jdbc = new JdbcTemplate(dataSource);
        namedJdbc = new NamedParameterJdbcTemplate(jdbc);

        createAnnouncementTable();
        createPublicDocumentTables();
        applyMigration("db/migration-h2/V147__engagement_folded_search_columns.sql");

        announcements = new AnnouncementReadRepository(namedJdbc);
        documents = new PublicDocumentRepository(namedJdbc);
        seedBaseRows();
    }

    @Test
    void migrationLiteralsAreTheExactLikePatternMap() throws Exception {
        String postgres = Files.readString(Path.of(ANNOUNCEMENT_MIGRATION), StandardCharsets.UTF_8);
        String h2 = Files.readString(Path.of(H2_MIGRATION), StandardCharsets.UTF_8);

        assertThat(LikePattern.FOLD_FROM).hasSize(67);
        assertThat(LikePattern.FOLD_TO).hasSize(67);
        assertThat(count(postgres, "'" + LikePattern.FOLD_FROM + "'")).isEqualTo(13);
        assertThat(count(postgres, "'" + LikePattern.FOLD_TO + "'")).isEqualTo(13);
        assertThat(count(h2, "'" + LikePattern.FOLD_FROM + "'")).isEqualTo(13);
        assertThat(count(h2, "'" + LikePattern.FOLD_TO + "'")).isEqualTo(13);
        assertThat(postgres).contains("GENERATED ALWAYS AS").contains("STORED");
        assertThat(h2).contains("GENERATED ALWAYS AS");
    }

    @Test
    void h2GeneratedColumnsCoverAllAnnouncementAndRevisionFields() {
        insertAnnouncement(
                "all-map",
                LikePattern.FOLD_FROM,
                LikePattern.FOLD_FROM,
                LikePattern.FOLD_FROM,
                LikePattern.FOLD_FROM,
                LikePattern.FOLD_FROM,
                LikePattern.FOLD_FROM,
                LikePattern.FOLD_FROM,
                "2026-08-20T10:00:00Z");
        assertThat(foldedAnnouncementValues("all-map"))
                .containsOnly(LikePattern.FOLD_TO);

        insertDocument(
                "all-map-doc",
                "all-map-doc",
                "PUBLISHED",
                1,
                LikePattern.FOLD_FROM,
                LikePattern.FOLD_FROM,
                LikePattern.FOLD_FROM,
                LikePattern.FOLD_FROM,
                LikePattern.FOLD_FROM,
                LikePattern.FOLD_FROM,
                "2026-10-29T02:15:00Z");
        assertThat(foldedRevisionValues("all-map-doc"))
                .containsOnly(LikePattern.FOLD_TO);
    }

    @Test
    void generatedColumnsRefreshOnInsertAndUpdate() {
        insertAnnouncement(
                "refresh", "Nguyễn Văn Đức", "nội dung", "nguyen-van-duc",
                "SE401", "Lập trình Java", "Học kỳ 1", "GS.TS. Trần Đình Khôi",
                "2026-08-20T10:00:00Z");
        assertThat(foldedAnnouncementValues("refresh"))
                .containsExactly("nguyen van duc", "noi dung", "nguyen-van-duc",
                        "se401", "lap trinh java", "hoc ky 1", "gs.ts. tran dinh khoi");

        jdbc.update("UPDATE \"engagement\".\"Announcement\""
                        + " SET \"title\" = 'ĐƯỜNG VỀ NHÀ', \"content\" = 'MỚI',"
                        + " \"slug\" = 'duong-ve-nha', \"courseCode\" = 'IT_101',"
                        + " \"courseName\" = 'Hệ điều hành', \"semesterName\" = 'Học kỳ 2',"
                        + " \"lecturerDisplayName\" = 'ThS. Lê Văn An'"
                        + " WHERE \"id\" = 'refresh'");
        assertThat(foldedAnnouncementValues("refresh"))
                .containsExactly("duong ve nha", "moi", "duong-ve-nha",
                        "it_101", "he dieu hanh", "hoc ky 2", "ths. le van an");

        jdbc.update("UPDATE \"engagement\".\"PublicDocumentRevision\""
                        + " SET \"titleVi\" = 'ĐƯỜNG', \"bodyEn\" = 'NEW BODY'"
                        + " WHERE \"documentId\" = 'doc-quy-dinh' AND \"revision\" = 1");
        assertThat(foldedRevisionValues("doc-quy-dinh").get(0)).isEqualTo("duong");
        assertThat(foldedRevisionValues("doc-quy-dinh").get(5)).isEqualTo("new body");
    }

    @Test
    void announcementSearchIsEquivalentToLegacyPredicate() {
        for (String term : announcementTerms()) {
            List<String> expected = legacyAnnouncementIds(term);
            long expectedCount = legacyAnnouncementCount(term);

            List<String> actual = announcements
                    .findAll(new AnnouncementFilter(null, null, null, null, term), 0, 100)
                    .stream()
                    .map(response -> response.id())
                    .toList();

            assertThat(actual).as("ids for term <%s>", term)
                    .containsExactlyElementsOf(expected);
            assertThat(announcements.countAll(new AnnouncementFilter(null, null, null, null, term)))
                    .as("count for term <%s>", term)
                    .isEqualTo(expectedCount);
        }

        assertThat(announcementIds("lich thi")).containsExactly("a-folded");
        assertThat(announcementIds("SE401 java")).containsExactly("a-folded");
        assertThat(announcementIds("GS.TS. Trần")).containsExactly("a-folded");
        assertThat(announcementIds("100%")).containsExactly("c-wild");
        assertThat(announcementIds("a_b")).containsExactly("c-wild");
        assertThat(announcementIds("back\\slash")).containsExactly("c-wild");
        assertThat(announcementIds(LikePattern.FOLD_FROM)).containsExactly("e-map");
        assertThat(announcementIds("tuyet-doi-khong-trung")).isEmpty();
        assertThat(announcementIds("")).containsExactly("d-unicode", "c-wild", "a-folded", "b-null", "e-map");
    }

    @Test
    void publicDocumentSearchIsEquivalentToLegacyPredicate() {
        for (String term : documentTerms()) {
            List<String> expected = legacyDocumentSlugs(term);
            long expectedCount = legacyDocumentCount(term);

            List<String> actual = documents.findPublic(term, null, null, 0, 100)
                    .stream()
                    .map(PublicListRow::slug)
                    .toList();

            assertThat(actual).as("slugs for term <%s>", term)
                    .containsExactlyElementsOf(expected);
            assertThat(documents.countPublic(term, null, null))
                    .as("count for term <%s>", term)
                    .isEqualTo(expectedCount);
        }

        assertThat(documentSlugs("hoc vu")).containsExactly("quy-dinh-hoc-vu");
        assertThat(documentSlugs("regulations")).containsExactly("quy-dinh-hoc-vu");
        assertThat(documentSlugs("borrowing")).containsExactly("huong-dan-thu-vien");
        assertThat(documentSlugs("100%")).containsExactly("literal-doc");
        assertThat(documentSlugs("a_b")).containsExactly("literal-doc");
        assertThat(documentSlugs("back\\slash")).containsExactly("literal-doc");
        assertThat(documentSlugs("muon sach")).doesNotContain("draft-doc");
        assertThat(documentSlugs("")).containsExactly("huong-dan-thu-vien", "quy-dinh-hoc-vu", "literal-doc");
    }

    @Test
    void nullFieldsAndUnicodeStayLiteralAndBounded() {
        assertThat(jdbc.queryForObject(
                        "SELECT \"foldedSlug\" FROM \"engagement\".\"Announcement\" WHERE \"id\" = 'b-null'",
                        String.class))
                .isEmpty();
        assertThat(jdbc.queryForObject(
                        "SELECT \"foldedLecturerDisplayName\" FROM \"engagement\".\"Announcement\" WHERE \"id\" = 'b-null'",
                        String.class))
                .isEmpty();
        assertThat(jdbc.queryForObject(
                        "SELECT \"foldedSummaryVi\" FROM \"engagement\".\"PublicDocumentRevision\""
                                + " WHERE \"documentId\" = 'doc-thu-vien' AND \"revision\" = 1",
                        String.class))
                .isEmpty();

        assertThat(announcementIds("日本語")).containsExactly("d-unicode");
        assertThat(announcementIds("😀")).containsExactly("d-unicode");
        assertThat(announcementIds("Đường")).containsExactly("d-unicode", "c-wild");
        assertThat(announcementIds("duong")).containsExactly("d-unicode", "c-wild");
        assertThat(documentSlugs("日本語")).containsExactly("literal-doc");
    }

    @Test
    void userFeedVisibilityIsUnchanged() {
        Instant now = Instant.parse("2026-08-20T12:30:00Z");
        UserVisibility visibility = new UserVisibility(List.of(), null, null, null, now);
        assertThat(announcements.countForUser(visibility)).isEqualTo(5);
        assertThat(announcements.findForUser(visibility, 0, 100))
                .extracting(response -> response.id())
                .containsExactly("d-unicode", "c-wild", "a-folded", "b-null", "e-map");
    }

    @Test
    void reportsJdbcTimingForLegacyAndFoldedPredicates() {
        int announcementRows = 12_000;
        int documentRows = 4_000;
        seedBulkAnnouncements(announcementRows);
        seedBulkDocuments(documentRows);

        String announcementTerm = "zzbulk";
        String documentTerm = "zzbulk";

        long legacyAnnouncementCount = legacyAnnouncementCount(announcementTerm);
        long foldedAnnouncementCount = announcements.countAll(
                new AnnouncementFilter(null, null, null, null, announcementTerm));
        assertThat(foldedAnnouncementCount).isEqualTo(legacyAnnouncementCount)
                .isEqualTo(announcementRows);

        Timing legacyAnnouncement = measure(() -> legacyAnnouncementCount(announcementTerm), 3, 8);
        Timing foldedAnnouncement = measure(
                () -> announcements.countAll(new AnnouncementFilter(null, null, null, null, announcementTerm)),
                3,
                8);

        long legacyDocumentCount = legacyDocumentCount(documentTerm);
        long foldedDocumentCount = documents.countPublic(documentTerm, null, null);
        assertThat(foldedDocumentCount).isEqualTo(legacyDocumentCount).isEqualTo(documentRows);

        Timing legacyDocument = measure(() -> legacyDocumentCount(documentTerm), 3, 8);
        Timing foldedDocument = measure(() -> documents.countPublic(documentTerm, null, null), 3, 8);

        System.out.printf(Locale.ROOT,
                "H2 folded-search JDBC count timings (best of %d after %d warmups):%n"
                        + "  announcements legacy=%d rows min=%.3f ms median=%.3f ms | folded min=%.3f ms median=%.3f ms%n"
                        + "  documents     legacy=%d rows min=%.3f ms median=%.3f ms | folded min=%.3f ms median=%.3f ms%n",
                8, 3,
                legacyAnnouncementCount, legacyAnnouncement.minMillis(), legacyAnnouncement.medianMillis(),
                foldedAnnouncement.minMillis(), foldedAnnouncement.medianMillis(),
                legacyDocumentCount, legacyDocument.minMillis(), legacyDocument.medianMillis(),
                foldedDocument.minMillis(), foldedDocument.medianMillis());

        assertThat(foldedAnnouncement.minMillis()).isLessThan(legacyAnnouncement.minMillis());
        assertThat(foldedDocument.minMillis()).isLessThan(legacyDocument.minMillis());
    }

    private List<String> announcementTerms() {
        return List.of(
                "",
                "lich thi",
                "Lịch thi",
                "SE401 java",
                "GS.TS. Trần",
                "Content",
                "100%",
                "a_b",
                "back\\slash",
                "Đường",
                "日本語",
                "😀",
                LikePattern.FOLD_FROM,
                "tuyet-doi-khong-trung",
                "   ");
    }

    private List<String> documentTerms() {
        return List.of(
                "",
                "hoc vu",
                "Học vụ",
                "regulations",
                "borrowing",
                "tom tat",
                "100%",
                "a_b",
                "back\\slash",
                "日本語",
                "muon sach",
                "tuyet-doi-khong-trung",
                "   ");
    }

    private List<String> announcementIds(String term) {
        return announcements.findAll(new AnnouncementFilter(null, null, null, null, term), 0, 100)
                .stream()
                .map(response -> response.id())
                .toList();
    }

    private List<String> documentSlugs(String term) {
        return documents.findPublic(term, null, null, 0, 100)
                .stream()
                .map(PublicListRow::slug)
                .toList();
    }

    private List<String> legacyAnnouncementIds(String term) {
        List<String> tokens = LikePattern.tokens(term);
        MapSqlParameterSource parameters = new MapSqlParameterSource();
        String where = "";
        if (!tokens.isEmpty()) {
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
            where = " WHERE " + String.join(" AND ", conditions);
        }
        return namedJdbc.query(
                "SELECT \"id\" FROM \"engagement\".\"Announcement\"" + where
                        + AnnouncementReadRepository.DISPLAY_ORDER_CLAUSE + " LIMIT 100",
                parameters,
                (resultSet, ignored) -> resultSet.getString(1));
    }

    private long legacyAnnouncementCount(String term) {
        List<String> tokens = LikePattern.tokens(term);
        MapSqlParameterSource parameters = new MapSqlParameterSource();
        String where = legacyAnnouncementWhere(tokens, parameters);
        Long count = namedJdbc.queryForObject(
                "SELECT COUNT(*) FROM \"engagement\".\"Announcement\"" + where,
                parameters,
                Long.class);
        return count == null ? 0 : count;
    }

    private List<String> legacyDocumentSlugs(String term) {
        List<String> tokens = LikePattern.tokens(term);
        MapSqlParameterSource parameters = new MapSqlParameterSource();
        String where = " WHERE d.\"status\" = 'PUBLISHED'" + legacyDocumentSearch(tokens, parameters);
        return namedJdbc.query(
                "SELECT d.\"slug\" FROM \"engagement\".\"PublicDocument\" d"
                        + " JOIN \"engagement\".\"PublicDocumentRevision\" rev"
                        + " ON rev.\"documentId\" = d.\"id\" AND rev.\"revision\" = d.\"publishedRevision\""
                        + where
                        + " ORDER BY rev.\"reviewedAt\" DESC, d.\"slug\" DESC LIMIT 100",
                parameters,
                (resultSet, ignored) -> resultSet.getString(1));
    }

    private long legacyDocumentCount(String term) {
        List<String> tokens = LikePattern.tokens(term);
        MapSqlParameterSource parameters = new MapSqlParameterSource();
        String where = " WHERE d.\"status\" = 'PUBLISHED'" + legacyDocumentSearch(tokens, parameters);
        Long count = namedJdbc.queryForObject(
                "SELECT COUNT(*) FROM \"engagement\".\"PublicDocument\" d"
                        + " JOIN \"engagement\".\"PublicDocumentRevision\" rev"
                        + " ON rev.\"documentId\" = d.\"id\" AND rev.\"revision\" = d.\"publishedRevision\""
                        + where,
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

    private String legacyDocumentSearch(List<String> tokens, MapSqlParameterSource parameters) {
        if (tokens.isEmpty()) {
            return "";
        }
        parameters.addValue("foldFrom", LikePattern.FOLD_FROM);
        parameters.addValue("foldTo", LikePattern.FOLD_TO);
        List<String> conditions = new ArrayList<>();
        for (int index = 0; index < tokens.size(); index++) {
            String parameter = "search" + index;
            parameters.addValue(parameter, tokens.get(index));
            conditions.add("(TRANSLATE(LOWER(COALESCE(rev.\"titleVi\", '')), :foldFrom, :foldTo) LIKE :" + parameter + " ESCAPE '\\'"
                    + " OR TRANSLATE(LOWER(COALESCE(rev.\"titleEn\", '')), :foldFrom, :foldTo) LIKE :" + parameter + " ESCAPE '\\'"
                    + " OR TRANSLATE(LOWER(COALESCE(rev.\"summaryVi\", '')), :foldFrom, :foldTo) LIKE :" + parameter + " ESCAPE '\\'"
                    + " OR TRANSLATE(LOWER(COALESCE(rev.\"summaryEn\", '')), :foldFrom, :foldTo) LIKE :" + parameter + " ESCAPE '\\'"
                    + " OR TRANSLATE(LOWER(COALESCE(rev.\"bodyVi\", '')), :foldFrom, :foldTo) LIKE :" + parameter + " ESCAPE '\\'"
                    + " OR TRANSLATE(LOWER(COALESCE(rev.\"bodyEn\", '')), :foldFrom, :foldTo) LIKE :" + parameter + " ESCAPE '\\')");
        }
        return " AND " + String.join(" AND ", conditions);
    }

    private List<String> foldedAnnouncementValues(String id) {
        return jdbc.query(
                "SELECT \"foldedTitle\", \"foldedContent\", \"foldedSlug\", \"foldedCourseCode\","
                        + " \"foldedCourseName\", \"foldedSemesterName\", \"foldedLecturerDisplayName\""
                        + " FROM \"engagement\".\"Announcement\" WHERE \"id\" = ?",
                (resultSet, ignored) -> List.of(
                        resultSet.getString(1),
                        resultSet.getString(2),
                        resultSet.getString(3),
                        resultSet.getString(4),
                        resultSet.getString(5),
                        resultSet.getString(6),
                        resultSet.getString(7)),
                id).get(0);
    }

    private List<String> foldedRevisionValues(String documentId) {
        return jdbc.query(
                "SELECT \"foldedTitleVi\", \"foldedTitleEn\", \"foldedSummaryVi\","
                        + " \"foldedSummaryEn\", \"foldedBodyVi\", \"foldedBodyEn\""
                        + " FROM \"engagement\".\"PublicDocumentRevision\""
                        + " WHERE \"documentId\" = ? AND \"revision\" = 1",
                (resultSet, ignored) -> List.of(
                        resultSet.getString(1),
                        resultSet.getString(2),
                        resultSet.getString(3),
                        resultSet.getString(4),
                        resultSet.getString(5),
                        resultSet.getString(6)),
                documentId).get(0);
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

    private void seedBaseRows() {
        insertAnnouncement(
                "a-folded",
                "Lịch thi giữa kỳ",
                "Nội dung chính thức",
                "lich-thi-giua-ky",
                "SE401",
                "Lập trình Java nâng cao",
                "Học kỳ 1",
                "GS.TS. Trần Đình Khôi",
                "2026-08-20T10:00:00Z");
        insertAnnouncement(
                "b-null",
                "Thông báo chung",
                "Không có gì",
                null,
                null,
                null,
                null,
                null,
                "2026-08-20T09:00:00Z");
        insertAnnouncement(
                "c-wild",
                "Mức 100% và mã a_b",
                "Đường dẫn C:\\back\\slash",
                "muc-100-va-a_b",
                "IT_101",
                "Hệ điều hành",
                null,
                null,
                "2026-08-20T11:00:00Z");
        insertAnnouncement(
                "d-unicode",
                "Đường về nhà",
                "日本語 😀",
                "duong-ve-nha",
                null,
                null,
                null,
                null,
                "2026-08-20T12:00:00Z");
        insertAnnouncement(
                "e-map",
                LikePattern.FOLD_FROM,
                "x",
                "map",
                null,
                null,
                null,
                null,
                "2026-08-20T08:00:00Z");

        insertDocument(
                "doc-quy-dinh",
                "quy-dinh-hoc-vu",
                "PUBLISHED",
                1,
                "Quy định học vụ",
                "Academic regulations",
                "Tóm tắt học vụ",
                "Academic summary",
                "<p>Nội dung học vụ chi tiết</p>",
                "<p>Academic body</p>",
                "2026-10-29T02:15:00Z");
        insertDocument(
                "doc-thu-vien",
                "huong-dan-thu-vien",
                "PUBLISHED",
                1,
                "Hướng dẫn thư viện",
                "Library guide",
                null,
                null,
                "Mượn sách",
                "Borrowing books",
                "2026-10-30T02:15:00Z");
        insertDocument(
                "doc-literal",
                "literal-doc",
                "PUBLISHED",
                1,
                "Mức 100% a_b",
                "Literal document",
                null,
                null,
                "Đường dẫn C:\\back\\slash",
                "日本語 body",
                "2026-10-28T02:15:00Z");
        insertDocument(
                "draft-doc",
                "draft-doc",
                "DRAFT",
                1,
                "Mượn sách nháp",
                "Draft borrowing",
                null,
                null,
                "Mượn sách",
                "Borrowing books",
                "2026-10-31T02:15:00Z");
    }

    private void seedBulkAnnouncements(int rows) {
        jdbc.execute((ConnectionCallback<Void>) connection -> {
            try (PreparedStatement statement = connection.prepareStatement("""
                    INSERT INTO "engagement"."Announcement" (
                        "id", "title", "content", "slug", "priority", "targetRoles",
                        "targetYears", "isGlobal", "semesterName", "courseCode",
                        "courseName", "lecturerDisplayName", "createdAt", "updatedAt", "status"
                    ) VALUES (?, ?, ?, ?, 'NORMAL', ?, ?, TRUE, ?, ?, ?, ?, ?, ?, 'PUBLISHED')
                    """)) {
                for (int index = 0; index < rows; index++) {
                    statement.setString(1, "bulk-" + index);
                    statement.setString(2, "Thông báo " + index);
                    statement.setString(3, "Nội dung thông báo thường " + index);
                    statement.setString(4, "bulk-" + index);
                    statement.setArray(5, connection.createArrayOf("VARCHAR", new String[0]));
                    statement.setArray(6, connection.createArrayOf("INTEGER", new Integer[0]));
                    statement.setString(7, "Học kỳ 1");
                    statement.setString(8, "SE" + index);
                    statement.setString(9, "Môn học " + index);
                    statement.setString(10, "Giảng viên zzbulk " + index);
                    statement.setObject(11, OffsetDateTime.parse("2026-08-20T10:00:00Z"));
                    statement.setObject(12, OffsetDateTime.parse("2026-08-20T10:00:00Z"));
                    statement.addBatch();
                }
                statement.executeBatch();
            }
            return null;
        });
    }

    private void seedBulkDocuments(int rows) {
        for (int index = 0; index < rows; index++) {
            insertDocument(
                    "bulk-doc-" + index,
                    "bulk-doc-" + index,
                    "PUBLISHED",
                    1,
                    "Tài liệu " + index,
                    "Document " + index,
                    null,
                    null,
                    "Nội dung thường " + index,
                    "Body zzbulk " + index,
                    "2026-10-29T02:15:00Z");
        }
    }

    private void createAnnouncementTable() {
        jdbc.execute("CREATE SCHEMA IF NOT EXISTS \"engagement\"");
        jdbc.execute("""
                CREATE TABLE "engagement"."Announcement" (
                    "id" VARCHAR(120) PRIMARY KEY,
                    "title" VARCHAR(240) NOT NULL,
                    "content" TEXT NOT NULL,
                    "slug" VARCHAR(240),
                    "priority" VARCHAR(40) NOT NULL,
                    "targetRoles" VARCHAR ARRAY NOT NULL,
                    "targetYears" INTEGER ARRAY NOT NULL,
                    "isGlobal" BOOLEAN NOT NULL,
                    "publishAt" TIMESTAMP WITH TIME ZONE,
                    "expiresAt" TIMESTAMP WITH TIME ZONE,
                    "publishedBy" VARCHAR(120),
                    "semesterId" VARCHAR(120),
                    "semesterName" VARCHAR(200),
                    "sectionId" VARCHAR(120),
                    "sectionNumber" VARCHAR(80),
                    "courseCode" VARCHAR(80),
                    "courseName" VARCHAR(200),
                    "lecturerId" VARCHAR(120),
                    "lecturerDisplayName" VARCHAR(200),
                    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL,
                    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL,
                    "version" INTEGER NOT NULL DEFAULT 0,
                    "archivedAt" TIMESTAMP WITH TIME ZONE,
                    "archivedBy" VARCHAR(120),
                    "status" VARCHAR(30) NOT NULL,
                    "authorId" VARCHAR(120),
                    "reviewerId" VARCHAR(120),
                    "reviewedAt" TIMESTAMP WITH TIME ZONE,
                    "reviewNote" VARCHAR(500),
                    "publishedRevision" INTEGER,
                    "displayOrder" INTEGER
                )
                """);
    }

    private void createPublicDocumentTables() {
        jdbc.execute("""
                CREATE TABLE "engagement"."PublicDocument" (
                    "id" VARCHAR(120) PRIMARY KEY,
                    "slug" VARCHAR(240) NOT NULL,
                    "status" VARCHAR(30) NOT NULL,
                    "authorId" VARCHAR(120) NOT NULL,
                    "currentRevision" INTEGER NOT NULL,
                    "publishedRevision" INTEGER,
                    "categoryId" VARCHAR(60),
                    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL,
                    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL
                )
                """);
        jdbc.execute("""
                CREATE TABLE "engagement"."PublicDocumentRevision" (
                    "documentId" VARCHAR(120) NOT NULL,
                    "revision" INTEGER NOT NULL,
                    "state" VARCHAR(30) NOT NULL,
                    "titleVi" VARCHAR(240) NOT NULL,
                    "titleEn" VARCHAR(240) NOT NULL,
                    "summaryVi" VARCHAR(500),
                    "summaryEn" VARCHAR(500),
                    "bodyVi" CLOB NOT NULL,
                    "bodyEn" CLOB NOT NULL,
                    "authorId" VARCHAR(120) NOT NULL,
                    "reviewerId" VARCHAR(120),
                    "reviewedAt" TIMESTAMP WITH TIME ZONE,
                    "reviewNote" VARCHAR(500),
                    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL,
                    PRIMARY KEY ("documentId", "revision")
                )
                """);
    }

    private void applyMigration(String classpath) {
        jdbc.execute((ConnectionCallback<Void>) connection -> {
            ScriptUtils.executeSqlScript(
                    connection,
                    new EncodedResource(new ClassPathResource(classpath), StandardCharsets.UTF_8));
            return null;
        });
    }

    private void insertAnnouncement(
            String id,
            String title,
            String content,
            String slug,
            String courseCode,
            String courseName,
            String semesterName,
            String lecturerDisplayName,
            String createdAt) {
        jdbc.execute((ConnectionCallback<Void>) connection -> {
            try (PreparedStatement statement = connection.prepareStatement("""
                    INSERT INTO "engagement"."Announcement" (
                        "id", "title", "content", "slug", "priority", "targetRoles",
                        "targetYears", "isGlobal", "semesterName", "courseCode",
                        "courseName", "lecturerDisplayName", "createdAt", "updatedAt", "status"
                    ) VALUES (?, ?, ?, ?, 'NORMAL', ?, ?, TRUE, ?, ?, ?, ?, ?, ?, 'PUBLISHED')
                    """)) {
                statement.setString(1, id);
                statement.setString(2, title);
                statement.setString(3, content);
                statement.setString(4, slug);
                statement.setArray(5, connection.createArrayOf("VARCHAR", new String[0]));
                statement.setArray(6, connection.createArrayOf("INTEGER", new Integer[0]));
                statement.setString(7, semesterName);
                statement.setString(8, courseCode);
                statement.setString(9, courseName);
                statement.setString(10, lecturerDisplayName);
                statement.setObject(11, OffsetDateTime.parse(createdAt));
                statement.setObject(12, OffsetDateTime.parse(createdAt));
                statement.executeUpdate();
            }
            return null;
        });
    }

    private void insertDocument(
            String id,
            String slug,
            String status,
            Integer publishedRevision,
            String titleVi,
            String titleEn,
            String summaryVi,
            String summaryEn,
            String bodyVi,
            String bodyEn,
            String reviewedAt) {
        jdbc.update(
                "INSERT INTO \"engagement\".\"PublicDocument\""
                        + " (\"id\", \"slug\", \"status\", \"authorId\", \"currentRevision\","
                        + " \"publishedRevision\", \"categoryId\", \"createdAt\", \"updatedAt\")"
                        + " VALUES (?, ?, ?, 'author-1', 1, ?, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)",
                id,
                slug,
                status,
                publishedRevision);
        jdbc.update(
                "INSERT INTO \"engagement\".\"PublicDocumentRevision\""
                        + " (\"documentId\", \"revision\", \"state\", \"titleVi\", \"titleEn\","
                        + " \"summaryVi\", \"summaryEn\", \"bodyVi\", \"bodyEn\", \"authorId\","
                        + " \"reviewerId\", \"reviewedAt\", \"createdAt\")"
                        + " VALUES (?, 1, 'PUBLISHED', ?, ?, ?, ?, ?, ?, 'author-1', 'admin-1', ?, ?)",
                id,
                titleVi,
                titleEn,
                summaryVi,
                summaryEn,
                bodyVi,
                bodyEn,
                OffsetDateTime.parse(reviewedAt),
                OffsetDateTime.parse(reviewedAt));
    }

    private static int count(String source, String needle) {
        int count = 0;
        int index = 0;
        while ((index = source.indexOf(needle, index)) >= 0) {
            count++;
            index += needle.length();
        }
        return count;
    }

    private record Timing(double minMillis, double medianMillis) {
    }
}
