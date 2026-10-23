package io.campuscore.restfulapi.admissions.service;

import io.campuscore.restfulapi.admissions.web.AdmissionDtos.ApplicationResponse;
import io.campuscore.restfulapi.admissions.web.AdmissionDtos.AttachmentUploadRequest;
import io.campuscore.restfulapi.admissions.web.AdmissionDtos.CreateApplicationRequest;
import io.campuscore.restfulapi.admissions.web.AdmissionDtos.SaveApplicationRequest;
import io.campuscore.restfulapi.web.DomainException;
import java.sql.ResultSet;
import java.sql.SQLException;
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
 * P10 simulated admissions — applicant lane (domain-contracts §7).
 *
 * <p>The applicant is the auth user itself — applications key on
 * {@code applicantUserId = jwt.sub}, never an academic Student row, so the
 * synthetic applicant profile stays provably separate from academic
 * authority. Applicant isolation is indistinguishable 404: every owned query
 * filters {@code applicantUserId}, so a foreign id returns the same
 * APPLICATION_NOT_FOUND an absent id does.
 *
 * <p>Lock order mirrors learning: idempotency claim → application
 * {@code FOR UPDATE} → transition. Optimistic {@code expectedVersion} is
 * required on every mutation; terminal applications reject all mutations.
 */
@Service
@Profile("persistence")
public class AdmissionApplicantService {

    private static final String APPLICATION = AdmissionService.APPLICATION;
    private static final String ATTACHMENT = AdmissionService.ATTACHMENT;
    private static final String FILE_OBJECT = AdmissionService.FILE_OBJECT;
    private static final String IDEMPOTENCY = AdmissionService.IDEMPOTENCY;

    private final NamedParameterJdbcTemplate jdbc;
    private final AdmissionService staff;
    private final tools.jackson.databind.ObjectMapper objectMapper;
    private final boolean postgres;

    public AdmissionApplicantService(NamedParameterJdbcTemplate jdbc, AdmissionService staff,
            tools.jackson.databind.ObjectMapper objectMapper) {
        this.jdbc = jdbc;
        this.staff = staff;
        this.objectMapper = objectMapper;
        this.postgres = jdbc.getJdbcOperations().execute(
                (org.springframework.jdbc.core.ConnectionCallback<Boolean>) connection ->
                        "PostgreSQL".equalsIgnoreCase(connection.getMetaData().getDatabaseProductName()));
    }

    // ------------------------------------------------------------------
    // Reads (owner-scoped)
    // ------------------------------------------------------------------

    public List<ApplicationResponse> myApplications(String applicantId) {
        List<Map<String, Object>> rows = jdbc.query(
                AdmissionService.applicationSelect() + " WHERE a.\"applicantUserId\" = :owner"
                        + " ORDER BY a.\"createdAt\" DESC",
                new MapSqlParameterSource("owner", applicantId),
                (row, index) -> rowToMap(row));
        return rows.stream()
                .map(row -> staff.mapApplication(row,
                        staff.attachmentsOf(String.valueOf(row.get("id"))),
                        staff.reviewsOf(String.valueOf(row.get("id")))))
                .toList();
    }

    /** Owner-only detail — a foreign id is indistinguishable 404 (§7 ADM-T02). */
    public ApplicationResponse myApplication(String applicantId, String applicationId) {
        Map<String, Object> row = ownedApplication(applicantId, applicationId);
        return staff.mapApplication(row,
                staff.attachmentsOf(applicationId), staff.reviewsOf(applicationId));
    }

    public Map<String, Object> attachmentFile(String applicantId, String applicationId,
            String attachmentId) {
        ownedApplication(applicantId, applicationId);
        return staff.attachmentFile(applicationId, attachmentId);
    }

    // ------------------------------------------------------------------
    // Lifecycle
    // ------------------------------------------------------------------

