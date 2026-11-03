package io.campuscore.restfulapi.thesis;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyMap;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import io.campuscore.restfulapi.mail.config.MailConfig;
import io.campuscore.restfulapi.mail.service.EmailService;
import io.campuscore.restfulapi.mail.service.MailDispatchQueue;
import io.campuscore.restfulapi.thesis.service.ThesisMutationService;
import io.campuscore.restfulapi.thesis.service.ThesisNotificationService;
import io.micrometer.core.instrument.MeterRegistry;
import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/** Actual services/transactions and a private H2 database; failures are at the mail boundary or real inbox SQL. */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles({"test", "persistence"})
@TestPropertySource(properties = {
        "spring.datasource.url=jdbc:h2:mem:thesis_result_publication_fault;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1",
        "spring.datasource.username=sa",
        "spring.datasource.password=",
        "spring.flyway.enabled=true",
        "spring.flyway.locations=classpath:db/migration-h2",
        "mail.enabled=true",
        "spring.mail.host=127.0.0.1",
        "spring.mail.port=2525",
        "spring.mail.password=test-only-mocked-mail-boundary"
})
class ThesisResultPublicationFaultTest extends ThesisPublicationFixture {

    @MockitoBean
    private EmailService email;

    @Autowired
    private MockMvc mvc;

    @Autowired
    private MeterRegistry meterRegistry;

    @MockitoSpyBean
    private ThesisNotificationService notificationSpy;

    private final List<String> attempts = new CopyOnWriteArrayList<>();

    @BeforeEach
    void captureMailBoundary() {
        attempts.clear();
        doAnswer(invocation -> {
            attempts.add(invocation.getArgument(0));
            return null;
        }).when(email).sendHtmlEmail(anyString(), anyString(), anyString(), anyMap());
    }

    @Test
    void firstRecipientFailureDoesNotStopRemainingAttemptsOrUndoCommittedPublication() {
        AtomicInteger ordinal = new AtomicInteger();
        doAnswer(invocation -> {
            attempts.add(invocation.getArgument(0));
            if (ordinal.incrementAndGet() == 1) {
                throw new IllegalStateException("test-only-transport-fault");
            }
            return null;
        }).when(email).sendHtmlEmail(anyString(), anyString(), anyString(), anyMap());

        mutations.publishResults(roundId, admin());
        awaitMailIdle();

        assertThat(roundStatus()).isEqualTo("RESULTS_PUBLISHED");
        assertThat(inboxCount()).isEqualTo(6);
        assertThat(attempts).containsExactlyInAnyOrderElementsOf(eligibleAddresses());
        assertThat(ordinal).hasValue(6);
        observation("first-mail-failure", attempts.size());
    }

    @Test
    void actualInboxConstraintFailureDoesNotSuppressEmailOrUndoPublication() {
        // The repository and transaction remain real. Only this private H2
        // fixture rejects the inbox channel's SUCCESS inserts.
        jdbc.execute("ALTER TABLE notifications.notification ADD CONSTRAINT fixture_reject_results CHECK (type <> 'SUCCESS')");
        try {
            mutations.publishResults(roundId, admin());
            awaitMailIdle();

            assertThat(roundStatus()).isEqualTo("RESULTS_PUBLISHED");
            assertThat(inboxCount()).isZero();
            assertThat(attempts).containsExactlyInAnyOrderElementsOf(eligibleAddresses());
            observation("actual-inbox-sql-failure", attempts.size());
        } finally {
            jdbc.execute("ALTER TABLE notifications.notification DROP CONSTRAINT fixture_reject_results");
        }
    }

