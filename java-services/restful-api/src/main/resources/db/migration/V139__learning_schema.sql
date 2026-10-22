-- P09 LMS (domain-contracts §6): learning schema — course materials,
-- assignments, submissions with immutable revisions, feedback history and
-- idempotent retry keys. Read-through roster only: nothing here writes the
-- academic Enrollment/StudentGrade authority tables.

CREATE SCHEMA IF NOT EXISTS learning;

CREATE TABLE IF NOT EXISTS learning."Material" (
    "id" VARCHAR(120) PRIMARY KEY,
    "sectionId" VARCHAR(120) NOT NULL,
    "title" VARCHAR(300) NOT NULL,
    "description" TEXT,
    "fileKey" VARCHAR(400),
    "fileName" VARCHAR(300),
    "contentType" VARCHAR(120),
    "sizeBytes" BIGINT,
    "checksum" VARCHAR(128),
    "uploaderId" VARCHAR(120) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS material_section_idx ON learning."Material" ("sectionId");

CREATE TABLE IF NOT EXISTS learning."Assignment" (
    "id" VARCHAR(120) PRIMARY KEY,
    "sectionId" VARCHAR(120) NOT NULL,
    "title" VARCHAR(300) NOT NULL,
    "description" TEXT,
    "deadlineAt" TIMESTAMP WITH TIME ZONE,
    "maxScore" NUMERIC(6,2),
    "status" VARCHAR(30) NOT NULL DEFAULT 'DRAFT',
    "ownerId" VARCHAR(120) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT assignment_status_check CHECK (
        "status" IN ('DRAFT', 'PUBLISHED', 'CLOSED', 'ARCHIVED')),
    CONSTRAINT assignment_deadline_reasonable CHECK (
        "deadlineAt" IS NULL OR "deadlineAt" > TIMESTAMP '2000-01-01')
);
CREATE INDEX IF NOT EXISTS assignment_section_idx ON learning."Assignment" ("sectionId");
CREATE INDEX IF NOT EXISTS assignment_status_idx ON learning."Assignment" ("status");

-- One submission per (assignment, student). Status is the lifecycle column;
-- the submitted artifact itself lives in immutable SubmissionRevision rows.
CREATE TABLE IF NOT EXISTS learning."Submission" (
    "id" VARCHAR(120) PRIMARY KEY,
    "assignmentId" VARCHAR(120) NOT NULL REFERENCES learning."Assignment" ("id") ON DELETE CASCADE,
    "studentId" VARCHAR(120) NOT NULL,
    "status" VARCHAR(30) NOT NULL DEFAULT 'DRAFT',
    "currentRevisionId" VARCHAR(120),
    "draftText" TEXT,
    "draftFileKey" VARCHAR(400),
    "draftFileName" VARCHAR(300),
    "draftContentType" VARCHAR(120),
    "draftSizeBytes" BIGINT,
    "draftChecksum" VARCHAR(128),
    "submittedAt" TIMESTAMP WITH TIME ZONE,
    "returnedAt" TIMESTAMP WITH TIME ZONE,
    "reviewedAt" TIMESTAMP WITH TIME ZONE,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT submission_status_check CHECK (
        "status" IN ('DRAFT', 'SUBMITTED', 'RETURNED', 'RESUBMITTED', 'REVIEWED')),
    CONSTRAINT submission_student_assignment_unique UNIQUE ("assignmentId", "studentId")
);
CREATE INDEX IF NOT EXISTS submission_assignment_idx ON learning."Submission" ("assignmentId");
CREATE INDEX IF NOT EXISTS submission_student_idx ON learning."Submission" ("studentId");

-- Immutable: every submit/resubmit creates a new row; no UPDATE/DELETE path
-- exists in code and reviewers treat any mutating write here as a defect.
CREATE TABLE IF NOT EXISTS learning."SubmissionRevision" (
    "id" VARCHAR(120) PRIMARY KEY,
    "submissionId" VARCHAR(120) NOT NULL REFERENCES learning."Submission" ("id") ON DELETE CASCADE,
    "revisionNo" INTEGER NOT NULL,
    "fileKey" VARCHAR(400),
    "fileName" VARCHAR(300),
    "contentType" VARCHAR(120),
    "sizeBytes" BIGINT,
    "checksum" VARCHAR(128),
    "textBody" TEXT,
    "submittedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT submission_revision_no_unique UNIQUE ("submissionId", "revisionNo")
);
CREATE INDEX IF NOT EXISTS submission_revision_idx
    ON learning."SubmissionRevision" ("submissionId");

-- Object bytes for materials + submission files (DB-backed for the synthetic
-- scope — same boundary as DatabaseThesisReportStorage).
CREATE TABLE IF NOT EXISTS learning."FileObject" (
    "key" VARCHAR(400) PRIMARY KEY,
    "contentType" VARCHAR(120) NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "sha256" VARCHAR(128) NOT NULL,
    "data" BYTEA NOT NULL,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Append-only feedback history: RETURNED transitions require a new row here;
-- score is learning-local and never feeds the academic grade authority.
CREATE TABLE IF NOT EXISTS learning."FeedbackRecord" (
    "id" VARCHAR(120) PRIMARY KEY,
    "submissionId" VARCHAR(120) NOT NULL REFERENCES learning."Submission" ("id") ON DELETE CASCADE,
    "revisionId" VARCHAR(120),
    "authorId" VARCHAR(120) NOT NULL,
    "comment" TEXT NOT NULL,
    "score" NUMERIC(6,2),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS feedback_submission_idx ON learning."FeedbackRecord" ("submissionId");

CREATE TABLE IF NOT EXISTS learning."Audit" (
    "id" VARCHAR(120) PRIMARY KEY,
    "assignmentId" VARCHAR(120),
    "submissionId" VARCHAR(120),
    "actorId" VARCHAR(120) NOT NULL,
    "action" VARCHAR(60) NOT NULL,
    "detail" TEXT,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS learning_audit_assignment_idx ON learning."Audit" ("assignmentId");

-- Idempotent retry keys for submission create and file upload (contract §1.3).
CREATE TABLE IF NOT EXISTS learning."Idempotency" (
    "id" VARCHAR(120) PRIMARY KEY,
    "ownerId" VARCHAR(120) NOT NULL,
    "idempotencyKey" VARCHAR(200) NOT NULL,
    "requestHash" VARCHAR(128) NOT NULL,
    "state" VARCHAR(20) NOT NULL DEFAULT 'IN_PROGRESS',
    "responseBody" TEXT,
    "recordId" VARCHAR(120),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT learning_idempotency_owner_key_unique UNIQUE ("ownerId", "idempotencyKey"),
    CONSTRAINT learning_idempotency_state_check CHECK ("state" IN ('IN_PROGRESS', 'COMPLETED'))
);

-- Synthetic fixture: one published assignment on a demo section is seeded by
-- the e2e orchestrator through the API (same convention as V138 events
-- grants — migrations never seed authority assignments).
