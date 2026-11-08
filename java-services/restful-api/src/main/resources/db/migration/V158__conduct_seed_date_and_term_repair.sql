-- V158__conduct_seed_date_and_term_repair.sql
-- Demo conduct seed repair: align the career fair activity date with the event
-- announcement and move activities whose dates fall outside their term.

UPDATE academic.conduct_activity
SET activity_date = DATE '2026-10-23'
WHERE title = 'Tham gia Ngày hội việc làm UTE Career Expo 2026'
  AND activity_date = DATE '2026-09-02';

UPDATE academic.conduct_activity
SET semester_id = 'semester-history-demo-1'
WHERE id IN ('act-drl-ute-van-nghe-20-11', 'act-drl-ute-chu-nhat-xanh-2025');

UPDATE academic.conduct_activity
SET semester_id = 'semester-history-demo-1',
    activity_date = DATE '2025-10-10'
WHERE id = 'act-drl-ute-hoi-thao-cloud-aws';
