-- The default admin audit screen pages newest first with ORDER BY "createdAt"
-- DESC, "id" DESC. The entity and actor indexes lead with other columns, so
-- the unfiltered view sorted the whole append-only table for every page. This
-- index serves that order and its LIMIT/OFFSET window directly.
--
-- Flyway runs each migration in a transaction and PostgreSQL forbids
-- CREATE INDEX CONCURRENTLY there, so a populated production database should
-- apply the same definition out of band with CONCURRENTLY and a write-impact
-- check (same note as V148 and V149).
--
-- Rollback: DROP INDEX campuscore_audit.admin_audit_created_id_idx;
-- The index is derived data; dropping it loses no information.

CREATE INDEX IF NOT EXISTS admin_audit_created_id_idx
    ON campuscore_audit."AdminAudit" ("createdAt" DESC, "id" DESC);
