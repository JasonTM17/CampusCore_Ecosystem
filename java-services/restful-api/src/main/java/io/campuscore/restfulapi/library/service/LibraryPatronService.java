package io.campuscore.restfulapi.library.service;

import io.campuscore.restfulapi.library.web.LibraryDtos.BorrowRequest;
import io.campuscore.restfulapi.library.web.LibraryDtos.CopyResponse;
import io.campuscore.restfulapi.library.web.LibraryDtos.LoanRequestResponse;
import io.campuscore.restfulapi.library.web.LibraryDtos.TitleResponse;
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
 * P11 library circulation — patron lane (contract §8).
 *
 * <p>The borrower is the auth user itself — requests key on
 * {@code borrowerUserId = jwt.sub}. Patron isolation is indistinguishable
 * 404 on owned reads: a foreign request id returns the same
 * REQUEST_NOT_FOUND an absent id does.
 *
 * <p>Request creation claims an idempotency row first (§1.3), then locks
 * the copy {@code FOR UPDATE} and flips AVAILABLE→RESERVED conditionally;
 * the Postgres partial unique index is the race backstop, the service
 * check gives the same answer on engines without it (H2 mirror).
 */
@Service
@Profile("persistence")
public class LibraryPatronService {

    private static final String COPY = LibraryService.COPY;
    private static final String LOAN_REQUEST = LibraryService.LOAN_REQUEST;
    private static final String TITLE = LibraryService.TITLE;
    private static final String IDEMPOTENCY = LibraryService.IDEMPOTENCY;
    private static final String AUTH_USER = LibraryService.AUTH_USER;

    private final NamedParameterJdbcTemplate jdbc;
    private final LibraryService staff;
    private final tools.jackson.databind.ObjectMapper objectMapper;
    private final boolean postgres;

    public LibraryPatronService(NamedParameterJdbcTemplate jdbc, LibraryService staff,
            tools.jackson.databind.ObjectMapper objectMapper) {
        this.jdbc = jdbc;
        this.staff = staff;
        this.objectMapper = objectMapper;
        this.postgres = jdbc.getJdbcOperations().execute(
                (org.springframework.jdbc.core.ConnectionCallback<Boolean>) connection ->
                        "PostgreSQL".equalsIgnoreCase(connection.getMetaData().getDatabaseProductName()));
    }

    // ------------------------------------------------------------------
    // Catalogue reads (any authenticated user; availability is server truth)
    // ------------------------------------------------------------------

    /** Titles with live availability — the expiry sweep runs first so a stale hold never shows as taken. */
    @Transactional
    public List<TitleResponse> catalogue(String borrowerId, String query) {
        staff.expireOverdue(borrowerId);
        StringBuilder sql = new StringBuilder(
                "SELECT \"id\", \"title\", \"author\", \"isbn\", \"category\", \"publisher\","
                        + " \"publishedYear\", \"description\", \"version\" FROM " + TITLE);
        MapSqlParameterSource params = new MapSqlParameterSource();
        if (query != null && !query.isBlank()) {
            sql.append(" WHERE LOWER(\"title\") LIKE :q OR LOWER(\"author\") LIKE :q"
                    + " OR LOWER(\"isbn\") LIKE :q OR LOWER(\"category\") LIKE :q");
            params.addValue("q", "%" + query.trim().toLowerCase() + "%");
        }
        sql.append(" ORDER BY \"title\"");
        List<Map<String, Object>> rows = jdbc.query(sql.toString(), params,
                (row, index) -> rowToMap(row));
        return rows.stream()
                .map(row -> staff.mapTitle(row, copiesOfTitle(String.valueOf(row.get("id")))))
                .toList();
    }

    @Transactional
    public TitleResponse title(String borrowerId, String titleId) {
        staff.expireOverdue(borrowerId);
        return staff.findTitle(titleId);
    }

