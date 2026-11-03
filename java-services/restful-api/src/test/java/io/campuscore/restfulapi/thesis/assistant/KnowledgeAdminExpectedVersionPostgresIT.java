package io.campuscore.restfulapi.thesis.assistant;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.URI;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.sql.Types;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicIntegerArray;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;
import org.flywaydb.core.Flyway;
import org.flywaydb.core.api.MigrationVersion;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;

/**
 * Applies the reduced knowledge migration chain before exercising the public knowledge admin RPC.
 * This proves the redefined function logic, grants, and concurrency on real PostgreSQL; it does NOT
 * prove the full hosted Supabase migration chain.
 */
@EnabledIfEnvironmentVariable(named = "CAMPUSCORE_POLICY_MIGRATION_ENABLED", matches = "true")
class KnowledgeAdminExpectedVersionPostgresIT {
    private static final String DATABASE = "policy_migration_test_knowledge_version_current_supabase";
    private static final String ACTOR = "knowledge-version-postgres-it";
    private static final String WRAPPER_MIGRATION = "20260923181500_archive_knowledge_release.sql";
    private static final String TARGET_MIGRATION = "20261104000000_knowledge_admin_expected_version.sql";
    // The policy-only migrations are omitted: this proof needs the knowledge schema and RPC
    // definitions, while the later runtime-policy chain cannot be replayed on the Java V83 baseline.
    private static final List<String> KNOWLEDGE_MIGRATION_CHAIN = List.of(
            "20260823073842_assistant_knowledge_authoring.sql",
            "20260901090000_assistant_release_authority.sql",
            "20260923180000_specialized_knowledge_domain.sql",
            WRAPPER_MIGRATION,
            TARGET_MIGRATION);
    private static final Pattern MIGRATION_NAME = Pattern.compile("^(\\d{14})_(.+)\\.sql$");

    @Test
    void serviceRoleUpdatesDraftsWithExpectedVersionsAndRejectsConcurrentStaleWrites() throws Exception {
        Fixture fixture = fixture();
        prepareSupabaseRoles(fixture);
        Path repository = repositoryRoot();
        Path inputDirectory = Files.createTempDirectory(
                repository.resolve("artifacts").resolve("verification"), "knowledge-version-migrations-");
        try {
            Flyway.configure()
                    .dataSource(fixture.url(), fixture.user(), fixture.password())
                    .locations("classpath:db/migration")
                    .createSchemas(true)
                    .schemas("thesis")
                    .defaultSchema("thesis")
                    .target(MigrationVersion.fromVersion("83"))
                    .cleanDisabled(true)
                    .load()
                    .migrate();
            assertThat(scalar(fixture, """
                    SELECT version FROM thesis.flyway_schema_history
                     WHERE success ORDER BY installed_rank DESC LIMIT 1
                    """)).isEqualTo("83");
            normalizeLegacySupabaseFixture(fixture);

            Path migrations = repository.resolve("supabase").resolve("migrations");
            assertThat(KNOWLEDGE_MIGRATION_CHAIN).isSorted();
            assertThat(KNOWLEDGE_MIGRATION_CHAIN.getLast()).isEqualTo(TARGET_MIGRATION);
            List<Path> supabaseMigrations = KNOWLEDGE_MIGRATION_CHAIN.stream().map(migrations::resolve).toList();
            assertThat(supabaseMigrations).allMatch(Files::isRegularFile);
            int wrapperIndex = KNOWLEDGE_MIGRATION_CHAIN.indexOf(WRAPPER_MIGRATION);
            assertThat(wrapperIndex).isGreaterThanOrEqualTo(0);

            for (Path migration : supabaseMigrations.subList(0, wrapperIndex + 1)) stageMigration(migration, inputDirectory);
            flyway(fixture, inputDirectory).migrate();
            assertThat(historyVersion(fixture)).isEqualTo("20260923181500");
            assertThat(migrationCount(fixture)).isEqualTo(wrapperIndex + 1);

            Map<String, FunctionPrivileges> wrapperPrivileges = functionPrivileges(fixture);
            assertExpectedFunctionPrivileges(wrapperPrivileges);

            Path target = migrationOverride(supabaseMigrations.getLast());
            assertThat(target.getFileName().toString()).isEqualTo(TARGET_MIGRATION);
            stageMigration(target, inputDirectory);
            flyway(fixture, inputDirectory).migrate();
            assertThat(historyVersion(fixture)).isEqualTo(version(supabaseMigrations.getLast()));
            assertThat(migrationCount(fixture)).isEqualTo(supabaseMigrations.size());
            assertThat(KNOWLEDGE_MIGRATION_CHAIN.getLast()).isEqualTo(TARGET_MIGRATION);
            Map<String, FunctionPrivileges> privilegesAfter = functionPrivileges(fixture);
            assertThat(privilegesAfter).isEqualTo(wrapperPrivileges);
            assertExpectedFunctionPrivileges(privilegesAfter);

            assertVersionUpdates(fixture);
            assertConcurrentUpdates(fixture);
        } finally {
            deleteTree(inputDirectory);
        }
    }