    /**
     * Create the draft for a cycle. One ACTIVE application per
     * (applicant, cycle): WITHDRAWN frees the slot, terminal history stays.
     * The Postgres partial unique index is the backstop; the service check
     * gives the same answer on engines without it (H2 mirror).
     */
    @Transactional
    public ApplicationResponse create(String applicantId, CreateApplicationRequest request,
            String idempotencyKey) {
        // Normalize before hashing + storing so "C", " C" and "C " are one
        // logical cycle for both the idempotency bind and the unique index.
        String cycle = request == null || request.cycle() == null
                ? null : request.cycle().trim();
        if (cycle == null || cycle.isBlank()) {
            throw problem(HttpStatus.BAD_REQUEST, "ADMISSION_CYCLE_REQUIRED", "cycle is required");
        }
        Map<String, Object> claimed = claimIdempotency(applicantId, idempotencyKey,
                "create:" + cycle);
        if (claimed != null) {
            return replayResponse(claimed);
        }
        Integer active = jdbc.queryForObject(
                "SELECT COUNT(*) FROM " + APPLICATION
                        + " WHERE \"applicantUserId\" = :owner AND \"cycle\" = :cycle"
                        + " AND \"status\" IN ('DRAFT','SUBMITTED','IN_REVIEW','RETURNED')",
                new MapSqlParameterSource("owner", applicantId).addValue("cycle", cycle),
                Integer.class);
        if (active != null && active > 0) {
            throw problem(HttpStatus.CONFLICT, "APPLICATION_CYCLE_ACTIVE",
                    "An application already exists for this admission cycle");
        }
        String id = UUID.randomUUID().toString();
        try {
            jdbc.update(
                    "INSERT INTO " + APPLICATION
                            + " (\"id\", \"applicantUserId\", \"cycle\", \"status\")"
                            + " VALUES (:id, :owner, :cycle, 'DRAFT')",
                    new MapSqlParameterSource("id", id)
                            .addValue("owner", applicantId)
                            .addValue("cycle", cycle));
        } catch (org.springframework.dao.DuplicateKeyException race) {
            // Concurrent create lost to the partial unique index backstop —
            // same domain answer as the service-level check above.
            throw problem(HttpStatus.CONFLICT, "APPLICATION_CYCLE_ACTIVE",
                    "An application already exists for this admission cycle");
        }
        staff.audit(id, applicantId, "CREATED", null, "DRAFT", "cycle=" + cycle);
        ApplicationResponse response = myApplication(applicantId, id);
        completeIdempotency(applicantId, idempotencyKey, id, response);
        return response;
    }

    /** Save draft form fields — only while the application is editable. */
    @Transactional
    public ApplicationResponse save(String applicantId, String applicationId,
            SaveApplicationRequest request) {
        Map<String, Object> application = lockOwned(applicantId, applicationId);
        String status = String.valueOf(application.get("status"));
        if (AdmissionService.TERMINAL_STATUSES.contains(status)) {
            throw problem(HttpStatus.CONFLICT, "APPLICATION_TERMINAL",
                    "Application is " + status + " and can no longer change");
        }
        if (!"DRAFT".equals(status) && !"RETURNED".equals(status)) {
            throw problem(HttpStatus.CONFLICT, "APPLICATION_STATE_INVALID",
                    "Fields can only be edited while the application is a draft or returned");
        }
        staff.requireVersion(application, request == null ? null : request.expectedVersion());
        jdbc.update(
                "UPDATE " + APPLICATION + " SET \"fullName\" = :fullName, \"dateOfBirth\" = :dob,"
                        + " \"schoolName\" = :schoolName, \"intendedMajor\" = :major, \"essay\" = :essay,"
                        + " \"version\" = \"version\" + 1, \"updatedAt\" = CURRENT_TIMESTAMP"
                        + " WHERE \"id\" = :id",
                new MapSqlParameterSource("id", applicationId)
                        .addValue("fullName", request.fullName())
                        .addValue("dob", request.dateOfBirth())
                        .addValue("schoolName", request.schoolName())
                        .addValue("major", request.intendedMajor())
                        .addValue("essay", request.essay()));
        staff.audit(applicationId, applicantId, "SAVED", status, status, null);
        return myApplication(applicantId, applicationId);
    }

