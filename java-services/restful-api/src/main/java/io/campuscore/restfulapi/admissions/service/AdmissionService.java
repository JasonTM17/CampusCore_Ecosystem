package io.campuscore.restfulapi.admissions.service;

import io.campuscore.restfulapi.admissions.web.AdmissionDtos.ApplicationResponse;
import io.campuscore.restfulapi.admissions.web.AdmissionDtos.AttachmentResponse;
import io.campuscore.restfulapi.admissions.web.AdmissionDtos.ChecklistItemRequest;
import io.campuscore.restfulapi.admissions.web.AdmissionDtos.DecisionRequest;
import io.campuscore.restfulapi.admissions.web.AdmissionDtos.ReturnApplicationRequest;
import io.campuscore.restfulapi.admissions.web.AdmissionDtos.ReviewResponse;
import io.campuscore.restfulapi.admissions.web.AdmissionDtos.StaffGrantResponse;
import io.campuscore.restfulapi.notification.repository.NotificationWriteRepository;
import io.campuscore.restfulapi.notification.repository.NotificationWriteRepository.CreateNotificationCommand;
import io.campuscore.restfulapi.web.DomainException;
import java.sql.ResultSet;
import java.sql.SQLException;
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
 * P10 simulated admissions — staff lane (domain-contracts §7).
 *
 * <p>Authority is the scoped {@code admissions."StaffGrant"} row — the ADMIN
 * role grants but does not confer domain rights (contract §1.1). Every
 * lifecycle transition is a conditional UPDATE under {@code FOR UPDATE} on the
 * application row so claim/return/decision serialize.
 *
 * <p>Decisions are simulations only: the row carries
 * {@code decisionLabel='SIMULATED'} and this class never writes
 * {@code academic."Student"} — an accepted applicant stays a plain auth user
 * (ADM-T01/T05). Return and decision notify the applicant in the same
 * transaction (§11 precedent).
 */
@Service
@Profile("persistence")
public class AdmissionService {

    static final String APPLICATION = "admissions.\"Application\"";
    static final String ATTACHMENT = "admissions.\"Attachment\"";
    static final String FILE_OBJECT = "admissions.\"FileObject\"";
    static final String REVIEW = "admissions.\"Review\"";
    static final String AUDIT = "admissions.\"Audit\"";
    static final String STAFF_GRANT = "admissions.\"StaffGrant\"";
    static final String IDEMPOTENCY = "admissions.\"Idempotency\"";
    static final String AUTH_USER = "campuscore_auth.\"User\"";
    static final String SCOPE = "admissions";
    static final String DECISION_LABEL = "SIMULATED";

    /** Statuses that still admit owner edits or staff lifecycle transitions. */
    static final List<String> ACTIVE_STATUSES = List.of("DRAFT", "SUBMITTED", "IN_REVIEW", "RETURNED");
    static final List<String> TERMINAL_STATUSES = List.of("ACCEPTED", "REJECTED", "WITHDRAWN");

    private final NamedParameterJdbcTemplate jdbc;
    private final NotificationWriteRepository notifications;
    private final tools.jackson.databind.ObjectMapper objectMapper;

    public AdmissionService(NamedParameterJdbcTemplate jdbc,
            NotificationWriteRepository notifications,
            tools.jackson.databind.ObjectMapper objectMapper) {
        this.jdbc = jdbc;
        this.notifications = notifications;
        this.objectMapper = objectMapper;
    }

    // ------------------------------------------------------------------
    // Authority
    // ------------------------------------------------------------------

    /** STAFF:admissions — the grant row is the sole domain authority. */
    void requireStaffGrant(String actorId) {
        Integer count = jdbc.queryForObject(
                "SELECT COUNT(*) FROM " + STAFF_GRANT
                        + " WHERE \"userId\" = :userId AND \"scope\" = :scope",
                new MapSqlParameterSource()
                        .addValue("userId", actorId)
                        .addValue("scope", SCOPE),
                Integer.class);
        if (count == null || count == 0) {
            throw problem(HttpStatus.FORBIDDEN, "ADMISSIONS_STAFF_REQUIRED",
                    "An admissions staff grant is required for this operation");
        }
    }

