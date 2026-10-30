package io.campuscore.restfulapi.admissions;

import static org.assertj.core.api.Assertions.assertThat;

import io.campuscore.restfulapi.admissions.service.AdmissionApplicantService;
import io.campuscore.restfulapi.admissions.service.AdmissionService;
import io.campuscore.restfulapi.admissions.web.AdmissionDtos.ApplicationResponse;
import io.campuscore.restfulapi.admissions.web.AdmissionDtos.CreateApplicationRequest;
import io.campuscore.restfulapi.web.DomainException;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
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
 * PostgreSQL authority test for ADM-T04 + §1.3 + claim serialization
 * (contract §7). The H2 contract test proves the business logic; only the
 * real engine proves that the partial unique index stops a second ACTIVE
 * application under a concurrent create race, that same-key submit replays
 * never double-transition, and that two staff lanes racing a claim end with
 * exactly one reviewer.
 *
 * <p><b>Environment contract</b>: runs ONLY when
 * {@code CAMPUSCORE_E2E_POSTGRES_URL} points at a {@code jdbc:postgresql:}
 * database, same opt-in convention as the events/learning ITs.
 */
@EnabledIf(value = "io.campuscore.restfulapi.admissions.AdmissionAuthorityPostgresIT#postgresTargetConfigured")
@SpringBootTest(properties = {
        "spring.flyway.locations=classpath:db/migration",
        "deepseek.enabled=false",
        "spring.jpa.hibernate.ddl-auto=none",
        "spring.datasource.hikari.maximum-pool-size=16"
})
@ActiveProfiles({"test", "persistence"})
class AdmissionAuthorityPostgresIT {

    @Autowired
    private AdmissionService staff;

    @Autowired
    private AdmissionApplicantService applicants;

    @Autowired
    private NamedParameterJdbcTemplate jdbc;

