-- The admin enrollment list and its count filter on "semesterId" and page by
-- "enrolledAt" DESC, "id" DESC. Existing indexes lead with studentId, sectionId,
-- or enrolledAt, so a semester filter counted and walked the whole table. This
-- one serves the filter, the ORDER BY/LIMIT page and an index-only count.
--
-- Flyway runs each migration in a transaction and PostgreSQL forbids
-- CREATE INDEX CONCURRENTLY there, so a populated production database should
-- apply the same definition out of band with CONCURRENTLY and a write-impact
-- check (same note as V148).
--
-- Rollback: DROP INDEX academic.academic_enrollment_semester_enrolled_idx;
-- The index is derived data; dropping it loses no information.

CREATE INDEX IF NOT EXISTS academic_enrollment_semester_enrolled_idx
    ON academic."Enrollment" ("semesterId", "enrolledAt" DESC, "id" DESC);