    boolean hasStaffGrant(String actorId) {
        Integer count = jdbc.queryForObject(
                "SELECT COUNT(*) FROM " + STAFF_GRANT
                        + " WHERE \"userId\" = :userId AND \"scope\" = :scope",
                new MapSqlParameterSource()
                        .addValue("userId", actorId)
                        .addValue("scope", SCOPE),
                Integer.class);
        return count != null && count > 0;
    }

    private static void requireAdmin(List<String> roles) {
        if (roles == null || !roles.contains("ADMIN")) {
            throw problem(HttpStatus.FORBIDDEN, "ADMISSIONS_ADMIN_REQUIRED",
                    "Grant administration requires the ADMIN role");
        }
    }

    // ------------------------------------------------------------------
    // Grants
    // ------------------------------------------------------------------

    public List<StaffGrantResponse> listGrants(String actorId) {
        requireStaffGrant(actorId);
        return jdbc.query(
                "SELECT \"id\", \"userId\", \"scope\", \"grantedBy\", \"createdAt\""
                        + " FROM " + STAFF_GRANT + " WHERE \"scope\" = :scope ORDER BY \"createdAt\"",
                new MapSqlParameterSource("scope", SCOPE),
                (row, index) -> mapGrant(row));
    }

    @Transactional
    public StaffGrantResponse grantStaff(String actorId, List<String> actorRoles, String userId) {
        requireAdmin(actorRoles);
        if (userId == null || userId.isBlank()) {
            throw problem(HttpStatus.BAD_REQUEST, "ADMISSION_USER_REQUIRED", "userId is required");
        }
        try {
            jdbc.queryForObject(
                    "SELECT \"id\" FROM " + AUTH_USER + " WHERE \"id\" = :id",
                    new MapSqlParameterSource("id", userId), String.class);
        } catch (EmptyResultDataAccessException exception) {
            throw problem(HttpStatus.NOT_FOUND, "ADMISSION_USER_NOT_FOUND", "Grant target user not found");
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
                        .addValue("scope", SCOPE)
                        .addValue("grantedBy", actorId));
        if (inserted == 0) {
            return jdbc.queryForObject(
                    "SELECT \"id\", \"userId\", \"scope\", \"grantedBy\", \"createdAt\" FROM " + STAFF_GRANT
                            + " WHERE \"userId\" = :userId AND \"scope\" = :scope",
                    new MapSqlParameterSource("userId", userId).addValue("scope", SCOPE),
                    (row, index) -> mapGrant(row));
        }
        audit(null, actorId, "STAFF_GRANTED", null, null, "scope=" + SCOPE + " user=" + userId);
        return new StaffGrantResponse(grantId, userId, SCOPE, actorId, Instant.now());
    }

    @Transactional
    public void revokeStaff(String actorId, List<String> actorRoles, String grantId) {
        requireAdmin(actorRoles);
        String revokedUserId = null;
        try {
            revokedUserId = jdbc.queryForObject(
                    "SELECT \"userId\" FROM " + STAFF_GRANT
                            + " WHERE \"id\" = :id AND \"scope\" = :scope",
                    new MapSqlParameterSource("id", grantId).addValue("scope", SCOPE),
                    String.class);
        } catch (EmptyResultDataAccessException missing) {
            // falls through to the delete-count check below
        }
        int deleted = jdbc.update(
                "DELETE FROM " + STAFF_GRANT + " WHERE \"id\" = :id AND \"scope\" = :scope",
                new MapSqlParameterSource("id", grantId).addValue("scope", SCOPE));
        if (deleted == 0) {
            throw problem(HttpStatus.NOT_FOUND, "ADMISSION_GRANT_NOT_FOUND", "Grant not found");
        }
        audit(null, actorId, "STAFF_REVOKED", null, null,
                "scope=" + SCOPE + " user=" + revokedUserId + " grant=" + grantId);
    }

    // ------------------------------------------------------------------
    // Staff review lane
    // ------------------------------------------------------------------

    /** Queue of applications — optional status filter; staff scope required. */
    public List<ApplicationResponse> queue(String actorId, String status) {
        requireStaffGrant(actorId);
        MapSqlParameterSource params = new MapSqlParameterSource();
        StringBuilder sql = new StringBuilder(applicationSelect());
        if (status != null && !status.isBlank()) {
            sql.append(" WHERE a.\"status\" = :status");
            params.addValue("status", status);
        }
        sql.append(" ORDER BY a.\"submittedAt\" NULLS LAST, a.\"createdAt\"");
        List<ApplicationResponse> rows = jdbc.query(sql.toString(), params,
                (row, index) -> mapApplication(row, List.of(), List.of()));
        return rows;
    }

