# Bảo mật

CampusCore được harden theo hướng tương thích: giữ contract đang dùng, nhưng chặn các bề mặt rủi ro rõ ràng ở browser auth, public health, public edge và release pipeline.

## 1. Auth model

Browser sessions dùng:

- `cc_access_token` (`HttpOnly`)
- `cc_refresh_token` (`HttpOnly`)
- `cc_csrf` (readable cookie)
- `X-CSRF-Token` cho request mutating dùng cookie auth

JWT extraction ưu tiên:

1. `Authorization: Bearer ...`
2. cookie `cc_access_token`

`POST /auth/refresh` và `POST /auth/logout` vẫn giữ legacy body contract để không làm gãy client cũ.

## 2. Notification service boundary

`notification-service` không phụ thuộc trực tiếp vào bảng user của `core-api`.

Nguyên tắc:

- chỉ lưu `userId` dạng opaque string
- không dùng foreign key chéo service
- consume event từ RabbitMQ thay vì gọi trực tiếp database của `core-api`

## 3. Public health vs internal readiness

- `GET /health` là public liveness tối giản
- `GET /api/v1/health/readiness` là internal readiness
- readiness yêu cầu `X-Health-Key` ở môi trường production-like
- `nginx` chặn readiness path ở public edge

Điều này giảm rò rỉ trạng thái dependency ra ngoài internet.

## 4. Gateway và rate limiting

`nginx` là public edge duy nhất:

- route auth và API được rate-limit riêng
- traffic web/App Router được nới đủ cho burst hợp lệ
- khi bị giới hạn sẽ trả `429`, không trả `503` giả gây hiểu nhầm runtime hỏng
- `/socket.io/*` đi thẳng tới `notification-service`

## 5. Queue và realtime

RabbitMQ được dùng làm ranh giới event giữa `core-api` và `notification-service`.

Semantics v1:

- `announcement.created`: realtime-only
- `notification.user.created`: persist + emit user room
- `notification.role.created`: persist nếu có `userIds`, nếu không thì realtime-only

Websocket auth:

- chấp nhận token từ handshake auth/header
- chấp nhận cookie access token trong handshake header
- reject token sai ngay khi connect

## 6. Security scans

### Local

`node scripts/run-security-local.mjs` chạy:

- `npm audit` cho backend, notification-service, frontend
- `gitleaks`
- `Trivy fs` cho từng service
- tùy chọn `Trivy config` cho phạm vi hạ tầng

### CI

Lane `security-scan` là bắt buộc trước release:

- `npm audit` cho 3 package
- `gitleaks`
- `Trivy fs`
- `Trivy image` cho 3 image runtime

Release sẽ bị chặn nếu finding mức `HIGH` hoặc `CRITICAL` không đạt ngưỡng đã chốt.

## 7. Known limitations

- chưa có service-to-service auth độc lập ngoài shared JWT contract
- chưa có outbox pattern đầy đủ cho mọi event domain
- chưa tách hẳn mọi domain thành microservices riêng
- cluster PostgreSQL vẫn là shared infrastructure, mới tách ở mức per-service schema

Đây là trade-off có chủ đích của portfolio v1: ưu tiên ranh giới service thật, runtime thật và release gate thật trước khi mở rộng split domain sâu hơn.
