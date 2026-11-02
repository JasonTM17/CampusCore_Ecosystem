package io.campuscore.restfulapi.thesis;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Timestamp;
import java.text.Normalizer;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * Test-only freeze of the current web archive search, plus the golden fixture
 * loader and the shared row seeding.
 *
 * <p>{@link #matches} is a line-by-line port of
 * {@code filteredRepositoryReports} in
 * {@code frontend/src/app/dashboard/thesis/page.tsx}. It is deliberately
 * independent of the production {@code ThesisArchiveSearch} helper: the server
 * implementation is judged against this copy and against the JS itself
 * ({@code frontend/tests/thesis-archive-search-oracle.test.js}), never against
 * itself.
 *
 * <p>The same {@code contracts/thesis-archive-search-cases.json} file drives
 * the node oracle, this port and the H2/PostgreSQL SQL suites, so the three
 * layers are proven equal on identical cases.
 */
final class ThesisArchiveSearchOracle {

    private static final String FIXTURE = "thesis-archive-search-cases.json";

    private ThesisArchiveSearchOracle() {
    }

    record Member(String displayName, String studentNumber, boolean external) {
    }

    record Report(String id, String topicTitle, String title, String topicDescription, String note,
            String fileName, String url, String departmentName, String submittedByDisplayName,
            String submittedByStudentNumber, List<String> supervisors, List<Member> members) {
    }

    record Case(String name, String search, List<String> expect) {
    }

    record Fixture(List<Report> reports, List<Case> cases, long total, long files, long urls) {
    }

    // --- fixture ---------------------------------------------------------

    static Fixture load() {
        Path path = locate();
        try {
            JsonNode root = new ObjectMapper().readTree(Files.readString(path));
            List<Report> reports = new ArrayList<>();
            for (JsonNode node : root.path("reports")) {
                List<String> supervisors = new ArrayList<>();
                for (JsonNode supervisor : node.path("supervisors")) {
                    supervisors.add(text(supervisor, "displayName"));
                }
                List<Member> members = new ArrayList<>();
                for (JsonNode member : node.path("members")) {
                    members.add(new Member(text(member, "displayName"), text(member, "studentNumber"),
                            member.path("external").asBoolean(false)));
                }
                reports.add(new Report(text(node, "id"), text(node, "topicTitle"), text(node, "title"),
                        text(node, "topicDescription"), text(node, "note"), text(node, "fileName"),
                        text(node, "url"), text(node, "departmentName"), text(node, "submittedByDisplayName"),
                        text(node, "submittedByStudentNumber"), List.copyOf(supervisors), List.copyOf(members)));
            }
            List<Case> cases = new ArrayList<>();
            for (JsonNode node : root.path("cases")) {
                List<String> expect = new ArrayList<>();
                for (JsonNode id : node.path("expect")) {
                    expect.add(id.asString());
                }
                cases.add(new Case(text(node, "name"), text(node, "search"), List.copyOf(expect)));
            }
            JsonNode summary = root.path("summary");
            return new Fixture(List.copyOf(reports), List.copyOf(cases), summary.path("total").asLong(),
                    summary.path("files").asLong(), summary.path("urls").asLong());
        } catch (IOException exception) {
            throw new IllegalStateException("cannot read " + path.toAbsolutePath(), exception);
        }
    }

    private static Path locate() {
        Path relative = Path.of("..", "..", "contracts", FIXTURE);
        if (Files.exists(relative)) {
            return relative;
        }
        Path current = Path.of("").toAbsolutePath();
        while (current != null) {
            Path candidate = current.resolve("contracts").resolve(FIXTURE);
            if (Files.exists(candidate)) {
                return candidate;
            }
            current = current.getParent();
        }
        throw new IllegalStateException("contracts/" + FIXTURE + " not found from " + Path.of("").toAbsolutePath());
    }

    private static String text(JsonNode node, String field) {
        JsonNode value = node.path(field);
        return value.isNull() || value.isMissingNode() ? null : value.asString();
    }

    // --- frozen web predicate --------------------------------------------

    /** The exact JS predicate over the fixture rows. */
    static List<String> matches(Fixture fixture, String search) {
        String raw = jsTrim(search);
        List<String> ids = new ArrayList<>();
        if (raw.isEmpty()) {
            for (Report report : fixture.reports()) {
                ids.add(report.id());
            }
            return ids;
        }
        List<String> tokens = jsTokens(fold(raw));
        for (Report report : fixture.reports()) {
            List<String> values = new ArrayList<>();
            values.add(emptyIfNull(report.topicTitle()).isEmpty()
                    ? emptyIfNull(report.title())
                    : report.topicTitle());
            values.add(emptyIfNull(report.topicDescription()));
            values.add(emptyIfNull(report.note()));
            values.add(emptyIfNull(report.fileName()));
            values.add(emptyIfNull(report.departmentName()));
            values.add(emptyIfNull(report.submittedByDisplayName()));
            values.add(emptyIfNull(report.submittedByStudentNumber()));
            for (String supervisor : report.supervisors()) {
                values.add(emptyIfNull(supervisor));
            }
            for (Member member : report.members()) {
                values.add(emptyIfNull(member.displayName()) + " " + emptyIfNull(member.studentNumber()));
            }
            String haystack = fold(String.join(" ", values));
            boolean everyToken = true;
            for (String token : tokens) {
                if (!haystack.contains(token)) {
                    everyToken = false;
                    break;
                }
            }
            if (everyToken) {
                ids.add(report.id());
            }
        }
        return ids;
    }

    /** NFD, drop U+0300..U+036F, đ/Đ to d, lower case. */
    static String fold(String value) {
        if (value == null) {
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

    /** JavaScript {@code String.prototype.trim} whitespace set. */
    static String jsTrim(String value) {
        if (value == null) {
            return "";
        }
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

    /** JavaScript {@code split(/\s+/)} over an already folded query. */
    static List<String> jsTokens(String folded) {
        List<String> tokens = new ArrayList<>();
        int start = -1;
        for (int index = 0; index < folded.length(); index++) {
            if (isJsWhitespace(folded.charAt(index))) {
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

    /** ECMAScript WhiteSpace + LineTerminator; U+0085 is deliberately absent. */
    static boolean isJsWhitespace(char character) {
        return character == '\t' || character == '\n' || character == 0x0B || character == '\f'
                || character == '\r' || character == ' ' || character == 0x00A0 || character == 0x1680
                || (character >= 0x2000 && character <= 0x200A) || character == 0x2028
                || character == 0x2029 || character == 0x202F || character == 0x205F
                || character == 0x3000 || character == 0xFEFF;
    }

    private static String emptyIfNull(String value) {
        return value == null ? "" : value;
    }

    // --- shared seeding --------------------------------------------------

    /**
     * Seeds one authorized archive round from the fixture and returns
     * {@code fixture id -> report id}. Groups stay PENDING so the production
     * 3..5 approval rule is not exercised by search fixtures.
     */
    static Map<String, UUID> seed(JdbcTemplate jdbc, UUID roundId, String tag, Fixture fixture) {
        String faculty = tag + "-faculty";
        // The PostgreSQL schema requires Faculty.code; the compact H2 schema has
        // no such column. Seed the superset first and fall back once.
        try {
            jdbc.update("INSERT INTO academic.\"Faculty\" (\"id\",\"name\",\"code\",\"isActive\") "
                    + "VALUES (?, ?, ?, TRUE)", faculty, "Search faculty " + tag, code(tag, "FAC"));
        } catch (org.springframework.dao.DataAccessException missingCodeColumn) {
            jdbc.update("INSERT INTO academic.\"Faculty\" (\"id\",\"name\",\"isActive\") VALUES (?, ?, TRUE)",
                    faculty, "Search faculty " + tag);
        }
        Map<String, String> departments = new LinkedHashMap<>();
        int departmentIndex = 0;
        for (Report report : fixture.reports()) {
            String name = report.departmentName();
            if (name != null && !departments.containsKey(name)) {
                String id = tag + "-dept-" + departmentIndex++;
                jdbc.update("INSERT INTO academic.\"Department\" "
                                + "(\"id\",\"name\",\"code\",\"facultyId\",\"isActive\") VALUES (?,?,?,?,TRUE)",
                        id, name, code(tag, "D" + departmentIndex), faculty);
                departments.put(name, id);
            }
        }

        Map<String, UUID> reportIds = new LinkedHashMap<>();
        Instant base = Instant.parse("2032-01-01T10:00:00Z");
        int index = 0;
        for (Report report : fixture.reports()) {
            UUID topicUuid = UUID.randomUUID();
            String leaderId = tag + "-leader-" + report.id();
            jdbc.update("INSERT INTO thesis.thesis_topic "
                            + "(id,round_id,department_id,title,description,max_groups,status,created_by) "
                            + "VALUES (?,?,?,?,?,5,'PUBLISHED',?)",
                    topicUuid, roundId, departments.get(report.departmentName()), report.topicTitle(),
                    report.topicDescription() == null ? "" : report.topicDescription(), tag);
            String submitter = report.submittedByDisplayName() == null && report.submittedByStudentNumber() == null
                    ? tag + "-submitter-" + report.id()
                    : ensureStudent(jdbc, tag, "submit-" + report.id(), report.submittedByDisplayName(),
                            report.submittedByStudentNumber());
            UUID groupUuid = UUID.randomUUID();
            jdbc.update("INSERT INTO thesis.thesis_group "
                            + "(id,round_id,leader_student_id,topic_id,status,approval_status) "
                            + "VALUES (?,?,?,?,'SUBMITTED','PENDING')",
                    groupUuid, roundId, leaderId, topicUuid);
            // Student profiles must exist before the roster: production validates
            // that leader_student_id is the order-1 member on every insert.
            List<String> memberIds = new ArrayList<>();
            for (int order = 0; order < report.members().size(); order++) {
                Member member = report.members().get(order);
                memberIds.add(member.external()
                        ? memberStudentId(tag, report, order)
                        : ensureStudent(jdbc, tag, "member-" + report.id() + "-" + order,
                                member.displayName(), member.studentNumber()));
            }
            if (!memberIds.isEmpty()) {
                jdbc.update("UPDATE thesis.thesis_group SET leader_student_id = ? WHERE id = ?",
                        memberIds.get(0), groupUuid);
            }
            for (int order = 0; order < report.members().size(); order++) {
                Member member = report.members().get(order);
                jdbc.update("INSERT INTO thesis.thesis_group_member "
                                + "(id,group_id,round_id,student_id,member_order,is_leader,display_name,is_external) "
                                + "VALUES (?,?,?,?,?,?,?,?)",
                        UUID.randomUUID(), groupUuid, roundId, memberIds.get(order), order + 1, order == 0,
                        member.external() ? member.displayName() : null, member.external());
            }
            for (int order = 0; order < report.supervisors().size(); order++) {
                String lecturerId = ensureLecturer(jdbc, tag, "sup-" + report.id() + "-" + order,
                        report.supervisors().get(order), departments.get(report.departmentName()));
                jdbc.update("INSERT INTO thesis.thesis_topic_supervisor "
                                + "(id,topic_id,lecturer_id,supervisor_order) VALUES (?,?,?,?)",
                        UUID.randomUUID(), topicUuid, lecturerId, order + 1);
            }
            UUID reportId = UUID.randomUUID();
            byte[] fileData = report.url() == null ? new byte[] {1, 2, 3, 4} : null;
            jdbc.update("INSERT INTO thesis.thesis_group_report "
                            + "(id,group_id,round_id,submitted_by,title,url,note,submitted_at,file_name,"
                            + "file_type,file_size,file_data) VALUES (?,?,?,?,?,?,?,?,?,'application/pdf',?,?)",
                    reportId, groupUuid, roundId, submitter, report.title(), report.url(), report.note(),
                    Timestamp.from(base.minusSeconds(index * 60L)), report.fileName(),
                    report.fileName() == null ? null : 4L, fileData);
            reportIds.put(report.id(), reportId);
            index++;
        }
        return reportIds;
    }

    private static String memberStudentId(String tag, Report report, int order) {
        return tag + "-member-" + report.id() + "-" + order;
    }

    private static String code(String tag, String suffix) {
        return (tag + "-" + suffix).toUpperCase(Locale.ROOT);
    }

    /** Creates (or reuses) a Student whose {@code studentId} is the searchable number. */
    static String ensureStudent(JdbcTemplate jdbc, String tag, String slug, String displayName,
            String studentNumber) {
        String studentId = tag + "-student-" + slug;
        Integer existing = jdbc.queryForObject(
                "SELECT COUNT(*) FROM campuscore_auth.\"Student\" WHERE \"id\" = ?", Integer.class, studentId);
        if (existing != null && existing > 0) {
            return studentId;
        }
        String[] parts = splitDisplayName(displayName);
        String userId = tag + "-user-" + slug;
        jdbc.update("INSERT INTO campuscore_auth.\"User\" "
                        + "(\"id\", \"email\", \"password\", \"firstName\", \"lastName\", \"status\", "
                        + "\"emailVerified\", \"isSuperAdmin\", \"failedLoginAttempts\", \"createdAt\", \"updatedAt\") "
                        + "VALUES (?, ?, 'test-password', ?, ?, 'ACTIVE', FALSE, FALSE, 0, "
                        + "CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)",
                userId, userId + "@fixture.test", parts[1], parts[0]);
        jdbc.update("INSERT INTO campuscore_auth.\"Student\" "
                        + "(\"id\", \"userId\", \"studentId\", \"curriculumId\", \"year\", \"admissionDate\") "
                        + "VALUES (?, ?, ?, 'curriculum-demo', 2, CURRENT_TIMESTAMP)",
                studentId, userId, studentNumber);
        return studentId;
    }

    /** Creates (or reuses) a Lecturer whose display name is the searchable value. */
    static String ensureLecturer(JdbcTemplate jdbc, String tag, String slug, String displayName,
            String departmentId) {
        String lecturerId = tag + "-lecturer-" + slug;
        Integer existing = jdbc.queryForObject(
                "SELECT COUNT(*) FROM campuscore_auth.\"Lecturer\" WHERE \"id\" = ?", Integer.class, lecturerId);
        if (existing != null && existing > 0) {
            return lecturerId;
        }
        String[] parts = splitDisplayName(displayName);
        String userId = tag + "-lecturer-user-" + slug;
        jdbc.update("INSERT INTO campuscore_auth.\"User\" "
                        + "(\"id\", \"email\", \"password\", \"firstName\", \"lastName\", \"status\", "
                        + "\"emailVerified\", \"isSuperAdmin\", \"failedLoginAttempts\", \"createdAt\", \"updatedAt\") "
                        + "VALUES (?, ?, 'test-password', ?, ?, 'ACTIVE', FALSE, FALSE, 0, "
                        + "CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)",
                userId, userId + "@fixture.test", parts[1], parts[0]);
        jdbc.update("INSERT INTO campuscore_auth.\"Lecturer\" "
                        + "(\"id\", \"userId\", \"departmentId\", \"employeeId\", \"isActive\") "
                        + "VALUES (?, ?, ?, ?, TRUE)",
                lecturerId, userId, departmentId, "GV-" + slug);
        return lecturerId;
    }

    /**
     * {@code displayName(first,last)} in production is {@code last + " " + first},
     * so the fixture name is split at its last space and rebuilt identically.
     */
    static String[] splitDisplayName(String displayName) {
        if (displayName == null || displayName.isEmpty()) {
            return new String[] {"", ""};
        }
        int space = displayName.lastIndexOf(' ');
        if (space < 0) {
            return new String[] {displayName, ""};
        }
        return new String[] {displayName.substring(0, space), displayName.substring(space + 1)};
    }
}
