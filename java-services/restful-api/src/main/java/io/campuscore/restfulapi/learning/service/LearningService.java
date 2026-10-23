package io.campuscore.restfulapi.learning.service;

import io.campuscore.restfulapi.learning.web.LearningDtos.AssignmentResponse;
import io.campuscore.restfulapi.learning.web.LearningDtos.AssignmentUpsertRequest;
import io.campuscore.restfulapi.learning.web.LearningDtos.FeedbackResponse;
import io.campuscore.restfulapi.learning.web.LearningDtos.MaterialResponse;
import io.campuscore.restfulapi.learning.web.LearningDtos.MaterialUpsertRequest;
import io.campuscore.restfulapi.learning.web.LearningDtos.ReturnRequest;
import io.campuscore.restfulapi.learning.web.LearningDtos.SubmissionReviewRequest;
import io.campuscore.restfulapi.learning.web.LearningDtos.RosterRowResponse;
import io.campuscore.restfulapi.learning.web.LearningDtos.SubmissionResponse;
import io.campuscore.restfulapi.learning.web.LearningDtos.SubmissionRevisionResponse;
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
 * P09 LMS staff surface (contract §6 LMS-T01..T07). Authority is the section's
 * assigned lecturer — {@code academic."Section"."lecturerId" = jwt lecturerId}
 * — a domain read-through, never a write to Enrollment/StudentGrade. Every
 * lifecycle move is a conditional UPDATE under {@code FOR UPDATE} on the
 * assignment (or submission) row.
 *
 * <p>Forbidden writes (§6): this class never mutates {@code academic."Enrollment"}
 * or grade authority; returned/reviewed feedback lives only in
 * {@code learning."FeedbackRecord"}.
 */
@Service
@Profile("persistence")
public class LearningService {

    static final String MATERIAL = "learning.\"Material\"";
    static final String ASSIGNMENT = "learning.\"Assignment\"";
    static final String SUBMISSION = "learning.\"Submission\"";
    static final String REVISION = "learning.\"SubmissionRevision\"";
    static final String FEEDBACK = "learning.\"FeedbackRecord\"";
    static final String AUDIT = "learning.\"Audit\"";
    static final String FILE_OBJECT = "learning.\"FileObject\"";
    static final String SECTION = "academic.\"Section\"";
    static final String ENROLLMENT = "academic.\"Enrollment\"";
    static final String STUDENT = "academic.\"Student\"";
    static final String AUTH_USER = "campuscore_auth.\"User\"";

    /** Enrollment statuses allowed to appear on the LMS roster (mirrors the
     * attendance convention — everything except DROPPED/CANCELLED). */
    static final String ROSTER_STATUSES = "('ENROLLED','PENDING','CONFIRMED','COMPLETED')";

    private final NamedParameterJdbcTemplate jdbc;
    private final NotificationWriteRepository notifications;

    public LearningService(NamedParameterJdbcTemplate jdbc,
            NotificationWriteRepository notifications) {
        this.jdbc = jdbc;
        this.notifications = notifications;
    }

    // ------------------------------------------------------------------
    // Authority — section assignment is the only lecturer credential
    // ------------------------------------------------------------------

    void requireSectionLecturer(String lecturerId, String sectionId) {
        Integer count = jdbc.queryForObject(
                "SELECT COUNT(*) FROM " + SECTION
                        + " WHERE \"id\" = :sectionId AND \"lecturerId\" = :lecturerId",
                new MapSqlParameterSource("sectionId", sectionId).addValue("lecturerId", lecturerId),
                Integer.class);
        if (count == null || count == 0) {
            throw problem(HttpStatus.FORBIDDEN, "SECTION_NOT_ASSIGNED",
                    "This section is assigned to another lecturer");
        }
    }

    String sectionOfAssignment(String assignmentId) {
        try {
            return jdbc.queryForObject(
                    "SELECT \"sectionId\" FROM " + ASSIGNMENT + " WHERE \"id\" = :id",
                    new MapSqlParameterSource("id", assignmentId), String.class);
        } catch (EmptyResultDataAccessException exception) {
            throw problem(HttpStatus.NOT_FOUND, "ASSIGNMENT_NOT_FOUND", "Assignment not found");
        }
    }

    // ------------------------------------------------------------------
    // Materials (LMS-T-adjacent: section content management)
    // ------------------------------------------------------------------

    @Transactional(readOnly = true)
    public List<MaterialResponse> listMaterials(String lecturerId, String sectionId) {
        requireSectionLecturer(lecturerId, sectionId);
        return jdbc.query("SELECT * FROM " + MATERIAL + " WHERE \"sectionId\" = :sectionId"
                        + " ORDER BY \"createdAt\" DESC, \"id\"",
                new MapSqlParameterSource("sectionId", sectionId), LearningService::mapMaterial);
    }