    private static void normalizeLegacySupabaseFixture(Fixture fixture) throws SQLException {
        try (Connection connection = fixture.connect(); Statement statement = connection.createStatement()) {
            // Java V83 creates the audit table without the UUID default used by Supabase authoring.
            statement.execute("ALTER TABLE assistant.knowledge_document_audit ALTER COLUMN id SET DEFAULT gen_random_uuid()");
            statement.executeUpdate("UPDATE assistant.knowledge_document SET domain='THESIS' WHERE domain='SPECIALIZED'");
            statement.executeUpdate("UPDATE assistant.knowledge_document_revision SET domain='THESIS' WHERE domain='SPECIALIZED'");
            statement.executeUpdate("""
                    UPDATE assistant.knowledge_release release
                       SET status='ARCHIVED'
                     WHERE release.status='PUBLISHED'
                       AND release.id IS DISTINCT FROM (
                           SELECT active_release_id FROM assistant.knowledge_runtime_state WHERE singleton=TRUE
                       )
                    """);
        }
    }

    private static void assertVersionUpdates(Fixture fixture) throws Exception {
        RpcResult created = serviceCall(fixture, "CREATE", null, payload("versioned-draft", "Version one", "Initial content", null));
        assertThat(created.version()).isEqualTo(1);
        assertThat(created.state()).isEqualTo("DRAFT");
        assertThat(draftVersion(fixture, created.documentId())).isEqualTo(1);

        RpcResult matching = serviceCall(fixture, "UPDATE", created.documentId(),
                payload("versioned-draft", "Version two", "Updated with the matching version", 1));
        assertThat(matching.version()).isEqualTo(2);
        assertThat(draftVersion(fixture, created.documentId())).isEqualTo(2);

        String beforeStaleUpdate = draftRow(fixture, created.documentId());
        SQLException staleFailure = null;
        try {
            serviceCall(fixture, "UPDATE", created.documentId(),
                    payload("versioned-draft", "Stale title", "This update must not persist", 1));
        } catch (SQLException error) {
            staleFailure = error;
        }
        assertThat((Object) staleFailure).as("stale expectedVersion must reject the update").isNotNull();
        assertThat(staleFailure.getSQLState()).isEqualTo("P0001");
        assertThat(staleFailure.getMessage()).contains("stale_version");
        assertThat(draftRow(fixture, created.documentId())).isEqualTo(beforeStaleUpdate);

        RpcResult compatible = serviceCall(fixture, "UPDATE", created.documentId(),
                payload("versioned-draft", "Version three", "Update without expectedVersion", null));
        assertThat(compatible.version()).isEqualTo(3);
        assertThat(draftVersion(fixture, created.documentId())).isEqualTo(3);
    }

