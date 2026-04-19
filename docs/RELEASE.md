# Release

## Release policy

- Branch push chỉ chạy CI.
- Public registry chỉ publish từ tag semver `vX.Y.Z`.
- `latest` chỉ được cập nhật khi có semver release.

Release mục tiêu của đợt này là **`v1.1.0`**.

## Required quality gate

Một tag release chỉ hợp lệ khi `quality-gate` xanh trên đúng SHA đó.

Lanes bắt buộc của v6:

- `core-quality`
- `core-integration`
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

Release v6 phải publish đủ 8 image:

1. `campuscore-backend`
2. `campuscore-notification-service`
3. `campuscore-finance-service`
4. `campuscore-academic-service`
5. `campuscore-engagement-service`
6. `campuscore-people-service`
7. `campuscore-analytics-service`
8. `campuscore-frontend`

Tag strategy:

- `v1.1.0`
- short SHA immutable tag
- `latest`

## Post-publish verification

- verify manifest của đủ 8 image
- verify digest và SBOM/provenance trong release summary
- smoke published images qua GHCR
- smoke published images qua Docker Hub nếu credentials đã cấu hình