    @Transactional
    public MaterialResponse createMaterial(String lecturerId, String sectionId,
            MaterialUpsertRequest request) {
        requireSectionLecturer(lecturerId, sectionId);
        if (request == null || request.title() == null || request.title().isBlank()) {
            throw problem(HttpStatus.BAD_REQUEST, "MATERIAL_TITLE_REQUIRED", "Material title is required");
        }
        String id = "mat-" + UUID.randomUUID();
        Map<String, Object> stored = storeFile(lecturerId, sectionId, request.fileName(),
                request.contentType(), request.contentBase64(), request.checksum());
        jdbc.update("INSERT INTO " + MATERIAL
                        + " (\"id\", \"sectionId\", \"title\", \"description\", \"fileKey\","
                        + " \"fileName\", \"contentType\", \"sizeBytes\", \"checksum\", \"uploaderId\")"
                        + " VALUES (:id, :sectionId, :title, :description, :fileKey,"
                        + " :fileName, :contentType, :sizeBytes, :checksum, :uploaderId)",
                materialParams(id, sectionId, request, stored, lecturerId));
        audit(null, null, lecturerId, "MATERIAL_CREATED", "material=" + id);
        return findMaterial(id);
    }

    @Transactional
    public MaterialResponse updateMaterial(String lecturerId, String materialId,
            MaterialUpsertRequest request) {
        Map<String, Object> material = lockMaterial(materialId);
        requireSectionLecturer(lecturerId, String.valueOf(material.get("sectionId")));
        requireVersion(request == null ? null : request.version(), material);
        if (request.title() == null || request.title().isBlank()) {
            throw problem(HttpStatus.BAD_REQUEST, "MATERIAL_TITLE_REQUIRED", "Material title is required");
        }
        boolean newFile = request.contentBase64() != null && !request.contentBase64().isBlank();
        Map<String, Object> stored = newFile
                ? storeFile(lecturerId, String.valueOf(material.get("sectionId")), request.fileName(),
                        request.contentType(), request.contentBase64(), request.checksum())
                : Map.of("key", (Object) material.get("fileKey"),
                        "fileName", material.get("fileName"),
                        "contentType", material.get("contentType"),
                        "sizeBytes", material.get("sizeBytes"),
                        "checksum", material.get("checksum"));
        int updated = jdbc.update("UPDATE " + MATERIAL
                        + " SET \"title\" = :title, \"description\" = :description,"
                        + " \"fileKey\" = :fileKey, \"fileName\" = :fileName,"
                        + " \"contentType\" = :contentType, \"sizeBytes\" = :sizeBytes,"
                        + " \"checksum\" = :checksum, \"version\" = \"version\" + 1,"
                        + " \"updatedAt\" = CURRENT_TIMESTAMP"
                        + " WHERE \"id\" = :id AND \"version\" = :expected",
                materialParams(materialId, String.valueOf(material.get("sectionId")), request,
                        stored, lecturerId)
                        .addValue("expected", request.version()));
        if (updated == 0) {
            throw problem(HttpStatus.CONFLICT, "STALE_VERSION",
                    "The material changed; reload before editing");
        }
        return findMaterial(materialId);
    }

    @Transactional
    public void deleteMaterial(String lecturerId, String materialId) {
        Map<String, Object> material = lockMaterial(materialId);
        requireSectionLecturer(lecturerId, String.valueOf(material.get("sectionId")));
        jdbc.update("DELETE FROM " + MATERIAL + " WHERE \"id\" = :id",
                new MapSqlParameterSource("id", materialId));
        audit(null, null, lecturerId, "MATERIAL_DELETED", "material=" + materialId);
    }

    // ------------------------------------------------------------------
    // Assignment lifecycle LMS-T01/T02 (+ DRAFT edit, ARCHIVE)
    // ------------------------------------------------------------------

    @Transactional(readOnly = true)
    public List<AssignmentResponse> listAssignments(String lecturerId, String sectionId) {
        requireSectionLecturer(lecturerId, sectionId);
        return jdbc.query(assignmentSelect()
                        + " WHERE a.\"sectionId\" = :sectionId"
                        + " ORDER BY a.\"createdAt\" DESC, a.\"id\"",
                new MapSqlParameterSource("sectionId", sectionId).addValue("studentId", ""),
                LearningService::mapAssignment);
    }

    @Transactional(readOnly = true)
    public AssignmentResponse staffAssignment(String lecturerId, String assignmentId) {
        requireSectionLecturer(lecturerId, sectionOfAssignment(assignmentId));
        return findAssignment(assignmentId, null);
    }

