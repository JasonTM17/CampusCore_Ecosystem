-- Lock the two seeded applicant demo accounts.
--
-- The admissions seed creates applicant-user / applicant-user-2 as ACTIVE
-- with the published demo credential. Deployments that intentionally serve
-- demo logins re-activate the pair through the runtime demo-account gate;
-- everywhere else the pair must start locked. The predicate names both the
-- immutable seed ids and the emails, so it is a no-op on databases where the
-- pair is absent or already locked, and no other account can match.

UPDATE campuscore_auth."User"
   SET "status" = 'LOCKED',
       "failedLoginAttempts" = 0,
       "lockedUntil" = NULL,
       "updatedAt" = CURRENT_TIMESTAMP
 WHERE "status" <> 'LOCKED'
   AND "id" IN ('applicant-user', 'applicant-user-2')
   AND "email" IN ('applicant@campuscore.edu', 'applicant2@campuscore.edu');
