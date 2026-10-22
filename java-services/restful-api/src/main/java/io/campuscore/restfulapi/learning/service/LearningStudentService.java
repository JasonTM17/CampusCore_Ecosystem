package io.campuscore.restfulapi.learning.service;

import io.campuscore.restfulapi.learning.web.LearningDtos.AssignmentResponse;
import io.campuscore.restfulapi.learning.web.LearningDtos.FeedbackResponse;
import io.campuscore.restfulapi.learning.web.LearningDtos.MaterialResponse;
import io.campuscore.restfulapi.learning.web.LearningDtos.SubmissionResponse;
import io.campuscore.restfulapi.learning.web.LearningDtos.SubmissionRevisionResponse;
import io.campuscore.restfulapi.learning.web.LearningDtos.SubmissionUpsertRequest;
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
 * P09 LMS student surface (contract §6 LMS-T03/T05/T07, LMS-X01/X02).
 * Authority is the caller's active enrollment — {@code jwt.studentId} in the
 * assignment's section with status not DROPPED/CANCELLED; submits additionally
 * require ENROLLED/CONFIRMED so a revoked enrollment can never post work.
 *
 * <p>Lock order mirrors events: idempotency claim → assignment FOR UPDATE →
 * submission. Submit/resubmit create an immutable {@code SubmissionRevision}
 * and flip status in the same transaction; retried requests replay the stored
 * response instead of writing a second revision (§1.3).
 */
@Service
@Profile("persistence")
public class LearningStudentService {

    private static final String ASSIGNMENT = LearningService.ASSIGNMENT;
    private static final String SUBMISSION = LearningService.SUBMISSION;
    private static final String REVISION = LearningService.REVISION;
    private static final String MATERIAL = LearningService.MATERIAL;
    private static final String IDEMPOTENCY = "learning.\"Idempotency\"";
    private static final String ENROLLMENT = LearningService.ENROLLMENT;

    private final NamedParameterJdbcTemplate jdbc;
    private final LearningService staff;
    private final tools.jackson.databind.ObjectMapper objectMapper;
    private final boolean postgres;

    public LearningStudentService(NamedParameterJdbcTemplate jdbc, LearningService staff,
            tools.jackson.databind.ObjectMapper objectMapper) {
        this.jdbc = jdbc;
        this.staff = staff;
        this.objectMapper = objectMapper;
        this.postgres = jdbc.getJdbcOperations().execute((org.springframework.jdbc.core.ConnectionCallback<Boolean>) connection ->
                "PostgreSQL".equalsIgnoreCase(connection.getMetaData().getDatabaseProductName()));
    }

    // ------------------------------------------------------------------
    // Authority
    // ------------------------------------------------------------------

    private void requireActiveEnrollment(String studentId, String sectionId) {
        Integer count = jdbc.queryForObject("SELECT COUNT(*) FROM " + ENROLLMENT
                        + " WHERE \"studentId\" = :studentId AND \"sectionId\" = :sectionId"
                        + " AND \"status\" NOT IN ('DROPPED','CANCELLED')",
                new MapSqlParameterSource("studentId", studentId).addValue("sectionId", sectionId),
                Integer.class);
        if (count == null || count == 0) {
            throw problem(HttpStatus.FORBIDDEN, "NOT_ENROLLED",
                    "You are not enrolled in this section");
        }
    }

    private void requireSubmittableEnrollment(String studentId, String sectionId) {
        Integer count = jdbc.queryForObject("SELECT COUNT(*) FROM " + ENROLLMENT
                        + " WHERE \"studentId\" = :studentId AND \"sectionId\" = :sectionId"
                        + " AND \"status\" IN ('ENROLLED','CONFIRMED')",
                new MapSqlParameterSource("studentId", studentId).addValue("sectionId", sectionId),
                Integer.class);
        if (count == null || count == 0) {
            throw problem(HttpStatus.FORBIDDEN, "ENROLLMENT_NOT_ACTIVE",
                    "A dropped or revoked enrollment cannot submit work");
        }
    }

