package io.campuscore.restfulapi.events.service;

import io.campuscore.restfulapi.events.web.EventDtos.EventResponse;
import io.campuscore.restfulapi.events.web.EventDtos.MyRegistrationResponse;
import io.campuscore.restfulapi.events.web.EventDtos.RegistrationResponse;
import io.campuscore.restfulapi.notification.repository.NotificationWriteRepository;
import io.campuscore.restfulapi.notification.repository.NotificationWriteRepository.CreateNotificationCommand;
import io.campuscore.restfulapi.web.DomainException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.context.annotation.Profile;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.dao.EmptyResultDataAccessException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.ConnectionCallback;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.ObjectMapper;

/**
 * Student-facing event registration (contract D4 / EVT-T03, EVT-T04, EVT-X01,
 * EVT-X02). The actor is always the JWT subject — SELF authority means the
 * student id is never taken from the request.
 *
 * <p>Concurrency contract: every mutation that touches capacity serializes on
 * the event row ({@code SELECT ... FOR UPDATE}) in a fixed order —
 * idempotency claim, then Event, then Registration — the same order for
 * register and cancel, so the last-seat race produces exactly one success
 * and a cancellation frees exactly one seat.
 *
 * <p>This class never writes {@code conduct_semester_score}.
 */
@Service
@Profile("persistence")
public class EventStudentService {

    private static final String EVENT = EventService.EVENT;
    private static final String REGISTRATION = EventService.REGISTRATION;
    private static final String AUDIT = EventService.AUDIT;
    private static final String IDEMPOTENCY = "events.\"Idempotency\"";

    private final NamedParameterJdbcTemplate jdbc;
    private final NotificationWriteRepository notifications;
    private final EventService events;
    private final ObjectMapper objectMapper;
    private final boolean postgres;

    public EventStudentService(
            NamedParameterJdbcTemplate jdbc,
            NotificationWriteRepository notifications,
            EventService events,
            ObjectMapper objectMapper) {
        this.jdbc = jdbc;
        this.notifications = notifications;
        this.events = events;
        this.objectMapper = objectMapper;
        this.postgres = jdbc.getJdbcOperations().execute((ConnectionCallback<Boolean>) connection ->
                "PostgreSQL".equalsIgnoreCase(connection.getMetaData().getDatabaseProductName()));
    }

    // ------------------------------------------------------------------
    // Reads
    // ------------------------------------------------------------------

    /** Public student catalog: everything visible after publish, incl. CANCELLED. */
    public List<EventResponse> listPublished(String studentId) {
        return jdbc.query(
                EventService.eventSelect(studentId)
                        + " WHERE e.\"status\" IN ('PUBLISHED', 'REGISTRATION_OPEN',"
                        + " 'REGISTRATION_CLOSED', 'COMPLETED', 'CANCELLED')"
                        + " ORDER BY e.\"startsAt\"",
                new MapSqlParameterSource().addValue("studentId", studentId),
                (row, index) -> EventService.mapEvent(row, studentId));
    }

    public EventResponse detail(String studentId, String eventId) {
        EventResponse event = events.findEvent(eventId, studentId);
        if ("DRAFT".equals(event.status())) {
            // DRAFT is staff-scope; students get an indistinguishable 404.
            throw EventService.problem(HttpStatus.NOT_FOUND, "EVENT_NOT_FOUND", "Event not found");
        }
        return event;
    }

