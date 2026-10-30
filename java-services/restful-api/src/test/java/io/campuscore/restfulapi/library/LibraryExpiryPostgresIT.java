package io.campuscore.restfulapi.library;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.doCallRealMethod;

import io.campuscore.restfulapi.library.service.LibraryPatronService;
import io.campuscore.restfulapi.library.service.LibraryService;
import io.campuscore.restfulapi.library.web.LibraryDtos.BorrowRequest;
import io.campuscore.restfulapi.library.web.LibraryDtos.IssueRequest;
import io.campuscore.restfulapi.library.web.LibraryDtos.LoanRequestResponse;
import io.campuscore.restfulapi.notification.repository.NotificationWriteRepository;
import io.campuscore.restfulapi.notification.repository.NotificationWriteRepository.CreateNotificationCommand;
import io.campuscore.restfulapi.web.DomainException;
import java.net.URI;
import java.sql.Connection;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Supplier;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIf;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.dao.InvalidDataAccessApiUsageException;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/** Local disposable PostgreSQL proof for atomic expiry, lock contention and notification retry. */
@EnabledIf("postgresTargetConfigured")
@SpringBootTest(properties = {
        "spring.flyway.locations=classpath:db/migration",
        "spring.jpa.hibernate.ddl-auto=none",
        "spring.datasource.hikari.maximum-pool-size=8",
        "deepseek.enabled=false"
})
@ActiveProfiles({"test", "persistence"})
class LibraryExpiryPostgresIT {
    @Autowired private LibraryService staff;
    @Autowired private LibraryPatronService patrons;
    @Autowired private NamedParameterJdbcTemplate jdbc;
    @Autowired private PlatformTransactionManager transactions;
    @MockitoSpyBean private NotificationWriteRepository notifications;