    /** DRAFT|RETURNED → SUBMITTED; required fields must be present. */
    @Transactional
    public ApplicationResponse submit(String applicantId, String applicationId,
            Integer expectedVersion, String idempotencyKey) {
        Map<String, Object> claimed = claimIdempotency(applicantId, idempotencyKey,
                "submit:" + applicationId + ":" + expectedVersion);
        if (claimed != null) {
            return replayResponse(claimed);
        }
        Map<String, Object> application = lockOwned(applicantId, applicationId);
        String status = String.valueOf(application.get("status"));
        if (AdmissionService.TERMINAL_STATUSES.contains(status)) {
            throw problem(HttpStatus.CONFLICT, "APPLICATION_TERMINAL",
                    "Application is " + status + " and can no longer change");
        }
        if (!"DRAFT".equals(status) && !"RETURNED".equals(status)) {
            throw problem(HttpStatus.CONFLICT, "APPLICATION_STATE_INVALID",
                    "Only a draft or returned application can be submitted");
        }
        staff.requireVersion(application, expectedVersion);
        requireComplete(applicationId);
        jdbc.update(
                "UPDATE " + APPLICATION + " SET \"status\" = 'SUBMITTED',"
                        + " \"submittedAt\" = CURRENT_TIMESTAMP, \"claimedBy\" = NULL,"
                        + " \"version\" = \"version\" + 1, \"updatedAt\" = CURRENT_TIMESTAMP"
                        + " WHERE \"id\" = :id",
                new MapSqlParameterSource("id", applicationId));
        staff.audit(applicationId, applicantId, "SUBMITTED", status, "SUBMITTED", null);
        ApplicationResponse response = myApplication(applicantId, applicationId);
        completeIdempotency(applicantId, idempotencyKey, applicationId, response);
        return response;
    }

    /** Owner withdraws while the application is non-terminal. */
    @Transactional
    public ApplicationResponse withdraw(String applicantId, String applicationId,
            Integer expectedVersion, String idempotencyKey) {
        Map<String, Object> claimed = claimIdempotency(applicantId, idempotencyKey,
                "withdraw:" + applicationId + ":" + expectedVersion);
        if (claimed != null) {
            return replayResponse(claimed);
        }
        Map<String, Object> application = lockOwned(applicantId, applicationId);
        String status = String.valueOf(application.get("status"));
        if (AdmissionService.TERMINAL_STATUSES.contains(status)) {
            throw problem(HttpStatus.CONFLICT, "APPLICATION_TERMINAL",
                    "Application is " + status + " and can no longer change");
        }
        staff.requireVersion(application, expectedVersion);
        jdbc.update(
                "UPDATE " + APPLICATION + " SET \"status\" = 'WITHDRAWN',"
                        + " \"version\" = \"version\" + 1, \"updatedAt\" = CURRENT_TIMESTAMP"
                        + " WHERE \"id\" = :id",
                new MapSqlParameterSource("id", applicationId));
        staff.audit(applicationId, applicantId, "WITHDRAWN", status, "WITHDRAWN", null);
        ApplicationResponse response = myApplication(applicantId, applicationId);
        completeIdempotency(applicantId, idempotencyKey, applicationId, response);
        return response;
    }

    // ------------------------------------------------------------------
    // Attachments (checksum-bound; editable states only)
    // ------------------------------------------------------------------