    /** Own requests/loans newest-first — foreign ids never appear here. */
    @Transactional
    public List<LoanRequestResponse> myLoans(String borrowerId) {
        staff.expireOverdue(borrowerId);
        List<Map<String, Object>> rows = jdbc.query(
                LibraryService.requestSelect() + " WHERE r.\"borrowerUserId\" = :owner"
                        + " ORDER BY r.\"createdAt\" DESC",
                new MapSqlParameterSource("owner", borrowerId),
                (row, index) -> rowToMap(row));
        return rows.stream().map(staff::mapRequest).toList();
    }

    /** Owner-only detail — a foreign id is indistinguishable 404. */
    @Transactional
    public LoanRequestResponse myLoan(String borrowerId, String requestId) {
        staff.expireOverdue(borrowerId);
        return staff.mapRequest(ownedRequest(borrowerId, requestId));
    }

    // ------------------------------------------------------------------
    // Request lifecycle
    // ------------------------------------------------------------------

    /**
     * Create a hold: copy AVAILABLE→RESERVED + request REQUESTED with a
     * server-clock expiry. One active request per copy (unique index +
     * conditional flip) and per borrower-per-copy (second index).
     */
    @Transactional
    public LoanRequestResponse request(String borrowerId, BorrowRequest request,
            String idempotencyKey) {
        String copyId = request == null ? null : request.copyId();
        if (copyId == null || copyId.isBlank()) {
            throw problem(HttpStatus.BAD_REQUEST, "COPY_REQUIRED", "copyId is required");
        }
        requireActiveUser(borrowerId);
        Map<String, Object> claimed = claimIdempotency(borrowerId, idempotencyKey,
                "request:" + copyId);
        if (claimed != null) {
            return replayResponse(claimed);
        }
        // Sweep before the copy lock: a dead hold on this copy frees the
        // stock here instead of blocking requests until a read happens by.
        staff.expireOverdue(borrowerId);
        Map<String, Object> copy = staff.lockCopy(copyId);
        String copyStatus = String.valueOf(copy.get("status"));
        if ("RETIRED".equals(copyStatus)) {
            throw problem(HttpStatus.CONFLICT, "COPY_TERMINAL",
                    "This copy is retired and cannot be requested");
        }
        int flipped = jdbc.update(
                "UPDATE " + COPY + " SET \"status\" = 'RESERVED',"
                        + " \"version\" = \"version\" + 1, \"updatedAt\" = CURRENT_TIMESTAMP"
                        + " WHERE \"id\" = :id AND \"status\" = 'AVAILABLE'",
                new MapSqlParameterSource("id", copyId));
        if (flipped == 0) {
            throw problem(HttpStatus.CONFLICT, "COPY_UNAVAILABLE",
                    "This copy is not available for request");
        }
        String requestId = UUID.randomUUID().toString();
        java.sql.Timestamp expiresAt = java.sql.Timestamp.from(
                java.time.Instant.now().plus(staff.reservationTtlHours(),
                        java.time.temporal.ChronoUnit.HOURS));
        try {
            jdbc.update(
                    "INSERT INTO " + LOAN_REQUEST
                            + " (\"id\", \"copyId\", \"borrowerUserId\", \"status\", \"expiresAt\")"
                            + " VALUES (:id, :copyId, :borrower, 'REQUESTED', :expiresAt)",
                    new MapSqlParameterSource("id", requestId)
                            .addValue("copyId", copyId)
                            .addValue("borrower", borrowerId)
                            .addValue("expiresAt", expiresAt));
        } catch (org.springframework.dao.DuplicateKeyException race) {
            // Concurrent request lost to the partial unique index backstop
            // (another active request on this copy, or this borrower already
            // holds an active request on it). The whole transaction rolls
            // back — including the RESERVED flip — so no copy cleanup here.
            throw problem(HttpStatus.CONFLICT, "COPY_UNAVAILABLE",
                    "This copy already has an active request");
        }
        staff.audit("REQUEST", requestId, borrowerId, "REQUESTED", null, "REQUESTED",
                "copy=" + copyId);
        staff.audit("COPY", copyId, borrowerId, "RESERVED", "AVAILABLE", "RESERVED",
                "request=" + requestId);
        LoanRequestResponse response = staff.mapRequest(staff.findRequestRow(requestId));
        completeIdempotency(borrowerId, idempotencyKey, requestId, response);
        return response;
    }