    private Map<String, Object> assignmentForStudent(String assignmentId, String studentId) {
        Map<String, Object> assignment;
        try {
            assignment = jdbc.queryForMap("SELECT * FROM " + ASSIGNMENT + " WHERE \"id\" = :id",
                    new MapSqlParameterSource("id", assignmentId));
        } catch (EmptyResultDataAccessException exception) {
            throw problem(HttpStatus.NOT_FOUND, "ASSIGNMENT_NOT_FOUND", "Assignment not found");
        }
        if ("DRAFT".equals(String.valueOf(assignment.get("status")))) {
            // Drafts are staff-scope — indistinguishable 404 (contract §1.1).
            throw problem(HttpStatus.NOT_FOUND, "ASSIGNMENT_NOT_FOUND", "Assignment not found");
        }
        requireActiveEnrollment(studentId, String.valueOf(assignment.get("sectionId")));
        return assignment;
    }

    // ------------------------------------------------------------------
    // Materials + assignments (read lane)
    // ------------------------------------------------------------------

    /** Student learning roster: sections with an active enrollment, each with
     * material/assignment counts the native surface can badge. */
    @Transactional(readOnly = true)
    public List<Map<String, Object>> mySections(String studentId) {
        // One card per section: a retake history can leave several enrollment
        // rows on the same sectionId — the operative seat (ENROLLED first)
        // is the one the portal surfaces.
        return jdbc.query(
                "SELECT e.\"sectionId\" AS section_id, sec.\"sectionNumber\" AS section_number,"
                        + " c.\"code\" AS course_code, c.\"name\" AS course_name,"
                        + " e.\"status\" AS enrollment_status,"
                        + " (SELECT COUNT(*) FROM " + MATERIAL + " m WHERE m.\"sectionId\" = e.\"sectionId\") AS material_count,"
                        + " (SELECT COUNT(*) FROM " + ASSIGNMENT + " a WHERE a.\"sectionId\" = e.\"sectionId\""
                        + "   AND a.\"status\" <> 'DRAFT') AS assignment_count"
                        + " FROM " + ENROLLMENT + " e"
                        + " JOIN " + LearningService.SECTION + " sec ON sec.\"id\" = e.\"sectionId\""
                        + " JOIN academic.\"Course\" c ON c.\"id\" = sec.\"courseId\""
                        + " WHERE e.\"studentId\" = :studentId"
                        + " AND e.\"status\" NOT IN ('DROPPED','CANCELLED')"
                        + " AND e.\"id\" = (SELECT e2.\"id\" FROM " + ENROLLMENT + " e2"
                        + "   WHERE e2.\"studentId\" = e.\"studentId\" AND e2.\"sectionId\" = e.\"sectionId\""
                        + "   AND e2.\"status\" NOT IN ('DROPPED','CANCELLED')"
                        + "   ORDER BY CASE e2.\"status\" WHEN 'ENROLLED' THEN 0 WHEN 'CONFIRMED' THEN 1"
                        + "     WHEN 'PENDING' THEN 2 ELSE 3 END, e2.\"enrolledAt\" DESC"
                        + "   LIMIT 1)"
                        + " ORDER BY c.\"code\", sec.\"sectionNumber\"",
                new MapSqlParameterSource("studentId", studentId),
                (row, n) -> Map.of(
                        "sectionId", row.getString("section_id"),
                        "sectionNumber", row.getString("section_number"),
                        "courseCode", row.getString("course_code"),
                        "courseName", row.getString("course_name"),
                        "enrollmentStatus", row.getString("enrollment_status"),
                        "materialCount", row.getLong("material_count"),
                        "assignmentCount", row.getLong("assignment_count")));
    }

    @Transactional(readOnly = true)
    public List<MaterialResponse> listMaterials(String studentId, String sectionId) {
        requireActiveEnrollment(studentId, sectionId);
        return jdbc.query("SELECT * FROM " + MATERIAL + " WHERE \"sectionId\" = :sectionId"
                        + " ORDER BY \"createdAt\" DESC, \"id\"",
                new MapSqlParameterSource("sectionId", sectionId), LearningService::mapMaterial);
    }

    @Transactional(readOnly = true)
    public Map<String, Object> downloadMaterial(String studentId, String materialId) {
        Map<String, Object> material;
        try {
            material = jdbc.queryForMap("SELECT * FROM " + MATERIAL + " WHERE \"id\" = :id",
                    new MapSqlParameterSource("id", materialId));
        } catch (EmptyResultDataAccessException exception) {
            throw problem(HttpStatus.NOT_FOUND, "MATERIAL_NOT_FOUND", "Material not found");
        }
        requireActiveEnrollment(studentId, String.valueOf(material.get("sectionId")));
        Map<String, Object> payload = staff.filePayload((String) material.get("fileKey"));
        payload.put("fileName", material.get("fileName"));
        return payload;
    }

