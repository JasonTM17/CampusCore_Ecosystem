-- The events staff grant for the seeded admin account is test/demo setup, not
-- schema: V137 inserted it in every environment that runs migrations, which
-- would hand roster access to that account wherever it is re-activated.
-- Remove only the row the migration itself created; grants issued through the
-- API (grantedBy = a real admin) are untouched. Local and e2e stacks grant
-- explicitly through POST /api/v1/events/staff/grants.
DELETE FROM events."StaffGrant"
WHERE "id" = 'grant-events-admin-user'
  AND "grantedBy" = 'system-migration';
