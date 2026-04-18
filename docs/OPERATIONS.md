# Vận hành

Tài liệu này mô tả cách boot, verify và vận hành CampusCore ở trạng thái microservices portfolio v1.

## 1. Local development stack

### Boot nhanh toàn stack

```bash
cp .env.example .env
docker compose up -d --build
```

Compose dev boot theo thứ tự:

1. `postgres`, `redis`, `rabbitmq`, `minio`
2. `core-api-init`
3. `notification-service-init`
4. `core-api`, `notification-service`, `frontend`, `nginx`

### Boot từng service để debug

- `cd backend && npm run start`
- `cd notification-service && npm run start`
- `cd frontend && npm run dev -- --hostname 127.0.0.1 --port 3100`

Khi cần xác nhận app có lên hay không, ưu tiên local smoke trước khi chạy E2E nặng.

## 2. Bootstrap schema

### Dev và E2E

`docker-compose.yml` và `docker-compose.e2e.yml` đã có one-shot init service:

- `core-api-init`: `prisma db push --skip-generate` + seed deterministic data
- `notification-service-init`: `prisma db push --skip-generate` + `data:migrate:legacy`

### Production-like

`docker-compose.production.yml` giữ runtime image sạch và không tự chạy migration trong app container. Trước first deploy, chạy bootstrap profile:

```bash
export DOCKERHUB_NAMESPACE=<namespace>
export IMAGE_TAG=v1.0.0
docker compose -f docker-compose.production.yml --profile bootstrap run --rm core-api-init
docker compose -f docker-compose.production.yml --profile bootstrap run --rm notification-service-init
```

`core-api-init` sẽ push schema `public` rồi seed dữ liệu. `notification-service-init` sẽ push schema `notifications` rồi copy legacy notifications nếu bảng cũ tồn tại. Sau đó mới chạy runtime stack:

```bash
export DOCKERHUB_NAMESPACE=<namespace>
export IMAGE_TAG=v1.0.0
docker compose -f docker-compose.production.yml up -d
```

## 3. Public edge

Public traffic luôn đi qua `nginx` tại `http://localhost` hoặc domain deploy thật.

Các path quan trọng:

- `/health` công khai
- `/api/docs` công khai theo config Swagger
- `/api/v1/notifications/*` qua `notification-service`
- `/socket.io/*` qua `notification-service`
- readiness path không public

## 4. Health checks

### core-api

- public liveness: `GET /health`
- internal readiness: `GET /api/v1/health/readiness`

### notification-service

- internal liveness: `GET /api/v1/health/liveness`
- internal readiness: `GET /api/v1/health/readiness`

Ở production-like path, readiness cần `X-Health-Key`.

## 5. Verification

### Chạy local security sweep

```bash
node scripts/run-security-local.mjs
```

Mặc định script chạy:

1. backend `npm audit --json`
2. notification-service `npm audit --json`
3. frontend `npm audit --json`
4. `gitleaks`
5. `Trivy fs` cho từng service

Bật scan config hạ tầng:

```bash
set LOCAL_SECURITY_INCLUDE_CONFIG=1
node scripts/run-security-local.mjs
```

### Full local matrix

```bash
cd backend && npm run lint && npm run lint:format && npm run typecheck && npm run build && npm run test:unit -- --runInBand && npm run test:integration -- --runInBand
cd ../notification-service && npm run lint && npm run lint:format && npm run typecheck && npm run build && npm run test:unit -- --runInBand && npm run test:integration -- --runInBand
cd ../frontend && npm run lint && npm run typecheck && npm test && npm run build && npm run test:e2e && npm run test:e2e:edge
cd .. && node scripts/run-image-smoke.mjs
docker compose -f docker-compose.yml config
docker compose -f docker-compose.production.yml config
docker compose -f docker-compose.e2e.yml config
git diff --check
```

## 6. Troubleshooting nhanh

### Cảm giác lệnh “đứng im”

- local dev: quá 2-3 phút là bất thường
- fast E2E: quá 6-8 phút là bất thường
- edge E2E: quá 10-12 phút là bất thường
- local security full: khoảng 8-10 phút là bình thường hơn do Trivy và Docker scan

Khi quá ngưỡng mà log không đổi, kiểm tra process hoặc container nền ngay.

### Xem log artifact local

- `frontend/test-results/fast-e2e-stack`
- `frontend/test-results/edge-e2e-stack`
- `frontend/test-results/image-smoke-stack`
- `frontend/test-results/security-local`