    /** Owner cancel of a pre-issue hold (LIB-T05); frees the copy. */
    @Transactional
    public LoanRequestResponse cancel(String borrowerId, String requestId,
            Integer expectedVersion, String reason, String idempotencyKey) {
        // Canonicalize once before hashing: an omitted reason and the explicit
        // default hash alike; a changed reason — or a key claimed before the
        // reason bound the fingerprint — conflicts instead of replaying.
        String normalizedReason = reason == null || reason.isBlank()
                ? "BORROWER_CANCELLED" : reason;
        Map<String, Object> claimed = claimIdempotency(borrowerId, idempotencyKey,
                "cancel:" + requestId + ":" + expectedVersion + ":" + normalizedReason);
        if (claimed != null) {
            return replayResponse(claimed);
        }
        Map<String, Object> loan = lockOwned(borrowerId, requestId);
        staff.requireTerminalGuard(loan);
        staff.requireVersion(loan, expectedVersion);
        String status = String.valueOf(loan.get("status"));
        if (!"REQUESTED".equals(status) && !"APPROVED".equals(status)) {
            throw problem(HttpStatus.CONFLICT, "REQUEST_STATE_INVALID",
                    "An issued loan cannot be cancelled — it must be returned at the desk");
        }
        int updated = jdbc.update(
                "UPDATE " + LOAN_REQUEST + " SET \"status\" = 'CANCELLED',"
                        + " \"cancelledBy\" = :actor, \"cancelledAt\" = CURRENT_TIMESTAMP,"
                        + " \"cancelReason\" = :reason,"
                        + " \"version\" = \"version\" + 1, \"updatedAt\" = CURRENT_TIMESTAMP"
                        + " WHERE \"id\" = :id AND \"status\" IN ('REQUESTED','APPROVED')",
                new MapSqlParameterSource("id", requestId)
                        .addValue("actor", borrowerId)
                        .addValue("reason", normalizedReason));
        if (updated == 0) {
            throw problem(HttpStatus.CONFLICT, "REQUEST_STATE_INVALID",
                    "An issued loan cannot be cancelled — it must be returned at the desk");
        }
        staff.audit("REQUEST", requestId, borrowerId, "CANCELLED", status, "CANCELLED",
                normalizedReason);
        freeCopyIfUnheld(String.valueOf(loan.get("copyId")));
        LoanRequestResponse response = myLoan(borrowerId, requestId);
        completeIdempotency(borrowerId, idempotencyKey, requestId, response);
        return response;
    }

    // ------------------------------------------------------------------
    // Authority + helpers
    // ------------------------------------------------------------------

    /** Inactive/suspended users cannot open new holds ("inactive user" leg). */
    private void requireActiveUser(String borrowerId) {
        String status;
        try {
            status = jdbc.queryForObject(
                    "SELECT \"status\" FROM " + AUTH_USER + " WHERE \"id\" = :id",
                    new MapSqlParameterSource("id", borrowerId), String.class);
        } catch (EmptyResultDataAccessException exception) {
            throw problem(HttpStatus.NOT_FOUND, "USER_NOT_FOUND", "User not found");
        }
        if (!"ACTIVE".equals(status)) {
            throw problem(HttpStatus.FORBIDDEN, "USER_INACTIVE",
                    "Only active accounts can request library items");
        }
    }

    private Map<String, Object> ownedRequest(String borrowerId, String requestId) {
        try {
            return jdbc.queryForMap(
                    LibraryService.requestSelect()
                            + " WHERE r.\"id\" = :id AND r.\"borrowerUserId\" = :owner",
                    new MapSqlParameterSource("id", requestId)
                            .addValue("owner", borrowerId));
        } catch (EmptyResultDataAccessException exception) {
            // indistinguishable from a missing id — no cross-patron oracle
            throw problem(HttpStatus.NOT_FOUND, "REQUEST_NOT_FOUND", "Loan request not found");
        }
    }

