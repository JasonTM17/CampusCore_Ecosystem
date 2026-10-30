package io.campuscore.restfulapi.careers.service;

import io.campuscore.restfulapi.careers.web.CareerDtos.ApplicationResponse;
import io.campuscore.restfulapi.careers.web.CareerDtos.ApplicationTransitionRequest;
import io.campuscore.restfulapi.careers.web.CareerDtos.AttachmentResponse;
import io.campuscore.restfulapi.careers.web.CareerDtos.CreateOpportunityRequest;
import io.campuscore.restfulapi.careers.web.CareerDtos.OpportunityResponse;
import io.campuscore.restfulapi.careers.web.CareerDtos.OrganizationResponse;
import io.campuscore.restfulapi.careers.web.CareerDtos.StaffGrantResponse;
import io.campuscore.restfulapi.careers.web.CareerDtos.TransitionRequest;
import io.campuscore.restfulapi.events.web.ListPaging;
import io.campuscore.restfulapi.notification.repository.NotificationWriteRepository;
import io.campuscore.restfulapi.notification.repository.NotificationWriteRepository.CreateNotificationCommand;
import io.campuscore.restfulapi.web.DomainException;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.context.annotation.Profile;
import org.springframework.dao.EmptyResultDataAccessException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.RowCallbackHandler;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * P12 careers — org-staff + reviewer lanes and shared helpers (§9).
 *
 * <p>Authority is organization-scoped: a {@code careers."StaffGrant"} row
 * with {@code organizationId = <org>} makes its holder a recruiter for
 * exactly that org (CAR-X01 — cross-org reads/writes are impossible at
 * the service layer, not just the route). The same table with
 * {@code organizationId = ''} marks a platform publication reviewer:
 * only reviewers can move IN_REVIEW → PUBLISHED/REJECTED, and never on
 * their own submission (CAR-T02). ADMIN role grants but does not confer
 * domain rights (§1.1).
 *
 * <p>Every transition locks its row {@code FOR UPDATE}, verifies the
 * optimistic version, runs the state-machine guard and writes an audit
 * row in the same transaction. Applications serialize candidate progress
 * SUBMITTED → REVIEWING → INTERVIEW → OFFER with a moderation reason on
 * REJECTED that is never hidden from the candidate (CAR-T06). At most
 * one active application per candidate per opportunity is backstopped by
 * the partial unique index (CAR-T04).
 */
@Service
@Profile("persistence")
public class CareerService {

    static final String ORGANIZATION = "careers.\"Organization\"";
    static final String OPPORTUNITY = "careers.\"Opportunity\"";
    static final String APPLICATION = "careers.\"Application\"";
    static final String ATTACHMENT = "careers.\"Attachment\"";
    static final String AUDIT = "careers.\"Audit\"";
    static final String STAFF_GRANT = "careers.\"StaffGrant\"";
    static final String IDEMPOTENCY = "careers.\"Idempotency\"";
    static final String AUTH_USER = "campuscore_auth.\"User\"";
    static final String SCOPE = "careers";

    /** Opportunity statuses that accept further lifecycle transitions. */
    static final List<String> OPEN_OPPORTUNITY_STATUSES = List.of("DRAFT", "IN_REVIEW", "PUBLISHED", "PAUSED");
    /** Terminal opportunity statuses. */
    static final List<String> TERMINAL_OPPORTUNITY_STATUSES = List.of("CLOSED", "REJECTED");
    /** Application statuses before a terminal outcome. */
    static final List<String> ACTIVE_APPLICATION_STATUSES = List.of(
            "SUBMITTED", "REVIEWING", "INTERVIEW", "OFFER");
    /** Terminal application statuses. */
    static final List<String> TERMINAL_APPLICATION_STATUSES = List.of("REJECTED", "WITHDRAWN");
    /** The only forward order the server accepts (CAR-T05). */
    private static final List<String> APPLICATION_PROGRESSION = List.of(
            "SUBMITTED", "REVIEWING", "INTERVIEW", "OFFER");

    private final NamedParameterJdbcTemplate jdbc;
    private final NotificationWriteRepository notifications;
    private final boolean postgres;

    public CareerService(NamedParameterJdbcTemplate jdbc,
            NotificationWriteRepository notifications) {
        this.jdbc = jdbc;
        this.notifications = notifications;
        this.postgres = jdbc.getJdbcOperations().execute((org.springframework.jdbc.core.ConnectionCallback<Boolean>) connection ->
                "PostgreSQL".equalsIgnoreCase(connection.getMetaData().getDatabaseProductName()));
    }

    // ------------------------------------------------------------------
    // Authority
    // ------------------------------------------------------------------

    /** STAFF:careers:<org> — an org-scoped grant row is the sole authority. */
    void requireOrgGrant(String actorId, String organizationId) {
        Integer count = jdbc.queryForObject(
                "SELECT COUNT(*) FROM " + STAFF_GRANT
                        + " WHERE \"userId\" = :userId AND \"scope\" = :scope"
                        + " AND \"organizationId\" = :org",
                new MapSqlParameterSource()
                        .addValue("userId", actorId)
                        .addValue("scope", SCOPE)
                        .addValue("org", organizationId == null ? "" : organizationId),
                Integer.class);
        if (organizationId == null || organizationId.isBlank()
                || count == null || count == 0) {
            throw problem(HttpStatus.FORBIDDEN, "CAREERS_STAFF_REQUIRED",
                    "A careers staff grant for this organization is required");
        }
    }

    /** STAFF:careers (orgId='') — the platform publication reviewer. */
    void requireReviewerGrant(String actorId) {
        Integer count = jdbc.queryForObject(
                "SELECT COUNT(*) FROM " + STAFF_GRANT
                        + " WHERE \"userId\" = :userId AND \"scope\" = :scope"
                        + " AND \"organizationId\" = ''",
                new MapSqlParameterSource()
                        .addValue("userId", actorId)
                        .addValue("scope", SCOPE),
                Integer.class);
        if (count == null || count == 0) {
            throw problem(HttpStatus.FORBIDDEN, "CAREERS_REVIEWER_REQUIRED",
                    "A careers reviewer grant is required for this operation");
        }
    }

