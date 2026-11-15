-- V164: Seed a dedicated events-staff demo account so the STAFF:events
-- surface is demoable on a fresh clone — a docker pull rebuilds the whole
-- seed, so the grant has to live in a migration, not in local-only SQL.
--
-- V138 removed the migration-seeded grant that V137 had handed to the main
-- admin account: roster rights on 'admin-user' were too broad wherever that
-- account is re-activated. The narrower fix is a dedicated demo persona —
-- events.staff@campuscore.demo — which exists only to carry the scoped
-- events grant. Like every runbook account it shares the published
-- password123 bcrypt hash, is created ACTIVE, and is re-locked on every boot
-- by DemoAccountGate wherever DEMO_ACCOUNTS_ENABLED=false (the account is
-- added to the gate's DEMO_EMAILS list in the same change, keeping
-- DemoAccountGateRunbookParityTest's security invariant).

INSERT INTO campuscore_auth."User" ("id", "email", "password", "firstName", "lastName", "status", "emailVerified")
SELECT 'events-staff-user', 'events.staff@campuscore.demo',
       '$2a$10$raV9MB3Qmj1Rbu2Rmo1vNup7VsC2OM3AqmcTcTLzbNyMyI4r2rJBe',
       'Khoa CNTT', 'Phạm Minh Châu', 'ACTIVE', TRUE
WHERE NOT EXISTS (
    SELECT 1 FROM campuscore_auth."User" existing WHERE existing."id" = 'events-staff-user'
);

-- The events staff surface only checks the grant row, but the account still
-- needs a base portal role + lecturer profile so dashboard resolution,
-- roster displays and lecturer-scoped surfaces behave like every other
-- .demo lecturer account.
INSERT INTO academic."Lecturer" ("id", "userId", "departmentId", "employeeId", "title", "specialization")
SELECT 'lecturer-profile-events-staff', 'events-staff-user', 'department-demo',
       'LEC-EVENTS-001', 'ThS.', 'Tổ chức sự kiện và hoạt động sinh viên'
WHERE NOT EXISTS (
    SELECT 1 FROM academic."Lecturer" existing WHERE existing."id" = 'lecturer-profile-events-staff'
);

INSERT INTO campuscore_auth."UserRole" ("id", "userId", "roleId")
SELECT 'user-role-lecturer-profile-events-staff', 'events-staff-user', 'role-lecturer'
WHERE NOT EXISTS (
    SELECT 1 FROM campuscore_auth."UserRole" existing
    WHERE existing."userId" = 'events-staff-user' AND existing."roleId" = 'role-lecturer'
);

-- The scoped grant itself: STAFF:events for exactly this demo account.
INSERT INTO events."StaffGrant" ("id", "userId", "scope", "grantedBy")
SELECT 'grant-events-staff-demo', 'events-staff-user', 'events', 'system-migration'
WHERE NOT EXISTS (
    SELECT 1 FROM events."StaffGrant" g
    WHERE g."userId" = 'events-staff-user' AND g."scope" = 'events'
);

-- The staff event list is owner-scoped (WHERE ownerId = actorId), so the
-- account needs an owned fixture or the desk would render empty: one DRAFT
-- event lets the demo walk the whole lifecycle (publish → open registration
-- → roster) without touching the admin-owned fixtures from V137.
INSERT INTO events."Event" (
    "id", "title", "description", "location", "organizer", "status",
    "capacity", "startsAt", "endsAt",
    "registrationOpensAt", "registrationClosesAt", "ownerId")
SELECT 'event-demo-staff-draft',
    'Talkshow chuyên đề — guest lecture series',
    'Faculty-hosted talkshow series where students register seats and staff manage the roster.',
    'Auditorium B2 — campus', N'Khoa Công nghệ Thông tin', 'DRAFT',
    120, CURRENT_TIMESTAMP + INTERVAL '21 days', CURRENT_TIMESTAMP + INTERVAL '21 days' + INTERVAL '2 hours',
    CURRENT_TIMESTAMP - INTERVAL '1 day', CURRENT_TIMESTAMP + INTERVAL '14 days',
    'events-staff-user'
WHERE NOT EXISTS (SELECT 1 FROM events."Event" e WHERE e."id" = 'event-demo-staff-draft');