    public ApplicationResponse staffApplication(String actorId, String applicationId) {
        requireStaffGrant(actorId);
        Map<String, Object> row = findApplicationRow(applicationId);
        List<AttachmentResponse> attachments = attachmentsOf(applicationId);
        List<ReviewResponse> reviews = reviewsOf(applicationId);
        return mapApplication(row, attachments, reviews);
    }

    /** SUBMITTED → IN_REVIEW; claims the application for this reviewer. */
    @Transactional
    public ApplicationResponse claim(String actorId, String applicationId, Integer expectedVersion) {
        requireStaffGrant(actorId);
        Map<String, Object> application = lockApplication(applicationId);
        requireTerminalGuard(application);
        requireVersion(application, expectedVersion);
        int updated = jdbc.update(
                "UPDATE " + APPLICATION + " SET \"status\" = 'IN_REVIEW', \"claimedBy\" = :actor,"
                        + " \"version\" = \"version\" + 1, \"updatedAt\" = CURRENT_TIMESTAMP"
                        + " WHERE \"id\" = :id AND \"status\" = 'SUBMITTED'",
                new MapSqlParameterSource("id", applicationId).addValue("actor", actorId));
        if (updated == 0) {
            throw problem(HttpStatus.CONFLICT, "APPLICATION_STATE_INVALID",
                    "Only a submitted application can be claimed for review");
        }
        insertReview(applicationId, actorId, "CLAIM", null, null, null);
        audit(applicationId, actorId, "CLAIMED", "SUBMITTED", "IN_REVIEW", null);
        return staffApplication(actorId, applicationId);
    }

    /** IN_REVIEW → RETURNED; requires the claiming reviewer. */
    @Transactional
    public ApplicationResponse returnApplication(String actorId, String applicationId,
            ReturnApplicationRequest request) {
        requireStaffGrant(actorId);
        Map<String, Object> application = lockApplication(applicationId);
        requireTerminalGuard(application);
        requireVersion(application, request == null ? null : request.expectedVersion());
        requireClaimedBy(application, actorId);
        String checklist = serializeChecklist(request == null ? null : request.checklist());
        String note = request == null ? null : request.note();
        // ADM-T03: a return must carry reviewer-visible reason — a checklist,
        // a note, or both. An empty review row is not a valid return.
        if (checklist == null && (note == null || note.isBlank())) {
            throw problem(HttpStatus.BAD_REQUEST, "RETURN_REASON_REQUIRED",
                    "Return requires a checklist or a reviewer note");
        }
        int updated = jdbc.update(
                "UPDATE " + APPLICATION + " SET \"status\" = 'RETURNED',"
                        + " \"version\" = \"version\" + 1, \"updatedAt\" = CURRENT_TIMESTAMP"
                        + " WHERE \"id\" = :id AND \"status\" = 'IN_REVIEW'",
                new MapSqlParameterSource("id", applicationId));
        if (updated == 0) {
            throw problem(HttpStatus.CONFLICT, "APPLICATION_STATE_INVALID",
                    "Only an in-review application can be returned");
        }
        insertReview(applicationId, actorId, "RETURN", checklist, note, null);
        audit(applicationId, actorId, "RETURNED", "IN_REVIEW", "RETURNED", note);
        notifyApplicant(application,
                "Hồ sơ tuyển sinh được trả về",
                "Hồ sơ " + applicationId + " của bạn được trả về để chỉnh sửa"
                        + (note == null || note.isBlank() ? "." : ": " + note),
                "INFO");
        return staffApplication(actorId, applicationId);
    }

