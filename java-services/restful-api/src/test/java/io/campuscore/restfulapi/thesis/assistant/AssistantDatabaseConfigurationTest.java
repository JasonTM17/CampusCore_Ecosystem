package io.campuscore.restfulapi.thesis.assistant;

import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertThrows;

import javax.sql.DataSource;
import org.junit.jupiter.api.Test;

/**
 * Regression for the production boot outage: a syntactically valid assistant
 * datasource whose dedicated runtime login cannot connect (unprovisioned
 * tenant/role, unreachable host) used to let Hikari's initialization failure
 * kill the whole application. The Wave 1.2 contract is that only the assistant
 * degrades — the bean must return a fail-closed
 * {@link UnavailableAssistantDataSource} so the RLS verifier marks the state
 * DEGRADED and chat endpoints answer 503 while the rest of the API keeps
 * serving.
 */
class AssistantDatabaseConfigurationTest {

    private final AssistantDatabaseConfiguration configuration = new AssistantDatabaseConfiguration();

    @Test
    void anUnreachableRuntimeLoginDegradesToAFailClosedDataSource() {
        DataSource dataSource = configuration.assistantDataSource(
                "jdbc:postgresql://127.0.0.1:1/postgres",
                "campuscore_assistant_runtime.testref",
                "x",
                1,
                1000,
                false);

        assertInstanceOf(UnavailableAssistantDataSource.class, dataSource);
    }

    @Test
    void credentialsEmbeddedInUrlRemainAHardFailure() {
        assertThrows(IllegalStateException.class, () -> configuration.assistantDataSource(
                "jdbc:postgresql://127.0.0.1:1/postgres?password=x",
                "campuscore_assistant_runtime.testref",
                "x",
                1,
                1000,
                false));
    }
}
