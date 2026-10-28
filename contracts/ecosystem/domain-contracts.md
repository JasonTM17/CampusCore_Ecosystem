# Domain contracts — DTO/state/error/RBAC/idempotency

Pha: P03 step 1 · Owner: controller · Review: Kongming + tester contract
Nguồn state machine: `plans/261021-2123-campusute-ecosystem/selected-design.md`
(các excerpt P04–P12) + enum EXISTING trong `java-services/restful-api`.

Consumer không tự định nghĩa dữ liệu hay quyền: mọi app (web/mobile/BFF) dùng
contract trong file này và types sinh từ `openapi.json`. Khi spec dưới đây khác
code hiện hữu, đó là PROPOSED và phase sở hữu domain đó phải implement + test.

## 1. Quy ước chung

### 1.1 Error envelope (EXISTING, giữ nguyên)

Mọi lỗi trả về `ErrorResponse` qua `GlobalExceptionHandler`/`ApiExceptionHandler`:

| HTTP | `code` (quy ước) | Khi nào |
| --- | --- | --- |
| 400 | `VALIDATION_FAILED`, `BAD_REQUEST` | Field error có `fields{}`; body lỗi cú pháp |
| 401 | `UNAUTHENTICATED` | Thiếu/hết phiên; không kèm thông tin tài khoản |
| 403 | `FORBIDDEN`, `ACCOUNT_DISABLED` | Đăng nhập rồi nhưng thiếu object scope/role |
| 404 | `NOT_FOUND` | Tài nguyên không tồn tại hoặc không thuộc scope caller |
| 409 | `CONFLICT`, `STALE_VERSION`, `DUPLICATE_ACTIVE` | Optimistic version/idempotency/state conflict |
| 410 | `GONE` | Tài nguyên đã chuyển trạng thái terminal hủy |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | Upload sai content-type |
| 429 | `RATE_LIMITED` | Lockout/throttle (identity, registration, apply) |
| 5xx | `INTERNAL`, `UPSTREAM_UNAVAILABLE` | Không lộ stack/credential trong `message` |

Quy tắc: `message` hiển thị được cho người dùng, không chứa internal id,
stack trace, tên cột, hay credential. Lỗi deny vì object-scope trả 404 (không
tiết lộ tồn tại) trừ khi spec ghi 403 rõ ràng.

### 1.2 RBAC notation

| Ký hiệu | Nghĩa |
| --- | --- |
| `ANON` | Chưa đăng nhập |
| `SELF` | Chủ tài nguyên (student/applicant/candidate sở hữu record) |
| `STAFF:<scope>` | Staff có grant trong đúng scope (`events`, `library`, `careers:<org>`, `admissions`, `content`) |
| `LECT:<section>` | Lecturer được gán section đó (academic authority) |
| `ADMIN` | Admin hệ thống — quản trị quyền, không suy ra quyền domain |
| `SYS` | Job/transition do server thực hiện (không phải HTTP actor) |

Mọi write đều kiểm **object scope ở service/repository**, không chỉ route guard
(Native/web object-scope acceptance trong selected-design §4). Role mới của
domain (event staff, recruiter, librarian, admissions reviewer…) là **domain
grant do admin được phép cấp** — recruiter/applicant không suy ra student/admin.

### 1.3 Idempotency

| Nơi | Quy ước |
| --- | --- |
| Mutation tạo-tài-nguyên client-init (register event, borrow request, apply, submit) | Client gửi `Idempotency-Key` (UUID); server unique trên `(actor, key)`; replay trả response lần đầu, không tạo bản ghi thứ hai |
| Transition đã-terminal | Trả 409 `CONFLICT` kèm trạng thái hiện tại; retry an toàn |
| Optimistic version | Record có `version`; write kèm `If-Match`/field version; stale → 409 `STALE_VERSION` |
| Retry nội bộ (notification, sync) | Job unique trên `(aggregate, event)`; chạy lại không nhân đôi |
| Auth/session | Rotation + replay revocation theo ADR-B; không tồn tại "refresh lặp" hợp lệ |

### 1.4 Acceptance id

