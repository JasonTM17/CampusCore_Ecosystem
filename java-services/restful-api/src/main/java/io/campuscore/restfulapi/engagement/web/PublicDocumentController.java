package io.campuscore.restfulapi.engagement.web;

import tools.jackson.databind.JsonNode;
import io.campuscore.restfulapi.engagement.service.PublicDocumentService;
import io.campuscore.restfulapi.engagement.web.PublicDocumentDtos.DocumentContentRequest;
import io.campuscore.restfulapi.engagement.web.PublicDocumentDtos.DocumentListResponse;
import io.campuscore.restfulapi.engagement.web.PublicDocumentDtos.DocumentResponse;
import java.util.List;
import java.util.Set;
import org.springframework.context.annotation.Profile;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.util.MultiValueMap;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.tags.Tag;

/**
 * Staff surface for the public-documentation lane (publication-policy §5). All
 * mutating routes are writer-set only; the anonymous read side lives on
 * {@code /api/v1/public/docs/**}.
 */
@Tag(name = "Public Documents", description = "Tài liệu công khai của trường — vòng đời duyệt theo phiên bản (DRAFT → IN_REVIEW → PUBLISHED → ARCHIVED)")
@RestController
@Profile("persistence")
@RequestMapping("/api/v1/docs")
public class PublicDocumentController {

    private final PublicDocumentService documents;

    public PublicDocumentController(PublicDocumentService documents) {
        this.documents = documents;
    }

    @Operation(summary = "Tạo tài liệu công khai (bản nháp)", description = "Tạo tài liệu mới với revision đầu tiên ở trạng thái DRAFT — chưa công khai cho đến khi được duyệt")
    @ApiResponses({
        @ApiResponse(responseCode = "201", description = "Tạo tài liệu thành công"),
        @ApiResponse(responseCode = "409", description = "Slug đã tồn tại")
    })
    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    @org.springframework.security.access.prepost.PreAuthorize("hasAnyRole('LECTURER', 'ADMIN', 'SUPER_ADMIN')")
    public DocumentResponse create(
            @AuthenticationPrincipal Jwt jwt,
            @RequestBody JsonNode request) {
        return documents.create(subject(jwt), actorLabel(jwt), roles(jwt),
                DocumentContentRequest.from(request));
    }