    @Test
    void failedInboxFanOutCanBeRetriedByAdminWithoutDuplicateNotices() throws Exception {
        var failures = meterRegistry.counter("campuscore.thesis.results.inbox.fanout.failures");
        double failuresBefore = failures.count();
        doThrow(new IllegalStateException("test-only-inbox-fault"))
                .doCallRealMethod()
                .when(notificationSpy).notifyResultsPublished(roundId);

        mutations.publishResults(roundId, admin());
        awaitMailIdle();

        assertThat(roundStatus()).isEqualTo("RESULTS_PUBLISHED");
        assertThat(inboxCount()).isZero();
        assertThat(failures.count()).isEqualTo(failuresBefore + 1);

        String retryPath = "/api/v1/thesis/rounds/" + roundId + "/publish-results/notifications/retry";
        mvc.perform(post(retryPath)
                        .with(ThesisAuthorityFixture.role(jdbc, "rmv-student-1", "STUDENT")))
                .andExpect(status().isForbidden());
        mvc.perform(post(retryPath)
                        .with(ThesisAuthorityFixture.role(jdbc, "rmv-admin", "ADMIN")))
                .andExpect(status().isNoContent());
        assertThat(inboxCount()).isEqualTo(6);

        mvc.perform(post(retryPath)
                        .with(ThesisAuthorityFixture.role(jdbc, "rmv-admin", "ADMIN")))
                .andExpect(status().isNoContent());
        assertThat(inboxCount()).isEqualTo(6);
    }

    @Test
    void retryDoesNotDuplicateLegacyResultNotices() throws Exception {
        Instant publishedAt = Instant.now();
        jdbc.update("UPDATE thesis.thesis_registration_round SET status='RESULTS_PUBLISHED', updated_at=? WHERE id=?",
                Timestamp.from(publishedAt), roundId);
        String title = "Kết quả khóa luận đã công bố";
        String message = "Kết quả đợt " + ROUND_NAME.trim()
                + " đã công bố. Mở trang khóa luận để xem điểm của bạn.";
        for (int student = 1; student <= 6; student++) {
            Instant createdAt = publishedAt.plusSeconds(1);
            jdbc.update("""
                    INSERT INTO notifications.notification
                        (id, user_id, title, message, type, link, is_read, read_at, created_at, updated_at)
                    VALUES (?, ?, ?, ?, 'SUCCESS', '/dashboard/thesis', FALSE, NULL, ?, ?)
                    """, "legacy-results-notice-" + student, "rmv-user-" + student,
                    title, message, Timestamp.from(createdAt), Timestamp.from(createdAt));
        }
        assertThat(inboxCount()).isEqualTo(6);

        mvc.perform(post("/api/v1/thesis/rounds/{id}/publish-results/notifications/retry", roundId)
                        .with(ThesisAuthorityFixture.role(jdbc, "rmv-admin", "ADMIN")))
                .andExpect(status().isNoContent());

        assertThat(inboxCount()).isEqualTo(6);
    }

    @Test
    void disabledMailCreatesInboxButNeverCallsTheMailBoundary() {
        mailConfig.setEnabled(false);

        mutations.publishResults(roundId, admin());

        assertThat(roundStatus()).isEqualTo("RESULTS_PUBLISHED");
        assertThat(inboxCount()).isEqualTo(6);
        assertThat(attempts).isEmpty();
        verifyNoInteractions(email);
        observation("mail-disabled", 0);
    }

    @Test
    void inactiveAccountsAndBlankAddressesAreExcludedWhileAudienceGuardsRemain() {
        jdbc.update("UPDATE campuscore_auth.\"User\" SET \"status\"='INACTIVE' WHERE \"id\"='rmv-user-2'");
        jdbc.update("UPDATE campuscore_auth.\"User\" SET \"email\"='  ' WHERE \"id\"='rmv-user-3'");

        mutations.publishResults(roundId, admin());
        awaitMailIdle();

        assertThat(roundStatus()).isEqualTo("RESULTS_PUBLISHED");
        assertThat(attempts).containsExactlyInAnyOrder(
                address(1), address(4), address(5), address(6));
        assertThat(inboxCount()).as("existing inbox audience is preserved").isEqualTo(6);
        observation("recipient-guards", attempts.size());
    }

    @Test
    void directEmailCallsOnUnpublishedOrMissingRoundDoNotReachTheMailBoundary() {
        assertThat(notifier.emailResultsPublished(roundId)).isZero();
        assertThat(notifier.emailResultsPublished(UUID.randomUUID())).isZero();

        assertThat(roundStatus()).isEqualTo("REGISTRATION_CLOSED");
        assertThat(inboxCount()).isZero();
        verifyNoInteractions(email);
        observation("direct-unpublished-mail", 0);
    }

    @Test
    void currentStudentCannotPublishThroughTheRealHttpSecurityChain() throws Exception {
        mvc.perform(post("/api/v1/thesis/rounds/{id}/publish-results", roundId)
                        .with(ThesisAuthorityFixture.student(jdbc, "rmv-student-1")))
                .andExpect(status().isForbidden());

        assertThat(roundStatus()).isEqualTo("REGISTRATION_CLOSED");
        assertThat(inboxCount()).isZero();
        verifyNoInteractions(email);
        observation("student-publication-forbidden", 0);
    }
}

