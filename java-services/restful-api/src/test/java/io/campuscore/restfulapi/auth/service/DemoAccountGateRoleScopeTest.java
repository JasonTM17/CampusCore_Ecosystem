package io.campuscore.restfulapi.auth.service;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;

/**
 * Role-scoped behavior of the demo gate (audit finding S2): with
 * {@code app.demo.roles} set and the gate enabled, only demo accounts holding
 * an in-scope role become ACTIVE while the remaining demo accounts are LOCKED.
 * An unset scope keeps the historical all-ACTIVE behavior and a disabled gate
 * locks everyone regardless of scope. Non-demo accounts are never touched.
 *
 * <p>The gate is constructed manually per case so one H2 context covers the
 * whole behavior matrix without property-driven context restarts.
 */
@SpringBootTest
@ActiveProfiles({"test", "persistence"})
@TestPropertySource(properties = {
        "spring.flyway.enabled=false",
        "spring.datasource.url=jdbc:h2:mem:demo_gate_roles;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1"
})
class DemoAccountGateRoleScopeTest {

    /** The forward migration that locks the seeded applicant pair. */
    private static final Path APPLICANT_LOCK_MIGRATION =
            Path.of("src/main/resources/db/migration/V145__lock_applicant_demo_accounts.sql");
    /** The lock statement the migration applies, pinned to the same predicate
     * by the assertions in {@link #applicantLockMigrationLocksExactlyTheSeededPairAcrossRuns}. */
    private static final String APPLICANT_LOCK_UPDATE =
            "UPDATE \"campuscore_auth\".\"User\" SET \"status\" = 'LOCKED', \"failedLoginAttempts\" = 0,"
                    + " \"lockedUntil\" = NULL, \"updatedAt\" = CURRENT_TIMESTAMP"
                    + " WHERE \"status\" <> 'LOCKED'"
                    + " AND \"id\" IN ('applicant-user', 'applicant-user-2')"
                    + " AND \"email\" IN ('applicant@campuscore.edu', 'applicant2@campuscore.edu')";

    @Autowired
    private JdbcTemplate jdbc;

    @BeforeEach
    void prepareFixture() {
        jdbc.execute("CREATE SCHEMA IF NOT EXISTS \"campuscore_auth\"");
        jdbc.execute("""
                CREATE TABLE IF NOT EXISTS "campuscore_auth"."User" (
                    "id" VARCHAR(120) PRIMARY KEY,
                    "email" VARCHAR(200) NOT NULL,
                    "firstName" VARCHAR(120) NOT NULL,
                    "lastName" VARCHAR(120) NOT NULL,
                    "status" VARCHAR(40) NOT NULL DEFAULT 'LOCKED',
                    "failedLoginAttempts" INTEGER NOT NULL DEFAULT 0,
                    "lockedUntil" TIMESTAMP,
                    "updatedAt" TIMESTAMP
                )
                """);
        jdbc.execute("""
                CREATE TABLE IF NOT EXISTS "campuscore_auth"."Role" (
                    "id" VARCHAR(120) PRIMARY KEY,
                    "name" VARCHAR(80) NOT NULL
                )
                """);
        jdbc.execute("""
                CREATE TABLE IF NOT EXISTS "campuscore_auth"."UserRole" (
                    "id" VARCHAR(120) PRIMARY KEY,
                    "userId" VARCHAR(120) NOT NULL,
                    "roleId" VARCHAR(120) NOT NULL
                )
                """);
        jdbc.update("DELETE FROM \"campuscore_auth\".\"UserRole\"");
        jdbc.update("DELETE FROM \"campuscore_auth\".\"Role\"");
        jdbc.update("DELETE FROM \"campuscore_auth\".\"User\"");

        jdbc.update("INSERT INTO \"campuscore_auth\".\"Role\" (\"id\", \"name\") VALUES ('role-student', 'STUDENT')");
        jdbc.update("INSERT INTO \"campuscore_auth\".\"Role\" (\"id\", \"name\") VALUES ('role-lecturer', 'LECTURER')");
        jdbc.update("INSERT INTO \"campuscore_auth\".\"Role\" (\"id\", \"name\") VALUES ('role-admin', 'ADMIN')");
        seedDemoUser("demo-student", "student@campuscore.edu", List.of("role-student"));
        seedDemoUser("demo-student-2", "student2@campuscore.edu", List.of("role-student"));
        seedDemoUser("demo-student-3", "student3@campuscore.edu", List.of("role-student"));
        seedDemoUser("demo-student-4", "student4@campuscore.edu", List.of("role-student"));
        seedDemoUser("demo-lecturer", "lecturer@campuscore.edu", List.of("role-lecturer"));
        seedDemoUser("demo-admin", "admin@campuscore.edu", List.of("role-admin"));
        seedDemoUser("demo-council", "lecturer003@campuscore.demo", List.of("role-lecturer"));
        // The two seeded applicant accounts ship ACTIVE with the same
        // published demo credential, so the disabled gate must actually
        // flip them — seeding them ACTIVE proves it does not just leave
        // whatever status the seed happened to write.
        seedDemoUser("applicant-user", "applicant@campuscore.edu", List.of("role-student"), "ACTIVE");
        seedDemoUser("applicant-user-2", "applicant2@campuscore.edu", List.of("role-student"), "ACTIVE");
        // A real account that shares nothing with the demo list: the gate must
        // never flip its status no matter how the scope is configured.
        seedDemoUser("real-user", "nguyen.van.a@student.hcmute.edu.vn", List.of("role-student"));
    }

