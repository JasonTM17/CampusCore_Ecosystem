package io.campuscore.restfulapi.engagement;

import java.util.LinkedHashMap;
import java.util.Map;

/** Bodies copied verbatim from each announcement's own insert, before V61. */
final class OriginalAnnouncementBodies {
    static final Map<String, String> SOURCE_FILES = new LinkedHashMap<>();

    static {
        SOURCE_FILES.put("announcement-registration-window", "V24__enrich_demo_announcements_and_notifications.sql");
        SOURCE_FILES.put("announcement-v26-scholarship", "V26__enrich_demo_campus_population.sql");
        SOURCE_FILES.put("announcement-v26-thesis-round", "V26__enrich_demo_campus_population.sql");
        SOURCE_FILES.put("announcement-v32-smart-campus", "V32__enrich_big_data_campus_ecosystem.sql");
        SOURCE_FILES.put("announcement-v32-job-fair", "V32__enrich_big_data_campus_ecosystem.sql");
        SOURCE_FILES.put("announcement-v32-ute-research", "V32__enrich_big_data_campus_ecosystem.sql");
        SOURCE_FILES.put("announcement-ute-samsung-scholarship-2026", "V43__big_data_campus_ecosystem_enrichment.sql");
        SOURCE_FILES.put("announcement-ute-intel-stem-women-2026", "V43__big_data_campus_ecosystem_enrichment.sql");
        SOURCE_FILES.put("announcement-ute-fpt-ojt-career-day", "V43__big_data_campus_ecosystem_enrichment.sql");
        SOURCE_FILES.put("announcement-ute-innovation-awards-2026", "V43__big_data_campus_ecosystem_enrichment.sql");
    }

    private OriginalAnnouncementBodies() {
    }

    static Map<String, String> fromInserts(Map<String, String> sqlByFile) {
        Map<String, String> bodies = new LinkedHashMap<>();
        for (var entry : SOURCE_FILES.entrySet()) {
            bodies.put(entry.getKey(), insertedContent(sqlByFile.get(entry.getValue()), entry.getKey()));
        }
        return bodies;
    }

    static Map<String, String> fromRepair(String sql) {
        Map<String, String> bodies = new LinkedHashMap<>();
        int cursor = 0;
        while (cursor < sql.length()) {
            int setAt = sql.indexOf("SET content = $", cursor);
            if (setAt < 0) {
                break;
            }
            int tagStart = setAt + "SET content = $".length();
            int tagEnd = sql.indexOf('$', tagStart);
            String tag = sql.substring(tagStart, tagEnd);
            int bodyStart = tagEnd + 1;
            String closer = "$" + tag + "$";
            int bodyEnd = sql.indexOf(closer, bodyStart);
            String body = sql.substring(bodyStart, bodyEnd);
            int idAt = sql.indexOf("WHERE \"id\" = '", bodyEnd);
            int idStart = idAt + "WHERE \"id\" = '".length();
            int idEnd = sql.indexOf('\'', idStart);
            bodies.put(sql.substring(idStart, idEnd), body);
            cursor = idEnd + 1;
        }
        return bodies;
    }

    private static String insertedContent(String sql, String id) {
        String needle = "'" + id + "'";
        int pos = 0;
        String found = null;
        while (pos < sql.length()) {
            int at = sql.indexOf(needle, pos);
            if (at < 0) {
                break;
            }
            int window = Math.max(0, at - 2500);
            if (sql.substring(window, at).contains("INSERT INTO engagement.\"Announcement\"")) {
                int titleAt = sql.indexOf('\'', at + needle.length());
                String title = readString(sql, titleAt).value();
                int contentAt = sql.indexOf('\'', titleAt + title.length() + 2);
                String content = readString(sql, contentAt).value();
                if (!title.startsWith("announcement-") && content.length() > 20) {
                    found = content;
                }
            }
            pos = at + needle.length();
        }
        if (found == null) {
            throw new IllegalStateException("no original insert for " + id);
        }
        return found;
    }

    private static Parsed readString(String text, int i) {
        if (text.charAt(i) != '\'') {
            throw new IllegalStateException("expected quote");
        }
        StringBuilder buf = new StringBuilder();
        i++;
        while (i < text.length()) {
            if (text.charAt(i) == '\'') {
                if (i + 1 < text.length() && text.charAt(i + 1) == '\'') {
                    buf.append('\'');
                    i += 2;
                    continue;
                }
                return new Parsed(buf.toString(), i + 1);
            }
            buf.append(text.charAt(i));
            i++;
        }
        throw new IllegalStateException("unterminated string");
    }

    private record Parsed(String value, int next) {
    }
}
