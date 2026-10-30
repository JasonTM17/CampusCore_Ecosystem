-- H2 mirror of V136__publication_workflow_and_docs.sql (Postgres).
-- Same logical schema so MockMvc contract tests exercise the real DDL.
-- The app-boot fixture creates engagement."Announcement" with only
-- (id, lecturerId); earlier mirrors expand the prod columns they touch
-- (see V123), so V136 first adds the pre-existing prod columns its
-- backfill/constraints reference (status from V64, archivedAt/createdAt
-- from the original announcement migration), then the new workflow set.

ALTER TABLE engagement."Announcement"
    ADD COLUMN IF NOT EXISTS "status" VARCHAR(30) NOT NULL DEFAULT 'PUBLISHED';
ALTER TABLE engagement."Announcement"
    ADD COLUMN IF NOT EXISTS "archivedAt" TIMESTAMP WITH TIME ZONE;
ALTER TABLE engagement."Announcement"
    ADD COLUMN IF NOT EXISTS "archivedBy" VARCHAR(120);
ALTER TABLE engagement."Announcement"
    ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE engagement."Announcement"
    ADD COLUMN IF NOT EXISTS "authorId" VARCHAR(120);
ALTER TABLE engagement."Announcement"
    ADD COLUMN IF NOT EXISTS "reviewerId" VARCHAR(120);
ALTER TABLE engagement."Announcement"
    ADD COLUMN IF NOT EXISTS "reviewedAt" TIMESTAMP WITH TIME ZONE;
ALTER TABLE engagement."Announcement"
    ADD COLUMN IF NOT EXISTS "reviewNote" VARCHAR(500);
ALTER TABLE engagement."Announcement"
    ADD COLUMN IF NOT EXISTS "publishedRevision" INTEGER;

UPDATE engagement."Announcement"
    SET "status" = 'ARCHIVED'
    WHERE "archivedAt" IS NOT NULL;
UPDATE engagement."Announcement"
    SET "status" = 'PUBLISHED'
    WHERE "archivedAt" IS NULL AND "status" <> 'PUBLISHED';

UPDATE engagement."Announcement" ann
    SET "authorId" = COALESCE(
        (SELECT audit."actorId" FROM engagement."AnnouncementAudit" audit
          WHERE audit."announcementId" = ann."id" AND audit."action" = 'CREATED'
          ORDER BY audit."createdAt" ASC LIMIT 1),
        ann."publishedBy",
        'legacy-unknown')
    WHERE ann."authorId" IS NULL;

ALTER TABLE engagement."Announcement"
    ALTER COLUMN "status" SET DEFAULT 'DRAFT';

ALTER TABLE engagement."Announcement"
    DROP CONSTRAINT IF EXISTS announcement_status_ck;
ALTER TABLE engagement."Announcement"
    ADD CONSTRAINT announcement_status_ck
        CHECK ("status" IN ('DRAFT', 'IN_REVIEW', 'PUBLISHED', 'ARCHIVED'));

ALTER TABLE engagement."AnnouncementAudit"
    DROP CONSTRAINT IF EXISTS announcement_audit_action_ck;
ALTER TABLE engagement."AnnouncementAudit"
    ADD CONSTRAINT announcement_audit_action_ck
        CHECK ("action" IN ('CREATED', 'UPDATED', 'SUBMITTED', 'APPROVED',
                            'RETURNED', 'ARCHIVED', 'RESTORED'));

CREATE INDEX IF NOT EXISTS announcement_workflow_queue_idx
    ON engagement."Announcement" ("status", "updatedAt" DESC);
CREATE INDEX IF NOT EXISTS announcement_author_idx
    ON engagement."Announcement" ("authorId");

CREATE TABLE IF NOT EXISTS engagement."PublicDocument" (
    "id" VARCHAR(120) PRIMARY KEY,
    "slug" VARCHAR(240) NOT NULL,
    "status" VARCHAR(30) NOT NULL DEFAULT 'DRAFT',
    "authorId" VARCHAR(120) NOT NULL,
    "currentRevision" INTEGER NOT NULL DEFAULT 1,
    "publishedRevision" INTEGER,
    "categoryId" VARCHAR(60),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT public_document_status_ck
        CHECK ("status" IN ('DRAFT', 'IN_REVIEW', 'PUBLISHED', 'ARCHIVED')),
    CONSTRAINT public_document_revision_ck
        CHECK ("publishedRevision" IS NULL OR "publishedRevision" <= "currentRevision")
);
CREATE UNIQUE INDEX IF NOT EXISTS public_document_slug_uq_idx
    ON engagement."PublicDocument" ("slug");
