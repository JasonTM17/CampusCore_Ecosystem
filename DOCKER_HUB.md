# Docker Hub and Registry Guide

## Registry policy

- Public publish chỉ chạy từ tag semver `vX.Y.Z`.
- `latest` chỉ cập nhật cùng semver release.
- `DOCKERHUB_NAMESPACE` là biến ưu tiên.
- `DOCKERHUB_USERNAME` vẫn được hỗ trợ như legacy alias khi namespace không được set.

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

- semver tag, ví dụ `v1.3.1`
- short SHA immutable tag
- `latest`

## Rollback

Ưu tiên rollback bằng:

1. digest đã được verify ở release summary
2. short SHA immutable tag
3. semver tag cũ

Không dùng `latest` làm mốc rollback.
