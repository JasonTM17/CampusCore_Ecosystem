package io.campuscore.restfulapi.academic.registration;

import io.campuscore.restfulapi.academic.registration.RegistrationDtos.CatalogSectionResponse;
import io.campuscore.restfulapi.academic.registration.RegistrationDtos.CurriculumRelevance;
import io.campuscore.restfulapi.academic.registration.RegistrationDtos.DropResponse;
import io.campuscore.restfulapi.academic.registration.RegistrationDtos.EligibilityResponse;
import io.campuscore.restfulapi.academic.registration.RegistrationDtos.RoadmapResponse;
import io.campuscore.restfulapi.academic.registration.RegistrationDtos.RoundResponse;
import io.campuscore.restfulapi.academic.registration.RegistrationDtos.SectionScheduleView;
import io.campuscore.restfulapi.academic.registration.RegistrationDtos.SummaryResponse;
import io.campuscore.restfulapi.academic.registration.RegistrationDtos.WishRequest;
import io.campuscore.restfulapi.academic.registration.RegistrationDtos.WishResponse;
import io.campuscore.restfulapi.academic.registration.RegistrationService.SlipPayload;
import io.campuscore.restfulapi.academic.registration.CreditLimitApplicationDtos.CreateRequest;
import io.campuscore.restfulapi.academic.registration.CreditLimitApplicationDtos.Response;
import io.campuscore.restfulapi.academic.registration.CreditLimitApplicationDtos.ReviewRequest;
import io.campuscore.restfulapi.academic.service.AcademicEnrollmentReadService;
import io.campuscore.restfulapi.academic.web.AcademicEnrollmentReadDtos.EnrollmentResponse;
import io.campuscore.restfulapi.academic.web.AcademicMutationDtos.EnrollRequest;
import io.campuscore.restfulapi.events.web.ListPaging;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import java.util.List;
import org.springframework.context.annotation.Profile;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.headers.Header;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.tags.Tag;

@Tag(name = "Course Registration & Credit Limits", description = "Đăng ký học phần theo đợt, xét duyệt đơn xin vượt trần 28-30 tín chỉ, xuất phiếu đăng ký và hủy học phần")
@RestController
@Profile("persistence")
@RequestMapping("/api/v1")
public class RegistrationController {

    private final RegistrationService registration;
    private final AcademicEnrollmentReadService enrollments;
    private final CreditLimitApplicationService creditLimitApplications;

    public RegistrationController(
            RegistrationService registration,
            AcademicEnrollmentReadService enrollments,
            CreditLimitApplicationService creditLimitApplications) {
        this.registration = registration;
        this.enrollments = enrollments;
        this.creditLimitApplications = creditLimitApplications;
    }

