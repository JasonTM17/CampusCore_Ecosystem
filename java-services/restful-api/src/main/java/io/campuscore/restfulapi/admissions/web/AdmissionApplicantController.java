package io.campuscore.restfulapi.admissions.web;

import io.campuscore.restfulapi.admissions.service.AdmissionApplicantService;
import io.campuscore.restfulapi.admissions.web.AdmissionDtos.ApplicationResponse;
import io.campuscore.restfulapi.admissions.web.AdmissionDtos.AttachmentUploadRequest;
import io.campuscore.restfulapi.admissions.web.AdmissionDtos.CreateApplicationRequest;
import io.campuscore.restfulapi.admissions.web.AdmissionDtos.SaveApplicationRequest;
import io.campuscore.restfulapi.admissions.web.AdmissionDtos.TransitionRequest;
import io.campuscore.restfulapi.events.web.ListPaging;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.headers.Header;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import java.util.List;
import java.util.Map;
import org.springframework.context.annotation.Profile;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RequestPart;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

/**
 * Applicant admissions surface (contract §7). The applicant is the auth user
 * (jwt.sub); every lane is owner-scoped with indistinguishable 404 for foreign
 * ids. Mutating calls accept Idempotency-Key (§1.3) and optimistic
 * expectedVersion.
 */
@Tag(name = "Admissions", description = "Tuyển sinh mô phỏng: hồ sơ, đính kèm, nộp/rút hồ sơ")
@RestController
@Profile("persistence")
@RequestMapping("/api/v1/admissions/applications")
public class AdmissionApplicantController {

    private final AdmissionApplicantService admissions;

    public AdmissionApplicantController(AdmissionApplicantService admissions) {
        this.admissions = admissions;
    }

    @Operation(summary = "Danh sách hồ sơ của tôi")
    @ApiResponse(responseCode = "200", description = "Danh sách hồ sơ", headers = @Header(
            name = ListPaging.TOTAL_COUNT_HEADER, description = ListPaging.TOTAL_COUNT_DOC,
            schema = @Schema(type = "integer")))
    @GetMapping("/my")
    @PreAuthorize("isAuthenticated()")
    public ResponseEntity<List<ApplicationResponse>> myApplications(
            @AuthenticationPrincipal Jwt jwt,
            HttpServletRequest request,
            @Parameter(description = ListPaging.PAGE_DOC) @RequestParam(required = false) Integer page,
            @Parameter(description = ListPaging.LIMIT_DOC) @RequestParam(required = false) Integer limit) {
        ListPaging.Window window = ListPaging.Window.of(page, limit, request);
        return ListPaging.respond(admissions.myApplications(applicant(jwt), window));
    }

    @Operation(summary = "Tạo hồ sơ nháp cho một đợt tuyển")
    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    @PreAuthorize("isAuthenticated()")
    public ApplicationResponse create(
            @AuthenticationPrincipal Jwt jwt,
            @Valid @RequestBody CreateApplicationRequest request,
            @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey) {
        return admissions.create(applicant(jwt), request, idempotencyKey);
    }

    @Operation(summary = "Chi tiết hồ sơ của tôi")
    @GetMapping("{applicationId}")
    @PreAuthorize("isAuthenticated()")
    public ApplicationResponse detail(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable String applicationId) {
        return admissions.myApplication(applicant(jwt), applicationId);
    }

    @Operation(summary = "Lưu trường hồ sơ nháp (optimistic version)")
    @PutMapping("{applicationId}")
    @PreAuthorize("isAuthenticated()")
    public ApplicationResponse save(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable String applicationId,
            @Valid @RequestBody SaveApplicationRequest request) {
        return admissions.save(applicant(jwt), applicationId, request);
    }

    @Operation(summary = "Nộp hồ sơ (DRAFT hoặc RETURNED)")
    @PostMapping("{applicationId}/submit")
    @PreAuthorize("isAuthenticated()")
    public ApplicationResponse submit(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable String applicationId,
            @RequestBody(required = false) TransitionRequest request,
            @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey) {
        return admissions.submit(applicant(jwt), applicationId,
                request == null ? null : request.expectedVersion(), idempotencyKey);
    }