    /** Student registration history — includes cancelled rows (audit trail). */
    public List<MyRegistrationResponse> myRegistrations(String studentId) {
        return jdbc.query(
                "SELECT r.\"id\" AS registration_id, r.\"status\" AS registration_status,"
                        + " r.\"attendanceStatus\" AS attendance_status,"
                        + " r.\"registeredAt\" AS registered_at, r.\"cancelledAt\" AS cancelled_at,"
                        + " e.\"id\", e.\"title\", e.\"description\", e.\"location\", e.\"organizer\","
                        + " e.\"status\", e.\"capacity\", e.\"registeredCount\","
                        + " e.\"startsAt\" AS starts_at, e.\"endsAt\" AS ends_at,"
                        + " e.\"registrationOpensAt\" AS registration_opens_at,"
                        + " e.\"registrationClosesAt\" AS registration_closes_at,"
                        + " e.\"ownerId\" AS owner_id, e.\"version\","
                        + " e.\"createdAt\" AS created_at, e.\"updatedAt\" AS updated_at"
                        + " FROM " + REGISTRATION + " r"
                        + " JOIN " + EVENT + " e ON e.\"id\" = r.\"eventId\""
                        + " WHERE r.\"studentId\" = :studentId"
                        + " ORDER BY r.\"registeredAt\" DESC",
                new MapSqlParameterSource().addValue("studentId", studentId),
                (row, index) -> new MyRegistrationResponse(
                        row.getString("registration_id"),
                        row.getString("registration_status"),
                        row.getString("attendance_status"),
                        row.getTimestamp("registered_at").toInstant(),
                        row.getTimestamp("cancelled_at") == null ? null
                                : row.getTimestamp("cancelled_at").toInstant(),
                        new EventResponse(
                                row.getString("id"),
                                row.getString("title"),
                                row.getString("description"),
                                row.getString("location"),
                                row.getString("organizer"),
                                row.getString("status"),
                                row.getInt("capacity"),
                                row.getInt("registeredCount"),
                                Math.max(0, row.getInt("capacity") - row.getInt("registeredCount")),
                                row.getTimestamp("starts_at").toInstant(),
                                row.getTimestamp("ends_at").toInstant(),
                                row.getTimestamp("registration_opens_at") == null ? null
                                        : row.getTimestamp("registration_opens_at").toInstant(),
                                row.getTimestamp("registration_closes_at") == null ? null
                                        : row.getTimestamp("registration_closes_at").toInstant(),
                                row.getString("owner_id"),
                                row.getInt("version"),
                                row.getTimestamp("created_at").toInstant(),
                                row.getTimestamp("updated_at").toInstant(),
                                row.getString("registration_id"),
                                row.getString("registration_status"),
                                row.getString("attendance_status"))));
    }

    // ------------------------------------------------------------------
    // EVT-T03 register
    // ------------------------------------------------------------------

