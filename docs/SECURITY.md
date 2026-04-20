# Security

## Auth and session

- Browser flow dùng `cc_access_token`, `cc_refresh_token`, `cc_csrf`.
- Request mutating qua cookie phải gửi `X-CSRF-Token`.
- Legacy bearer vẫn được giữ để tương thích với client cũ và service-to-service cases cần token.

## Internal route protection

- Canonical internal routes dùng `/api/v1/internal/*`.
- `nginx` chặn cả `/internal/*` và `/api/v1/internal/*`.
- Internal controllers yêu cầu `X-Service-Token`.

## Health exposure

- Public edge chỉ expose `/health`.
- Readiness nội bộ không đi qua public edge.
- Production-like path dùng `X-Health-Key` cho readiness.

## Security verification

Quality gate hiện tại bắt buộc:

- `npm audit` cho toàn bộ package
- `gitleaks`
- `Trivy fs`
- `Trivy image`

`security-scan` phải bao phủ đủ:

- `core-api`
- `auth-service`
- `notification-service`
- `finance-service`
- `academic-service`
- `engagement-service`
- `people-service`
- `analytics-service`
- `frontend`
- `packages/platform-auth`

## Known transitional limitations

- `people-service` vẫn cần shadow sync về `core-api` trong một release chuyển tiếp để không làm gãy JWT claims.
- `analytics-service` vẫn đọc dữ liệu legacy/shadow trong `public` schema để giữ low-risk.
- PostgreSQL vẫn là shared cluster theo mô hình multi-schema, chưa tách cluster độc lập theo service.
- Docker Hub publish nên dùng PAT qua `DOCKERHUB_TOKEN`; không nên dùng account password thật trong CI/CD.
