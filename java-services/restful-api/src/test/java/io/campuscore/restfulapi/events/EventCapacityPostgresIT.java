package io.campuscore.restfulapi.events;

import static org.assertj.core.api.Assertions.assertThat;

import io.campuscore.restfulapi.events.service.EventStudentService;
import io.campuscore.restfulapi.web.DomainException;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIf;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/**
 * PostgreSQL authority test for EVT-X01/EVT-X02 — the H2 contract test cannot
 * prove row-lock serialization ({@code SELECT ... FOR UPDATE} + the
 * conditional {@code registeredCount < capacity} UPDATE) on the real engine.
 *
 * <p><b>Environment contract</b>: runs ONLY when
 * {@code CAMPUSCORE_E2E_POSTGRES_URL} points at a {@code jdbc:postgresql:}
 * database, same opt-in convention as
 * {@code AcademicEnrollmentSeatRacePostgresIT}.
 */
@EnabledIf(value = "io.campuscore.restfulapi.events.EventCapacityPostgresIT#postgresTargetConfigured")
@SpringBootTest(properties = {
        "spring.flyway.locations=classpath:db/migration",
        "deepseek.enabled=false",
        "spring.jpa.hibernate.ddl-auto=none",
        "spring.datasource.hikari.maximum-pool-size=16"
})
@ActiveProfiles({"test", "persistence"})
class EventCapacityPostgresIT {

    private static final int STUDENT_COUNT = 6;
    private static final int CAPACITY = 2;

    @Autowired
    private EventStudentService students;

    @Autowired
    private NamedParameterJdbcTemplate jdbc;