    @Transactional(readOnly = true)
    public List<AssignmentResponse> listAssignments(String studentId, String sectionId) {
        requireActiveEnrollment(studentId, sectionId);
        return jdbc.query(LearningService.assignmentSelect()
                        + " WHERE a.\"sectionId\" = :sectionId AND a.\"status\" <> 'DRAFT'"
                        + " ORDER BY a.\"deadlineAt\" NULLS LAST, a.\"createdAt\" DESC",
                new MapSqlParameterSource("sectionId", sectionId).addValue("studentId", studentId),
                LearningService::mapAssignment);
    }

    @Transactional(readOnly = true)
    public AssignmentResponse assignment(String studentId, String assignmentId) {
        assignmentForStudent(assignmentId, studentId);
        return staff.findAssignment(assignmentId, studentId);
    }

    // ------------------------------------------------------------------
    // Submission draft → submit → resubmit (LMS-T03/T05, LMS-X01/X02)
    // ------------------------------------------------------------------

    /** Idempotent: first call creates the DRAFT submission; replay returns the
     * stored response without a second row (unique (assignment, student)
     * backstops any raced pair). */
    @Transactional
    public SubmissionResponse ensureDraft(String studentId, String assignmentId, String idempotencyKey) {
        Map<String, Object> assignment = assignmentForStudent(assignmentId, studentId);
        requireSubmittableEnrollment(studentId, String.valueOf(assignment.get("sectionId")));
        Map<String, Object> claimed = claimIdempotency(studentId, idempotencyKey,
                "draft:" + assignmentId);
        if (claimed != null) {
            return replayResponse(claimed);
        }
        Map<String, Object> submission = lockSubmissionFor(studentId, assignmentId);
        if (submission == null) {
            String id = "sub-" + UUID.randomUUID();
            try {
                jdbc.update("INSERT INTO " + SUBMISSION
                                + " (\"id\", \"assignmentId\", \"studentId\", \"status\")"
                                + " VALUES (:id, :assignmentId, :studentId, 'DRAFT')",
                        new MapSqlParameterSource("id", id)
                                .addValue("assignmentId", assignmentId)
                                .addValue("studentId", studentId));
            } catch (org.springframework.dao.DuplicateKeyException duplicate) {
                // Raced first-write: the unique (assignment, student) row now
                // exists — re-read and return it as a clean replay.
                submission = lockSubmissionFor(studentId, assignmentId);
            }
            if (submission == null) {
                submission = jdbc.queryForMap("SELECT * FROM " + SUBMISSION
                                + " WHERE \"id\" = :id",
                        new MapSqlParameterSource("id", id));
            }
            staff.audit(assignmentId, (String) submission.get("id"), studentId,
                    "DRAFT_OPENED", null);
        }
        SubmissionResponse response = staff.mapSubmission(submission);
        completeIdempotency(studentId, idempotencyKey, (String) submission.get("id"), response);
        return response;
    }

    /** Draft content (text + optional file) while status = DRAFT. */
    @Transactional
    public SubmissionResponse saveDraft(String studentId, String submissionId,
            SubmissionUpsertRequest request) {
        Map<String, Object> submission = lockOwnedSubmission(studentId, submissionId);
        if (!"DRAFT".equals(String.valueOf(submission.get("status")))) {
            throw problem(HttpStatus.CONFLICT, "SUBMISSION_NOT_DRAFT",
                    "Only a draft can be edited");
        }
        Map<String, Object> stored = request != null
                ? staff.storeFile(studentId, submissionId, request.fileName(),
                        request.contentType(), request.contentBase64(), request.checksum())
                : null;
        jdbc.update("UPDATE " + SUBMISSION
                        + " SET \"draftText\" = COALESCE(:text, \"draftText\"),"
                        + " \"draftFileKey\" = COALESCE(:fileKey, \"draftFileKey\"),"
                        + " \"draftFileName\" = COALESCE(:fileName, \"draftFileName\"),"
                        + " \"draftContentType\" = COALESCE(:contentType, \"draftContentType\"),"
                        + " \"draftSizeBytes\" = COALESCE(:sizeBytes, \"draftSizeBytes\"),"
                        + " \"draftChecksum\" = COALESCE(:checksum, \"draftChecksum\"),"
                        + " \"version\" = \"version\" + 1, \"updatedAt\" = CURRENT_TIMESTAMP"
                        + " WHERE \"id\" = :id",
                new MapSqlParameterSource("id", submissionId)
                        .addValue("text", request == null ? null : request.textBody())
                        .addValue("fileKey", stored == null ? null : stored.get("key"))
                        .addValue("fileName", stored == null ? null : stored.get("fileName"))
                        .addValue("contentType", stored == null ? null : stored.get("contentType"))
                        .addValue("sizeBytes", stored == null ? null : stored.get("sizeBytes"))
                        .addValue("checksum", stored == null ? null : stored.get("checksum")));
        return staff.mapSubmission(staff.getSubmission(submissionId));
    }

