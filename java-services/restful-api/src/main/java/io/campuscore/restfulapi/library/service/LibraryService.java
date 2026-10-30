package io.campuscore.restfulapi.library.service;

import io.campuscore.restfulapi.library.web.LibraryDtos.CopyResponse;
import io.campuscore.restfulapi.library.web.LibraryDtos.CreateCopyRequest;
import io.campuscore.restfulapi.library.web.LibraryDtos.CreateTitleRequest;
import io.campuscore.restfulapi.library.web.LibraryDtos.IssueRequest;
import io.campuscore.restfulapi.library.web.LibraryDtos.LoanRequestResponse;
import io.campuscore.restfulapi.library.web.LibraryDtos.StaffGrantResponse;
import io.campuscore.restfulapi.library.web.LibraryDtos.TitleResponse;
import io.campuscore.restfulapi.notification.repository.NotificationWriteRepository;
import io.campuscore.restfulapi.notification.repository.NotificationWriteRepository.CreateNotificationCommand;
import io.campuscore.restfulapi.web.DomainException;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Profile;
import org.springframework.dao.EmptyResultDataAccessException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * P11 library circulation — staff lane + shared helpers (contract §8).
 *
 * <p>Authority is the scoped {@code library."StaffGrant"} row — the ADMIN
 * role grants but does not confer domain rights (§1.1). Every lifecycle
 * transition locks the request row {@code FOR UPDATE} before touching its
 * copy so approve/issue/return serialize, and the storage layer carries a
 * partial unique index on active requests per copy (LIB-X02 backstop) so
 * two patrons racing one copy can never both win.
 *
 * <p>Reservation expiry is a server-clock rule: bounded staff maintenance
 * and copy-scoped replacement requests materialize cancellation and release
 * in one transaction. Patron reads expose persisted state and the deadline;
 * approve and issue reject expired holds even before cleanup commits.
 *
 * <p>Stock is derived from copy status, never a counter: RETURN flips
 * ISSUED→RETURNED and ON_LOAN→AVAILABLE in one transaction, so a replayed
 * return hits the state guard instead of inflating availability (LIB-T04).
 * Copies retire soft — loan history survives (LIB-T06).
 */
@Service
@Profile("persistence")
public class LibraryService {

    static final String TITLE = "library.\"Title\"";
    static final String COPY = "library.\"Copy\"";
    static final String LOAN_REQUEST = "library.\"LoanRequest\"";
    static final String AUDIT = "library.\"Audit\"";
    static final String STAFF_GRANT = "library.\"StaffGrant\"";
    static final String IDEMPOTENCY = "library.\"Idempotency\"";
    static final String AUTH_USER = "campuscore_auth.\"User\"";
    static final String SCOPE = "library";

    /** Request statuses that still occupy a copy reservation. */
    static final List<String> ACTIVE_REQUEST_STATUSES = List.of("REQUESTED", "APPROVED", "ISSUED");
    /** Terminal request statuses — immutable once reached. */
    static final List<String> TERMINAL_REQUEST_STATUSES = List.of("RETURNED", "CANCELLED");
    /** Reservation holds that the server-clock expiry sweep can end. */
    static final List<String> EXPIRABLE_STATUSES = List.of("REQUESTED", "APPROVED");

    private final NamedParameterJdbcTemplate jdbc;
    private final NotificationWriteRepository notifications;
    private final long reservationTtlHours;
    private final int loanDays;
    private final boolean postgres;

    public LibraryService(NamedParameterJdbcTemplate jdbc,
            NotificationWriteRepository notifications,
            @Value("${campuscore.library.reservation-ttl-hours:48}") long reservationTtlHours,
            @Value("${campuscore.library.loan-days:14}") int loanDays) {
        this.jdbc = jdbc;
        this.notifications = notifications;
        this.reservationTtlHours = reservationTtlHours;
        this.loanDays = loanDays;
        this.postgres = jdbc.getJdbcOperations().execute((org.springframework.jdbc.core.ConnectionCallback<Boolean>) connection ->
                "PostgreSQL".equalsIgnoreCase(connection.getMetaData().getDatabaseProductName()));
    }

    long reservationTtlHours() {
        return reservationTtlHours;
    }

    // ------------------------------------------------------------------
    // Authority
    // ------------------------------------------------------------------

