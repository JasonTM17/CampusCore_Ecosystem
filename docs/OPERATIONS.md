# Vận hành CampusCore v3

Tài liệu này mô tả cách boot, kiểm tra và vận hành CampusCore ở trạng thái **Microservices Portfolio v3**.

## 1. Thành phần runtime

Stack runtime hiện tại gồm:

- `frontend`
- `core-api`
- `notification-service`
- `finance-service`
- `academic-service`
- `nginx`
- PostgreSQL
- Redis
- RabbitMQ
- MinIO

## 2. Boot local full stack

### Cách nhanh nhất

```bash
cp .env.example .env
docker compose up -d --build
```

Thứ tự boot ở dev compose:

1. `postgres`, `redis`, `rabbitmq`, `minio`
2. `core-api-init`
3. `notification-service-init`
4. `finance-service-init`
5. `academic-service-init`
6. `core-api`, `notification-service`, `finance-service`, `academic-service`, `frontend`, `nginx`

## 3. Boot từng service để debug

Khi cần debug cục bộ, nên chạy đúng entrypoint theo service:

- `cd backend && npm run start`
- `cd notification-service && npm run start`
- `cd finance-service && npm run start`
- `cd academic-service && npm run start`
- `cd frontend && npm run dev -- --hostname 127.0.0.1 --port 3100`

Nếu mục tiêu chỉ là “xem app lên chưa”, đừng chạy full matrix ngay. Hãy ưu tiên local smoke trước.

## 4. Bootstrap schema

### Dev và E2E

`docker-compose.yml` và `docker-compose.e2e.yml` dùng one-shot init service:

- `core-api-init`: push schema `public` và seed dữ liệu nền
- `notification-service-init`: push schema `notifications` và migrate notification legacy
- `finance-service-init`: push schema `finance` và migrate finance legacy
- `academic-service-init`: push schema `academic` và migrate academic legacy

### Production-like

Production compose giữ runtime image sạch. Trước first deploy, chạy bootstrap:

```bash
export DOCKERHUB_NAMESPACE=<namespace>
export IMAGE_TAG=v1.0.0
docker compose -f docker-compose.production.yml --profile bootstrap run --rm core-api-init
docker compose -f docker-compose.production.yml --profile bootstrap run --rm notification-service-init
docker compose -f docker-compose.production.yml --profile bootstrap run --rm finance-service-init
docker compose -f docker-compose.production.yml --profile bootstrap run --rm academic-service-init
docker compose -f docker-compose.production.yml up -d
```

## 5. Public edge và internal path

Public traffic luôn đi qua `nginx`:

- `/health` -> `core-api`
- `/api/docs` -> `core-api`
- `/api/v1/notifications/*` và `/socket.io/*` -> `notification-service`
- `/api/v1/finance/*` -> `finance-service`
- public academic paths -> `academic-service`
- auth và các route identity còn lại -> `core-api`

Không public:

- `/api/v1/health/liveness`
- `/api/v1/health/readiness`
- `/internal/*`

Điểm quan trọng nhất hiện tại là internal finance context:

- `GET /internal/v1/finance-context/students/:studentId`
- `GET /internal/v1/finance-context/semesters/:semesterId`
- `GET /internal/v1/finance-context/semesters/:semesterId/billable-students`

Các endpoint này chỉ dành cho `finance-service` và phải đi kèm `X-Service-Token`.

## 6. Health checks

### `core-api`

- public liveness: `GET /health`
- internal liveness: `GET /api/v1/health/liveness`
- internal readiness: `GET /api/v1/health/readiness`

### `notification-service`

- internal liveness: `GET /api/v1/health/liveness`
- internal readiness: `GET /api/v1/health/readiness`

### `finance-service`

- internal liveness: `GET /api/v1/health/liveness`
- internal readiness: `GET /api/v1/health/readiness`

### `academic-service`

- internal liveness: `GET /api/v1/health/liveness`
- internal readiness: `GET /api/v1/health/readiness`

Ở production-like flow, readiness yêu cầu `X-Health-Key`.

## 7. Verification tham chiếu

### Core API

```bash
cd backend
npm run lint
npm run lint:format
npm run typecheck
npm run build
npm run test:unit -- --runInBand
npm run test:integration -- --runInBand
```

### Notification service

```bash
cd notification-service
npm run lint
npm run lint:format
npm run typecheck
npm run build
npm run test:unit -- --runInBand
npm run test:integration -- --runInBand
```

### Finance service

```bash
cd finance-service
npm run lint
npm run lint:format
npm run typecheck
npm run build
npm run test:unit -- --runInBand
npm run test:integration -- --runInBand
```

### Academic service

```bash
cd academic-service
npm run lint
npm run lint:format
npm run typecheck
npm run build
npm run test:unit -- --runInBand
npm run test:integration -- --runInBand
```

### Frontend

```bash
cd frontend
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e
```

### Runtime và security

```bash
node scripts/run-image-smoke.mjs
cd frontend && npm run test:e2e:edge
cd .. && node scripts/run-security-local.mjs
docker compose -f docker-compose.yml config
docker compose -f docker-compose.production.yml config
docker compose -f docker-compose.e2e.yml config
git diff --check
```

## 8. Security sweep local

```bash
node scripts/run-security-local.mjs
```

Trình tự local hiện tại:

1. `npm audit` cho `backend`
2. `npm audit` cho `notification-service`
3. `npm audit` cho `finance-service`
4. `npm audit` cho `academic-service`
5. `npm audit` cho `frontend`
6. `gitleaks`
7. `Trivy fs`

## 9. Troubleshooting nhanh

### Khi lệnh có vẻ “đứng”

Ngưỡng tham chiếu:

- local dev: quá 2-3 phút là bất thường
- fast E2E: quá 6-8 phút là bất thường
- edge E2E: quá 10-12 phút là bất thường
- local security full: khoảng 8-10 phút vẫn có thể hợp lý hơn

Khi quá ngưỡng mà log không đổi:

1. kiểm tra process nền
2. kiểm tra container nền
3. kiểm tra Docker daemon
4. kiểm tra listener trên `3000`, `3100`, `4000`, `4001`, `4002`, `4003`, `80`

### Khi Docker daemon tắt

Các bài sau sẽ bị chặn:

- `docker compose ... config` nếu file yêu cầu env chưa set
- `test:e2e:edge`
- `run-image-smoke.mjs`
- mọi integration cần service container thật
- publish registry

Khi đó nên:

1. bật Docker Desktop
2. xác nhận `docker version` trả được server version
3. chạy lại bài runtime nặng thay vì tiếp tục chờ trong trạng thái treo

## 10. Thư mục log tham chiếu

- `frontend/test-results/fast-e2e-stack`
- `frontend/test-results/edge-e2e-stack`
- `frontend/test-results/image-smoke-stack`
- `frontend/test-results/security-local`

## 11. Lưu ý vận hành

- Không public `/internal/*` qua gateway.
- Không cho runtime app container tự chạy migration ở production-like flow.
- `academic-service-init` phải chạy trước khi public academic traffic được đưa vào `academic-service`.
- Khi rollback, ưu tiên SHA tag hoặc digest thay vì `latest`.