`<DOMAIN>-T<nn>` cho transition; `<DOMAIN>-X<nn>` cho invariant/negative.
Phase sở hữu map id → test name trong gate của nó. Id không đổi khi đổi impl.

## 2. Schema owner / FK boundary (ADR-C)

Một PostgreSQL, Flyway là authority duy nhất. `campuscore_auth` sở hữu
account/session/credential — domain khác **không ghi** vào. Học vụ hiện hữu
(Student/User/Enrollment/Section/Grade) là academic authority — domain mới
**đọc qua service/repository được cấp**, không sao chép bảng.

| Schema/owner | Bảng chủ | Được phép ghi | FK sang authority |
| --- | --- | --- | --- |
| `campuscore_auth` (EXISTING) | user, session, credential, grant | auth services only | — |
| academic (EXISTING) | student, section, enrollment, grade, conduct | academic services only | user → auth |
| thesis (EXISTING) | round, topic, group, report, council | thesis services | user/section |
| engagement (EXISTING→P06) | announcement, article, taxonomy, media | engagement services | user |
| `notification` (EXISTING) | notification, delivery | notification service cùng transaction với domain gốc | user |
| `assistant` (EXISTING, RLS) | conversation, turn, knowledge, scope | assistant services | user (RLS-bound) |
| `events` (PROPOSED P08) | event, registration, attendance | events services | user; KHÔNG ghi conduct |
| `learning` (PROPOSED P09) | course material, assignment, submission, feedback | learning services | section/enrollment read-through |
| `admissions` (PROPOSED P10) | application, attachment, review | admissions services | user (applicant account) |
| `library` (PROPOSED P11) | title, copy, loan_request, loan | library services | user |
| `careers` (PROPOSED P12) | organization, opportunity, application | careers services | user + org membership |

Forbidden write toàn cục: cross-schema direct write, sửa row authority
(enrollment, grade, credential) từ domain service, ghi `conduct_semester_score`
từ events, nhập private RAG knowledge vào public read model.

Migration sequence cho mọi domain mới (ADR-C): **expand → backfill kiểm đếm →
switch reader/writer → contract sau cửa sổ phục hồi**. Alloc version V lúc
implement sau khi kiểm tra danh sách migration hiện có; không giữ số cố định.

## 3. Identity / session (P04–P05, authority `campuscore_auth`)

State machine phiên EXISTING + PROPOSED OIDC:

| Id | Transition | Actor | Precondition | Forbidden write |
| --- | --- | --- | --- | --- |
| SES-T01 | `authorize` → auth-code issued | BFF (`SYS`) | Registered client, exact redirect_uri, PKCE+state+nonce | Code không gắn verifier/nonce |
| SES-T02 | auth-code → tokens/session | BFF (`SYS`) | Code một lần, chưa dùng, đúng client+redirect | Đổi code đã dùng; reuse code |
| SES-T03 | access refresh → rotated refresh | `SELF` qua BFF | Refresh hiện tại hợp lệ, session active | Giữ refresh cũ sau rotate |
| SES-T04 | refresh replay detected → revoke account-wide | `SYS` | Replay token đã rotated | Cho phép bất kỳ phiên nào sống lại |
| SES-T05 | logout → session revoked | `SELF` | Idempotent: logout hai lần vẫn 200 | Revoke phiên của account khác |
| SES-T06 | password change / 2FA change → credentialVersion bump + revoke | `SELF` | Re-auth hoặc credential hợp lệ | Giữ phiên cũ qua cửa sổ ≤900s access (Wukong residual — ghi trong gate identity) |
| SES-T07 | account disabled → deny mọi authorize/refresh | `SYS` | `accountState != ACTIVE` | Phát hành session mới |
| SES-X01 | Cross-host opaque id copy → reject (surface binding) | `SYS` | Cookie surface ≠ host | Accept session id của host khác |
| SES-X02 | Refresh cookie không có `Domain`; host-only HTTPS | `SYS` | Prod profile | Cookie `Domain=.campusute…` |

## 4. Announcement / publication (P06, engagement)

EXISTING announcement có author/read flow; PROPOSED workflow duyệt:

