# Operations

## Local bootstrap

1. Chuẩn bị `.env` từ `.env.example`.
2. Bật Docker daemon.
3. Chạy `docker compose up -d --build`.

One-shot init hiện tại:

1. `core-api-init`
2. `notification-service-init`
3. `finance-service-init`
4. `academic-service-init`
5. `engagement-service-init`
6. `people-service-init`
7. `analytics-service-init`
8. runtime services

## Verify workflows

- Fast local E2E: `node scripts/run-fast-e2e.mjs`
- Edge E2E qua `nginx`: `node scripts/run-edge-e2e.mjs`
- Production-like image smoke: `node scripts/run-image-smoke.mjs`
- Local security sweep: `node scripts/run-security-local.mjs`

## Health model

- Public liveness: `GET /health` qua `core-api`
- Internal readiness: `GET /api/v1/health/readiness`
- Service internal routes không public qua `nginx`

## Required runtime services

- PostgreSQL
- Redis
- RabbitMQ
- MinIO
- `core-api`
- `notification-service`
- `finance-service`
- `academic-service`
- `engagement-service`
- `people-service`
- `analytics-service`
- `frontend`
- `nginx`

## Operational defaults

- `DOCKERHUB_NAMESPACE` là biến ưu tiên cho publish image.
- `DOCKERHUB_USERNAME` vẫn được chấp nhận như legacy alias.
- `latest` chỉ cập nhật khi có semver release.
