package io.campuscore.restfulapi.thesis;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import io.campuscore.restfulapi.thesis.domain.ThesisTopic;
import io.campuscore.restfulapi.thesis.domain.TopicStatus;
import io.campuscore.restfulapi.thesis.repository.ThesisRoundReadPort;
import io.campuscore.restfulapi.thesis.repository.ThesisTopicRepository;
import io.campuscore.restfulapi.thesis.service.ThesisTopicService;
import io.campuscore.restfulapi.thesis.web.ThesisTopicController;
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
import java.util.concurrent.atomic.AtomicInteger;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.jdbc.datasource.DelegatingDataSource;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.security.oauth2.jwt.Jwt;

/**
 * Budget proof for Q09: the paged topic read scans every visible {@code
 * (id, title)} pair but hydrates exactly one page. The compatibility branch
 * still materializes the whole set through the JPA repository, which is the
 * behaviour this test would have failed on before the paged projection existed.
 */
class ThesisTopicReadBudgetTest {

    private static final int TOTAL = 60;
    private static final int LIMIT = 20;

    private JdbcTemplate jdbc;
    private ThesisTopicController controller;
    private final AtomicInteger jpaMaterialized = new AtomicInteger();
    private final List<String> statements = new ArrayList<>();
    private final Map<String, Integer> rowsRead = new HashMap<>();
    private UUID roundId;