    /** Any careers grant — desk surfaces enumerate what the actor may see. */
    boolean hasAnyStaffGrant(String actorId) {
        Integer count = jdbc.queryForObject(
                "SELECT COUNT(*) FROM " + STAFF_GRANT
                        + " WHERE \"userId\" = :userId AND \"scope\" = :scope",
                new MapSqlParameterSource()
                        .addValue("userId", actorId)
                        .addValue("scope", SCOPE),
                Integer.class);
        return count != null && count > 0;
    }

    /** Org-scoped grants only — recruiter lanes deny reviewer-only actors. */
    boolean hasAnyOrgGrant(String actorId) {
        Integer count = jdbc.queryForObject(
                "SELECT COUNT(*) FROM " + STAFF_GRANT
                        + " WHERE \"userId\" = :userId AND \"scope\" = :scope"
                        + " AND \"organizationId\" <> ''",
                new MapSqlParameterSource()
                        .addValue("userId", actorId)
                        .addValue("scope", SCOPE),
                Integer.class);
        return count != null && count > 0;
    }

    void requireAnyOrgGrant(String actorId) {
        if (!hasAnyOrgGrant(actorId)) {
            throw problem(HttpStatus.FORBIDDEN, "CAREERS_STAFF_REQUIRED",
                    "A careers organization grant is required for this operation");
        }
    }

    List<String> grantedOrganizations(String actorId) {
        return jdbc.query(
                "SELECT \"organizationId\" FROM " + STAFF_GRANT
                        + " WHERE \"userId\" = :userId AND \"scope\" = :scope"
                        + " AND \"organizationId\" <> ''",
                new MapSqlParameterSource()
                        .addValue("userId", actorId)
                        .addValue("scope", SCOPE),
                (row, index) -> String.valueOf(row.getString("organizationId")));
    }

    boolean isReviewer(String actorId) {
        try {
            requireReviewerGrant(actorId);
            return true;
        } catch (DomainException denied) {
            return false;
        }
    }

    private static void requireAdmin(List<String> roles) {
        if (roles == null || !roles.contains("ADMIN")) {
            throw problem(HttpStatus.FORBIDDEN, "CAREERS_ADMIN_REQUIRED",
                    "Grant administration requires the ADMIN role");
        }
    }

    // ------------------------------------------------------------------
    // Grants (admin-managed; orgId '' = platform reviewer)
    // ------------------------------------------------------------------

    public List<StaffGrantResponse> listGrants(String actorId) {
        return listGrants(actorId, null).items();
    }

    public ListPaging.Result<StaffGrantResponse> listGrants(String actorId,
            ListPaging.Window window) {
        if (!hasAnyStaffGrant(actorId) && !isReviewer(actorId)) {
            throw problem(HttpStatus.FORBIDDEN, "CAREERS_STAFF_REQUIRED",
                    "A careers grant is required to list grants");
        }
        MapSqlParameterSource params = new MapSqlParameterSource("scope", SCOPE);
        Long total = null;
        if (window != null) {
            total = jdbc.queryForObject(
                    "SELECT COUNT(*) FROM " + STAFF_GRANT + " WHERE \"scope\" = :scope",
                    params, Long.class);
        }
        String sql = "SELECT \"id\", \"userId\", \"scope\", \"organizationId\", \"grantedBy\", \"createdAt\""
                + " FROM " + STAFF_GRANT + " WHERE \"scope\" = :scope ORDER BY \"createdAt\"";
        if (window != null) {
            sql += ", \"id\" LIMIT :limit OFFSET :offset";
            params.addValue("limit", window.limit()).addValue("offset", window.offset());
        }
        return new ListPaging.Result<>(
                jdbc.query(sql, params, (row, index) -> mapGrant(row)), total);
    }

    @Transactional
    public StaffGrantResponse grantStaff(String actorId, List<String> actorRoles,
            String userId, String organizationId) {
        requireAdmin(actorRoles);
        if (userId == null || userId.isBlank()) {
            throw problem(HttpStatus.BAD_REQUEST, "CAREERS_USER_REQUIRED", "userId is required");
        }
        Integer userExists = jdbc.queryForObject(
                "SELECT COUNT(*) FROM " + AUTH_USER + " WHERE \"id\" = :userId",
                new MapSqlParameterSource("userId", userId), Integer.class);
        if (userExists == null || userExists == 0) {
            throw problem(HttpStatus.NOT_FOUND, "CAREERS_USER_NOT_FOUND",
                    "Grant target user not found");
        }
        if (organizationId != null && !organizationId.isEmpty()
                && organizationId.isBlank()) {
            throw problem(HttpStatus.BAD_REQUEST, "ORGANIZATION_ID_BLANK",
                    "organizationId must name an organization or be omitted for a reviewer grant");
        }
        String org = organizationId == null ? "" : organizationId.trim();
        if (!org.isEmpty()) {
            Integer orgExists = jdbc.queryForObject(
                    "SELECT COUNT(*) FROM " + ORGANIZATION + " WHERE \"id\" = :org",
                    new MapSqlParameterSource("org", org), Integer.class);
            if (orgExists == null || orgExists == 0) {
                throw problem(HttpStatus.NOT_FOUND, "ORGANIZATION_NOT_FOUND",
                        "Grant target organization not found");
            }
        }
        String grantId = UUID.randomUUID().toString();
        // Two admins can grant the same target concurrently. ON CONFLICT
        // DO NOTHING keeps the loser's transaction valid on PostgreSQL,
        // where a plain unique violation would abort it and poison the
        // re-read below.
        String insert = "INSERT INTO " + STAFF_GRANT
                + " (\"id\", \"userId\", \"scope\", \"organizationId\", \"grantedBy\")"
                + " VALUES (:id, :userId, :scope, :org, :actor)"
                + (postgres ? " ON CONFLICT (\"userId\", \"scope\", \"organizationId\") DO NOTHING" : "");
        int inserted;
        try {
            inserted = jdbc.update(insert,
                    new MapSqlParameterSource()
                            .addValue("id", grantId)
                            .addValue("userId", userId)
                            .addValue("scope", SCOPE)
                            .addValue("org", org)
                            .addValue("actor", actorId));
        } catch (org.springframework.dao.DuplicateKeyException duplicate) {
            // Only the non-PostgreSQL mirror raises here; the re-read below
            // returns the row the racing request created.
            inserted = 0;
        }
        if (inserted > 0) {
            audit("GRANT", grantId, actorId, "STAFF_GRANTED", null,
                    org.isEmpty() ? "REVIEWER" : "ORG:" + org, "user=" + userId);
        }
        return jdbc.queryForObject(
                "SELECT \"id\", \"userId\", \"scope\", \"organizationId\", \"grantedBy\", \"createdAt\""
                        + " FROM " + STAFF_GRANT
                        + " WHERE \"userId\" = :userId AND \"scope\" = :scope"
                        + " AND \"organizationId\" = :org",
                new MapSqlParameterSource()
                        .addValue("userId", userId)
                        .addValue("scope", SCOPE)
                        .addValue("org", org),
                (row, index) -> mapGrant(row));
    }

