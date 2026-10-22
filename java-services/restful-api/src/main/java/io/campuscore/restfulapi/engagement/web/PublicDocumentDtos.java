package io.campuscore.restfulapi.engagement.web;

import com.fasterxml.jackson.annotation.JsonFormat;
import io.swagger.v3.oas.annotations.media.Schema;
import tools.jackson.databind.JsonNode;
import java.time.Instant;
import java.util.List;

/**
 * DTOs for the public-documentation lane (publication-policy §5). A document is
 * a thin lifecycle shell; content lives on revisions and the anonymous surface
 * is pinned to {@code publishedRevision} only.
 */
public final class PublicDocumentDtos {

    private PublicDocumentDtos() {
    }

    /** Staff view of one document row plus its head revision detail. */
    public record DocumentResponse(
            String id,
            String slug,
            @Schema(types = {"string"}, allowableValues = {"DRAFT", "IN_REVIEW", "PUBLISHED", "ARCHIVED"})
            String status,
            String authorId,
            int currentRevision,
            @Schema(types = {"integer", "null"})
            Integer publishedRevision,
            @Schema(types = {"string", "null"})
            String categoryId,
            @JsonFormat(shape = JsonFormat.Shape.STRING, pattern = "yyyy-MM-dd'T'HH:mm:ss.SSSX", timezone = "UTC")
            Instant createdAt,
            @JsonFormat(shape = JsonFormat.Shape.STRING, pattern = "yyyy-MM-dd'T'HH:mm:ss.SSSX", timezone = "UTC")
            Instant updatedAt,
            List<String> tagIds,
            RevisionResponse headRevision) {
    }

    /** Revision detail — the review-scoped state machine row. */
    public record RevisionResponse(
            int revision,
            @Schema(types = {"string"}, allowableValues = {"DRAFT", "IN_REVIEW", "PUBLISHED", "SUPERSEDED"})
            String state,
            String titleVi,
            String titleEn,
            @Schema(types = {"string", "null"})
            String summaryVi,
            @Schema(types = {"string", "null"})
            String summaryEn,
            String bodyVi,
            String bodyEn,
            String authorId,
            @Schema(types = {"string", "null"})
            String reviewerId,
            @JsonFormat(shape = JsonFormat.Shape.STRING, pattern = "yyyy-MM-dd'T'HH:mm:ss.SSSX", timezone = "UTC")
            @Schema(types = {"string", "null"}, format = "date-time")
            Instant reviewedAt,
            @Schema(types = {"string", "null"})
            String reviewNote,
            @JsonFormat(shape = JsonFormat.Shape.STRING, pattern = "yyyy-MM-dd'T'HH:mm:ss.SSSX", timezone = "UTC")
            Instant createdAt) {
    }

    public record DocumentListResponse(
            List<DocumentResponse> data,
            AnnouncementReadDtos.PageMeta meta) {
    }

    /**
     * Anonymous public view: only the {@code publishedRevision} revision's
     * content ever appears here — draft head text can never leak (KM-M8).
     */
    public record PublicDocumentResponse(
            String slug,
            @Schema(types = {"string", "null"})
            String categoryId,
            int publishedRevision,
            boolean superseded,
            String titleVi,
            String titleEn,
            @Schema(types = {"string", "null"})
            String summaryVi,
            @Schema(types = {"string", "null"})
            String summaryEn,
            String bodyVi,
            String bodyEn,
            @JsonFormat(shape = JsonFormat.Shape.STRING, pattern = "yyyy-MM-dd'T'HH:mm:ss.SSSX", timezone = "UTC")
            Instant publishedAt,
            List<String> tagIds) {
    }

    /** Compact anonymous list row — no bodies. */
    public record PublicDocumentListItem(
            String slug,
            @Schema(types = {"string", "null"})
            String categoryId,
            int publishedRevision,
            String titleVi,
            String titleEn,
            @Schema(types = {"string", "null"})
            String summaryVi,
            @Schema(types = {"string", "null"})
            String summaryEn,
            @JsonFormat(shape = JsonFormat.Shape.STRING, pattern = "yyyy-MM-dd'T'HH:mm:ss.SSSX", timezone = "UTC")
            Instant publishedAt,
            List<String> tagIds) {
    }

    public record PublicDocumentListResponse(
            List<PublicDocumentListItem> data,
            AnnouncementReadDtos.PageMeta meta) {
    }

    /** Attachment metadata — public only while the parent doc is published. */
    public record PublicDocumentAttachmentResponse(
            String id,
            String fileName,
            String fileUrl,
            String mimeType,
            long fileSizeBytes,
            @Schema(types = {"string", "null"})
            String checksumSha256) {
    }

    /** Staff create/update payload — both locales are required on every write. */
    public record DocumentContentRequest(
            String slug,
            String categoryId,
            List<String> tagIds,
            String titleVi,
            String titleEn,
            String summaryVi,
            String summaryEn,
            String bodyVi,
            String bodyEn) {

        public static DocumentContentRequest from(JsonNode node) {
            return new DocumentContentRequest(
                    text(node, "slug"),
                    text(node, "categoryId"),
                    strings(node, "tagIds"),
                    text(node, "titleVi"),
                    text(node, "titleEn"),
                    text(node, "summaryVi"),
                    text(node, "summaryEn"),
                    text(node, "bodyVi"),
                    text(node, "bodyEn"));
        }
    }

    private static String text(JsonNode node, String field) {
        if (node == null) {
            return null;
        }
        JsonNode value = node.get(field);
        if (value == null || value.isNull()) {
            return null;
        }
        return value.asText();
    }

    private static List<String> strings(JsonNode node, String field) {
        if (node == null) {
            return List.of();
        }
        JsonNode value = node.get(field);
        if (value == null || value.isNull() || !value.isArray()) {
            return List.of();
        }
        java.util.ArrayList<String> result = new java.util.ArrayList<>(value.size());
        for (JsonNode item : value) {
            result.add(item.asText());
        }
        return List.copyOf(result);
    }
}
