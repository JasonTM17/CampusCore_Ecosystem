DO $v161$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM academic."Enrollment" enrollment
        JOIN academic."Section" source_section ON source_section."id" = enrollment."sectionId"
        WHERE enrollment."id" LIKE 'enrollment-history-v27-%'
          AND enrollment."semesterId" <> source_section."semesterId"
          AND (enrollment."semesterId" <> 'semester-history-demo-1'
               OR source_section."semesterId" <> 'semester-demo')
    ) THEN
        RAISE EXCEPTION 'V161 found a V27 history enrollment outside the verified semester mapping';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM academic."StudentGrade" grade
        JOIN academic."Enrollment" enrollment ON enrollment."id" = grade."enrollmentId"
        JOIN academic."Section" source_section ON source_section."id" = enrollment."sectionId"
        JOIN academic."GradeItem" source_item ON source_item."id" = grade."gradeItemId"
        WHERE enrollment."id" LIKE 'enrollment-history-v27-%'
          AND enrollment."semesterId" = 'semester-history-demo-1'
          AND enrollment."semesterId" <> source_section."semesterId"
          AND source_item."sectionId" <> source_section."id"
    ) THEN
        RAISE EXCEPTION 'V161 found a V27 history grade item outside its source section';
    END IF;

    CREATE TEMPORARY TABLE v161_section_map (
        source_id VARCHAR(120) PRIMARY KEY,
        historical_id VARCHAR(120) NOT NULL UNIQUE
    ) ON COMMIT DROP;

    INSERT INTO v161_section_map (source_id, historical_id)
    SELECT source_section."id",
           'section-hist-v161-' || lpad(row_number() OVER (ORDER BY source_section."id")::text, 3, '0')
    FROM academic."Section" source_section
    WHERE source_section."semesterId" = 'semester-demo'
      AND EXISTS (
          SELECT 1
          FROM academic."Enrollment" enrollment
          WHERE enrollment."id" LIKE 'enrollment-history-v27-%'
            AND enrollment."semesterId" = 'semester-history-demo-1'
            AND enrollment."sectionId" = source_section."id"
            AND enrollment."semesterId" <> source_section."semesterId"
      );

    IF NOT EXISTS (SELECT 1 FROM v161_section_map) THEN
        RETURN;
    END IF;

    INSERT INTO academic."Section" (
        "id", "sectionNumber", "courseId", "semesterId", "lecturerId", "classroomId",
        "capacity", "enrolledCount", "status", "createdAt", "updatedAt"
    )
    SELECT section_map.historical_id, source_section."sectionNumber", source_section."courseId",
           'semester-history-demo-1', source_section."lecturerId", source_section."classroomId",
           source_section."capacity", source_section."enrolledCount", source_section."status",
           source_section."createdAt", source_section."updatedAt"
    FROM v161_section_map section_map
    JOIN academic."Section" source_section ON source_section."id" = section_map.source_id;

    INSERT INTO academic."SectionSchedule" (
        "id", "sectionId", "classroomId", "dayOfWeek", "startTime", "endTime"
    )
    SELECT 'schedule-hist-v161-' || md5(source_schedule."id"), section_map.historical_id,
           source_schedule."classroomId", source_schedule."dayOfWeek",
           source_schedule."startTime", source_schedule."endTime"
    FROM v161_section_map section_map
    JOIN academic."SectionSchedule" source_schedule ON source_schedule."sectionId" = section_map.source_id;

    INSERT INTO academic."GradeItem" (
        "id", "sectionId", "name", "type", "maxScore", "weight", "gradedAt", "createdAt"
    )
    SELECT 'grade-hist-v161-' || md5(source_item."id"), section_map.historical_id,
           source_item."name", source_item."type", source_item."maxScore", source_item."weight",
           source_item."gradedAt", source_item."createdAt"
    FROM v161_section_map section_map
    JOIN academic."GradeItem" source_item ON source_item."sectionId" = section_map.source_id;

    UPDATE academic."StudentGrade" grade
    SET "gradeItemId" = 'grade-hist-v161-' || md5(source_item."id")
    FROM academic."Enrollment" enrollment,
         v161_section_map section_map,
         academic."GradeItem" source_item
    WHERE enrollment."id" LIKE 'enrollment-history-v27-%'
      AND enrollment."semesterId" = 'semester-history-demo-1'
      AND enrollment."sectionId" = section_map.source_id
      AND source_item."sectionId" = section_map.source_id
      AND grade."enrollmentId" = enrollment."id"
      AND grade."gradeItemId" = source_item."id"
      AND EXISTS (
          SELECT 1
          FROM academic."GradeItem" historical_item
          WHERE historical_item."id" = 'grade-hist-v161-' || md5(source_item."id")
            AND historical_item."sectionId" = section_map.historical_id
      );

    IF EXISTS (
        SELECT 1
        FROM academic."StudentGrade" grade
        JOIN academic."Enrollment" enrollment ON enrollment."id" = grade."enrollmentId"
        JOIN v161_section_map section_map ON section_map.source_id = enrollment."sectionId"
        JOIN academic."GradeItem" historical_item ON historical_item."id" = grade."gradeItemId"
        WHERE enrollment."id" LIKE 'enrollment-history-v27-%'
          AND enrollment."semesterId" = 'semester-history-demo-1'
          AND historical_item."sectionId" <> section_map.historical_id
    ) THEN
        RAISE EXCEPTION 'V161 could not re-point every V27 history grade item';
    END IF;

    UPDATE academic."Enrollment" enrollment
    SET "sectionId" = section_map.historical_id
    FROM v161_section_map section_map
    JOIN academic."Section" historical_section ON historical_section."id" = section_map.historical_id
    WHERE enrollment."id" LIKE 'enrollment-history-v27-%'
      AND enrollment."semesterId" = 'semester-history-demo-1'
      AND enrollment."sectionId" = section_map.source_id
      AND historical_section."semesterId" = enrollment."semesterId";

    IF EXISTS (
        SELECT 1
        FROM academic."Enrollment" enrollment
        JOIN academic."Section" section ON section."id" = enrollment."sectionId"
        WHERE enrollment."id" LIKE 'enrollment-history-v27-%'
          AND enrollment."semesterId" <> section."semesterId"
    ) THEN
        RAISE EXCEPTION 'V161 left a V27 history enrollment in a different semester';
    END IF;
END;
$v161$;
