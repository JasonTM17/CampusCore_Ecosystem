package io.campuscore.restfulapi.engagement.repository;

import io.campuscore.restfulapi.engagement.domain.ArticleAttachment;
import io.campuscore.restfulapi.engagement.domain.ArticleMediaGallery;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Types;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import org.springframework.context.annotation.Profile;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

/**
 * Caller-visible reads for {@code ArticleAttachment} and
 * {@code ArticleMediaGallery} (publication-policy §4, ANN-T05). Every route
 * joins the parent {@code engagement."Announcement"} and applies the same
 * two-tier rule as reading the announcement itself:
 *
 * <ul>
 *   <li>Published parent (PUBLISHED, in-window, unarchived): the caller must
 *       satisfy the announcement audience predicate — the {@code userWhere}
 *       scoping of the read repository — while ADMIN/SUPER_ADMIN and the
 *       announcement author bypass the audience part.</li>
 *   <li>Unpublished parent (DRAFT/IN_REVIEW/ARCHIVED): visible only to the
 *       writer set — governance sees everything, lecturers see their own
 *       drafts and the IN_REVIEW review queue; students and anonymous callers
 *       see nothing.</li>
 *   <li>A missing parent matches no tier, so the row simply does not exist —
 *       the same answer as an absent asset (no existence oracle).</li>
 * </ul>
 */
@Repository
@Profile("persistence")
public class ArticleAssetReadRepository {

    private static final String ANNOUNCEMENT = "\"engagement\".\"Announcement\"";
    private static final String ATTACHMENT = "\"engagement\".\"ArticleAttachment\"";
    private static final String GALLERY = "\"engagement\".\"ArticleMediaGallery\"";

    private static final String ATT_COLUMNS = """
            a."id", a."announcementId", a."fileName", a."fileUrl", a."fileSizeBytes",
            a."mimeType", a."checksumSha256", a."downloadCount", a."isPublic", a."createdAt"
            """;

    private static final String GAL_COLUMNS = """
            g."id", g."announcementId", g."mediaUrl", g."thumbnailUrl", g."captionVi",
            g."captionEn", g."altText", g."mediaType", g."aspectRatio", g."width",
            g."height", g."fileSizeBytes", g."displayOrder", g."isCover", g."createdAt"
            """;

    private final NamedParameterJdbcTemplate jdbc;

