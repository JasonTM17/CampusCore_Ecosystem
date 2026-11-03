# Mobile environments — cách chạy app CampusUTE (Expo)

App trong `mobile/` được phát triển với dịch vụ local. Repo này chưa cấu hình
API, portal hoặc identity issuer production; host cho ecosystem sẽ được chọn sau.

| Biến | Hành vi |
| --- | --- |
| `EXPO_PUBLIC_API_MODE` | Chế độ API: `live` (mặc định) gọi API đã cấu hình; `preview` dùng dữ liệu mẫu, không gọi mạng. |
| `EXPO_PUBLIC_API_URL` | Android Emulator local API: `http://10.0.2.2:4010/api/v1`. Build non-development cần HTTPS trừ khi local cleartext opt-in dùng host loopback được phép. |
| `EXPO_PUBLIC_ALLOW_CLEARTEXT_LOCAL` | Chỉ `1` trong EAS profile `local`. HTTP chỉ được dùng với `localhost`, `127.0.0.1`, `10.0.2.2`, `::1`; Android cleartext chỉ bật cho profile này. |
| `EXPO_PUBLIC_PORTAL_URL` | Tuỳ chọn. Development mặc định `https://portal.localhost:3102`; nếu unset trong build non-development, các thao tác mở web không hiện. |
| `EXPO_PUBLIC_ISSUER_URL` | Tuỳ chọn để ghi đè local OIDC issuer khi khác API host. Không có production issuer trong repo. |

## Chạy local

`docker-compose.yml` định nghĩa service `restful-api`, host port
`RESTFUL_API_HOST_PORT` (mặc định `4010`) và API path `/api/v1`. Android Emulator
dùng `10.0.2.2`; EAS profile `local` cấu hình URL và cleartext opt-in này.
Lệnh `npx expo start` chạy app development mode với cùng URL API local.

`mobile/app.config.js` chỉ thêm Android cleartext manifest plugin khi
`CAMPUSUTE_MOBILE_PROFILE=local` và
`EXPO_PUBLIC_ALLOW_CLEARTEXT_LOCAL=1`. Profile `preview` và `production` không
đặt các biến local này.

Giá trị `EXPO_PUBLIC_*` được bake vào bundle, không được chứa secret. App chỉ
gọi API; nó không kết nối PostgreSQL trực tiếp.