    @Transactional
    public void revokeStaff(String actorId, List<String> actorRoles, String grantId) {
        requireAdmin(actorRoles);
        Map<String, Object> grant;
        try {
            grant = jdbc.queryForMap(
                    "SELECT \"userId\", \"organizationId\" FROM " + STAFF_GRANT
                            + " WHERE \"id\" = :id AND \"scope\" = :scope",
                    new MapSqlParameterSource("id", grantId).addValue("scope", SCOPE));
        } catch (EmptyResultDataAccessException exception) {
            throw problem(HttpStatus.NOT_FOUND, "CAREERS_GRANT_NOT_FOUND", "Grant not found");
        }
        jdbc.update("DELETE FROM " + STAFF_GRANT + " WHERE \"id\" = :id",
                new MapSqlParameterSource("id", grantId));
        audit("GRANT", grantId, actorId, "STAFF_REVOKED",
                "ORG:" + grant.get("organizationId"), null,
                "user=" + grant.get("userId"));
    }

    // ------------------------------------------------------------------
    // Organizations
    // ------------------------------------------------------------------

    public List<OrganizationResponse> organizations() {
        return organizations(null).items();
    }

    public ListPaging.Result<OrganizationResponse> organizations(ListPaging.Window window) {
        MapSqlParameterSource params = new MapSqlParameterSource();
        Long total = null;
        if (window != null) {
            total = jdbc.queryForObject(
                    "SELECT COUNT(*) FROM " + ORGANIZATION, params, Long.class);
        }
        String sql = "SELECT \"id\", \"name\", \"description\", \"version\" FROM " + ORGANIZATION
                + " ORDER BY \"name\"";
        if (window != null) {
            sql += ", \"id\" LIMIT :limit OFFSET :offset";
            params.addValue("limit", window.limit()).addValue("offset", window.offset());
        }
        return new ListPaging.Result<>(
                jdbc.query(sql, params, (row, index) -> mapOrganization(row)), total);
    }

    /** The organizations this staff actor is granted for — the desk scope. */
    public List<OrganizationResponse> myOrganizations(String actorId) {
        return myOrganizations(actorId, null).items();
    }

    public ListPaging.Result<OrganizationResponse> myOrganizations(String actorId,
            ListPaging.Window window) {
        requireAnyOrgGrant(actorId);
        List<String> orgs = grantedOrganizations(actorId);
        MapSqlParameterSource params = new MapSqlParameterSource("orgs", orgs);
        Long total = null;
        if (window != null) {
            total = jdbc.queryForObject(
                    "SELECT COUNT(*) FROM " + ORGANIZATION + " WHERE \"id\" IN (:orgs)",
                    params, Long.class);
        }
        String sql = "SELECT \"id\", \"name\", \"description\", \"version\" FROM " + ORGANIZATION
                + " WHERE \"id\" IN (:orgs) ORDER BY \"name\"";
        if (window != null) {
            sql += ", \"id\" LIMIT :limit OFFSET :offset";
            params.addValue("limit", window.limit()).addValue("offset", window.offset());
        }
        return new ListPaging.Result<>(
                jdbc.query(sql, params, (row, index) -> mapOrganization(row)), total);
    }

    Map<String, Object> findOrganization(String organizationId) {
        try {
            return jdbc.queryForMap(
                    "SELECT \"id\", \"name\" FROM " + ORGANIZATION + " WHERE \"id\" = :id",
                    new MapSqlParameterSource("id", organizationId));
        } catch (EmptyResultDataAccessException exception) {
            throw problem(HttpStatus.NOT_FOUND, "ORGANIZATION_NOT_FOUND", "Organization not found");
        }
    }

    // ------------------------------------------------------------------
    // Opportunity staff lane (org-scoped)
    // ------------------------------------------------------------------

    static String opportunitySelect() {
        return "SELECT o.\"id\", o.\"organizationId\", g.\"name\" AS org_name, o.\"title\","
                + " o.\"description\", o.\"location\", o.\"employmentType\", o.\"salaryText\","
                + " o.\"status\", o.\"submittedBy\", o.\"reviewedBy\", o.\"reviewedAt\","
                + " o.\"publishedAt\", o.\"pausedAt\", o.\"closedAt\", o.\"moderationReason\","
                + " o.\"version\", o.\"createdAt\""
                + " FROM " + OPPORTUNITY + " o"
                + " JOIN " + ORGANIZATION + " g ON g.\"id\" = o.\"organizationId\"";
    }

    /** Org-scoped opportunity queue — only granted orgs are visible. */
    @Transactional
    public List<OpportunityResponse> opportunityQueue(String actorId, String status) {
        return opportunityQueue(actorId, status, null).items();
    }

    @Transactional
    public ListPaging.Result<OpportunityResponse> opportunityQueue(String actorId,
            String status, ListPaging.Window window) {
        requireAnyOrgGrant(actorId);
        List<String> orgs = grantedOrganizations(actorId);
        MapSqlParameterSource params = new MapSqlParameterSource("orgs", orgs);
        String where = " WHERE o.\"organizationId\" IN (:orgs)";
        if (status != null && !status.isBlank()) {
            where += " AND o.\"status\" = :status";
            params.addValue("status", status);
        }
        Long total = null;
        if (window != null) {
            total = jdbc.queryForObject(
                    "SELECT COUNT(*) FROM " + OPPORTUNITY + " o" + where, params, Long.class);
        }
        String sql = opportunitySelect() + where + " ORDER BY o.\"createdAt\" DESC";
        if (window != null) {
            sql += ", o.\"id\" LIMIT :limit OFFSET :offset";
            params.addValue("limit", window.limit()).addValue("offset", window.offset());
        }
        return new ListPaging.Result<>(
                jdbc.query(sql, params, (row, index) -> mapOpportunity(row)), total);
    }