    /** LMS-T03 + LMS-X01: DRAFT → SUBMITTED under the assignment row lock with
     * the server clock as the deadline oracle. Creates the immutable first
     * revision; replay returns the stored response (no second revision). */
    @Transactional
    public SubmissionResponse submit(String studentId, String assignmentId, String idempotencyKey) {
        Map<String, Object> claimed = claimIdempotency(studentId, idempotencyKey,
                "submit:" + assignmentId);
        if (claimed != null) {
            return replayResponse(claimed);
        }
        Map<String, Object> assignment = lockAssignmentForStudent(assignmentId, studentId);
        Map<String, Object> submission = lockSubmissionFor(studentId, assignmentId);
        if (submission == null) {
            throw problem(HttpStatus.CONFLICT, "DRAFT_REQUIRED",
                    "Open a draft before submitting");
        }
        String status = String.valueOf(submission.get("status"));
        if (!"DRAFT".equals(status)) {
            throw problem(HttpStatus.CONFLICT, "SUBMISSION_STATE_INVALID",
                    "Only a draft can be submitted");
        }
        requireDeadline(assignment);
        String submissionId = String.valueOf(submission.get("id"));
        int nextNo = nextRevisionNo(submissionId);
        insertRevision(submissionId, nextNo, submission);
        int updated = jdbc.update("UPDATE " + SUBMISSION
                        + " SET \"status\" = 'SUBMITTED', \"submittedAt\" = CURRENT_TIMESTAMP,"
                        + " \"currentRevisionId\" = :revisionId,"
                        + " \"version\" = \"version\" + 1, \"updatedAt\" = CURRENT_TIMESTAMP"
                        + " WHERE \"id\" = :id AND \"status\" = 'DRAFT'",
                new MapSqlParameterSource("id", submissionId)
                        .addValue("revisionId", currentRevisionId(submissionId)));
        if (updated == 0) {
            throw problem(HttpStatus.CONFLICT, "SUBMISSION_STATE_INVALID",
                    "Submission is no longer a draft");
        }
        staff.audit(assignmentId, submissionId, studentId, "SUBMITTED", "revision=" + nextNo);
        SubmissionResponse response = staff.mapSubmission(staff.getSubmission(submissionId));
        completeIdempotency(studentId, idempotencyKey, submissionId, response);
        return response;
    }

