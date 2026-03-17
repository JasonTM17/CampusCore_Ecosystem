# Docker Hub Repositories - CampusCore

<p align="center">
  <img src="https://img.shields.io/badge/version-2.0.0-blue" alt="Version">
  <img src="https://img.shields.io/badge/Docker-Pulled-2496ED?style=for-the-badge&logo=docker" alt="Docker">
</p>

---

## CampusCore - Enterprise Academic Management Platform

**Full-stack university course registration system**

> Production-ready academic management platform for universities with student enrollment, grade management, scheduling, and more.

### 🐳 Docker Images

#### Backend API
```bash
docker pull nguyenson1710/campuscore-backend:latest
```

| Property | Value |
|----------|-------|
| Image | `nguyenson1710/campuscore-backend:latest` |
| Framework | NestJS (Node.js) |
| Database | PostgreSQL 15+ |
| ORM | Prisma |
| Cache | Redis 7+ |
| Message Queue | RabbitMQ 3 |
| Port | 3000 |
| Swagger | `/api` |

#### Frontend Web App
```bash
docker pull nguyenson1710/campuscore-frontend:latest
```

| Property | Value |
|----------|-------|
| Image | `nguyenson1710/campuscore-frontend:latest` |
| Framework | Next.js 14 (React 18) |
| Language | TypeScript |
| Styling | Tailwind CSS + shadcn/ui |
| Port | 3001 |
| Features | Dark mode, Responsive, Dashboard |

---

## Quick Start

### Pull and Run

```bash
# 1. Pull both images
docker pull nguyenson1710/campuscore-backend:latest
docker pull nguyenson1710/campuscore-frontend:latest

# 2. Run with docker-compose
# Create docker-compose.yml with the images
```

### Using Docker Compose

```yaml
version: '3.8'

services:
  backend:
    image: nguyenson1710/campuscore-backend:latest
    container_name: campuscore-api
    environment:
      DATABASE_URL: postgresql://user:password@postgres:5432/campuscore
      JWT_SECRET: your-jwt-secret
      REDIS_URL: redis://redis:6379
    ports:
      - "3000:3000"

  frontend:
    image: nguyenson1710/campuscore-frontend:latest
    container_name: campuscore-web
    environment:
      NEXT_PUBLIC_API_URL: http://localhost:3000
    ports:
      - "3001:3000"
```

---

## Features

### Student Features
- ✅ Course Registration & Enrollment
- ✅ Class Schedule View
- ✅ Academic Grades with GPA
- ✅ Official Transcript
- ✅ Tuition Invoices
- ✅ Announcements
- ✅ Profile Management

### Lecturer Features
- ✅ Grade Management
- ✅ Teaching Schedule
- ✅ Course Announcements

### Admin Features
- ✅ User Management
- ✅ Course Management
- ✅ Section Management
- ✅ Enrollment Management
- ✅ Analytics Dashboard
- ✅ Department & Faculty Management

---

## Environment Variables

### Backend Required
| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET` | JWT access token secret |
| `JWT_REFRESH_SECRET` | JWT refresh token secret |
| `REDIS_URL` | Redis connection URL |
| `RABBITMQ_URL` | RabbitMQ connection URL |

### Frontend Required
| Variable | Description |
|----------|-------------|
| `NEXT_PUBLIC_API_URL` | Backend API URL |

---

## Default Ports

| Service | Port |
|---------|------|
| Frontend | 3001 |
| Backend API | 3000 |
| PostgreSQL | 5432 |
| Redis | 6379 |

---

## Building Locally

If you want to build images locally:

```bash
# Clone repository
git clone https://github.com/JasonTM17/CampusCore_FullStack_Individual.git
cd CampusCore_FullStack_Individual

# Build backend
docker build -f backend/Dockerfile -t nguyenson1710/campuscore-backend:latest .

# Build frontend
docker build -f frontend/Dockerfile -t nguyenson1710/campuscore-frontend:latest .

# Push to Docker Hub
docker login
docker push nguyenson1710/campuscore-backend:latest
docker push nguyenson1710/campuscore-frontend:latest
```

---

## Tech Stack Details

### Backend Technologies
- **Runtime**: Node.js 20+
- **Framework**: NestJS
- **Database**: PostgreSQL 15
- **ORM**: Prisma
- **Cache**: Redis 7
- **Message Queue**: RabbitMQ 3
- **Auth**: JWT with Refresh Tokens
- **API Docs**: Swagger/OpenAPI
- **Monitoring**: Prometheus, Grafana, Jaeger

### Frontend Technologies
- **Framework**: Next.js 14
- **UI Library**: React 18
- **Language**: TypeScript
- **Styling**: Tailwind CSS
- **Components**: shadcn/ui
- **Icons**: Lucide React
- **Forms**: React Hook Form + Zod
- **HTTP**: Axios

---

## Author

**Nguyễn Tiến Sơn** - Full Stack Developer

<div align="center">

[![GitHub](https://img.shields.io/badge/GitHub-JasonTM17-black?style=flat&logo=github)](https://github.com/JasonTM17)
[![Email](https://img.shields.io/badge/Email-jasonbmt06%40gmail.com-red?style=flat&logo=gmail)](mailto:jasonbmt06@gmail.com)

</div>

---

## Other Repositories

### JobHunter - Job Portal Application

```
nguyenson1710/jobhunter-backend:latest
nguyenson1710/jobhunter-frontend:latest
```

Full-stack job search and recruitment platform.

---

*For more details, visit the [GitHub Repository](https://github.com/JasonTM17/CampusCore_FullStack_Individual)*
