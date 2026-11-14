package io.campuscore.restfulapi.thesis.assistant;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.UUID;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;

/** PostgreSQL privilege checks for the constrained Assistant provisioner role. */
@EnabledIfEnvironmentVariable(named = "ASSISTANT_RLS_POSTGRES_URL", matches = "jdbc:postgresql:.+")
class AssistantProvisionerPrivilegePostgresIT {
    private static final String PROVISIONER_ROLE = "campuscore_assistant_provisioner";
    private static final String FUNCTION_OWNER_ROLE = "campuscore_assistant_provisioner_owner";
    private static final String RUNTIME_ROLE = "campuscore_assistant_runtime";

    @BeforeAll
    static void migrateDisposableDatabase() {
        Flyway.configure()
                .dataSource(requiredEnv("ASSISTANT_RLS_POSTGRES_URL"),
                        valueOr("ASSISTANT_RLS_PRIMARY_USER", "campuscore"),
                        valueOr("ASSISTANT_RLS_PRIMARY_PASSWORD", ""))
                .locations("classpath:db/migration")
                .schemas("thesis", "academic", "campuscore_auth")
                .defaultSchema("thesis")
                .load()
                .migrate();
    }

    @Test
    void restrictedLoginHasOnlyThePasswordFunctionAndCannotReachAssistantData() throws Exception {
        boolean mutateCreateRole = "createrole".equals(System.getenv("ASSISTANT_PROVISIONER_TEST_MUTATION"));
        try (Connection owner = primaryConnection()) {
            if (mutateCreateRole) execute(owner, "ALTER ROLE " + PROVISIONER_ROLE + " CREATEROLE");
            try {
                assertRoleContracts(owner, mutateCreateRole);
                assertDatabaseAndSchemaGrants(owner);
                assertPublicCannotExecute(owner);

                String unrelatedRole = "assistant_provisioner_it_" + UUID.randomUUID().toString().replace("-", "");
                String createdRole = unrelatedRole + "_new";
                String permanentTable = "assistant_provisioner_it_permanent_"
                        + UUID.randomUUID().toString().replace("-", "");
                execute(owner, "CREATE ROLE " + quoteIdentifier(unrelatedRole) + " NOLOGIN");
                try (Connection provisioner = provisionerConnection()) {
                    SQLException permanentCreateFailure = assertThrows(SQLException.class,
                            () -> execute(provisioner, "CREATE TABLE assistant_ops."
                                    + quoteIdentifier(permanentTable) + " (id integer)"));
                    assertEquals("42501", permanentCreateFailure.getSQLState(),
                            "the provisioner must fail permanent table creation for lack of schema CREATE");
                    execute(provisioner, "CREATE TEMPORARY TABLE provisioner_session_temp (id integer)");
                    assertThrows(SQLException.class,
                            () -> execute(provisioner, "CREATE ROLE " + quoteIdentifier(createdRole) + " NOLOGIN"));
                    assertThrows(SQLException.class,
                            () -> execute(provisioner, "ALTER ROLE " + quoteIdentifier(unrelatedRole) + " LOGIN"));
                    assertThrows(SQLException.class,
                            () -> execute(provisioner, "SET ROLE " + RUNTIME_ROLE));
                    assertThrows(SQLException.class,
                            () -> queryLong(provisioner, "SELECT count(*) FROM assistant.chat_conversation"));

                    String hostilePassword = "it-" + UUID.randomUUID()
                            + "'; ALTER ROLE campuscore_assistant_runtime SUPERUSER; --";
                    try {
                        setRuntimePassword(provisioner, hostilePassword);
                        setRuntimePassword(provisioner, hostilePassword);
                        try (Connection runtime = DriverManager.getConnection(
                                requiredEnv("ASSISTANT_RLS_POSTGRES_URL"), RUNTIME_ROLE, hostilePassword)) {
                            assertEquals(RUNTIME_ROLE, queryString(runtime, "SELECT current_user"));
                        }
                    } finally {
                        // The probe rotated the shared runtime credential; restore it
                        // so sibling ITs in the same failsafe run can still authenticate.
                        restoreRuntimePassword();
                    }
                } finally {
                    execute(owner, "DROP TABLE IF EXISTS assistant_ops." + quoteIdentifier(permanentTable));
                    execute(owner, "DROP ROLE IF EXISTS " + quoteIdentifier(createdRole));
                    execute(owner, "DROP ROLE IF EXISTS " + quoteIdentifier(unrelatedRole));
                }
            } finally {
                if (mutateCreateRole) execute(owner, "ALTER ROLE " + PROVISIONER_ROLE + " NOCREATEROLE");
            }
        }
    }

