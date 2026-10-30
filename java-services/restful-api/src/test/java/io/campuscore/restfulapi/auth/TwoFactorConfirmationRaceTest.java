package io.campuscore.restfulapi.auth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import io.campuscore.restfulapi.auth.repository.AuthUserRepository;
import io.campuscore.restfulapi.auth.repository.TwoFactorChallengeRepository;
import io.campuscore.restfulapi.auth.service.TwoFactorService;
import io.campuscore.restfulapi.exception.AppException;
import io.campuscore.restfulapi.mail.service.EmailService;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.HexFormat;
import java.util.UUID;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.jdbc.core.namedparam.SqlParameterSource;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;

@SpringBootTest(properties = {
        "spring.datasource.url=jdbc:h2:mem:two_factor_confirmation;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1"
})
@ActiveProfiles({"test", "persistence"})
class TwoFactorConfirmationRaceTest {
    @Autowired TwoFactorService service;
    @Autowired TwoFactorChallengeRepository challenges;
    @Autowired JdbcTemplate jdbc;
    @Autowired org.springframework.transaction.PlatformTransactionManager transactionManager;
    @MockitoSpyBean AuthUserRepository users;
    @MockitoSpyBean NamedParameterJdbcTemplate namedJdbc;
    @MockitoBean EmailService email;

    @AfterEach
    void clearBarriers() { reset(users, namedJdbc); }

    @Test
    void concurrentEnableConfirmsConsumeOnceBeforeChangingPosture() throws Exception { confirmRace(true); }

    @Test
    void concurrentDisableConfirmsConsumeOnceBeforeChangingPosture() throws Exception { confirmRace(false); }

    private void confirmRace(boolean enable) throws Exception {
        Fixture f = fixture(enable);
        var firstReady = new CountDownLatch(1);
        var secondReady = new CountDownLatch(1);
        var releaseFirst = new CountDownLatch(1);
        var releaseSecond = new CountDownLatch(1);
        var firstBoundary = new AtomicBoolean();
        var secondBoundary = new AtomicBoolean();
        org.mockito.stubbing.Answer<Object> atUserBoundary = invocation -> {
            String name = Thread.currentThread().getName();
            if (name.equals("confirm-first") && firstBoundary.compareAndSet(false, true)) {
                firstReady.countDown(); await(releaseFirst);
            }
            if (name.equals("confirm-second") && secondBoundary.compareAndSet(false, true)) {
                secondReady.countDown(); await(releaseSecond);
            }
            return invocation.callRealMethod();
        };
        doAnswer(atUserBoundary).when(users).lockUserRow(f.userId());
        doAnswer(atUserBoundary).when(users).setTwoFactorEnabled(eq(f.userId()), anyBoolean());
        var pool = Executors.newFixedThreadPool(2);
        try {
            var first = pool.submit(() -> confirm(f, enable, "confirm-first"));
            await(firstReady);
            var second = pool.submit(() -> confirm(f, enable, "confirm-second"));
            await(secondReady);
            releaseFirst.countDown();
            assertThat(first.get(15, TimeUnit.SECONDS)).isEqualTo("OK");
            releaseSecond.countDown();
            assertThat(second.get(15, TimeUnit.SECONDS)).isEqualTo("TWO_FACTOR_CHALLENGE_INVALID");
            assertPosture(f, enable, 1);
            assertThat(auditCount(f)).isEqualTo(1);
            verify(users, times(1)).deleteAllRefreshSessions(f.userId());
            assertThat(challenges.findById(f.challengeId()).orElseThrow().consumedAt()).isNotNull();
        } finally {
            releaseFirst.countDown(); releaseSecond.countDown(); pool.shutdownNow();
            assertThat(pool.awaitTermination(15, TimeUnit.SECONDS)).isTrue();
        }
    }

    @Test
    void zeroRowEnableConsumptionRejectsBeforeAnyPostureSideEffect() throws Exception { lostConsumption(true); }

    @Test
    void zeroRowDisableConsumptionRejectsBeforeAnyPostureSideEffect() throws Exception { lostConsumption(false); }

    private void lostConsumption(boolean enable) throws Exception {
        Fixture f = fixture(enable);
        doAnswer(invocation -> {
            String sql = invocation.getArgument(0);
            if (sql.contains("TwoFactorChallenge") && sql.contains("SET \"consumedAt\"")) return 0;
            return invocation.callRealMethod();
        }).when(namedJdbc).update(anyString(), any(SqlParameterSource.class));
        assertThat(confirm(f, enable, "consume-loser")).isEqualTo("TWO_FACTOR_CHALLENGE_INVALID");
        assertPosture(f, !enable, 0);
        assertThat(auditCount(f)).isZero();
        verify(users, never()).setTwoFactorEnabled(eq(f.userId()), anyBoolean());
        verify(users, never()).deleteAllRefreshSessions(f.userId());
    }

    @Test
    void queuedConfirmationCannotReuseChallengeAfterPasswordReplacement() throws Exception {
        staleAuthority(false);
    }

    @Test
    void queuedConfirmationCannotReuseChallengeAfterAccountRevocation() throws Exception {
        staleAuthority(true);
    }

