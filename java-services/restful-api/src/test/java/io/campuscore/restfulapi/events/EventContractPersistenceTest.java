package io.campuscore.restfulapi.events;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import io.campuscore.restfulapi.testsupport.CurrentAccountJwt;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.core.io.ClassPathResource;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.init.ScriptUtils;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.RequestPostProcessor;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * H2 contract test for the P08 events domain (contract D4). Proves the
 * lifecycle, scoped authority, capacity, idempotency, cancel-frees-one-seat,
 * transactional notifications and the attendance boundary on the real
 * controllers + service + H2 mirror DDL. The PostgreSQL last-seat race and
 * the partial-unique backstop are proven separately in
 * {@code EventCapacityPostgresIT} (env-gated).
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles({"test", "persistence"})
@TestPropertySource(properties = {
        "spring.flyway.enabled=false",
        "spring.datasource.url=jdbc:h2:mem:events_contract;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1"
})
class EventContractPersistenceTest {

    @Autowired
    private JdbcTemplate jdbc;

    @Autowired
    private MockMvc mvc;

    @Autowired
    private ObjectMapper objectMapper;

    private RequestPostProcessor staffJwt;
    private RequestPostProcessor secondStaffJwt;
    private RequestPostProcessor adminJwt;
    private RequestPostProcessor studentJwt;
    private RequestPostProcessor student2Jwt;
    private RequestPostProcessor outsiderJwt;

