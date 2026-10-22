package io.campuscore.restfulapi.events;

import static org.assertj.core.api.Assertions.assertThat;

import java.sql.Connection;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.jdbc.datasource.SingleConnectionDataSource;
import org.springframework.jdbc.datasource.init.ScriptUtils;

class SeededEventsGrantMigrationTest {

    @Test
    void dropsOnlyTheGrantTheMigrationSeeded() throws Exception {
        var dataSource = new DriverManagerDataSource(
                "jdbc:h2:mem:events-grant-" + UUID.randomUUID() + ";MODE=PostgreSQL", "sa", "");
        try (Connection connection = dataSource.getConnection()) {
            var jdbc = new JdbcTemplate(new SingleConnectionDataSource(connection, true));
            jdbc.execute("CREATE SCHEMA events");
            jdbc.execute("CREATE TABLE events.\"StaffGrant\" (\"id\" VARCHAR(64) PRIMARY KEY,"
                    + " \"userId\" VARCHAR(64) NOT NULL, \"scope\" VARCHAR(40) NOT NULL,"
                    + " \"grantedBy\" VARCHAR(64) NOT NULL)");
            jdbc.update("INSERT INTO events.\"StaffGrant\" VALUES"
                    + " ('grant-events-admin-user', 'admin-user', 'events', 'system-migration')");
            jdbc.update("INSERT INTO events.\"StaffGrant\" VALUES"
                    + " ('api-grant', 'staff-user', 'events', 'admin-user')");

            ScriptUtils.executeSqlScript(connection,
                    new ClassPathResource("db/migration/V138__drop_migration_seeded_events_grant.sql"));

            assertThat(jdbc.queryForList("SELECT \"id\" FROM events.\"StaffGrant\"", String.class))
                    .containsExactly("api-grant");
        }
    }
}
