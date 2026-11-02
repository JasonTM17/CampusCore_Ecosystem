package io.campuscore.restfulapi.thesis;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyMap;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doAnswer;

import io.campuscore.restfulapi.mail.service.EmailService;
import io.campuscore.restfulapi.web.DomainException;
import java.time.Duration;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.HttpStatus;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.transaction.support.TransactionSynchronizationManager;

/**
 * Result publication over the actual mutation, notification, persistence and
 * transaction services with only the SMTP boundary replaced. A publication
 * must not wait for (or run inside) mail delivery: the fan-out is queued after
 * commit and the request stays bounded by database work.
 */
@SpringBootTest
@ActiveProfiles({"test", "persistence"})
@TestPropertySource(properties = {
        "spring.datasource.url=jdbc:h2:mem:thesis_result_publication_async;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1",
        "spring.datasource.username=sa",
        "spring.datasource.password=",
        "spring.flyway.enabled=true",
        "spring.flyway.locations=classpath:db/migration-h2",
        "mail.enabled=true",
        "spring.mail.host=127.0.0.1",
        "spring.mail.port=2525",
        "spring.mail.password=test-only-mail-boundary-mock"
})
class ThesisResultPublicationAsyncTest extends ThesisPublicationFixture {

    private static final int EXTRA_GROUPS = 40;
    private static final int EXTRA_RECIPIENTS = EXTRA_GROUPS * 3;
    private static final int LARGE_COHORT = 6 + EXTRA_RECIPIENTS;
    private static final Duration WAIT = Duration.ofSeconds(20);

    @MockitoBean
    private EmailService email;

    private final List<String> attempts = new CopyOnWriteArrayList<>();

    @BeforeEach
    void captureDeliveries() {
        attempts.clear();
        doAnswer(invocation -> {
            attempts.add(invocation.getArgument(0));
            return null;
        }).when(email).sendHtmlEmail(anyString(), anyString(), anyString(), anyMap());
    }

    @Test
    void largeCohortPublishesBeforeSlowMailDeliveryCompletes() throws Exception {
        seedLargeCohort();
        CountDownLatch firstDeliveryStarted = new CountDownLatch(1);
        CountDownLatch releaseFirstDelivery = new CountDownLatch(1);
        doAnswer(invocation -> {
            attempts.add(invocation.getArgument(0));
            if (firstDeliveryStarted.getCount() > 0) {
                firstDeliveryStarted.countDown();
                if (!releaseFirstDelivery.await(5, TimeUnit.SECONDS)) {
                    throw new IllegalStateException("test-only-release-timeout");
                }
            }
            return null;
        }).when(email).sendHtmlEmail(anyString(), anyString(), anyString(), anyMap());

        long startedAt = System.nanoTime();
        mutations.publishResults(roundId, admin());
        long elapsedMillis = (System.nanoTime() - startedAt) / 1_000_000;

        assertThat(roundStatus()).isEqualTo("RESULTS_PUBLISHED");
        assertThat(inboxCount()).isEqualTo(LARGE_COHORT);
        assertThat(elapsedMillis)
                .as("the publish request must not wait for SMTP delivery")
                .isLessThan(2_000);
        assertThat(firstDeliveryStarted.await(5, TimeUnit.SECONDS))
                .as("mail delivery starts in the background").isTrue();

        releaseFirstDelivery.countDown();
        awaitAttempts(LARGE_COHORT);
        assertThat(attempts).hasSize(LARGE_COHORT);
    }

    @Test
    void mailRunsAfterCommitOutsideThePublishingTransaction() throws Exception {
        AtomicReference<Boolean> transactionActive = new AtomicReference<>();
        AtomicReference<String> roundStatusSeenBySender = new AtomicReference<>();
        CountDownLatch firstDeliveryStarted = new CountDownLatch(1);
        CountDownLatch releaseFirstDelivery = new CountDownLatch(1);
        doAnswer(invocation -> {
            attempts.add(invocation.getArgument(0));
            if (firstDeliveryStarted.getCount() > 0) {
                transactionActive.set(TransactionSynchronizationManager.isActualTransactionActive());
                roundStatusSeenBySender.set(jdbc.queryForObject(
                        "SELECT status FROM thesis.thesis_registration_round WHERE id = ?", String.class, roundId));
                firstDeliveryStarted.countDown();
                if (!releaseFirstDelivery.await(5, TimeUnit.SECONDS)) {
                    throw new IllegalStateException("test-only-release-timeout");
                }
            }
            return null;
        }).when(email).sendHtmlEmail(anyString(), anyString(), anyString(), anyMap());

        long startedAt = System.nanoTime();
        mutations.publishResults(roundId, admin());
        long elapsedMillis = (System.nanoTime() - startedAt) / 1_000_000;

        assertThat(firstDeliveryStarted.await(5, TimeUnit.SECONDS)).isTrue();
        assertThat(elapsedMillis)
                .as("the request returns while the mail worker is still sending")
                .isLessThan(2_000);
        assertThat(transactionActive.get())
                .as("no database transaction is active on the mail worker")
                .isFalse();
        assertThat(roundStatusSeenBySender.get())
                .as("the publication is committed before any mail is sent")
                .isEqualTo("RESULTS_PUBLISHED");

        releaseFirstDelivery.countDown();
        awaitAttempts(6);
        assertThat(attempts).hasSize(6);
    }

