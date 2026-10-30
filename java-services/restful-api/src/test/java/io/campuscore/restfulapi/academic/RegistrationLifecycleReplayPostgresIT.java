package io.campuscore.restfulapi.academic;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import io.campuscore.restfulapi.academic.registration.RegistrationService;
import io.campuscore.restfulapi.academic.web.AcademicEnrollmentReadDtos.EnrollmentResponse;
import io.campuscore.restfulapi.web.DomainException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIf;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/**
 * PostgreSQL authority test for idempotent lifecycle replay: a replayed
 * Idempotency-Key must answer from the recorded claim without rerunning the
 * first execution's side effects — no regenerated registration slip, no seat
 * recount, no extra enrollment event — and a recorded target that no longer
 * resolves must answer the stable conflict tombstone instead of fabricating a
 * result or surfacing a server error.
 *
 * <p><b>Environment contract</b> (opt-in, identical to
 * {@link AcademicEnrollmentIdempotencyRacePostgresIT}): runs ONLY when
 * {@code CAMPUSCORE_E2E_POSTGRES_URL} is set to a {@code jdbc:postgresql:} URL —
 * point it at a freshly recreated database, e.g.
 * {@code jdbc:postgresql://localhost:5432/campuscore_e2e}. Optional overrides:
 * {@code CAMPUSCORE_E2E_POSTGRES_USER} / {@code CAMPUSCORE_E2E_POSTGRES_PASSWORD}
 * (both default to {@code postgres}). CI without the env skips the IT.
 */
@EnabledIf(value = "io.campuscore.restfulapi.academic.RegistrationLifecycleReplayPostgresIT#postgresTargetConfigured")
@SpringBootTest(properties = {
        "spring.flyway.locations=classpath:db/migration",
        "deepseek.enabled=false",
        "spring.jpa.hibernate.ddl-auto=none",
        "spring.datasource.hikari.maximum-pool-size=8"
})
@ActiveProfiles({"test", "persistence"})
class RegistrationLifecycleReplayPostgresIT {

    @Autowired
    private RegistrationService registration;

    @Autowired
    private NamedParameterJdbcTemplate jdbc;

