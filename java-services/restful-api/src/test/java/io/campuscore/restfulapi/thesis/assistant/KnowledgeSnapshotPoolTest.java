package io.campuscore.restfulapi.thesis.assistant;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.spy;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;

import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;
import io.campuscore.restfulapi.thesis.assistant.AssistantRlsBoundary.Access;
import io.campuscore.restfulapi.thesis.assistant.ThesisAssistantKnowledgeRepository.KnowledgeDocument;
import java.io.PrintWriter;
import java.sql.Connection;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.logging.Logger;
import javax.sql.DataSource;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentMatchers;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;

/**
 * The assistant datasource pool is deliberately bounded (validated to 1-4
 * connections), and every repository call already runs inside the RLS
 * transaction boundary holding one pooled connection. A snapshot refresh that
 * asks the same pool for a second connection can never be satisfied while the
 * caller's transaction is open — on a capacity-one pool it waits out the
 * acquire timeout on every cold load, and concurrent callers multiply the
 * wait. The refresh must therefore isolate its failure on the caller's own
 * connection instead of checking out another one.
 */
class KnowledgeSnapshotPoolTest {

    private static final UUID RELEASE_ID =
            UUID.fromString("00000000-0000-4000-8000-00000000e001");

    private HikariDataSource pool;
    private CountingDataSource countingDataSource;
    private NamedParameterJdbcTemplate jdbc;
    private AssistantRlsTransactionRunner transactions;
    private ThesisAssistantKnowledgeRepository repository;

    @BeforeEach
    void openCapacityOnePool() throws Exception {
        HikariConfig config = new HikariConfig();
        config.setJdbcUrl("jdbc:h2:mem:snapshot-pool-" + UUID.randomUUID()
                + ";MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1");
        config.setUsername("sa");
        config.setMaximumPoolSize(1);
        // Bounded wait: a second checkout can never succeed while the caller's
        // transaction holds the only connection, so the pre-fix path surfaces
        // as a deterministic acquire timeout instead of an open-ended hang.
        config.setConnectionTimeout(1500);
        pool = new HikariDataSource(config);
        countingDataSource = new CountingDataSource(pool);
        seedPublishedCorpus();
        jdbc = spy(new NamedParameterJdbcTemplate(countingDataSource));
        transactions = new AssistantRlsTransactionRunner(
                new DataSourceTransactionManager(countingDataSource), jdbc, true);
        repository = new ThesisAssistantKnowledgeRepository(jdbc, false, true, 30_000L, transactions);
    }

    @AfterEach
    void closePool() {
        if (pool != null) {
            pool.close();
        }
    }

    @Test
    @DisplayName("a cold refresh inside the boundary never waits on a second pooled connection")
    void coldRefreshInsideTheBoundaryNeedsOnlyTheCallerConnection() throws Throwable {
        List<KnowledgeDocument> documents = transactions.execute(Access.AUTO,
                () -> repository.search("vi", List.of("giấy"), 5));

        assertEquals(List.of("cert-vi"), slugs(documents));
        assertEquals(1, countingDataSource.checkouts(),
                "the refresh must run inside the caller's transaction on the same physical connection");
        // The snapshot loader actually ran, and the search stayed on the
        // snapshot path instead of degrading to the per-request SQL query.
        verify(jdbc, times(1)).query(contains("knowledge_runtime_state"),
                ArgumentMatchers.<RowMapper<Object>>any());
        verify(jdbc, never()).query(contains("lexical_score"), any(MapSqlParameterSource.class),
                ArgumentMatchers.<RowMapper<KnowledgeDocument>>any());
    }

    @Test
    @DisplayName("four concurrent boundaries on a capacity-one pool all complete on their own connection")
    void concurrentBoundariesNeverWaitForAnExtraConnection() throws Exception {
        ExecutorService scheduler = Executors.newFixedThreadPool(4);
        try {
            List<Future<List<KnowledgeDocument>>> searches = new ArrayList<>();
            for (int i = 0; i < 4; i++) {
                searches.add(scheduler.submit(() -> transactions.executeUnchecked(Access.AUTO,
                        () -> repository.search("vi", List.of("giấy"), 5))));
            }
            for (Future<List<KnowledgeDocument>> search : searches) {
                assertEquals(List.of("cert-vi"), slugs(search.get(30, TimeUnit.SECONDS)));
            }
        } finally {
            scheduler.shutdownNow();
        }

        // Exactly one pooled checkout per boundary: a nested second checkout
        // would have surfaced as extra attempts (pre-fix: 5 — one doomed
        // acquire inside the suspended boundary, then the failure backoff
        // suppressed the rest).
        assertEquals(4, countingDataSource.checkouts());
        verify(jdbc, times(1)).query(contains("knowledge_runtime_state"),
                ArgumentMatchers.<RowMapper<Object>>any());
        verify(jdbc, never()).query(contains("lexical_score"), any(MapSqlParameterSource.class),
                ArgumentMatchers.<RowMapper<KnowledgeDocument>>any());
    }

