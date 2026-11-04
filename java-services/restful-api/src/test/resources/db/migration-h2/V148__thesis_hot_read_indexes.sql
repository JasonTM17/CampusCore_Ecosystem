-- H2 mirror of db/migration/V148__thesis_hot_read_indexes.sql for the trimmed
-- test chain. H2 2.3 accepts the same IF NOT EXISTS and ASC/DESC index column
-- syntax, so the column order and directions stay byte-for-byte equivalent to
-- the PostgreSQL definition.
--
-- Rollback: drop the three indexes below; they are derived data.

CREATE INDEX IF NOT EXISTS thesis_group_topic_idx
    ON thesis.thesis_group (topic_id);

CREATE INDEX IF NOT EXISTS thesis_group_report_round_submitted_idx
    ON thesis.thesis_group_report (round_id, submitted_at DESC, group_id);

CREATE INDEX IF NOT EXISTS thesis_council_topic_council_idx
    ON thesis.thesis_council_topic (council_id, topic_id);
