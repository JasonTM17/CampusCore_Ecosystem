package io.campuscore.restfulapi.careers.web;

import io.campuscore.restfulapi.careers.service.CareerService;
import io.campuscore.restfulapi.careers.web.CareerDtos.ApplicationResponse;
import io.campuscore.restfulapi.careers.web.CareerDtos.ApplicationTransitionRequest;
import io.campuscore.restfulapi.careers.web.CareerDtos.CreateOpportunityRequest;
import io.campuscore.restfulapi.careers.web.CareerDtos.GrantRequest;
import io.campuscore.restfulapi.careers.web.CareerDtos.OpportunityResponse;
import io.campuscore.restfulapi.careers.web.CareerDtos.OrganizationResponse;
import io.campuscore.restfulapi.careers.web.CareerDtos.StaffGrantResponse;
import io.campuscore.restfulapi.careers.web.CareerDtos.TransitionRequest;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import java.util.List;
import org.springframework.context.annotation.Profile;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * Org-scoped recruiter + platform reviewer careers surface (contract §9).
 *
 * <p>Two authority lanes share this controller; both are grant-gated
 * inside the service (§1.1 — route auth is never the domain authority):
 *
 * <ul>
 *   <li>{@code STAFF:careers:<org>} — create/submit/pause/close postings
 *       and act on applications only inside the granted org (CAR-X01).
 *   <li>{@code STAFF:careers} (orgId '') — moderation queue; publish or
 *       reject IN_REVIEW postings, never the reviewer's own submission
 *       (CAR-T02).
 * </ul>
 *
 * <p>Grant administration itself requires the ADMIN role — a staff grant
 * cannot reproduce itself.
 */
@Tag(name = "Careers staff", description = "Tin tuyển dụng theo tổ chức, duyệt đăng, xét hồ sơ")
@RestController
@Profile("persistence")
@RequestMapping("/api/v1/careers/staff")
public class CareerStaffController {

    private final CareerService careers;

    public CareerStaffController(CareerService careers) {
        this.careers = careers;
    }

    // ------------------------- grants ---------------------------------

    @Operation(summary = "Danh sách grants careers (org/reviewer)")
    @GetMapping("/grants")
    @PreAuthorize("isAuthenticated()")
    public List<StaffGrantResponse> grants(@AuthenticationPrincipal Jwt jwt) {
        return careers.listGrants(staff(jwt));
    }

    @Operation(summary = "Cấp grant theo tổ chức hoặc reviewer (admin)")
    @PostMapping("/grants")
    @ResponseStatus(HttpStatus.CREATED)
    @PreAuthorize("isAuthenticated()")
    public StaffGrantResponse grant(
            @AuthenticationPrincipal Jwt jwt,
            @RequestBody GrantRequest request) {
        return careers.grantStaff(staff(jwt), roles(jwt),
                request == null ? null : request.userId(),
                request == null ? null : request.organizationId());
    }

    @Operation(summary = "Thu hồi grant careers (admin)")
    @PostMapping("/grants/{grantId}/revoke")
    @PreAuthorize("isAuthenticated()")
    public ResponseEntity<Void> revoke(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable String grantId) {
        careers.revokeStaff(staff(jwt), roles(jwt), grantId);
        return ResponseEntity.noContent().build();
    }

    // ------------------------- organizations --------------------------

    @Operation(summary = "Tổ chức tôi được gán recruiter")
    @GetMapping("/organizations/my")
    @PreAuthorize("isAuthenticated()")
    public List<OrganizationResponse> myOrganizations(@AuthenticationPrincipal Jwt jwt) {
        return careers.myOrganizations(staff(jwt));
    }

    // ------------------------- opportunities --------------------------

    @Operation(summary = "Hàng đợi tin tuyển dụng của các tổ chức tôi quản")
    @GetMapping("/opportunities")
    @PreAuthorize("isAuthenticated()")
    public List<OpportunityResponse> opportunityQueue(
            @AuthenticationPrincipal Jwt jwt,
            @RequestParam(required = false) String status) {
        return careers.opportunityQueue(staff(jwt), status);
    }

    @Operation(summary = "Tạo tin DRAFT trong tổ chức tôi quản")
    @PostMapping("/opportunities")
    @ResponseStatus(HttpStatus.CREATED)
    @PreAuthorize("isAuthenticated()")
    public OpportunityResponse createOpportunity(
            @AuthenticationPrincipal Jwt jwt,
            @RequestBody CreateOpportunityRequest request) {
        return careers.createOpportunity(staff(jwt), request);
    }

    @Operation(summary = "Chi tiết tin trong phạm vi tổ chức")
    @GetMapping("/opportunities/{opportunityId}")
    @PreAuthorize("isAuthenticated()")
    public OpportunityResponse staffOpportunity(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable String opportunityId) {
        return careers.staffOpportunity(staff(jwt), opportunityId);
    }

    @Operation(summary = "DRAFT → IN_REVIEW (nộp duyệt)")
    @PostMapping("/opportunities/{opportunityId}/submit-review")
    @PreAuthorize("isAuthenticated()")
    public OpportunityResponse submitReview(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable String opportunityId,
            @RequestBody(required = false) TransitionRequest request) {
        return careers.submitReview(staff(jwt), opportunityId,
                request == null ? null : request.expectedVersion());
    }

