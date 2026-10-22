package io.campuscore.restfulapi.events.service;

import io.campuscore.restfulapi.events.web.EventDtos.AttendanceBatchRequest;
import io.campuscore.restfulapi.events.web.EventDtos.AttendanceMarkRequest;
import io.campuscore.restfulapi.events.web.EventDtos.CreateEventRequest;
import io.campuscore.restfulapi.events.web.EventDtos.EventResponse;
import io.campuscore.restfulapi.events.web.EventDtos.OpenRegistrationRequest;
import io.campuscore.restfulapi.events.web.EventDtos.RosterEntry;
import io.campuscore.restfulapi.events.web.EventDtos.StaffGrantResponse;
import io.campuscore.restfulapi.events.web.EventDtos.UpdateEventRequest;
import io.campuscore.restfulapi.notification.repository.NotificationWriteRepository;
import io.campuscore.restfulapi.notification.repository.NotificationWriteRepository.CreateNotificationCommand;
import io.campuscore.restfulapi.web.DomainException;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.context.annotation.Profile;
import org.springframework.dao.EmptyResultDataAccessException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Event staff lifecycle (contract D4 / EVT-T01..T06). Authority is the scoped
 * {@code events."StaffGrant"} row — the ADMIN role grants but does not confer
 * domain rights. Every transition is a conditional UPDATE under
 * {@code FOR UPDATE} on the event row so lifecycle decisions serialize.
 *
 * <p>The attendance transition is manual roster marking only: this class never
 * writes {@code conduct_semester_score} (EVT-T06 forbidden write).
 */
@Service
@Profile("persistence")
public class EventService {

    static final String EVENT = "events.\"Event\"";
    static final String REGISTRATION = "events.\"Registration\"";
    static final String STAFF_GRANT = "events.\"StaffGrant\"";
    static final String AUDIT = "events.\"Audit\"";
    static final String AUTH_USER = "campuscore_auth.\"User\"";
    static final String EVENT_SCOPE = "events";

    private final NamedParameterJdbcTemplate jdbc;
    private final NotificationWriteRepository notifications;

    public EventService(NamedParameterJdbcTemplate jdbc, NotificationWriteRepository notifications) {
        this.jdbc = jdbc;
        this.notifications = notifications;
    }

    // ------------------------------------------------------------------
    // Authority
    // ------------------------------------------------------------------

    /** STAFF:events — the grant row is the sole domain authority. */
    void requireStaffGrant(String actorId) {
        Integer count = jdbc.queryForObject(
                "SELECT COUNT(*) FROM " + STAFF_GRANT
                        + " WHERE \"userId\" = :userId AND \"scope\" = :scope",
                new MapSqlParameterSource()
                        .addValue("userId", actorId)
                        .addValue("scope", EVENT_SCOPE),
                Integer.class);
        if (count == null || count == 0) {
            throw problem(HttpStatus.FORBIDDEN, "EVENTS_STAFF_REQUIRED",
                    "An events staff grant is required for this operation");
        }
    }

    boolean hasStaffGrant(String actorId) {
        Integer count = jdbc.queryForObject(
                "SELECT COUNT(*) FROM " + STAFF_GRANT
                        + " WHERE \"userId\" = :userId AND \"scope\" = :scope",
                new MapSqlParameterSource()
                        .addValue("userId", actorId)
                        .addValue("scope", EVENT_SCOPE),
                Integer.class);
        return count != null && count > 0;
    }

    /** Domain membership permits creation; an existing event is assigned to its owner. */
    private static void requireEventOwner(String actorId, String ownerId) {
        if (!actorId.equals(ownerId)) {
            throw problem(HttpStatus.FORBIDDEN, "EVENT_NOT_OWNER",
                    "This event is assigned to another staff member");
        }
    }

    public List<StaffGrantResponse> listGrants(String actorId) {
        requireStaffGrant(actorId);
        return jdbc.query(
                "SELECT \"id\", \"userId\", \"scope\", \"grantedBy\", \"createdAt\""
                        + " FROM " + STAFF_GRANT + " WHERE \"scope\" = :scope ORDER BY \"createdAt\"",
                new MapSqlParameterSource("scope", EVENT_SCOPE),
                (row, index) -> new StaffGrantResponse(
                        row.getString("id"),
                        row.getString("userId"),
                        row.getString("scope"),
                        row.getString("grantedBy"),
                        row.getTimestamp("createdAt").toInstant()));
    }

