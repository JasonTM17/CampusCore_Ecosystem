package io.campuscore.restfulapi.engagement;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import io.campuscore.restfulapi.engagement.domain.ArticleAttachment;
import io.campuscore.restfulapi.engagement.domain.ArticleCategory;
import io.campuscore.restfulapi.engagement.domain.ArticleMediaGallery;
import io.campuscore.restfulapi.engagement.domain.ArticleTag;
import io.campuscore.restfulapi.engagement.repository.ArticleAssetReadRepository;
import io.campuscore.restfulapi.engagement.repository.ArticleAssetReadRepository.AssetVisibility;
import io.campuscore.restfulapi.engagement.repository.ArticleCategoryRepository;
import io.campuscore.restfulapi.engagement.repository.ArticleTagRepository;
import io.campuscore.restfulapi.engagement.web.ArticleTaxonomyController;
import io.campuscore.restfulapi.engagement.web.ArticleTaxonomyDtos.AttachmentDto;
import io.campuscore.restfulapi.engagement.web.ArticleTaxonomyDtos.AttachmentListResponse;
import io.campuscore.restfulapi.engagement.web.ArticleTaxonomyDtos.CategoryDto;
import io.campuscore.restfulapi.engagement.web.ArticleTaxonomyDtos.MediaGalleryListResponse;
import io.campuscore.restfulapi.engagement.web.ArticleTaxonomyDtos.TagDto;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.server.ResponseStatusException;

class ArticleTaxonomyControllerTest {

    private ArticleCategoryRepository categoryRepository;
    private ArticleTagRepository tagRepository;
    private ArticleAssetReadRepository assetReads;
    private ArticleTaxonomyController controller;

    @BeforeEach
    void setUp() {
        categoryRepository = mock(ArticleCategoryRepository.class);
        tagRepository = mock(ArticleTagRepository.class);
        assetReads = mock(ArticleAssetReadRepository.class);
        controller = new ArticleTaxonomyController(categoryRepository, tagRepository, assetReads);
    }

    private static Jwt adminJwt() {
        return Jwt.withTokenValue("fixture")
                .header("alg", "none")
                .subject("admin-1")
                .claim("email", "admin-1@campuscore.edu")
                .claim("roles", List.of("ADMIN"))
                .build();
    }

    @Test
    @DisplayName("getCategories should return active categories sorted by displayOrder")
    void getCategoriesReturnsActiveCategories() {
        ArticleCategory cat = new ArticleCategory(
                "cat-1", "RESEARCH_TECH", "Nghiên cứu & Công nghệ", "Research & Technology",
                "nghien-cuu-cong-nghe", "Desc", "indigo", "flask", 1, true);

        when(categoryRepository.findByIsActiveTrueOrderByDisplayOrderAsc()).thenReturn(List.of(cat));

        List<ArticleCategory> result = controller.getCategories();
        assertEquals(1, result.size());
        assertEquals("RESEARCH_TECH", result.get(0).getCode());
    }

    @Test
    @DisplayName("getCategoryBySlug should return category when found and 404 when missing")
    void getCategoryBySlugHandlesFoundAndMissing() {
        ArticleCategory cat = new ArticleCategory(
                "cat-2", "AWARDS_HONORS", "Học bổng & Khen thưởng", "Scholarships",
                "scholarships", "Desc", "amber", "trophy", 2, true);

        when(categoryRepository.findBySlug("scholarships")).thenReturn(Optional.of(cat));
        when(categoryRepository.findBySlug("missing")).thenReturn(Optional.empty());

        assertEquals(cat, controller.getCategoryBySlug("scholarships"));

        ResponseStatusException ex = assertThrows(
                ResponseStatusException.class,
                () -> controller.getCategoryBySlug("missing"));
        assertEquals(HttpStatus.NOT_FOUND, ex.getStatusCode());
    }