    @DynamicPropertySource
    static void postgresProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", () -> valueOr(
                "CAMPUSCORE_E2E_POSTGRES_URL", "jdbc:postgresql://localhost:5432/campuscore_e2e"));
        registry.add("spring.datasource.username", () -> valueOr("CAMPUSCORE_E2E_POSTGRES_USER", "postgres"));
        registry.add("spring.datasource.password", () -> valueOr("CAMPUSCORE_E2E_POSTGRES_PASSWORD", "postgres"));
    }

    private String eventId;
    private final List<String> studentIds = new ArrayList<>();

    @BeforeEach
    void seed() {
        eventId = "it-event-" + System.nanoTime();
        for (int index = 1; index <= STUDENT_COUNT; index++) {
            String id = "it-student-" + index + "-" + System.nanoTime();
            studentIds.add(id);
            jdbc.update(
                    "INSERT INTO campuscore_auth.\"User\""
                            + " (\"id\", \"email\", \"password\", \"firstName\", \"lastName\", \"status\")"
                            + " VALUES (:id, :email, 'x', 'It', 'Student', 'ACTIVE')",
                    new MapSqlParameterSource()
                            .addValue("id", id)
                            .addValue("email", id + "@it.local"));
        }
        jdbc.update(
                "INSERT INTO campuscore_auth.\"User\""
                        + " (\"id\", \"email\", \"password\", \"firstName\", \"lastName\", \"status\")"
                        + " VALUES ('it-staff', 'it-staff@it.local', 'x', 'It', 'Staff', 'ACTIVE')"
                        + " ON CONFLICT (\"id\") DO NOTHING",
                new MapSqlParameterSource());
        jdbc.update(
                "INSERT INTO events.\"Event\""
                        + " (\"id\", \"title\", \"organizer\", \"status\", \"capacity\","
                        + " \"startsAt\", \"endsAt\", \"ownerId\")"
                        + " VALUES (:id, 'IT race event', 'IT', 'REGISTRATION_OPEN', :capacity,"
                        + " :startsAt, :endsAt, 'it-staff')",
                new MapSqlParameterSource()
                        .addValue("id", eventId)
                        .addValue("capacity", CAPACITY)
                        .addValue("startsAt", java.sql.Timestamp.from(Instant.now().plus(1, ChronoUnit.HOURS)))
                        .addValue("endsAt", java.sql.Timestamp.from(Instant.now().plus(3, ChronoUnit.HOURS))));
    }

    /** EVT-X01: six students race two seats — exactly two commit on Postgres. */
    @Test
    void lastSeatRaceYieldsExactlyCapacitySuccessesOnPostgres() throws Exception {
        ExecutorService pool = Executors.newFixedThreadPool(STUDENT_COUNT);
        CountDownLatch ready = new CountDownLatch(STUDENT_COUNT);
        CountDownLatch start = new CountDownLatch(1);
        List<Future<Outcome>> futures = new ArrayList<>();
        try {
            for (int index = 0; index < STUDENT_COUNT; index++) {
                final String studentId = studentIds.get(index);
                final String key = "it-seat-" + index;
                futures.add(pool.submit((Callable<Outcome>) () -> {
                    ready.countDown();
                    if (!start.await(10, TimeUnit.SECONDS)) {
                        return new Outcome(false, -1, "start barrier timeout");
                    }
                    try {
                        students.register(studentId, eventId, key);
                        return new Outcome(true, 201, "");
                    } catch (DomainException rejection) {
                        return new Outcome(false, rejection.getStatus().value(), rejection.code());
                    }
                }));
            }
            assertThat(ready.await(10, TimeUnit.SECONDS)).isTrue();
            start.countDown();
            List<Outcome> outcomes = new ArrayList<>();
            for (Future<Outcome> future : futures) {
                outcomes.add(future.get(60, TimeUnit.SECONDS));
            }

            assertThat(outcomes.stream().filter(Outcome::registered).count())
                    .as("exactly the event capacity succeeds")
                    .isEqualTo(CAPACITY);
            assertThat(outcomes.stream()
                            .filter(outcome -> !outcome.registered())
                            .allMatch(outcome -> outcome.status() == 409))
                    .as("every loser gets a business conflict, never a 500 or lock timeout")
                    .isTrue();

            Integer registeredCount = jdbc.queryForObject(
                    "SELECT \"registeredCount\" FROM events.\"Event\" WHERE \"id\" = :id",
                    Map.of("id", eventId), Integer.class);
            Integer activeRows = jdbc.queryForObject(
                    "SELECT COUNT(*) FROM events.\"Registration\""
                            + " WHERE \"eventId\" = :id AND \"status\" = 'REGISTERED'",
                    Map.of("id", eventId), Integer.class);
            Integer duplicates = jdbc.queryForObject(
                    "SELECT COUNT(*) FROM (SELECT \"studentId\" FROM events.\"Registration\""
                            + " WHERE \"eventId\" = :id AND \"status\" = 'REGISTERED'"
                            + " GROUP BY \"studentId\" HAVING COUNT(*) > 1) d",
                    Map.of("id", eventId), Integer.class);
            assertThat(registeredCount).isEqualTo(CAPACITY);
            assertThat(activeRows).isEqualTo(CAPACITY);
            assertThat(duplicates).isZero();
        } finally {
            pool.shutdownNow();
            assertThat(pool.awaitTermination(10, TimeUnit.SECONDS)).isTrue();
        }
    }

    /**
     * EVT-X02 on Postgres: one student fires the same idempotency key twice
     * concurrently — the row count never exceeds one regardless of which lane
     * wins the claim insert.
     */
    @Test
    void concurrentSameKeyReplayNeverDoubleRegistersOnPostgres() throws Exception {
        String studentId = studentIds.get(0);
        ExecutorService pool = Executors.newFixedThreadPool(2);
        CountDownLatch ready = new CountDownLatch(2);
        CountDownLatch start = new CountDownLatch(1);
        List<Future<Outcome>> futures = new ArrayList<>();
        try {
            for (int lane = 0; lane < 2; lane++) {
                futures.add(pool.submit((Callable<Outcome>) () -> {
                    ready.countDown();
                    if (!start.await(10, TimeUnit.SECONDS)) {
                        return new Outcome(false, -1, "start barrier timeout");
                    }
                    try {
                        students.register(studentId, eventId, "same-key");
                        return new Outcome(true, 201, "");
                    } catch (DomainException rejection) {
                        return new Outcome(false, rejection.getStatus().value(), rejection.code());
                    }
                }));
            }
            assertThat(ready.await(10, TimeUnit.SECONDS)).isTrue();
            start.countDown();
            List<Outcome> outcomes = new ArrayList<>();
            for (Future<Outcome> future : futures) {
                outcomes.add(future.get(60, TimeUnit.SECONDS));
            }
            assertThat(outcomes.stream().anyMatch(Outcome::registered)).isTrue();
            assertThat(outcomes.stream()
                            .filter(outcome -> !outcome.registered())
                            .allMatch(outcome -> outcome.status() == 409))
                    .isTrue();
            Integer rows = jdbc.queryForObject(
                    "SELECT COUNT(*) FROM events.\"Registration\""
                            + " WHERE \"eventId\" = :id AND \"studentId\" = :studentId"
                            + " AND \"status\" = 'REGISTERED'",
                    Map.of("id", eventId, "studentId", studentId), Integer.class);
            Integer registeredCount = jdbc.queryForObject(
                    "SELECT \"registeredCount\" FROM events.\"Event\" WHERE \"id\" = :id",
                    Map.of("id", eventId), Integer.class);
            assertThat(rows).isEqualTo(1);
            assertThat(registeredCount).isEqualTo(1);
        } finally {
            pool.shutdownNow();
            assertThat(pool.awaitTermination(10, TimeUnit.SECONDS)).isTrue();
        }
    }

    static boolean postgresTargetConfigured() {
        String url = System.getenv("CAMPUSCORE_E2E_POSTGRES_URL");
        return url != null && url.startsWith("jdbc:postgresql:");
    }

    private record Outcome(boolean registered, int status, String code) {
    }

    private static String valueOr(String name, String fallback) {
        String value = System.getenv(name);
        return value == null || value.isBlank() ? fallback : value;
    }
}
