package io.campuscore.restfulapi.thesis;

import java.nio.file.Files;
import java.nio.file.Path;
import java.text.Normalizer;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Pattern;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * Test-only oracle for the topic-catalogue search. It is a faithful, separately
 * written port of the JavaScript predicate that used to run in the browser, and
 * it reads the same shared golden fixture the Node test executes against the
 * real component function. Production code is checked against this oracle and
 * the fixture, never the other way round.
 *
 * <p>Keep this class independent of {@code ThesisTopicCatalogSearch}: sharing
 * implementation would make the equivalence assertion vacuous.
 */
final class ThesisTopicSearchOracle {

    static final String FIXTURE = "thesis-topic-catalog-search-cases.json";

    private static final String JS_WHITESPACE =
            "\\t\\n\\u000B\\f\\r \\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000\\uFEFF";
    private static final Pattern WHITESPACE_RUN = Pattern.compile("[" + JS_WHITESPACE + "]+");
    private static final Map<String, List<String>> KEYWORDS = keywords();

    private ThesisTopicSearchOracle() {
    }

    record Topic(String id, String title, String description) {
    }

    record Case(String name, String search, boolean showAll, List<String> expectedIds) {
    }

    record Fixture(List<Topic> topics, Map<String, List<String>> dictionary, List<Case> cases,
            List<Case> emptyCatalogueCases) {
    }

    static Fixture fixture() throws Exception {
        List<Path> candidates = List.of(
                Path.of("contracts", FIXTURE),
                Path.of("..", "contracts", FIXTURE),
                Path.of("..", "..", "contracts", FIXTURE));
        Path found = candidates.stream().filter(Files::isRegularFile).findFirst()
                .orElseThrow(() -> new IllegalStateException(
                        "Could not find shared golden fixture at " + candidates));
        JsonNode root = new ObjectMapper().readTree(Files.readString(found));
        List<Topic> topics = new ArrayList<>();
        for (JsonNode node : root.path("topics")) {
            topics.add(new Topic(node.path("id").asText(), node.path("title").asText(),
                    node.path("description").isNull() ? null : node.path("description").asText()));
        }
        Map<String, List<String>> dictionary = new ObjectMapper().convertValue(
                root.path("dictionary"), new tools.jackson.core.type.TypeReference<Map<String, List<String>>>() { });
        return new Fixture(List.copyOf(topics), java.util.Collections.unmodifiableMap(dictionary),
                cases(root.path("cases")), cases(root.path("emptyCatalogue").path("cases")));
    }

    private static List<Case> cases(JsonNode nodes) {
        List<Case> cases = new ArrayList<>();
        for (JsonNode node : nodes) {
            List<String> ids = new ArrayList<>();
            node.path("expectedIds").forEach(id -> ids.add(id.asText()));
            cases.add(new Case(node.path("name").asText(), node.path("search").asText(),
                    node.path("showAll").asBoolean(), List.copyOf(ids)));
        }
        return List.copyOf(cases);
    }

    /**
     * The web predicate: blank or {@code all} means the page shows everything;
     * otherwise dictionary alternatives plus substring/all-token matching.
     */
    static List<String> matchingIds(List<Topic> topics, String search) {
        String query = trim(search == null ? "" : search).toLowerCase(Locale.ROOT);
        if (query.isEmpty() || query.equals("all")) {
            return topics.stream().map(Topic::id).toList();
        }
        List<String> terms = new ArrayList<>();
        terms.add(query);
        KEYWORDS.forEach((key, synonyms) -> {
            if (query.contains(key) || key.contains(query)) {
                synonyms.forEach(synonym -> terms.add(synonym.toLowerCase(Locale.ROOT)));
            }
        });
        List<String> matches = new ArrayList<>();
        for (Topic topic : topics) {
            if (matches(topic, terms)) {
                matches.add(topic.id());
            }
        }
        return List.copyOf(matches);
    }

    private static boolean matches(Topic topic, List<String> terms) {
        String fullText = fold(join(topic.title(), plainText(topic.description())));
        for (String term : terms) {
            String folded = fold(term);
            if (folded.isEmpty()) {
                return true;
            }
            if (fullText.contains(folded)) {
                return true;
            }
            List<String> tokens = new ArrayList<>();
            for (String token : WHITESPACE_RUN.split(folded)) {
                if (!token.isEmpty()) {
                    tokens.add(token);
                }
            }
            if (!tokens.isEmpty() && tokens.stream().allMatch(fullText::contains)) {
                return true;
            }
        }
        return false;
    }

    /** {@code [title, plain].filter(Boolean).join(' ')}. */
    private static String join(String title, String plainText) {
        boolean hasTitle = title != null && !title.isEmpty();
        if (hasTitle && !plainText.isEmpty()) {
            return title + " " + plainText;
        }
        return hasTitle ? title : plainText;
    }

    static String plainText(String raw) {
        if (raw == null || raw.isEmpty()) {
            return "";
        }
        String value = raw.replaceAll("<[^>]*>", " ");
        value = value.replaceAll("(?i)&nbsp;", " ");
        value = value.replaceAll("(?i)&amp;", "&");
        value = value.replaceAll("(?i)&lt;", "<");
        value = value.replaceAll("(?i)&gt;", ">");
        value = value.replaceAll("(?i)&quot;", "\"");
        value = value.replaceAll("(?i)&#39;", "'");
        value = value.replaceAll("(?i)&apos;", "'");
        value = WHITESPACE_RUN.matcher(value).replaceAll(" ");
        return trim(value);
    }

    static String fold(String value) {
        if (value == null || value.isEmpty()) {
            return "";
        }
        String decomposed = Normalizer.normalize(value, Normalizer.Form.NFD);
        StringBuilder stripped = new StringBuilder(decomposed.length());
        for (int index = 0; index < decomposed.length(); index++) {
            char character = decomposed.charAt(index);
            if (character < '\u0300' || character > '\u036f') {
                stripped.append(character);
            }
        }
        return stripped.toString().replace('đ', 'd').replace('Đ', 'd').toLowerCase(Locale.ROOT);
    }

    private static String trim(String value) {
        int start = 0;
        int end = value.length();
        while (start < end && isWhitespace(value.charAt(start))) {
            start++;
        }
        while (end > start && isWhitespace(value.charAt(end - 1))) {
            end--;
        }
        return value.substring(start, end);
    }

    private static boolean isWhitespace(char character) {
        return "\t\n\u000B\f\r \u00A0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007"
                .indexOf(character) >= 0
                || (character >= '\u2008' && character <= '\u200a')
                || character == '\u2028' || character == '\u2029' || character == '\u202f'
                || character == '\u205f' || character == '\u3000' || character == '\ufeff';
    }

    private static Map<String, List<String>> keywords() {
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

    /** Exposed so a contract test can prove the fixture truly carries all seven entries. */
    static List<String> dictionaryKeys() {
        return List.copyOf(KEYWORDS.keySet());
    }
}
