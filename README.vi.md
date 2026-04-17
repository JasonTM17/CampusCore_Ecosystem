# CampusCore

[![CI](https://github.com/JasonTM17/CampusCore_FullStack_Individual/actions/workflows/ci.yml/badge.svg)](https://github.com/JasonTM17/CampusCore_FullStack_Individual/actions/workflows/ci.yml)
[![CD](https://github.com/JasonTM17/CampusCore_FullStack_Individual/actions/workflows/cd.yml/badge.svg)](https://github.com/JasonTM17/CampusCore_FullStack_Individual/actions/workflows/cd.yml)
![Next.js](https://img.shields.io/badge/frontend-Next.js%2015-111827)
![NestJS](https://img.shields.io/badge/backend-NestJS%2010-e11d48)
![License](https://img.shields.io/badge/license-MIT-16a34a)

CampusCore la nen tang quan ly dao tao, dang ky hoc phan, lich hoc, diem so, hoa don hoc phi, thong bao, va van hanh quan tri.

Du an giu backend o dang mot ung dung NestJS co the deploy doc lap, nhung duoc verify theo kieu production-like multi-service thong qua nginx, PostgreSQL, Redis, RabbitMQ, MinIO, va bo edge E2E tap trung.

## Bao Gom Gi

- Cong sinh vien, giang vien, va quan tri
- Frontend Next.js 15 chay standalone runtime trong Docker
- Backend NestJS 10 voi Prisma, JWT auth, Swagger, va websocket auth
- PostgreSQL, Redis, RabbitMQ, MinIO, Mailhog, nginx, va monitoring stack
- Fast local E2E cung edge E2E di qua nginx

## Runtime Contract Cong Khai

| URL | Muc dich |
| --- | --- |
| `http://localhost` | Cong vao cong khai qua nginx |
| `http://localhost/login` | Trang dang nhap |
| `http://localhost/health` | Health endpoint cong khai |
| `http://localhost/api/docs` | Swagger UI qua nginx |
| `http://localhost:4000/api/v1/health` | Health truc tiep cua backend trong local stack |

Frontend lang nghe trong Docker o cong `3000`, backend o cong `4000`, va nginx la mat ngo cong khai duy nhat trong cac compose stack.

## Khu Vuc Tinh Nang

### Cong Sinh Vien

- Dang ky hoc phan
- Xem lich hoc theo tuan
- Xem diem va bang diem
- Theo doi hoa don hoc phi
- Xem thong bao
- Quan ly ho so ca nhan

### Cong Giang Vien

- Lich giang day
- Quan ly diem
- Flow empty state an toan khi chua co du lieu

### Cong Quan Tri

- Quan ly nguoi dung
- Quan ly mon hoc va lop hoc phan
- Quan ly dang ky
- Dashboard van hanh

## Ghi Chu Kien Truc

- Frontend: Next.js 15, React 18, TypeScript, Tailwind CSS
- Backend: NestJS 10, Prisma, PostgreSQL, JWT, Socket.IO
- Runtime services: Redis, RabbitMQ, MinIO, Mailhog, nginx
- Observability: Prometheus, Grafana, Loki, Promtail, Jaeger

Trong dot nay, CampusCore khong tach backend thanh cac microservice rieng. Thay vao do, repo verify mot deployable backend duy nhat cung toan bo service xung quanh, de hanh vi runtime van giong mot he thong nhieu thanh phan that.

## Container Images

### Docker Hub

- `nguyenson1710/campuscore-backend`
- `nguyenson1710/campuscore-frontend`

### GitHub Packages (GHCR)

- `ghcr.io/jasontm17/campuscore-backend`
- `ghcr.io/jasontm17/campuscore-frontend`

Chien luoc tag dong bo tren cac registry:

- `latest`
- tag phien ban nhu `v1.0.0`
- tag commit SHA bat bien nhu `0f8bc44`

Vi du pull image:

```bash
docker pull nguyenson1710/campuscore-backend:v1.0.0
docker pull nguyenson1710/campuscore-frontend:v1.0.0
docker pull ghcr.io/jasontm17/campuscore-backend:v1.0.0
docker pull ghcr.io/jasontm17/campuscore-frontend:v1.0.0
```

## Khoi Dong Nhanh

### Local Full Stack

```bash
cp .env.example .env
docker compose up -d --build
```

Mo:

- `http://localhost`
- `http://localhost/api/docs`
- `http://localhost/health`

### Production-like Image Stack

```bash
docker compose -f docker-compose.production.yml up -d
```

Can dat cac bien sau trong `.env` truoc khi chay production image stack:

- `POSTGRES_PASSWORD`
- `JWT_SECRET`
- `JWT_REFRESH_SECRET`
- `RABBITMQ_PASSWORD`
- `MINIO_PASSWORD`
- `GRAFANA_PASSWORD`
- `DOCKERHUB_NAMESPACE`
- `IMAGE_TAG`

`NEXT_PUBLIC_API_URL` co the de trong khi frontend di qua same-origin routing cua nginx.

## Verify Va Test

Repo duoc khoa chat bang:

- backend lint, format check, typecheck, build, va test
- frontend lint, typecheck, build, va smoke test
- Playwright fast E2E de lap nhanh local
- Playwright edge E2E di qua nginx de verify production-like
- Docker compose config validation cho dev, prod, va E2E stacks

Browser E2E hien tai cover:

- load cong khai cho `/` va `/login`
- dang nhap sinh vien va mo chi tiet hoa don
- dang nhap admin va thao tac tren trang user management
- dang nhap giang vien va mo flow lich day hoac empty state hop le
- health va Swagger qua nginx
- websocket auth smoke voi token hop le va token sai

## CI/CD

GitHub Actions hien co:

- `CI Build and Test` cho backend, frontend, va edge E2E
- `CD - Registry Publish` de publish image len registry

Hanh vi registry:

- Docker Hub uu tien `DOCKERHUB_NAMESPACE`
- `DOCKERHUB_USERNAME` van duoc giu lam legacy alias de tuong thich
- GitHub Container Registry tu dong dung namespace cua repository owner
- push len `master`, `main`, va version tag se publish `latest` hoac tag release cung commit SHA

## Tai Lieu

- [README goc](./README.md)
- [English Guide](./README.en.md)
- [Docker Hub Notes](./DOCKER_HUB.md)

## Tac Gia

Nguyen Tien Son

- GitHub: [JasonTM17](https://github.com/JasonTM17)
- Email: [jasonbmt06@gmail.com](mailto:jasonbmt06@gmail.com)