    @Transactional
    public AssignmentResponse createAssignment(String lecturerId, String sectionId,
            AssignmentUpsertRequest request) {
        requireSectionLecturer(lecturerId, sectionId);
        if (request == null || request.title() == null || request.title().isBlank()) {
            throw problem(HttpStatus.BAD_REQUEST, "ASSIGNMENT_TITLE_REQUIRED",
                    "Assignment title is required");
        }
        String id = "asg-" + UUID.randomUUID();
        jdbc.update("INSERT INTO " + ASSIGNMENT
                        + " (\"id\", \"sectionId\", \"title\", \"description\", \"deadlineAt\","
                        + " \"maxScore\", \"status\", \"ownerId\")"
                        + " VALUES (:id, :sectionId, :title, :description, :deadlineAt,"
                        + " :maxScore, 'DRAFT', :ownerId)",
                new MapSqlParameterSource("id", id)
                        .addValue("sectionId", sectionId)
                        .addValue("title", request.title())
                        .addValue("description", request.description())
                        .addValue("deadlineAt", ts(request.deadlineAt()))
                        .addValue("maxScore", request.maxScore())
                        .addValue("ownerId", lecturerId));
        audit(id, null, lecturerId, "ASSIGNMENT_CREATED", null);
        return findAssignment(id, null);
    }

    @Transactional
    public AssignmentResponse updateAssignment(String lecturerId, String assignmentId,
            AssignmentUpsertRequest request) {
        Map<String, Object> assignment = lockAssignment(assignmentId);
        requireSectionLecturer(lecturerId, String.valueOf(assignment.get("sectionId")));
        if (!"DRAFT".equals(String.valueOf(assignment.get("status")))) {
            throw problem(HttpStatus.CONFLICT, "ASSIGNMENT_NOT_DRAFT",
                    "Only draft assignments can be edited");
        }
        requireVersion(request == null ? null : request.version(), assignment);
        int updated = jdbc.update("UPDATE " + ASSIGNMENT
                        + " SET \"title\" = :title, \"description\" = :description,"
                        + " \"deadlineAt\" = :deadlineAt, \"maxScore\" = :maxScore,"
                        + " \"version\" = \"version\" + 1, \"updatedAt\" = CURRENT_TIMESTAMP"
                        + " WHERE \"id\" = :id AND \"version\" = :expected",
                new MapSqlParameterSource("id", assignmentId)
                        .addValue("title", request.title())
                        .addValue("description", request.description())
                        .addValue("deadlineAt", ts(request.deadlineAt()))
                        .addValue("maxScore", request.maxScore())
                        .addValue("expected", request.version()));
        if (updated == 0) {
            throw problem(HttpStatus.CONFLICT, "STALE_VERSION",
                    "The assignment changed; reload before editing");
        }
        return findAssignment(assignmentId, null);
    }

    /** LMS-T01: DRAFT → PUBLISHED under the row lock. */
    @Transactional
    public AssignmentResponse publish(String lecturerId, String assignmentId) {
        return transition(lecturerId, assignmentId, "DRAFT", "PUBLISHED", "ASSIGNMENT_PUBLISHED");
    }

    /** LMS-T02: PUBLISHED → CLOSED stops all submission writes. */
    @Transactional
    public AssignmentResponse close(String lecturerId, String assignmentId) {
        return transition(lecturerId, assignmentId, "PUBLISHED", "CLOSED", "ASSIGNMENT_CLOSED");
    }

    @Transactional
    public AssignmentResponse archive(String lecturerId, String assignmentId) {
        Map<String, Object> assignment = lockAssignment(assignmentId);
        requireSectionLecturer(lecturerId, String.valueOf(assignment.get("sectionId")));
        String status = String.valueOf(assignment.get("status"));
        if (!"CLOSED".equals(status)) {
            throw problem(HttpStatus.CONFLICT, "ASSIGNMENT_STATE_INVALID",
                    "Only closed assignments can be archived");
        }
        setStatus(assignmentId, "CLOSED", "ARCHIVED");
        audit(assignmentId, null, lecturerId, "ASSIGNMENT_ARCHIVED", null);
        return findAssignment(assignmentId, null);
    }

    private AssignmentResponse transition(String lecturerId, String assignmentId,
            String from, String to, String auditAction) {
        Map<String, Object> assignment = lockAssignment(assignmentId);
        requireSectionLecturer(lecturerId, String.valueOf(assignment.get("sectionId")));
        setStatus(assignmentId, from, to);
        audit(assignmentId, null, lecturerId, auditAction, null);
        return findAssignment(assignmentId, null);
    }

    private void setStatus(String assignmentId, String from, String to) {
        int updated = jdbc.update("UPDATE " + ASSIGNMENT
                        + " SET \"status\" = :to, \"version\" = \"version\" + 1,"
                        + " \"updatedAt\" = CURRENT_TIMESTAMP"
                        + " WHERE \"id\" = :id AND \"status\" = :from",
                new MapSqlParameterSource("id", assignmentId)
                        .addValue("to", to).addValue("from", from));
        if (updated == 0) {
            throw problem(HttpStatus.CONFLICT, "ASSIGNMENT_STATE_INVALID",
                    "Assignment is no longer in state " + from);
        }
    }

