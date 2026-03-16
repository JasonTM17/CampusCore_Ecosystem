# CampusCore - Enterprise Academic Management Platform

<p align="center">
  <img src="https://img.shields.io/badge/version-1.0.0-blue" alt="Version">
  <img src="https://img.shields.io/badge/license-MIT-green" alt="License">
  <img src="https://img.shields.io/badge/status-Production Ready-brightgreen" alt="Status">
</p>

> A production-grade university academic management and course registration platform built with modern technologies.

## Author

**Nguyễn Sơn** - Full Stack Developer
- GitHub: [JasonTM17](https://github.com/JasonTM17)
- Email: jasonbmt06@gmail.com

## Technology Stack

### Backend
- **Framework**: NestJS (Node.js)
- **Database**: PostgreSQL 15+
- **ORM**: Prisma
- **Cache**: Redis 7+
- **Authentication**: JWT with refresh tokens
- **API Documentation**: Swagger/OpenAPI

### Frontend
- **Framework**: Next.js 14 (React)
- **Language**: TypeScript
- **Styling**: Tailwind CSS
- **UI Components**: shadcn/ui
- **Icons**: Lucide React

### DevOps & Infrastructure
- **Container**: Docker & Docker Compose
- **Reverse Proxy**: Nginx
- **CI/CD**: GitHub Actions
- **Load Testing**: k6

## Architecture

- **Backend**: NestJS + Prisma + PostgreSQL + Redis
- **Frontend**: Next.js + TypeScript + Tailwind + shadcn/ui
- **Reverse Proxy**: Nginx

## Image Names

- Backend: `nguyenson1710/campuscore-backend:latest`
- Frontend: `nguyenson1710/campuscore-frontend:latest`

## Prerequisites

- Docker and Docker Compose
- Docker Hub account
- PostgreSQL 15+
- Redis 7+

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
```

## Docker Compose Commands

### Development (Local Build)

```bash
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

### Tag for Docker Hub

```bash
# Tag backend
docker tag nguyenson1710/campuscore-backend:latest nguyenson1710/campuscore-backend:latest

# Tag frontend
docker tag nguyenson1710/campuscore-frontend:latest nguyenson1710/campuscore-frontend:latest
```

### Push to Docker Hub

```bash
# Login to Docker Hub
docker login

# Push backend
docker push nguyenson1710/campuscore-backend:latest

# Push frontend
docker push nguyenson1710/campuscore-frontend:latest
```

## GitHub Actions (CI/CD)

The repository includes a GitHub Actions workflow that automatically builds and pushes images to Docker Hub on every push to master/main.

### Required Secrets

Add these secrets in GitHub repository settings:

- `DOCKERHUB_USERNAME`: Your Docker Hub username
- `DOCKERHUB_TOKEN`: Your Docker Hub access token

### Workflow Triggers

- On push to `master` or `main` branch
- Manual trigger via GitHub Actions (workflow_dispatch)

## Database Migrations

The backend container runs Prisma migrations automatically on startup. Ensure the database is accessible.

```bash
# Run migrations manually (if needed)
docker exec -it campuscore-api npx prisma migrate deploy
```

## Ports and Services

| Service   | Port | URL                    |
|-----------|------|------------------------|
| Backend   | 3000 | http://localhost:3000  |
| Frontend  | 3001 | http://localhost:3001  |
| PostgreSQL| 5432 | localhost:5432         |
| Redis     | 6379 | localhost:6379         |
| Nginx     | 80   | http://localhost       |

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

## Production Checklist

- [ ] Change default JWT secrets
- [ ] Use strong PostgreSQL password
- [ ] Configure HTTPS with nginx
- [ ] Set up proper logging
- [ ] Configure backup for PostgreSQL
- [ ] Set up monitoring and alerts
