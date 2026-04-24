# CampusCore (English)

CampusCore is a production-like university operations platform built as a release-verified microservices portfolio. It brings together a Next.js product shell, NestJS domain services, bilingual UX, student payments, operator observability, and Kubernetes handoff assets without changing the public auth/session contract.

![CampusCore public homepage](./docs/assets/screenshots/campuscore-home-en.png)

> **Live domain note:** `https://tienson.io.vn` is Cloudflare-managed. It resolves to CampusCore only when a production origin or the documented Cloudflare Tunnel/local edge is running. If the domain is unavailable, use the local edge workflow in [docs/CLOUDFLARE.md](./docs/CLOUDFLARE.md) or run the stack locally from the commands below.

## Release status

- Current release: [`v1.4.0`](https://github.com/JasonTM17/CampusCore_FullStack_Individual/releases/tag/v1.4.0)
- Release notes: [docs/releases/v1.4.0.md](./docs/releases/v1.4.0.md)
- Published topology: 9 images across GHCR and Docker Hub
- Verification posture: CI quality gate, CD publish, manifest verification, image smoke, edge E2E, and security scan

## Current stack

- `core-api`: audit logs, finance-context, compatibility shadow, public health
- `auth-service`: auth, sessions, users, roles, permissions, JWT cookie + CSRF contract
- `notification-service`: inbox, unread count, websocket `/notifications`
- `finance-service`: invoices, payments, scholarships, finance events
- `academic-service`: public academic APIs and academic master data
- `engagement-service`: announcements and support tickets
- `people-service`: public owner of `students` and `lecturers`
- `analytics-service`: public owner of `/api/v1/analytics/*`
- `frontend`: Next.js 15 standalone runtime
- `nginx`: single public edge

## Public contract

Frontend-facing paths stay stable:

- `/api/v1/students/*` -> `people-service`
- `/api/v1/lecturers/*` -> `people-service`
- `/api/v1/notifications/*`, `/socket.io/*` -> `notification-service`
- `/api/v1/finance/*` -> `finance-service`
- public academic routes -> `academic-service`
- announcements and support tickets -> `engagement-service`
- `/api/v1/analytics/*` -> `analytics-service`
- `/api/v1/auth/*`, `/api/v1/users/*`, `/api/v1/roles/*`, `/api/v1/permissions/*` -> `auth-service`
- `/health` -> `core-api`

Not public:

- `/internal/*`
- `/api/v1/internal/*`
- internal readiness endpoints

## Auth model

Browser auth contract:

- `cc_access_token`
- `cc_refresh_token`
- `cc_csrf`
- `X-CSRF-Token`

Legacy bearer support remains for compatibility.

## Canonical internal contract

The canonical internal service paths are:

- `/api/v1/internal/academic-context/*`
- `/api/v1/internal/auth-context/*`
- `/api/v1/internal/finance-context/*`

## Shared auth contract

All backend services now share `packages/platform-auth` as the internal source of truth for:

- `cc_access_token`, `cc_refresh_token`, `cc_csrf`
- `X-CSRF-Token`
- `X-Service-Token`
- `X-Health-Key`
- shared cookie helpers, JWT claim normalization, and auth wrappers

These routes are service-to-service only and require `X-Service-Token`.

## Release policy

- Branch pushes run CI only
- Public registries publish only from `vX.Y.Z` tags
- `latest` moves only with a semver release

Current public images:

1. `campuscore-backend`
2. `campuscore-auth-service`
3. `campuscore-notification-service`
4. `campuscore-finance-service`
5. `campuscore-academic-service`
6. `campuscore-engagement-service`
7. `campuscore-people-service`
8. `campuscore-analytics-service`
9. `campuscore-frontend`

## Related docs

- Runtime inventory: `node scripts/run-container-inventory.mjs`
- Cloudflare/local edge handoff: [docs/CLOUDFLARE.md](./docs/CLOUDFLARE.md)
- [README.md](./README.md)
- [README.vi.md](./README.vi.md)
- [docs/releases/TEMPLATE.md](./docs/releases/TEMPLATE.md)
- [docs/releases/v1.4.0.md](./docs/releases/v1.4.0.md)
- [k8s/README.md](./k8s/README.md)
- [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)
- [docs/OPERATIONS.md](./docs/OPERATIONS.md)
- [docs/SECURITY.md](./docs/SECURITY.md)
- [docs/RELEASE.md](./docs/RELEASE.md)
- [DOCKER_HUB.md](./DOCKER_HUB.md)