/** Shared test-only rows. Both concrete suites supply their own isolated H2 URL. */
abstract class ThesisPublicationFixture {

    static final String ROUND_NAME = "Đợt bảo vệ <script>mailRoundProbe</script> & kiểm thử";

    @Autowired
    protected JdbcTemplate jdbc;
    @Autowired
    protected ThesisMutationService mutations;
    @Autowired
    protected ThesisNotificationService notifier;
    @Autowired
    protected PlatformTransactionManager transactionManager;
    @Autowired
    protected MailConfig mailConfig;
    @Autowired
    protected MailDispatchQueue mailDispatch;

    protected UUID roundId;

    @BeforeEach
    void seedPrivatePublicationRows() {
        mailConfig.setEnabled(true);
        jdbc.execute("CREATE SCHEMA IF NOT EXISTS notifications");
        jdbc.execute("""
                CREATE TABLE IF NOT EXISTS notifications.notification (
                    id VARCHAR(120) PRIMARY KEY, user_id VARCHAR(120) NOT NULL,
                    title VARCHAR(240) NOT NULL, message VARCHAR(2000) NOT NULL,
                    type VARCHAR(60) NOT NULL, link VARCHAR(500),
                    is_read BOOLEAN NOT NULL DEFAULT FALSE, read_at TIMESTAMP,
                    created_at TIMESTAMP NOT NULL, updated_at TIMESTAMP NOT NULL)
                """);
        clearPrivateRows();
        roundId = insertRound(ROUND_NAME);
        UUID firstTopic = insertTopic(roundId, "Nhóm thứ nhất", 8.57);
        UUID secondTopic = insertTopic(roundId, "Nhóm khác: điểm riêng tư", 6.13);
        insertGroup(roundId, firstTopic, "APPROVED", "SUBMITTED", 1);
        insertGroup(roundId, secondTopic, "APPROVED", "SUBMITTED", 4);
        // REJECTED stands in for "not emailed" the same way the old PENDING row
        // did; a real pending group now blocks publication by design.
        insertGroup(roundId, firstTopic, "REJECTED", "SUBMITTED", 7);
        insertGroup(roundId, firstTopic, "APPROVED", "CANCELLED", 10);
        UUID otherRound = insertRound("Đợt khác không nhận thư");
        insertGroup(otherRound, insertTopic(otherRound, "Đề tài đợt khác", 9.42), "APPROVED", "SUBMITTED", 13);
        insertUser("rmv-admin", "Quản trị");
        assertThat(roundStatus()).isEqualTo("REGISTRATION_CLOSED");
        assertThat(inboxCount()).isZero();
    }

    @AfterEach
    void restorePrivateFixture() {
        mailConfig.setEnabled(true);
        clearPrivateRows();
    }

    protected TransactionTemplate transaction() {
        return new TransactionTemplate(transactionManager);
    }

    protected Jwt admin() {
        return Jwt.withTokenValue("isolated-publication-fixture").header("alg", "none")
                .subject("rmv-admin").claim("roles", List.of("ADMIN")).build();
    }

    protected String roundStatus() {
        return jdbc.queryForObject("SELECT status FROM thesis.thesis_registration_round WHERE id=?", String.class, roundId);
    }

    protected int inboxCount() {
        return jdbc.queryForObject("SELECT COUNT(*) FROM notifications.notification", Integer.class);
    }

    protected static String address(int student) {
        return "rmv-user-" + student + "@fixture.test";
    }

    protected static List<String> eligibleAddresses() {
        return List.of(address(1), address(2), address(3), address(4), address(5), address(6));
    }

    protected static String givenName(int student) {
        return "Sinh viên " + student + " <img src=x onerror='mailNameProbe'>";
    }

    protected void observation(String checkpoint, int mailAttempts) {
        System.out.printf("RESULT_MAIL_OBSERVATION checkpoint=%s round=%s inbox=%d mailAttempts=%d%n",
                checkpoint, roundStatus(), inboxCount(), mailAttempts);
    }