`DRAFT → IN_REVIEW → PUBLISHED → ARCHIVED`; `IN_REVIEW → DRAFT` (return);
`PUBLISHED → ARCHIVED` chỉ qua audited transition.

| Id | Transition | Actor | Precondition | Forbidden write |
| --- | --- | --- | --- | --- |
| ANN-T01 | `DRAFT → IN_REVIEW` | `STAFF:content` (author) | owner của draft | Author tự publish |
| ANN-T02 | `IN_REVIEW → PUBLISHED` | `STAFF:content` reviewer ≠ author | revision hiện tại, không phải author | Reviewer là author; sửa nội dung khi publish |
| ANN-T03 | `IN_REVIEW → DRAFT` | `STAFF:content` reviewer | kèm lý do | Xóa revision lịch sử |
| ANN-T04 | `PUBLISHED → ARCHIVED` | `STAFF:content` | audited transition | Sửa/xóa publication đã phát hành |
| ANN-T05 | đọc bản published | `ANON` | publication status = PUBLISHED | Lộ draft/attachment private qua search/cache/direct URL |
| ANN-X01 | Audit transition ghi actor+revision | `SYS` | mọi transition | Transition không audit |

## 5. Events / Đoàn–Hội (P08, schema `events`)

Event: `DRAFT → PUBLISHED → (REGISTRATION_OPEN → REGISTRATION_CLOSED) → COMPLETED | CANCELLED`.
Registration: `REGISTERED → CANCELLED`; attendance: `ABSENT → ATTENDED` (manual).

| Id | Transition | Actor | Precondition | Forbidden write |
| --- | --- | --- | --- | --- |
| EVT-T01 | `DRAFT → PUBLISHED` | `STAFF:events` owner | đủ field bắt buộc | Publish event của scope khác |
| EVT-T02 | mở đăng ký | `STAFF:events` | event PUBLISHED, trong cửa sổ | Mở cho event CANCELLED |
| EVT-T03 | đăng ký chỗ | `SELF` (student) | open, còn capacity, chưa có active registration | Vượt capacity; tạo active thứ hai |
| EVT-T04 | hủy đăng ký | `SELF` | registration của mình, đang active | Hủy của người khác; giải phóng ≠1 chỗ |
| EVT-T05 | `event → CANCELLED` | `STAFF:events` | audit + notify registrant cùng tx | Xóa registration history |
| EVT-T06 | attendance `→ ATTENDED` | `STAFF:events` theo roster | event diễn ra, registrant có mặt trong roster | Ghi `conduct_semester_score`; điểm rèn luyện tự động |
| EVT-X01 | Hai actor tranh chỗ cuối → đúng một thành công | `SYS` | unique active registration + locked capacity tx | Double-book |
| EVT-X02 | Retry cùng `Idempotency-Key` không tăng count | `SYS` | §1.3 | Đếm hai lần |

Quyết định phạm vi (người dùng chốt 2026-10-22):

- **Grant:** chỉ `ADMIN` cấp/thu `STAFF:events`; ADMIN được tự cấp cho chính mình,
  audit `GRANTED` với `grantedBy` = chính ADMIN đó. ADMIN không có grant vẫn bị
  403 `EVENTS_STAFF_REQUIRED` ở mọi staff op.
- **Owner-scope:** mọi thao tác staff trên một event đã tồn tại (sửa, publish,
  mở/đóng đăng ký, roster, điểm danh, complete, cancel) chỉ dành cho owner;
  grant holder khác nhận 403 `EVENT_NOT_OWNER`.
- **DRAFT → CANCELLED** được phép (EVT-T05 áp dụng cho cả DRAFT); lịch sử giữ nguyên.
- **Seed:** migration không seed grant nào (V138 xóa grant `system-migration`
  của V137). Stack dev/e2e cấp grant tường minh qua
  `POST /api/v1/events/staff/grants` (xem `scripts/ecosystem-events-verify.mjs`).

## 6. LMS (P09, schema `learning`; roster read-through)

Assignment: `DRAFT → PUBLISHED → CLOSED → ARCHIVED`.
Submission: `DRAFT → SUBMITTED → RETURNED → RESUBMITTED → REVIEWED`.