    @Operation(summary = "Danh sách tài liệu (staff)", description = "Liệt kê tài liệu theo trạng thái vòng đời; giảng viên chỉ thấy tài liệu của mình và hàng chờ duyệt")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "Truy vấn danh sách thành công")
    })
    @GetMapping
    @org.springframework.security.access.prepost.PreAuthorize("hasAnyRole('LECTURER', 'ADMIN', 'SUPER_ADMIN')")
    public DocumentListResponse list(
            @Parameter(description = "Số trang phân trang (bắt đầu từ 1)") @RequestParam(defaultValue = "1") int page,
            @Parameter(description = "Số lượng tài liệu trên một trang") @RequestParam(defaultValue = "20") int limit,
            @Parameter(description = "Trạng thái vòng đời (DRAFT, IN_REVIEW, PUBLISHED, ARCHIVED, ALL)") @RequestParam(defaultValue = "ALL") String status,
            @RequestParam MultiValueMap<String, String> queryParameters,
            @AuthenticationPrincipal Jwt jwt) {
        requireAllowedQuery(queryParameters, Set.of("page", "limit", "status"));
        List<String> roles = roles(jwt);
        String authorScope = isLecturerOnly(roles) ? subject(jwt) : null;
        return documents.list(page, limit, status, authorScope);
    }

    @Operation(summary = "Chi tiết tài liệu (staff)", description = "Truy vấn tài liệu kèm head revision — bao gồm cả bản nháp đang soạn")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "Truy vấn chi tiết thành công"),
        @ApiResponse(responseCode = "404", description = "Không tìm thấy tài liệu")
    })
    @GetMapping("{id}")
    @org.springframework.security.access.prepost.PreAuthorize("hasAnyRole('LECTURER', 'ADMIN', 'SUPER_ADMIN')")
    public DocumentResponse detail(
            @Parameter(description = "Mã định danh tài liệu (UUID)", required = true) @PathVariable String id,
            @AuthenticationPrincipal Jwt jwt) {
        return documents.detail(id, roles(jwt), subject(jwt));
    }

    @Operation(summary = "Sửa tài liệu — tạo revision mới", description = "Mỗi lần sửa tạo head revision mới ở DRAFT; nội dung đang công khai không bị gián đoạn")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "Tạo revision thành công"),
        @ApiResponse(responseCode = "404", description = "Không tìm thấy tài liệu"),
        @ApiResponse(responseCode = "409", description = "Tài liệu đã lưu trữ hoặc slug bị đổi")
    })
    @PutMapping("{id}")
    @org.springframework.security.access.prepost.PreAuthorize("hasAnyRole('LECTURER', 'ADMIN', 'SUPER_ADMIN')")
    public DocumentResponse revise(
            @Parameter(description = "Mã định danh tài liệu (UUID)", required = true) @PathVariable String id,
            @AuthenticationPrincipal Jwt jwt,
            @RequestBody JsonNode request) {
        return documents.revise(subject(jwt), actorLabel(jwt), roles(jwt), id,
                DocumentContentRequest.from(request));
    }

    @Operation(summary = "Gửi duyệt head revision", description = "Tác giả revision (hoặc quản trị viên) gửi bản nháp vào hàng chờ duyệt")
    @PostMapping("{id}/submit")
    @org.springframework.security.access.prepost.PreAuthorize("hasAnyRole('LECTURER', 'ADMIN', 'SUPER_ADMIN')")
    public DocumentResponse submit(@PathVariable String id, @AuthenticationPrincipal Jwt jwt) {
        return documents.submit(subject(jwt), actorLabel(jwt), roles(jwt), id);
    }

    @Operation(summary = "Duyệt xuất bản head revision", description = "Người duyệt (khác tác giả revision) xuất bản — revision cũ chuyển SUPERSEDED, doc chuyển PUBLISHED")
    @PostMapping("{id}/approve")
    @org.springframework.security.access.prepost.PreAuthorize("hasAnyRole('LECTURER', 'ADMIN', 'SUPER_ADMIN')")
    public DocumentResponse approve(@PathVariable String id, @AuthenticationPrincipal Jwt jwt) {
        return documents.approve(subject(jwt), actorLabel(jwt), roles(jwt), id);
    }

    @Operation(summary = "Trả head revision về nháp", description = "Người duyệt trả bài kèm ghi chú lý do bắt buộc")
    @PostMapping("{id}/return")
    @org.springframework.security.access.prepost.PreAuthorize("hasAnyRole('LECTURER', 'ADMIN', 'SUPER_ADMIN')")
    public DocumentResponse returnForRework(
            @PathVariable String id,
            @AuthenticationPrincipal Jwt jwt,
            @RequestBody JsonNode request) {
        return documents.returnForRework(subject(jwt), actorLabel(jwt), roles(jwt), id,
                AnnouncementWriteDtos.LifecycleRequest.from(request).reason());
    }

    @Operation(summary = "Lưu trữ tài liệu", description = "Rút tài liệu khỏi bề mặt công khai (unpublish) — revisions giữ nguyên làm lịch sử")
    @PostMapping("{id}/archive")
    @org.springframework.security.access.prepost.PreAuthorize("hasAnyRole('LECTURER', 'ADMIN', 'SUPER_ADMIN')")
    public DocumentResponse archive(
            @PathVariable String id,
            @AuthenticationPrincipal Jwt jwt,
            @RequestBody JsonNode request) {
        return documents.archive(subject(jwt), actorLabel(jwt), roles(jwt), id,
                AnnouncementWriteDtos.LifecycleRequest.from(request).reason());
    }

    @Operation(summary = "Khôi phục tài liệu về nháp", description = "Khôi phục tài liệu đã lưu trữ về DRAFT — phải duyệt lại mới công khai trở lại")
    @PostMapping("{id}/restore")
    @org.springframework.security.access.prepost.PreAuthorize("hasAnyRole('LECTURER', 'ADMIN', 'SUPER_ADMIN')")
    public DocumentResponse restore(
            @PathVariable String id,
            @AuthenticationPrincipal Jwt jwt,
            @RequestBody JsonNode request) {
        return documents.restore(subject(jwt), actorLabel(jwt), roles(jwt), id,
                AnnouncementWriteDtos.LifecycleRequest.from(request).reason());
    }

    private static void requireAllowedQuery(
            MultiValueMap<String, String> queryParameters,
            Set<String> allowed) {
        for (java.util.Map.Entry<String, List<String>> entry : queryParameters.entrySet()) {
            if ("_cc_nocache".equals(entry.getKey())) {
                continue;
            }
            if (!allowed.contains(entry.getKey()) || entry.getValue().size() != 1) {
                throw new IllegalArgumentException(
                        "Unexpected or repeated query parameter: " + entry.getKey());
            }
        }
    }

    private static boolean isLecturerOnly(List<String> roles) {
        return roles != null && roles.contains("LECTURER")
                && !roles.contains("ADMIN") && !roles.contains("SUPER_ADMIN");
    }

    private static List<String> roles(Jwt jwt) {
        return jwt == null ? List.of() : jwt.getClaimAsStringList("roles");
    }

    private static String subject(Jwt jwt) {
        if (jwt == null || jwt.getSubject() == null || jwt.getSubject().isBlank()) {
            throw new AccessDeniedException("Not authenticated");
        }
        return jwt.getSubject();
    }

    private static String actorLabel(Jwt jwt) {
        String firstName = claimAsString(jwt, "firstName");
        String lastName = claimAsString(jwt, "lastName");
        String fullName = (lastName + " " + firstName).trim();
        String email = claimAsString(jwt, "email");
        if (!fullName.isBlank()) {
            return email.isBlank() ? fullName : fullName + " · " + email;
        }
        return email.isBlank() ? subject(jwt) : email;
    }

    private static String claimAsString(Jwt jwt, String claim) {
        if (jwt == null) {
            return "";
        }
        Object value = jwt.getClaims().get(claim);
        return value == null ? "" : value.toString().trim();
    }
}
