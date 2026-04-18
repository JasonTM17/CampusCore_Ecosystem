# Vận hành CampusCore v2

Tài liệu này mô tả cách boot, kiểm tra và vận hành CampusCore ở trạng thái **Microservices Portfolio v2**.

## 1. Thành phần runtime

Stack runtime hiện tại gồm:

- `frontend`
- `core-api`
- `notification-service`
- `finance-service`
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

Compose dev boot theo thứ tự:

1. `postgres`, `redis`, `rabbitmq`, `minio`
2. `core-api-init`
3. `notification-service-init`
4. `finance-service-init`
5. `core-api`, `notification-service`, `finance-service`, `frontend`, `nginx`

## 3. Boot từng service để debug

Khi cần debug một phần nhỏ, nên chạy đúng entrypoint của service thay vì gọi lệnh mơ hồ ở root:

- `cd backend && npm run start`
- `cd notification-service && npm run start`
- `cd finance-service && npm run start`
- `cd frontend && npm run dev -- --hostname 127.0.0.1 --port 3100`

Ưu tiên local smoke trước khi chạy E2E nặng.

## 4. Bootstrap schema

### Dev và E2E

`docker-compose.yml` và `docker-compose.e2e.yml` dùng one-shot init service:

- `core-api-init`: `prisma db push --skip-generate` và seed deterministic data vào `schema=public`
- `notification-service-init`: `prisma db push --skip-generate` và migrate legacy notification data vào `schema=notifications`
- `finance-service-init`: `prisma db push --skip-generate` và migrate legacy finance data vào `schema=finance`

### Production-like

`docker-compose.production.yml` giữ runtime image sạch. Trước first deploy, chạy bootstrap profile:

```bash
export DOCKERHUB_NAMESPACE=<namespace>
export IMAGE_TAG=v1.0.0
docker compose -f docker-compose.production.yml --profile bootstrap run --rm core-api-init
docker compose -f docker-compose.production.yml --profile bootstrap run --rm notification-service-init
docker compose -f docker-compose.production.yml --profile bootstrap run --rm finance-service-init
```

Sau khi bootstrap xong, mới khởi động runtime stack:

```bash
export DOCKERHUB_NAMESPACE=<namespace>
export IMAGE_TAG=v1.0.0
docker compose -f docker-compose.production.yml up -d
```

## 5. Public edge và internal path

Public traffic luôn đi qua `nginx`:

- `/health` công khai
- `/api/docs` công khai theo cấu hình Swagger
- `/api/v1/notifications/*` qua `notification-service`
- `/socket.io/*` qua `notification-service`
- `/api/v1/finance/*` qua `finance-service`
- auth và route học vụ còn lại đi `core-api`

Không public:

- `/api/v1/health/liveness`
- `/api/v1/health/readiness`
- `/internal/*`

Điểm này đặc biệt quan trọng với finance context API:

- `GET /internal/v1/finance-context/students/:studentId`
- `GET /internal/v1/finance-context/semesters/:semesterId`
- `GET /internal/v1/finance-context/semesters/:semesterId/billable-students`

Các endpoint này chỉ dành cho `finance-service`.

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

Ở môi trường production-like, readiness nội bộ yêu cầu `X-Health-Key`.

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

Một vòng quét local nên bao gồm:

1. `npm audit` cho `backend`
2. `npm audit` cho `notification-service`
3. `npm audit` cho `finance-service`
4. `npm audit` cho `frontend`
5. `gitleaks`
6. `Trivy fs`

## 9. Troubleshooting nhanh

### Khi lệnh có vẻ “đứng im”

Ngưỡng tham chiếu:

- local dev: quá 2-3 phút là bất thường
- fast E2E: quá 6-8 phút là bất thường
- edge E2E: quá 10-12 phút là bất thường
- local security full: 8-10 phút có thể vẫn bình thường hơn do Trivy và Docker scan

Khi quá ngưỡng mà log không đổi:

1. kiểm tra process nền
2. kiểm tra container nền
3. kiểm tra cổng `3000`, `3100`, `4000`, `4001`, `4002`, `80`

### Thư mục log tham chiếu

- `frontend/test-results/fast-e2e-stack`
- `frontend/test-results/edge-e2e-stack`
- `frontend/test-results/image-smoke-stack`
- `frontend/test-results/security-local`

## 10. Lưu ý vận hành

- Không public `/internal/*` qua gateway.
- Không cho runtime app container tự chạy migration ở production-like flow.
- Finance bootstrap phải chạy trước khi `finance-service` nhận traffic thật.
- Khi rollback, ưu tiên rollback theo tag SHA hoặc digest thay vì `latest`.
