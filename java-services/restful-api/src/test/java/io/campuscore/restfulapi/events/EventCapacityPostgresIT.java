package io.campuscore.restfulapi.events;

import static org.assertj.core.api.Assertions.assertThat;

import io.campuscore.restfulapi.events.service.EventStudentService;
import io.campuscore.restfulapi.events.service.EventService;
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
    private EventService events;

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

    @Test
    void twoCancelKeysFreeOneSeatAndNotifyOnce() throws Exception {
        var registration = students.register(studentIds.get(0), eventId, "register-before-cancel");
        var results = contend(() -> students.cancel(studentIds.get(0), registration.id(), "cancel-a"),
                () -> students.cancel(studentIds.get(0), registration.id(), "cancel-b"));
        assertThat(results.stream().filter(Outcome::registered).count()).isEqualTo(1);
        assertInvariant(0);
        assertThat(notices()).isEqualTo(2);
        assertThat(audits("REGISTRATION_CANCELLED")).isEqualTo(1);
    }

    @Test
    void cancellationAndLastSeatRegistrationSerializeWithoutCountDrift() throws Exception {
        jdbc.update("UPDATE events.\"Event\" SET \"capacity\"=1 WHERE \"id\"=:id", Map.of("id", eventId));
        var registration = students.register(studentIds.get(0), eventId, "initial-register");
        var results = contend(() -> students.cancel(studentIds.get(0), registration.id(), "release-seat"),
                () -> students.register(studentIds.get(1), eventId, "claim-seat"));
        assertThat(results.get(0).registered()).isTrue();
        int newRegistration = results.get(1).registered() ? 1 : 0;
        assertInvariant(newRegistration);
        assertThat(notices()).isEqualTo(2 + newRegistration);
    }

    @Test
    void eventCancellationAndRegistrationLeaveNoActiveSeats() throws Exception {
        grantFixtureStaff();
        var results = contend(() -> events.cancel("it-staff", eventId, "race cancellation"),
                () -> students.register(studentIds.get(0), eventId, "racing-register"));
        assertThat(results.get(0).registered()).isTrue();
        assertInvariant(0);
        assertThat(jdbc.queryForObject("SELECT \"status\" FROM events.\"Event\" WHERE \"id\"=:id",
                Map.of("id", eventId), String.class)).isEqualTo("CANCELLED");
        assertThat(notices()).isEqualTo(results.get(1).registered() ? 2 : 0);
        org.assertj.core.api.Assertions.assertThatThrownBy(() -> students.register(studentIds.get(1), eventId, "after-terminal"))
                .isInstanceOf(DomainException.class);
    }

    @Test
    void eventCancellationAndIndividualCancellationDoNotDuplicateNotices() throws Exception {
        grantFixtureStaff();
        var registration = students.register(studentIds.get(0), eventId, "before-both-cancels");
        var results = contend(() -> students.cancel(studentIds.get(0), registration.id(), "individual-cancel"),
                () -> events.cancel("it-staff", eventId, "whole-event-cancel"));
        assertThat(results.get(1).registered()).isTrue();
        assertInvariant(0);
        assertThat(notices()).isEqualTo(2);
        assertThat(audits("CANCELLED")).isEqualTo(1);
    }

    @Test
    void oldReplayDoesNotChangeFreshRegistrationOrRepeatSideEffects() {
        var original = students.register(studentIds.get(0), eventId, "old-register");
        var cancelled = students.cancel(studentIds.get(0), original.id(), "old-cancel");
        var fresh = students.register(studentIds.get(0), eventId, "fresh-register");
        assertThat(students.register(studentIds.get(0), eventId, "old-register")).isEqualTo(original);
        assertThat(students.cancel(studentIds.get(0), original.id(), "old-cancel")).isEqualTo(cancelled);
        assertThat(fresh.id()).isNotEqualTo(original.id());
        assertInvariant(1);
        assertThat(notices()).isEqualTo(3);
        assertThat(audits("REGISTERED")).isEqualTo(2);
        assertThat(audits("REGISTRATION_CANCELLED")).isEqualTo(1);
    }

    private void grantFixtureStaff() {
        jdbc.update("INSERT INTO events.\"StaffGrant\" (\"id\",\"userId\",\"scope\",\"grantedBy\")"
                + " VALUES ('it-staff-grant','it-staff','events','fixture') ON CONFLICT (\"userId\",\"scope\") DO NOTHING",
                Map.of());
    }

    /** Both requests must be observed waiting on the held event lock, not a timing-only race. */
    private List<Outcome> contend(Callable<?> first, Callable<?> second) throws Exception {
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try (var anchor = jdbc.getJdbcTemplate().getDataSource().getConnection()) {
            anchor.setAutoCommit(false);
            try (var statement = anchor.prepareStatement("SELECT \"id\" FROM events.\"Event\" WHERE \"id\"=? FOR UPDATE")) {
                statement.setString(1, eventId);
                try (var rows = statement.executeQuery()) { assertThat(rows.next()).isTrue(); }
            }
            List<Future<Outcome>> futures = new ArrayList<>();
            for (Callable<?> action : List.of(first, second)) {
                futures.add(pool.submit(() -> {
                    try { action.call(); return new Outcome(true, 200, ""); }
                    catch (DomainException rejection) {
                        return new Outcome(false, rejection.getStatus().value(), rejection.code());
                    }
                }));
            }
            int waiting = 0;
            long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(10);
            while (System.nanoTime() < deadline) {
                waiting = jdbc.queryForObject("SELECT COUNT(*) FROM pg_stat_activity WHERE datname=current_database()"
                        + " AND wait_event_type='Lock' AND state='active'", Map.of(), Integer.class);
                if (waiting >= 2) break;
                Thread.sleep(20);
            }
            assertThat(waiting).as("both contenders observed at PostgreSQL lock fault point").isGreaterThanOrEqualTo(2);
            anchor.commit();
            List<Outcome> outcomes = new ArrayList<>();
            for (Future<Outcome> future : futures) outcomes.add(future.get(30, TimeUnit.SECONDS));
            assertThat(outcomes).allMatch(outcome -> outcome.registered() || outcome.status() == 409);
            return outcomes;
        } finally {
            pool.shutdownNow();
            assertThat(pool.awaitTermination(10, TimeUnit.SECONDS)).isTrue();
        }
    }

    private void assertInvariant(int expected) {
        var args = Map.of("id", eventId);
        int count = jdbc.queryForObject("SELECT \"registeredCount\" FROM events.\"Event\" WHERE \"id\"=:id", args, Integer.class);
        int active = jdbc.queryForObject("SELECT COUNT(*) FROM events.\"Registration\" WHERE \"eventId\"=:id AND \"status\"='REGISTERED'", args, Integer.class);
        int capacity = jdbc.queryForObject("SELECT \"capacity\" FROM events.\"Event\" WHERE \"id\"=:id", args, Integer.class);
        assertThat(count).isEqualTo(active).isEqualTo(expected).isBetween(0, capacity);
        int duplicatePairs = jdbc.queryForObject("SELECT COUNT(*) FROM (SELECT \"studentId\" FROM events.\"Registration\""
                + " WHERE \"eventId\"=:id AND \"status\"='REGISTERED' GROUP BY \"studentId\" HAVING COUNT(*)>1) d", args, Integer.class);
        assertThat(duplicatePairs).isZero();
    }

    private int notices() {
        return jdbc.queryForObject("SELECT COUNT(*) FROM notifications.notification WHERE link=:link",
                Map.of("link", "/dashboard/events?event=" + eventId), Integer.class);
    }

    private int audits(String action) {
        return jdbc.queryForObject("SELECT COUNT(*) FROM events.\"Audit\" WHERE \"eventId\"=:id AND \"action\"=:action",
                Map.of("id", eventId, "action", action), Integer.class);
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
