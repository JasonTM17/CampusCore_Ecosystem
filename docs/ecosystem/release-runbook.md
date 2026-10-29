# Release runbook — demo candidate → staged deploy → rollback

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

```powershell
# demo stack đang chạy (compose project bất kỳ):
$env:ECO_DRILL_CONTAINER='campuscore-demo-p14-postgres-1'
$env:ECO_DRILL_DB='campuscore_restful_e2e'
node scripts/ecosystem-backup-drill.mjs --out artifacts/verification/demo
# → demo-<ts>.dump + .sha256 + backup-drill.json (row-count parity mọi
#   bảng, FK parity, orphan checks library/careers/events/admissions).
#   exit 4 = BLOCKED_CAPABILITY khi không có stack.
```

Sau drill: verify archive bằng `ops/backup/verify-backup.sh` nếu restore
bằng tay. Restore **luôn** vào DB isolated (`demo_restore_*`) — script từ
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

## 5. Staged deploy (BLOCKED_CAPABILITY hiện tại)

Cần DNS + hosting credentials + store/signing. Khi có:

1. Deploy API/id trước (image digest pin trong manifest).
2. Deploy web hosts (portal/learn/apply/apex) trỏ surface registry.
3. `probe-ecosystem-hosts.mjs` chống declared hostname (không `--insecure`).
4. Canary synthetic personas → full lifecycle suite → live smoke.
5. Rollback drill: restore backup hiện tại → attachment parity → delta
   check trước reopen. DNS rollback theo record thực — TTL không tức thì.

## 6. Recovery

- Data corrupt → fence writer → `ops/backup/restore-postgres.sh` vào
  isolated target → verify parity → re-point → kiểm delta trước reopen.
- Frontend deployment trước trong schema-expand window; API image digest
  phải nằm trong manifest candidate.
- Supabase cũ **không** là fallback target.
- Không đổi bundle ID/package name để né lỗi (mobile-policy).
