package io.campuscore.restfulapi.thesis.service;

import io.campuscore.restfulapi.web.DomainException;
import java.text.Normalizer;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;

/**
 * Server-side archive search policy for {@code GET /thesis/rounds/{id}/repository}.
 *
 * <p>It reproduces the round page's client predicate exactly, and deliberately
 * does <b>not</b> reuse {@code common.LikePattern}: that helper truncates at 64
 * characters, caps eight tokens and strips honorifics, while the web predicate
 * does none of those things. Every token of the request is kept and bound as a
 * LIKE literal.
 *
 * <p><b>Fold.</b> The web folds with {@code normalize('NFD')}, removes
 * U+0300..U+036F, maps {@code đ/Đ} to {@code d} and lower-cases. Tokens are
 * folded here in Java with that exact order. Stored values are folded in SQL:
 * combining marks are stripped with {@code REGEXP_REPLACE(..., 'g')} and every
 * precomposed Latin letter that canonically decomposes to base + marks is
 * mapped to its lower-case base with {@code TRANSLATE}. The translate pair is
 * generated from {@link Normalizer} (same source as the Java fold), so it
 * covers Vietnamese, Latin-1 and Latin Extended-A/B/Additional without a
 * hand-maintained table and without an extension or index.
 *
 * <p><b>Known limitation.</b> SQL folding is defined for BMP Latin characters.
 * Astral-plane letters with a canonical decomposition and upper-case letters of
 * non-Latin scripts depend on the database {@code LOWER()} collation, whereas the
 * browser folds them. Vietnamese and the Latin script used by this archive are
 * covered by the parity fixture and the PostgreSQL suite.
 */
public final class ThesisArchiveSearch {

    public static final String ARCHIVE_TOTAL_HEADER = "X-Archive-Total-Count";
    public static final String ARCHIVE_FILE_HEADER = "X-Archive-File-Count";
    public static final String ARCHIVE_URL_HEADER = "X-Archive-Url-Count";

    public static final String ARCHIVE_TOTAL_DOC =
            "Tổng số báo cáo đã phân quyền của đợt, không phụ thuộc search";
    public static final String ARCHIVE_FILE_DOC =
            "Số báo cáo đã phân quyền có tên tệp khác rỗng, không phụ thuộc search";
    public static final String ARCHIVE_URL_DOC =
            "Số báo cáo đã phân quyền có URL khác rỗng, không phụ thuộc search";
    public static final String SEARCH_DOC =
            "Từ khóa tìm kiếm trên kho báo cáo (chỉ một giá trị); so khớp không dấu, không phân biệt hoa thường";

    public static final String INVALID_SEARCH_CODE = "INVALID_SEARCH";
    private static final String SEARCH_PARAMETER = "search";

    /** ECMAScript combining-mark range removed by the web fold. */
    static final String COMBINING_MARKS = "[" + '\u0300' + "-" + '\u036F' + "]";

    /** Precomposed Latin letters mapped to their lower-case base letter. */
    static final String FOLD_FROM;
    static final String FOLD_TO;

    private static final int[][] LATIN_FOLD_RANGES = {{0x00C0, 0x024F}, {0x1E00, 0x1EFF}};

    /**
     * Root-level searchable values. The topic title falls back to the report
     * title only when the topic title is empty, exactly like
     * {@code topicTitle || title} in the page.
     */
    private static final String TOPIC_TITLE =
            "CASE WHEN COALESCE(t.title, '') = '' THEN COALESCE(r.title, '') ELSE t.title END";
    private static final String SUBMITTER_NAME =
            "CASE WHEN BTRIM(COALESCE(submitter_user.\"lastName\", '') || ' ' || "
            + "COALESCE(submitter_user.\"firstName\", '')) <> '' THEN "
            + "BTRIM(COALESCE(submitter_user.\"lastName\", '') || ' ' || "
            + "COALESCE(submitter_user.\"firstName\", '')) ELSE '' END";
    private static final String MEMBER_NAME =
            "CASE WHEN BTRIM(COALESCE(member_user.\"lastName\", '') || ' ' || "
            + "COALESCE(member_user.\"firstName\", '')) <> '' THEN "
            + "BTRIM(COALESCE(member_user.\"lastName\", '') || ' ' || "
            + "COALESCE(member_user.\"firstName\", '')) ELSE COALESCE(member.display_name, '') END";
    private static final String SUPERVISOR_NAME =
            "CASE WHEN BTRIM(COALESCE(supervisor_user.\"lastName\", '') || ' ' || "
            + "COALESCE(supervisor_user.\"firstName\", '')) <> '' THEN "
            + "BTRIM(COALESCE(supervisor_user.\"lastName\", '') || ' ' || "
            + "COALESCE(supervisor_user.\"firstName\", '')) ELSE '' END";