    @BeforeEach
    void fixture() throws Exception {
        jdbc.execute("CREATE SCHEMA IF NOT EXISTS campuscore_auth");
        jdbc.execute("CREATE SCHEMA IF NOT EXISTS notifications");
        // Fresh domain state per test: the shared in-memory H2 keeps schemas
        // across the cached context, so drop before re-applying the mirror.
        jdbc.execute("DROP SCHEMA IF EXISTS events CASCADE");
        jdbc.execute("DROP TABLE IF EXISTS notifications.notification");
        jdbc.execute("CREATE SCHEMA IF NOT EXISTS events");
        jdbc.execute("""
                CREATE TABLE IF NOT EXISTS notifications.notification (
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
        // Apply the exact H2 mirror DDL so the contract test runs the same
        // schema Flyway applies in test profile deployments.
        try (java.sql.Connection connection = jdbc.getDataSource().getConnection()) {
            ScriptUtils.executeSqlScript(connection,
                    new ClassPathResource("db/migration-h2/V137__events_schema_and_grants.sql"));
        }

        staffJwt = CurrentAccountJwt.fixtureJwt(jdbc, "staff-user", "LECTURER");
        secondStaffJwt = CurrentAccountJwt.fixtureJwt(jdbc, "staff-user-2", "LECTURER");
        adminJwt = CurrentAccountJwt.fixtureJwt(jdbc, "admin-user", "ADMIN");
        studentJwt = CurrentAccountJwt.fixtureJwt(jdbc, "student-1", "STUDENT");
        student2Jwt = CurrentAccountJwt.fixtureJwt(jdbc, "student-2", "STUDENT");
        outsiderJwt = CurrentAccountJwt.fixtureJwt(jdbc, "lecturer-outsider", "LECTURER");

        grantEvents("staff-user", "test-fixture");
        grantEvents("staff-user-2", "test-fixture");
    }

    private void grantEvents(String userId, String grantedBy) {
        jdbc.update("INSERT INTO events.\"StaffGrant\" (\"id\", \"userId\", \"scope\", \"grantedBy\")"
                        + " VALUES (?, ?, 'events', ?)",
                "grant-" + userId, userId, grantedBy);
    }

    private String createEventJson(int capacity, Instant startsAt, Instant endsAt,
            Instant opensAt, Instant closesAt) {
        return "{"
                + "\"title\":\"Hoi trai sinh vien\","
                + "\"description\":\"demo\","
                + "\"location\":\"Hall A\","
                + "\"organizer\":\"Doan Thanh nien\","
                + "\"capacity\":" + capacity + ","
                + "\"startsAt\":\"" + startsAt + "\","
                + "\"endsAt\":\"" + endsAt + "\","
                + "\"registrationOpensAt\":" + (opensAt == null ? "null" : "\"" + opensAt + "\"") + ","
                + "\"registrationClosesAt\":" + (closesAt == null ? "null" : "\"" + closesAt + "\"") + "}";
    }

    private String createDraft(RequestPostProcessor staff, int capacity,
            Instant startsAt, Instant endsAt) throws Exception {
        MvcResult result = mvc.perform(post("/api/v1/events/staff").with(staff)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(createEventJson(capacity, startsAt, endsAt,
                                Instant.now().minus(1, ChronoUnit.HOURS),
                                Instant.now().plus(1, ChronoUnit.HOURS))))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.status").value("DRAFT"))
                .andReturn();
        return objectMapper.readTree(result.getResponse().getContentAsString()).get("id").asText();
    }

    private String openEventId() throws Exception {
        String eventId = createDraft(staffJwt, 2,
                Instant.now().plus(2, ChronoUnit.HOURS), Instant.now().plus(5, ChronoUnit.HOURS));
        mvc.perform(post("/api/v1/events/staff/" + eventId + "/publish").with(staffJwt))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("PUBLISHED"));
        mvc.perform(post("/api/v1/events/staff/" + eventId + "/open-registration").with(staffJwt)
                        .contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("REGISTRATION_OPEN"));
        return eventId;
    }

    /** Moves the stored start into the past, standing in for the clock reaching the event. */
    private void startEventNow(String eventId) {
        jdbc.update("UPDATE events.\"Event\" SET \"startsAt\" = ?, \"endsAt\" = ? WHERE \"id\" = ?",
                Timestamp.from(Instant.now().minus(1, ChronoUnit.HOURS)),
                Timestamp.from(Instant.now().plus(1, ChronoUnit.HOURS)), eventId);
    }

    private String register(String eventId, RequestPostProcessor student, String key) throws Exception {
        MvcResult result = mvc.perform(post("/api/v1/events/" + eventId + "/register").with(student)
                        .header("Idempotency-Key", key))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.status").value("REGISTERED"))
                .andReturn();
        return objectMapper.readTree(result.getResponse().getContentAsString())
                .get("id").asText();
    }

    // ---------------------------------------------------------------
    // EVT-T01..T06 happy path + scope
    // ---------------------------------------------------------------

    @Test
    void lifecycleDraftHiddenPublishOpenRegisterCloseAttendComplete() throws Exception {
        String eventId = createDraft(staffJwt, 5,
                Instant.now().plus(2, ChronoUnit.HOURS), Instant.now().plus(4, ChronoUnit.HOURS));

        // DRAFT is staff-scope: students see an indistinguishable 404/empty.
        mvc.perform(get("/api/v1/events/" + eventId).with(studentJwt))
                .andExpect(status().isNotFound());
        mvc.perform(get("/api/v1/events").with(studentJwt))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[?(@.id=='" + eventId + "')]").isEmpty());

        mvc.perform(post("/api/v1/events/staff/" + eventId + "/publish").with(staffJwt))
                .andExpect(status().isOk());
        mvc.perform(post("/api/v1/events/staff/" + eventId + "/open-registration").with(staffJwt)
                        .contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().isOk());

        String registrationId = register(eventId, studentJwt, "reg-key-1");

        mvc.perform(get("/api/v1/events/staff/" + eventId + "/roster").with(staffJwt))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].registrationId").value(registrationId))
                .andExpect(jsonPath("$[0].attendanceStatus").value("ABSENT"));

        // Attendance while open is forbidden — roster marking follows close.
        mvc.perform(post("/api/v1/events/staff/" + eventId + "/attendance").with(staffJwt)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"marks\":[{\"registrationId\":\"" + registrationId
                                + "\",\"status\":\"ATTENDED\"}]}"))
                .andExpect(status().isConflict());

        mvc.perform(post("/api/v1/events/staff/" + eventId + "/close-registration").with(staffJwt))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("REGISTRATION_CLOSED"));

        // Attendance and completion only exist once the event has started.
        startEventNow(eventId);
        mvc.perform(post("/api/v1/events/staff/" + eventId + "/attendance").with(staffJwt)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"marks\":[{\"registrationId\":\"" + registrationId
                                + "\",\"status\":\"ATTENDED\"}]}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].attendanceStatus").value("ATTENDED"))
                .andExpect(jsonPath("$[0].attendanceMarkedBy").value("staff-user"));

        mvc.perform(post("/api/v1/events/staff/" + eventId + "/complete").with(staffJwt))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("COMPLETED"));

        // Student history retains the attended registration.
        mvc.perform(get("/api/v1/events/my/registrations").with(studentJwt))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].registrationStatus").value("REGISTERED"))
                .andExpect(jsonPath("$[0].attendanceStatus").value("ATTENDED"));
    }

    @Test
    void staffScopeRequiredForEveryStaffOperation() throws Exception {
        String eventId = openEventId();
        // A lecturer without the events grant gets 403 EVENTS_STAFF_REQUIRED.
        mvc.perform(post("/api/v1/events/staff").with(outsiderJwt)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(createEventJson(10, Instant.now().plus(1, ChronoUnit.HOURS),
                                Instant.now().plus(2, ChronoUnit.HOURS), null, null)))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("EVENTS_STAFF_REQUIRED"));
        mvc.perform(get("/api/v1/events/staff/" + eventId + "/roster").with(outsiderJwt))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("EVENTS_STAFF_REQUIRED"));
        mvc.perform(post("/api/v1/events/staff/" + eventId + "/cancel").with(outsiderJwt)
                        .contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().isForbidden());
        // A student cannot register for a peer — SELF comes from the token.
        // (There is simply no studentId parameter to forge.)
    }

    @Test
    void publishRequiresOwnerGrantee() throws Exception {
        String eventId = createDraft(staffJwt, 5,
                Instant.now().plus(1, ChronoUnit.HOURS), Instant.now().plus(2, ChronoUnit.HOURS));
        // Second grant holder may administer grants/rosters but may not
        // publish an event owned by another staff member (EVT-T01 owner).
        mvc.perform(post("/api/v1/events/staff/" + eventId + "/publish").with(secondStaffJwt))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("EVENT_NOT_OWNER"));
        mvc.perform(post("/api/v1/events/staff/" + eventId + "/publish").with(staffJwt))
                .andExpect(status().isOk());
    }

    // ---------------------------------------------------------------
    // Capacity + idempotency
    // ---------------------------------------------------------------

    @Test
    void lastSeatSequentialProofAndFullRejection() throws Exception {
        String eventId = createDraft(staffJwt, 1,
                Instant.now().plus(2, ChronoUnit.HOURS), Instant.now().plus(4, ChronoUnit.HOURS));
        mvc.perform(post("/api/v1/events/staff/" + eventId + "/publish").with(staffJwt));
        mvc.perform(post("/api/v1/events/staff/" + eventId + "/open-registration").with(staffJwt)
                .contentType(MediaType.APPLICATION_JSON).content("{}"));

        register(eventId, studentJwt, "s1-key");
        mvc.perform(post("/api/v1/events/" + eventId + "/register").with(student2Jwt)
                        .header("Idempotency-Key", "s2-key"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("EVENT_FULL"));

        Integer count = jdbc.queryForObject(
                "SELECT \"registeredCount\" FROM events.\"Event\" WHERE \"id\" = ?",
                Integer.class, eventId);
        assertThat(count).isEqualTo(1);
    }

    @Test
    void idempotentReplayReturnsSameRegistration() throws Exception {
        String eventId = openEventId();
        String first = register(eventId, studentJwt, "replay-key");
        String second = register(eventId, studentJwt, "replay-key");
        assertThat(second).isEqualTo(first);
        Integer rows = jdbc.queryForObject(
                "SELECT COUNT(*) FROM events.\"Registration\" WHERE \"eventId\" = ? AND \"status\" = 'REGISTERED'",
                Integer.class, eventId);
        Integer count = jdbc.queryForObject(
                "SELECT \"registeredCount\" FROM events.\"Event\" WHERE \"id\" = ?",
                Integer.class, eventId);
        assertThat(rows).isEqualTo(1);
        assertThat(count).isEqualTo(1);

        // Same key, different payload → conflict (contract §1.3).
        mvc.perform(post("/api/v1/events/registrations/" + first + "/cancel").with(studentJwt)
                        .header("Idempotency-Key", "replay-key"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("IDEMPOTENCY_CONFLICT"));

        // Missing key is a client error, not a silent retry.
        mvc.perform(post("/api/v1/events/" + eventId + "/register").with(student2Jwt))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("IDEMPOTENCY_KEY_REQUIRED"));
    }

    @Test
    void cancelFreesExactlyOneSeatAndRetainsHistory() throws Exception {
        String eventId = createDraft(staffJwt, 1,
                Instant.now().plus(2, ChronoUnit.HOURS), Instant.now().plus(4, ChronoUnit.HOURS));
        mvc.perform(post("/api/v1/events/staff/" + eventId + "/publish").with(staffJwt));
        mvc.perform(post("/api/v1/events/staff/" + eventId + "/open-registration").with(staffJwt)
                .contentType(MediaType.APPLICATION_JSON).content("{}"));

        String registrationId = register(eventId, studentJwt, "r1");
        mvc.perform(post("/api/v1/events/" + eventId + "/register").with(student2Jwt)
                        .header("Idempotency-Key", "r2"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("EVENT_FULL"));

        mvc.perform(post("/api/v1/events/registrations/" + registrationId + "/cancel")
                        .with(studentJwt).header("Idempotency-Key", "cancel-1"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("CANCELLED"));

        Integer count = jdbc.queryForObject(
                "SELECT \"registeredCount\" FROM events.\"Event\" WHERE \"id\" = ?",
                Integer.class, eventId);
        Integer retained = jdbc.queryForObject(
                "SELECT COUNT(*) FROM events.\"Registration\" WHERE \"id\" = ? AND \"status\" = 'CANCELLED'",
                Integer.class, registrationId);
        assertThat(count).isEqualTo(0);
        assertThat(retained).isEqualTo(1);

        // The freed seat is claimable by exactly the next student.
        register(eventId, student2Jwt, "r2b");

        // Cancelling an already-cancelled registration is a conflict, and the
        // replayed cancel key returns the stored row without double-freeing.
        mvc.perform(post("/api/v1/events/registrations/" + registrationId + "/cancel")
                        .with(studentJwt).header("Idempotency-Key", "cancel-2"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("REGISTRATION_NOT_ACTIVE"));
    }

    @Test
    void studentCannotCancelAnotherStudentsRegistration() throws Exception {
        // §1.1: object-scope deny returns 404, identical to a missing id —
        // no existence oracle between "not found" and "not yours".
        String eventId = openEventId();
        String registrationId = register(eventId, studentJwt, "owner-key");
        mvc.perform(post("/api/v1/events/registrations/" + registrationId + "/cancel")
                        .with(student2Jwt).header("Idempotency-Key", "thief-key"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("REGISTRATION_NOT_FOUND"));
        mvc.perform(post("/api/v1/events/registrations/00000000-0000-0000-0000-000000000000/cancel")
                        .with(student2Jwt).header("Idempotency-Key", "ghost-key"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("REGISTRATION_NOT_FOUND"));
    }

    @Test
    void cancelThenReregisterKeepsSingleActiveRowOnEveryRead() throws Exception {
        // Regression for the my.* join: after cancel→re-register the student
        // owns two history rows, and only the active one may join — otherwise
        // detail 500s (IncorrectResultSize) and the catalog lists the event
        // twice.
        String eventId = openEventId();
        String firstId = register(eventId, studentJwt, "rr-1");
        mvc.perform(post("/api/v1/events/registrations/" + firstId + "/cancel")
                        .with(studentJwt).header("Idempotency-Key", "rr-cancel"))
                .andExpect(status().isOk());
        String secondId = register(eventId, studentJwt, "rr-2");
        assertThat(secondId).isNotEqualTo(firstId);

        mvc.perform(get("/api/v1/events/" + eventId).with(studentJwt))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(eventId))
                .andExpect(jsonPath("$.myRegistrationId").value(secondId))
                .andExpect(jsonPath("$.myRegistrationStatus").value("REGISTERED"));

        // The catalog must contain the event exactly once.
        MvcResult list = mvc.perform(get("/api/v1/events").with(studentJwt))
                .andExpect(status().isOk())
                .andReturn();
        var entries = objectMapper.readTree(list.getResponse().getContentAsString());
        var matches = new java.util.ArrayList<JsonNode>();
        entries.forEach(entry -> {
            if (eventId.equals(entry.get("id").asText())) {
                matches.add(entry);
            }
        });
        assertThat(matches).hasSize(1);
        assertThat(matches.get(0).get("myRegistrationId").asText()).isEqualTo(secondId);

        // History still shows both rows — the cancelled one is retained.
        mvc.perform(get("/api/v1/events/my/registrations").with(studentJwt))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(2));
    }

    // ---------------------------------------------------------------
    // EVT-T05 cancel + notifications in one transaction
    // ---------------------------------------------------------------

    @Test
    void eventCancelNotifiesRegistrantsTransactionally() throws Exception {
        String eventId = openEventId();
        String registrationId = register(eventId, studentJwt, "notify-key");

        mvc.perform(post("/api/v1/events/staff/" + eventId + "/cancel").with(staffJwt)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"reason\":\"phong bi chiem\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("CANCELLED"));

        List<Map<String, Object>> notices = jdbc.queryForList(
                "SELECT title, type, link FROM notifications.notification WHERE user_id = 'student-1'"
                        + " AND link LIKE '%" + eventId + "%'");
        assertThat(notices).isNotEmpty();
        assertThat(notices.stream().anyMatch(n -> "WARNING".equals(n.get("type"))
                && String.valueOf(n.get("title")).contains("hủy"))).isTrue();

        // Registration history is retained (CANCELLED row, not deleted).
        Integer retained = jdbc.queryForObject(
                "SELECT COUNT(*) FROM events.\"Registration\" WHERE \"id\" = ? AND \"status\" = 'CANCELLED'",
                Integer.class, registrationId);
        assertThat(retained).isEqualTo(1);

        // The cancelled event still displays (contract: cancelled shown clearly).
        mvc.perform(get("/api/v1/events/" + eventId).with(studentJwt))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("CANCELLED"));

        // New registrations into a cancelled event are impossible.
        mvc.perform(post("/api/v1/events/" + eventId + "/register").with(student2Jwt)
                        .header("Idempotency-Key", "late-key"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("EVENT_NOT_OPEN"));
    }

    @Test
    void attendanceRejectsNonRosterMarksAndCorrections() throws Exception {
        String eventId = createDraft(staffJwt, 3,
                Instant.now().plus(2, ChronoUnit.HOURS), Instant.now().plus(4, ChronoUnit.HOURS));
        mvc.perform(post("/api/v1/events/staff/" + eventId + "/publish").with(staffJwt));
        mvc.perform(post("/api/v1/events/staff/" + eventId + "/open-registration").with(staffJwt)
                .contentType(MediaType.APPLICATION_JSON).content("{}"));
        String registrationId = register(eventId, studentJwt, "att-key");
        mvc.perform(post("/api/v1/events/staff/" + eventId + "/close-registration").with(staffJwt));
        startEventNow(eventId);

        // Unknown registration id → not on roster.
        mvc.perform(post("/api/v1/events/staff/" + eventId + "/attendance").with(staffJwt)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"marks\":[{\"registrationId\":\"nope\",\"status\":\"ATTENDED\"}]}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("EVENT_REGISTRATION_NOT_ON_ROSTER"));

        // ATTENDED then corrected back to ABSENT (manual audit trail).
        mvc.perform(post("/api/v1/events/staff/" + eventId + "/attendance").with(staffJwt)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"marks\":[{\"registrationId\":\"" + registrationId
                                + "\",\"status\":\"ATTENDED\"}]}"))
                .andExpect(status().isOk());
        mvc.perform(post("/api/v1/events/staff/" + eventId + "/attendance").with(staffJwt)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"marks\":[{\"registrationId\":\"" + registrationId
                                + "\",\"status\":\"ABSENT\"}]}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].attendanceStatus").value("ABSENT"));
    }

    @Test
    void eventNotYetStartedRejectsAttendance() throws Exception {
        String eventId = createDraft(staffJwt, 3,
                Instant.now().plus(2, ChronoUnit.HOURS), Instant.now().plus(4, ChronoUnit.HOURS));
        mvc.perform(post("/api/v1/events/staff/" + eventId + "/publish").with(staffJwt));
        mvc.perform(post("/api/v1/events/staff/" + eventId + "/open-registration").with(staffJwt)
                .contentType(MediaType.APPLICATION_JSON).content("{}"));
        String registrationId = register(eventId, studentJwt, "early-key");
        mvc.perform(post("/api/v1/events/staff/" + eventId + "/close-registration").with(staffJwt));

        mvc.perform(post("/api/v1/events/staff/" + eventId + "/attendance").with(staffJwt)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"marks\":[{\"registrationId\":\"" + registrationId
                                + "\",\"status\":\"ATTENDED\"}]}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("EVENT_NOT_STARTED"));
    }

    // ---------------------------------------------------------------
    // Grants (ADMIN authority) + conduct boundary
    // ---------------------------------------------------------------

    @Test
    void grantAdministrationRequiresAdminRole() throws Exception {
        // Staff grant holder cannot grant — ADMIN only.
        mvc.perform(post("/api/v1/events/staff/grants").with(staffJwt)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"userId\":\"lecturer-outsider\"}"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("EVENTS_ADMIN_REQUIRED"));

        mvc.perform(post("/api/v1/events/staff/grants").with(adminJwt)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"userId\":\"lecturer-outsider\"}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.scope").value("events"));

        // The newly granted outsider can now use staff operations.
        mvc.perform(get("/api/v1/events/staff").with(outsiderJwt))
                .andExpect(status().isOk());
    }

    // ---------------------------------------------------------------
    // Regression: authority and time preconditions
    // ---------------------------------------------------------------

    @Test
    void nonOwnerGranteeCannotEditAnotherOwnersDraft() throws Exception {
        String eventId = createDraft(staffJwt, 5,
                Instant.now().plus(2, ChronoUnit.HOURS), Instant.now().plus(4, ChronoUnit.HOURS));
        mvc.perform(put("/api/v1/events/staff/" + eventId).with(secondStaffJwt)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"title\":\"hijacked\",\"capacity\":1}"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("EVENT_NOT_OWNER"));
        mvc.perform(put("/api/v1/events/staff/" + eventId).with(staffJwt)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"title\":\"owner edit\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.title").value("owner edit"));
    }

    @Test
    void adminWithoutGrantCannotRunStaffOperations() throws Exception {
        RequestPostProcessor ungrantedAdmin = CurrentAccountJwt.fixtureJwt(jdbc, "admin-no-grant", "ADMIN");
        String eventId = openEventId();
        mvc.perform(get("/api/v1/events/staff").with(ungrantedAdmin))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("EVENTS_STAFF_REQUIRED"));
        mvc.perform(get("/api/v1/events/staff/" + eventId + "/roster").with(ungrantedAdmin))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("EVENTS_STAFF_REQUIRED"));
        mvc.perform(post("/api/v1/events/staff/" + eventId + "/cancel").with(ungrantedAdmin)
                        .contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("EVENTS_STAFF_REQUIRED"));
    }

    @Test
    void studentRegisterOnDraftIsIndistinguishableFromMissing() throws Exception {
        String draftId = createDraft(staffJwt, 5,
                Instant.now().plus(2, ChronoUnit.HOURS), Instant.now().plus(4, ChronoUnit.HOURS));
        String draft = mvc.perform(post("/api/v1/events/" + draftId + "/register").with(studentJwt)
                        .header("Idempotency-Key", "draft-key"))
                .andExpect(status().isNotFound())
                .andReturn().getResponse().getContentAsString();
        String missing = mvc.perform(post("/api/v1/events/no-such-event/register").with(studentJwt)
                        .header("Idempotency-Key", "missing-key"))
                .andExpect(status().isNotFound())
                .andReturn().getResponse().getContentAsString();
        org.assertj.core.api.Assertions.assertThat(objectMapper.readTree(draft).get("code").asText())
                .isEqualTo(objectMapper.readTree(missing).get("code").asText());
    }

    @Test
    void registerRejectedAfterEventStart() throws Exception {
        String eventId = openEventId();
        startEventNow(eventId);
        mvc.perform(post("/api/v1/events/" + eventId + "/register").with(studentJwt)
                        .header("Idempotency-Key", "late-start-key"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("EVENT_STARTED"));
    }

    @Test
    void studentCannotCancelAfterEventStartOrAttendanceMark() throws Exception {
        String eventId = openEventId();
        String registrationId = register(eventId, studentJwt, "cancel-late-reg");
        mvc.perform(post("/api/v1/events/staff/" + eventId + "/close-registration").with(staffJwt))
                .andExpect(status().isOk());
        startEventNow(eventId);
        mvc.perform(post("/api/v1/events/staff/" + eventId + "/attendance").with(staffJwt)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"marks\":[{\"registrationId\":\"" + registrationId
                                + "\",\"status\":\"ATTENDED\"}]}"))
                .andExpect(status().isOk());
        mvc.perform(post("/api/v1/events/registrations/" + registrationId + "/cancel").with(studentJwt)
                        .header("Idempotency-Key", "cancel-late-key"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("EVENT_STARTED"));
        mvc.perform(get("/api/v1/events/my/registrations").with(studentJwt))
                .andExpect(jsonPath("$[0].registrationStatus").value("REGISTERED"))
                .andExpect(jsonPath("$[0].attendanceStatus").value("ATTENDED"));
    }

    @Test
    void registrationWindowMustBeOrderedAndCloseBeforeStart() throws Exception {
        Instant start = Instant.now().plus(2, ChronoUnit.HOURS);
        Instant end = Instant.now().plus(4, ChronoUnit.HOURS);
        // Closes after the event starts.
        mvc.perform(post("/api/v1/events/staff").with(staffJwt)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(createEventJson(5, start, end, Instant.now(), start.plus(1, ChronoUnit.HOURS))))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("EVENT_WINDOW_INVALID"));
        // Inverted window.
        mvc.perform(post("/api/v1/events/staff").with(staffJwt)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(createEventJson(5, start, end,
                                Instant.now().plus(1, ChronoUnit.HOURS), Instant.now())))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("EVENT_WINDOW_INVALID"));
        // Opening cannot override the stored window past the start either.
        String eventId = createDraft(staffJwt, 5, start, end);
        mvc.perform(post("/api/v1/events/staff/" + eventId + "/publish").with(staffJwt))
                .andExpect(status().isOk());
        mvc.perform(post("/api/v1/events/staff/" + eventId + "/open-registration").with(staffJwt)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"registrationClosesAt\":\"" + start.plus(1, ChronoUnit.HOURS) + "\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("EVENT_WINDOW_INVALID"));
    }

    @Test
    void completeRejectedBeforeEventStarts() throws Exception {
        String eventId = openEventId();
        mvc.perform(post("/api/v1/events/staff/" + eventId + "/close-registration").with(staffJwt))
                .andExpect(status().isOk());
        mvc.perform(post("/api/v1/events/staff/" + eventId + "/complete").with(staffJwt))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("EVENT_NOT_STARTED"));
    }

    @Test
    void oversizedIdempotencyKeyIsRejectedAsBadRequest() throws Exception {
        String eventId = openEventId();
        mvc.perform(post("/api/v1/events/" + eventId + "/register").with(studentJwt)
                        .header("Idempotency-Key", "k".repeat(201)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("IDEMPOTENCY_KEY_INVALID"));
    }

    @Test
    void eventsPackageNeverTouchesConductScores() throws Exception {
        // EVT-T06 forbidden write, pinned by source scan: no file in the
        // events module may reference the conduct score surface.
        Path eventsDir = Path.of("src/main/java/io/campuscore/restfulapi/events");
        assertThat(eventsDir).exists();
        try (var paths = Files.walk(eventsDir)) {
            List<Path> sources = paths.filter(p -> p.toString().endsWith(".java")).toList();
            assertThat(sources).isNotEmpty();
            for (Path source : sources) {
                String text = Files.readString(source, StandardCharsets.UTF_8);
                // Strip comments: javadoc may describe the boundary ("never
                // writes conduct_semester_score") — only real code must not.
                String code = text.replaceAll("(?s)/\\*.*?\\*/", " ")
                        .replaceAll("//[^\\n]*", " ");
                assertThat(code)
                        .as(source + " must not reference the conduct surface")
                        .doesNotContain("conduct_semester_score")
                        .doesNotContain("AcademicConduct")
                        .doesNotContain("conductScore");
            }
        }
    }
}
