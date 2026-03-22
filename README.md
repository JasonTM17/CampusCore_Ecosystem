# CampusCore — Academic Management Platform

> Nền tảng quản lý đào tạo và đăng ký học phần dành cho trường đại học.
> Dự án học tập cá nhân — NestJS + Next.js + PostgreSQL + Redis + Docker.

---

## Mục lục

1. [Giới thiệu](#giới-thiệu)
2. [Kiến trúc](#kiến-trúc)
3. [Công nghệ sử dụng](#công-nghệ-sử-dụng)
4. [Tính năng chính](#tính-năng-chính)
5. [Yêu cầu hệ thống](#yêu-cầu-hệ-thống)
6. [Cài đặt](#cài-đặt)
   - [Docker Compose (khuyến nghị)](#docker-compose-khuyến-nghị)
   - [Development local](#development-local)
7. [Biến môi trường](#biến-môi-trường)
8. [Database Migrations (Prisma)](#database-migrations-prisma)
9. [Docker — Build và Push lên Docker Hub](#docker--build-và-push-lên-docker-hub)
10. [CI/CD](#cicd)
11. [Monitoring](#monitoring)
12. [Bảo mật](#bảo-mật)
13. [Xử lý sự cố](#xử-lý-sự-cố)
14. [Đóng góp](#đóng-góp)

---

## Giới thiệu

**CampusCore** là nền tảng quản lý đào tạo và đăng ký học phần, được xây dựng theo kiến trúc **fullstack** với:

- Cổng sinh viên — đăng ký học phần, xem lịch học, điểm số, bảng điểm, hóa đơn
- Cổng giảng viên — nhập điểm, xem lịch giảng dạy
- Cổng quản trị — quản lý người dùng, môn học, lớp học phần, phòng ban
- Hệ thống phân quyền RBAC đầy đủ
- Docker hóa hoàn chỉnh — build và chạy trong container

---

## Kiến trúc

```
┌─────────────────────────────────────────────────────────────┐
│                        Nginx (Reverse Proxy)                │
│                          :80, :443                          │
└─────────────────────────┬───────────────────────────────────┘
                          │
          ┌───────────────┴───────────────┐
          │                               │
    ┌─────▼─────┐                 ┌──────▼──────┐
    │  Backend  │                 │  Frontend   │
    │  (NestJS) │                 │  (Next.js)  │
    │   :3000   │                 │    :3001    │
    └─────┬─────┘                 └──────────────┘
          │
    ┌─────┴─────────────────────────────────────┐
    │                                            │
┌───▼────┐ ┌─────┐ ┌─────────┐ ┌───────┐ ┌──────┐
│Postgres│ │Redis│ │RabbitMQ │ │MinIO  │ │Mailhog│
│  :5432 │ │:6379│ │  :5672  │ │:9000  │ │ :1025 │
└────────┘ └──────┘ └─────────┘ └───────┘ └───────┘
```

---

## Công nghệ sử dụng

| Layer | Công nghệ |
|-------|----------------------------|
| Frontend | Next.js 14 + React 18 + TypeScript + TailwindCSS + shadcn/ui |
| Backend | NestJS + Node.js |
| Database | PostgreSQL 15+ |
| ORM | Prisma |
| Cache | Redis 7+ |
| Message Queue | RabbitMQ 3 |
| Object Storage | MinIO |
| Migrations | Prisma Migrate |
| Security | JWT (access + refresh token) |
| API Docs | Swagger / OpenAPI |
| Container | Docker + Docker Compose |
| CI/CD | GitHub Actions |
| Monitoring | Prometheus + Grafana + Loki + Jaeger |
| Email | Nodemailer (Mailhog for dev) |

---

## Tính năng chính

### Cổng sinh viên

- **Đăng ký học phần** — Xem và đăng ký các môn học
- **Lịch học** — Xem thời khóa biểu theo học kỳ
- **Điểm số** — Xem điểm các môn học và tính GPA
- **Bảng điểm chính thức** — Bảng điểm tích lũy toàn khóa
- **Hóa đơn học phí** — Xem và quản lý thanh toán
- **Thông báo** — Cập nhật thông báo từ nhà trường
- **Quản lý hồ sơ** — Cập nhật thông tin cá nhân

### Cổng giảng viên

- **Quản lý điểm** — Nhập và công bố điểm sinh viên
- **Lịch giảng dạy** — Xem thời khóa biểu giảng dạy
- **Thông báo môn học** — Đăng thông báo cho sinh viên

### Cổng quản trị

- **Quản lý người dùng** — Sinh viên, giảng viên, nhân viên
- **Quản lý môn học** — Tạo và cấu hình môn học
- **Quản lý lớp học phần** — Quản lý nhóm và sức chứa
- **Quản lý đăng ký** — Theo dõi và xử lý đăng ký
- **Bảng phân tích** — Thống kê đăng ký và báo cáo
- **Khoa & Bộ môn** — Cấu trúc tổ chức

---

## Yêu cầu hệ thống

- Docker và Docker Compose v2.0+
- Tài khoản Docker Hub (để pull images)
- RAM tối thiểu 4GB (khuyến nghị 8GB)
- 20GB dung lượng ổ đĩa

---

## Cài đặt

### Docker Compose (khuyến nghị)

```bash
# Clone repository
git clone https://github.com/JasonTM17/CampusCore_FullStack_Individual.git
cd CampusCore_FullStack_Individual

# Tạo file .env
cp backend/.env.example .env
# Chỉnh sửa .env với các giá trị của bạn

# Build và khởi động tất cả dịch vụ
docker-compose up -d --build

# Xem logs
docker-compose logs -f

# Dừng tất cả dịch vụ
docker-compose down
```

### Development local

```bash
# Backend
cd backend
npm install
npx prisma migrate dev
npx prisma generate
npm run start:dev

# Frontend (terminal khác)
cd frontend
npm install
npm run dev
```

---

## Biến môi trường

Tạo file `.env` tại thư mục gốc của dự án:

```bash
# Database
POSTGRES_PASSWORD=your_secure_password

# JWT Secrets (tạo chuỗi bảo mật cho production)
JWT_SECRET=your-super-secret-jwt-key-change-in-production
JWT_REFRESH_SECRET=your-super-secret-refresh-key-change-in-production

# API URLs
NEXT_PUBLIC_API_URL=http://localhost:3000

# Docker Hub
IMAGE_TAG=latest

# MinIO
MINIO_USER=campuscore
MINIO_PASSWORD=your_secure_password

# RabbitMQ
RABBITMQ_USER=campuscore
RABBITMQ_PASSWORD=your_secure_password

# Grafana
GRAFANA_PASSWORD=admin123
```

---

## Database Migrations (Prisma)

Backend container tự động chạy Prisma migrations khi khởi động.

```bash
# Chạy migrations thủ công (nếu cần)
docker exec -it campuscore-api npx prisma migrate deploy

# Reset database
docker exec -it campuscore-api npx prisma migrate reset

# Generate Prisma client
docker exec -it campuscore-api npx prisma generate
```

---

## Docker — Build và Push lên Docker Hub

### Build local

```bash
# Backend
docker build -f backend/Dockerfile -t nguyenson1710/campuscore-backend:latest .

# Frontend
docker build -f frontend/Dockerfile -t nguyenson1710/campuscore-frontend:latest .
```

### Push lên Docker Hub

```bash
# Login Docker Hub
docker login

# Push backend
docker push nguyenson1710/campuscore-backend:latest

# Push frontend
docker push nguyenson1710/campuscore-frontend:latest
```

### Pull pre-built images

```bash
docker pull nguyenson1710/campuscore-backend:latest
docker pull nguyenson1710/campuscore-frontend:latest
```

---

## CI/CD

GitHub Actions workflows tự động chạy:

| Workflow | Trigger | Jobs |
|----------|---------|------|
| `ci.yml` | Push / PR vào `master` | Backend lint + build + test, Frontend lint + build |
| `cd.yml` | Push tag `v*.*.*` vào `master` / push vào `master` | Build và push Docker images lên Docker Hub |

**Secrets cần thiết cho CD (GitHub -> Settings -> Secrets):**

- `DOCKERHUB_USERNAME` — Username Docker Hub
- `DOCKERHUB_PASSWORD` — Password hoặc Access Token Docker Hub

---

## Monitoring

| Service | Port | URL |
|---------|------|-----|
| Frontend | 3001 | http://localhost:3001 |
| Backend | 3000 | http://localhost:3000 |
| Swagger | 3000 | http://localhost:3000/api |
| PostgreSQL | 5432 | localhost:5432 |
| Redis | 6379 | localhost:6379 |
| RabbitMQ | 5672 | localhost:5672 |
| RabbitMQ UI | 15672 | http://localhost:15672 |
| MinIO | 9000 | http://localhost:9000 |
| MinIO UI | 9001 | http://localhost:9001 |
| Mailhog | 8025 | http://localhost:8025 |
| Grafana | 3002 | http://localhost:3002 |
| Prometheus | 9090 | http://localhost:9090 |
| Jaeger | 16686 | http://localhost:16686 |

**Thông tin đăng nhập mặc định:**

| Service | Username | Password |
|---------|----------|----------|
| Grafana | `admin` | `admin123` (hoặc qua `GRAFANA_PASSWORD` env) |
| RabbitMQ | `campuscore` | `campuscore_password` (hoặc qua `RABBITMQ_PASSWORD` env) |
| MinIO | `campuscore` | `campuscore_password` (hoặc qua `MINIO_PASSWORD` env) |

---

## Bảo mật

- **JWT**: Access token + refresh token, secret key được externalize qua env vars
- **RBAC**: Phân quyền theo role + permission tại tất cả endpoint
- **Env vars**: Không bao giờ commit `.env` vào repo — `.gitignore` đã được cấu hình
- **HTTPS**: Cấu hình SSL certificates qua nginx trong production

---

## Xử lý sự cố

### Backend không khởi động

```bash
# Kiểm tra logs
docker-compose logs backend

# Xác minh kết nối database
docker exec -it campuscore-api sh
node -e "require('dotenv').config(); console.log(process.env.DATABASE_URL)"
```

### Lỗi kết nối database

- Đảm bảo PostgreSQL container đang chạy: `docker-compose ps`
- Kiểm tra định dạng `DATABASE_URL`: `postgresql://user:password@hostname:port/database`

### Lỗi kết nối Redis

- Đảm bảo Redis container đang chạy: `docker-compose ps`
- Kiểm tra định dạng `REDIS_URL`: `redis://hostname:6379`

### Lỗi build Frontend

```bash
# Xóa Next.js cache
rm -rf frontend/.next

# Rebuild
docker-compose build frontend
```

---

## Đóng góp

Dự án này phục vụ mục đích học tập cá nhân. Mọi góp ý và đề xuất cải tiến đều được hoan nghênh qua email.

**Email:** jasonbmt06@gmail.com

---

## License

MIT License
