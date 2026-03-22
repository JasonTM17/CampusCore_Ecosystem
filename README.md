# CampusCore — Academic Management Platform

<p align="center">
  <img src="https://img.shields.io/badge/version-2.0.0-blue" alt="Version">
  <img src="https://img.shields.io/badge/license-MIT-green" alt="License">
  <img src="https://img.shields.io/badge/Purpose-Learning%20Project-9b59b6" alt="Purpose">
</p>

> **CampusCore** là dự án học tập cá nhân, xây dựng nền tảng quản lý đào tạo và đăng ký học phần dành cho các trường đại học. Dự án được phát triển nhằm thực hành và trình diễn các công nghệ hiện đại trong phát triển phần mềm full-stack.

---

## Liên hệ & Đóng góp

Mọi ý kiến đóng góp, góp ý, hoặc thắc mắc, xin vui lòng liên hệ qua email:

**📧 jasonbmt06@gmail.com**

---

## Tác giả

**Nguyễn Tiến Sơn** — Full Stack Developer
- GitHub: [JasonTM17](https://github.com/JasonTM17)
- Email: jasonbmt06@gmail.com

---

## Tổng quan kỹ thuật

### Backend
- **Framework**: NestJS (Node.js)
- **Database**: PostgreSQL 15+
- **ORM**: Prisma
- **Cache**: Redis 7+
- **Message Queue**: RabbitMQ 3
- **Object Storage**: MinIO
- **Authentication**: JWT with refresh tokens
- **API Documentation**: Swagger/OpenAPI
- **Email**: Nodemailer (Mailhog for development)
- **Monitoring**: Prometheus, Grafana, Loki, Jaeger

### Frontend
- **Framework**: Next.js 14 (React 18)
- **Language**: TypeScript
- **Styling**: Tailwind CSS
- **UI Components**: shadcn/ui
- **Icons**: Lucide React
- **State Management**: React Context + SWR
- **Forms**: React Hook Form + Zod

### DevOps & Infrastructure
- **Container**: Docker & Docker Compose
- **Reverse Proxy**: Nginx
- **CI/CD**: GitHub Actions
- **Monitoring Stack**: Prometheus + Grafana + Loki + Promtail + Jaeger

---

## Tính năng chính

### Cổng sinh viên
- 📚 **Đăng ký học phần** — Xem và đăng ký các môn học
- 📅 **Lịch học** — Xem thời khóa biểu theo học kỳ
- 📊 **Điểm số** — Xem điểm các môn học và tính GPA
- 📜 **Bảng điểm chính thức** — Bảng điểm tích lũy toàn khóa
- 💰 **Hóa đơn học phí** — Xem và quản lý thanh toán
- 📢 **Thông báo** — Cập nhật thông báo từ nhà trường
- 👤 **Quản lý hồ sơ** — Cập nhật thông tin cá nhân

### Cổng giảng viên
- 📝 **Quản lý điểm** — Nhập và công bố điểm sinh viên
- 📅 **Lịch giảng dạy** — Xem thời khóa biểu giảng dạy
- 📢 **Thông báo môn học** — Đăng thông báo cho sinh viên

### Cổng quản trị
- 👥 **Quản lý người dùng** — Sinh viên, giảng viên, nhân viên
- 📚 **Quản lý môn học** — Tạo và cấu hình môn học
- 📅 **Quản lý lớp học phần** — Quản lý nhóm và sức chứa
- ✅ **Quản lý đăng ký** — Theo dõi và xử lý đăng ký
- 📊 **Bảng phân tích** — Thống kê đăng ký và báo cáo
- 🏢 **Khoa & Bộ môn** — Cấu trúc tổ chức

---

## Docker Hub Images

```
Backend:  nguyenson1710/campuscore-backend:latest
Frontend: nguyenson1710/campuscore-frontend:latest
```

Pull images:
```bash
docker pull nguyenson1710/campuscore-backend:latest
docker pull nguyenson1710/campuscore-frontend:latest
```

---

## Kiến trúc hệ thống

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

## Yêu cầu hệ thống

- Docker và Docker Compose v2.0+
- Tài khoản Docker Hub (để pull images)
- RAM tối thiểu 4GB (khuyến nghị 8GB)
- 20GB dung lượng ổ đĩa

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

## Khởi động nhanh

### Phát triển (Build local)

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

### Production (Sử dụng Docker Hub Images)

```bash
# Khởi động với images đã build sẵn
docker-compose -f docker-compose.production.yml up -d

# Xem logs
docker-compose -f docker-compose.production.yml logs -f

# Dừng tất cả dịch vụ
docker-compose -f docker-compose.production.yml down
```

---

## Build và Push lên Docker Hub

### Build local

```bash
# Build backend image
docker build -f backend/Dockerfile -t nguyenson1710/campuscore-backend:latest .

# Build frontend image
docker build -f frontend/Dockerfile -t nguyenson1710/campuscore-frontend:latest .
```

### Tag và Push lên Docker Hub

```bash
# Login Docker Hub
docker login

# Tag backend
docker tag nguyenson1710/campuscore-backend:latest nguyenson1710/campuscore-backend:latest

# Tag frontend
docker tag nguyenson1710/campuscore-frontend:latest nguyenson1710/campuscore-frontend:latest

# Push backend
docker push nguyenson1710/campuscore-backend:latest

# Push frontend
docker push nguyenson1710/campuscore-frontend:latest
```

### Script hỗ trợ

```bash
# Chạy script (tag mặc định là "latest")
./scripts/docker-publish.sh

# Hoặc chỉ định tag tùy chỉnh
./scripts/docker-publish.sh v2.0.0
```

> **Lưu ý**: Trên Windows, chạy script bên trong Git Bash hoặc WSL. Có thể chạy `bash ./scripts/docker-publish.sh`.

---

## CI/CD với GitHub Actions

Repository đã tích hợp GitHub Actions workflow tự động build và push images lên Docker Hub mỗi khi push lên nhánh master/main.

### Secrets cần thiết

Thêm các secrets sau trong GitHub repository settings:

- `DOCKERHUB_USERNAME`: Tên đăng nhập Docker Hub
- `DOCKERHUB_TOKEN`: Docker Hub access token

### Trigger workflow

- Push lên nhánh `master` hoặc `main`
- Chạy thủ công qua GitHub Actions (workflow_dispatch)

---

## Cổng và Dịch vụ

| Dịch vụ      | Cổng  | URL                         |
|--------------|--------|-----------------------------|
| Frontend     | 3001   | http://localhost:3001       |
| Backend      | 3000   | http://localhost:3000       |
| Swagger      | 3000   | http://localhost:3000/api   |
| PostgreSQL   | 5432   | localhost:5432              |
| Redis        | 6379   | localhost:6379              |
| RabbitMQ     | 5672   | localhost:5672              |
| RabbitMQ UI  | 15672  | http://localhost:15672      |
| MinIO        | 9000   | http://localhost:9000      |
| MinIO UI     | 9001   | http://localhost:9001      |
| Mailhog      | 8025   | http://localhost:8025       |
| Nginx        | 80     | http://localhost           |
| Prometheus   | 9090   | http://localhost:9090       |
| Grafana      | 3002   | http://localhost:3002       |
| Loki         | 3100   | http://localhost:3100       |
| Jaeger       | 16686  | http://localhost:16686      |

---

## Thông tin đăng nhập mặc định

### Grafana
- Username: `admin`
- Password: `admin123` (hoặc đặt qua GRAFANA_PASSWORD env)

### RabbitMQ Management
- Username: `campuscore`
- Password: `campuscore_password` (hoặc đặt qua RABBITMQ_PASSWORD env)

### MinIO
- Username: `campuscore`
- Password: `campuscore_password` (hoặc đặt qua MINIO_PASSWORD env)

---

## Di chuyển Database

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

## Xử lý sự cố

### Backend không khởi động

```bash
# Kiểm tra logs
docker-compose logs backend

# Xác minh kết nối database
docker exec -it campuscore-api sh
# Sau đó chạy: node -e "require('dotenv').config(); console.log(process.env.DATABASE_URL)"
```

### Lỗi kết nối database

- Đảm bảo PostgreSQL container đang chạy: `docker-compose ps`
- Kiểm tra định dạng DATABASE_URL: `postgresql://user:password@hostname:port/database`

### Lỗi kết nối Redis

- Đảm bảo Redis container đang chạy: `docker-compose ps`
- Kiểm tra định dạng REDIS_URL: `redis://hostname:6379`

### Lỗi build Frontend

```bash
# Xóa Next.js cache
rm -rf frontend/.next

# Rebuild
docker-compose build frontend
```

---

## Tài liệu API

Khi backend đang chạy, truy cập:
- Swagger UI: http://localhost:3000/api
- OpenAPI JSON: http://localhost:3000/api-json

---

## Checklist triển khai Production

- [ ] Thay đổi JWT secrets mặc định
- [ ] Sử dụng mật khẩu PostgreSQL mạnh
- [ ] Cấu hình HTTPS với nginx (SSL certificates)
- [ ] Thiết lập logging phù hợp
- [ ] Cấu hình backup cho PostgreSQL
- [ ] Thiết lập monitoring và alerts
- [ ] Cấu hình settings theo môi trường
- [ ] Thiết lập domain name và DNS

---

## Giấy phép

MIT License — sử dụng tự do cho mục đích học tập hoặc thương mại.

---

## Liên hệ

📧 **jasonbmt06@gmail.com**

Mọi góp ý, báo lỗi, hoặc câu hỏi, xin gửi email về địa chỉ trên. Rất mong nhận được phản hồi từ bạn!