    @DynamicPropertySource
    static void postgresProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", () -> valueOr(
                "CAMPUSCORE_E2E_POSTGRES_URL", "jdbc:postgresql://localhost:5432/campuscore_e2e"));
        registry.add("spring.datasource.username", () -> valueOr("CAMPUSCORE_E2E_POSTGRES_USER", "postgres"));
        registry.add("spring.datasource.password", () -> valueOr("CAMPUSCORE_E2E_POSTGRES_PASSWORD", "postgres"));
    }

    @Test
    void replayedEnrollDoesNotRegenerateRetiredSlipSeatOrEvent() {
        AcademicEnrollmentPostgresFixture fixture = AcademicEnrollmentPostgresFixture.seed(jdbc, 10);
        String studentId = fixture.seedStudent(1);
        String key = "replay-slip-" + fixture.sectionId;

        EnrollmentResponse first = registration.enroll(studentId, fixture.sectionId, List.of("STUDENT"), key);
        assertThat(slipCount(studentId, fixture.semesterId)).isEqualTo(1);

        // Retire the document the way a lifecycle mutation does: a replay of
        // the completed claim must not resurrect it.
        jdbc.update("DELETE FROM academic.\"RegistrationSlip\""
                        + " WHERE \"studentId\" = :studentId AND \"semesterId\" = :semesterId",
                Map.of("studentId", studentId, "semesterId", fixture.semesterId));

        EnrollmentResponse replayed = registration.enroll(studentId, fixture.sectionId, List.of("STUDENT"), key);

        assertThat(replayed.id()).isEqualTo(first.id());
        assertThat(replayed.status()).isEqualTo("ENROLLED");
        assertThat(slipCount(studentId, fixture.semesterId))
                .as("a replay must not regenerate a retired slip")
                .isZero();
        assertThat(enrolledCount(fixture.sectionId)).isEqualTo(1);
        assertThat(eventCount(first.id(), "ENROLL")).isEqualTo(1);
        assertThat(eventCount(first.id(), "DROP")).isZero();
        assertThat(claimCount(studentId, key)).isEqualTo(1);
    }

    @Test
    void dropRetiresSlipAndEnrollReplayStaysSideEffectFree() {
        AcademicEnrollmentPostgresFixture fixture = AcademicEnrollmentPostgresFixture.seed(jdbc, 10);
        String studentId = fixture.seedStudent(1);
        String enrollKey = "replay-enroll-" + fixture.sectionId;
        String dropKey = "replay-drop-" + fixture.sectionId;

        EnrollmentResponse first = registration.enroll(studentId, fixture.sectionId, List.of("STUDENT"), enrollKey);
        registration.drop(first.id(), studentId, List.of("STUDENT"), dropKey);
        assertThat(enrollmentStatus(first.id())).isEqualTo("DROPPED");
        assertThat(slipCount(studentId, fixture.semesterId)).isZero();
        assertThat(enrolledCount(fixture.sectionId)).isZero();

        EnrollmentResponse replayed = registration.enroll(studentId, fixture.sectionId, List.of("STUDENT"), enrollKey);

        // The replay returns the recorded enrollment's live state — honestly
        // DROPPED, never a fabricated success — and must not resurrect the
        // retired slip, re-bill the seat, or add lifecycle events.
        assertThat(replayed.id()).isEqualTo(first.id());
        assertThat(replayed.status()).isEqualTo("DROPPED");
        assertThat(slipCount(studentId, fixture.semesterId)).isZero();
        assertThat(enrolledCount(fixture.sectionId)).isZero();
        assertThat(enrollmentStatus(first.id())).isEqualTo("DROPPED");
        assertThat(eventCount(first.id(), "ENROLL")).isEqualTo(1);
        assertThat(eventCount(first.id(), "DROP")).isEqualTo(1);

        // Replaying the drop itself is equally inert: no second DROP event,
        // no seat movement, the row stays DROPPED.
        registration.drop(first.id(), studentId, List.of("STUDENT"), dropKey);
        assertThat(eventCount(first.id(), "DROP")).isEqualTo(1);
        assertThat(enrolledCount(fixture.sectionId)).isZero();
        assertThat(enrollmentStatus(first.id())).isEqualTo("DROPPED");
    }

    @Test
    void enrollReplayAfterHardDeleteAnswersStableTombstone() {
        AcademicEnrollmentPostgresFixture fixture = AcademicEnrollmentPostgresFixture.seed(jdbc, 10);
        String studentId = fixture.seedStudent(1);
        String key = "replay-gone-" + fixture.sectionId;

        EnrollmentResponse first = registration.enroll(studentId, fixture.sectionId, List.of("STUDENT"), key);
        int seatsBefore = enrolledCount(fixture.sectionId);
        jdbc.update("DELETE FROM academic.\"Enrollment\" WHERE \"id\" = :id", Map.of("id", first.id()));

        // The recorded target is gone: replay answers the stable conflict
        // tombstone — the same shape the other idempotent services use when a
        // stored result can no longer be produced — never a fabricated
        // response and never a server error. Repeating yields the same answer.
        for (int attempt = 0; attempt < 2; attempt++) {
            assertThatThrownBy(() -> registration.enroll(studentId, fixture.sectionId, List.of("STUDENT"), key))
                    .isInstanceOf(DomainException.class)
                    .satisfies(thrown -> {
                        DomainException exception = (DomainException) thrown;
                        assertThat(exception.getStatus()).isEqualTo(HttpStatus.CONFLICT);
                        assertThat(exception.code()).isEqualTo("IDEMPOTENCY_RESPONSE_UNAVAILABLE");
                    });
        }

        assertThat(enrollmentCount(studentId))
                .as("a tombstoned replay must not recreate the enrollment")
                .isZero();
        assertThat(enrolledCount(fixture.sectionId))
                .as("a replay must not move the seat counter")
                .isEqualTo(seatsBefore);
        assertThat(slipCount(studentId, fixture.semesterId))
                .as("a replay must not delete or regenerate the recorded slip")
                .isEqualTo(1);
        assertThat(eventCount(first.id(), "ENROLL")).isEqualTo(1);
        assertThat(claimState(studentId, key))
                .as("the recorded claim history is preserved")
                .isEqualTo("COMPLETED");
    }

    @Test
    void legacyClaimWithoutRecordedTargetAnswersTombstone() {
        AcademicEnrollmentPostgresFixture fixture = AcademicEnrollmentPostgresFixture.seed(jdbc, 10);
        String studentId = fixture.seedStudent(1);
        String key = "legacy-" + fixture.sectionId;

        // A claim left by an older deployment that completed without recording
        // its target: preserving the unknown history takes precedence over a
        // fabricated success, so the replay answers the tombstone too.
        jdbc.update("INSERT INTO academic.\"RegistrationIdempotency\""
                        + " (\"id\", \"ownerId\", \"idempotencyKey\", \"requestHash\", \"state\", \"enrollmentId\")"
                        + " VALUES (:id, :ownerId, :key, :hash, 'COMPLETED', NULL)",
                Map.of(
                        "id", "legacy-claim-" + fixture.sectionId,
                        "ownerId", studentId,
                        "key", key,
                        "hash", sha256Hex("ENROLL|" + fixture.sectionId)));

        assertThatThrownBy(() -> registration.enroll(studentId, fixture.sectionId, List.of("STUDENT"), key))
                .isInstanceOf(DomainException.class)
                .satisfies(thrown -> {
                    DomainException exception = (DomainException) thrown;
                    assertThat(exception.getStatus()).isEqualTo(HttpStatus.CONFLICT);
                    assertThat(exception.code()).isEqualTo("IDEMPOTENCY_RESPONSE_UNAVAILABLE");
                });
        assertThat(enrollmentCount(studentId)).isZero();
        assertThat(enrolledCount(fixture.sectionId)).isZero();
        assertThat(eventCountForStudent(studentId, "ENROLL")).isZero();
    }

    @Test
    void sameKeyWithChangedPayloadStillConflicts() {
        AcademicEnrollmentPostgresFixture fixture = AcademicEnrollmentPostgresFixture.seed(jdbc, 10);
        String studentId = fixture.seedStudent(1);
        String otherCourseId = fixture.courseId + "-other";
        String otherSectionId = fixture.sectionId + "-other";
        jdbc.update("INSERT INTO academic.\"Course\""
                        + " (\"id\", \"code\", \"name\", \"credits\", \"departmentId\", \"isActive\")"
                        + " VALUES (:id, :id, 'Other course', 3, :department, TRUE)",
                Map.of("id", otherCourseId, "department", fixture.departmentId));
        jdbc.update("INSERT INTO academic.\"Section\""
                        + " (\"id\", \"sectionNumber\", \"courseId\", \"semesterId\", \"capacity\","
                        + " \"enrolledCount\", \"status\")"
                        + " VALUES (:id, '02', :course, :semester, 10, 0, 'OPEN')",
                Map.of("id", otherSectionId, "course", otherCourseId, "semester", fixture.semesterId));
        String key = "conflict-" + fixture.sectionId;

        registration.enroll(studentId, fixture.sectionId, List.of("STUDENT"), key);

        assertThatThrownBy(() -> registration.enroll(studentId, otherSectionId, List.of("STUDENT"), key))
                .isInstanceOf(DomainException.class)
                .satisfies(thrown -> {
                    DomainException exception = (DomainException) thrown;
                    assertThat(exception.getStatus()).isEqualTo(HttpStatus.CONFLICT);
                    assertThat(exception.code()).isEqualTo("IDEMPOTENCY_CONFLICT");
                });
        assertThat(enrollmentCount(studentId)).isEqualTo(1);
    }

    static boolean postgresTargetConfigured() {
        String url = System.getenv("CAMPUSCORE_E2E_POSTGRES_URL");
        return url != null && url.startsWith("jdbc:postgresql:");
    }

    private int slipCount(String studentId, String semesterId) {
        Integer count = jdbc.queryForObject(
                "SELECT COUNT(*) FROM academic.\"RegistrationSlip\""
                        + " WHERE \"studentId\" = :studentId AND \"semesterId\" = :semesterId",
                Map.of("studentId", studentId, "semesterId", semesterId), Integer.class);
        return count == null ? 0 : count;
    }

    private int enrolledCount(String sectionId) {
        Integer count = jdbc.queryForObject(
                "SELECT \"enrolledCount\" FROM academic.\"Section\" WHERE \"id\" = :id",
                Map.of("id", sectionId), Integer.class);
        return count == null ? 0 : count;
    }

    private int enrollmentCount(String studentId) {
        Integer count = jdbc.queryForObject(
                "SELECT COUNT(*) FROM academic.\"Enrollment\" WHERE \"studentId\" = :studentId",
                Map.of("studentId", studentId), Integer.class);
        return count == null ? 0 : count;
    }

    private int eventCount(String enrollmentId, String action) {
        Integer count = jdbc.queryForObject(
                "SELECT COUNT(*) FROM academic.\"EnrollmentEvent\""
                        + " WHERE \"enrollmentId\" = :enrollmentId AND \"action\" = :action",
                Map.of("enrollmentId", enrollmentId, "action", action), Integer.class);
        return count == null ? 0 : count;
    }

    private int eventCountForStudent(String studentId, String action) {
        Integer count = jdbc.queryForObject(
                "SELECT COUNT(*) FROM academic.\"EnrollmentEvent\""
                        + " WHERE \"studentId\" = :studentId AND \"action\" = :action",
                Map.of("studentId", studentId, "action", action), Integer.class);
        return count == null ? 0 : count;
    }

    private String enrollmentStatus(String enrollmentId) {
        return jdbc.queryForObject(
                "SELECT \"status\" FROM academic.\"Enrollment\" WHERE \"id\" = :id",
                Map.of("id", enrollmentId), String.class);
    }

    private int claimCount(String ownerId, String key) {
        Integer count = jdbc.queryForObject(
                "SELECT COUNT(*) FROM academic.\"RegistrationIdempotency\""
                        + " WHERE \"ownerId\" = :ownerId AND \"idempotencyKey\" = :key",
                Map.of("ownerId", ownerId, "key", key), Integer.class);
        return count == null ? 0 : count;
    }

    private String claimState(String ownerId, String key) {
        return jdbc.queryForObject(
                "SELECT \"state\" FROM academic.\"RegistrationIdempotency\""
                        + " WHERE \"ownerId\" = :ownerId AND \"idempotencyKey\" = :key",
                Map.of("ownerId", ownerId, "key", key), String.class);
    }

    private static String sha256Hex(String value) {
        try {
            return HexFormat.of().formatHex(
                    MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException(exception);
        }
    }

    private static String valueOr(String name, String fallback) {
        String value = System.getenv(name);
        return value == null || value.isBlank() ? fallback : value;
    }
}
