package io.campuscore.restfulapi.thesis.assistant;

import static org.assertj.core.api.Assertions.assertThat;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/** Real-PostgreSQL lock-order regression for the prerequisite map revision writer. */
@EnabledIfEnvironmentVariable(named = "ASSISTANT_RLS_POSTGRES_URL", matches = "jdbc:postgresql:.+")
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.MOCK, properties = {
        "spring.flyway.locations=classpath:db/migration",
        "spring.flyway.schemas=thesis,academic,campuscore_auth",
        "spring.flyway.default-schema=thesis",
        "spring.jpa.hibernate.ddl-auto=none",
        "assistant.rls.test-mode=false",
        "assistant.rag.service-mode=true",
        "assistant.rag.service-token=rls-it-internal-token-9fb407c5",
        "assistant.retention.enabled=false",
        "assistant.supabase.enabled=false",
        "assistant.datasource.maximum-pool-size=1",
        "deepseek.enabled=false",
        "spring.task.scheduling.enabled=false"
})
@ActiveProfiles("persistence")
class PrerequisiteMapSyncDocumentLockPostgresIT {

    private static final String DOCUMENT_SLUG = "catalog-prerequisite-map-vi";

    @Autowired
    private PrerequisiteMapSyncJob job;

    @Autowired
    @Qualifier("namedParameterJdbcTemplate")
    private NamedParameterJdbcTemplate primaryJdbc;

