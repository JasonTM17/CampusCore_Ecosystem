-- V165: Activate the financial-hold showcase account for the enrollment demo.
-- The bursar seed (V2 bursar schema) keys the HK1 invoice and active
-- "Nợ học phí" hold to student-profile-021 — phuong.ttm@campuscore.demo's
-- Student row — but the account stayed LOCKED (V48 restrict state, and it is
-- not in the runbook subset V82 re-activated), so the documented
-- debt-blocks-registration walkthrough could never be logged into on a fresh
-- clone.
--
-- Scope is exactly one address, same discipline as V82: the rest of the seeded
-- .demo student population stays LOCKED. On hosts where demo logins must not
-- work, DemoAccountGate re-applies LOCKED to this same list on every boot
-- (DEMO_ACCOUNTS_ENABLED=false); the gate's email list covers this account via
-- DemoAccountGateRunbookParityTest.
UPDATE campuscore_auth."User"
SET "status" = 'ACTIVE',
    "failedLoginAttempts" = 0,
    "lockedUntil" = NULL,
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "email" = 'phuong.ttm@campuscore.demo';
