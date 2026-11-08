WITH generated AS (
    SELECT section."id" AS section_id,
           schedule."classroomId" AS room_id,
           schedule."dayOfWeek" AS day_of_week,
           schedule."startTime" AS start_time,
           schedule."endTime"::time - schedule."startTime"::time AS duration,
           substring(section."id" FROM 'section-auto-([0-9]+)$')::integer AS section_number
    FROM academic."Section" section
    JOIN academic."SectionSchedule" schedule ON schedule."sectionId" = section."id"
    WHERE section."id" LIKE 'section-auto-%'
), colliding AS (
    SELECT generated.*
    FROM generated
    WHERE EXISTS (
        SELECT 1
        FROM generated other
        WHERE other.section_id <> generated.section_id
          AND other.room_id = generated.room_id
          AND other.day_of_week = generated.day_of_week
          AND other.start_time = generated.start_time
    )
), untouched AS (
    SELECT generated.room_id, generated.day_of_week, generated.start_time
    FROM generated
    WHERE NOT EXISTS (
        SELECT 1 FROM colliding WHERE colliding.section_id = generated.section_id
    )
), room_options AS (
    SELECT DISTINCT room_id FROM generated
), day_options AS (
    SELECT DISTINCT day_of_week FROM generated
), time_options AS (
    SELECT DISTINCT start_time FROM generated
), available_slots AS (
    SELECT room_options.room_id,
           day_options.day_of_week,
           time_options.start_time,
           row_number() OVER (
               ORDER BY room_options.room_id, day_options.day_of_week, time_options.start_time::time
           ) AS slot_number
    FROM room_options
    CROSS JOIN day_options
    CROSS JOIN time_options
    WHERE NOT EXISTS (
        SELECT 1
        FROM untouched
        WHERE untouched.room_id = room_options.room_id
          AND untouched.day_of_week = day_options.day_of_week
          AND untouched.start_time = time_options.start_time
    )
), ranked_collisions AS (
    SELECT colliding.*,
           row_number() OVER (ORDER BY colliding.section_number, colliding.section_id) AS slot_number
    FROM colliding
), assignments AS (
    SELECT ranked_collisions.section_id,
           available_slots.room_id,
           available_slots.day_of_week,
           available_slots.start_time,
           ranked_collisions.duration
    FROM ranked_collisions
    JOIN available_slots USING (slot_number)
), updated_schedules AS (
    UPDATE academic."SectionSchedule" schedule
    SET "classroomId" = assignments.room_id,
        "dayOfWeek" = assignments.day_of_week,
        "startTime" = assignments.start_time,
        "endTime" = (assignments.start_time::time + assignments.duration)::text
    FROM assignments
    WHERE schedule."sectionId" = assignments.section_id
    RETURNING schedule."sectionId" AS section_id, schedule."classroomId" AS room_id
)
UPDATE academic."Section" section
SET "classroomId" = updated_schedules.room_id
FROM updated_schedules
WHERE section."id" = updated_schedules.section_id;

UPDATE academic."Enrollment" enrollment
SET "enrolledAt" = TIMESTAMPTZ '2025-12-10T00:00:00Z'
        + ((substring(enrollment."id" FROM '^enrollment-history-v27-([0-9]+)-')::integer % 30)
            * INTERVAL '1 day')
FROM academic."Semester" semester
WHERE enrollment."id" LIKE 'enrollment-history-v27-%'
  AND enrollment."semesterId" = semester."id"
  AND semester."id" = 'semester-history-demo-1'
  AND enrollment."enrolledAt" > semester."endDate";