    @Transactional
    public ApplicationResponse uploadAttachment(String applicantId, String applicationId,
            AttachmentUploadRequest request, String idempotencyKey) {
        if (request == null) {
            throw problem(HttpStatus.BAD_REQUEST, "ATTACHMENT_DATA_REQUIRED", "dataBase64 is required");
        }
        // Decode + checksum before claiming so the request hash binds the
        // actual bytes — a same-key retry with different bytes conflicts.
        byte[] bytes = decode(request.dataBase64(), request.fileName());
        String checksum = sha256(bytes);
        if (request.checksum() != null && !request.checksum().isBlank()
                && !checksum.equalsIgnoreCase(request.checksum().trim())) {
            throw problem(HttpStatus.BAD_REQUEST, "FILE_CHECKSUM_MISMATCH",
                    "Declared checksum does not match the uploaded bytes");
        }
        Map<String, Object> claimed = claimIdempotency(applicantId, idempotencyKey,
                "attach:" + applicationId + ":" + checksum);
        if (claimed != null) {
            return replayResponse(claimed);
        }
        Map<String, Object> application = lockOwned(applicantId, applicationId);
        String status = String.valueOf(application.get("status"));
        if (AdmissionService.TERMINAL_STATUSES.contains(status)) {
            throw problem(HttpStatus.CONFLICT, "APPLICATION_TERMINAL",
                    "Application is " + status + " and can no longer change");
        }
        if (!"DRAFT".equals(status) && !"RETURNED".equals(status)) {
            throw problem(HttpStatus.CONFLICT, "APPLICATION_STATE_INVALID",
                    "Attachments can only change while the application is a draft or returned");
        }
        String fileKey = "admissions/" + applicationId + "/" + UUID.randomUUID();
        jdbc.update(
                "INSERT INTO " + FILE_OBJECT
                        + " (\"key\", \"contentType\", \"sizeBytes\", \"sha256\", \"data\")"
                        + " VALUES (:key, :contentType, :size, :sha, :data)",
                new MapSqlParameterSource()
                        .addValue("key", fileKey)
                        .addValue("contentType", request.contentType() == null
                                ? "application/octet-stream" : request.contentType())
                        .addValue("size", (long) bytes.length)
                        .addValue("sha", checksum)
                        .addValue("data", bytes));
        jdbc.update(
                "INSERT INTO " + ATTACHMENT
                        + " (\"id\", \"applicationId\", \"fileKey\", \"fileName\", \"contentType\","
                        + " \"sizeBytes\", \"checksum\")"
                        + " VALUES (:id, :appId, :fileKey, :fileName, :contentType, :size, :sha)",
                new MapSqlParameterSource()
                        .addValue("id", UUID.randomUUID().toString())
                        .addValue("appId", applicationId)
                        .addValue("fileKey", fileKey)
                        .addValue("fileName", request.fileName())
                        .addValue("contentType", request.contentType() == null
                                ? "application/octet-stream" : request.contentType())
                        .addValue("size", (long) bytes.length)
                        .addValue("sha", checksum));
        jdbc.update(
                "UPDATE " + APPLICATION
                        + " SET \"version\" = \"version\" + 1, \"updatedAt\" = CURRENT_TIMESTAMP"
                        + " WHERE \"id\" = :id",
                new MapSqlParameterSource("id", applicationId));
        staff.audit(applicationId, applicantId, "ATTACHMENT_ADDED", status, status,
                request.fileName());
        ApplicationResponse response = myApplication(applicantId, applicationId);
        completeIdempotency(applicantId, idempotencyKey, applicationId, response);
        return response;
    }

