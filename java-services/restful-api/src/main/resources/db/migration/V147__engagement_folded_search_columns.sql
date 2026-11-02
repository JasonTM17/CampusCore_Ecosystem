-- W16: pre-folded search columns for the two operator searches whose predicate
-- is CPU-bound on TRANSLATE(LOWER(col), 67, 67) per row per column (P10
-- evidence). Each field keeps its own stored column so the query shape stays
-- "OR across fields, AND across tokens" and the LIKE/ESCAPE semantics do not
-- change. PostgreSQL recomputes generated columns on INSERT/UPDATE and
-- backfills existing rows while this migration runs.
--
-- The 67-character mapping is copied verbatim from
-- common/LikePattern.java (FOLD_FROM/FOLD_TO). PostgreSQL translate(text,text,text)
-- is IMMUTABLE, so it is legal in a generated column.
--
-- No index is added: both readers use an infix LIKE '%token%', which a B-tree
-- cannot serve, and the optional pg_trgm alternative needs an extension plus a
-- custom plan to be useful (P10 §4-6). The generated column removes the fold
-- CPU cost; it does not claim to remove the sequential scan.
--
-- Rollback: drop the folded columns listed below. They are derived data, so no
-- information is lost; the reader must be rolled back first because it selects
-- these names.

ALTER TABLE engagement."Announcement"
    ADD COLUMN IF NOT EXISTS "foldedTitle" TEXT
    GENERATED ALWAYS AS (TRANSLATE(LOWER(COALESCE("title", '')), 'áàảãạăằắẳẵặâầấẩẫậéèẻẽẹêềếểễệíìỉĩịóòỏõọôồốổỗộơờớởỡợúùủũụưừứửữựýỳỷỹỵđ', 'aaaaaaaaaaaaaaaaaeeeeeeeeeeeiiiiiooooooooooooooooouuuuuuuuuuuyyyyyd')) STORED;

ALTER TABLE engagement."Announcement"
    ADD COLUMN IF NOT EXISTS "foldedContent" TEXT
    GENERATED ALWAYS AS (TRANSLATE(LOWER(COALESCE("content", '')), 'áàảãạăằắẳẵặâầấẩẫậéèẻẽẹêềếểễệíìỉĩịóòỏõọôồốổỗộơờớởỡợúùủũụưừứửữựýỳỷỹỵđ', 'aaaaaaaaaaaaaaaaaeeeeeeeeeeeiiiiiooooooooooooooooouuuuuuuuuuuyyyyyd')) STORED;

ALTER TABLE engagement."Announcement"
    ADD COLUMN IF NOT EXISTS "foldedSlug" TEXT
    GENERATED ALWAYS AS (TRANSLATE(LOWER(COALESCE("slug", '')), 'áàảãạăằắẳẵặâầấẩẫậéèẻẽẹêềếểễệíìỉĩịóòỏõọôồốổỗộơờớởỡợúùủũụưừứửữựýỳỷỹỵđ', 'aaaaaaaaaaaaaaaaaeeeeeeeeeeeiiiiiooooooooooooooooouuuuuuuuuuuyyyyyd')) STORED;

ALTER TABLE engagement."Announcement"
    ADD COLUMN IF NOT EXISTS "foldedCourseCode" TEXT
    GENERATED ALWAYS AS (TRANSLATE(LOWER(COALESCE("courseCode", '')), 'áàảãạăằắẳẵặâầấẩẫậéèẻẽẹêềếểễệíìỉĩịóòỏõọôồốổỗộơờớởỡợúùủũụưừứửữựýỳỷỹỵđ', 'aaaaaaaaaaaaaaaaaeeeeeeeeeeeiiiiiooooooooooooooooouuuuuuuuuuuyyyyyd')) STORED;

ALTER TABLE engagement."Announcement"
    ADD COLUMN IF NOT EXISTS "foldedCourseName" TEXT
    GENERATED ALWAYS AS (TRANSLATE(LOWER(COALESCE("courseName", '')), 'áàảãạăằắẳẵặâầấẩẫậéèẻẽẹêềếểễệíìỉĩịóòỏõọôồốổỗộơờớởỡợúùủũụưừứửữựýỳỷỹỵđ', 'aaaaaaaaaaaaaaaaaeeeeeeeeeeeiiiiiooooooooooooooooouuuuuuuuuuuyyyyyd')) STORED;

ALTER TABLE engagement."Announcement"
    ADD COLUMN IF NOT EXISTS "foldedSemesterName" TEXT
    GENERATED ALWAYS AS (TRANSLATE(LOWER(COALESCE("semesterName", '')), 'áàảãạăằắẳẵặâầấẩẫậéèẻẽẹêềếểễệíìỉĩịóòỏõọôồốổỗộơờớởỡợúùủũụưừứửữựýỳỷỹỵđ', 'aaaaaaaaaaaaaaaaaeeeeeeeeeeeiiiiiooooooooooooooooouuuuuuuuuuuyyyyyd')) STORED;