    /** STAFF:library — the grant row is the sole domain authority. */
    void requireStaffGrant(String actorId) {
        if (!hasStaffGrant(actorId)) {
            throw problem(HttpStatus.FORBIDDEN, "LIBRARY_STAFF_REQUIRED",
                    "A library staff grant is required for this operation");
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
            throw problem(HttpStatus.FORBIDDEN, "LIBRARY_ADMIN_REQUIRED",
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
            throw problem(HttpStatus.BAD_REQUEST, "LIBRARY_USER_REQUIRED", "userId is required");
        }
        try {
            jdbc.queryForObject(
                    "SELECT \"id\" FROM " + AUTH_USER + " WHERE \"id\" = :id",
                    new MapSqlParameterSource("id", userId), String.class);
        } catch (EmptyResultDataAccessException exception) {
            throw problem(HttpStatus.NOT_FOUND, "LIBRARY_USER_NOT_FOUND", "Grant target user not found");
        }
        String grantId = UUID.randomUUID().toString();
        // Two admins can grant the same target concurrently. ON CONFLICT
        // DO NOTHING keeps the loser's transaction valid on PostgreSQL,
        // where a plain unique violation would abort it and poison the
        // re-read below.
        String insert = "INSERT INTO " + STAFF_GRANT
                + " (\"id\", \"userId\", \"scope\", \"grantedBy\")"
                + " VALUES (:id, :userId, :scope, :grantedBy)"
                + (postgres ? " ON CONFLICT (\"userId\", \"scope\") DO NOTHING" : "");
        int inserted;
        try {
            inserted = jdbc.update(insert,
                    new MapSqlParameterSource()
                            .addValue("id", grantId)
                            .addValue("userId", userId)
                            .addValue("scope", SCOPE)
                            .addValue("grantedBy", actorId));
        } catch (org.springframework.dao.DuplicateKeyException duplicate) {
            // Only the non-PostgreSQL mirror raises here; the re-read below
            // returns the row the racing request created.
            inserted = 0;
        }
        if (inserted > 0) {
            audit("GRANT", grantId, actorId, "STAFF_GRANTED", null, null,
                    "scope=" + SCOPE + " user=" + userId);
        }
        return jdbc.queryForObject(
                "SELECT \"id\", \"userId\", \"scope\", \"grantedBy\", \"createdAt\" FROM " + STAFF_GRANT
                        + " WHERE \"userId\" = :userId AND \"scope\" = :scope",
                new MapSqlParameterSource("userId", userId).addValue("scope", SCOPE),
                (row, index) -> mapGrant(row));
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
            throw problem(HttpStatus.NOT_FOUND, "LIBRARY_GRANT_NOT_FOUND", "Grant not found");
        }
        audit("GRANT", grantId, actorId, "STAFF_REVOKED", null, null,
                "scope=" + SCOPE + " user=" + revokedUserId);
    }

    // ------------------------------------------------------------------
    // Inventory (staff-only writes; copies retire soft, history survives)
    // ------------------------------------------------------------------

    @Transactional
    public TitleResponse createTitle(String actorId, CreateTitleRequest request) {
        requireStaffGrant(actorId);
        if (request == null || request.title() == null || request.title().isBlank()) {
            throw problem(HttpStatus.BAD_REQUEST, "TITLE_REQUIRED", "title is required");
        }
        String id = UUID.randomUUID().toString();
        jdbc.update(
                "INSERT INTO " + TITLE
                        + " (\"id\", \"title\", \"author\", \"isbn\", \"category\", \"publisher\","
                        + " \"publishedYear\", \"description\")"
                        + " VALUES (:id, :title, :author, :isbn, :category, :publisher, :year, :description)",
                new MapSqlParameterSource()
                        .addValue("id", id)
                        .addValue("title", request.title().trim())
                        .addValue("author", request.author())
                        .addValue("isbn", request.isbn())
                        .addValue("category", request.category())
                        .addValue("publisher", request.publisher())
                        .addValue("year", request.publishedYear())
                        .addValue("description", request.description()));
        audit("TITLE", id, actorId, "TITLE_CREATED", null, null, request.title().trim());
        return titleDetail(actorId, id);
    }