    /** LMS-T05: RETURNED → RESUBMITTED — a NEW immutable revision inside the
     * same server-deadline window; never mutates the reviewed revision. */
    @Transactional
    public SubmissionResponse resubmit(String studentId, String assignmentId, String idempotencyKey,
            SubmissionUpsertRequest request) {
        Map<String, Object> claimed = claimIdempotency(studentId, idempotencyKey,
                "resubmit:" + assignmentId);
        if (claimed != null) {
            return replayResponse(claimed);
        }
        Map<String, Object> assignment = lockAssignmentForStudent(assignmentId, studentId);
        Map<String, Object> submission = lockSubmissionFor(studentId, assignmentId);
        if (submission == null) {
            throw problem(HttpStatus.NOT_FOUND, "SUBMISSION_NOT_FOUND", "Submission not found");
        }
        if (!"RETURNED".equals(String.valueOf(submission.get("status")))) {
            throw problem(HttpStatus.CONFLICT, "SUBMISSION_STATE_INVALID",
                    "Only returned work can be resubmitted");
        }
        requireDeadline(assignment);
        String submissionId = String.valueOf(submission.get("id"));
        Map<String, Object> stored = request != null
                ? staff.storeFile(studentId, submissionId, request.fileName(),
                        request.contentType(), request.contentBase64(), request.checksum())
                : null;
        String textBody = request != null && request.textBody() != null
                ? request.textBody() : (String) submission.get("draftText");
        if (stored == null && (textBody == null || textBody.isBlank())) {
            throw problem(HttpStatus.BAD_REQUEST, "SUBMISSION_EMPTY",
                    "A resubmission needs text or a file");
        }
        int nextNo = nextRevisionNo(submissionId);
        insertRevision(submissionId, nextNo, submission, stored, textBody);
        int updated = jdbc.update("UPDATE " + SUBMISSION
                        + " SET \"status\" = 'RESUBMITTED', \"submittedAt\" = CURRENT_TIMESTAMP,"
                        + " \"currentRevisionId\" = :revisionId,"
                        + " \"version\" = \"version\" + 1, \"updatedAt\" = CURRENT_TIMESTAMP"
                        + " WHERE \"id\" = :id AND \"status\" = 'RETURNED'",
                new MapSqlParameterSource("id", submissionId)
                        .addValue("revisionId", currentRevisionId(submissionId)));
        if (updated == 0) {
            throw problem(HttpStatus.CONFLICT, "SUBMISSION_STATE_INVALID",
                    "Submission is no longer in returned state");
        }
        staff.audit(assignmentId, submissionId, studentId, "RESUBMITTED", "revision=" + nextNo);
        SubmissionResponse response = staff.mapSubmission(staff.getSubmission(submissionId));
        completeIdempotency(studentId, idempotencyKey, submissionId, response);
        return response;
    }

    // ------------------------------------------------------------------
    // Own submission reads + file download (LMS-T07)
    // ------------------------------------------------------------------

    @Transactional(readOnly = true)
    public SubmissionResponse mySubmission(String studentId, String submissionId) {
        return staff.mapSubmission(ownedSubmission(studentId, submissionId));
    }

    @Transactional(readOnly = true)
    public List<SubmissionRevisionResponse> myRevisions(String studentId, String submissionId) {
        ownedSubmission(studentId, submissionId);
        return staff.listRevisions(submissionId);
    }

    @Transactional(readOnly = true)
    public List<FeedbackResponse> myFeedback(String studentId, String submissionId) {
        ownedSubmission(studentId, submissionId);
        return staff.listFeedback(submissionId);
    }

    @Transactional(readOnly = true)
    public Map<String, Object> downloadRevision(String studentId, String revisionId) {
        Map<String, Object> revision = staff.getRevision(revisionId);
        ownedSubmission(studentId, String.valueOf(revision.get("submissionId")));
        Map<String, Object> payload = staff.filePayload(String.valueOf(revision.get("fileKey")));
        payload.put("fileName", revision.get("fileName"));
        return payload;
    }

    @Transactional(readOnly = true)
    public List<SubmissionResponse> mySubmissions(String studentId, String sectionId) {
        requireActiveEnrollment(studentId, sectionId);
        return jdbc.query("SELECT s.* FROM " + SUBMISSION + " s"
                        + " JOIN " + ASSIGNMENT + " a ON a.\"id\" = s.\"assignmentId\""
                        + " WHERE s.\"studentId\" = :studentId AND a.\"sectionId\" = :sectionId"
                        + " ORDER BY s.\"updatedAt\" DESC",
                new MapSqlParameterSource("studentId", studentId).addValue("sectionId", sectionId),
                (row, n) -> LearningService.mapSubmission(rowToMap(row)));
    }

    // ------------------------------------------------------------------
    // Internals
    // ------------------------------------------------------------------

    private Map<String, Object> lockAssignmentForStudent(String assignmentId, String studentId) {
        Map<String, Object> assignment;
        try {
            assignment = jdbc.queryForMap("SELECT * FROM " + ASSIGNMENT
                            + " WHERE \"id\" = :id FOR UPDATE",
                    new MapSqlParameterSource("id", assignmentId));
        } catch (EmptyResultDataAccessException exception) {
            throw problem(HttpStatus.NOT_FOUND, "ASSIGNMENT_NOT_FOUND", "Assignment not found");
        }
        if (!"PUBLISHED".equals(String.valueOf(assignment.get("status")))) {
            throw problem(HttpStatus.CONFLICT, "ASSIGNMENT_NOT_OPEN",
                    "This assignment is not open for submissions");
        }
        requireSubmittableEnrollment(studentId, String.valueOf(assignment.get("sectionId")));
        return assignment;
    }

