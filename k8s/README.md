# CampusCore Kubernetes

CampusCore hiện có bộ manifests Kustomize cho đúng topology 9 image đang chạy ở Docker Compose:

- `core-api`
- `auth-service`
- `notification-service`
- `finance-service`
- `academic-service`
- `engagement-service`
- `people-service`
- `analytics-service`
- `frontend`
- `nginx`
- PostgreSQL, Redis, RabbitMQ, MinIO

## Mục tiêu

- Giữ nguyên boundary runtime đang có trong repo.
- Dùng public GHCR images của release hiện tại làm mặc định triển khai.
- Không tự động chạy migration trong app runtime; bootstrap schema vẫn là bước operator-managed giống production compose.

## Base và overlay

- `k8s/base`: canonical production-like runtime base cho topology hiện tại.
- `k8s/bootstrap`: one-shot init jobs theo đúng thứ tự bootstrap schema/data.
- `k8s/overlays/docker-desktop`: local-first overlay cho Docker Desktop Kubernetes.

Overlay Docker Desktop giữ nguyên boundary service nhưng vá đúng các điểm chỉ nên đổi ở local:

- `campuscore-nginx` dùng `ClusterIP` để port-forward ổn định.
- `SWAGGER_ENABLED=true` để local smoke kiểm được `/api/docs`.
- `COOKIE_SECURE=false` và `FRONTEND_URL=http://127.0.0.1:8080` để browser auth flow chạy được trên HTTP local.
- Secret dùng giá trị local-only, không phải production secret.

## Dùng với Docker Desktop Kubernetes

1. Bật Kubernetes trong Docker Desktop.
2. Chạy preflight:

```bash
node scripts/run-k8s-preflight.mjs
```

3. Chạy smoke local đầy đủ:

```bash
node scripts/run-k8s-local-smoke.mjs
```

Script smoke sẽ:

- apply `k8s/overlays/docker-desktop`
- chờ infra sẵn sàng
- render `k8s/bootstrap` rồi apply các job theo đúng thứ tự
- chờ rollout runtime
- port-forward `campuscore-nginx`
- smoke `/health`, `/login`, `/api/docs`, và deny `/api/v1/internal/*`

Mặc định script sẽ cleanup namespace sau khi xong để tiết kiệm tài nguyên local. Nếu muốn giữ lại cluster state để tự kiểm tra tiếp:

```bash
K8S_KEEP_RESOURCES=1 node scripts/run-k8s-local-smoke.mjs
```

## Deploy giữ nguyên resources

Nếu bạn muốn Docker Desktop Kubernetes UI hiển thị đủ pods/deployments/services của CampusCore sau khi chạy xong, dùng script deploy riêng:

```bash
node scripts/run-k8s-local-deploy.mjs
```

Script này sẽ:

- apply `k8s/overlays/docker-desktop`
- chờ infra sẵn sàng
- chạy bootstrap jobs theo thứ tự chuẩn
- chờ rollout toàn bộ runtime
- chạy một lượt smoke ngắn qua port-forward
- **không xóa namespace `campuscore`**

Nếu bạn chỉ muốn reconcile lại runtime trên namespace đang có sẵn resources:

```bash
K8S_REUSE_NAMESPACE=1 node scripts/run-k8s-local-deploy.mjs
```

Chế độ này không replay bootstrap jobs. Nếu thật sự cần chạy lại init jobs trên namespace đang tồn tại, hãy chủ động thêm:

```bash
K8S_REUSE_NAMESPACE=1 K8S_FORCE_BOOTSTRAP_REPLAY=1 node scripts/run-k8s-local-deploy.mjs
```

Sau khi script deploy hoàn tất:

1. Trong Docker Desktop Kubernetes UI, đổi namespace từ `default` sang `campuscore`
2. Nếu muốn mở edge bằng browser:

```bash
kubectl -n campuscore port-forward service/campuscore-nginx 8080:80
```

Lệnh này là **long-running command** có chủ đích: terminal sẽ giữ mở cho tới khi bạn nhấn `Ctrl+C`. Đây không phải là dấu hiệu stack bị treo.

Rồi mở:

- `http://127.0.0.1:8080/health`
- `http://127.0.0.1:8080/login`
- `http://127.0.0.1:8080/api/docs`

Nếu cần dọn stack local này đi sau khi kiểm tra xong:

```bash
node scripts/run-k8s-local-destroy.mjs
```

## Manual flow nếu cần tự điều khiển

1. Render runtime:

```bash
kubectl kustomize k8s/overlays/docker-desktop
```

2. Apply runtime:

```bash
kubectl apply -k k8s/overlays/docker-desktop
```

3. Bootstrap vẫn chạy tách riêng để tránh app runtime tự đụng migration.

Thứ tự khuyến nghị của bootstrap:

1. `core-api-init`
2. `auth-service-init`
3. `notification-service-init`
4. `finance-service-init`
5. `academic-service-init`
6. `engagement-service-init`
7. `people-service-init`
8. `analytics-service-init`

Nếu cần chạy từng job thủ công, dùng manifest đã render từ:

```bash
kubectl kustomize k8s/bootstrap
```

thay vì apply raw file trực tiếp, để image tags luôn khớp release đang khóa trong Kustomize.

## Public entrypoint

- `campuscore-nginx` được expose bằng `Service` kiểu `LoadBalancer` trong `k8s/base`.
- Docker Desktop overlay đổi service này sang `ClusterIP` và dùng port-forward:

```bash
kubectl -n campuscore port-forward service/campuscore-nginx 8080:80
```

## Đổi sang Docker Hub

Base Kustomize hiện trỏ tới GHCR vì đó là registry public đã xác nhận sẵn cho release hiện tại. Nếu muốn chạy bằng Docker Hub:

1. sửa phần `images:` trong [k8s/base/kustomization.yaml](./base/kustomization.yaml), hoặc
2. dùng `kustomize edit set image` / overlay riêng của bạn.

## Lưu ý bảo mật

- Không commit secrets thật vào repo.
- Dùng Docker Hub PAT qua `DOCKERHUB_TOKEN`, không dùng password tài khoản thật trong CI/CD.
- Toàn bộ internal routes `/api/v1/internal/*` vẫn bị chặn ở `nginx`; K8s không thay đổi contract này.