    @Transactional
    public CopyResponse createCopy(String actorId, CreateCopyRequest request) {
        requireStaffGrant(actorId);
        if (request == null || request.titleId() == null || request.titleId().isBlank()) {
            throw problem(HttpStatus.BAD_REQUEST, "TITLE_REQUIRED", "titleId is required");
        }
        if (request.barcode() == null || request.barcode().isBlank()) {
            throw problem(HttpStatus.BAD_REQUEST, "BARCODE_REQUIRED", "barcode is required");
        }
        try {
            jdbc.queryForObject(
                    "SELECT \"id\" FROM " + TITLE + " WHERE \"id\" = :id",
                    new MapSqlParameterSource("id", request.titleId()), String.class);
        } catch (EmptyResultDataAccessException exception) {
            throw problem(HttpStatus.NOT_FOUND, "TITLE_NOT_FOUND", "Title not found");
        }
        String id = UUID.randomUUID().toString();
        try {
            jdbc.update(
                    "INSERT INTO " + COPY
                            + " (\"id\", \"titleId\", \"barcode\", \"status\")"
                            + " VALUES (:id, :titleId, :barcode, 'AVAILABLE')",
                    new MapSqlParameterSource()
                            .addValue("id", id)
                            .addValue("titleId", request.titleId())
                            .addValue("barcode", request.barcode().trim()));
        } catch (org.springframework.dao.DuplicateKeyException duplicate) {
            throw problem(HttpStatus.CONFLICT, "BARCODE_TAKEN",
                    "A copy with this barcode already exists");
        }
        audit("COPY", id, actorId, "COPY_CREATED", null, "AVAILABLE", request.barcode().trim());
        return copyOf(id);
    }

    /** Copy → RETIRED; refused while an active request/loan occupies it. */
    @Transactional
    public CopyResponse retireCopy(String actorId, String copyId, Integer expectedVersion) {
        requireStaffGrant(actorId);
        Map<String, Object> copy = lockCopy(copyId);
        requireCopyVersion(copy, expectedVersion);
        String status = String.valueOf(copy.get("status"));
        if ("RETIRED".equals(status)) {
            throw problem(HttpStatus.CONFLICT, "COPY_TERMINAL",
                    "Copy is already retired");
        }
        Integer active = jdbc.queryForObject(
                "SELECT COUNT(*) FROM " + LOAN_REQUEST
                        + " WHERE \"copyId\" = :copyId AND \"status\" IN ('REQUESTED','APPROVED','ISSUED')",
                new MapSqlParameterSource("copyId", copyId), Integer.class);
        if (active != null && active > 0) {
            throw problem(HttpStatus.CONFLICT, "COPY_HAS_ACTIVE_LOAN",
                    "Copy cannot retire while a request or loan is active");
        }
        jdbc.update(
                "UPDATE " + COPY + " SET \"status\" = 'RETIRED',"
                        + " \"version\" = \"version\" + 1, \"updatedAt\" = CURRENT_TIMESTAMP"
                        + " WHERE \"id\" = :id",
                new MapSqlParameterSource("id", copyId));
        audit("COPY", copyId, actorId, "COPY_RETIRED", status, "RETIRED", null);
        return copyOf(copyId);
    }

    // ------------------------------------------------------------------
    // Expiry sweep (LIB-X01: the server clock is the only authority)
    // ------------------------------------------------------------------

    /** Process one bounded batch under staff authority; notification failure rolls it back. */
    @Transactional
    public int expireOverdue(String actorId) {
        requireStaffGrant(actorId);
        return expireHolds(actorId, null);
    }

    /** Called only inside the patron mutation transaction, before locking the copy. */
    void expireForCopy(String copyId) {
        expireHolds("system", copyId);
    }

    private int expireHolds(String actorId, String copyId) {
        List<Map<String, Object>> expired = jdbc.queryForList(
                "SELECT \"id\", \"copyId\", \"borrowerUserId\", \"status\" FROM " + LOAN_REQUEST
                        + " WHERE \"status\" IN ('REQUESTED','APPROVED')"
                        + " AND \"expiresAt\" IS NOT NULL AND \"expiresAt\" < CURRENT_TIMESTAMP"
                        + (copyId == null ? "" : " AND \"copyId\" = :copyId")
                        + " ORDER BY \"expiresAt\", \"id\" LIMIT :batchSize FOR UPDATE"
                        + (postgres ? " SKIP LOCKED" : ""),
                new MapSqlParameterSource("copyId", copyId)
                        .addValue("batchSize", copyId == null ? 100 : 1));
        int completed = 0;
        for (Map<String, Object> request : expired) {
            String requestId = String.valueOf(request.get("id"));
            int updated = jdbc.update(
                    "UPDATE " + LOAN_REQUEST + " SET \"status\" = 'CANCELLED',"
                            + " \"cancelledBy\" = :actor, \"cancelledAt\" = CURRENT_TIMESTAMP,"
                            + " \"cancelReason\" = 'RESERVATION_EXPIRED',"
                            + " \"version\" = \"version\" + 1, \"updatedAt\" = CURRENT_TIMESTAMP"
                            + " WHERE \"id\" = :id AND \"status\" IN ('REQUESTED','APPROVED')"
                            + " AND \"expiresAt\" < CURRENT_TIMESTAMP",
                    new MapSqlParameterSource("id", requestId).addValue("actor", actorId));
            if (updated == 0) {
                continue;
            }
            completed++;
            audit("REQUEST", requestId, actorId, "EXPIRED", String.valueOf(request.get("status")),
                    "CANCELLED", "server-clock sweep");
            freeCopyIfUnheld(String.valueOf(request.get("copyId")));
            notifications.create(new CreateNotificationCommand(
                    UUID.randomUUID().toString(),
                    String.valueOf(request.get("borrowerUserId")),
                    "Giữ chỗ sách hết hạn",
                    "Đơn giữ chỗ " + requestId + " đã hết hạn theo giờ máy chủ.",
                    "INFO", "/library", Instant.now()));
        }
        return completed;
    }