    public ArticleAssetReadRepository(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /** Caller context — the announcement-side userWhere inputs plus identity flags. */
    public record AssetVisibility(
            List<String> roles,
            String subject,
            String studentId,
            Integer studentYear,
            String lecturerId,
            Instant now) {

        public boolean governance() {
            return roles.contains("ADMIN") || roles.contains("SUPER_ADMIN");
        }

        /** Writer set: lecturer preview and governance — policy §4 unpublished tier. */
        public boolean writerSet() {
            return governance() || roles.contains("LECTURER");
        }
    }

    // ------------------------------------------------------------------
    // Scoped visibility — the "is this parent visible to me" check behind
    // announcementId-scoped routes; false answers a caller-safe 404.
    // ------------------------------------------------------------------

    public boolean isParentVisible(String announcementId, AssetVisibility visibility) {
        SqlWhere where = parentWhere(visibility);
        where.parameters().addValue("parentId", announcementId);
        Long count = jdbc.queryForObject(
                "SELECT COUNT(*) FROM " + ANNOUNCEMENT + " p"
                        + " WHERE p.\"id\" = :parentId" + where.sql(),
                where.parameters(),
                Long.class);
        return count != null && count > 0;
    }

    // ------------------------------------------------------------------
    // Attachment reads — isPublic stays a per-asset flag on the published
    // tier; the writer preview tier sees every row of a draft parent.
    // ------------------------------------------------------------------

    public List<ArticleAttachment> findAttachments(
            String announcementId, AssetVisibility visibility, long offset, int limit) {
        SqlWhere where = assetWhere(announcementId, visibility, true);
        where.parameters().addValue("offset", offset).addValue("limit", limit);
        return jdbc.query(
                "SELECT " + ATT_COLUMNS + " FROM " + ATTACHMENT + " a"
                        + " JOIN " + ANNOUNCEMENT + " p ON p.\"id\" = a.\"announcementId\""
                        + where.sql()
                        + " ORDER BY a.\"createdAt\" ASC, a.\"id\" ASC LIMIT :limit OFFSET :offset",
                where.parameters(),
                ATTACHMENT_MAPPER);
    }

    public long countAttachments(String announcementId, AssetVisibility visibility) {
        SqlWhere where = assetWhere(announcementId, visibility, true);
        Long count = jdbc.queryForObject(
                "SELECT COUNT(*) FROM " + ATTACHMENT + " a"
                        + " JOIN " + ANNOUNCEMENT + " p ON p.\"id\" = a.\"announcementId\""
                        + where.sql(),
                where.parameters(),
                Long.class);
        return Objects.requireNonNullElse(count, 0L);
    }

    // ------------------------------------------------------------------
    // Gallery reads — same parent join; the entity carries no isPublic flag.
    // ------------------------------------------------------------------

    public List<ArticleMediaGallery> findGalleries(
            String announcementId, AssetVisibility visibility, long offset, int limit) {
        SqlWhere where = assetWhere(announcementId, visibility, false);
        where.parameters().addValue("offset", offset).addValue("limit", limit);
        return jdbc.query(
                "SELECT " + GAL_COLUMNS + " FROM " + GALLERY + " g"
                        + " JOIN " + ANNOUNCEMENT + " p ON p.\"id\" = g.\"announcementId\""
                        + where.sql()
                        + " ORDER BY g.\"displayOrder\" ASC, g.\"id\" ASC LIMIT :limit OFFSET :offset",
                where.parameters(),
                GALLERY_MAPPER);
    }

    public long countGalleries(String announcementId, AssetVisibility visibility) {
        SqlWhere where = assetWhere(announcementId, visibility, false);
        Long count = jdbc.queryForObject(
                "SELECT COUNT(*) FROM " + GALLERY + " g"
                        + " JOIN " + ANNOUNCEMENT + " p ON p.\"id\" = g.\"announcementId\""
                        + where.sql(),
                where.parameters(),
                Long.class);
        return Objects.requireNonNullElse(count, 0L);
    }

    // ------------------------------------------------------------------
    // Predicate builders
    // ------------------------------------------------------------------

    /**
     * The two-tier parent predicate as a WHERE body (the JOIN itself already
     * binds {@code p} to the asset's {@code announcementId}).
     * {@code applyIsPublic} adds the per-asset flag on the published tier —
     * attachments only; galleries have no such column.
     */
    private SqlWhere assetWhere(String announcementId, AssetVisibility visibility, boolean applyIsPublic) {
        MapSqlParameterSource parameters = baseParameters(visibility);
        List<String> conditions = new ArrayList<>();

        String published = publishedTier(visibility, parameters);
        if (applyIsPublic) {
            published += " AND a.\"isPublic\" = TRUE";
        }
        String unpublished = unpublishedTier(visibility, parameters);
        conditions.add("(" + published + "\n   OR " + unpublished + ")");

        if (announcementId != null) {
            parameters.addValue("parentId", announcementId);
            conditions.add(applyIsPublic ? "a.\"announcementId\" = :parentId" : "g.\"announcementId\" = :parentId");
        }
        return new SqlWhere(" WHERE " + String.join(" AND ", conditions), parameters);
    }

    /**
     * Parent-visible predicate for the scoped {@code announcementId} check —
     * the same tiers, expressed on the announcement row itself.
     */
    private SqlWhere parentWhere(AssetVisibility visibility) {
        MapSqlParameterSource parameters = baseParameters(visibility);
        String published = publishedTier(visibility, parameters);
        String unpublished = unpublishedTier(visibility, parameters);
        return new SqlWhere(" AND (" + published + "\n   OR " + unpublished + ")", parameters);
    }

    /** PUBLISHED + in-window + unarchived, gated by audience or bypass. */
    private String publishedTier(AssetVisibility visibility, MapSqlParameterSource parameters) {
        List<String> audience = new ArrayList<>();
        audience.add("p.\"isGlobal\" = TRUE");
        for (int index = 0; index < visibility.roles().size(); index++) {
            String parameter = "role" + index;
            audience.add(":" + parameter + " = ANY(p.\"targetRoles\")");
            parameters.addValue(parameter, visibility.roles().get(index));
        }
        if (visibility.lecturerId() != null) {
            audience.add("p.\"lecturerId\" = :lecturerId");
            parameters.addValue("lecturerId", visibility.lecturerId());
        }
        // Audience = OR-terms AND the student/lecturer narrowing — the exact
        // shape userWhere applies to the announcement read itself.
        StringBuilder scoped = new StringBuilder("(")
                .append(String.join(" OR ", audience))
                .append(")");
        if (visibility.studentId() != null) {
            if (visibility.studentYear() == null) {
                scoped.append(" AND CARDINALITY(p.\"targetYears\") = 0");
            } else {
                scoped.append(" AND (CARDINALITY(p.\"targetYears\") = 0")
                        .append(" OR :studentYear = ANY(p.\"targetYears\"))");
                parameters.addValue("studentYear", visibility.studentYear());
            }
            scoped.append(" AND (p.\"sectionId\" IS NULL OR p.\"sectionId\" IN (")
                    .append("SELECT enrollment.\"sectionId\" FROM academic.\"Enrollment\" enrollment")
                    .append(" WHERE enrollment.\"studentId\" = :viewerStudentId")
                    .append(" AND enrollment.\"status\" NOT IN ('DROPPED', 'CANCELLED')))");
            parameters.addValue("viewerStudentId", visibility.studentId());
        }
        // A notice that names a lecturer only reaches that lecturer.
        if (visibility.roles().contains("LECTURER") && visibility.lecturerId() != null) {
            scoped.append(" AND (p.\"lecturerId\" IS NULL OR p.\"lecturerId\" = :lecturerId)");
        }
        return "( p.\"status\" = 'PUBLISHED' AND p.\"archivedAt\" IS NULL"
                + " AND (p.\"publishAt\" IS NULL OR p.\"publishAt\" <= :now)"
                + " AND (p.\"expiresAt\" IS NULL OR p.\"expiresAt\" > :now)"
                + " AND ( :bypass = TRUE OR p.\"authorId\" = :subject OR ("
                + scoped + ") ) )";
    }

    /**
     * Writer-preview tier — anything NOT currently public to its audience
     * (draft, in-review, archived, and published-but-out-of-window parents)
     * is visible only to the writer set. Governance sees every such parent;
     * a lecturer sees own drafts plus the IN_REVIEW queue.
     */
    private String unpublishedTier(AssetVisibility visibility, MapSqlParameterSource parameters) {
        parameters.addValue("writerSet", visibility.writerSet());
        return "( :writerSet = TRUE"
                + " AND NOT ( p.\"status\" = 'PUBLISHED' AND p.\"archivedAt\" IS NULL"
                + " AND (p.\"publishAt\" IS NULL OR p.\"publishAt\" <= :now)"
                + " AND (p.\"expiresAt\" IS NULL OR p.\"expiresAt\" > :now) )"
                + " AND ( :bypass = TRUE OR p.\"authorId\" = :subject"
                + " OR ( :lecturerQueue = TRUE AND p.\"status\" = 'IN_REVIEW' ) ) )";
    }

    private MapSqlParameterSource baseParameters(AssetVisibility visibility) {
        return new MapSqlParameterSource()
                .addValue("now",
                        OffsetDateTime.ofInstant(visibility.now(), ZoneOffset.UTC),
                        Types.TIMESTAMP_WITH_TIMEZONE)
                .addValue("bypass", visibility.governance())
                .addValue("subject", visibility.subject())
                .addValue("lecturerQueue", visibility.roles().contains("LECTURER"));
    }

    private record SqlWhere(String sql, MapSqlParameterSource parameters) {
    }

    // ------------------------------------------------------------------
    // Mappers — entities keep their JPA shape so the legacy route contract
    // (raw entity serialization) stays byte-identical.
    // ------------------------------------------------------------------

    private static final RowMapper<ArticleAttachment> ATTACHMENT_MAPPER =
            ArticleAssetReadRepository::mapAttachment;

    private static ArticleAttachment mapAttachment(ResultSet rs, int ignored) throws SQLException {
        ArticleAttachment row = new ArticleAttachment();
        row.setId(rs.getString("id"));
        row.setAnnouncementId(rs.getString("announcementId"));
        row.setFileName(rs.getString("fileName"));
        row.setFileUrl(rs.getString("fileUrl"));
        row.setFileSizeBytes(rs.getLong("fileSizeBytes"));
        row.setMimeType(rs.getString("mimeType"));
        row.setChecksumSha256(rs.getString("checksumSha256"));
        row.setDownloadCount(rs.getInt("downloadCount"));
        row.setPublic(rs.getBoolean("isPublic"));
        row.setCreatedAt(instant(rs, "createdAt"));
        return row;
    }

    private static final RowMapper<ArticleMediaGallery> GALLERY_MAPPER =
            ArticleAssetReadRepository::mapGallery;

    private static ArticleMediaGallery mapGallery(ResultSet rs, int ignored) throws SQLException {
        ArticleMediaGallery row = new ArticleMediaGallery();
        row.setId(rs.getString("id"));
        row.setAnnouncementId(rs.getString("announcementId"));
        row.setMediaUrl(rs.getString("mediaUrl"));
        row.setThumbnailUrl(rs.getString("thumbnailUrl"));
        row.setCaptionVi(rs.getString("captionVi"));
        row.setCaptionEn(rs.getString("captionEn"));
        row.setAltText(rs.getString("altText"));
        row.setMediaType(rs.getString("mediaType"));
        row.setAspectRatio(rs.getString("aspectRatio"));
        int width = rs.getInt("width");
        row.setWidth(rs.wasNull() ? null : width);
        int height = rs.getInt("height");
        row.setHeight(rs.wasNull() ? null : height);
        long size = rs.getLong("fileSizeBytes");
        row.setFileSizeBytes(rs.wasNull() ? null : size);
        row.setDisplayOrder(rs.getInt("displayOrder"));
        row.setCover(rs.getBoolean("isCover"));
        row.setCreatedAt(instant(rs, "createdAt"));
        return row;
    }

    private static Instant instant(ResultSet rs, String column) throws SQLException {
        OffsetDateTime value = rs.getObject(column, OffsetDateTime.class);
        return value == null ? null : value.toInstant();
    }
}
