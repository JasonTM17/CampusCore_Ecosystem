-- H2 mirror of V147__engagement_folded_search_columns.sql (PostgreSQL).
-- H2 has no STORED modifier: a generated column is always computed on write.
-- The trimmed H2 fixture chain does not carry every production Announcement
-- column, so add the six base columns this migration's expressions reference
-- (title/content already exist from V123). VARCHAR is used instead of TEXT
-- because H2 generated columns need an explicit character type.
-- Same logical schema and the same 67-character fold map as production.

ALTER TABLE engagement."Announcement" ADD COLUMN IF NOT EXISTS "slug" VARCHAR(240);
ALTER TABLE engagement."Announcement" ADD COLUMN IF NOT EXISTS "courseCode" VARCHAR(60);
ALTER TABLE engagement."Announcement" ADD COLUMN IF NOT EXISTS "courseName" VARCHAR(240);
ALTER TABLE engagement."Announcement" ADD COLUMN IF NOT EXISTS "semesterName" VARCHAR(180);
ALTER TABLE engagement."Announcement" ADD COLUMN IF NOT EXISTS "lecturerDisplayName" VARCHAR(240);

ALTER TABLE engagement."Announcement" ADD COLUMN IF NOT EXISTS "foldedTitle" VARCHAR
    GENERATED ALWAYS AS (TRANSLATE(LOWER(COALESCE("title", '')), 'áàảãạăằắẳẵặâầấẩẫậéèẻẽẹêềếểễệíìỉĩịóòỏõọôồốổỗộơờớởỡợúùủũụưừứửữựýỳỷỹỵđ', 'aaaaaaaaaaaaaaaaaeeeeeeeeeeeiiiiiooooooooooooooooouuuuuuuuuuuyyyyyd'));

ALTER TABLE engagement."Announcement" ADD COLUMN IF NOT EXISTS "foldedContent" VARCHAR
    GENERATED ALWAYS AS (TRANSLATE(LOWER(COALESCE("content", '')), 'áàảãạăằắẳẵặâầấẩẫậéèẻẽẹêềếểễệíìỉĩịóòỏõọôồốổỗộơờớởỡợúùủũụưừứửữựýỳỷỹỵđ', 'aaaaaaaaaaaaaaaaaeeeeeeeeeeeiiiiiooooooooooooooooouuuuuuuuuuuyyyyyd'));

ALTER TABLE engagement."Announcement" ADD COLUMN IF NOT EXISTS "foldedSlug" VARCHAR
    GENERATED ALWAYS AS (TRANSLATE(LOWER(COALESCE("slug", '')), 'áàảãạăằắẳẵặâầấẩẫậéèẻẽẹêềếểễệíìỉĩịóòỏõọôồốổỗộơờớởỡợúùủũụưừứửữựýỳỷỹỵđ', 'aaaaaaaaaaaaaaaaaeeeeeeeeeeeiiiiiooooooooooooooooouuuuuuuuuuuyyyyyd'));

ALTER TABLE engagement."Announcement" ADD COLUMN IF NOT EXISTS "foldedCourseCode" VARCHAR
    GENERATED ALWAYS AS (TRANSLATE(LOWER(COALESCE("courseCode", '')), 'áàảãạăằắẳẵặâầấẩẫậéèẻẽẹêềếểễệíìỉĩịóòỏõọôồốổỗộơờớởỡợúùủũụưừứửữựýỳỷỹỵđ', 'aaaaaaaaaaaaaaaaaeeeeeeeeeeeiiiiiooooooooooooooooouuuuuuuuuuuyyyyyd'));

ALTER TABLE engagement."Announcement" ADD COLUMN IF NOT EXISTS "foldedCourseName" VARCHAR
    GENERATED ALWAYS AS (TRANSLATE(LOWER(COALESCE("courseName", '')), 'áàảãạăằắẳẵặâầấẩẫậéèẻẽẹêềếểễệíìỉĩịóòỏõọôồốổỗộơờớởỡợúùủũụưừứửữựýỳỷỹỵđ', 'aaaaaaaaaaaaaaaaaeeeeeeeeeeeiiiiiooooooooooooooooouuuuuuuuuuuyyyyyd'));

ALTER TABLE engagement."Announcement" ADD COLUMN IF NOT EXISTS "foldedSemesterName" VARCHAR
    GENERATED ALWAYS AS (TRANSLATE(LOWER(COALESCE("semesterName", '')), 'áàảãạăằắẳẵặâầấẩẫậéèẻẽẹêềếểễệíìỉĩịóòỏõọôồốổỗộơờớởỡợúùủũụưừứửữựýỳỷỹỵđ', 'aaaaaaaaaaaaaaaaaeeeeeeeeeeeiiiiiooooooooooooooooouuuuuuuuuuuyyyyyd'));

