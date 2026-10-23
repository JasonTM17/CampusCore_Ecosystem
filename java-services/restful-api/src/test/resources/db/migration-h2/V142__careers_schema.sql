-- H2 mirror of V142__careers_schema.sql (Postgres).
-- Same logical schema so MockMvc contract tests exercise the real DDL.
-- Differences from prod:
--   * cross-schema REFERENCES campuscore_auth."User" dropped (auth users are
--     stubbed per-test instead — same convention as the V137/V139/V140/V141
--     mirrors).
--   * the partial unique index car_application_active_unique (WHERE status IN
--     active set) is Postgres-only; H2 gets plain non-unique indexes. The
--     one-active-application-per-opportunity invariant is still enforced by
--     the service path, and the Postgres IT proves the DB backstop on the
--     real engine.
--   * demo organization seed INSERTs stripped (fixtures seed their own rows).

CREATE SCHEMA IF NOT EXISTS careers;

CREATE TABLE IF NOT EXISTS careers."StaffGrant" (
    "id" VARCHAR(120) PRIMARY KEY,
    "userId" VARCHAR(120) NOT NULL,
    "scope" VARCHAR(40) NOT NULL,
    "organizationId" VARCHAR(120) NOT NULL DEFAULT '',
    "grantedBy" VARCHAR(120) NOT NULL,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT car_staff_grant_user_scope_org_unique
        UNIQUE ("userId", "scope", "organizationId")
);
CREATE INDEX IF NOT EXISTS car_staff_grant_scope_idx
    ON careers."StaffGrant" ("scope", "organizationId");

CREATE TABLE IF NOT EXISTS careers."Organization" (
    "id" VARCHAR(120) PRIMARY KEY,
    "name" VARCHAR(240) NOT NULL,
    "description" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS careers."Opportunity" (
    "id" VARCHAR(120) PRIMARY KEY,
    "organizationId" VARCHAR(120) NOT NULL REFERENCES careers."Organization" ("id"),
    "title" VARCHAR(300) NOT NULL,
    "description" TEXT,
    "location" VARCHAR(200),
    "employmentType" VARCHAR(60),
    "salaryText" VARCHAR(200),
    "status" VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
    "submittedBy" VARCHAR(120) NOT NULL,
    "reviewedBy" VARCHAR(120),
    "reviewedAt" TIMESTAMP WITH TIME ZONE,
    "publishedAt" TIMESTAMP WITH TIME ZONE,
    "pausedAt" TIMESTAMP WITH TIME ZONE,
    "closedAt" TIMESTAMP WITH TIME ZONE,
    "moderationReason" VARCHAR(500),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT car_opportunity_status_check CHECK (
        "status" IN ('DRAFT','IN_REVIEW','PUBLISHED','PAUSED','CLOSED','REJECTED'))
);
CREATE INDEX IF NOT EXISTS car_opportunity_org_idx
    ON careers."Opportunity" ("organizationId");
CREATE INDEX IF NOT EXISTS car_opportunity_status_idx
    ON careers."Opportunity" ("status");

CREATE TABLE IF NOT EXISTS careers."Application" (
    "id" VARCHAR(120) PRIMARY KEY,
    "opportunityId" VARCHAR(120) NOT NULL REFERENCES careers."Opportunity" ("id"),
    "candidateUserId" VARCHAR(120) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'SUBMITTED',
    "coverLetter" TEXT,
    "submittedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "statusChangedBy" VARCHAR(120),
    "statusChangedAt" TIMESTAMP WITH TIME ZONE,
    "moderationReason" VARCHAR(500),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT car_application_status_check CHECK (
        "status" IN ('SUBMITTED','REVIEWING','INTERVIEW','OFFER','REJECTED','WITHDRAWN'))
);
CREATE INDEX IF NOT EXISTS car_application_active_idx
    ON careers."Application" ("candidateUserId", "opportunityId", "status");
CREATE INDEX IF NOT EXISTS car_application_candidate_idx
    ON careers."Application" ("candidateUserId");
CREATE INDEX IF NOT EXISTS car_application_opportunity_idx
    ON careers."Application" ("opportunityId");
CREATE INDEX IF NOT EXISTS car_application_status_idx
    ON careers."Application" ("status");

CREATE TABLE IF NOT EXISTS careers."Attachment" (
    "id" VARCHAR(120) PRIMARY KEY,
    "applicationId" VARCHAR(120) NOT NULL REFERENCES careers."Application" ("id"),
    "fileName" VARCHAR(300) NOT NULL,
    "contentType" VARCHAR(120) NOT NULL,
    "checksum" VARCHAR(128),
    "data" BYTEA NOT NULL,
    "uploadedBy" VARCHAR(120) NOT NULL,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS car_attachment_application_idx
    ON careers."Attachment" ("applicationId");

CREATE TABLE IF NOT EXISTS careers."Audit" (
    "id" VARCHAR(120) PRIMARY KEY,
    "entityType" VARCHAR(30) NOT NULL,
    "entityId" VARCHAR(120) NOT NULL,
    "actorId" VARCHAR(120) NOT NULL,
    "action" VARCHAR(60) NOT NULL,
    "fromStatus" VARCHAR(30),
    "toStatus" VARCHAR(30),
    "detail" TEXT,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS car_audit_entity_idx
    ON careers."Audit" ("entityType", "entityId");

CREATE TABLE IF NOT EXISTS careers."Idempotency" (
    "id" VARCHAR(120) PRIMARY KEY,
    "ownerId" VARCHAR(120) NOT NULL,
    "idempotencyKey" VARCHAR(200) NOT NULL,
    "requestHash" VARCHAR(128) NOT NULL,
    "state" VARCHAR(20) NOT NULL DEFAULT 'IN_PROGRESS',
    "responseBody" TEXT,
    "recordId" VARCHAR(120),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT car_idempotency_owner_key_unique UNIQUE ("ownerId", "idempotencyKey"),
    CONSTRAINT car_idempotency_state_check CHECK ("state" IN ('IN_PROGRESS', 'COMPLETED'))
);
