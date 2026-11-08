-- V160: align the assistant's letter-grade conversion corpus with the bands
-- the application actually assigns.
--
-- V41's curriculum-gpa-weighting-and-credit-system and V88's
-- gpa-letter-conversion-faq documented the whole 8.5-10.0 range as grade A
-- with no A+ band, while AcademicMutationService.letterGrade and
-- frontend/src/lib/grade-scale.ts assign A+ for 9.0-10.0 and A for 8.5-8.9.
-- A student with a 9.5 therefore saw A+ on the transcript while the assistant
-- quoted the older band.
--
-- Forward-only: the superseded revisions stay immutable and are archived, the
-- corrected revisions are published, and a new release is activated. The
-- affected set is captured first so the whole migration is a no-op when every
-- active public revision already carries the A+ band.

CREATE TEMP TABLE v160_affected (id UUID PRIMARY KEY, slug TEXT NOT NULL, locale TEXT NOT NULL) ON COMMIT DROP;

INSERT INTO v160_affected (id, slug, locale)
SELECT d.id, d.slug, d.locale
FROM assistant.knowledge_document d
JOIN assistant.knowledge_document_revision r
  ON r.document_id = d.id AND r.state = 'PUBLISHED'
WHERE d.active = TRUE
  AND d.visibility = 'PUBLIC'
  AND r.content LIKE '%8.5-10.0%'
  AND r.content NOT LIKE '%A+%';

-- 1. Correct the document copy, and the conversion-bearing title of the
--    curriculum document, which enumerates the same bands.
UPDATE assistant.knowledge_document
SET title = 'Cơ cấu điểm học phần, quy đổi điểm chữ A+ A B+ B C+ C D+ D F sang thang điểm 4 và cách tính GPA',
    content = 'Quy chuẩn đánh giá và tính điểm học phần theo hệ thống tín chỉ: 1. Cơ cấu điểm học phần: Điểm tổng kết học phần là điểm trung bình có trọng số gồm Điểm quá trình (chiếm 50%, bao gồm điểm danh, kiểm tra định kỳ, bài tập lớn, thuyết trình) và Điểm thi kết thúc học phần (chiếm 50%). Điểm học phần được chấm theo thang điểm 10, làm tròn đến một chữ số thập phân. 2. Quy đổi thang điểm chữ và thang điểm 4: Điểm 9.0-10.0 tương ứng loại A+ (thang 4: 4.0); 8.5-8.9 loại A (4.0); 8.0-8.4 loại B+ (3.5); 7.0-7.9 loại B (3.0); 6.5-6.9 loại C+ (2.5); 5.5-6.4 loại C (2.0); 5.0-5.4 loại D+ (1.5); 4.0-4.9 loại D (1.0); dưới 4.0 là loại F (0.0 - không đạt). 3. Điểm trung bình GPA và CPA: Điểm trung bình học kỳ (GPA) và điểm trung bình tích lũy (CPA) được tính bằng tổng tích số giữa điểm số thang 4 của từng môn với số tín chỉ của môn đó, chia cho tổng số tín chỉ đã tích lũy.'
WHERE slug = 'curriculum-gpa-weighting-and-credit-system-vi'
  AND id IN (SELECT id FROM v160_affected);

UPDATE assistant.knowledge_document
SET title = 'Course grading structure, letter grade to 4.0 scale conversion (A+ A B+ B C+ C D+ D F), and GPA calculation',
    content = 'Credit-based academic grading and GPA standards: 1. Course grading breakdown: Final course scores are computed from In-term Assessment (50%, including attendance, quizzes, assignments) and Final Exam (50%). Courses are marked on a 10-point scale rounded to one decimal place. 2. Letter grade and 4.0 conversions: 9.0-10.0 = A+ (4.0); 8.5-8.9 = A (4.0); 8.0-8.4 = B+ (3.5); 7.0-7.9 = B (3.0); 6.5-6.9 = C+ (2.5); 5.5-6.4 = C (2.0); 5.0-5.4 = D+ (1.5); 4.0-4.9 = D (1.0); below 4.0 = F (0.0 - fail). 3. GPA & CPA calculation: Semester GPA and Cumulative GPA (CPA) are computed as the sum of products of 4.0 grade points and course credits divided by total attempted credits.'
