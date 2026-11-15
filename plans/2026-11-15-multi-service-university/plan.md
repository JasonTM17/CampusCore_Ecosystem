# Plan — Kiến trúc đa dịch vụ theo mô hình trường ĐH (SIS + Registrar + Bursar)

- Date: 2026-11-15 · Owner: Nguyễn Sơn
- Mode: ak-plan --ultra (evidence packet `54b9922e`, 5 candidates, verifier chọn **C3 university-topology** nguyên vẹn)
- Candidates: `../2026-11-15-multi-service-university/candidates.md` (C0 strangler, C1 modular-monolith, C2 microservices, **C3 winner**, C4 minimal)

## Mục tiêu
Tách source theo mô hình dịch vụ của các trường ĐH thật (Banner/PeopleSoft):
**SIS core** (hồ sơ học vụ) + **Enrollment/Registrar service** (đăng ký học phần) + **Bursar service** (học phí/hóa đơn/thanh toán/financial hold) + **Notification service** + **API Gateway** + RAG sidecar hiện có — mỗi thứ là container riêng trên docker compose, push lên repo, demo vẫn chạy nguyên vẹn.

## Topology đích
```
            ┌──────────┐
   web/app →│ edge :80 │── /api/v1/me/registration*, /me/enrollments* → enrollment-api :4013
            │ (nginx)  │── /api/v1/me/bursar*                          → bursar-api     :4012
            └──────────┘── /api/*                                      → sis-core       :4010
                          (static web passthrough → frontend :3000)
```
- `sis-core` = restful-api hiện tại (auth, academic, people, thesis, engagement, events, library, careers, admissions…)
- `enrollment-api` = cùng image restful-api, profile `enrollment` — chỉ serve slice registration/enrollments (precedent: rag-service profile `persistence`)
- `bursar-api` = service Spring Boot MỚI (`java-services/bursar-api/`), schema `bursar` riêng trong cùng Postgres, Flyway riêng
- `notification-service`: giữ trong sis-core ở phase này (mail + in-app đã modular); tách riêng nếu phase sau cần
- Postgres: một instance, sở hữu theo schema (`academic` cho sis/enrollment, `bursar` cho bursar-api)

## Nguyên tắc
1. Demo không bao giờ hỏng: mỗi phase merge được, compose lên chạy được.
2. Contract qua REST nội bộ + schema ownership; KHÔNG viết chéo schema.
3. Financial hold như trường thật: sinh viên còn nợ học phí → bursar expose `me/bursar/holds`, registration chặn đăng ký/enroll hiển thị lý do.
4. Migration Flyway mới phải bump `scripts/flyway-lineage-check.test.mjs` + `docs/integrations/flyway-lineage.md` §5.2.
5. Commit chỉ `Nguyễn Sơn <jasonbmt06@gmail.com>`; PR → squash merge → xoá branch.

## Phases
| # | Phase | Kết quả nghiệm thu |
|---|-------|--------------------|
| P1 | `phase-01-gateway.md` — Edge gateway + service aliases | `localhost:8080` route đúng 3 backend; web/mobile dùng gateway; compose stack sạch |
| P2 | `phase-02-bursar.md` — bursar-api service mới | Invoice/charge/payment/hold qua `me/bursar/*`; trang `/vi/hoc-phi` hiển thị data seed; hold chặn đăng ký |
| P3 | `phase-03-enrollment.md` — enrollment-api profile container | Container `enrollment-api` serve riêng registration endpoints; gateway route đúng; E2E đăng ký qua gateway |
| P4 | `phase-04-frontend.md` — trang ĐKHPhần + Học phí chuyên nghiệp | `/vi/dang-ky-hoc-phan` (roadmap CTĐT + catalog nhóm khoa + cart) và `/vi/hoc-phi` (bảng phí, thanh toán demo, biên lai) |

## Rủi ro & giảm thiểu
- Profile-bleed: endpoint lộ sai container → allowlist route trong SecurityConfig theo profile + contract test.
- Entanglement `academic.*` giữa sis và enrollment → ở phase này enrollment vẫn cùng code/DB, chỉ tách container (không tách module) — an toàn.
- Payment demo-grade: không tích hợp cổng thật — mô hình bursar/cashier (phí theo tín chỉ × khoa, thanh toán chuyển khoản demo + biên lai), đúng thực tế nhiều trường VN.
- Hold↔registration coupling → contract nhỏ: `GET /api/v1/me/bursar/holds` trên bursar-api; sis enrollment check gọi nội bộ hoặc FE hiển thị — chọn FE-level warning + server check qua internal endpoint nếu cần.

## Out of scope (giữ feature freeze)
Không tách module Maven lớn (C1), không Kafka/service-per-DB (C2), không đụng F10/F5/F2/F4.
