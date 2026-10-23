package io.campuscore.restfulapi.careers.service;

import io.campuscore.restfulapi.careers.web.CareerDtos.ApplicationResponse;
import io.campuscore.restfulapi.careers.web.CareerDtos.ApplyRequest;
import io.campuscore.restfulapi.careers.web.CareerDtos.AttachmentUploadRequest;
import io.campuscore.restfulapi.careers.web.CareerDtos.OpportunityResponse;
import io.campuscore.restfulapi.web.DomainException;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.Base64;
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
 * P12 careers — candidate lane (contract §9).
 *
 * <p>The candidate is the auth user itself — applications key on
 * {@code candidateUserId = jwt.sub} and candidate reads scope
 * {@code WHERE candidateUserId = :owner}, so a foreign application id
 * answers the same APPLICATION_NOT_FOUND a missing id does (no oracle).
 * Applying claims an idempotency row first (§1.3); the Postgres partial
 * unique index backstops one-active-application-per-opportunity (CAR-T04)
 * and the service check gives the same answer on the H2 mirror.
 *
 * <p>Only PUBLISHED opportunities appear in browse — a closed/paused/draft
 * posting accepts no new applications (CAR-T03/T04). WITHDRAW is owner-
 * only pre-terminal; REJECT's moderation reason is always visible to the
 * candidate (CAR-T06). Attachments are owner-written pre-terminal and
 * readable by the owner or the owning org's recruiters (CAR-X02).
 */
@Service
@Profile("persistence")
public class CareerCandidateService {

    private static final String APPLICATION = CareerService.APPLICATION;
    private static final String ATTACHMENT = CareerService.ATTACHMENT;
    private static final String OPPORTUNITY = CareerService.OPPORTUNITY;
    private static final String IDEMPOTENCY = CareerService.IDEMPOTENCY;
    private static final String AUTH_USER = CareerService.AUTH_USER;

    private final NamedParameterJdbcTemplate jdbc;
    private final CareerService staff;
    private final tools.jackson.databind.ObjectMapper objectMapper;
    private final boolean postgres;

    public CareerCandidateService(NamedParameterJdbcTemplate jdbc, CareerService staff,
            tools.jackson.databind.ObjectMapper objectMapper) {
        this.jdbc = jdbc;
        this.staff = staff;
        this.objectMapper = objectMapper;
        this.postgres = jdbc.getJdbcOperations().execute(
                (org.springframework.jdbc.core.ConnectionCallback<Boolean>) connection ->
                        "PostgreSQL".equalsIgnoreCase(connection.getMetaData().getDatabaseProductName()));
    }

    // ------------------------------------------------------------------
    // Browse (any authenticated user — PUBLISHED only)
    // ------------------------------------------------------------------

    /** Published opportunities — the only state a candidate may apply to. */
    @Transactional(readOnly = true)
    public List<OpportunityResponse> browse(String query) {
        MapSqlParameterSource params = new MapSqlParameterSource();
        String sql = CareerService.opportunitySelect() + " WHERE o.\"status\" = 'PUBLISHED'";
        if (query != null && !query.isBlank()) {
            sql += " AND (LOWER(o.\"title\") LIKE :q OR LOWER(o.\"description\") LIKE :q"
                    + " OR LOWER(o.\"location\") LIKE :q OR LOWER(g.\"name\") LIKE :q)";
            params.addValue("q", "%" + query.trim().toLowerCase() + "%");
        }
        sql += " ORDER BY o.\"publishedAt\" DESC";
        return jdbc.query(sql, params, (row, index) -> rowToMap(row))
                .stream().map(staff::mapOpportunity).toList();
    }

    /** Published detail — draft/closed postings are indistinguishable 404. */
    @Transactional(readOnly = true)
    public OpportunityResponse browseOne(String opportunityId) {
        Map<String, Object> row;
        try {
            row = jdbc.queryForMap(
                    CareerService.opportunitySelect()
                            + " WHERE o.\"id\" = :id AND o.\"status\" = 'PUBLISHED'",
                    new MapSqlParameterSource("id", opportunityId));
        } catch (EmptyResultDataAccessException exception) {
            throw problem(HttpStatus.NOT_FOUND, "OPPORTUNITY_NOT_FOUND", "Opportunity not found");
        }
        return staff.mapOpportunity(row);
    }

    /** Own applications newest-first — foreign ids never appear here. */
    @Transactional
    public List<ApplicationResponse> myApplications(String candidateId) {
        return jdbc.query(
                CareerService.applicationSelect() + " WHERE a.\"candidateUserId\" = :owner"
                        + " ORDER BY a.\"submittedAt\" DESC",
                new MapSqlParameterSource("owner", candidateId),
                (row, index) -> staff.mapApplication(rowToMap(row)));
    }

