package io.campuscore.restfulapi.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.fail;

import io.campuscore.restfulapi.admissions.service.AdmissionService;
import io.campuscore.restfulapi.admissions.web.AdmissionDtos;
import io.campuscore.restfulapi.careers.service.CareerService;
import io.campuscore.restfulapi.careers.web.CareerDtos;
import io.campuscore.restfulapi.events.service.EventService;
import io.campuscore.restfulapi.events.web.EventDtos;
import io.campuscore.restfulapi.library.service.LibraryService;
import io.campuscore.restfulapi.library.web.LibraryDtos;
import io.campuscore.restfulapi.web.DomainException;
import java.sql.Connection;
import java.sql.Statement;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.function.Function;
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
 * PostgreSQL authority test for scoped staff grants: two admins granting the
 * SAME target at the same time must leave exactly one grant row, neither call
 * may surface a uniqueness violation, and the repeat response replays the
 * stored row's identity, grantor and instant — never the repeating admin's.
 * The {@code (userId, scope[, organizationId])} unique constraint plus
 * uniqueness-preserving conflict handling is the mechanism; the H2 contract
 * tests cannot prove the Postgres schedule.
 *
 * <p>The race is deterministic, not timing-based: an anchor connection holds
 * {@code ACCESS EXCLUSIVE} on the domain audit table so the first grant's
 * transaction parks after its row insert but before its audit write (and
 * commit). The second grant is then observed blocked on the unique index's
 * speculative entry — the exact fault point the absence-check insert leaks.
 * Only then is the anchor released.
 *
 * <p><b>Environment contract</b> (opt-in, identical to
 * {@code EventCapacityPostgresIT}): runs ONLY when
 * {@code CAMPUSCORE_E2E_POSTGRES_URL} is set to a {@code jdbc:postgresql:} URL —
 * point it at a freshly recreated database. CI without the env skips the IT.
 */
@EnabledIf(value = "io.campuscore.restfulapi.security.GrantRepeatPostgresIT#postgresTargetConfigured")
@SpringBootTest(properties = {
        "spring.flyway.locations=classpath:db/migration",
        "deepseek.enabled=false",
        "spring.jpa.hibernate.ddl-auto=none",
        "spring.datasource.hikari.maximum-pool-size=16"
})
@ActiveProfiles({"test", "persistence"})
class GrantRepeatPostgresIT {

    private static final List<String> ADMIN = List.of("ADMIN");

    @Autowired
    private AdmissionService admissions;

    @Autowired
    private LibraryService library;

    @Autowired
    private CareerService careers;

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

    private String adminA;
    private String adminB;
    private String target;
    private String orgId;

    @BeforeEach
    void seed() {
        String suffix = Long.toString(System.nanoTime(), 36);
        adminA = "it-grant-admin-a-" + suffix;
        adminB = "it-grant-admin-b-" + suffix;
        target = "it-grant-target-" + suffix;
        orgId = "it-grant-org-" + suffix;
        jdbc.update(
                "INSERT INTO campuscore_auth.\"User\""
                        + " (\"id\", \"email\", \"password\", \"firstName\", \"lastName\", \"status\")"
                        + " VALUES (:id, :email, 'x', 'It', 'Target', 'ACTIVE')",
                new MapSqlParameterSource()
                        .addValue("id", target)
                        .addValue("email", target + "@it.local"));
        jdbc.update(
                "INSERT INTO careers.\"Organization\" (\"id\", \"name\") VALUES (:id, 'IT grant org')",
                new MapSqlParameterSource("id", orgId));
    }

    @Test
    void concurrentAdmissionsGrantRetainsOneStoredRow() throws Exception {
        race("admissions.\"Audit\"",
                Map.of("userId", target),
                "SELECT COUNT(*) FROM admissions.\"StaffGrant\""
                        + " WHERE \"userId\" = :userId AND \"scope\" = 'admissions'",
                "SELECT COUNT(*) FROM admissions.\"Audit\""
                        + " WHERE \"action\" = 'STAFF_GRANTED' AND \"detail\" LIKE :detail",
                actor -> admissions.grantStaff(actor, ADMIN, target),
                response -> {
                    var grant = (AdmissionDtos.StaffGrantResponse) response;
                    return new GrantView(grant.id(), grant.grantedBy(), grant.createdAt());
                });
    }