    @Transactional
    public RegistrationResponse register(String studentId, String eventId, String idempotencyKey) {
        requireKey(idempotencyKey);
        String hash = sha256("register:" + eventId);
        Map<String, Object> replay = claimIdempotency(studentId, idempotencyKey, hash);
        if (replay != null) {
            return replayResponse(replay);
        }
        Map<String, Object> event = events.lockEvent(eventId);
        if ("DRAFT".equals(String.valueOf(event.get("status")))) {
            // §1.1: a draft is not visible to students, so deny exactly like a missing id.
            throw EventService.problem(HttpStatus.NOT_FOUND, "EVENT_NOT_FOUND", "Event not found");
        }
        if (!"REGISTRATION_OPEN".equals(String.valueOf(event.get("status")))) {
            throw EventService.problem(HttpStatus.CONFLICT, "EVENT_NOT_OPEN",
                    "Event registration is not open");
        }
        Instant now = Instant.now();
        Instant startsAt = EventService.toInstant(event.get("starts_at"));
        if (startsAt != null && !now.isBefore(startsAt)) {
            throw EventService.problem(HttpStatus.CONFLICT, "EVENT_STARTED",
                    "The event has already started");
        }
        Instant opensAt = EventService.toInstant(event.get("registration_opens_at"));
        Instant closesAt = EventService.toInstant(event.get("registration_closes_at"));
        if (opensAt != null && now.isBefore(opensAt)) {
            throw EventService.problem(HttpStatus.CONFLICT, "EVENT_WINDOW_NOT_STARTED",
                    "Registration window has not opened yet");
        }
        if (closesAt != null && now.isAfter(closesAt)) {
            throw EventService.problem(HttpStatus.CONFLICT, "EVENT_WINDOW_CLOSED",
                    "Registration window has closed");
        }
        Integer active = jdbc.queryForObject(
                "SELECT COUNT(*) FROM " + REGISTRATION
                        + " WHERE \"eventId\" = :eventId AND \"studentId\" = :studentId"
                        + " AND \"status\" = 'REGISTERED'",
                new MapSqlParameterSource()
                        .addValue("eventId", eventId)
                        .addValue("studentId", studentId),
                Integer.class);
        if (active != null && active > 0) {
            throw EventService.problem(HttpStatus.CONFLICT, "REGISTRATION_DUPLICATE",
                    "Student already has an active registration for this event");
        }
        // Conditional counter update is the capacity gate: the row lock plus
        // this predicate means the last-seat race yields exactly one success.
        int claimed = jdbc.update(
                "UPDATE " + EVENT + " SET \"registeredCount\" = \"registeredCount\" + 1,"
                        + " \"version\" = \"version\" + 1, \"updatedAt\" = CURRENT_TIMESTAMP"
                        + " WHERE \"id\" = :id AND \"registeredCount\" < \"capacity\"",
                new MapSqlParameterSource("id", eventId));
        if (claimed == 0) {
            throw EventService.problem(HttpStatus.CONFLICT, "EVENT_FULL", "Event is full");
        }
        String registrationId = UUID.randomUUID().toString();
        jdbc.update(
                "INSERT INTO " + REGISTRATION
                        + " (\"id\", \"eventId\", \"studentId\", \"status\")"
                        + " VALUES (:id, :eventId, :studentId, 'REGISTERED')",
                new MapSqlParameterSource()
                        .addValue("id", registrationId)
                        .addValue("eventId", eventId)
                        .addValue("studentId", studentId));
        events.audit(eventId, registrationId, "REGISTERED", studentId, null);
        notifications.createBatch(List.of(new CreateNotificationCommand(
                UUID.randomUUID().toString(), studentId,
                "Đăng ký sự kiện thành công",
                "Bạn đã đăng ký tham gia: " + event.get("title"),
                "SUCCESS", "/dashboard/events?event=" + eventId, Instant.now())));
        return completeIdempotency(studentId, idempotencyKey, registrationId, hash);
    }

    // ------------------------------------------------------------------
    // EVT-T04 cancel — frees exactly one seat
    // ------------------------------------------------------------------

