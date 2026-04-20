# CampusCore (Tiếng Việt)

CampusCore là một microservices portfolio cho bài toán quản lý học vụ đại học. Repo hiện chạy với một `core-api`, một `auth-service`, sáu domain service (`notification-service`, `finance-service`, `academic-service`, `engagement-service`, `people-service`, `analytics-service`), một `frontend`, và một `nginx gateway`.

## Stack hiện tại

- `core-api`: audit logs, finance-context, compatibility shadow, public health
- `auth-service`: auth, sessions, users, roles, permissions, JWT cookie + CSRF contract
- `notification-service`: inbox, unread count, websocket `/notifications`
- `finance-service`: invoices, payments, scholarships, finance events
- `academic-service`: public academic APIs và academic master-data
- `engagement-service`: thông báo, phiếu hỗ trợ
- `people-service`: service công khai sở hữu `students` và `lecturers`
- `analytics-service`: service công khai sở hữu `/api/v1/analytics/*`
- `frontend`: Next.js 15 standalone runtime
- `nginx`: public edge duy nhất

## Public contract

Public path phía frontend không đổi:

- `/api/v1/students/*` -> `people-service`
- `/api/v1/lecturers/*` -> `people-service`
- `/api/v1/notifications/*`, `/socket.io/*` -> `notification-service`
- `/api/v1/finance/*` -> `finance-service`
- public academic routes -> `academic-service`
- announcements và support tickets -> `engagement-service`
- `/api/v1/analytics/*` -> `analytics-service`
- `/api/v1/auth/*`, `/api/v1/users/*`, `/api/v1/roles/*`, `/api/v1/permissions/*` -> `auth-service`
- `/health` -> `core-api`

Không public:

- `/internal/*`
- `/api/v1/internal/*`
- readiness nội bộ

## Auth model

Browser flow dùng:

- `cc_access_token`
- `cc_refresh_token`
- `cc_csrf`
- `X-CSRF-Token`

Legacy bearer vẫn được giữ để tương thích.

## Internal contract canonical

Internal service contract canonical hiện tại là:

- `/api/v1/internal/academic-context/*`
- `/api/v1/internal/auth-context/*`
- `/api/v1/internal/finance-context/*`

## Shared auth contract

Toàn bộ service backend đang dùng chung package nội bộ `packages/platform-auth` làm nguồn chuẩn cho:

- cookie `cc_access_token`, `cc_refresh_token`, `cc_csrf`
- header `X-CSRF-Token`
- header `X-Service-Token`
- header `X-Health-Key`
- helper parse cookie, JWT claims, và wrapper auth dùng chung

Các route này chỉ dùng cho service-to-service với `X-Service-Token`.

## Release policy

- Branch push chỉ chạy CI
- Public registry chỉ publish từ tag `vX.Y.Z`
- `latest` chỉ cập nhật cùng semver release

Các image public hiện tại:

1. `campuscore-backend`
2. `campuscore-auth-service`
3. `campuscore-notification-service`
4. `campuscore-finance-service`
5. `campuscore-academic-service`
6. `campuscore-engagement-service`
7. `campuscore-people-service`
8. `campuscore-analytics-service`
9. `campuscore-frontend`

## Tài liệu liên quan

- [README.md](./README.md)
- [README.en.md](./README.en.md)
- [k8s/README.md](./k8s/README.md)
- [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)
- [docs/OPERATIONS.md](./docs/OPERATIONS.md)
- [docs/SECURITY.md](./docs/SECURITY.md)
- [docs/RELEASE.md](./docs/RELEASE.md)
- [DOCKER_HUB.md](./DOCKER_HUB.md)
