-- H2 mirror of the PostgreSQL migration of the same number.
ALTER TABLE academic."AttendanceGeofence"
    ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;