    private void seedDemoUser(String id, String email, List<String> roleIds) {
        seedDemoUser(id, email, roleIds, "LOCKED");
    }

    private void seedDemoUser(String id, String email, List<String> roleIds, String status) {
        jdbc.update(
                "INSERT INTO \"campuscore_auth\".\"User\""
                        + " (\"id\", \"email\", \"firstName\", \"lastName\", \"status\", \"failedLoginAttempts\")"
                        + " VALUES (?, ?, ?, ?, ?, 3)",
                id, email, "Demo", "User", status);
        for (String roleId : roleIds) {
            jdbc.update(
                    "INSERT INTO \"campuscore_auth\".\"UserRole\" (\"id\", \"userId\", \"roleId\") VALUES (?, ?, ?)",
                    id + "-" + roleId, id, roleId);
        }
    }

    private DemoAccountGate gate(boolean enabled, String roles) {
        return new DemoAccountGate(new org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate(jdbc.getDataSource()), enabled, roles);
    }

    private String statusOf(String email) {
        return jdbc.queryForObject(
                "SELECT \"status\" FROM \"campuscore_auth\".\"User\" WHERE \"email\" = ?",
                String.class, email);
    }

    @Test
    void studentScopeActivatesOnlyStudentDemoAccounts() {
        gate(true, "STUDENT").run(null);

        assertThat(statusOf("student@campuscore.edu")).isEqualTo("ACTIVE");
        assertThat(statusOf("student2@campuscore.edu")).isEqualTo("ACTIVE");
        assertThat(statusOf("student3@campuscore.edu")).isEqualTo("ACTIVE");
        assertThat(statusOf("student4@campuscore.edu")).isEqualTo("ACTIVE");
        assertThat(statusOf("lecturer@campuscore.edu")).isEqualTo("LOCKED");
        assertThat(statusOf("admin@campuscore.edu")).isEqualTo("LOCKED");
        assertThat(statusOf("lecturer003@campuscore.demo")).isEqualTo("LOCKED");
        // The seeded applicant pair holds the STUDENT role like the team.
        assertThat(statusOf("applicant@campuscore.edu")).isEqualTo("ACTIVE");
        assertThat(statusOf("applicant2@campuscore.edu")).isEqualTo("ACTIVE");
        // Never touch a real account.
        assertThat(statusOf("nguyen.van.a@student.hcmute.edu.vn")).isEqualTo("LOCKED");
    }

