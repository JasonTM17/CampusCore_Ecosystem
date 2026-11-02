package io.campuscore.restfulapi.thesis;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doAnswer;

import io.campuscore.restfulapi.events.web.ListPaging;
import io.campuscore.restfulapi.thesis.service.ThesisGroupReadService;
import io.campuscore.restfulapi.thesis.web.ThesisGroupReadDtos.GroupMemberResponse;
import io.campuscore.restfulapi.thesis.web.ThesisGroupReadDtos.GroupResponse;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIf;
import org.mockito.Mockito;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.jdbc.core.namedparam.SqlParameterSource;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;

/**
 * Real-PostgreSQL port of {@link ThesisGroupPagingContractTest}: Q13's single
 * deduplicated authorized set, scope-ranked ordering, exact totals, empty-page
 * short circuit and contact masking under the real Flyway schema.
 *
 * <p><b>Environment contract</b>: runs only when
 * {@code CAMPUSCORE_E2E_POSTGRES_URL} is a {@code jdbc:postgresql:} URL for a
 * disposable database. Optional user/password default to
 * {@code campuscore}/{@code postgres}. Fixtures use {@code tgb-} markers and
 * are deleted after every test.
 */
@EnabledIf("postgresTargetConfigured")
@SpringBootTest(properties = {
        "spring.flyway.locations=classpath:db/migration",
        "deepseek.enabled=false"
})
@ActiveProfiles({"test", "persistence"})
class ThesisGroupPagingPostgresIT {

    private static final String DEPT = "department-demo";
    private static final String FACULTY = "faculty-demo";
    private static final String SIBLING_DEPT = "tgb-dept-sibling";
    private static final String FOREIGN_DEPT = "tgb-dept-foreign";
    private static final String ROUND_NAME = "tgb-paging";
    private static final String DEAN = "tgb-dean";

    @Autowired
    private JdbcTemplate jdbc;

    @Autowired
    private ThesisGroupReadService groups;

    @MockitoSpyBean
    private NamedParameterJdbcTemplate namedJdbc;

