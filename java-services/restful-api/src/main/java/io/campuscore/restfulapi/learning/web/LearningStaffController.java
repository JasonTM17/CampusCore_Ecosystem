package io.campuscore.restfulapi.learning.web;

import io.campuscore.restfulapi.learning.service.LearningService;
import io.campuscore.restfulapi.learning.web.LearningDtos.AssignmentResponse;
import io.campuscore.restfulapi.learning.web.LearningDtos.AssignmentUpsertRequest;
import io.campuscore.restfulapi.learning.web.LearningDtos.FeedbackResponse;
import io.campuscore.restfulapi.learning.web.LearningDtos.MaterialResponse;
import io.campuscore.restfulapi.learning.web.LearningDtos.MaterialUpsertRequest;
import io.campuscore.restfulapi.learning.web.LearningDtos.ReturnRequest;
import io.campuscore.restfulapi.learning.web.LearningDtos.SubmissionReviewRequest;
import io.campuscore.restfulapi.learning.web.LearningDtos.RosterRowResponse;
import io.campuscore.restfulapi.learning.web.LearningDtos.SubmissionResponse;
import io.campuscore.restfulapi.learning.web.LearningDtos.SubmissionRevisionResponse;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import java.util.List;
import java.util.Map;
import org.springframework.context.annotation.Profile;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/** P09 LMS staff surface. Every route re-checks the caller's lecturerId claim
 * against the section's assigned lecturer inside the service (contract §6 —
 * section assignment is the only staff credential in the learning domain). */
@RestController
@Profile("persistence")
@RequestMapping("/api/v1/learning/staff")
public class LearningStaffController {

    private final LearningService learning;

    public LearningStaffController(LearningService learning) {
        this.learning = learning;
    }

    // ---------------- materials ----------------

    @Operation(summary = "Danh sách học liệu của lớp học phần (giảng viên phụ trách)")
    @GetMapping("/sections/{sectionId}/materials")
    @PreAuthorize("isAuthenticated()")
    public List<MaterialResponse> listMaterials(
            @AuthenticationPrincipal Jwt jwt,
            @Parameter(description = "Mã lớp học phần") @PathVariable String sectionId) {
        return learning.listMaterials(lecturer(jwt), sectionId);
    }

    @Operation(summary = "Tạo học liệu mới cho lớp học phần")
    @PostMapping("/sections/{sectionId}/materials")
    @ResponseStatus(HttpStatus.CREATED)
    @PreAuthorize("isAuthenticated()")
    public MaterialResponse createMaterial(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable String sectionId,
            @RequestBody MaterialUpsertRequest request) {
        return learning.createMaterial(lecturer(jwt), sectionId, request);
    }

    @Operation(summary = "Cập nhật học liệu (optimistic version)")
    @PutMapping("/materials/{materialId}")
    @PreAuthorize("isAuthenticated()")
    public MaterialResponse updateMaterial(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable String materialId,
            @RequestBody MaterialUpsertRequest request) {
        return learning.updateMaterial(lecturer(jwt), materialId, request);
    }

