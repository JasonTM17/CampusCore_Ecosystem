# Bảo Mật

CampusCore hiện được thiết kế theo hướng an toàn hơn ở tầng runtime và release, nhưng vẫn giữ tương thích cho client cũ trong giai đoạn chuyển tiếp.

## Auth

Browser auth dùng cookie:

- `cc_access_token`
- `cc_refresh_token`
- `cc_csrf`

Các request mutating từ browser phải gửi `X-CSRF-Token`. Bearer token legacy vẫn được hỗ trợ để không làm gãy tích hợp cũ.

## Health

- Public `GET /health` chỉ là liveness tối giản
- Readiness chi tiết nằm ở `GET /api/v1/health/readiness`
- Readiness có thể được bảo vệ bằng `HEALTH_READINESS_KEY`

Mục tiêu của tách này là không vô tình làm lộ trạng thái nội bộ cho public edge.

## Secrets

Không commit file secret vào repo. Các file local như `.env` và `backend/.env` phải được coi là chỉ dùng trên máy cá nhân và không được track.

## Image and Dependency Scanning

CI/CD dùng security scan cho:

- source dependencies
- built container images

Pipeline release chỉ được đi tiếp khi các lane này đạt ngưỡng an toàn đã khóa.

## Release Discipline

Public release chỉ được publish từ semver tag `vX.Y.Z`.

- `latest` chỉ cập nhật khi có release semver
- rollback nên dùng digest hoặc SHA tag bất biến
- branch push chỉ chạy CI, không phát hành public

## Operational Risk Notes

- Docker Hub namespace nên cấu hình bằng `DOCKERHUB_NAMESPACE`
- `DOCKERHUB_USERNAME` chỉ giữ làm alias cũ
- Nếu đổi runtime contract, phải cập nhật docs, compose và release notes cùng lúc

## Tài Liệu Liên Quan

- [Kiến trúc](./ARCHITECTURE.md)
- [Vận hành](./OPERATIONS.md)
- [Phát hành](./RELEASE.md)
