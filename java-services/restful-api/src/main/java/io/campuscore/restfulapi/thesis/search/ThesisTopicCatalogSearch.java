package io.campuscore.restfulapi.thesis.search;

import io.campuscore.restfulapi.web.DomainException;
import java.text.Normalizer;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.springframework.http.HttpStatus;

/**
 * Server-side equivalent of the topic-catalogue search predicate in
 * {@code frontend/src/components/dashboard/thesis/ThesisTopicCatalogPage.tsx}.
 *
 * <p>The web screen filters the complete authorised topic array in the browser,
 * so paging it server-side is only sound when this predicate reproduces every
 * step exactly: the same trim/lowercase query, the same seven-entry bilingual
 * dictionary expanded with {@code q.includes(key) || key.includes(q)} before
 * accent folding, the same ordered HTML-to-text operations from
 * {@code frontend/src/lib/thesis-text.ts}, the same NFD + U+0300..U+036F folding
 * with {@code đ} mapped to {@code d}, and the same substring-or-all-tokens match.
 *
 * <p>The policy deliberately does not reuse {@code common.LikePattern}: that
 * helper truncates at 64 characters, caps at eight tokens and removes
 * honorifics, which would silently change results. This class rejects raw
 * terms above its request budget rather than truncating or dropping tokens. It
 * also does not generalise the asymmetric synonym
 * expansion into bidirectional matching.
 *
 * <p>Whitespace follows ECMAScript, not {@link String#trim()} and not
 * {@link String#strip()}: the web {@code trim()} also removes non-breaking
 * spaces and the Unicode space separators, and JavaScript {@code \s} token
 * splitting uses the same set. Java's default {@code \s} is ASCII-only, so the
 * explicit character class below is required for equality.
 */
public final class ThesisTopicCatalogSearch {

    public static final int MAX_SEARCH_LENGTH = 200;
    public static final int MAX_SEARCH_TOKENS = 16;

    /** Header carrying the authorised topic count before the search predicate. */
    public static final String CATALOG_TOTAL_COUNT_HEADER = "X-Topic-Total-Count";

    /**
     * Exact copy of {@code topicBilingualKeywords} in the catalogue page.
     * Insertion order is irrelevant to the result (the web predicate uses
     * {@code some()}) but is kept identical for auditability.
     */
    private static final Map<String, List<String>> BILINGUAL_KEYWORDS = dictionary();

    private static final Pattern HTML_TAG = Pattern.compile("<[^>]*>");
    private static final Pattern WHITESPACE_RUN = Pattern.compile("[" + jsWhitespaceClass() + "]+");

    private static final ThesisTopicCatalogSearch INACTIVE =
            new ThesisTopicCatalogSearch(false, List.of());

    private final boolean active;
    private final List<String> alternatives;

    private ThesisTopicCatalogSearch(boolean active, List<String> alternatives) {
        this.active = active;
        this.alternatives = alternatives;
    }

    /**
     * Parses one raw {@code search} query parameter. A blank value or the exact
     * keyword {@code all} (after trim and lowercase) disables filtering, which
     * keeps the catalogue's "show everything" state identical to no search.
     */
    public static ThesisTopicCatalogSearch parse(String search) {
        String query = jsTrim(search == null ? "" : search).toLowerCase(Locale.ROOT);
        if (query.isEmpty() || query.equals("all")) {
            return INACTIVE;
        }
        List<String> terms = new ArrayList<>();
        terms.add(query);
        for (Map.Entry<String, List<String>> entry : BILINGUAL_KEYWORDS.entrySet()) {
            String key = entry.getKey();
            // Asymmetric on purpose: the web expands when either direction
            // matches, before accent folding. Do not fold the query here.
            if (query.contains(key) || key.contains(query)) {
                for (String synonym : entry.getValue()) {
                    terms.add(synonym.toLowerCase(Locale.ROOT));
                }
            }
        }
        return new ThesisTopicCatalogSearch(true, List.copyOf(terms));
    }

    /** Rejects an unbounded catalogue query before the caller reads topics. */
    public static void requireWithinBudget(String search) {
        if (search == null) {
            return;
        }
        if (search.length() > MAX_SEARCH_LENGTH) {
            throw invalidSearch();
        }
        int tokens = 0;
        boolean inToken = false;
        for (int index = 0; index < search.length(); index++) {
            if (isJsWhitespace(search.charAt(index))) {
                inToken = false;
            } else if (!inToken) {
                tokens++;
                if (tokens > MAX_SEARCH_TOKENS) {
                    throw invalidSearch();
                }
                inToken = true;
            }
        }
    }

    /** False for an omitted, blank or {@code all} query: every topic matches. */
    public boolean isActive() {
        return active;
    }

    /** Read-only audit view of the copied dictionary; used by the equality tests. */
    public static Map<String, List<String>> bilingualKeywords() {
        return BILINGUAL_KEYWORDS;
    }

