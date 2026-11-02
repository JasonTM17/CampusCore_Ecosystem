package io.campuscore.restfulapi.thesis;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.doAnswer;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import io.campuscore.restfulapi.common.LikePattern;
import io.campuscore.restfulapi.events.web.ListPaging;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Proxy;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;
import java.util.stream.IntStream;
import javax.sql.DataSource;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.RequestPostProcessor;
import tools.jackson.databind.ObjectMapper;

/**
 * Q06 read-budget guard: a paged archive request must materialize only the
 * selected report roots and their children, never the whole round. The
 * measurements wrap the real Spring {@link DataSource}, so the assertions see
 * every SQL statement and every JDBC row the production path actually reads.
 *
 * <p>Written before the split-projection implementation; on the old fan-out
 * query the page assertions fail because {@code page}/{@code limit} are not
 * recognized and the entire multiplied join is returned.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles({"test", "persistence"})
@TestPropertySource(properties = {
        "spring.datasource.url=jdbc:h2:mem:restful_api_archive_budget;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1",
        "spring.datasource.username=sa",
        "spring.datasource.password=",
        "spring.flyway.enabled=true",
        "spring.flyway.locations=classpath:db/migration-h2"
})
class ThesisArchiveReadBudgetTest {

    private static final int ROOTS = 7;
    private static final int MEMBERS_PER_ROOT = 4;
    private static final int SUPERVISORS_PER_ROOT = 2;

    @Autowired
    private JdbcTemplate jdbc;

    @Autowired
    private MockMvc mvc;

    @Autowired
    private ObjectMapper mapper;

    @MockitoSpyBean
    private DataSource dataSource;

    private final List<String> statements = new ArrayList<>();
    private final Map<String, Integer> rowsRead = new HashMap<>();

    private UUID roundId;
    private String tag;
    private RequestPostProcessor admin;

    @BeforeEach
    void instrumentAndSeed() throws Exception {
        tag = "arb" + UUID.randomUUID().toString().replace("-", "").substring(0, 10);
        statements.clear();
        rowsRead.clear();
        doAnswer(invocation -> measured((Connection) invocation.callRealMethod()))
                .when(dataSource).getConnection();
        seedRoundWithSevenReports();
        admin = admin();
        statements.clear();
        rowsRead.clear();
    }

    @Test
    void pagedRepositoryReadsOnlyTheSelectedRootPageAndItsChildren() throws Exception {
        var response = mvc.perform(get("/api/v1/thesis/rounds/{id}/repository", roundId)
                        .param("page", "1")
                        .param("limit", "2")
                        .with(admin))
                .andExpect(status().isOk())
                .andExpect(header().string("X-Total-Count", String.valueOf(ROOTS)))
                .andReturn();

        assertThat(mapper.readTree(response.getResponse().getContentAsString())).hasSize(2);
        assertThat(countQueries()).hasSize(1);
        assertThat(rootQueries()).hasSize(1);
        assertThat(memberQueries()).hasSize(1);
        assertThat(supervisorQueries()).hasSize(1);
        assertThat(rowsRead.get(rootQueries().getFirst())).isEqualTo(2);
        assertThat(rowsRead.get(memberQueries().getFirst()))
                .isEqualTo(2 * MEMBERS_PER_ROOT);
        assertThat(rowsRead.get(supervisorQueries().getFirst()))
                .isEqualTo(2 * SUPERVISORS_PER_ROOT);
        assertThat(statements).noneMatch(sql -> sql.contains("file_data") || sql.contains("storage_key"));
    }

    @Test
    void emptyPageReadsOnlyTheAuthorizedCount() throws Exception {
        var response = mvc.perform(get("/api/v1/thesis/rounds/{id}/repository", roundId)
                        .param("page", "9")
                        .param("limit", "2")
                        .with(admin))
                .andExpect(status().isOk())
                .andExpect(header().string("X-Total-Count", String.valueOf(ROOTS)))
                .andReturn();

        assertThat(mapper.readTree(response.getResponse().getContentAsString())).isEmpty();
        assertThat(countQueries()).hasSize(1);
        assertThat(rootQueries()).isEmpty();
        assertThat(memberQueries()).isEmpty();
        assertThat(supervisorQueries()).isEmpty();
    }

    @Test
    void legacyReadKeepsEveryRootButSplitsTheChildQueries() throws Exception {
        var response = mvc.perform(get("/api/v1/thesis/rounds/{id}/repository", roundId).with(admin))
                .andExpect(status().isOk())
                .andExpect(header().doesNotExist("X-Total-Count"))
                .andReturn();

        assertThat(mapper.readTree(response.getResponse().getContentAsString())).hasSize(ROOTS);
        assertThat(countQueries()).isEmpty();
        assertThat(rootQueries()).hasSize(1);
        assertThat(memberQueries()).hasSize(1);
        assertThat(supervisorQueries()).hasSize(1);
        assertThat(rowsRead.get(rootQueries().getFirst())).isEqualTo(ROOTS);
        assertThat(rowsRead.get(memberQueries().getFirst())).isEqualTo(ROOTS * MEMBERS_PER_ROOT);
        assertThat(rowsRead.get(supervisorQueries().getFirst())).isEqualTo(ROOTS * SUPERVISORS_PER_ROOT);
        assertThat(statements).noneMatch(sql -> sql.contains("file_data") || sql.contains("storage_key"));
    }

    @Test
    void searchedPageKeepsOneAggregateOneRootAndPageBoundChildren() throws Exception {
        statements.clear();
        rowsRead.clear();

        var response = mvc.perform(get("/api/v1/thesis/rounds/{id}/repository", roundId)
                        .param("search", "budget")
                        .param("page", "1")
                        .param("limit", "2")
                        .with(admin))
                .andExpect(status().isOk())
                .andExpect(header().string("X-Total-Count", String.valueOf(ROOTS)))
                .andExpect(header().string("X-Archive-Total-Count", String.valueOf(ROOTS)))
                .andReturn();

        assertThat(mapper.readTree(response.getResponse().getContentAsString())).hasSize(2);
        assertThat(countQueries()).hasSize(1);
        assertThat(rootQueries()).hasSize(1);
        assertThat(memberQueries()).hasSize(1);
        assertThat(supervisorQueries()).hasSize(1);
        assertThat(countQueries().getFirst()).contains("REGEXP_REPLACE");
        assertThat(rootQueries().getFirst()).contains("REGEXP_REPLACE");
        assertThat(rowsRead.get(rootQueries().getFirst())).isEqualTo(2);
        assertThat(rowsRead.get(memberQueries().getFirst())).isEqualTo(2 * MEMBERS_PER_ROOT);
        assertThat(rowsRead.get(supervisorQueries().getFirst())).isEqualTo(2 * SUPERVISORS_PER_ROOT);

        // No match: the aggregate alone answers, no page or child read happens.
        statements.clear();
        rowsRead.clear();
        mvc.perform(get("/api/v1/thesis/rounds/{id}/repository", roundId)
                        .param("search", "no-such-budget-term")
                        .param("page", "0")
                        .param("limit", "2")
                        .with(admin))
                .andExpect(status().isOk())
                .andExpect(header().string("X-Total-Count", "0"))
                .andExpect(header().string("X-Archive-Total-Count", String.valueOf(ROOTS)));
        assertThat(countQueries()).hasSize(1);
        assertThat(rootQueries()).isEmpty();
        assertThat(memberQueries()).isEmpty();
        assertThat(supervisorQueries()).isEmpty();

        // The unpaged search read stays one root plus its two child reads.
        statements.clear();
        rowsRead.clear();
        mvc.perform(get("/api/v1/thesis/rounds/{id}/repository", roundId)
                        .param("search", "budget")
                        .with(admin))
                .andExpect(status().isOk())
                .andExpect(header().doesNotExist("X-Archive-Total-Count"));
        assertThat(countQueries()).isEmpty();
        assertThat(rootQueries()).hasSize(1);
        assertThat(memberQueries()).hasSize(1);
        assertThat(supervisorQueries()).hasSize(1);
        assertThat(rowsRead.get(rootQueries().getFirst())).isEqualTo(ROOTS);
    }

    @Test
    void oversizedSearchIsBoundedBeforeItReachesTheStatement() throws Exception {
        String search = IntStream.range(0, 120)
                .mapToObj(index -> "ab")
                .collect(Collectors.joining(" "));
        statements.clear();
        rowsRead.clear();

        mvc.perform(get("/api/v1/thesis/rounds/{id}/repository", roundId)
                        .param("search", search)
                        .with(admin))
                .andExpect(status().isOk())
                .andExpect(header().doesNotExist("X-Total-Count"));

        assertThat(rootQueries()).hasSize(1);
        String sql = rootQueries().getFirst();
        // Ten LIKE predicates per accepted word: seven scalar fields, two for
        // the member subquery and one for the supervisor subquery.
        assertThat(likePredicates(sql)).isLessThanOrEqualTo(LikePattern.MAX_TOKENS * 10);
        assertThat(sql.length()).isLessThan(30_000);
    }

    @Test
    void legacyReadStopsAtThePagingCeiling() throws Exception {
        for (int index = 0; index < 94; index++) {
            UUID topicId = UUID.randomUUID();
            jdbc.update("INSERT INTO thesis.thesis_topic "
                            + "(id, round_id, department_id, title, description, max_groups, status, created_by) "
                            + "VALUES (?, ?, 'department-demo', ?, 'ceiling fixture', 1, 'PUBLISHED', 'arb')",
                    topicId, roundId, "Ceiling topic " + index);
            UUID groupId = UUID.randomUUID();
            jdbc.update("INSERT INTO thesis.thesis_group "
                            + "(id, round_id, leader_student_id, topic_id, status, approval_status) "
                            + "VALUES (?, ?, ?, ?, 'SUBMITTED', 'APPROVED')",
                    groupId, roundId, tag + "-ceiling-student-" + index, topicId);
            jdbc.update("INSERT INTO thesis.thesis_group_report "
                            + "(id, group_id, round_id, submitted_by, title, url, submitted_at, file_name, "
                            + "file_type, file_size) "
                            + "VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'application/pdf', 4)",
                    UUID.randomUUID(), groupId, roundId, tag + "-ceiling-submitter",
                    "Ceiling report " + index, "https://example.test/ceiling-" + index,
                    Timestamp.from(Instant.now().minusSeconds(index + 1L)), "ceiling-" + index + ".pdf");
        }
        statements.clear();
        rowsRead.clear();

        var response = mvc.perform(get("/api/v1/thesis/rounds/{id}/repository", roundId).with(admin))
                .andExpect(status().isOk())
                .andReturn();

        assertThat(mapper.readTree(response.getResponse().getContentAsString()))
                .hasSize(ListPaging.MAX_LIMIT);
    }

    @Test
    void legacyReadCarriesThePagingCeiling() throws Exception {
        statements.clear();
        rowsRead.clear();

        mvc.perform(get("/api/v1/thesis/rounds/{id}/repository", roundId).with(admin))
                .andExpect(status().isOk());

        assertThat(rootQueries()).hasSize(1);
        assertThat(rootQueries().getFirst()).contains(" LIMIT " + ListPaging.MAX_LIMIT);
    }

    @Test
    void countAndPageUseTheSameLecturerScopePredicate() throws Exception {
        String lecturerId = tag + "-lecturer";
        ensureLecturer(lecturerId, "department-demo");
        RequestPostProcessor lecturer = ThesisAuthorityFixture.lecturer(jdbc, lecturerId);
        statements.clear();
        rowsRead.clear();

        mvc.perform(get("/api/v1/thesis/rounds/{id}/repository", roundId)
                        .param("page", "0")
                        .param("limit", "2")
                        .with(lecturer))
                .andExpect(status().isOk())
                .andExpect(header().string("X-Total-Count", String.valueOf(ROOTS)));

        assertThat(countQueries()).hasSize(1);
        assertThat(rootQueries()).hasSize(1);
        assertThat(countQueries().getFirst())
                .contains("g.approval_status = 'APPROVED'")
                .contains("t.department_id = ?");
        assertThat(rootQueries().getFirst())
                .contains("g.approval_status = 'APPROVED'")
                .contains("t.department_id = ?");
    }

    private List<String> countQueries() {
        return statements.stream()
                .filter(sql -> sql.startsWith("SELECT COUNT(*) AS archive_total"))
                .toList();
    }

    private List<String> rootQueries() {
        return statements.stream()
                .filter(sql -> sql.startsWith("SELECT r.id AS report_id"))
                .toList();
    }

    private List<String> memberQueries() {
        return statements.stream()
                .filter(sql -> sql.startsWith("SELECT gm.group_id"))
                .toList();
    }

    private List<String> supervisorQueries() {
        return statements.stream()
                .filter(sql -> sql.startsWith("SELECT sup.topic_id"))
                .toList();
    }

    private static int likePredicates(String sql) {
        int count = 0;
        int index = 0;
        while ((index = sql.indexOf("LIKE ?", index)) >= 0) {
            count++;
            index += "LIKE ?".length();
        }
        return count;
    }

    private void seedRoundWithSevenReports() {
        roundId = UUID.randomUUID();
        Instant now = Instant.now();
        jdbc.update("INSERT INTO thesis.thesis_registration_round "
                        + "(id, name, thesis_type, lecturer_submit_start, lecturer_submit_end, "
                        + "registration_start, registration_end, gvpb_deadline, status) "
                        + "VALUES (?, ?, 'KLTN', ?, ?, ?, ?, ?, 'REGISTRATION_CLOSED')",
                roundId, "Archive budget round",
                Timestamp.from(now.minusSeconds(14_400)), Timestamp.from(now.minusSeconds(10_800)),
                Timestamp.from(now.minusSeconds(7_200)), Timestamp.from(now.plusSeconds(3_600)),
                Timestamp.from(now.plusSeconds(86_400)));
        Instant base = now.minusSeconds(600);
        for (int root = 0; root < ROOTS; root++) {
            UUID topicId = UUID.randomUUID();
            jdbc.update("INSERT INTO thesis.thesis_topic "
                            + "(id, round_id, department_id, title, description, max_groups, status, created_by) "
                            + "VALUES (?, ?, 'department-demo', ?, 'budget fixture', 1, 'PUBLISHED', 'arb')",
                    topicId, roundId, "Budget topic " + root);
            UUID groupId = UUID.randomUUID();
            jdbc.update("INSERT INTO thesis.thesis_group "
                            + "(id, round_id, leader_student_id, topic_id, status, approval_status) "
                            + "VALUES (?, ?, ?, ?, 'SUBMITTED', 'APPROVED')",
                    groupId, roundId, tag + "-student-" + root + "-1", topicId);
            for (int order = 1; order <= MEMBERS_PER_ROOT; order++) {
                String studentId = tag + "-student-" + root + "-" + order;
                ensureStudent(studentId, "Member", "Budget" + order);
                jdbc.update("INSERT INTO thesis.thesis_group_member "
                                + "(id, group_id, round_id, student_id, member_order, is_leader) "
                                + "VALUES (?, ?, ?, ?, ?, ?)",
                        UUID.randomUUID(), groupId, roundId, studentId, order, order == 1);
            }
            for (int order = 1; order <= SUPERVISORS_PER_ROOT; order++) {
                String lecturerId = tag + "-supervisor-" + root + "-" + order;
                ensureLecturer(lecturerId, "department-demo");
                jdbc.update("INSERT INTO thesis.thesis_topic_supervisor "
                                + "(id, topic_id, lecturer_id, supervisor_order) VALUES (?, ?, ?, ?)",
                        UUID.randomUUID(), topicId, lecturerId, order);
            }
            jdbc.update("INSERT INTO thesis.thesis_group_report "
                            + "(id, group_id, round_id, submitted_by, title, url, submitted_at, file_name, file_type, file_size) "
                            + "VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'application/pdf', 4)",
                    UUID.randomUUID(), groupId, roundId, tag + "-student-" + root + "-1",
                    "Budget report " + root, "https://drive.example.com/budget-" + root + ".pdf",
                    Timestamp.from(base.minusSeconds(root * 60L)), "budget-" + root + ".pdf");
        }
    }

    private void ensureStudent(String studentId, String first, String last) {
        String userId = tag + "-user-" + studentId;
        jdbc.update("INSERT INTO campuscore_auth.\"User\" "
                        + "(\"id\", \"email\", \"password\", \"firstName\", \"lastName\", \"status\", "
                        + "\"emailVerified\", \"isSuperAdmin\", \"failedLoginAttempts\", \"createdAt\", \"updatedAt\") "
                        + "VALUES (?, ?, 'test-password', ?, ?, 'ACTIVE', FALSE, FALSE, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)",
                userId, studentId + "@fixture.test", first, last);
        jdbc.update("INSERT INTO campuscore_auth.\"Student\" "
                        + "(\"id\", \"userId\", \"studentId\", \"curriculumId\", \"year\", \"admissionDate\") "
                        + "VALUES (?, ?, ?, 'curriculum-demo', 2, CURRENT_TIMESTAMP)",
                studentId, userId, "CODE-" + studentId);
    }

    private void ensureLecturer(String lecturerId, String departmentId) {
        String userId = tag + "-lecturer-user-" + lecturerId;
        jdbc.update("INSERT INTO campuscore_auth.\"User\" "
                        + "(\"id\", \"email\", \"password\", \"firstName\", \"lastName\", \"status\", "
                        + "\"emailVerified\", \"isSuperAdmin\", \"failedLoginAttempts\", \"createdAt\", \"updatedAt\") "
                        + "VALUES (?, ?, 'test-password', 'Budget', 'Supervisor', 'ACTIVE', FALSE, FALSE, 0, "
                        + "CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)",
                userId, lecturerId + "@fixture.test");
        jdbc.update("INSERT INTO campuscore_auth.\"Lecturer\" "
                        + "(\"id\", \"userId\", \"departmentId\", \"employeeId\", \"isActive\") "
                        + "VALUES (?, ?, ?, ?, TRUE)",
                lecturerId, userId, departmentId, "GV-" + lecturerId);
    }

    private RequestPostProcessor admin() {
        return ThesisAuthorityFixture.role(jdbc, tag + "-admin-user", "ADMIN");
    }

    private Connection measured(Connection connection) {
        return (Connection) Proxy.newProxyInstance(getClass().getClassLoader(),
                new Class<?>[]{Connection.class}, (proxy, method, args) -> {
                    Object result = invoke(connection, method, args);
                    if (method.getName().equals("prepareStatement")) {
                        String sql = (String) args[0];
                        return Proxy.newProxyInstance(getClass().getClassLoader(),
                                new Class<?>[]{PreparedStatement.class}, (statement, statementMethod, statementArgs) -> {
                                    if (statementMethod.getName().startsWith("execute")) {
                                        statements.add(sql);
                                    }
                                    Object value = invoke(result, statementMethod, statementArgs);
                                    if (value instanceof ResultSet rows) {
                                        return Proxy.newProxyInstance(getClass().getClassLoader(),
                                                new Class<?>[]{ResultSet.class}, (set, setMethod, setArgs) -> {
                                                    Object next = invoke(rows, setMethod, setArgs);
                                                    if (setMethod.getName().equals("next")
                                                            && Boolean.TRUE.equals(next)) {
                                                        rowsRead.merge(sql, 1, Integer::sum);
                                                    }
                                                    return next;
                                                });
                                    }
                                    return value;
                                });
                    }
                    return result;
                });
    }

    private static Object invoke(Object target, java.lang.reflect.Method method, Object[] args) throws Throwable {
        try {
            return method.invoke(target, args);
        } catch (InvocationTargetException exception) {
            throw exception.getCause();
        }
    }
}
