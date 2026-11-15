# Phase 1 — Edge API Gateway + service aliases

## Mục tiêu
Thêm container `edge` (nginx) làm điểm vào duy nhất cho API, chuẩn bị topology đa dịch vụ mà không đụng code hiện có.

## Việc cần làm
1. `ops/edge/nginx.conf`: upstream `sis-core` (restful-api:4010), `enrollment-api` (:4013), `bursar-api` (:4012), `frontend` (:3000). Route:
   - `/api/v1/me/registration*`, `/api/v1/me/enrollments*` → enrollment-api (fallback sis-core khi enrollment chưa có — route cùng upstream ban đầu, chuyển sau ở P3)
   - `/api/v1/me/bursar*` → bursar-api (502 graceful nếu down)
   - `/api/*` → sis-core; `/` → frontend
   - WebSocket/SSE passthrough (`/chat/stream`, notifications)
2. `docker-compose.yml`: thêm service `edge` (nginx:alpine, port 8080), giữ nguyên port hiện tại để không phá demo; thêm alias `sis-core` cho restful-api (network alias).
3. `local-dev.mjs`/`docs/DEMO_RUNBOOK.md`: ghi chú entry mới `:8080`, giữ `:4010`/`:3000` cho tương thích.
4. Contract test script `scripts/edge-route-check.mjs`: assert route table + 404 passthrough.

## Nghiệm thu
- `docker compose up` → `curl localhost:8080/api/v1/site/health` (hoặc endpoint health hiện có) = 200; `/api/v1/me/registration/rounds` qua gateway với token student = 200.
- Web login/SSO/refresh vẫn hoạt động khi đi qua `:8080`.
- CI xanh; không commit `.env`/secret.