    // ------------------------------------------------------------------
    // Roster + submissions (LMS-T04/T06: return with feedback, review)
    // ------------------------------------------------------------------

    /** Section roster read-through: every enrollment except DROPPED/CANCELLED,
     * joined to the assignment's submission (when one exists). */
    @Transactional(readOnly = true)
    public List<RosterRowResponse> roster(String lecturerId, String assignmentId) {
        String sectionId = sectionOfAssignment(assignmentId);
        requireSectionLecturer(lecturerId, sectionId);
        return jdbc.query(
                "SELECT e.\"id\" AS enrollment_id, e.\"studentId\" AS student_id,"
                        + " student_user.\"lastName\" || ' ' || student_user.\"firstName\" AS student_name,"
                        + " student_user.\"email\" AS student_email, e.\"status\" AS enrollment_status,"
                        + " s.\"id\" AS submission_id, s.\"status\" AS submission_status,"
                        + " s.\"submittedAt\" AS submitted_at"
                        + " FROM " + ENROLLMENT + " e"
                        + " JOIN " + STUDENT + " student ON student.\"id\" = e.\"studentId\""
                        + " JOIN " + AUTH_USER + " student_user ON student_user.\"id\" = student.\"userId\""
                        + " LEFT JOIN " + SUBMISSION + " s ON s.\"assignmentId\" = :assignmentId"
                        + " AND s.\"studentId\" = e.\"studentId\""
                        + " WHERE e.\"sectionId\" = :sectionId"
                        + " AND e.\"status\" IN " + ROSTER_STATUSES
                        // One row per student: retake history leaves several
                        // seats on the same section — the operative one
                        // (ENROLLED first) represents them on the roster.
                        + " AND e.\"id\" = (SELECT e2.\"id\" FROM " + ENROLLMENT + " e2"
                        + "   WHERE e2.\"studentId\" = e.\"studentId\" AND e2.\"sectionId\" = e.\"sectionId\""
                        + "   AND e2.\"status\" IN " + ROSTER_STATUSES
                        + "   ORDER BY CASE e2.\"status\" WHEN 'ENROLLED' THEN 0 WHEN 'CONFIRMED' THEN 1"
                        + "     WHEN 'PENDING' THEN 2 ELSE 3 END, e2.\"enrolledAt\" DESC"
                        + "   LIMIT 1)"
                        + " ORDER BY student_user.\"lastName\", student_user.\"firstName\"",
                new MapSqlParameterSource("sectionId", sectionId).addValue("assignmentId", assignmentId),
                LearningService::mapRosterRow);
    }

    @Transactional(readOnly = true)
    public SubmissionResponse submission(String lecturerId, String submissionId) {
        Map<String, Object> row = getSubmission(submissionId);
        requireSectionLecturer(lecturerId, sectionOfAssignment(String.valueOf(row.get("assignmentId"))));
        return mapSubmission(row);
    }

    @Transactional(readOnly = true)
    public List<SubmissionRevisionResponse> revisions(String lecturerId, String submissionId) {
        Map<String, Object> row = getSubmission(submissionId);
        requireSectionLecturer(lecturerId, sectionOfAssignment(String.valueOf(row.get("assignmentId"))));
        return listRevisions(submissionId);
    }

    /** LMS-T04: SUBMITTED|RESUBMITTED → RETURNED requires a feedback row in the
     * same transaction (history is append-only). */
    @Transactional
    public SubmissionResponse returnSubmission(String lecturerId, String submissionId,
            ReturnRequest request) {
        Map<String, Object> submission = lockSubmission(submissionId);
        requireSectionLecturer(lecturerId,
                sectionOfAssignment(String.valueOf(submission.get("assignmentId"))));
        requireVersion(request == null ? null : request.expectedVersion(), submission);
        if (request == null || request.comment() == null || request.comment().isBlank()) {
            throw problem(HttpStatus.BAD_REQUEST, "FEEDBACK_REQUIRED",
                    "Returning a submission requires feedback");
        }
        String status = String.valueOf(submission.get("status"));
        if (!"SUBMITTED".equals(status) && !"RESUBMITTED".equals(status)) {
            throw problem(HttpStatus.CONFLICT, "SUBMISSION_STATE_INVALID",
                    "Only submitted work can be returned with feedback");
        }
        int updated = jdbc.update("UPDATE " + SUBMISSION
                        + " SET \"status\" = 'RETURNED', \"returnedAt\" = CURRENT_TIMESTAMP,"
                        + " \"version\" = \"version\" + 1, \"updatedAt\" = CURRENT_TIMESTAMP"
                        + " WHERE \"id\" = :id AND \"status\" IN ('SUBMITTED','RESUBMITTED')"
                        + " AND \"version\" = :expected",
                new MapSqlParameterSource("id", submissionId)
                        .addValue("expected", request.expectedVersion()));
        if (updated == 0) {
            throw problem(HttpStatus.CONFLICT, "SUBMISSION_STATE_INVALID",
                    "Submission is no longer awaiting review");
        }
        insertFeedback(submissionId, (String) submission.get("currentRevisionId"),
                lecturerId, request.comment(), request.score());
        audit(String.valueOf(submission.get("assignmentId")), submissionId, lecturerId,
                "SUBMISSION_RETURNED", null);
        notifyStudent(submission, "Bài tập đã được trả về",
                "Bài nộp của bạn vừa nhận nhận xét — xem phản hồi và nộp lại bản sửa.",
                "INFO");
        return mapSubmission(getSubmission(submissionId));
    }

