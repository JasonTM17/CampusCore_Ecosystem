-- P08 Events / Đoàn–Hội schema (contracts/ecosystem/domain-contracts.md §5 D4).
--
--   Event: DRAFT → PUBLISHED → (REGISTRATION_OPEN → REGISTRATION_CLOSED)
--          → COMPLETED | CANCELLED.
--   Registration: REGISTERED → CANCELLED; attendance ABSENT → ATTENDED manual.
--
-- Invariants implemented here and enforced again in the service layer:
--   * one ACTIVE registration per (event, student) — partial unique index
--   * registeredCount is a denormalized counter maintained under the event
--     row lock; the CHECK keeps it inside [0, capacity]
--   * staff authority is a scoped grant (STAFF:events) — ADMIN role alone
--     does NOT confer domain rights (contract §1.1)
--   * idempotency mirror of academic."RegistrationIdempotency" (§1.3)
--   * NOTHING here writes conduct_semester_score — attendance is manual
--     roster marking only (EVT-T06 forbidden write).

CREATE SCHEMA IF NOT EXISTS events;

-- Scoped domain staff grants (shared shape — library/careers:<org>/admissions
-- reuse the same model in their own schemas with their own scope values).
CREATE TABLE events."StaffGrant" (
    "id" VARCHAR(120) PRIMARY KEY,
    "userId" VARCHAR(120) NOT NULL REFERENCES campuscore_auth."User" ("id"),
    "scope" VARCHAR(40) NOT NULL,
    "grantedBy" VARCHAR(120) NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT staff_grant_user_scope_unique UNIQUE ("userId", "scope")
);

CREATE INDEX IF NOT EXISTS staff_grant_scope_idx
    ON events."StaffGrant" ("scope");

CREATE TABLE events."Event" (
    "id" VARCHAR(120) PRIMARY KEY,
    "title" VARCHAR(240) NOT NULL,
    "description" TEXT,
    "location" VARCHAR(240),
    "organizer" VARCHAR(160) NOT NULL,          -- Đoàn–Hội body / club / office
    "status" VARCHAR(24) NOT NULL DEFAULT 'DRAFT',
    "capacity" INTEGER NOT NULL CHECK ("capacity" > 0),
    "registeredCount" INTEGER NOT NULL DEFAULT 0,
    "startsAt" TIMESTAMPTZ NOT NULL,
    "endsAt" TIMESTAMPTZ NOT NULL,
    "registrationOpensAt" TIMESTAMPTZ,
    "registrationClosesAt" TIMESTAMPTZ,
    "ownerId" VARCHAR(120) NOT NULL REFERENCES campuscore_auth."User" ("id"),
    "version" INTEGER NOT NULL DEFAULT 0,        -- §1.3 optimistic version
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT event_status_check CHECK ("status" IN (
        'DRAFT', 'PUBLISHED', 'REGISTRATION_OPEN', 'REGISTRATION_CLOSED',
        'COMPLETED', 'CANCELLED')),
    CONSTRAINT event_registered_within_capacity
        CHECK ("registeredCount" >= 0 AND "registeredCount" <= "capacity"),
    CONSTRAINT event_window_check CHECK ("endsAt" > "startsAt")
);

CREATE INDEX IF NOT EXISTS event_status_idx ON events."Event" ("status");
CREATE INDEX IF NOT EXISTS event_owner_idx ON events."Event" ("ownerId");

CREATE TABLE events."Registration" (
    "id" VARCHAR(120) PRIMARY KEY,
    "eventId" VARCHAR(120) NOT NULL REFERENCES events."Event" ("id"),
    "studentId" VARCHAR(120) NOT NULL REFERENCES campuscore_auth."User" ("id"),
    "status" VARCHAR(16) NOT NULL DEFAULT 'REGISTERED',
    "registeredAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelledAt" TIMESTAMPTZ,
    "attendanceStatus" VARCHAR(16) NOT NULL DEFAULT 'ABSENT',
    "attendanceMarkedBy" VARCHAR(120),
    "attendanceMarkedAt" TIMESTAMPTZ,
    "version" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT registration_status_check CHECK ("status" IN ('REGISTERED', 'CANCELLED')),
    CONSTRAINT registration_attendance_check CHECK ("attendanceStatus" IN ('ABSENT', 'ATTENDED'))
);

