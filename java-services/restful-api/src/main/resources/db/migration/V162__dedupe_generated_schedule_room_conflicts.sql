DO $$
DECLARE
    clashing_schedule RECORD;
    candidate_slot RECORD;
    semester_summary RECORD;
    candidate_end_time TIME;
    schedule_duration INTERVAL;
    slot_assigned BOOLEAN;
    candidate_count INTEGER;
    room_free_count INTEGER;
    lecturer_free_count INTEGER;
    unique_free_count INTEGER;
    all_free_count INTEGER;
    room_available BOOLEAN;
    lecturer_available BOOLEAN;
    unique_available BOOLEAN;
BEGIN
    CREATE TEMP TABLE _generated_schedule_allocator_stats ON COMMIT DROP AS
    SELECT section."semesterId" AS semester_id,
           (COUNT(DISTINCT schedule."id") FILTER (WHERE EXISTS (
               SELECT 1
               FROM academic."SectionSchedule" other_schedule
               JOIN academic."Section" other_section ON other_section."id" = other_schedule."sectionId"
               WHERE other_schedule."id" <> schedule."id"
                 AND other_section."semesterId" = section."semesterId"
                 AND other_section."status" <> 'CANCELLED'
                 AND other_schedule."classroomId" = schedule."classroomId"
                 AND other_schedule."dayOfWeek" = schedule."dayOfWeek"
                 AND other_schedule."startTime"::time < schedule."endTime"::time
                 AND other_schedule."endTime"::time > schedule."startTime"::time
           )))::integer AS clashing_before,
           0::integer AS moved
    FROM academic."Section" section
    JOIN academic."SectionSchedule" schedule ON schedule."sectionId" = section."id"
    WHERE section."id" LIKE 'section-auto-%'
      AND section."status" <> 'CANCELLED'
    GROUP BY section."semesterId";

    LOOP
        SELECT section."id" AS section_id,
               section."semesterId" AS semester_id,
               section."lecturerId" AS lecturer_id,
               section."classroomId" AS current_classroom_id,
               section."capacity" AS capacity,
               schedule."id" AS schedule_id,
               schedule."startTime" AS start_time,
               schedule."endTime" AS end_time,
               substring(section."id" FROM 'section-auto-([0-9]+)$')::integer AS section_number
        INTO clashing_schedule
        FROM academic."Section" section
        JOIN academic."SectionSchedule" schedule ON schedule."sectionId" = section."id"
        WHERE section."id" LIKE 'section-auto-%'
          AND section."status" <> 'CANCELLED'
          AND EXISTS (
              SELECT 1
              FROM academic."SectionSchedule" other_schedule
              JOIN academic."Section" other_section ON other_section."id" = other_schedule."sectionId"
              WHERE other_schedule."id" <> schedule."id"
                AND other_section."semesterId" = section."semesterId"
                AND other_section."status" <> 'CANCELLED'
                AND other_schedule."classroomId" = schedule."classroomId"
                AND other_schedule."dayOfWeek" = schedule."dayOfWeek"
                AND other_schedule."startTime"::time < schedule."endTime"::time
                AND other_schedule."endTime"::time > schedule."startTime"::time
          )
        ORDER BY substring(section."id" FROM 'section-auto-([0-9]+)$')::integer,
                 section."id",
                 schedule."id"
        LIMIT 1;

        EXIT WHEN NOT FOUND;

        schedule_duration := clashing_schedule.end_time::time - clashing_schedule.start_time::time;
        slot_assigned := FALSE;
        candidate_count := 0;
        room_free_count := 0;
        lecturer_free_count := 0;
        unique_free_count := 0;
        all_free_count := 0;

        FOR candidate_slot IN
            SELECT room."id" AS room_id,
                   day_options.day_of_week,
                   time_options.start_time
            FROM academic."Classroom" room
            CROSS JOIN (
                SELECT DISTINCT generated_schedule."dayOfWeek" AS day_of_week
                FROM academic."Section" generated_section
                JOIN academic."SectionSchedule" generated_schedule
                  ON generated_schedule."sectionId" = generated_section."id"
                WHERE generated_section."id" LIKE 'section-auto-%'
                  AND generated_section."semesterId" = clashing_schedule.semester_id
                  AND generated_section."status" <> 'CANCELLED'
            ) day_options
            CROSS JOIN (
                SELECT DISTINCT generated_schedule."startTime" AS start_time
                FROM academic."Section" generated_section
                JOIN academic."SectionSchedule" generated_schedule
                  ON generated_schedule."sectionId" = generated_section."id"
                WHERE generated_section."id" LIKE 'section-auto-%'
                  AND generated_section."semesterId" = clashing_schedule.semester_id
                  AND generated_section."status" <> 'CANCELLED'
            ) time_options
            WHERE room."isActive" = TRUE
              AND room."capacity" >= clashing_schedule.capacity
            ORDER BY CASE WHEN room."id" = clashing_schedule.current_classroom_id THEN 0 ELSE 1 END,
                     room."id",
                     day_options.day_of_week,
                     time_options.start_time::time
        LOOP
            candidate_end_time := candidate_slot.start_time::time + schedule_duration;
            candidate_count := candidate_count + 1;

            SELECT NOT EXISTS (
                   SELECT 1
                   FROM academic."SectionSchedule" other_schedule
                   JOIN academic."Section" other_section ON other_section."id" = other_schedule."sectionId"
                   WHERE other_schedule."id" <> clashing_schedule.schedule_id
                     AND other_section."semesterId" = clashing_schedule.semester_id
                     AND other_section."status" <> 'CANCELLED'
                     AND other_schedule."classroomId" = candidate_slot.room_id
                     AND other_schedule."dayOfWeek" = candidate_slot.day_of_week
                     AND other_schedule."startTime"::time < candidate_end_time
                     AND other_schedule."endTime"::time > candidate_slot.start_time::time
               ) INTO room_available;
            SELECT NOT EXISTS (
                   SELECT 1
                   FROM academic."SectionSchedule" other_schedule
                   JOIN academic."Section" other_section ON other_section."id" = other_schedule."sectionId"
                   WHERE other_schedule."id" <> clashing_schedule.schedule_id
                     AND other_section."semesterId" = clashing_schedule.semester_id
                     AND other_section."status" <> 'CANCELLED'
                     AND other_section."lecturerId" = clashing_schedule.lecturer_id
                     AND other_schedule."dayOfWeek" = candidate_slot.day_of_week
                     AND other_schedule."startTime"::time < candidate_end_time
                     AND other_schedule."endTime"::time > candidate_slot.start_time::time
               ) INTO lecturer_available;
            SELECT NOT EXISTS (
                   SELECT 1
                   FROM academic."SectionSchedule" other_schedule
                   JOIN academic."Section" other_section ON other_section."id" = other_schedule."sectionId"
                   WHERE other_schedule."id" <> clashing_schedule.schedule_id
                     AND other_section."semesterId" = clashing_schedule.semester_id
                     AND other_section."id" LIKE 'section-auto-%'
                     AND other_schedule."classroomId" = candidate_slot.room_id
                     AND other_schedule."dayOfWeek" = candidate_slot.day_of_week
                     AND other_schedule."startTime"::time = candidate_slot.start_time::time
               ) INTO unique_available;

            IF room_available THEN
                room_free_count := room_free_count + 1;
            END IF;
            IF lecturer_available THEN
                lecturer_free_count := lecturer_free_count + 1;
            END IF;
            IF unique_available THEN
                unique_free_count := unique_free_count + 1;
            END IF;

            IF room_available AND lecturer_available AND unique_available THEN
                all_free_count := all_free_count + 1;
                UPDATE academic."SectionSchedule"
                SET "classroomId" = candidate_slot.room_id,
                    "dayOfWeek" = candidate_slot.day_of_week,
                    "startTime" = candidate_slot.start_time,
                    "endTime" = candidate_end_time::text
                WHERE "id" = clashing_schedule.schedule_id;

                IF (
                    SELECT COUNT(*)
                    FROM academic."SectionSchedule"
                    WHERE "sectionId" = clashing_schedule.section_id
                ) = 1 THEN
                    UPDATE academic."Section"
                    SET "classroomId" = candidate_slot.room_id
                    WHERE "id" = clashing_schedule.section_id;
                END IF;

                UPDATE _generated_schedule_allocator_stats
                SET moved = moved + 1
                WHERE semester_id = clashing_schedule.semester_id;

                slot_assigned := TRUE;
                EXIT;
            END IF;
        END LOOP;

        IF NOT slot_assigned THEN
            RAISE EXCEPTION 'No conflict-free candidate slot available for section % (candidates %, room-free %, lecturer-free %, unique-free %, all-free %)',
                clashing_schedule.section_id, candidate_count, room_free_count, lecturer_free_count, unique_free_count, all_free_count;
        END IF;
    END LOOP;

    FOR semester_summary IN
        SELECT stats.semester_id,
               stats.clashing_before,
               stats.moved,
               (
                   SELECT COUNT(*)
                   FROM academic."SectionSchedule" first_schedule
                   JOIN academic."Section" first_section ON first_section."id" = first_schedule."sectionId"
                   JOIN academic."SectionSchedule" second_schedule ON second_schedule."id" > first_schedule."id"
                   JOIN academic."Section" second_section ON second_section."id" = second_schedule."sectionId"
                   WHERE first_section."semesterId" = stats.semester_id
                     AND second_section."semesterId" = stats.semester_id
                     AND first_section."status" <> 'CANCELLED'
                     AND second_section."status" <> 'CANCELLED'
                     AND (first_section."id" LIKE 'section-auto-%' OR second_section."id" LIKE 'section-auto-%')
                     AND first_schedule."classroomId" = second_schedule."classroomId"
                     AND first_schedule."dayOfWeek" = second_schedule."dayOfWeek"
                     AND first_schedule."startTime"::time < second_schedule."endTime"::time
                     AND second_schedule."startTime"::time < first_schedule."endTime"::time
               ) AS residual_room_pairs,
               (
                   SELECT COUNT(*)
                   FROM academic."SectionSchedule" first_schedule
                   JOIN academic."Section" first_section ON first_section."id" = first_schedule."sectionId"
                   JOIN academic."SectionSchedule" second_schedule ON second_schedule."id" > first_schedule."id"
                   JOIN academic."Section" second_section ON second_section."id" = second_schedule."sectionId"
                   WHERE first_section."semesterId" = stats.semester_id
                     AND second_section."semesterId" = stats.semester_id
                     AND first_section."status" <> 'CANCELLED'
                     AND second_section."status" <> 'CANCELLED'
                     AND first_section."lecturerId" = second_section."lecturerId"
                     AND first_section."lecturerId" IS NOT NULL
                     AND (first_section."id" LIKE 'section-auto-%' OR second_section."id" LIKE 'section-auto-%')
                     AND first_schedule."dayOfWeek" = second_schedule."dayOfWeek"
                     AND first_schedule."startTime"::time < second_schedule."endTime"::time
                     AND second_schedule."startTime"::time < first_schedule."endTime"::time
               ) AS residual_generated_lecturer_pairs
        FROM _generated_schedule_allocator_stats stats
        ORDER BY stats.semester_id
    LOOP
        RAISE NOTICE 'V162 semester %, clashing-before %, moved %, residual-room-pairs %, residual-generated-lecturer-pairs %',
            semester_summary.semester_id,
            semester_summary.clashing_before,
            semester_summary.moved,
            semester_summary.residual_room_pairs,
            semester_summary.residual_generated_lecturer_pairs;
    END LOOP;
END;
$$;