| Id | Transition | Actor | Precondition | Forbidden write |
| --- | --- | --- | --- | --- |
| LMS-T01 | assignment `DRAFT → PUBLISHED` | `LECT:<section>` | lecturer của section authority | Ghi Enrollment/StudentGrade; lecturer khác section sửa |
| LMS-T02 | assignment `PUBLISHED → CLOSED` | `LECT:<section>` / `SYS` deadline | sau server deadline | Nhận submission mới sau CLOSED |
| LMS-T03 | submission `DRAFT → SUBMITTED` | `SELF` (enrolled) | assignment PUBLISHED, trước server deadline, enrollment active | Revoked enrollment nộp; nộp hộ người khác |
| LMS-T04 | submission `SUBMITTED → RETURNED` | `LECT:<section>` | có feedback kèm | Sửa/xóa submitted revision |
| LMS-T05 | `RETURNED → RESUBMITTED` | `SELF` | trong cửa sổ resubmit | Ghi đè bản đã chấm |
| LMS-T06 | `→ REVIEWED` | `LECT:<section>` | sau khi chấm xong | Đổi grade authority học vụ |
| LMS-T07 | upload/download file | `SELF`/`LECT` | owner submission hoặc lecturer section; checksum khớp | Student khác tải bài |
| LMS-X01 | Submit gần deadline theo **server clock** | `SYS` | clock oracle trong test | Client timestamp quyết định |
| LMS-X02 | Immutable submitted revision | `SYS` | mọi write sau SUBMITTED tạo revision mới | Mutate in-place |

- **Authority denials:** staff-scope sử dụng 403 `SECTION_NOT_ASSIGNED` /
  `LECTURER_SCOPE_REQUIRED`; student-scope sử dụng 403 `NOT_ENROLLED` /
  `ENROLLMENT_NOT_ACTIVE` — cùng posture §5 `EVENT_NOT_OWNER` (existence của
  section/assignment published là thông tin catalog, không phải object bí mật).
  Object-scope trong cùng capability (submission/file của student khác) vẫn
  là 404 indistinguishable theo §1.1.
- **REVIEWED window:** LMS-T06 chấp nhận `RESUBMITTED → REVIEWED` và
  `RETURNED → REVIEWED` (chu kỳ đầu bắt buộc qua RETURNED vì feedback là
  precondition T04; bare `SUBMITTED → REVIEWED` không hợp lệ).
- **Seat semantics:** read lanes (materials, assignments, submissions của
  chính mình) mở cho mọi seat không bị thu hồi (ENROLLED/PENDING/CONFIRMED/
  COMPLETED — khớp roster); write lanes (draft open/save, submit, resubmit)
  chỉ cho `ENROLLED|CONFIRMED`. DROPPED/CANCELLED mất cả read lẫn write.
- **Feedback notice:** return/review tạo notification trong cùng transaction
  (§11); official grade authority không bị chạm.

## 7. Admissions mô phỏng (P10, schema `admissions`)

`DRAFT → SUBMITTED → IN_REVIEW → RETURNED → SUBMITTED → ACCEPTED | REJECTED`;
owner `→ WITHDRAWN` khi policy cho phép. Terminal immutable.

| Id | Transition | Actor | Precondition | Forbidden write |
| --- | --- | --- | --- | --- |
| ADM-T01 | `DRAFT → SUBMITTED` | `SELF` (applicant) | đủ trường bắt buộc, attachment hợp lệ | Submit hồ sơ người khác |
| ADM-T02 | `SUBMITTED → IN_REVIEW` | `STAFF:admissions` | claim hồ sơ | Reviewer tự sửa nội dung hồ sơ |
| ADM-T03 | `IN_REVIEW → RETURNED` | `STAFF:admissions` | kèm checklist + lý do | Mất checklist history |
| ADM-T04 | `RETURNED → SUBMITTED` (resubmit) | `SELF` | trong hạn resubmit | Tạo hồ sơ thứ hai cùng đợt |
| ADM-T05 | `IN_REVIEW → ACCEPTED/REJECTED` | `STAFF:admissions` | quyết định gắn nhãn **mô phỏng** | Quyết định không nhãn; đảo quyết định silently |
| ADM-T06 | `→ WITHDRAWN` | `SELF` | policy window mở | Withdraw sau terminal |
| ADM-X01 | Terminal (ACCEPTED/REJECTED/WITHDRAWN) immutable | `SYS` | mọi write sau terminal → 409 | Sửa bản ghi terminal |
| ADM-X02 | Stale write conflict có UX | `SYS` | optimistic version | Ghi đè lặng |

