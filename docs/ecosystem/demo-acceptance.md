# Demo acceptance matrix — D0–D10

Bảng nghiệm thu demo C2: mỗi requirement map tới gate + evidence directory.
Gate `demo` tổng hợp — nó **không tự cấp PASS** cho các leg capability-gated
(deploy/DNS/device); một verdict PASS nghĩa là các leg executable đã chạy và
các leg còn lại hiển thị BLOCKED/NOT_RUN trong report.

| Req | Nội dung | Phase | Gate / evidence | Trạng thái |
| --- | --- | --- | --- | --- |
| D0 | An toàn dữ liệu — chỉ fixture synthetic, không clone production | P01, P14 | `baseline` (6/6) + `demo-reconcile` (seed allowlist) | PASS local |
| D1 | Định danh — SSO portal↔LMS↔admissions + system browser mobile | P04, P05, P13 | `identity` (2/2), `bff` (5/5), `devices` assoc leg | PASS local; device lanes BLOCKED_CAPABILITY |
| D2 | Học vụ hiện hữu — đăng ký/lịch/điểm/khóa luận/trợ lý/thông báo giữ invariant | P02, P07, P14 | `platform` (6/6 executed, 1 non-required FAIL recorded — stale CorrectionMigration ITs, defect-ledger owned), `mobile-core` (3/3) | PASS local |
| D3 | Hub/tin/tài liệu — soạn→duyệt→công bố→tìm/đọc VI/EN | P06 | `content` (4/4) | PASS local |
| D4 | Sự kiện — công bố→đăng ký→roster→điểm danh→lịch sử | P08 | `events` (4/4 stable-source) | PASS |
| D5 | LMS — roster→tài liệu→bài tập→nộp→phản hồi | P09 | `learning` (4/4 stable-source) | PASS |
| D6 | Tuyển sinh — nháp→nộp→trả sửa→nộp lại→quyết định mô phỏng | P10 | `admissions` (4/4 stable-source) | PASS |
| D7 | Thư viện — danh mục→yêu cầu→xuất mượn→trả→khả dụng | P11 | `library` (4/4 stable-source) | PASS |
| D8 | Việc làm — kiểm duyệt tin→ứng tuyển→cập nhật trạng thái | P12 | `careers` (4/4 stable-source) | PASS |
| D9 | Mobile/API — mọi miền thao tác native, Android/iOS kiểm chứng riêng | P03, P07, P13 | `devices` (3/5 executed, 2 blocked); contracts | Partial — OS device evidence BLOCKED_CAPABILITY |
| D10 | Vận hành — quota/cold-start đo, backup/restore, rollback, giới hạn free | P03, P14 | `demo` (manifest + reconcile + drill/probe khi stack có) | Partial — deploy/DNS BLOCKED_CAPABILITY |

## Rehearsal evidence binding

`scripts/ecosystem-release-manifest.mjs` binds the candidate: git SHA +
source hash + Flyway head + spec/contract digests + per-gate evidence
digests + device-association digests + rehearsal-artifact digests. A
manifest with `dirtyWorktree: true` is never releasable. Each gate's
latest evidence must be `verdict: PASS` and must not show
`sourceStable: false` (intra-run drift); evidence produced on an
ancestor snapshot of the candidate commit is ancestor-valid and flagged
`stale: true` in `evidenceSummary` — evidence whose gitSha is not on the
candidate's history is rejected outright, and evidence with no source
identity is flagged `unverifiable`.

`scripts/ecosystem-backup-drill.mjs` produces `backup-drill.json` (per-table
row-count parity, FK parity, named orphan checks) against whichever demo
postgres `ECO_DRILL_CONTAINER`/`ECO_DRILL_DB` point at — exit 4 =
BLOCKED_CAPABILITY when no stack is running.

`scripts/probe-ecosystem-hosts.mjs` produces the live host probe
(TLS/cache/redirect/CSP/association) once surfaces are up — see
`release-runbook.md` §3 for the preview boot recipe.
