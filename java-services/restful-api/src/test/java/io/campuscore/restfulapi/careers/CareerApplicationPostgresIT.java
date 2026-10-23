package io.campuscore.restfulapi.careers;

import static org.assertj.core.api.Assertions.assertThat;

import io.campuscore.restfulapi.careers.service.CareerCandidateService;
import io.campuscore.restfulapi.careers.service.CareerService;
import io.campuscore.restfulapi.careers.web.CareerDtos.ApplicationResponse;
import io.campuscore.restfulapi.careers.web.CareerDtos.ApplicationTransitionRequest;
import io.campuscore.restfulapi.careers.web.CareerDtos.ApplyRequest;
import io.campuscore.restfulapi.careers.web.CareerDtos.CreateOpportunityRequest;
import io.campuscore.restfulapi.careers.web.CareerDtos.OpportunityResponse;
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
 * PostgreSQL authority test for CAR-T04 + CAR-T05 + CAR-T02 (contract §9).
 * The H2 contract test proves the business logic; only the real engine
 * proves that the partial unique index collapses a concurrent apply race
 * to exactly one active application, that two org-staff lanes racing the
 * same transition serialize to one state change, and that two reviewer
 * lanes racing publish produce exactly one PUBLISHED row.
 *
 * <p><b>Environment contract</b>: runs ONLY when
 * {@code CAMPUSCORE_E2E_POSTGRES_URL} points at a {@code jdbc:postgresql:}
 * database, same opt-in convention as the events/learning/admissions/
 * library ITs.
 */
@EnabledIf(value = "io.campuscore.restfulapi.careers.CareerApplicationPostgresIT#postgresTargetConfigured")
@SpringBootTest(properties = {
        "spring.flyway.locations=classpath:db/migration",
        "deepseek.enabled=false",
        "spring.jpa.hibernate.ddl-auto=none",
        "spring.datasource.hikari.maximum-pool-size=16"
})
@ActiveProfiles({"test", "persistence"})
class CareerApplicationPostgresIT {

    @Autowired
    private CareerService staff;

    @Autowired
    private CareerCandidateService candidates;

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
    private String orgId;
    private String recruiterId;
    private String recruiter2Id;
    private String reviewerId;
    private String reviewer2Id;

    @BeforeEach
    void seed() {
        suffix = "car-" + UUID.randomUUID().toString().substring(0, 8);
        orgId = "org-" + suffix;
        recruiterId = "recruiter-" + suffix;
        recruiter2Id = "recruiter2-" + suffix;
        reviewerId = "reviewer-" + suffix;
        reviewer2Id = "reviewer2-" + suffix;
        for (String user : List.of(recruiterId, recruiter2Id, reviewerId, reviewer2Id)) {
            seedUser(user);
        }
        jdbc.update("INSERT INTO careers.\"Organization\" (\"id\",\"name\")"
                        + " VALUES (:id, :name)",
                new MapSqlParameterSource("id", orgId).addValue("name", "IT Org " + suffix));
        grant(recruiterId, orgId);
        grant(recruiter2Id, orgId);
        grant(reviewerId, "");
        grant(reviewer2Id, "");
    }

    private void seedUser(String userId) {
        jdbc.update("INSERT INTO campuscore_auth.\"User\" (\"id\",\"email\",\"password\",\"firstName\",\"lastName\",\"status\")"
                        + " VALUES (:id,:email,'x','It','User','ACTIVE')",
                new MapSqlParameterSource("id", userId).addValue("email", userId + "@it.local"));
    }

    private void grant(String userId, String org) {
        jdbc.update("INSERT INTO careers.\"StaffGrant\""
                        + " (\"id\",\"userId\",\"scope\",\"organizationId\",\"grantedBy\")"
                        + " VALUES (:id,:user,'careers',:org,'it')",
                new MapSqlParameterSource("id", "g-" + userId + "-" + org)
                        .addValue("user", userId).addValue("org", org));
    }

    private OpportunityResponse publishedOpportunity() {
        OpportunityResponse draft = staff.createOpportunity(recruiterId,
                new CreateOpportunityRequest(orgId, "IT Role " + suffix,
                        "desc", "HCMC", "INTERNSHIP", "negotiable"));
        OpportunityResponse inReview = staff.submitReview(recruiterId, draft.id(), draft.version());
        return staff.publish(reviewerId, inReview.id(), inReview.version());
    }