    @DynamicPropertySource
    static void postgresProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", () -> valueOr(
                "CAMPUSCORE_E2E_POSTGRES_URL", "jdbc:postgresql://localhost:5432/campuscore_e2e"));
        registry.add("spring.datasource.username", () -> valueOr("CAMPUSCORE_E2E_POSTGRES_USER", "postgres"));
        registry.add("spring.datasource.password", () -> valueOr("CAMPUSCORE_E2E_POSTGRES_PASSWORD", "postgres"));
    }

    static boolean postgresTargetConfigured() {
        String url = System.getenv("CAMPUSCORE_E2E_POSTGRES_URL");
        return url != null && url.startsWith("jdbc:postgresql:");
    }

    private static String valueOr(String name, String fallback) {
        String value = System.getenv(name);
        return value == null || value.isBlank() ? fallback : value;
    }

    private String suffix;
    private String applicantId;
    private String staffId;
    private String staff2Id;
    private String cycle;

    @BeforeEach
    void seed() {
        suffix = "adm-" + UUID.randomUUID().toString().substring(0, 8);
        cycle = "cycle-" + suffix;
        applicantId = "app-" + suffix;
        staffId = "staff-" + suffix;
        staff2Id = "staff2-" + suffix;
        seedUser(applicantId);
        seedUser(staffId);
        seedUser(staff2Id);
        grant(staffId);
        grant(staff2Id);
    }

    private void seedUser(String userId) {
        jdbc.update("INSERT INTO campuscore_auth.\"User\" (\"id\",\"email\",\"password\",\"firstName\",\"lastName\",\"status\")"
                        + " VALUES (:id,:email,'x','It','User','ACTIVE')",
                new MapSqlParameterSource("id", userId).addValue("email", userId + "@it.local"));
    }

    private void grant(String userId) {
        jdbc.update("INSERT INTO admissions.\"StaffGrant\" (\"id\",\"userId\",\"scope\",\"grantedBy\")"
                        + " VALUES (:id,:user,'admissions','it')",
                new MapSqlParameterSource("id", "g-" + userId).addValue("user", userId));
    }

    private ApplicationResponse completeDraft() {
        ApplicationResponse draft = applicants.create(applicantId,
                new CreateApplicationRequest(cycle), "it-create-" + suffix);
        applicants.save(applicantId, draft.id(), new io.campuscore.restfulapi.admissions.web
                .AdmissionDtos.SaveApplicationRequest("IT Applicant", "2008-01-01",
                "THPT IT", "CNTT", "essay", draft.version()));
        return applicants.myApplication(applicantId, draft.id());
    }

    // ------------------------------------------------------------------
    // ADM-T04 on Postgres: concurrent same-cycle creates collapse to ONE
    // active row — the partial unique index is the storage backstop.
    // ------------------------------------------------------------------

    @Test
    void concurrentCreateCollapsesToOneActiveApplicationOnPostgres() throws Exception {
        int lanes = 4;
        ExecutorService pool = Executors.newFixedThreadPool(lanes);
        CountDownLatch ready = new CountDownLatch(lanes);
        CountDownLatch fire = new CountDownLatch(1);
        List<Future<Outcome>> futures = new ArrayList<>();
        for (int i = 0; i < lanes; i++) {
            int lane = i;
            futures.add(pool.submit((Callable<Outcome>) () -> {
                ready.countDown();
                fire.await(5, TimeUnit.SECONDS);
                try {
                    applicants.create(applicantId,
                            new CreateApplicationRequest(cycle), "it-create-race-" + lane);
                    return new Outcome(201, "");
                } catch (DomainException rejection) {
                    return new Outcome(rejection.getStatus().value(), rejection.code());
                }
            }));
        }
        ready.await(10, TimeUnit.SECONDS);
        fire.countDown();
        int created = 0;
        int conflicts = 0;
        for (Future<Outcome> future : futures) {
            Outcome outcome = future.get(30, TimeUnit.SECONDS);
            if (outcome.status() == 201 || outcome.status() == 200) {
                created++;
            } else {
                assertThat(outcome.status()).isEqualTo(409);
                assertThat(outcome.code()).isEqualTo("APPLICATION_CYCLE_ACTIVE");
                conflicts++;
            }
        }
        pool.shutdownNow();
        assertThat(created).as("exactly one lane wins the cycle").isEqualTo(1);
        assertThat(conflicts).isEqualTo(lanes - 1);
        Integer active = jdbc.queryForObject(
                "SELECT COUNT(*) FROM admissions.\"Application\""
                        + " WHERE \"applicantUserId\" = :owner AND \"cycle\" = :cycle"
                        + " AND \"status\" IN ('DRAFT','SUBMITTED','IN_REVIEW','RETURNED')",
                Map.of("owner", applicantId, "cycle", cycle), Integer.class);
        assertThat(active).isEqualTo(1);
    }

    // ------------------------------------------------------------------
    // §1.3 on Postgres: concurrent same-key submits → exactly one SUBMITTED
    // transition (winners replay, losers see IN_PROGRESS/conflict — never a
    // second transition row).
    // ------------------------------------------------------------------

    @Test
    void concurrentSameKeySubmitTransitionsOnceOnPostgres() throws Exception {
        ApplicationResponse draft = completeDraft();
        int lanes = 4;
        ExecutorService pool = Executors.newFixedThreadPool(lanes);
        CountDownLatch ready = new CountDownLatch(lanes);
        CountDownLatch fire = new CountDownLatch(1);
        List<Future<Outcome>> futures = new ArrayList<>();
        for (int i = 0; i < lanes; i++) {
            futures.add(pool.submit((Callable<Outcome>) () -> {
                ready.countDown();
                fire.await(5, TimeUnit.SECONDS);
                try {
                    applicants.submit(applicantId, draft.id(), draft.version(), "it-submit-" + suffix);
                    return new Outcome(200, "");
                } catch (DomainException rejection) {
                    return new Outcome(rejection.getStatus().value(), rejection.code());
                }
            }));
        }
        ready.await(10, TimeUnit.SECONDS);
        fire.countDown();
        int wins = 0;
        int tolerated = 0;
        for (Future<Outcome> future : futures) {
            Outcome outcome = future.get(30, TimeUnit.SECONDS);
            if (outcome.status() == 200) {
                wins++;
            } else {
                // a key-claim loser may surface IN_PROGRESS, a stale version,
                // or a state conflict — never a second transition
                assertThat(outcome.status()).isEqualTo(409);
                tolerated++;
            }
        }
        pool.shutdownNow();
        assertThat(wins).as("at least one lane lands the submit").isGreaterThanOrEqualTo(1);
        Integer submitted = jdbc.queryForObject(
                "SELECT COUNT(*) FROM admissions.\"Audit\""
                        + " WHERE \"applicationId\" = :id AND \"action\" = 'SUBMITTED'",
                Map.of("id", draft.id()), Integer.class);
        assertThat(submitted).as("exactly one SUBMITTED transition recorded").isEqualTo(1);
        assertThat(applicants.myApplication(applicantId, draft.id()).status())
                .isEqualTo("SUBMITTED");
    }

    // ------------------------------------------------------------------
    // Claim serialization on Postgres: two grant-holding staff racing a
    // claim end with exactly one claimedBy — the conditional UPDATE under
    // FOR UPDATE is the arbiter.
    // ------------------------------------------------------------------

    @Test
    void concurrentClaimLeavesExactlyOneReviewerOnPostgres() throws Exception {
        ApplicationResponse draft = completeDraft();
        applicants.submit(applicantId, draft.id(), draft.version(), "it-submit-claim-" + suffix);
        ApplicationResponse submitted = applicants.myApplication(applicantId, draft.id());

        ExecutorService pool = Executors.newFixedThreadPool(2);
        CountDownLatch ready = new CountDownLatch(2);
        CountDownLatch fire = new CountDownLatch(1);
        List<Future<Outcome>> futures = List.of(
                pool.submit((Callable<Outcome>) () -> {
                    ready.countDown();
                    fire.await(5, TimeUnit.SECONDS);
                    try {
                        staff.claim(staffId, submitted.id(), submitted.version());
                        return new Outcome(200, "");
                    } catch (DomainException rejection) {
                        return new Outcome(rejection.getStatus().value(), rejection.code());
                    }
                }),
                pool.submit((Callable<Outcome>) () -> {
                    ready.countDown();
                    fire.await(5, TimeUnit.SECONDS);
                    try {
                        staff.claim(staff2Id, submitted.id(), submitted.version());
                        return new Outcome(200, "");
                    } catch (DomainException rejection) {
                        return new Outcome(rejection.getStatus().value(), rejection.code());
                    }
                }));
        ready.await(10, TimeUnit.SECONDS);
        fire.countDown();
        int wins = 0;
        for (Future<Outcome> future : futures) {
            Outcome outcome = future.get(30, TimeUnit.SECONDS);
            if (outcome.status() == 200) {
                wins++;
            } else {
                assertThat(outcome.status()).isIn(409, 403);
            }
        }
        pool.shutdownNow();
        assertThat(wins).as("exactly one staff lane wins the claim").isEqualTo(1);
        Map<String, Object> row = jdbc.queryForMap(
                "SELECT \"status\", \"claimedBy\" FROM admissions.\"Application\" WHERE \"id\" = :id",
                Map.of("id", submitted.id()));
        assertThat(row.get("status")).isEqualTo("IN_REVIEW");
        assertThat(row.get("claimedBy")).isIn(staffId, staff2Id);
    }

    private record Outcome(int status, String code) {
    }
}