    @Test
    void multiRoleScopeActivatesEveryCoveredDemoRole() {
        gate(true, "student, lecturer").run(null);

        assertThat(statusOf("student@campuscore.edu")).isEqualTo("ACTIVE");
        assertThat(statusOf("student2@campuscore.edu")).isEqualTo("ACTIVE");
        assertThat(statusOf("student3@campuscore.edu")).isEqualTo("ACTIVE");
        assertThat(statusOf("student4@campuscore.edu")).isEqualTo("ACTIVE");
        assertThat(statusOf("lecturer@campuscore.edu")).isEqualTo("ACTIVE");
        assertThat(statusOf("lecturer003@campuscore.demo")).isEqualTo("ACTIVE");
        assertThat(statusOf("applicant@campuscore.edu")).isEqualTo("ACTIVE");
        assertThat(statusOf("applicant2@campuscore.edu")).isEqualTo("ACTIVE");
        assertThat(statusOf("admin@campuscore.edu")).isEqualTo("LOCKED");
    }

    @Test
    void lecturerScopeLeavesEveryStudentTeamMemberLocked() {
        gate(true, "LECTURER").run(null);

        assertThat(statusOf("student@campuscore.edu")).isEqualTo("LOCKED");
        assertThat(statusOf("student2@campuscore.edu")).isEqualTo("LOCKED");
        assertThat(statusOf("student3@campuscore.edu")).isEqualTo("LOCKED");
        assertThat(statusOf("student4@campuscore.edu")).isEqualTo("LOCKED");
        assertThat(statusOf("lecturer@campuscore.edu")).isEqualTo("ACTIVE");
        assertThat(statusOf("lecturer003@campuscore.demo")).isEqualTo("ACTIVE");
        assertThat(statusOf("applicant@campuscore.edu")).isEqualTo("LOCKED");
        assertThat(statusOf("applicant2@campuscore.edu")).isEqualTo("LOCKED");
        assertThat(statusOf("nguyen.van.a@student.hcmute.edu.vn")).isEqualTo("LOCKED");
    }

    @Test
    void unsetScopeKeepsTheHistoricalAllActiveBehavior() {
        gate(true, "").run(null);

        assertThat(statusOf("student@campuscore.edu")).isEqualTo("ACTIVE");
        assertThat(statusOf("student2@campuscore.edu")).isEqualTo("ACTIVE");
        assertThat(statusOf("student3@campuscore.edu")).isEqualTo("ACTIVE");
        assertThat(statusOf("student4@campuscore.edu")).isEqualTo("ACTIVE");
        assertThat(statusOf("lecturer@campuscore.edu")).isEqualTo("ACTIVE");
        assertThat(statusOf("admin@campuscore.edu")).isEqualTo("ACTIVE");
        assertThat(statusOf("lecturer003@campuscore.demo")).isEqualTo("ACTIVE");
        assertThat(statusOf("applicant@campuscore.edu")).isEqualTo("ACTIVE");
        assertThat(statusOf("applicant2@campuscore.edu")).isEqualTo("ACTIVE");
    }

    @Test
    void disabledGateLocksEveryDemoAccountRegardlessOfScope() {
        gate(false, "STUDENT").run(null);

        assertThat(statusOf("student@campuscore.edu")).isEqualTo("LOCKED");
        assertThat(statusOf("student2@campuscore.edu")).isEqualTo("LOCKED");
        assertThat(statusOf("student3@campuscore.edu")).isEqualTo("LOCKED");
        assertThat(statusOf("student4@campuscore.edu")).isEqualTo("LOCKED");
        assertThat(statusOf("lecturer@campuscore.edu")).isEqualTo("LOCKED");
        assertThat(statusOf("admin@campuscore.edu")).isEqualTo("LOCKED");
        assertThat(statusOf("lecturer003@campuscore.demo")).isEqualTo("LOCKED");
        assertThat(statusOf("applicant@campuscore.edu")).isEqualTo("LOCKED");
        assertThat(statusOf("applicant2@campuscore.edu")).isEqualTo("LOCKED");
    }

