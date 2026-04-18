# Bảo mật CampusCore v2

CampusCore được harden theo hướng tương thích: giữ public contract ổn định cho frontend và client cũ, nhưng siết chặt các bề mặt rủi ro ở browser auth, internal service boundary, public health, gateway và release pipeline.

## 1. Browser auth và session contract

Browser session dùng cùng một contract trên các service:

- `cc_access_token` (`HttpOnly`)
- `cc_refresh_token` (`HttpOnly`)
- `cc_csrf`
- `X-CSRF-Token` cho request mutating khi request được xác thực bằng cookie

Bearer legacy vẫn được giữ để tương thích:

- `Authorization: Bearer ...`
- JSON `accessToken`, `refreshToken`, `user`

Thứ tự trích xuất auth token:

1. Bearer token
2. cookie `cc_access_token`

## 2. CSRF policy

CSRF chỉ được áp khi request dùng browser cookie auth.

Nguyên tắc:

- request mutating qua cookie phải có `X-CSRF-Token`
- request mutating qua Bearer không bị áp CSRF
- logout và refresh vẫn giữ legacy body contract để không làm gãy client cũ

## 3. Public health và internal readiness

### Public

- `GET /health` là liveness tối giản của `core-api`

### Internal

- `GET /api/v1/health/liveness`
- `GET /api/v1/health/readiness`

Readiness nội bộ:

- không public qua `nginx`
- yêu cầu `X-Health-Key` ở môi trường production-like

Điều này giúp không lộ trạng thái dependency chi tiết ra public edge.

## 4. Internal service-to-service boundary

Finance context API là interface nội bộ mới trong `core-api`:

- `GET /internal/v1/finance-context/students/:studentId`
- `GET /internal/v1/finance-context/semesters/:semesterId`
- `GET /internal/v1/finance-context/semesters/:semesterId/billable-students`

Các endpoint này:

- không public qua `nginx`
- được bảo vệ bởi header `X-Service-Token`
- dùng shared secret `INTERNAL_SERVICE_TOKEN`

`finance-service` chỉ dùng các endpoint này để đọc context cần thiết, không đọc trực tiếp schema `public`.

## 5. Data boundary giữa services

CampusCore dùng per-service schema trong một PostgreSQL cluster:

- `core-api` -> `public`
- `notification-service` -> `notifications`
- `finance-service` -> `finance`

Nguyên tắc bảo mật và ownership:

- không foreign key chéo service
- không join runtime trực tiếp sang schema khác
- ID ngoài service được giữ dạng opaque reference

### Snapshot trong finance

`finance-service` lưu snapshot hiển thị trên invoice:

- `studentDisplayName`
- `studentEmail`
- `studentCode`
- `semesterName`

Việc này giảm nhu cầu đọc chéo service khi phục vụ request người dùng.

## 6. Gateway hardening

`nginx` là public edge duy nhất:

- route public traffic đến đúng service
- chặn `/internal/*`
- chặn readiness nội bộ
- áp rate limiting
- trả `429` khi bị rate-limit thay vì `503` gây hiểu nhầm runtime hỏng

Public route split chính:

- `/api/v1/notifications/*` -> `notification-service`
- `/socket.io/*` -> `notification-service`
- `/api/v1/finance/*` -> `finance-service`
- auth, Swagger, health và route học vụ còn lại -> `core-api`

## 7. Queue và event-driven integration

RabbitMQ là ranh giới tích hợp giữa service.

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

Điểm quan trọng là service consumer không truy cập database của producer để “tự suy luận” dữ liệu.

## 8. Security scans

### Local baseline

Một vòng quét local nên bao gồm:

- `npm audit` cho `backend`
- `npm audit` cho `notification-service`
- `npm audit` cho `finance-service`
- `npm audit` cho `frontend`
- `gitleaks`
- `Trivy fs`

### CI gate

Lane bảo mật của pipeline nên chặn release khi có finding blocker ở:

- dependency scan
- secret scan
- filesystem scan
- image scan cho cả 4 image ứng dụng

## 9. Known limitations

CampusCore v2 vẫn có một số trade-off có chủ đích:

- chưa có `auth-service` riêng
- chưa có `academic-service` riêng
- chưa dùng outbox pattern đầy đủ cho toàn bộ domain
- vẫn dùng shared PostgreSQL cluster, mới tách ở mức schema
- service-to-service auth hiện dùng shared secret header cho internal finance context, chưa phải service identity độc lập

Đây là trạng thái phù hợp cho một portfolio ở mức microservices thật nhưng vẫn giữ phạm vi triển khai có kiểm soát.
