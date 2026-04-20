# CampusCore Kubernetes

CampusCore hiện có thêm bộ manifests Kustomize cho cùng topology 9 image đang chạy ở Docker Compose:

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

## Dùng với Docker Desktop Kubernetes

1. Bật Kubernetes trong Docker Desktop.
2. Cập nhật placeholder secrets trong [k8s/base/secrets.example.yaml](./base/secrets.example.yaml).
3. Render thử:

```bash
kubectl kustomize k8s/base
```

4. Apply runtime base:

```bash
kubectl apply -k k8s/base
```

5. Chờ infra và runtime chính sẵn sàng:

```bash
kubectl -n campuscore get pods
```

## Bootstrap một lần

Bootstrap vẫn chạy tách riêng để tránh app runtime tự đụng migration.

Thứ tự khuyến nghị:

1. `01-core-api-init.yaml`
2. `02-auth-service-init.yaml`
3. `03-notification-service-init.yaml`
4. `04-finance-service-init.yaml`
5. `05-academic-service-init.yaml`
6. `06-engagement-service-init.yaml`
7. `07-people-service-init.yaml`
8. `08-analytics-service-init.yaml`

Ví dụ:

```bash
kubectl apply -n campuscore -f k8s/bootstrap/01-core-api-init.yaml
kubectl wait -n campuscore --for=condition=complete job/core-api-init --timeout=10m
kubectl delete -n campuscore job/core-api-init
```

Lặp lại cho các job còn lại theo đúng thứ tự.

## Public entrypoint

- `campuscore-nginx` được expose bằng `Service` kiểu `LoadBalancer`.
- Nếu cluster local của bạn chưa cấp external IP, dùng port-forward:

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
