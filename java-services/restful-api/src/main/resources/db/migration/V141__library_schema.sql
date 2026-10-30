-- P11 Library circulation (domain-contracts §8): consistent copy stock —
-- catalogue titles, physical copies, patron loan requests with a
-- server-clock reservation expiry, scoped staff grants, idempotent
-- retries. Copies are never hard-deleted: RETIRE is soft and keeps loan
-- history (LIB-T06). This is a synthetic demo catalogue — no real OPAC,
-- no fines, no real books.

CREATE SCHEMA IF NOT EXISTS library;

-- Scoped domain staff grants (shared shape — events/admissions carry the
-- same model in their own schemas with their own scope values).
CREATE TABLE IF NOT EXISTS library."StaffGrant" (
    "id" VARCHAR(120) PRIMARY KEY,
    "userId" VARCHAR(120) NOT NULL REFERENCES campuscore_auth."User" ("id"),
    "scope" VARCHAR(40) NOT NULL,
    "grantedBy" VARCHAR(120) NOT NULL,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT lib_staff_grant_user_scope_unique UNIQUE ("userId", "scope")
);
CREATE INDEX IF NOT EXISTS lib_staff_grant_scope_idx
    ON library."StaffGrant" ("scope");

-- Catalogue title — bibliographic record; stock is derived from its
-- copies, never stored as a counter (no phantom stock to drift).
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

-- Physical copy. status machine: AVAILABLE → RESERVED → ON_LOAN →
-- AVAILABLE; → RETIRED (soft — loan history survives, LIB-T06).
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

-- Loan request. status machine: REQUESTED → APPROVED → ISSUED → RETURNED
-- | CANCELLED. expiresAt is the server-clock reservation deadline
-- (LIB-X01): a request still in REQUESTED/APPROVED past expiresAt is
-- expired by the sweep and frees its copy; on ISSUE it is cleared and
-- dueAt carries the loan period instead (informational — no fines).
CREATE TABLE IF NOT EXISTS library."LoanRequest" (
    "id" VARCHAR(120) PRIMARY KEY,
    "copyId" VARCHAR(120) NOT NULL REFERENCES library."Copy" ("id"),
    "borrowerUserId" VARCHAR(120) NOT NULL REFERENCES campuscore_auth."User" ("id"),
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
-- LIB-X02 backstop: at most ONE active request per copy at the storage
-- layer — two patrons racing one copy can never both win.
CREATE UNIQUE INDEX IF NOT EXISTS loan_request_active_copy_unique
    ON library."LoanRequest" ("copyId")
    WHERE "status" IN ('REQUESTED','APPROVED','ISSUED');
-- One active request per borrower per copy — a patron cannot hold the
-- same copy twice.
CREATE UNIQUE INDEX IF NOT EXISTS loan_request_active_borrower_unique
    ON library."LoanRequest" ("borrowerUserId", "copyId")
    WHERE "status" IN ('REQUESTED','APPROVED','ISSUED');
CREATE INDEX IF NOT EXISTS lib_request_borrower_idx
    ON library."LoanRequest" ("borrowerUserId");
CREATE INDEX IF NOT EXISTS lib_request_status_idx
    ON library."LoanRequest" ("status");
CREATE INDEX IF NOT EXISTS lib_request_expiry_idx
    ON library."LoanRequest" ("expiresAt") WHERE "status" IN ('REQUESTED','APPROVED');

-- Audit carries from/to status (INV-07 — admissions convention).
-- entityType+entityId lets rows target copies, requests and grants.
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

-- Idempotent retry keys (contract §1.3): request/cancel replay the
-- stored response instead of double-reserving a copy.
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

-- Synthetic demo catalogue (demo-data-policy): deterministic ids so the
-- e2e legs can target them — a two-copy title for the normal flow, a
-- single-copy title for the contention race, and one retired copy.
INSERT INTO library."Title" ("id", "title", "author", "isbn", "category", "publisher", "publishedYear", "description")
SELECT 'title-algorithms-demo', 'Introduction to Algorithms', 'Cormen, Leiserson, Rivest, Stein',
       '978-0262033848', 'Computer Science', 'MIT Press', 2009,
       'Synthetic catalogue title for the CampusUTE library demo.'
WHERE NOT EXISTS (SELECT 1 FROM library."Title" WHERE "id" = 'title-algorithms-demo');
INSERT INTO library."Copy" ("id", "titleId", "barcode", "status")
SELECT 'copy-algo-1', 'title-algorithms-demo', 'LIB-ALGO-0001', 'AVAILABLE'
WHERE NOT EXISTS (SELECT 1 FROM library."Copy" WHERE "id" = 'copy-algo-1');
INSERT INTO library."Copy" ("id", "titleId", "barcode", "status")
SELECT 'copy-algo-2', 'title-algorithms-demo', 'LIB-ALGO-0002', 'AVAILABLE'
WHERE NOT EXISTS (SELECT 1 FROM library."Copy" WHERE "id" = 'copy-algo-2');

INSERT INTO library."Title" ("id", "title", "author", "isbn", "category", "publisher", "publishedYear", "description")
SELECT 'title-database-demo', 'Database System Concepts', 'Silberschatz, Korth, Sudarshan',
       '978-0078022159', 'Computer Science', 'McGraw-Hill', 2019,
       'Synthetic single-copy title for the contention demo.'
WHERE NOT EXISTS (SELECT 1 FROM library."Title" WHERE "id" = 'title-database-demo');
INSERT INTO library."Copy" ("id", "titleId", "barcode", "status")
SELECT 'copy-db-1', 'title-database-demo', 'LIB-DB-0001', 'AVAILABLE'
WHERE NOT EXISTS (SELECT 1 FROM library."Copy" WHERE "id" = 'copy-db-1');

INSERT INTO library."Title" ("id", "title", "author", "isbn", "category", "publisher", "publishedYear", "description")
SELECT 'title-networks-demo', 'Computer Networks', 'Tanenbaum, Wetherall',
       '978-0132126953', 'Computer Science', 'Pearson', 2010,
       'Synthetic catalogue title for the CampusUTE library demo.'
WHERE NOT EXISTS (SELECT 1 FROM library."Title" WHERE "id" = 'title-networks-demo');
INSERT INTO library."Copy" ("id", "titleId", "barcode", "status")
SELECT 'copy-net-1', 'title-networks-demo', 'LIB-NET-0001', 'AVAILABLE'
WHERE NOT EXISTS (SELECT 1 FROM library."Copy" WHERE "id" = 'copy-net-1');
INSERT INTO library."Copy" ("id", "titleId", "barcode", "status")
SELECT 'copy-net-retired', 'title-networks-demo', 'LIB-NET-0099', 'RETIRED'
WHERE NOT EXISTS (SELECT 1 FROM library."Copy" WHERE "id" = 'copy-net-retired');

-- No grant seed: the e2e orchestrator grants STAFF:library through the
-- API (same convention as V137 events / V140 admissions — migrations
-- never seed authority assignments).