    /** Free a copy iff no active request still holds it (unique-index safe). */
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
    // Staff request lane
    // ------------------------------------------------------------------

    /** Request queue — materializes at most one expiry batch before reading persisted state. */
    @Transactional
    public List<LoanRequestResponse> queue(String actorId, String status) {
        requireStaffGrant(actorId);
        expireOverdue(actorId);
        MapSqlParameterSource params = new MapSqlParameterSource();
        StringBuilder sql = new StringBuilder(requestSelect());
        if (status != null && !status.isBlank()) {
            sql.append(" WHERE r.\"status\" = :status");
            params.addValue("status", status);
        }
        sql.append(" ORDER BY r.\"requestedAt\" NULLS LAST, r.\"createdAt\"");
        return jdbc.query(sql.toString(), params, (row, index) -> mapRequest(row));
    }

    public LoanRequestResponse staffRequest(String actorId, String requestId) {
        requireStaffGrant(actorId);
        return mapRequest(findRequestRow(requestId));
    }

    /** Staff view of a title incl. copies — same projection patrons get. */
    public TitleResponse titleDetail(String actorId, String titleId) {
        requireStaffGrant(actorId);
        return findTitle(titleId);
    }

    /** REQUESTED → APPROVED; the hold must still be inside its server-clock window. */
    @Transactional
    public LoanRequestResponse approve(String actorId, String requestId, Integer expectedVersion) {
        requireStaffGrant(actorId);
        Map<String, Object> request = lockRequest(requestId);
        requireTerminalGuard(request);
        requireVersion(request, expectedVersion);
        if (!"REQUESTED".equals(String.valueOf(request.get("status")))) {
            throw problem(HttpStatus.CONFLICT, "REQUEST_STATE_INVALID",
                    "Only a requested hold can be approved");
        }
        requireWithinHoldWindow(request);
        int updated = jdbc.update(
                "UPDATE " + LOAN_REQUEST + " SET \"status\" = 'APPROVED',"
                        + " \"approvedBy\" = :actor, \"approvedAt\" = CURRENT_TIMESTAMP,"
                        + " \"version\" = \"version\" + 1, \"updatedAt\" = CURRENT_TIMESTAMP"
                        + " WHERE \"id\" = :id AND \"status\" = 'REQUESTED'",
                new MapSqlParameterSource("id", requestId).addValue("actor", actorId));
        if (updated == 0) {
            throw problem(HttpStatus.CONFLICT, "REQUEST_STATE_INVALID",
                    "Only a requested hold can be approved");
        }
        audit("REQUEST", requestId, actorId, "APPROVED", "REQUESTED", "APPROVED", null);
        notifyBorrower(request,
                "Đơn mượn sách được duyệt",
                "Đơn mượn " + requestId + " đã được duyệt — đến quầy để nhận sách.",
                "INFO");
        return staffRequest(actorId, requestId);
    }

