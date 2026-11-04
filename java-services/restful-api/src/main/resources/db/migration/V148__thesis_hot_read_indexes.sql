-- W16: the three thesis hot-read indexes that the P5 measurement justified
-- (plans/reports/orchestrate-261101-w16/ds-p5-thesis/result.md §0). Each one
-- changed a measured plan, not just a timing:
--
--   thesis.thesis_group (topic_id)
--       Q11 8.96 -> 0.27 ms (33x, 975 -> 6 buffers, sequential scan ->
--       index scan) and a nested-loop plan for Q03/Q14.
--   thesis.thesis_group_report (round_id, submitted_at DESC, group_id)
--       Q05 80.13 -> 35.73 ms (2.2x, 35k -> 6.2k rows, buffers halved).
--   thesis.thesis_council_topic (council_id, topic_id)
--       Q08 16.23 -> 4.96 ms (3.3x, 45k seq -> 7 x 111-row index-only scans).
--
-- Deliberately absent: thesis_group (round_id, created_at DESC, id) and
-- thesis_topic (round_id, status, title) were never chosen by the planner, and
-- thesis_council (round_id, created_at, id) only pays off around 100x today's
-- row count. Those surfaces need pagination instead (P5 §4, §6).
--
-- Ordinary B-trees trade read work for write maintenance. Flyway runs each
-- migration in a transaction and PostgreSQL forbids CREATE INDEX CONCURRENTLY
-- there, so a production rollout of the same definitions has to be applied out
-- of band with CONCURRENTLY and a write-impact check (P5 §7).
--
-- Rollback: DROP INDEX thesis.thesis_group_topic_idx;
--           DROP INDEX thesis.thesis_group_report_round_submitted_idx;
--           DROP INDEX thesis.thesis_council_topic_council_idx;
-- The indexes are derived data; dropping them loses no information and only
-- restores the pre-V148 plans.

CREATE INDEX IF NOT EXISTS thesis_group_topic_idx
    ON thesis.thesis_group (topic_id);

CREATE INDEX IF NOT EXISTS thesis_group_report_round_submitted_idx
    ON thesis.thesis_group_report (round_id, submitted_at DESC, group_id);

CREATE INDEX IF NOT EXISTS thesis_council_topic_council_idx
    ON thesis.thesis_council_topic (council_id, topic_id);