    @Test
    void failingRecipientDoesNotStopTheRestOrUndoPublication() {
        doAnswer(invocation -> {
            String address = invocation.getArgument(0);
            attempts.add(address);
            if (address(3).equals(address)) {
                throw new IllegalStateException("test-only-transport-fault");
            }
            return null;
        }).when(email).sendHtmlEmail(anyString(), anyString(), anyString(), anyMap());

        mutations.publishResults(roundId, admin());
        awaitAttempts(6);

        assertThat(roundStatus()).isEqualTo("RESULTS_PUBLISHED");
        assertThat(inboxCount()).isEqualTo(6);
        assertThat(attempts).containsExactlyInAnyOrderElementsOf(eligibleAddresses());
    }

    @Test
    void repeatedPublicationDoesNotResendMail() {
        mutations.publishResults(roundId, admin());
        awaitAttempts(6);

        assertThatThrownBy(() -> mutations.publishResults(roundId, admin()))
                .isInstanceOfSatisfying(DomainException.class, failure -> {
                    assertThat(failure.getStatus()).isEqualTo(HttpStatus.CONFLICT);
                    assertThat(failure.getCode()).isEqualTo("ROUND_STATE_CONFLICT");
                });
        awaitIdleQuietly();
        assertThat(attempts).hasSize(6);
        assertThat(inboxCount()).isEqualTo(6);
    }

    private void awaitAttempts(int expected) {
        long deadline = System.nanoTime() + WAIT.toNanos();
        while (attempts.size() < expected && System.nanoTime() < deadline) {
            try {
                Thread.sleep(10);
            } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
                break;
            }
        }
        assertThat(attempts).hasSize(expected);
    }

    private void awaitIdleQuietly() {
        // A duplicate publication registers no fan-out; leave a short window
        // for a late task from the first publication to surface if the
        // implementation wrongly queued one.
        long deadline = System.nanoTime() + Duration.ofMillis(500).toNanos();
        while (System.nanoTime() < deadline) {
            try {
                Thread.sleep(10);
            } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
                return;
            }
        }
    }

    private void seedLargeCohort() {
        UUID topicId = jdbc.queryForObject(
                "SELECT topic_id FROM thesis.thesis_group WHERE round_id = ? AND approval_status = 'APPROVED'"
                        + " AND status = 'SUBMITTED' AND topic_id IS NOT NULL LIMIT 1",
                UUID.class, roundId);
        for (int groupIndex = 0; groupIndex < EXTRA_GROUPS; groupIndex++) {
            UUID groupId = UUID.randomUUID();
            int firstStudent = 100 + groupIndex * 3;
            jdbc.update("""
                    INSERT INTO thesis.thesis_group
                        (id, round_id, leader_student_id, topic_id, status, approval_status)
                    VALUES (?, ?, ?, ?, 'SUBMITTED', 'APPROVED')
                    """, groupId, roundId, studentId(firstStudent), topicId);
            for (int member = 0; member < 3; member++) {
                int number = firstStudent + member;
                String userId = userId(number);
                String studentId = studentId(number);
                jdbc.update("""
                        INSERT INTO campuscore_auth."User"
                            ("id", "email", "password", "firstName", "lastName", "status", "emailVerified",
                             "isSuperAdmin", "failedLoginAttempts", "createdAt", "updatedAt")
                        VALUES (?, ?, 'test-password', ?, 'Trần', 'ACTIVE', TRUE, FALSE, 0,
                                CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                        """, userId, userId + "@fixture.test", givenName(number));
                jdbc.update("""
                        INSERT INTO campuscore_auth."Student"
                            ("id", "userId", "studentId", "curriculumId", "year", "admissionDate")
                        VALUES (?, ?, ?, 'curriculum-demo', 4, CURRENT_TIMESTAMP)
                        """, studentId, userId, "RMV-" + number);
                jdbc.update("""
                        INSERT INTO thesis.thesis_group_member
                            (id, group_id, round_id, student_id, member_order, is_leader, active_participation)
                        VALUES (?, ?, ?, ?, ?, ?, TRUE)
                        """, UUID.randomUUID(), groupId, roundId, studentId, member + 1, member == 0);
            }
        }
    }

    private static String userId(int number) {
        return "rmv-bulk-user-" + number;
    }

    private static String studentId(int number) {
        return "rmv-bulk-student-" + number;
    }
}
