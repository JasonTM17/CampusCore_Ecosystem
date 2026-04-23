ALTER TABLE "Faculty"
  ADD COLUMN IF NOT EXISTS "nameEn" TEXT,
  ADD COLUMN IF NOT EXISTS "nameVi" TEXT,
  ADD COLUMN IF NOT EXISTS "descriptionEn" TEXT,
  ADD COLUMN IF NOT EXISTS "descriptionVi" TEXT;

ALTER TABLE "Department"
  ADD COLUMN IF NOT EXISTS "nameEn" TEXT,
  ADD COLUMN IF NOT EXISTS "nameVi" TEXT,
  ADD COLUMN IF NOT EXISTS "descriptionEn" TEXT,
  ADD COLUMN IF NOT EXISTS "descriptionVi" TEXT;

ALTER TABLE "Semester"
  ADD COLUMN IF NOT EXISTS "nameEn" TEXT,
  ADD COLUMN IF NOT EXISTS "nameVi" TEXT;

ALTER TABLE "Course"
  ADD COLUMN IF NOT EXISTS "nameEn" TEXT,
  ADD COLUMN IF NOT EXISTS "nameVi" TEXT,
  ADD COLUMN IF NOT EXISTS "descriptionEn" TEXT,
  ADD COLUMN IF NOT EXISTS "descriptionVi" TEXT;

ALTER TABLE "Curriculum"
  ADD COLUMN IF NOT EXISTS "nameEn" TEXT,
  ADD COLUMN IF NOT EXISTS "nameVi" TEXT,
  ADD COLUMN IF NOT EXISTS "descriptionEn" TEXT,
  ADD COLUMN IF NOT EXISTS "descriptionVi" TEXT;

UPDATE "Faculty"
SET
  "nameEn" = COALESCE("nameEn", "name"),
  "descriptionEn" = COALESCE("descriptionEn", "description"),
  "nameVi" = COALESCE(
    "nameVi",
    CASE "code"
      WHEN 'FCS' THEN 'Khoa Khoa học máy tính'
      WHEN 'FE' THEN 'Khoa Kỹ thuật'
      WHEN 'FBA' THEN 'Khoa Quản trị kinh doanh'
      ELSE NULL
    END
  ),
  "descriptionVi" = COALESCE(
    "descriptionVi",
    CASE "code"
      WHEN 'FCS' THEN 'Khoa Khoa học máy tính và công nghệ thông tin'
      WHEN 'FE' THEN 'Khoa Kỹ thuật'
      WHEN 'FBA' THEN 'Khoa Quản trị kinh doanh'
      ELSE NULL
    END
  );

UPDATE "Department"
SET
  "nameEn" = COALESCE("nameEn", "name"),
  "descriptionEn" = COALESCE("descriptionEn", "description"),
  "nameVi" = COALESCE(
    "nameVi",
    CASE "code"
      WHEN 'CS' THEN 'Khoa học máy tính'
      WHEN 'SE' THEN 'Kỹ thuật phần mềm'
      WHEN 'CE' THEN 'Kỹ thuật máy tính'
      WHEN 'BA' THEN 'Quản trị kinh doanh'
      ELSE NULL
    END
  ),
  "descriptionVi" = COALESCE(
    "descriptionVi",
    CASE "code"
      WHEN 'CS' THEN 'Bộ môn Khoa học máy tính'
      WHEN 'SE' THEN 'Bộ môn Kỹ thuật phần mềm'
      WHEN 'CE' THEN 'Bộ môn Kỹ thuật máy tính'
      WHEN 'BA' THEN 'Bộ môn Quản trị kinh doanh'
      ELSE NULL
    END
  );

UPDATE "Course"
SET
  "nameEn" = COALESCE("nameEn", "name"),
  "descriptionEn" = COALESCE("descriptionEn", "description"),
  "nameVi" = COALESCE(
    "nameVi",
    CASE "code"
      WHEN 'CS101' THEN 'Nhập môn lập trình'
      WHEN 'CS201' THEN 'Cấu trúc dữ liệu'
      WHEN 'CS301' THEN 'Giải thuật'
      WHEN 'CS401' THEN 'Trí tuệ nhân tạo'
      WHEN 'SE201' THEN 'Nguyên lý kỹ thuật phần mềm'
      WHEN 'SE301' THEN 'Hệ quản trị cơ sở dữ liệu'
      WHEN 'SE401' THEN 'Phát triển web'
      WHEN 'CE201' THEN 'Kiến trúc máy tính'
      WHEN 'CE301' THEN 'Mạng máy tính'
      WHEN 'BA101' THEN 'Nhập môn kinh doanh'
      WHEN 'BA201' THEN 'Nguyên lý quản trị'
      ELSE NULL
    END
  );

UPDATE "Curriculum"
SET
  "nameEn" = COALESCE("nameEn", "name"),
  "descriptionEn" = COALESCE("descriptionEn", "description"),
  "nameVi" = COALESCE(
    "nameVi",
    CASE "code"
      WHEN 'CS2025' THEN 'Chương trình Khoa học máy tính 2025'
      WHEN 'SE2025' THEN 'Chương trình Kỹ thuật phần mềm 2025'
      ELSE NULL
    END
  ),
  "descriptionVi" = COALESCE(
    "descriptionVi",
    CASE "code"
      WHEN 'CS2025' THEN 'Chương trình Khoa học máy tính cho khóa tuyển sinh 2025'
      WHEN 'SE2025' THEN 'Chương trình Kỹ thuật phần mềm cho khóa tuyển sinh 2025'
      ELSE NULL
    END
  );

UPDATE "Semester" AS s
SET
  "nameEn" = COALESCE(
    s."nameEn",
    CASE s."type"
      WHEN 'SPRING' THEN CONCAT('Spring ', ay."year")
      WHEN 'SUMMER' THEN CONCAT('Summer ', ay."year")
      WHEN 'FALL' THEN CONCAT('Fall ', ay."year")
      ELSE s."name"
    END
  ),
  "nameVi" = COALESCE(
    s."nameVi",
    CASE s."type"
      WHEN 'SPRING' THEN CONCAT('Học kỳ Xuân ', ay."year")
      WHEN 'SUMMER' THEN CONCAT('Học kỳ Hè ', ay."year")
      WHEN 'FALL' THEN CONCAT('Học kỳ Thu ', ay."year")
      ELSE NULL
    END
  )
FROM "AcademicYear" AS ay
WHERE ay."id" = s."academicYearId";