    /** Create a posting inside the actor's org — starts DRAFT (CAR-T01). */
    @Transactional
    public OpportunityResponse createOpportunity(String actorId, CreateOpportunityRequest request) {
        if (request == null || request.organizationId() == null || request.organizationId().isBlank()) {
            throw problem(HttpStatus.BAD_REQUEST, "ORGANIZATION_REQUIRED", "organizationId is required");
        }
        requireOrgGrant(actorId, request.organizationId());
        if (request.title() == null || request.title().isBlank()) {
            throw problem(HttpStatus.BAD_REQUEST, "TITLE_REQUIRED", "title is required");
        }
        findOrganization(request.organizationId());
        String id = UUID.randomUUID().toString();
        jdbc.update(
                "INSERT INTO " + OPPORTUNITY
                        + " (\"id\", \"organizationId\", \"title\", \"description\", \"location\","
                        + " \"employmentType\", \"salaryText\", \"submittedBy\")"
                        + " VALUES (:id, :org, :title, :description, :location, :type, :salary, :actor)",
                new MapSqlParameterSource()
                        .addValue("id", id)
                        .addValue("org", request.organizationId())
                        .addValue("title", request.title().trim())
                        .addValue("description", request.description())
                        .addValue("location", request.location())
                        .addValue("type", request.employmentType())
                        .addValue("salary", request.salaryText())
                        .addValue("actor", actorId));
        audit("OPPORTUNITY", id, actorId, "CREATED", null, "DRAFT", "org=" + request.organizationId());
        return staffOpportunity(actorId, id);
    }

    /** Org-scoped opportunity detail — foreign org ids answer 403 scope-deny (§6/§5 posture). */
    @Transactional
    public OpportunityResponse staffOpportunity(String actorId, String opportunityId) {
        Map<String, Object> row = findOpportunityRow(opportunityId);
        requireOrgGrant(actorId, String.valueOf(row.get("organizationId")));
        return mapOpportunity(row);
    }

    /** DRAFT → IN_REVIEW (CAR-T01): the org submits for moderation. */
    @Transactional
    public OpportunityResponse submitReview(String actorId, String opportunityId,
            Integer expectedVersion) {
        Map<String, Object> opportunity = lockOpportunity(opportunityId);
        requireOrgGrant(actorId, String.valueOf(opportunity.get("organizationId")));
        requireOpportunityTerminalGuard(opportunity);
        requireVersion(opportunity, expectedVersion);
        if (!"DRAFT".equals(String.valueOf(opportunity.get("status")))) {
            throw problem(HttpStatus.CONFLICT, "OPPORTUNITY_STATE_INVALID",
                    "Only a draft can be submitted for review");
        }
        transitionOpportunity(opportunityId, "IN_REVIEW", "DRAFT");
        audit("OPPORTUNITY", opportunityId, actorId, "SUBMITTED_FOR_REVIEW", "DRAFT", "IN_REVIEW", null);
        return staffOpportunity(actorId, opportunityId);
    }

    /** PUBLISHED → PAUSED (CAR-T03): org staff with a visible reason. */
    @Transactional
    public OpportunityResponse pause(String actorId, String opportunityId,
            TransitionRequest request) {
        return orgStatusChange(actorId, opportunityId, request, "PUBLISHED", "PAUSED",
                "PAUSED", "pausedAt");
    }

    /** PAUSED → PUBLISHED (resume): org staff only, no reviewer round-trip. */
    @Transactional
    public OpportunityResponse resume(String actorId, String opportunityId,
            Integer expectedVersion) {
        return orgStatusChange(actorId, opportunityId,
                new TransitionRequest(expectedVersion, null), "PAUSED", "PUBLISHED",
                "RESUMED", null);
    }

    /** → CLOSED (CAR-T03): org staff, reason required, terminal. */
    @Transactional
    public OpportunityResponse close(String actorId, String opportunityId,
            TransitionRequest request) {
        // Scope check must precede the state check — a foreign actor gets the
        // same 403 as any denied lane instead of a state-oracle 409.
        Map<String, Object> opportunity = lockOpportunity(opportunityId);
        requireOrgGrant(actorId, String.valueOf(opportunity.get("organizationId")));
        String status = String.valueOf(opportunity.get("status"));
        if (!"PUBLISHED".equals(status) && !"PAUSED".equals(status)) {
            throw problem(HttpStatus.CONFLICT, "OPPORTUNITY_STATE_INVALID",
                    "Only a published or paused opportunity can be closed");
        }
        return orgStatusChange(actorId, opportunityId, request, status, "CLOSED",
                "CLOSED", "closedAt");
    }

    private OpportunityResponse orgStatusChange(String actorId, String opportunityId,
            TransitionRequest request, String fromStatus, String toStatus,
            String action, String timestampColumn) {
        Map<String, Object> opportunity = lockOpportunity(opportunityId);
        requireOrgGrant(actorId, String.valueOf(opportunity.get("organizationId")));
        requireOpportunityTerminalGuard(opportunity);
        requireVersion(opportunity, request == null ? null : request.expectedVersion());
        String current = String.valueOf(opportunity.get("status"));
        if (!fromStatus.equals(current)) {
            throw problem(HttpStatus.CONFLICT, "OPPORTUNITY_STATE_INVALID",
                    "Only a " + fromStatus.toLowerCase() + " opportunity can transition here");
        }
        String reason = request == null ? null : request.reason();
        if (("CLOSED".equals(toStatus) || "PAUSED".equals(toStatus))
                && (reason == null || reason.isBlank())) {
            throw problem(HttpStatus.BAD_REQUEST, "MODERATION_REASON_REQUIRED",
                    "A visible reason is required for " + toStatus.toLowerCase());
        }
        String sql = "UPDATE " + OPPORTUNITY + " SET \"status\" = :to,"
                + " \"moderationReason\" = :reason,"
                + " \"version\" = \"version\" + 1, \"updatedAt\" = CURRENT_TIMESTAMP";
        if (timestampColumn != null) {
            sql += ", \"" + timestampColumn + "\" = CURRENT_TIMESTAMP";
        }
        sql += " WHERE \"id\" = :id AND \"status\" = :from";
        int updated = jdbc.update(sql, new MapSqlParameterSource()
                .addValue("id", opportunityId)
                .addValue("to", toStatus)
                .addValue("reason", reason)
                .addValue("from", fromStatus));
        if (updated == 0) {
            throw problem(HttpStatus.CONFLICT, "OPPORTUNITY_STATE_INVALID",
                    "The opportunity is no longer " + fromStatus.toLowerCase());
        }
        audit("OPPORTUNITY", opportunityId, actorId, action, fromStatus, toStatus, reason);
        if ("CLOSED".equals(toStatus)) {
            notifyUser(String.valueOf(opportunity.get("submittedBy")),
                    "Tin tuyển dụng đã đóng",
                    "Tin " + opportunityId + " đã đóng — " + reason, "INFO");
        }
        return staffOpportunity(actorId, opportunityId);
    }