    /**
     * Grant administration is ADMIN authority (contract §1.1: admins grant,
     * they do not inherit domain rights). Callers must pass an admin role.
     */
    @Transactional
    public StaffGrantResponse grantStaff(String actorId, List<String> actorRoles, String userId) {
        requireAdmin(actorRoles);
        if (userId == null || userId.isBlank()) {
            throw problem(HttpStatus.BAD_REQUEST, "EVENT_USER_REQUIRED", "userId is required");
        }
        try {
            jdbc.queryForObject(
                    "SELECT \"id\" FROM " + AUTH_USER + " WHERE \"id\" = :id",
                    new MapSqlParameterSource("id", userId), String.class);
        } catch (EmptyResultDataAccessException exception) {
            throw problem(HttpStatus.NOT_FOUND, "EVENT_USER_NOT_FOUND", "Grant target user not found");
        }
        String grantId = UUID.randomUUID().toString();
        int inserted = jdbc.update(
                "INSERT INTO " + STAFF_GRANT
                        + " (\"id\", \"userId\", \"scope\", \"grantedBy\")"
                        + " SELECT :id, :userId, :scope, :grantedBy"
                        + " WHERE NOT EXISTS (SELECT 1 FROM " + STAFF_GRANT + " g"
                        + " WHERE g.\"userId\" = :userId AND g.\"scope\" = :scope)",
                new MapSqlParameterSource()
                        .addValue("id", grantId)
                        .addValue("userId", userId)
                        .addValue("scope", EVENT_SCOPE)
                        .addValue("grantedBy", actorId));
        if (inserted == 0) {
            return jdbc.queryForObject(
                    "SELECT \"id\", \"userId\", \"scope\", \"grantedBy\", \"createdAt\" FROM " + STAFF_GRANT
                            + " WHERE \"userId\" = :userId AND \"scope\" = :scope",
                    new MapSqlParameterSource().addValue("userId", userId).addValue("scope", EVENT_SCOPE),
                    (row, index) -> mapGrant(row));
        }
        audit(null, null, "GRANTED", actorId, "scope=" + EVENT_SCOPE + " user=" + userId);
        return jdbc.queryForObject(
                "SELECT \"id\", \"userId\", \"scope\", \"grantedBy\", \"createdAt\" FROM " + STAFF_GRANT
                        + " WHERE \"id\" = :id",
                new MapSqlParameterSource("id", grantId),
                (row, index) -> mapGrant(row));
    }

    @Transactional
    public void revokeStaff(String actorId, List<String> actorRoles, String grantId) {
        requireAdmin(actorRoles);
        int deleted = jdbc.update(
                "DELETE FROM " + STAFF_GRANT + " WHERE \"id\" = :id AND \"scope\" = :scope",
                new MapSqlParameterSource().addValue("id", grantId).addValue("scope", EVENT_SCOPE));
        if (deleted == 0) {
            throw problem(HttpStatus.NOT_FOUND, "EVENT_GRANT_NOT_FOUND", "Staff grant not found");
        }
        audit(null, null, "REVOKED", actorId, "grant=" + grantId);
    }

    private static void requireAdmin(List<String> roles) {
        if (roles == null || !(roles.contains("ADMIN") || roles.contains("SUPER_ADMIN"))) {
            throw problem(HttpStatus.FORBIDDEN, "EVENTS_ADMIN_REQUIRED",
                    "Grant administration requires an administrator role");
        }
    }

    // ------------------------------------------------------------------
    // Lifecycle writes
    // ------------------------------------------------------------------

