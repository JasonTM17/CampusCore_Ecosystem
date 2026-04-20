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
- Production compose preflight: `node scripts/check-production-compose-config.mjs`
- Kubernetes preflight: `node scripts/run-k8s-preflight.mjs`
- Kubernetes local smoke: `node scripts/run-k8s-local-smoke.mjs`
- Kubernetes local deploy giữ nguyên resources: `node scripts/run-k8s-local-deploy.mjs`
- Kubernetes local edge helper: `node scripts/run-k8s-local-edge.mjs`
- Kubernetes local edge stop: `node scripts/stop-k8s-local-edge.mjs`
- Kubernetes local destroy: `node scripts/run-k8s-local-destroy.mjs`

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

- `DOCKERHUB_USERNAME` là secret bắt buộc để publish Docker Hub.
- `DOCKERHUB_NAMESPACE` chỉ cần set khi namespace khác username.
- `DOCKERHUB_TOKEN` là secret đăng nhập ưu tiên cho Docker Hub publish từ CI/CD.
- `latest` chỉ cập nhật khi có semver release.

## Kubernetes deployment target

- Repo hiện có Kustomize manifests tại `k8s/base` và `k8s/bootstrap`, cùng overlay local-first tại `k8s/overlays/docker-desktop`.
- Topology K8s giữ nguyên boundary runtime hiện tại: `core-api`, `auth-service`, `notification-service`, `finance-service`, `academic-service`, `engagement-service`, `people-service`, `analytics-service`, `frontend`, `nginx`, cùng PostgreSQL, Redis, RabbitMQ, MinIO.
- Với Docker Desktop, đường chuẩn là:
  - `node scripts/run-k8s-preflight.mjs`
  - `node scripts/run-k8s-local-smoke.mjs`
- Nếu muốn giữ stack chạy để Docker Desktop UI nhìn thấy tài nguyên:
  - `node scripts/run-k8s-local-deploy.mjs`
  - sau đó đổi namespace từ `default` sang `campuscore` trong Docker Desktop Kubernetes UI
  - cách dùng khuyến nghị để mở edge local là `node scripts/run-k8s-local-edge.mjs`
  - helper này sẽ giữ local listener ổn định ở `http://127.0.0.1:8080` và đợi `/health` sẵn sàng trước khi thoát
  - các route contract như `/login`, `/api/docs`, và deny `/api/v1/internal/*` vẫn được verify trong `run-k8s-local-smoke.mjs` và `run-k8s-local-deploy.mjs`
  - nếu cần fallback thủ công, vẫn có thể dùng `kubectl -n campuscore port-forward service/campuscore-nginx 8080:80`
  - khi cần dọn, chạy `node scripts/run-k8s-local-destroy.mjs`
  - nếu chỉ muốn dừng listener local mà giữ cluster, chạy `node scripts/stop-k8s-local-edge.mjs`
  - nếu chỉ muốn reconcile lại runtime trên namespace đang tồn tại, dùng `K8S_REUSE_NAMESPACE=1 node scripts/run-k8s-local-deploy.mjs`
  - bootstrap jobs chỉ được replay khi chủ động set `K8S_FORCE_BOOTSTRAP_REPLAY=1`
- Overlay Docker Desktop bật Swagger local, tắt secure cookie flag cho HTTP local, và dùng `ClusterIP` + port-forward cho `campuscore-nginx`.
- Repo cũng đã có `k8s/overlays/staging-generic` và `k8s/overlays/prod-generic` làm khung cloud-agnostic cho staging/prod; Cloudflare nếu dùng sau này chỉ đứng trước ingress.
- Checklist ingress/TLS/secrets cho hai overlay generic nằm tại `docs/K8S_HANDOFF.md`.
- Bootstrap schema/migration vẫn là bước operator-managed riêng, giống policy production compose hiện tại.