    static {
        Map<Character, Character> pairs = new LinkedHashMap<>();
        // ASCII case folding is explicit so the predicate does not depend on the
        // database collation for the common case.
        for (char letter = 'A'; letter <= 'Z'; letter++) {
            pairs.put(letter, (char) (letter + ('a' - 'A')));
        }
        for (int[] range : LATIN_FOLD_RANGES) {
            for (int codePoint = range[0]; codePoint <= range[1]; codePoint++) {
                Character base = foldableBase(codePoint);
                if (base == null) {
                    continue;
                }
                pairs.putIfAbsent((char) codePoint, base);
            }
        }
        pairs.putIfAbsent('đ', 'd');
        pairs.putIfAbsent('Đ', 'd');

        StringBuilder from = new StringBuilder(pairs.size());
        StringBuilder to = new StringBuilder(pairs.size());
        pairs.forEach((source, target) -> {
            from.append(source);
            to.append(target);
        });
        if (from.toString().contains("'") || to.toString().contains("'")) {
            throw new IllegalStateException("fold map cannot be embedded in a SQL literal");
        }
        FOLD_FROM = from.toString();
        FOLD_TO = to.toString();
    }

    private ThesisArchiveSearch() {
    }

    /**
     * Rejects a repeated {@code search} parameter with {@code 400 INVALID_SEARCH}.
     * Called with {@link jakarta.servlet.http.HttpServletRequest#getParameterValues}
     * so two identical values are still rejected.
     */
    public static String singleValued(String search, String[] rawValues) {
        if (rawValues != null && rawValues.length > 1) {
            throw new DomainException(HttpStatus.BAD_REQUEST, INVALID_SEARCH_CODE,
                    "search may be specified only once");
        }
        return search;
    }

    /**
     * Folded tokens of the request; an empty list means "no predicate". Blank or
     * mark-only input yields no tokens, which matches the web predicate's
     * {@code every(...)} over an empty token list.
     */
    static List<String> tokens(String search) {
        String folded = fold(search);
        if (folded.isEmpty()) {
            return List.of();
        }
        List<String> tokens = new ArrayList<>();
        int start = -1;
        for (int index = 0; index < folded.length(); index++) {
            if (isJavaScriptWhitespace(folded.charAt(index))) {
                if (start >= 0) {
                    tokens.add(folded.substring(start, index));
                    start = -1;
                }
            } else if (start < 0) {
                start = index;
            }
        }
        if (start >= 0) {
            tokens.add(folded.substring(start));
        }
        return tokens;
    }

    /** NFD, drop U+0300..U+036F, đ/Đ to d, lower case — the web order. */
    static String fold(String value) {
        if (value == null || value.isEmpty()) {
            return "";
        }
        String decomposed = Normalizer.normalize(value, Normalizer.Form.NFD);
        StringBuilder out = new StringBuilder(decomposed.length());
        for (int index = 0; index < decomposed.length(); index++) {
            char character = decomposed.charAt(index);
            if (character >= 0x0300 && character <= 0x036F) {
                continue;
            }
            if (character == 'đ' || character == 'Đ') {
                out.append('d');
                continue;
            }
            out.append(character);
        }
        return out.toString().toLowerCase(Locale.ROOT);
    }

    /** {@code [token]} escaped for {@code LIKE ... ESCAPE '\'} and wrapped in {@code %}. */
    static String likePattern(String foldedToken) {
        String escaped = foldedToken
                .replace("\\", "\\\\")
                .replace("%", "\\%")
                .replace("_", "\\_");
        return "%" + escaped + "%";
    }

    /**
     * Builds the AND-across-tokens / OR-across-fields predicate and binds one
     * LIKE parameter per token plus the shared fold map. Returns an empty string
     * when no token applies, so an omitted or blank search keeps the exact
     * legacy SQL.
     */
    static String condition(List<String> tokens, MapSqlParameterSource parameters) {
        if (tokens == null || tokens.isEmpty()) {
            return "";
        }
        parameters.addValue("archiveFoldFrom", FOLD_FROM).addValue("archiveFoldTo", FOLD_TO);
        StringBuilder condition = new StringBuilder();
        for (int index = 0; index < tokens.size(); index++) {
            String parameter = "archiveSearchToken" + index;
            parameters.addValue(parameter, likePattern(tokens.get(index)));
            String like = " LIKE :" + parameter + " ESCAPE '\\'";
            condition.append(" AND (")
                    .append(sqlFold(TOPIC_TITLE)).append(like)
                    .append(" OR ").append(sqlFold("t.description")).append(like)
                    .append(" OR ").append(sqlFold("r.note")).append(like)
                    .append(" OR ").append(sqlFold("r.file_name")).append(like)
                    .append(" OR ").append(sqlFold("COALESCE(d.\"name\", t.department_id)")).append(like)
                    .append(" OR ").append(sqlFold(SUBMITTER_NAME)).append(like)
                    .append(" OR ").append(sqlFold("submitted_student.\"studentId\"")).append(like)
                    .append(" OR ").append(memberExists(like))
                    .append(" OR ").append(supervisorExists(like))
                    .append(")");
        }
        return condition.substring(" AND ".length());
    }

