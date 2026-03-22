# CampusCore — Load Testing Setup

> **Lưu ý**: Đây là module kiểm thử tải của dự án học tập **CampusCore**, phục vụ mục đích thực hành và đánh giá hiệu năng hệ thống.

## Giới thiệu

Module này chứa bộ kiểm thử tải cho ứng dụng CampusCore, sử dụng công cụ [k6](https://k6.io/docs/getting-started/installation/).

## Yêu cầu

- [k6](https://k6.io/docs/getting-started/installation/) đã được cài đặt trên hệ thống
- Docker và Docker Compose (để chạy ứng dụng)
- Node.js (tùy chọn, để chạy seed data)

## Khởi động nhanh

### 1. Khởi động ứng dụng

```bash
# Khởi động tất cả dịch vụ
docker compose up -d

# Chờ các dịch vụ sẵn sàng
docker compose ps
```

### 2. Chạy kiểm thử

#### PowerShell (Windows)

```powershell
# Smoke test — kiểm tra chức năng cơ bản
.\load-tests\scripts\run-tests.ps1 smoke

# Load test — kiểm tra tải
.\load-tests\scripts\run-tests.ps1 load

# Stress test — kiểm tra giới hạn
.\load-tests\scripts\run-tests.ps1 stress
```

#### Bash (Linux/Mac)

```bash
# Smoke test
./load-tests/scripts/run-tests.sh smoke

# Load test
./load-tests/scripts/run-tests.sh load

# Stress test
./load-tests/scripts/run-tests.sh stress
```

## Các cấu hình kiểm thử

| Cấu hình | Mô tả                      | VUs  | Thời lượng | Trường hợp sử dụng            |
|----------|----------------------------|------|------------|-------------------------------|
| smoke    | Kiểm tra chức năng cơ bản | 1    | 30s        | Xác nhận hệ thống hoạt động  |
| load     | Tải cơ bản                | 5–10 | 2 phút     | Mô phỏng lưu lượng bình thường |
| stress   | Tìm điểm giới hạn         | 10–50| 4 phút     | Xác định ngưỡng chịu tải      |
| spike    | Bùng nổ lưu lượng         | 5–50 | 1 phút     | Xử lý đột biến traffic        |
| soak     | Kiểm thử dài hạn          | 10   | 5 phút     | Phát hiện rò rỉ bộ nhớ       |

## Biến môi trường

| Biến              | Mặc định                    | Mô tả                    |
|-------------------|-----------------------------|--------------------------|
| `BASE_URL`        | http://localhost            | Base URL ứng dụng        |
| `API_BASE_URL`    | http://localhost/api/v1      | Base URL API             |
| `K6_USERS_EMAIL`  | student1@campuscore.edu      | Email sinh viên test     |
| `K6_USERS_PASSWORD`| (đặt trong .env)           | Mật khẩu sinh viên test  |
| `K6_ADMIN_EMAIL`  | admin@campuscore.edu         | Email admin test         |
| `K6_ADMIN_PASSWORD`| (đặt trong .env)           | Mật khẩu admin test      |

## Cấu trúc dự án

```
load-tests/
├── configs/              # Cấu hình kiểm thử
│   └── base-config.js
├── helpers/              # Các hàm tiện ích
│   ├── auth.js          # Hỗ trợ xác thực
│   ├── config.js        # Cấu hình
│   └── requests.js      # Wrapper HTTP request
├── scenarios/           # Kịch bản nghiệp vụ
│   ├── admin-portal-scenarios.js
│   ├── auth-scenarios.js
│   ├── common.js
│   └── student-portal-scenarios.js
├── scripts/             # Script chạy kiểm thử
│   ├── run-tests.ps1   # PowerShell
│   └── run-tests.sh    # Bash
├── src/                # Entry point chính
│   └── main.js
├── reports/            # Kết quả kiểm thử (tự động tạo)
│   └── *.json
└── README.md           # File này
```

## Kịch bản kiểm thử

### Luồng xác thực
- Đăng nhập
- Lấy thông tin người dùng hiện tại
- Đăng xuất

### Cổng sinh viên
- Lấy danh sách học phần có sẵn
- Lấy danh sách đăng ký của tôi
- Lấy điểm của tôi
- Lấy lịch học của tôi
- Lấy bảng điểm của tôi
- Lấy hóa đơn của tôi

### Cổng quản trị
- Lấy tổng quan phân tích
- Lấy tất cả học phần
- Lấy tất cả đăng ký
- Lấy tất cả sinh viên
- Lấy các học kỳ
- Lấy thông báo

## Ngưỡng kiểm thử

Các ngưỡng mặc định:

- **p95 latency**: < 500ms
- **p99 latency**: < 1000ms
- **Tỷ lệ lỗi**: < 1%
- **Throughput**: > 5 req/s (load), > 10 req/s (stress)

## Kết quả kiểm thử

Kết quả được lưu vào file JSON trong `load-tests/reports/`:

- `smoke-results.json`
- `load-results.json`
- `stress-results.json`
- `spike-results.json`
- `soak-results.json`

## Tích hợp Monitoring

### Prometheus + Grafana (Tùy chọn)

Để bật xuất metrics:

```powershell
k6 run load-tests\src\main.js `
    --out prometheus `
    --prometheus-labels "env=local,app=campuscore"
```

## Xử lý sự cố

### Kiểm thử thất bại với "connection refused"
- Đảm bảo Docker containers đang chạy: `docker compose ps`
- Kiểm tra backend: `curl http://localhost/api/v1/health`

### Lỗi xác thực
- Kiểm tra credentials trong file `.env`
- Đảm bảo users tồn tại trong database

### Tỷ lệ lỗi cao
- Kiểm tra logs ứng dụng: `docker logs campuscore-api`
- Kiểm tra kết nối database
- Xem chi tiết lỗi trong output k6

## Tích hợp CI/CD

Ví dụ GitHub Actions workflow:

```yaml
name: Load Tests

on:
  schedule:
    - cron: '0 2 * * *'  # Chạy hàng ngày lúc 2h sáng
  workflow_dispatch:

jobs:
  load-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: grafana/k6-action@v0.2
        with:
          filename: load-tests/src/main.js
          flags: --duration 2m --vus 10
        env:
          API_BASE_URL: ${{ secrets.API_BASE_URL }}
```

## Giấy phép

MIT License — phục vụ mục đích học tập.
