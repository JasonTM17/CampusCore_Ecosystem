# CampusCore

[![CI](https://github.com/JasonTM17/CampusCore_FullStack_Individual/actions/workflows/ci.yml/badge.svg)](https://github.com/JasonTM17/CampusCore_FullStack_Individual/actions/workflows/ci.yml)
[![CD](https://github.com/JasonTM17/CampusCore_FullStack_Individual/actions/workflows/cd.yml/badge.svg)](https://github.com/JasonTM17/CampusCore_FullStack_Individual/actions/workflows/cd.yml)
![Next.js](https://img.shields.io/badge/frontend-Next.js%2015-111827)
![NestJS](https://img.shields.io/badge/backend-NestJS%2010-e11d48)
![License](https://img.shields.io/badge/license-MIT-16a34a)

CampusCore is an academic management platform for course registration, schedules, grades, tuition invoices, announcements, and administration workflows.

The project keeps the backend as a single deployable NestJS application, but verifies it as a production-like multi-service stack through nginx, PostgreSQL, Redis, RabbitMQ, MinIO, and focused edge E2E coverage.

## What Is Included

- Student, lecturer, and admin portals
- Next.js 15 frontend with standalone runtime for Docker
- NestJS 10 backend with Prisma, JWT auth, Swagger, and websocket auth
- PostgreSQL, Redis, RabbitMQ, MinIO, Mailhog, nginx, and monitoring services
- Fast local E2E plus nginx-backed edge E2E

## Public Runtime Contract

| URL | Purpose |
| --- | --- |
| `http://localhost` | Public entrypoint through nginx |
| `http://localhost/login` | Login page |
| `http://localhost/health` | Public health endpoint |
| `http://localhost/api/docs` | Swagger UI through nginx |
| `http://localhost:4000/api/v1/health` | Direct backend health in the local stack |

The frontend listens on port `3000` inside Docker, the backend listens on port `4000`, and nginx is the only public surface in the compose stacks.

## Feature Areas

### Student Portal

- Course registration
- Weekly schedule
- Grades and transcript views
- Tuition invoices
- Announcements
- Profile management

### Lecturer Portal

- Teaching schedule
- Grade management
- Empty-state safe lecturer flows

### Admin Portal

- User management
- Course and section administration
- Enrollment management
- Operational dashboards

## Architecture Notes

- Frontend: Next.js 15, React 18, TypeScript, Tailwind CSS
- Backend: NestJS 10, Prisma, PostgreSQL, JWT, Socket.IO
- Runtime services: Redis, RabbitMQ, MinIO, Mailhog, nginx
- Observability stack: Prometheus, Grafana, Loki, Promtail, Jaeger

CampusCore is not split into separate backend microservices in this release. Instead, the repository verifies the single backend deployable together with the surrounding services, so runtime behavior still reflects a realistic multi-service deployment.

## Container Images

### Docker Hub

- `nguyenson1710/campuscore-backend`
- `nguyenson1710/campuscore-frontend`

### GitHub Packages (GHCR)

- `ghcr.io/jasontm17/campuscore-backend`
- `ghcr.io/jasontm17/campuscore-frontend`

GitHub publishes new container packages as private by default on first push. If you want anonymous pulls and a public package page, change the package visibility to `Public` once in GitHub Package settings.

Tag strategy across registries:

- `latest`
- semantic release tags such as `v1.0.0`
- immutable commit SHA tags such as `0f8bc44`

Example pulls:

```bash
docker pull nguyenson1710/campuscore-backend:v1.0.0
docker pull nguyenson1710/campuscore-frontend:v1.0.0
docker pull ghcr.io/jasontm17/campuscore-backend:v1.0.0
docker pull ghcr.io/jasontm17/campuscore-frontend:v1.0.0
```

## Quick Start

### Local Full Stack

```bash
cp .env.example .env
docker compose up -d --build
```

Open:

- `http://localhost`
- `http://localhost/api/docs`
- `http://localhost/health`

### Production-like Image Stack

```bash
docker compose -f docker-compose.production.yml up -d
```

Set the following values in `.env` before starting the production image stack:

- `POSTGRES_PASSWORD`
- `JWT_SECRET`
- `JWT_REFRESH_SECRET`
- `RABBITMQ_PASSWORD`
- `MINIO_PASSWORD`
- `GRAFANA_PASSWORD`
- `DOCKERHUB_NAMESPACE`
- `IMAGE_TAG`

`NEXT_PUBLIC_API_URL` can stay empty when the frontend uses nginx same-origin routing.

## Verification and Testing

The repository is validated with:

- backend lint, format check, typecheck, build, and tests
- frontend lint, typecheck, build, and smoke tests
- image smoke that boots the production-like Docker runtime from the real Dockerfiles
- Playwright fast E2E for local feedback
- Playwright edge E2E through nginx for production-like verification
- mandatory security scans for source and container images
- Docker compose config validation for development, production, and E2E stacks

Focused browser E2E currently covers:

- public load for `/` and `/login`
- student login and invoice detail flow
- admin login and user-management action controls
- lecturer login and schedule or empty-state flow
- public health and Swagger through nginx
- websocket auth smoke with valid and invalid tokens

## CI/CD

GitHub Actions provides:

- `CI Build and Test` as the release quality gate across backend, frontend, compose contracts, image smoke, edge E2E, and security scanning
- `CD - Gated Registry Publish` for registry publishing only after the matching CI run succeeds

Registry behavior:

- Docker Hub publishing uses `DOCKERHUB_NAMESPACE` as the preferred namespace input
- `DOCKERHUB_USERNAME` remains supported as the legacy alias for compatibility
- GitHub Container Registry publishing uses the repository owner namespace automatically
- pushes to `master`, `main`, and version tags publish `latest` or the tag plus the commit SHA only after the same commit passes the CI quality gate

## Documentation

- [Root README](./README.md)
- [Vietnamese Guide](./README.vi.md)
- [Docker Hub Notes](./DOCKER_HUB.md)

## Author

Nguyen Tien Son

- GitHub: [JasonTM17](https://github.com/JasonTM17)
- Email: [jasonbmt06@gmail.com](mailto:jasonbmt06@gmail.com)
