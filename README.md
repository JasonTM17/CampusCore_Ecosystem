# CampusCore - Enterprise Academic Management Platform

<p align="center">
  <img src="https://img.shields.io/badge/version-2.0.0-blue" alt="Version">
  <img src="https://img.shields.io/badge/license-MIT-green" alt="License">
  <img src="https://img.shields.io/badge/status-Production Ready-brightgreen" alt="Status">
  <img src="https://img.shields.io/badge/Docker Hub-nguyenson1710-orange" alt="Docker Hub">
</p>

> A production-grade university academic management and course registration platform built with modern technologies.

## Author

**Nguyễn Tiến Sơn** - Full Stack Developer
- GitHub: [JasonTM17](https://github.com/JasonTM17)
- Email: jasonbmt06@gmail.com

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

## Technology Stack

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

## Features

### Student Portal
- 📚 **Course Registration** - Browse and enroll in courses
- 📅 **Class Schedule** - View weekly timetable with semester filtering
- 📊 **Academic Grades** - View course grades with GPA calculation
- 📜 **Official Transcript** - Comprehensive academic record with cumulative GPA
- 💰 **Tuition Invoices** - View and manage payment invoices
- 📢 **Announcements** - Stay updated with university notices
- 👤 **Profile Management** - Update personal information

### Lecturer Portal
- 📝 **Grade Management** - Input and publish student grades
- 📅 **Teaching Schedule** - View teaching timetable
- 📢 **Course Announcements** - Post announcements for students

### Admin Dashboard
- 👥 **User Management** - Manage students, lecturers, staff
- 📚 **Course Management** - Create and configure courses
- 📅 **Section Management** - Manage class sections and capacity
- ✅ **Enrollment Management** - Monitor and manage enrollments
- 📊 **Analytics Dashboard** - Enrollment statistics and reports
- 🏢 **Department & Faculty** - Organizational structure management

## Architecture

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

## Prerequisites

- Docker and Docker Compose v2.0+
- Docker Hub account (for pulling images)
- 4GB RAM minimum (8GB recommended)
- 20GB disk space

## Environment Variables

Create a `.env` file in the project root:

```bash
# Database
POSTGRES_PASSWORD=your_secure_password

# JWT Secrets (generate secure strings for production)
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

## Quick Start

### Development (Local Build)

```bash
# Clone the repository
git clone https://github.com/JasonTM17/CampusCore_FullStack_Individual.git
cd CampusCore_FullStack_Individual

# Create .env file
cp backend/.env.example .env
# Edit .env with your values

# Build and start all services
docker-compose up -d --build

# View logs
docker-compose logs -f

# Stop all services
docker-compose down
```

### Production (Using Docker Hub Images)

```bash
# Start with pre-built images
docker-compose -f docker-compose.production.yml up -d

# View logs
docker-compose -f docker-compose.production.yml logs -f

# Stop all services
docker-compose -f docker-compose.production.yml down
```

## Building and Publishing to Docker Hub

### Local Build

```bash
# Build backend image
docker build -f backend/Dockerfile -t nguyenson1710/campuscore-backend:latest .

# Build frontend image
docker build -f frontend/Dockerfile -t nguyenson1710/campuscore-frontend:latest .
```

### Tag and Push to Docker Hub

```bash
# Login to Docker Hub
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

### Using the Publish Script

```bash
# Run the helper script (default tag is "latest")
./scripts/docker-publish.sh

# Or specify a custom tag
./scripts/docker-publish.sh v2.0.0
```

> **Note**: On Windows, run the script inside Git Bash or WSL. You can also run `bash ./scripts/docker-publish.sh`.

## GitHub Actions (CI/CD)

The repository includes a GitHub Actions workflow that automatically builds and pushes images to Docker Hub on every push to master/main.

### Required Secrets

Add these secrets in GitHub repository settings:

- `DOCKERHUB_USERNAME`: Your Docker Hub username
- `DOCKERHUB_TOKEN`: Your Docker Hub access token

### Workflow Triggers

- On push to `master` or `main` branch
- Manual trigger via GitHub Actions (workflow_dispatch)

## Ports and Services

| Service    | Port | URL                        |
|------------|------|----------------------------|
| Frontend   | 3001 | http://localhost:3001      |
| Backend    | 3000 | http://localhost:3000      |
| Swagger    | 3000 | http://localhost:3000/api |
| PostgreSQL | 5432 | localhost:5432            |
| Redis      | 6379 | localhost:6379            |
| RabbitMQ   | 5672 | localhost:5672            |
| RabbitMQ UI| 15672| http://localhost:15672    |
| MinIO      | 9000 | http://localhost:9000     |
| MinIO UI   | 9001 | http://localhost:9001    |
| Mailhog    | 8025 | http://localhost:8025     |
| Nginx      | 80   | http://localhost          |
| Prometheus | 9090 | http://localhost:9090     |
| Grafana    | 3002 | http://localhost:3002     |
| Loki       | 3100 | http://localhost:3100     |
| Jaeger     | 16686| http://localhost:16686    |

## Default Credentials

### Grafana
- Username: `admin`
- Password: `admin123` (or set via GRAFANA_PASSWORD env)

### RabbitMQ Management
- Username: `campuscore`
- Password: `campuscore_password` (or set via RABBITMQ_PASSWORD env)

### MinIO
- Username: `campuscore`
- Password: `campuscore_password` (or set via MINIO_PASSWORD env)

## Database Migrations

The backend container runs Prisma migrations automatically on startup.

```bash
# Run migrations manually (if needed)
docker exec -it campuscore-api npx prisma migrate deploy

# Reset database
docker exec -it campuscore-api npx prisma migrate reset

# Generate Prisma client
docker exec -it campuscore-api npx prisma generate
```

## Troubleshooting

### Backend won't start

```bash
# Check logs
docker-compose logs backend

# Verify database connection
docker exec -it campuscore-api sh
# Then run: node -e "require('dotenv').config(); console.log(process.env.DATABASE_URL)"
```

### Database connection issues

- Ensure PostgreSQL container is healthy: `docker-compose ps`
- Check DATABASE_URL format: `postgresql://user:password@hostname:port/database`

### Redis connection issues

- Ensure Redis container is running: `docker-compose ps`
- Check REDIS_URL format: `redis://hostname:6379`

### Frontend build issues

```bash
# Clear Next.js cache
rm -rf frontend/.next

# Rebuild
docker-compose build frontend
```

## API Documentation

Once the backend is running, visit:
- Swagger UI: http://localhost:3000/api
- OpenAPI JSON: http://localhost:3000/api-json

## Production Checklist

- [ ] Change default JWT secrets
- [ ] Use strong PostgreSQL password
- [ ] Configure HTTPS with nginx (SSL certificates)
- [ ] Set up proper logging
- [ ] Configure backup for PostgreSQL
- [ ] Set up monitoring and alerts
- [ ] Configure environment-specific settings
- [ ] Set up domain name and DNS

## License

MIT License - feel free to use for learning or commercial projects.

## Support

For issues and questions:
- Email: jasonbmt06@gmail.com
- GitHub Issues: https://github.com/JasonTM17/CampusCore_FullStack_Individual/issues
