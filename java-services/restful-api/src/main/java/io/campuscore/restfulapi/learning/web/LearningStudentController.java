package io.campuscore.restfulapi.learning.web;

import io.campuscore.restfulapi.admissions.web.MultipartAttachment;
import io.campuscore.restfulapi.learning.service.LearningStudentService;
import io.campuscore.restfulapi.learning.web.LearningDtos.AssignmentResponse;
import io.campuscore.restfulapi.learning.web.LearningDtos.FeedbackResponse;
import io.campuscore.restfulapi.learning.web.LearningDtos.MaterialResponse;
import io.campuscore.restfulapi.learning.web.LearningDtos.SubmissionResponse;
import io.campuscore.restfulapi.learning.web.LearningDtos.SubmissionRevisionResponse;
import io.campuscore.restfulapi.learning.web.LearningDtos.SubmissionUpsertRequest;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import java.util.List;
import java.util.Map;
import org.springframework.context.annotation.Profile;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
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

/** P09 LMS student surface. Authority is the caller's studentId claim bound to
 * an active enrollment in the assignment's section; another student's
 * submission is a 404 (contract §1.1), never a 403 oracle. */
@RestController
@Profile("persistence")
@RequestMapping("/api/v1/learning")
public class LearningStudentController {

    private final LearningStudentService learning;

    public LearningStudentController(LearningStudentService learning) {
        this.learning = learning;
    }

    @Operation(summary = "Các lớp học phần đang học (roster học tập)")
    @GetMapping("/sections")
    @PreAuthorize("isAuthenticated()")
    public List<Map<String, Object>> mySections(@AuthenticationPrincipal Jwt jwt) {
        return learning.mySections(student(jwt));
    }

    @Operation(summary = "Học liệu của lớp học phần (sinh viên đang học)")
    @GetMapping("/sections/{sectionId}/materials")
    @PreAuthorize("isAuthenticated()")
    public List<MaterialResponse> listMaterials(
            @AuthenticationPrincipal Jwt jwt,
            @Parameter(description = "Mã lớp học phần") @PathVariable String sectionId) {
        return learning.listMaterials(student(jwt), sectionId);
    }

    @Operation(summary = "Tải tệp học liệu (sinh viên đang học)")
    @GetMapping("/materials/{materialId}/file")
    @PreAuthorize("isAuthenticated()")
    public ResponseEntity<byte[]> downloadMaterial(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable String materialId) {
        return LearningStaffController.fileResponse(
                learning.downloadMaterial(student(jwt), materialId));
    }

    @Operation(summary = "Bài tập của lớp học phần (không gồm nháp)")
    @GetMapping("/sections/{sectionId}/assignments")
    @PreAuthorize("isAuthenticated()")
    public List<AssignmentResponse> listAssignments(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable String sectionId) {
        return learning.listAssignments(student(jwt), sectionId);
    }

    @Operation(summary = "Chi tiết bài tập (sinh viên đang học)")
    @GetMapping("/assignments/{assignmentId}")
    @PreAuthorize("isAuthenticated()")
    public AssignmentResponse assignment(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable String assignmentId) {
        return learning.assignment(student(jwt), assignmentId);
    }

    @Operation(summary = "Mở nháp bài nộp — idempotent (LMS-T03)")
    @PostMapping("/assignments/{assignmentId}/draft")
    @ResponseStatus(HttpStatus.CREATED)
    @PreAuthorize("isAuthenticated()")
    public SubmissionResponse openDraft(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable String assignmentId,
            @Parameter(description = "Khóa chống gửi trùng") @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey) {
        return learning.ensureDraft(student(jwt), assignmentId, idempotencyKey);
    }

    @Operation(summary = "Lưu nội dung nháp (văn bản + tệp đính kèm)")
    @PutMapping("/submissions/{submissionId}/draft")
    @PreAuthorize("isAuthenticated()")
    public SubmissionResponse saveDraft(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable String submissionId,
            @RequestBody SubmissionUpsertRequest request) {
        return learning.saveDraft(student(jwt), submissionId, request);
    }

