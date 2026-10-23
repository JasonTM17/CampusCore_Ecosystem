-- H2 mirror of V140__admissions_schema.sql (Postgres).
-- Same logical schema so MockMvc contract tests exercise the real DDL.
-- Differences from prod:
--   * cross-schema REFERENCES campuscore_auth."User" dropped (auth users are
--     stubbed per-test instead — same convention as the V137/V139 mirrors).
--   * the partial unique index (WHERE status IN active set) is a Postgres-only
--     construct; H2 gets a plain non-unique index. The one-active-application
--     invariant is still enforced by the service row-lock path, and the
--     Postgres IT proves the DB backstop on the real engine.
--   * demo account seed INSERTs stripped (fixtures seed their own users).

CREATE SCHEMA IF NOT EXISTS admissions;

CREATE TABLE IF NOT EXISTS admissions."StaffGrant" (
    "id" VARCHAR(120) PRIMARY KEY,
    "userId" VARCHAR(120) NOT NULL,
    "scope" VARCHAR(40) NOT NULL,
    "grantedBy" VARCHAR(120) NOT NULL,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT adm_staff_grant_user_scope_unique UNIQUE ("userId", "scope")
);
CREATE INDEX IF NOT EXISTS adm_staff_grant_scope_idx
    ON admissions."StaffGrant" ("scope");

CREATE TABLE IF NOT EXISTS admissions."Application" (
    "id" VARCHAR(120) PRIMARY KEY,
    "applicantUserId" VARCHAR(120) NOT NULL,
    "cycle" VARCHAR(60) NOT NULL,
    "status" VARCHAR(30) NOT NULL DEFAULT 'DRAFT',
    "fullName" VARCHAR(240),
    "dateOfBirth" VARCHAR(20),
    "schoolName" VARCHAR(300),
    "intendedMajor" VARCHAR(200),
    "essay" TEXT,
    "claimedBy" VARCHAR(120),
    "submittedAt" TIMESTAMP WITH TIME ZONE,
    "decision" VARCHAR(20),
    "decisionLabel" VARCHAR(40),
    "decisionAt" TIMESTAMP WITH TIME ZONE,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT application_status_check CHECK (
        "status" IN ('DRAFT','SUBMITTED','IN_REVIEW','RETURNED',
                     'ACCEPTED','REJECTED','WITHDRAWN')),
    CONSTRAINT application_decision_label_check CHECK (
        ("decision" IS NULL AND "decisionLabel" IS NULL AND "decisionAt" IS NULL)
        OR ("decision" IN ('ACCEPTED','REJECTED') AND "decisionLabel" = 'SIMULATED'
            AND "decisionAt" IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS application_active_unique
    ON admissions."Application" ("applicantUserId", "cycle", "status");
CREATE INDEX IF NOT EXISTS application_applicant_idx
    ON admissions."Application" ("applicantUserId");
CREATE INDEX IF NOT EXISTS application_status_idx
    ON admissions."Application" ("status");

CREATE TABLE IF NOT EXISTS admissions."Attachment" (
    "id" VARCHAR(120) PRIMARY KEY,
    "applicationId" VARCHAR(120) NOT NULL REFERENCES admissions."Application" ("id") ON DELETE CASCADE,
    "fileKey" VARCHAR(400) NOT NULL,
    "fileName" VARCHAR(300) NOT NULL,
    "contentType" VARCHAR(120),
    "sizeBytes" BIGINT,
    "checksum" VARCHAR(128) NOT NULL,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS attachment_application_idx
    ON admissions."Attachment" ("applicationId");

CREATE TABLE IF NOT EXISTS admissions."FileObject" (
    "key" VARCHAR(400) PRIMARY KEY,
    "contentType" VARCHAR(120) NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "sha256" VARCHAR(128) NOT NULL,
    "data" BYTEA NOT NULL,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS admissions."Review" (
    "id" VARCHAR(120) PRIMARY KEY,
    "applicationId" VARCHAR(120) NOT NULL REFERENCES admissions."Application" ("id") ON DELETE CASCADE,
    "reviewerId" VARCHAR(120) NOT NULL,
    "action" VARCHAR(30) NOT NULL,
    "checklist" TEXT,
    "note" TEXT,
    "decision" VARCHAR(20),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT review_action_check CHECK (
        "action" IN ('CLAIM','RETURN','DECISION'))
);
CREATE INDEX IF NOT EXISTS review_application_idx
    ON admissions."Review" ("applicationId");

CREATE TABLE IF NOT EXISTS admissions."Audit" (
    "id" VARCHAR(120) PRIMARY KEY,
    "applicationId" VARCHAR(120),
    "actorId" VARCHAR(120) NOT NULL,
    "action" VARCHAR(60) NOT NULL,
    "fromStatus" VARCHAR(30),
    "toStatus" VARCHAR(30),
    "detail" TEXT,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS adm_audit_application_idx
    ON admissions."Audit" ("applicationId");

CREATE TABLE IF NOT EXISTS admissions."Idempotency" (
    "id" VARCHAR(120) PRIMARY KEY,
    "ownerId" VARCHAR(120) NOT NULL,
    "idempotencyKey" VARCHAR(200) NOT NULL,
    "requestHash" VARCHAR(128) NOT NULL,
    "state" VARCHAR(20) NOT NULL DEFAULT 'IN_PROGRESS',
    "responseBody" TEXT,
    "recordId" VARCHAR(120),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT adm_idempotency_owner_key_unique UNIQUE ("ownerId", "idempotencyKey"),
    CONSTRAINT adm_idempotency_state_check CHECK ("state" IN ('IN_PROGRESS', 'COMPLETED'))
);
