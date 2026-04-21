# Kubernetes Generic Handoff

Tài liệu này chốt handoff cho hai overlay cloud-agnostic:

- `k8s/overlays/staging-generic`
- `k8s/overlays/prod-generic`

và hai overlay operator kế thừa từ lớp generic:

- `k8s/overlays/staging-operator`
- `k8s/overlays/prod-operator`

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
- `staging-operator` và `prod-operator` giữ nguyên các override đó nhưng thay `Secret` placeholder bằng `ExternalSecret` và thêm `Certificate` để handoff cho operator rõ hơn

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

Nếu dùng Cloudflare sau này, Cloudflare chỉ đứng ở lớp DNS/WAF/CDN phía trước ingress. Nó không thay runtime cluster, không thay service boundary, và không thay `nginx` nội bộ của CampusCore. Runbook chi tiết cho DNS, TLS Full Strict, cert-manager DNS-01, và private overlay nằm tại [CLOUDFLARE.md](./CLOUDFLARE.md).

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

## Operator overlays

Nếu cluster đã có các CRD/operator sau:

- `external-secrets.io/v1beta1`
- `cert-manager.io/v1`

thì operator có thể bắt đầu luôn từ:

- `k8s/overlays/staging-operator`
- `k8s/overlays/prod-operator`

Hai overlay này kế thừa toàn bộ ingress/config/service shape từ lớp generic, nhưng thay cơ chế secrets/TLS như sau:

- xóa `Secret campuscore-secrets` placeholder ra khỏi render cuối
- thêm `ExternalSecret campuscore-secrets`
- thêm `Certificate campuscore-tls`

Các placeholder mới trong lớp operator:

| Overlay | ClusterSecretStore placeholder | ClusterIssuer placeholder | Remote secret key placeholder |
| --- | --- | --- | --- |
| `staging-operator` | `replace-with-staging-cluster-secret-store` | `replace-with-staging-cluster-issuer` | `replace-with-staging/campuscore/runtime` |
| `prod-operator` | `replace-with-prod-cluster-secret-store` | `replace-with-prod-cluster-issuer` | `replace-with-prod/campuscore/runtime` |

Các overlay này vẫn cố ý **không** hard-code `ingressClassName`. Nếu cluster yêu cầu ingress class hoặc annotations riêng, operator vẫn nên thêm private patch bên ngoài repo public.

## Private overlay pattern

Repo public chỉ giữ placeholder generic và một template pack an toàn để copy ra private overlay. Nếu môi trường thật dùng:

- External Secrets
- Sealed Secrets
- SOPS
- ingress class patch riêng
- hostnames thật
- requests/limits hoặc rollout policy riêng

thì nên tạo thêm private overlay nội bộ bằng cách copy từ:

- `k8s/templates/private-operator/staging`, hoặc
- `k8s/templates/private-operator/prod`

Private overlay đó là nơi hợp lệ để:

- bind secret manager của tổ chức
- gắn `ingressClassName`
- thay hostname thật
- thêm annotations của ingress/load balancer
- override resources/replicas/rollout strategy

Template pack này đã có sẵn:

- `patch-ingress.yaml` cho hostname, TLS secret, ingress class, và annotations thật
- `patch-external-secret.yaml` cho `ClusterSecretStore` và remote secret key thật
- `patch-certificate.yaml` cho `ClusterIssuer` và DNS names thật
- `patch-configmap.yaml` cho `FRONTEND_URL`
- `patch-runtime-overrides.yaml` cho ví dụ stateless app replicas/resources/rolling update
- `bootstrap/kustomization.yaml` để bootstrap jobs render vào namespace môi trường tương ứng

Render kiểm tra trước khi apply:

```bash
kubectl kustomize k8s/templates/private-operator/staging
kubectl kustomize k8s/templates/private-operator/staging/bootstrap
kubectl kustomize k8s/templates/private-operator/prod
kubectl kustomize k8s/templates/private-operator/prod/bootstrap
```

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

Nếu cluster đã có `ExternalSecret` + `cert-manager`, checklist thực tế gọn hơn sẽ là:

1. Copy `k8s/templates/private-operator/staging` hoặc `k8s/templates/private-operator/prod` sang overlay private
2. Thay `ClusterSecretStore`, `ClusterIssuer`, hostname, TLS secret name, ingress class, và annotations thật
3. Xác nhận remote secret key path khớp secret manager thật
4. Review `patch-runtime-overrides.yaml` theo capacity thật của cluster
5. Apply overlay runtime
6. Chạy bootstrap jobs theo đúng thứ tự
7. Verify `/health`, deny `/api/v1/internal/*`, login/session, và `/api/docs` nếu môi trường cho phép
8. Nếu domain chạy qua Cloudflare, hoàn tất checklist trong [CLOUDFLARE.md](./CLOUDFLARE.md) trước khi bật proxy cho production traffic

## Release interaction

- Local-first path vẫn dùng `k8s/overlays/docker-desktop`
- Generic overlays là handoff công khai cho staging/prod
- Operator overlays là handoff kế tiếp cho cluster đã có secret/TLS operators, không thay quy trình local smoke/deploy
- Base Kustomize tiếp tục trỏ tới GHCR public images của release hiện hành; Docker Hub là đường override nếu operator muốn dùng registry đó
