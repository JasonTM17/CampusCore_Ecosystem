package io.campuscore.restfulapi.academic;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.SQLException;
import org.flywaydb.core.Flyway;

final class SeedPostgresITSupport {
    private SeedPostgresITSupport() { }

    static Connection connect() throws SQLException {
        return DriverManager.getConnection(required("CAMPUSCORE_E2E_POSTGRES_URL"),
                required("CAMPUSCORE_E2E_POSTGRES_USER"), required("CAMPUSCORE_E2E_POSTGRES_PASSWORD"));
    }

    static void migrate() {
        Flyway.configure()
                .dataSource(required("CAMPUSCORE_E2E_POSTGRES_URL"),
                        required("CAMPUSCORE_E2E_POSTGRES_USER"), required("CAMPUSCORE_E2E_POSTGRES_PASSWORD"))
                .locations("classpath:db/migration")
                .createSchemas(true)
                .defaultSchema("thesis")
                .schemas("thesis", "academic", "campuscore_auth", "campuscore_identity")
                .cleanDisabled(true)
                .load()
                .migrate();
    }

    static int count(Connection connection, String query) throws SQLException {
        try (var statement = connection.createStatement(); var rows = statement.executeQuery(query)) {
            if (!rows.next()) throw new SQLException("Count query returned no rows");
            return rows.getInt(1);
        }
    }

    private static String required(String name) {
        String value = System.getenv(name);
        if (value == null || value.isBlank()) throw new IllegalStateException("Required disposable test setting: " + name);
        return value;
    }
}
