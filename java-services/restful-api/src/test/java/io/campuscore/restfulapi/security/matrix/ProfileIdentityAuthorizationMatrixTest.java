package io.campuscore.restfulapi.security.matrix;

import static io.campuscore.restfulapi.testsupport.CurrentAccountJwt.fixtureJwt;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import io.campuscore.restfulapi.testsupport.AccountAuthorityFixture;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.RequestPostProcessor;

/**
 * Cross-account authorization matrix for the self-service identity surface.
 *
 * <p>None of these routes accepts a user id: every one resolves the subject
 * from the JWT. The matrix therefore asserts the observable consequence — A's
 * token reads and mutates A's row only, B's row is untouched, and B's password
 * cannot be used to act on A's account (and vice versa). The real H2 auth
 * schema is used so credential rotation and the two-factor switch run their
 * production SQL, not a stub.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles({"test", "persistence"})
@TestPropertySource(properties = {
        "spring.datasource.url=jdbc:h2:mem:authz_identity;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1",
        "spring.datasource.username=sa",
        "spring.datasource.password=",
        "spring.flyway.enabled=true",
        "spring.flyway.locations=classpath:db/migration-h2"
})
class ProfileIdentityAuthorizationMatrixTest {

    private static final String USER_A = "mx-authz-user-a";
    private static final String USER_B = "mx-authz-user-b";
    private static final String ADMIN = "mx-authz-admin";

    @Autowired
    private JdbcTemplate jdbc;

    @Autowired
    private MockMvc mvc;

    @Autowired
    private PasswordEncoder passwordEncoder;

    private String passwordA;
    private String passwordB;

    @BeforeEach
    void prepareIdentityFixture() {
        jdbc.update("DELETE FROM campuscore_auth.\"User\" WHERE \"id\" LIKE 'mx-authz-%'");
        passwordA = "a-" + UUID.randomUUID();
        passwordB = "b-" + UUID.randomUUID();
        insertUser(USER_A, "mx-authz-a@campuscore.edu", passwordA, false);
        insertUser(USER_B, "mx-authz-b@campuscore.edu", passwordB, true);
        insertUser(ADMIN, "mx-authz-admin@campuscore.edu", passwordA, false);
        AccountAuthorityFixture.replaceRoles(jdbc, USER_A, "STUDENT");
        AccountAuthorityFixture.replaceRoles(jdbc, USER_B, "STUDENT");
        AccountAuthorityFixture.replaceRoles(jdbc, ADMIN, "ADMIN");
    }

    @Test
    void student_reads_only_own_profile_from_auth_me() throws Exception {
        mvc.perform(get("/api/v1/auth/me").with(studentJwt(USER_A)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(USER_A))
                .andExpect(jsonPath("$.email").value("mx-authz-a@campuscore.edu"));

        mvc.perform(get("/api/v1/auth/me").with(studentJwt(USER_B)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(USER_B))
                .andExpect(jsonPath("$.email").value("mx-authz-b@campuscore.edu"));
    }

    @Test
    void student_updates_only_own_profile() throws Exception {
        mvc.perform(put("/api/v1/auth/profile")
                        .with(studentJwt(USER_A))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"phone\":\"+84901234567\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(USER_A))
                .andExpect(jsonPath("$.phone").value("+84901234567"));

        assertThat(phone(USER_A)).isEqualTo("+84901234567");
        assertThat(phone(USER_B)).isNull();
    }

    @Test
    void student_cannot_change_another_accounts_password() throws Exception {
        String hashB = passwordHash(USER_B);
        String hashA = passwordHash(USER_A);

        mvc.perform(post("/api/v1/auth/change-password")
                        .with(studentJwt(USER_A))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(changePasswordBody(passwordB, "new-" + UUID.randomUUID())))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_OLD_PASSWORD"));

        assertThat(passwordHash(USER_A)).isEqualTo(hashA);
        assertThat(passwordHash(USER_B)).isEqualTo(hashB);
    }

    @Test
    void student_changes_only_own_password() throws Exception {
        String hashB = passwordHash(USER_B);
        String hashA = passwordHash(USER_A);

        mvc.perform(post("/api/v1/auth/change-password")
                        .with(studentJwt(USER_A))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(changePasswordBody(passwordA, "new-" + UUID.randomUUID())))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.message").value("Password changed successfully"));

        assertThat(passwordHash(USER_A)).isNotEqualTo(hashA);
        assertThat(passwordHash(USER_B)).isEqualTo(hashB);
    }

    @Test
    void student_reads_only_own_two_factor_status() throws Exception {
        mvc.perform(get("/api/v1/me/two-factor").with(studentJwt(USER_A)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.enabled").value(false));

        mvc.perform(get("/api/v1/me/two-factor").with(studentJwt(USER_B)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.enabled").value(true));
    }

    @Test
    void student_cannot_enable_two_factor_on_another_account() throws Exception {
        // A presents B's password on A's own token: the password belongs to a
        // different account, so the enable challenge must never be issued.
        mvc.perform(post("/api/v1/me/two-factor/enable")
                        .with(studentJwt(USER_A))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"password\":\"" + passwordB + "\"}"))
                .andExpect(status().isBadRequest());

        assertThat(twoFactorEnabled(USER_A)).isFalse();
        assertThat(twoFactorEnabled(USER_B)).isTrue();
        assertThat(challengeCount(USER_A, USER_B)).isZero();
    }

    @Test
    void anonymous_cannot_read_profile_or_change_password() throws Exception {
        mvc.perform(get("/api/v1/auth/me"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("UNAUTHENTICATED"));

        mvc.perform(post("/api/v1/auth/change-password")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(changePasswordBody("anything", "new-" + UUID.randomUUID())))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("UNAUTHENTICATED"));
    }

    @Test
    void admin_reads_only_own_profile() throws Exception {
        mvc.perform(get("/api/v1/auth/me").with(adminJwt()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(ADMIN))
                .andExpect(jsonPath("$.email").value("mx-authz-admin@campuscore.edu"));
    }

    private void insertUser(String id, String email, String rawPassword, boolean twoFactorEnabled) {
        jdbc.update("INSERT INTO campuscore_auth.\"User\""
                        + " (\"id\", \"email\", \"password\", \"firstName\", \"lastName\", \"status\","
                        + " \"mustChangePassword\", \"twoFactorEnabled\", \"emailVerified\", \"isSuperAdmin\","
                        + " \"failedLoginAttempts\", \"createdAt\", \"updatedAt\")"
                        + " VALUES (?, ?, ?, 'Matrix', 'Account', 'ACTIVE', FALSE, ?, TRUE, FALSE, 0,"
                        + " CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)",
                id, email, passwordEncoder.encode(rawPassword), twoFactorEnabled);
    }

    private static String changePasswordBody(String oldPassword, String newPassword) {
        return "{\"oldPassword\":\"" + oldPassword + "\",\"newPassword\":\"" + newPassword + "\"}";
    }

    private String phone(String id) {
        return jdbc.queryForObject(
                "SELECT \"phone\" FROM campuscore_auth.\"User\" WHERE \"id\" = ?", String.class, id);
    }

    private String passwordHash(String id) {
        return jdbc.queryForObject(
                "SELECT \"password\" FROM campuscore_auth.\"User\" WHERE \"id\" = ?", String.class, id);
    }

    private boolean twoFactorEnabled(String id) {
        return Boolean.TRUE.equals(jdbc.queryForObject(
                "SELECT \"twoFactorEnabled\" FROM campuscore_auth.\"User\" WHERE \"id\" = ?",
                Boolean.class, id));
    }

    private int challengeCount(String... userIds) {
        Integer count = jdbc.queryForObject(
                "SELECT COUNT(*) FROM campuscore_auth.\"TwoFactorChallenge\""
                        + " WHERE \"userId\" IN ('" + String.join("','", userIds) + "')",
                Integer.class);
        return count == null ? 0 : count;
    }

    private RequestPostProcessor studentJwt(String subject) {
        return fixtureJwt(jdbc, subject, token -> token.subject(subject), "STUDENT")
                .authorities(new SimpleGrantedAuthority("ROLE_STUDENT"));
    }

    private RequestPostProcessor adminJwt() {
        return fixtureJwt(jdbc, ADMIN, token -> token.subject(ADMIN), "ADMIN")
                .authorities(new SimpleGrantedAuthority("ROLE_ADMIN"));
    }
}
