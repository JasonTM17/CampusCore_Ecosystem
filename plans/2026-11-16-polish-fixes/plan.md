# Plan — Vòng fix polish sau khi merge P1–P4

Ngày: 2026-11-16 · Nền: main `a231940f` (CI 9/9 xanh, không PR mở)

## Phát hiện đã verify trong code

| # | Vấn đề | Bằng chứng |
|---|--------|-----------|
| F1 | `/vi/docs` trống: `engagement."PublicDocument"` có schema (V136) nhưng không seed nào publish doc | grep migration: 0 INSERT PublicDocument |
| F2 | `/careers` trống: `careers."Opportunity"` (V142) không có row nào (chỉ seed 2 Organization) | grep INSERT Opportunity = 0 |
| F3 | `enrolledCount` drift 18 section: `EnrolledCountReconcileJob` WARN mỗi giờ, `repair=false` mặc định → demo cứ drift mãi | `EnrolledCountReconcileJob.java` |
| F4 | Lecturer vào `/vi/dashboard` bắn `/me/registration/summary` → 403 rác console: `summaryQuery` dùng `canLoad` (csrf hint) thay vì chờ role resolve | `dashboard/page.tsx` ~line 178 |
| F5 | `/vi/staff` thiếu desk `events`: `STAFF_DESKS` chỉ có admissions/careers/library dù `/api/v1/events/staff/grants` đã tồn tại → account `events.staff@` vào /staff thấy trống | `staff-desks.ts`, `EventStaffController.java:180` |
| F6 | Zero-desk state dùng `WorkspaceForbiddenState` — sinh viên bấm /staff thấy trang "bị cấm" thay vì "bạn không có bàn làm việc" | `StaffDesksPage.tsx:95` |
| F7 | Mobile assistant: toolbar (title + scope tabs + history) nằm TRONG `FlatList.header` → thread dài cuộn mất | `AssistantScreen.tsx:66-88` |
| F8 | DEMO_RUNBOOK chưa ghi: `rag-service` dùng chung Dockerfile restful-api → đổi code assistant phải rebuild CẢ HAI (đã từng bị bug vì quên) | incident đã xảy ra |
| F9 | Chatbot provider (DeepSeek) tắt → mọi câu trả lời lexical. Cần `DEEPSEEK_API_KEY` — chờ user | `.env` DEEPSEEK_ENABLED=false |
| F10 | Mobile dev warning require cycle `Ui.tsx ↔ performance-list.tsx` | Metro warning |

## Không làm (ghi rõ)

- SSO mobile: giới hạn Expo Go, đã ghi runbook.
- E2E stack ECONNREFUSED bursar:4012: noise server-side vô hại, test vẫn pass.
- Feature freeze F10/F5/F2/F4 giữ nguyên.

## Phases

### Phase A — Data & config (1 migration + compose + docs)
1. **V167** `demo_content_public_docs_and_careers.sql`:
   - 3 `PublicDocument` PUBLISHED (Quy chế đào tạo tín chỉ, Hướng dẫn đăng ký học phần, Quy định học phí & miễn giảm) + `PublicDocumentRevision` PUBLISHED (vi+en) + audit rows; author = admin seed, reviewer khác author (4-eyes đúng).
   - 3 `careers."Opportunity"` PUBLISHED thuộc 2 Organization đã seed (CTV thư viện, TTS phát triển phần mềm, Trợ giảng khoa CNTT) + deadline tương lai.
   - Bump `flyway-lineage-check` + `docs/integrations/flyway-lineage.md` §5.2 (164 files, V1..V167).
2. `docker-compose.local.yml` + `docker-compose.yml`: `ACADEMIC_ENROLLEDCOUNT_REPAIR: "true"` trên restful-api/enrollment-api → job tự vá drift sau 1 chu kỳ.
3. `docs/DEMO_RUNBOOK.md`: note rag-service = cùng image restful-api → `docker compose build restful-api rag-service` khi đổi assistant.

### Phase B — Web UX
4. `dashboard/page.tsx`: `summaryQuery` enabled `canLoad && (authLoading || hasAccess)`; grep các trang khác dùng `canLoad` vá cùng pattern nếu có.
5. `staff-desks.ts`: thêm `{ key:'events', href:'/dashboard/events', grantsPath:'/events/staff/grants' }`; `StaffDeskKey` + `DESK_ICONS` + copy vi/en; `StaffDesksPage` zero-desk → `EmptyState` "không có bàn làm việc" thay ForbiddenState.
6. i18n messages cho desk events.

### Phase C — Mobile polish
7. `AssistantScreen.tsx`: tách title/toolbar/scope/notice ra khỏi `FlatList.header` → render block cố định trên list (scope luôn thấy).
8. Require cycle `Ui.tsx ↔ performance-list.tsx`: tách import vòng (di chuyển type/helper sang file trung lập).

### Phase D — Verify & ship
9. Local stack: docs/careers/staff/lecturer-dashboard verify tay + `npm test`, tsc, eslint, mobile jest; spec e2e liên quan.
10. Một PR `fix(polish)` → CI xanh → Devin Review triage → squash-merge theo flow user.

## Rủi ro
- Seed PublicDocument phải khớp contract `publication-policy.md` (revision state, authorId≠reviewerId) — đọc kỹ V136 + service trước khi viết.
- Staff desk probe `/events/staff/grants` phải trả 200 có grant / 403 không — verify bằng curl trước khi thêm vào registry.
- `canLoad` fix không được làm chậm waterfall student — giữ early-fire khi `authLoading`.