    /** IN_REVIEW → ACCEPTED|REJECTED; decision is labeled SIMULATED. */
    @Transactional
    public ApplicationResponse decide(String actorId, String applicationId, DecisionRequest request) {
        requireStaffGrant(actorId);
        String decision = request == null ? null : request.decision();
        if (!"ACCEPTED".equals(decision) && !"REJECTED".equals(decision)) {
            throw problem(HttpStatus.BAD_REQUEST, "ADMISSION_DECISION_INVALID",
                    "decision must be ACCEPTED or REJECTED");
        }
        Map<String, Object> application = lockApplication(applicationId);
        requireTerminalGuard(application);
        requireVersion(application, request.expectedVersion());
        requireClaimedBy(application, actorId);
        int updated = jdbc.update(
                "UPDATE " + APPLICATION + " SET \"status\" = :decision, \"decision\" = :decision,"
                        + " \"decisionLabel\" = :label, \"decisionAt\" = CURRENT_TIMESTAMP,"
                        + " \"version\" = \"version\" + 1, \"updatedAt\" = CURRENT_TIMESTAMP"
                        + " WHERE \"id\" = :id AND \"status\" = 'IN_REVIEW'",
                new MapSqlParameterSource("id", applicationId)
                        .addValue("decision", decision)
                        .addValue("label", DECISION_LABEL));
        if (updated == 0) {
            throw problem(HttpStatus.CONFLICT, "APPLICATION_STATE_INVALID",
                    "Only an in-review application can be decided");
        }
        String checklist = serializeChecklist(request.checklist());
        insertReview(applicationId, actorId, "DECISION", checklist, request.note(), decision);
        audit(applicationId, actorId, "DECISION_" + decision, "IN_REVIEW", decision, request.note());
        notifyApplicant(application,
                "Kết quả hồ sơ tuyển sinh (mô phỏng)",
                "Hồ sơ " + applicationId + " đã có kết quả mô phỏng: "
                        + ("ACCEPTED".equals(decision) ? "TRÚNG TUYỂN" : "KHÔNG TRÚNG TUYỂN")
                        + " (mô phỏng, không tạo hồ sơ sinh viên).",
                "ACCEPTED".equals(decision) ? "SUCCESS" : "INFO");
        return staffApplication(actorId, applicationId);
    }

    /** Staff-scoped attachment download (checksum verified by caller layer). */
    public Map<String, Object> staffAttachmentFile(String actorId, String applicationId,
            String attachmentId) {
        requireStaffGrant(actorId);
        return attachmentFile(applicationId, attachmentId);
    }

    // ------------------------------------------------------------------
    // Shared helpers (also used by the applicant lane)
    // ------------------------------------------------------------------

    static String applicationSelect() {
        return "SELECT a.\"id\", a.\"applicantUserId\", u.\"email\" AS applicant_email,"
                + " a.\"cycle\", a.\"status\", a.\"fullName\", a.\"dateOfBirth\", a.\"schoolName\","
                + " a.\"intendedMajor\", a.\"essay\", a.\"claimedBy\", a.\"submittedAt\","
                + " a.\"decision\", a.\"decisionLabel\", a.\"decisionAt\", a.\"version\","
                + " a.\"createdAt\", a.\"updatedAt\""
                + " FROM " + APPLICATION + " a"
                + " LEFT JOIN " + AUTH_USER + " u ON u.\"id\" = a.\"applicantUserId\"";
    }

    Map<String, Object> lockApplication(String applicationId) {
        try {
            return jdbc.queryForMap(
                    "SELECT \"id\", \"applicantUserId\", \"cycle\", \"status\", \"claimedBy\","
                            + " \"version\", \"submittedAt\", \"decision\""
                            + " FROM " + APPLICATION + " WHERE \"id\" = :id FOR UPDATE",
                    new MapSqlParameterSource("id", applicationId));
        } catch (EmptyResultDataAccessException exception) {
            throw problem(HttpStatus.NOT_FOUND, "APPLICATION_NOT_FOUND", "Application not found");
        }
    }

    Map<String, Object> findApplicationRow(String applicationId) {
        try {
            return jdbc.queryForMap(
                    applicationSelect() + " WHERE a.\"id\" = :id",
                    new MapSqlParameterSource("id", applicationId));
        } catch (EmptyResultDataAccessException exception) {
            throw problem(HttpStatus.NOT_FOUND, "APPLICATION_NOT_FOUND", "Application not found");
        }
    }