    // ------------------------------------------------------------------
    // Reviewer lane (platform publication moderation, CAR-T02)
    // ------------------------------------------------------------------

    /** IN_REVIEW queue — only platform reviewers see the moderation list. */
    @Transactional
    public List<OpportunityResponse> reviewQueue(String actorId) {
        return reviewQueue(actorId, null).items();
    }

    @Transactional
    public ListPaging.Result<OpportunityResponse> reviewQueue(String actorId,
            ListPaging.Window window) {
        requireReviewerGrant(actorId);
        MapSqlParameterSource params = new MapSqlParameterSource();
        Long total = null;
        if (window != null) {
            total = jdbc.queryForObject(
                    "SELECT COUNT(*) FROM " + OPPORTUNITY + " o WHERE o.\"status\" = 'IN_REVIEW'",
                    params, Long.class);
        }
        String sql = opportunitySelect() + " WHERE o.\"status\" = 'IN_REVIEW'"
                + " ORDER BY o.\"createdAt\"";
        if (window != null) {
            sql += ", o.\"id\" LIMIT :limit OFFSET :offset";
            params.addValue("limit", window.limit()).addValue("offset", window.offset());
        }
        return new ListPaging.Result<>(
                jdbc.query(sql, params, (row, index) -> mapOpportunity(row)), total);
    }

    /** IN_REVIEW → PUBLISHED: reviewer != submitter (CAR-T02). */
    @Transactional
    public OpportunityResponse publish(String actorId, String opportunityId,
            Integer expectedVersion) {
        requireReviewerGrant(actorId);
        Map<String, Object> opportunity = lockOpportunity(opportunityId);
        requireOpportunityTerminalGuard(opportunity);
        requireVersion(opportunity, expectedVersion);
        if (!"IN_REVIEW".equals(String.valueOf(opportunity.get("status")))) {
            throw problem(HttpStatus.CONFLICT, "OPPORTUNITY_STATE_INVALID",
                    "Only an in-review opportunity can be published");
        }
        if (actorId.equals(String.valueOf(opportunity.get("submittedBy")))) {
            throw problem(HttpStatus.FORBIDDEN, "SELF_PUBLISH_FORBIDDEN",
                    "The submitter cannot moderate their own opportunity");
        }
        int updated = jdbc.update(
                "UPDATE " + OPPORTUNITY + " SET \"status\" = 'PUBLISHED',"
                        + " \"reviewedBy\" = :actor, \"reviewedAt\" = CURRENT_TIMESTAMP,"
                        + " \"publishedAt\" = CURRENT_TIMESTAMP, \"moderationReason\" = NULL,"
                        + " \"version\" = \"version\" + 1, \"updatedAt\" = CURRENT_TIMESTAMP"
                        + " WHERE \"id\" = :id AND \"status\" = 'IN_REVIEW'",
                new MapSqlParameterSource("id", opportunityId).addValue("actor", actorId));
        if (updated == 0) {
            throw problem(HttpStatus.CONFLICT, "OPPORTUNITY_STATE_INVALID",
                    "The opportunity is no longer in review");
        }
        audit("OPPORTUNITY", opportunityId, actorId, "PUBLISHED", "IN_REVIEW", "PUBLISHED", null);
        notifyUser(String.valueOf(opportunity.get("submittedBy")),
                "Tin tuyển dụng đã đăng",
                "Tin " + opportunityId + " đã được duyệt và hiển thị với ứng viên.", "SUCCESS");
        return mapOpportunity(findOpportunityRow(opportunityId));
    }

    /** IN_REVIEW → REJECTED: reviewer, reason required and visible to org. */
    @Transactional
    public OpportunityResponse rejectOpportunity(String actorId, String opportunityId,
            TransitionRequest request) {
        requireReviewerGrant(actorId);
        Map<String, Object> opportunity = lockOpportunity(opportunityId);
        requireOpportunityTerminalGuard(opportunity);
        requireVersion(opportunity, request == null ? null : request.expectedVersion());
        if (!"IN_REVIEW".equals(String.valueOf(opportunity.get("status")))) {
            throw problem(HttpStatus.CONFLICT, "OPPORTUNITY_STATE_INVALID",
                    "Only an in-review opportunity can be rejected");
        }
        if (actorId.equals(String.valueOf(opportunity.get("submittedBy")))) {
            throw problem(HttpStatus.FORBIDDEN, "SELF_PUBLISH_FORBIDDEN",
                    "The submitter cannot moderate their own opportunity");
        }
        String reason = request == null ? null : request.reason();
        if (reason == null || reason.isBlank()) {
            throw problem(HttpStatus.BAD_REQUEST, "MODERATION_REASON_REQUIRED",
                    "A visible moderation reason is required");
        }
        int updated = jdbc.update(
                "UPDATE " + OPPORTUNITY + " SET \"status\" = 'REJECTED',"
                        + " \"reviewedBy\" = :actor, \"reviewedAt\" = CURRENT_TIMESTAMP,"
                        + " \"moderationReason\" = :reason,"
                        + " \"version\" = \"version\" + 1, \"updatedAt\" = CURRENT_TIMESTAMP"
                        + " WHERE \"id\" = :id AND \"status\" = 'IN_REVIEW'",
                new MapSqlParameterSource("id", opportunityId)
                        .addValue("actor", actorId).addValue("reason", reason));
        if (updated == 0) {
            throw problem(HttpStatus.CONFLICT, "OPPORTUNITY_STATE_INVALID",
                    "The opportunity is no longer in review");
        }
        audit("OPPORTUNITY", opportunityId, actorId, "REJECTED", "IN_REVIEW", "REJECTED", reason);
        notifyUser(String.valueOf(opportunity.get("submittedBy")),
                "Tin tuyển dụng bị từ chối",
                "Tin " + opportunityId + " bị từ chối — " + reason, "WARNING");
        return mapOpportunity(findOpportunityRow(opportunityId));
    }