    private static void assertConcurrentUpdates(Fixture fixture) throws Exception {
        RpcResult created = serviceCall(fixture, "CREATE", null, payload("concurrent-draft", "Original", "Concurrent baseline", null));
        assertThat(created.version()).isEqualTo(1);

        CountDownLatch ready = new CountDownLatch(2);
        CountDownLatch start = new CountDownLatch(1);
        AtomicIntegerArray backendPids = new AtomicIntegerArray(2);
        ExecutorService executor = Executors.newFixedThreadPool(2);
        Future<RpcOutcome> first = null;
        Future<RpcOutcome> second = null;
        List<RpcOutcome> outcomes;
        try (Connection blocker = fixture.connect()) {
            blocker.setAutoCommit(false);
            int blockerPid = scalarInt(blocker, "SELECT pg_backend_pid()");
            lockDocument(blocker, created.documentId());
            first = executor.submit(() -> concurrentUpdate(fixture, created.documentId(), 0, backendPids, ready, start,
                    payload("concurrent-draft", "Concurrent writer one", "First concurrent update", 1)));
            second = executor.submit(() -> concurrentUpdate(fixture, created.documentId(), 1, backendPids, ready, start,
                    payload("concurrent-draft", "Concurrent writer two", "Second concurrent update", 1)));

            try {
                boolean workersReady = ready.await(10, TimeUnit.SECONDS);
                start.countDown();
                assertThat(workersReady).as("both service-role connections are ready before release").isTrue();
                assertThat(backendPids.get(0)).isNotEqualTo(backendPids.get(1));
                boolean bothBlocked = awaitBothBlocked(fixture, backendPids, 10, TimeUnit.SECONDS);
                assertThat(bothBlocked)
                        .as("both update backends wait on a PostgreSQL lock before the draft lock is released; %s",
                                backendStates(fixture, backendPids, blockerPid))
                        .isTrue();
            } finally {
                blocker.commit();
            }

            outcomes = List.of(first.get(20, TimeUnit.SECONDS), second.get(20, TimeUnit.SECONDS));
        } finally {
            start.countDown();
            executor.shutdownNow();
            assertThat(executor.awaitTermination(10, TimeUnit.SECONDS)).isTrue();
        }

        List<RpcOutcome> successes = outcomes.stream().filter(outcome -> outcome.response() != null).toList();
        List<RpcOutcome> stale = outcomes.stream().filter(outcome -> outcome.error() != null).toList();
        assertThat(successes).hasSize(1);
        assertThat(stale).hasSize(1);
        assertThat(successes.getFirst().response().version()).isEqualTo(2);
        assertThat(stale.getFirst().error().getSQLState()).isEqualTo("P0001");
        assertThat(stale.getFirst().error().getMessage()).contains("stale_version");
        assertThat(draftVersion(fixture, created.documentId())).isEqualTo(2);
        assertThat(draftTitle(fixture, created.documentId())).isIn("Concurrent writer one", "Concurrent writer two");
    }

    private static RpcOutcome concurrentUpdate(
            Fixture fixture,
            java.util.UUID documentId,
            int index,
            AtomicIntegerArray backendPids,
            CountDownLatch ready,
            CountDownLatch start,
            String updatePayload) throws Exception {
        try (Connection connection = fixture.connect()) {
            execute(connection, "SET ROLE service_role");
            backendPids.set(index, scalarInt(connection, "SELECT pg_backend_pid()"));
            ready.countDown();
            if (!start.await(10, TimeUnit.SECONDS)) throw new IllegalStateException("concurrent update start latch timed out");
            try {
                return new RpcOutcome(adminCall(connection, "UPDATE", documentId, updatePayload), null);
            } catch (SQLException error) {
                return new RpcOutcome(null, error);
            }
        }
    }

    private static boolean awaitBothBlocked(
            Fixture fixture,
            AtomicIntegerArray backendPids,
            long timeout,
            TimeUnit unit) throws SQLException {
        long deadline = System.nanoTime() + unit.toNanos(timeout);
        try (Connection observer = fixture.connect();
             PreparedStatement statement = observer.prepareStatement("""
                     SELECT COUNT(*) FROM pg_stat_activity activity
                      WHERE (activity.pid=? OR activity.pid=?)
                        AND activity.wait_event_type='Lock'
                     """)) {
            while (System.nanoTime() < deadline) {
                statement.setInt(1, backendPids.get(0));
                statement.setInt(2, backendPids.get(1));
                try (ResultSet rows = statement.executeQuery()) {
                    if (rows.next() && rows.getInt(1) == 2) return true;
                }
                Thread.yield();
            }
        }
        return false;
    }