    @Transactional
    public EventResponse create(String actorId, CreateEventRequest request) {
        requireStaffGrant(actorId);
        validatePayload(request.title(), request.organizer(), request.capacity(),
                request.startsAt(), request.endsAt());
        validateRegistrationWindow(request.registrationOpensAt(), request.registrationClosesAt(),
                request.startsAt());
        String id = UUID.randomUUID().toString();
        jdbc.update(
                "INSERT INTO " + EVENT
                        + " (\"id\", \"title\", \"description\", \"location\", \"organizer\", \"status\","
                        + " \"capacity\", \"startsAt\", \"endsAt\", \"registrationOpensAt\","
                        + " \"registrationClosesAt\", \"ownerId\")"
                        + " VALUES (:id, :title, :description, :location, :organizer, 'DRAFT',"
                        + " :capacity, :startsAt, :endsAt, :opensAt, :closesAt, :ownerId)",
                eventParams(id, request, actorId));
        audit(id, null, "CREATED", actorId, null);
        return findEvent(id, null);
    }

    /** Draft-only edit; capacity may not drop below the live registered count. */
    @Transactional
    public EventResponse update(String actorId, String eventId, UpdateEventRequest request) {
        requireStaffGrant(actorId);
        Map<String, Object> event = lockEvent(eventId);
        if (!actorId.equals(String.valueOf(event.get("owner_id")))) {
            throw problem(HttpStatus.FORBIDDEN, "EVENT_NOT_OWNER",
                    "Only the event owner can edit this event");
        }
        if (!"DRAFT".equals(String.valueOf(event.get("status")))) {
            throw problem(HttpStatus.CONFLICT, "EVENT_NOT_DRAFT", "Only draft events can be edited");
        }
        if (request.version() == null || request.version() < 0) {
            throw problem(HttpStatus.BAD_REQUEST, "EVENT_VERSION_REQUIRED", "The current event version is required");
        }
        if (request.version() != ((Number) event.get("version")).intValue()) {
            throw problem(HttpStatus.CONFLICT, "STALE_VERSION", "The event changed; reload before editing");
        }
        int capacity = request.capacity() == null ? ((Number) event.get("capacity")).intValue() : request.capacity();
        Instant startsAt = request.startsAt() == null ? toInstant(event.get("starts_at")) : request.startsAt();
        Instant endsAt = request.endsAt() == null ? toInstant(event.get("ends_at")) : request.endsAt();
        validatePayload(request.title() == null ? String.valueOf(event.get("title")) : request.title(),
                request.organizer() == null ? String.valueOf(event.get("organizer")) : request.organizer(),
                capacity, startsAt, endsAt);
        validateRegistrationWindow(
                request.registrationOpensAt() == null
                        ? toInstant(event.get("registration_opens_at")) : request.registrationOpensAt(),
                request.registrationClosesAt() == null
                        ? toInstant(event.get("registration_closes_at")) : request.registrationClosesAt(),
                startsAt);
        jdbc.update(
                "UPDATE " + EVENT + " SET \"title\" = :title, \"description\" = :description,"
                        + " \"location\" = :location, \"organizer\" = :organizer, \"capacity\" = :capacity,"
                        + " \"startsAt\" = :startsAt, \"endsAt\" = :endsAt,"
                        + " \"registrationOpensAt\" = :opensAt, \"registrationClosesAt\" = :closesAt,"
                        + " \"version\" = \"version\" + 1, \"updatedAt\" = CURRENT_TIMESTAMP"
                        + " WHERE \"id\" = :id",
                new MapSqlParameterSource()
                        .addValue("id", eventId)
                        .addValue("title", request.title() == null ? event.get("title") : request.title())
                        .addValue("description", request.description() == null ? event.get("description") : request.description())
                        .addValue("location", request.location() == null ? event.get("location") : request.location())
                        .addValue("organizer", request.organizer() == null ? event.get("organizer") : request.organizer())
                        .addValue("capacity", capacity)
                        .addValue("startsAt", Timestamp.from(startsAt))
                        .addValue("endsAt", Timestamp.from(endsAt))
                        .addValue("opensAt", request.registrationOpensAt() == null
                                ? event.get("registration_opens_at") : Timestamp.from(request.registrationOpensAt()))
                        .addValue("closesAt", request.registrationClosesAt() == null
                                ? event.get("registration_closes_at") : Timestamp.from(request.registrationClosesAt())));
        audit(eventId, null, "UPDATED", actorId, null);
        return findEvent(eventId, null);
    }

