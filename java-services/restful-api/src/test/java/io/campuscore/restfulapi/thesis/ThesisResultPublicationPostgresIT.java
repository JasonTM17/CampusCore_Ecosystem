package io.campuscore.restfulapi.thesis;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doAnswer;

import io.campuscore.restfulapi.thesis.service.ThesisCouncilService;
import io.campuscore.restfulapi.thesis.service.ThesisMutationService;
import io.campuscore.restfulapi.web.DomainException;
import java.math.BigDecimal;
import java.net.URI;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIf;
import org.mockito.Mockito;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.jdbc.core.namedparam.SqlParameterSource;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;

/** Real PostgreSQL publication locking, V152 shape and disposition race coverage. */
@EnabledIf("postgresTargetConfigured")
@SpringBootTest(properties = {"spring.flyway.locations=classpath:db/migration", "deepseek.enabled=false"})
@ActiveProfiles({"test", "persistence"})
class ThesisResultPublicationPostgresIT {
    private static final int WAIT_SECONDS = 15;

    @Autowired private JdbcTemplate jdbc;
    @Autowired private ThesisMutationService mutations;
    @Autowired private ThesisCouncilService councils;
    @MockitoSpyBean private NamedParameterJdbcTemplate namedJdbc;

    private final Set<UUID> rounds = java.util.concurrent.ConcurrentHashMap.newKeySet();
    private final Map<UUID, String> roundPrefixes = new java.util.concurrent.ConcurrentHashMap<>();

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", () -> System.getenv("CAMPUSCORE_E2E_POSTGRES_URL"));
        registry.add("spring.datasource.username", () -> valueOr("CAMPUSCORE_E2E_POSTGRES_USER", "campuscore"));
        registry.add("spring.datasource.password", () -> valueOr("CAMPUSCORE_E2E_POSTGRES_PASSWORD", "campuscore"));
    }

    @BeforeEach
    void resetSpy() {
        Mockito.reset(namedJdbc);
    }

    @AfterEach
    void cleanFixtures() {
        for (UUID roundId : rounds) {
            String prefix = roundPrefixes.get(roundId);
            if (prefix == null) {
                prefix = prefixFor(roundId);
            }
            String prefixPattern = prefix == null ? null : prefix + "%";
            if (prefixPattern != null) {
                jdbc.update("DELETE FROM campuscore_audit.\"AdminAudit\" WHERE \"actorId\" LIKE ? "
                                + "OR \"entityId\" IN (SELECT CAST(id AS text) FROM thesis.thesis_topic WHERE created_by LIKE ?)",
                        prefixPattern, prefixPattern);
            }
            jdbc.update("DELETE FROM thesis.thesis_group_report WHERE round_id = ?", roundId);
            jdbc.update("DELETE FROM thesis.thesis_topic_score WHERE topic_id IN "
                    + "(SELECT id FROM thesis.thesis_topic WHERE round_id = ?)", roundId);
            jdbc.update("DELETE FROM thesis.thesis_council_topic WHERE topic_id IN "
                    + "(SELECT id FROM thesis.thesis_topic WHERE round_id = ?)", roundId);
            jdbc.update("DELETE FROM thesis.thesis_council_member WHERE council_id IN "
                    + "(SELECT id FROM thesis.thesis_council WHERE round_id = ?)", roundId);
            jdbc.update("DELETE FROM thesis.thesis_council WHERE round_id = ?", roundId);
            jdbc.update("UPDATE thesis.thesis_group SET approval_status = 'REJECTED' WHERE round_id = ?", roundId);
            jdbc.update("DELETE FROM thesis.thesis_group_member WHERE round_id = ?", roundId);
            jdbc.update("DELETE FROM thesis.thesis_group WHERE round_id = ?", roundId);
            jdbc.update("DELETE FROM thesis.thesis_topic_supervisor WHERE topic_id IN "
                    + "(SELECT id FROM thesis.thesis_topic WHERE round_id = ?)", roundId);
            jdbc.update("DELETE FROM thesis.thesis_topic WHERE round_id = ?", roundId);
            jdbc.update("DELETE FROM thesis.thesis_registration_round WHERE id = ?", roundId);
            if (prefixPattern != null) {
                jdbc.update("DELETE FROM campuscore_auth.\"Lecturer\" WHERE \"id\" LIKE ?", prefixPattern);
                jdbc.update("DELETE FROM campuscore_auth.\"Student\" WHERE \"id\" LIKE ?", prefixPattern);
                jdbc.update("DELETE FROM campuscore_auth.\"User\" WHERE \"id\" LIKE ?", prefixPattern);
            }
        }
        rounds.clear();
        roundPrefixes.clear();
    }

    @Test
    void publicationSerializesWithReviewerReplacementWithoutUsingStaleReviewer() throws Exception {
        Fixture fixture = fixture("reviewer-race", false, null);
        String publisherThread = "tdp-publisher-" + fixture.suffix();
        String replacementThread = "tdp-reviewer-" + fixture.suffix();
        RaceBarrier barrier = pauseWriterAtRoundLock(publisherThread, replacementThread);
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            Future<Throwable> publication = pool.submit(() -> {
                Thread.currentThread().setName(publisherThread);
                try {
                    mutations.publishResults(fixture.roundId(), governanceJwt(fixture));
                    return null;
                } catch (Throwable failure) {
                    return failure;
                }
            });
            assertThat(barrier.publisherLocked().await(WAIT_SECONDS, TimeUnit.SECONDS))
                    .as("publication holds the round lock before resolving reviewer evidence").isTrue();
            Future<Object> replacement = pool.submit(() -> {
                Thread.currentThread().setName(replacementThread);
                try {
                    return councils.assignReviewer(fixture.topicId(), fixture.replacementReviewer(),
                            governanceJwt(fixture));
                } catch (Throwable failure) {
                    return failure;
                }
            });
            assertCompetitorBlocked(barrier, "reviewer replacement must wait behind publication");
            barrier.releasePublisher().countDown();

            Throwable publishFailure = publication.get(WAIT_SECONDS, TimeUnit.SECONDS);
            assertThat(publishFailure).isInstanceOf(DomainException.class);
            assertThat(((DomainException) publishFailure).code()).isEqualTo("RESULTS_NOT_READY");
            Object replacementResult = replacement.get(WAIT_SECONDS, TimeUnit.SECONDS);
            assertThat(replacementResult).isNotInstanceOf(Throwable.class);
            assertThat(jdbc.queryForObject("SELECT gvpb_lecturer_id FROM thesis.thesis_topic WHERE id = ?",
                    String.class, fixture.topicId())).isEqualTo(fixture.replacementReviewer());
            assertThat(jdbc.queryForObject("SELECT status FROM thesis.thesis_registration_round WHERE id = ?",
                    String.class, fixture.roundId())).isEqualTo("REGISTRATION_CLOSED");
            assertThat(dispositionAuditCount(fixture.topicId())).isZero();
        } finally {
            barrier.releasePublisher().countDown();
            pool.shutdownNow();
            assertThat(pool.awaitTermination(WAIT_SECONDS, TimeUnit.SECONDS)).isTrue();
        }
    }

    @Test
    void publicationSerializesWithChairFinalizationAndKeepsNonQualifyingScoreUnfinalized() throws Exception {
        Fixture fixture = fixture("chair-race", true, new BigDecimal("4.90"));
        String publisherThread = "tdp-publisher-" + fixture.suffix();
        String chairThread = "tdp-chair-" + fixture.suffix();
        RaceBarrier barrier = pauseWriterAtRoundLock(publisherThread, chairThread);
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            Future<Throwable> publication = pool.submit(() -> {
                Thread.currentThread().setName(publisherThread);
                try {
                    mutations.publishResults(fixture.roundId(), governanceJwt(fixture));
                    return null;
                } catch (Throwable failure) {
                    return failure;
                }
            });
            assertThat(barrier.publisherLocked().await(WAIT_SECONDS, TimeUnit.SECONDS))
                    .as("publication holds the round lock before classification").isTrue();
            Future<Object> finalize = pool.submit(() -> {
                Thread.currentThread().setName(chairThread);
                try {
                    return councils.finalizeScores(fixture.councilId(), fixture.topicId(),
                            lecturerJwt(fixture, fixture.chair()));
                } catch (Throwable failure) {
                    return failure;
                }
            });
            assertCompetitorBlocked(barrier, "chair finalization must wait behind publication");
            barrier.releasePublisher().countDown();

            assertThat(publication.get(WAIT_SECONDS, TimeUnit.SECONDS)).isNull();
            Object finalizeResult = finalize.get(WAIT_SECONDS, TimeUnit.SECONDS);
            assertThat(finalizeResult).isInstanceOf(DomainException.class);
            assertThat(((DomainException) finalizeResult).code()).isEqualTo("ROUND_STATE_CONFLICT");
            assertThat(jdbc.queryForObject("SELECT status FROM thesis.thesis_registration_round WHERE id = ?",
                    String.class, fixture.roundId())).isEqualTo("RESULTS_PUBLISHED");
            assertThat(jdbc.queryForObject("SELECT result_status FROM thesis.thesis_topic WHERE id = ?",
                    String.class, fixture.topicId())).isEqualTo("NOT_QUALIFIED");
            assertThat(jdbc.queryForObject("SELECT final_score FROM thesis.thesis_topic WHERE id = ?",
                    Object.class, fixture.topicId())).isNull();
            assertThat(count("SELECT COUNT(*) FROM thesis.thesis_topic_score WHERE topic_id = ? AND component = 'DEFENSE'",
                    fixture.topicId())).isEqualTo(3);
            assertThat(dispositionAuditCount(fixture.topicId())).isEqualTo(1);
            assertThat(count("SELECT COUNT(*) FROM campuscore_audit.\"AdminAudit\" "
                    + "WHERE \"entityId\" = ? AND \"action\" = 'COUNCIL_SCORE_FINALIZED'",
                    fixture.topicId().toString())).isZero();
        } finally {
            barrier.releasePublisher().countDown();
            pool.shutdownNow();
            assertThat(pool.awaitTermination(WAIT_SECONDS, TimeUnit.SECONDS)).isTrue();
        }
    }

    @Test
    void failedPublicationRollsBackDispositionBeforeWaitingGroupCanBeApproved() throws Exception {
        Fixture fixture = fixture("approval-race", false, new BigDecimal("4.50"));
        TopicGroup pending = addPendingGroup(fixture, "pending");
        String publisherThread = "tdp-publisher-" + fixture.suffix();
        String approvalThread = "tdp-approval-" + fixture.suffix();
        RaceBarrier barrier = pauseWriterAtRoundLock(publisherThread, approvalThread);
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            Future<Throwable> publication = pool.submit(() -> {
                Thread.currentThread().setName(publisherThread);
                try {
                    mutations.publishResults(fixture.roundId(), governanceJwt(fixture));
                    return null;
                } catch (Throwable failure) {
                    return failure;
                }
            });
            assertThat(barrier.publisherLocked().await(WAIT_SECONDS, TimeUnit.SECONDS))
                    .as("publication holds the round lock before checking submitted groups").isTrue();
            Future<Throwable> approval = pool.submit(() -> {
                Thread.currentThread().setName(approvalThread);
                try {
                    mutations.approveGroup(pending.groupId(), adminJwt(fixture));
                    return null;
                } catch (Throwable failure) {
                    return failure;
                }
            });
            assertCompetitorBlocked(barrier, "group approval must wait behind publication");
            barrier.releasePublisher().countDown();

            Throwable publishFailure = publication.get(WAIT_SECONDS, TimeUnit.SECONDS);
            assertThat(publishFailure).isInstanceOf(DomainException.class);
            assertThat(((DomainException) publishFailure).code()).isEqualTo("GROUPS_PENDING_APPROVAL");
            assertThat(approval.get(WAIT_SECONDS, TimeUnit.SECONDS)).isNull();
            assertThat(jdbc.queryForObject("SELECT approval_status FROM thesis.thesis_group WHERE id = ?",
                    String.class, pending.groupId())).isEqualTo("APPROVED");
            assertThat(jdbc.queryForObject("SELECT status FROM thesis.thesis_registration_round WHERE id = ?",
                    String.class, fixture.roundId())).isEqualTo("REGISTRATION_CLOSED");
            assertThat(jdbc.queryForObject("SELECT result_status FROM thesis.thesis_topic WHERE id = ?",
                    String.class, fixture.topicId())).isNull();
            assertThat(dispositionAuditCount(fixture.topicId())).isZero();
        } finally {
            barrier.releasePublisher().countDown();
            pool.shutdownNow();
            assertThat(pool.awaitTermination(WAIT_SECONDS, TimeUnit.SECONDS)).isTrue();
        }
    }

    @Test
    void postgresDispositionCheckRejectsInvalidAndNullBypassShapes() {
        Fixture fixture = fixture("shape", false, null);
        assertThatThrownBy(() -> jdbc.update("UPDATE thesis.thesis_topic SET result_status = 'NOT_QUALIFIED', "
                        + "result_reason = 'GVPB_BELOW_THRESHOLD', result_resolved_by = NULL, "
                        + "result_resolved_at = CURRENT_TIMESTAMP WHERE id = ?", fixture.topicId()))
                .isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(() -> jdbc.update("UPDATE thesis.thesis_topic SET result_status = NULL, "
                        + "result_reason = 'GVPB_BELOW_THRESHOLD' WHERE id = ?", fixture.topicId()))
                .isInstanceOf(DataIntegrityViolationException.class);
    }

    @Test
    void postgresDispositionCheckRejectsInvalidResultShapes() {
        Fixture fixture = fixture("invalid-shapes", false, null);
        assertCheckViolation(() -> jdbc.update("UPDATE thesis.thesis_topic SET final_score = 7.00, "
                        + "result_status = 'NOT_QUALIFIED', result_reason = 'GVPB_BELOW_THRESHOLD', "
                        + "result_resolved_by = ?, result_resolved_at = CURRENT_TIMESTAMP WHERE id = ?",
                fixture.reviewer(), fixture.topicId()));
        assertCheckViolation(() -> jdbc.update("UPDATE thesis.thesis_topic SET final_score = NULL, "
                        + "result_status = 'NOT_QUALIFIED', result_reason = 'GVPB_BELOW_THRESHOLD', "
                        + "result_resolved_by = ' ', result_resolved_at = CURRENT_TIMESTAMP WHERE id = ?",
                fixture.topicId()));
        assertCheckViolation(() -> jdbc.update("UPDATE thesis.thesis_topic SET final_score = 7.00, "
                        + "result_status = 'GRADED', result_reason = 'GVPB_BELOW_THRESHOLD', "
                        + "result_resolved_by = NULL, result_resolved_at = NULL WHERE id = ?",
                fixture.topicId()));
        assertCheckViolation(() -> jdbc.update("UPDATE thesis.thesis_topic SET result_status = 'UNKNOWN', "
                        + "result_reason = NULL, result_resolved_by = NULL, result_resolved_at = NULL "
                        + "WHERE id = ?", fixture.topicId()));
    }

    @Test
    void fixtureCleanupIsIdempotentWhenRegistrationRoundIsAbsent() {
        String prefix = "tdp-" + UUID.randomUUID().toString().replace("-", "").substring(0, 12);
        UUID roundId = UUID.randomUUID();
        rounds.add(roundId);
        roundPrefixes.put(roundId, prefix);
        insertLecturer(prefix + "-owner");

        cleanFixtures();
        cleanFixtures();

        assertThat(count("SELECT COUNT(*) FROM campuscore_auth.\"User\" WHERE \"id\" LIKE ?",
                prefix + "%")).isZero();
    }

    private Fixture fixture(String tag, boolean withCouncil, BigDecimal counterScore) {
        String suffix = UUID.randomUUID().toString().replace("-", "").substring(0, 12);
        String prefix = "tdp-" + suffix;
        Instant now = Instant.now();
        UUID roundId = UUID.randomUUID();
        rounds.add(roundId);
        roundPrefixes.put(roundId, prefix);
        String dean = prefix + "-dean";
        String chair = prefix + "-chair";
        String secretary = prefix + "-secretary";
        String member = prefix + "-member";
        String reviewer = prefix + "-reviewer";
        String replacement = prefix + "-replacement";
        insertLecturer(dean);
        insertLecturer(chair);
        insertLecturer(secretary);
        insertLecturer(member);
        insertLecturer(reviewer);
        insertLecturer(replacement);

        jdbc.update("INSERT INTO thesis.thesis_registration_round "
                        + "(id, name, thesis_type, lecturer_submit_start, lecturer_submit_end, "
                        + "registration_start, registration_end, gvpb_deadline, status) "
                        + "VALUES (?, ?, 'KLTN', ?, ?, ?, ?, ?, 'REGISTRATION_CLOSED')",
                roundId, "Thesis result disposition " + prefix,
                Timestamp.from(now.minusSeconds(7_200)), Timestamp.from(now.minusSeconds(3_600)),
                Timestamp.from(now.minusSeconds(3_600)), Timestamp.from(now.minusSeconds(60)),
                Timestamp.from(now.minusSeconds(30)));
        UUID topicId = insertTopic(roundId, prefix + "-topic", reviewer);
        UUID groupId = insertGroup(roundId, topicId, prefix + "-group", true);
        UUID councilId = null;
        if (withCouncil) {
            councilId = UUID.randomUUID();
            jdbc.update("INSERT INTO thesis.thesis_council (id, round_id, name, status, created_by) "
                            + "VALUES (?, ?, ?, 'ACTIVE', ?)",
                    councilId, roundId, prefix + " council", userId(dean));
            seat(councilId, chair, "CHAIR");
            seat(councilId, secretary, "SECRETARY");
            seat(councilId, member, "MEMBER");
            jdbc.update("INSERT INTO thesis.thesis_council_topic (id, council_id, topic_id, assigned_by) "
                            + "VALUES (?, ?, ?, ?)",
                    UUID.randomUUID(), councilId, topicId, userId(dean));
            if (counterScore != null) {
                insertScore(topicId, null, reviewer, "GVPB", counterScore);
                insertScore(topicId, councilId, chair, "DEFENSE", new BigDecimal("7.00"));
                insertScore(topicId, councilId, secretary, "DEFENSE", new BigDecimal("8.00"));
                insertScore(topicId, councilId, member, "DEFENSE", new BigDecimal("9.00"));
            }
        } else if (counterScore != null) {
            insertScore(topicId, null, reviewer, "GVPB", counterScore);
        }
        return new Fixture(prefix, suffix, roundId, topicId, groupId, councilId,
                reviewer, replacement, chair, secretary, member, dean);
    }

    private TopicGroup addPendingGroup(Fixture fixture, String tag) {
        String prefix = fixture.prefix() + "-" + tag;
        UUID topicId = insertTopic(fixture.roundId(), prefix + "-topic", null);
        UUID groupId = insertGroup(fixture.roundId(), topicId, prefix + "-group", false);
        return new TopicGroup(topicId, groupId);
    }

    private UUID insertTopic(UUID roundId, String title, String reviewer) {
        UUID topicId = UUID.randomUUID();
        String createdBy = title.substring(0, title.lastIndexOf('-')) + "-owner";
        insertLecturer(createdBy);
        jdbc.update("INSERT INTO thesis.thesis_topic "
                        + "(id, round_id, department_id, title, description, max_groups, status, created_by, gvpb_lecturer_id) "
                        + "VALUES (?, ?, 'department-demo', ?, 'disposition race fixture', 2, 'PUBLISHED', ?, ?)",
                topicId, roundId, title, userId(createdBy), reviewer);
        return topicId;
    }

    private UUID insertGroup(UUID roundId, UUID topicId, String tag, boolean approved) {
        UUID groupId = UUID.randomUUID();
        String leader = tag + "-leader";
        jdbc.update("INSERT INTO thesis.thesis_group "
                        + "(id, round_id, leader_student_id, topic_id, status, approval_status) "
                        + "VALUES (?, ?, ?, ?, 'SUBMITTED', 'PENDING')",
                groupId, roundId, leader, topicId);
        for (int index = 1; index <= 3; index++) {
            String student = index == 1 ? leader : tag + "-student-" + index;
            jdbc.update("INSERT INTO thesis.thesis_group_member "
                            + "(id, group_id, round_id, student_id, member_order, is_leader) "
                            + "VALUES (?, ?, ?, ?, ?, ?)",
                    UUID.randomUUID(), groupId, roundId, student, index, index == 1);
        }
        if (approved) {
            jdbc.update("UPDATE thesis.thesis_group SET approval_status = 'APPROVED' WHERE id = ?", groupId);
        }
        return groupId;
    }

    private void insertScore(UUID topicId, UUID councilId, String lecturer, String component, BigDecimal score) {
        jdbc.update("INSERT INTO thesis.thesis_topic_score "
                        + "(id, topic_id, council_id, lecturer_id, component, score) VALUES (?, ?, ?, ?, ?, ?)",
                UUID.randomUUID(), topicId, councilId, lecturer, component, score);
    }

    private void seat(UUID councilId, String lecturerId, String role) {
        jdbc.update("INSERT INTO thesis.thesis_council_member (id, council_id, lecturer_id, member_role) "
                        + "VALUES (?, ?, ?, ?)",
                UUID.randomUUID(), councilId, lecturerId, role);
    }

    private RaceBarrier pauseWriterAtRoundLock(String publisherThread, String competitorThread) {
        CountDownLatch publisherLocked = new CountDownLatch(1);
        CountDownLatch competitorAtLock = new CountDownLatch(1);
        CountDownLatch releasePublisher = new CountDownLatch(1);
        AtomicInteger publisherPid = new AtomicInteger();
        AtomicInteger competitorPid = new AtomicInteger();
        doAnswer(invocation -> {
            String sql = invocation.getArgument(0, String.class);
            boolean roundLock = sql.contains("thesis_registration_round") && sql.contains("FOR UPDATE");
            String thread = Thread.currentThread().getName();
            if (roundLock && publisherThread.equals(thread)) {
                Object result = invocation.callRealMethod();
                publisherPid.set(backendPid());
                publisherLocked.countDown();
                if (!releasePublisher.await(WAIT_SECONDS, TimeUnit.SECONDS)) {
                    throw new IllegalStateException("publication barrier timed out");
                }
                return result;
            }
            if (roundLock && competitorThread.equals(thread)) {
                competitorPid.set(backendPid());
                competitorAtLock.countDown();
            }
            return invocation.callRealMethod();
        }).when(namedJdbc).queryForMap(anyString(), org.mockito.ArgumentMatchers.any(SqlParameterSource.class));
        return new RaceBarrier(publisherLocked, competitorAtLock, releasePublisher, publisherPid, competitorPid);
    }

    private void assertCompetitorBlocked(RaceBarrier barrier, String because) throws Exception {
        assertThat(barrier.competitorAtLock().await(WAIT_SECONDS, TimeUnit.SECONDS))
                .as("the competing operation reaches the round lock").isTrue();
        assertThat(barrier.publisherPid().get()).isPositive();
        assertThat(barrier.competitorPid().get()).isPositive();
        boolean blocked = false;
        for (int attempt = 0; attempt < WAIT_SECONDS * 10; attempt++) {
            Boolean waiting = jdbc.queryForObject(
                    "SELECT EXISTS(SELECT 1 FROM unnest(pg_blocking_pids(?)) blocker WHERE blocker = ?)",
                    Boolean.class, barrier.competitorPid().get(), barrier.publisherPid().get());
            if (Boolean.TRUE.equals(waiting)) {
                blocked = true;
                break;
            }
            Thread.sleep(100);
        }
        assertThat(blocked).as(because).isTrue();
    }

    private int backendPid() {
        Integer pid = jdbc.queryForObject("SELECT pg_backend_pid()", Integer.class);
        return pid == null ? -1 : pid;
    }

    private int dispositionAuditCount(UUID topicId) {
        return count("SELECT COUNT(*) FROM campuscore_audit.\"AdminAudit\" "
                + "WHERE \"entityId\" = ? AND \"action\" = 'THESIS_RESULT_DISPOSITION_RESOLVED'",
                topicId.toString());
    }

    private int count(String sql, Object... args) {
        Integer count = jdbc.queryForObject(sql, Integer.class, args);
        return count == null ? 0 : count;
    }

    private void assertCheckViolation(Runnable update) {
        assertThatThrownBy(update::run)
                .isInstanceOf(DataIntegrityViolationException.class)
                .satisfies(failure -> {
                    Throwable cause = failure;
                    while (cause != null && !(cause instanceof SQLException)) {
                        cause = cause.getCause();
                    }
                    assertThat(cause).isInstanceOf(SQLException.class);
                    assertThat(((SQLException) cause).getSQLState()).isEqualTo("23514");
                });
    }

    private void insertLecturer(String lecturerId) {
        String userId = userId(lecturerId);
        jdbc.update("INSERT INTO campuscore_auth.\"User\" "
                        + "(\"id\", \"email\", \"password\", \"firstName\", \"lastName\", \"status\", "
                        + "\"emailVerified\", \"isSuperAdmin\", \"failedLoginAttempts\", \"createdAt\", \"updatedAt\") "
                        + "VALUES (?, ?, 'test-password', 'Race', 'Actor', 'ACTIVE', FALSE, FALSE, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)",
                userId, userId + "@test.invalid");
        jdbc.update("INSERT INTO campuscore_auth.\"Lecturer\" "
                        + "(\"id\", \"userId\", \"departmentId\", \"employeeId\", \"isActive\") "
                        + "VALUES (?, ?, 'department-demo', ?, TRUE)",
                lecturerId, userId, lecturerId);
    }

    private static String userId(String lecturerId) { return lecturerId + "-user"; }

    private Jwt governanceJwt(Fixture fixture) {
        return Jwt.withTokenValue("test").header("alg", "none").subject(userId(fixture.dean()))
                .claim("roles", List.of("TRUONG_KHOA")).claim("lecturerId", fixture.dean()).build();
    }

    private Jwt adminJwt(Fixture fixture) {
        return Jwt.withTokenValue("test").header("alg", "none").subject(userId(fixture.dean()))
                .claim("roles", List.of("ADMIN")).claim("lecturerId", fixture.dean()).build();
    }

    private Jwt lecturerJwt(Fixture fixture, String lecturerId) {
        return Jwt.withTokenValue("test").header("alg", "none").subject(userId(lecturerId))
                .claim("roles", List.of("LECTURER")).claim("lecturerId", lecturerId).build();
    }

    private String prefixFor(UUID roundId) {
        List<String> names = jdbc.queryForList("SELECT name FROM thesis.thesis_registration_round WHERE id = ?",
                String.class, roundId);
        return names.isEmpty() ? null : names.get(0).replace("Thesis result disposition ", "");
    }

    private static String valueOr(String key, String fallback) {
        String value = System.getenv(key);
        return value == null || value.isBlank() ? fallback : value;
    }

    static boolean postgresTargetConfigured() {
        String url = System.getenv("CAMPUSCORE_E2E_POSTGRES_URL");
        if (url == null || !url.startsWith("jdbc:postgresql:")) return false;
        try {
            URI uri = URI.create(url.substring("jdbc:".length()));
            String host = uri.getHost();
            boolean loopback = "localhost".equalsIgnoreCase(host) || "127.0.0.1".equals(host)
                    || "::1".equals(host) || "[::1]".equals(host);
            String database = uri.getPath() == null ? "" : uri.getPath().replaceFirst("^/", "");
            return loopback && database.startsWith("campuscore_restful_e2e");
        } catch (IllegalArgumentException exception) {
            return false;
        }
    }

    private record Fixture(String prefix, String suffix, UUID roundId, UUID topicId, UUID groupId,
            UUID councilId, String reviewer, String replacementReviewer, String chair, String secretary,
            String member, String dean) { }
    private record TopicGroup(UUID topicId, UUID groupId) { }
    private record RaceBarrier(CountDownLatch publisherLocked, CountDownLatch competitorAtLock,
            CountDownLatch releasePublisher, AtomicInteger publisherPid, AtomicInteger competitorPid) { }
}
