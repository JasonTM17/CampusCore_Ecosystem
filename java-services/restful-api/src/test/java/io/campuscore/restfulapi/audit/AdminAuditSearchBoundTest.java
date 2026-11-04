package io.campuscore.restfulapi.audit;

import static org.assertj.core.api.Assertions.assertThat;

import io.campuscore.restfulapi.common.LikePattern;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.regex.Pattern;
import java.util.stream.Collectors;
import java.util.stream.IntStream;
import javax.sql.DataSource;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.jdbc.core.namedparam.SqlParameterSource;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

/**
 * The audit keyword search adds five {@code TRANSLATE(...) LIKE} predicates per
 * accepted word to both the count and the page statement, so an unbounded word
 * list multiplies the work an operator request can order. It must therefore use
 * the same {@link LikePattern} term/token budget as every other admin search.
 */
class AdminAuditSearchBoundTest {

    private JdbcTemplate jdbc;
    private CapturingJdbc capturing;
    private AdminAuditReadRepository repository;

    @BeforeEach
    void setUp() {
        DriverManagerDataSource dataSource = new DriverManagerDataSource();
        dataSource.setDriverClassName("org.h2.Driver");
        dataSource.setUrl("jdbc:h2:mem:audit_search_bound_test_" + System.nanoTime()
                + ";MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1");
        dataSource.setUsername("sa");
        dataSource.setPassword("");
        jdbc = new JdbcTemplate(dataSource);
        capturing = new CapturingJdbc(dataSource);
        repository = new AdminAuditReadRepository(capturing);

        jdbc.execute("CREATE SCHEMA IF NOT EXISTS \"campuscore_audit\"");
        jdbc.execute("CREATE SCHEMA IF NOT EXISTS \"campuscore_auth\"");
        jdbc.execute("""
            CREATE TABLE "campuscore_audit"."AdminAudit" (
                "id" VARCHAR(120) PRIMARY KEY,
                "actorId" VARCHAR(120),
                "actorLabel" VARCHAR(240),
                "action" VARCHAR(48) NOT NULL,
                "entityType" VARCHAR(48) NOT NULL,
                "entityId" VARCHAR(120),
                "summary" VARCHAR(500),
                "beforeState" TEXT,
                "afterState" TEXT,
                "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
        """);
        jdbc.execute("""
            CREATE TABLE "campuscore_auth"."User" (
                "id" VARCHAR(120) PRIMARY KEY,
                "email" VARCHAR(320) NOT NULL,
                "firstName" VARCHAR(120),
                "lastName" VARCHAR(120)
            )
        """);
    }

    private void insert(String id, String summary) {
        jdbc.update(
                "INSERT INTO \"campuscore_audit\".\"AdminAudit\""
                        + " (\"id\",\"actorId\",\"actorLabel\",\"action\",\"entityType\",\"entityId\",\"summary\",\"createdAt\")"
                        + " VALUES (?,?,?,?,?,?,?,?)",
                id, "admin-user", "Admin", "UPDATED", "COURSE", "c-" + id, summary,
                Timestamp.from(Instant.now()));
    }

    @Test
    void aSearchFullOfWordsBindsAtMostTheSharedTokenLimit() {
        insert("a1", "Updated CN course");
        String search = IntStream.range(0, 200)
                .mapToObj(index -> "alpha")
                .collect(Collectors.joining(" "));

        repository.page(1, 20, null, null, null, null, search);

        assertThat(capturing.statements).hasSize(2);
        assertThat(capturing.statements).allSatisfy(sql ->
                assertThat(distinctTokenParameters(sql))
                        .isLessThanOrEqualTo(LikePattern.MAX_TOKENS));
    }

    @Test
    void wordsBeyondTheTokenLimitNoLongerWidenTheSearch() {
        insert("a1", "alpha bravo charlie delta echo foxtrot golf hotel");

        // The ninth word is outside the accepted budget, so it must not make
        // the whole search fail to match.
        assertThat(repository.page(1, 20, null, null, null, null,
                "alpha bravo charlie delta echo foxtrot golf hotel zulu").data())
                .extracting(AdminAuditReadRepository.AuditEntry::id)
                .containsExactly("a1");
    }

    @Test
    void aTermBeyondTheLengthLimitIsMatchedByItsBoundedPrefix() {
        String prefix = "x".repeat(LikePattern.MAX_TERM_LENGTH);
        insert("a1", prefix + "a");

        assertThat(repository.page(1, 20, null, null, null, null, prefix + "b").data())
                .extracting(AdminAuditReadRepository.AuditEntry::id)
                .containsExactly("a1");
    }

    private static int distinctTokenParameters(String sql) {
        var matcher = Pattern.compile("searchToken\\d+").matcher(sql);
        var names = new HashSet<String>();
        while (matcher.find()) {
            names.add(matcher.group());
        }
        return names.size();
    }

    private static final class CapturingJdbc extends NamedParameterJdbcTemplate {

        private final List<String> statements = new ArrayList<>();

        private CapturingJdbc(DataSource dataSource) {
            super(dataSource);
        }

        @Override
        public <T> T queryForObject(String sql, SqlParameterSource paramSource, Class<T> requiredType) {
            statements.add(sql);
            return super.queryForObject(sql, paramSource, requiredType);
        }

        @Override
        public <T> List<T> query(String sql, SqlParameterSource paramSource, RowMapper<T> rowMapper) {
            statements.add(sql);
            return super.query(sql, paramSource, rowMapper);
        }
    }
}
