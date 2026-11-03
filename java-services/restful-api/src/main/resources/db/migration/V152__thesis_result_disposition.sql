-- A group whose assigned reviewer scored the thesis below the 5.0 defense threshold has no
-- numeric final score; publication records that terminal outcome instead of leaving the round
-- blocked. Existing numeric results are backfilled as GRADED with the provenance already stored.
ALTER TABLE thesis.thesis_topic
    ADD COLUMN IF NOT EXISTS result_reason VARCHAR(64),
    ADD COLUMN IF NOT EXISTS result_resolved_by VARCHAR(120),
    ADD COLUMN IF NOT EXISTS result_resolved_at TIMESTAMPTZ;

UPDATE thesis.thesis_topic
SET result_status = 'GRADED',
    result_resolved_by = COALESCE(result_resolved_by, final_score_finalized_by),
    result_resolved_at = COALESCE(result_resolved_at, final_score_finalized_at)
WHERE final_score IS NOT NULL
  AND result_status IS NULL;

ALTER TABLE thesis.thesis_topic
    ADD CONSTRAINT thesis_topic_result_shape_valid CHECK (
        CASE
            WHEN result_status IS NULL THEN
                final_score IS NULL AND result_reason IS NULL
                AND result_resolved_by IS NULL AND result_resolved_at IS NULL
            WHEN result_status = 'GRADED' THEN
                final_score IS NOT NULL AND final_score BETWEEN 0 AND 10 AND result_reason IS NULL
            WHEN result_status = 'NOT_QUALIFIED' THEN
                final_score IS NULL AND result_reason = 'GVPB_BELOW_THRESHOLD'
                AND result_resolved_by IS NOT NULL AND TRIM(result_resolved_by) <> ''
                AND result_resolved_at IS NOT NULL
                AND final_score_finalized_by IS NULL AND final_score_finalized_at IS NULL
            ELSE FALSE
        END
    );