    /** EVT-T01: DRAFT → PUBLISHED by the owner staff member only. */
    @Transactional
    public EventResponse publish(String actorId, String eventId) {
        requireStaffGrant(actorId);
        Map<String, Object> event = lockEvent(eventId);
        if (!actorId.equals(String.valueOf(event.get("owner_id")))) {
            throw problem(HttpStatus.FORBIDDEN, "EVENT_NOT_OWNER",
                    "Only the event owner can publish this event");
        }
        transition(eventId, "DRAFT", "PUBLISHED", actorId, null);
        return findEvent(eventId, null);
    }

    /**
     * EVT-T02: PUBLISHED → REGISTRATION_OPEN inside the registration window;
     * cancelled events can never reach this state (the status machine has no
     * edge back from CANCELLED).
     */
    @Transactional
    public EventResponse openRegistration(String actorId, String eventId, OpenRegistrationRequest request) {
        requireStaffGrant(actorId);
        Map<String, Object> event = lockEvent(eventId);
        requireEventOwner(actorId, String.valueOf(event.get("owner_id")));
        Instant opensAt = request != null && request.registrationOpensAt() != null
                ? request.registrationOpensAt() : toInstant(event.get("registration_opens_at"));
        Instant closesAt = request != null && request.registrationClosesAt() != null
                ? request.registrationClosesAt() : toInstant(event.get("registration_closes_at"));
        Instant now = Instant.now();
        Instant startsAt = toInstant(event.get("starts_at"));
        validateRegistrationWindow(opensAt, closesAt, startsAt);
        if (startsAt != null && !now.isBefore(startsAt)) {
            throw problem(HttpStatus.CONFLICT, "EVENT_STARTED",
                    "Registration cannot open once the event has started");
        }
        if (opensAt != null && now.isBefore(opensAt)) {
            throw problem(HttpStatus.CONFLICT, "EVENT_WINDOW_NOT_STARTED",
                    "Registration window has not opened yet");
        }
        if (closesAt != null && now.isAfter(closesAt)) {
            throw problem(HttpStatus.CONFLICT, "EVENT_WINDOW_CLOSED",
                    "Registration window has already closed");
        }
        if (opensAt != null || closesAt != null) {
            jdbc.update(
                    "UPDATE " + EVENT + " SET \"registrationOpensAt\" = :opensAt,"
                            + " \"registrationClosesAt\" = :closesAt WHERE \"id\" = :id",
                    new MapSqlParameterSource()
                            .addValue("id", eventId)
                            .addValue("opensAt", opensAt == null ? null : Timestamp.from(opensAt))
                            .addValue("closesAt", closesAt == null ? null : Timestamp.from(closesAt)));
        }
        transition(eventId, "PUBLISHED", "REGISTRATION_OPEN", actorId, null);
        return findEvent(eventId, null);
    }

    @Transactional
    public EventResponse closeRegistration(String actorId, String eventId) {
        requireStaffGrant(actorId);
        Map<String, Object> event = lockEvent(eventId);
        requireEventOwner(actorId, String.valueOf(event.get("owner_id")));
        transition(eventId, "REGISTRATION_OPEN", "REGISTRATION_CLOSED", actorId, null);
        return findEvent(eventId, null);
    }

    @Transactional
    public EventResponse complete(String actorId, String eventId) {
        requireStaffGrant(actorId);
        Map<String, Object> event = lockEvent(eventId);
        requireEventOwner(actorId, String.valueOf(event.get("owner_id")));
        Instant startsAt = toInstant(event.get("starts_at"));
        if (startsAt != null && Instant.now().isBefore(startsAt)) {
            throw problem(HttpStatus.CONFLICT, "EVENT_NOT_STARTED",
                    "An event cannot be completed before it starts");
        }
        transition(eventId, "REGISTRATION_CLOSED", "COMPLETED", actorId, null);
        return findEvent(eventId, null);
    }

