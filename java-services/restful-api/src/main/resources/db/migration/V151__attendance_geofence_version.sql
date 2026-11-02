-- Geofence edits overwrote every column, so a stale form could turn a
-- deliberately disabled geofence back on. The version lets the service reject
-- a write that was read before the latest change (STALE_VERSION).
--
-- Additive and cheap: PostgreSQL 11 and later add a constant default without
-- rewriting the table. Rollback: ALTER TABLE academic."AttendanceGeofence"
-- DROP COLUMN "version"; the column is a concurrency token and holds no
-- business data.
ALTER TABLE academic."AttendanceGeofence"
    ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;