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

1. Build API/id image từ commit đã qua cổng staged, gắn tag `candidate-<sha>`, chạy scan + SBOM attestation và xác nhận review exact-head trước khi promote tag release chính thức (không promote `latest` tự động). Repo này **không** chứa workflow publish image. Với database đã có dữ liệu (populated database), thực hiện quy trình pre-deployment DDL cho các migration nặng khóa (V146, V147) theo [Flyway lineage pre-deployment](../integrations/flyway-lineage.md#44-pre-deployment-procedure-for-populated-databases-lock-heavy-migrations-v146-v147) trước khi khởi động API.
2. Deploy web hosts (portal/learn/apply/apex) trỏ surface registry.
3. `probe-ecosystem-hosts.mjs` chống declared hostname (không `--insecure`).
4. Canary synthetic personas → full lifecycle suite → live smoke.
5. Rollback drill: restore backup hiện tại → attachment parity → delta
   check trước reopen. DNS rollback theo record thực — TTL không tức thì.

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