    /** Owner-only detail — a foreign id is indistinguishable 404. */
    @Transactional
    public ApplicationResponse myApplication(String candidateId, String applicationId) {
        return staff.mapApplication(ownedApplication(candidateId, applicationId));
    }

    // ------------------------------------------------------------------
    // Apply / withdraw / attachments
    // ------------------------------------------------------------------

    /**
     * Apply to a PUBLISHED opportunity (CAR-T04): one active application
     * per candidate per opportunity — the partial unique index is the race
     * backstop, this SELECT+INSERT pair runs inside the transaction.
     */
    @Transactional
    public ApplicationResponse apply(String candidateId, ApplyRequest request,
            String idempotencyKey) {
        String opportunityId = request == null ? null : request.opportunityId();
        if (opportunityId == null || opportunityId.isBlank()) {
            throw problem(HttpStatus.BAD_REQUEST, "OPPORTUNITY_REQUIRED",
                    "opportunityId is required");
        }
        requireActiveUser(candidateId);
        Map<String, Object> claimed = claimIdempotency(candidateId, idempotencyKey,
                "apply:" + opportunityId + ":" + sha256(
                        (request.coverLetter() == null ? "" : request.coverLetter())
                                .getBytes(java.nio.charset.StandardCharsets.UTF_8)));
        if (claimed != null) {
            return replayResponse(claimed);
        }
        Map<String, Object> opportunity = staff.lockOpportunity(opportunityId);
        String status = String.valueOf(opportunity.get("status"));
        if (!"PUBLISHED".equals(status)) {
            // PAUSED/CLOSED were publicly visible — a 409 is honest there;
            // drafts/in-review/rejected postings are indistinguishable 404.
            if ("PAUSED".equals(status) || "CLOSED".equals(status)) {
                throw problem(HttpStatus.CONFLICT, "OPPORTUNITY_NOT_OPEN",
                        "This opportunity is not accepting applications");
            }
            throw problem(HttpStatus.NOT_FOUND, "OPPORTUNITY_NOT_FOUND",
                    "Opportunity not found");
        }
        // Service check gives the deterministic answer on engines without the
        // partial unique index (H2 mirror); Postgres still backstops races.
        Integer existing = jdbc.queryForObject(
                "SELECT COUNT(*) FROM " + APPLICATION
                        + " WHERE \"candidateUserId\" = :candidate"
                        + " AND \"opportunityId\" = :opp"
                        + " AND \"status\" IN ('SUBMITTED','REVIEWING','INTERVIEW','OFFER')",
                new MapSqlParameterSource()
                        .addValue("candidate", candidateId)
                        .addValue("opp", opportunityId),
                Integer.class);
        if (existing != null && existing > 0) {
            throw problem(HttpStatus.CONFLICT, "APPLICATION_ACTIVE",
                    "You already have an active application for this opportunity");
        }
        String applicationId = UUID.randomUUID().toString();
        try {
            jdbc.update(
                    "INSERT INTO " + APPLICATION
                            + " (\"id\", \"opportunityId\", \"candidateUserId\", \"coverLetter\")"
                            + " VALUES (:id, :opp, :candidate, :coverLetter)",
                    new MapSqlParameterSource()
                            .addValue("id", applicationId)
                            .addValue("opp", opportunityId)
                            .addValue("candidate", candidateId)
                            .addValue("coverLetter", request.coverLetter()));
        } catch (org.springframework.dao.DuplicateKeyException race) {
            // Concurrent apply lost to the partial unique index backstop —
            // the whole transaction rolls back (CAR-T04).
            throw problem(HttpStatus.CONFLICT, "APPLICATION_ACTIVE",
                    "You already have an active application for this opportunity");
        }
        staff.audit("APPLICATION", applicationId, candidateId, "SUBMITTED", null, "SUBMITTED",
                "opportunity=" + opportunityId);
        ApplicationResponse response = myApplication(candidateId, applicationId);
        completeIdempotency(candidateId, idempotencyKey, applicationId, response);
        return response;
    }

