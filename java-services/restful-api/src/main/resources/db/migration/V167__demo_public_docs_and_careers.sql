-- Demo content seed: published public documents (/docs) and careers
-- opportunities (/careers) so a docker-pulled stack shows a working portal
-- instead of two empty boards.
--
-- demo-data-policy: rows are synthetic demo content marked by stable ids
-- (doc-demo-*, opp-demo-*) and guarded by WHERE NOT EXISTS so the migration
-- is idempotent on pre-seeded databases. Authority assignments are still
-- never seeded here (V142 convention) — publishedAt/reviewedBy on these rows
-- describe already-completed review, not grant issuance.
--
-- Reviewer binding (publication-policy): every PUBLISHED revision carries
-- reviewerId != authorId, so the four-eyes trail reads correctly in the
-- staff audit surfaces.

-- ---------------------------------------------------------------------------
-- 1. Public documents — three canonical student-facing documents
-- ---------------------------------------------------------------------------
INSERT INTO engagement."PublicDocument"
    ("id", "slug", "status", "authorId", "currentRevision", "publishedRevision",
     "categoryId", "createdAt", "updatedAt")
SELECT 'doc-demo-quy-che-dao-tao', 'quy-che-dao-tao-tin-chi', 'PUBLISHED',
       'admin-user', 1, 1, 'cat-academic-affairs',
       '2026-08-20T09:00:00Z', '2026-08-21T10:00:00Z'
WHERE NOT EXISTS (SELECT 1 FROM engagement."PublicDocument"
                  WHERE "id" = 'doc-demo-quy-che-dao-tao');

INSERT INTO engagement."PublicDocument"
    ("id", "slug", "status", "authorId", "currentRevision", "publishedRevision",
     "categoryId", "createdAt", "updatedAt")
SELECT 'doc-demo-huong-dan-dkhp', 'huong-dan-dang-ky-hoc-phan', 'PUBLISHED',
       'admin-user', 1, 1, 'cat-academic-affairs',
       '2026-08-25T09:00:00Z', '2026-08-26T10:00:00Z'
WHERE NOT EXISTS (SELECT 1 FROM engagement."PublicDocument"
                  WHERE "id" = 'doc-demo-huong-dan-dkhp');

INSERT INTO engagement."PublicDocument"
    ("id", "slug", "status", "authorId", "currentRevision", "publishedRevision",
     "categoryId", "createdAt", "updatedAt")
SELECT 'doc-demo-hoc-phi', 'quy-dinh-hoc-phi-mien-giam', 'PUBLISHED',
       'admin-user', 1, 1, 'cat-student-life',
       '2026-09-01T09:00:00Z', '2026-09-02T10:00:00Z'
WHERE NOT EXISTS (SELECT 1 FROM engagement."PublicDocument"
                  WHERE "id" = 'doc-demo-hoc-phi');

INSERT INTO engagement."PublicDocumentRevision"
    ("documentId", "revision", "state", "titleVi", "titleEn",
     "summaryVi", "summaryEn", "bodyVi", "bodyEn",
     "authorId", "reviewerId", "reviewedAt", "reviewNote", "createdAt")
SELECT 'doc-demo-quy-che-dao-tao', 1, 'PUBLISHED',
       'Quy chế đào tạo theo học chế tín chỉ',
       'Credit-based training regulations',
       'Khung quy chế đào tạo áp dụng cho khóa tuyển 2026: tín chỉ, điểm chữ, điều kiện tốt nghiệp.',
       'Credit-system training framework for the 2026 cohort: credits, letter grades, graduation requirements.',
       '<h2>Điều 1. Phạm vi áp dụng</h2><p>Quy chế này áp dụng cho sinh viên hệ đại học chính quy của trường học theo học chế tín chỉ kể từ khóa tuyển 2026.</p><h2>Điều 2. Tín chỉ và khối lượng học tập</h2><p>Một tín chỉ lý thuyết tương đương 15 tiết; một tín chỉ thực hành, thí nghiệm hoặc đồ án tương đương 30 tiết. Mỗi học kỳ chính sinh viên đăng ký từ 12 đến 24 tín chỉ; trường hợp đặc biệt phải có đơn xin vượt hạn mức được phê duyệt.</p><h2>Điều 3. Đánh giá và điểm chữ</h2><p>Kết quả học phần được đánh giá theo thang chữ A, B+, B, C+, C, D+, D, F. Điểm trung bình học kỳ và tích lũy tính theo thang 4.0. Môn đạt điểm F phải đăng ký học lại; kết quả cuối cùng lấy điểm cao nhất (chính sách best-attempt).</p><h2>Điều 4. Điều kiện tốt nghiệp</h2><p>Sinh viên tốt nghiệp khi tích lũy đủ số tín chỉ của chương trình đào tạo, điểm trung bình tích lũy từ 2.0 trở lên, hoàn thành khóa luận hoặc đồ án tốt nghiệp và không còn nợ học phí.</p>',
       '<h2>Article 1. Scope</h2><p>These regulations apply to full-time undergraduate students on the credit system from the 2026 intake onward.</p><h2>Article 2. Credits and workload</h2><p>One theory credit equals 15 periods; one practical, laboratory, or project credit equals 30 periods. Students register for 12 to 24 credits per main semester; exceeding the cap requires an approved credit-limit application.</p><h2>Article 3. Assessment and letter grades</h2><p>Courses are graded on the letter scale A, B+, B, C+, C, D+, D, F, and term and cumulative GPAs use the 4.0 scale. An F requires a retake; the best attempt counts (best-attempt policy).</p><h2>Article 4. Graduation requirements</h2><p>Students graduate once they accumulate the programme credit total, hold a cumulative GPA of at least 2.0, complete the thesis or capstone, and have no outstanding tuition balance.</p>',
       'admin-user', 'lecturer-user', '2026-08-21T10:00:00Z',
       'Nội dung khớp thông báo đào tạo số 12/2026.', '2026-08-20T09:00:00Z'
