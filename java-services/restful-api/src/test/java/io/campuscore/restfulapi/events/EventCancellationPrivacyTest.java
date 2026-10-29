package io.campuscore.restfulapi.events;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import io.campuscore.restfulapi.events.service.EventService;
import io.campuscore.restfulapi.testsupport.CurrentAccountJwt;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.core.io.ClassPathResource;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.init.ScriptUtils;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.RequestPostProcessor;
import tools.jackson.databind.ObjectMapper;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles({"test", "persistence"})
@TestPropertySource(properties = {
        "spring.flyway.enabled=false",
        "spring.datasource.url=jdbc:h2:mem:events_contract;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1"
})
class EventCancellationPrivacyTest {

    @Autowired private JdbcTemplate jdbc;
    @Autowired private MockMvc mvc;
    @Autowired private ObjectMapper objectMapper;
    @Autowired private EventService events;

    private RequestPostProcessor staff;
    private RequestPostProcessor student;
    private RequestPostProcessor secondStudent;

    @BeforeEach
    void fixture() throws Exception {
        jdbc.execute("CREATE SCHEMA IF NOT EXISTS campuscore_auth");
        jdbc.execute("CREATE SCHEMA IF NOT EXISTS notifications");
        jdbc.execute("DROP SCHEMA IF EXISTS events CASCADE");
        jdbc.execute("DROP TABLE IF EXISTS notifications.notification");
        jdbc.execute("""
                CREATE TABLE notifications.notification (
                    id VARCHAR(120) PRIMARY KEY,
                    user_id VARCHAR(120) NOT NULL,
                    title VARCHAR(240) NOT NULL,
                    message VARCHAR(2000) NOT NULL,
                    type VARCHAR(60) NOT NULL,
                    link VARCHAR(500),
                    is_read BOOLEAN NOT NULL DEFAULT FALSE,
                    read_at TIMESTAMP WITH TIME ZONE,
                    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
                )
                """);
        try (var connection = jdbc.getDataSource().getConnection()) {
            ScriptUtils.executeSqlScript(connection,
                    new ClassPathResource("db/migration-h2/V137__events_schema_and_grants.sql"));
        }
        staff = CurrentAccountJwt.fixtureJwt(jdbc, "staff-user", "LECTURER");
        student = CurrentAccountJwt.fixtureJwt(jdbc, "student-1", "STUDENT");
        secondStudent = CurrentAccountJwt.fixtureJwt(jdbc, "student-2", "STUDENT");
        jdbc.update("INSERT INTO events.\"StaffGrant\" (\"id\", \"userId\", \"scope\", \"grantedBy\")"
                + " VALUES ('cancel-owner', 'staff-user', 'events', 'test-fixture')");
    }

    @Test
    void cancelledDraftRemainsAbsentFromStudentList() throws Exception {
        String id = createDraft("Private planning", "Unpublished private description");
        assertHiddenFromList(id);
        cancel(id, "Private cancellation reason");
        assertHiddenFromList(id);
        mvc.perform(get("/api/v1/events/staff/" + id).with(staff))
                .andExpect(status().isOk()).andExpect(jsonPath("$.status").value("CANCELLED"))
                .andExpect(jsonPath("$.description").value("Unpublished private description"));
    }

    @Test
    void cancelledDraftDetailIsIndistinguishableFromMissing() throws Exception {
        String id = createDraft("Private planning", "Unpublished private description");
        assertMissingDetail(id);
        cancel(id, "Private cancellation reason");
        assertMissingDetail(id);
        assertMissingDetail("missing-event");
    }

    @Test
    void cancelledPublishedEventRemainsVisibleWithoutRegistrations() throws Exception {
        String id = createDraft("Public event", "Published description");
        publish(id);
        mvc.perform(get("/api/v1/events/" + id).with(student))
                .andExpect(status().isOk()).andExpect(jsonPath("$.status").value("PUBLISHED"));
        cancel(id, "Schedule change");
        mvc.perform(get("/api/v1/events").with(student))
                .andExpect(status().isOk()).andExpect(jsonPath("$[0].id").value(id))
                .andExpect(jsonPath("$[0].status").value("CANCELLED"));
        mvc.perform(get("/api/v1/events/" + id).with(student))
                .andExpect(status().isOk()).andExpect(jsonPath("$.description").value("Published description"));
    }

    @Test
    void cancelledEventWithUnknownPublicationHistoryStaysHidden() throws Exception {
        String id = createDraft("Unknown history", "Private until proven published");
        publish(id);
        cancel(id, null);
        // Missing historical provenance must not be inferred from CANCELLED alone.
        jdbc.update("DELETE FROM events.\"Audit\" WHERE \"eventId\" = ? AND \"action\" = 'PUBLISHED'", id);
        String otherId = createDraft("Other event", "Other description");
        publish(otherId);
        assertHiddenFromList(id);
        assertMissingDetail(id);
    }

