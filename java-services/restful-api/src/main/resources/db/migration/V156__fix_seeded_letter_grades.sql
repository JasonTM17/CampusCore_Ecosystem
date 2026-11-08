WITH expected_grades AS (
    SELECT enrollment."id",
           CASE
               WHEN enrollment."finalGrade" >= 9.0 THEN 'A+'
               WHEN enrollment."finalGrade" >= 8.5 THEN 'A'
               WHEN enrollment."finalGrade" >= 8.0 THEN 'B+'
               WHEN enrollment."finalGrade" >= 7.0 THEN 'B'
               WHEN enrollment."finalGrade" >= 6.5 THEN 'C+'
               WHEN enrollment."finalGrade" >= 5.5 THEN 'C'
               WHEN enrollment."finalGrade" >= 5.0 THEN 'D+'
               WHEN enrollment."finalGrade" >= 4.0 THEN 'D'
               ELSE 'F'
           END AS letter_grade
    FROM academic."Enrollment" enrollment
    WHERE (enrollment."id" LIKE 'enr-s2-hist-%' OR enrollment."id" LIKE 'enr-s3-hist-%')
      AND enrollment."finalGrade" IS NOT NULL
)
UPDATE academic."Enrollment" enrollment
SET "letterGrade" = expected_grades.letter_grade
FROM expected_grades
WHERE enrollment."id" = expected_grades."id"
  AND enrollment."letterGrade" IS DISTINCT FROM expected_grades.letter_grade;