    private static String backendStates(Fixture fixture, AtomicIntegerArray backendPids, int blockerPid) throws SQLException {
        StringBuilder states = new StringBuilder();
        try (Connection observer = fixture.connect();
             PreparedStatement statement = observer.prepareStatement("""
                     SELECT pid, state, wait_event_type, wait_event, pg_blocking_pids(pid)::text
                       FROM pg_stat_activity
                      WHERE pid=? OR pid=?
                      ORDER BY pid
                     """)) {
            statement.setInt(1, backendPids.get(0));
            statement.setInt(2, backendPids.get(1));
            try (ResultSet rows = statement.executeQuery()) {
                while (rows.next()) {
                    if (!states.isEmpty()) states.append(';');
                    states.append(rows.getInt(1)).append(':').append(rows.getString(2)).append(':')
                            .append(rows.getString(3)).append(':').append(rows.getString(4)).append(':')
                            .append(rows.getString(5)).append(":holder=").append(blockerPid);
                }
            }
        }
        return states.isEmpty() ? "no worker backends found" : states.toString();
    }

    private static void lockDocument(Connection connection, java.util.UUID documentId) throws SQLException {
        try (PreparedStatement statement = connection.prepareStatement(
                "SELECT id FROM assistant.knowledge_document WHERE id=? FOR UPDATE")) {
            statement.setObject(1, documentId);
            try (ResultSet rows = statement.executeQuery()) {
                assertThat(rows.next()).isTrue();
            }
        }
    }

    private static RpcResult serviceCall(Fixture fixture, String action, java.util.UUID documentId, String payload) throws SQLException {
        try (Connection connection = fixture.connect()) {
            execute(connection, "SET ROLE service_role");
            return adminCall(connection, action, documentId, payload);
        }
    }

    private static RpcResult adminCall(Connection connection, String action, java.util.UUID documentId, String payload) throws SQLException {
        try (PreparedStatement statement = connection.prepareStatement("""
                SELECT result ->> 'documentId', (result ->> 'version')::integer, result ->> 'state'
                  FROM (SELECT assistant.knowledge_admin(?, ?::uuid, ?::jsonb, ?) AS result) call
                """)) {
            statement.setString(1, action);
            if (documentId == null) statement.setNull(2, Types.VARCHAR);
            else statement.setString(2, documentId.toString());
            statement.setString(3, payload);
            statement.setString(4, ACTOR);
            try (ResultSet rows = statement.executeQuery()) {
                if (!rows.next()) throw new SQLException("knowledge_admin returned no result");
                return new RpcResult(java.util.UUID.fromString(rows.getString(1)), rows.getInt(2), rows.getString(3));
            }
        }
    }

    private static String payload(String slug, String title, String content, Integer expectedVersion) {
        return "{\"domain\":\"SPECIALIZED\",\"locale\":\"en\",\"slug\":\"" + slug
                + "\",\"title\":\"" + title + "\",\"content\":\"" + content
                + "\",\"source\":\"knowledge-version-postgres-it\",\"priority\":50"
                + (expectedVersion == null ? "" : ",\"expectedVersion\":" + expectedVersion) + "}";
    }

    private static int draftVersion(Fixture fixture, java.util.UUID documentId) throws SQLException {
        return Integer.parseInt(scalar(fixture, """
                SELECT version::text FROM assistant.knowledge_document_revision
                 WHERE document_id=? AND state='DRAFT' AND created_by=? ORDER BY version DESC LIMIT 1
                """, documentId, ACTOR));
    }

    private static String draftRow(Fixture fixture, java.util.UUID documentId) throws SQLException {
        return scalar(fixture, """
                SELECT to_jsonb(revision)::text FROM assistant.knowledge_document_revision revision
                 WHERE document_id=? AND state='DRAFT' AND created_by=? ORDER BY version DESC LIMIT 1
                """, documentId, ACTOR);
    }