    /** LMS-T06: RETURNED → REVIEWED is the terminal review state. */
    @Transactional
    public SubmissionResponse reviewSubmission(String lecturerId, String submissionId,
            SubmissionReviewRequest request) {
        Map<String, Object> submission = lockSubmission(submissionId);
        requireSectionLecturer(lecturerId,
                sectionOfAssignment(String.valueOf(submission.get("assignmentId"))));
        String status = String.valueOf(submission.get("status"));
        // The first cycle must pass through RETURNED (feedback is mandatory
        // there); afterwards review closes RESUBMITTED or RETURNED work.
        if (!"RESUBMITTED".equals(status) && !"RETURNED".equals(status)) {
            throw problem(HttpStatus.CONFLICT, "SUBMISSION_STATE_INVALID",
                    "Only resubmitted or returned work can be marked reviewed");
        }
        if (request != null && request.expectedVersion() != null
                && request.expectedVersion() != ((Number) submission.get("version")).intValue()) {
            throw problem(HttpStatus.CONFLICT, "STALE_VERSION",
                    "The submission changed; reload before reviewing");
        }
        int updated = jdbc.update("UPDATE " + SUBMISSION
                        + " SET \"status\" = 'REVIEWED', \"reviewedAt\" = CURRENT_TIMESTAMP,"
                        + " \"version\" = \"version\" + 1, \"updatedAt\" = CURRENT_TIMESTAMP"
                        + " WHERE \"id\" = :id AND \"status\" IN ('RESUBMITTED','RETURNED')",
                new MapSqlParameterSource("id", submissionId));
        if (updated == 0) {
            throw problem(HttpStatus.CONFLICT, "SUBMISSION_STATE_INVALID",
                    "Submission is no longer in returned state");
        }
        if (request != null && (request.comment() != null || request.score() != null)) {
            insertFeedback(submissionId, (String) submission.get("currentRevisionId"),
                    lecturerId,
                    request.comment() == null ? "" : request.comment(), request.score());
        }
        audit(String.valueOf(submission.get("assignmentId")), submissionId, lecturerId,
                "SUBMISSION_REVIEWED", null);
        notifyStudent(submission, "Bài tập đã được chấm xong",
                "Bài nộp của bạn đã được giảng viên chấm xong — xem đánh giá cuối.",
                "SUCCESS");
        return mapSubmission(getSubmission(submissionId));
    }

    /** §11 feedback notification: the student learns about return/review in
     * the same transaction as the state change (events pattern). The inbox
     * user_id is the AUTH user id — resolve it through the academic Student
     * row (submission.studentId is the academic profile pk). */
    private void notifyStudent(Map<String, Object> submission, String title,
            String message, String type) {
        String assignmentId = String.valueOf(submission.get("assignmentId"));
        String assignmentTitle = jdbc.queryForObject(
                "SELECT \"title\" FROM " + ASSIGNMENT + " WHERE \"id\" = :id",
                new MapSqlParameterSource("id", assignmentId), String.class);
        String authUserId = jdbc.queryForObject(
                "SELECT \"userId\" FROM " + STUDENT + " WHERE \"id\" = :studentId",
                new MapSqlParameterSource("studentId", submission.get("studentId")),
                String.class);
        if (authUserId == null) {
            return;
        }
        notifications.create(new CreateNotificationCommand(
                UUID.randomUUID().toString(), authUserId,
                title + ": " + assignmentTitle, message, type,
                "/dashboard/learn", Instant.now()));
    }

    @Transactional(readOnly = true)
    public List<FeedbackResponse> feedback(String lecturerId, String submissionId) {
        Map<String, Object> row = getSubmission(submissionId);
        requireSectionLecturer(lecturerId, sectionOfAssignment(String.valueOf(row.get("assignmentId"))));
        return listFeedback(submissionId);
    }

    // ------------------------------------------------------------------
    // File objects — authorized lecturer download inside own section
    // ------------------------------------------------------------------

    @Transactional(readOnly = true)
    public Map<String, Object> downloadRevision(String lecturerId, String revisionId) {
        Map<String, Object> revision = getRevision(revisionId);
        Map<String, Object> submission = getSubmission(String.valueOf(revision.get("submissionId")));
        requireSectionLecturer(lecturerId,
                sectionOfAssignment(String.valueOf(submission.get("assignmentId"))));
        Map<String, Object> payload = filePayload(String.valueOf(revision.get("fileKey")));
        payload.put("fileName", revision.get("fileName"));
        return payload;
    }