    @Operation(summary = "PUBLISHED → PAUSED (kèm lý do)")
    @PostMapping("/opportunities/{opportunityId}/pause")
    @PreAuthorize("isAuthenticated()")
    public OpportunityResponse pause(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable String opportunityId,
            @RequestBody TransitionRequest request) {
        return careers.pause(staff(jwt), opportunityId, request);
    }

    @Operation(summary = "PAUSED → PUBLISHED (mở lại)")
    @PostMapping("/opportunities/{opportunityId}/resume")
    @PreAuthorize("isAuthenticated()")
    public OpportunityResponse resume(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable String opportunityId,
            @RequestBody(required = false) TransitionRequest request) {
        return careers.resume(staff(jwt), opportunityId,
                request == null ? null : request.expectedVersion());
    }

    @Operation(summary = "→ CLOSED (kèm lý do, dừng nhận hồ sơ)")
    @PostMapping("/opportunities/{opportunityId}/close")
    @PreAuthorize("isAuthenticated()")
    public OpportunityResponse close(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable String opportunityId,
            @RequestBody TransitionRequest request) {
        return careers.close(staff(jwt), opportunityId, request);
    }

    // ------------------------- reviewer moderation --------------------

    @Operation(summary = "Hàng đợi IN_REVIEW (chỉ reviewer)")
    @GetMapping("/review-queue")
    @PreAuthorize("isAuthenticated()")
    public List<OpportunityResponse> reviewQueue(@AuthenticationPrincipal Jwt jwt) {
        return careers.reviewQueue(staff(jwt));
    }

    @Operation(summary = "IN_REVIEW → PUBLISHED (reviewer ≠ người nộp)")
    @PostMapping("/opportunities/{opportunityId}/publish")
    @PreAuthorize("isAuthenticated()")
    public OpportunityResponse publish(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable String opportunityId,
            @RequestBody(required = false) TransitionRequest request) {
        return careers.publish(staff(jwt), opportunityId,
                request == null ? null : request.expectedVersion());
    }

    @Operation(summary = "IN_REVIEW → REJECTED (kèm moderation reason)")
    @PostMapping("/opportunities/{opportunityId}/reject")
    @PreAuthorize("isAuthenticated()")
    public OpportunityResponse rejectOpportunity(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable String opportunityId,
            @RequestBody TransitionRequest request) {
        return careers.rejectOpportunity(staff(jwt), opportunityId, request);
    }

    // ------------------------- applications ---------------------------

    @Operation(summary = "Hàng đợi hồ sơ trong các tổ chức tôi quản")
    @GetMapping("/applications")
    @PreAuthorize("isAuthenticated()")
    public List<ApplicationResponse> applicationQueue(
            @AuthenticationPrincipal Jwt jwt,
            @RequestParam(required = false) String opportunityId,
            @RequestParam(required = false) String status) {
        return careers.applicationQueue(staff(jwt), opportunityId, status);
    }

    @Operation(summary = "Chi tiết hồ sơ trong phạm vi tổ chức")
    @GetMapping("/applications/{applicationId}")
    @PreAuthorize("isAuthenticated()")
    public ApplicationResponse staffApplication(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable String applicationId) {
        return careers.staffApplication(staff(jwt), applicationId);
    }

    @Operation(summary = "SUBMITTED→REVIEWING→INTERVIEW→OFFER (từng bước)")
    @PostMapping("/applications/{applicationId}/transition")
    @PreAuthorize("isAuthenticated()")
    public ApplicationResponse transition(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable String applicationId,
            @RequestBody ApplicationTransitionRequest request) {
        return careers.transitionApplication(staff(jwt), applicationId, request);
    }

    @Operation(summary = "→ REJECTED (kèm moderation reason)")
    @PostMapping("/applications/{applicationId}/reject")
    @PreAuthorize("isAuthenticated()")
    public ApplicationResponse rejectApplication(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable String applicationId,
            @RequestBody TransitionRequest request) {
        return careers.rejectApplication(staff(jwt), applicationId, request);
    }

    @Operation(summary = "Tải tệp đính kèm hồ sơ trong phạm vi tổ chức")
    @GetMapping("/applications/{applicationId}/attachments/{attachmentId}/download")
    @PreAuthorize("isAuthenticated()")
    public ResponseEntity<byte[]> downloadAttachment(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable String applicationId,
            @PathVariable String attachmentId) {
        return CareerCandidateController.fileResponse(
                careers.staffAttachment(staff(jwt), applicationId, attachmentId));
    }

    private static String staff(Jwt jwt) {
        if (jwt == null || jwt.getSubject() == null || jwt.getSubject().isBlank()) {
            throw new AccessDeniedException("Not authenticated");
        }
        return jwt.getSubject();
    }

    private static List<String> roles(Jwt jwt) {
        List<String> roles = jwt.getClaimAsStringList("roles");
        return roles == null ? List.of() : roles;
    }
}