WHERE slug = 'curriculum-gpa-weighting-and-credit-system-en'
  AND id IN (SELECT id FROM v160_affected);

UPDATE assistant.knowledge_document
SET content = 'Bảng quy đổi điểm chữ sang thang điểm 4 của học phần: Điểm A+ quy đổi 4.0 (khoảng điểm 10 là 9.0-10.0); điểm A quy đổi 4.0 (8.5-8.9); điểm B+ quy đổi 3.5 (8.0-8.4); điểm B quy đổi 3.0 (7.0-7.9); điểm C+ quy đổi 2.5 (6.5-6.9); điểm C quy đổi 2.0 (5.5-6.4); điểm D+ quy đổi 1.5 (5.0-5.4); điểm D quy đổi 1.0 (4.0-4.9); điểm F quy đổi 0.0 - không đạt (dưới 4.0). Ví dụ: hỏi Điểm A mấy điểm 4 thì đáp án là 4.0. Điểm tổng kết học phần nằm trong khoảng 5.5-6.4 tương ứng điểm C và 2.0 thang 4. GPA tính bằng tổng (điểm thang 4 nhân số tín chỉ) chia tổng số tín chỉ.'
WHERE slug = 'gpa-letter-conversion-faq-vi'
  AND id IN (SELECT id FROM v160_affected);

UPDATE assistant.knowledge_document
SET content = 'Letter-to-4.0-scale conversion table for a course: grade A+ converts to 4.0 (10-point range 9.0-10.0); grade A converts to 4.0 (8.5-8.9); B+ converts to 3.5 (8.0-8.4); B converts to 3.0 (7.0-7.9); C+ converts to 2.5 (6.5-6.9); C converts to 2.0 (5.5-6.4); D+ converts to 1.5 (5.0-5.4); D converts to 1.0 (4.0-4.9); F converts to 0.0 - failed (below 4.0). Example: asked what an A is on the 4.0 scale, the answer is 4.0. GPA is the credit-weighted sum of 4.0-scale points divided by total credits.'
WHERE slug = 'gpa-letter-conversion-faq-en'
  AND id IN (SELECT id FROM v160_affected);

-- 2. Archive the superseded published revisions of exactly the affected documents.
UPDATE assistant.knowledge_document_revision r
SET state = 'ARCHIVED'
WHERE r.state = 'PUBLISHED'
  AND r.document_id IN (SELECT id FROM v160_affected);

-- 3. Publish new versioned revisions carrying the corrected content.
WITH target AS (
    SELECT d.id, d.locale, d.slug, d.title, d.source, d.priority, d.domain, d.content,
           COALESCE(MAX(r.version), 0) + 1 AS next_version
    FROM assistant.knowledge_document d
    JOIN v160_affected a ON a.id = d.id
    LEFT JOIN assistant.knowledge_document_revision r ON r.document_id = d.id
    WHERE d.active = TRUE AND d.visibility = 'PUBLIC'
    GROUP BY d.id, d.locale, d.slug, d.title, d.source, d.priority, d.domain, d.content
)
INSERT INTO assistant.knowledge_document_revision
    (id, document_id, version, state, locale, slug, title, content, source, priority,
     created_by, reviewed_by, published_at, domain)
SELECT md5(t.id::text || '-revision-' || t.next_version::text)::uuid,
       t.id, t.next_version, 'PUBLISHED', t.locale, t.slug, t.title, t.content, t.source,
       t.priority, 'system-migration', 'system-migration', CURRENT_TIMESTAMP, t.domain
FROM target t
WHERE NOT EXISTS (
    SELECT 1
    FROM assistant.knowledge_document_revision existing
    WHERE existing.document_id = t.id AND existing.version = t.next_version);