    /**
     * APPROVED → ISSUED under the copy row lock: the conditional copy flip
     * (RESERVED→ON_LOAN) plus the partial unique index mean one copy can
     * never be issued to two requests (LIB-T03/LIB-X02).
     */
    @Transactional
    public LoanRequestResponse issue(String actorId, String requestId, IssueRequest request) {
        requireStaffGrant(actorId);
        Map<String, Object> loan = lockRequest(requestId);
        requireTerminalGuard(loan);
        requireVersion(loan, request == null ? null : request.expectedVersion());
        if (!"APPROVED".equals(String.valueOf(loan.get("status")))) {
            throw problem(HttpStatus.CONFLICT, "REQUEST_STATE_INVALID",
                    "Only an approved request can be issued");
        }
        // Same server-clock window rule as approve: an expired-but-unswept
        // hold can never be issued, no matter when the last read swept.
        requireWithinHoldWindow(loan);
        String copyId = String.valueOf(loan.get("copyId"));
        lockCopy(copyId);
        // Waiting for the copy lock can consume the remaining hold window.
        requireWithinHoldWindow(loan);
        int copyFlipped = jdbc.update(
                "UPDATE " + COPY + " SET \"status\" = 'ON_LOAN',"
                        + " \"version\" = \"version\" + 1, \"updatedAt\" = CURRENT_TIMESTAMP"
                        + " WHERE \"id\" = :id AND \"status\" = 'RESERVED'",
                new MapSqlParameterSource("id", copyId));
        if (copyFlipped == 0) {
            throw problem(HttpStatus.CONFLICT, "COPY_STATE_INVALID",
                    "The reserved copy is no longer available for issue");
        }
        int days = request != null && request.dueDays() != null && request.dueDays() > 0
                ? request.dueDays() : loanDays;
        Instant dueAt = Instant.now().plus(days, ChronoUnit.DAYS);
        int updated = jdbc.update(
                "UPDATE " + LOAN_REQUEST + " SET \"status\" = 'ISSUED',"
                        + " \"issuedBy\" = :actor, \"issuedAt\" = CURRENT_TIMESTAMP,"
                        + " \"dueAt\" = :dueAt, \"expiresAt\" = NULL,"
                        + " \"version\" = \"version\" + 1, \"updatedAt\" = CURRENT_TIMESTAMP"
                        + " WHERE \"id\" = :id AND \"status\" = 'APPROVED'",
                new MapSqlParameterSource("id", requestId)
                        .addValue("actor", actorId)
                        .addValue("dueAt", java.sql.Timestamp.from(dueAt)));
        if (updated == 0) {
            throw problem(HttpStatus.CONFLICT, "REQUEST_STATE_INVALID",
                    "Only an approved request can be issued");
        }
        audit("REQUEST", requestId, actorId, "ISSUED", "APPROVED", "ISSUED",
                "dueDays=" + days);
        audit("COPY", copyId, actorId, "ON_LOAN", "RESERVED", "ON_LOAN", "request=" + requestId);
        notifyBorrower(loan,
                "Sách đã được mượn",
                "Đơn mượn " + requestId + " đã nhận sách — hạn trả sau " + days + " ngày.",
                "SUCCESS");
        return staffRequest(actorId, requestId);
    }

    /** ISSUED → RETURNED; copy returns to AVAILABLE in the same transaction. */
    @Transactional
    public LoanRequestResponse returnLoan(String actorId, String requestId, Integer expectedVersion) {
        requireStaffGrant(actorId);
        Map<String, Object> loan = lockRequest(requestId);
        requireTerminalGuard(loan);
        requireVersion(loan, expectedVersion);
        if (!"ISSUED".equals(String.valueOf(loan.get("status")))) {
            throw problem(HttpStatus.CONFLICT, "REQUEST_STATE_INVALID",
                    "Only an issued loan can be returned");
        }
        String copyId = String.valueOf(loan.get("copyId"));
        lockCopy(copyId);
        int updated = jdbc.update(
                "UPDATE " + LOAN_REQUEST + " SET \"status\" = 'RETURNED',"
                        + " \"returnedBy\" = :actor, \"returnedAt\" = CURRENT_TIMESTAMP,"
                        + " \"version\" = \"version\" + 1, \"updatedAt\" = CURRENT_TIMESTAMP"
                        + " WHERE \"id\" = :id AND \"status\" = 'ISSUED'",
                new MapSqlParameterSource("id", requestId).addValue("actor", actorId));
        if (updated == 0) {
            throw problem(HttpStatus.CONFLICT, "REQUEST_STATE_INVALID",
                    "Only an issued loan can be returned");
        }
        jdbc.update(
                "UPDATE " + COPY + " SET \"status\" = 'AVAILABLE',"
                        + " \"version\" = \"version\" + 1, \"updatedAt\" = CURRENT_TIMESTAMP"
                        + " WHERE \"id\" = :id AND \"status\" = 'ON_LOAN'",
                new MapSqlParameterSource("id", copyId));
        audit("REQUEST", requestId, actorId, "RETURNED", "ISSUED", "RETURNED", null);
        audit("COPY", copyId, actorId, "AVAILABLE", "ON_LOAN", "AVAILABLE", "request=" + requestId);
        notifyBorrower(loan,
                "Đã trả sách",
                "Đơn mượn " + requestId + " đã được ghi nhận trả.",
                "SUCCESS");
        return staffRequest(actorId, requestId);
    }

