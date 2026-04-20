# Release

## Release policy

- Branch push chỉ chạy CI.
- Public registry chỉ publish từ tag semver `vX.Y.Z`.
- `latest` chỉ được cập nhật khi có semver release.
- GitHub Actions ưu tiên `DOCKERHUB_TOKEN`; `DOCKERHUB_PASSWORD` chỉ còn là legacy fallback.
- Badge CD trong `README.md` phải trỏ tới tag release mới nhất vì workflow CD chỉ chạy từ semver tag.

Baseline release công khai hiện tại là **`v1.3.4`**.

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

- `v1.3.4`
- short SHA immutable tag
- `latest`

## Post-publish verification

- verify manifest của đủ 9 image bằng `node scripts/verify-release-manifests.mjs`
- verify digest và SBOM/provenance trong release summary
- smoke published images qua GHCR
- smoke published images qua Docker Hub nếu credentials đã cấu hình

Kiểm tra local sau release:

```powershell
$env:RELEASE_TAG='v1.3.4'
$env:RELEASE_SHORT_SHA='f3e7de8'
node scripts/verify-release-manifests.mjs
```

Script này kiểm GHCR và Docker Hub cho đủ 9 image với tag semver, short SHA và `latest`. Mặc định script dùng concurrency `4`, timeout `45s` cho mỗi manifest và retry `2` lần để tránh lỗi mạng cục bộ làm hỏng kết luận. Nếu Docker Hub trả rate-limit `429` khi verify cục bộ, script fallback sang Docker Hub tag API để xác nhận tag public vẫn tồn tại. Nếu verify local bị timeout nhưng job CD `Verify published release artifacts` đã xanh trên GitHub runner, release vẫn được coi là hợp lệ.

## Kubernetes hand-off

- Repo hiện có manifests Kustomize dưới `k8s/` cho topology 9 image.
- Base deploy target mặc định dùng GHCR public images của release hiện tại.
- Local-first path dùng `k8s/overlays/docker-desktop` cùng:
  - `node scripts/run-k8s-preflight.mjs`
  - `node scripts/run-k8s-local-smoke.mjs`
- Nếu cần giữ nguyên stack để kiểm trực tiếp bằng Docker Desktop Kubernetes UI:
  - `node scripts/run-k8s-local-deploy.mjs`
  - đổi namespace UI từ `default` sang `campuscore`
  - khi dọn local cluster state, chạy `node scripts/run-k8s-local-destroy.mjs`
- Khi cần chuyển sang Docker Hub, chỉ cần override image names trong Kustomize thay vì đổi runtime topology.
