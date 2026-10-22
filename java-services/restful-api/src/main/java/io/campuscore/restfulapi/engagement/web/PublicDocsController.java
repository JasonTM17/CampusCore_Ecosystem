package io.campuscore.restfulapi.engagement.web;

import io.campuscore.restfulapi.engagement.service.PublicDocumentService;
import io.campuscore.restfulapi.engagement.web.PublicDocumentDtos.PublicDocumentAttachmentResponse;
import io.campuscore.restfulapi.engagement.web.PublicDocumentDtos.PublicDocumentListResponse;
import io.campuscore.restfulapi.engagement.web.PublicDocumentDtos.PublicDocumentResponse;
import jakarta.servlet.http.HttpServletResponse;
import java.util.List;
import java.util.Set;
import org.springframework.context.annotation.Profile;
import org.springframework.http.HttpHeaders;
import org.springframework.util.MultiValueMap;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.tags.Tag;

/**
 * Anonymous public-documentation surface (publication-policy §5). Every route
 * is {@code Cache-Control: no-store} so an unpublish is effective immediately;
 * unpublished or unknown slugs answer the same 404 — no existence oracle.
 */
@Tag(name = "Public Documents", description = "Tài liệu công khai của trường — đọc ẩn danh, chỉ nội dung đã duyệt xuất bản")
@RestController
@Profile("persistence")
@RequestMapping("/api/v1/public/docs")
public class PublicDocsController {

    private final PublicDocumentService documents;

    public PublicDocsController(PublicDocumentService documents) {
        this.documents = documents;
    }

    @Operation(summary = "Danh mục tài liệu công khai", description = "Liệt kê tài liệu đã xuất bản, hỗ trợ tìm kiếm VI/EN không dấu, lọc theo chuyên mục và thẻ")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "Truy vấn danh mục thành công")
    })
    @GetMapping
    public PublicDocumentListResponse list(
            @Parameter(description = "Số trang phân trang (bắt đầu từ 1)") @RequestParam(defaultValue = "1") int page,
            @Parameter(description = "Số lượng tài liệu trên một trang") @RequestParam(defaultValue = "12") int limit,
            @Parameter(description = "Từ khóa tìm kiếm (tiêu đề, tóm tắt, nội dung — cả hai ngôn ngữ)") @RequestParam(required = false) String search,
            @Parameter(description = "Lọc theo mã chuyên mục") @RequestParam(required = false) String category,
            @Parameter(description = "Lọc theo mã thẻ") @RequestParam(required = false) String tag,
            @RequestParam MultiValueMap<String, String> queryParameters,
            HttpServletResponse response) {
        noStore(response);
        requireAllowedQuery(queryParameters, Set.of("page", "limit", "search", "category", "tag"));
        return documents.findPublic(page, limit, normalize(search), normalize(category), normalize(tag));
    }

    @Operation(summary = "Tài liệu công khai theo slug", description = "Nội dung revision đã xuất bản của tài liệu — slug không tồn tại hoặc chưa xuất bản đều trả 404")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "Truy vấn tài liệu thành công"),
        @ApiResponse(responseCode = "404", description = "Không tìm thấy tài liệu")
    })
    @GetMapping("{slug}")
    public PublicDocumentResponse detail(
            @Parameter(description = "Slug công khai của tài liệu", required = true) @PathVariable String slug,
            HttpServletResponse response) {
        noStore(response);
        return documents.findPublicBySlug(slug);
    }

    @Operation(summary = "Tài liệu công khai theo slug và revision", description = "Permalink phiên bản — chỉ phục vụ revision đã xuất bản hoặc cũ hơn; revision mới hơn publishedRevision trả 404")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "Truy vấn revision thành công"),
        @ApiResponse(responseCode = "404", description = "Không tìm thấy revision")
    })
    @GetMapping("{slug}/revisions/{revision}")
    public PublicDocumentResponse revision(
            @Parameter(description = "Slug công khai của tài liệu", required = true) @PathVariable String slug,
            @Parameter(description = "Số phiên bản (bắt đầu từ 1)", required = true) @PathVariable int revision,
            HttpServletResponse response) {
        noStore(response);
        return documents.findPublicRevision(slug, revision);
    }

    @Operation(summary = "Tệp đính kèm tài liệu công khai", description = "Metadata tệp đính kèm — chỉ phục vụ khi tài liệu đang xuất bản và tệp được đánh dấu công khai")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "Truy vấn tệp đính kèm thành công"),
        @ApiResponse(responseCode = "404", description = "Không tìm thấy tệp đính kèm")
    })
    @GetMapping("{slug}/attachments/{attachmentId}")
    public PublicDocumentAttachmentResponse attachment(
            @Parameter(description = "Slug công khai của tài liệu", required = true) @PathVariable String slug,
            @Parameter(description = "Mã định danh tệp đính kèm", required = true) @PathVariable String attachmentId,
            HttpServletResponse response) {
        noStore(response);
        return documents.findPublicAttachment(slug, attachmentId);
    }

    private static void noStore(HttpServletResponse response) {
        response.setHeader(HttpHeaders.CACHE_CONTROL, "no-store");
    }

    private static String normalize(String value) {
        return value == null || value.isBlank() ? null : value;
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
}