## 8. Library (P11, schema `library`)

Copy: `AVAILABLE → RESERVED → ON_LOAN → AVAILABLE`; `→ RETIRED` (soft, giữ history).
Request: `REQUESTED → APPROVED → ISSUED → RETURNED | CANCELLED`.

| Id | Transition | Actor | Precondition | Forbidden write |
| --- | --- | --- | --- | --- |
| LIB-T01 | copy `AVAILABLE → RESERVED` | `SELF` (request) / `SYS` | request REQUESTED, copy available | Reserve copy ON_LOAN |
| LIB-T02 | request `REQUESTED → APPROVED` | `STAFF:library` | còn hạn, copy còn | Approve request hết hạn |
| LIB-T03 | `APPROVED → ISSUED` | `STAFF:library` | transaction lock copy, unique active loan | Double-issue một copy |
| LIB-T04 | `ISSUED → RETURNED` | `STAFF:library` | loan active; idempotent | Trả hai lần tăng tồn kho ảo |
| LIB-T05 | `→ CANCELLED` | `SELF`/`STAFF` | trước ISSUED | Cancel loan đang active không qua return |
| LIB-T06 | copy `→ RETIRED` | `STAFF:library` | không active loan | Xóa loan history |
| LIB-X01 | Reservation expiry theo **server clock** | `SYS` | expiry rule cấu hình | Client giữ chỗ vô hạn |
| LIB-X02 | Race một copy → đúng một issue | `SYS` | lock + unique active | Double-issue |

## 9. Careers (P12, schema `careers`)

Opportunity: `DRAFT → IN_REVIEW → PUBLISHED → PAUSED → CLOSED`; `IN_REVIEW → REJECTED`; `PUBLISHED → CLOSED`; `PAUSED → PUBLISHED` (resume — org staff, không qua reviewer).
Application: `SUBMITTED → REVIEWING → INTERVIEW → OFFER → (REJECTED | WITHDRAWN)`; mọi pre-terminal `→ WITHDRAWN` (owner) / `→ REJECTED` (recruiter).

| Id | Transition | Actor | Precondition | Forbidden write |
| --- | --- | --- | --- | --- |
| CAR-T01 | opportunity `DRAFT → IN_REVIEW` | `STAFF:careers:<org>` | org membership | Recruiter org khác sửa |
| CAR-T02 | `IN_REVIEW → PUBLISHED` | `STAFF:careers` reviewer | reviewer ≠ submitter khi policy | Owner tự publish bypass reviewer |
| CAR-T03 | `PUBLISHED → PAUSED/CLOSED` | `STAFF:careers:<org>` | reason rõ | Closed job nhận application mới |
| CAR-T04 | application `→ SUBMITTED` | `SELF` (candidate) | opportunity PUBLISHED, chưa có active app | Hai active app/user/opportunity |
| CAR-T05 | `SUBMITTED → REVIEWING → INTERVIEW → OFFER` | `STAFF:careers:<org>` | server validates transition, audit actor | Recruiter thấy applicant của tin khác |
| CAR-T06 | `→ REJECTED` | `STAFF:careers:<org>` | moderation reason | Ẩn reason với candidate |
| CAR-T07 | `→ WITHDRAWN` | `SELF` | pre-terminal | Withdraw của người khác |
| CAR-X01 | Recruiter chỉ org được gán; không thấy điểm/admissions | `SYS` | org scope repository | Cross-org read |
| CAR-X02 | Attachment ownership | `SYS` | owner/staff của tin đó | Candidate khác tải hồ sơ |

## 10. Academic / thesis EXISTING (giữ nguyên, không redefine)

