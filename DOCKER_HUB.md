# Docker Hub và Public Registry

Tài liệu này mô tả contract phát hành public image của CampusCore ở trạng thái **Microservices Portfolio v3**.

## Public images

CampusCore hiện có 5 image ứng dụng được phát hành công khai:

- `campuscore-backend`
- `campuscore-notification-service`
- `campuscore-finance-service`
- `campuscore-academic-service`
- `campuscore-frontend`

Namespace Docker Hub hiện tại:

- `nguyenson1710`

## Vai trò của từng image

| Image | Port nội bộ | Vai trò |
| --- | --- | --- |
| `campuscore-backend` | `4000` | `core-api` cho auth, identity, announcements, analytics, finance-context và public health |
| `campuscore-notification-service` | `4001` | notification inbox, unread count, websocket `/notifications`, realtime consumer |
| `campuscore-finance-service` | `4002` | invoices, payments, scholarships, finance events |
| `campuscore-academic-service` | `4003` | semesters, courses, classrooms, sections, enrollments, grades, attendance, schedules và academic master-data công khai |
| `campuscore-frontend` | `3000` | Next.js 15 standalone runtime |

`nginx` không được publish như application image chính của portfolio. Nó vẫn là public edge trong runtime compose.

## Namespace và biến môi trường

Quy ước ưu tiên:

- `DOCKERHUB_NAMESPACE` là input ưu tiên
- `DOCKERHUB_USERNAME` được giữ như legacy alias

Khi cả hai cùng có mặt, script và workflow phải ưu tiên `DOCKERHUB_NAMESPACE`.

## Release policy

CampusCore dùng policy **semver-only public publishing**:

- chỉ publish khi push tag `vX.Y.Z`
- branch `master` hoặc `main` chỉ chạy CI
- `latest` chỉ di chuyển cùng một semver release
- mỗi release công khai phải đẩy đủ cả 5 image

Mỗi image được publish với:

- semver tag, ví dụ `v1.0.0`
- short SHA immutable
- `latest`

## Docker Hub repositories

- `nguyenson1710/campuscore-backend`
- `nguyenson1710/campuscore-notification-service`
- `nguyenson1710/campuscore-finance-service`
- `nguyenson1710/campuscore-academic-service`
- `nguyenson1710/campuscore-frontend`

## GHCR mirror

Pipeline cũng mirror tương ứng lên GitHub Container Registry:

- `ghcr.io/jasontm17/campuscore-backend`
- `ghcr.io/jasontm17/campuscore-notification-service`
- `ghcr.io/jasontm17/campuscore-finance-service`
- `ghcr.io/jasontm17/campuscore-academic-service`
- `ghcr.io/jasontm17/campuscore-frontend`

Nếu muốn anonymous pull từ GHCR, package có thể cần được chuyển visibility sang `Public` một lần.

## Ví dụ pull image

```bash
docker pull nguyenson1710/campuscore-backend:v1.0.0
docker pull nguyenson1710/campuscore-notification-service:v1.0.0
docker pull nguyenson1710/campuscore-finance-service:v1.0.0
docker pull nguyenson1710/campuscore-academic-service:v1.0.0
docker pull nguyenson1710/campuscore-frontend:v1.0.0
```

## Manual publish helper

Ví dụ chạy helper local:

```bash
DOCKERHUB_NAMESPACE=nguyenson1710 ./scripts/docker-publish.sh v1.0.0
```

Ở một release đầy đủ, helper phải build và push:

- `campuscore-backend`
- `campuscore-notification-service`
- `campuscore-finance-service`
- `campuscore-academic-service`
- `campuscore-frontend`
- semver tag
- short SHA tag
- `latest`

## Rollback

Rollback nên dựa trên:

- digest immutable
- short SHA tag immutable

Không nên dùng `latest` làm rollback target chính.

## Repository description updates

Nếu có `DOCKERHUB_TOKEN`, có thể cập nhật description Docker Hub bằng script repo:

```bash
DOCKERHUB_TOKEN=... DOCKERHUB_NAMESPACE=nguyenson1710 ./scripts/update-hub-description.sh
```

Nếu chưa có token, việc publish image vẫn thực hiện được; description có thể cập nhật thủ công sau.