    /**
     * EVT-T05: staff cancellation in one transaction — event flips to
     * CANCELLED, every active registration flips to CANCELLED (history rows
     * are retained, never deleted), each affected registrant receives a
     * notification in the same transaction, and the audit row records the
     * actor and reason.
     */
    @Transactional
    public EventResponse cancel(String actorId, String eventId, String reason) {
        requireStaffGrant(actorId);
        Map<String, Object> event = lockEvent(eventId);
        requireEventOwner(actorId, String.valueOf(event.get("owner_id")));
        String status = String.valueOf(event.get("status"));
        if ("CANCELLED".equals(status) || "COMPLETED".equals(status)) {
            throw problem(HttpStatus.CONFLICT, "EVENT_TERMINAL",
                    "A cancelled or completed event cannot be cancelled");
        }
        jdbc.update(
                "UPDATE " + EVENT + " SET \"status\" = 'CANCELLED', \"version\" = \"version\" + 1,"
                        + " \"updatedAt\" = CURRENT_TIMESTAMP WHERE \"id\" = :id AND \"status\" = :status",
                new MapSqlParameterSource().addValue("id", eventId).addValue("status", status));
        List<String> registrants = jdbc.queryForList(
                "SELECT \"studentId\" FROM " + REGISTRATION
                        + " WHERE \"eventId\" = :eventId AND \"status\" = 'REGISTERED'",
                new MapSqlParameterSource("eventId", eventId), String.class);
        jdbc.update(
                "UPDATE " + REGISTRATION + " SET \"status\" = 'CANCELLED',"
                        + " \"cancelledAt\" = CURRENT_TIMESTAMP, \"version\" = \"version\" + 1"
                        + " WHERE \"eventId\" = :eventId AND \"status\" = 'REGISTERED'",
                new MapSqlParameterSource("eventId", eventId));
        jdbc.update(
                "UPDATE " + EVENT + " SET \"registeredCount\" = 0 WHERE \"id\" = :id",
                new MapSqlParameterSource("id", eventId));
        String title = "Sự kiện đã hủy: " + event.get("title");
        String message = reason == null || reason.isBlank()
                ? "Sự kiện bạn đăng ký đã bị hủy."
                : "Sự kiện bạn đăng ký đã bị hủy. Lý do: " + reason;
        notifications.createBatch(registrants.stream()
                .map(studentId -> new CreateNotificationCommand(
                        UUID.randomUUID().toString(), studentId, title, message,
                        "WARNING", "/dashboard/events?event=" + eventId, Instant.now()))
                .toList());
        audit(eventId, null, "CANCELLED", actorId,
                reason == null || reason.isBlank() ? null : "reason=" + reason);
        return findEvent(eventId, null);
    }

    // ------------------------------------------------------------------
    // Roster + attendance
    // ------------------------------------------------------------------

    /** Roster is staff-scope only; students never see other registrants. */
    public List<RosterEntry> roster(String actorId, String eventId) {
        requireStaffGrant(actorId);
        requireEventOwner(actorId, findEvent(eventId, null).ownerId());
        return jdbc.query(
                "SELECT r.\"id\" AS registration_id, r.\"version\" AS version, r.\"studentId\" AS student_id,"
                        + " u.\"firstName\" AS first_name, u.\"lastName\" AS last_name, u.\"email\" AS email,"
                        + " r.\"status\" AS status, r.\"attendanceStatus\" AS attendance_status,"
                        + " r.\"attendanceMarkedBy\" AS marked_by, r.\"attendanceMarkedAt\" AS marked_at,"
                        + " r.\"registeredAt\" AS registered_at"
                        + " FROM " + REGISTRATION + " r"
                        + " JOIN " + AUTH_USER + " u ON u.\"id\" = r.\"studentId\""
                        + " WHERE r.\"eventId\" = :eventId"
                        + " ORDER BY r.\"registeredAt\"",
                new MapSqlParameterSource("eventId", eventId),
                (row, index) -> new RosterEntry(
                        row.getString("registration_id"),
                        row.getInt("version"),
                        row.getString("student_id"),
                        (String.valueOf(row.getString("last_name")) + " "
                                + String.valueOf(row.getString("first_name"))).trim(),
                        row.getString("email"),
                        row.getString("status"),
                        row.getString("attendance_status"),
                        row.getString("marked_by"),
                        row.getTimestamp("marked_at") == null ? null : row.getTimestamp("marked_at").toInstant(),
                        row.getTimestamp("registered_at").toInstant()));
    }