WHERE NOT EXISTS (SELECT 1 FROM engagement."PublicDocumentRevision"
                  WHERE "documentId" = 'doc-demo-quy-che-dao-tao' AND "revision" = 1);

INSERT INTO engagement."PublicDocumentRevision"
    ("documentId", "revision", "state", "titleVi", "titleEn",
     "summaryVi", "summaryEn", "bodyVi", "bodyEn",
     "authorId", "reviewerId", "reviewedAt", "reviewNote", "createdAt")
SELECT 'doc-demo-huong-dan-dkhp', 1, 'PUBLISHED',
       'Hướng dẫn đăng ký học phần trên cổng sinh viên',
       'Course registration guide on the student portal',
       'Các bước tra cứu lộ trình CTĐT, chọn lớp học phần, kiểm tra xung đột lịch và xác nhận đăng ký.',
       'How to browse the curriculum roadmap, pick class sections, check timetable conflicts, and confirm registration.',
       '<h2>Bước 1. Kiểm tra đợt đăng ký</h2><p>Mở trang <strong>Đăng ký học phần</strong> trong thời gian đợt đăng ký mở. Hệ thống hiển thị hạn mức tín chỉ, số tín chỉ đã dùng và đếm ngược thời hạn.</p><h2>Bước 2. Xem lộ trình chương trình đào tạo</h2><p>Cột bên trái liệt kê các môn theo năm học và học kỳ: màu xanh là môn đã đạt, màu vàng là môn đang học, màu xám là môn chưa đủ điều kiện (thiếu tiên quyết).</p><h2>Bước 3. Chọn lớp học phần</h2><p>Dùng bộ lọc theo khoa, chế độ "Môn trong CTĐT", "Chưa học" hoặc "Học lại". Nhấn <strong>Đăng ký</strong> trên nhóm môn còn chỗ; hệ thống tự kiểm tra trùng lịch, tiên quyết và hạn mức.</p><h2>Bước 4. Kiểm tra giỏ và thời khóa biểu</h2><p>Panel bên phải hiển thị lớp đã đăng ký, lưới TKB tuần và cảnh báo xung đột. Môn hết chỗ có thể thêm vào <strong>Nguyện vọng</strong> để nhận thông báo khi mở nhóm mới.</p>',
       '<h2>Step 1. Check the registration window</h2><p>Open the <strong>Course registration</strong> page while a round is open. The page shows your credit cap, credits used, and the remaining window.</p><h2>Step 2. Review the curriculum roadmap</h2><p>The left rail lists courses by year and semester: green means passed, amber in progress, grey locked by unmet prerequisites.</p><h2>Step 3. Pick a class section</h2><p>Filter by department or use the "In curriculum", "Not taken", or "Retake" modes. Press <strong>Register</strong> on a section with open seats; the system checks conflicts, prerequisites, and the credit cap.</p><h2>Step 4. Review the cart and timetable</h2><p>The right panel shows registered sections, the weekly grid, and conflict warnings. Full courses can go on the <strong>Wishlist</strong> for a notification when a new section opens.</p>',
       'admin-user', 'lecturer-user', '2026-08-26T10:00:00Z',
       'Khớp flow workspace đăng ký mới.', '2026-08-25T09:00:00Z'