    // ------------------------------------------------------------------
    // Application staff lane (org-scoped)
    // ------------------------------------------------------------------

    static String applicationSelect() {
        return "SELECT a.\"id\", a.\"opportunityId\", o.\"title\" AS opp_title,"
                + " o.\"organizationId\", g.\"name\" AS org_name, a.\"candidateUserId\","
                + " u.\"email\" AS candidate_email, a.\"status\", a.\"coverLetter\","
                + " a.\"submittedAt\", a.\"statusChangedBy\", a.\"statusChangedAt\","
                + " a.\"moderationReason\", a.\"version\", a.\"createdAt\""
                + " FROM " + APPLICATION + " a"
                + " JOIN " + OPPORTUNITY + " o ON o.\"id\" = a.\"opportunityId\""
                + " JOIN " + ORGANIZATION + " g ON g.\"id\" = o.\"organizationId\""
                + " LEFT JOIN " + AUTH_USER + " u ON u.\"id\" = a.\"candidateUserId\"";
    }

    /** Org-scoped application queue — optional opportunity/status filters. */
    @Transactional
    public List<ApplicationResponse> applicationQueue(String actorId,
            String opportunityId, String status) {
        return applicationQueue(actorId, opportunityId, status, null).items();
    }

    @Transactional
    public ListPaging.Result<ApplicationResponse> applicationQueue(String actorId,
            String opportunityId, String status, ListPaging.Window window) {
        requireAnyOrgGrant(actorId);
        List<String> orgs = grantedOrganizations(actorId);
        MapSqlParameterSource params = new MapSqlParameterSource("orgs", orgs);
        String where = " WHERE o.\"organizationId\" IN (:orgs)";
        if (opportunityId != null && !opportunityId.isBlank()) {
            where += " AND a.\"opportunityId\" = :opp";
            params.addValue("opp", opportunityId);
        }
        if (status != null && !status.isBlank()) {
            where += " AND a.\"status\" = :status";
            params.addValue("status", status);
        }
        Long total = null;
        if (window != null) {
            total = jdbc.queryForObject(
                    "SELECT COUNT(*) FROM " + APPLICATION + " a"
                            + " JOIN " + OPPORTUNITY + " o ON o.\"id\" = a.\"opportunityId\"" + where,
                    params, Long.class);
        }
        String sql = applicationSelect() + where + " ORDER BY a.\"submittedAt\" DESC";
        if (window != null) {
            sql += ", a.\"id\" LIMIT :limit OFFSET :offset";
            params.addValue("limit", window.limit()).addValue("offset", window.offset());
        }
        List<Map<String, Object>> rows = jdbc.query(sql, params,
                (row, index) -> rowToMap(row));
        List<String> applicationIds = rows.stream()
                .map(row -> String.valueOf(row.get("id")))
                .toList();
        Map<String, List<AttachmentResponse>> attachments =
                attachmentsByApplication(applicationIds);
        List<ApplicationResponse> items = rows.stream()
                .map(row -> mapApplication(row, attachments.getOrDefault(
                        String.valueOf(row.get("id")), List.of())))
                .toList();
        return new ListPaging.Result<>(items, total);
    }

    /** Org-scoped application detail — foreign org applications answer 403 scope-deny. */
    @Transactional
    public ApplicationResponse staffApplication(String actorId, String applicationId) {
        Map<String, Object> row = findApplicationRow(applicationId);
        requireOrgGrant(actorId, String.valueOf(row.get("organizationId")));
        return mapApplication(row);
    }

    /**
     * SUBMITTED → REVIEWING → INTERVIEW → OFFER (CAR-T05): the server
     * validates the exact forward step — no skipping and no backwards.
     */
    @Transactional
    public ApplicationResponse transitionApplication(String actorId, String applicationId,
            ApplicationTransitionRequest request) {
        Map<String, Object> application = lockApplication(applicationId);
        requireOrgGrant(actorId, String.valueOf(application.get("organizationId")));
        requireApplicationTerminalGuard(application);
        requireVersion(application, request == null ? null : request.expectedVersion());
        String current = String.valueOf(application.get("status"));
        String to = request == null || request.toStatus() == null ? "" : request.toStatus();
        int currentIndex = APPLICATION_PROGRESSION.indexOf(current);
        int toIndex = APPLICATION_PROGRESSION.indexOf(to);
        if (toIndex != currentIndex + 1) {
            throw problem(HttpStatus.CONFLICT, "APPLICATION_STATE_INVALID",
                    "Applications advance " + current + " → next step only");
        }
        int updated = jdbc.update(
                "UPDATE " + APPLICATION + " SET \"status\" = :to,"
                        + " \"statusChangedBy\" = :actor, \"statusChangedAt\" = CURRENT_TIMESTAMP,"
                        + " \"version\" = \"version\" + 1, \"updatedAt\" = CURRENT_TIMESTAMP"
                        + " WHERE \"id\" = :id AND \"status\" = :from",
                new MapSqlParameterSource()
                        .addValue("id", applicationId)
                        .addValue("to", to)
                        .addValue("from", current)
                        .addValue("actor", actorId));
        if (updated == 0) {
            throw problem(HttpStatus.CONFLICT, "APPLICATION_STATE_INVALID",
                    "The application is no longer " + current);
        }
        audit("APPLICATION", applicationId, actorId, to, current, to, null);
        notifyUser(String.valueOf(application.get("candidateUserId")),
                "Hồ sơ ứng tuyển cập nhật",
                "Hồ sơ " + applicationId + " chuyển sang " + to + ".",
                "OFFER".equals(to) ? "SUCCESS" : "INFO");
        return staffApplication(actorId, applicationId);
    }

