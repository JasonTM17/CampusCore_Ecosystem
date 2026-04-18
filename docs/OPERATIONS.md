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

Nếu chỉ cần boot nhanh từng app để kiểm tra local:

```bash
cd backend && npm run start
cd frontend && npm run dev -- --hostname 127.0.0.1 --port 3100
```

Không dùng `npm run dev` ở root. Repo này có nhiều chế độ verify khác nhau nên entrypoint mơ hồ rất dễ làm terminal trông như bị treo.

## Chạy Production-Like

```bash
docker compose -f docker-compose.production.yml up -d
```

Trong mode production-like:

- frontend chạy bằng standalone runtime
- backend chạy từ runtime build thật
- nginx là public entrypoint
- readiness nội bộ yêu cầu `X-Health-Key`

## Chọn Đúng Chế Độ Chạy

- **Debug nhanh local**
  - dùng `backend npm run start` và `frontend npm run dev`
  - phù hợp khi cần kiểm tra app có boot hay render được không
- **Fast verify**
  - dùng `frontend npm run test:e2e`
  - script sẽ tự quản lý Postgres cô lập, seed dữ liệu, rồi chạy Playwright local
- **Production-like verify**
  - dùng `frontend npm run test:e2e:edge`
  - script sẽ build stack Docker, chạy nginx và kiểm tra public edge

Mốc thời gian tham chiếu:

- local dev: thường dưới 2-3 phút
- fast E2E: thường dưới 6-8 phút
- edge E2E: thường dưới 10-12 phút

Log chính khi debug:

- `frontend/test-results/fast-e2e-stack`
- `frontend/test-results/edge-e2e-stack`

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

### Lệnh chạy lâu nhưng không ra gì

Ưu tiên kiểm tra:

- có đang chạy đúng chế độ verify hay không
- có tiến trình `node` mồ côi không còn mở cổng nào không
- có container compose cũ còn giữ tài nguyên không
- log trong `frontend/test-results/*` có còn sinh thêm dòng mới không

Nếu vượt mốc thời gian tham chiếu mà log đứng yên, nên dừng tiến trình đó và khởi động lại bằng đúng entrypoint thay vì chờ vô hạn.

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

### Backend local không lên được

Nếu backend local chết sớm với lỗi Prisma hoặc quyền database, nguyên nhân thường là `backend/.env` đang trỏ vào một Postgres cục bộ không khớp quyền hoặc schema.

Ưu tiên xử lý theo thứ tự:

- override `DATABASE_URL` sang một Postgres cô lập để verify nhanh
- hoặc cập nhật local `.env` để trỏ đúng database thật mà bạn có quyền dùng
- không ép repo dùng chung một database của project khác chỉ để local boot tạm

## Teardown

Khi chạy stack thử nghiệm, nên dọn sạch tài nguyên compose sau khi kiểm tra xong để tránh container treo và xung đột cổng.

## Tài Liệu Liên Quan

- [Kiến trúc](./ARCHITECTURE.md)
- [Bảo mật](./SECURITY.md)
- [Phát hành](./RELEASE.md)
