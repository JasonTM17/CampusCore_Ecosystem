package io.campuscore.restfulapi.library;

import static org.assertj.core.api.Assertions.assertThat;

import io.campuscore.restfulapi.library.service.LibraryPatronService;
import io.campuscore.restfulapi.library.service.LibraryService;
import io.campuscore.restfulapi.library.web.LibraryDtos.BorrowRequest;
import io.campuscore.restfulapi.library.web.LibraryDtos.IssueRequest;
import io.campuscore.restfulapi.library.web.LibraryDtos.LoanRequestResponse;
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
 * PostgreSQL authority test for LIB-X02 + LIB-T04 (contract §8). The H2
 * contract test proves the business logic; only the real engine proves
 * that the partial unique index stops a second ACTIVE request on one
 * copy under a concurrent hold race, that two staff lanes racing an
 * issue end with exactly one ISSUED transition (the double-issue claim),
 * and that a raced return leaves exactly one RETURNED row with the copy
 * restored — never phantom stock.
 *
 * <p><b>Environment contract</b>: runs ONLY when
 * {@code CAMPUSCORE_E2E_POSTGRES_URL} points at a {@code jdbc:postgresql:}
 * database, same opt-in convention as the events/learning/admissions ITs.
 */
@EnabledIf(value = "io.campuscore.restfulapi.library.LibraryInventoryPostgresIT#postgresTargetConfigured")
@SpringBootTest(properties = {
        "spring.flyway.locations=classpath:db/migration",
        "deepseek.enabled=false",
        "spring.jpa.hibernate.ddl-auto=none",
        "spring.datasource.hikari.maximum-pool-size=16",
        "campuscore.library.reservation-ttl-hours=48",
        "campuscore.library.loan-days=14"
})
@ActiveProfiles({"test", "persistence"})
class LibraryInventoryPostgresIT {

    @Autowired
    private LibraryService staff;

    @Autowired
    private LibraryPatronService patrons;

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
    private String titleId;
    private String copyId;
    private String borrowerId;
    private String staffId;
    private String staff2Id;

    @BeforeEach
    void seed() {
        suffix = "lib-" + UUID.randomUUID().toString().substring(0, 8);
        titleId = "title-" + suffix;
        copyId = "copy-" + suffix;
        borrowerId = "borrower-" + suffix;
        staffId = "staff-" + suffix;
        staff2Id = "staff2-" + suffix;
        seedUser(borrowerId);
        seedUser(staffId);
        seedUser(staff2Id);
        grant(staffId);
        grant(staff2Id);
        jdbc.update("INSERT INTO library.\"Title\" (\"id\",\"title\",\"author\",\"category\")"
                        + " VALUES (:id,'IT Title','IT Author','CS')",
                new MapSqlParameterSource("id", titleId));
        jdbc.update("INSERT INTO library.\"Copy\" (\"id\",\"titleId\",\"barcode\",\"status\")"
                        + " VALUES (:id,:title,:barcode,'AVAILABLE')",
                new MapSqlParameterSource("id", copyId)
                        .addValue("title", titleId)
                        .addValue("barcode", "BC-" + suffix));
    }

    private void seedUser(String userId) {
        jdbc.update("INSERT INTO campuscore_auth.\"User\" (\"id\",\"email\",\"password\",\"firstName\",\"lastName\",\"status\")"
                        + " VALUES (:id,:email,'x','It','User','ACTIVE')",
                new MapSqlParameterSource("id", userId).addValue("email", userId + "@it.local"));
    }

    private void grant(String userId) {
        jdbc.update("INSERT INTO library.\"StaffGrant\" (\"id\",\"userId\",\"scope\",\"grantedBy\")"
                        + " VALUES (:id,:user,'library','it')",
                new MapSqlParameterSource("id", "g-" + userId).addValue("user", userId));
    }

    // ------------------------------------------------------------------
    // LIB-X02 on Postgres: N patrons racing ONE copy — the partial unique
    // index lets exactly one REQUESTED row exist; losers get
    // COPY_UNAVAILABLE, never a second hold.
    // ------------------------------------------------------------------