CREATE INDEX IF NOT EXISTS public_document_status_idx
    ON engagement."PublicDocument" ("status", "updatedAt" DESC);

CREATE TABLE IF NOT EXISTS engagement."PublicDocumentRevision" (
    "documentId" VARCHAR(120) NOT NULL
        REFERENCES engagement."PublicDocument"("id") ON DELETE CASCADE,
    "revision" INTEGER NOT NULL,
    "state" VARCHAR(30) NOT NULL DEFAULT 'DRAFT',
    "titleVi" VARCHAR(240) NOT NULL,
    "titleEn" VARCHAR(240) NOT NULL,
    "summaryVi" VARCHAR(500),
    "summaryEn" VARCHAR(500),
    "bodyVi" CLOB NOT NULL,
    "bodyEn" CLOB NOT NULL,
    "authorId" VARCHAR(120) NOT NULL,
    "reviewerId" VARCHAR(120),
    "reviewedAt" TIMESTAMP WITH TIME ZONE,
    "reviewNote" VARCHAR(500),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY ("documentId", "revision"),
    CONSTRAINT public_doc_revision_state_ck
        CHECK ("state" IN ('DRAFT', 'IN_REVIEW', 'PUBLISHED', 'SUPERSEDED'))
);

CREATE TABLE IF NOT EXISTS engagement."PublicDocumentAttachment" (
    "id" VARCHAR(120) PRIMARY KEY,
    "documentId" VARCHAR(120) NOT NULL
        REFERENCES engagement."PublicDocument"("id") ON DELETE CASCADE,
    "fileName" VARCHAR(255) NOT NULL,
    "fileUrl" VARCHAR(500) NOT NULL,
    "mimeType" VARCHAR(120) NOT NULL,
    "fileSizeBytes" BIGINT NOT NULL,
    "checksumSha256" VARCHAR(64),
    "isPublic" BOOLEAN NOT NULL DEFAULT TRUE,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT public_doc_attachment_mime_ck CHECK ("mimeType" IN (
        'application/pdf',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/zip'
    )),
    CONSTRAINT public_doc_attachment_size_ck
        CHECK ("fileSizeBytes" > 0 AND "fileSizeBytes" <= 52428800)
);
CREATE INDEX IF NOT EXISTS public_doc_attachment_doc_idx
    ON engagement."PublicDocumentAttachment" ("documentId");

CREATE TABLE IF NOT EXISTS engagement."PublicDocumentTagMap" (
    "documentId" VARCHAR(120) NOT NULL
        REFERENCES engagement."PublicDocument"("id") ON DELETE CASCADE,
    "tagId" VARCHAR(60) NOT NULL
        REFERENCES engagement."ArticleTag"("id") ON DELETE CASCADE,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY ("documentId", "tagId")
);

CREATE TABLE IF NOT EXISTS engagement."PublicDocumentAudit" (
    "id" VARCHAR(120) PRIMARY KEY,
    "documentId" VARCHAR(120) NOT NULL
        REFERENCES engagement."PublicDocument"("id") ON DELETE CASCADE,
    "action" VARCHAR(20) NOT NULL,
    "actorId" VARCHAR(120) NOT NULL,
    "actorLabel" VARCHAR(240),
    "reason" VARCHAR(500) NOT NULL DEFAULT '',
    "version" INTEGER NOT NULL,
    "beforeState" CLOB,
    "afterState" CLOB,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT public_doc_audit_action_ck
        CHECK ("action" IN ('CREATED', 'REVISED', 'SUBMITTED', 'APPROVED',
                            'RETURNED', 'ARCHIVED', 'RESTORED'))
);
CREATE INDEX IF NOT EXISTS public_doc_audit_doc_idx
    ON engagement."PublicDocumentAudit" ("documentId", "createdAt" DESC);
