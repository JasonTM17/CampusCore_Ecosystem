package io.campuscore.restfulapi.engagement.repository;

import io.campuscore.restfulapi.common.LikePattern;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Types;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import java.util.Optional;
import org.springframework.context.annotation.Profile;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

/**
 * JDBC adapter for the public-documentation lane. The document row is the
 * lifecycle shell; all content lives on {@code "PublicDocumentRevision"} rows
 * and anonymous reads are always pinned to {@code publishedRevision} so an
 * in-progress head revision can never leak (publication-policy §5).
 */
@Repository
@Profile("persistence")
public class PublicDocumentRepository {

    private static final String DOC = "\"engagement\".\"PublicDocument\"";
    private static final String REV = "\"engagement\".\"PublicDocumentRevision\"";
    private static final String ATT = "\"engagement\".\"PublicDocumentAttachment\"";
    private static final String TAG = "\"engagement\".\"PublicDocumentTagMap\"";
    private static final String AUDIT = "\"engagement\".\"PublicDocumentAudit\"";

    private final NamedParameterJdbcTemplate jdbc;

    public PublicDocumentRepository(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    // ------------------------------------------------------------------
    // Staff reads
    // ------------------------------------------------------------------

    public Optional<DocumentRow> findById(String id) {
        return jdbc.query(
                        "SELECT " + DOC_COLUMNS + " FROM " + DOC + " d WHERE d.\"id\" = :id",
                        new MapSqlParameterSource("id", id),
                        DOC_MAPPER)
                .stream()
                .findFirst();
    }

    /** Row-locked read for transitions — same FOR UPDATE convention as announcements. */
    public Optional<DocumentRow> findByIdForUpdate(String id) {
        return jdbc.query(
                        "SELECT " + DOC_COLUMNS + " FROM " + DOC + " d WHERE d.\"id\" = :id FOR UPDATE",
                        new MapSqlParameterSource("id", id),
                        DOC_MAPPER)
                .stream()
                .findFirst();
    }

    /**
     * The head revision — the row the review state machine operates on.
     * Concurrency is serialized by the document row lock the service holds
     * (findByIdForUpdate), so this is a plain read; the transition UPDATEs
     * still carry their own state predicates as the second safety layer.
     */
    public Optional<RevisionRow> findHeadRevision(String documentId) {
        return jdbc.query(
                        "SELECT " + REV_COLUMNS + " FROM " + REV + " rev"
                                + " JOIN " + DOC + " d ON d.\"id\" = rev.\"documentId\""
                                + " AND d.\"currentRevision\" = rev.\"revision\""
                                + " WHERE rev.\"documentId\" = :id",
                        new MapSqlParameterSource("id", documentId),
                        REV_MAPPER)
                .stream()
                .findFirst();
    }

    public List<String> tagIds(String documentId) {
        return jdbc.query(
                        "SELECT \"tagId\" FROM " + TAG + " WHERE \"documentId\" = :id ORDER BY \"tagId\"",
                        new MapSqlParameterSource("id", documentId),
                        (resultSet, ignored) -> resultSet.getString("tagId"));
    }

    public boolean existsBySlug(String slug) {
        Long count = jdbc.queryForObject(
                "SELECT COUNT(*) FROM " + DOC + " WHERE \"slug\" = :slug",
                new MapSqlParameterSource("slug", slug),
                Long.class);
        return count != null && count > 0;
    }

    /**
     * Staff list. {@code authorScope} (lecturer subject) narrows to own docs
     * plus docs whose head revision is under review — the same "own ∨ queue"
     * shape the announcement list uses.
     */
    public List<DocumentRow> list(String status, String authorScope, long offset, int limit) {
        MapSqlParameterSource parameters = new MapSqlParameterSource()
                .addValue("offset", offset)
                .addValue("limit", limit);
        List<String> conditions = new ArrayList<>();
        if (status != null) {
            conditions.add("d.\"status\" = :status");
            parameters.addValue("status", status);
        }
        if (authorScope != null) {
            conditions.add("(d.\"authorId\" = :authorScope OR EXISTS ("
                    + "SELECT 1 FROM " + REV + " rev WHERE rev.\"documentId\" = d.\"id\""
                    + " AND rev.\"revision\" = d.\"currentRevision\" AND rev.\"state\" = 'IN_REVIEW'))");
            parameters.addValue("authorScope", authorScope);
        }
        return jdbc.query(
                "SELECT " + DOC_COLUMNS + " FROM " + DOC + " d"
                        + (conditions.isEmpty() ? "" : " WHERE " + String.join(" AND ", conditions))
                        + " ORDER BY d.\"updatedAt\" DESC, d.\"id\" DESC LIMIT :limit OFFSET :offset",
                parameters,
                DOC_MAPPER);
    }

    public long count(String status, String authorScope) {
        MapSqlParameterSource parameters = new MapSqlParameterSource();
        List<String> conditions = new ArrayList<>();
        if (status != null) {
            conditions.add("d.\"status\" = :status");
            parameters.addValue("status", status);
        }
        if (authorScope != null) {
            conditions.add("(d.\"authorId\" = :authorScope OR EXISTS ("
                    + "SELECT 1 FROM " + REV + " rev WHERE rev.\"documentId\" = d.\"id\""
                    + " AND rev.\"revision\" = d.\"currentRevision\" AND rev.\"state\" = 'IN_REVIEW'))");
            parameters.addValue("authorScope", authorScope);
        }
        Long count = jdbc.queryForObject(
                "SELECT COUNT(*) FROM " + DOC + " d"
                        + (conditions.isEmpty() ? "" : " WHERE " + String.join(" AND ", conditions)),
                parameters,
                Long.class);
        return Objects.requireNonNullElse(count, 0L);
    }

    // ------------------------------------------------------------------
    // Writes — every mutation is a single-statement CAS where the contract
    // needs atomicity (state predicates inside the UPDATE).
    // ------------------------------------------------------------------

    public void insertDocument(CreateDocumentCommand command) {
        jdbc.update(
                "INSERT INTO " + DOC + " (\"id\", \"slug\", \"status\", \"authorId\","
                        + " \"currentRevision\", \"categoryId\", \"createdAt\", \"updatedAt\")"
                        + " VALUES (:id, :slug, 'DRAFT', :authorId, 1, :categoryId, :now, :now)",
                new MapSqlParameterSource()
                        .addValue("id", command.id())
                        .addValue("slug", command.slug())
                        .addValue("authorId", command.authorId())
                        .addValue("categoryId", command.categoryId())
                        .addValue("now", instant(command.createdAt())));
    }

    public void insertRevision(RevisionCommand command) {
        jdbc.update(
                "INSERT INTO " + REV + " (\"documentId\", \"revision\", \"state\","
                        + " \"titleVi\", \"titleEn\", \"summaryVi\", \"summaryEn\","
                        + " \"bodyVi\", \"bodyEn\", \"authorId\", \"createdAt\")"
                        + " VALUES (:documentId, :revision, 'DRAFT', :titleVi, :titleEn,"
                        + " :summaryVi, :summaryEn, :bodyVi, :bodyEn, :authorId, :createdAt)",
                revisionParams(command));
    }

    public void replaceTags(String documentId, List<String> tagIds) {
        jdbc.update("DELETE FROM " + TAG + " WHERE \"documentId\" = :id",
                new MapSqlParameterSource("id", documentId));
        for (String tagId : tagIds) {
            jdbc.update(
                    "INSERT INTO " + TAG + " (\"documentId\", \"tagId\") VALUES (:id, :tagId)",
                    new MapSqlParameterSource()
                            .addValue("id", documentId)
                            .addValue("tagId", tagId));
        }
    }

    /**
     * PUT path guard: bumps {@code currentRevision} only while it still holds
     * the value the locked read saw. The service inserts the next revision
     * row BEFORE this bump so a lost race leaves an unreachable draft row
     * rather than a head pointer with no revision behind it.
     */
    public int bumpCurrentRevision(String documentId, int nextRevision, Instant updatedAt) {
        return jdbc.update(
                "UPDATE " + DOC + " SET \"currentRevision\" = :rev, \"updatedAt\" = :now"
                        + " WHERE \"id\" = :id AND \"currentRevision\" = :rev - 1",
                new MapSqlParameterSource()
                        .addValue("rev", nextRevision)
                        .addValue("now", instant(updatedAt))
                        .addValue("id", documentId));
    }

    /** Head DRAFT {@literal ->} IN_REVIEW. */
    public int submitHead(String documentId, int revision) {
        return jdbc.update(
                "UPDATE " + REV + " SET \"state\" = 'IN_REVIEW'"
                        + " WHERE \"documentId\" = :id AND \"revision\" = :rev AND \"state\" = 'DRAFT'",
                new MapSqlParameterSource()
                        .addValue("id", documentId)
                        .addValue("rev", revision));
    }

    /** On a never-published doc, submit also moves the shell to IN_REVIEW. */
    public void markDocInReviewIfNeverPublished(String documentId, Instant now) {
        jdbc.update(
                "UPDATE " + DOC + " SET \"status\" = 'IN_REVIEW', \"updatedAt\" = :now"
                        + " WHERE \"id\" = :id AND \"status\" = 'DRAFT' AND \"publishedRevision\" IS NULL",
                new MapSqlParameterSource()
                        .addValue("id", documentId)
                        .addValue("now", instant(now)));
    }

    /** Prior published revision {@literal ->} SUPERSEDED (approve step 1). */
    public void supersedePublishedRevision(String documentId) {
        jdbc.update(
                "UPDATE " + REV + " SET \"state\" = 'SUPERSEDED'"
                        + " WHERE \"documentId\" = :id AND \"state\" = 'PUBLISHED'",
                new MapSqlParameterSource("id", documentId));
    }

    /** Head IN_REVIEW {@literal ->} PUBLISHED, binding reviewer identity. */
    public int approveHead(String documentId, int revision, String reviewerId, Instant reviewedAt) {
        return jdbc.update(
                "UPDATE " + REV + " SET \"state\" = 'PUBLISHED',"
                        + " \"reviewerId\" = :reviewerId, \"reviewedAt\" = :reviewedAt"
                        + " WHERE \"documentId\" = :id AND \"revision\" = :rev AND \"state\" = 'IN_REVIEW'",
                new MapSqlParameterSource()
                        .addValue("id", documentId)
                        .addValue("rev", revision)
                        .addValue("reviewerId", reviewerId)
                        .addValue("reviewedAt", instant(reviewedAt)));
    }

    public void markDocPublished(String documentId, int publishedRevision, Instant now) {
        jdbc.update(
                "UPDATE " + DOC + " SET \"status\" = 'PUBLISHED', \"publishedRevision\" = :rev,"
                        + " \"updatedAt\" = :now WHERE \"id\" = :id",
                new MapSqlParameterSource()
                        .addValue("rev", publishedRevision)
                        .addValue("now", instant(now))
                        .addValue("id", documentId));
    }

    /** Head IN_REVIEW {@literal ->} DRAFT with the mandatory reviewer note. */
    public int returnHead(String documentId, int revision, String reviewerId, String note, Instant reviewedAt) {
        return jdbc.update(
                "UPDATE " + REV + " SET \"state\" = 'DRAFT',"
                        + " \"reviewerId\" = :reviewerId, \"reviewedAt\" = :reviewedAt,"
                        + " \"reviewNote\" = :note"
                        + " WHERE \"documentId\" = :id AND \"revision\" = :rev AND \"state\" = 'IN_REVIEW'",
                new MapSqlParameterSource()
                        .addValue("id", documentId)
                        .addValue("rev", revision)
                        .addValue("reviewerId", reviewerId)
                        .addValue("reviewedAt", instant(reviewedAt))
                        .addValue("note", note));
    }

    /** A returned never-published doc's shell drops back to DRAFT. */
    public void markDocDraftIfNeverPublished(String documentId, Instant now) {
        jdbc.update(
                "UPDATE " + DOC + " SET \"status\" = 'DRAFT', \"updatedAt\" = :now"
                        + " WHERE \"id\" = :id AND \"status\" = 'IN_REVIEW' AND \"publishedRevision\" IS NULL",
                new MapSqlParameterSource()
                        .addValue("id", documentId)
                        .addValue("now", instant(now)));
    }

    public int archive(String documentId, Instant now) {
        return jdbc.update(
                "UPDATE " + DOC + " SET \"status\" = 'ARCHIVED', \"updatedAt\" = :now"
                        + " WHERE \"id\" = :id AND \"status\" <> 'ARCHIVED'",
                new MapSqlParameterSource()
                        .addValue("id", documentId)
                        .addValue("now", instant(now)));
    }

    /** Restore lands DRAFT — publishedRevision stays as history (policy §5). */
    public int restore(String documentId, Instant now) {
        return jdbc.update(
                "UPDATE " + DOC + " SET \"status\" = 'DRAFT', \"updatedAt\" = :now"
                        + " WHERE \"id\" = :id AND \"status\" = 'ARCHIVED'",
                new MapSqlParameterSource()
                        .addValue("id", documentId)
                        .addValue("now", instant(now)));
    }

    public void appendAudit(AuditCommand command) {
        jdbc.update(
                "INSERT INTO " + AUDIT + " (\"id\", \"documentId\", \"action\", \"actorId\","
                        + " \"actorLabel\", \"reason\", \"version\", \"beforeState\", \"afterState\","
                        + " \"createdAt\")"
                        + " VALUES (:id, :documentId, :action, :actorId, :actorLabel, :reason,"
                        + " :version, :beforeState, :afterState, :createdAt)",
                new MapSqlParameterSource()
                        .addValue("id", command.id())
                        .addValue("documentId", command.documentId())
                        .addValue("action", command.action())
                        .addValue("actorId", command.actorId())
                        .addValue("actorLabel", command.actorLabel())
                        .addValue("reason", command.reason())
                        .addValue("version", command.version())
                        .addValue("beforeState", command.beforeState())
                        .addValue("afterState", command.afterState())
                        .addValue("createdAt", instant(command.createdAt())));
    }

    // ------------------------------------------------------------------
    // Anonymous public reads — all pinned to status='PUBLISHED' and the
    // publishedRevision row; anything else is an indistinguishable 404.
    // ------------------------------------------------------------------

    public List<PublicListRow> findPublic(String search, String categoryId, String tagId, long offset, int limit) {
        SqlWhere where = publicWhere(search, categoryId, tagId);
        where.parameters().addValue("offset", offset).addValue("limit", limit);
        return jdbc.query(
                "SELECT " + PUBLIC_COLUMNS + " FROM " + DOC + " d"
                        + " JOIN " + REV + " rev ON rev.\"documentId\" = d.\"id\""
                        + " AND rev.\"revision\" = d.\"publishedRevision\""
                        + where.sql()
                        + " ORDER BY rev.\"createdAt\" DESC, d.\"slug\" DESC LIMIT :limit OFFSET :offset",
                where.parameters(),
                PUBLIC_LIST_MAPPER);
    }

    public long countPublic(String search, String categoryId, String tagId) {
        SqlWhere where = publicWhere(search, categoryId, tagId);
        Long count = jdbc.queryForObject(
                "SELECT COUNT(*) FROM " + DOC + " d"
                        + " JOIN " + REV + " rev ON rev.\"documentId\" = d.\"id\""
                        + " AND rev.\"revision\" = d.\"publishedRevision\""
                        + where.sql(),
                where.parameters(),
                Long.class);
        return Objects.requireNonNullElse(count, 0L);
    }

    /** Anonymous detail — only the published revision's content. */
    public Optional<PublicDocRow> findPublicBySlug(String slug) {
        return jdbc.query(
                        "SELECT " + PUBLIC_COLUMNS + ", rev.\"bodyVi\", rev.\"bodyEn\""
                                + " FROM " + DOC + " d"
                                + " JOIN " + REV + " rev ON rev.\"documentId\" = d.\"id\""
                                + " AND rev.\"revision\" = d.\"publishedRevision\""
                                + " WHERE d.\"status\" = 'PUBLISHED' AND d.\"slug\" = :slug"
                                + " LIMIT 2",
                        new MapSqlParameterSource("slug", slug),
                        PUBLIC_DETAIL_MAPPER)
                .stream()
                .findFirst();
    }

    /**
     * Revision permalink: serves any revision at or below publishedRevision on
     * a live doc. Older rows answer {@code superseded=true}; a revision newer
     * than publishedRevision does not exist for the public (no oracle). The
     * state predicate is belt-and-suspenders — no revision below
     * publishedRevision can be a draft, but the filter keeps the invariant
     * local to this query.
     */
    public Optional<PublicDocRow> findPublicRevision(String slug, int revision) {
        return jdbc.query(
                        "SELECT " + PUBLIC_COLUMNS + ", rev.\"bodyVi\", rev.\"bodyEn\""
                                + " FROM " + DOC + " d"
                                + " JOIN " + REV + " rev ON rev.\"documentId\" = d.\"id\""
                                + " AND rev.\"revision\" = :revision"
                                + " WHERE d.\"status\" = 'PUBLISHED' AND d.\"slug\" = :slug"
                                + " AND rev.\"state\" IN ('PUBLISHED', 'SUPERSEDED')"
                                + " AND :revision <= d.\"publishedRevision\""
                                + " LIMIT 2",
                        new MapSqlParameterSource()
                                .addValue("slug", slug)
                                .addValue("revision", revision),
                        PUBLIC_DETAIL_MAPPER)
                .stream()
                .findFirst();
    }

    /** Attachment metadata only while the parent doc is live and the row isPublic. */
    public Optional<AttachmentRow> findPublicAttachment(String slug, String attachmentId) {
        return jdbc.query(
                        "SELECT " + ATT_COLUMNS + " FROM " + ATT + " a"
                                + " JOIN " + DOC + " d ON d.\"id\" = a.\"documentId\""
                                + " WHERE d.\"status\" = 'PUBLISHED' AND d.\"slug\" = :slug"
                                + " AND a.\"id\" = :attachmentId AND a.\"isPublic\""
                                + " LIMIT 2",
                        new MapSqlParameterSource()
                                .addValue("slug", slug)
                                .addValue("attachmentId", attachmentId),
                        ATT_MAPPER)
                .stream()
                .findFirst();
    }

    public List<AttachmentRow> attachmentsForDocument(String documentId) {
        return jdbc.query(
                "SELECT " + ATT_COLUMNS + " FROM " + ATT + " a WHERE a.\"documentId\" = :id",
                new MapSqlParameterSource("id", documentId),
                ATT_MAPPER);
    }

    /** Batch tag fetch — one query for a whole result page, grouped by caller. */
    public List<TagAssignment> findTagsForDocuments(List<String> documentIds) {
        if (documentIds.isEmpty()) {
            return List.of();
        }
        return jdbc.query(
                "SELECT \"documentId\", \"tagId\" FROM " + TAG
                        + " WHERE \"documentId\" IN (:ids) ORDER BY \"tagId\"",
                new MapSqlParameterSource("ids", documentIds),
                (resultSet, ignored) -> new TagAssignment(
                        resultSet.getString("documentId"), resultSet.getString("tagId")));
    }

    /** Staff category move — slug stays immutable (permalinks), category may move. */
    public void updateCategory(String documentId, String categoryId) {
        jdbc.update(
                "UPDATE " + DOC + " SET \"categoryId\" = :categoryId WHERE \"id\" = :id",
                new MapSqlParameterSource()
                        .addValue("id", documentId)
                        .addValue("categoryId", categoryId));
    }

    public record TagAssignment(String documentId, String tagId) {
    }

    private SqlWhere publicWhere(String search, String categoryId, String tagId) {
        MapSqlParameterSource parameters = new MapSqlParameterSource();
        List<String> conditions = new ArrayList<>();
        conditions.add("d.\"status\" = 'PUBLISHED'");
        if (categoryId != null) {
            conditions.add("d.\"categoryId\" = :categoryId");
            parameters.addValue("categoryId", categoryId);
        }
        if (tagId != null) {
            conditions.add("EXISTS (SELECT 1 FROM " + TAG + " tag"
                    + " WHERE tag.\"documentId\" = d.\"id\" AND tag.\"tagId\" = :tagId)");
            parameters.addValue("tagId", tagId);
        }
        List<String> tokens = LikePattern.tokens(search);
        if (!tokens.isEmpty()) {
            parameters.addValue("foldFrom", LikePattern.FOLD_FROM);
            parameters.addValue("foldTo", LikePattern.FOLD_TO);
            for (int index = 0; index < tokens.size(); index++) {
                String paramName = "search" + index;
                parameters.addValue(paramName, tokens.get(index));
                conditions.add("(TRANSLATE(LOWER(COALESCE(rev.\"titleVi\", '')), :foldFrom, :foldTo) LIKE :" + paramName + " ESCAPE '\\'"
                        + " OR TRANSLATE(LOWER(COALESCE(rev.\"titleEn\", '')), :foldFrom, :foldTo) LIKE :" + paramName + " ESCAPE '\\'"
                        + " OR TRANSLATE(LOWER(COALESCE(rev.\"summaryVi\", '')), :foldFrom, :foldTo) LIKE :" + paramName + " ESCAPE '\\'"
                        + " OR TRANSLATE(LOWER(COALESCE(rev.\"summaryEn\", '')), :foldFrom, :foldTo) LIKE :" + paramName + " ESCAPE '\\'"
                        + " OR TRANSLATE(LOWER(COALESCE(rev.\"bodyVi\", '')), :foldFrom, :foldTo) LIKE :" + paramName + " ESCAPE '\\'"
                        + " OR TRANSLATE(LOWER(COALESCE(rev.\"bodyEn\", '')), :foldFrom, :foldTo) LIKE :" + paramName + " ESCAPE '\\')");
            }
        }
        return new SqlWhere(" WHERE " + String.join(" AND ", conditions), parameters);
    }

    private record SqlWhere(String sql, MapSqlParameterSource parameters) {
    }

    // ------------------------------------------------------------------
    // Row shapes and mappers
    // ------------------------------------------------------------------

    private static final String DOC_COLUMNS = """
            d."id", d."slug", d."status", d."authorId", d."currentRevision",
            d."publishedRevision", d."categoryId", d."createdAt", d."updatedAt"
            """;

    private static final String REV_COLUMNS = """
            rev."documentId", rev."revision", rev."state", rev."titleVi", rev."titleEn",
            rev."summaryVi", rev."summaryEn", rev."bodyVi", rev."bodyEn", rev."authorId",
            rev."reviewerId", rev."reviewedAt", rev."reviewNote", rev."createdAt"
            """;

    private static final String PUBLIC_COLUMNS = """
            d."id" AS "documentId", d."slug", d."categoryId", d."publishedRevision",
            rev."revision", rev."titleVi", rev."titleEn", rev."summaryVi", rev."summaryEn",
            rev."createdAt" AS "publishedAt"
            """;

    private static final String ATT_COLUMNS = """
            a."id", a."documentId", a."fileName", a."fileUrl", a."mimeType",
            a."fileSizeBytes", a."checksumSha256", a."isPublic", a."createdAt"
            """;

    private static final RowMapper<DocumentRow> DOC_MAPPER = PublicDocumentRepository::mapDocument;
    private static final RowMapper<RevisionRow> REV_MAPPER = PublicDocumentRepository::mapRevision;
    private static final RowMapper<PublicListRow> PUBLIC_LIST_MAPPER = PublicDocumentRepository::mapPublicList;
    private static final RowMapper<PublicDocRow> PUBLIC_DETAIL_MAPPER = PublicDocumentRepository::mapPublicDetail;
    private static final RowMapper<AttachmentRow> ATT_MAPPER = PublicDocumentRepository::mapAttachment;

    private static DocumentRow mapDocument(ResultSet rs, int ignored) throws SQLException {
        return new DocumentRow(
                rs.getString("id"),
                rs.getString("slug"),
                rs.getString("status"),
                rs.getString("authorId"),
                rs.getInt("currentRevision"),
                nullableInteger(rs, "publishedRevision"),
                rs.getString("categoryId"),
                instant(rs, "createdAt"),
                instant(rs, "updatedAt"));
    }

    private static RevisionRow mapRevision(ResultSet rs, int ignored) throws SQLException {
        return new RevisionRow(
                rs.getString("documentId"),
                rs.getInt("revision"),
                rs.getString("state"),
                rs.getString("titleVi"),
                rs.getString("titleEn"),
                rs.getString("summaryVi"),
                rs.getString("summaryEn"),
                rs.getString("bodyVi"),
                rs.getString("bodyEn"),
                rs.getString("authorId"),
                rs.getString("reviewerId"),
                instant(rs, "reviewedAt"),
                rs.getString("reviewNote"),
                instant(rs, "createdAt"));
    }

    private static PublicListRow mapPublicList(ResultSet rs, int ignored) throws SQLException {
        return new PublicListRow(
                rs.getString("documentId"),
                rs.getString("slug"),
                rs.getString("categoryId"),
                rs.getInt("publishedRevision"),
                rs.getString("titleVi"),
                rs.getString("titleEn"),
                rs.getString("summaryVi"),
                rs.getString("summaryEn"),
                instant(rs, "publishedAt"));
    }

    private static PublicDocRow mapPublicDetail(ResultSet rs, int ignored) throws SQLException {
        return new PublicDocRow(
                rs.getString("documentId"),
                rs.getString("slug"),
                rs.getString("categoryId"),
                rs.getInt("publishedRevision"),
                rs.getInt("revision"),
                rs.getString("titleVi"),
                rs.getString("titleEn"),
                rs.getString("summaryVi"),
                rs.getString("summaryEn"),
                rs.getString("bodyVi"),
                rs.getString("bodyEn"),
                instant(rs, "publishedAt"));
    }

    private static AttachmentRow mapAttachment(ResultSet rs, int ignored) throws SQLException {
        return new AttachmentRow(
                rs.getString("id"),
                rs.getString("documentId"),
                rs.getString("fileName"),
                rs.getString("fileUrl"),
                rs.getString("mimeType"),
                rs.getLong("fileSizeBytes"),
                rs.getString("checksumSha256"),
                rs.getBoolean("isPublic"),
                instant(rs, "createdAt"));
    }

    private static MapSqlParameterSource revisionParams(RevisionCommand command) {
        return new MapSqlParameterSource()
                .addValue("documentId", command.documentId())
                .addValue("revision", command.revision())
                .addValue("titleVi", command.titleVi())
                .addValue("titleEn", command.titleEn())
                .addValue("summaryVi", command.summaryVi())
                .addValue("summaryEn", command.summaryEn())
                .addValue("bodyVi", command.bodyVi())
                .addValue("bodyEn", command.bodyEn())
                .addValue("authorId", command.authorId())
                .addValue("createdAt", instant(command.createdAt()));
    }

    private static Integer nullableInteger(ResultSet rs, String column) throws SQLException {
        int value = rs.getInt(column);
        return rs.wasNull() ? null : value;
    }

    private static OffsetDateTime instant(Instant value) {
        return value == null ? null : OffsetDateTime.ofInstant(value, ZoneOffset.UTC);
    }

    private static Instant instant(ResultSet rs, String column) throws SQLException {
        OffsetDateTime value = rs.getObject(column, OffsetDateTime.class);
        return value == null ? null : value.toInstant();
    }

    public record DocumentRow(
            String id,
            String slug,
            String status,
            String authorId,
            int currentRevision,
            Integer publishedRevision,
            String categoryId,
            Instant createdAt,
            Instant updatedAt) {
    }

    public record RevisionRow(
            String documentId,
            int revision,
            String state,
            String titleVi,
            String titleEn,
            String summaryVi,
            String summaryEn,
            String bodyVi,
            String bodyEn,
            String authorId,
            String reviewerId,
            Instant reviewedAt,
            String reviewNote,
            Instant createdAt) {
    }

    public record PublicListRow(
            String documentId,
            String slug,
            String categoryId,
            int publishedRevision,
            String titleVi,
            String titleEn,
            String summaryVi,
            String summaryEn,
            Instant publishedAt) {
    }

    /** Detail row: {@code revision} is the served revision (permalink target). */
    public record PublicDocRow(
            String documentId,
            String slug,
            String categoryId,
            int publishedRevision,
            int revision,
            String titleVi,
            String titleEn,
            String summaryVi,
            String summaryEn,
            String bodyVi,
            String bodyEn,
            Instant publishedAt) {
    }

    public record AttachmentRow(
            String id,
            String documentId,
            String fileName,
            String fileUrl,
            String mimeType,
            long fileSizeBytes,
            String checksumSha256,
            boolean isPublic,
            Instant createdAt) {
    }

    public record CreateDocumentCommand(
            String id,
            String slug,
            String authorId,
            String categoryId,
            Instant createdAt) {
    }

    public record RevisionCommand(
            String documentId,
            int revision,
            String titleVi,
            String titleEn,
            String summaryVi,
            String summaryEn,
            String bodyVi,
            String bodyEn,
            String authorId,
            Instant createdAt) {
    }

    public record AuditCommand(
            String id,
            String documentId,
            String action,
            String actorId,
            String actorLabel,
            String reason,
            int version,
            String beforeState,
            String afterState,
            Instant createdAt) {
    }
}