    private static void assertRoleContracts(Connection owner, boolean mutation) throws SQLException {
        try (Statement statement = owner.createStatement();
                ResultSet roles = statement.executeQuery("""
                        SELECT p.rolcanlogin, p.rolsuper, p.rolcreatedb, p.rolcreaterole,
                               p.rolinherit, p.rolreplication, p.rolbypassrls,
                               (SELECT count(*) FROM pg_catalog.pg_auth_members m
                                 WHERE m.member=p.oid OR m.roleid=p.oid) memberships
                          FROM pg_catalog.pg_roles p
                         WHERE p.rolname='campuscore_assistant_provisioner'
                        """)) {
            assertTrue(roles.next(), "the restricted provisioner role must exist");
            assertTrue(roles.getBoolean("rolcanlogin"));
            assertFalse(roles.getBoolean("rolsuper"));
            assertFalse(roles.getBoolean("rolcreatedb"));
            assertFalse(roles.getBoolean("rolcreaterole"), mutation
                    ? "the CREATEROLE mutation must be detected" : "the provisioner must not manage roles");
            assertFalse(roles.getBoolean("rolinherit"));
            assertFalse(roles.getBoolean("rolreplication"));
            assertFalse(roles.getBoolean("rolbypassrls"));
            assertEquals(0L, roles.getLong("memberships"));
            assertFalse(roles.next());
        }
        try (Statement statement = owner.createStatement();
                ResultSet roles = statement.executeQuery("""
                        SELECT p.rolcanlogin, p.rolcreaterole,
                               (SELECT count(*) FROM pg_catalog.pg_auth_members m
                                 WHERE m.member=p.oid OR m.roleid=p.oid) memberships
                          FROM pg_catalog.pg_roles p
                         WHERE p.rolname='campuscore_assistant_provisioner_owner'
                        """)) {
            assertTrue(roles.next(), "the isolated function owner must exist");
            assertFalse(roles.getBoolean("rolcanlogin"));
            assertTrue(roles.getBoolean("rolcreaterole"));
            assertEquals(0L, roles.getLong("memberships"));
        }
        try (Statement statement = owner.createStatement();
                ResultSet roles = statement.executeQuery("""
                        SELECT count(*) FROM pg_catalog.pg_auth_members m
                          JOIN pg_catalog.pg_roles runtime ON runtime.oid=m.member OR runtime.oid=m.roleid
                          JOIN pg_catalog.pg_roles provisioner ON provisioner.rolname='campuscore_assistant_provisioner'
                         WHERE runtime.rolname='campuscore_assistant_runtime'
                           AND (m.member=provisioner.oid OR m.roleid=provisioner.oid)
                        """)) {
            assertTrue(roles.next());
            assertEquals(0L, roles.getLong(1), "the provisioner must not be a runtime-role member");
        }
    }

    private static void assertDatabaseAndSchemaGrants(Connection owner) throws SQLException {
        try (PreparedStatement statement = owner.prepareStatement("""
                SELECT has_database_privilege(?, current_database(), 'CONNECT'),
                       has_database_privilege(?, current_database(), 'TEMPORARY'),
                       has_database_privilege(?, current_database(), 'CREATE'),
                       has_schema_privilege(?, 'assistant_ops', 'USAGE'),
                       has_schema_privilege(?, 'assistant_ops', 'CREATE'),
                       has_function_privilege(?, 'assistant_ops.set_runtime_password(text)', 'EXECUTE')
                """)) {
            for (int index = 1; index <= 6; index += 1) statement.setString(index, PROVISIONER_ROLE);
            try (ResultSet result = statement.executeQuery()) {
                assertTrue(result.next());
                assertTrue(result.getBoolean(1));
                assertTrue(result.getBoolean(2));
                assertFalse(result.getBoolean(3));
                assertTrue(result.getBoolean(4));
                assertFalse(result.getBoolean(5));
                assertTrue(result.getBoolean(6));
            }
        }
        assertDatabaseAclSources(owner);
        assertNoSchemaCreate(owner);
    }

