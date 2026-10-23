-- P10 Admissions mô phỏng (domain-contracts §7): synthetic applicant
-- workflow — applications keyed by the AUTH user id (never academic.Student;
-- an ACCEPTED decision creates no Student row), attachments with checksum,
-- append-only review history, scoped staff grants, idempotent retry keys.
-- Every decision carries the SIMULATED label — there is no real admissions.

CREATE SCHEMA IF NOT EXISTS admissions;

-- Scoped domain staff grants (shared shape — events/library/careers reuse
-- the same model in their own schemas with their own scope values).
CREATE TABLE IF NOT EXISTS admissions."StaffGrant" (
    "id" VARCHAR(120) PRIMARY KEY,
    "userId" VARCHAR(120) NOT NULL REFERENCES campuscore_auth."User" ("id"),
    "scope" VARCHAR(40) NOT NULL,
    "grantedBy" VARCHAR(120) NOT NULL,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT adm_staff_grant_user_scope_unique UNIQUE ("userId", "scope")
);
CREATE INDEX IF NOT EXISTS adm_staff_grant_scope_idx
    ON admissions."StaffGrant" ("scope");

-- Application: one ACTIVE application per (applicant, cycle). status machine:
-- DRAFT → SUBMITTED → IN_REVIEW → RETURNED → SUBMITTED → ACCEPTED|REJECTED,
-- owner → WITHDRAWN while non-terminal; ACCEPTED/REJECTED/WITHDRAWN immutable.
-- decisionLabel is CHECKed to 'SIMULATED' — a decision row can never claim
-- to be a real admissions outcome (§7 ADM-T05 "nhãn mô phỏng").
CREATE TABLE IF NOT EXISTS admissions."Application" (
    "id" VARCHAR(120) PRIMARY KEY,
    "applicantUserId" VARCHAR(120) NOT NULL REFERENCES campuscore_auth."User" ("id"),
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
-- ADM-T04 forbidden write: a second active application in the same cycle is
-- impossible at the storage layer (partial unique index, events capacity
-- convention). Terminal applications keep history and never block a new cycle.
CREATE UNIQUE INDEX IF NOT EXISTS application_active_unique
    ON admissions."Application" ("applicantUserId", "cycle")
    WHERE "status" IN ('DRAFT','SUBMITTED','IN_REVIEW','RETURNED');
CREATE INDEX IF NOT EXISTS application_applicant_idx
    ON admissions."Application" ("applicantUserId");
CREATE INDEX IF NOT EXISTS application_status_idx
    ON admissions."Application" ("status");

-- Attachment metadata; object bytes live in FileObject (checksum-bound,
-- owner/staff-scoped download — an applicant never reaches another file).
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

-- Append-only review history: CLAIM/RETURN/DECISION rows are never updated;
-- checklist + reason survive every later transition (ADM-T03).
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

-- Audit carries from/to status (INV-07) — the precedent L1 debt from
-- events/learning is fixed here from the start.
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

-- Idempotent retry keys (contract §1.3): apply/submit/resubmit/withdraw
-- replay the stored response instead of writing twice.
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

-- Synthetic applicant accounts for the demo/e2e lanes (demo-data-policy):
-- auth users only — no academic Student row exists for them, proving the
-- application profile is separate from the academic authority.
INSERT INTO campuscore_auth."User" ("id", "email", "password", "firstName", "lastName", "status")
SELECT 'applicant-user', 'applicant@campuscore.edu', '$2a$10$raV9MB3Qmj1Rbu2Rmo1vNup7VsC2OM3AqmcTcTLzbNyMyI4r2rJBe', 'Demo', 'Applicant', 'ACTIVE'
WHERE NOT EXISTS (SELECT 1 FROM campuscore_auth."User" WHERE "email" = 'applicant@campuscore.edu');
INSERT INTO campuscore_auth."UserRole" ("id", "userId", "roleId")
SELECT 'userrole-applicant', 'applicant-user', 'role-student'
WHERE NOT EXISTS (SELECT 1 FROM campuscore_auth."UserRole" WHERE "userId" = 'applicant-user' AND "roleId" = 'role-student');
INSERT INTO campuscore_auth."User" ("id", "email", "password", "firstName", "lastName", "status")
SELECT 'applicant-user-2', 'applicant2@campuscore.edu', '$2a$10$raV9MB3Qmj1Rbu2Rmo1vNup7VsC2OM3AqmcTcTLzbNyMyI4r2rJBe', 'Demo', 'ApplicantTwo', 'ACTIVE'
WHERE NOT EXISTS (SELECT 1 FROM campuscore_auth."User" WHERE "email" = 'applicant2@campuscore.edu');
INSERT INTO campuscore_auth."UserRole" ("id", "userId", "roleId")
SELECT 'userrole-applicant-2', 'applicant-user-2', 'role-student'
WHERE NOT EXISTS (SELECT 1 FROM campuscore_auth."UserRole" WHERE "userId" = 'applicant-user-2' AND "roleId" = 'role-student');

-- No grant seed: the e2e orchestrator grants STAFF:admissions to the admin
-- through the API (same convention as V138 events — migrations never seed
-- authority assignments).
