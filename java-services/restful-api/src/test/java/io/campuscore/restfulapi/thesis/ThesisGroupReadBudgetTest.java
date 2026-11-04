package io.campuscore.restfulapi.thesis;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

import io.campuscore.restfulapi.thesis.repository.ThesisGroupReadRepository;
import io.campuscore.restfulapi.thesis.repository.ThesisRoundReadPort;
import io.campuscore.restfulapi.thesis.service.ThesisGroupReadService;
import io.campuscore.restfulapi.thesis.web.ThesisGroupReadController;
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
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.jdbc.datasource.DelegatingDataSource;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.security.oauth2.jwt.Jwt;

/**
 * Read-budget evidence for the per-round thesis-group list: the count and the
 * ordered page window happen in SQL before member hydration, and governance
 * masking no longer runs one supervisor lookup per group.
 */
class ThesisGroupReadBudgetTest {

    private static final String DEPT = "department-demo";
    private static final String FACULTY = "faculty-demo";
    private static final String DEAN_LECTURER = "budget-dean";
    private static final String DEAN_USER = "budget-dean-user";

    private JdbcTemplate jdbc;
    private ThesisGroupReadController controller;
    private final List<String> statements = new ArrayList<>();
    private final Map<String, Integer> rowsRead = new HashMap<>();
    private UUID roundId;

