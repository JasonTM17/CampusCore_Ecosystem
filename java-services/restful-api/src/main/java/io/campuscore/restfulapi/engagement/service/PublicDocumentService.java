package io.campuscore.restfulapi.engagement.service;

import io.campuscore.restfulapi.engagement.repository.PublicDocumentRepository;
import io.campuscore.restfulapi.engagement.repository.PublicDocumentRepository.AttachmentRow;
import io.campuscore.restfulapi.engagement.repository.PublicDocumentRepository.AuditCommand;
import io.campuscore.restfulapi.engagement.repository.PublicDocumentRepository.CreateDocumentCommand;
import io.campuscore.restfulapi.engagement.repository.PublicDocumentRepository.DocumentRow;
import io.campuscore.restfulapi.engagement.repository.PublicDocumentRepository.PublicDocRow;
import io.campuscore.restfulapi.engagement.repository.PublicDocumentRepository.PublicListRow;
import io.campuscore.restfulapi.engagement.repository.PublicDocumentRepository.RevisionCommand;
import io.campuscore.restfulapi.engagement.repository.PublicDocumentRepository.RevisionRow;
import io.campuscore.restfulapi.engagement.service.AnnouncementHtmlSanitizer.SanitizationResult;
import io.campuscore.restfulapi.engagement.web.AnnouncementReadDtos.PageMeta;
import io.campuscore.restfulapi.engagement.web.PublicDocumentDtos.DocumentContentRequest;
import io.campuscore.restfulapi.engagement.web.PublicDocumentDtos.DocumentListResponse;
import io.campuscore.restfulapi.engagement.web.PublicDocumentDtos.DocumentResponse;
import io.campuscore.restfulapi.engagement.web.PublicDocumentDtos.PublicDocumentAttachmentResponse;
import io.campuscore.restfulapi.engagement.web.PublicDocumentDtos.PublicDocumentListItem;
import io.campuscore.restfulapi.engagement.web.PublicDocumentDtos.PublicDocumentListResponse;
import io.campuscore.restfulapi.engagement.web.PublicDocumentDtos.PublicDocumentResponse;
import io.campuscore.restfulapi.engagement.web.PublicDocumentDtos.RevisionResponse;
import io.campuscore.restfulapi.web.DomainException;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.core.JacksonException;
import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.annotation.Profile;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/**
 * Public-documentation lane: revision-scoped review state machine where the
 * document row answers "is anything public" and the head revision carries the
 * workflow state (publication-policy §5). Anonymous reads are pinned to
 * {@code publishedRevision}; staff mutations lock the document row and
 * re-check state inside the lock — the same convention announcements use.
 */
@Service
@Profile("persistence")
public class PublicDocumentService {

    private static final Logger LOGGER = LoggerFactory.getLogger(PublicDocumentService.class);
    private static final int MAX_ACTOR_LABEL_LENGTH = 240;
    private static final int MAX_SLUG_LENGTH = 240;
    private static final Set<String> DOC_STATUSES = Set.of("DRAFT", "IN_REVIEW", "PUBLISHED", "ARCHIVED", "ALL");
    private static final Set<String> GOVERNANCE_ROLES = Set.of("ADMIN", "SUPER_ADMIN");

    private final PublicDocumentRepository documents;
    private final ObjectMapper objectMapper;
    private final Clock clock;

    public PublicDocumentService(
            PublicDocumentRepository documents,
            ObjectMapper objectMapper) {
        this.documents = documents;
        this.objectMapper = objectMapper;
        this.clock = Clock.systemUTC();
    }

    // ------------------------------------------------------------------
    // Staff surface
    // ------------------------------------------------------------------

