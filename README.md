# CampusCore

CampusCore is an academic management platform for course registration, schedules, grades, announcements, and admin workflows.

## Runtime contract

| URL | Purpose |
| --- | --- |
| `http://localhost` | Main app entrypoint through nginx |
| `http://localhost/health` | Public health check |
| `http://localhost/api/docs` | Swagger UI |
| `http://localhost:4000/api/v1/health` | Direct backend health check in the dev stack |

The frontend service listens on port `3000` inside Docker, but the public route is the nginx reverse proxy on port `80`.

## Stack

- Frontend: Next.js 15, React 18, TypeScript
- Backend: NestJS, Prisma, PostgreSQL
- Infrastructure: Redis, RabbitMQ, MinIO, Mailhog, nginx
- Observability: Prometheus, Grafana, Loki, Jaeger

## Compose modes

### Local full stack

```bash
cp .env.example .env
docker compose up -d --build
```

This builds the local backend/frontend images from `backend/Dockerfile` and `frontend/Dockerfile`, then starts the full stack with nginx, database, cache, queue, storage, email testing, and the observability services.

### Production images

```bash
docker compose -f docker-compose.production.yml up -d
```

This uses the published Docker Hub images for the app services and keeps the public surface on nginx only.

## Environment

Create the root `.env` from `.env.example`.

Key values:

- `POSTGRES_PASSWORD`
- `JWT_SECRET`
- `JWT_REFRESH_SECRET`
- `RABBITMQ_PASSWORD`
- `MINIO_PASSWORD`
- `GRAFANA_PASSWORD`
- `FRONTEND_URL`
- `DOCKERHUB_NAMESPACE` when you use the production image stack

`NEXT_PUBLIC_API_URL` is optional and can be left blank when using the nginx same-origin route.

## Docker Hub

Use `scripts/docker-publish.sh` to build and push both app images.

```bash
DOCKERHUB_NAMESPACE=<namespace> ./scripts/docker-publish.sh latest
```

Update image descriptions with:

```bash
DOCKERHUB_TOKEN=... DOCKERHUB_NAMESPACE=<namespace> ./scripts/update-hub-description.sh
```

The Docker Hub scripts prefer `DOCKERHUB_NAMESPACE`; `DOCKERHUB_USERNAME` remains supported as a legacy alias for CI compatibility.

GitHub Actions publishes both images from `.github/workflows/cd.yml` when Docker Hub secrets are configured. `DOCKERHUB_USERNAME` and `DOCKERHUB_PASSWORD` are required; `DOCKERHUB_NAMESPACE` is optional and is preferred when publishing to an organization namespace.

## Monitoring

- Prometheus only scrapes itself by default.
- Loki receives nginx access logs through promtail.
- Grafana ships with Prometheus and Loki datasources plus a small overview dashboard.

## Deployment notes

- HTTPS is not bundled. Terminate TLS at your own edge proxy if you need it.
- Backend runs on port `4000` internally and serves health at `/api/v1/health`.
- The Render config is backend-only and expects external queue/storage/mail endpoints to be provided separately.
