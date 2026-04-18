# Vận Hành

Tài liệu này mô tả cách chạy, kiểm tra và xử lý sự cố cho CampusCore trong trạng thái hiện tại.

## Chạy Local

```bash
cp .env.example .env
docker compose up -d --build
```

Mở:

- `http://localhost`
- `http://localhost/api/docs`
- `http://localhost/health`

## Chạy Production-Like

```bash
docker compose -f docker-compose.production.yml up -d
```

Trong mode production-like:

- frontend chạy bằng standalone runtime
- backend chạy từ runtime build thật
- nginx là public entrypoint
- readiness nội bộ yêu cầu `X-Health-Key`

## Health Check

- `GET /health`: liveness công khai
- `GET /api/v1/health/readiness`: readiness nội bộ
- `GET /api/v1/health`: alias tạm thời cho readiness

Nếu đang ở môi trường production-like, readiness phải được bảo vệ bằng `HEALTH_READINESS_KEY`.

## Auth Vận Hành

Browser session dùng cookie:

- `cc_access_token`
- `cc_refresh_token`
- `cc_csrf`

Khi gọi các endpoint mutating từ browser, cần gửi `X-CSRF-Token`.

## Kiểm Thử Vận Hành

Các lớp kiểm tra nên chạy khi muốn xác nhận hệ thống:

- backend lint, format check, typecheck, build, unit test, integration test
- frontend lint, typecheck, build, E2E
- `docker compose ... config` cho dev/prod/e2e
- image smoke production-like
- edge E2E qua nginx

## Xử Lý Sự Cố

### Liveness lên nhưng readiness xuống

Điều này thường có nghĩa là ứng dụng đã boot, nhưng một dependency chưa sẵn sàng hoặc chưa cấu hình. Kiểm tra:

- PostgreSQL
- Redis
- RabbitMQ
- `HEALTH_READINESS_KEY`

### Frontend không lên trong production-like

Kiểm tra:

- image frontend có chạy standalone runtime hay chưa
- nginx có đang trỏ đúng upstream hay không
- biến môi trường public URL có khớp với compose stack không

### Auth cookie không hoạt động

Kiểm tra:

- `COOKIE_SECURE`
- `SameSite`
- `X-CSRF-Token`
- domain/path của cookie trong môi trường đang chạy

## Teardown

Khi chạy stack thử nghiệm, nên dọn sạch tài nguyên compose sau khi kiểm tra xong để tránh container treo và xung đột cổng.

## Tài Liệu Liên Quan

- [Kiến trúc](./ARCHITECTURE.md)
- [Bảo mật](./SECURITY.md)
- [Phát hành](./RELEASE.md)