    @Test
    void concurrentLibraryGrantRetainsOneStoredRow() throws Exception {
        race("library.\"Audit\"",
                Map.of("userId", target),
                "SELECT COUNT(*) FROM library.\"StaffGrant\""
                        + " WHERE \"userId\" = :userId AND \"scope\" = 'library'",
                "SELECT COUNT(*) FROM library.\"Audit\""
                        + " WHERE \"action\" = 'STAFF_GRANTED' AND \"detail\" LIKE :detail",
                actor -> library.grantStaff(actor, ADMIN, target),
                response -> {
                    var grant = (LibraryDtos.StaffGrantResponse) response;
                    return new GrantView(grant.id(), grant.grantedBy(), grant.createdAt());
                });
    }

    @Test
    void concurrentEventsGrantRetainsOneStoredRow() throws Exception {
        race("events.\"Audit\"",
                Map.of("userId", target),
                "SELECT COUNT(*) FROM events.\"StaffGrant\""
                        + " WHERE \"userId\" = :userId AND \"scope\" = 'events'",
                "SELECT COUNT(*) FROM events.\"Audit\""
                        + " WHERE \"action\" = 'GRANTED' AND \"detail\" LIKE :detail",
                actor -> events.grantStaff(actor, ADMIN, target),
                response -> {
                    var grant = (EventDtos.StaffGrantResponse) response;
                    return new GrantView(grant.id(), grant.grantedBy(), grant.createdAt());
                });
    }

    @Test
    void concurrentCareersOrgGrantRetainsOneStoredRow() throws Exception {
        race("careers.\"Audit\"",
                Map.of("userId", target, "org", orgId),
                "SELECT COUNT(*) FROM careers.\"StaffGrant\""
                        + " WHERE \"userId\" = :userId AND \"scope\" = 'careers'"
                        + " AND \"organizationId\" = :org",
                "SELECT COUNT(*) FROM careers.\"Audit\""
                        + " WHERE \"action\" = 'STAFF_GRANTED' AND \"detail\" LIKE :detail",
                actor -> careers.grantStaff(actor, ADMIN, target, orgId),
                response -> {
                    var grant = (CareerDtos.StaffGrantResponse) response;
                    return new GrantView(grant.id(), grant.grantedBy(), grant.createdAt());
                });
    }

    @Test
    void repeatedCareersGrantsReplayStoredProvenance() {
        var orgGrant = careers.grantStaff(adminA, ADMIN, target, orgId);
        var orgRepeat = careers.grantStaff(adminB, ADMIN, target, orgId);
        assertThat(orgRepeat).isEqualTo(orgGrant);
        assertThat(orgRepeat.grantedBy()).isEqualTo(adminA);
        assertThat(orgRepeat.organizationId()).isEqualTo(orgId);

        var reviewerGrant = careers.grantStaff(adminA, ADMIN, target, null);
        var reviewerRepeat = careers.grantStaff(adminB, ADMIN, target, "");
        assertThat(reviewerRepeat).isEqualTo(reviewerGrant);
        assertThat(reviewerRepeat.grantedBy()).isEqualTo(adminA);
        assertThat(reviewerRepeat.organizationId()).isEmpty();

        Integer rows = jdbc.queryForObject(
                "SELECT COUNT(*) FROM careers.\"StaffGrant\""
                        + " WHERE \"userId\" = :userId AND \"scope\" = 'careers'",
                Map.of("userId", target), Integer.class);
        assertThat(rows).isEqualTo(2);
        Integer audits = jdbc.queryForObject(
                "SELECT COUNT(*) FROM careers.\"Audit\""
                        + " WHERE \"action\" = 'STAFF_GRANTED' AND \"detail\" LIKE :detail",
                Map.of("detail", "%" + target + "%"), Integer.class);
        assertThat(audits).isEqualTo(2);
    }