    private static List<String> slugs(List<KnowledgeDocument> documents) {
        return documents.stream().map(KnowledgeDocument::slug).toList();
    }

    private void seedPublishedCorpus() throws SQLException {
        try (Connection connection = pool.getConnection();
                Statement ddl = connection.createStatement()) {
            ddl.execute("CREATE SCHEMA assistant");
            ddl.execute("CREATE TABLE assistant.knowledge_release ("
                    + "id UUID PRIMARY KEY, corpus_version VARCHAR(120), corpus_hash VARCHAR(64), status VARCHAR(24))");
            ddl.execute("CREATE TABLE assistant.knowledge_runtime_state ("
                    + "singleton BOOLEAN PRIMARY KEY, active_release_id UUID)");
            ddl.execute("CREATE TABLE assistant.knowledge_runtime_document ("
                    + "release_id UUID NOT NULL, source_id VARCHAR(180) NOT NULL, revision_id UUID, "
                    + "version INTEGER NOT NULL DEFAULT 0, domain VARCHAR(48) NOT NULL, "
                    + "slug VARCHAR(180) NOT NULL, locale VARCHAR(8) NOT NULL, "
                    + "title TEXT NOT NULL, content TEXT NOT NULL, source TEXT NOT NULL, "
                    + "priority INTEGER NOT NULL DEFAULT 100, active BOOLEAN NOT NULL DEFAULT TRUE, "
                    + "visibility VARCHAR(32) NOT NULL DEFAULT 'PUBLIC', "
                    + "published_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)");
            ddl.execute("INSERT INTO assistant.knowledge_release (id, corpus_version, corpus_hash, status) "
                    + "VALUES ('" + RELEASE_ID + "', 'pool-fixture', '0123abcd', 'PUBLISHED')");
            ddl.execute("INSERT INTO assistant.knowledge_runtime_state (singleton, active_release_id) "
                    + "VALUES (TRUE, '" + RELEASE_ID + "')");
            ddl.execute("INSERT INTO assistant.knowledge_runtime_document "
                    + "(release_id, source_id, domain, slug, locale, title, content, source, priority) VALUES "
                    + "('" + RELEASE_ID + "', 'cert-vi-source', 'POLICY', 'cert-vi', 'vi', "
                    + "'Xin giấy xác nhận sinh viên', 'Nội dung hướng dẫn xin giấy xác nhận', 'fixture', 5)");
        }
    }

    /** Counts pool checkout requests; each transaction needs exactly one. */
    private static final class CountingDataSource implements DataSource {
        private final DataSource delegate;
        private final AtomicInteger checkouts = new AtomicInteger();

        private CountingDataSource(DataSource delegate) {
            this.delegate = delegate;
        }

        int checkouts() {
            return checkouts.get();
        }

        @Override
        public Connection getConnection() throws SQLException {
            checkouts.incrementAndGet();
            return delegate.getConnection();
        }

        @Override
        public Connection getConnection(String username, String password) throws SQLException {
            checkouts.incrementAndGet();
            return delegate.getConnection(username, password);
        }

        @Override
        public PrintWriter getLogWriter() throws SQLException {
            return delegate.getLogWriter();
        }

        @Override
        public void setLogWriter(PrintWriter out) throws SQLException {
            delegate.setLogWriter(out);
        }

        @Override
        public void setLoginTimeout(int seconds) throws SQLException {
            delegate.setLoginTimeout(seconds);
        }

        @Override
        public int getLoginTimeout() throws SQLException {
            return delegate.getLoginTimeout();
        }

        @Override
        public Logger getParentLogger() throws java.sql.SQLFeatureNotSupportedException {
            return delegate.getParentLogger();
        }

        @Override
        public <T> T unwrap(Class<T> iface) throws SQLException {
            return delegate.unwrap(iface);
        }

        @Override
        public boolean isWrapperFor(Class<?> iface) throws SQLException {
            return delegate.isWrapperFor(iface);
        }
    }
}
