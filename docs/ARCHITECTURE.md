# Architecture

CampusCore hiện chạy như một stack microservices production-like với một `core-api`, sáu domain service, một `frontend`, và một `nginx gateway`.

## Runtime boundary

| Thành phần | Ownership chính |
| --- | --- |
| `core-api` | auth, users, roles, permissions, audit logs, finance-context, public `/health` |
| `notification-service` | notification inbox, unread count, realtime `/notifications` |
| `finance-service` | invoices, payments, scholarships, billing events |
| `academic-service` | faculties, departments, semesters, courses, sections, enrollments, grades, attendance, schedules |
| `engagement-service` | announcements, support tickets |
| `people-service` | `students`, `lecturers`, shadow-sync outbound events |
| `analytics-service` | `/api/v1/analytics/*`, dashboards, lecturer reporting, finance-academic reporting |
| `frontend` | Next.js standalone web app |
| `nginx` | single public edge and path router |

## Data layout

- PostgreSQL dùng một cluster chung nhưng tách schema theo service.
- `core-api` dùng `public`.
- `notification-service` dùng `notifications`.
- `finance-service` dùng `finance`.
- `academic-service` dùng `academic`.
- `engagement-service` dùng `engagement`.
- `people-service` dùng `people`.
- `analytics-service` hiện đọc từ `public` theo hướng low-risk.
- Shared auth contract được gom về `packages/platform-auth` để giảm lặp lại cookie/JWT/CSRF logic giữa các service.

## Public routing

- `/api/v1/auth/*`, `/api/v1/users/*`, `/api/v1/roles/*`, `/api/v1/permissions/*`, `/health` -> `core-api`
- `/api/v1/notifications/*`, `/socket.io/*` -> `notification-service`
- `/api/v1/finance/*` -> `finance-service`
- public academic routes -> `academic-service`
- `/api/v1/announcements/*`, `/api/v1/support-tickets/*` -> `engagement-service`
- `/api/v1/students/*`, `/api/v1/lecturers/*` -> `people-service`
- `/api/v1/analytics/*` -> `analytics-service`

## Internal contracts

Canonical internal paths:

- `/api/v1/internal/academic-context/*`
- `/api/v1/internal/people-context/*`
- `/api/v1/internal/finance-context/*`

Các path này không public qua `nginx` và yêu cầu `X-Service-Token`.

## Transitional constraints

- `core-api` vẫn giữ auth và identity platform.
- `people-service` dùng mô hình hybrid một release với shadow sync để giữ JWT claims `studentId` và `lecturerId`.
- `analytics-service` chưa có schema riêng để tránh refactor ownership sâu hơn trong cùng đợt hardening này.
