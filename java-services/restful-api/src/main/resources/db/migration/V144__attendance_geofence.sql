-- Additive geofenced attendance. Recovery: disable geofences/close sessions,
-- deploy a forward-fix migration. Rollback only on an unused local database:
-- drop the five new tables in reverse FK order and Attendance.checkinId.
-- Never discard production audit, consent or attendance as an application rollback.
CREATE TABLE IF NOT EXISTS academic."AttendanceGeofence" (
    "id" VARCHAR(120) PRIMARY KEY,
    "name" VARCHAR(240) NOT NULL,
    "campusCode" VARCHAR(60) NOT NULL,
    "centerLat" NUMERIC(9,6) NOT NULL CHECK ("centerLat" BETWEEN -90 AND 90),
    "centerLng" NUMERIC(9,6) NOT NULL CHECK ("centerLng" BETWEEN -180 AND 180),
    "radiusMeters" INTEGER NOT NULL DEFAULT 150 CHECK ("radiusMeters" BETWEEN 30 AND 1000),
    "isActive" BOOLEAN NOT NULL DEFAULT FALSE,
    "note" VARCHAR(500),
    "createdBy" VARCHAR(120) NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS academic."AttendanceSession" (
    "id" VARCHAR(120) PRIMARY KEY,
    "sectionId" VARCHAR(120) NOT NULL REFERENCES academic."Section" ("id"),
    "attendanceDate" DATE NOT NULL,
    "geofenceId" VARCHAR(120) NOT NULL REFERENCES academic."AttendanceGeofence" ("id"),
    "opensAt" TIMESTAMPTZ NOT NULL,
    "closesAt" TIMESTAMPTZ NOT NULL,
    "lateAfterMinutes" INTEGER NOT NULL DEFAULT 10 CHECK ("lateAfterMinutes" BETWEEN 0 AND 60),
    "requireCode" BOOLEAN NOT NULL DEFAULT TRUE,
    "status" VARCHAR(16) NOT NULL CHECK ("status" IN ('OPEN','CLOSED')),
    "codeSecret" TEXT NOT NULL,
    "openedBy" VARCHAR(120) NOT NULL,
    "closedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT attendance_session_window CHECK (
        "closesAt" > "opensAt" AND "closesAt" <= "opensAt" + INTERVAL '60 minutes'
        AND "opensAt" + "lateAfterMinutes" * INTERVAL '1 minute' <= "closesAt")
);
CREATE UNIQUE INDEX IF NOT EXISTS attendance_session_one_open
    ON academic."AttendanceSession" ("sectionId", "attendanceDate") WHERE "status" = 'OPEN';
CREATE INDEX IF NOT EXISTS attendance_session_expiry ON academic."AttendanceSession" ("status", "closesAt");
CREATE INDEX IF NOT EXISTS attendance_session_retention ON academic."AttendanceSession" ("attendanceDate");
CREATE TABLE IF NOT EXISTS academic."AttendanceCheckin" (
    "id" VARCHAR(120) PRIMARY KEY,
    "sessionId" VARCHAR(120) NOT NULL REFERENCES academic."AttendanceSession" ("id"),
    "studentId" VARCHAR(120) NOT NULL REFERENCES academic."Student" ("id"),
    "deviceHash" CHAR(64) NOT NULL,
    "decision" VARCHAR(24) NOT NULL CHECK ("decision" IN ('ACCEPTED','PENDING_REVIEW','REJECTED')),
    "reason" VARCHAR(240) NOT NULL,
    "distanceMeters" DOUBLE PRECISION NOT NULL CHECK ("distanceMeters" >= 0),
    "accuracyMeters" DOUBLE PRECISION NOT NULL CHECK ("accuracyMeters" BETWEEN 0 AND 100),
    "lat" DOUBLE PRECISION CHECK ("lat" BETWEEN -90 AND 90),
    "lng" DOUBLE PRECISION CHECK ("lng" BETWEEN -180 AND 180),
    "mockProvider" BOOLEAN NOT NULL,
    "capturedAt" TIMESTAMPTZ NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedBy" VARCHAR(120),
    "reviewedAt" TIMESTAMPTZ,
    "reviewNote" VARCHAR(1000),
    CONSTRAINT attendance_checkin_coordinate_pair CHECK (("lat" IS NULL) = ("lng" IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS attendance_checkin_active_unique
    ON academic."AttendanceCheckin" ("sessionId", "studentId") WHERE "decision" IN ('ACCEPTED','PENDING_REVIEW');
CREATE INDEX IF NOT EXISTS attendance_checkin_device ON academic."AttendanceCheckin" ("sessionId", "deviceHash");
CREATE INDEX IF NOT EXISTS attendance_checkin_history ON academic."AttendanceCheckin" ("studentId", "createdAt");
CREATE TABLE IF NOT EXISTS academic."AttendanceCheckinAttempt" (
    "id" VARCHAR(120) PRIMARY KEY,
    "sessionId" VARCHAR(120) REFERENCES academic."AttendanceSession" ("id"),
    "requestedSessionId" VARCHAR(120) NOT NULL,
    "studentId" VARCHAR(120) NOT NULL REFERENCES academic."Student" ("id"),
    "outcome" VARCHAR(40) NOT NULL,
    "reason" VARCHAR(240) NOT NULL,
    "ipHash" CHAR(64) NOT NULL,
    "requestHash" CHAR(64),
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS attendance_attempt_student ON academic."AttendanceCheckinAttempt" ("sessionId", "studentId", "createdAt");
CREATE INDEX IF NOT EXISTS attendance_attempt_ip ON academic."AttendanceCheckinAttempt" ("sessionId", "ipHash", "createdAt");
CREATE INDEX IF NOT EXISTS attendance_attempt_retention ON academic."AttendanceCheckinAttempt" ("createdAt");
CREATE TABLE IF NOT EXISTS academic."AttendanceLocationConsent" (
    "studentId" VARCHAR(120) PRIMARY KEY REFERENCES academic."Student" ("id"),
    "version" VARCHAR(40) NOT NULL,
    "acceptedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE academic."Attendance" ADD COLUMN IF NOT EXISTS "checkinId" VARCHAR(120)
    REFERENCES academic."AttendanceCheckin" ("id");
INSERT INTO academic."AttendanceGeofence" ("id", "name", "campusCode", "centerLat", "centerLng", "radiusMeters", "isActive", "note", "createdBy")
SELECT 'ute-main-placeholder', 'HCM-UTE Vo Van Ngan (UNVERIFIED PLACEHOLDER)', 'UTE-MAIN',
       10.850600, 106.771900, 150, FALSE,
       'APPROXIMATE ONLY. Admin must verify campus coordinates and radius before enabling.', 'migration'
WHERE NOT EXISTS (SELECT 1 FROM academic."AttendanceGeofence" WHERE "id" = 'ute-main-placeholder');