    private Map<String, Object> lockOwned(String borrowerId, String requestId) {
        try {
            return jdbc.queryForMap(
                    "SELECT \"id\", \"copyId\", \"borrowerUserId\", \"status\", \"expiresAt\","
                            + " \"version\", \"dueAt\" FROM " + LOAN_REQUEST
                            + " WHERE \"id\" = :id AND \"borrowerUserId\" = :owner FOR UPDATE",
                    new MapSqlParameterSource("id", requestId)
                            .addValue("owner", borrowerId));
        } catch (EmptyResultDataAccessException exception) {
            throw problem(HttpStatus.NOT_FOUND, "REQUEST_NOT_FOUND", "Loan request not found");
        }
    }

    private List<CopyResponse> copiesOfTitle(String titleId) {
        return jdbc.query(
                "SELECT \"id\", \"titleId\", \"barcode\", \"status\", \"version\""
                        + " FROM " + COPY + " WHERE \"titleId\" = :id ORDER BY \"barcode\"",
                new MapSqlParameterSource("id", titleId),
                (row, index) -> new CopyResponse(
                        row.getString("id"),
                        row.getString("titleId"),
                        row.getString("barcode"),
                        row.getString("status"),
                        row.getInt("version")));
    }

    private void freeCopyIfUnheld(String copyId) {
        jdbc.update(
                "UPDATE " + COPY + " SET \"status\" = 'AVAILABLE',"
                        + " \"version\" = \"version\" + 1, \"updatedAt\" = CURRENT_TIMESTAMP"
                        + " WHERE \"id\" = :id AND \"status\" IN ('RESERVED','ON_LOAN')"
                        + " AND NOT EXISTS (SELECT 1 FROM " + LOAN_REQUEST + " r"
                        + " WHERE r.\"copyId\" = :id"
                        + " AND r.\"status\" IN ('REQUESTED','APPROVED','ISSUED'))",
                new MapSqlParameterSource("id", copyId));
    }

    // ------------------------------------------------------------------
    // Idempotency (§1.3: per-owner key, request-hash bind, immutable replay)
    // ------------------------------------------------------------------

    private Map<String, Object> claimIdempotency(String borrowerId, String key, String requestHash) {
        if (key == null || key.isBlank()) {
            throw problem(HttpStatus.BAD_REQUEST, "IDEMPOTENCY_KEY_REQUIRED",
                    "Idempotency-Key header is required");
        }
        if (key.length() > 200) {
            throw problem(HttpStatus.BAD_REQUEST, "IDEMPOTENCY_KEY_INVALID",
                    "Idempotency-Key is too long");
        }
        MapSqlParameterSource parameters = new MapSqlParameterSource("id", "idem-" + UUID.randomUUID())
                .addValue("ownerId", borrowerId)
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
                new MapSqlParameterSource("ownerId", borrowerId).addValue("key", key));
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

    private void completeIdempotency(String borrowerId, String key, String recordId,
            LoanRequestResponse response) {
        jdbc.update("UPDATE " + IDEMPOTENCY
                        + " SET \"state\" = 'COMPLETED', \"recordId\" = :recordId,"
                        + " \"responseBody\" = :responseBody, \"updatedAt\" = CURRENT_TIMESTAMP"
                        + " WHERE \"ownerId\" = :ownerId AND \"idempotencyKey\" = :key",
                new MapSqlParameterSource("recordId", recordId)
                        .addValue("responseBody", objectMapper.writeValueAsString(response))
                        .addValue("ownerId", borrowerId)
                        .addValue("key", key));
    }

    private LoanRequestResponse replayResponse(Map<String, Object> row) {
        Object body = row.get("response_body");
        if (!(body instanceof String json) || json.isBlank()) {
            throw problem(HttpStatus.CONFLICT, "IDEMPOTENCY_RESPONSE_UNAVAILABLE",
                    "The original response is unavailable; refresh the current request state");
        }
        return objectMapper.readValue(json, LoanRequestResponse.class);
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
