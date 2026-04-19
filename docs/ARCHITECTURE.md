# Architecture

CampusCore hiện chạy như một stack microservices production-like với một `core-api`, một `auth-service`, sáu domain service, một `frontend`, và một `nginx gateway`.

## Runtime boundary

| Thành phần             | Ownership chính                                                                                  |
| ---------------------- | ------------------------------------------------------------------------------------------------ |
| `core-api`             | audit logs, finance-context, compatibility shadow, public `/health`                             |
| `auth-service`         | auth, sessions, users, roles, permissions, JWT cookie + CSRF contract                            |
| `notification-service` | notification inbox, unread count, realtime `/notifications`                                      |
| `finance-service`      | invoices, payments, scholarships, billing events                                                 |
| `academic-service`     | faculties, departments, semesters, courses, sections, enrollments, grades, attendance, schedules |
| `engagement-service`   | announcements, support tickets                                                                   |
| `people-service`       | `students`, `lecturers`, shadow-sync outbound events                                             |
| `analytics-service`    | `/api/v1/analytics/*`, dashboards, lecturer reporting, finance-academic reporting                |
| `frontend`             | Next.js standalone web app                                                                       |
| `nginx`                | single public edge and path router                                                               |

## Data layout

- PostgreSQL dùng một cluster chung nhưng tách schema theo service.
- `core-api` dùng `public`.
- `auth-service` dùng `auth`.
- `notification-service` dùng `notifications`.
- `finance-service` dùng `finance`.
- `academic-service` dùng `academic`.
- `engagement-service` dùng `engagement`.
- `people-service` dùng `people`.
- `analytics-service` hiện đọc từ `public` theo hướng low-risk.
- Shared auth contract được gom về `packages/platform-auth` để giảm lặp lại cookie/JWT/CSRF logic giữa các service.

## Public routing

- `/api/v1/auth/*`, `/api/v1/users/*`, `/api/v1/roles/*`, `/api/v1/permissions/*` -> `auth-service`
- `/health` -> `core-api`
- `/api/v1/notifications/*`, `/socket.io/*` -> `notification-service`
- `/api/v1/finance/*` -> `finance-service`
- public academic routes -> `academic-service`
- `/api/v1/announcements/*`, `/api/v1/support-tickets/*` -> `engagement-service`
- `/api/v1/students/*`, `/api/v1/lecturers/*` -> `people-service`
- `/api/v1/analytics/*` -> `analytics-service`

## Internal contracts

Canonical internal paths:

- `/api/v1/internal/academic-context/*`
- `/api/v1/internal/auth-context/*`
- `/api/v1/internal/finance-context/*`

Các path này không public qua `nginx` và yêu cầu `X-Service-Token`.

## Transitional constraints

- `auth-service` đã là public owner của auth và identity platform.
- `core-api` chỉ giữ shadow compatibility cho IAM trong một release chuyển tiếp.
- `people-service` dùng mô hình hybrid một release với shadow sync để giữ JWT claims `studentId` và `lecturerId`.
- `analytics-service` chưa có schema riêng để tránh refactor ownership sâu hơn trong cùng đợt hardening này.