| Entity | States (code authority) | Boundary |
| --- | --- | --- |
| `RoundStatus` | DRAFT → PROPOSAL_OPEN → PROPOSALS_PUBLISHED → REGISTRATION_OPEN → REGISTRATION_CLOSED → RESULTS_PUBLISHED → CLOSED \| CANCELLED | thesis services |
| `TopicStatus` | DRAFT → PUBLISHED → APPROVED/REJECTED → ARCHIVED | thesis services |
| `GroupStatus` | DRAFT → ASSIGNED → SUBMITTED → APPROVED/REJECTED → COMPLETED \| CANCELLED | thesis services |
| `ApprovalStatus` | PENDING → APPROVED \| REJECTED | thesis services |
| Enrollment | enrollment authority ghi; domain khác read-through | academic |
| Assistant conversation/turn | `assistant` schema + RLS; scope-bound | assistant services |

## 11. Notifications (EXISTING)

Tạo trong **cùng transaction** với transition gốc (event cancel, loan issue,
feedback, decision). `notification.delivery` retry không nhân đôi
(unique trên `(aggregate, event)`). Cross-account read → deny.

## 12. Invariants toàn cục (kiểm ở gate từng phase)

| Id | Invariant |
| --- | --- |
| INV-01 | Không public registration: openapi không chứa path tự đăng ký tài khoản |
| INV-02 | Private/authenticated response `Cache-Control: no-store` |
| INV-03 | Cross-account cache/role spoof → deny ở mọi miền |
| INV-04 | Terminal states immutable trừ audited reverse transition đã liệt kê |
| INV-05 | Idempotent mutation: retry bằng key không tạo hiệu ứng thứ hai |
| INV-06 | Domain grant do admin cấp; không suy diễn quyền chéo domain |
| INV-07 | Audit ghi `actor, from, to, at, reason?` cho mọi transition ở §4–§9 |
| INV-08 | Server clock là oracle cho deadline/expiry/capacity window |

## 13. Assistant stream trên mobile (v2, M02)

Nguồn đã đọc: `ThesisAssistantController` (`POST /api/v1/thesis/assistant/chat/stream`, alias `/api/v1/assistant/chat/stream`), `ThesisAssistantService.StreamEvent`, `frontend/src/lib/assistant-stream.ts`, `useAssistantStream.ts`. Oracle chung: `contracts/ecosystem/assistant-stream.fixture.jsonl` (mỗi dòng `{scenario,event,data}`; `event:"comment"` chỉ là marker harness cho SSE comment `:heartbeat`, KHÔNG có trên wire).

| Mục | Hợp đồng |
|---|---|
| Request | `POST`, JSON `{message(<=2000, không trắng), locale(en|vi), clientRequestId(UUID), conversationId?, scope?(academic|specialized)}`, `Accept: text/event-stream`, bearer. Không có `Idempotency-Key`: identity = `clientRequestId` |
| Event | `meta{requestId,clientRequestId,turnId,conversationId,model,locale}`, `delta{sequence,text,sourceIds}`, `replace{text,sourceIds,reasonCode}`, `citation{citation}`, `done{messageId,reasonCode,degraded,terminalStatus,resetAt}`, `error{code,retryable}` |
| Thứ tự | `meta` trước thân; `citation` sau thân; `done` cần thân; `error` là terminal (được phép trước `meta`); sau `done`/`error` không nhận event nữa; EOF không terminal = lỗi |
| Heartbeat | comment `:heartbeat` mỗi 15 s; không reset idle timer; web: idle 45 s, tổng 120 s |
| Lỗi | trước stream: HTTP 400/401/403/429(`Retry-After`)/503(`ASSISTANT_RLS_UNAVAILABLE`); trong stream: event `error`. Quota RAG ngày cạn = câu trả lời suy giảm `reasonCode=QUOTA_EXCEEDED`, không phải 429 |
| Hủy | `POST .../requests/{clientRequestId}/cancel` -> 200; 409 `TURN_COMPLETED`/`FAILED_AMBIGUOUS`, 410 `TURN_PURGED`; web gọi cancel rồi abort reader |
| Resume | Không có `id`/`Last-Event-ID`: không resume; mất kết nối = trạng thái chưa xác nhận, người dùng chủ động gửi lại cùng `clientRequestId` |
| Rate limit | bucket assistant 20 POST/phút/user |
| Frame cắt | parser phải ghép byte UTF-8 qua `TextDecoder` streaming trước khi parse JSON (tình huống test: cắt giữa ký tự có dấu) |