    /** → REJECTED (CAR-T06): org staff, reason required — never hidden. */
    @Transactional
    public ApplicationResponse rejectApplication(String actorId, String applicationId,
            TransitionRequest request) {
        Map<String, Object> application = lockApplication(applicationId);
        requireOrgGrant(actorId, String.valueOf(application.get("organizationId")));
        requireApplicationTerminalGuard(application);
        requireVersion(application, request == null ? null : request.expectedVersion());
        String current = String.valueOf(application.get("status"));
        String reason = request == null ? null : request.reason();
        if (reason == null || reason.isBlank()) {
            throw problem(HttpStatus.BAD_REQUEST, "MODERATION_REASON_REQUIRED",
                    "A moderation reason is required and is shown to the candidate");
        }
        int updated = jdbc.update(
                "UPDATE " + APPLICATION + " SET \"status\" = 'REJECTED',"
                        + " \"statusChangedBy\" = :actor, \"statusChangedAt\" = CURRENT_TIMESTAMP,"
                        + " \"moderationReason\" = :reason,"
                        + " \"version\" = \"version\" + 1, \"updatedAt\" = CURRENT_TIMESTAMP"
                        + " WHERE \"id\" = :id AND \"status\" = :from",
                new MapSqlParameterSource()
                        .addValue("id", applicationId)
                        .addValue("from", current)
                        .addValue("actor", actorId)
                        .addValue("reason", reason));
        if (updated == 0) {
            throw problem(HttpStatus.CONFLICT, "APPLICATION_TERMINAL",
                    "The application already reached a terminal state");
        }
        audit("APPLICATION", applicationId, actorId, "REJECTED", current, "REJECTED", reason);
        notifyUser(String.valueOf(application.get("candidateUserId")),
                "Hồ sơ ứng tuyển bị từ chối",
                "Hồ sơ " + applicationId + " bị từ chối — " + reason, "WARNING");
        return staffApplication(actorId, applicationId);
    }

    /** Org-scoped attachment bytes (CAR-X02): only the owning org's staff. */
    @Transactional
    public Map<String, Object> staffAttachment(String actorId, String applicationId,
            String attachmentId) {
        Map<String, Object> application = findApplicationRow(applicationId);
        requireOrgGrant(actorId, String.valueOf(application.get("organizationId")));
        return findAttachmentRow(applicationId, attachmentId);
    }

    // ------------------------------------------------------------------
    // Shared helpers (also used by the candidate lane)
    // ------------------------------------------------------------------

    Map<String, Object> lockOpportunity(String opportunityId) {
        try {
            return jdbc.queryForMap(
                    "SELECT \"id\", \"organizationId\", \"status\", \"submittedBy\","
                            + " \"version\" FROM " + OPPORTUNITY
                            + " WHERE \"id\" = :id FOR UPDATE",
                    new MapSqlParameterSource("id", opportunityId));
        } catch (EmptyResultDataAccessException exception) {
            throw problem(HttpStatus.NOT_FOUND, "OPPORTUNITY_NOT_FOUND", "Opportunity not found");
        }
    }

    Map<String, Object> findOpportunityRow(String opportunityId) {
        try {
            return jdbc.queryForMap(
                    opportunitySelect() + " WHERE o.\"id\" = :id",
                    new MapSqlParameterSource("id", opportunityId));
        } catch (EmptyResultDataAccessException exception) {
            throw problem(HttpStatus.NOT_FOUND, "OPPORTUNITY_NOT_FOUND", "Opportunity not found");
        }
    }