    /** Mail runs on the bounded queue; tests observe the drained state, not the request return. */
    protected void awaitMailIdle() {
        assertThat(mailDispatch.awaitIdle(Duration.ofSeconds(20)))
                .as("mail dispatch queue drained")
                .isTrue();
    }

    private void clearPrivateRows() {
        // These contexts use dedicated in-memory databases, never a shared DB.
        jdbc.update("DELETE FROM notifications.notification");
        // thesis_group_report is ON DELETE RESTRICT -> delete reports before groups.
        jdbc.update("DELETE FROM thesis.thesis_group_report");
        jdbc.update("DELETE FROM thesis.thesis_group_member");
        jdbc.update("DELETE FROM thesis.thesis_group");
        jdbc.update("DELETE FROM thesis.thesis_topic_supervisor");
        jdbc.update("DELETE FROM thesis.thesis_topic");
        jdbc.update("DELETE FROM thesis.thesis_registration_round");
        jdbc.update("DELETE FROM campuscore_auth.\"UserRole\" WHERE \"userId\" LIKE 'rmv-%'");
        jdbc.update("DELETE FROM campuscore_auth.\"Student\" WHERE \"id\" LIKE 'rmv-%'");
        jdbc.update("DELETE FROM campuscore_auth.\"User\" WHERE \"id\" LIKE 'rmv-%'");
    }

    private UUID insertRound(String name) {
        UUID id = UUID.randomUUID();
        Instant now = Instant.now();
        jdbc.update("""
                INSERT INTO thesis.thesis_registration_round
                    (id, name, thesis_type, lecturer_submit_start, lecturer_submit_end,
                     registration_start, registration_end, gvpb_deadline, report_date, defense_date, status)
                VALUES (?, ?, 'KLTN', ?, ?, ?, ?, ?, ?, ?, 'REGISTRATION_CLOSED')
                """, id, name, Timestamp.from(now.minusSeconds(432_000)), Timestamp.from(now.minusSeconds(345_600)),
                Timestamp.from(now.minusSeconds(259_200)), Timestamp.from(now.minusSeconds(172_800)),
                Timestamp.from(now.minusSeconds(86_400)), Timestamp.from(now.minusSeconds(43_200)), Timestamp.from(now));
        return id;
    }

    private UUID insertTopic(UUID round, String title, double score) {
        UUID id = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO thesis.thesis_topic
                    (id, round_id, department_id, title, description, max_groups, status, created_by,
                     final_score, final_score_finalized_by, final_score_finalized_at, result_status)
                VALUES (?, ?, 'department-demo', ?, 'Private result mail fixture', 3, 'PUBLISHED',
                        'rmv-admin', ?, 'rmv-chair', CURRENT_TIMESTAMP, 'GRADED')
                """, id, round, title, score);
        return id;
    }

    private void insertGroup(UUID round, UUID topic, String approval, String status, int firstStudent) {
        UUID group = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO thesis.thesis_group (id, round_id, leader_student_id, topic_id, status, approval_status)
                VALUES (?, ?, ?, ?, ?, ?)
                """, group, round, "rmv-student-" + firstStudent, topic, status, approval);
        for (int order = 1; order <= 3; order++) {
            int number = firstStudent + order - 1;
            String user = "rmv-user-" + number;
            String student = "rmv-student-" + number;
            insertUser(user, givenName(number));
            jdbc.update("""
                    INSERT INTO campuscore_auth."Student"
                        ("id", "userId", "studentId", "curriculumId", "year", "admissionDate")
                    VALUES (?, ?, ?, 'curriculum-demo', 4, CURRENT_TIMESTAMP)
                    """, student, user, "RMV-" + number);
            jdbc.update("""
                    INSERT INTO thesis.thesis_group_member
                        (id, group_id, round_id, student_id, member_order, is_leader, active_participation)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    """, UUID.randomUUID(), group, round, student, order, order == 1, !"CANCELLED".equals(status));
        }
    }

    private void insertUser(String id, String firstName) {
        jdbc.update("""
                INSERT INTO campuscore_auth."User"
                    ("id", "email", "password", "firstName", "lastName", "status", "emailVerified",
                     "isSuperAdmin", "failedLoginAttempts", "createdAt", "updatedAt")
                VALUES (?, ?, 'test-password', ?, 'Trần', 'ACTIVE', TRUE, FALSE, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                """, id, id + "@fixture.test", firstName);
    }
}