    private String borrower;
    private String reader;
    private String desk;
    private String copy;
    private String hold;

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", () -> System.getenv("CAMPUSCORE_E2E_POSTGRES_URL"));
        registry.add("spring.datasource.username", () -> System.getenv("CAMPUSCORE_E2E_POSTGRES_USER"));
        registry.add("spring.datasource.password", () -> System.getenv("CAMPUSCORE_E2E_POSTGRES_PASSWORD"));
    }

    static boolean postgresTargetConfigured() {
        String value = System.getenv("CAMPUSCORE_E2E_POSTGRES_URL");
        if (value == null || !value.startsWith("jdbc:postgresql:")) {
            return false;
        }
        URI uri = URI.create(value.substring(5));
        return ("127.0.0.1".equals(uri.getHost()) || "localhost".equals(uri.getHost()))
                && "/campuscore_restful_e2e".equals(uri.getPath());
    }

    @BeforeEach
    void seed() {
        String suffix = UUID.randomUUID().toString();
        borrower = "owner-" + suffix;
        reader = "reader-" + suffix;
        desk = "desk-" + suffix;
        copy = "copy-" + suffix;
        for (String user : new String[]{borrower, reader, desk}) {
            jdbc.update("INSERT INTO campuscore_auth.\"User\""
                    + " (\"id\",\"email\",\"password\",\"firstName\",\"lastName\",\"status\")"
                    + " VALUES (:id,:email,'fixture','Test','User','ACTIVE')",
                    Map.of("id", user, "email", user + "@test.local"));
        }
        jdbc.update("INSERT INTO library.\"StaffGrant\" (\"id\",\"userId\",\"scope\",\"grantedBy\")"
                + " VALUES (:id,:id,'library',:id)", Map.of("id", desk));
        jdbc.update("INSERT INTO library.\"Title\" (\"id\",\"title\") VALUES (:id,'Expiry fixture')",
                Map.of("id", suffix));
        jdbc.update("INSERT INTO library.\"Copy\" (\"id\",\"titleId\",\"barcode\") VALUES (:id,:title,:id)",
                Map.of("id", copy, "title", suffix));
        var request = patrons.request(borrower, new BorrowRequest(copy), "initial-" + suffix);
        hold = request.id();
        staff.approve(desk, hold, request.version());
        jdbc.update("UPDATE library.\"LoanRequest\" SET \"expiresAt\" = TIMESTAMPTZ '2000-01-01 00:00:00Z'"
                + " WHERE \"id\" = :id", Map.of("id", hold));
    }

    @AfterEach
    void closeFixtureHolds() {
        doCallRealMethod().when(notifications).create(any(CreateNotificationCommand.class));
        if (copy == null) {
            return;
        }
        // Keep history while preventing failed tests from feeding the next global sweep.
        for (String id : jdbc.queryForList("SELECT \"id\" FROM library.\"LoanRequest\""
                + " WHERE \"copyId\" = :copy AND \"status\" IN ('REQUESTED','APPROVED')",
                Map.of("copy", copy), String.class)) {
            var request = staff.staffRequest(desk, id);
            staff.cancelStaff(desk, id, request.version(), "fixture cleanup");
        }
    }

    @Test
    void notificationFaultRollsBackExpiryAndRetryCompletesExactlyOnce() {
        int before = notificationsForBorrower();
        doAnswer(invocation -> {
            invocation.callRealMethod();
            throw new IllegalStateException("injected notification persistence fault");
        }).when(notifications).create(any(CreateNotificationCommand.class));
        assertThatThrownBy(() -> staff.expireOverdue(desk))
                .isInstanceOf(InvalidDataAccessApiUsageException.class)
                .hasRootCauseInstanceOf(IllegalStateException.class)
                .hasRootCauseMessage("injected notification persistence fault");
        assertThat(state(hold)).isEqualTo("APPROVED");
        assertThat(copyState()).isEqualTo("RESERVED");
        assertThat(expiryAudits()).isZero();
        assertThat(notificationsForBorrower()).isEqualTo(before);
        assertThat(patrons.myLoan(borrower, hold).version()).isEqualTo(2);
        doCallRealMethod().when(notifications).create(any(CreateNotificationCommand.class));
        assertThat(staff.expireOverdue(desk)).isEqualTo(1);
        assertThat(staff.expireOverdue(desk)).isZero();
        assertThat(state(hold)).isEqualTo("CANCELLED");
        assertThat(copyState()).isEqualTo("AVAILABLE");
        assertThat(expiryAudits()).isEqualTo(1);
        assertThat(notificationsForBorrower()).isEqualTo(before + 1);
        assertThat(patrons.myLoan(borrower, hold).version()).isEqualTo(3);
    }

    @Test
    void sweepSkipsLockedHoldThenRetriesWithoutDuplicateHistory() throws Exception {
        ExecutorService pool = Executors.newSingleThreadExecutor();
        try (Connection anchor = jdbc.getJdbcTemplate().getDataSource().getConnection()) {
            anchor.setAutoCommit(false);
            try (var lock = anchor.prepareStatement("SELECT \"id\" FROM library.\"LoanRequest\""
                    + " WHERE \"id\" = ? FOR UPDATE")) {
                lock.setString(1, hold);
                lock.executeQuery().close();
            }
            Future<Integer> sweeping = pool.submit(() -> staff.expireOverdue(desk));
            assertThat(sweeping.get(5, TimeUnit.SECONDS)).isZero();
            assertThat(state(hold)).isEqualTo("APPROVED");
            anchor.commit();
            assertThat(staff.expireOverdue(desk)).isEqualTo(1);
            assertThat(staff.expireOverdue(desk)).isZero();
            assertThat(expiryAudits()).isEqualTo(1);
            assertThat(copyState()).isEqualTo("AVAILABLE");
        } finally {
            pool.shutdownNow();
            assertThat(pool.awaitTermination(10, TimeUnit.SECONDS)).isTrue();
        }
    }

    @Test
    void issueWaitsForExpiryCommitAndNeverIssuesTheExpiredHold() throws Exception {
        contendWithSweep(() -> staff.issue(desk, hold, new IssueRequest(2, 14)), false);
    }

    @Test
    void replacementWaitsForExpiryCommitAndPreservesExactlyOneActiveHold() throws Exception {
        contendWithSweep(() -> patrons.request(reader, new BorrowRequest(copy), "replacement-" + copy), true);
    }

    private void contendWithSweep(Supplier<LoanRequestResponse> mutation, boolean replacement) throws Exception {
        CountDownLatch atNotification = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        doAnswer(invocation -> {
            Object result = invocation.callRealMethod();
            atNotification.countDown();
            assertThat(release.await(20, TimeUnit.SECONDS)).isTrue();
            return result;
        }).when(notifications).create(any(CreateNotificationCommand.class));
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            Future<Integer> sweep = pool.submit(() -> staff.expireOverdue(desk));
            assertThat(atNotification.await(10, TimeUnit.SECONDS)).isTrue();
            AtomicInteger backend = new AtomicInteger();
            Future<Outcome> contender = pool.submit(() -> {
                try {
                    var result = new TransactionTemplate(transactions).execute(status -> {
                        backend.set(jdbc.queryForObject("SELECT pg_backend_pid()", Map.of(), Integer.class));
                        return mutation.get();
                    });
                    return new Outcome(result, null);
                } catch (DomainException denial) {
                    return new Outcome(null, denial.code());
                }
            });
            awaitDatabaseLock(backend);
            assertThat(contender.isDone()).isFalse();
            release.countDown();
            assertThat(sweep.get(10, TimeUnit.SECONDS)).isEqualTo(1);
            Outcome outcome = contender.get(10, TimeUnit.SECONDS);
            if (replacement) {
                assertThat(outcome.denial()).isNull();
                assertThat(outcome.request().status()).isEqualTo("REQUESTED");
                assertThat(outcome.request().borrowerUserId()).isEqualTo(reader);
                assertThat(copyState()).isEqualTo("RESERVED");
            } else {
                assertThat(outcome.request()).isNull();
                assertThat(outcome.denial()).isEqualTo("REQUEST_TERMINAL");
                assertThat(copyState()).isEqualTo("AVAILABLE");
            }
            assertThat(state(hold)).isEqualTo("CANCELLED");
            assertThat(expiryAudits()).isEqualTo(1);
            assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM library.\"LoanRequest\""
                    + " WHERE \"copyId\" = :id AND \"status\" IN ('REQUESTED','APPROVED','ISSUED')",
                    Map.of("id", copy), Integer.class)).isEqualTo(replacement ? 1 : 0);
            assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM library.\"Audit\""
                    + " WHERE \"entityId\" = :id AND \"action\" = 'ISSUED'", Map.of("id", hold), Integer.class))
                    .isZero();
        } finally {
            release.countDown();
            pool.shutdownNow();
            assertThat(pool.awaitTermination(10, TimeUnit.SECONDS)).isTrue();
        }
    }

    private void awaitDatabaseLock(AtomicInteger backend) throws InterruptedException {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(10);
        while (System.nanoTime() < deadline) {
            if (backend.get() != 0 && Boolean.TRUE.equals(jdbc.queryForObject(
                    "SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE pid = :pid AND wait_event_type = 'Lock')",
                    Map.of("pid", backend.get()), Boolean.class))) {
                return;
            }
            Thread.sleep(10);
        }
        throw new AssertionError("contending transaction did not reach the database lock");
    }

    private String state(String id) {
        return jdbc.queryForObject("SELECT \"status\" FROM library.\"LoanRequest\" WHERE \"id\" = :id",
                Map.of("id", id), String.class);
    }

    private String copyState() {
        return jdbc.queryForObject("SELECT \"status\" FROM library.\"Copy\" WHERE \"id\" = :id",
                Map.of("id", copy), String.class);
    }

    private int expiryAudits() {
        return jdbc.queryForObject("SELECT COUNT(*) FROM library.\"Audit\""
                + " WHERE \"entityId\" = :id AND \"action\" = 'EXPIRED'", Map.of("id", hold), Integer.class);
    }

    private int notificationsForBorrower() {
        return jdbc.queryForObject("SELECT COUNT(*) FROM notifications.notification WHERE user_id = :id",
                Map.of("id", borrower), Integer.class);
    }

    private record Outcome(LoanRequestResponse request, String denial) {
    }
}
