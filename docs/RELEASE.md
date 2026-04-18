# Phát Hành

CampusCore hiện dùng chính sách phát hành công khai **semver-only**.

## Quy Tắc Release

- Chỉ publish public image khi ref là tag `vX.Y.Z`
- Nhánh `master` và `main` chỉ chạy CI
- `latest` chỉ được cập nhật cùng release semver
- Mỗi release phải có tag SHA bất biến để rollback dễ dàng

## Tags

Mỗi release nên có:

- `vX.Y.Z`
- `latest`
- tag SHA ngắn như `0f8bc44`

## Registry

### Docker Hub

- Namespace ưu tiên: `DOCKERHUB_NAMESPACE`
- Alias cũ: `DOCKERHUB_USERNAME`

### GitHub Container Registry

- Dùng namespace của repository owner
- Package mới có thể cần set visibility thành `Public` một lần nếu muốn anonymous pull

## Gating

Release chỉ được phép đi tiếp khi:

- backend quality pass
- backend integration pass
- frontend quality pass
- fast E2E pass
- compose contract pass
- image smoke pass
- edge E2E pass
- security scan pass

## Rollback

Khi cần rollback, ưu tiên:

1. digest image
2. tag SHA bất biến
3. chỉ dùng `latest` khi không còn lựa chọn khác

## Release Notes

Mỗi lần phát hành nên ghi rõ:

- source SHA
- CI run URL
- image tags
- digests
- SBOM hoặc provenance nếu workflow đã tạo ra

## Tài Liệu Liên Quan

- [Kiến trúc](./ARCHITECTURE.md)
- [Vận hành](./OPERATIONS.md)
- [Bảo mật](./SECURITY.md)
