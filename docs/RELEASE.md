# Release

## Release policy

- Branch push chỉ chạy CI.
- Public registry chỉ publish từ tag semver `vX.Y.Z`.
- `latest` chỉ được cập nhật khi có semver release.

Nhánh hardening hiện tại nhắm tới **`v1.3.1`**.

## Required quality gate

Một tag release chỉ hợp lệ khi `quality-gate` xanh trên đúng SHA đó.

Lanes bắt buộc hiện tại:

- `core-quality`
- `core-integration`
- `auth-quality`
- `auth-integration`
- `notification-quality`
- `notification-integration`
- `finance-quality`
- `finance-integration`
- `academic-quality`
- `academic-integration`
- `engagement-quality`
- `engagement-integration`
- `people-quality`
- `people-integration`
- `analytics-quality`
- `analytics-integration`
- `frontend-quality`
- `frontend-fast-e2e`
- `compose-contract`
- `image-smoke`
- `edge-e2e`
- `security-scan`
- `quality-gate`

## Public images

Release hiện tại phải publish đủ 9 image:

1. `campuscore-backend`
2. `campuscore-auth-service`
3. `campuscore-notification-service`
4. `campuscore-finance-service`
5. `campuscore-academic-service`
6. `campuscore-engagement-service`
7. `campuscore-people-service`
8. `campuscore-analytics-service`
9. `campuscore-frontend`

Tag strategy:

- `v1.3.1`
- short SHA immutable tag
- `latest`

## Post-publish verification

- verify manifest của đủ 9 image
- verify digest và SBOM/provenance trong release summary
- smoke published images qua GHCR
- smoke published images qua Docker Hub nếu credentials đã cấu hình