    /**
     * Fold expression for a stored text expression, portable across H2 and
     * PostgreSQL. The fold map is bound, not inlined: the same two parameters
     * are reused by every field of every token, so the statement stays small.
     */
    static String sqlFold(String expression) {
        return "LOWER(TRANSLATE(REGEXP_REPLACE(COALESCE(" + expression + ", ''), '"
                + COMBINING_MARKS + "', '', 'g'), :archiveFoldFrom, :archiveFoldTo))";
    }

    private static String memberExists(String like) {
        return "EXISTS (SELECT 1 FROM thesis.thesis_group_member member "
                + "LEFT JOIN campuscore_auth.\"Student\" member_student "
                + "ON member_student.\"id\" = member.student_id "
                + "LEFT JOIN campuscore_auth.\"User\" member_user "
                + "ON member_user.\"id\" = member_student.\"userId\" "
                + "WHERE member.group_id = g.id AND member.student_id IS NOT NULL AND ("
                + sqlFold(MEMBER_NAME) + like
                + " OR " + sqlFold("member_student.\"studentId\"") + like
                + "))";
    }

    private static String supervisorExists(String like) {
        return "EXISTS (SELECT 1 FROM thesis.thesis_topic_supervisor supervisor "
                + "LEFT JOIN campuscore_auth.\"Lecturer\" supervisor_profile "
                + "ON supervisor_profile.\"id\" = supervisor.lecturer_id "
                + "LEFT JOIN campuscore_auth.\"User\" supervisor_user "
                + "ON supervisor_user.\"id\" = supervisor_profile.\"userId\" "
                + "WHERE supervisor.topic_id = t.id AND supervisor.lecturer_id IS NOT NULL AND ("
                + sqlFold(SUPERVISOR_NAME) + like
                + "))";
    }

    /**
     * The lower-case base of a character that canonically decomposes to exactly
     * one base letter plus marks inside U+0300..U+036F, or {@code null}.
     */
    private static Character foldableBase(int codePoint) {
        if (codePoint > Character.MAX_VALUE || !Character.isBmpCodePoint(codePoint)) {
            return null;
        }
        String value = String.valueOf((char) codePoint);
        String decomposed = Normalizer.normalize(value, Normalizer.Form.NFD);
        if (decomposed.equals(value)) {
            return null;
        }
        StringBuilder base = new StringBuilder(decomposed.length());
        for (int index = 0; index < decomposed.length(); ) {
            int part = decomposed.codePointAt(index);
            index += Character.charCount(part);
            if (part >= 0x0300 && part <= 0x036F) {
                continue;
            }
            int type = Character.getType(part);
            if (type == Character.NON_SPACING_MARK || type == Character.ENCLOSING_MARK
                    || type == Character.COMBINING_SPACING_MARK) {
                // A mark the web fold keeps: mapping to the base would widen the match.
                return null;
            }
            base.appendCodePoint(part);
        }
        if (base.length() != 1) {
            // Digraphs and other multi-character decompositions cannot be
            // expressed by a single TRANSLATE pair.
            return null;
        }
        String lowered = String.valueOf(base.charAt(0)).toLowerCase(Locale.ROOT);
        return lowered.length() == 1 ? lowered.charAt(0) : null;
    }

    /** ECMAScript WhiteSpace + LineTerminator (U+0085 is not JavaScript whitespace). */
    static boolean isJavaScriptWhitespace(char character) {
        return character == '\t' || character == '\n' || character == 0x0B || character == '\f'
                || character == '\r' || character == ' ' || character == 0x00A0 || character == 0x1680
                || (character >= 0x2000 && character <= 0x200A) || character == 0x2028
                || character == 0x2029 || character == 0x202F || character == 0x205F
                || character == 0x3000 || character == 0xFEFF;
    }
}