    private Map<String, Object> lockSubmissionFor(String studentId, String assignmentId) {
        try {
            return jdbc.queryForMap("SELECT * FROM " + SUBMISSION
                            + " WHERE \"assignmentId\" = :assignmentId AND \"studentId\" = :studentId"
                            + " FOR UPDATE",
                    new MapSqlParameterSource("assignmentId", assignmentId)
                            .addValue("studentId", studentId));
        } catch (EmptyResultDataAccessException exception) {
            return null;
        }
    }

    private Map<String, Object> lockOwnedSubmission(String studentId, String submissionId) {
        try {
            Map<String, Object> row = jdbc.queryForMap("SELECT * FROM " + SUBMISSION
                            + " WHERE \"id\" = :id FOR UPDATE",
                    new MapSqlParameterSource("id", submissionId));
            if (!studentId.equals(String.valueOf(row.get("studentId")))) {
                throw problem(HttpStatus.NOT_FOUND, "SUBMISSION_NOT_FOUND", "Submission not found");
            }
            return row;
        } catch (EmptyResultDataAccessException exception) {
            throw problem(HttpStatus.NOT_FOUND, "SUBMISSION_NOT_FOUND", "Submission not found");
        }
    }

    private Map<String, Object> ownedSubmission(String studentId, String submissionId) {
        Map<String, Object> row = staff.getSubmission(submissionId);
        if (!studentId.equals(String.valueOf(row.get("studentId")))) {
            // §1.1: another student's submission is a 404, not a 403 oracle.
            throw problem(HttpStatus.NOT_FOUND, "SUBMISSION_NOT_FOUND", "Submission not found");
        }
        return row;
    }

    /** LMS-X01 clock oracle: the submission write reads the deadline under the
     * assignment lock; server time decides — never client timestamps. */
    private void requireDeadline(Map<String, Object> assignment) {
        Instant deadlineAt = LearningService.toInstant(assignment.get("deadlineAt"));
        if (deadlineAt != null && Instant.now().isAfter(deadlineAt)) {
            throw problem(HttpStatus.CONFLICT, "DEADLINE_PASSED",
                    "The submission deadline has passed");
        }
    }

    private int nextRevisionNo(String submissionId) {
        Integer max = jdbc.queryForObject("SELECT COALESCE(MAX(\"revisionNo\"), 0) FROM "
                        + REVISION + " WHERE \"submissionId\" = :id",
                new MapSqlParameterSource("id", submissionId), Integer.class);
        return (max == null ? 0 : max) + 1;
    }

    private String currentRevisionId(String submissionId) {
        return jdbc.queryForObject("SELECT \"id\" FROM " + REVISION
                        + " WHERE \"submissionId\" = :id ORDER BY \"revisionNo\" DESC LIMIT 1",
                new MapSqlParameterSource("id", submissionId), String.class);
    }

    private void insertRevision(String submissionId, int revisionNo, Map<String, Object> draft) {
        insertRevision(submissionId, revisionNo, draft, null, (String) draft.get("draftText"));
    }

    private void insertRevision(String submissionId, int revisionNo, Map<String, Object> source,
            Map<String, Object> stored, String textBody) {
        jdbc.update("INSERT INTO " + REVISION
                        + " (\"id\", \"submissionId\", \"revisionNo\", \"fileKey\", \"fileName\","
                        + " \"contentType\", \"sizeBytes\", \"checksum\", \"textBody\")"
                        + " VALUES (:id, :submissionId, :revisionNo, :fileKey, :fileName,"
                        + " :contentType, :sizeBytes, :checksum, :textBody)",
                new MapSqlParameterSource("id", "rev-" + UUID.randomUUID())
                        .addValue("submissionId", submissionId)
                        .addValue("revisionNo", revisionNo)
                        .addValue("fileKey", stored != null ? stored.get("key") : source.get("draftFileKey"))
                        .addValue("fileName", stored != null ? stored.get("fileName") : source.get("draftFileName"))
                        .addValue("contentType", stored != null ? stored.get("contentType") : source.get("draftContentType"))
                        .addValue("sizeBytes", stored != null ? stored.get("sizeBytes") : source.get("draftSizeBytes"))
                        .addValue("checksum", stored != null ? stored.get("checksum") : source.get("draftChecksum"))
                        .addValue("textBody", textBody));
    }