    @Transactional(readOnly = true)
    public Map<String, Object> downloadMaterial(String lecturerId, String materialId) {
        Map<String, Object> material;
        try {
            material = jdbc.queryForMap("SELECT * FROM " + MATERIAL + " WHERE \"id\" = :id",
                    new MapSqlParameterSource("id", materialId));
        } catch (EmptyResultDataAccessException exception) {
            throw problem(HttpStatus.NOT_FOUND, "MATERIAL_NOT_FOUND", "Material not found");
        }
        requireSectionLecturer(lecturerId, String.valueOf(material.get("sectionId")));
        Map<String, Object> payload = filePayload((String) material.get("fileKey"));
        payload.put("fileName", material.get("fileName"));
        return payload;
    }

    // ------------------------------------------------------------------
    // Shared helpers (used by the student service too)
    // ------------------------------------------------------------------

    Map<String, Object> filePayload(String fileKey) {
        if (fileKey == null || fileKey.isBlank()) {
            throw problem(HttpStatus.NOT_FOUND, "FILE_NOT_FOUND", "No file attached");
        }
        try {
            return jdbc.queryForMap("SELECT \"key\", \"contentType\" AS content_type,"
                            + " \"sizeBytes\" AS size_bytes, \"sha256\", \"data\""
                            + " FROM " + FILE_OBJECT + " WHERE \"key\" = :key",
                    new MapSqlParameterSource("key", fileKey));
        } catch (EmptyResultDataAccessException exception) {
            throw problem(HttpStatus.NOT_FOUND, "FILE_NOT_FOUND", "File not found");
        }
    }

    /** Stores a file object when content is supplied; verifies the caller's
     * declared checksum against the received bytes (LMS-T07). Returns the
     * stored-object metadata (key/name/type/size/checksum) or null when no
     * content was supplied. */
    Map<String, Object> storeFile(String actorId, String scope, String fileName, String contentType,
            String contentBase64, String checksum) {
        if (contentBase64 == null || contentBase64.isBlank()) {
            return null;
        }
        byte[] bytes;
        try {
            bytes = java.util.Base64.getDecoder().decode(contentBase64);
        } catch (IllegalArgumentException exception) {
            throw problem(HttpStatus.BAD_REQUEST, "FILE_ENCODING_INVALID",
                    "File content must be base64");
        }
        String sha256 = sha256(bytes);
        if (checksum != null && !checksum.isBlank() && !checksum.equalsIgnoreCase(sha256)) {
            throw problem(HttpStatus.UNPROCESSABLE_ENTITY, "FILE_CHECKSUM_MISMATCH",
                    "File checksum does not match the content");
        }
        String key = "learning/" + scope + "/" + UUID.randomUUID();
        jdbc.update("INSERT INTO " + FILE_OBJECT
                        + " (\"key\", \"contentType\", \"sizeBytes\", \"sha256\", \"data\")"
                        + " VALUES (:key, :contentType, :sizeBytes, :sha256, :data)",
                new MapSqlParameterSource("key", key)
                        .addValue("contentType", contentType == null ? "application/octet-stream" : contentType)
                        .addValue("sizeBytes", (long) bytes.length)
                        .addValue("sha256", sha256)
                        .addValue("data", bytes));
        return Map.of("key", key, "fileName", fileName == null ? "" : fileName,
                "contentType", contentType == null ? "application/octet-stream" : contentType,
                "sizeBytes", (long) bytes.length, "checksum", sha256);
    }

    static String sha256(byte[] data) {
        try {
            return java.util.HexFormat.of().formatHex(
                    java.security.MessageDigest.getInstance("SHA-256").digest(data));
        } catch (java.security.NoSuchAlgorithmException impossible) {
            throw new IllegalStateException(impossible);
        }
    }

    void insertFeedback(String submissionId, String revisionId, String authorId,
            String comment, Double score) {
        jdbc.update("INSERT INTO " + FEEDBACK
                        + " (\"id\", \"submissionId\", \"revisionId\", \"authorId\", \"comment\", \"score\")"
                        + " VALUES (:id, :submissionId, :revisionId, :authorId, :comment, :score)",
                new MapSqlParameterSource("id", "fb-" + UUID.randomUUID())
                        .addValue("submissionId", submissionId)
                        .addValue("revisionId", revisionId)
                        .addValue("authorId", authorId)
                        .addValue("comment", comment)
                        .addValue("score", score));
    }

    List<FeedbackResponse> listFeedback(String submissionId) {
        return jdbc.query("SELECT * FROM " + FEEDBACK + " WHERE \"submissionId\" = :id"
                        + " ORDER BY \"createdAt\", \"id\"",
                new MapSqlParameterSource("id", submissionId), LearningService::mapFeedback);
    }

