-- Service-test mirror of PostgreSQL V113. H2 cannot prove PG deferred triggers,
-- migration-only legacy-marker guards or immutable RAG releases.
ALTER TABLE thesis.thesis_group
    ADD COLUMN legacy_group_size_exception BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE thesis.thesis_group g
SET legacy_group_size_exception = TRUE
WHERE g.approval_status = 'APPROVED'
  AND (g.status = 'CANCELLED' OR EXISTS (
      SELECT 1 FROM thesis.thesis_registration_round r
      WHERE r.id = g.round_id AND r.status IN ('RESULTS_PUBLISHED', 'CLOSED', 'CANCELLED')))
  AND (SELECT COUNT(*) FROM thesis.thesis_group_member m WHERE m.group_id = g.id) BETWEEN 1 AND 2;

UPDATE thesis.thesis_group g
SET approval_status = 'PENDING', approved_by = NULL, approved_at = NULL,
    rejection_reason = 'Group requires 3-5 members before re-approval',
    version = g.version + 1, updated_at = CURRENT_TIMESTAMP
WHERE g.approval_status = 'APPROVED' AND g.status <> 'CANCELLED'
  AND EXISTS (SELECT 1 FROM thesis.thesis_registration_round r
      WHERE r.id = g.round_id AND r.status NOT IN ('RESULTS_PUBLISHED', 'CLOSED', 'CANCELLED'))
  AND (SELECT COUNT(*) FROM thesis.thesis_group_member m WHERE m.group_id = g.id) < 3;

ALTER TABLE thesis.thesis_group_member DROP CONSTRAINT IF EXISTS thesis_group_member_order_valid;
ALTER TABLE thesis.thesis_group_member
    ADD CONSTRAINT thesis_group_member_order_valid CHECK (member_order BETWEEN 1 AND 5);