-- 4. Canonical summary and the new immutable release.
WITH canonical AS (
    SELECT d.id::text AS source_id, r.version, COALESCE(r.domain, d.domain, 'POLICY') AS domain,
           d.slug, d.locale, d.title, d.content, d.source, d.priority
    FROM assistant.knowledge_document d
    JOIN assistant.knowledge_document_revision r
      ON r.document_id = d.id
     AND r.state = 'PUBLISHED'
    WHERE d.active = TRUE
      AND d.visibility = 'PUBLIC'
), summary AS (
    SELECT encode(
               digest(
                   COALESCE(
                       string_agg(
                           concat_ws('|', source_id, domain, slug, locale, title, content, source,
                                     priority::text, version::text),
                           E'\n' ORDER BY source_id
                       ),
                       ''
                   ),
                   'sha256'
               ),
               'hex'
           ) AS corpus_hash,
           COUNT(*)::integer AS row_count,
           COALESCE(
               jsonb_agg(
                   jsonb_build_object('sourceId', source_id, 'domain', domain, 'slug', slug, 'locale', locale)
                   ORDER BY source_id
               ),
               '[]'::jsonb
           ) AS documents
    FROM canonical
)
INSERT INTO assistant.knowledge_release
    (id, corpus_version, corpus_hash, row_count, source, status, manifest, created_by, activated_at, previous_release_id)
SELECT '00000000-0000-0000-0000-000000000160'::uuid,
       'gpa-letter-band-conversion-v160', corpus_hash, row_count, 'MANUAL', 'PUBLISHED',
       jsonb_build_object(
           'schemaVersion', 1,
           'corpusVersion', 'gpa-letter-band-conversion-v160',
           'rowCount', row_count,
           'sha256', corpus_hash,
           'documents', documents
       ),
       'system-migration', CURRENT_TIMESTAMP,
       (SELECT active_release_id
        FROM assistant.knowledge_runtime_state
        WHERE singleton = TRUE)
FROM summary
WHERE EXISTS (SELECT 1 FROM v160_affected)
  AND NOT EXISTS (
      SELECT 1
      FROM assistant.knowledge_release
      WHERE id = '00000000-0000-0000-0000-000000000160'::uuid
  );

-- 5. Project every public document into the new release snapshot.
INSERT INTO assistant.knowledge_runtime_document
    (release_id, source_id, revision_id, version, domain, slug, locale, title, content, source,
     priority, active, visibility, published_at)
SELECT '00000000-0000-0000-0000-000000000160'::uuid,
       d.id::text, r.id, r.version, COALESCE(r.domain, d.domain, 'POLICY'), d.slug, d.locale,
       d.title, d.content, d.source, d.priority, TRUE, 'PUBLIC',
       COALESCE(r.published_at, CURRENT_TIMESTAMP)
FROM assistant.knowledge_document d
JOIN assistant.knowledge_document_revision r
  ON r.document_id = d.id
 AND r.state = 'PUBLISHED'
WHERE d.active = TRUE
  AND d.visibility = 'PUBLIC'
  AND EXISTS (SELECT 1 FROM v160_affected)
  AND NOT EXISTS (
      SELECT 1
      FROM assistant.knowledge_runtime_document existing
      WHERE existing.release_id = '00000000-0000-0000-0000-000000000160'::uuid
        AND existing.source_id = d.id::text
  );

-- 6. Switch the active runtime release.
INSERT INTO assistant.knowledge_runtime_state (singleton, active_release_id)
SELECT TRUE, '00000000-0000-0000-0000-000000000160'::uuid
WHERE EXISTS (SELECT 1 FROM v160_affected)
ON CONFLICT (singleton) DO UPDATE
SET active_release_id = EXCLUDED.active_release_id,
    updated_at = CURRENT_TIMESTAMP
WHERE EXISTS (SELECT 1 FROM v160_affected);