    /**
     * Remove an attachment and its bytes — no orphan FileObject rows are left
     * behind (the exit-gate cleanup test counts them).
     */
    @Transactional
    public ApplicationResponse deleteAttachment(String applicantId, String applicationId,
            String attachmentId, String idempotencyKey) {
        Map<String, Object> claimed = claimIdempotency(applicantId, idempotencyKey,
                "detach:" + applicationId + ":" + attachmentId);
        if (claimed != null) {
            return replayResponse(claimed);
        }
        Map<String, Object> application = lockOwned(applicantId, applicationId);
        String status = String.valueOf(application.get("status"));
        if (AdmissionService.TERMINAL_STATUSES.contains(status)) {
            throw problem(HttpStatus.CONFLICT, "APPLICATION_TERMINAL",
                    "Application is " + status + " and can no longer change");
        }
        if (!"DRAFT".equals(status) && !"RETURNED".equals(status)) {
            throw problem(HttpStatus.CONFLICT, "APPLICATION_STATE_INVALID",
                    "Attachments can only change while the application is a draft or returned");
        }
        Map<String, Object> attachment;
        try {
            attachment = jdbc.queryForMap(
                    "SELECT \"fileKey\" FROM " + ATTACHMENT
                            + " WHERE \"id\" = :id AND \"applicationId\" = :appId",
                    new MapSqlParameterSource("id", attachmentId)
                            .addValue("appId", applicationId));
        } catch (EmptyResultDataAccessException exception) {
            throw problem(HttpStatus.NOT_FOUND, "ATTACHMENT_NOT_FOUND", "Attachment not found");
        }
        jdbc.update("DELETE FROM " + ATTACHMENT + " WHERE \"id\" = :id",
                new MapSqlParameterSource("id", attachmentId));
        jdbc.update("DELETE FROM " + FILE_OBJECT + " WHERE \"key\" = :key",
                new MapSqlParameterSource("key", String.valueOf(attachment.get("fileKey"))));
        jdbc.update(
                "UPDATE " + APPLICATION
                        + " SET \"version\" = \"version\" + 1, \"updatedAt\" = CURRENT_TIMESTAMP"
                        + " WHERE \"id\" = :id",
                new MapSqlParameterSource("id", applicationId));
        staff.audit(applicationId, applicantId, "ATTACHMENT_REMOVED", status, status, attachmentId);
        ApplicationResponse response = myApplication(applicantId, applicationId);
        completeIdempotency(applicantId, idempotencyKey, applicationId, response);
        return response;
    }

    // ------------------------------------------------------------------
    // Authority + helpers
    // ------------------------------------------------------------------

    private Map<String, Object> ownedApplication(String applicantId, String applicationId) {
        try {
            return jdbc.queryForMap(
                    AdmissionService.applicationSelect()
                            + " WHERE a.\"id\" = :id AND a.\"applicantUserId\" = :owner",
                    new MapSqlParameterSource("id", applicationId)
                            .addValue("owner", applicantId));
        } catch (EmptyResultDataAccessException exception) {
            // indistinguishable from a missing id — no cross-applicant oracle
            throw problem(HttpStatus.NOT_FOUND, "APPLICATION_NOT_FOUND", "Application not found");
        }
    }

    private Map<String, Object> lockOwned(String applicantId, String applicationId) {
        try {
            return jdbc.queryForMap(
                    "SELECT \"id\", \"applicantUserId\", \"cycle\", \"status\", \"claimedBy\","
                            + " \"version\", \"submittedAt\", \"decision\""
                            + " FROM " + APPLICATION
                            + " WHERE \"id\" = :id AND \"applicantUserId\" = :owner FOR UPDATE",
                    new MapSqlParameterSource("id", applicationId)
                            .addValue("owner", applicantId));
        } catch (EmptyResultDataAccessException exception) {
            throw problem(HttpStatus.NOT_FOUND, "APPLICATION_NOT_FOUND", "Application not found");
        }
    }

    /** Required form fields before submit; attachments are optional. */
    private void requireComplete(String applicationId) {
        Map<String, Object> row = jdbc.queryForMap(
                "SELECT \"fullName\", \"schoolName\", \"intendedMajor\", \"dateOfBirth\""
                        + " FROM " + APPLICATION + " WHERE \"id\" = :id",
                new MapSqlParameterSource("id", applicationId));
        for (String column : List.of("fullName", "schoolName", "intendedMajor", "dateOfBirth")) {
            Object value = row.get(column);
            if (value == null || String.valueOf(value).isBlank()) {
                throw problem(HttpStatus.BAD_REQUEST, "APPLICATION_INCOMPLETE",
                        "Field " + column + " is required before submitting");
            }
        }
    }