    @Test
    void concurrentRequestRaceCollapsesToOneHoldOnPostgres() throws Exception {
        int lanes = 4;
        ExecutorService pool = Executors.newFixedThreadPool(lanes);
        CountDownLatch ready = new CountDownLatch(lanes);
        CountDownLatch fire = new CountDownLatch(1);
        List<Future<Outcome>> futures = new ArrayList<>();
        for (int i = 0; i < lanes; i++) {
            String laneUser = borrowerId + "-" + i;
            seedUser(laneUser);
            int lane = i;
            futures.add(pool.submit((Callable<Outcome>) () -> {
                ready.countDown();
                fire.await(5, TimeUnit.SECONDS);
                try {
                    patrons.request(laneUser, new BorrowRequest(copyId), "it-race-" + suffix + "-" + lane);
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
                assertThat(outcome.code()).isEqualTo("COPY_UNAVAILABLE");
            }
        }
        pool.shutdownNow();
        assertThat(wins).as("exactly one patron holds the copy").isEqualTo(1);
        Integer active = jdbc.queryForObject(
                "SELECT COUNT(*) FROM library.\"LoanRequest\""
                        + " WHERE \"copyId\" = :copy AND \"status\" IN ('REQUESTED','APPROVED','ISSUED')",
                Map.of("copy", copyId), Integer.class);
        assertThat(active).isEqualTo(1);
        assertThat(copyStatus()).isEqualTo("RESERVED");
    }

    // ------------------------------------------------------------------
    // LIB-X02/T03 on Postgres: two staff lanes racing the ISSUE of the
    // same APPROVED request end with exactly one ISSUED transition — the
    // double-issue claim fails at the row lock + conditional update.
    // ------------------------------------------------------------------

    @Test
    void concurrentIssueTransitionsOnceOnPostgres() throws Exception {
        LoanRequestResponse request = patrons.request(borrowerId,
                new BorrowRequest(copyId), "it-issue-" + suffix);
        staff.approve(staffId, request.id(), request.version());
        LoanRequestResponse approved = staff.staffRequest(staffId, request.id());

        ExecutorService pool = Executors.newFixedThreadPool(2);
        CountDownLatch ready = new CountDownLatch(2);
        CountDownLatch fire = new CountDownLatch(1);
        List<Future<Outcome>> futures = List.of(
                pool.submit((Callable<Outcome>) () -> {
                    ready.countDown();
                    fire.await(5, TimeUnit.SECONDS);
                    try {
                        staff.issue(staffId, request.id(), new IssueRequest(approved.version(), null));
                        return new Outcome(200, "");
                    } catch (DomainException rejection) {
                        return new Outcome(rejection.getStatus().value(), rejection.code());
                    }
                }),
                pool.submit((Callable<Outcome>) () -> {
                    ready.countDown();
                    fire.await(5, TimeUnit.SECONDS);
                    try {
                        staff.issue(staff2Id, request.id(), new IssueRequest(approved.version(), null));
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
        assertThat(wins).as("exactly one staff lane issues the copy").isEqualTo(1);
        Integer issued = jdbc.queryForObject(
                "SELECT COUNT(*) FROM library.\"Audit\""
                        + " WHERE \"entityType\" = 'REQUEST' AND \"entityId\" = :id"
                        + " AND \"action\" = 'ISSUED'",
                Map.of("id", request.id()), Integer.class);
        assertThat(issued).as("exactly one ISSUED transition recorded").isEqualTo(1);
        assertThat(copyStatus()).isEqualTo("ON_LOAN");
    }

    // ------------------------------------------------------------------
    // LIB-T04 on Postgres: two staff lanes racing the RETURN of one loan
    // — exactly one RETURNED row, copy AVAILABLE once, and the next hold
    // succeeds (stock never inflates or sticks).
    // ------------------------------------------------------------------

    @Test
    void concurrentReturnLeavesOneReturnedRowAndFreesCopyOnPostgres() throws Exception {
        LoanRequestResponse request = patrons.request(borrowerId,
                new BorrowRequest(copyId), "it-return-" + suffix);
        staff.approve(staffId, request.id(), request.version());
        LoanRequestResponse approved = staff.staffRequest(staffId, request.id());
        LoanRequestResponse issued = staff.issue(staffId, request.id(),
                new IssueRequest(approved.version(), null));

        ExecutorService pool = Executors.newFixedThreadPool(2);
        CountDownLatch ready = new CountDownLatch(2);
        CountDownLatch fire = new CountDownLatch(1);
        List<Future<Outcome>> futures = List.of(
                pool.submit((Callable<Outcome>) () -> {
                    ready.countDown();
                    fire.await(5, TimeUnit.SECONDS);
                    try {
                        staff.returnLoan(staffId, request.id(), issued.version());
                        return new Outcome(200, "");
                    } catch (DomainException rejection) {
                        return new Outcome(rejection.getStatus().value(), rejection.code());
                    }
                }),
                pool.submit((Callable<Outcome>) () -> {
                    ready.countDown();
                    fire.await(5, TimeUnit.SECONDS);
                    try {
                        staff.returnLoan(staff2Id, request.id(), issued.version());
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
        assertThat(wins).as("exactly one staff lane lands the return").isEqualTo(1);
        Integer returned = jdbc.queryForObject(
                "SELECT COUNT(*) FROM library.\"Audit\""
                        + " WHERE \"entityType\" = 'REQUEST' AND \"entityId\" = :id"
                        + " AND \"action\" = 'RETURNED'",
                Map.of("id", request.id()), Integer.class);
        assertThat(returned).as("exactly one RETURNED transition recorded").isEqualTo(1);
        assertThat(copyStatus()).isEqualTo("AVAILABLE");

        // The freed copy takes a fresh hold immediately — stock is real.
        String nextBorrower = borrowerId + "-next";
        seedUser(nextBorrower);
        LoanRequestResponse next = patrons.request(nextBorrower,
                new BorrowRequest(copyId), "it-after-return-" + suffix);
        assertThat(next.status()).isEqualTo("REQUESTED");
        assertThat(copyStatus()).isEqualTo("RESERVED");
    }

    private String copyStatus() {
        return jdbc.queryForObject(
                "SELECT \"status\" FROM library.\"Copy\" WHERE \"id\" = :id",
                Map.of("id", copyId), String.class);
    }

    private record Outcome(int status, String code) {
    }
}
