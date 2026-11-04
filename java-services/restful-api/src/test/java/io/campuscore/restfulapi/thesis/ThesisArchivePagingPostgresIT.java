package io.campuscore.restfulapi.thesis;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doAnswer;

import io.campuscore.restfulapi.events.web.ListPaging;
import io.campuscore.restfulapi.testsupport.AccountAuthorityFixture;
import io.campuscore.restfulapi.thesis.service.ThesisReportService;
import io.campuscore.restfulapi.thesis.service.ThesisReportService.RepositoryMemberResponse;
import io.campuscore.restfulapi.thesis.service.ThesisReportService.RepositoryReportResponse;
import io.campuscore.restfulapi.thesis.service.ThesisReportService.RepositorySupervisorResponse;
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
import org.springframework.jdbc.core.RowMapper;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.jdbc.core.namedparam.SqlParameterSource;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;

/**
 * Real-PostgreSQL port of {@link ThesisArchivePagingContractTest}. The H2 twin
 * cannot prove three things this suite exists for: {@code LIMIT/OFFSET} with
 * parameter markers over real UUID ordering, the repeatable-read snapshot that
 * keeps the count and the page consistent under a concurrent insert, and the
 * archive role predicates against the production Flyway schema.
 *
 * <p><b>Environment contract</b> (opt-in, same as the sibling thesis
 * {@code *PostgresIT} classes): runs ONLY when
 * {@code CAMPUSCORE_E2E_POSTGRES_URL} is a {@code jdbc:postgresql:} URL
 * pointing at a disposable database - the real migrations run on context
 * startup. Optional {@code CAMPUSCORE_E2E_POSTGRES_USER} /
 * {@code CAMPUSCORE_E2E_POSTGRES_PASSWORD}. Fixture ids carry an
 * {@code arqpg-} marker and are removed after every test.
 */
@EnabledIf("postgresTargetConfigured")
@SpringBootTest(properties = { "spring.flyway.locations=classpath:db/migration", "deepseek.enabled=false" })
@ActiveProfiles({"test", "persistence"})
class ThesisArchivePagingPostgresIT {

    private static final String DEPT = "department-demo";

    @Autowired private JdbcTemplate jdbc;
    @Autowired private ThesisReportService reports;
    @MockitoSpyBean private NamedParameterJdbcTemplate namedJdbc;