    private static void assertDatabaseAclSources(Connection owner) throws SQLException {
        String query = """
                SELECT count(*) FILTER (
                           WHERE acl.grantee=0 AND acl.privilege_type='CONNECT') public_connect,
                       count(*) FILTER (
                           WHERE acl.grantee=0 AND acl.privilege_type='TEMPORARY') public_temporary,
                       count(*) FILTER (
                           WHERE acl.grantee=provisioner.oid
                             AND acl.privilege_type='CONNECT' AND NOT acl.is_grantable) direct_connect,
                       count(*) FILTER (
                           WHERE acl.grantee=provisioner.oid
                             AND (acl.privilege_type <> 'CONNECT' OR acl.is_grantable)) extra_direct
                  FROM pg_catalog.pg_database db
                  JOIN pg_catalog.pg_roles provisioner
                    ON provisioner.rolname=?
                  CROSS JOIN LATERAL pg_catalog.aclexplode(
                      COALESCE(db.datacl, pg_catalog.acldefault('d', db.datdba))) acl
                 WHERE db.datname=current_database()
                 GROUP BY provisioner.oid
                """;
        try (PreparedStatement statement = owner.prepareStatement(query)) {
            statement.setString(1, PROVISIONER_ROLE);
            try (ResultSet result = statement.executeQuery()) {
                assertTrue(result.next());
                assertTrue(result.getLong("public_connect") > 0L,
                        "PUBLIC must retain its database CONNECT default");
                assertTrue(result.getLong("public_temporary") > 0L,
                        "PUBLIC must retain its database TEMPORARY default");
                assertTrue(result.getLong("direct_connect") > 0L,
                        "the provisioner must have its explicit CONNECT grant");
                assertEquals(0L, result.getLong("extra_direct"),
                        "the provisioner must have no direct database grant beyond CONNECT");
                assertFalse(result.next());
            }
        }
    }

    private static void assertNoSchemaCreate(Connection owner) throws SQLException {
        try (PreparedStatement statement = owner.prepareStatement("""
                SELECT count(*)
                  FROM pg_catalog.pg_namespace n
                 WHERE pg_catalog.has_schema_privilege(?, n.oid, 'CREATE')
                """)) {
            statement.setString(1, PROVISIONER_ROLE);
            try (ResultSet result = statement.executeQuery()) {
                assertTrue(result.next());
                assertEquals(0L, result.getLong(1),
                        "the provisioner must not have CREATE on any schema");
            }
        }
    }

    private static void assertPublicCannotExecute(Connection owner) throws SQLException {
        String query = """
                SELECT EXISTS (
                    SELECT 1
                      FROM pg_catalog.pg_proc p
                      JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
                      CROSS JOIN LATERAL pg_catalog.aclexplode(
                          COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))) acl
                     WHERE n.nspname='assistant_ops'
                       AND p.proname='set_runtime_password'
                       AND acl.grantee=0
                       AND acl.privilege_type='EXECUTE'
                )
                """;
        assertFalse(queryBoolean(owner, query), "PUBLIC must not have EXECUTE on the password function");
    }

    private static void restoreRuntimePassword() throws SQLException {
        try (Connection provisioner = provisionerConnection()) {
            setRuntimePassword(provisioner, requiredEnv("ASSISTANT_RLS_RUNTIME_PASSWORD"));
        }
    }

    private static void setRuntimePassword(Connection provisioner, String password) throws SQLException {
        try (PreparedStatement statement = provisioner.prepareStatement(
                "SELECT assistant_ops.set_runtime_password(?)")) {
            statement.setString(1, password);
            try (ResultSet result = statement.executeQuery()) {
                assertTrue(result.next());
            }
        }
    }

    private static Connection primaryConnection() throws SQLException {
        return DriverManager.getConnection(requiredEnv("ASSISTANT_RLS_POSTGRES_URL"),
                valueOr("ASSISTANT_RLS_PRIMARY_USER", "campuscore"),
                valueOr("ASSISTANT_RLS_PRIMARY_PASSWORD", ""));
    }

    private static Connection provisionerConnection() throws SQLException {
        return DriverManager.getConnection(requiredEnv("ASSISTANT_RLS_POSTGRES_URL"),
                PROVISIONER_ROLE, requiredEnv("ASSISTANT_DB_PROVISIONER_PASSWORD"));
    }

    private static String queryString(Connection connection, String sql) throws SQLException {
        try (Statement statement = connection.createStatement(); ResultSet result = statement.executeQuery(sql)) {
            assertTrue(result.next());
            return result.getString(1);
        }
    }

    private static long queryLong(Connection connection, String sql) throws SQLException {
        try (Statement statement = connection.createStatement(); ResultSet result = statement.executeQuery(sql)) {
            assertTrue(result.next());
            return result.getLong(1);
        }
    }

    private static boolean queryBoolean(Connection connection, String sql) throws SQLException {
        try (Statement statement = connection.createStatement(); ResultSet result = statement.executeQuery(sql)) {
            assertTrue(result.next());
            return result.getBoolean(1);
        }
    }

    private static void execute(Connection connection, String sql) throws SQLException {
        try (Statement statement = connection.createStatement()) {
            statement.execute(sql);
        }
    }

    private static String quoteIdentifier(String identifier) {
        return "\"" + identifier.replace("\"", "\"\"") + "\"";
    }

    private static String requiredEnv(String name) {
        String value = System.getenv(name);
        if (value == null || value.isBlank()) throw new IllegalStateException(name + " is required for this PostgreSQL IT");
        return value;
    }

    private static String valueOr(String name, String fallback) {
        String value = System.getenv(name);
        return value == null || value.isBlank() ? fallback : value;
    }
}