    List<SubmissionRevisionResponse> listRevisions(String submissionId) {
        return jdbc.query("SELECT * FROM " + REVISION + " WHERE \"submissionId\" = :id"
                        + " ORDER BY \"revisionNo\" DESC",
                new MapSqlParameterSource("id", submissionId), LearningService::mapRevision);
    }

    Map<String, Object> lockAssignment(String assignmentId) {
        try {
            return jdbc.queryForMap("SELECT * FROM " + ASSIGNMENT
                            + " WHERE \"id\" = :id FOR UPDATE",
                    new MapSqlParameterSource("id", assignmentId));
        } catch (EmptyResultDataAccessException exception) {
            throw problem(HttpStatus.NOT_FOUND, "ASSIGNMENT_NOT_FOUND", "Assignment not found");
        }
    }

    Map<String, Object> lockSubmission(String submissionId) {
        try {
            return jdbc.queryForMap("SELECT * FROM " + SUBMISSION
                            + " WHERE \"id\" = :id FOR UPDATE",
                    new MapSqlParameterSource("id", submissionId));
        } catch (EmptyResultDataAccessException exception) {
            throw problem(HttpStatus.NOT_FOUND, "SUBMISSION_NOT_FOUND", "Submission not found");
        }
    }

    Map<String, Object> lockMaterial(String materialId) {
        try {
            return jdbc.queryForMap("SELECT * FROM " + MATERIAL
                            + " WHERE \"id\" = :id FOR UPDATE",
                    new MapSqlParameterSource("id", materialId));
        } catch (EmptyResultDataAccessException exception) {
            throw problem(HttpStatus.NOT_FOUND, "MATERIAL_NOT_FOUND", "Material not found");
        }
    }

    Map<String, Object> getSubmission(String submissionId) {
        try {
            return jdbc.queryForMap("SELECT * FROM " + SUBMISSION + " WHERE \"id\" = :id",
                    new MapSqlParameterSource("id", submissionId));
        } catch (EmptyResultDataAccessException exception) {
            throw problem(HttpStatus.NOT_FOUND, "SUBMISSION_NOT_FOUND", "Submission not found");
        }
    }

    Map<String, Object> getRevision(String revisionId) {
        try {
            return jdbc.queryForMap("SELECT * FROM " + REVISION + " WHERE \"id\" = :id",
                    new MapSqlParameterSource("id", revisionId));
        } catch (EmptyResultDataAccessException exception) {
            throw problem(HttpStatus.NOT_FOUND, "REVISION_NOT_FOUND", "Revision not found");
        }
    }

    AssignmentResponse findAssignment(String assignmentId, String studentId) {
        try {
            return jdbc.queryForObject(assignmentSelect() + " WHERE a.\"id\" = :id",
                    new MapSqlParameterSource("id", assignmentId)
                            .addValue("studentId", studentId == null ? "" : studentId),
                    LearningService::mapAssignment);
        } catch (EmptyResultDataAccessException exception) {
            throw problem(HttpStatus.NOT_FOUND, "ASSIGNMENT_NOT_FOUND", "Assignment not found");
        }
    }

    MaterialResponse findMaterial(String materialId) {
        try {
            return jdbc.queryForObject("SELECT * FROM " + MATERIAL + " WHERE \"id\" = :id",
                    new MapSqlParameterSource("id", materialId), LearningService::mapMaterial);
        } catch (EmptyResultDataAccessException exception) {
            throw problem(HttpStatus.NOT_FOUND, "MATERIAL_NOT_FOUND", "Material not found");
        }
    }

    void requireVersion(Integer supplied, Map<String, Object> row) {
        if (supplied == null) {
            throw problem(HttpStatus.BAD_REQUEST, "VERSION_REQUIRED",
                    "The current version is required for this write");
        }
        if (supplied != ((Number) row.get("version")).intValue()) {
            throw problem(HttpStatus.CONFLICT, "STALE_VERSION",
                    "The record changed; reload before editing");
        }
    }

    void audit(String assignmentId, String submissionId, String actorId,
            String action, String detail) {
        jdbc.update("INSERT INTO " + AUDIT
                        + " (\"id\", \"assignmentId\", \"submissionId\", \"actorId\", \"action\", \"detail\")"
                        + " VALUES (:id, :assignmentId, :submissionId, :actorId, :action, :detail)",
                new MapSqlParameterSource("id", "lau-" + UUID.randomUUID())
                        .addValue("assignmentId", assignmentId)
                        .addValue("submissionId", submissionId)
                        .addValue("actorId", actorId)
                        .addValue("action", action)
                        .addValue("detail", detail));
    }

    // ------------------------------------------------------------------
    // Mappers
    // ------------------------------------------------------------------