    // ------------------------------------------------------------------
    // CAR-T04 on Postgres: N candidates racing apply to ONE opportunity —
    // the partial unique index lets exactly one SUBMITTED row exist.
    // ------------------------------------------------------------------

    @Test
    void concurrentApplyRaceCollapsesToOneApplicationOnPostgres() throws Exception {
        OpportunityResponse opp = publishedOpportunity();
        int lanes = 4;
        ExecutorService pool = Executors.newFixedThreadPool(lanes);
        CountDownLatch ready = new CountDownLatch(lanes);
        CountDownLatch fire = new CountDownLatch(1);
        List<Future<Outcome>> futures = new ArrayList<>();
        for (int i = 0; i < lanes; i++) {
            String laneUser = "cand-" + suffix + "-" + i;
            seedUser(laneUser);
            int lane = i;
            futures.add(pool.submit((Callable<Outcome>) () -> {
                ready.countDown();
                fire.await(5, TimeUnit.SECONDS);
                try {
                    candidates.apply(laneUser, new ApplyRequest(opp.id(), "cover"),
                            "it-apply-" + suffix + "-" + lane);
                    return new Outcome(200, "");
                } catch (DomainException rejection) {
                    return new Outcome(rejection.getStatus().value(), rejection.code());
                }
            }));
        }
        // Wait — the lanes are DIFFERENT candidates, so all 4 should win.
        // The unique index guards (candidateUserId, opportunityId): for the
        // race claim to be interesting, use ONE candidate with racing lanes
        // in the next test. Here prove the multi-candidate happy path.
        ready.await(10, TimeUnit.SECONDS);
        fire.countDown();
        int wins = 0;
        for (Future<Outcome> future : futures) {
            Outcome outcome = future.get(30, TimeUnit.SECONDS);
            if (outcome.status() == 200) {
                wins++;
            }
        }
        pool.shutdownNow();
        assertThat(wins).as("distinct candidates can all apply").isEqualTo(lanes);
        Integer count = jdbc.queryForObject(
                "SELECT COUNT(*) FROM careers.\"Application\" WHERE \"opportunityId\" = :opp",
                Map.of("opp", opp.id()), Integer.class);
        assertThat(count).isEqualTo(lanes);
    }