    /**
     * EVT-T06: manual marks on rostered (REGISTERED) registrations once the
     * event has started and registration has closed — check-in through
     * post-event marking. Forbidden write: no conduct_semester_score mutation
     * exists anywhere in this path.
     */
    @Transactional
    public List<RosterEntry> markAttendance(String actorId, String eventId, AttendanceBatchRequest request) {
        requireStaffGrant(actorId);
        Map<String, Object> event = lockEvent(eventId);
        requireEventOwner(actorId, String.valueOf(event.get("owner_id")));
        String status = String.valueOf(event.get("status"));
        if (!"REGISTRATION_CLOSED".equals(status) && !"COMPLETED".equals(status)) {
            throw problem(HttpStatus.CONFLICT, "EVENT_ATTENDANCE_STATE",
                    "Attendance is marked after registration closes");
        }
        if (Instant.now().isBefore(toInstant(event.get("starts_at")))) {
            throw problem(HttpStatus.CONFLICT, "EVENT_NOT_STARTED",
                    "Attendance cannot be marked before the event starts");
        }
        if (request == null || request.marks() == null || request.marks().isEmpty()) {
            throw problem(HttpStatus.BAD_REQUEST, "EVENT_MARKS_REQUIRED", "At least one mark is required");
        }
        for (AttendanceMarkRequest mark : request.marks()) {
            if (mark == null || mark.registrationId() == null || mark.registrationId().isBlank()
                    || mark.status() == null
                    || !(mark.status().equals("ATTENDED") || mark.status().equals("ABSENT"))) {
                throw problem(HttpStatus.BAD_REQUEST, "EVENT_MARK_INVALID",
                        "Each mark needs a registrationId and status ATTENDED or ABSENT");
            }
            if (mark.version() == null || mark.version() < 0) {
                throw problem(HttpStatus.BAD_REQUEST, "EVENT_VERSION_REQUIRED", "Each mark needs its roster version");
            }
            List<Integer> versions = jdbc.queryForList(
                    "SELECT \"version\" FROM " + REGISTRATION
                            + " WHERE \"id\" = :id AND \"eventId\" = :eventId AND \"status\" = 'REGISTERED' FOR UPDATE",
                    new MapSqlParameterSource("id", mark.registrationId()).addValue("eventId", eventId), Integer.class);
            if (versions.isEmpty()) {
                throw problem(HttpStatus.CONFLICT, "EVENT_REGISTRATION_NOT_ON_ROSTER", "Registration is not an active roster entry");
            }
            if (!mark.version().equals(versions.getFirst())) {
                throw problem(HttpStatus.CONFLICT, "STALE_VERSION", "Reload the roster before marking attendance");
            }
            int updated = jdbc.update(
                    "UPDATE " + REGISTRATION + " SET \"attendanceStatus\" = :mark,"
                            + " \"attendanceMarkedBy\" = :actor, \"attendanceMarkedAt\" = CURRENT_TIMESTAMP,"
                            + " \"version\" = \"version\" + 1"
                            + " WHERE \"id\" = :id AND \"eventId\" = :eventId AND \"status\" = 'REGISTERED' AND \"version\" = :version",
                    new MapSqlParameterSource()
                            .addValue("id", mark.registrationId())
                            .addValue("eventId", eventId)
                            .addValue("mark", mark.status())
                            .addValue("actor", actorId)
                            .addValue("version", mark.version()));
            if (updated == 0) {
                throw problem(HttpStatus.CONFLICT, "EVENT_REGISTRATION_NOT_ON_ROSTER",
                        "Registration " + mark.registrationId() + " is not an active roster entry");
            }
            audit(eventId, mark.registrationId(), mark.status(), actorId, null);
        }
        return roster(actorId, eventId);
    }

    // ------------------------------------------------------------------
    // Staff reads
    // ------------------------------------------------------------------

    /** Staff list includes drafts; students never receive DRAFT rows. */
    public List<EventResponse> listStaffEvents(String actorId) {
        requireStaffGrant(actorId);
        return jdbc.query(
                eventSelect(null) + " WHERE e.\"ownerId\" = :ownerId ORDER BY e.\"startsAt\" DESC",
                new MapSqlParameterSource().addValue("studentId", null).addValue("ownerId", actorId),
                (row, index) -> mapEvent(row, null));
    }