-- EVT-X01 backstop: at most one ACTIVE registration per (event, student).
CREATE UNIQUE INDEX IF NOT EXISTS registration_active_unique
    ON events."Registration" ("eventId", "studentId")
    WHERE "status" = 'REGISTERED';

CREATE INDEX IF NOT EXISTS registration_student_idx
    ON events."Registration" ("studentId");
CREATE INDEX IF NOT EXISTS registration_event_idx
    ON events."Registration" ("eventId");

-- §1.3 idempotency mirror — replay returns the first response, never a
-- second registration row.
CREATE TABLE events."Idempotency" (
    "id" VARCHAR(120) PRIMARY KEY,
    "ownerId" VARCHAR(120) NOT NULL,
    "idempotencyKey" VARCHAR(200) NOT NULL,
    "requestHash" CHAR(64) NOT NULL,
    "state" VARCHAR(40) NOT NULL,
    "registrationId" VARCHAR(120),
    "responseBody" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT event_idempotency_owner_key UNIQUE ("ownerId", "idempotencyKey")
);

CREATE TABLE events."Audit" (
    "id" VARCHAR(120) PRIMARY KEY,
    "eventId" VARCHAR(120) NOT NULL,
    "registrationId" VARCHAR(120),
    "action" VARCHAR(40) NOT NULL,          -- PUBLISHED/OPENED/CLOSED/CANCELLED/REGISTERED/REGISTRATION_CANCELLED/ATTENDED/ABSENT/GRANTED/REVOKED
    "actorId" VARCHAR(120) NOT NULL,
    "detail" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS event_audit_event_idx ON events."Audit" ("eventId");

-- Demo fixtures (synthetic — demo-data-policy): one events-scope staff grant
-- for the seeded admin account, plus two events so surfaces render real
-- rows in every environment that runs migrations.
INSERT INTO events."StaffGrant" ("id", "userId", "scope", "grantedBy")
SELECT 'grant-events-admin-user', u."id", 'events', 'system-migration'
FROM campuscore_auth."User" u
WHERE u."id" = 'admin-user'
  AND NOT EXISTS (
      SELECT 1 FROM events."StaffGrant" g
      WHERE g."userId" = 'admin-user' AND g."scope" = 'events');

INSERT INTO events."Event" (
    "id", "title", "description", "location", "organizer", "status",
    "capacity", "startsAt", "endsAt",
    "registrationOpensAt", "registrationClosesAt", "ownerId")
SELECT 'event-demo-open',
    'Sinh nhật Đoàn trường — volunteer fair',
    'Clubs and Đoàn–Hội bodies introduce their programmes; attendees register seats in advance.',
    'Hall A — main campus', N'Đoàn Thanh niên', 'REGISTRATION_OPEN',
    3, CURRENT_TIMESTAMP + INTERVAL '14 days', CURRENT_TIMESTAMP + INTERVAL '14 days' + INTERVAL '3 hours',
    CURRENT_TIMESTAMP - INTERVAL '1 day', CURRENT_TIMESTAMP + INTERVAL '10 days',
    'admin-user'
WHERE NOT EXISTS (SELECT 1 FROM events."Event" e WHERE e."id" = 'event-demo-open');

INSERT INTO events."Event" (
    "id", "title", "description", "location", "organizer", "status",
    "capacity", "startsAt", "endsAt",
    "registrationOpensAt", "registrationClosesAt", "ownerId")
SELECT 'event-demo-draft',
    'Hội thảo kỹ năng mềm — communication workshop',
    'Draft workshop pending publish — seats open after the PUBLISHED transition.',
    'Room B2.04', N'Hội Sinh viên', 'DRAFT',
    40, CURRENT_TIMESTAMP + INTERVAL '30 days', CURRENT_TIMESTAMP + INTERVAL '30 days' + INTERVAL '2 hours',
    NULL, NULL, 'admin-user'
WHERE NOT EXISTS (SELECT 1 FROM events."Event" e WHERE e."id" = 'event-demo-draft');
