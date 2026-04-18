# Phát hành

CampusCore dùng release policy theo hướng **semver-only public publishing**.

## 1. Nguyên tắc chung

- `master` và `main` chỉ chạy CI
- public registry chỉ publish khi push tag `vX.Y.Z`
- CD phải chờ đúng `quality-gate` của commit đó xanh
- mỗi release publish đủ 3 image ứng dụng

## 2. Image contract

### Docker Hub

- `nguyenson1710/campuscore-backend`
- `nguyenson1710/campuscore-notification-service`
- `nguyenson1710/campuscore-frontend`

### GHCR

- `ghcr.io/jasontm17/campuscore-backend`
- `ghcr.io/jasontm17/campuscore-notification-service`
- `ghcr.io/jasontm17/campuscore-frontend`

## 3. Tag strategy

Mỗi release semver publish:

- `vX.Y.Z`
- short SHA immutable
- `latest`

`latest` chỉ cập nhật khi có release semver. Branch push không được phép di chuyển `latest`.

## 4. CI/CD workflow

### CI Build and Test

Lane bắt buộc:

- `core-quality`
- `core-integration`
- `notification-quality`
- `notification-integration`
- `frontend-quality`
- `frontend-fast-e2e`
- `compose-contract`
- `image-smoke`
- `edge-e2e`
- `security-scan`
- `dependency-review`
- `quality-gate`

`quality-gate` là status duy nhất nên được dùng cho branch protection.

### CD - Gated Registry Publish

Workflow CD chỉ trigger khi push tag `v*.*.*` và sẽ:

1. resolve release plan
2. chờ CI matching commit thành công
3. publish Docker Hub nếu có đủ secret
4. publish GHCR
5. ghi release summary với digest, tags, source SHA và provenance/SBOM

## 5. Docker Hub secrets

Bắt buộc:

- `DOCKERHUB_USERNAME`
- `DOCKERHUB_PASSWORD`

Khuyến nghị:

- `DOCKERHUB_NAMESPACE`

`DOCKERHUB_NAMESPACE` là tên được ưu tiên. `DOCKERHUB_USERNAME` được giữ làm legacy alias để tương thích workflow cũ.

## 6. Manual publish helper

Script local:

```bash
DOCKERHUB_NAMESPACE=<namespace> ./scripts/docker-publish.sh v1.0.0
```

Script sẽ build và push:

- `campuscore-backend`
- `campuscore-notification-service`
- `campuscore-frontend`
- semver tag
- short SHA tag
- `latest` cùng với đúng semver release đó

## 7. Rollback

Ưu tiên rollback bằng:

- digest immutable từ registry
- short SHA tag immutable

Không nên rollback bằng `latest` vì đó là moving tag.
