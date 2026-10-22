# Ecosystem verification runner

Pha: P01 step 3 · Runner: `scripts/verify-ecosystem.mjs` · Registry: `scripts/verify-ecosystem.gates.json` · Policy dữ liệu: [demo-data-policy.md](./demo-data-policy.md) · Baseline: [baseline.md](./baseline.md)

## Cú pháp

```bash
node scripts/verify-ecosystem.mjs --gate <name> --target local|preview|demo --evidence <repo-relative dir>
node scripts/verify-ecosystem.mjs --list   # liệt kê gate đã đăng ký
node scripts/verify-ecosystem.mjs --gate <name> --only <caseId,caseId>  # rerun đúng phần fail theo budget
```

- `--gate`: tên gate trong registry; gate chưa đăng ký hoặc không có case → exit 3 `NOT_RUN`.
- `--target`: chỉ allowlist `local|preview|demo`; giá trị khác → exit 2.
- `--evidence`: thư mục repo-relative chứa `report.json`, `run.log`, `<case>.log`; mặc định `artifacts/verification/<gate>`. Mọi log được mask secrets.
- `{evidence}`, `{gate}`, `{target}`, `{auto-project}` được substitute trong case args. `{auto-project}` = tên disposable compose `campuscore-ecosystem-fixture-<pid>-<ts>` duy nhất mỗi lần chạy.

## Contract (không bao giờ pass rỗng)

| Tình huống | Kết quả |
| --- | --- |
| Gate chưa triển khai / không có case | exit 3 `NOT_RUN` |
| Required case thiếu capability | exit 4 `BLOCKED_CAPABILITY` |
| 0 case được thực thi | exit 3 `NOT_RUN` |
| Bất kỳ required case nào FAIL | exit 1 `FAIL` |
| Required case kết thúc `NOT_RUN` (target filter / thiếu run.cmd) | exit 3 `NOT_RUN` — case bắt buộc không chạy là evidence gap, không green-pass |
| Tất cả required PASS, ≥1 executed | exit 0 `PASS` |
| `--only` subset chạy, tất cả PASS nhưng không đủ full gate | exit 0 `PASS_PARTIAL` — không bao giờ đọc là full-gate PASS |

Exit code con 4 được ánh sang `BLOCKED_CAPABILITY`; exit 3 sang `FAIL` kèm reason `NOT_RUN`. Java regression chạy bằng Maven selector thật và từ chối test-count 0 (quy ước khi case Maven xuất hiện từ P02+). PostgreSQL IT bắt buộc ở gate DB — thiếu Docker là `BLOCKED_CAPABILITY`, không được âm thầm skip.

## Capability

`docker` được probe trực tiếp (`docker compose version`). Mọi capability khác (device ios/android, dns, legal, signing, provider…) phải được khai báo qua env `ECO_CAP_<NAME>=1`; thiếu env = `BLOCKED_CAPABILITY`, không giả định.

## Registry hiện hữu

| Gate | Owner | Cases |
| --- | --- | --- |
| `baseline` | P01 | `node-version`, `frontend-npm-ci`, `mobile-npm-ci`, `mobile-npm-test`, `mobile-typecheck`, `fixture-pack` (capability: docker) |
| `platform` | P02 | `java-verify`, `contract-snapshot`, `platform-image`, `platform-stack`, `postgres-lock-order`, `postgres-content-audit` (non-required — content-drift tracking) |
| `contracts` | P03 | `tokens-check`, `contract-probes`, `cross-account-cache`, `pgit-real`, `frontend-typecheck` (`npm run typecheck` = next typegen + tsc), `mobile-typecheck` |
| `identity` | P04 | `identity-contract-tests` (H2: discovery contract, JWKS rollover ring, auth-code+PKCE+nonce, resource lane, userinfo, single-use code, wrong verifier, offlist callback, no-session redirect, suspended/must-change-password, ciphertext columns, wrong iss/aud, rollover decode, disabled+paused surfaces), `postgres-race` (capability: docker — `UnifiedSessionRevocationPostgresIT` trên disposable Postgres: cross-lane replay revoke, save/revoke race, per-client logout) |
| `bff` | P05 | `host-registry` + `static-policy` (R2-1 CI gates: doc↔code↔projection parity, cookie/CSRF/token-leak sentinels), `bff-contract-tests` (H2 real-HTTP `EcosystemBffContractTest`: login→callback→state→logout journey, PKCE+nonce, tx-scoped cookies, CSRF triple-check, registry fail-closed, forged proxy headers, redirect surfaces, `/bff/api` allowlist + bearer inject + no-store, client-scoped revoke), `bff-postgres-race` (capability: docker — `BffSessionPostgresIT` trên disposable Postgres: single-flight concurrent refresh, logout-vs-refresh, callback-vs-grant-delete, account/per-client sweep, one-time tx consume, bounded retention), `browser-sso` (capability: docker — `ecosystem-sso-verify.mjs preview`: compose BFF lane + self-signed TLS terminator `id.localhost:4443` + `next dev --experimental-https` trên mọi `*.localhost` surface + Playwright `ecosystem-sso.spec.ts`: host routing, SSO journey 2 surfaces, cookie isolation, sibling CSRF, mix-up/open-redirect, tab race, revoke-deny, no-store, VI/EN) |
| `content` | P06 | `content-lifecycle` (H2 `AnnouncementContractPersistenceTest`: DRAFT→REVIEW→PUBLISHED→ARCHIVED, FOR UPDATE transitions, scheduled publish, version guard, VI/EN search, no-RAG-leak), `content-docs` (docs registry contract), `content-assets` (attachment/gallery scoping), `content-e2e` (capability: docker — `ecosystem-content-verify.mjs preview` + Playwright `ecosystem-content.spec.ts`: hub modules incl. planned-disabled entries, news read VI/EN, docs read, lecturer queue workflow, cache `no-store` on authenticated lanes) |
| `mobile-core` | P07 | `mobile-oidc-probe` (H2 `EcosystemMobileOidcProbeTest`: `cu-mobile` public client — authorize+PKCE exchange, refresh mint/rotate, revoke, account freshness gate, missing-verifier invalid_grant), `mobile-tests` (`npm test` — route guards, session storage mirror, OIDC flow pure core, query lifecycle, screen atlas), `mobile-typecheck` |
| `events` | P08 | `events-contract` (H2 `EventContractPersistenceTest`: lifecycle, scoped staff grants, roster/attendance authz, idempotent register/cancel, notifications same-tx, no `conduct_semester_score` writes), `events-postgres-race` (capability: docker — `EventCapacityPostgresIT` trên disposable Postgres: last-seat race exactly-one-winner, cancel frees one seat), `events-e2e` (capability: docker — `ecosystem-events-verify.mjs preview` + Playwright `ecosystem-events.spec.ts`: create→publish→open→register journey, EVENT_FULL, cancel notify + retained history, `/admin/events` staff roster render + attended mark) |