    @Operation(summary = "Danh sách đợt đăng ký học phần", description = "Truy vấn danh sách các đợt đăng ký học phần đang mở hoặc theo học kỳ chỉ định")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "Truy vấn thành công danh sách đợt đăng ký")
    })
    @GetMapping("registration/rounds")
    @PreAuthorize("isAuthenticated()")
    public List<RoundResponse> rounds(
            @Parameter(description = "Mã định danh học kỳ (UUID)") @RequestParam(required = false) String semesterId) {
        return registration.listRounds(semesterId);
    }

    @Operation(summary = "Kiểm tra điều kiện đăng ký học phần của sinh viên", description = "Kiểm tra vai trò sinh viên, đợt đăng ký đang mở trong cửa sổ thời gian (REGISTRATION hoặc ADD_DROP), phạm vi khoá/ngành theo cohort và trần tín chỉ đã dùng/còn lại. Endpoint KHÔNG kiểm tra trạng thái học phí")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "Kiểm tra điều kiện thành công"),
        @ApiResponse(responseCode = "403", description = "Không có hồ sơ sinh viên hoạt động"),
        @ApiResponse(responseCode = "409", description = "Không có đợt đăng ký nào đang mở"),
        @ApiResponse(responseCode = "422", description = "Sinh viên ngoài phạm vi cohort của đợt")
    })
    @GetMapping("me/registration/eligibility")
    @PreAuthorize("hasRole('STUDENT')")
    public EligibilityResponse eligibility(
            @AuthenticationPrincipal Jwt jwt,
            @Parameter(description = "Mã định danh học kỳ (UUID)") @RequestParam(required = false) String semesterId,
            @Parameter(description = "Mã định danh đợt đăng ký (UUID)") @RequestParam(required = false) String roundId) {
        return registration.eligibility(jwt.getClaimAsString("studentId"), semesterId, roundId);
    }

    @Operation(summary = "Tra cứu danh mục lớp học phần khả dụng để đăng ký", description = "Lấy toàn bộ lớp học phần của học kỳ trong đợt đang mở kèm lịch học (thứ/giờ/phòng/giảng viên), cột chỗ, trạng thái xung đột lịch với các lớp đã đăng ký, cờ đã đăng ký và mức độ liên quan chương trình đào tạo (MANDATORY/ELECTIVE/OUTSIDE). Danh sách KHÔNG tự lọc theo điều kiện tiên quyết — kiểm tra tiên quyết chỉ diễn ra khi bấm đăng ký")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "Lấy danh sách lớp học phần thành công")
    })
    @GetMapping("me/registration/sections")
    @PreAuthorize("hasRole('STUDENT')")
    public List<CatalogSectionResponse> sections(
            @AuthenticationPrincipal Jwt jwt,
            @Parameter(description = "Mã định danh học kỳ (UUID)") @RequestParam(required = false) String semesterId,
            @Parameter(description = "Mã định danh đợt đăng ký (UUID)") @RequestParam(required = false) String roundId,
            @Parameter(description = "Chế độ lọc: all (mặc định), curriculum (trong CTĐT), remaining (chưa học trong CTĐT), retake (học lại)")
            @RequestParam(required = false) String mode,
            @Parameter(description = "Lọc theo khoa (Department ID)") @RequestParam(required = false) String departmentId,
            @Parameter(description = "Tìm kiếm theo mã hoặc tên học phần") @RequestParam(required = false) String search) {
        return registration.catalog(jwt.getClaimAsString("studentId"), semesterId, roundId, mode, departmentId, search);
    }

    @Operation(summary = "Lộ trình CTĐT phục vụ đăng ký", description = "Cây chương trình đào tạo Năm → Kỳ → Môn với trạng thái hoàn thành, tiên quyết thỏa mãn và số nhóm mở trong học kỳ đích — nguồn dữ liệu cho trang đăng ký học phần chuyên dụng.")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "Lộ trình CTĐT"),
        @ApiResponse(responseCode = "404", description = "Sinh viên chưa được gán CTĐT", content = @Content)
    })
    @GetMapping("me/registration/roadmap")
    @PreAuthorize("hasRole('STUDENT')")
    public RoadmapResponse roadmap(
            @AuthenticationPrincipal Jwt jwt,
            @Parameter(description = "Học kỳ đích tính cờ nhóm mở; mặc định học kỳ của đợt đăng ký đang mở") @RequestParam(required = false) String semesterId) {
        return registration.roadmap(jwt.getClaimAsString("studentId"), semesterId);
    }

    @Operation(summary = "Danh sách nguyện vọng đăng ký", description = "Các học phần sinh viên lưu lại để theo dõi (đăng ký nguyện vọng) cho một học kỳ.")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "Danh sách nguyện vọng")
    })
    @GetMapping("me/registration/wishes")
    @PreAuthorize("hasRole('STUDENT')")
    public List<WishResponse> wishes(
            @AuthenticationPrincipal Jwt jwt,
            @Parameter(description = "Học kỳ đích; mặc định học kỳ của đợt đăng ký đang mở") @RequestParam(required = false) String semesterId) {
        return registration.wishes(jwt.getClaimAsString("studentId"), semesterId);
    }

    @Operation(summary = "Thêm học phần vào nguyện vọng", description = "Lưu học phần sinh viên muốn theo dõi/đăng ký sau. Idempotent theo (sinh viên, học phần, học kỳ).")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "Nguyện vọng đã lưu"),
        @ApiResponse(responseCode = "409", description = "Đã có trong nguyện vọng hoặc đã đăng ký học phần này", content = @Content)
    })
    @PostMapping("me/registration/wishes")
    @PreAuthorize("hasRole('STUDENT')")
    public WishResponse addWish(
            @AuthenticationPrincipal Jwt jwt,
            @Parameter(description = "Khóa chống trùng lặp Idempotency") @RequestHeader(value = "Idempotency-Key") String idempotencyKey,
            @Valid @RequestBody WishRequest request) {
        return registration.addWish(jwt.getClaimAsString("studentId"), request.courseId(), request.semesterId(), idempotencyKey);
    }

    @Operation(summary = "Xoá học phần khỏi nguyện vọng", description = "Gỡ một học phần đã lưu khỏi danh sách nguyện vọng của sinh viên.")
    @ApiResponses({
        @ApiResponse(responseCode = "204", description = "Đã xoá"),
        @ApiResponse(responseCode = "404", description = "Không tìm thấy nguyện vọng", content = @Content)
    })
    @DeleteMapping("me/registration/wishes/{id}")
    @PreAuthorize("hasRole('STUDENT')")
    public ResponseEntity<Void> removeWish(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable String id) {
        registration.removeWish(jwt.getClaimAsString("studentId"), id);
        return ResponseEntity.noContent().build();
    }

    @Operation(summary = "Tổng kết trạng thái đăng ký và số tín chỉ của sinh viên", description = "Lấy tổng số tín chỉ đã đăng ký, giới hạn tín chỉ và danh sách lớp đã chọn trong học kỳ")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "Lấy tổng kết đăng ký thành công")
    })
    @GetMapping("me/registration/summary")
    @PreAuthorize("hasRole('STUDENT')")
    public SummaryResponse summary(
            @AuthenticationPrincipal Jwt jwt,
            @Parameter(description = "Mã định danh học kỳ (UUID)") @RequestParam(required = false) String semesterId) {
        return registration.summary(jwt.getClaimAsString("studentId"), semesterId);
    }

    @Operation(summary = "Xem đơn xin nâng hạn mức tín chỉ (28-30 TC)", description = "Lấy thông tin đơn xin mở rộng trần tín chỉ của sinh viên cho đợt đăng ký")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "Tìm thấy đơn xin nâng hạn mức tín chỉ"),
        @ApiResponse(responseCode = "204", description = "Chưa có đơn nào được nộp cho đợt này", content = @Content)
    })
    @GetMapping("me/registration/credit-limit-application")
    @PreAuthorize("hasRole('STUDENT')")
    public ResponseEntity<Response> creditLimitApplication(
            @AuthenticationPrincipal Jwt jwt,
            @Parameter(description = "Mã định danh đợt đăng ký (UUID)", required = true) @RequestParam String roundId) {
        Response application = creditLimitApplications.findForStudent(
                jwt.getClaimAsString("studentId"), roundId);
        return application == null ? ResponseEntity.noContent().build() : ResponseEntity.ok(application);
    }

    @Operation(summary = "Nộp đơn xin nâng hạn mức tín chỉ (28-30 TC)", description = "Sinh viên nộp đơn xin cứu xét vượt trần tín chỉ chuẩn (28 TC) lên tối đa 30 TC kèm lý do")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "Nộp đơn xin thành công"),
        @ApiResponse(responseCode = "400", description = "Yêu cầu không hợp lệ hoặc đã tồn tại đơn")
    })
    @PostMapping("me/registration/credit-limit-applications")
    @PreAuthorize("hasRole('STUDENT')")
    public Response submitCreditLimitApplication(
            @AuthenticationPrincipal Jwt jwt,
            @Valid @RequestBody CreateRequest request) {
        return creditLimitApplications.submit(
                jwt.getClaimAsString("studentId"), request.roundId(), request.reason());
    }

    @Operation(summary = "Danh sách đơn xin nâng hạn mức tín chỉ (Phòng Đào tạo / Admin)", description = "Lấy danh sách các đơn xin nâng trần tín chỉ cần xét duyệt; không có page/limit trả về tối đa 500 đơn mới nhất")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "Lấy danh sách đơn thành công", headers = @Header(
                name = ListPaging.TOTAL_COUNT_HEADER, description = ListPaging.TOTAL_COUNT_DOC,
                schema = @Schema(type = "integer")))
    })
    @GetMapping("admin/registration/credit-limit-applications")
    @PreAuthorize("hasAnyRole('ADMIN', 'SUPER_ADMIN')")
    public ResponseEntity<List<Response>> creditLimitApplications(
            HttpServletRequest httpRequest,
            @Parameter(description = "Trạng thái đơn (PENDING, APPROVED, REJECTED)") @RequestParam(required = false, defaultValue = "PENDING") String status,
            @Parameter(description = ListPaging.PAGE_DOC) @RequestParam(required = false) Integer page,
            @Parameter(description = ListPaging.LIMIT_DOC) @RequestParam(required = false) Integer limit) {
        ListPaging.Window window = ListPaging.Window.of(page, limit, httpRequest);
        return ListPaging.respond(creditLimitApplications.listPage(status, window));
    }

    @Operation(summary = "Xét duyệt đơn xin nâng hạn mức tín chỉ", description = "Phòng Đào tạo phê duyệt (APPROVED) hoặc từ chối (REJECTED) đơn xin nâng trần tín chỉ của sinh viên")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "Xét duyệt đơn thành công"),
        @ApiResponse(responseCode = "404", description = "Không tìm thấy đơn chỉ định")
    })
    @PostMapping("admin/registration/credit-limit-applications/{id}/review")
    @PreAuthorize("hasAnyRole('ADMIN', 'SUPER_ADMIN')")
    public Response reviewCreditLimitApplication(
            @AuthenticationPrincipal Jwt jwt,
            @Parameter(description = "Mã định danh đơn (UUID)", required = true) @PathVariable String id,
            @Valid @RequestBody ReviewRequest request) {
        return creditLimitApplications.review(id, request.decision(), jwt.getSubject(), request.note());
    }

    @Operation(summary = "Xuất phiếu đăng ký học phần (PDF)", description = "Tạo và tải về phiếu đăng ký học phần chính thức định dạng PDF kèm mã băm SHA256")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "Tạo file PDF thành công", content = @io.swagger.v3.oas.annotations.media.Content(mediaType = "application/pdf"))
    })
    @GetMapping("me/registration/slip")
    @PreAuthorize("hasRole('STUDENT')")
    public ResponseEntity<byte[]> slip(
            @AuthenticationPrincipal Jwt jwt,
            @Parameter(description = "Mã định danh học kỳ (UUID)") @RequestParam(required = false) String semesterId) {
        SlipPayload payload = registration.slip(jwt.getClaimAsString("studentId"), semesterId);
        return ResponseEntity.ok()
                .header("X-Content-SHA256", payload.sha256())
                .header(HttpHeaders.CONTENT_DISPOSITION, ContentDisposition.attachment().filename("registration-slip.pdf").build().toString())
                .contentType(MediaType.APPLICATION_PDF)
                .body(payload.payload());
    }

    @Operation(summary = "Danh sách lớp học phần sinh viên đang ghi danh", description = "Truy vấn tất cả các lớp học phần hiện tại của sinh viên")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "Truy vấn thành công")
    })
    @GetMapping("me/enrollments")
    @PreAuthorize("hasRole('STUDENT')")
    public List<EnrollmentResponse> myEnrollments(@AuthenticationPrincipal Jwt jwt) {
        return enrollments.findStudentEnrollments(jwt.getClaimAsString("studentId"), null);
    }

    @Operation(summary = "Đăng ký vào lớp học phần", description = "Ghi danh sinh viên vào lớp học phần với khóa Idempotency bắt buộc; máy chủ tự kiểm tra đợt mở, trần tín chỉ, điều kiện tiên quyết/song hành và xung đột lịch trước khi trừ chỗ")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "Đăng ký thành công"),
        @ApiResponse(responseCode = "400", description = "Thiếu khóa Idempotency"),
        @ApiResponse(responseCode = "409", description = "Lớp đã đầy/đóng, trùng lịch học, đăng ký trùng, hoặc khóa Idempotency đang được xử lý"),
        @ApiResponse(responseCode = "422", description = "Vượt trần tín chỉ hoặc thiếu điều kiện tiên quyết/song hành")
    })
    @PostMapping("me/enrollments")
    @PreAuthorize("hasRole('STUDENT')")
    public EnrollmentResponse enroll(
            @AuthenticationPrincipal Jwt jwt,
            @Parameter(description = "Khóa chống trùng lặp Idempotency") @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey,
            @Valid @RequestBody EnrollRequest request) {
        return registration.enroll(
                jwt.getClaimAsString("studentId"),
                request.sectionId(),
                jwt.getClaimAsStringList("roles"),
                idempotencyKey);
    }

    @Operation(summary = "Hủy đăng ký lớp học phần", description = "Rút khỏi lớp học phần đã đăng ký trong thời hạn cho phép của đợt (đợt ADD_DROP đang mở, hoặc đợt REGISTRATION còn cửa sổ); yêu cầu khóa Idempotency để chống phát lại")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "Hủy học phần thành công"),
        @ApiResponse(responseCode = "400", description = "Thiếu khóa Idempotency"),
        @ApiResponse(responseCode = "404", description = "Không tìm thấy bản ghi ghi danh"),
        @ApiResponse(responseCode = "409", description = "Đợt hủy đã đóng hoặc bản ghi không còn trạng thái active")
    })
    @PostMapping("me/enrollments/{id}/drop")
    @PreAuthorize("hasAnyRole('STUDENT', 'ADMIN', 'SUPER_ADMIN')")
    public DropResponse drop(
            @AuthenticationPrincipal Jwt jwt,
            @Parameter(description = "Mã ghi danh (UUID)", required = true) @PathVariable String id,
            @Parameter(description = "Khóa chống trùng lặp Idempotency") @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey) {
        registration.drop(id, jwt.getClaimAsString("studentId"), jwt.getClaimAsStringList("roles"), idempotencyKey,
                jwt.getSubject());
        return new DropResponse("Enrollment dropped successfully");
    }
}