    @BeforeEach
    void fixture() {
        var source = new DriverManagerDataSource("jdbc:h2:mem:thesis_topic_budget_"
                + UUID.randomUUID() + ";MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1", "sa", "");
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
                                            Object value = invoke(result, m, a);
                                            if (value instanceof ResultSet rows) {
                                                return Proxy.newProxyInstance(getClass().getClassLoader(),
                                                        new Class<?>[]{ResultSet.class}, (rp, rm, ra) -> {
                                                            Object next = invoke(rows, rm, ra);
                                                            if (rm.getName().equals("next")
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
        };
        jdbc = new JdbcTemplate(measured);
        NamedParameterJdbcTemplate named = new NamedParameterJdbcTemplate(measured);
        roundId = UUID.randomUUID();
        seedRound(roundId);
        List<ThesisTopic> legacyRows = seedTopics(roundId);
        ThesisTopicRepository repository = mock(ThesisTopicRepository.class);
        when(repository.findAllByRoundIdAndStatusOrderByTitle(eq(roundId), any(TopicStatus.class)))
                .thenAnswer(call -> {
                    if (call.getArgument(1) == TopicStatus.PUBLISHED) {
                        jpaMaterialized.addAndGet(legacyRows.size());
                        return legacyRows;
                    }
                    return List.of();
                });
        controller = new ThesisTopicController(new ThesisTopicService(
                repository, new ThesisRoundReadPort(jdbc), named));
        statements.clear();
        rowsRead.clear();
        jpaMaterialized.set(0);
    }

    @Test
    void onlyTheSelectedPageIsHydratedWhileTheIdTitleScanCoversTheVisibleSet() {
        var response = controller.list(roundId, null, 0, LIMIT, adminJwt());

        assertThat(response.getBody()).hasSize(LIMIT);
        assertThat(response.getHeaders().getFirst("X-Total-Count")).isEqualTo(String.valueOf(TOTAL));
        assertThat(jpaMaterialized.get())
                .as("the legacy JPA materialization must not run for paged reads")
                .isZero();
        assertThat(keyRowsRead()).isEqualTo(TOTAL);
        assertThat(fullTopicRowsRead()).isEqualTo(LIMIT);
        assertThat(statements)
                .as("round existence, key scan, publication lookup and hydration stay constant")
                .hasSize(4);
    }

    @Test
    void consecutivePagesKeepAConstantReadBudget() {
        var first = controller.list(roundId, null, 0, LIMIT, adminJwt());
        assertThat(first.getBody()).hasSize(LIMIT);
        assertThat(fullTopicRowsRead()).isEqualTo(LIMIT);

        statements.clear();
        rowsRead.clear();
        var second = controller.list(roundId, null, 1, LIMIT, adminJwt());

        assertThat(second.getBody()).hasSize(LIMIT);
        assertThat(second.getHeaders().getFirst("X-Total-Count")).isEqualTo(String.valueOf(TOTAL));
        assertThat(keyRowsRead()).isEqualTo(TOTAL);
        assertThat(fullTopicRowsRead()).isEqualTo(LIMIT);
        assertThat(statements).hasSize(4);
        assertThat(second.getBody().stream().map(topic -> topic.id()).toList())
                .doesNotContainAnyElementsOf(first.getBody().stream().map(topic -> topic.id()).toList());
    }

    @Test
    void anOutOfRangePageHydratesNothingAndKeepsTheExactTotal() {
        var response = controller.list(roundId, null, 3, LIMIT, adminJwt());

        assertThat(response.getBody()).isEmpty();
        assertThat(response.getHeaders().getFirst("X-Total-Count")).isEqualTo(String.valueOf(TOTAL));
        assertThat(jpaMaterialized.get()).isZero();
        assertThat(keyRowsRead()).isEqualTo(TOTAL);
        assertThat(fullTopicRowsRead()).isZero();
        assertThat(statements)
                .as("round existence and the key scan only; no hydration or publication lookup")
                .hasSize(2);
    }

    @Test
    void legacyUnpagedReadStillReturnsTheWholeArrayWithoutATotalHeader() {
        var response = controller.list(roundId, null, null, null, adminJwt());

        assertThat(response.getBody()).hasSize(TOTAL);
        assertThat(response.getHeaders().getFirst("X-Total-Count")).isNull();
        assertThat(jpaMaterialized.get())
                .as("the compatibility branch remains the complete legacy read")
                .isEqualTo(TOTAL);
    }

    private int keyRowsRead() {
        return rowsRead.entrySet().stream()
                .filter(entry -> entry.getKey().startsWith("SELECT t.id, t.title"))
                .mapToInt(Map.Entry::getValue).sum();
    }

    private int fullTopicRowsRead() {
        return rowsRead.entrySet().stream()
                .filter(entry -> entry.getKey().contains("description"))
                .mapToInt(Map.Entry::getValue).sum();
    }

    private void seedRound(UUID id) {
        Instant now = Instant.now();
        jdbc.update("INSERT INTO thesis.thesis_registration_round (id, name, thesis_type,"
                        + " lecturer_submit_start, lecturer_submit_end, registration_start,"
                        + " registration_end, status) VALUES (?, ?, 'KLTN', ?, ?, ?, ?, 'DRAFT')",
                id, "topic-read-budget", Timestamp.from(now.minusSeconds(7_200)),
                Timestamp.from(now.minusSeconds(3_600)), Timestamp.from(now.minusSeconds(3_600)),
                Timestamp.from(now.plusSeconds(86_400 * 30L)));
    }

    private List<ThesisTopic> seedTopics(UUID round) {
        List<ThesisTopic> rows = new ArrayList<>();
        for (int i = 0; i < TOTAL; i++) {
            UUID id = UUID.randomUUID();
            String title = "Budget topic %02d".formatted(i);
            jdbc.update("INSERT INTO thesis.thesis_topic (id, round_id, department_id, title,"
                            + " description, max_groups, status, created_by)"
                            + " VALUES (?, ?, 'department-demo', ?, 'Budget description', 2,"
                            + " 'PUBLISHED', 'budget-owner')",
                    id, round, title);
            ThesisTopic row = new ThesisTopic(round, "department-demo", title,
                    "Budget description", 2, "budget-owner");
            forceId(row, id);
            rows.add(row);
        }
        return rows;
    }

    private static void forceId(ThesisTopic topic, UUID id) {
        try {
            var field = ThesisTopic.class.getDeclaredField("id");
            field.setAccessible(true);
            field.set(topic, id);
        } catch (ReflectiveOperationException exception) {
            throw new IllegalStateException(exception);
        }
    }

    private static Jwt adminJwt() {
        return Jwt.withTokenValue("topic-budget").header("alg", "none")
                .subject("budget-admin").claim("roles", List.of("ADMIN")).build();
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
