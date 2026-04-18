# Bảo mật CampusCore v3

CampusCore được harden theo hướng tương thích: giữ public contract ổn định cho frontend và legacy clients, đồng thời siết chặt browser auth, internal boundaries, public health, gateway, CI/CD và release posture.

## 1. Browser auth và session contract

Browser session dùng cùng một contract trên các service:

- `cc_access_token` (`HttpOnly`)
- `cc_refresh_token` (`HttpOnly`)
- `cc_csrf`
- `X-CSRF-Token` cho request mutating khi auth bằng cookie

Legacy compatibility vẫn được giữ:

- `Authorization: Bearer ...`
- JSON `accessToken`, `refreshToken`, `user`

Thứ tự trích xuất token:

1. Bearer token
2. Cookie `cc_access_token`

## 2. CSRF policy

CSRF chỉ áp khi request dùng cookie auth.

Nguyên tắc:

- request mutating qua cookie phải có `X-CSRF-Token`
- request mutating qua Bearer không bị áp CSRF
- logout và refresh vẫn giữ contract legacy để không làm gãy client cũ

## 3. Public health và internal readiness

### Public

- `GET /health` là public liveness tối giản của `core-api`

### Internal

- `GET /api/v1/health/liveness`
- `GET /api/v1/health/readiness`

Readiness nội bộ:

- không public qua `nginx`
- yêu cầu `X-Health-Key` trong môi trường production-like

Điều này giúp không lộ trạng thái chi tiết của database, Redis, RabbitMQ ra public edge.

## 4. Internal service boundary

CampusCore hiện có internal contract nổi bật:

- `X-Service-Token`
- `/internal/v1/finance-context/*`

Các endpoint finance-context:

- không public qua `nginx`
- được bảo vệ bằng shared secret `INTERNAL_SERVICE_TOKEN`
- chỉ phục vụ `finance-service`

Ở v3, finance read-through vẫn đi từ `finance-service` sang `core-api`. Chưa chuyển contract này sang `academic-service`.

## 5. Data boundary giữa các service

CampusCore dùng per-service schema trong cùng một PostgreSQL cluster:

- `core-api` -> `public`
- `notification-service` -> `notifications`
- `finance-service` -> `finance`
- `academic-service` -> `academic`

Nguyên tắc bảo mật và ownership:

- không foreign key chéo service
- không join runtime trực tiếp sang schema khác
- ID ngoài service được giữ dạng opaque reference

### Snapshot trong academic-service

`academic-service` lưu snapshot one-time của:

- `User`
- `Student`
- `Lecturer`

Điều này cho phép academic joins chạy trong schema của chính service. Ở v3, `students` và `lecturers` vẫn là identity/profile owner trong `core-api`.

### Snapshot trong finance-service

`finance-service` lưu snapshot hiển thị ngay trên invoice:

- `studentDisplayName`
- `studentEmail`
- `studentCode`
- `semesterName`

Việc này giảm nhu cầu đọc chéo service trên request path phục vụ người dùng.

## 6. Gateway hardening

`nginx` là public edge duy nhất:

- route request đến đúng service
- chặn `/internal/*`
- chặn readiness nội bộ
- áp rate limiting
- trả `429` khi bị rate-limit thay vì `503`

Public route split hiện tại:

- `/api/v1/notifications/*` và `/socket.io/*` -> `notification-service`
- `/api/v1/finance/*` -> `finance-service`
- public academic routes -> `academic-service`
- auth, docs, health, students, lecturers, announcements, analytics -> `core-api`

## 7. Queue và event-driven integration

RabbitMQ là ranh giới tích hợp chính giữa các service.

### Event từ `core-api`

- `announcement.created`
- `notification.user.created`
- `notification.role.created`

### Event từ `finance-service`

- `invoice.created`
- `invoice.status.changed`
- `payment.completed`

### Hành vi của `notification-service`

- consume event
- tạo inbox khi payload phù hợp
- phát realtime billing notification

Không service nào được dựa vào database của service khác để “tự suy luận” event state.

## 8. Security scan và release gate

### Local baseline

`node scripts/run-security-local.mjs` hiện quét:

- `npm audit` cho `backend`
- `npm audit` cho `notification-service`
- `npm audit` cho `finance-service`
- `npm audit` cho `academic-service`
- `npm audit` cho `frontend`
- `gitleaks`
- `Trivy fs`

### CI gate

Lane `security-scan` phải chặn release khi có finding blocker ở:

- dependency scan
- secret scan
- filesystem scan
- image scan cho cả 5 image public

## 9. Known limitations

Một số trade-off hiện vẫn có chủ đích:

- chưa có `auth-service` riêng
- `students` và `lecturers` vẫn ở `core-api`
- `academic-service` mới dùng snapshot one-time, chưa có sync runtime
- `core-api` vẫn giữ analytics và finance-context
- shared PostgreSQL cluster mới tách ở mức schema, chưa tách cluster

Đây là trạng thái phù hợp cho một portfolio microservices thật, nhưng vẫn giữ scope triển khai có kiểm soát.
