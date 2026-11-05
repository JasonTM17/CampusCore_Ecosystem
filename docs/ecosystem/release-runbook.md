# Release runbook — local demo candidate → future go-live → rollback

> **Status: deferred — the ecosystem runs local-first; nothing here is deployed.**
> Runbook này mô tả quy trình release/go-live **tương lai**; local quick start nằm ở
> [README.md](../../README.md#quick-start-local).

C2 P14: một release hội tụ D0–D10 (synthetic demo, chưa pilot). Mọi bước
ghi evidence; deploy/DNS/store là external capability — `BLOCKED_CAPABILITY`
cho tới khi credentials được cung cấp.

## 1. Freeze + manifest

```powershell
git status --porcelain                       # phải sạch (tracked files)
node scripts/ecosystem-release-manifest.mjs --out artifacts/verification/demo
# → candidate-manifest.json: gitSha + sourceHash + flywayHead +
#   specDigest + contractDigest + per-gate evidence digests +
#   device-association digests. dirtyWorktree:false là điều kiện release.
```

Không bind candidate khi dirtyWorktree=true — manifest chỉ mô tả working
tree, không phải snapshot đã commit.

## 2. Backup/restore drill

Drill chạy trên **fixture disposable** (không dùng stack demo chung): container mang label
`io.campusute.drill.disposable=true` và tên theo hợp đồng ở
[ops/backup/README.md](../../ops/backup/README.md). Guard từ chối mọi tên khác.

```powershell
$env:ECO_DRILL_CONTAINER='campusute-drill-p14-postgres'
$env:ECO_DRILL_DB='campusute_drill_p14'
$env:ECO_DRILL_DISPOSABLE='1'
node scripts/ecosystem-backup-drill.mjs --out artifacts/verification/demo
# → demo-<ts>.dump + .sha256 + backup-drill.json (row-count parity mọi
#   bảng, FK parity, orphan checks library/careers/events/admissions).
#   exit 4 = BLOCKED_CAPABILITY khi không có stack.
```

Bản sao lưu gồm dump DB và tar thư mục báo cáo luận văn được chụp ở hai thời điểm khác nhau;
backup, verify và restore đối chiếu `storage_key` trong dump với tar, chụp lại một lần khi lệch
(chi tiết ở [ops/backup/README.md](../../ops/backup/README.md)).

Sau drill: verify archive bằng `ops/backup/verify-backup.sh` nếu restore
bằng tay. Restore **luôn** vào DB isolated (`campuscore_restore_*`) — script từ
chối overwrite DB nguồn.

## 3. Host probe

Preview boot (giống e2e orchestrators):

```powershell
docker compose -p campuscore-demo-p14 -f docker-compose.e2e.yml `
  -f docker-compose.sso-preview.yml up -d --build postgres `
  assistant-db-provisioner restful-api
# + dev-id-tls.mjs :4443 -> http://127.0.0.1:4100
# + next dev --experimental-https :3102 (cert/key từ evidence dir)
node scripts/probe-ecosystem-hosts.mjs --insecure `
  --host portal=https://portal.localhost:3102 `
  --host learn=https://learn.localhost:3102 `
  --host apply=https://apply.localhost:3102 `
  --host apex=https://apex.localhost:3102 `
  --host id=https://id.localhost:4443 `
  --json artifacts/verification/demo/host-probe.json
```

Checks: AASA `application/json` + synthetic ids + `/session/*`,`/api/*`
excludes; assetlinks synthetic fingerprint; CSP header; session lane
no-store; apex→portal redirect; id liveness + X-Request-Id.

## 4. Cold start + cost envelope

Đo trong drill window: `healthyMs` của restful-api (compose up → health),
`docker stats --no-stream` RSS, DB file growth (`pg_database_size`),
egress estimate từ dump size. Ghi vào `demo-acceptance.md` D10 row —
free-tier CU-h chỉ là ước lượng ghi rõ method, không gọi là bill thực.

### Cổng quyết định sizing trước cloud preview/demo

Mốc đo lịch sử trong rehearsal: API RSS774,6MiB; các mốc trước ghi825MiB–1,03GiB. Các giá trị đó vượt ngân sách512MiB đã dùng khi lập phương án miễn phí; không phải phép đo của candidate hiện tại hay xác nhận gói dịch vụ hiện hành. Trước cloud deployment, owner phải chọn phương án có bằng chứng: tài nguyên trả phí đủ RAM, giảm footprint rồi đo lại mà giữ các kiểm bảo mật, hoặc tiếp tục local/tự host trong phạm vi được phép. Chưa có quyết định thì cloud deploy còn BLOCKED_CAPABILITY. Ưu tiên miễn phí không đồng nghĩa cam kết vận hành miễn phí; không tự mua hoặc đăng ký dịch vụ. Local verification không thay quyết định cloud sizing.

## 5. Staged deploy (BLOCKED_CAPABILITY — future go-live)

Cần DNS + hosting credentials + store/signing. Khi owner mở go-live:

1. Build API/id image từ commit đã qua cổng staged, gắn tag `candidate-<sha>`, chạy scan + SBOM attestation và xác nhận review exact-head trước khi promote tag release chính thức (không promote `latest` tự động). Repo này **không** chứa workflow publish image. Với database đã có dữ liệu (populated database), thực hiện quy trình pre-deployment DDL cho các migration nặng khóa (V146–V150) theo [Flyway lineage pre-deployment](../integrations/flyway-lineage.md#44-pre-deployment-procedure-for-populated-databases-lock-heavy-migrations-v146v150) trước khi khởi động API. Môi trường có dữ liệu phát sinh từ phiên bản cũ (< V14, < V53, < V116) cần chạy preflight và xử lý ngoài băng theo [Populated environments below V14 / V53 / V116](#populated-environments-below-v14--v53--v116).
2. Deploy web hosts (portal/learn/apply/apex) trỏ surface registry.
3. `probe-ecosystem-hosts.mjs` chống declared hostname (không `--insecure`).
4. Canary synthetic personas → full lifecycle suite → live smoke.
5. Rollback drill: restore backup hiện tại → attachment parity → delta
   check trước reopen. DNS rollback theo record thực — TTL không tức thì.

### Populated environments below V14 / V53 / V116

Các migration V14, V53 và V116 đã được áp dụng vào chuỗi Flyway canonical và không thể chỉnh sửa trực tiếp (ràng buộc checksum). Khi khôi phục database từ bản sao lưu cũ, staging clone hoặc môi trường dev lâu năm có dữ liệu sẵn ở phiên bản thấp hơn các mốc này, áp dụng bảng tóm tắt và quy trình ngoài băng (out-of-band) dưới đây trước khi deploy (với V146–V150, xem [Flyway lineage pre-deployment](../integrations/flyway-lineage.md#44-pre-deployment-procedure-for-populated-databases-lock-heavy-migrations-v146v150)):

| Migration | Phiên bản ảnh hưởng | Triệu chứng khi chạy mặc định | Hướng xử lý ngoài băng an toàn |
| --- | --- | --- | --- |
| **V14** | `< V14` (V1..V13) có dữ liệu `Enrollment` | Giữ khóa `ACCESS EXCLUSIVE` trên `academic."Enrollment"` trong suốt quá trình backfill (`courseId`, `creditsSnapshot`), chặn toàn bộ đọc/ghi; fail deploy nếu có dòng mồ côi | Backfill phân lô trước deploy, chạy V14 trong cửa sổ bảo trì (FK và `SET NOT NULL` vẫn validate dưới khóa) |
| **V53** | `< V53` (V1..V52) có dữ liệu điểm | Correlated subquery `DELETE` không có index chạy quét tuần tự $O(n^2)$ làm treo deploy/boot loop; xóa nhầm điểm sửa mới nhất do giữ `min(ctid)` | Chạy preflight audit trùng lặp; tạo `CREATE UNIQUE INDEX CONCURRENTLY` trước deploy |
| **V116** | `< V116` (đặc biệt V115) | Khóa `SHARE ROW EXCLUSIVE` trên 7 bảng bao gồm `campuscore_auth."User"`, chặn toàn bộ đăng nhập người dùng; fail deploy nếu chạm `lock_timeout='10s'` | Lên lịch trong cửa sổ bảo trì, chờ/ngắt transaction dài trên auth; migration mới chỉ lock theo dòng `FOR UPDATE` |

#### Quy trình chi tiết từng migration

##### 1. Migration V14 (`academic."Enrollment"`)

- **Đối tượng ảnh hưởng**: Môi trường có dữ liệu ở phiên bản `< V14`. Cài đặt mới hoặc database đã ở `≥ V14` không bị ảnh hưởng.
- **Triệu chứng**: Giao dịch Flyway chạy `UPDATE` toàn bảng rồi `ALTER COLUMN ... SET NOT NULL` (`courseId`, `creditsSnapshot`) và `ADD CONSTRAINT enrollment_course_fk` không có `NOT VALID`, giữ `ACCESS EXCLUSIVE` trên `academic."Enrollment"`.
- **Preflight queries (chỉ đọc trước deploy)**:
  ```sql
  -- 1. Phát hiện bản ghi không join được Section/Course (tránh fail SET NOT NULL)
  SELECT e."id", e."sectionId"
  FROM academic."Enrollment" e
  LEFT JOIN academic."Section" s ON s."id" = e."sectionId"
  LEFT JOIN academic."Course" c ON c."id" = s."courseId"
  WHERE s."id" IS NULL OR c."id" IS NULL;

  -- 2. Phát hiện trùng lặp active enrollment vi phạm unique index
  SELECT "studentId", "sectionId", count(*)
  FROM academic."Enrollment"
  WHERE "status" IN ('ENROLLED', 'PENDING', 'CONFIRMED')
  GROUP BY "studentId", "sectionId"
  HAVING count(*) > 1;

  SELECT e."studentId", s."courseId", e."semesterId", count(*)
  FROM academic."Enrollment" e
  JOIN academic."Section" s ON s."id" = e."sectionId"
  WHERE e."status" IN ('ENROLLED', 'PENDING', 'CONFIRMED')
  GROUP BY e."studentId", s."courseId", e."semesterId"
  HAVING count(*) > 1;
  ```
- **Xử lý**: V14 tự `DROP`/`ADD` lại `enrollment_course_fk` (có validate) và `SET NOT NULL`, nên không thể tránh hoàn toàn khóa bằng cách tạo trước FK hay CHECK. Giảm thời gian giữ khóa bằng cách backfill phân lô trước deploy (V14 chỉ còn cập nhật các dòng còn `NULL`), rồi chạy V14 trong cửa sổ bảo trì:
  ```sql
  ALTER TABLE academic."Enrollment"
    ADD COLUMN IF NOT EXISTS "courseId" VARCHAR(120),
    ADD COLUMN IF NOT EXISTS "creditsSnapshot" INTEGER;

  -- lặp lại (autocommit) đến khi cập nhật 0 dòng
  UPDATE academic."Enrollment" e
  SET "courseId" = s."courseId", "creditsSnapshot" = c."credits"
  FROM academic."Section" s
  JOIN academic."Course" c ON c."id" = s."courseId"
  WHERE e."sectionId" = s."id"
    AND e."id" IN (
      SELECT "id" FROM academic."Enrollment"
      WHERE "courseId" IS NULL OR "creditsSnapshot" IS NULL
      LIMIT 5000
    );
  ```

##### 2. Migration V53 (`academic."StudentGrade"`)

- **Đối tượng ảnh hưởng**: Môi trường có dữ liệu điểm ở phiên bản `< V53`. Cài đặt mới hoặc database đã ở `≥ V53` không bị ảnh hưởng.
- **Triệu chứng**: Lệnh `DELETE` trùng lặp chạy correlated subquery khi chưa có index gây quét tuần tự $O(n^2)$ trên bảng điểm hàng triệu dòng; xóa theo `min(ctid)` làm mất giá trị điểm cập nhật mới nhất.
- **Preflight query (chỉ đọc trước deploy)**:
  ```sql
  -- Kiểm tra trùng lặp (enrollmentId, gradeItemId) và các điểm liên quan
  SELECT "enrollmentId", "gradeItemId", count(*), array_agg("score" ORDER BY ctid)
  FROM academic."StudentGrade"
  GROUP BY "enrollmentId", "gradeItemId"
  HAVING count(*) > 1;
  ```
- **Xử lý ngoài băng an toàn**:
  1. Kiểm tra và giải quyết các dòng trùng lặp dựa trên kết quả preflight query (audit thủ công thay vì xóa tự động).
  2. Tạo index đồng thời trước khi deploy (chạy autocommit ngoài transaction block, quyền database owner):
  ```sql
  CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS academic_student_grade_enrollment_item_uq
      ON academic."StudentGrade" ("enrollmentId", "gradeItemId");
  ```
  Sau khi index đã tồn tại, câu lệnh tạo index trong V53 trở thành no-op và câu lệnh deduplicate không bị quét tuần tự $O(n^2)$.

##### 3. Migration V116 (`campuscore_auth."User"`)

- **Đối tượng ảnh hưởng**: Môi trường có dữ liệu ở phiên bản `< V116` (đặc biệt V115). Cài đặt mới hoặc database đã ở `≥ V116` không bị ảnh hưởng.
- **Triệu chứng**: `LOCK TABLE ... IN SHARE ROW EXCLUSIVE MODE` trên `campuscore_auth."User"` (và 6 bảng khác) xung đột với `ROW EXCLUSIVE` của các thao tác đăng nhập (`POST /api/v1/auth/login`), gây nghẽn đăng nhập; abort deploy nếu vướng transaction giữ khóa quá 10s (`lock_timeout = '10s'`).
- **Preflight queries (chỉ đọc trước deploy)**:
  ```sql
  -- 1. Kiểm tra xung đột dữ liệu tài khoản demo
  SELECT "id", "email", "isSuperAdmin"
  FROM campuscore_auth."User"
  WHERE "id" IN ('student-user', 'student-user-2', 'student-user-3', 'student-user-4')
     OR "email" IN ('student@campuscore.edu', 'student2@campuscore.edu', 'student3@campuscore.edu', 'student4@campuscore.edu');

  SELECT "id", "userId", "studentId"
  FROM academic."Student"
  WHERE "id" IN ('student-profile', 'student-profile-058', 'student-profile-059', 'student-profile-team-004')
     OR "userId" IN ('student-user', 'student-user-2', 'student-user-3', 'student-user-4')
     OR "studentId" IN ('24110054', '24110345', '24110051', '24162050');

  -- 2. Kiểm tra transaction đang mở trên bảng User
  SELECT pid, usename, state, age(clock_timestamp(), query_start), query
  FROM pg_stat_activity
  WHERE state != 'idle'
    AND pid <> pg_backend_pid();
  ```
- **Xử lý an toàn**:
  - Triển khai trong cửa sổ bảo trì (maintenance window), tạm dừng lưu lượng đăng nhập.
  - Kết thúc hoặc chờ các transaction mở trên `campuscore_auth."User"` hoàn tất trước khi chạy deploy.
  - Lưu ý cho migration sau: Không dùng `LOCK TABLE ... IN SHARE ROW EXCLUSIVE MODE` trên bảng auth mà chỉ khóa theo từng dòng (`SELECT ... FOR UPDATE` theo thứ tự khóa chính).

### Future go-live prerequisites (measured 2026-10-30 — không phải defect của repo này)

Các host dưới đây là **host đích tương lai** của ecosystem; việc chúng chưa
resolve/404 phản ánh go-live chưa mở, không phải lỗi cần sửa trong workspace local.

| Item | Probe result (2026-10-30) | Owner action khi mở go-live |
| --- | --- | --- |
| `id.campusute.io.vn` (OIDC issuer) | NXDOMAIN | Trỏ DNS về hosting đã chọn; issuer env `IDENTITY_ISSUER_URI` phải khớp |
| `api.campusute.io.vn` | NXDOMAIN | Trỏ DNS về API service (hoặc giữ `/api/v1` proxy và bỏ host này khỏi registry) |
| `/.well-known/assetlinks.json` | 404 trên www | Deploy frontend ≥ commit `4471465a`; fingerprint đã bind keystore release local (`0A:0B:8C:…`, xem `device-runbook.md`) |
| `/.well-known/apple-app-site-association` | 404 trên www | Cùng deploy; TeamID còn `SYNTH00000` — điền khi enroll Apple Developer (proposal trong `device-runbook.md`) |
| Physical device acceptance | NOT_RUN | Emulator pass là mức chứng minh hiện có; không thay physical |

## 6. Recovery

- Data corrupt → fence writer → `ops/backup/restore-postgres.sh` vào
  isolated target → verify parity → re-point → kiểm delta trước reopen.
- Thứ tự rollout frontend-trước-API trong schema-expand window và việc API image
  digest nằm trong manifest candidate chỉ áp dụng cho **future go-live**
  (deferred); recovery local không cần bước này.
- Supabase cũ **không** là fallback target.
- Không đổi bundle ID/package name để né lỗi (mobile-policy).