    private UUID roundId;

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", () -> System.getenv("CAMPUSCORE_E2E_POSTGRES_URL"));
        registry.add("spring.datasource.username", () -> valueOr("CAMPUSCORE_E2E_POSTGRES_USER", "campuscore"));
        registry.add("spring.datasource.password", () -> valueOr("CAMPUSCORE_E2E_POSTGRES_PASSWORD", "postgres"));
    }

    @BeforeEach
    void prepare() {
        cleanFixtures();
        roundId = UUID.randomUUID();
        Instant now = Instant.now();
        jdbc.update("INSERT INTO thesis.thesis_registration_round "
                        + "(id, name, thesis_type, lecturer_submit_start, lecturer_submit_end, "
                        + "registration_start, registration_end, status) "
                        + "VALUES (?, ?, 'KLTN', ?, ?, ?, ?, 'REGISTRATION_OPEN')",
                roundId, ROUND_NAME,
                Timestamp.from(now.minusSeconds(7_200)), Timestamp.from(now.minusSeconds(3_600)),
                Timestamp.from(now.minusSeconds(3_600)), Timestamp.from(now.plusSeconds(3_600)));
        ensureDepartments();
        ensureLecturer(DEAN, "tgb-dean-user", DEPT);
    }

    @AfterEach
    void cleanFixtures() {
        // Groups first: deleting a cancelled group cascades its roster past the
        // read-only-roster trigger, which only fences direct member writes.
        jdbc.update("DELETE FROM thesis.thesis_group WHERE round_id IN "
                + "(SELECT id FROM thesis.thesis_registration_round WHERE name=?)", ROUND_NAME);
        jdbc.update("DELETE FROM thesis.thesis_group_member WHERE round_id IN "
                + "(SELECT id FROM thesis.thesis_registration_round WHERE name=?)", ROUND_NAME);
        jdbc.update("DELETE FROM thesis.thesis_topic_supervisor WHERE lecturer_id LIKE 'tgb-%' "
                + "OR topic_id IN (SELECT id FROM thesis.thesis_topic WHERE created_by LIKE 'tgb-%')");
        jdbc.update("DELETE FROM thesis.thesis_topic WHERE created_by LIKE 'tgb-%'");
        jdbc.update("DELETE FROM thesis.thesis_registration_round WHERE name=?", ROUND_NAME);
        jdbc.update("DELETE FROM campuscore_auth.\"Lecturer\" WHERE \"id\" LIKE 'tgb-%'");
        jdbc.update("DELETE FROM campuscore_auth.\"User\" WHERE \"id\" LIKE 'tgb-%'");
        jdbc.update("DELETE FROM academic.\"Curriculum\" WHERE \"id\" LIKE 'tgb-%'");
        jdbc.update("DELETE FROM academic.\"Department\" WHERE \"id\" LIKE 'tgb-%'");
        jdbc.update("DELETE FROM academic.\"Faculty\" WHERE \"id\" LIKE 'tgb-%'");
    }

    @Test
    void q13CountsAndPagesOneAuthorizedSetInScopeRankOrder() {
        UUID f1 = group(topic(DEPT, "tgb faculty one"), base(1), "SUBMITTED");
        UUID overlap = group(topic(DEPT, "tgb faculty overlap"), base(2), "SUBMITTED");
        UUID f2 = group(topic(DEPT, "tgb faculty two"), base(3), "SUBMITTED");
        UUID s1 = group(topic(FOREIGN_DEPT, "tgb outsider one"), base(4), "SUBMITTED");
        UUID s2 = group(topic(FOREIGN_DEPT, "tgb outsider two"), base(5), "SUBMITTED");
        group(topic(FOREIGN_DEPT, "tgb foreign unrelated"), base(6), "SUBMITTED");
        supervise(topicOf(overlap));
        supervise(topicOf(s1));
        supervise(topicOf(s2));
        externalMember(f1, "tgb-contact-f1@fixture.test");
        externalMember(f2, "tgb-contact-f2@fixture.test");
        externalMember(overlap, "tgb-contact-overlap@fixture.test");
        externalMember(s1, "tgb-contact-s1@fixture.test");
        externalMember(s2, "tgb-contact-s2@fixture.test");

        var first = page(0, 2, List.of("TRUONG_KHOA"), null, DEAN, "tgb-dean-user");
        assertThat(first.total()).isEqualTo(5L);
        assertThat(first.items()).extracting(GroupResponse::id)
                .containsExactly(f2, overlap);
        assertThat(first.items().get(0).members()).extracting(GroupMemberResponse::contact)
                .containsOnlyNulls();
        assertThat(first.items().get(1).members()).extracting(GroupMemberResponse::contact)
                .contains("tgb-contact-overlap@fixture.test");

        var second = page(1, 2, List.of("TRUONG_KHOA"), null, DEAN, "tgb-dean-user");
        assertThat(second.total()).isEqualTo(5L);
        assertThat(second.items()).extracting(GroupResponse::id).containsExactly(f1, s2);

        var third = page(2, 2, List.of("TRUONG_KHOA"), null, DEAN, "tgb-dean-user");
        assertThat(third.total()).isEqualTo(5L);
        assertThat(third.items()).extracting(GroupResponse::id).containsExactly(s1);

        var beyond = page(9, 2, List.of("TRUONG_KHOA"), null, DEAN, "tgb-dean-user");
        assertThat(beyond.total()).isEqualTo(5L);
        assertThat(beyond.items()).isEmpty();

        List<UUID> legacy = groups.list(roundId, List.of("TRUONG_KHOA"), null, DEAN, "tgb-dean-user")
                .stream().map(GroupResponse::id).toList();
        assertThat(legacy).containsExactly(f2, overlap, f1, s2, s1);
        assertThat(legacy).hasSize(5);
    }

    @Test
    void studentPagingKeepsNonCancelledBeforeCancelledOnRealPostgres() {
        String student = "tgb-student";
        UUID cancelledOlder = group(null, base(3), "SUBMITTED", student);
        member(cancelledOlder, student, true);
        cancel(cancelledOlder);
        UUID cancelledNewest = group(null, base(4), "SUBMITTED", student);
        member(cancelledNewest, student, true);
        cancel(cancelledNewest);
        UUID active = group(null, base(1), "SUBMITTED", student);
        member(active, student, true);

        List<UUID> paged = new ArrayList<>();
        for (int page = 0; page < 3; page++) {
            page(page, 1, List.of("STUDENT"), student, null, null).items()
                    .forEach(group -> paged.add(group.id()));
        }
        assertThat(paged).containsExactly(active, cancelledNewest, cancelledOlder);
        assertThat(page(0, 1, List.of("STUDENT"), student, null, null).total()).isEqualTo(3L);
    }

    @Test
    void facultyDerivationStillIncludesTopiclessMemberCurricula() {
        UUID topicless = group(null, base(1), "SUBMITTED", "tgb-member-own");
        member(topicless, "tgb-member-own", true);
        student("tgb-member-own", "curriculum-demo");
        UUID foreignTopicless = group(null, base(2), "SUBMITTED", "tgb-member-foreign");
        member(foreignTopicless, "tgb-member-foreign", true);
        student("tgb-member-foreign", "tgb-curr-foreign");

        var page = page(0, 10, List.of("TRUONG_KHOA"), null, DEAN, "tgb-dean-user");
        assertThat(page.total()).isEqualTo(1L);
        assertThat(page.items()).extracting(GroupResponse::id).containsExactly(topicless);
    }

    @Test
    void pagedLecturerReadStaysOnSupervisedTopics() {
        UUID supervised = topic(DEPT, "tgb lecturer supervised");
        supervise(supervised);
        group(supervised, base(1), "SUBMITTED");
        group(supervised, base(2), "SUBMITTED");
        group(topic(DEPT, "tgb lecturer other"), base(3), "SUBMITTED");

        var page = page(0, 1, List.of("LECTURER"), null, DEAN, null);
        assertThat(page.total()).isEqualTo(2L);
        assertThat(page.items()).hasSize(1);
    }

    @Test
    void countAndPageShareTheRepeatableReadSnapshot() throws Exception {
        for (int i = 1; i <= 5; i++) {
            group(null, base(i), "SUBMITTED");
        }
        CountDownLatch paused = new CountDownLatch(1);
        CountDownLatch resume = new CountDownLatch(1);
        doAnswer(call -> {
            String sql = call.getArgument(0);
            if ("tgb-snapshot".equals(Thread.currentThread().getName())
                    && sql.startsWith("SELECT COUNT(*) FROM thesis.thesis_group g")) {
                paused.countDown();
                if (!resume.await(15, TimeUnit.SECONDS)) {
                    throw new IllegalStateException("snapshot barrier timeout");
                }
            }
            return call.callRealMethod();
        }).when(namedJdbc).queryForObject(anyString(), any(SqlParameterSource.class), eq(Long.class));

        var pool = Executors.newSingleThreadExecutor();
        try {
            var worker = pool.submit(() -> {
                Thread.currentThread().setName("tgb-snapshot");
                try {
                    return page(0, 10, List.of("ADMIN"), null, null, null);
                } catch (RuntimeException failure) {
                    return failure;
                }
            });
            assertThat(paused.await(10, TimeUnit.SECONDS))
                    .as("paged read paused after its count, before its page query")
                    .isTrue();
            // Committed on another connection while the paged transaction is
            // between count and page: the snapshot must keep total and rows
            // consistent with each other.
            group(null, base(99), "SUBMITTED");
            resume.countDown();
            Object outcome = worker.get(20, TimeUnit.SECONDS);
            assertThat(outcome).isInstanceOf(ListPaging.Result.class);
            @SuppressWarnings("unchecked")
            ListPaging.Result<GroupResponse> result = (ListPaging.Result<GroupResponse>) outcome;
            assertThat(result.total()).isEqualTo(5L);
            assertThat(result.items()).hasSize(5);
        } finally {
            resume.countDown();
            pool.shutdownNow();
            assertThat(pool.awaitTermination(10, TimeUnit.SECONDS)).isTrue();
            Mockito.reset(namedJdbc);
        }
        assertThat(jdbc.queryForObject(
                "SELECT COUNT(*) FROM thesis.thesis_group WHERE round_id=?", Long.class, roundId))
                .as("the committed insert is real; only the transaction snapshot hid it")
                .isEqualTo(6L);
    }

    private ListPaging.Result<GroupResponse> page(int page, int limit, List<String> roles,
            String studentId, String lecturerId, String subject) {
        return groups.listPage(roundId, roles, studentId, lecturerId, subject,
                ListPaging.Window.of(page, limit));
    }

    // ---------- fixtures ----------

    private Instant base(int seconds) {
        return Instant.parse("2030-10-01T00:00:00Z").plusSeconds(seconds);
    }

    private UUID topic(String departmentId, String title) {
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO thesis.thesis_topic "
                        + "(id, round_id, department_id, title, description, max_groups, status, created_by) "
                        + "VALUES (?, ?, ?, ?, 'tgb fixture topic', 20, 'PUBLISHED', 'tgb-fixture')",
                id, roundId, departmentId, title);
        return id;
    }

    private UUID group(UUID topicId, Instant createdAt, String status) {
        return group(topicId, createdAt, status, "tgb-leader-" + UUID.randomUUID());
    }

    private UUID group(UUID topicId, Instant createdAt, String status, String leaderStudentId) {
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO thesis.thesis_group "
                        + "(id, round_id, leader_student_id, topic_id, status, approval_status, created_at) "
                        + "VALUES (?, ?, ?, ?, ?, 'PENDING', ?)",
                id, roundId, leaderStudentId, topicId, status, Timestamp.from(createdAt));
        return id;
    }

    private UUID topicOf(UUID groupId) {
        return jdbc.queryForObject("SELECT topic_id FROM thesis.thesis_group WHERE id=?", UUID.class, groupId);
    }

    private void supervise(UUID topicId) {
        jdbc.update("INSERT INTO thesis.thesis_topic_supervisor (id, topic_id, lecturer_id, supervisor_order) "
                + "VALUES (?, ?, ?, 1)", UUID.randomUUID(), topicId, DEAN);
    }

    private void externalMember(UUID groupId, String contact) {
        String leader = jdbc.queryForObject(
                "SELECT leader_student_id FROM thesis.thesis_group WHERE id=?", String.class, groupId);
        jdbc.update("INSERT INTO thesis.thesis_group_member "
                        + "(id, group_id, round_id, student_id, member_order, is_leader, display_name, contact, is_external) "
                        + "VALUES (?, ?, ?, ?, 1, TRUE, 'tgb external', ?, TRUE)",
                UUID.randomUUID(), groupId, roundId, leader, contact);
    }

    private void member(UUID groupId, String studentId, boolean active) {
        jdbc.update("INSERT INTO thesis.thesis_group_member "
                        + "(id, group_id, round_id, student_id, member_order, is_leader, active_participation) "
                        + "VALUES (?, ?, ?, ?, 1, TRUE, ?)",
                UUID.randomUUID(), groupId, roundId, studentId, active);
    }

    private void cancel(UUID groupId) {
        jdbc.update("UPDATE thesis.thesis_group SET status='CANCELLED' WHERE id=?", groupId);
    }

    private void student(String studentId, String curriculumId) {
        jdbc.update("INSERT INTO campuscore_auth.\"User\" "
                        + "(\"id\", \"email\", \"password\", \"firstName\", \"lastName\", \"status\", "
                        + "\"emailVerified\", \"isSuperAdmin\", \"failedLoginAttempts\", \"createdAt\", \"updatedAt\") "
                        + "VALUES (?, ?, 'test-password', 'Paging', 'Fixture', 'ACTIVE', FALSE, FALSE, 0, "
                        + "CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)",
                studentId, studentId + "@fixture.test");
        jdbc.update("INSERT INTO campuscore_auth.\"Student\" "
                        + "(\"id\", \"userId\", \"studentId\", \"curriculumId\", \"year\", \"admissionDate\") "
                        + "VALUES (?, ?, ?, ?, 2, CURRENT_TIMESTAMP)",
                studentId, studentId, "TGB-" + Integer.toUnsignedString(studentId.hashCode(), 36), curriculumId);
    }

    private void ensureLecturer(String lecturerId, String userId, String departmentId) {
        jdbc.update("INSERT INTO campuscore_auth.\"User\" "
                        + "(\"id\", \"email\", \"password\", \"firstName\", \"lastName\", \"status\", "
                        + "\"emailVerified\", \"isSuperAdmin\", \"failedLoginAttempts\", \"createdAt\", \"updatedAt\") "
                        + "VALUES (?, ?, 'test-password', 'Paging', 'Fixture', 'ACTIVE', FALSE, FALSE, 0, "
                        + "CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)",
                userId, userId + "@fixture.test");
        jdbc.update("INSERT INTO campuscore_auth.\"Lecturer\" "
                        + "(\"id\", \"userId\", \"departmentId\", \"employeeId\", \"isActive\") "
                        + "VALUES (?, ?, ?, ?, TRUE)",
                lecturerId, userId, departmentId,
                "TGB-" + Integer.toUnsignedString(lecturerId.hashCode(), 36));
    }

    private void ensureDepartments() {
        jdbc.update("INSERT INTO academic.\"Department\" "
                        + "(\"id\", \"name\", \"code\", \"facultyId\", \"isActive\") "
                        + "SELECT ?, 'TGB sibling department', 'TGBS', ?, TRUE "
                        + "WHERE NOT EXISTS (SELECT 1 FROM academic.\"Department\" WHERE \"id\"=?)",
                SIBLING_DEPT, FACULTY, SIBLING_DEPT);
        curriculum("tgb-curr-sibling", "TGB sibling curriculum", "TGBCS", SIBLING_DEPT);
        jdbc.update("INSERT INTO academic.\"Faculty\" (\"id\", \"name\", \"code\", \"isActive\") "
                        + "VALUES ('tgb-faculty-foreign', 'TGB foreign faculty', 'TGBFF', TRUE)");
        jdbc.update("INSERT INTO academic.\"Department\" "
                        + "(\"id\", \"name\", \"code\", \"facultyId\", \"isActive\") "
                        + "VALUES (?, 'TGB foreign department', 'TGBF', 'tgb-faculty-foreign', TRUE)",
                FOREIGN_DEPT);
        curriculum("tgb-curr-foreign", "TGB foreign curriculum", "TGBCF", FOREIGN_DEPT);
    }

    private void curriculum(String id, String name, String code, String departmentId) {
        jdbc.update("INSERT INTO academic.\"Curriculum\" "
                        + "(\"id\", \"name\", \"code\", \"departmentId\", \"academicYearId\") "
                        + "VALUES (?, ?, ?, ?, "
                        + "(SELECT \"id\" FROM academic.\"AcademicYear\" ORDER BY \"id\" LIMIT 1))",
                id, name, code, departmentId);
    }

    private static String valueOr(String name, String fallback) {
        String value = System.getenv(name);
        return value == null || value.isBlank() ? fallback : value;
    }

    static boolean postgresTargetConfigured() {
        String url = System.getenv("CAMPUSCORE_E2E_POSTGRES_URL");
        return url != null && url.startsWith("jdbc:postgresql:");
    }
}
