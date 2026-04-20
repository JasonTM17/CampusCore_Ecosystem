# Kubernetes Generic Handoff

Tài liệu này chốt handoff cho hai overlay cloud-agnostic:

- `k8s/overlays/staging-generic`
- `k8s/overlays/prod-generic`

Mục tiêu là giữ nguyên topology 9 image và boundary service hiện tại, nhưng để operator có đủ thông tin triển khai lên một cluster staging/prod bất kỳ mà không khóa repo vào một ingress controller, secret manager, hay cloud vendor cụ thể.

## Boundary vận hành

- `k8s/base` là canonical runtime base
- `k8s/bootstrap` là one-shot init jobs theo đúng thứ tự bootstrap schema/data
- `staging-generic` và `prod-generic` chỉ override đúng phần môi trường:
  - namespace
  - `ConfigMap` public config
  - `Secret` placeholders
  - `Ingress`
  - `campuscore-nginx` kiểu `ClusterIP`

`campuscore-nginx` phải tiếp tục đứng sau `Ingress`; public edge contract của repo không đổi.

## Ingress và TLS

Hai overlay generic cố ý **không** hard-code `ingressClassName`. Ý nghĩa của quyết định này:

- nếu cluster có default ingress class, operator có thể apply trực tiếp
- nếu cluster cần ingress class riêng, operator nên thêm private overlay hoặc patch riêng theo môi trường
- repo không tự giả định `nginx`, `traefik`, `alb`, hay controller cụ thể khác

Placeholder hiện tại:

| Overlay | Hostname placeholder | TLS secret placeholder |
| --- | --- | --- |
| `staging-generic` | `staging.campuscore.example.com` | `campuscore-staging-tls` |
| `prod-generic` | `campuscore.example.com` | `campuscore-prod-tls` |

TLS secret phải do operator/cluster cung cấp. Repo không commit cert/key thật.

Nếu dùng Cloudflare sau này, Cloudflare chỉ đứng ở lớp DNS/WAF/CDN phía trước ingress. Nó không thay runtime cluster, không thay service boundary, và không thay `nginx` nội bộ của CampusCore.

## ConfigMap vs Secret mapping

### ConfigMap (`campuscore-shared-env`)

Các giá trị này là config thường, có thể để trong `ConfigMap`:

| Key | Dùng cho | Ghi chú |
| --- | --- | --- |
| `SWAGGER_ENABLED` | backend services | staging/prod generic mặc định `false` |
| `COOKIE_SECURE` | browser auth contract | generic overlays mặc định `true` |
| `FRONTEND_URL` | auth/session/email links | phải khớp hostname công khai của môi trường |

### Secret (`campuscore-secrets`)

Các giá trị này phải được operator thay bằng giá trị thật trước khi apply lên shared/public cluster:

| Key | Dùng cho | Bắt buộc |
| --- | --- | --- |
| `POSTGRES_PASSWORD` | PostgreSQL cluster | có |
| `JWT_SECRET` | access token signing | có |
| `JWT_REFRESH_SECRET` | refresh token signing | có |
| `HEALTH_READINESS_KEY` | internal readiness probe auth | có |
| `INTERNAL_SERVICE_TOKEN` | service-to-service internal APIs | có |
| `RABBITMQ_PASSWORD` | RabbitMQ auth | có |
| `MINIO_USER` | MinIO access key | có |
| `MINIO_PASSWORD` | MinIO secret key | có |
| `SMTP_USER` | outbound email | tùy môi trường |
| `SMTP_PASSWORD` | outbound email | tùy môi trường |

Operator nên xem `stringData` trong overlay generic là **placeholder contract**, không phải giá trị mặc định có thể dùng thật.

## Private overlay pattern

Repo public chỉ giữ placeholder generic. Nếu môi trường thật dùng:

- External Secrets
- Sealed Secrets
- SOPS
- ingress class patch riêng
- hostnames thật
- requests/limits hoặc rollout policy riêng

thì nên tạo thêm private overlay nội bộ kế thừa từ:

- `k8s/overlays/staging-generic`, hoặc
- `k8s/overlays/prod-generic`

Private overlay đó là nơi hợp lệ để:

- bind secret manager của tổ chức
- gắn `ingressClassName`
- thay hostname thật
- thêm annotations của ingress/load balancer
- override resources/replicas/rollout strategy

## Operator checklist

1. Chọn overlay phù hợp: staging hoặc prod generic
2. Thay toàn bộ `stringData` placeholder bằng secret thật hoặc patch sang secret manager riêng
3. Xác nhận `FRONTEND_URL` khớp hostname công khai
4. Cấp TLS secret đúng tên hoặc patch lại tên secret
5. Thêm ingress class/annotations bằng private overlay nếu cluster yêu cầu
6. Apply `k8s/base`/overlay runtime
7. Chạy bootstrap jobs theo đúng thứ tự operator-managed
8. Verify:
   - `/health`
   - `/api/docs` nếu môi trường đó cho phép
   - deny `/api/v1/internal/*`
   - auth/session/browser flow

## Release interaction

- Local-first path vẫn dùng `k8s/overlays/docker-desktop`
- Generic overlays là handoff cho staging/prod, không thay quy trình local smoke/deploy
- Base Kustomize tiếp tục trỏ tới GHCR public images của release hiện hành; Docker Hub là đường override nếu operator muốn dùng registry đó