    @Test
    @DisplayName("getTags should return top tags by usage count")
    void getTagsReturnsTopTags() {
        ArticleTag tag = new ArticleTag("tag-ai", "ai", "Trí tuệ nhân tạo", "Artificial Intelligence", 25);

        when(tagRepository.findTop20ByOrderByUsageCountDesc()).thenReturn(List.of(tag));

        List<ArticleTag> result = controller.getTags();
        assertEquals(1, result.size());
        assertEquals("ai", result.get(0).getSlug());
    }

    @Test
    @DisplayName("getMediaGalleries routes through the parent-visibility gate")
    void getMediaGalleriesFiltersByAnnouncement() {
        ArticleMediaGallery gallery = new ArticleMediaGallery();
        gallery.setId("gal-1");
        gallery.setAnnouncementId("ann-1");
        gallery.setMediaUrl("https://theses.campusute.io.vn/photo.jpg");
        gallery.setCaptionVi("Lễ tốt nghiệp");

        when(assetReads.isParentVisible(eq("ann-1"), any(AssetVisibility.class))).thenReturn(true);
        when(assetReads.findGalleries(eq("ann-1"), any(AssetVisibility.class), eq(0L), eq(200)))
                .thenReturn(List.of(gallery));
        when(assetReads.findGalleries(eq(null), any(AssetVisibility.class), eq(0L), eq(200)))
                .thenReturn(List.of(gallery));

        List<ArticleMediaGallery> filtered = controller.getMediaGalleries("ann-1", adminJwt());
        assertEquals(1, filtered.size());
        assertEquals("ann-1", filtered.get(0).getAnnouncementId());

        List<ArticleMediaGallery> all = controller.getMediaGalleries(null, adminJwt());
        assertEquals(1, all.size());
    }

    @Test
    @DisplayName("getMediaGalleries answers 404 when the parent is not caller-visible")
    void getMediaGalleriesHidesInvisibleParent() {
        when(assetReads.isParentVisible(eq("draft-1"), any(AssetVisibility.class))).thenReturn(false);

        ResponseStatusException ex = assertThrows(
                ResponseStatusException.class,
                () -> controller.getMediaGalleries("draft-1", adminJwt()));
        assertEquals(HttpStatus.NOT_FOUND, ex.getStatusCode());
    }

    @Test
    @DisplayName("getAttachments routes through the parent-visibility gate")
    void getAttachmentsFiltersByAnnouncement() {
        ArticleAttachment attachment = new ArticleAttachment();
        attachment.setId("att-1");
        attachment.setAnnouncementId("ann-1");
        attachment.setFileName("thong_bao.pdf");

        when(assetReads.isParentVisible(eq("ann-1"), any(AssetVisibility.class))).thenReturn(true);
        when(assetReads.findAttachments(eq("ann-1"), any(AssetVisibility.class), eq(0L), eq(200)))
                .thenReturn(List.of(attachment));
        when(assetReads.findAttachments(eq(null), any(AssetVisibility.class), eq(0L), eq(200)))
                .thenReturn(List.of(attachment));

        List<AttachmentDto> filtered = controller.getAttachments("ann-1", adminJwt());
        assertEquals(1, filtered.size());
        assertEquals("thong_bao.pdf", filtered.get(0).fileName());

        List<AttachmentDto> allPublic = controller.getAttachments(null, adminJwt());
        assertEquals(1, allPublic.size());
    }

    @Test
    @DisplayName("getCategoriesV2 projects the entity onto the audit-free category DTO")
    void getCategoriesV2MapsPublicFieldsOnly() {
        ArticleCategory cat = new ArticleCategory(
                "cat-1", "RESEARCH_TECH", "Nghiên cứu & Công nghệ", "Research & Technology",
                "nghien-cuu-cong-nghe", "Desc", "indigo", "flask", 1, true);

        when(categoryRepository.findByIsActiveTrueOrderByDisplayOrderAsc()).thenReturn(List.of(cat));

        // Exact record equality is the guard: adding an entity audit field to CategoryDto
        // would break this assertion instead of silently shipping it on the wire.
        assertEquals(
                List.of(new CategoryDto(
                        "cat-1", "RESEARCH_TECH", "nghien-cuu-cong-nghe",
                        "Nghiên cứu & Công nghệ", "Research & Technology",
                        "Desc", "indigo", "flask", 1, true)),
                controller.getCategoriesV2());
    }