    private static String draftTitle(Fixture fixture, java.util.UUID documentId) throws SQLException {
        return scalar(fixture, """
                SELECT title FROM assistant.knowledge_document_revision
                 WHERE document_id=? AND state='DRAFT' AND created_by=? ORDER BY version DESC LIMIT 1
                """, documentId, ACTOR);
    }

    private static Map<String, FunctionPrivileges> functionPrivileges(Fixture fixture) throws SQLException {
        Map<String, FunctionPrivileges> result = new LinkedHashMap<>();
        String sql = """
                SELECT p.proname,
                       has_function_privilege('anon', p.oid, 'EXECUTE'),
                       has_function_privilege('authenticated', p.oid, 'EXECUTE'),
                       has_function_privilege('service_role', p.oid, 'EXECUTE'),
                       EXISTS (
                           SELECT 1
                             FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) privilege
                            WHERE privilege.grantee=0 AND privilege.privilege_type='EXECUTE'
                       ) AS public_execute
                  FROM pg_proc p
                 WHERE p.oid IN (
                     to_regprocedure('assistant.knowledge_admin(text,uuid,jsonb,text)'),
                     to_regprocedure('assistant.knowledge_admin_unlocked(text,uuid,jsonb,text)')
                 )
                 ORDER BY p.proname
                """;
        try (Connection connection = fixture.connect(); Statement statement = connection.createStatement();
             ResultSet rows = statement.executeQuery(sql)) {
            while (rows.next()) {
                result.put(rows.getString(1), new FunctionPrivileges(
                        rows.getBoolean(2), rows.getBoolean(3), rows.getBoolean(4), rows.getBoolean(5)));
            }
        }
        assertThat(result.keySet()).containsExactlyInAnyOrder("knowledge_admin", "knowledge_admin_unlocked");
        return result;
    }

    private static void assertExpectedFunctionPrivileges(Map<String, FunctionPrivileges> privileges) {
        assertThat(privileges.get("knowledge_admin")).isEqualTo(new FunctionPrivileges(false, false, true, false));
        assertThat(privileges.get("knowledge_admin_unlocked")).isEqualTo(new FunctionPrivileges(false, false, false, false));
    }

    private static void prepareSupabaseRoles(Fixture fixture) throws SQLException {
        try (Connection connection = fixture.connect()) {
            execute(connection, """
                    DO $$
                    DECLARE role_name text;
                    BEGIN
                        FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
                            IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
                                EXECUTE format('CREATE ROLE %I NOLOGIN', role_name);
                            END IF;
                        END LOOP;
                    END
                    $$
                    """);
            execute(connection, "CREATE SCHEMA IF NOT EXISTS auth");
            execute(connection, """
                    CREATE OR REPLACE FUNCTION auth.jwt()
                    RETURNS jsonb LANGUAGE sql STABLE
                    AS $$ SELECT '{}'::jsonb $$
                    """);
        }
    }

    private static Path migrationOverride(Path original) throws Exception {
        String override = System.getenv("CAMPUSCORE_KNOWLEDGE_VERSION_MIGRATION_OVERRIDE");
        if (override == null || override.isBlank()) return original;
        Path root = repositoryRoot();
        Path candidate = Path.of(override).toRealPath();
        assertThat(candidate).startsWith(root);
        return candidate;
    }

    private static void stageMigration(Path source, Path inputDirectory) throws Exception {
        Matcher name = MIGRATION_NAME.matcher(source.getFileName().toString());
        if (!name.matches()) throw new IllegalArgumentException("Unsupported SQL migration name: " + source.getFileName());
        Path target = inputDirectory.resolve("V" + name.group(1) + "__" + name.group(2) + ".sql");
        Files.copy(source, target, StandardCopyOption.REPLACE_EXISTING);
    }

    private static String version(Path migration) {
        Matcher name = MIGRATION_NAME.matcher(migration.getFileName().toString());
        if (!name.matches()) throw new IllegalArgumentException("Unsupported SQL migration name: " + migration.getFileName());
        return name.group(1);
    }