    @ParameterizedTest
    @ValueSource(strings = {"title", "reason", "both", "unicode"})
    void maximumInputsCancelAllRegistrationsWithinNotificationLimits(String variant) throws Exception {
        String title = variant.equals("reason") ? "Public event" : "Đ".repeat(240);
        String reason = variant.equals("title") ? "Schedule change" : "ý".repeat(2000);
        if (variant.equals("unicode")) {
            // Put a surrogate pair across each generated notification's truncation boundary.
            title = "Đ".repeat(223) + "🚀" + "x".repeat(15);
            reason = "ý".repeat(1961) + "🚀" + "x".repeat(37);
        }
        String id = openWithRegistrants(title);
        cancel(id, reason);
        assertThat(jdbc.queryForObject("SELECT \"registeredCount\" FROM events.\"Event\" WHERE \"id\" = ?",
                Integer.class, id)).isZero();
        assertThat(jdbc.queryForList("SELECT \"status\" FROM events.\"Registration\" WHERE \"eventId\" = ?",
                String.class, id)).containsExactly("CANCELLED", "CANCELLED");
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM events.\"Registration\" WHERE \"eventId\" = ?"
                + " AND \"cancelledAt\" IS NOT NULL AND \"version\" = 1", Integer.class, id)).isEqualTo(2);
        var notices = jdbc.queryForList("SELECT user_id, title, message, type, link FROM notifications.notification"
                + " WHERE type = 'WARNING' ORDER BY user_id");
        assertThat(notices).hasSize(2);
        String expectedTitle = "Sự kiện đã hủy: " + title;
        String expectedMessage = "Sự kiện bạn đăng ký đã bị hủy. Lý do: " + reason;
        for (var notice : notices) {
            String actualTitle = (String) notice.get("title");
            String actualMessage = (String) notice.get("message");
            assertThat(actualTitle.length()).isLessThanOrEqualTo(240);
            assertThat(actualMessage.length()).isLessThanOrEqualTo(2000);
            assertThat(actualTitle).startsWith("Sự kiện đã hủy: ");
            assertThat(actualMessage).startsWith("Sự kiện bạn đăng ký đã bị hủy. Lý do: ");
            assertThat(expectedTitle).startsWith(actualTitle);
            assertThat(expectedMessage).startsWith(actualMessage);
            if (variant.equals("unicode")) {
                assertThat(actualTitle).isEqualTo("Sự kiện đã hủy: " + "Đ".repeat(223));
                assertThat(actualMessage).isEqualTo("Sự kiện bạn đăng ký đã bị hủy. Lý do: " + "ý".repeat(1961));
            } else {
                assertThat(actualTitle.length()).isEqualTo(variant.equals("reason") ? expectedTitle.length() : 240);
                assertThat(actualMessage.length()).isEqualTo(variant.equals("title") ? expectedMessage.length() : 2000);
            }
            assertThat(Character.isHighSurrogate(actualTitle.charAt(actualTitle.length() - 1))).isFalse();
            assertThat(Character.isHighSurrogate(actualMessage.charAt(actualMessage.length() - 1))).isFalse();
            assertThat(notice.get("link")).isEqualTo("/dashboard/events?event=" + id);
        }
        assertThat(notices.stream().map(row -> row.get("user_id")).toList())
                .containsExactly("student-1", "student-2");
        assertThat(jdbc.queryForObject("SELECT \"detail\" FROM events.\"Audit\""
                + " WHERE \"eventId\" = ? AND \"action\" = 'CANCELLED'", String.class, id))
                .isEqualTo("reason=" + reason);
        assertThat(jdbc.queryForObject("SELECT \"title\" FROM events.\"Event\" WHERE \"id\" = ?",
                String.class, id)).isEqualTo(title);
        mvc.perform(get("/api/v1/events/my/registrations").with(student))
                .andExpect(status().isOk()).andExpect(jsonPath("$[0].registrationStatus").value("CANCELLED"));
        mvc.perform(get("/api/v1/events/" + id).with(secondStudent))
                .andExpect(status().isOk()).andExpect(jsonPath("$.status").value("CANCELLED"));
    }

    @ParameterizedTest
    @ValueSource(strings = {"", "   "})
    void blankReasonKeepsDefaultNotification(String reason) throws Exception {
        String id = openWithRegistrants("Public event");
        cancel(id, reason);
        assertThat(jdbc.queryForList("SELECT message FROM notifications.notification WHERE type = 'WARNING'",
                String.class)).containsExactly("Sự kiện bạn đăng ký đã bị hủy.", "Sự kiện bạn đăng ký đã bị hủy.");
    }

    @Test
    void finalAuditFailureRollsBackCancellationAndEntireNotificationBatch() throws Exception {
        String id = openWithRegistrants("Đ".repeat(240));
        var eventBefore = jdbc.queryForMap("SELECT * FROM events.\"Event\" WHERE \"id\" = ?", id);
        var registrationsBefore = jdbc.queryForList("SELECT * FROM events.\"Registration\" ORDER BY \"id\"");
        var noticesBefore = jdbc.queryForList("SELECT * FROM notifications.notification ORDER BY id");
        var auditBefore = jdbc.queryForList("SELECT * FROM events.\"Audit\" ORDER BY \"id\"");
        jdbc.execute("ALTER TABLE events.\"Audit\" ADD CONSTRAINT reject_cancel_audit CHECK (\"action\" <> 'CANCELLED')");
        try {
            assertThatThrownBy(() -> events.cancel("staff-user", id, "ý".repeat(2000)))
                    .isInstanceOf(DataIntegrityViolationException.class)
                    .hasMessageContaining("reject_cancel_audit");
            assertThat(jdbc.queryForMap("SELECT * FROM events.\"Event\" WHERE \"id\" = ?", id)).isEqualTo(eventBefore);
            assertThat(jdbc.queryForList("SELECT * FROM events.\"Registration\" ORDER BY \"id\""))
                    .isEqualTo(registrationsBefore);
            assertThat(jdbc.queryForList("SELECT * FROM notifications.notification ORDER BY id")).isEqualTo(noticesBefore);
            assertThat(jdbc.queryForList("SELECT * FROM events.\"Audit\" ORDER BY \"id\"" )).isEqualTo(auditBefore);
        } finally {
            jdbc.execute("ALTER TABLE events.\"Audit\" DROP CONSTRAINT reject_cancel_audit");
        }
        cancel(id, "ý".repeat(2000));
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM notifications.notification WHERE type = 'WARNING'",
                Integer.class)).isEqualTo(2);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM events.\"Audit\" WHERE \"action\" = 'CANCELLED'",
                Integer.class)).isEqualTo(1);
    }

    private String createDraft(String title, String description) throws Exception {
        Instant startsAt = Instant.now().plus(2, ChronoUnit.HOURS);
        var result = mvc.perform(post("/api/v1/events/staff").with(staff)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of(
                                "title", title, "description", description, "organizer", "Student office",
                                "capacity", 2, "startsAt", startsAt.toString(),
                                "endsAt", startsAt.plus(2, ChronoUnit.HOURS).toString()))))
                .andExpect(status().isCreated()).andReturn();
        return objectMapper.readTree(result.getResponse().getContentAsString()).get("id").asText();
    }

    private void publish(String id) throws Exception {
        mvc.perform(post("/api/v1/events/staff/" + id + "/publish").with(staff)).andExpect(status().isOk());
    }

    private String openWithRegistrants(String title) throws Exception {
        String id = createDraft(title, "Published description");
        publish(id);
        mvc.perform(post("/api/v1/events/staff/" + id + "/open-registration").with(staff)
                .contentType(MediaType.APPLICATION_JSON).content("{}")).andExpect(status().isOk());
        for (var registrant : List.of(student, secondStudent)) {
            mvc.perform(post("/api/v1/events/" + id + "/register").with(registrant)
                    .header("Idempotency-Key", "registration")).andExpect(status().isCreated());
        }
        return id;
    }

    private void cancel(String id, String reason) throws Exception {
        mvc.perform(post("/api/v1/events/staff/" + id + "/cancel").with(staff)
                .contentType(MediaType.APPLICATION_JSON)
                .content(reason == null ? "{}" : objectMapper.writeValueAsString(Map.of("reason", reason))))
                .andExpect(status().isOk()).andExpect(jsonPath("$.status").value("CANCELLED"));
    }

    private void assertHiddenFromList(String id) throws Exception {
        mvc.perform(get("/api/v1/events").with(student)).andExpect(status().isOk())
                .andExpect(jsonPath("$[?(@.id=='" + id + "')]").isEmpty());
    }

    private void assertMissingDetail(String id) throws Exception {
        mvc.perform(get("/api/v1/events/" + id).with(student))
                .andExpect(status().isNotFound()).andExpect(jsonPath("$.code").value("EVENT_NOT_FOUND"))
                .andExpect(jsonPath("$.message").value("Event not found"));
    }
}
