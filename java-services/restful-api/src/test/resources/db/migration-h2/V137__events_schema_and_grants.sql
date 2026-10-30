-- H2 mirror of V137__events_schema_and_grants.sql (Postgres).
-- Same logical schema so MockMvc contract tests exercise the real DDL.
-- Differences from prod:
--   * INTERVAL arithmetic expanded to H2 DATEADD calls.
--   * The partial unique index (WHERE status='REGISTERED') is a Postgres-only
--     construct; H2 gets a plain non-unique index. The single-active-
--     registration invariant is still enforced by the service row-lock path,
--     and EventCapacityPostgresIT proves the DB backstop on the real engine.

CREATE SCHEMA IF NOT EXISTS events;

CREATE TABLE IF NOT EXISTS events."StaffGrant" (
    "id" VARCHAR(120) PRIMARY KEY,
    "userId" VARCHAR(120) NOT NULL,
    "scope" VARCHAR(40) NOT NULL,
    "grantedBy" VARCHAR(120) NOT NULL,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT staff_grant_user_scope_unique UNIQUE ("userId", "scope")
);

CREATE INDEX IF NOT EXISTS staff_grant_scope_idx
    ON events."StaffGrant" ("scope");

CREATE TABLE IF NOT EXISTS events."Event" (
    "id" VARCHAR(120) PRIMARY KEY,
    "title" VARCHAR(240) NOT NULL,
    "description" TEXT,
    "location" VARCHAR(240),
    "organizer" VARCHAR(160) NOT NULL,
    "status" VARCHAR(24) NOT NULL DEFAULT 'DRAFT',
    "capacity" INTEGER NOT NULL CHECK ("capacity" > 0),
    "registeredCount" INTEGER NOT NULL DEFAULT 0,
    "startsAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    "endsAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    "registrationOpensAt" TIMESTAMP WITH TIME ZONE,
    "registrationClosesAt" TIMESTAMP WITH TIME ZONE,
    "ownerId" VARCHAR(120) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT event_status_check CHECK ("status" IN (
        'DRAFT', 'PUBLISHED', 'REGISTRATION_OPEN', 'REGISTRATION_CLOSED',
        'COMPLETED', 'CANCELLED')),
    CONSTRAINT event_registered_within_capacity
        CHECK ("registeredCount" >= 0 AND "registeredCount" <= "capacity"),
    CONSTRAINT event_window_check CHECK ("endsAt" > "startsAt")
);

CREATE INDEX IF NOT EXISTS event_status_idx ON events."Event" ("status");
CREATE INDEX IF NOT EXISTS event_owner_idx ON events."Event" ("ownerId");

CREATE TABLE IF NOT EXISTS events."Registration" (
    "id" VARCHAR(120) PRIMARY KEY,
    "eventId" VARCHAR(120) NOT NULL,
    "studentId" VARCHAR(120) NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'REGISTERED',
    "registeredAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelledAt" TIMESTAMP WITH TIME ZONE,
    "attendanceStatus" VARCHAR(16) NOT NULL DEFAULT 'ABSENT',
    "attendanceMarkedBy" VARCHAR(120),
    "attendanceMarkedAt" TIMESTAMP WITH TIME ZONE,
    "version" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT registration_status_check CHECK ("status" IN ('REGISTERED', 'CANCELLED')),
    CONSTRAINT registration_attendance_check CHECK ("attendanceStatus" IN ('ABSENT', 'ATTENDED'))
);

CREATE INDEX IF NOT EXISTS registration_active_lookup
    ON events."Registration" ("eventId", "studentId", "status");
CREATE INDEX IF NOT EXISTS registration_student_idx
    ON events."Registration" ("studentId");
CREATE INDEX IF NOT EXISTS registration_event_idx
    ON events."Registration" ("eventId");

CREATE TABLE IF NOT EXISTS events."Idempotency" (
    "id" VARCHAR(120) PRIMARY KEY,
    "ownerId" VARCHAR(120) NOT NULL,
    "idempotencyKey" VARCHAR(200) NOT NULL,
    "requestHash" CHAR(64) NOT NULL,
    "state" VARCHAR(40) NOT NULL,
    "registrationId" VARCHAR(120),
    "responseBody" TEXT,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT event_idempotency_owner_key UNIQUE ("ownerId", "idempotencyKey")
);

CREATE TABLE IF NOT EXISTS events."Audit" (
    "id" VARCHAR(120) PRIMARY KEY,
    "eventId" VARCHAR(120) NOT NULL,
    "registrationId" VARCHAR(120),
    "action" VARCHAR(40) NOT NULL,
    "actorId" VARCHAR(120) NOT NULL,
    "detail" TEXT,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS event_audit_event_idx ON events."Audit" ("eventId");
