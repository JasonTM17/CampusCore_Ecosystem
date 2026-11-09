-- The demo curriculum link repair replaced the declared four-year program
-- totals with the sum of the mandatory courses it had just linked, so fifteen
-- programs declare fewer credits than their own students already earned. This
-- migration restores the authored totals. Each row is updated only while the
-- stored value still equals the mandatory-link sum that repair wrote, so an
-- administrator's later edit is preserved and a rerun changes nothing.
-- curriculum-demo keeps its linked-course total and is not touched.

WITH target_curricula("id", "declaredTotal") AS (
    VALUES
        ('curriculum-se',      150),
        ('curriculum-ais',     148),
        ('curriculum-netsec',  152),
        ('curriculum-isbd',    145),
        ('curriculum-mis',     145),
        ('curriculum-auto',    150),
        ('curriculum-etec',    150),
        ('curriculum-robot',   149),
        ('curriculum-manuf',   148),
        ('curriculum-autoeng', 150),
        ('curriculum-bimeng',  146),
        ('curriculum-civil',   147),
        ('curriculum-bte',     138),
        ('curriculum-fin',     140),
        ('curriculum-lscm',    142)
), mandatory_totals AS (
    SELECT curriculum."id" AS curriculum_id,
           COALESCE(SUM(course."credits") FILTER (WHERE link."isMandatory"), 0)::integer AS total_credits
    FROM target_curricula target
    JOIN academic."Curriculum" curriculum ON curriculum."id" = target."id"
    LEFT JOIN academic."CurriculumCourse" link ON link."curriculumId" = curriculum."id"
    LEFT JOIN academic."Course" course ON course."id" = link."courseId"
    GROUP BY curriculum."id"
)
UPDATE academic."Curriculum" curriculum
SET "totalCredits" = target."declaredTotal"
FROM target_curricula target
JOIN mandatory_totals totals ON totals.curriculum_id = target."id"
WHERE curriculum."id" = target."id"
  AND curriculum."totalCredits" = totals.total_credits
  AND curriculum."totalCredits" IS DISTINCT FROM target."declaredTotal";