Lệch hợp đồng phát hiện, chưa sửa trong M02 (ghi nhận để sửa ở lane B/M05): OpenAPI `message.minLength=0` vs Java `@NotBlank`; OpenAPI có `specializedScope` không có trong record Java; OpenAPI SSE chỉ khai báo 200. RN `fetch` readable stream: ASSUMPTION cho tới canary M07; mobile giữ adapter buffered sau cờ, UI không tuyên bố streaming parity trước canary (R17).

## 14. Push delivery (v2, M02 -> M03 lane B)

Trạng thái: PROPOSED (chưa có mã). Inbox `notifications.notification` vẫn là nguồn sự thật; push chỉ là tín hiệu mở app.

- API (owner lấy từ JWT, không nhận `userId`): `PUT /api/v1/notifications/my/devices/{installationId}` body `{provider, platform, token}`, response không echo token, lặp lại idempotent; `DELETE` cùng path, 204, lặp an toàn. Lỗi: 400 `INVALID_REQUEST`/`DEVICE_TOKEN_INVALID`, 401, 403, 404 (thiết bị không thuộc caller), 429. Không dùng `Idempotency-Key` vì thao tác lặp an toàn.
- Migration: `V143__notification_push_delivery.sql` (Postgres) + mirror H2 cùng tên; Flyway cao nhất hiện tại V142. Bảng `notifications.device_registration` (`id, user_id FK campuscore_auth."User", installation_id, provider, platform, token_ciphertext, token_fingerprint, credential_version, status ACTIVE|REVOKED, created_at, updated_at, revoked_at`; UNIQUE `(provider, token_fingerprint)`, UNIQUE `(user_id, installation_id)`) và `notifications.delivery_outbox` (`id, notification_id, device_id, recipient_user_id, status, attempt_count, next_attempt_at, last_error_code, lease_owner, lease_generation, lease_until, created_at, updated_at, sent_at`; UNIQUE `(notification_id, device_id)`). Token ciphertext + fingerprint cần khóa do security owner duyệt; chưa có khóa = giữ push BLOCKED_CAPABILITY.
- Rebind (R23): đăng ký token đã thuộc tài khoản khác = chuyển quyền sở hữu cho tài khoản vừa xác thực, vô hiệu hàng cũ; outbox cũ vẫn mang `recipient_user_id` snapshot.
- Dispatch (R23): ngay trước khi gửi phải khớp `notification.user_id == outbox.recipient_user_id == device.user_id`, registration ACTIVE, `User.status='ACTIVE'`, `User.credentialVersion == device.credential_version`; không dựa vào `AccountStateFilter`.
- Claim: Postgres `FOR UPDATE SKIP LOCKED` + `lease_generation` (ack chỉ khi owner+generation+lease khớp); H2 chỉ kiểm chuyển trạng thái tuần tự, không là oracle đồng thời; test song song bắt buộc trên Postgres disposable.
- Trạng thái: `PENDING -> CLAIMED -> SENT`; lỗi tạm `RETRY_WAIT` (tối đa 5 lần, backoff cap + jitter, PROPOSED); lỗi vĩnh viễn `FAILED`; mismatch/revoke `SUPPRESSED`; chưa có provider `BLOCKED`. Cờ `app.notifications.push.enabled=false` mặc định; không provider thì không bao giờ `SENT`.
- Ngữ nghĩa: at-least-once; sau timeout provider có thể đã nhận, KHÔNG tuyên bố exactly-once; push đã rời hệ thống không thu hồi nguyên tử (điểm tuyến tính hóa = kiểm tra send-time). Audit chỉ ghi action/actor/device id/owner cũ-mới; không ghi token, fingerprint, title/message.
- Test âm tính bắt buộc: cross-user token rebind, revoke giữa enqueue và send, duplicate event, crash sau provider timeout, claim song song (Postgres), tài khoản INACTIVE/đổi credentialVersion, no-provider.