    /**
     * Matches one topic exactly like the web predicate. An active policy folds
     * {@code title + ' ' + plainText(description)} once and checks every
     * alternative: a whole-substring hit, or all of its whitespace tokens.
     */
    public boolean matches(String title, String description) {
        if (!active) {
            return true;
        }
        String searchable = fold(searchableText(title, description));
        for (String term : alternatives) {
            String folded = fold(term);
            if (folded.isEmpty()) {
                // The web returns true for a term that folds to nothing, which
                // only happens for a query made of combining marks.
                return true;
            }
            if (searchable.contains(folded)) {
                return true;
            }
            List<String> tokens = whitespaceTokens(folded);
            if (!tokens.isEmpty() && tokens.stream().allMatch(searchable::contains)) {
                return true;
            }
        }
        return false;
    }

    /** Ordered plain-text operations from {@code thesis-text.ts}; do not reorder. */
    static String plainText(String raw) {
        if (raw == null || raw.isEmpty()) {
            return "";
        }
        String value = HTML_TAG.matcher(raw).replaceAll(" ");
        value = replaceIgnoreCase(value, "&nbsp;", " ");
        value = replaceIgnoreCase(value, "&amp;", "&");
        value = replaceIgnoreCase(value, "&lt;", "<");
        value = replaceIgnoreCase(value, "&gt;", ">");
        value = replaceIgnoreCase(value, "&quot;", "\"");
        // The web alternates &#39;|&apos; in one global replace; the ordered
        // sequential pair is equivalent because neither result contains the
        // other pattern.
        value = replaceIgnoreCase(value, "&#39;", "'");
        value = replaceIgnoreCase(value, "&apos;", "'");
        value = WHITESPACE_RUN.matcher(value).replaceAll(" ");
        return jsTrim(value);
    }

    /** {@code normalizeVietnameseText}: NFD, drop U+0300..U+036F, đ→d, lowercase. */
    static String fold(String value) {
        if (value == null || value.isEmpty()) {
            return "";
        }
        String decomposed = Normalizer.normalize(value, Normalizer.Form.NFD);
        StringBuilder withoutMarks = new StringBuilder(decomposed.length());
        for (int index = 0; index < decomposed.length(); index++) {
            char character = decomposed.charAt(index);
            if (character < '\u0300' || character > '\u036f') {
                withoutMarks.append(character);
            }
        }
        return withoutMarks.toString()
                .replace('đ', 'd')
                .replace('Đ', 'd')
                .toLowerCase(Locale.ROOT);
    }

    /** ECMAScript {@code trim()}: ASCII whitespace plus the Unicode Zs set. */
    static String jsTrim(String value) {
        int start = 0;
        int end = value.length();
        while (start < end && isJsWhitespace(value.charAt(start))) {
            start++;
        }
        while (end > start && isJsWhitespace(value.charAt(end - 1))) {
            end--;
        }
        return value.substring(start, end);
    }

    private static String searchableText(String title, String description) {
        String plain = plainText(description);
        boolean hasTitle = title != null && !title.isEmpty();
        if (hasTitle && !plain.isEmpty()) {
            return title + " " + plain;
        }
        return hasTitle ? title : plain;
    }

    private static List<String> whitespaceTokens(String value) {
        List<String> tokens = new ArrayList<>();
        int start = -1;
        for (int index = 0; index < value.length(); index++) {
            boolean whitespace = isJsWhitespace(value.charAt(index));
            if (whitespace && start >= 0) {
                tokens.add(value.substring(start, index));
                start = -1;
            } else if (!whitespace && start < 0) {
                start = index;
            }
        }
        if (start >= 0) {
            tokens.add(value.substring(start));
        }
        return tokens;
    }

    private static String replaceIgnoreCase(String value, String target, String replacement) {
        return Pattern.compile(Pattern.quote(target), Pattern.CASE_INSENSITIVE)
                .matcher(value)
                .replaceAll(Matcher.quoteReplacement(replacement));
    }

    private static boolean isJsWhitespace(char character) {
        return switch (character) {
            case '\t', '\n', '\u000b', '\f', '\r', ' ', '\u00a0', '\u1680',
                 '\u2000', '\u2001', '\u2002', '\u2003', '\u2004', '\u2005', '\u2006',
                 '\u2007', '\u2008', '\u2009', '\u200a', '\u2028', '\u2029', '\u202f',
                 '\u205f', '\u3000', '\ufeff' -> true;
            default -> false;
        };
    }

    private static DomainException invalidSearch() {
        return new DomainException(HttpStatus.BAD_REQUEST, "INVALID_SEARCH",
                "search must not exceed 200 characters or 16 tokens");
    }

    private static String jsWhitespaceClass() {
        return "\\t\\n\\u000B\\f\\r \\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000\\uFEFF";
    }

    private static Map<String, List<String>> dictionary() {
        Map<String, List<String>> keywords = new LinkedHashMap<>();
        keywords.put("artificial intelligence", List.of("artificial intelligence", "ai", "trí tuệ nhân tạo"));
        keywords.put("software & web", List.of("software", "web", "phần mềm"));
        keywords.put("robotics & mechatronics",
                List.of("robotics", "mechatronics", "cơ điện tử", "robot"));
        keywords.put("information systems", List.of("information systems", "hệ thống thông tin"));
        keywords.put("iot & telecom", List.of("iot", "telecom", "viễn thông"));
        keywords.put("automotive", List.of("automotive", "ô tô"));
        keywords.put("civil engineering", List.of("civil engineering", "xây dựng"));
        return java.util.Collections.unmodifiableMap(keywords);
    }
}