    public EventResponse staffEvent(String actorId, String eventId) {
        requireStaffGrant(actorId);
        EventResponse event = findEvent(eventId, null);
        requireEventOwner(actorId, event.ownerId());
        return event;
    }

    // ------------------------------------------------------------------
    // Shared helpers (also used by EventStudentService via package scope)
    // ------------------------------------------------------------------

    static String eventSelect(String studentJoin) {
        // studentJoin parameter kept for call-site clarity: reads always LEFT
        // JOIN the caller's registration so my* fields fill in one round-trip.
        return "SELECT e.\"id\", e.\"title\", e.\"description\", e.\"location\", e.\"organizer\","
                + " e.\"status\", e.\"capacity\", e.\"registeredCount\", e.\"startsAt\" AS starts_at,"
                + " e.\"endsAt\" AS ends_at, e.\"registrationOpensAt\" AS registration_opens_at,"
                + " e.\"registrationClosesAt\" AS registration_closes_at, e.\"ownerId\" AS owner_id,"
                + " e.\"version\", e.\"createdAt\" AS created_at, e.\"updatedAt\" AS updated_at,"
                + " mine.\"id\" AS my_registration_id, mine.\"status\" AS my_registration_status,"
                + " mine.\"attendanceStatus\" AS my_attendance_status"
                + " FROM " + EVENT + " e"
                + " LEFT JOIN " + REGISTRATION + " mine ON mine.\"eventId\" = e.\"id\""
                + " AND mine.\"studentId\" = :studentId AND mine.\"status\" = 'REGISTERED'";
    }

    static EventResponse mapEvent(ResultSet row, String studentId) throws SQLException {
        int capacity = row.getInt("capacity");
        int registered = row.getInt("registeredCount");
        return new EventResponse(
                row.getString("id"),
                row.getString("title"),
                row.getString("description"),
                row.getString("location"),
                row.getString("organizer"),
                row.getString("status"),
                capacity,
                registered,
                Math.max(0, capacity - registered),
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
                studentId == null ? null : row.getString("my_registration_id"),
                studentId == null ? null : row.getString("my_registration_status"),
                studentId == null ? null : row.getString("my_attendance_status"));
    }

    Map<String, Object> lockEvent(String eventId) {
        try {
            return jdbc.queryForMap(
                    "SELECT \"id\", \"version\", \"status\", \"capacity\", \"registeredCount\", \"title\","
                            + " \"description\", \"location\", \"organizer\","
                            + " \"ownerId\" AS owner_id, \"startsAt\" AS starts_at, \"endsAt\" AS ends_at,"
                            + " \"registrationOpensAt\" AS registration_opens_at,"
                            + " \"registrationClosesAt\" AS registration_closes_at"
                            + " FROM " + EVENT + " WHERE \"id\" = :id FOR UPDATE",
                    new MapSqlParameterSource("id", eventId));
        } catch (EmptyResultDataAccessException exception) {
            throw problem(HttpStatus.NOT_FOUND, "EVENT_NOT_FOUND", "Event not found");
        }
    }

    void requireEvent(String eventId) {
        Integer count = jdbc.queryForObject(
                "SELECT COUNT(*) FROM " + EVENT + " WHERE \"id\" = :id",
                new MapSqlParameterSource("id", eventId), Integer.class);
        if (count == null || count == 0) {
            throw problem(HttpStatus.NOT_FOUND, "EVENT_NOT_FOUND", "Event not found");
        }
    }

    EventResponse findEvent(String eventId, String studentId) {
        try {
            return jdbc.queryForObject(
                    eventSelect(studentId) + " WHERE e.\"id\" = :id",
                    new MapSqlParameterSource()
                            .addValue("id", eventId)
                            .addValue("studentId", studentId),
                    (row, index) -> mapEvent(row, studentId));
        } catch (EmptyResultDataAccessException exception) {
            throw problem(HttpStatus.NOT_FOUND, "EVENT_NOT_FOUND", "Event not found");
        }
    }

