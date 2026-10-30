-- H2 mirror of V141__library_schema.sql (Postgres).
-- Same logical schema so MockMvc contract tests exercise the real DDL.
-- Differences from prod:
--   * cross-schema REFERENCES campuscore_auth."User" dropped (auth users are
--     stubbed per-test instead — same convention as the V137/V139/V140 mirrors).
--   * the partial unique indexes (WHERE status IN active set) are Postgres-only;
--     H2 gets plain non-unique indexes. The one-active-request-per-copy
--     invariant is still enforced by the service row-lock path, and the
--     Postgres IT proves the DB backstop on the real engine.
--   * demo catalogue seed INSERTs stripped (fixtures seed their own rows).

CREATE SCHEMA IF NOT EXISTS library;

CREATE TABLE IF NOT EXISTS library."StaffGrant" (
    "id" VARCHAR(120) PRIMARY KEY,
    "userId" VARCHAR(120) NOT NULL,
    "scope" VARCHAR(40) NOT NULL,
    "grantedBy" VARCHAR(120) NOT NULL,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT lib_staff_grant_user_scope_unique UNIQUE ("userId", "scope")
);
CREATE INDEX IF NOT EXISTS lib_staff_grant_scope_idx
    ON library."StaffGrant" ("scope");

CREATE TABLE IF NOT EXISTS library."Title" (
    "id" VARCHAR(120) PRIMARY KEY,
    "title" VARCHAR(300) NOT NULL,
    "author" VARCHAR(300),
    "isbn" VARCHAR(40),
    "category" VARCHAR(120),
    "publisher" VARCHAR(200),
    "publishedYear" INTEGER,
    "description" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS lib_title_search_idx
    ON library."Title" ("title");

CREATE TABLE IF NOT EXISTS library."Copy" (
    "id" VARCHAR(120) PRIMARY KEY,
    "titleId" VARCHAR(120) NOT NULL REFERENCES library."Title" ("id"),
    "barcode" VARCHAR(80) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'AVAILABLE',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT copy_status_check CHECK (
        "status" IN ('AVAILABLE','RESERVED','ON_LOAN','RETIRED')),
    CONSTRAINT copy_barcode_unique UNIQUE ("barcode")
);
CREATE INDEX IF NOT EXISTS lib_copy_title_idx
    ON library."Copy" ("titleId");
CREATE INDEX IF NOT EXISTS lib_copy_status_idx
    ON library."Copy" ("status");

CREATE TABLE IF NOT EXISTS library."LoanRequest" (
    "id" VARCHAR(120) PRIMARY KEY,
    "copyId" VARCHAR(120) NOT NULL REFERENCES library."Copy" ("id"),
    "borrowerUserId" VARCHAR(120) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'REQUESTED',
    "requestedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP WITH TIME ZONE,
    "approvedBy" VARCHAR(120),
    "approvedAt" TIMESTAMP WITH TIME ZONE,
    "issuedBy" VARCHAR(120),
    "issuedAt" TIMESTAMP WITH TIME ZONE,
    "dueAt" TIMESTAMP WITH TIME ZONE,
    "returnedBy" VARCHAR(120),
    "returnedAt" TIMESTAMP WITH TIME ZONE,
    "cancelledBy" VARCHAR(120),
    "cancelledAt" TIMESTAMP WITH TIME ZONE,
    "cancelReason" VARCHAR(300),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT loan_request_status_check CHECK (
        "status" IN ('REQUESTED','APPROVED','ISSUED','RETURNED','CANCELLED'))
);
CREATE INDEX IF NOT EXISTS loan_request_active_copy_unique
    ON library."LoanRequest" ("copyId", "status");
CREATE INDEX IF NOT EXISTS loan_request_active_borrower_unique
    ON library."LoanRequest" ("borrowerUserId", "copyId", "status");
CREATE INDEX IF NOT EXISTS lib_request_borrower_idx
    ON library."LoanRequest" ("borrowerUserId");
CREATE INDEX IF NOT EXISTS lib_request_status_idx
    ON library."LoanRequest" ("status");
CREATE INDEX IF NOT EXISTS lib_request_expiry_idx
    ON library."LoanRequest" ("expiresAt", "status");

CREATE TABLE IF NOT EXISTS library."Audit" (
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
CREATE INDEX IF NOT EXISTS lib_audit_entity_idx
    ON library."Audit" ("entityType", "entityId");

CREATE TABLE IF NOT EXISTS library."Idempotency" (
    "id" VARCHAR(120) PRIMARY KEY,
    "ownerId" VARCHAR(120) NOT NULL,
    "idempotencyKey" VARCHAR(200) NOT NULL,
    "requestHash" VARCHAR(128) NOT NULL,
    "state" VARCHAR(20) NOT NULL DEFAULT 'IN_PROGRESS',
    "responseBody" TEXT,
    "recordId" VARCHAR(120),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT lib_idempotency_owner_key_unique UNIQUE ("ownerId", "idempotencyKey"),
    CONSTRAINT lib_idempotency_state_check CHECK ("state" IN ('IN_PROGRESS', 'COMPLETED'))
);