ALTER TABLE engagement."Announcement"
    ADD COLUMN IF NOT EXISTS "foldedLecturerDisplayName" TEXT
    GENERATED ALWAYS AS (TRANSLATE(LOWER(COALESCE("lecturerDisplayName", '')), 'áàảãạăằắẳẵặâầấẩẫậéèẻẽẹêềếểễệíìỉĩịóòỏõọôồốổỗộơờớởỡợúùủũụưừứửữựýỳỷỹỵđ', 'aaaaaaaaaaaaaaaaaeeeeeeeeeeeiiiiiooooooooooooooooouuuuuuuuuuuyyyyyd')) STORED;

ALTER TABLE engagement."PublicDocumentRevision"
    ADD COLUMN IF NOT EXISTS "foldedTitleVi" TEXT
    GENERATED ALWAYS AS (TRANSLATE(LOWER(COALESCE("titleVi", '')), 'áàảãạăằắẳẵặâầấẩẫậéèẻẽẹêềếểễệíìỉĩịóòỏõọôồốổỗộơờớởỡợúùủũụưừứửữựýỳỷỹỵđ', 'aaaaaaaaaaaaaaaaaeeeeeeeeeeeiiiiiooooooooooooooooouuuuuuuuuuuyyyyyd')) STORED;

ALTER TABLE engagement."PublicDocumentRevision"
    ADD COLUMN IF NOT EXISTS "foldedTitleEn" TEXT
    GENERATED ALWAYS AS (TRANSLATE(LOWER(COALESCE("titleEn", '')), 'áàảãạăằắẳẵặâầấẩẫậéèẻẽẹêềếểễệíìỉĩịóòỏõọôồốổỗộơờớởỡợúùủũụưừứửữựýỳỷỹỵđ', 'aaaaaaaaaaaaaaaaaeeeeeeeeeeeiiiiiooooooooooooooooouuuuuuuuuuuyyyyyd')) STORED;

ALTER TABLE engagement."PublicDocumentRevision"
    ADD COLUMN IF NOT EXISTS "foldedSummaryVi" TEXT
    GENERATED ALWAYS AS (TRANSLATE(LOWER(COALESCE("summaryVi", '')), 'áàảãạăằắẳẵặâầấẩẫậéèẻẽẹêềếểễệíìỉĩịóòỏõọôồốổỗộơờớởỡợúùủũụưừứửữựýỳỷỹỵđ', 'aaaaaaaaaaaaaaaaaeeeeeeeeeeeiiiiiooooooooooooooooouuuuuuuuuuuyyyyyd')) STORED;

ALTER TABLE engagement."PublicDocumentRevision"
    ADD COLUMN IF NOT EXISTS "foldedSummaryEn" TEXT
    GENERATED ALWAYS AS (TRANSLATE(LOWER(COALESCE("summaryEn", '')), 'áàảãạăằắẳẵặâầấẩẫậéèẻẽẹêềếểễệíìỉĩịóòỏõọôồốổỗộơờớởỡợúùủũụưừứửữựýỳỷỹỵđ', 'aaaaaaaaaaaaaaaaaeeeeeeeeeeeiiiiiooooooooooooooooouuuuuuuuuuuyyyyyd')) STORED;

ALTER TABLE engagement."PublicDocumentRevision"
    ADD COLUMN IF NOT EXISTS "foldedBodyVi" TEXT
    GENERATED ALWAYS AS (TRANSLATE(LOWER(COALESCE("bodyVi", '')), 'áàảãạăằắẳẵặâầấẩẫậéèẻẽẹêềếểễệíìỉĩịóòỏõọôồốổỗộơờớởỡợúùủũụưừứửữựýỳỷỹỵđ', 'aaaaaaaaaaaaaaaaaeeeeeeeeeeeiiiiiooooooooooooooooouuuuuuuuuuuyyyyyd')) STORED;

ALTER TABLE engagement."PublicDocumentRevision"
    ADD COLUMN IF NOT EXISTS "foldedBodyEn" TEXT
    GENERATED ALWAYS AS (TRANSLATE(LOWER(COALESCE("bodyEn", '')), 'áàảãạăằắẳẵặâầấẩẫậéèẻẽẹêềếểễệíìỉĩịóòỏõọôồốổỗộơờớởỡợúùủũụưừứửữựýỳỷỹỵđ', 'aaaaaaaaaaaaaaaaaeeeeeeeeeeeiiiiiooooooooooooooooouuuuuuuuuuuyyyyyd')) STORED;