    List<AttachmentResponse> attachmentsOf(String applicationId) {
        return jdbc.query(
                "SELECT \"id\", \"fileName\", \"contentType\", \"sizeBytes\", \"checksum\", \"createdAt\""
                        + " FROM " + ATTACHMENT + " WHERE \"applicationId\" = :id"
                        + " ORDER BY \"createdAt\"",
                new MapSqlParameterSource("id", applicationId),
                (row, index) -> new AttachmentResponse(
                        row.getString("id"),
                        row.getString("fileName"),
                        row.getString("contentType"),
                        row.getLong("sizeBytes"),
                        row.getString("checksum"),
                        toInstant(row.getObject("createdAt"))));
    }

    List<ReviewResponse> reviewsOf(String applicationId) {
        return jdbc.query(
                "SELECT \"id\", \"reviewerId\", \"action\", \"checklist\", \"note\", \"decision\", \"createdAt\""
                        + " FROM " + REVIEW + " WHERE \"applicationId\" = :id"
                        + " ORDER BY \"createdAt\"",
                new MapSqlParameterSource("id", applicationId),
                (row, index) -> new ReviewResponse(
                        row.getString("id"),
                        row.getString("reviewerId"),
                        row.getString("action"),
                        row.getString("checklist"),
                        row.getString("note"),
                        row.getString("decision"),
                        toInstant(row.getObject("createdAt"))));
    }

    Map<String, Object> attachmentFile(String applicationId, String attachmentId) {
        try {
            return jdbc.queryForMap(
                    "SELECT a.\"fileName\", a.\"checksum\", f.\"data\", f.\"contentType\" AS content_type"
                            + " FROM " + ATTACHMENT + " a"
                            + " JOIN " + FILE_OBJECT + " f ON f.\"key\" = a.\"fileKey\""
                            + " WHERE a.\"id\" = :attId AND a.\"applicationId\" = :appId",
                    new MapSqlParameterSource("attId", attachmentId)
                            .addValue("appId", applicationId));
        } catch (EmptyResultDataAccessException exception) {
            throw problem(HttpStatus.NOT_FOUND, "ATTACHMENT_NOT_FOUND", "Attachment not found");
        }
    }

    void requireTerminalGuard(Map<String, Object> application) {
        String status = String.valueOf(application.get("status"));
        if (TERMINAL_STATUSES.contains(status)) {
            throw problem(HttpStatus.CONFLICT, "APPLICATION_TERMINAL",
                    "Application is " + status + " and can no longer change");
        }
    }

    void requireVersion(Map<String, Object> application, Integer expectedVersion) {
        int version = ((Number) application.get("version")).intValue();
        if (expectedVersion == null) {
            throw problem(HttpStatus.BAD_REQUEST, "APPLICATION_VERSION_REQUIRED",
                    "expectedVersion is required");
        }
        if (expectedVersion.intValue() != version) {
            throw problem(HttpStatus.CONFLICT, "STALE_VERSION",
                    "Reload the application before retrying (version " + version + ")");
        }
    }

    private void requireClaimedBy(Map<String, Object> application, String actorId) {
        Object claimedBy = application.get("claimedBy");
        if (claimedBy == null || !actorId.equals(String.valueOf(claimedBy))) {
            throw problem(HttpStatus.FORBIDDEN, "APPLICATION_REVIEW_NOT_OWNED",
                    "This application is being reviewed by another staff member");
        }
    }

    private void insertReview(String applicationId, String reviewerId, String action,
            String checklist, String note, String decision) {
        jdbc.update(
                "INSERT INTO " + REVIEW
                        + " (\"id\", \"applicationId\", \"reviewerId\", \"action\", \"checklist\","
                        + " \"note\", \"decision\")"
                        + " VALUES (:id, :applicationId, :reviewerId, :action, :checklist, :note, :decision)",
                new MapSqlParameterSource()
                        .addValue("id", UUID.randomUUID().toString())
                        .addValue("applicationId", applicationId)
                        .addValue("reviewerId", reviewerId)
                        .addValue("action", action)
                        .addValue("checklist", checklist)
                        .addValue("note", note)
                        .addValue("decision", decision));
    }