Binding R2-1 (`execution-contract.md` §Sửa đổi R2): P03 đăng ký `contract-drift` (kèm CI workflow diff), P05 đăng ký `host-registry` + `static-policy`; P14 `demo` tái chạy các gate này.

## Contract generator (`scripts/generate-api-contract.mjs`)

Oracle chính của gate `contracts`. Luồng:

1. Fetch `/v3/api-docs` từ runtime (`--base-url`) hoặc đọc `--spec-file`
   (mode `spec-file`; `--spec-file` trỏ chính artifact committed → đánh dấu
   `specFileSelfCheck` — chỉ chứng minh spec↔types nhất quán, KHÔNG chứng minh
   parity với live API).
2. Normalize: bỏ `servers` (deployment info, không phải contract), bỏ
   pseudo-props `all`/`empty` của `MultiValueMapStringString` (springdoc leak
   writeOnly accessors của Spring binding type — contract thật của query-param
   map là free-form string-array). Cùng normalization áp vào committed spec
   trước khi diff — normalization không bao giờ đọc thành breaking removal.
3. Invariants: required paths (`auth/login|refresh|me|logout`, notifications);
   forbidden self-registration — path trên auth surface
   (`/auth|/users|/accounts` + `regist|sign-up|create-account|self-regist|onboard`
   — auth surface không được chứa registration nào), self-registration
   segment đúng-nguyên-từ ở bất cứ đâu (`self-regist*|self-sign-up|public-register*|onboard`),
   operationId (`selfRegister|selfSignup|signUp|createAccount|publicRegister|selfEnroll|enrollSelf`,
   hoặc `^register` khi path nằm trên auth surface);
   fixtures: upload ≥1, nullable(optional-prop) ≥1, enum ≥1, paging ≥1;
   `nullableStrict` (explicit null-typed schema) đếm trung thực — hiện 0,
   ghi note vì runtime JSON nulls chưa documented.
4. Additive diff vs committed spec (đệ quy): endpoint/schema removal,
   property removal ở mọi depth, newly-required property, type/format đổi,
   narrowed enum ở mọi schema node, param bị xoá hoặc newly-required, xoá
   requestBody/response-code, thay đổi request/response schema → FAIL trừ
   khi allowlist `contracts/ecosystem/contract-allowlist.json` có entry
   (mỗi entry cần reason + pha sanction; key canonical: `METHOD path`
   uppercase hoặc label `schema:Name[.prop]`).
5. Type generation: `openapi-typescript@6.7.6` (pinned cả hai lockfile) →
   staging dir `.contract-check-*` (repo-relative, dọn lúc khởi động và sau
   mỗi run; đã gitignore). Generated files KHÔNG `@ts-nocheck` — tsc thật
   validate chúng qua `*-typecheck` cases.
6. **Staging-write**: mọi artifact generate vào staging; chỉ promote sang
   committed path khi report sạch hoàn toàn — run FAIL không bao giờ mutate
   baseline (self-heal oracle ngược lại cho phép run thứ hai pass ảo).
   `--check` hoàn toàn read-only: regenerate vào staging rồi byte-compare.

## Ngân sách chạy

Mỗi gate chạy một lần tại exit pha; chỉ rerun phần fail hoặc phần bị repair ảnh hưởng. Broadening chỉ khi diff đổi public contract/schema/auth chung. Tối đa 2 sửa tập trung cùng gate, sau đó đúng 1 specialist-guided attempt; còn fail ghi blocker. Terminal P14 chạy toàn bộ suite trên snapshot đóng băng.

## Evidence identity

`report.json.identity` ghi node version, platform, gitSha, timestamp, evidenceDir, runId; `counts` tách executed/passed/failed/blocked/notRun. Checkbox thoát pha chỉ được check khi đường dẫn evidence này đã ghi trong ledger (R2-3).