    private void transition(String eventId, String from, String to, String actorId, String detail) {
        int updated = jdbc.update(
                "UPDATE " + EVENT + " SET \"status\" = :to, \"version\" = \"version\" + 1,"
                        + " \"updatedAt\" = CURRENT_TIMESTAMP WHERE \"id\" = :id AND \"status\" = :from",
                new MapSqlParameterSource()
                        .addValue("id", eventId)
                        .addValue("to", to)
                        .addValue("from", from));
        if (updated == 0) {
            throw problem(HttpStatus.CONFLICT, "EVENT_STATE_INVALID",
                    "Event is not in state " + from);
        }
        audit(eventId, null, to, actorId, detail);
    }

    void audit(String eventId, String registrationId, String action, String actorId, String detail) {
        jdbc.update(
                "INSERT INTO " + AUDIT
                        + " (\"id\", \"eventId\", \"registrationId\", \"action\", \"actorId\", \"detail\")"
                        + " VALUES (:id, :eventId, :registrationId, :action, :actorId, :detail)",
                new MapSqlParameterSource()
                        .addValue("id", UUID.randomUUID().toString())
                        .addValue("eventId", eventId == null ? "system" : eventId)
                        .addValue("registrationId", registrationId)
                        .addValue("action", action)
                        .addValue("actorId", actorId == null ? "system" : actorId)
                        .addValue("detail", detail));
    }

    /** The window must be ordered and must close no later than the event starts. */
    private static void validateRegistrationWindow(Instant opensAt, Instant closesAt, Instant startsAt) {
        if (opensAt != null && closesAt != null && !closesAt.isAfter(opensAt)) {
            throw problem(HttpStatus.BAD_REQUEST, "EVENT_WINDOW_INVALID",
                    "registrationClosesAt must be after registrationOpensAt");
        }
        if (startsAt != null && closesAt != null && closesAt.isAfter(startsAt)) {
            throw problem(HttpStatus.BAD_REQUEST, "EVENT_WINDOW_INVALID",
                    "registrationClosesAt must not be after startsAt");
        }
    }

    private static void validatePayload(String title, String organizer, Integer capacity,
            Instant startsAt, Instant endsAt) {
        if (title == null || title.isBlank()) {
            throw problem(HttpStatus.BAD_REQUEST, "EVENT_TITLE_REQUIRED", "Event title is required");
        }
        if (organizer == null || organizer.isBlank()) {
            throw problem(HttpStatus.BAD_REQUEST, "EVENT_ORGANIZER_REQUIRED", "Organizer is required");
        }
        if (capacity == null || capacity <= 0) {
            throw problem(HttpStatus.BAD_REQUEST, "EVENT_CAPACITY_INVALID", "Capacity must be positive");
        }
        if (startsAt == null || endsAt == null || !endsAt.isAfter(startsAt)) {
            throw problem(HttpStatus.BAD_REQUEST, "EVENT_WINDOW_INVALID",
                    "endsAt must be after startsAt");
        }
    }

    private static MapSqlParameterSource eventParams(String id, CreateEventRequest request, String ownerId) {
        return new MapSqlParameterSource()
                .addValue("id", id)
                .addValue("title", request.title())
                .addValue("description", request.description())
                .addValue("location", request.location())
                .addValue("organizer", request.organizer())
                .addValue("capacity", request.capacity())
                .addValue("startsAt", Timestamp.from(request.startsAt()))
                .addValue("endsAt", Timestamp.from(request.endsAt()))
                .addValue("opensAt", request.registrationOpensAt() == null
                        ? null : Timestamp.from(request.registrationOpensAt()))
                .addValue("closesAt", request.registrationClosesAt() == null
                        ? null : Timestamp.from(request.registrationClosesAt()))
                .addValue("ownerId", ownerId);
    }

    private static StaffGrantResponse mapGrant(ResultSet row) throws SQLException {
        return new StaffGrantResponse(
                row.getString("id"),
                row.getString("userId"),
                row.getString("scope"),
                row.getString("grantedBy"),
                row.getTimestamp("createdAt").toInstant());
    }

    static Instant toInstant(Object value) {
        if (value == null) {
            return null;
        }
        if (value instanceof Timestamp timestamp) {
            return timestamp.toInstant();
        }
        if (value instanceof java.time.OffsetDateTime offset) {
            return offset.toInstant();
        }
        return Instant.parse(String.valueOf(value));
    }

    static DomainException problem(HttpStatus status, String code, String message) {
        return new DomainException(status, code, message);
    }
}
