# Docker Hub and Registry Guide

## Registry policy

- Public publish chỉ chạy từ tag semver `vX.Y.Z`.
- `latest` chỉ cập nhật cùng semver release.
- `DOCKERHUB_NAMESPACE` là biến ưu tiên.
- `DOCKERHUB_USERNAME` vẫn được hỗ trợ như legacy alias khi namespace không được set.
- GitHub Actions nên dùng `DOCKERHUB_TOKEN` cho đăng nhập publish.
- `DOCKERHUB_PASSWORD` chỉ còn là legacy fallback trong workflow hiện tại.

## Recommended GitHub secrets

- `DOCKERHUB_USERNAME`
- `DOCKERHUB_TOKEN`
- `DOCKERHUB_NAMESPACE` chỉ khi namespace khác username

Docker Desktop giúp bạn đăng nhập và thử kéo/push image cục bộ, nhưng publish tự động trên GitHub-hosted runner vẫn cần repo secrets ở GitHub.

## Public image set hiện tại

1. `campuscore-backend`
2. `campuscore-auth-service`
3. `campuscore-notification-service`
4. `campuscore-finance-service`
5. `campuscore-academic-service`
6. `campuscore-engagement-service`
7. `campuscore-people-service`
8. `campuscore-analytics-service`
9. `campuscore-frontend`

## Tag strategy

Mỗi image public được publish với:

- semver tag, ví dụ `v1.3.4`
- short SHA immutable tag
- `latest`

## Rollback

Ưu tiên rollback bằng:

1. digest đã được verify ở release summary
2. short SHA immutable tag
3. semver tag cũ

Không dùng `latest` làm mốc rollback.

## Local manifest verification

Sau khi CD publish xong, có thể kiểm lại đủ 9 image trên GHCR và Docker Hub bằng script có timeout/retry:

```powershell
$env:RELEASE_TAG='v1.3.4'
$env:RELEASE_SHORT_SHA='f3e7de8'
node scripts/verify-release-manifests.mjs
```

Nếu Docker Hub namespace khác username, set thêm:

```powershell
$env:DOCKERHUB_NAMESPACE='your-namespace'
```

Script mặc định kiểm đủ `v1.3.4`, short SHA và `latest` cho cả hai registry. Khi Docker Hub trả rate-limit `429` cho manifest inspect trên máy local, script sẽ fallback sang Docker Hub tag API để xác nhận tag public vẫn tồn tại. Nếu local network hoặc Docker Desktop làm lệnh verify timeout nhưng job CD `Verify published release artifacts` đã xanh, kết quả trên GitHub Actions là nguồn xác nhận release chính.
