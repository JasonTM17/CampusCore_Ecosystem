# Operations

## Local bootstrap

1. Chuẩn bị `.env` từ `.env.example`.
2. Bật Docker daemon.
3. Chạy `docker compose up -d --build`.

One-shot init hiện tại:

1. `core-api-init`
2. `auth-service-init`
3. `notification-service-init`
4. `finance-service-init`
5. `academic-service-init`
6. `engagement-service-init`
7. `people-service-init`
8. `analytics-service-init`
9. runtime services

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
- `auth-service`
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
- `DOCKERHUB_TOKEN` là secret đăng nhập ưu tiên cho Docker Hub publish từ CI/CD.
- `latest` chỉ cập nhật khi có semver release.

## Kubernetes deployment target

- Repo hiện có Kustomize manifests tại `k8s/base`.
- Bộ manifest này giữ nguyên boundary runtime hiện tại: `core-api`, `auth-service`, `notification-service`, `finance-service`, `academic-service`, `engagement-service`, `people-service`, `analytics-service`, `frontend`, `nginx`, cùng PostgreSQL, Redis, RabbitMQ, MinIO.
- Với Docker Desktop, bật Kubernetes rồi dùng `kubectl kustomize k8s/base` để render và `kubectl apply -k k8s/base` để triển khai.
- Bootstrap schema/migration vẫn là bước operator-managed riêng, giống policy production compose hiện tại.
