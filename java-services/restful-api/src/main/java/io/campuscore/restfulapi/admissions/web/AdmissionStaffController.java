package io.campuscore.restfulapi.admissions.web;

import io.campuscore.restfulapi.admissions.service.AdmissionService;
import io.campuscore.restfulapi.admissions.web.AdmissionDtos.ApplicationResponse;
import io.campuscore.restfulapi.admissions.web.AdmissionDtos.DecisionRequest;
import io.campuscore.restfulapi.admissions.web.AdmissionDtos.ReturnApplicationRequest;
import io.campuscore.restfulapi.admissions.web.AdmissionDtos.StaffGrantResponse;
import io.campuscore.restfulapi.admissions.web.AdmissionDtos.TransitionRequest;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import java.util.List;
import java.util.Map;
import org.springframework.context.annotation.Profile;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * Staff admissions surface (contract §7). Coarse gate is authentication; the
 * scoped {@code STAFF:admissions} grant is enforced inside the service for
 * staff operations. ADMIN may list grant metadata and manage grants, but the
 * role does not confer admissions-record access (§1.1).
 */
@Tag(name = "Admissions Staff", description = "Hàng đợi tuyển sinh mô phỏng: claim, trả hồ sơ, quyết định, grants")
@RestController
@Profile("persistence")
@RequestMapping("/api/v1/admissions/staff")
public class AdmissionStaffController {

    private final AdmissionService admissions;

    public AdmissionStaffController(AdmissionService admissions) {
        this.admissions = admissions;
    }

    @Operation(summary = "Hàng đợi hồ sơ (lọc theo trạng thái)")
    @GetMapping("/queue")
    @PreAuthorize("isAuthenticated()")
    public List<ApplicationResponse> queue(
            @AuthenticationPrincipal Jwt jwt,
            @RequestParam(required = false) String status) {
        return admissions.queue(staff(jwt), status);
    }

    @Operation(summary = "Chi tiết hồ sơ (staff)")
    @GetMapping("/applications/{applicationId}")
    @PreAuthorize("isAuthenticated()")
    public ApplicationResponse detail(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable String applicationId) {
        return admissions.staffApplication(staff(jwt), applicationId);
    }

    @Operation(summary = "Nhận duyệt hồ sơ (SUBMITTED → IN_REVIEW)")
    @PostMapping("/applications/{applicationId}/claim")
    @PreAuthorize("isAuthenticated()")
    public ApplicationResponse claim(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable String applicationId,
            @RequestBody(required = false) TransitionRequest request) {
        return admissions.claim(staff(jwt), applicationId,
                request == null ? null : request.expectedVersion());
    }

    @Operation(summary = "Trả hồ sơ kèm checklist (IN_REVIEW → RETURNED)")
    @PostMapping("/applications/{applicationId}/return")
    @PreAuthorize("isAuthenticated()")
    public ApplicationResponse returnApplication(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable String applicationId,
            @RequestBody ReturnApplicationRequest request) {
        return admissions.returnApplication(staff(jwt), applicationId, request);
    }

    @Operation(summary = "Quyết định mô phỏng (IN_REVIEW → ACCEPTED|REJECTED)")
    @PostMapping("/applications/{applicationId}/decision")
    @PreAuthorize("isAuthenticated()")
    public ApplicationResponse decide(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable String applicationId,
            @RequestBody DecisionRequest request) {
        return admissions.decide(staff(jwt), applicationId, request);
    }

    @Operation(summary = "Tải nội dung tệp đính kèm (staff)")
    @GetMapping("/applications/{applicationId}/attachments/{attachmentId}/file")
    @PreAuthorize("isAuthenticated()")
    public ResponseEntity<byte[]> downloadAttachment(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable String applicationId,
            @PathVariable String attachmentId) {
        return AdmissionApplicantController.fileResponse(
                admissions.staffAttachmentFile(staff(jwt), applicationId, attachmentId));
    }

    @Operation(summary = "Danh sách staff grants")
    @GetMapping("/grants")
    @PreAuthorize("isAuthenticated()")
    public List<StaffGrantResponse> grants(@AuthenticationPrincipal Jwt jwt) {
        return admissions.listGrants(staff(jwt), roles(jwt));
    }

    @Operation(summary = "Cấp grant STAFF:admissions (admin)")
    @PostMapping("/grants")
    @ResponseStatus(HttpStatus.CREATED)
    @PreAuthorize("isAuthenticated()")
    public StaffGrantResponse grant(
            @AuthenticationPrincipal Jwt jwt,
            @RequestBody Map<String, String> request) {
        return admissions.grantStaff(staff(jwt), roles(jwt),
                request == null ? null : request.get("userId"));
    }

    @Operation(summary = "Thu hồi grant (admin)")
    @DeleteMapping("/grants/{grantId}")
    @PreAuthorize("isAuthenticated()")
    public void revoke(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable String grantId) {
        admissions.revokeStaff(staff(jwt), roles(jwt), grantId);
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
