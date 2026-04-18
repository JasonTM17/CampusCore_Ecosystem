# Phát hành CampusCore v3

CampusCore dùng policy **semver-only public publishing**. Mục tiêu là chỉ phát hành public image sau khi stack nhiều service đã qua đủ quality gate, runtime smoke, edge E2E và security scan.

## 1. Nguyên tắc phát hành

- branch `master` hoặc `main` chỉ chạy CI
- public registry chỉ publish khi push tag `vX.Y.Z`
- `latest` chỉ di chuyển cùng một semver release
- mỗi release phải mang đủ **5 image**

## 2. Public images

### Docker Hub

- `nguyenson1710/campuscore-backend`
- `nguyenson1710/campuscore-notification-service`
- `nguyenson1710/campuscore-finance-service`
- `nguyenson1710/campuscore-academic-service`
- `nguyenson1710/campuscore-frontend`

### GHCR

- `ghcr.io/jasontm17/campuscore-backend`
- `ghcr.io/jasontm17/campuscore-notification-service`
- `ghcr.io/jasontm17/campuscore-finance-service`
- `ghcr.io/jasontm17/campuscore-academic-service`
- `ghcr.io/jasontm17/campuscore-frontend`

## 3. Tag strategy

Mỗi semver release publish:

- `vX.Y.Z`
- short SHA immutable
- `latest`

`latest` không bao giờ được đẩy từ push thường trên branch.

## 4. Release contents

Một release v3 đầy đủ phải bao gồm:

- `core-api`
- `notification-service`
- `finance-service`
- `academic-service`
- `frontend`

`nginx` vẫn là public runtime edge, nhưng không được coi là application image chính của portfolio.

## 5. Điều kiện trước khi tag

Trước khi tạo tag phát hành, cần xác nhận:

- `core-api` pass quality và integration
- `notification-service` pass quality và integration
- `finance-service` pass quality và integration
- `academic-service` pass quality và integration
- `frontend` pass quality, build và fast E2E
- edge E2E pass
- image smoke pass
- compose contract pass
- security sweep pass

Checklist local tham chiếu:

```bash
cd backend && npm run lint && npm run lint:format && npm run typecheck && npm run build && npm run test:unit -- --runInBand && npm run test:integration -- --runInBand
cd ../notification-service && npm run lint && npm run lint:format && npm run typecheck && npm run build && npm run test:unit -- --runInBand && npm run test:integration -- --runInBand
cd ../finance-service && npm run lint && npm run lint:format && npm run typecheck && npm run build && npm run test:unit -- --runInBand && npm run test:integration -- --runInBand
cd ../academic-service && npm run lint && npm run lint:format && npm run typecheck && npm run build && npm run test:unit -- --runInBand && npm run test:integration -- --runInBand
cd ../frontend && npm run lint && npm run typecheck && npm test && npm run build && npm run test:e2e
cd .. && node scripts/run-image-smoke.mjs
cd frontend && npm run test:e2e:edge
cd .. && node scripts/run-security-local.mjs
docker compose -f docker-compose.yml config
docker compose -f docker-compose.production.yml config
docker compose -f docker-compose.e2e.yml config
git diff --check
```

## 6. Bootstrap trước first deploy

Production-like stack không tự chạy migration trong app container. Trước first deploy:

```bash
export DOCKERHUB_NAMESPACE=<namespace>
export IMAGE_TAG=v1.0.0
docker compose -f docker-compose.production.yml --profile bootstrap run --rm core-api-init
docker compose -f docker-compose.production.yml --profile bootstrap run --rm notification-service-init
docker compose -f docker-compose.production.yml --profile bootstrap run --rm finance-service-init
docker compose -f docker-compose.production.yml --profile bootstrap run --rm academic-service-init
docker compose -f docker-compose.production.yml up -d
```

## 7. Docker Hub secrets

Bắt buộc:

- `DOCKERHUB_USERNAME`
- `DOCKERHUB_PASSWORD`

Khuyến nghị:

- `DOCKERHUB_NAMESPACE`

`DOCKERHUB_NAMESPACE` là tên ưu tiên. `DOCKERHUB_USERNAME` được giữ như legacy alias để tương thích.

## 8. Manual publish helper

Ví dụ helper local:

```bash
DOCKERHUB_NAMESPACE=<namespace> ./scripts/docker-publish.sh v1.0.0
```

Script helper phải build và push đủ:

- `campuscore-backend`
- `campuscore-notification-service`
- `campuscore-finance-service`
- `campuscore-academic-service`
- `campuscore-frontend`
- semver tag
- short SHA tag
- `latest`

## 9. Rollback

Ưu tiên rollback bằng:

- digest immutable
- short SHA tag immutable

Không dùng `latest` làm rollback target chính.

## 10. Narrative phát hành v3

Ở trạng thái này, CampusCore là một portfolio microservices với:

- một `core-api` giữ auth và identity
- một `notification-service` làm owner của notifications và realtime
- một `finance-service` làm owner của finance domain
- một `academic-service` làm owner của public academic APIs
- một `frontend`
- một `nginx gateway`

Release narrative phải phản ánh đúng boundary này, không mô tả monolith trá hình và cũng không overclaim rằng mọi domain đã được tách hoàn toàn.