    private void staleAuthority(boolean revoke) throws Exception {
        for (boolean enable : new boolean[] {true, false}) {
            Fixture f = fixture(enable);
            var ready = new CountDownLatch(1);
            var release = new CountDownLatch(1);
            var firstBoundary = new AtomicBoolean();
            org.mockito.stubbing.Answer<Object> boundary = invocation -> {
                if (Thread.currentThread().getName().equals("queued-confirm")
                        && firstBoundary.compareAndSet(false, true)) {
                    ready.countDown(); await(release);
                }
                return invocation.callRealMethod();
            };
            doAnswer(boundary).when(users).lockUserRow(f.userId());
            doAnswer(boundary).when(users).setTwoFactorEnabled(eq(f.userId()), anyBoolean());
            var pool = Executors.newSingleThreadExecutor();
            try {
                var pending = pool.submit(() -> confirm(f, enable, "queued-confirm"));
                await(ready);
                new org.springframework.transaction.support.TransactionTemplate(transactionManager)
                        .executeWithoutResult(status -> {
                            users.lockUserRow(f.userId());
                            if (revoke) users.bumpCredentialVersion(f.userId());
                            else users.changePassword(f.userId(), "replacement-synthetic-hash", Instant.now());
                        });
                release.countDown();
                assertThat(pending.get(15, TimeUnit.SECONDS)).isEqualTo("TWO_FACTOR_CHALLENGE_INVALID");
                assertPosture(f, !enable, 1);
                assertThat(auditCount(f)).isZero();
            } finally {
                release.countDown(); pool.shutdownNow();
                assertThat(pool.awaitTermination(15, TimeUnit.SECONDS)).isTrue();
            }
        }
    }

    @Test
    void wrongAttemptsCommitAndLockOutForBothPosturePurposes() throws Exception {
        for (boolean enable : new boolean[] {true, false}) {
            Fixture f = fixture(enable);
            for (int attempt = 1; attempt <= 5; attempt++) {
                int expected = attempt;
                assertThatThrownBy(() -> apply(f, enable, "wrong-synthetic-code"))
                        .isInstanceOfSatisfying(AppException.class, error -> assertThat(error.code())
                                .isEqualTo(expected == 5 ? "TWO_FACTOR_CODE_LOCKED" : "TWO_FACTOR_CODE_INVALID"));
                assertThat(challenges.findById(f.challengeId()).orElseThrow().attempts()).isEqualTo(attempt);
            }
            assertThat(confirm(f, enable, "locked-challenge")).isEqualTo("TWO_FACTOR_CHALLENGE_INVALID");
            assertPosture(f, !enable, 0);
            assertThat(auditCount(f)).isZero();
        }
    }

    @Test
    void accountIsRereadAfterUserLockBeforeVerifyingChallenge() throws Exception {
        Fixture f = fixture(true);
        doAnswer(invocation -> {
            Object result = invocation.callRealMethod();
            jdbc.update("UPDATE campuscore_auth.\"User\" SET status='INACTIVE' WHERE id=?", f.userId());
            return result;
        }).when(users).lockUserRow(f.userId());
        assertThatThrownBy(() -> apply(f, true, "314159"))
                .isInstanceOf(org.springframework.web.server.ResponseStatusException.class);
        assertPosture(f, false, 0);
        assertThat(challenges.findById(f.challengeId()).orElseThrow().consumedAt()).isNull();
        assertThat(auditCount(f)).isZero();
    }

    private String confirm(Fixture f, boolean enable, String threadName) {
        String previousName = Thread.currentThread().getName();
        Thread.currentThread().setName(threadName);
        try { apply(f, enable, "314159"); return "OK"; }
        catch (AppException rejection) { return rejection.code(); }
        finally { Thread.currentThread().setName(previousName); }
    }

    private void apply(Fixture f, boolean enable, String code) {
        if (enable) service.confirmEnable(f.userId(), f.challengeId(), code);
        else service.confirmDisable(f.userId(), f.challengeId(), code);
    }

    private Fixture fixture(boolean enable) throws Exception {
        String id = "confirmation-" + UUID.randomUUID();
        jdbc.update("INSERT INTO campuscore_auth.\"User\""
                + " (id,email,password,\"firstName\",\"lastName\",status,\"emailVerified\",\"twoFactorEnabled\")"
                + " VALUES (?,?,'synthetic-hash','Synthetic','Confirmation','ACTIVE',TRUE,?)",
                id, id + "@example.invalid", !enable);
        String hash = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                .digest((id + ":314159").getBytes(StandardCharsets.UTF_8)));
        String challenge = challenges.insert(id, enable ? "ENABLE" : "DISABLE", hash, Instant.now().plusSeconds(300));
        return new Fixture(id, challenge);
    }

    private void assertPosture(Fixture f, boolean enabled, long version) {
        assertThat(users.isTwoFactorEnabled(f.userId())).isEqualTo(enabled);
        assertThat(users.findById(f.userId()).orElseThrow().credentialVersion()).isEqualTo(version);
    }

    private int auditCount(Fixture f) {
        return jdbc.queryForObject("SELECT count(*) FROM campuscore_audit.\"AdminAudit\" WHERE \"actorId\"=?",
                Integer.class, f.userId());
    }

    private static void await(CountDownLatch barrier) throws InterruptedException {
        assertThat(barrier.await(15, TimeUnit.SECONDS)).as("confirmation schedule barrier").isTrue();
    }

    private record Fixture(String userId, String challengeId) { }
}
