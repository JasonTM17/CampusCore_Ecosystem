-- Demo seed: fee rates, one paid invoice for the primary demo student, and one
-- partially-paid invoice with an ACTIVE financial hold — the showcase case for
-- tuition-hold registration blocking (P3).
-- student_id always stores the academic."Student" primary key — the same value
-- the IdentityTokenCustomizer writes into the JWT `studentId` claim.

INSERT INTO bursar.fee_rate ("id", academic_year, department_code, price_per_credit, effective_from)
VALUES
    ('rate-2526-default', '2025-2026', NULL,   980000, DATE '2025-08-01'),
    ('rate-2526-cntt',    '2025-2026', 'CNTT', 1050000, DATE '2025-08-01'),
    ('rate-2526-ck',      '2025-2026', 'CK',    950000, DATE '2025-08-01')
ON CONFLICT ("id") DO NOTHING;

-- Paid invoice for the primary demo student (student@campuscore.edu) so their
-- wallet shows a realistic, fully settled term bill.
INSERT INTO bursar.student_account ("id", student_id, "balance")
SELECT 'acct-' || s."id", s."id", 0
FROM academic."Student" s
WHERE s."id" IN (
    SELECT st."id" FROM academic."Student" st
    JOIN campuscore_auth."User" u ON u."id" = st."userId"
    WHERE u."email" IN ('student@campuscore.edu', 'phuong.ttm@campuscore.demo')
)
ON CONFLICT (student_id) DO NOTHING;

INSERT INTO bursar.invoice ("id", student_id, "term", "status", "total", issued_at, due_at, paid_at)
SELECT 'inv-2526-paid-student', s."id", 'HK1-2025-2026', 'PAID', 18620000,
       TIMESTAMPTZ '2025-08-15 09:00:00+00', TIMESTAMPTZ '2025-09-15 23:59:59+00',
       TIMESTAMPTZ '2025-09-01 10:24:00+00'
FROM academic."Student" s
JOIN campuscore_auth."User" u ON u."id" = s."userId"
WHERE u."email" = 'student@campuscore.edu'
ON CONFLICT ("id") DO NOTHING;

INSERT INTO bursar.invoice_item ("id", invoice_id, "label", course_code, "credits", unit_price, "amount")
VALUES
    ('item-paid-1', 'inv-2526-paid-student', 'Học phí tín chỉ HK1 (19 TC × 980.000)', NULL, 19, 980000, 18620000)
ON CONFLICT ("id") DO NOTHING;

INSERT INTO bursar.payment ("id", invoice_id, idempotency_key, "amount", "method", "reference", "status", paid_at)
VALUES ('pay-seed-1', 'inv-2526-paid-student', 'seed-paid-student', 18620000, 'BANK_TRANSFER',
        'FT25241001', 'COMPLETED', TIMESTAMPTZ '2025-09-01 10:24:00+00')
ON CONFLICT ("id") DO NOTHING;

-- Debt student: PARTIAL invoice + ACTIVE hold.
INSERT INTO bursar.invoice ("id", student_id, "term", "status", "total", issued_at, due_at)
SELECT 'inv-2526-debt', s."id", 'HK1-2025-2026', 'PARTIAL', 15000000,
       TIMESTAMPTZ '2025-08-15 09:00:00+00', TIMESTAMPTZ '2025-10-15 23:59:59+00'
FROM academic."Student" s
JOIN campuscore_auth."User" u ON u."id" = s."userId"
WHERE u."email" = 'phuong.ttm@campuscore.demo'
ON CONFLICT ("id") DO NOTHING;

INSERT INTO bursar.invoice_item ("id", invoice_id, "label", course_code, "credits", unit_price, "amount")
VALUES ('item-debt-1', 'inv-2526-debt', 'Học phí tín chỉ HK1 (15 TC × 1.000.000)', NULL, 15, 1000000, 15000000)
ON CONFLICT ("id") DO NOTHING;

INSERT INTO bursar.payment ("id", invoice_id, idempotency_key, "amount", "method", "reference", "status", paid_at)
VALUES ('pay-seed-2', 'inv-2526-debt', 'seed-debt-partial', 5000000, 'BANK_TRANSFER',
        'FT25241088', 'COMPLETED', TIMESTAMPTZ '2025-09-20 14:05:00+00')
ON CONFLICT ("id") DO NOTHING;

INSERT INTO bursar.financial_hold ("id", student_id, "reason", "status")
SELECT 'hold-debt-1', s."id",
       'Nợ học phí HK1-2025-2026 — vui lòng hoàn tất thanh toán trước khi đăng ký học phần.',
       'ACTIVE'
FROM academic."Student" s
JOIN campuscore_auth."User" u ON u."id" = s."userId"
WHERE u."email" = 'phuong.ttm@campuscore.demo'
ON CONFLICT ("id") DO NOTHING;

UPDATE bursar.student_account sa
SET "balance" = 10000000, updated_at = now()
WHERE sa.student_id = (
    SELECT st."id" FROM academic."Student" st
    JOIN campuscore_auth."User" u ON u."id" = st."userId"
    WHERE u."email" = 'phuong.ttm@campuscore.demo'
);