    void audit(String applicationId, String actorId, String action,
            String fromStatus, String toStatus, String detail) {
        jdbc.update(
                "INSERT INTO " + AUDIT
                        + " (\"id\", \"applicationId\", \"actorId\", \"action\", \"fromStatus\","
                        + " \"toStatus\", \"detail\")"
                        + " VALUES (:id, :applicationId, :actorId, :action, :fromStatus, :toStatus, :detail)",
                new MapSqlParameterSource()
                        .addValue("id", UUID.randomUUID().toString())
                        .addValue("applicationId", applicationId)
                        .addValue("actorId", actorId)
                        .addValue("action", action)
                        .addValue("fromStatus", fromStatus)
                        .addValue("toStatus", toStatus)
                        .addValue("detail", detail));
    }

    /** applicantUserId IS an auth user id here — no academic indirection. */
    private void notifyApplicant(Map<String, Object> application, String title,
            String message, String type) {
        notifications.create(new CreateNotificationCommand(
                UUID.randomUUID().toString(),
                String.valueOf(application.get("applicantUserId")),
                title, message, type,
                "/apply", Instant.now()));
    }

    private String serializeChecklist(List<ChecklistItemRequest> checklist) {
        if (checklist == null || checklist.isEmpty()) {
            return null;
        }
        for (ChecklistItemRequest item : checklist) {
            if (item == null || item.item() == null || item.item().isBlank()) {
                throw problem(HttpStatus.BAD_REQUEST, "CHECKLIST_ITEM_INVALID",
                        "Each checklist item needs an item label");
            }
            if (item.result() != null && !List.of("PASS", "FAIL", "NOTE").contains(item.result())) {
                throw problem(HttpStatus.BAD_REQUEST, "CHECKLIST_RESULT_INVALID",
                        "Checklist result must be PASS, FAIL or NOTE");
            }
        }
        return objectMapper.writeValueAsString(checklist);
    }

    ApplicationResponse mapApplication(Map<String, Object> row,
            List<AttachmentResponse> attachments, List<ReviewResponse> reviews) {
        return new ApplicationResponse(
                String.valueOf(row.get("id")),
                String.valueOf(row.get("applicantUserId")),
                row.get("applicant_email") == null ? null : String.valueOf(row.get("applicant_email")),
                String.valueOf(row.get("cycle")),
                String.valueOf(row.get("status")),
                row.get("fullName") == null ? null : String.valueOf(row.get("fullName")),
                row.get("dateOfBirth") == null ? null : String.valueOf(row.get("dateOfBirth")),
                row.get("schoolName") == null ? null : String.valueOf(row.get("schoolName")),
                row.get("intendedMajor") == null ? null : String.valueOf(row.get("intendedMajor")),
                row.get("essay") == null ? null : String.valueOf(row.get("essay")),
                row.get("claimedBy") == null ? null : String.valueOf(row.get("claimedBy")),
                toInstant(row.get("submittedAt")),
                row.get("decision") == null ? null : String.valueOf(row.get("decision")),
                row.get("decisionLabel") == null ? null : String.valueOf(row.get("decisionLabel")),
                toInstant(row.get("decisionAt")),
                ((Number) row.get("version")).intValue(),
                toInstant(row.get("createdAt")),
                toInstant(row.get("updatedAt")),
                attachments,
                reviews);
    }

    private ApplicationResponse mapApplication(ResultSet row,
            List<AttachmentResponse> attachments, List<ReviewResponse> reviews) throws SQLException {
        return new ApplicationResponse(
                row.getString("id"),
                row.getString("applicantUserId"),
                row.getString("applicant_email"),
                row.getString("cycle"),
                row.getString("status"),
                row.getString("fullName"),
                row.getString("dateOfBirth"),
                row.getString("schoolName"),
                row.getString("intendedMajor"),
                row.getString("essay"),
                row.getString("claimedBy"),
                toInstant(row.getObject("submittedAt")),
                row.getString("decision"),
                row.getString("decisionLabel"),
                toInstant(row.getObject("decisionAt")),
                row.getInt("version"),
                toInstant(row.getObject("createdAt")),
                toInstant(row.getObject("updatedAt")),
                attachments,
                reviews);
    }

    private static StaffGrantResponse mapGrant(ResultSet row) throws SQLException {
        return new StaffGrantResponse(
                row.getString("id"),
                row.getString("userId"),
                row.getString("scope"),
                row.getString("grantedBy"),
                toInstant(row.getObject("createdAt")));
    }

    static Instant toInstant(Object value) {
        if (value == null) {
            return null;
        }
        if (value instanceof java.sql.Timestamp timestamp) {
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