    /** Staff cancel of a pre-issue hold (LIB-T05); frees the copy. */
    @Transactional
    public LoanRequestResponse cancelStaff(String actorId, String requestId,
            Integer expectedVersion, String reason) {
        requireStaffGrant(actorId);
        Map<String, Object> loan = lockRequest(requestId);
        requireTerminalGuard(loan);
        requireVersion(loan, expectedVersion);
        String status = String.valueOf(loan.get("status"));
        if (!"REQUESTED".equals(status) && !"APPROVED".equals(status)) {
            throw problem(HttpStatus.CONFLICT, "REQUEST_STATE_INVALID",
                    "An issued loan cannot be cancelled — it must be returned");
        }
        int updated = jdbc.update(
                "UPDATE " + LOAN_REQUEST + " SET \"status\" = 'CANCELLED',"
                        + " \"cancelledBy\" = :actor, \"cancelledAt\" = CURRENT_TIMESTAMP,"
                        + " \"cancelReason\" = :reason,"
                        + " \"version\" = \"version\" + 1, \"updatedAt\" = CURRENT_TIMESTAMP"
                        + " WHERE \"id\" = :id AND \"status\" IN ('REQUESTED','APPROVED')",
                new MapSqlParameterSource("id", requestId)
                        .addValue("actor", actorId)
                        .addValue("reason", reason == null || reason.isBlank()
                                ? "STAFF_CANCELLED" : reason));
        if (updated == 0) {
            throw problem(HttpStatus.CONFLICT, "REQUEST_STATE_INVALID",
                    "An issued loan cannot be cancelled — it must be returned");
        }
        audit("REQUEST", requestId, actorId, "CANCELLED", status, "CANCELLED", reason);
        freeCopyIfUnheld(String.valueOf(loan.get("copyId")));
        notifyBorrower(loan,
                "Đơn mượn sách bị hủy",
                "Đơn mượn " + requestId + " đã bị hủy bởi nhân viên thư viện.",
                "INFO");
        return staffRequest(actorId, requestId);
    }

    // ------------------------------------------------------------------
    // Shared helpers (also used by the patron lane)
    // ------------------------------------------------------------------

    static String requestSelect() {
        return "SELECT r.\"id\", r.\"copyId\", c.\"barcode\" AS barcode, c.\"titleId\" AS title_id,"
                + " t.\"title\" AS title_name, r.\"borrowerUserId\", u.\"email\" AS borrower_email,"
                + " r.\"status\", r.\"requestedAt\", r.\"expiresAt\", r.\"approvedBy\", r.\"approvedAt\","
                + " r.\"issuedBy\", r.\"issuedAt\", r.\"dueAt\", r.\"returnedBy\", r.\"returnedAt\","
                + " r.\"cancelledBy\", r.\"cancelledAt\", r.\"cancelReason\", r.\"version\", r.\"createdAt\""
                + " FROM " + LOAN_REQUEST + " r"
                + " JOIN " + COPY + " c ON c.\"id\" = r.\"copyId\""
                + " JOIN " + TITLE + " t ON t.\"id\" = c.\"titleId\""
                + " LEFT JOIN " + AUTH_USER + " u ON u.\"id\" = r.\"borrowerUserId\"";
    }

    Map<String, Object> lockRequest(String requestId) {
        try {
            return jdbc.queryForMap(
                    "SELECT \"id\", \"copyId\", \"borrowerUserId\", \"status\", \"expiresAt\","
                            + " \"version\", \"dueAt\" FROM " + LOAN_REQUEST
                            + " WHERE \"id\" = :id FOR UPDATE",
                    new MapSqlParameterSource("id", requestId));
        } catch (EmptyResultDataAccessException exception) {
            throw problem(HttpStatus.NOT_FOUND, "REQUEST_NOT_FOUND", "Loan request not found");
        }
    }