    @DynamicPropertySource
    static void postgresProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", () -> requiredEnv("ASSISTANT_RLS_POSTGRES_URL"));
        registry.add("spring.datasource.username", () -> valueOr("ASSISTANT_RLS_PRIMARY_USER", "postgres"));
        registry.add("spring.datasource.password", () -> valueOr("ASSISTANT_RLS_PRIMARY_PASSWORD", ""));
        registry.add("assistant.datasource.url", () -> requiredEnv("ASSISTANT_RLS_POSTGRES_URL"));
        registry.add("assistant.datasource.username", () -> "campuscore_assistant_runtime");
        registry.add("assistant.datasource.password", () -> requiredEnv("ASSISTANT_RLS_RUNTIME_PASSWORD"));
        registry.add("assistant.datasource.maximum-pool-size", () -> "1");
        registry.add("assistant.rls.test-mode", () -> "false");
        registry.add("security.jwt.secret", () -> requiredEnv("ASSISTANT_RLS_JWT_SECRET"));
        registry.add("security.jwt.refresh-secret", () -> requiredEnv("ASSISTANT_RLS_JWT_REFRESH_SECRET"));
    }

    @Test
    void syncLocksTheDocumentBeforeVersionReadAndKeepsThatLockThroughInsert() throws Exception {
        UUID documentId = primaryJdbc.queryForObject(
                "SELECT id FROM assistant.knowledge_document WHERE slug=:slug AND active",
                new MapSqlParameterSource("slug", DOCUMENT_SLUG), UUID.class);
        assertThat(documentId).isNotNull();
        int beforeVersion = primaryJdbc.queryForObject(
                "SELECT COALESCE(MAX(version),0) FROM assistant.knowledge_document_revision WHERE document_id=:id",
                new MapSqlParameterSource("id", documentId), Integer.class);
        int adminVersion = beforeVersion + 1;
        primaryJdbc.update("UPDATE assistant.knowledge_document SET content='stale map for lock test' WHERE id=:id",
                new MapSqlParameterSource("id", documentId));

        String suffix = UUID.randomUUID().toString().replace("-", "").substring(0, 12);
        String triggerName = "prerequisite_map_insert_gate_" + suffix;
        String functionName = "prerequisite_map_insert_gate_fn_" + suffix;
        long advisoryKey = UUID.randomUUID().getMostSignificantBits();
        Connection barrierConnection = null;
        Connection adminConnection = null;
        ExecutorService pool = Executors.newFixedThreadPool(2);
        Future<?> syncFuture = null;
        Future<Boolean> observerFuture = null;
        boolean triggerCreated = false;
        boolean advisoryHeld = false;
        boolean adminTransactionOpen = false;
        WaitObservation initialWait = null;
        WaitObservation insertWait = null;
        WaitObservation observerWait = null;
        String observerName = "prerequisite-lock-observer-" + suffix;

        try {
            createInsertGate(functionName, triggerName, advisoryKey);
            triggerCreated = true;

            barrierConnection = primaryJdbc.getJdbcTemplate().getDataSource().getConnection();
            advisoryLock(barrierConnection, advisoryKey);
            advisoryHeld = true;

            adminConnection = primaryJdbc.getJdbcTemplate().getDataSource().getConnection();
            adminConnection.setAutoCommit(false);
            adminTransactionOpen = true;
            int adminPid = backendPid(adminConnection);
            try (PreparedStatement statement = adminConnection.prepareStatement(
                    "SELECT id FROM assistant.knowledge_document WHERE id=? FOR UPDATE")) {
                statement.setObject(1, documentId);
                try (ResultSet rows = statement.executeQuery()) {
                    assertThat(rows.next()).isTrue();
                }
            }
            try (PreparedStatement statement = adminConnection.prepareStatement(
                    "INSERT INTO assistant.knowledge_document_revision "
                            + "(id,document_id,version,state,domain,locale,slug,title,content,source,priority,created_by) "
                            + "SELECT ?,id,?,'DRAFT',domain,locale,slug,title,content,source,priority,? "
                            + "FROM assistant.knowledge_document WHERE id=?")) {
                statement.setObject(1, UUID.randomUUID());
                statement.setInt(2, adminVersion);
                statement.setString(3, "lock-order-admin-writer");
                statement.setObject(4, documentId);
                assertThat(statement.executeUpdate()).isEqualTo(1);
            }

            CountDownLatch syncStarted = new CountDownLatch(1);
            syncFuture = pool.submit(() -> {
                syncStarted.countDown();
                job.synchronizeMapDocuments();
            });
            assertThat(syncStarted.await(10, TimeUnit.SECONDS)).isTrue();
            initialWait = awaitAssistantLockWait(syncFuture);

            adminConnection.commit();
            adminTransactionOpen = false;

            int barrierPid = backendPid(barrierConnection);
            insertWait = awaitInsertWait(barrierPid, syncFuture);
            if (insertWait != null) {
                CountDownLatch observerStarted = new CountDownLatch(1);
                observerFuture = pool.submit(() -> acquireDocumentLock(documentId, observerName, observerStarted));
                assertThat(observerStarted.await(10, TimeUnit.SECONDS)).isTrue();
                observerWait = awaitBlockedObserver(observerName, insertWait.pid(), observerFuture);
            }
        } finally {
            if (adminConnection != null && adminTransactionOpen) {
                adminConnection.commit();
                adminTransactionOpen = false;
            }
            if (advisoryHeld && barrierConnection != null) {
                advisoryUnlock(barrierConnection, advisoryKey);
            }
            if (syncFuture != null) {
                syncFuture.get(30, TimeUnit.SECONDS);
            }
            if (observerFuture != null) {
                observerFuture.get(30, TimeUnit.SECONDS);
            }
            pool.shutdown();
            pool.awaitTermination(30, TimeUnit.SECONDS);
            if (adminConnection != null) adminConnection.close();
            if (barrierConnection != null) barrierConnection.close();
            if (triggerCreated) dropInsertGate(functionName, triggerName);
        }

        assertThat(initialWait)
                .as("the scheduled writer waits on the document row before reading MAX(version)")
                .isNotNull();
        assertThat(initialWait.query()).contains("SELECT id FROM assistant.knowledge_document")
                .contains("FOR UPDATE");
        assertThat(insertWait)
                .as("the scheduled writer reaches its revision INSERT after the admin commits")
                .isNotNull();
        assertThat(insertWait.query()).startsWith("INSERT INTO assistant.knowledge_document_revision");
        assertThat(observerWait)
                .as("another transaction is blocked by the same backend while it executes the revision INSERT")
                .isNotNull();
        assertThat(observerWait.blockerPid()).isEqualTo(insertWait.pid());

        Integer afterVersion = primaryJdbc.queryForObject(
                "SELECT MAX(version) FROM assistant.knowledge_document_revision WHERE document_id=:id",
                new MapSqlParameterSource("id", documentId), Integer.class);
        assertThat(afterVersion).isEqualTo(adminVersion + 1);
        Long adminDrafts = primaryJdbc.queryForObject(
                "SELECT COUNT(*) FROM assistant.knowledge_document_revision "
                        + "WHERE document_id=:id AND version=:version AND created_by='lock-order-admin-writer'",
                new MapSqlParameterSource().addValue("id", documentId).addValue("version", adminVersion), Long.class);
        assertThat(adminDrafts).isEqualTo(1L);
    }

    private void createInsertGate(String functionName, String triggerName, long advisoryKey) {
        primaryJdbc.getJdbcTemplate().execute("CREATE FUNCTION assistant." + functionName + "() RETURNS trigger "
                + "LANGUAGE plpgsql AS $gate$ BEGIN "
                + "IF NEW.slug = '" + DOCUMENT_SLUG + "' AND NEW.created_by = 'prerequisite-map-sync' THEN "
                + "PERFORM pg_advisory_xact_lock(" + advisoryKey + "); "
                + "END IF; RETURN NEW; END; $gate$");
        primaryJdbc.getJdbcTemplate().execute("CREATE TRIGGER " + triggerName
                + " BEFORE INSERT ON assistant.knowledge_document_revision FOR EACH ROW EXECUTE FUNCTION assistant."
                + functionName + "()");
    }

    private void dropInsertGate(String functionName, String triggerName) {
        primaryJdbc.getJdbcTemplate().execute("DROP TRIGGER IF EXISTS " + triggerName
                + " ON assistant.knowledge_document_revision");
        primaryJdbc.getJdbcTemplate().execute("DROP FUNCTION IF EXISTS assistant." + functionName + "()");
    }

    private WaitObservation awaitAssistantLockWait(Future<?> syncFuture) throws InterruptedException {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(10);
        while (System.nanoTime() < deadline) {
            List<WaitObservation> rows = primaryJdbc.query(
                    "SELECT waiting.pid, waiting.query, blocking.pid AS blocker_pid "
                            + "FROM pg_stat_activity waiting "
                            + "CROSS JOIN LATERAL unnest(pg_blocking_pids(waiting.pid)) AS blocking(pid) "
                            + "WHERE waiting.usename='campuscore_assistant_runtime' "
                            + "AND waiting.wait_event_type='Lock' AND waiting.state='active' "
                            + "ORDER BY waiting.query_start LIMIT 1",
                    Map.of(), (rs, row) -> new WaitObservation(rs.getInt("pid"), rs.getString("query"),
                            rs.getInt("blocker_pid")));
            if (!rows.isEmpty()) return rows.getFirst();
            if (syncFuture.isDone()) return null;
            Thread.onSpinWait();
        }
        return null;
    }

    private WaitObservation awaitInsertWait(int blockerPid, Future<?> syncFuture) throws InterruptedException {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(10);
        while (System.nanoTime() < deadline) {
            List<WaitObservation> rows = primaryJdbc.query(
                    "SELECT waiting.pid, waiting.query, blocking.pid AS blocker_pid "
                            + "FROM pg_stat_activity waiting "
                            + "CROSS JOIN LATERAL unnest(pg_blocking_pids(waiting.pid)) AS blocking(pid) "
                            + "WHERE waiting.usename='campuscore_assistant_runtime' "
                            + "AND waiting.wait_event_type='Lock' AND waiting.state='active' "
                            + "AND waiting.query ILIKE 'INSERT INTO assistant.knowledge_document_revision%' "
                            + "AND blocking.pid=:blocker ORDER BY waiting.query_start LIMIT 1",
                    new MapSqlParameterSource("blocker", blockerPid),
                    (rs, row) -> new WaitObservation(rs.getInt("pid"), rs.getString("query"),
                            rs.getInt("blocker_pid")));
            if (!rows.isEmpty()) return rows.getFirst();
            if (syncFuture.isDone()) return null;
            Thread.onSpinWait();
        }
        return null;
    }

    private WaitObservation awaitBlockedObserver(String observerName, int jobPid, Future<?> observerFuture)
            throws InterruptedException {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(10);
        while (System.nanoTime() < deadline) {
            List<WaitObservation> rows = primaryJdbc.query(
                    "SELECT waiting.pid, waiting.query, blocking.pid AS blocker_pid "
                            + "FROM pg_stat_activity waiting "
                            + "CROSS JOIN LATERAL unnest(pg_blocking_pids(waiting.pid)) AS blocking(pid) "
                            + "WHERE waiting.application_name=:observer AND waiting.wait_event_type='Lock' "
                            + "AND blocking.pid=:job ORDER BY waiting.query_start LIMIT 1",
                    new MapSqlParameterSource().addValue("observer", observerName).addValue("job", jobPid),
                    (rs, row) -> new WaitObservation(rs.getInt("pid"), rs.getString("query"),
                            rs.getInt("blocker_pid")));
            if (!rows.isEmpty()) return rows.getFirst();
            if (observerFuture.isDone()) return null;
            Thread.onSpinWait();
        }
        return null;
    }

    private boolean acquireDocumentLock(UUID documentId, String applicationName, CountDownLatch started)
            throws SQLException {
        try (Connection connection = primaryJdbc.getJdbcTemplate().getDataSource().getConnection()) {
            connection.setAutoCommit(false);
            try (PreparedStatement app = connection.prepareStatement("SELECT set_config('application_name', ?, true)")) {
                app.setString(1, applicationName);
                app.execute();
            }
            started.countDown();
            try (PreparedStatement statement = connection.prepareStatement(
                    "SELECT id FROM assistant.knowledge_document WHERE id=? FOR UPDATE")) {
                statement.setObject(1, documentId);
                try (ResultSet rows = statement.executeQuery()) {
                    boolean found = rows.next();
                    connection.commit();
                    return found;
                }
            }
        }
    }

    private static void advisoryLock(Connection connection, long key) throws SQLException {
        try (PreparedStatement statement = connection.prepareStatement("SELECT pg_advisory_lock(?)")) {
            statement.setLong(1, key);
            statement.execute();
        }
    }

    private static void advisoryUnlock(Connection connection, long key) throws SQLException {
        try (PreparedStatement statement = connection.prepareStatement("SELECT pg_advisory_unlock(?)")) {
            statement.setLong(1, key);
            statement.execute();
        }
    }

    private static int backendPid(Connection connection) throws SQLException {
        try (Statement statement = connection.createStatement(); ResultSet rows = statement.executeQuery("SELECT pg_backend_pid()")) {
            rows.next();
            return rows.getInt(1);
        }
    }

    private static String requiredEnv(String name) {
        String value = System.getenv(name);
        if (value == null || value.isBlank()) {
            throw new IllegalStateException("Missing required environment variable " + name);
        }
        return value;
    }

    private static String valueOr(String name, String fallback) {
        String value = System.getenv(name);
        return value == null || value.isBlank() ? fallback : value;
    }

    private record WaitObservation(int pid, String query, int blockerPid) { }
}
