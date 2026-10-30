package io.campuscore.restfulapi.library.web;

import io.campuscore.restfulapi.events.web.ListPaging;
import io.campuscore.restfulapi.library.service.LibraryPatronService;
import io.campuscore.restfulapi.library.web.LibraryDtos.BorrowRequest;
import io.campuscore.restfulapi.library.web.LibraryDtos.CancelRequest;
import io.campuscore.restfulapi.library.web.LibraryDtos.LoanRequestResponse;
import io.campuscore.restfulapi.library.web.LibraryDtos.TitleResponse;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.headers.Header;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.tags.Tag;
import java.util.List;
import org.springframework.context.annotation.Profile;
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
 * Patron library surface (contract §8): catalogue search, own holds and
 * history, request creation and owner cancel. Any authenticated user can
 * read the catalogue and hold copies — borrowers key on the auth user id.
 * Every mutating lane takes an Idempotency-Key header (§1.3).
 */
@Tag(name = "Library", description = "Thư viện mô phỏng: tra cứu, giữ chỗ, lịch sử mượn")
@RestController
@Profile("persistence")
@RequestMapping("/api/v1/library")
public class LibraryPatronController {

    private final LibraryPatronService library;

    public LibraryPatronController(LibraryPatronService library) {
        this.library = library;
    }

    @Operation(summary = "Tra cứu danh mục sách")
    @ApiResponse(responseCode = "200", description = "Danh mục sách", headers = @Header(
            name = ListPaging.TOTAL_COUNT_HEADER, description = ListPaging.TOTAL_COUNT_DOC,
            schema = @Schema(type = "integer")))
    @GetMapping("/catalogue")
    @PreAuthorize("isAuthenticated()")
    public ResponseEntity<List<TitleResponse>> catalogue(
            @AuthenticationPrincipal Jwt jwt,
            @RequestParam(required = false) String query,
            @Parameter(description = ListPaging.PAGE_DOC) @RequestParam(required = false) Integer page,
            @Parameter(description = ListPaging.LIMIT_DOC) @RequestParam(required = false) Integer limit) {
        ListPaging.Window window = ListPaging.Window.of(page, limit);
        var result = library.catalogue(patron(jwt), query, window);
        return window == null ? ResponseEntity.ok(result.items()) : ResponseEntity.ok()
                .header(ListPaging.TOTAL_COUNT_HEADER, String.valueOf(result.total()))
                .body(result.items());
    }

    @Operation(summary = "Chi tiết đầu sách + tình trạng các bản sao")
    @GetMapping("/catalogue/{titleId}")
    @PreAuthorize("isAuthenticated()")
    public TitleResponse title(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable String titleId) {
        return library.title(patron(jwt), titleId);
    }

    @Operation(summary = "Đơn mượn của tôi")
    @GetMapping("/requests/my")
    @PreAuthorize("isAuthenticated()")
    public List<LoanRequestResponse> myLoans(@AuthenticationPrincipal Jwt jwt) {
        return library.myLoans(patron(jwt));
    }

    @Operation(summary = "Chi tiết đơn mượn (chủ sở hữu)")
    @GetMapping("/requests/{requestId}")
    @PreAuthorize("isAuthenticated()")
    public LoanRequestResponse myLoan(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable String requestId) {
        return library.myLoan(patron(jwt), requestId);
    }

    @Operation(summary = "Giữ chỗ một bản sao (AVAILABLE → RESERVED + REQUESTED)")
    @PostMapping("/requests")
    @PreAuthorize("isAuthenticated()")
    public LoanRequestResponse request(
            @AuthenticationPrincipal Jwt jwt,
            @RequestBody BorrowRequest request,
            @RequestHeader(name = "Idempotency-Key", required = false) String idempotencyKey) {
        return library.request(patron(jwt), request, idempotencyKey);
    }

    @Operation(summary = "Hủy giữ chỗ trước khi phát sách (→ CANCELLED)")
    @PostMapping("/requests/{requestId}/cancel")
    @PreAuthorize("isAuthenticated()")
    public LoanRequestResponse cancel(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable String requestId,
            @RequestBody(required = false) CancelRequest request,
            @RequestHeader(name = "Idempotency-Key", required = false) String idempotencyKey) {
        return library.cancel(patron(jwt), requestId,
                request == null ? null : request.expectedVersion(),
                request == null ? null : request.reason(),
                idempotencyKey);
    }

    private static String patron(Jwt jwt) {
        if (jwt == null || jwt.getSubject() == null || jwt.getSubject().isBlank()) {
            throw new AccessDeniedException("Not authenticated");
        }
        return jwt.getSubject();
    }
}