    private String tag;
    private UUID roundId;

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", () -> System.getenv("CAMPUSCORE_E2E_POSTGRES_URL"));
        registry.add("spring.datasource.username", () -> valueOr("CAMPUSCORE_E2E_POSTGRES_USER", "campuscore"));
        registry.add("spring.datasource.password", () -> valueOr("CAMPUSCORE_E2E_POSTGRES_PASSWORD", "postgres"));
    }

    @BeforeEach
    void prepare() {
        Mockito.reset(namedJdbc);
        tag = "arqpg-" + UUID.randomUUID().toString().replace("-", "").substring(0, 8);
        cleanFixtures();
        roundId = UUID.randomUUID();
        Instant now = Instant.now();
        jdbc.update("INSERT INTO thesis.thesis_registration_round "
                        + "(id,name,thesis_type,lecturer_submit_start,lecturer_submit_end,"
                        + "registration_start,registration_end,gvpb_deadline,status) "
                        + "VALUES (?,'" + tag + "-round','KLTN',?,?,?,?,?,'REGISTRATION_CLOSED')",
                roundId, Timestamp.from(now.minusSeconds(14_400)), Timestamp.from(now.minusSeconds(10_800)),
                Timestamp.from(now.minusSeconds(7_200)), Timestamp.from(now.plusSeconds(3_600)),
                Timestamp.from(now.plusSeconds(86_400)));
    }

    @AfterEach
    void cleanFixtures() {
        String round = "SELECT id FROM thesis.thesis_registration_round WHERE name = '" + tag + "-round'";
        // Cancelled rosters are immutable by trigger, so members are removed by
        // the group's ON DELETE CASCADE instead of a direct DELETE.
        jdbc.update("DELETE FROM thesis.thesis_group_report WHERE round_id IN (" + round + ")");
        jdbc.update("DELETE FROM thesis.thesis_group WHERE round_id IN (" + round + ")");
        jdbc.update("DELETE FROM thesis.thesis_topic_supervisor "
                + "WHERE topic_id IN (SELECT id FROM thesis.thesis_topic WHERE round_id IN (" + round + "))");
        jdbc.update("DELETE FROM thesis.thesis_topic WHERE round_id IN (" + round + ")");
        jdbc.update("DELETE FROM thesis.thesis_registration_round WHERE name = ?", tag + "-round");
        jdbc.update("DELETE FROM campuscore_auth.\"Student\" WHERE \"id\" LIKE ?", tag + "-%");
        jdbc.update("DELETE FROM campuscore_auth.\"Lecturer\" WHERE \"id\" LIKE ?", tag + "-%");
        jdbc.update("DELETE FROM campuscore_auth.\"User\" WHERE \"id\" LIKE ?", "%" + tag + "%");
        jdbc.update("DELETE FROM academic.\"Curriculum\" WHERE \"id\" LIKE ?", tag + "-%");
        jdbc.update("DELETE FROM academic.\"Department\" WHERE \"id\" LIKE ?", tag + "-%");
        jdbc.update("DELETE FROM academic.\"Faculty\" WHERE \"id\" LIKE ?", tag + "-%");
    }

    @Test
    void pagesConcatenateToTheLegacyResultWithFullChildrenOnPostgres() {
        Seed seed = seedArchive();

        List<RepositoryReportResponse> legacy = reports.listRepository(roundId, adminJwt());
        assertThat(legacy).extracting(RepositoryReportResponse::reportId)
                .containsExactlyElementsOf(seed.expectedRootOrder());
        assertThat(legacy).hasSize(7);

        RepositoryReportResponse tied = legacy.getFirst();
        assertThat(tied.members()).hasSize(4)
                .extracting(RepositoryMemberResponse::displayName)
                .containsExactly("Member 1 One", "Member 2 Two", "Member 3 Three", "Member 4 Four");
        assertThat(tied.supervisors()).hasSize(2)
                .extracting(RepositorySupervisorResponse::displayName)
                .containsExactly("Supervisor One", "Supervisor Two");
        assertThat(tied.supervisors()).extracting(RepositorySupervisorResponse::supervisorOrder)
                .containsExactly(1, 2);

        List<RepositoryReportResponse> concatenated = new ArrayList<>();
        for (int page = 0; page < 3; page++) {
            ListPaging.Result<RepositoryReportResponse> result =
                    reports.listRepository(roundId, adminJwt(), ListPaging.Window.of(page, 3));
            assertThat(result.total()).isEqualTo(7L);
            assertThat(result.items().size()).isLessThanOrEqualTo(3);
            concatenated.addAll(result.items());
        }
        assertThat(concatenated).containsExactlyElementsOf(legacy);

        ListPaging.Result<RepositoryReportResponse> outOfRange =
                reports.listRepository(roundId, adminJwt(), ListPaging.Window.of(9, 3));
        assertThat(outOfRange.total()).isEqualTo(7L);
        assertThat(outOfRange.items()).isEmpty();

        RepositoryReportResponse topicless = legacy.stream()
                .filter(item -> item.topicTitle() == null).findFirst().orElseThrow();
        assertThat(topicless.members()).hasSize(1);
        assertThat(topicless.supervisors()).isEmpty();
        assertThat(topicless.departmentName()).isNull();
    }

    @Test
    void archiveRoleMatrixMatchesTheContractOnPostgres() {
        Seed seed = seedArchive();

        List<UUID> admin = ids(reports.listRepository(roundId, adminJwt()));
        assertThat(admin).hasSize(7).containsAll(seed.expectedRootOrder());

        String headId = tag + "-head";
        ThesisAuthorityFixture.lecturer(jdbc, headId);
        jdbc.update("UPDATE campuscore_auth.\"Lecturer\" SET \"departmentId\" = ? WHERE \"id\" = ?", DEPT, headId);
        String headSubject = lecturerSubject(headId);
        AccountAuthorityFixture.replaceRoles(jdbc, headSubject, "TRUONG_KHOA", "LECTURER");
        Jwt head = lecturerJwt(headId, headSubject, "TRUONG_KHOA", "LECTURER");
        List<UUID> headVisible = ids(reports.listRepository(roundId, head));
        assertThat(headVisible).hasSize(6)
                .containsAll(seed.expectedRootOrder().subList(0, 6))
                .doesNotContain(seed.foreignReportId());

        String lecturerId = tag + "-lecturer";
        ThesisAuthorityFixture.lecturer(jdbc, lecturerId);
        jdbc.update("UPDATE campuscore_auth.\"Lecturer\" SET \"departmentId\" = ? WHERE \"id\" = ?", DEPT, lecturerId);
        Jwt lecturer = lecturerJwt(lecturerId, lecturerSubject(lecturerId), "LECTURER");
        List<UUID> lecturerVisible = ids(reports.listRepository(roundId, lecturer));
        assertThat(lecturerVisible).hasSize(3)
                .containsAll(seed.expectedRootOrder().subList(0, 3))
                .doesNotContain(seed.foreignReportId());
    }

    @Test
    void countAndPageShareOneRepeatableReadSnapshot() throws Exception {
        seedArchive();
        CountDownLatch paused = new CountDownLatch(1);
        CountDownLatch resume = new CountDownLatch(1);
        doAnswer(invocation -> {
            String sql = invocation.getArgument(0);
            if (sql.startsWith("SELECT r.id AS report_id")
                    && "arqpg-worker".equals(Thread.currentThread().getName())) {
                paused.countDown();
                if (!resume.await(10, TimeUnit.SECONDS)) {
                    throw new IllegalStateException("snapshot barrier timeout");
                }
            }
            return invocation.callRealMethod();
        }).when(namedJdbc).query(anyString(), any(SqlParameterSource.class), any(RowMapper.class));

        var pool = Executors.newSingleThreadExecutor();
        try {
            var worker = pool.submit(() -> {
                Thread.currentThread().setName("arqpg-worker");
                return reports.listRepository(roundId, adminJwt(), ListPaging.Window.of(0, 100));
            });
            assertThat(paused.await(10, TimeUnit.SECONDS))
                    .as("count finished and the worker is paused before the root page query").isTrue();
            // Commits on another connection after the snapshot was taken.
            insertLateReport();
            resume.countDown();
            ListPaging.Result<RepositoryReportResponse> result = worker.get(20, TimeUnit.SECONDS);
            assertThat(result.total()).isEqualTo(7L);
            assertThat(result.items()).hasSize(7);
        } finally {
            resume.countDown();
            pool.shutdownNow();
            assertThat(pool.awaitTermination(10, TimeUnit.SECONDS)).isTrue();
        }
        assertThat(jdbc.queryForObject(
                "SELECT COUNT(*) FROM thesis.thesis_group_report WHERE round_id = ?", Integer.class, roundId))
                .isEqualTo(8);
    }

    // --- fixtures ---------------------------------------------------------

    private Seed seedArchive() {
        String foreignFaculty = tag + "-faculty";
        String foreignDepartment = tag + "-department";
        jdbc.update("INSERT INTO academic.\"Faculty\" (\"id\",\"name\",\"code\",\"isActive\") "
                + "VALUES (?, 'Archive foreign faculty', 'ARQ', TRUE)", foreignFaculty);
        jdbc.update("INSERT INTO academic.\"Department\" (\"id\",\"name\",\"code\",\"facultyId\",\"isActive\") "
                + "VALUES (?, 'Archive foreign department', 'ARQD', ?, TRUE)", foreignDepartment, foreignFaculty);

        UUID topic = insertTopic(DEPT, tag + "-demo-topic");
        insertSupervisor(topic, tag + "-sup-1", 1, "Supervisor One");
        insertSupervisor(topic, tag + "-sup-2", 2, "Supervisor Two");
        UUID foreignTopic = insertTopic(foreignDepartment, tag + "-foreign-topic");

        Instant tied = Instant.parse("2032-02-02T10:00:00Z");
        List<UUID> tiedReports = new ArrayList<>();
        for (int i = 0; i < 3; i++) {
            UUID group = insertGroup(topic, "SUBMITTED");
            for (int order = 1; order <= 4; order++) {
                insertMember(group, tag + "-m" + i + "-" + order, order, "Member " + order + " " + word(order));
            }
            approve(group);
            tiedReports.add(insertReport(group, tied, "Tied report " + i));
        }
        UUID pending = insertGroupWithRoster(topic, "SUBMITTED", "PENDING",
                tied.minusSeconds(10), "Pending report", 1);
        UUID cancelled = insertGroupWithRoster(topic, "CANCELLED", "APPROVED",
                tied.minusSeconds(20), "Cancelled report", 3);

        UUID topicless = insertGroup(null, "SUBMITTED");
        insertMember(topicless, tag + "-m-topicless", 1, "Topicless Member");
        UUID topiclessReport = insertReport(topicless, tied.minusSeconds(30), "Topicless report");

        UUID foreign = insertGroupWithRoster(foreignTopic, "SUBMITTED", "APPROVED",
                tied.minusSeconds(40), "Foreign report", 3);

        List<UUID> expected = new ArrayList<>();
        expected.addAll(jdbc.query("SELECT id FROM thesis.thesis_group_report WHERE round_id = ? "
                + "ORDER BY submitted_at DESC, group_id ASC", (rs, row) -> rs.getObject("id", UUID.class), roundId));
        assertThat(expected).hasSize(7);
        assertThat(tiedReports).hasSize(3);
        assertThat(expected).containsAll(tiedReports);
        return new Seed(expected, pending, cancelled, topiclessReport, foreign);
    }

    private UUID insertGroupWithRoster(UUID topic, String status, String approval, Instant at,
            String title, int members) {
        // Status and approval are applied after the roster: a cancelled group
        // has a read-only roster and an approved one must already hold 3..5
        // members when the production trigger checks it.
        UUID group = insertGroup(topic, "SUBMITTED");
        for (int order = 1; order <= members; order++) {
            insertMember(group, tag + "-m-" + UUID.randomUUID().toString().substring(0, 8), order,
                    "Roster Member " + order);
        }
        if ("APPROVED".equals(approval)) {
            approve(group);
        }
        if ("CANCELLED".equals(status)) {
            jdbc.update("UPDATE thesis.thesis_group SET status = 'CANCELLED' WHERE id = ?", group);
        }
        return insertReport(group, at, title);
    }

    private UUID insertTopic(String department, String title) {
        UUID topic = UUID.randomUUID();
        jdbc.update("INSERT INTO thesis.thesis_topic "
                + "(id,round_id,department_id,title,description,max_groups,status,created_by) "
                + "VALUES (?,?,?,?,?,5,'PUBLISHED',?)",
                topic, roundId, department, title, tag + " fixture", tag);
        return topic;
    }

    /**
     * Production enforces the 3..5 member rule when a group becomes APPROVED,
     * so fixtures create the group pending, add the roster and only then flip
     * the approval (the H2 compact schema has no such trigger).
     */
    private UUID insertGroup(UUID topic, String status) {
        UUID group = UUID.randomUUID();
        jdbc.update("INSERT INTO thesis.thesis_group "
                        + "(id,round_id,leader_student_id,topic_id,status,approval_status) "
                        + "VALUES (?,?,?,?,?,'PENDING')",
                group, roundId, tag + "-leader-" + group, topic, status);
        return group;
    }

    private void approve(UUID group) {
        jdbc.update("UPDATE thesis.thesis_group SET approval_status = 'APPROVED' WHERE id = ?", group);
    }

    private void insertMember(UUID group, String studentId, int order, String displayName) {
        if (order == 1) {
            // Production requires leader_student_id to be the order-1 member.
            studentId = jdbc.queryForObject(
                    "SELECT leader_student_id FROM thesis.thesis_group WHERE id = ?", String.class, group);
        }
        ThesisAuthorityFixture.student(jdbc, studentId);
        jdbc.update("INSERT INTO thesis.thesis_group_member "
                        + "(id,group_id,round_id,student_id,member_order,is_leader) VALUES (?,?,?,?,?,?)",
                UUID.randomUUID(), group, roundId, studentId, order, order == 1);
        // Keep the fixture display name deterministic for the ordering assertion.
        String userId = jdbc.queryForObject("SELECT \"userId\" FROM campuscore_auth.\"Student\" WHERE \"id\" = ?",
                String.class, studentId);
        String[] parts = displayName.split(" ", 2);
        jdbc.update("UPDATE campuscore_auth.\"User\" SET \"firstName\" = ?, \"lastName\" = ? WHERE \"id\" = ?",
                parts.length > 1 ? parts[1] : "", parts[0], userId);
    }

    private void insertSupervisor(UUID topic, String lecturerId, int order, String displayName) {
        ThesisAuthorityFixture.lecturer(jdbc, lecturerId);
        jdbc.update("INSERT INTO thesis.thesis_topic_supervisor "
                + "(id,topic_id,lecturer_id,supervisor_order) VALUES (?,?,?,?)",
                UUID.randomUUID(), topic, lecturerId, order);
        String userId = jdbc.queryForObject("SELECT \"userId\" FROM campuscore_auth.\"Lecturer\" WHERE \"id\" = ?",
                String.class, lecturerId);
        String[] parts = displayName.split(" ", 2);
        jdbc.update("UPDATE campuscore_auth.\"User\" SET \"firstName\" = ?, \"lastName\" = ? WHERE \"id\" = ?",
                parts.length > 1 ? parts[1] : "", parts[0], userId);
    }

    private UUID insertReport(UUID group, Instant submittedAt, String title) {
        UUID report = UUID.randomUUID();
        jdbc.update("INSERT INTO thesis.thesis_group_report "
                        + "(id,group_id,round_id,submitted_by,title,url,submitted_at,file_name,file_type,file_size) "
                        + "VALUES (?,?,?,?,?,?,?,?,'application/pdf',4)",
                report, group, roundId, tag + "-leader", title,
                "https://drive.example.com/" + report, Timestamp.from(submittedAt), report + ".pdf");
        return report;
    }

    private void insertLateReport() {
        UUID topic = insertTopic(DEPT, tag + "-late-topic");
        UUID group = insertGroup(topic, "SUBMITTED");
        for (int order = 1; order <= 3; order++) {
            insertMember(group, tag + "-late-member-" + order, order, "Late Member " + order);
        }
        approve(group);
        insertReport(group, Instant.now(), "Late report");
    }

    private static String word(int order) {
        return switch (order) {
            case 1 -> "One";
            case 2 -> "Two";
            case 3 -> "Three";
            default -> "Four";
        };
    }

    private record Seed(List<UUID> expectedRootOrder, UUID pendingReportId, UUID cancelledReportId,
                        UUID topiclessReportId, UUID foreignReportId) { }

    private List<UUID> ids(List<RepositoryReportResponse> items) {
        return items.stream().map(RepositoryReportResponse::reportId).toList();
    }

    private String lecturerSubject(String lecturerId) {
        return jdbc.queryForObject("SELECT \"userId\" FROM campuscore_auth.\"Lecturer\" WHERE \"id\" = ?",
                String.class, lecturerId);
    }

    private static Jwt adminJwt() {
        return Jwt.withTokenValue("arqpg-test").header("alg", "none").subject("arqpg-admin")
                .claim("roles", List.of("ADMIN")).build();
    }

    private static Jwt lecturerJwt(String lecturerId, String subject, String... roles) {
        return Jwt.withTokenValue("arqpg-test").header("alg", "none").subject(subject)
                .claim("roles", List.of(roles)).claim("lecturerId", lecturerId).build();
    }

    /** Opt-in like the sibling Postgres ITs: runs only for a jdbc:postgresql: target. */
    static boolean postgresTargetConfigured() {
        String url = System.getenv("CAMPUSCORE_E2E_POSTGRES_URL");
        return url != null && url.startsWith("jdbc:postgresql:");
    }

    private static String valueOr(String key, String fallback) {
        String value = System.getenv(key);
        return value == null || value.isBlank() ? fallback : value;
    }
}