    /** Owner withdraw of a pre-terminal application (CAR-T07). */
    @Transactional
    public ApplicationResponse withdraw(String candidateId, String applicationId,
            Integer expectedVersion, String idempotencyKey) {
        Map<String, Object> claimed = claimIdempotency(candidateId, idempotencyKey,
                "withdraw:" + applicationId + ":" + expectedVersion);
        if (claimed != null) {
            return replayResponse(claimed);
        }
        Map<String, Object> application = lockOwned(candidateId, applicationId);
        staff.requireApplicationTerminalGuard(application);
        staff.requireVersion(application, expectedVersion);
        String current = String.valueOf(application.get("status"));
        int updated = jdbc.update(
                "UPDATE " + APPLICATION + " SET \"status\" = 'WITHDRAWN',"
                        + " \"statusChangedBy\" = :actor, \"statusChangedAt\" = CURRENT_TIMESTAMP,"
                        + " \"version\" = \"version\" + 1, \"updatedAt\" = CURRENT_TIMESTAMP"
                        + " WHERE \"id\" = :id AND \"status\" IN"
                        + " ('SUBMITTED','REVIEWING','INTERVIEW','OFFER')",
                new MapSqlParameterSource("id", applicationId).addValue("actor", candidateId));
        if (updated == 0) {
            throw problem(HttpStatus.CONFLICT, "APPLICATION_TERMINAL",
                    "The application already reached a terminal state");
        }
        staff.audit("APPLICATION", applicationId, candidateId, "WITHDRAWN", current, "WITHDRAWN", null);
        ApplicationResponse response = myApplication(candidateId, applicationId);
        completeIdempotency(candidateId, idempotencyKey, applicationId, response);
        return response;
    }

    /**
     * Owner attachment upload (CAR-X02): pre-terminal applications only,
     * Idempotency-Key required, optional declared sha256 verify — same
     * convention as the admissions lane (version bumps so a resubmission
     * decision always sees the final file set).
     */
    @Transactional
    public ApplicationResponse uploadAttachment(String candidateId, String applicationId,
            AttachmentUploadRequest request, String idempotencyKey) {
        if (request == null || request.fileName() == null || request.fileName().isBlank()) {
            throw problem(HttpStatus.BAD_REQUEST, "FILE_NAME_REQUIRED", "fileName is required");
        }
        if (request.dataBase64() == null || request.dataBase64().isBlank()) {
            throw problem(HttpStatus.BAD_REQUEST, "FILE_DATA_REQUIRED", "dataBase64 is required");
        }
        byte[] bytes;
        try {
            bytes = Base64.getDecoder().decode(request.dataBase64());
        } catch (IllegalArgumentException exception) {
            throw problem(HttpStatus.BAD_REQUEST, "FILE_DATA_INVALID",
                    "dataBase64 is not valid base64");
        }
        if (bytes.length == 0 || bytes.length > 5 * 1024 * 1024) {
            throw problem(HttpStatus.BAD_REQUEST, "ATTACHMENT_SIZE_INVALID",
                    "Attachment must be 1 byte to 5 MiB");
        }
        String checksum = sha256(bytes);
        if (request.checksum() != null && !request.checksum().isBlank()
                && !checksum.equalsIgnoreCase(request.checksum().trim())) {
            throw problem(HttpStatus.BAD_REQUEST, "FILE_CHECKSUM_MISMATCH",
                    "Uploaded content does not match the declared checksum");
        }
        Map<String, Object> claimed = claimIdempotency(candidateId, idempotencyKey,
                "attachment:" + sha256((applicationId + "|" + checksum + "|"
                        + request.fileName().trim() + "|" + (request.contentType() == null
                                ? "" : request.contentType()))
                        .getBytes(java.nio.charset.StandardCharsets.UTF_8)));
        if (claimed != null) {
            return replayResponse(claimed);
        }
        Map<String, Object> application = lockOwned(candidateId, applicationId);
        staff.requireApplicationTerminalGuard(application);
        jdbc.update(
                "INSERT INTO " + ATTACHMENT
                        + " (\"id\", \"applicationId\", \"fileName\", \"contentType\","
                        + " \"checksum\", \"data\", \"uploadedBy\")"
                        + " VALUES (:id, :app, :name, :type, :checksum, :data, :actor)",
                new MapSqlParameterSource()
                        .addValue("id", UUID.randomUUID().toString())
                        .addValue("app", applicationId)
                        .addValue("name", request.fileName().trim())
                        .addValue("type", request.contentType() == null
                                ? "application/octet-stream" : request.contentType())
                        .addValue("checksum", checksum)
                        .addValue("data", bytes)
                        .addValue("actor", candidateId));
        jdbc.update("UPDATE " + APPLICATION + " SET \"version\" = \"version\" + 1,"
                        + " \"updatedAt\" = CURRENT_TIMESTAMP WHERE \"id\" = :id",
                new MapSqlParameterSource("id", applicationId));
        staff.audit("APPLICATION", applicationId, candidateId, "ATTACHMENT_ADDED",
                null, null, "file=" + request.fileName().trim());
        ApplicationResponse response = myApplication(candidateId, applicationId);
        completeIdempotency(candidateId, idempotencyKey, applicationId, response);
        return response;
    }

