package io.campuscore.restfulapi.careers.web;

import io.campuscore.restfulapi.careers.service.CareerCandidateService;
import io.campuscore.restfulapi.careers.service.CareerService;
import io.campuscore.restfulapi.careers.web.CareerDtos.ApplicationResponse;
import io.campuscore.restfulapi.careers.web.CareerDtos.ApplyRequest;
import io.campuscore.restfulapi.careers.web.CareerDtos.AttachmentUploadRequest;
import io.campuscore.restfulapi.careers.web.CareerDtos.OpportunityResponse;
import io.campuscore.restfulapi.careers.web.CareerDtos.OrganizationResponse;
import io.campuscore.restfulapi.careers.web.CareerDtos.TransitionRequest;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import java.util.List;
import java.util.Map;
import org.springframework.context.annotation.Profile;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * Candidate careers surface (contract §9): published-opportunity browse,
 * apply, own application history, withdraw and own attachments. Every
 * mutating lane takes an Idempotency-Key header (§1.3); candidate reads
 * are owner-scoped so foreign ids answer the same 404 a missing id does.
 */
@Tag(name = "Careers", description = "Việc làm mô phỏng: tin tuyển dụng, ứng tuyển, rút hồ sơ")
@RestController
@Profile("persistence")
@RequestMapping("/api/v1/careers")
public class CareerCandidateController {

    private final CareerCandidateService candidates;
    private final CareerService careers;

    public CareerCandidateController(CareerCandidateService candidates, CareerService careers) {
        this.candidates = candidates;
        this.careers = careers;
    }

    @Operation(summary = "Danh mục tổ chức tuyển dụng")
    @GetMapping("/organizations")
    @PreAuthorize("isAuthenticated()")
    public List<OrganizationResponse> organizations() {
        return careers.organizations();
    }

    @Operation(summary = "Tin tuyển dụng đang đăng (PUBLISHED)")
    @GetMapping("/opportunities")
    @PreAuthorize("isAuthenticated()")
    public List<OpportunityResponse> opportunities(
            @RequestParam(required = false) String query) {
        return candidates.browse(query);
    }

    @Operation(summary = "Chi tiết tin đang đăng")
    @GetMapping("/opportunities/{opportunityId}")
    @PreAuthorize("isAuthenticated()")
    public OpportunityResponse opportunity(@PathVariable String opportunityId) {
        return candidates.browseOne(opportunityId);
    }

    @Operation(summary = "Hồ sơ ứng tuyển của tôi")
    @GetMapping("/applications/my")
    @PreAuthorize("isAuthenticated()")
    public List<ApplicationResponse> myApplications(@AuthenticationPrincipal Jwt jwt) {
        return candidates.myApplications(candidate(jwt));
    }

    @Operation(summary = "Chi tiết hồ sơ của tôi (chủ sở hữu)")
    @GetMapping("/applications/{applicationId}")
    @PreAuthorize("isAuthenticated()")
    public ApplicationResponse myApplication(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable String applicationId) {
        return candidates.myApplication(candidate(jwt), applicationId);
    }

    @Operation(summary = "Ứng tuyển một tin PUBLISHED (→ SUBMITTED)")
    @PostMapping("/applications")
    @PreAuthorize("isAuthenticated()")
    public ApplicationResponse apply(
            @AuthenticationPrincipal Jwt jwt,
            @RequestBody ApplyRequest request,
            @RequestHeader(name = "Idempotency-Key", required = false) String idempotencyKey) {
        return candidates.apply(candidate(jwt), request, idempotencyKey);
    }

    @Operation(summary = "Rút hồ sơ trước trạng thái kết thúc (→ WITHDRAWN)")
    @PostMapping("/applications/{applicationId}/withdraw")
    @PreAuthorize("isAuthenticated()")
    public ApplicationResponse withdraw(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable String applicationId,
            @RequestBody(required = false) TransitionRequest request,
            @RequestHeader(name = "Idempotency-Key", required = false) String idempotencyKey) {
        return candidates.withdraw(candidate(jwt), applicationId,
                request == null ? null : request.expectedVersion(), idempotencyKey);
    }

    @Operation(summary = "Tải hồ sơ đính kèm lên đơn của tôi")
    @PostMapping("/applications/{applicationId}/attachments")
    @PreAuthorize("isAuthenticated()")
    public ApplicationResponse uploadAttachment(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable String applicationId,
            @RequestBody AttachmentUploadRequest request,
            @RequestHeader(name = "Idempotency-Key", required = false) String idempotencyKey) {
        return candidates.uploadAttachment(candidate(jwt), applicationId, request, idempotencyKey);
    }

    @Operation(summary = "Tải xuống tệp đính kèm của tôi")
    @GetMapping("/applications/{applicationId}/attachments/{attachmentId}/download")
    @PreAuthorize("isAuthenticated()")
    public ResponseEntity<byte[]> downloadAttachment(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable String applicationId,
            @PathVariable String attachmentId) {
        return fileResponse(
                candidates.ownAttachment(candidate(jwt), applicationId, attachmentId));
    }

    static ResponseEntity<byte[]> fileResponse(Map<String, Object> file) {
        Object data = file.get("data");
        byte[] bytes = data instanceof byte[] raw ? raw : new byte[0];
        String fileName = file.get("fileName") == null ? "file"
                : String.valueOf(file.get("fileName"));
        String encoded = java.net.URLEncoder.encode(fileName, java.nio.charset.StandardCharsets.UTF_8)
                .replace("+", "%20");
        Object contentType = file.get("contentType") == null
                ? file.get("content_type") : file.get("contentType");
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION,
                        "attachment; filename*=UTF-8''" + encoded)
                .header(HttpHeaders.CACHE_CONTROL, "no-store")
                .contentType(MediaType.parseMediaType(
                        contentType == null ? MediaType.APPLICATION_OCTET_STREAM_VALUE
                                : String.valueOf(contentType)))
                .body(bytes);
    }

    private static String candidate(Jwt jwt) {
        if (jwt == null || jwt.getSubject() == null || jwt.getSubject().isBlank()) {
            throw new AccessDeniedException("Not authenticated");
        }
        return jwt.getSubject();
    }
}