    @Transactional
    public RegistrationResponse cancel(String studentId, String registrationId, String idempotencyKey) {
        requireKey(idempotencyKey);
        String hash = sha256("cancel:" + registrationId);
        Map<String, Object> replay = claimIdempotency(studentId, idempotencyKey, hash);
        if (replay != null) {
            return replayResponse(replay);
        }
        String eventId;
        try {
            eventId = jdbc.queryForObject(
                    "SELECT \"eventId\" FROM " + REGISTRATION + " WHERE \"id\" = :id",
                    new MapSqlParameterSource("id", registrationId), String.class);
        } catch (EmptyResultDataAccessException exception) {
            throw EventService.problem(HttpStatus.NOT_FOUND, "REGISTRATION_NOT_FOUND",
                    "Registration not found");
        }
        // Lock order is identical to register(): Event before Registration.
        Map<String, Object> event = events.lockEvent(eventId);
        Map<String, Object> registration;
        try {
            registration = jdbc.queryForMap(
                    "SELECT \"id\", \"studentId\" AS student_id, \"status\", \"eventId\" AS event_id,"
                            + " \"attendanceStatus\" AS attendance_status"
                            + " FROM " + REGISTRATION + " WHERE \"id\" = :id FOR UPDATE",
                    new MapSqlParameterSource("id", registrationId));
        } catch (EmptyResultDataAccessException exception) {
            throw EventService.problem(HttpStatus.NOT_FOUND, "REGISTRATION_NOT_FOUND",
                    "Registration not found");
        }
        if (!studentId.equals(String.valueOf(registration.get("student_id")))) {
            // §1.1: object-scope deny hides existence — same 404 as a missing id.
            throw EventService.problem(HttpStatus.NOT_FOUND, "REGISTRATION_NOT_FOUND",
                    "Registration not found");
        }
        if (!"REGISTERED".equals(String.valueOf(registration.get("status")))) {
            throw EventService.problem(HttpStatus.CONFLICT, "REGISTRATION_NOT_ACTIVE",
                    "Registration is no longer active");
        }
        String eventStatus = String.valueOf(event.get("status"));
        if ("CANCELLED".equals(eventStatus) || "COMPLETED".equals(eventStatus)) {
            throw EventService.problem(HttpStatus.CONFLICT, "EVENT_TERMINAL",
                    "Registration can no longer be cancelled for this event");
        }
        Instant eventStart = EventService.toInstant(event.get("starts_at"));
        if ("ATTENDED".equals(String.valueOf(registration.get("attendance_status")))
                || (eventStart != null && !Instant.now().isBefore(eventStart))) {
            // A started event keeps its roster: a no-show cannot relabel itself as a cancellation.
            throw EventService.problem(HttpStatus.CONFLICT, "EVENT_STARTED",
                    "Registration can no longer be cancelled once the event has started");
        }
        // Guarded transition: exactly one row flips, exactly one seat frees.
        int cancelled = jdbc.update(
                "UPDATE " + REGISTRATION + " SET \"status\" = 'CANCELLED',"
                        + " \"cancelledAt\" = CURRENT_TIMESTAMP, \"version\" = \"version\" + 1"
                        + " WHERE \"id\" = :id AND \"status\" = 'REGISTERED'",
                new MapSqlParameterSource("id", registrationId));
        if (cancelled == 0) {
            throw EventService.problem(HttpStatus.CONFLICT, "REGISTRATION_NOT_ACTIVE",
                    "Registration is no longer active");
        }
        jdbc.update(
                "UPDATE " + EVENT + " SET \"registeredCount\" = \"registeredCount\" - 1,"
                        + " \"version\" = \"version\" + 1, \"updatedAt\" = CURRENT_TIMESTAMP"
                        + " WHERE \"id\" = :id AND \"registeredCount\" > 0",
                new MapSqlParameterSource("id", eventId));
        events.audit(eventId, registrationId, "REGISTRATION_CANCELLED", studentId, null);
        notifications.createBatch(List.of(new CreateNotificationCommand(
                UUID.randomUUID().toString(), studentId,
                "Đã hủy đăng ký sự kiện",
                "Bạn đã hủy đăng ký tham gia: " + event.get("title"),
                "INFO", "/dashboard/events?event=" + eventId, Instant.now())));
        return completeIdempotency(studentId, idempotencyKey, registrationId, hash);
    }

    // ------------------------------------------------------------------
    // Idempotency (mirror of RegistrationService — §1.3 contract)
    // ------------------------------------------------------------------

    private Map<String, Object> claimIdempotency(String ownerId, String key, String hash) {
        MapSqlParameterSource parameters = new MapSqlParameterSource()
                .addValue("id", UUID.randomUUID().toString())
                .addValue("ownerId", ownerId)
                .addValue("key", key)
                .addValue("hash", hash);
        if (postgres) {
            int inserted = jdbc.update(
                    "INSERT INTO " + IDEMPOTENCY
                            + " (\"id\", \"ownerId\", \"idempotencyKey\", \"requestHash\", \"state\")"
                            + " VALUES (:id, :ownerId, :key, :hash, 'IN_PROGRESS')"
                            + " ON CONFLICT (\"ownerId\", \"idempotencyKey\") DO NOTHING",
                    parameters);
            if (inserted == 1) {
                return null;
            }
        } else {
            try {
                jdbc.update(
                        "INSERT INTO " + IDEMPOTENCY
                                + " (\"id\", \"ownerId\", \"idempotencyKey\", \"requestHash\", \"state\")"
                                + " VALUES (:id, :ownerId, :key, :hash, 'IN_PROGRESS')",
                        parameters);
                return null;
            } catch (DataIntegrityViolationException duplicate) {
                // H2 fallback — test-only path, see academic mirror.
            }
        }
        Map<String, Object> existing = jdbc.queryForMap(
                "SELECT \"requestHash\" AS request_hash, \"state\", \"registrationId\" AS registration_id,"
                        + " CAST(\"responseBody\" AS VARCHAR) AS response_body"
                        + " FROM " + IDEMPOTENCY
                        + " WHERE \"ownerId\" = :ownerId AND \"idempotencyKey\" = :key",
                new MapSqlParameterSource().addValue("ownerId", ownerId).addValue("key", key));
        if (!hash.equals(String.valueOf(existing.get("request_hash")).trim())) {
            throw EventService.problem(HttpStatus.CONFLICT, "IDEMPOTENCY_CONFLICT",
                    "Idempotency key was reused with a different payload");
        }
        if ("IN_PROGRESS".equals(String.valueOf(existing.get("state")))) {
            throw EventService.problem(HttpStatus.CONFLICT, "IDEMPOTENCY_IN_PROGRESS",
                    "The same request is already in progress");
        }
        return existing;
    }