    // ------------------------------------------------------------------
    // Idempotency (§1.3: per-owner key, request-hash bind, immutable replay)
    // ------------------------------------------------------------------

    private Map<String, Object> claimIdempotency(String studentId, String key, String requestHash) {
        if (key == null || key.isBlank()) {
            throw problem(HttpStatus.BAD_REQUEST, "IDEMPOTENCY_KEY_REQUIRED",
                    "Idempotency-Key header is required");
        }
        if (key.length() > 200) {
            throw problem(HttpStatus.BAD_REQUEST, "IDEMPOTENCY_KEY_INVALID",
                    "Idempotency-Key is too long");
        }
        MapSqlParameterSource parameters = new MapSqlParameterSource("id", "idem-" + UUID.randomUUID())
                .addValue("ownerId", studentId)
                .addValue("key", key)
                .addValue("hash", requestHash);
        if (postgres) {
            int inserted = jdbc.update("INSERT INTO " + IDEMPOTENCY
                            + " (\"id\", \"ownerId\", \"idempotencyKey\", \"requestHash\", \"state\")"
                            + " VALUES (:id, :ownerId, :key, :hash, 'IN_PROGRESS')"
                            + " ON CONFLICT (\"ownerId\", \"idempotencyKey\") DO NOTHING",
                    parameters);
            if (inserted == 1) {
                return null;
            }
        } else {
            try {
                jdbc.update("INSERT INTO " + IDEMPOTENCY
                                + " (\"id\", \"ownerId\", \"idempotencyKey\", \"requestHash\", \"state\")"
                                + " VALUES (:id, :ownerId, :key, :hash, 'IN_PROGRESS')",
                        parameters);
                return null;
            } catch (org.springframework.dao.DuplicateKeyException duplicate) {
                // H2 fallback — test-only path; Postgres claims atomically above.
            }
        }
        Map<String, Object> existing = jdbc.queryForMap(
                "SELECT \"requestHash\" AS request_hash, \"state\","
                        + " CAST(\"responseBody\" AS VARCHAR) AS response_body"
                        + " FROM " + IDEMPOTENCY
                        + " WHERE \"ownerId\" = :ownerId AND \"idempotencyKey\" = :key",
                new MapSqlParameterSource("ownerId", studentId).addValue("key", key));
        if (!requestHash.equals(String.valueOf(existing.get("request_hash")).trim())) {
            throw problem(HttpStatus.CONFLICT, "IDEMPOTENCY_CONFLICT",
                    "This Idempotency-Key was used for a different request");
        }
        if ("IN_PROGRESS".equals(String.valueOf(existing.get("state")))) {
            throw problem(HttpStatus.CONFLICT, "IDEMPOTENCY_IN_PROGRESS",
                    "A request with this key is still running");
        }
        return existing;
    }

    private void completeIdempotency(String studentId, String key, String recordId,
            SubmissionResponse response) {
        jdbc.update("UPDATE " + IDEMPOTENCY
                        + " SET \"state\" = 'COMPLETED', \"recordId\" = :recordId,"
                        + " \"responseBody\" = :responseBody, \"updatedAt\" = CURRENT_TIMESTAMP"
                        + " WHERE \"ownerId\" = :ownerId AND \"idempotencyKey\" = :key",
                new MapSqlParameterSource("recordId", recordId)
                        .addValue("responseBody", objectMapper.writeValueAsString(response))
                        .addValue("ownerId", studentId)
                        .addValue("key", key));
    }

    private SubmissionResponse replayResponse(Map<String, Object> row) {
        Object body = row.get("response_body");
        if (!(body instanceof String json) || json.isBlank()) {
            throw problem(HttpStatus.CONFLICT, "IDEMPOTENCY_RESPONSE_UNAVAILABLE",
                    "The original response is unavailable; refresh the current submission state");
        }
        return objectMapper.readValue(json, SubmissionResponse.class);
    }

    private static Map<String, Object> rowToMap(ResultSet row) throws SQLException {
        var meta = row.getMetaData();
        var map = new java.util.HashMap<String, Object>();
        for (int i = 1; i <= meta.getColumnCount(); i++) {
            map.put(meta.getColumnLabel(i), row.getObject(i));
        }
        return map;
    }

    private static DomainException problem(HttpStatus status, String code, String message) {
        return new DomainException(status, code, message);
    }
}
