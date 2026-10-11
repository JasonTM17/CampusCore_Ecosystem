package io.campuscore.restfulapi.thesis;

import io.campuscore.restfulapi.testsupport.CurrentAccountJwt;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors;
import org.springframework.test.web.servlet.request.RequestPostProcessor;

/**
 * Creates only the current auth rows required by thesis web fixtures. Tokens
 * are then derived from those rows, so AccountStateFilter sees the same roles
 * and profile claims as a production-issued token.
 */
public final class ThesisAuthorityFixture {
    private ThesisAuthorityFixture() { }

    public static RequestPostProcessor student(JdbcTemplate jdbc, String studentId) {
        String userId = jdbc.query("SELECT \"userId\" FROM campuscore_auth.\"Student\" WHERE \"id\"=?",
                        resultSet -> resultSet.next() ? resultSet.getString(1) : null, studentId);
        if (userId == null) {
            // Assistant turn ownership is the authenticated user id.  Use the
            // requested fixture id for both values when this helper creates a
            // profile so owner-scoped assertions remain about the real subject.
            userId = studentId;
            ensureUser(jdbc, userId, "student-" + shortId(studentId) + "@fixture.test");
            jdbc.update("INSERT INTO campuscore_auth.\"Student\" (\"id\", \"userId\", \"studentId\", \"curriculumId\", \"year\", \"admissionDate\") "
                            + "VALUES (?, ?, ?, 'curriculum-demo', 2, CURRENT_TIMESTAMP)",
                    studentId, userId, "FIXTURE-" + shortId(studentId));
        }
        ensureRole(jdbc, userId, "STUDENT");
        return CurrentAccountJwt.currentJwt(jdbc, userId);
    }

    public static RequestPostProcessor lecturer(JdbcTemplate jdbc, String lecturerId) {
        String userId = jdbc.query("SELECT \"userId\" FROM campuscore_auth.\"Lecturer\" WHERE \"id\"=?",
                        resultSet -> resultSet.next() ? resultSet.getString(1) : null, lecturerId);
        if (userId == null) {
            userId = "thesis-fixture-lecturer-" + lecturerId;
            ensureUser(jdbc, userId, "lecturer-" + shortId(lecturerId) + "@fixture.test");
            jdbc.update("INSERT INTO campuscore_auth.\"Lecturer\" (\"id\", \"userId\", \"departmentId\", \"employeeId\", \"isActive\") "
                            + "VALUES (?, ?, 'department-demo', ?, TRUE)",
                    lecturerId, userId, "FIXTURE-" + shortId(lecturerId));
        }
        ensureRole(jdbc, userId, "LECTURER");
        return CurrentAccountJwt.currentJwt(jdbc, userId);
    }

    public static RequestPostProcessor role(JdbcTemplate jdbc, String subject, String role) {
        ensureUser(jdbc, subject, role.toLowerCase() + "-" + shortId(subject) + "@fixture.test");
        ensureRole(jdbc, subject, role);
        return CurrentAccountJwt.currentJwt(jdbc, subject);
    }

    public static RequestPostProcessor studentWithUnexpectedLecturerClaim(
            JdbcTemplate jdbc, String studentId, String unexpectedLecturerId) {
        student(jdbc, studentId);
        String subject = jdbc.queryForObject("SELECT \"userId\" FROM campuscore_auth.\"Student\" WHERE \"id\"=?",
                String.class, studentId);
        var state = new io.campuscore.restfulapi.auth.repository.AuthUserRepository(new NamedParameterJdbcTemplate(jdbc))
                .findAccountAuthorization(subject).orElseThrow();
        return SecurityMockMvcRequestPostProcessors.jwt().jwt(token -> token.subject(subject)
                        .claim("roles", state.roles())
                        .claim("permissions", state.permissions())
                        .claim("studentId", state.studentId())
                        .claim("student", java.util.Map.of("year", state.studentYear()))
                        .claim("lecturerId", unexpectedLecturerId))
                .authorities(state.roles().stream().map(role -> new SimpleGrantedAuthority("ROLE_" + role))
                        .toArray(org.springframework.security.core.GrantedAuthority[]::new));
    }

    private static void ensureUser(JdbcTemplate jdbc, String userId, String email) {
        Integer existing = jdbc.queryForObject("SELECT COUNT(*) FROM campuscore_auth.\"User\" WHERE \"id\"=?",
                Integer.class, userId);
        if (existing == null || existing == 0) {
            jdbc.update("INSERT INTO campuscore_auth.\"User\" (\"id\", \"email\", \"password\", \"firstName\", \"lastName\", \"status\", \"emailVerified\", \"isSuperAdmin\", \"failedLoginAttempts\", \"createdAt\", \"updatedAt\") "
                            + "VALUES (?, ?, 'test-password', 'Thesis', 'Fixture', 'ACTIVE', FALSE, FALSE, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)",
                    userId, email);
        }
    }

    private static void ensureRole(JdbcTemplate jdbc, String userId, String roleName) {
        String roleId = jdbc.query("SELECT \"id\" FROM campuscore_auth.\"Role\" WHERE \"name\"=?",
                resultSet -> resultSet.next() ? resultSet.getString(1) : null, roleName);
        if (roleId == null) {
            roleId = "fixture-role-" + roleName;
            jdbc.update("INSERT INTO campuscore_auth.\"Role\" (\"id\", \"name\", \"isSystem\", \"createdAt\", \"updatedAt\") "
                            + "VALUES (?, ?, TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)", roleId, roleName);
        }
        Integer count = jdbc.queryForObject("SELECT COUNT(*) FROM campuscore_auth.\"UserRole\" WHERE \"userId\"=? AND \"roleId\"=?",
                Integer.class, userId, roleId);
        if (count == null || count == 0) {
            jdbc.update("INSERT INTO campuscore_auth.\"UserRole\" (\"id\", \"userId\", \"roleId\") VALUES (?, ?, ?)",
                    UUID.randomUUID().toString(), userId, roleId);
        }
    }

    private static String shortId(String raw) {
        return Integer.toUnsignedString(raw.hashCode(), 36);
    }
}