    @Transactional
    public DocumentResponse create(
            String actorId,
            String actorLabel,
            List<String> roles,
            DocumentContentRequest request) {
        String actor = requireText(actorId, "actor");
        String label = requireActorLabel(actorLabel);
        String slug = requireSlug(request.slug());
        if (documents.existsBySlug(slug)) {
            throw conflict("DOCUMENT_SLUG_TAKEN", "A document with this slug already exists");
        }
        SanitizedBodies bodies = sanitize(request);
        Instant now = Instant.now(clock);
        String id = UUID.randomUUID().toString();
        documents.insertDocument(new CreateDocumentCommand(
                id, slug, actor, request.categoryId(), now));
        documents.insertRevision(new RevisionCommand(
                id, 1, request.titleVi(), request.titleEn(),
                request.summaryVi(), request.summaryEn(),
                bodies.bodyVi(), bodies.bodyEn(), actor, now));
        documents.replaceTags(id, request.tagIds());
        DocumentResponse after = requireDocument(id);
        appendAudit("CREATED", actor, label, "Document created", null, after, 1, now);
        return after;
    }

    @Transactional(readOnly = true)
    public DocumentListResponse list(
            int page,
            int limit,
            String status,
            String authorScope) {
        requirePage(page, limit);
        String lifecycle = status == null || "ALL".equals(status) ? null : status;
        if (status != null && !DOC_STATUSES.contains(status)) {
            throw new IllegalArgumentException(
                    "status must be DRAFT, IN_REVIEW, PUBLISHED, ARCHIVED, or ALL");
        }
        long offset = (long) (page - 1) * limit;
        List<DocumentResponse> data = documents.list(lifecycle, authorScope, offset, limit)
                .stream()
                .map(row -> toResponse(row, headRevision(row.id()), documents.tagIds(row.id())))
                .toList();
        long total = documents.count(lifecycle, authorScope);
        long totalPages = total == 0 ? 0 : ((total - 1) / limit) + 1;
        return new DocumentListResponse(data, new PageMeta(total, page, limit, (int) totalPages));
    }

