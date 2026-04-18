# CampusCore

CampusCore is an academic management platform delivered as **Microservices Portfolio v3**. The current stack combines a `core-api` that owns auth and identity, a `notification-service` for inbox and realtime delivery, a `finance-service` for billing, an `academic-service` for public academic APIs, a `frontend`, and a single `nginx gateway` as the public edge.

The primary README is the Vietnamese version:

- [README.md](./README.md)
- [README.vi.md](./README.vi.md)

## Current stack

- `frontend`: Next.js 15, standalone runtime for production-like execution
- `core-api`: NestJS 11, owner of auth, session, users, roles, permissions, students, lecturers, announcements, analytics, finance-context, and public health
- `notification-service`: NestJS 11, owner of notification inboxes, unread counts, websocket `/notifications`, RabbitMQ consumption, and realtime fan-out
- `finance-service`: NestJS 11, owner of invoices, payments, scholarships, and finance events
- `academic-service`: NestJS 11, owner of faculties, departments, semesters, courses, sections, enrollments, grades, attendance, waitlist, and schedules
- `nginx`: the only public gateway

Shared infrastructure:

- PostgreSQL with one cluster and service-specific schemas
- Redis
- RabbitMQ
- MinIO

## Service boundaries

| Component | Owns | Does not own |
| --- | --- | --- |
| `core-api` | auth, identity, users, roles, permissions, students, lecturers, announcements, analytics, `/health` | notification inboxes, finance data, public academic APIs |
| `notification-service` | notification inboxes, unread counts, `/notifications` websocket, realtime delivery | auth source of truth, finance data, academic master-data |
| `finance-service` | invoices, payments, scholarships, finance exports, finance events | users and academic source of truth |
| `academic-service` | faculties, departments, academic years, semesters, courses, curricula, classrooms, sections, enrollments, grades, attendance, waitlist, schedules | auth source of truth, finance context, public health |

## Public contract

The frontend keeps the same public paths while gateway ownership changes behind `nginx`.

- `/health` -> `core-api`
- `/api/docs` -> `core-api`
- `/api/v1/notifications/*` and `/socket.io/*` -> `notification-service`
- `/api/v1/finance/*` -> `finance-service`
- public academic paths such as `/api/v1/semesters/*`, `/api/v1/courses/*`, `/api/v1/sections/*`, `/api/v1/enrollments/*`, `/api/v1/grades/*`, `/api/v1/attendance/*` -> `academic-service`

Internal routes remain blocked at the edge:

- `/api/v1/health/liveness`
- `/api/v1/health/readiness`
- `/internal/*`

## Auth and health model

Browser session contract shared across services:

- `cc_access_token`
- `cc_refresh_token`
- `cc_csrf`
- `X-CSRF-Token` on mutating requests authenticated by cookies

Legacy compatibility is still available through:

- JSON `accessToken`, `refreshToken`, `user`
- `Authorization: Bearer ...`

Health model:

- `GET /health` is the public minimal liveness endpoint of `core-api`
- `GET /api/v1/health/readiness` is the internal readiness endpoint, protected by `X-Health-Key` in production-like environments

## Data model

CampusCore uses a **per-service schema strategy**:

- `core-api` -> `schema=public`
- `notification-service` -> `schema=notifications`
- `finance-service` -> `schema=finance`
- `academic-service` -> `schema=academic`

`academic-service` uses a **one-time local snapshot** of `User`, `Student`, and `Lecturer` to keep academic joins local to its own schema. In v3, `students` and `lecturers` still remain identity/profile owners in `core-api`.

`finance-service` still reads finance context from `core-api` through `X-Service-Token`. That contract is not moved to `academic-service` in this phase.

## Quick start

### Local stack

```bash
cp .env.example .env
docker compose up -d --build
```

Boot order:

1. `postgres`, `redis`, `rabbitmq`, `minio`
2. `core-api-init`
3. `notification-service-init`
4. `finance-service-init`
5. `academic-service-init`
6. `core-api`, `notification-service`, `finance-service`, `academic-service`, `frontend`, `nginx`

### Production-like stack

```bash
export DOCKERHUB_NAMESPACE=<namespace>
export IMAGE_TAG=v1.0.0
docker compose -f docker-compose.production.yml --profile bootstrap run --rm core-api-init
docker compose -f docker-compose.production.yml --profile bootstrap run --rm notification-service-init
docker compose -f docker-compose.production.yml --profile bootstrap run --rm finance-service-init
docker compose -f docker-compose.production.yml --profile bootstrap run --rm academic-service-init
docker compose -f docker-compose.production.yml up -d
```

Runtime containers stay clean in production-like mode. Schema bootstrap is an operational prerequisite before the first deployment.

## Verification matrix

- `backend/core-api`: lint, format, typecheck, build, unit, integration
- `notification-service`: lint, format, typecheck, build, unit, integration
- `finance-service`: lint, format, typecheck, build, unit, integration
- `academic-service`: lint, format, typecheck, build, unit, integration
- `frontend`: lint, typecheck, test, build, fast E2E
- `node scripts/run-image-smoke.mjs`
- `cd frontend && npm run test:e2e:edge`
- `node scripts/run-security-local.mjs`
- `docker compose -f docker-compose.yml config`
- `docker compose -f docker-compose.production.yml config`
- `docker compose -f docker-compose.e2e.yml config`
- `git diff --check`

## Release policy

CampusCore uses a **semver-only public release** policy:

- `master` or `main` runs CI only
- public registries publish only from `vX.Y.Z` tags
- `latest` moves only with a semver release
- each release publishes **five images**:
  - `campuscore-backend`
  - `campuscore-notification-service`
  - `campuscore-finance-service`
  - `campuscore-academic-service`
  - `campuscore-frontend`

## Registries

### Docker Hub

- `nguyenson1710/campuscore-backend`
- `nguyenson1710/campuscore-notification-service`
- `nguyenson1710/campuscore-finance-service`
- `nguyenson1710/campuscore-academic-service`
- `nguyenson1710/campuscore-frontend`

### GitHub Container Registry

- `ghcr.io/jasontm17/campuscore-backend`
- `ghcr.io/jasontm17/campuscore-notification-service`
- `ghcr.io/jasontm17/campuscore-finance-service`
- `ghcr.io/jasontm17/campuscore-academic-service`
- `ghcr.io/jasontm17/campuscore-frontend`

## Additional documentation

- [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)
- [docs/OPERATIONS.md](./docs/OPERATIONS.md)
- [docs/SECURITY.md](./docs/SECURITY.md)
- [docs/RELEASE.md](./docs/RELEASE.md)
- [DOCKER_HUB.md](./DOCKER_HUB.md)
