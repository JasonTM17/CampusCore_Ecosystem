# Demo data policy — fixture hư cấu CampusUTE

Pha: P01 step 2 · Owner: controller · Review: tester + security dữ liệu fixture
Liên quan: `scripts/ecosystem-fixture.mjs`, gate `baseline` trong `scripts/verify-ecosystem.gates.json`.

## 1. Nguyên tắc nguồn (D0)

- Mọi dữ liệu demo (DB rows, file/attachment, email, log, search index, audit trail) phải có nguồn **synthetic**: Flyway migrations trên DB trống + generator pack, không clone production, không import hồ sơ thật.
- Phát hiện dữ liệu người thật → **rebuild fixture**; cấm lọc tên/ngày sinh bằng regex rồi coi là an toàn.
- Pack là artifact có provenance; không chứa credential nào (xem §4).

## 2. Allowlist synthetic

| Loại | Cho phép | Ngoài allowlist = vi phạm |
| --- | --- | --- |
| Email domain | `@campuscore.demo`, `@campuscore.edu`, `@campuscore.test`, `@ute.demo.edu.vn` | gmail/outlook/edu.vn thật, bất kỳ domain nào khác |
| URL host | `localhost`, `127.0.0.1`, `*.campuscore.(demo\|edu\|test)`, `ute.demo.edu.vn`, `demo.campuscore.test` | `campusute.io.vn`, `*.hcmute.edu.vn` thật, `images.unsplash.com`, mọi host live khác |
| Điện thoại | `+8490…` synthetic do generator sinh | Chuỗi `0xxxxxxxxx` / `+84xxxxxxxxx` thật; chuỗi số nằm trong token hex (sha256/uuid/hash) không tính phone — boundary của pattern loại ký tự `a–f` để không corrupt checksum |
| Persona | Email + tên nằm trong roster `personas.json` | Tên người thật ngoài persona registry |

Generator normalize mọi literal ngoài allowlist trên disposable DB **trước khi dump**, rồi ghi mapping vào manifest (email/phone lưu hash, URL lưu host + path hash). Không sửa tay kết quả.

## 3. Provenance bắt buộc trong manifest

`manifest.json` trong pack phải ghi: `sourceHead` (git SHA khi generate), `project` disposable đã dùng, Flyway lineage (schema, số migration applied, version cuối, checksum), danh sách file pack + sha256 + bytes, `personas.json` hash, normalization counts và bảng mapping (hash-only), `forbiddenFields`, `credentialPolicy`, kết quả audit before/after.

## 4. Credential — sinh khi chạy, không ghi artifact

- Pack dump thay mọi bcrypt hash `\$2[aby]$…` bằng placeholder `__RUNTIME_BCRYPT__` và JWT `eyJ…` bằng `__RUNTIME_TOKEN__`; manifest ghi `replacedCount`.
- Khi provisioning một môi trường demo, bước apply sinh hash từ biến môi trường `FIXTURE_ACCOUNT_BCRYPT` (bcrypt sẵn) hoặc `FIXTURE_ACCOUNT_SECRET` (mật khẩu runtime do operator cung cấp, hash tại chỗ bằng password encoder của app). Giá trị này không bao giờ nằm trong pack, manifest, log hay git.
- DemoAccountGate hiện hữu (mặc định LOCKED) vẫn là lớp phòng vệ trên mọi host không phải demo.

## 5. Trường bị cấm (forbiddenFields)

`realEmail`, `realName` ngoài persona, `realPhone`, `studentId thật`, `số định danh/CCCD`, `địa chỉ thật`, `password hash/token/secret`, `live URL` ngoài allowlist, `file đính kèm thật`, `điểm/hồ sơ học vụ thật`. Audit fail khi bất kỳ trường nào xuất hiện trong pack hoặc disposable DB sau normalize.

## 6. Bề mặt audit (gate `baseline` case `fixture-pack`)

1. **DB toàn phần**: mọi cột text/varchar/json(b) ngoài `pg_catalog`/`information_schema`/`flyway_schema_history` — scan email/URL/credential; cột `phone|mobile|tel|contact` + mọi text column cho phone pattern.
2. **Attachment metadata**: thuộc phạm vi quét chung; zero live URL/file thật.
3. **Search index / knowledge**: cùng phạm vi; zero live URL.
4. **Audit trail**: cùng phạm vi; zero dấu vết nguồn thật.
5. **Pack file**: zero bcrypt/JWT/forbidden email/forbidden URL; sha256 manifest khớp file.

Re-run normalize phải idempotent: lần hai phát hiện 0 vi phạm, manifest ghi `dbViolationsBefore=0`.