    /**
     * Two admins grant the same target while an anchor holds the domain audit
     * table: the first call parks after its row insert, the second is observed
     * blocked on the unique index, then the anchor commits. Afterward a third
     * sequential repeat replays the same stored row.
     */
    private void race(String auditTable, Map<String, ?> countParams, String countSql,
            String auditSql, Function<String, Object> grantByActor,
            Function<Object, GrantView> view) throws Exception {
        List<Outcome> outcomes = contend(auditTable,
                capture(() -> view.apply(grantByActor.apply(adminA))),
                capture(() -> view.apply(grantByActor.apply(adminB))));

        // Neither call surfaces a uniqueness error; both resolve to the same
        // stored row — the winner's id, grantor and instant.
        assertThat(outcomes).allMatch(outcome -> outcome.grant() != null);
        assertThat(outcomes.get(1).grant()).isEqualTo(outcomes.get(0).grant());
        assertThat(outcomes.get(0).grant().grantedBy()).isEqualTo(adminA);
        assertThat(jdbc.queryForObject(countSql, countParams, Integer.class)).isEqualTo(1);
        assertThat(jdbc.queryForObject(auditSql,
                Map.of("detail", "%" + target + "%"), Integer.class)).isEqualTo(1);
        assertThat(view.apply(grantByActor.apply(adminB))).isEqualTo(outcomes.get(0).grant());
    }

    private List<Outcome> contend(String auditTable, Callable<Outcome> first,
            Callable<Outcome> second) throws Exception {
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try (Connection anchor = jdbc.getJdbcTemplate().getDataSource().getConnection()) {
            anchor.setAutoCommit(false);
            try (Statement lock = anchor.createStatement()) {
                lock.execute("LOCK TABLE " + auditTable + " IN ACCESS EXCLUSIVE MODE");
            }
            Future<Outcome> futureFirst = pool.submit(first);
            awaitBlocked(
                    "SELECT COUNT(*) FROM pg_locks WHERE NOT granted AND locktype = 'relation'"
                            + " AND relation = '" + auditTable + "'::regclass",
                    "first grant parked at its audit write");
            Future<Outcome> futureSecond = pool.submit(second);
            awaitBlocked(
                    "SELECT COUNT(*) FROM pg_locks WHERE NOT granted AND locktype = 'transactionid'",
                    "second grant parked on the unique-index conflict");
            anchor.commit();
            return List.of(futureFirst.get(30, TimeUnit.SECONDS),
                    futureSecond.get(30, TimeUnit.SECONDS));
        } finally {
            pool.shutdownNow();
            assertThat(pool.awaitTermination(10, TimeUnit.SECONDS)).isTrue();
        }
    }

    private Callable<Outcome> capture(Callable<GrantView> call) {
        return () -> {
            try {
                return new Outcome(call.call(), 200, "");
            } catch (DomainException rejection) {
                return new Outcome(null, rejection.getStatus().value(), rejection.code());
            } catch (Exception failure) {
                return new Outcome(null, 500, failure.getClass().getSimpleName());
            }
        };
    }

    private void awaitBlocked(String sql, String description) throws InterruptedException {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(15);
        while (System.nanoTime() < deadline) {
            Integer waiting = jdbc.queryForObject(sql, Map.of(), Integer.class);
            if (waiting != null && waiting > 0) {
                return;
            }
            Thread.sleep(20);
        }
        fail("timed out waiting for " + description);
    }

    static boolean postgresTargetConfigured() {
        String url = System.getenv("CAMPUSCORE_E2E_POSTGRES_URL");
        return url != null && url.startsWith("jdbc:postgresql:");
    }

    private record GrantView(String id, String grantedBy, Instant createdAt) {
    }

    private record Outcome(GrantView grant, int status, String code) {
    }

    private static String valueOr(String name, String fallback) {
        String value = System.getenv(name);
        return value == null || value.isBlank() ? fallback : value;
    }
}