    private RegistrationResponse replayResponse(Map<String, Object> replay) {
        Object body = replay.get("response_body");
        if (!(body instanceof String json) || json.isBlank()) {
            // Older keys have no snapshot. Never fabricate a replay from mutable state.
            throw EventService.problem(HttpStatus.CONFLICT, "IDEMPOTENCY_RESPONSE_UNAVAILABLE",
                    "The original response is unavailable; refresh the current registration state");
        }
        return objectMapper.readValue(json, RegistrationResponse.class);
    }

    private RegistrationResponse completeIdempotency(String ownerId, String key, String registrationId, String hash) {
        RegistrationResponse response = findRegistration(registrationId);
        jdbc.update(
                "UPDATE " + IDEMPOTENCY
                        + " SET \"state\" = 'COMPLETED', \"registrationId\" = :registrationId,"
                        + " \"requestHash\" = :hash, \"responseBody\" = :responseBody, \"updatedAt\" = CURRENT_TIMESTAMP"
                        + " WHERE \"ownerId\" = :ownerId AND \"idempotencyKey\" = :key",
                new MapSqlParameterSource()
                        .addValue("registrationId", registrationId)
                        .addValue("hash", hash)
                        .addValue("responseBody", objectMapper.writeValueAsString(response))
                        .addValue("ownerId", ownerId)
                        .addValue("key", key));
        return response;
    }

    private static void requireKey(String idempotencyKey) {
        if (idempotencyKey == null || idempotencyKey.isBlank()) {
            throw EventService.problem(HttpStatus.BAD_REQUEST, "IDEMPOTENCY_KEY_REQUIRED",
                    "Idempotency-Key is required");
        }
        if (idempotencyKey.length() > 200) {
            throw EventService.problem(HttpStatus.BAD_REQUEST, "IDEMPOTENCY_KEY_INVALID",
                    "Idempotency-Key must be at most 200 characters");
        }
    }

    private RegistrationResponse findRegistration(String registrationId) {
        try {
            return jdbc.queryForObject(
                    "SELECT \"id\", \"eventId\" AS event_id, \"studentId\" AS student_id,"
                            + " \"status\", \"attendanceStatus\" AS attendance_status,"
                            + " \"registeredAt\" AS registered_at, \"cancelledAt\" AS cancelled_at"
                            + " FROM " + REGISTRATION + " WHERE \"id\" = :id",
                    new MapSqlParameterSource("id", registrationId),
                    (row, index) -> new RegistrationResponse(
                            row.getString("id"),
                            row.getString("event_id"),
                            row.getString("student_id"),
                            row.getString("status"),
                            row.getString("attendance_status"),
                            row.getTimestamp("registered_at").toInstant(),
                            row.getTimestamp("cancelled_at") == null ? null
                                    : row.getTimestamp("cancelled_at").toInstant()));
        } catch (EmptyResultDataAccessException exception) {
            throw EventService.problem(HttpStatus.NOT_FOUND, "REGISTRATION_NOT_FOUND",
                    "Registration not found");
        }
    }

    private static String sha256(String payload) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            return HexFormat.of().formatHex(digest.digest(payload.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException("SHA-256 unavailable", exception);
        }
    }
}