    private static byte[] decode(String dataBase64, String fileName) {
        if (fileName == null || fileName.isBlank()) {
            throw problem(HttpStatus.BAD_REQUEST, "ATTACHMENT_NAME_REQUIRED", "fileName is required");
        }
        if (dataBase64 == null || dataBase64.isBlank()) {
            throw problem(HttpStatus.BAD_REQUEST, "ATTACHMENT_DATA_REQUIRED", "dataBase64 is required");
        }
        try {
            byte[] bytes = java.util.Base64.getDecoder().decode(dataBase64);
            if (bytes.length == 0 || bytes.length > 5 * 1024 * 1024) {
                throw problem(HttpStatus.BAD_REQUEST, "ATTACHMENT_SIZE_INVALID",
                        "Attachment must be 1 byte to 5 MiB");
            }
            return bytes;
        } catch (IllegalArgumentException exception) {
            throw problem(HttpStatus.BAD_REQUEST, "ATTACHMENT_DATA_INVALID", "dataBase64 is not valid base64");
        }
    }

    private static String sha256(byte[] bytes) {
        try {
            var digest = java.security.MessageDigest.getInstance("SHA-256").digest(bytes);
            var hex = new StringBuilder(digest.length * 2);
            for (byte b : digest) {
                hex.append(String.format("%02x", b));
            }
            return hex.toString();
        } catch (java.security.NoSuchAlgorithmException exception) {
            throw new IllegalStateException(exception);
        }
    }

    // ------------------------------------------------------------------
    // Idempotency (§1.3: per-owner key, request-hash bind, immutable replay)
    // ------------------------------------------------------------------

    private Map<String, Object> claimIdempotency(String applicantId, String key, String requestHash) {
        if (key == null || key.isBlank()) {
            throw problem(HttpStatus.BAD_REQUEST, "IDEMPOTENCY_KEY_REQUIRED",
                    "Idempotency-Key header is required");
        }
        if (key.length() > 200) {
            throw problem(HttpStatus.BAD_REQUEST, "IDEMPOTENCY_KEY_INVALID",
                    "Idempotency-Key is too long");
        }
        MapSqlParameterSource parameters = new MapSqlParameterSource("id", "idem-" + UUID.randomUUID())
                .addValue("ownerId", applicantId)
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
                new MapSqlParameterSource("ownerId", applicantId).addValue("key", key));
        if (!requestHash.trim().equals(String.valueOf(existing.get("request_hash")).trim())) {
            throw problem(HttpStatus.CONFLICT, "IDEMPOTENCY_CONFLICT",
                    "This Idempotency-Key was used for a different request");
        }
        if ("IN_PROGRESS".equals(String.valueOf(existing.get("state")))) {
            throw problem(HttpStatus.CONFLICT, "IDEMPOTENCY_IN_PROGRESS",
                    "A request with this key is still running");
        }
        return existing;
    }

    private void completeIdempotency(String applicantId, String key, String recordId,
            ApplicationResponse response) {
        jdbc.update("UPDATE " + IDEMPOTENCY
                        + " SET \"state\" = 'COMPLETED', \"recordId\" = :recordId,"
                        + " \"responseBody\" = :responseBody, \"updatedAt\" = CURRENT_TIMESTAMP"
                        + " WHERE \"ownerId\" = :ownerId AND \"idempotencyKey\" = :key",
                new MapSqlParameterSource("recordId", recordId)
                        .addValue("responseBody", objectMapper.writeValueAsString(response))
                        .addValue("ownerId", applicantId)
                        .addValue("key", key));
    }

    private ApplicationResponse replayResponse(Map<String, Object> row) {
        Object body = row.get("response_body");
        if (!(body instanceof String json) || json.isBlank()) {
            throw problem(HttpStatus.CONFLICT, "IDEMPOTENCY_RESPONSE_UNAVAILABLE",
                    "The original response is unavailable; refresh the current application state");
        }
        return objectMapper.readValue(json, ApplicationResponse.class);
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
