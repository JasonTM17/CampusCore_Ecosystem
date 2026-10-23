-- P12 Careers and applications (domain-contracts §9): moderated job
-- opportunities with organization-scoped recruiter authority — org
-- recruiters own their org's postings and applicants, platform reviewers
-- moderate publication (CAR-T02 reviewer != submitter), candidates apply
-- with one active application per opportunity. This is a synthetic demo
-- board — no scraping, no payments, no real e-mail, no real employers.

CREATE SCHEMA IF NOT EXISTS careers;

-- Scoped domain staff grants. scope='careers' + organizationId='' means a
-- platform publication reviewer (CAR-T02); a non-empty organizationId is a
-- recruiter scoped to exactly that organization (careers:<org>).
CREATE TABLE IF NOT EXISTS careers."StaffGrant" (
    "id" VARCHAR(120) PRIMARY KEY,
    "userId" VARCHAR(120) NOT NULL REFERENCES campuscore_auth."User" ("id"),
    "scope" VARCHAR(40) NOT NULL,
    "organizationId" VARCHAR(120) NOT NULL DEFAULT '',
    "grantedBy" VARCHAR(120) NOT NULL,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT car_staff_grant_user_scope_org_unique
        UNIQUE ("userId", "scope", "organizationId")
);
CREATE INDEX IF NOT EXISTS car_staff_grant_scope_idx
    ON careers."StaffGrant" ("scope", "organizationId");

-- Recruiting organization — the isolation boundary for recruiters.
CREATE TABLE IF NOT EXISTS careers."Organization" (
    "id" VARCHAR(120) PRIMARY KEY,
    "name" VARCHAR(240) NOT NULL,
    "description" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Opportunity. status machine (§9): DRAFT → IN_REVIEW → PUBLISHED →
-- PAUSED → CLOSED; IN_REVIEW → REJECTED; PUBLISHED → CLOSED;
-- PAUSED → PUBLISHED (resume). moderationReason carries the reason shown
-- to the org for REJECTED/PAUSED/CLOSED decisions.
CREATE TABLE IF NOT EXISTS careers."Opportunity" (
    "id" VARCHAR(120) PRIMARY KEY,
    "organizationId" VARCHAR(120) NOT NULL REFERENCES careers."Organization" ("id"),
    "title" VARCHAR(300) NOT NULL,
    "description" TEXT,
    "location" VARCHAR(200),
    "employmentType" VARCHAR(60),
    "salaryText" VARCHAR(200),
    "status" VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
    "submittedBy" VARCHAR(120) NOT NULL REFERENCES campuscore_auth."User" ("id"),
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

-- Application. status machine (§9): SUBMITTED → REVIEWING → INTERVIEW →
-- OFFER → (REJECTED | WITHDRAWN); every pre-terminal state → WITHDRAWN
-- (owner) or → REJECTED (org recruiter, moderationReason required —
-- CAR-T06 never hides the reason from the candidate).
CREATE TABLE IF NOT EXISTS careers."Application" (
    "id" VARCHAR(120) PRIMARY KEY,
    "opportunityId" VARCHAR(120) NOT NULL REFERENCES careers."Opportunity" ("id"),
    "candidateUserId" VARCHAR(120) NOT NULL REFERENCES campuscore_auth."User" ("id"),
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
-- CAR-T04 backstop: at most ONE active application per candidate per
-- opportunity at the storage layer — raced applies can never both win.
CREATE UNIQUE INDEX IF NOT EXISTS car_application_active_unique
    ON careers."Application" ("candidateUserId", "opportunityId")
    WHERE "status" IN ('SUBMITTED','REVIEWING','INTERVIEW','OFFER');
CREATE INDEX IF NOT EXISTS car_application_candidate_idx
    ON careers."Application" ("candidateUserId");
CREATE INDEX IF NOT EXISTS car_application_opportunity_idx
    ON careers."Application" ("opportunityId");
CREATE INDEX IF NOT EXISTS car_application_status_idx
    ON careers."Application" ("status");

-- Candidate attachment (CV / evidence). Owner + the owning org's
-- recruiters read it (CAR-X02); the file bytes are verified against the
-- declared sha256 when provided (same convention as admissions §7).
CREATE TABLE IF NOT EXISTS careers."Attachment" (
    "id" VARCHAR(120) PRIMARY KEY,
    "applicationId" VARCHAR(120) NOT NULL REFERENCES careers."Application" ("id"),
    "fileName" VARCHAR(300) NOT NULL,
    "contentType" VARCHAR(120) NOT NULL,
    "checksum" VARCHAR(128),
    "data" BYTEA NOT NULL,
    "uploadedBy" VARCHAR(120) NOT NULL REFERENCES campuscore_auth."User" ("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS car_attachment_application_idx
    ON careers."Attachment" ("applicationId");

-- Audit carries from/to status (INV-07 — admissions/library convention).
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

-- Idempotent retry keys (contract §1.3): apply/withdraw/transition replay
-- the stored response instead of double-writing.
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

-- Synthetic demo organizations (demo-data-policy): two orgs so cross-org
-- isolation has a real negative case in every environment.
INSERT INTO careers."Organization" ("id", "name", "description")
SELECT 'org-alpha-demo', 'UTE Tech Partners',
       'Synthetic recruiting partner for the CampusUTE careers demo.'
WHERE NOT EXISTS (SELECT 1 FROM careers."Organization" WHERE "id" = 'org-alpha-demo');
INSERT INTO careers."Organization" ("id", "name", "description")
SELECT 'org-beta-demo', 'Mekong Software House',
       'Synthetic recruiting partner for the CampusUTE careers demo.'
WHERE NOT EXISTS (SELECT 1 FROM careers."Organization" WHERE "id" = 'org-beta-demo');

-- No grant or opportunity seed: the e2e orchestrator grants careers
-- scopes and drafts postings through the API (same convention as
-- V137/V140/V141 — migrations never seed authority assignments).
