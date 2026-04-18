# Docker Hub Guide

CampusCore public images hiện gồm 3 image ứng dụng:

- `campuscore-backend`
- `campuscore-notification-service`
- `campuscore-frontend`

Namespace hiện tại: `nguyenson1710`.

## Namespace rule

- `DOCKERHUB_NAMESPACE` là input được ưu tiên
- `DOCKERHUB_USERNAME` được giữ như legacy alias
- khi cả hai cùng có mặt, workflow và script phải ưu tiên `DOCKERHUB_NAMESPACE`

## Release policy

Public release chỉ publish từ tag semver `vX.Y.Z`.

Mỗi release đẩy:

- semver tag, ví dụ `v1.0.0`
- short SHA immutable
- `latest`

`latest` chỉ đổi khi có semver release. Push lên branch không được phép publish public tag mới.

## Image contract

| Image                             | Internal port | Vai trò                                                            |
| --------------------------------- | ------------- | ------------------------------------------------------------------ |
| `campuscore-backend`              | `4000`        | `core-api` cho auth, học vụ, public health, Swagger                |
| `campuscore-notification-service` | `4001`        | inbox notifications, websocket `/notifications`, RabbitMQ consumer |
| `campuscore-frontend`             | `3000`        | Next.js 15 standalone runtime                                      |

Các image này không bao gồm `nginx`. Public edge trong compose vẫn là `nginx`.

## Pull example

```bash
docker pull nguyenson1710/campuscore-backend:v1.0.0
docker pull nguyenson1710/campuscore-notification-service:v1.0.0
docker pull nguyenson1710/campuscore-frontend:v1.0.0
```

## GHCR mirror

Release pipeline cũng push tương ứng lên GHCR:

- `ghcr.io/jasontm17/campuscore-backend`
- `ghcr.io/jasontm17/campuscore-notification-service`
- `ghcr.io/jasontm17/campuscore-frontend`

GHCR package có thể cần đặt visibility sang `Public` một lần nếu muốn anonymous pull.

## Manual publish helper

```bash
DOCKERHUB_NAMESPACE=nguyenson1710 ./scripts/docker-publish.sh v1.0.0
```

Script local chỉ nhận semver tag rõ ràng, ví dụ `v1.0.0`, rồi tự gắn thêm short SHA và `latest` cho đúng release đó.

## Rollback

Rollback nên dùng:

- digest immutable
- SHA tag immutable

Không dùng `latest` làm rollback target chính.

## Description updates

Nếu có `DOCKERHUB_TOKEN`, có thể cập nhật description bằng script repo:

```bash
DOCKERHUB_TOKEN=... DOCKERHUB_NAMESPACE=nguyenson1710 ./scripts/update-hub-description.sh
```

Nếu chưa có token, image vẫn publish bình thường, còn description có thể cập nhật thủ công sau.
