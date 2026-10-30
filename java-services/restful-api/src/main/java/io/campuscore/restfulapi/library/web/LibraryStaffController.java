package io.campuscore.restfulapi.library.web;

import io.campuscore.restfulapi.library.service.LibraryService;
import io.campuscore.restfulapi.library.web.LibraryDtos.CancelRequest;
import io.campuscore.restfulapi.library.web.LibraryDtos.CopyResponse;
import io.campuscore.restfulapi.library.web.LibraryDtos.CreateCopyRequest;
import io.campuscore.restfulapi.library.web.LibraryDtos.CreateTitleRequest;
import io.campuscore.restfulapi.library.web.LibraryDtos.IssueRequest;
import io.campuscore.restfulapi.library.web.LibraryDtos.LoanRequestResponse;
import io.campuscore.restfulapi.library.web.LibraryDtos.StaffGrantResponse;
import io.campuscore.restfulapi.library.web.LibraryDtos.TitleResponse;
import io.campuscore.restfulapi.library.web.LibraryDtos.TransitionRequest;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import java.util.List;
import java.util.Map;
import org.springframework.context.annotation.Profile;
import org.springframework.http.HttpStatus;
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
 * Staff library surface (contract §8). Coarse gate is authentication; the
 * scoped {@code STAFF:library} grant is enforced inside the service so an
 * authenticated non-grantee receives 403 LIBRARY_STAFF_REQUIRED (§1.1).
 * Grant administration requires ADMIN. Students cannot mutate inventory.
 */
@Tag(name = "Library Staff", description = "Quầy thư viện mô phỏng: duyệt, phát sách, nhận trả, kho, grants")
@RestController
@Profile("persistence")
@RequestMapping("/api/v1/library/staff")
public class LibraryStaffController {

    private final LibraryService library;

    public LibraryStaffController(LibraryService library) {
        this.library = library;
    }

    @Operation(summary = "Hàng đợi đơn mượn (lọc theo trạng thái)")
    @GetMapping("/requests")
    @PreAuthorize("isAuthenticated()")
    public List<LoanRequestResponse> queue(
            @AuthenticationPrincipal Jwt jwt,
            @RequestParam(required = false) String status) {
        return library.queue(staff(jwt), status);
    }

    @Operation(summary = "Chi tiết đơn mượn (staff)")
    @GetMapping("/requests/{requestId}")
    @PreAuthorize("isAuthenticated()")
    public LoanRequestResponse detail(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable String requestId) {
        return library.staffRequest(staff(jwt), requestId);
    }

    @Operation(summary = "Duyệt đơn (REQUESTED → APPROVED, còn trong hạn giữ chỗ)")
    @PostMapping("/requests/{requestId}/approve")
    @PreAuthorize("isAuthenticated()")
    public LoanRequestResponse approve(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable String requestId,
            @RequestBody(required = false) TransitionRequest request) {
        return library.approve(staff(jwt), requestId,
                request == null ? null : request.expectedVersion());
    }

    @Operation(summary = "Phát sách (APPROVED → ISSUED, copy → ON_LOAN)")
    @PostMapping("/requests/{requestId}/issue")
    @PreAuthorize("isAuthenticated()")
    public LoanRequestResponse issue(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable String requestId,
            @RequestBody(required = false) IssueRequest request) {
        return library.issue(staff(jwt), requestId, request);
    }

    @Operation(summary = "Nhận trả (ISSUED → RETURNED, copy → AVAILABLE)")
    @PostMapping("/requests/{requestId}/return")
    @PreAuthorize("isAuthenticated()")
    public LoanRequestResponse returnLoan(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable String requestId,
            @RequestBody(required = false) TransitionRequest request) {
        return library.returnLoan(staff(jwt), requestId,
                request == null ? null : request.expectedVersion());
    }

    @Operation(summary = "Hủy đơn trước phát (staff, → CANCELLED + giải phóng copy)")
    @PostMapping("/requests/{requestId}/cancel")
    @PreAuthorize("isAuthenticated()")
    public LoanRequestResponse cancel(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable String requestId,
            @RequestBody(required = false) CancelRequest request) {
        return library.cancelStaff(staff(jwt), requestId,
                request == null ? null : request.expectedVersion(),
                request == null ? null : request.reason());
    }

    @Operation(summary = "Thêm đầu sách")
    @PostMapping("/titles")
    @ResponseStatus(HttpStatus.CREATED)
    @PreAuthorize("isAuthenticated()")
    public TitleResponse createTitle(
            @AuthenticationPrincipal Jwt jwt,
            @RequestBody CreateTitleRequest request) {
        return library.createTitle(staff(jwt), request);
    }

    @Operation(summary = "Chi tiết đầu sách (staff)")
    @GetMapping("/titles/{titleId}")
    @PreAuthorize("isAuthenticated()")
    public TitleResponse title(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable String titleId) {
        return library.titleDetail(staff(jwt), titleId);
    }

    @Operation(summary = "Thêm bản sao")
    @PostMapping("/copies")
    @ResponseStatus(HttpStatus.CREATED)
    @PreAuthorize("isAuthenticated()")
    public CopyResponse createCopy(
            @AuthenticationPrincipal Jwt jwt,
            @RequestBody CreateCopyRequest request) {
        return library.createCopy(staff(jwt), request);
    }

    @Operation(summary = "Ngừng lưu hành bản sao (soft retire, giữ lịch sử)")
    @PostMapping("/copies/{copyId}/retire")
    @PreAuthorize("isAuthenticated()")
    public CopyResponse retire(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable String copyId,
            @RequestBody(required = false) TransitionRequest request) {
        return library.retireCopy(staff(jwt), copyId,
                request == null ? null : request.expectedVersion());
    }

    @Operation(summary = "Danh sách staff grants")
    @GetMapping("/grants")
    @PreAuthorize("isAuthenticated()")
    public List<StaffGrantResponse> grants(@AuthenticationPrincipal Jwt jwt) {
        return library.listGrants(staff(jwt));
    }

    @Operation(summary = "Cấp grant STAFF:library (admin)")
    @PostMapping("/grants")
    @ResponseStatus(HttpStatus.CREATED)
    @PreAuthorize("isAuthenticated()")
    public StaffGrantResponse grant(
            @AuthenticationPrincipal Jwt jwt,
            @RequestBody Map<String, String> request) {
        return library.grantStaff(staff(jwt), roles(jwt),
                request == null ? null : request.get("userId"));
    }

    @Operation(summary = "Thu hồi grant (admin)")
    @DeleteMapping("/grants/{grantId}")
    @PreAuthorize("isAuthenticated()")
    public void revoke(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable String grantId) {
        library.revokeStaff(staff(jwt), roles(jwt), grantId);
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