    @Operation(summary = "Lưu nội dung nháp dạng multipart (cùng quy tắc với bản base64)")
    @PutMapping(value = "/submissions/{submissionId}/draft", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @PreAuthorize("isAuthenticated()")
    public SubmissionResponse saveDraftMultipart(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable String submissionId,
            @RequestParam(value = "textBody", required = false) String textBody,
            @RequestParam(value = "checksum", required = false) String checksum,
            @RequestPart(value = "file", required = false) MultipartFile file) {
        return learning.saveDraft(student(jwt), submissionId, upsert(textBody, checksum, file));
    }

    @Operation(summary = "Nộp bài — deadline theo đồng hồ máy chủ (LMS-X01), revision bất biến (LMS-X02)")
    @PostMapping("/assignments/{assignmentId}/submit")
    @PreAuthorize("isAuthenticated()")
    public SubmissionResponse submit(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable String assignmentId,
            @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey) {
        return learning.submit(student(jwt), assignmentId, idempotencyKey);
    }

    @Operation(summary = "Nộp lại sau khi bị trả (LMS-T05) — tạo revision mới, không ghi đè")
    @PostMapping("/assignments/{assignmentId}/resubmit")
    @PreAuthorize("isAuthenticated()")
    public SubmissionResponse resubmit(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable String assignmentId,
            @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey,
            @RequestBody SubmissionUpsertRequest request) {
        return learning.resubmit(student(jwt), assignmentId, idempotencyKey, request);
    }

    @Operation(summary = "Nộp lại dạng multipart (cùng quy tắc với bản base64)")
    @PostMapping(value = "/assignments/{assignmentId}/resubmit", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @PreAuthorize("isAuthenticated()")
    public SubmissionResponse resubmitMultipart(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable String assignmentId,
            @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey,
            @RequestParam(value = "textBody", required = false) String textBody,
            @RequestParam(value = "checksum", required = false) String checksum,
            @RequestPart(value = "file", required = false) MultipartFile file) {
        return learning.resubmit(student(jwt), assignmentId, idempotencyKey,
                upsert(textBody, checksum, file));
    }

    @Operation(summary = "Bài nộp của tôi trong lớp học phần")
    @GetMapping("/sections/{sectionId}/submissions")
    @PreAuthorize("isAuthenticated()")
    public List<SubmissionResponse> mySubmissions(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable String sectionId) {
        return learning.mySubmissions(student(jwt), sectionId);
    }

    @Operation(summary = "Chi tiết bài nộp của tôi")
    @GetMapping("/submissions/{submissionId}")
    @PreAuthorize("isAuthenticated()")
    public SubmissionResponse mySubmission(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable String submissionId) {
        return learning.mySubmission(student(jwt), submissionId);
    }

    @Operation(summary = "Lịch sử revision của bài nộp của tôi")
    @GetMapping("/submissions/{submissionId}/revisions")
    @PreAuthorize("isAuthenticated()")
    public List<SubmissionRevisionResponse> myRevisions(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable String submissionId) {
        return learning.myRevisions(student(jwt), submissionId);
    }

    @Operation(summary = "Phản hồi trên bài nộp của tôi")
    @GetMapping("/submissions/{submissionId}/feedback")
    @PreAuthorize("isAuthenticated()")
    public List<FeedbackResponse> myFeedback(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable String submissionId) {
        return learning.myFeedback(student(jwt), submissionId);
    }

    @Operation(summary = "Tải tệp revision của tôi (LMS-T07 — chỉ chủ bài)")
    @GetMapping("/revisions/{revisionId}/file")
    @PreAuthorize("isAuthenticated()")
    public ResponseEntity<byte[]> downloadRevision(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable String revisionId) {
        return LearningStaffController.fileResponse(
                learning.downloadRevision(student(jwt), revisionId));
    }

    private static SubmissionUpsertRequest upsert(String textBody, String checksum, MultipartFile file) {
        MultipartAttachment.Payload payload = MultipartAttachment.optional(file, MultipartAttachment.COURSEWORK);
        return payload == null
                ? new SubmissionUpsertRequest(textBody, null, null, null, null)
                : new SubmissionUpsertRequest(textBody, payload.fileName(), payload.contentType(),
                        payload.contentBase64(), checksum);
    }

    private static String student(Jwt jwt) {
        String studentId = jwt.getClaimAsString("studentId");
        if (studentId == null || studentId.isBlank()) {
            throw new io.campuscore.restfulapi.web.DomainException(HttpStatus.FORBIDDEN,
                    "STUDENT_SCOPE_REQUIRED", "This account is not linked to a student");
        }
        return studentId;
    }
}
