WITH target_curricula("id") AS (
    VALUES
        ('curriculum-se'),
        ('curriculum-ais'),
        ('curriculum-netsec'),
        ('curriculum-isbd'),
        ('curriculum-mis'),
        ('curriculum-auto'),
        ('curriculum-etec'),
        ('curriculum-robot'),
        ('curriculum-manuf'),
        ('curriculum-autoeng'),
        ('curriculum-bimeng'),
        ('curriculum-civil'),
        ('curriculum-bte'),
        ('curriculum-fin'),
        ('curriculum-lscm')
), ordered_courses AS (
    SELECT curriculum."id" AS curriculum_id,
           course."id" AS course_id,
           ROW_NUMBER() OVER (
               PARTITION BY curriculum."id"
               ORDER BY course."code", course."id"
           ) AS course_order
    FROM target_curricula target
    JOIN academic."Curriculum" curriculum ON curriculum."id" = target."id"
    JOIN academic."Course" course ON course."departmentId" = curriculum."departmentId"
)
INSERT INTO academic."CurriculumCourse"
    ("id", "curriculumId", "courseId", "year", "semester", "isMandatory")
SELECT 'curriculum-course-v159-' || md5(ordered_courses.curriculum_id || ':' || ordered_courses.course_id),
       ordered_courses.curriculum_id,
       ordered_courses.course_id,
       (((ordered_courses.course_order - 1) / 2) % 4 + 1)::integer,
       ((ordered_courses.course_order - 1) % 2 + 1)::integer,
       TRUE
FROM ordered_courses
WHERE NOT EXISTS (
    SELECT 1
    FROM academic."CurriculumCourse" existing
    WHERE existing."curriculumId" = ordered_courses.curriculum_id
      AND existing."courseId" = ordered_courses.course_id
)
ON CONFLICT ("id") DO NOTHING;

WITH target_curricula("id") AS (
    VALUES
        ('curriculum-demo'),
        ('curriculum-se'),
        ('curriculum-ais'),
        ('curriculum-netsec'),
        ('curriculum-isbd'),
        ('curriculum-mis'),
        ('curriculum-auto'),
        ('curriculum-etec'),
        ('curriculum-robot'),
        ('curriculum-manuf'),
        ('curriculum-autoeng'),
        ('curriculum-bimeng'),
        ('curriculum-civil'),
        ('curriculum-bte'),
        ('curriculum-fin'),
        ('curriculum-lscm')
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
SET "totalCredits" = mandatory_totals.total_credits
FROM mandatory_totals
WHERE curriculum."id" = mandatory_totals.curriculum_id
  AND curriculum."totalCredits" IS DISTINCT FROM mandatory_totals.total_credits;
