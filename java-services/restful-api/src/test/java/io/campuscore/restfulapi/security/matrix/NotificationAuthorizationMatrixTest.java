package io.campuscore.restfulapi.security.matrix;

import static io.campuscore.restfulapi.testsupport.CurrentAccountJwt.fixtureJwt;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.RequestPostProcessor;

/**
 * Cross-user authorization matrix for the notification inbox.
 *
 * <p>The service deliberately answers 403 for a foreign id and 404 for an id
 * that does not exist (NotificationWritePersistenceTest pins that split on the
 * write lanes); this class pins the same split on the detail read and adds the
 * positive owner/admin rows plus the role gate. No expectation here changes the
 * established contract — it only makes a future regression loud.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles({"test", "persistence"})
@TestPropertySource(properties = {
        "spring.flyway.enabled=false",
        "spring.datasource.url=jdbc:h2:mem:authz_notification;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1"
})
class NotificationAuthorizationMatrixTest {

    private static final String STUDENT = "mx-notif-student";
    private static final String OTHER_STUDENT = "mx-notif-student-2";
    private static final String ADMIN = "mx-notif-admin";
    private static final Instant NOW = Instant.parse("2026-08-21T01:00:00Z");

    @Autowired
    private JdbcTemplate jdbc;

    @Autowired
    private MockMvc mvc;

    @BeforeEach
    void prepareInboxFixture() {
        jdbc.execute("CREATE SCHEMA IF NOT EXISTS notifications");
        jdbc.execute("""
                CREATE TABLE IF NOT EXISTS notifications.notification (
                    id VARCHAR(120) PRIMARY KEY,
                    user_id VARCHAR(120) NOT NULL,
                    title VARCHAR(200) NOT NULL,
                    message VARCHAR(2000) NOT NULL,
                    type VARCHAR(40) NOT NULL,
                    link VARCHAR(500),
                    is_read BOOLEAN NOT NULL DEFAULT FALSE,
                    read_at TIMESTAMP,
                    created_at TIMESTAMP NOT NULL,
                    updated_at TIMESTAMP NOT NULL
                )
                """);
        jdbc.update("DELETE FROM notifications.notification");

        // AccountStateFilter reads this row for every token-bearing request.
        jdbc.execute("CREATE SCHEMA IF NOT EXISTS \"campuscore_auth\"");
        jdbc.execute("""
                CREATE TABLE IF NOT EXISTS "campuscore_auth"."User" (
                    "id" VARCHAR(120) PRIMARY KEY,
                    "email" VARCHAR(320) NOT NULL,
                    "password" VARCHAR(200) NOT NULL DEFAULT 'password',
                    "firstName" VARCHAR(120) NOT NULL DEFAULT 'Test',
                    "lastName" VARCHAR(120) NOT NULL DEFAULT 'User',
                    "status" VARCHAR(40) NOT NULL DEFAULT 'ACTIVE',
                    "mustChangePassword" BOOLEAN NOT NULL DEFAULT FALSE,
                    "twoFactorEnabled" BOOLEAN NOT NULL DEFAULT FALSE,
                    "emailVerified" BOOLEAN NOT NULL DEFAULT TRUE,
                    "isSuperAdmin" BOOLEAN NOT NULL DEFAULT FALSE,
                    "failedLoginAttempts" INTEGER NOT NULL DEFAULT 0,
                    "credentialVersion" BIGINT NOT NULL DEFAULT 0,
                    "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    "updatedAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
                """);
        jdbc.update("DELETE FROM \"campuscore_auth\".\"User\" WHERE \"id\" IN (?, ?, ?)",
                STUDENT, OTHER_STUDENT, ADMIN);
        jdbc.update("DELETE FROM notifications.notification");
    }

    @Test
    void student_reads_own_notification() throws Exception {
        insert("mx-notif-mine", STUDENT, false);

        mvc.perform(get("/api/v1/notifications/mx-notif-mine").with(studentJwt(STUDENT)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value("mx-notif-mine"))
                .andExpect(jsonPath("$.userId").value(STUDENT));
    }

    @Test
    void student_lists_only_own_notifications() throws Exception {
        insert("mx-notif-mine", STUDENT, false);
        insert("mx-notif-foreign", OTHER_STUDENT, false);

        mvc.perform(get("/api/v1/notifications/my").with(studentJwt(STUDENT)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.length()").value(1))
                .andExpect(jsonPath("$.data[0].id").value("mx-notif-mine"))
                .andExpect(jsonPath("$.meta.total").value(1));
    }

    @Test
    void student_cannot_read_another_users_notification() throws Exception {
        insert("mx-notif-foreign", OTHER_STUDENT, false);

        // Foreign id: 403, never the body. Missing id stays 404 so the two
        // answers remain distinguishable exactly as the service intends.
        mvc.perform(get("/api/v1/notifications/mx-notif-foreign").with(studentJwt(STUDENT)))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("ACCESS_DENIED"));

        mvc.perform(get("/api/v1/notifications/mx-notif-missing").with(studentJwt(STUDENT)))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("NOT_FOUND"));
    }

    @Test
    void student_cannot_mark_another_users_notification_read() throws Exception {
        insert("mx-notif-foreign", OTHER_STUDENT, false);

        mvc.perform(patch("/api/v1/notifications/my/mx-notif-foreign/read").with(studentJwt(STUDENT)))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("HTTP_403"));

        assertThat(readFlag("mx-notif-foreign")).isFalse();
    }

    @Test
    void student_cannot_delete_another_users_notification() throws Exception {
        insert("mx-notif-foreign", OTHER_STUDENT, false);

        mvc.perform(delete("/api/v1/notifications/my/mx-notif-foreign").with(studentJwt(STUDENT)))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("HTTP_403"));

        assertThat(rowCount("mx-notif-foreign")).isEqualTo(1);
    }

    @Test
    void student_marks_and_deletes_only_own_notification() throws Exception {
        insert("mx-notif-mine", STUDENT, false);

        mvc.perform(patch("/api/v1/notifications/my/mx-notif-mine/read").with(studentJwt(STUDENT)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.isRead").value(true));
        assertThat(readFlag("mx-notif-mine")).isTrue();

        mvc.perform(delete("/api/v1/notifications/my/mx-notif-mine").with(studentJwt(STUDENT)))
                .andExpect(status().isOk());
        assertThat(rowCount("mx-notif-mine")).isZero();
    }

    @Test
    void anonymous_cannot_read_notification_detail() throws Exception {
        insert("mx-notif-foreign", OTHER_STUDENT, false);

        mvc.perform(get("/api/v1/notifications/mx-notif-foreign"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("UNAUTHENTICATED"));
    }

    @Test
    void admin_reads_another_users_notification() throws Exception {
        insert("mx-notif-foreign", OTHER_STUDENT, false);

        mvc.perform(get("/api/v1/notifications/mx-notif-foreign").with(adminJwt()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value("mx-notif-foreign"))
                .andExpect(jsonPath("$.userId").value(OTHER_STUDENT));
    }

    private void insert(String id, String userId, boolean read) {
        jdbc.update(
                "INSERT INTO notifications.notification "
                        + "(id, user_id, title, message, type, link, is_read, read_at, created_at, updated_at) "
                        + "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                id, userId, "Title " + id, "Message " + id, "INFO", null,
                read, read ? Timestamp.from(NOW.plusSeconds(1)) : null,
                Timestamp.from(NOW), Timestamp.from(NOW));
    }

    private boolean readFlag(String id) {
        return Boolean.TRUE.equals(jdbc.queryForObject(
                "SELECT is_read FROM notifications.notification WHERE id = ?", Boolean.class, id));
    }

    private int rowCount(String id) {
        Integer count = jdbc.queryForObject(
                "SELECT COUNT(*) FROM notifications.notification WHERE id = ?", Integer.class, id);
        return count == null ? 0 : count;
    }

    private RequestPostProcessor studentJwt(String subject) {
        return fixtureJwt(jdbc, subject, token -> token
                        .subject(subject)
                        .claim("roles", List.of("STUDENT")), "STUDENT")
                .authorities(new SimpleGrantedAuthority("ROLE_STUDENT"));
    }

    private RequestPostProcessor adminJwt() {
        return fixtureJwt(jdbc, ADMIN, token -> token
                        .subject(ADMIN)
                        .claim("roles", List.of("ADMIN")), "ADMIN")
                .authorities(new SimpleGrantedAuthority("ROLE_ADMIN"));
    }
}