    @Test
    @DisplayName("getTagsV2 maps tags onto DTOs and keeps the 404 contract for unknown slugs")
    void getTagsV2MapsDtoAndKeepsNotFound() {
        ArticleTag tag = new ArticleTag("tag-ai", "ai", "Trí tuệ nhân tạo", "Artificial Intelligence", 25);
        when(tagRepository.findTop20ByOrderByUsageCountDesc()).thenReturn(List.of(tag));
        when(tagRepository.findBySlug("ai")).thenReturn(Optional.of(tag));
        when(tagRepository.findBySlug("missing")).thenReturn(Optional.empty());

        assertEquals(List.of(new TagDto("tag-ai", "ai", "Trí tuệ nhân tạo", "Artificial Intelligence", 25)),
                controller.getTagsV2());
        assertEquals("ai", controller.getTagBySlugV2("ai").slug());
        ResponseStatusException ex = assertThrows(
                ResponseStatusException.class,
                () -> controller.getTagBySlugV2("missing"));
        assertEquals(HttpStatus.NOT_FOUND, ex.getStatusCode());
    }

    @Test
    @DisplayName("getMediaGalleriesV2 caps an oversized page at 200 and reports gated totals")
    void getMediaGalleriesV2CapsPageSize() {
        ArticleMediaGallery gallery = new ArticleMediaGallery();
        gallery.setId("gal-1");
        gallery.setAnnouncementId("ann-1");
        gallery.setMediaUrl("https://theses.campusute.io.vn/photo.jpg");
        when(assetReads.isParentVisible(eq("ann-1"), any(AssetVisibility.class))).thenReturn(true);
        when(assetReads.findGalleries(eq("ann-1"), any(AssetVisibility.class), eq(0L), eq(200)))
                .thenReturn(List.of(gallery));
        when(assetReads.countGalleries(eq("ann-1"), any(AssetVisibility.class))).thenReturn(1L);

        MediaGalleryListResponse response = controller.getMediaGalleriesV2("ann-1", 1, 10_000, adminJwt());

        verify(assetReads).findGalleries(eq("ann-1"), any(AssetVisibility.class), eq(0L), eq(200));
        assertEquals(200, response.meta().limit());
        assertEquals(1, response.meta().page());
        assertEquals(1, response.meta().totalPages());
        assertEquals("gal-1", response.data().get(0).id());
    }

    @Test
    @DisplayName("getAttachmentsV2 falls back to the 50-row page and reports gated totals")
    void getAttachmentsV2UsesDefaultPublicPage() {
        ArticleAttachment attachment = new ArticleAttachment();
        attachment.setId("att-1");
        attachment.setFileName("quyet_dinh.pdf");
        when(assetReads.findAttachments(eq(null), any(AssetVisibility.class), eq(50L), eq(50)))
                .thenReturn(List.of(attachment));
        when(assetReads.countAttachments(eq(null), any(AssetVisibility.class))).thenReturn(100L);

        AttachmentListResponse response = controller.getAttachmentsV2(null, 2, 0, adminJwt());

        verify(assetReads).findAttachments(eq(null), any(AssetVisibility.class), eq(50L), eq(50));
        assertEquals(
                List.of(new AttachmentDto("att-1", null, "quyet_dinh.pdf", null, 0L, null, 0)),
                response.data());
        assertEquals(50, response.meta().limit());
        assertEquals(2, response.meta().page());
        assertEquals(100, response.meta().total());
        assertEquals(2, response.meta().totalPages());
    }
}