    static String assignmentSelect() {
        return "SELECT a.*,"
                + " s.\"id\" AS my_submission_id, s.\"status\" AS my_submission_status"
                + " FROM " + ASSIGNMENT + " a"
                + " LEFT JOIN " + SUBMISSION + " s ON s.\"assignmentId\" = a.\"id\""
                + " AND s.\"studentId\" = :studentId";
    }

    static AssignmentResponse mapAssignment(ResultSet row, int n) throws SQLException {
        return new AssignmentResponse(
                row.getString("id"), row.getString("sectionId"), row.getString("title"),
                row.getString("description"), instant(row.getTimestamp("deadlineAt")),
                toDouble(row.getObject("maxScore")), row.getString("status"),
                row.getInt("version"), instant(row.getTimestamp("createdAt")),
                instant(row.getTimestamp("updatedAt")),
                row.getString("my_submission_id"), row.getString("my_submission_status"));
    }

    static MaterialResponse mapMaterial(ResultSet row, int n) throws SQLException {
        return new MaterialResponse(
                row.getString("id"), row.getString("sectionId"), row.getString("title"),
                row.getString("description"), row.getString("fileName"),
                row.getString("contentType"), toLong(row.getObject("sizeBytes")),
                row.getString("checksum"), row.getInt("version"),
                instant(row.getTimestamp("createdAt")), instant(row.getTimestamp("updatedAt")));
    }

    static SubmissionResponse mapSubmission(Map<String, Object> row) {
        return new SubmissionResponse(
                String.valueOf(row.get("id")), String.valueOf(row.get("assignmentId")),
                String.valueOf(row.get("studentId")), String.valueOf(row.get("status")),
                (String) row.get("currentRevisionId"), toInstant(row.get("submittedAt")),
                toInstant(row.get("returnedAt")), toInstant(row.get("reviewedAt")),
                ((Number) row.get("version")).intValue(),
                (String) row.get("student_name"), (String) row.get("student_email"));
    }

    static SubmissionRevisionResponse mapRevision(ResultSet row, int n) throws SQLException {
        return new SubmissionRevisionResponse(
                row.getString("id"), row.getString("submissionId"), row.getInt("revisionNo"),
                row.getString("fileName"), row.getString("contentType"),
                toLong(row.getObject("sizeBytes")), row.getString("checksum"),
                row.getString("textBody"), instant(row.getTimestamp("submittedAt")));
    }

    static FeedbackResponse mapFeedback(ResultSet row, int n) throws SQLException {
        return new FeedbackResponse(
                row.getString("id"), row.getString("submissionId"), row.getString("revisionId"),
                row.getString("authorId"), row.getString("comment"),
                toDouble(row.getObject("score")), instant(row.getTimestamp("createdAt")));
    }

    static RosterRowResponse mapRosterRow(ResultSet row, int n) throws SQLException {
        return new RosterRowResponse(
                row.getString("enrollment_id"), row.getString("student_id"), row.getString("student_name"),
                row.getString("student_email"), row.getString("enrollment_status"),
                row.getString("submission_id"), row.getString("submission_status"),
                instant(row.getTimestamp("submitted_at")));
    }

    private static MapSqlParameterSource materialParams(String id, String sectionId,
            MaterialUpsertRequest request, Map<String, Object> stored, String uploaderId) {
        return new MapSqlParameterSource("id", id)
                .addValue("sectionId", sectionId)
                .addValue("title", request.title())
                .addValue("description", request.description())
                .addValue("fileKey", stored == null ? null : stored.get("key"))
                .addValue("fileName", stored == null ? request.fileName() : stored.get("fileName"))
                .addValue("contentType", stored == null ? request.contentType() : stored.get("contentType"))
                .addValue("sizeBytes", stored == null ? null : stored.get("sizeBytes"))
                .addValue("checksum", stored == null ? request.checksum() : stored.get("checksum"))
                .addValue("uploaderId", uploaderId);
    }

    static Timestamp ts(Instant instant) {
        return instant == null ? null : Timestamp.from(instant);
    }

    static Instant instant(Timestamp timestamp) {
        return timestamp == null ? null : timestamp.toInstant();
    }

    static Double toDouble(Object value) {
        return value instanceof Number number ? number.doubleValue() : null;
    }

    static Long toLong(Object value) {
        return value instanceof Number number ? number.longValue() : null;
    }

    static Instant toInstant(Object value) {
        if (value == null) {
            return null;
        }
        if (value instanceof Timestamp timestamp) {
            return timestamp.toInstant();
        }
        if (value instanceof java.time.OffsetDateTime odt) {
            return odt.toInstant();
        }
        if (value instanceof java.time.LocalDateTime ldt) {
            return ldt.toInstant(java.time.ZoneOffset.UTC);
        }
        if (value instanceof Instant inst) {
            return inst;
        }
        return Instant.parse(String.valueOf(value));
    }

    static DomainException problem(HttpStatus status, String code, String message) {
        return new DomainException(status, code, message);
    }
}