    Map<String, Object> lockCopy(String copyId) {
        try {
            return jdbc.queryForMap(
                    "SELECT \"id\", \"titleId\", \"barcode\", \"status\", \"version\""
                            + " FROM " + COPY + " WHERE \"id\" = :id FOR UPDATE",
                    new MapSqlParameterSource("id", copyId));
        } catch (EmptyResultDataAccessException exception) {
            throw problem(HttpStatus.NOT_FOUND, "COPY_NOT_FOUND", "Copy not found");
        }
    }

    Map<String, Object> findRequestRow(String requestId) {
        try {
            return jdbc.queryForMap(
                    requestSelect() + " WHERE r.\"id\" = :id",
                    new MapSqlParameterSource("id", requestId));
        } catch (EmptyResultDataAccessException exception) {
            throw problem(HttpStatus.NOT_FOUND, "REQUEST_NOT_FOUND", "Loan request not found");
        }
    }

    CopyResponse copyOf(String copyId) {
        try {
            return jdbc.queryForObject(
                    "SELECT \"id\", \"titleId\", \"barcode\", \"status\", \"version\""
                            + " FROM " + COPY + " WHERE \"id\" = :id",
                    new MapSqlParameterSource("id", copyId),
                    (row, index) -> mapCopy(row));
        } catch (EmptyResultDataAccessException exception) {
            throw problem(HttpStatus.NOT_FOUND, "COPY_NOT_FOUND", "Copy not found");
        }
    }

    TitleResponse findTitle(String titleId) {
        Map<String, Object> row;
        try {
            row = jdbc.queryForMap(
                    "SELECT \"id\", \"title\", \"author\", \"isbn\", \"category\", \"publisher\","
                            + " \"publishedYear\", \"description\", \"version\""
                            + " FROM " + TITLE + " WHERE \"id\" = :id",
                    new MapSqlParameterSource("id", titleId));
        } catch (EmptyResultDataAccessException exception) {
            throw problem(HttpStatus.NOT_FOUND, "TITLE_NOT_FOUND", "Title not found");
        }
        List<CopyResponse> copies = jdbc.query(
                "SELECT \"id\", \"titleId\", \"barcode\", \"status\", \"version\""
                        + " FROM " + COPY + " WHERE \"titleId\" = :id ORDER BY \"barcode\"",
                new MapSqlParameterSource("id", titleId),
                (rs, index) -> mapCopy(rs));
        return mapTitle(row, copies);
    }

    void requireTerminalGuard(Map<String, Object> request) {
        String status = String.valueOf(request.get("status"));
        if (TERMINAL_REQUEST_STATUSES.contains(status)) {
            throw problem(HttpStatus.CONFLICT, "REQUEST_TERMINAL",
                    "Loan request is " + status + " and can no longer change");
        }
    }

    void requireVersion(Map<String, Object> request, Integer expectedVersion) {
        int version = ((Number) request.get("version")).intValue();
        if (expectedVersion == null) {
            throw problem(HttpStatus.BAD_REQUEST, "REQUEST_VERSION_REQUIRED",
                    "expectedVersion is required");
        }
        if (expectedVersion.intValue() != version) {
            throw problem(HttpStatus.CONFLICT, "STALE_VERSION",
                    "Reload the request before retrying (version " + version + ")");
        }
    }

    private void requireCopyVersion(Map<String, Object> copy, Integer expectedVersion) {
        int version = ((Number) copy.get("version")).intValue();
        if (expectedVersion == null) {
            throw problem(HttpStatus.BAD_REQUEST, "COPY_VERSION_REQUIRED",
                    "expectedVersion is required");
        }
        if (expectedVersion.intValue() != version) {
            throw problem(HttpStatus.CONFLICT, "STALE_VERSION",
                    "Reload the copy before retrying (version " + version + ")");
        }
    }

    /** LIB-T02/LIB-X01: an expired hold cannot be approved (server clock). */
    private void requireWithinHoldWindow(Map<String, Object> request) {
        Object expiresAt = request.get("expiresAt");
        if (expiresAt != null && toInstant(expiresAt).isBefore(Instant.now())) {
            throw problem(HttpStatus.CONFLICT, "RESERVATION_EXPIRED",
                    "The reservation hold expired; copy release is pending cleanup");
        }
    }

