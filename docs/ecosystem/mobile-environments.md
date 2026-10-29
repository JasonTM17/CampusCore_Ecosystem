# Mobile environments — cách chạy app CampusUTE (Expo)

App di động (`mobile/`, Expo ~57 / React Native 0.86) có đúng ba cách chạy, được
chọn bằng hai biến công khai trong `mobile/.env` (gitignored; mẫu ở
`mobile/.env.example`):

- `EXPO_PUBLIC_API_MODE` — `preview` (mặc định an toàn) hoặc `live`.
- `EXPO_PUBLIC_API_URL` — base URL đến REST API, ví dụ `http://10.0.2.2:4010/api/v1`.

`EXPO_PUBLIC_*` được nhúng vào bundle mobile → **public by definition**: tuyệt đối
không chứa secret. App không bao giờ kết nối database; nó chỉ gọi HTTP API qua
`mobile/src/api/client.ts`.

## 1. Preview / sample-data mode

```
EXPO_PUBLIC_API_MODE=preview
```

- App dùng nội dung mẫu cục bộ; **không gọi mạng**. Mọi live request bị client
  chặn với lỗi `MOBILE_API_PREVIEW`.
- Được: duyệt UI, điều hướng, theme, màn hình với dữ liệu mẫu.
- Không được: đăng nhập thật, dữ liệu thật, đăng ký học phần, lane dean/staff/admin.
- Không cần backend, Docker hay DB chạy.

## 2. Live mode — backend local (Compose)

```
EXPO_PUBLIC_API_MODE=live
# Android emulator:
EXPO_PUBLIC_API_URL=http://10.0.2.2:4010/api/v1
# Điện thoại thật (cùng mạng LAN với máy dev):
# EXPO_PUBLIC_API_URL=http://<LAN-IP-của-máy-dev>:4010/api/v1
```

- `10.0.2.2` là alias của host machine nhìn từ Android emulator — không phải
  `localhost` của thiết bị. Điện thoại vật lý không có alias này → phải dùng IP
  LAN thật (ví dụ `192.168.x.x`) và cổng `RESTFUL_API_HOST_PORT` (mặc định 4010)
  của cụm `docker-compose.yml`.
- Được: đăng nhập tài khoản đã mở khoá, gọi API thật, luồng e2e local.
- Không được nếu: backend chưa chạy, `DEMO_ACCOUNTS_ENABLED` chưa bật cho tài
  khoản demo (migration V48 khoá sẵn), hoặc issuer OIDC chưa cấu hình.
- HTTPS/Không phải bắt buộc ở dev, nhưng cookie/session vẫn theo cơ chế Bearer
  access+refresh token của app (không dùng cookie web).

## 3. Live mode — API production (anonymous content only)

```
EXPO_PUBLIC_API_MODE=live
EXPO_PUBLIC_API_URL=https://www.campusute.io.vn/api/v1
```

- Được: đọc nội dung công khai/ẩn danh từ backend production.
- **Không được: đăng nhập.** Production sign-in đi qua OIDC issuer
  `id.campusute.io.vn` (xem `docs/ecosystem/identity-contract.md`,
  `docs/ecosystem/mobile-policy.md`); khi issuer host khác API host, app còn cần
  `EXPO_PUBLIC_ISSUER_URL` trỏ đến issuer đó.
- **Open infrastructure item (2026-10-29):** DNS của `id.campusute.io.vn` không
  resolve tại thời điểm audit — luồng đăng nhập production trên mobile đang bị
  chặn bởi hạ tầng, không phải lỗi app.

## Ranh giới dữ liệu

- **App không bao giờ kết nối database trực tiếp.** PostgreSQL/Neon chỉ reachable
  bởi backend (`SPRING_DATASOURCE_URL`/`ASSISTANT_DB_URL` ở server); mobile chỉ
  gọi `/api/v1` qua HTTP Bearer token.
- EAS build profiles (`mobile/eas.json`) development/preview/production phân phối
  nội bộ; giá trị `EXPO_PUBLIC_*` được bake lúc build — đổi biến phải rebuild.