    Map<String, Object> lockApplication(String applicationId) {
        try {
            return jdbc.queryForMap(
                    "SELECT a.\"id\", a.\"opportunityId\", a.\"candidateUserId\", a.\"status\","
                            + " a.\"version\", o.\"organizationId\""
                            + " FROM " + APPLICATION + " a"
                            + " JOIN " + OPPORTUNITY + " o ON o.\"id\" = a.\"opportunityId\""
                            + " WHERE a.\"id\" = :id FOR UPDATE",
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

    Map<String, Object> findAttachmentRow(String applicationId, String attachmentId) {
        try {
            return jdbc.queryForMap(
                    "SELECT \"id\", \"applicationId\", \"fileName\", \"contentType\","
                            + " \"checksum\", \"data\", \"uploadedBy\", \"createdAt\""
                            + " FROM " + ATTACHMENT
                            + " WHERE \"id\" = :id AND \"applicationId\" = :app",
                    new MapSqlParameterSource("id", attachmentId).addValue("app", applicationId));
        } catch (EmptyResultDataAccessException exception) {
            throw problem(HttpStatus.NOT_FOUND, "ATTACHMENT_NOT_FOUND", "Attachment not found");
        }
    }

    List<AttachmentResponse> attachmentsOf(String applicationId) {
        return jdbc.query(
                "SELECT \"id\", \"fileName\", \"contentType\", \"checksum\", \"createdAt\""
                        + " FROM " + ATTACHMENT
                        + " WHERE \"applicationId\" = :app ORDER BY \"createdAt\"",
                new MapSqlParameterSource("app", applicationId),
                (row, index) -> mapAttachment(row));
    }

    /** One grouped read per 100 parents — list lanes never fan out a query per row. */
    Map<String, List<AttachmentResponse>> attachmentsByApplication(List<String> applicationIds) {
        if (applicationIds.isEmpty()) {
            return Map.of();
        }
        Map<String, List<AttachmentResponse>> grouped = new HashMap<>();
        for (int from = 0; from < applicationIds.size(); from += ListPaging.MAX_LIMIT) {
            List<String> batch = applicationIds.subList(from,
                    Math.min(applicationIds.size(), from + ListPaging.MAX_LIMIT));
            jdbc.query(
                    "SELECT \"applicationId\", \"id\", \"fileName\", \"contentType\", \"checksum\","
                            + " \"createdAt\" FROM " + ATTACHMENT
                            + " WHERE \"applicationId\" IN (:applicationIds)"
                            + " ORDER BY \"applicationId\", \"createdAt\", \"id\"",
                    new MapSqlParameterSource("applicationIds", batch),
                    (RowCallbackHandler) row -> grouped.computeIfAbsent(
                            row.getString("applicationId"), ignored -> new ArrayList<>())
                            .add(mapAttachment(row)));
        }
        return grouped;
    }

    void requireOpportunityTerminalGuard(Map<String, Object> opportunity) {
        String status = String.valueOf(opportunity.get("status"));
        if (TERMINAL_OPPORTUNITY_STATUSES.contains(status)) {
            throw problem(HttpStatus.CONFLICT, "OPPORTUNITY_TERMINAL",
                    "Opportunity is " + status + " and can no longer change");
        }
    }

    void requireApplicationTerminalGuard(Map<String, Object> application) {
        String status = String.valueOf(application.get("status"));
        if (TERMINAL_APPLICATION_STATUSES.contains(status)) {
            throw problem(HttpStatus.CONFLICT, "APPLICATION_TERMINAL",
                    "Application is " + status + " and can no longer change");
        }
    }

    void requireVersion(Map<String, Object> record, Integer expectedVersion) {
        int version = ((Number) record.get("version")).intValue();
        if (expectedVersion == null) {
            throw problem(HttpStatus.BAD_REQUEST, "REQUEST_VERSION_REQUIRED",
                    "expectedVersion is required");
        }
        if (expectedVersion.intValue() != version) {
            throw problem(HttpStatus.CONFLICT, "STALE_VERSION",
                    "Reload the record before retrying (version " + version + ")");
        }
    }

    private void transitionOpportunity(String opportunityId, String to, String from) {
        int updated = jdbc.update(
                "UPDATE " + OPPORTUNITY + " SET \"status\" = :to,"
                        + " \"version\" = \"version\" + 1, \"updatedAt\" = CURRENT_TIMESTAMP"
                        + " WHERE \"id\" = :id AND \"status\" = :from",
                new MapSqlParameterSource("id", opportunityId)
                        .addValue("to", to).addValue("from", from));
        if (updated == 0) {
            throw problem(HttpStatus.CONFLICT, "OPPORTUNITY_STATE_INVALID",
                    "The opportunity is no longer " + from.toLowerCase());
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

    /** candidateUserId/submittedBy ARE auth user ids — no academic indirection. */
    void notifyUser(String userId, String title, String message, String type) {
        notifications.create(new CreateNotificationCommand(
                UUID.randomUUID().toString(), userId, title, message, type,
                "/careers", Instant.now()));
    }

    OrganizationResponse mapOrganization(ResultSet row) throws SQLException {
        return new OrganizationResponse(
                row.getString("id"), row.getString("name"),
                row.getString("description"), row.getInt("version"));
    }

    OpportunityResponse mapOpportunity(Map<String, Object> row) {
        return new OpportunityResponse(
                String.valueOf(row.get("id")),
                String.valueOf(row.get("organizationId")),
                row.get("org_name") == null ? null : String.valueOf(row.get("org_name")),
                String.valueOf(row.get("title")),
                row.get("description") == null ? null : String.valueOf(row.get("description")),
                row.get("location") == null ? null : String.valueOf(row.get("location")),
                row.get("employmentType") == null ? null : String.valueOf(row.get("employmentType")),
                row.get("salaryText") == null ? null : String.valueOf(row.get("salaryText")),
                String.valueOf(row.get("status")),
                String.valueOf(row.get("submittedBy")),
                row.get("reviewedBy") == null ? null : String.valueOf(row.get("reviewedBy")),
                toInstant(row.get("reviewedAt")),
                toInstant(row.get("publishedAt")),
                toInstant(row.get("pausedAt")),
                toInstant(row.get("closedAt")),
                row.get("moderationReason") == null ? null : String.valueOf(row.get("moderationReason")),
                ((Number) row.get("version")).intValue(),
                toInstant(row.get("createdAt")));
    }

    private OpportunityResponse mapOpportunity(ResultSet row) throws SQLException {
        return new OpportunityResponse(
                row.getString("id"), row.getString("organizationId"), row.getString("org_name"),
                row.getString("title"), row.getString("description"), row.getString("location"),
                row.getString("employmentType"), row.getString("salaryText"),
                row.getString("status"), row.getString("submittedBy"), row.getString("reviewedBy"),
                toInstant(row.getTimestamp("reviewedAt")), toInstant(row.getTimestamp("publishedAt")),
                toInstant(row.getTimestamp("pausedAt")), toInstant(row.getTimestamp("closedAt")),
                row.getString("moderationReason"), row.getInt("version"),
                toInstant(row.getTimestamp("createdAt")));
    }

    ApplicationResponse mapApplication(Map<String, Object> row) {
        return mapApplication(row, attachmentsOf(String.valueOf(row.get("id"))));
    }

    ApplicationResponse mapApplication(Map<String, Object> row,
            List<AttachmentResponse> attachments) {
        return new ApplicationResponse(
                String.valueOf(row.get("id")),
                String.valueOf(row.get("opportunityId")),
                row.get("opp_title") == null ? null : String.valueOf(row.get("opp_title")),
                String.valueOf(row.get("organizationId")),
                row.get("org_name") == null ? null : String.valueOf(row.get("org_name")),
                String.valueOf(row.get("candidateUserId")),
                row.get("candidate_email") == null ? null : String.valueOf(row.get("candidate_email")),
                String.valueOf(row.get("status")),
                row.get("coverLetter") == null ? null : String.valueOf(row.get("coverLetter")),
                toInstant(row.get("submittedAt")),
                row.get("statusChangedBy") == null ? null : String.valueOf(row.get("statusChangedBy")),
                toInstant(row.get("statusChangedAt")),
                row.get("moderationReason") == null ? null : String.valueOf(row.get("moderationReason")),
                ((Number) row.get("version")).intValue(),
                toInstant(row.get("createdAt")),
                attachments);
    }

    private AttachmentResponse mapAttachment(ResultSet row) throws SQLException {
        return new AttachmentResponse(
                row.getString("id"), row.getString("fileName"), row.getString("contentType"),
                row.getString("checksum"), toInstant(row.getTimestamp("createdAt")));
    }

    private StaffGrantResponse mapGrant(ResultSet row) throws SQLException {
        return new StaffGrantResponse(
                row.getString("id"), row.getString("userId"), row.getString("scope"),
                row.getString("organizationId"), row.getString("grantedBy"),
                toInstant(row.getTimestamp("createdAt")));
    }

    private static Map<String, Object> rowToMap(ResultSet row) throws SQLException {
        var meta = row.getMetaData();
        var map = new java.util.HashMap<String, Object>();
        for (int i = 1; i <= meta.getColumnCount(); i++) {
            map.put(meta.getColumnLabel(i), row.getObject(i));
        }
        return map;
    }

    static Instant toInstant(Object value) {
        if (value == null) {
            return null;
        }
        if (value instanceof Instant instant) {
            return instant;
        }
        if (value instanceof Timestamp timestamp) {
            return timestamp.toInstant();
        }
        return Instant.parse(String.valueOf(value));
    }

    static DomainException problem(HttpStatus status, String code, String message) {
        return new DomainException(status, code, message);
    }
}