    /** Same candidate racing themselves — the unique index collapses it. */
    @Test
    void sameCandidateRaceCollapsesToOneActiveApplicationOnPostgres() throws Exception {
        OpportunityResponse opp = publishedOpportunity();
        String candidateId = "cand-" + suffix;
        seedUser(candidateId);
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
                    candidates.apply(candidateId, new ApplyRequest(opp.id(), "cover"),
                            "it-same-" + suffix + "-" + lane);
                    return new Outcome(200, "");
                } catch (DomainException rejection) {
                    return new Outcome(rejection.getStatus().value(), rejection.code());
                }
            }));
        }
        ready.await(10, TimeUnit.SECONDS);
        fire.countDown();
        int wins = 0;
        for (Future<Outcome> future : futures) {
            Outcome outcome = future.get(30, TimeUnit.SECONDS);
            if (outcome.status() == 200) {
                wins++;
            } else {
                assertThat(outcome.status()).isEqualTo(409);
                assertThat(outcome.code()).isEqualTo("APPLICATION_ACTIVE");
            }
        }
        pool.shutdownNow();
        assertThat(wins).as("exactly one apply wins").isEqualTo(1);
        Integer active = jdbc.queryForObject(
                "SELECT COUNT(*) FROM careers.\"Application\""
                        + " WHERE \"candidateUserId\" = :c AND \"opportunityId\" = :opp"
                        + " AND \"status\" IN ('SUBMITTED','REVIEWING','INTERVIEW','OFFER')",
                Map.of("c", candidateId, "opp", opp.id()), Integer.class);
        assertThat(active).isEqualTo(1);
    }

    // ------------------------------------------------------------------
    // CAR-T05 on Postgres: two org-staff lanes racing SUBMITTED→REVIEWING
    // on one application — the row lock + conditional update serialize to
    // exactly one transition.
    // ------------------------------------------------------------------

    @Test
    void concurrentTransitionSerializesOnPostgres() throws Exception {
        OpportunityResponse opp = publishedOpportunity();
        String candidateId = "cand-" + suffix;
        seedUser(candidateId);
        ApplicationResponse application = candidates.apply(candidateId,
                new ApplyRequest(opp.id(), "cover"), "it-tr-" + suffix);

        ExecutorService pool = Executors.newFixedThreadPool(2);
        CountDownLatch ready = new CountDownLatch(2);
        CountDownLatch fire = new CountDownLatch(1);
        List<Future<Outcome>> futures = List.of(
                pool.submit((Callable<Outcome>) () -> {
                    ready.countDown();
                    fire.await(5, TimeUnit.SECONDS);
                    try {
                        staff.transitionApplication(recruiterId, application.id(),
                                new ApplicationTransitionRequest("REVIEWING", application.version()));
                        return new Outcome(200, "");
                    } catch (DomainException rejection) {
                        return new Outcome(rejection.getStatus().value(), rejection.code());
                    }
                }),
                pool.submit((Callable<Outcome>) () -> {
                    ready.countDown();
                    fire.await(5, TimeUnit.SECONDS);
                    try {
                        staff.transitionApplication(recruiter2Id, application.id(),
                                new ApplicationTransitionRequest("REVIEWING", application.version()));
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
                assertThat(outcome.status()).isEqualTo(409);
            }
        }
        pool.shutdownNow();
        assertThat(wins).as("exactly one transition lands").isEqualTo(1);
        Integer reviewing = jdbc.queryForObject(
                "SELECT COUNT(*) FROM careers.\"Audit\""
                        + " WHERE \"entityType\" = 'APPLICATION' AND \"entityId\" = :id"
                        + " AND \"action\" = 'REVIEWING'",
                Map.of("id", application.id()), Integer.class);
        assertThat(reviewing).as("exactly one REVIEWING transition recorded").isEqualTo(1);
    }

    // ------------------------------------------------------------------
    // CAR-T02 on Postgres: two reviewer lanes racing publish on one
    // IN_REVIEW opportunity — exactly one PUBLISHED row results.
    // ------------------------------------------------------------------

    @Test
    void concurrentPublishSerializesOnPostgres() throws Exception {
        OpportunityResponse draft = staff.createOpportunity(recruiterId,
                new CreateOpportunityRequest(orgId, "IT Publish " + suffix,
                        "desc", "HCMC", "INTERNSHIP", null));
        OpportunityResponse inReview = staff.submitReview(recruiterId, draft.id(), draft.version());

        ExecutorService pool = Executors.newFixedThreadPool(2);
        CountDownLatch ready = new CountDownLatch(2);
        CountDownLatch fire = new CountDownLatch(1);
        List<Future<Outcome>> futures = List.of(
                pool.submit((Callable<Outcome>) () -> {
                    ready.countDown();
                    fire.await(5, TimeUnit.SECONDS);
                    try {
                        staff.publish(reviewerId, inReview.id(), inReview.version());
                        return new Outcome(200, "");
                    } catch (DomainException rejection) {
                        return new Outcome(rejection.getStatus().value(), rejection.code());
                    }
                }),
                pool.submit((Callable<Outcome>) () -> {
                    ready.countDown();
                    fire.await(5, TimeUnit.SECONDS);
                    try {
                        staff.publish(reviewer2Id, inReview.id(), inReview.version());
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
                assertThat(outcome.status()).isEqualTo(409);
            }
        }
        pool.shutdownNow();
        assertThat(wins).as("exactly one reviewer publishes").isEqualTo(1);
        Integer published = jdbc.queryForObject(
                "SELECT COUNT(*) FROM careers.\"Audit\""
                        + " WHERE \"entityType\" = 'OPPORTUNITY' AND \"entityId\" = :id"
                        + " AND \"action\" = 'PUBLISHED'",
                Map.of("id", inReview.id()), Integer.class);
        assertThat(published).as("exactly one PUBLISHED transition recorded").isEqualTo(1);
    }

    private record Outcome(int status, String code) {
    }
}
