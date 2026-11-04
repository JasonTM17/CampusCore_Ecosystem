package io.campuscore.restfulapi.thesis.web;

import org.springframework.security.access.prepost.PreAuthorize;
import io.campuscore.restfulapi.events.web.ListPaging;
import io.campuscore.restfulapi.thesis.domain.TopicStatus;
import io.campuscore.restfulapi.thesis.search.ThesisTopicCatalogSearch;
import io.campuscore.restfulapi.thesis.service.ThesisTopicService;
import io.campuscore.restfulapi.thesis.web.ThesisTopicDtos.TopicResponse;
import io.campuscore.restfulapi.web.DomainException;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.headers.Header;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.tags.Tag;
import java.util.List;
import java.util.UUID;
import org.springframework.context.annotation.Profile;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@Tag(name = "Thesis Topics Catalog", description = "Quản lý và tra cứu kho đề tài Khóa luận & Đồ án tốt nghiệp theo đợt và bộ môn")
@RestController
@Profile("persistence")
@RequestMapping("/api/v1/thesis/topics")
@PreAuthorize("isAuthenticated()")
public class ThesisTopicController {

    private final ThesisTopicService topics;

    public ThesisTopicController(ThesisTopicService topics) {
        this.topics = topics;
    }

    @Operation(summary = "Lấy danh sách đề tài theo đợt khóa luận", description = "Truy xuất danh sách các đề tài khóa luận trong đợt đã chọn, có quyền bảo mật ẩn đề tài nháp/lưu trữ đối với sinh viên. Thêm search để lọc đúng như trang danh mục; khi có page/limit trả thêm X-Topic-Total-Count (tổng trước khi lọc).")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "Truy xuất danh sách đề tài thành công", headers = {
                @Header(name = ListPaging.TOTAL_COUNT_HEADER, description = ListPaging.TOTAL_COUNT_DOC,
                        schema = @Schema(type = "integer")),
                @Header(name = ThesisTopicCatalogSearch.CATALOG_TOTAL_COUNT_HEADER,
                        description = "Số đề tài người gọi được xem trước khi áp dụng search (chỉ khi có page/limit)",
                        schema = @Schema(type = "integer"))}),
        @ApiResponse(responseCode = "400", description = "Tham số roundId, search hoặc page/limit không hợp lệ")
    })
    @GetMapping
    public ResponseEntity<List<TopicResponse>> list(
            @Parameter(description = "Mã định danh UUID của đợt khóa luận", required = true)
            @RequestParam UUID roundId,
            @Parameter(description = "Trạng thái đề tài (PUBLISHED, APPROVED, DRAFT...)")
            @RequestParam(required = false) TopicStatus status,
            @Parameter(description = "Từ khoá lọc theo đúng ngữ nghĩa trang danh mục; bỏ trống hoặc 'all' là không lọc")
            @RequestParam(required = false) String search,
            @Parameter(description = ListPaging.PAGE_DOC) @RequestParam(required = false) Integer page,
            @Parameter(description = ListPaging.LIMIT_DOC) @RequestParam(required = false) Integer limit,
            jakarta.servlet.http.HttpServletRequest request,
            @AuthenticationPrincipal Jwt actor) {
        requireSingleSearch(request);
        ThesisTopicCatalogSearch.requireWithinBudget(search);
        return respond(roundId, status, search, page, limit, actor);
    }

    /**
     * Direct-call compatibility entry point (no search, no repeated-parameter
     * check); the HTTP mapping above is the public contract.
     */
    public ResponseEntity<List<TopicResponse>> list(UUID roundId, TopicStatus status, Integer page,
            Integer limit, Jwt actor) {
        return respond(roundId, status, null, page, limit, actor);
    }

    private ResponseEntity<List<TopicResponse>> respond(UUID roundId, TopicStatus status, String search,
            Integer page, Integer limit, Jwt actor) {
        ListPaging.Window window = ListPaging.Window.of(page, limit);
        if (window == null) {
            return ResponseEntity.ok(topics.list(roundId, status, actor, search));
        }
        ThesisTopicService.CatalogPage result = topics.listPage(roundId, status, actor, window, search);
        return ResponseEntity.ok()
                .header(ListPaging.TOTAL_COUNT_HEADER, String.valueOf(result.total()))
                .header(ThesisTopicCatalogSearch.CATALOG_TOTAL_COUNT_HEADER,
                        String.valueOf(result.catalogTotal()))
                .body(result.items());
    }

    /** A repeated {@code search} is ambiguous, so it fails before any data is read. */
    private static void requireSingleSearch(jakarta.servlet.http.HttpServletRequest request) {
        String[] values = request.getParameterValues("search");
        if (values != null && values.length > 1) {
            throw new DomainException(org.springframework.http.HttpStatus.BAD_REQUEST, "INVALID_SEARCH",
                    "search may be specified only once");
        }
    }

    @Operation(summary = "Xem chi tiết đề tài theo mã định danh (UUID)", description = "Truy xuất thông tin chi tiết một đề tài khóa luận bao gồm mô tả, mục tiêu, GVHD và số nhóm tối đa")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "Tìm thấy đề tài"),
        @ApiResponse(responseCode = "404", description = "Không tìm thấy đề tài với UUID tương ứng")
    })
    @GetMapping("/{id}")
    public TopicResponse get(
            @Parameter(description = "Mã UUID của đề tài", required = true)
            @PathVariable UUID id,
            @AuthenticationPrincipal Jwt actor) {
        return topics.get(id, actor);
    }
}