ALTER TABLE engagement."Announcement" ADD COLUMN IF NOT EXISTS "foldedLecturerDisplayName" VARCHAR
    GENERATED ALWAYS AS (TRANSLATE(LOWER(COALESCE("lecturerDisplayName", '')), 'áàảãạăằắẳẵặâầấẩẫậéèẻẽẹêềếểễệíìỉĩịóòỏõọôồốổỗộơờớởỡợúùủũụưừứửữựýỳỷỹỵđ', 'aaaaaaaaaaaaaaaaaeeeeeeeeeeeiiiiiooooooooooooooooouuuuuuuuuuuyyyyyd'));

ALTER TABLE engagement."PublicDocumentRevision" ADD COLUMN IF NOT EXISTS "foldedTitleVi" VARCHAR
    GENERATED ALWAYS AS (TRANSLATE(LOWER(COALESCE("titleVi", '')), 'áàảãạăằắẳẵặâầấẩẫậéèẻẽẹêềếểễệíìỉĩịóòỏõọôồốổỗộơờớởỡợúùủũụưừứửữựýỳỷỹỵđ', 'aaaaaaaaaaaaaaaaaeeeeeeeeeeeiiiiiooooooooooooooooouuuuuuuuuuuyyyyyd'));

ALTER TABLE engagement."PublicDocumentRevision" ADD COLUMN IF NOT EXISTS "foldedTitleEn" VARCHAR
    GENERATED ALWAYS AS (TRANSLATE(LOWER(COALESCE("titleEn", '')), 'áàảãạăằắẳẵặâầấẩẫậéèẻẽẹêềếểễệíìỉĩịóòỏõọôồốổỗộơờớởỡợúùủũụưừứửữựýỳỷỹỵđ', 'aaaaaaaaaaaaaaaaaeeeeeeeeeeeiiiiiooooooooooooooooouuuuuuuuuuuyyyyyd'));

ALTER TABLE engagement."PublicDocumentRevision" ADD COLUMN IF NOT EXISTS "foldedSummaryVi" VARCHAR
    GENERATED ALWAYS AS (TRANSLATE(LOWER(COALESCE("summaryVi", '')), 'áàảãạăằắẳẵặâầấẩẫậéèẻẽẹêềếểễệíìỉĩịóòỏõọôồốổỗộơờớởỡợúùủũụưừứửữựýỳỷỹỵđ', 'aaaaaaaaaaaaaaaaaeeeeeeeeeeeiiiiiooooooooooooooooouuuuuuuuuuuyyyyyd'));

ALTER TABLE engagement."PublicDocumentRevision" ADD COLUMN IF NOT EXISTS "foldedSummaryEn" VARCHAR
    GENERATED ALWAYS AS (TRANSLATE(LOWER(COALESCE("summaryEn", '')), 'áàảãạăằắẳẵặâầấẩẫậéèẻẽẹêềếểễệíìỉĩịóòỏõọôồốổỗộơờớởỡợúùủũụưừứửữựýỳỷỹỵđ', 'aaaaaaaaaaaaaaaaaeeeeeeeeeeeiiiiiooooooooooooooooouuuuuuuuuuuyyyyyd'));

ALTER TABLE engagement."PublicDocumentRevision" ADD COLUMN IF NOT EXISTS "foldedBodyVi" VARCHAR
    GENERATED ALWAYS AS (TRANSLATE(LOWER(COALESCE("bodyVi", '')), 'áàảãạăằắẳẵặâầấẩẫậéèẻẽẹêềếểễệíìỉĩịóòỏõọôồốổỗộơờớởỡợúùủũụưừứửữựýỳỷỹỵđ', 'aaaaaaaaaaaaaaaaaeeeeeeeeeeeiiiiiooooooooooooooooouuuuuuuuuuuyyyyyd'));

ALTER TABLE engagement."PublicDocumentRevision" ADD COLUMN IF NOT EXISTS "foldedBodyEn" VARCHAR
    GENERATED ALWAYS AS (TRANSLATE(LOWER(COALESCE("bodyEn", '')), 'áàảãạăằắẳẵặâầấẩẫậéèẻẽẹêềếểễệíìỉĩịóòỏõọôồốổỗộơờớởỡợúùủũụưừứửữựýỳỷỹỵđ', 'aaaaaaaaaaaaaaaaaeeeeeeeeeeeiiiiiooooooooooooooooouuuuuuuuuuuyyyyyd'));