    /** Owner attachment download — foreign applications are the same 404. */
    @Transactional(readOnly = true)
    public Map<String, Object> ownAttachment(String candidateId, String applicationId,
            String attachmentId) {
        ownedApplication(candidateId, applicationId);
        return staff.findAttachmentRow(applicationId, attachmentId);
    }

    // ------------------------------------------------------------------
    // Authority + helpers
    // ------------------------------------------------------------------

    /** Inactive/suspended users cannot open applications (isolation leg). */
    private void requireActiveUser(String candidateId) {
        String status;
        try {
            status = jdbc.queryForObject(
                    "SELECT \"status\" FROM " + AUTH_USER + " WHERE \"id\" = :id",
                    new MapSqlParameterSource("id", candidateId), String.class);
        } catch (EmptyResultDataAccessException exception) {
            throw problem(HttpStatus.NOT_FOUND, "USER_NOT_FOUND", "User not found");
        }
        if (!"ACTIVE".equals(status)) {
            throw problem(HttpStatus.FORBIDDEN, "USER_INACTIVE",
                    "Only active accounts can apply");
        }
    }

    private Map<String, Object> ownedApplication(String candidateId, String applicationId) {
        try {
            return jdbc.queryForMap(
                    CareerService.applicationSelect()
                            + " WHERE a.\"id\" = :id AND a.\"candidateUserId\" = :owner",
                    new MapSqlParameterSource("id", applicationId)
                            .addValue("owner", candidateId));
        } catch (EmptyResultDataAccessException exception) {
            // indistinguishable from a missing id — no cross-candidate oracle
            throw problem(HttpStatus.NOT_FOUND, "APPLICATION_NOT_FOUND",
                    "Application not found");
        }
    }

    private Map<String, Object> lockOwned(String candidateId, String applicationId) {
        try {
            return jdbc.queryForMap(
                    "SELECT \"id\", \"opportunityId\", \"candidateUserId\", \"status\", \"version\""
                            + " FROM " + APPLICATION
                            + " WHERE \"id\" = :id AND \"candidateUserId\" = :owner FOR UPDATE",
                    new MapSqlParameterSource("id", applicationId)
                            .addValue("owner", candidateId));
        } catch (EmptyResultDataAccessException exception) {
            throw problem(HttpStatus.NOT_FOUND, "APPLICATION_NOT_FOUND",
                    "Application not found");
        }
    }

    // ------------------------------------------------------------------
    // Idempotency (§1.3: per-owner key, request-hash bind, immutable replay)
    // ------------------------------------------------------------------

    private Map<String, Object> claimIdempotency(String candidateId, String key, String requestHash) {
        if (key == null || key.isBlank()) {
            throw problem(HttpStatus.BAD_REQUEST, "IDEMPOTENCY_KEY_REQUIRED",
                    "Idempotency-Key header is required");
        }
        if (key.length() > 200) {
            throw problem(HttpStatus.BAD_REQUEST, "IDEMPOTENCY_KEY_INVALID",
                    "Idempotency-Key is too long");
        }
        MapSqlParameterSource parameters = new MapSqlParameterSource("id", "idem-" + UUID.randomUUID())
                .addValue("ownerId", candidateId)
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
                new MapSqlParameterSource("ownerId", candidateId).addValue("key", key));
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

    private void completeIdempotency(String candidateId, String key, String recordId,
            ApplicationResponse response) {
        jdbc.update("UPDATE " + IDEMPOTENCY
                        + " SET \"state\" = 'COMPLETED', \"recordId\" = :recordId,"
                        + " \"responseBody\" = :responseBody, \"updatedAt\" = CURRENT_TIMESTAMP"
                        + " WHERE \"ownerId\" = :ownerId AND \"idempotencyKey\" = :key",
                new MapSqlParameterSource("recordId", recordId)
                        .addValue("responseBody", objectMapper.writeValueAsString(response))
                        .addValue("ownerId", candidateId)
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

    private static String sha256(byte[] bytes) {
        try {
            byte[] digest = java.security.MessageDigest.getInstance("SHA-256").digest(bytes);
            StringBuilder hex = new StringBuilder(digest.length * 2);
            for (byte value : digest) {
                hex.append(String.format("%02x", value));
            }
            return hex.toString();
        } catch (java.security.NoSuchAlgorithmException exception) {
            throw new IllegalStateException("SHA-256 unavailable", exception);
        }
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