    /**
     * The seeded applicant pair stays ACTIVE after the admissions seed ran, so
     * a follow-up migration must lock exactly those two rows: no-op when they
     * are absent or already locked, and a real account beside them is spared.
     */
    @Test
    void applicantLockMigrationLocksExactlyTheSeededPairAcrossRuns() throws Exception {
        String sql = Files.readString(APPLICANT_LOCK_MIGRATION);
        assertThat(sql)
                .contains("\"status\" <> 'LOCKED'")
                .contains("\"id\" IN ('applicant-user', 'applicant-user-2')")
                .contains("\"email\" IN ('applicant@campuscore.edu', 'applicant2@campuscore.edu')");

        // A real account beside the seeds must be spared by the predicate.
        jdbc.update("UPDATE \"campuscore_auth\".\"User\" SET \"status\" = 'ACTIVE'"
                + " WHERE \"id\" = 'real-user'");

        assertThat(jdbc.update(APPLICANT_LOCK_UPDATE)).isEqualTo(2);
        assertThat(statusOf("applicant@campuscore.edu")).isEqualTo("LOCKED");
        assertThat(statusOf("applicant2@campuscore.edu")).isEqualTo("LOCKED");
        assertThat(statusOf("nguyen.van.a@student.hcmute.edu.vn")).isEqualTo("ACTIVE");

        // Re-applying is a true no-op, and absent seeds change nothing.
        assertThat(jdbc.update(APPLICANT_LOCK_UPDATE)).isZero();
        jdbc.update("DELETE FROM \"campuscore_auth\".\"UserRole\""
                + " WHERE \"userId\" IN ('applicant-user', 'applicant-user-2')");
        jdbc.update("DELETE FROM \"campuscore_auth\".\"User\""
                + " WHERE \"id\" IN ('applicant-user', 'applicant-user-2')");
        assertThat(jdbc.update(APPLICANT_LOCK_UPDATE)).isZero();
    }

    @Test
    void demoAccountWithoutAnyRoleRowStaysLockedWhenScoped() {
        jdbc.update("DELETE FROM \"campuscore_auth\".\"UserRole\" WHERE \"userId\" = 'demo-admin'");

        gate(true, "STUDENT,ADMIN").run(null);

        assertThat(statusOf("student@campuscore.edu")).isEqualTo("ACTIVE");
        assertThat(statusOf("admin@campuscore.edu")).isEqualTo("LOCKED");
    }

    @Test
    void roleParsingIsCaseInsensitiveAndDropsBlankAndUnknownEntries() {
        assertThat(DemoAccountGate.parseRoles(null)).isEmpty();
        assertThat(DemoAccountGate.parseRoles("  ")).isEmpty();
        assertThat(DemoAccountGate.parseRoles("student, LECTURER ,")).isEqualTo(Set.of("STUDENT", "LECTURER"));
    }

    @Test
    void scopedActivationAlsoClearsLockoutCounters() {
        gate(true, "STUDENT").run(null);

        Integer attempts = jdbc.queryForObject(
                "SELECT \"failedLoginAttempts\" FROM \"campuscore_auth\".\"User\" WHERE \"email\" = ?",
                Integer.class, "student@campuscore.edu");
        assertThat(attempts).isZero();
        LocalDateTime updated = jdbc.queryForObject(
                "SELECT \"updatedAt\" FROM \"campuscore_auth\".\"User\" WHERE \"email\" = ?",
                LocalDateTime.class, "student@campuscore.edu");
        assertThat(updated).isNotNull();
    }
}