WHERE NOT EXISTS (SELECT 1 FROM engagement."PublicDocumentRevision"
                  WHERE "documentId" = 'doc-demo-huong-dan-dkhp' AND "revision" = 1);

INSERT INTO engagement."PublicDocumentRevision"
    ("documentId", "revision", "state", "titleVi", "titleEn",
     "summaryVi", "summaryEn", "bodyVi", "bodyEn",
     "authorId", "reviewerId", "reviewedAt", "reviewNote", "createdAt")
SELECT 'doc-demo-hoc-phi', 1, 'PUBLISHED',
       'Quy định học phí, miễn giảm và thời hạn thanh toán',
       'Tuition, waivers, and payment deadlines',
       'Cách tính học phí theo tín chỉ, mốc đóng phí, diện miễn giảm và chế tài khi quá hạn.',
       'How tuition is computed per credit, payment deadlines, waiver categories, and late-payment holds.',
       '<h2>1. Cách tính học phí</h2><p>Học phí tính theo số tín chỉ đăng ký nhân đơn giá của khoa quản lý học phần. Hoá đơn được phát hành sau khi đợt đăng ký chính thức kết thúc.</p><h2>2. Thời hạn thanh toán</h2><p>Sinh viên thanh toán trong vòng 15 ngày kể từ ngày phát hành hoá đơn. Quá hạn, hệ thống đặt <strong>hold học phí</strong>: tạm chặn đăng ký học phần và xem bảng điểm cho tới khi hoàn tất công nợ.</p><h2>3. Miễn giảm</h2><p>Diện chính sách (con thương binh, hộ nghèo, khuyết tật) nộp hồ sơ tại Phòng Tài chính trước kỳ đầu năm học; mức giảm 50–100% tuỳ diện.</p><h2>4. Tra cứu và thanh toán</h2><p>Trang <strong>Học phí</strong> trên cổng sinh viên hiển thị số dư, hoá đơn từng kỳ và trạng thái hold; thanh toán trực tuyến hoặc chuyển khoản ghi mã hoá đơn.</p>',
       '<h2>1. How tuition is computed</h2><p>Tuition equals registered credits times the per-credit rate of the faculty owning the course. Invoices are issued after the main registration round closes.</p><h2>2. Payment deadline</h2><p>Payment is due within 15 days of invoice issue. Overdue accounts receive a <strong>tuition hold</strong> that blocks course registration and grade viewing until the balance clears.</p><h2>3. Waivers</h2><p>Policy categories (children of war invalids, poor households, disabilities) submit dossiers to the Bursar office before the first term; waivers cover 50–100%.</p><h2>4. Lookup and payment</h2><p>The portal <strong>Tuition</strong> page shows the balance, per-term invoices, and hold status; pay online or by transfer quoting the invoice code.</p>',
       'admin-user', 'lecturer-user', '2026-09-02T10:00:00Z',
       'Khớp cấu hình bursar-api mới.', '2026-09-01T09:00:00Z'
WHERE NOT EXISTS (SELECT 1 FROM engagement."PublicDocumentRevision"
                  WHERE "documentId" = 'doc-demo-hoc-phi' AND "revision" = 1);

-- Audit trail: CREATED → SUBMITTED → APPROVED per document (4-eyes reads).
INSERT INTO engagement."PublicDocumentAudit"
    ("id", "documentId", "action", "actorId", "actorLabel", "reason", "version", "createdAt")
SELECT 'audit-' || d."id" || '-created', d."id", 'CREATED', 'admin-user',
       'System Administrator', '', 1, d."createdAt"
FROM engagement."PublicDocument" d
WHERE d."id" IN ('doc-demo-quy-che-dao-tao', 'doc-demo-huong-dan-dkhp', 'doc-demo-hoc-phi')
  AND NOT EXISTS (SELECT 1 FROM engagement."PublicDocumentAudit" a
                  WHERE a."id" = 'audit-' || d."id" || '-created');

INSERT INTO engagement."PublicDocumentAudit"
    ("id", "documentId", "action", "actorId", "actorLabel", "reason", "version", "createdAt")
SELECT 'audit-' || d."id" || '-submitted', d."id", 'SUBMITTED', 'admin-user',
       'System Administrator', 'Gửi duyệt bản đầu tiên.', 1,
       d."createdAt" + interval '4 hours'
FROM engagement."PublicDocument" d
WHERE d."id" IN ('doc-demo-quy-che-dao-tao', 'doc-demo-huong-dan-dkhp', 'doc-demo-hoc-phi')
  AND NOT EXISTS (SELECT 1 FROM engagement."PublicDocumentAudit" a
                  WHERE a."id" = 'audit-' || d."id" || '-submitted');

