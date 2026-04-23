ALTER TABLE "Invoice"
ADD COLUMN "semesterNameEn" TEXT,
ADD COLUMN "semesterNameVi" TEXT;

UPDATE "Invoice"
SET "semesterNameEn" = COALESCE("semesterNameEn", "semesterName")
WHERE "semesterNameEn" IS NULL;

UPDATE "Invoice"
SET "semesterNameVi" = CASE
  WHEN "semesterName" ~* '^Fall[[:space:]]+[0-9]{4}$'
    THEN 'Học kỳ Thu ' || substring("semesterName" from '([0-9]{4})$')
  WHEN "semesterName" ~* '^Spring[[:space:]]+[0-9]{4}$'
    THEN 'Học kỳ Xuân ' || substring("semesterName" from '([0-9]{4})$')
  WHEN "semesterName" ~* '^Summer[[:space:]]+[0-9]{4}$'
    THEN 'Học kỳ Hè ' || substring("semesterName" from '([0-9]{4})$')
  ELSE "semesterNameVi"
END
WHERE "semesterNameVi" IS NULL;