    void audit(String entityType, String entityId, String actorId, String action,
            String fromStatus, String toStatus, String detail) {
        jdbc.update(
                "INSERT INTO " + AUDIT
                        + " (\"id\", \"entityType\", \"entityId\", \"actorId\", \"action\","
                        + " \"fromStatus\", \"toStatus\", \"detail\")"
                        + " VALUES (:id, :entityType, :entityId, :actorId, :action, :fromStatus, :toStatus, :detail)",
                new MapSqlParameterSource()
                        .addValue("id", UUID.randomUUID().toString())
                        .addValue("entityType", entityType)
                        .addValue("entityId", entityId)
                        .addValue("actorId", actorId)
                        .addValue("action", action)
                        .addValue("fromStatus", fromStatus)
                        .addValue("toStatus", toStatus)
                        .addValue("detail", detail));
    }

    /** borrowerUserId IS an auth user id — no academic indirection. */
    private void notifyBorrower(Map<String, Object> request, String title,
            String message, String type) {
        notifications.create(new CreateNotificationCommand(
                UUID.randomUUID().toString(),
                String.valueOf(request.get("borrowerUserId")),
                title, message, type, "/library", Instant.now()));
    }

    LoanRequestResponse mapRequest(Map<String, Object> row) {
        return new LoanRequestResponse(
                String.valueOf(row.get("id")),
                String.valueOf(row.get("copyId")),
                row.get("barcode") == null ? null : String.valueOf(row.get("barcode")),
                row.get("title_id") == null ? null : String.valueOf(row.get("title_id")),
                row.get("title_name") == null ? null : String.valueOf(row.get("title_name")),
                String.valueOf(row.get("borrowerUserId")),
                row.get("borrower_email") == null ? null : String.valueOf(row.get("borrower_email")),
                String.valueOf(row.get("status")),
                toInstant(row.get("requestedAt")),
                toInstant(row.get("expiresAt")),
                row.get("approvedBy") == null ? null : String.valueOf(row.get("approvedBy")),
                toInstant(row.get("approvedAt")),
                row.get("issuedBy") == null ? null : String.valueOf(row.get("issuedBy")),
                toInstant(row.get("issuedAt")),
                toInstant(row.get("dueAt")),
                row.get("returnedBy") == null ? null : String.valueOf(row.get("returnedBy")),
                toInstant(row.get("returnedAt")),
                row.get("cancelledBy") == null ? null : String.valueOf(row.get("cancelledBy")),
                toInstant(row.get("cancelledAt")),
                row.get("cancelReason") == null ? null : String.valueOf(row.get("cancelReason")),
                ((Number) row.get("version")).intValue(),
                toInstant(row.get("createdAt")));
    }

    private LoanRequestResponse mapRequest(ResultSet row) throws SQLException {
        return new LoanRequestResponse(
                row.getString("id"),
                row.getString("copyId"),
                row.getString("barcode"),
                row.getString("title_id"),
                row.getString("title_name"),
                row.getString("borrowerUserId"),
                row.getString("borrower_email"),
                row.getString("status"),
                toInstant(row.getObject("requestedAt")),
                toInstant(row.getObject("expiresAt")),
                row.getString("approvedBy"),
                toInstant(row.getObject("approvedAt")),
                row.getString("issuedBy"),
                toInstant(row.getObject("issuedAt")),
                toInstant(row.getObject("dueAt")),
                row.getString("returnedBy"),
                toInstant(row.getObject("returnedAt")),
                row.getString("cancelledBy"),
                toInstant(row.getObject("cancelledAt")),
                row.getString("cancelReason"),
                row.getInt("version"),
                toInstant(row.getObject("createdAt")));
    }

    private CopyResponse mapCopy(ResultSet row) throws SQLException {
        return new CopyResponse(
                row.getString("id"),
                row.getString("titleId"),
                row.getString("barcode"),
                row.getString("status"),
                row.getInt("version"));
    }

    TitleResponse mapTitle(Map<String, Object> row, List<CopyResponse> copies) {
        int available = (int) copies.stream().filter(c -> "AVAILABLE".equals(c.status())).count();
        return new TitleResponse(
                String.valueOf(row.get("id")),
                String.valueOf(row.get("title")),
                row.get("author") == null ? null : String.valueOf(row.get("author")),
                row.get("isbn") == null ? null : String.valueOf(row.get("isbn")),
                row.get("category") == null ? null : String.valueOf(row.get("category")),
                row.get("publisher") == null ? null : String.valueOf(row.get("publisher")),
                row.get("publishedYear") == null ? null : ((Number) row.get("publishedYear")).intValue(),
                row.get("description") == null ? null : String.valueOf(row.get("description")),
                copies.size(), available,
                ((Number) row.get("version")).intValue(),
                copies);
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