    private static Flyway flyway(Fixture fixture, Path inputDirectory) {
        return Flyway.configure()
                .dataSource(fixture.url(), fixture.user(), fixture.password())
                .locations("filesystem:" + inputDirectory.toAbsolutePath().toString().replace('\\', '/'))
                .createSchemas(true)
                .schemas("knowledge_migration_history")
                .defaultSchema("knowledge_migration_history")
                .cleanDisabled(true)
                .load();
    }

    private static String historyVersion(Fixture fixture) throws SQLException {
        return scalar(fixture, """
                SELECT version FROM knowledge_migration_history.flyway_schema_history
                 WHERE success ORDER BY installed_rank DESC LIMIT 1
                """);
    }

    private static int migrationCount(Fixture fixture) throws SQLException {
        return Integer.parseInt(scalar(fixture, """
                SELECT COUNT(*)::text FROM knowledge_migration_history.flyway_schema_history
                 WHERE success AND version IS NOT NULL
                """));
    }

    private static void deleteTree(Path directory) throws Exception {
        try (Stream<Path> paths = Files.walk(directory)) {
            for (Path path : paths.sorted(Comparator.reverseOrder()).toList()) Files.deleteIfExists(path);
        }
    }

    private static int scalarInt(Connection connection, String sql) throws SQLException {
        try (Statement statement = connection.createStatement(); ResultSet rows = statement.executeQuery(sql)) {
            if (!rows.next()) throw new SQLException("Expected one row for: " + sql);
            return rows.getInt(1);
        }
    }

    private static String scalar(Fixture fixture, String sql, Object... parameters) throws SQLException {
        try (Connection connection = fixture.connect(); PreparedStatement statement = connection.prepareStatement(sql)) {
            for (int index = 0; index < parameters.length; index++) statement.setObject(index + 1, parameters[index]);
            try (ResultSet rows = statement.executeQuery()) { return rows.next() ? rows.getString(1) : null; }
        }
    }

    private static void execute(Connection connection, String sql) throws SQLException {
        try (Statement statement = connection.createStatement()) { statement.execute(sql); }
    }

    private static Fixture fixture() throws Exception {
        String url = required("CAMPUSCORE_KNOWLEDGE_VERSION_CURRENT_SUPABASE_URL");
        URI target = URI.create(url.replaceFirst("^jdbc:", ""));
        assertThat(target.getScheme()).isEqualTo("postgresql");
        assertThat(target.getHost()).isIn("localhost", "127.0.0.1", "::1");
        assertThat(target.getUserInfo()).isNull();
        assertThat(target.getPath()).isEqualTo("/" + DATABASE);
        Fixture fixture = new Fixture(url, required("CAMPUSCORE_KNOWLEDGE_VERSION_USER"), required("CAMPUSCORE_KNOWLEDGE_VERSION_PASSWORD"));
        try (Connection connection = fixture.connect()) {
            assertThat(scalarInt(connection, "SELECT COUNT(*) FROM pg_database WHERE datname=current_database()")).isEqualTo(1);
            assertThat(scalar(fixture, "SELECT to_regclass('knowledge_migration_history.flyway_schema_history')::text")).isNull();
        }
        return fixture;
    }

    private static String required(String name) {
        String value = System.getenv(name);
        if (value == null || value.isBlank()) throw new IllegalStateException("Required disposable test setting: " + name);
        return value;
    }

    private static Path repositoryRoot() {
        Path current = Path.of("").toAbsolutePath().normalize();
        while (current != null) {
            if (Files.isDirectory(current.resolve("supabase").resolve("migrations"))) return current;
            current = current.getParent();
        }
        throw new IllegalStateException("Could not locate the repository Supabase migrations directory");
    }

    private record Fixture(String url, String user, String password) {
        Connection connect() throws SQLException { return DriverManager.getConnection(url, user, password); }
    }

    private record RpcResult(java.util.UUID documentId, int version, String state) {}
    private record RpcOutcome(RpcResult response, SQLException error) {}
    private record FunctionPrivileges(boolean anon, boolean authenticated, boolean serviceRole, boolean publicRole) {}
}
