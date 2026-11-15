-- Bursar service owns this schema end-to-end. The shared Postgres instance
-- mirrors how university SIS deployments split domains across schemas.
CREATE SCHEMA IF NOT EXISTS bursar;

CREATE TABLE IF NOT EXISTS bursar.fee_rate (
    "id"             TEXT PRIMARY KEY,
    academic_year   TEXT NOT NULL,
    department_code TEXT,
    price_per_credit BIGINT NOT NULL,
    effective_from  DATE
);
CREATE UNIQUE INDEX IF NOT EXISTS "FeeRate_year_dept_key"
    ON bursar.fee_rate (academic_year, COALESCE(department_code, ''));

CREATE TABLE IF NOT EXISTS bursar.student_account (
    "id"        TEXT PRIMARY KEY,
    student_id TEXT NOT NULL UNIQUE,
    "balance"   BIGINT NOT NULL DEFAULT 0,
    "currency"  TEXT NOT NULL DEFAULT 'VND',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bursar.invoice (
    "id"        TEXT PRIMARY KEY,
    student_id TEXT NOT NULL,
    "term"      TEXT NOT NULL,
    "status"    TEXT NOT NULL DEFAULT 'ISSUED'
                CHECK ("status" IN ('ISSUED','PARTIAL','PAID','CANCELLED')),
    "total"     BIGINT NOT NULL,
    issued_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    due_at     TIMESTAMPTZ,
    paid_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS "Invoice_student_idx" ON bursar.invoice (student_id);

CREATE TABLE IF NOT EXISTS bursar.invoice_item (
    "id"         TEXT PRIMARY KEY,
    invoice_id  TEXT NOT NULL REFERENCES bursar.invoice("id") ON DELETE CASCADE,
    "label"      TEXT NOT NULL,
    course_code TEXT,
    "credits"    INT NOT NULL,
    unit_price  BIGINT NOT NULL,
    "amount"     BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS "InvoiceItem_invoice_idx" ON bursar.invoice_item (invoice_id);

CREATE TABLE IF NOT EXISTS bursar.payment (
    "id"             TEXT PRIMARY KEY,
    invoice_id      TEXT NOT NULL REFERENCES bursar.invoice("id") ON DELETE CASCADE,
    idempotency_key TEXT UNIQUE,
    "amount"         BIGINT NOT NULL,
    "method"         TEXT NOT NULL,
    "reference"      TEXT,
    "status"         TEXT NOT NULL DEFAULT 'COMPLETED' CHECK ("status" IN ('COMPLETED','FAILED')),
    paid_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "Payment_invoice_idx" ON bursar.payment (invoice_id);

CREATE TABLE IF NOT EXISTS bursar.financial_hold (
    "id"         TEXT PRIMARY KEY,
    student_id  TEXT NOT NULL,
    "reason"     TEXT NOT NULL,
    "status"     TEXT NOT NULL DEFAULT 'ACTIVE' CHECK ("status" IN ('ACTIVE','RELEASED')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    released_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS "FinancialHold_student_status_idx"
    ON bursar.financial_hold (student_id, "status");
