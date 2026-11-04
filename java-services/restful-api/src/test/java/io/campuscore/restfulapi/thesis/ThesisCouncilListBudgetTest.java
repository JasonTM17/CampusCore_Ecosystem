package io.campuscore.restfulapi.thesis;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

import io.campuscore.restfulapi.thesis.service.ThesisCouncilService;
import io.campuscore.restfulapi.thesis.service.ThesisCouncilService.CouncilResponse;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Proxy;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.jdbc.datasource.DelegatingDataSource;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.security.oauth2.jwt.Jwt;

/**
 * The round council list must hydrate every roster in a fixed number of
 * statements, and a faculty-head filter must resolve the dean's faculty once
 * instead of once per council.
 */
class ThesisCouncilListBudgetTest {

    private JdbcTemplate jdbc;
    private NamedParameterJdbcTemplate named;
    private ThesisCouncilService councils;
    private final List<String> statements = new ArrayList<>();
    private final List<UUID> manyRoundVisibleCouncils = new ArrayList<>();
    private UUID singleRound;
    private UUID manyRound;
    private UUID deanCreatedCouncil;
    private UUID foreignCouncil;

    @BeforeEach
    void setUp() {
        var source = new DriverManagerDataSource(
                "jdbc:h2:mem:thesis_council_list_" + UUID.randomUUID()
                        + ";MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1", "sa", "");
        Flyway.configure().dataSource(source).locations("classpath:db/migration-h2").load().migrate();
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
                                            return invoke(result, m, a);
                                        });
                            }
                            return result;
                        });
            }
        };
        jdbc = new JdbcTemplate(measured);
        named = new NamedParameterJdbcTemplate(measured);
        councils = new ThesisCouncilService(
                named, mock(io.campuscore.restfulapi.audit.AdminAuditRecorder.class));

        singleRound = insertRound("Council list single");
        manyRound = insertRound("Council list many");
        seedCouncil(singleRound, "single", 3, 2, "someone", "department-demo");
        for (int i = 0; i < 40; i++) {
            UUID councilId = seedCouncil(manyRound, "many-" + i, 3, i % 3, "someone", "department-demo");
            if (i % 3 != 0) {
                manyRoundVisibleCouncils.add(councilId);
            }
        }
        deanCreatedCouncil = seedCouncil(manyRound, "dean-created", 3, 0, "budget-dean-user", "department-demo");

        jdbc.update("INSERT INTO academic.\"Faculty\" (\"id\",\"name\",\"isActive\") "
                + "VALUES ('budget-faculty','Budget faculty',TRUE)");
        jdbc.update("INSERT INTO academic.\"Department\" "
                + "(\"id\",\"name\",\"nameEn\",\"nameVi\",\"code\",\"facultyId\",\"isActive\") "
                + "VALUES ('budget-department','Budget department','Budget department','Budget department','BD',"
                + "'budget-faculty',TRUE)");
        foreignCouncil = seedCouncil(manyRound, "foreign", 3, 1, "someone", "budget-department");

        jdbc.update("INSERT INTO campuscore_auth.\"User\" "
                + "(\"id\",\"email\",\"password\",\"firstName\",\"lastName\",\"status\",\"emailVerified\","
                + "\"isSuperAdmin\",\"failedLoginAttempts\",\"createdAt\",\"updatedAt\") "
                + "VALUES ('budget-dean-user','budget-dean@fixture.test','test','Budget','Dean','ACTIVE',"
                + "FALSE,FALSE,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)");
        jdbc.update("INSERT INTO campuscore_auth.\"Lecturer\" "
                + "(\"id\",\"userId\",\"departmentId\",\"employeeId\",\"isActive\") "
                + "VALUES ('budget-dean-lecturer','budget-dean-user','department-demo','EMP-BUDGET-DEAN',TRUE)");
        statements.clear();
    }

    @Test
    void listHydratesTheSameRosterAsTheSingleCouncilRead() {
        List<CouncilResponse> listed = councils.listByRound(singleRound);
        List<CouncilResponse> singleReads = listed.stream()
                .map(council -> councils.getCouncil(council.id()))
                .toList();

        assertThat(listed).containsExactlyElementsOf(singleReads);
        assertThat(listed.get(0).members())
                .extracting(ThesisCouncilService.CouncilMember::memberRole)
                .containsExactly("CHAIR", "SECRETARY", "MEMBER");
        assertThat(listed.get(0).topicIds()).hasSize(2);
    }

    @Test
    void roundListStatementCountDoesNotGrowWithCouncilCount() {
        int single = statementsFor(singleRound);
        int many = statementsFor(manyRound);

        assertThat(many).isEqualTo(single);
    }

    @Test
    void deanFilterKeepsTheSingleCouncilRuleAndAConstantStatementCount() {
        Jwt dean = Jwt.withTokenValue("test").header("alg", "none").subject("budget-dean-user")
                .claim("roles", List.of("TRUONG_KHOA"))
                .claim("lecturerId", "budget-dean-lecturer")
                .build();

        List<UUID> visible = councils.listByRoundForActor(manyRound, dean).stream()
                .map(CouncilResponse::id)
                .toList();

        assertThat(visible).containsAll(manyRoundVisibleCouncils).contains(deanCreatedCouncil);
        assertThat(visible).doesNotContain(foreignCouncil);

        int single = statementsFor(singleRound, dean);
        int many = statementsFor(manyRound, dean);
        assertThat(many).isEqualTo(single);
    }

    private int statementsFor(UUID roundId) {
        statements.clear();
        councils.listByRound(roundId);
        return statements.size();
    }

    private int statementsFor(UUID roundId, Jwt actor) {
        statements.clear();
        councils.listByRoundForActor(roundId, actor);
        return statements.size();
    }

    private UUID insertRound(String name) {
        UUID roundId = UUID.randomUUID();
        Instant registrationStart = Instant.now().plusSeconds(3_600);
        jdbc.update("INSERT INTO thesis.thesis_registration_round "
                        + "(id, name, thesis_type, lecturer_submit_start, lecturer_submit_end, "
                        + "registration_start, registration_end, status) "
                        + "VALUES (?, ?, 'KLTN', ?, ?, ?, ?, 'REGISTRATION_CLOSED')",
                roundId, name,
                Timestamp.from(registrationStart.minusSeconds(7_200)),
                Timestamp.from(registrationStart.minusSeconds(3_600)),
                Timestamp.from(registrationStart),
                Timestamp.from(registrationStart.plusSeconds(3_600)));
        return roundId;
    }

    private UUID seedCouncil(UUID roundId, String tag, int members, int topics,
            String createdBy, String departmentId) {
        UUID councilId = UUID.randomUUID();
        jdbc.update("INSERT INTO thesis.thesis_council (id, round_id, name, status, created_by) "
                + "VALUES (?, ?, ?, 'ACTIVE', ?)", councilId, roundId, "Council " + tag, createdBy);
        for (int i = 0; i < members; i++) {
            String role = i == 0 ? "CHAIR" : i == 1 ? "SECRETARY" : "MEMBER";
            jdbc.update("INSERT INTO thesis.thesis_council_member "
                            + "(id, council_id, lecturer_id, member_role) VALUES (?, ?, ?, ?)",
                    UUID.randomUUID(), councilId, tag + "-member-" + i, role);
        }
        for (int i = 0; i < topics; i++) {
            UUID topicId = UUID.randomUUID();
            jdbc.update("INSERT INTO thesis.thesis_topic "
                            + "(id, round_id, department_id, title, description, max_groups, status, created_by) "
                            + "VALUES (?, ?, ?, ?, 'council list fixture', 1, 'PUBLISHED', ?)",
                    topicId, roundId, departmentId, "Topic " + tag + "-" + i, UUID.randomUUID());
            jdbc.update("INSERT INTO thesis.thesis_council_topic (id, council_id, topic_id, assigned_by) "
                    + "VALUES (?, ?, ?, ?)", UUID.randomUUID(), councilId, topicId, "someone");
        }
        return councilId;
    }

    private static Object invoke(Object target, java.lang.reflect.Method method, Object[] args)
            throws Throwable {
        try {
            return method.invoke(target, args);
        } catch (InvocationTargetException exception) {
            throw exception.getCause();
        }
    }
}
