# CampusCore

[![CI](https://github.com/JasonTM17/CampusCore_FullStack_Individual/actions/workflows/ci.yml/badge.svg)](https://github.com/JasonTM17/CampusCore_FullStack_Individual/actions/workflows/ci.yml)
[![CD](https://github.com/JasonTM17/CampusCore_FullStack_Individual/actions/workflows/cd.yml/badge.svg)](https://github.com/JasonTM17/CampusCore_FullStack_Individual/actions/workflows/cd.yml)
![Next.js](https://img.shields.io/badge/frontend-Next.js%2015-111827)
![NestJS](https://img.shields.io/badge/backend-NestJS%2010-e11d48)
![License](https://img.shields.io/badge/license-MIT-16a34a)

CampusCore is an academic management platform for course registration, schedules, grades, tuition invoices, announcements, and administration workflows.

This repository keeps the backend as a single deployable NestJS application, but verifies it like a multi-service product through nginx, PostgreSQL, Redis, RabbitMQ, MinIO, and focused end-to-end smoke coverage.

Language versions:

- [English](./README.en.md)
- [Tieng Viet](./README.vi.md)

## Highlights

- Student, lecturer, and admin flows in one stack
- Public entrypoint through nginx at `http://localhost`
- Frontend runs with Next.js standalone runtime in Docker
- Backend health reports database, cache, and queue status
- Fast local checks plus edge E2E through the public gateway
- Published container images on Docker Hub and GitHub Container Registry

## Runtime Contract

| URL | Purpose |
| --- | --- |
| `http://localhost` | Public web entrypoint through nginx |
| `http://localhost/login` | Login page |
| `http://localhost/health` | Public health endpoint |
| `http://localhost/api/docs` | Swagger UI through nginx |
| `http://localhost:4000/api/v1/health` | Direct backend health in the local stack |

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
- Lecturer dashboard flows with empty-state support

### Admin Portal

- User management
- Course and section administration
- Enrollment management
- Dashboard analytics and operations views

## Container Images and Packages

### Docker Hub

- `nguyenson1710/campuscore-backend`
- `nguyenson1710/campuscore-frontend`

### GitHub Packages (GHCR)

- `ghcr.io/jasontm17/campuscore-backend`
- `ghcr.io/jasontm17/campuscore-frontend`

GitHub publishes new container packages as private by default on first push. If you want anonymous pulls and a public package page, change the package visibility to `Public` once in GitHub Package settings.

Published tags follow the same release strategy across registries:

- `latest`
- semantic tags such as `v1.0.0`
- immutable commit SHA tags such as `0f8bc44`

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

Set `DOCKERHUB_NAMESPACE` and `IMAGE_TAG` in `.env` before using the production image compose file.

## Quality Gates

The repository is verified with:

- backend lint, format check, typecheck, build, and tests
- frontend lint, typecheck, build, and smoke tests
- image smoke that boots production-like Docker runtime from the real Dockerfiles
- Playwright fast E2E for local iteration
- Playwright edge E2E through nginx for production-like verification
- mandatory security scans for source and published container images
- Docker compose config validation for dev, prod, and E2E stacks

## CI/CD

GitHub Actions provides:

- `CI Build and Test` as the release quality gate across backend, frontend, compose contracts, image smoke, edge E2E, and security scanning
- `CD - Gated Registry Publish` for Docker Hub and GitHub Container Registry image publishing only after the matching CI run succeeds

Docker Hub publishing uses `DOCKERHUB_NAMESPACE` as the preferred namespace input and keeps `DOCKERHUB_USERNAME` as the legacy alias for compatibility. GitHub Container Registry publishing uses the repository owner namespace automatically. Release publishing is blocked until the same commit passes the CI quality gate.

## More Documentation

- [English Guide](./README.en.md)
- [Huong dan tieng Viet](./README.vi.md)
- [Docker Hub Notes](./DOCKER_HUB.md)

## Author

Nguyen Tien Son

- GitHub: [JasonTM17](https://github.com/JasonTM17)
- Email: [jasonbmt06@gmail.com](mailto:jasonbmt06@gmail.com)