INSERT INTO engagement."PublicDocumentAudit"
    ("id", "documentId", "action", "actorId", "actorLabel", "reason", "version", "createdAt")
SELECT 'audit-' || d."id" || '-approved', d."id", 'APPROVED', 'lecturer-user',
       'Demo Lecturer', 'Đã rà soát nội dung.', 1, d."updatedAt"
FROM engagement."PublicDocument" d
WHERE d."id" IN ('doc-demo-quy-che-dao-tao', 'doc-demo-huong-dan-dkhp', 'doc-demo-hoc-phi')
  AND NOT EXISTS (SELECT 1 FROM engagement."PublicDocumentAudit" a
                  WHERE a."id" = 'audit-' || d."id" || '-approved');

-- ---------------------------------------------------------------------------
-- 2. Careers opportunities — three published postings on the two demo orgs
-- ---------------------------------------------------------------------------
INSERT INTO careers."Opportunity"
    ("id", "organizationId", "title", "description", "location",
     "employmentType", "salaryText", "status", "submittedBy",
     "reviewedBy", "reviewedAt", "publishedAt", "createdAt", "updatedAt")
SELECT 'opp-demo-library-ctv', 'org-alpha-demo',
       'Cộng tác viên Thư viện số (bán thời gian)',
       '<p>Hỗ trợ số hóa tài liệu, gán metadata và hướng dẫn sinh viên tra cứu trên hệ thống thư viện số của trường.</p><ul><li>Sinh viên năm 2 trở lên, ưu tiên khoa Thông tin - Thư viện.</li><li>Làm việc 8–12 giờ/tuần, linh hoạt theo TKB.</li></ul>',
       'Thư viện trường, cơ sở 1', 'PART_TIME', '28.000 VND/giờ',
       'PUBLISHED', 'admin-user', 'lecturer-user',
       '2026-09-05T10:00:00Z', '2026-09-05T14:00:00Z',
       '2026-09-04T09:00:00Z', '2026-09-05T14:00:00Z'
WHERE NOT EXISTS (SELECT 1 FROM careers."Opportunity"
                  WHERE "id" = 'opp-demo-library-ctv');

INSERT INTO careers."Opportunity"
    ("id", "organizationId", "title", "description", "location",
     "employmentType", "salaryText", "status", "submittedBy",
     "reviewedBy", "reviewedAt", "publishedAt", "createdAt", "updatedAt")
SELECT 'opp-demo-teaching-assistant', 'org-alpha-demo',
       'Trợ giảng lập trình — Khoa Công nghệ Thông tin',
       '<p>Trợ giảng cho các lớp Nhập môn lập trình và Cấu trúc dữ liệu: chấm bài tập, hướng dẫn lab, giải đáp trên diễn đàn môn học.</p><ul><li>Sinh viên năm 3–4 ngành CNTT, GPA ≥ 3.2.</li><li>Thành thạo Java hoặc Python.</li></ul>',
       'Khoa CNTT, tòa B', 'PART_TIME', '35.000 VND/giờ',
       'PUBLISHED', 'admin-user', 'lecturer-user',
       '2026-09-06T10:00:00Z', '2026-09-06T14:00:00Z',
       '2026-09-05T09:00:00Z', '2026-09-06T14:00:00Z'
WHERE NOT EXISTS (SELECT 1 FROM careers."Opportunity"
                  WHERE "id" = 'opp-demo-teaching-assistant');

INSERT INTO careers."Opportunity"
    ("id", "organizationId", "title", "description", "location",
     "employmentType", "salaryText", "status", "submittedBy",
     "reviewedBy", "reviewedAt", "publishedAt", "createdAt", "updatedAt")
SELECT 'opp-demo-software-intern', 'org-beta-demo',
       'Thực tập sinh Phát triển phần mềm (Java/React)',
       '<p>Tham gia team phát triển ứng dụng quản lý đào tạo cho các trường ĐH: viết API Spring Boot, giao diện React, test end-to-end.</p><ul><li>Thực tập 3–6 tháng, mentor kèm 1-1.</li><li>Cơ hội ký HĐ chính thức sau thực tập.</li></ul>',
       'Quận Thủ Đức, TP.HCM (hybrid)', 'INTERNSHIP', '4.000.000 VND/tháng',
       'PUBLISHED', 'admin-user', 'lecturer-user',
       '2026-09-08T10:00:00Z', '2026-09-08T14:00:00Z',
       '2026-09-07T09:00:00Z', '2026-09-08T14:00:00Z'
WHERE NOT EXISTS (SELECT 1 FROM careers."Opportunity"
                  WHERE "id" = 'opp-demo-software-intern');