    @Operation(summary = "Xoá học liệu")
    @DeleteMapping("/materials/{materialId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @PreAuthorize("isAuthenticated()")
    public void deleteMaterial(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable String materialId) {
        learning.deleteMaterial(lecturer(jwt), materialId);
    }

    @Operation(summary = "Tải tệp học liệu (giảng viên phụ trách)")
    @GetMapping("/materials/{materialId}/file")
    @PreAuthorize("isAuthenticated()")
    public ResponseEntity<byte[]> downloadMaterial(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable String materialId) {
        return fileResponse(learning.downloadMaterial(lecturer(jwt), materialId));
    }

    // ---------------- assignments ----------------

    @Operation(summary = "Danh sách bài tập của lớp học phần (gồm nháp)")
    @GetMapping("/sections/{sectionId}/assignments")
    @PreAuthorize("isAuthenticated()")
    public List<AssignmentResponse> listAssignments(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable String sectionId) {
        return learning.listAssignments(lecturer(jwt), sectionId);
    }

    @Operation(summary = "Tạo bài tập nháp (LMS-T01: DRAFT → PUBLISHED → CLOSED → ARCHIVED)")
    @PostMapping("/sections/{sectionId}/assignments")
    @ResponseStatus(HttpStatus.CREATED)
    @PreAuthorize("isAuthenticated()")
    public AssignmentResponse createAssignment(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable String sectionId,
            @RequestBody AssignmentUpsertRequest request) {
        return learning.createAssignment(lecturer(jwt), sectionId, request);
    }

    @Operation(summary = "Chi tiết bài tập (giảng viên phụ trách)")
    @GetMapping("/assignments/{assignmentId}")
    @PreAuthorize("isAuthenticated()")
    public AssignmentResponse assignment(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable String assignmentId) {
        return learning.staffAssignment(lecturer(jwt), assignmentId);
    }

    @Operation(summary = "Sửa bài tập nháp (optimistic version)")
    @PutMapping("/assignments/{assignmentId}")
    @PreAuthorize("isAuthenticated()")
    public AssignmentResponse updateAssignment(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable String assignmentId,
            @RequestBody AssignmentUpsertRequest request) {
        return learning.updateAssignment(lecturer(jwt), assignmentId, request);
    }

    @Operation(summary = "Công bố bài tập (LMS-T01)")
    @PostMapping("/assignments/{assignmentId}/publish")
    @PreAuthorize("isAuthenticated()")
    public AssignmentResponse publish(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable String assignmentId) {
        return learning.publish(lecturer(jwt), assignmentId);
    }

    @Operation(summary = "Đóng bài tập — chặn mọi thao tác nộp (LMS-T02)")
    @PostMapping("/assignments/{assignmentId}/close")
    @PreAuthorize("isAuthenticated()")
    public AssignmentResponse close(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable String assignmentId) {
        return learning.close(lecturer(jwt), assignmentId);
    }

    @Operation(summary = "Lưu trữ bài tập đã đóng")
    @PostMapping("/assignments/{assignmentId}/archive")
    @PreAuthorize("isAuthenticated()")
    public AssignmentResponse archive(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable String assignmentId) {
        return learning.archive(lecturer(jwt), assignmentId);
    }

    @Operation(summary = "Danh sách roster với trạng thái nộp bài")
    @GetMapping("/assignments/{assignmentId}/roster")
    @PreAuthorize("isAuthenticated()")
    public List<RosterRowResponse> roster(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable String assignmentId) {
        return learning.roster(lecturer(jwt), assignmentId);
    }

    // ---------------- submissions / feedback ----------------

    @Operation(summary = "Chi tiết bài nộp (giảng viên phụ trách)")
    @GetMapping("/submissions/{submissionId}")
    @PreAuthorize("isAuthenticated()")
    public SubmissionResponse submission(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable String submissionId) {
        return learning.submission(lecturer(jwt), submissionId);
    }

    @Operation(summary = "Lịch sử revision bất biến của bài nộp (LMS-X02)")
    @GetMapping("/submissions/{submissionId}/revisions")
    @PreAuthorize("isAuthenticated()")
    public List<SubmissionRevisionResponse> revisions(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable String submissionId) {
        return learning.revisions(lecturer(jwt), submissionId);
    }

    @Operation(summary = "Trả bài kèm phản hồi (LMS-T04: SUBMITTED|RESUBMITTED → RETURNED)")
    @PostMapping("/submissions/{submissionId}/return")
    @PreAuthorize("isAuthenticated()")
    public SubmissionResponse returnSubmission(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable String submissionId,
            @RequestBody ReturnRequest request) {
        return learning.returnSubmission(lecturer(jwt), submissionId, request);
    }

    @Operation(summary = "Đánh dấu đã duyệt (LMS-T06: RETURNED → REVIEWED)")
    @PostMapping("/submissions/{submissionId}/review")
    @PreAuthorize("isAuthenticated()")
    public SubmissionResponse reviewSubmission(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable String submissionId,
            @RequestBody(required = false) SubmissionReviewRequest request) {
        return learning.reviewSubmission(lecturer(jwt), submissionId, request);
    }

    @Operation(summary = "Lịch sử phản hồi (append-only)")
    @GetMapping("/submissions/{submissionId}/feedback")
    @PreAuthorize("isAuthenticated()")
    public List<FeedbackResponse> feedback(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable String submissionId) {
        return learning.feedback(lecturer(jwt), submissionId);
    }

    @Operation(summary = "Tải tệp của một revision (LMS-T07 — chỉ giảng viên phụ trách)")
    @GetMapping("/revisions/{revisionId}/file")
    @PreAuthorize("isAuthenticated()")
    public ResponseEntity<byte[]> downloadRevision(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable String revisionId) {
        return fileResponse(learning.downloadRevision(lecturer(jwt), revisionId));
    }

    // ---------------- helpers ----------------

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

    private static String lecturer(Jwt jwt) {
        String lecturerId = jwt.getClaimAsString("lecturerId");
        if (lecturerId == null || lecturerId.isBlank()) {
            throw new io.campuscore.restfulapi.web.DomainException(HttpStatus.FORBIDDEN,
                    "LECTURER_SCOPE_REQUIRED", "This account is not linked to a lecturer");
        }
        return lecturerId;
    }
}
