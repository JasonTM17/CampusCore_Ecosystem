# Phase 2 — bursar-api (Phòng Tài chính / học phí)

## Mục tiêu
Service Spring Boot mới `java-services/bursar-api/` = "phòng kế toán" của trường: đánh giá học phí theo tín chỉ, hóa đơn, thanh toán demo, financial hold.

## Data model (schema `bursar`, Flyway riêng `bursar/migration/B*.sql`)
- `bursar."FeeRate"`: academicYearId, departmentId (nullable = mặc định), pricePerCredit VND.
- `bursar."StudentAccount"`: studentId (FK logic → academic), balance, holdFlag.
- `bursar."Invoice"`: studentId, term (semesterId), status DRAFT/ISSUED/PARTIAL/PAID/CANCELLED, issuedAt, dueAt, total.
- `bursar."InvoiceItem"`: invoiceId, courseId/sectionId, credits, unitPrice, label.
- `bursar."Payment"`: invoiceId, amount, method BANK_TRANSFER/CASH/MOCK_GATEWAY, reference, status, paidAt; idempotency key.
- Seed demo: fee rate mặc định + 2 khoa; invoice kỳ hiện tại cho student demo (PARTIAL — còn nợ → hold mẫu cho 1 account phụ, student@ trả hết để không block demo chính… hoặc giữ student@ nợ nhẹ nhưng hold chỉ WARN — chọn: hold thật cho `student-debt@campuscore.demo` account mới để demo chặn đăng ký).

## Endpoints (JWT cùng issuer — verify bằng public key/shared secret cơ chế hiện có của restful-api; nếu phức tạp: forward-auth qua sis-core internal `/internal/me` — quyết định khi implement, ưu tiên verify JWT trực tiếp)
- `GET /api/v1/me/bursar/account` — số dư, hold.
- `GET /api/v1/me/bursar/invoices`, `/invoices/{id}` — hoá đơn + items.
- `POST /api/v1/me/bursar/invoices/{id}/payments` — thanh toán demo (idempotent) → Payment + cập nhật Invoice/Account.
- `GET /api/v1/me/bursar/holds` — danh sách hold active.
- Internal: `GET /internal/bursar/holds/{studentId}` (token nội bộ như pattern `X-Rag-Service-Token`) để sis-core kiểm tra.

## Nghiệm thu
- Container `bursar-api` :4012 trong compose; `curl localhost:8080/api/v1/me/bursar/invoices` với token student = danh sách hoá đơn thật.
- POST payment demo → invoice PAID, account giảm nợ; replay idempotency-key không tạo payment trùng.
- Account `student-debt@` có hold; sis-core gọi được `/internal/bursar/holds/{id}`.
- Flyway lineage bumped; tests mvn cho bursar-api trong CI.