    @BeforeEach
    void fixture() throws Exception {
        var source = new DriverManagerDataSource("jdbc:h2:mem:thesis_group_budget_"
                + UUID.randomUUID() + ";MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1", "sa", "");
        var measured = new DelegatingDataSource(source) {
            @Override
            public Connection getConnection() throws java.sql.SQLException {
                Connection connection = super.getConnection();
                return (Connection) Proxy.newProxyInstance(getClass().getClassLoader(),
                        new Class<?>[]{Connection.class}, (proxy, method, args) -> {
                            Object result = invoke(connection, method, args);
                            if (method.getName().equals("prepareStatement")) {
                                String sql = (String) args[0];
                                return Proxy.newProxyInstance(getClass().getClassLoader(),
                                        new Class<?>[]{PreparedStatement.class}, (p, m, a) -> {
                                            if (m.getName().startsWith("execute")) {
                                                statements.add(sql);
                                            }
                                            Object value = invoke(result, m, a);
                                            if (value instanceof ResultSet rows) {
                                                return Proxy.newProxyInstance(getClass().getClassLoader(),
                                                        new Class<?>[]{ResultSet.class}, (rp, rm, ra) -> {
                                                            Object next = invoke(rows, rm, ra);
                                                            if (rm.getName().equals("next") && Boolean.TRUE.equals(next)) {
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
        };
        jdbc = new JdbcTemplate(measured);
        schema();
        roundId = UUID.randomUUID();
        ThesisGroupReadRepository repository = new ThesisGroupReadRepository(new NamedParameterJdbcTemplate(measured));
        ThesisGroupReadService service = new ThesisGroupReadService(repository, mock(ThesisRoundReadPort.class));
        controller = new ThesisGroupReadController(service);
        statements.clear();
        rowsRead.clear();
    }

    @Test
    void legacyAdminReadStaysCompleteAndUncounted() {
        for (int i = 0; i < 45; i++) {
            group(null, "SUBMITTED", Instant.parse("2030-01-01T00:00:00Z").plusSeconds(i));
        }

        resetCounters();
        var response = controller.list(roundId, null, null, jwt("budget-admin", List.of("ADMIN"), null));

        assertThat(response.getBody()).hasSize(45);
        assertThat(response.getHeaders().getFirst("X-Total-Count")).isNull();
        assertThat(countQueries()).isEmpty();
        assertThat(parentQueries()).hasSize(1);
        assertThat(hydrateQueries()).hasSize(1);
        assertThat(rowsRead.get(parentQueries().getFirst())).isEqualTo(45);
    }

    @Test
    void pagedAdminReadsOnlyTheWindowBeforeHydration() {
        for (int i = 0; i < 45; i++) {
            group(null, "SUBMITTED", Instant.parse("2030-01-01T00:00:00Z").plusSeconds(i));
        }

        resetCounters();
        var response = controller.list(roundId, 0, 20, jwt("budget-admin", List.of("ADMIN"), null));
        assertThat(response.getHeaders().getFirst("X-Total-Count")).isEqualTo("45");
        assertThat(response.getBody()).hasSize(20);
        assertThat(countQueries()).hasSize(1);
        assertThat(parentQueries()).hasSize(1);
        assertThat(parentQueries().getFirst()).contains("LIMIT").contains("OFFSET");
        assertThat(hydrateQueries()).hasSize(1);
        assertThat(rowsRead.get(countQueries().getFirst())).isEqualTo(1);
        assertThat(rowsRead.get(parentQueries().getFirst())).isEqualTo(20);
        assertThat(rowsRead.get(hydrateQueries().getFirst())).isEqualTo(20);
        assertThat(statements).hasSize(3);
    }

    @Test
    void outOfRangePageCountsButNeverReadsParentsOrMembers() {
        for (int i = 0; i < 45; i++) {
            group(null, "SUBMITTED", Instant.parse("2030-01-01T00:00:00Z").plusSeconds(i));
        }

        resetCounters();
        var response = controller.list(roundId, 3, 20, jwt("budget-admin", List.of("ADMIN"), null));

        assertThat(response.getHeaders().getFirst("X-Total-Count")).isEqualTo("45");
        assertThat(response.getBody()).isEmpty();
        assertThat(countQueries()).hasSize(1);
        assertThat(parentQueries()).isEmpty();
        assertThat(hydrateQueries()).isEmpty();
        assertThat(statements).hasSize(1);
    }

    @Test
    void q13PagesOneAuthorizedSetWithoutPerGroupSupervisionLookups() {
        ensureGovernanceProfile();
        UUID plainTopic = topic(DEPT, "Budget plain in-faculty");
        UUID supervisedTopic = topic(DEPT, "Budget supervised in-faculty");
        UUID outsiderTopic = topic("budget-dept-foreign", "Budget supervised outsider");
        UUID foreignTopic = topic("budget-dept-foreign", "Budget foreign unrelated");
        supervise(supervisedTopic, DEAN_LECTURER);
        supervise(outsiderTopic, DEAN_LECTURER);

        Instant base = Instant.parse("2030-01-01T00:00:00Z");
        for (int i = 0; i < 20; i++) {
            group(plainTopic, "SUBMITTED", base.plusSeconds(i));
        }
        for (int i = 0; i < 10; i++) {
            group(supervisedTopic, "SUBMITTED", base.plusSeconds(100 + i));
        }
        for (int i = 0; i < 10; i++) {
            group(outsiderTopic, "SUBMITTED", base.plusSeconds(200 + i));
        }
        for (int i = 0; i < 5; i++) {
            group(foreignTopic, "SUBMITTED", base.plusSeconds(300 + i));
        }

        resetCounters();
        var response = controller.list(roundId, 0, 20,
                jwt(DEAN_USER, List.of("TRUONG_KHOA"), DEAN_LECTURER));

        assertThat(response.getHeaders().getFirst("X-Total-Count")).isEqualTo("40");
        assertThat(response.getBody()).hasSize(20);
        assertThat(countQueries()).hasSize(1);
        assertThat(parentQueries()).hasSize(1);
        assertThat(parentQueries().getFirst()).contains("scope_rank").contains("LIMIT");
        assertThat(hydrateQueries()).hasSize(1);
        assertThat(rowsRead.get(parentQueries().getFirst())).isEqualTo(20);
        assertThat(rowsRead.get(hydrateQueries().getFirst())).isEqualTo(20);
        // Scope lookup + count + parent page + one hydration query.
        assertThat(statements).hasSize(4);
        // The old masking path issued one COUNT lookup per group.
        assertThat(statements).noneMatch(sql ->
                sql.startsWith("SELECT COUNT(*) FROM thesis.thesis_topic_supervisor"));
    }

    @Test
    void pagedLecturerReadIsBoundedToTheSupervisedWindow() {
        ensureLecturer("budget-lecturer", "budget-lecturer-user", DEPT);
        UUID supervised = topic(DEPT, "Budget lecturer supervised");
        UUID other = topic(DEPT, "Budget lecturer other");
        supervise(supervised, "budget-lecturer");
        Instant base = Instant.parse("2030-01-01T00:00:00Z");
        for (int i = 0; i < 30; i++) {
            group(supervised, "SUBMITTED", base.plusSeconds(i));
        }
        for (int i = 0; i < 10; i++) {
            group(other, "SUBMITTED", base.plusSeconds(100 + i));
        }

        resetCounters();
        var response = controller.list(roundId, 1, 10,
                jwt("budget-lecturer-user", List.of("LECTURER"), "budget-lecturer"));

        assertThat(response.getHeaders().getFirst("X-Total-Count")).isEqualTo("30");
        assertThat(response.getBody()).hasSize(10);
        assertThat(countQueries()).hasSize(1);
        assertThat(parentQueries()).hasSize(1);
        assertThat(hydrateQueries()).hasSize(1);
        assertThat(rowsRead.get(parentQueries().getFirst())).isEqualTo(10);
        assertThat(rowsRead.get(hydrateQueries().getFirst())).isEqualTo(10);
        assertThat(statements).hasSize(3);
    }

    private void schema() {        jdbc.execute("CREATE SCHEMA thesis");
        jdbc.execute("CREATE SCHEMA campuscore_auth");
        jdbc.execute("CREATE SCHEMA academic");
        jdbc.execute("CREATE TABLE thesis.thesis_group ("
                + "id UUID PRIMARY KEY, round_id UUID NOT NULL, leader_student_id VARCHAR(120) NOT NULL,"
                + " topic_id UUID, status VARCHAR(32) NOT NULL, approval_status VARCHAR(32) NOT NULL,"
                + " rejection_reason VARCHAR(500), created_at TIMESTAMP WITH TIME ZONE NOT NULL)");
        jdbc.execute("CREATE TABLE thesis.thesis_group_member ("
                + "group_id UUID NOT NULL, student_id VARCHAR(120) NOT NULL, display_name VARCHAR(200),"
                + " contact VARCHAR(200), is_external BOOLEAN, is_leader BOOLEAN, member_order INTEGER)");
        jdbc.execute("CREATE TABLE thesis.thesis_topic (id UUID PRIMARY KEY, department_id VARCHAR(120))");
        jdbc.execute("CREATE TABLE thesis.thesis_topic_supervisor ("
                + "topic_id UUID NOT NULL, lecturer_id VARCHAR(120) NOT NULL)");
        jdbc.execute("CREATE TABLE campuscore_auth.\"Student\" ("
                + "\"id\" VARCHAR PRIMARY KEY, \"studentId\" VARCHAR, \"userId\" VARCHAR, \"curriculumId\" VARCHAR)");
        jdbc.execute("CREATE TABLE campuscore_auth.\"User\" ("
                + "\"id\" VARCHAR PRIMARY KEY, \"firstName\" VARCHAR, \"lastName\" VARCHAR,"
                + " \"email\" VARCHAR, \"status\" VARCHAR)");
        jdbc.execute("CREATE TABLE campuscore_auth.\"Lecturer\" ("
                + "\"id\" VARCHAR PRIMARY KEY, \"userId\" VARCHAR, \"departmentId\" VARCHAR, \"isActive\" BOOLEAN)");
        jdbc.execute("CREATE TABLE academic.\"Department\" ("
                + "\"id\" VARCHAR PRIMARY KEY, \"facultyId\" VARCHAR, \"isActive\" BOOLEAN)");
        jdbc.execute("CREATE TABLE academic.\"Curriculum\" (\"id\" VARCHAR PRIMARY KEY, \"departmentId\" VARCHAR)");
        jdbc.execute("CREATE TABLE academic.\"Faculty\" (\"id\" VARCHAR PRIMARY KEY, \"isActive\" BOOLEAN)");
        jdbc.update("INSERT INTO academic.\"Faculty\" (\"id\", \"isActive\") VALUES (?, TRUE)", FACULTY);
        jdbc.update("INSERT INTO academic.\"Faculty\" (\"id\", \"isActive\")"
                + " VALUES ('budget-faculty-foreign', TRUE)");
        jdbc.update("INSERT INTO academic.\"Department\" (\"id\", \"facultyId\", \"isActive\")"
                + " VALUES (?, ?, TRUE)", DEPT, FACULTY);
        jdbc.update("INSERT INTO academic.\"Department\" (\"id\", \"facultyId\", \"isActive\")"
                + " VALUES ('budget-dept-foreign', 'budget-faculty-foreign', TRUE)");
    }

    private void ensureGovernanceProfile() {
        ensureLecturer(DEAN_LECTURER, DEAN_USER, DEPT);
    }

    private void ensureLecturer(String lecturerId, String userId, String departmentId) {
        jdbc.update("INSERT INTO campuscore_auth.\"User\" (\"id\", \"status\") VALUES (?, 'ACTIVE')", userId);
        jdbc.update("INSERT INTO campuscore_auth.\"Lecturer\""
                + " (\"id\", \"userId\", \"departmentId\", \"isActive\") VALUES (?, ?, ?, TRUE)",
                lecturerId, userId, departmentId);
    }

    private UUID topic(String departmentId, String title) {
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO thesis.thesis_topic (id, department_id) VALUES (?, ?)", id, departmentId);
        return id;
    }

    private void supervise(UUID topicId, String lecturerId) {
        jdbc.update("INSERT INTO thesis.thesis_topic_supervisor (topic_id, lecturer_id) VALUES (?, ?)",
                topicId, lecturerId);
    }

    private UUID group(UUID topicId, String status, Instant createdAt) {
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO thesis.thesis_group"
                        + " (id, round_id, leader_student_id, topic_id, status, approval_status, created_at)"
                        + " VALUES (?, ?, 'budget-leader', ?, ?, 'PENDING', ?)",
                id, roundId, topicId, status, Timestamp.from(createdAt));
        jdbc.update("INSERT INTO thesis.thesis_group_member"
                        + " (group_id, student_id, display_name, contact, is_external, is_leader, member_order)"
                        + " VALUES (?, ?, 'External Member', 'external@budget.test', TRUE, TRUE, 1)",
                id, "budget-external-" + id);
        return id;
    }

    private void resetCounters() {
        statements.clear();
        rowsRead.clear();
    }

    private List<String> countQueries() {        return statements.stream()
                .filter(sql -> sql.startsWith("SELECT COUNT(*) FROM thesis.thesis_group"))
                .toList();
    }

    private List<String> parentQueries() {
        return statements.stream()
                .filter(sql -> sql.startsWith("SELECT g.id") || sql.startsWith("SELECT id, round_id"))
                .filter(sql -> !sql.startsWith("SELECT m.group_id"))
                .toList();
    }

    private List<String> hydrateQueries() {
        return statements.stream().filter(sql -> sql.startsWith("SELECT m.group_id")).toList();
    }

    private static Jwt jwt(String subject, List<String> roles, String lecturerId) {
        Jwt.Builder builder = Jwt.withTokenValue("budget-fixture").header("alg", "none")
                .subject(subject).claim("roles", roles);
        if (lecturerId != null) {
            builder.claim("lecturerId", lecturerId);
        }
        return builder.build();
    }

    private static Object invoke(Object target, java.lang.reflect.Method method, Object[] args) throws Throwable {
        try {
            return method.invoke(target, args);
        } catch (InvocationTargetException exception) {
            throw exception.getCause();
        }
    }
}