    @Operation(summary = "Rút hồ sơ (khi còn cho phép)")
    @PostMapping("{applicationId}/withdraw")
    @PreAuthorize("isAuthenticated()")
    public ApplicationResponse withdraw(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable String applicationId,
            @RequestBody(required = false) TransitionRequest request,
            @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey) {
        return admissions.withdraw(applicant(jwt), applicationId,
                request == null ? null : request.expectedVersion(), idempotencyKey);
    }

    @Operation(summary = "Tải tệp đính kèm (checksum-bound)")
    @PostMapping("{applicationId}/attachments")
    @ResponseStatus(HttpStatus.CREATED)
    @PreAuthorize("isAuthenticated()")
    public ApplicationResponse uploadAttachment(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable String applicationId,
            @RequestBody AttachmentUploadRequest request,
            @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey) {
        return admissions.uploadAttachment(applicant(jwt), applicationId, request, idempotencyKey);
    }

    @Operation(summary = "Tải tệp đính kèm dạng multipart (cùng quy tắc với bản base64)")
    @PostMapping(value = "{applicationId}/attachments", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @ResponseStatus(HttpStatus.CREATED)
    @PreAuthorize("isAuthenticated()")
    public ApplicationResponse uploadAttachmentMultipart(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable String applicationId,
            @RequestPart(value = "file", required = false) MultipartFile file,
            @RequestParam(value = "checksum", required = false) String checksum,
            @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey) {
        MultipartAttachment.Payload payload = MultipartAttachment.required(file, MultipartAttachment.DOCUMENTS);
        return admissions.uploadAttachment(applicant(jwt), applicationId,
                new AttachmentUploadRequest(payload.fileName(), payload.contentType(),
                        payload.contentBase64(), checksum),
                idempotencyKey);
    }

    @Operation(summary = "Xóa tệp đính kèm (dọn byte, không để orphan)")
    @DeleteMapping("{applicationId}/attachments/{attachmentId}")
    @PreAuthorize("isAuthenticated()")
    public ApplicationResponse deleteAttachment(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable String applicationId,
            @PathVariable String attachmentId,
            @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey) {
        return admissions.deleteAttachment(applicant(jwt), applicationId, attachmentId, idempotencyKey);
    }

    @Operation(summary = "Tải nội dung tệp (chỉ chủ hồ sơ)")
    @GetMapping("{applicationId}/attachments/{attachmentId}/file")
    @PreAuthorize("isAuthenticated()")
    public ResponseEntity<byte[]> downloadAttachment(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable String applicationId,
            @PathVariable String attachmentId) {
        return fileResponse(admissions.attachmentFile(applicant(jwt), applicationId, attachmentId));
    }

    static ResponseEntity<byte[]> fileResponse(Map<String, Object> file) {
        Object data = file.get("data");
        byte[] bytes = data instanceof byte[] raw ? raw : new byte[0];
        String fileName = file.get("fileName") == null ? "file"
                : String.valueOf(file.get("fileName"));
        String encoded = java.net.URLEncoder.encode(fileName, java.nio.charset.StandardCharsets.UTF_8)
                .replace("+", "%20");
        Object contentType = file.get("content_type");
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION,
                        "attachment; filename*=UTF-8''" + encoded)
                .header(HttpHeaders.CACHE_CONTROL, "no-store")
                .contentType(MediaType.parseMediaType(
                        contentType == null ? MediaType.APPLICATION_OCTET_STREAM_VALUE
                                : String.valueOf(contentType)))
                .body(bytes);
    }

    private static String applicant(Jwt jwt) {
        if (jwt == null || jwt.getSubject() == null || jwt.getSubject().isBlank()) {
            throw new AccessDeniedException("Not authenticated");
        }
        return jwt.getSubject();
    }
}