    @Transactional(readOnly = true)
    public DocumentResponse detail(String id, List<String> roles, String subject) {
        DocumentResponse doc = requireDocument(requireText(id, "document id"));
        // Lecturer-scope on reads: own docs or anything in the review queue;
        // governance roles read everything.
        if (isLecturerOnly(roles)
                && !subject.equals(doc.authorId())
                && (doc.headRevision() == null || !"IN_REVIEW".equals(doc.headRevision().state()))) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Document not found");
        }
        return doc;
    }

    /** PUT: creates the next head revision; allowed unless ARCHIVED. */
    @Transactional
    public DocumentResponse revise(
            String actorId,
            String actorLabel,
            List<String> roles,
            String documentId,
            DocumentContentRequest request) {
        String actor = requireText(actorId, "actor");
        String label = requireActorLabel(actorLabel);
        String id = requireText(documentId, "document id");
        DocumentRow before = requireDocumentForUpdate(id);
        if ("ARCHIVED".equals(before.status())) {
            throw conflict("DOCUMENT_ARCHIVED", "Archived documents must be restored before editing");
        }
        requireDocumentOwner(roles, actor, before);
        // Category/slug/tag changes ride the doc row; slug stays immutable —
        // permalinks would break if a published slug could move (§5).
        if (request.slug() != null && !request.slug().isBlank() && !before.slug().equals(request.slug())) {
            throw conflict("DOCUMENT_SLUG_IMMUTABLE", "The slug of a document cannot change");
        }
        if (request.categoryId() != null && !request.categoryId().equals(before.categoryId())) {
            updateCategory(id, request.categoryId());
        }
        // Capture the pre-mutation head and tags for the audit before-state.
        DocumentResponse beforeSnapshot = toResponse(before, headRevision(id), null);
        SanitizedBodies bodies = sanitize(request);
        Instant now = Instant.now(clock);
        int nextRevision = before.currentRevision() + 1;
        // Insert the revision first, then CAS-bump the head pointer — a lost
        // race leaves an unreachable draft row, never a dangling head.
        documents.insertRevision(new RevisionCommand(
                id, nextRevision, request.titleVi(), request.titleEn(),
                request.summaryVi(), request.summaryEn(),
                bodies.bodyVi(), bodies.bodyEn(), actor, now));
        if (documents.bumpCurrentRevision(id, nextRevision, now) != 1) {
            throw conflict("DOCUMENT_REVISION_CONFLICT", "Document was changed by another writer");
        }
        documents.replaceTags(id, request.tagIds());
        DocumentResponse after = requireDocument(id);
        appendAudit("REVISED", actor, label, "New revision " + nextRevision,
                beforeSnapshot, after, nextRevision, now);
        return after;
    }

    @Transactional
    public DocumentResponse submit(String actorId, String actorLabel, List<String> roles, String documentId) {
        String actor = requireText(actorId, "actor");
        String label = requireActorLabel(actorLabel);
        String id = requireText(documentId, "document id");
        DocumentRow before = requireDocumentForUpdate(id);
        if ("ARCHIVED".equals(before.status())) {
            throw invalidState();
        }
        RevisionRow head = requireHeadRevision(id);
        if (!"DRAFT".equals(head.state())) {
            throw invalidState();
        }
        if (!actor.equals(head.authorId()) && !isGovernance(roles)) {
            throw new DomainException(HttpStatus.FORBIDDEN, "DOCUMENT_NOT_AUTHOR",
                    "Only the revision author may submit it for review");
        }
        Instant now = Instant.now(clock);
        if (documents.submitHead(id, head.revision()) != 1) {
            throw conflict("DOCUMENT_STATE_CONFLICT", "Document was changed by another writer");
        }
        documents.markDocInReviewIfDraft(id, now);
        DocumentResponse after = requireDocument(id);
        appendAudit("SUBMITTED", actor, label, "Submitted for review",
                toResponse(before, head, null), after, head.revision(), now);
        return after;
    }

    @Transactional
    public DocumentResponse approve(String actorId, String actorLabel, List<String> roles, String documentId) {
        String actor = requireText(actorId, "actor");
        String label = requireActorLabel(actorLabel);
        String id = requireText(documentId, "document id");
        DocumentRow before = requireDocumentForUpdate(id);
        if ("ARCHIVED".equals(before.status())) {
            throw invalidState();
        }
        RevisionRow head = requireHeadRevision(id);
        if (!"IN_REVIEW".equals(head.state())) {
            throw invalidState();
        }
        if (actor.equals(head.authorId())) {
            throw conflict("REVIEWER_EQUALS_AUTHOR",
                    "The revision author cannot approve their own document");
        }
        Instant now = Instant.now(clock);
        documents.supersedePublishedRevision(id);
        if (documents.approveHead(id, head.revision(), actor, now) != 1) {
            throw conflict("DOCUMENT_STATE_CONFLICT", "Document was changed by another writer");
        }
        documents.markDocPublished(id, head.revision(), now);
        DocumentResponse after = requireDocument(id);
        appendAudit("APPROVED", actor, label, "Approved for publication",
                toResponse(before, head, null), after, head.revision(), now);
        return after;
    }

    @Transactional
    public DocumentResponse returnForRework(
            String actorId,
            String actorLabel,
            List<String> roles,
            String documentId,
            String reason) {
        String actor = requireText(actorId, "actor");
        String label = requireActorLabel(actorLabel);
        String id = requireText(documentId, "document id");
        String note = requireReason(reason);
        DocumentRow before = requireDocumentForUpdate(id);
        RevisionRow head = requireHeadRevision(id);
        if (!"IN_REVIEW".equals(head.state())) {
            throw invalidState();
        }
        Instant now = Instant.now(clock);
        if (documents.returnHead(id, head.revision(), actor, note, now) != 1) {
            throw conflict("DOCUMENT_STATE_CONFLICT", "Document was changed by another writer");
        }
        documents.markDocDraftIfInReview(id, now);
        DocumentResponse after = requireDocument(id);
        appendAudit("RETURNED", actor, label, note,
                toResponse(before, head, null), after, head.revision(), now);
        return after;
    }

    @Transactional
    public DocumentResponse archive(String actorId, String actorLabel, List<String> roles, String documentId, String reason) {
        return lifecycle(actorId, actorLabel, roles, documentId, requireReason(reason), true);
    }

    @Transactional
    public DocumentResponse restore(String actorId, String actorLabel, List<String> roles, String documentId, String reason) {
        return lifecycle(actorId, actorLabel, roles, documentId, requireReason(reason), false);
    }

    private DocumentResponse lifecycle(
            String actorId,
            String actorLabel,
            List<String> roles,
            String documentId,
            String reason,
            boolean archive) {
        String actor = requireText(actorId, "actor");
        String label = requireActorLabel(actorLabel);
        String id = requireText(documentId, "document id");
        DocumentRow before = requireDocumentForUpdate(id);
        requireDocumentOwner(roles, actor, before);
        if (archive && "ARCHIVED".equals(before.status())) {
            throw conflict("DOCUMENT_ALREADY_ARCHIVED", "Document is already archived");
        }
        if (!archive && !"ARCHIVED".equals(before.status())) {
            throw conflict("DOCUMENT_NOT_ARCHIVED", "Document is not archived");
        }
        Instant now = Instant.now(clock);
        int changed = archive ? documents.archive(id, now) : documents.restore(id, now);
        if (changed != 1) {
            throw conflict("DOCUMENT_STATE_CONFLICT", "Document was changed by another writer");
        }
        DocumentResponse after = requireDocument(id);
        appendAudit(archive ? "ARCHIVED" : "RESTORED", actor, label, reason,
                toResponse(before, headRevision(id), null), after, after.currentRevision(), now);
        return after;
    }

    // ------------------------------------------------------------------
    // Anonymous surface — 404-indistinguishable, pinned to publishedRevision
    // ------------------------------------------------------------------

    @Transactional(readOnly = true)
    public PublicDocumentListResponse findPublic(int page, int limit, String search, String categoryId, String tagId) {
        requirePage(page, limit);
        long offset = (long) (page - 1) * limit;
        List<PublicListRow> rows = documents.findPublic(search, categoryId, tagId, offset, limit);
        long total = documents.countPublic(search, categoryId, tagId);
        return toListResponse(rows, total, page, limit);
    }

    @Transactional(readOnly = true)
    public PublicDocumentResponse findPublicBySlug(String slug) {
        // Reads validate presence only — a malformed slug is an unknown slug,
        // so reads answer the same 404 (no format oracle on the public side).
        PublicDocRow row = documents.findPublicBySlug(requireText(slug, "slug"))
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Document not found"));
        return toPublic(row);
    }

    /** Revision permalink — serves only published-or-older revisions on live docs. */
    @Transactional(readOnly = true)
    public PublicDocumentResponse findPublicRevision(String slug, int revision) {
        if (revision < 1) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Document not found");
        }
        PublicDocRow row = documents.findPublicRevision(requireText(slug, "slug"), revision)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Document not found"));
        return toPublic(row);
    }

    @Transactional(readOnly = true)
    public PublicDocumentAttachmentResponse findPublicAttachment(String slug, String attachmentId) {
        AttachmentRow row = documents.findPublicAttachment(requireText(slug, "slug"), requireText(attachmentId, "attachment id"))
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Attachment not found"));
        return new PublicDocumentAttachmentResponse(
                row.id(), row.fileName(), row.fileUrl(), row.mimeType(),
                row.fileSizeBytes(), row.checksumSha256());
    }

    // ------------------------------------------------------------------
    // Internals
    // ------------------------------------------------------------------

    private PublicDocumentResponse toPublic(PublicDocRow row) {
        return new PublicDocumentResponse(
                row.slug(),
                row.categoryId(),
                row.publishedRevision(),
                row.revision() < row.publishedRevision(),
                row.titleVi(),
                row.titleEn(),
                row.summaryVi(),
                row.summaryEn(),
                row.bodyVi(),
                row.bodyEn(),
                row.publishedAt(),
                documents.tagIds(row.documentId()));
    }

    private PublicDocumentListResponse toListResponse(
            List<PublicListRow> rows,
            long total,
            int page,
            int limit) {
        // One batch tag query per page — the public list renders tag chips.
        java.util.Map<String, List<String>> tagsByDoc = new java.util.HashMap<>();
        for (var assignment : documents.findTagsForDocuments(
                rows.stream().map(PublicListRow::documentId).toList())) {
            tagsByDoc.computeIfAbsent(assignment.documentId(), ignored -> new java.util.ArrayList<>())
                    .add(assignment.tagId());
        }
        List<PublicDocumentListItem> data = rows.stream()
                .map(row -> new PublicDocumentListItem(
                        row.slug(),
                        row.categoryId(),
                        row.publishedRevision(),
                        row.titleVi(),
                        row.titleEn(),
                        row.summaryVi(),
                        row.summaryEn(),
                        row.publishedAt(),
                        tagsByDoc.getOrDefault(row.documentId(), List.of())))
                .toList();
        long totalPages = total == 0 ? 0 : ((total - 1) / limit) + 1;
        return new PublicDocumentListResponse(data, new PageMeta(total, page, limit, (int) totalPages));
    }

    private DocumentResponse toResponse(DocumentRow doc, RevisionRow head, List<String> tagIds) {
        return new DocumentResponse(
                doc.id(),
                doc.slug(),
                doc.status(),
                doc.authorId(),
                doc.currentRevision(),
                doc.publishedRevision(),
                doc.categoryId(),
                doc.createdAt(),
                doc.updatedAt(),
                tagIds == null ? documents.tagIds(doc.id()) : tagIds,
                head == null ? null : toRevisionResponse(head));
    }

    private static RevisionResponse toRevisionResponse(RevisionRow row) {
        return new RevisionResponse(
                row.revision(),
                row.state(),
                row.titleVi(),
                row.titleEn(),
                row.summaryVi(),
                row.summaryEn(),
                row.bodyVi(),
                row.bodyEn(),
                row.authorId(),
                row.reviewerId(),
                row.reviewedAt(),
                row.reviewNote(),
                row.createdAt());
    }

    private RevisionRow headRevision(String documentId) {
        return documents.findHeadRevision(documentId).orElse(null);
    }

    private RevisionRow requireHeadRevision(String documentId) {
        return documents.findHeadRevision(documentId)
                .orElseThrow(() -> new IllegalStateException("Document has no head revision"));
    }

    private DocumentResponse requireDocument(String id) {
        DocumentRow row = documents.findById(id)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Document not found"));
        return toResponse(row, headRevision(id), null);
    }

    private DocumentRow requireDocumentForUpdate(String id) {
        return documents.findByIdForUpdate(id)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Document not found"));
    }

    private void updateCategory(String id, String categoryId) {
        // categoryId null here means "unchanged" — the caller only reaches this
        // when a different non-null value arrived, so write it directly.
        documents.updateCategory(id, categoryId);
    }

    private void appendAudit(
            String action,
            String actorId,
            String actorLabel,
            String reason,
            DocumentResponse before,
            DocumentResponse after,
            int version,
            Instant createdAt) {
        documents.appendAudit(new AuditCommand(
                UUID.randomUUID().toString(),
                after == null ? before.id() : after.id(),
                action,
                actorId,
                actorLabel,
                reason == null ? "" : reason,
                version,
                snapshot(before),
                snapshot(after),
                createdAt));
    }

    private String snapshot(DocumentResponse value) {
        if (value == null) {
            return null;
        }
        try {
            return objectMapper.writeValueAsString(value);
        } catch (JacksonException exception) {
            throw new IllegalStateException("Document audit snapshot could not be serialized", exception);
        }
    }

    private static SanitizedBodies sanitize(DocumentContentRequest request) {
        String titleVi = requireText(request.titleVi(), "titleVi");
        requireText(request.titleEn(), "titleEn");
        String bodyVi = sanitizeHtml(requireText(request.bodyVi(), "bodyVi"));
        String bodyEn = sanitizeHtml(requireText(request.bodyEn(), "bodyEn"));
        capLength(titleVi, 240, "titleVi");
        capLength(request.titleEn(), 240, "titleEn");
        if (request.summaryVi() != null) {
            capLength(request.summaryVi(), 500, "summaryVi");
        }
        if (request.summaryEn() != null) {
            capLength(request.summaryEn(), 500, "summaryEn");
        }
        return new SanitizedBodies(bodyVi, bodyEn);
    }

    private record SanitizedBodies(String bodyVi, String bodyEn) {
    }

    private static String sanitizeHtml(String html) {
        SanitizationResult result = AnnouncementHtmlSanitizer.sanitize(html);
        return result.html();
    }

    private static void capLength(String value, int max, String field) {
        if (value.codePointCount(0, value.length()) > max) {
            throw new IllegalArgumentException(field + " must contain at most " + max + " characters");
        }
    }

    private static boolean isLecturerOnly(List<String> roles) {
        return roles != null && roles.contains("LECTURER")
                && !roles.contains("ADMIN") && !roles.contains("SUPER_ADMIN");
    }

    private static boolean isGovernance(List<String> roles) {
        return roles != null && roles.stream().anyMatch(GOVERNANCE_ROLES::contains);
    }

    /** Lecturers operate only on documents they authored; governance on all. */
    private static void requireDocumentOwner(List<String> roles, String actorId, DocumentRow doc) {
        if (isLecturerOnly(roles) && !actorId.equals(doc.authorId())) {
            throw new DomainException(HttpStatus.FORBIDDEN, "DOCUMENT_NOT_AUTHOR",
                    "Lecturers may only manage documents they authored");
        }
    }

    private static DomainException invalidState() {
        return conflict("DOCUMENT_INVALID_STATE",
                "The document is not in the required lifecycle state for this transition");
    }

    private static String requireSlug(String value) {
        String slug = requireText(value, "slug").trim();
        if (slug.codePointCount(0, slug.length()) > MAX_SLUG_LENGTH) {
            throw new IllegalArgumentException("slug must contain at most " + MAX_SLUG_LENGTH + " characters");
        }
        if (!slug.matches("[a-z0-9][a-z0-9-]{0,239}")) {
            throw new IllegalArgumentException(
                    "slug must be lowercase letters, digits, and hyphens (permalink-safe)");
        }
        return slug;
    }

    private static String requireReason(String value) {
        String reason = requireText(value, "reason").trim();
        if (reason.codePointCount(0, reason.length()) > 500) {
            throw new IllegalArgumentException("reason must contain at most 500 characters");
        }
        return reason;
    }

    private static String requireActorLabel(String value) {
        String label = requireText(value, "actorLabel").trim();
        if (label.codePointCount(0, label.length()) > MAX_ACTOR_LABEL_LENGTH) {
            throw new IllegalArgumentException("actorLabel must contain at most " + MAX_ACTOR_LABEL_LENGTH + " characters");
        }
        return label;
    }

    private static String requireText(String value, String name) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException(name + " is required");
        }
        return value;
    }

    private static void requirePage(int page, int limit) {
        if (page < 1 || limit < 1 || limit > 100) {
            throw new IllegalArgumentException("page must be >= 1 and limit between 1 and 100");
        }
    }

    private static DomainException conflict(String code, String message) {
        return new DomainException(HttpStatus.CONFLICT, code, message);
    }
}
