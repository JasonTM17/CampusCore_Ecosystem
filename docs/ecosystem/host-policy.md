# Host policy — Browser BFF, host isolation và SSO xuyên miền (P05)

Contract implementation của ADR-B phần browser surface (selected-design §ADR-B,
§trust boundaries). P04 đã có identity authority (`identity-contract.md`); P05
thêm **browser-facing BFF lane**: mỗi host là confidential OIDC client riêng,
browser chỉ giữ opaque host-only cookie, mọi token nằm server-side.

## 0. Phạm vi pha

Trong `restful-api` (Java BFF + resource + identity cùng runtime, không JVM mới)
và `frontend` (Next = reverse proxy allowlisted routes + host routing). Consumer
preview SSO: `www` (portal) + `learn` (dummy protected route) + `apply`
(registry entry, chưa có UI — spec kiểm registry). `docs` host: không session.

## 1. Surface registry — `identity.bff.surfaces[]`

Single source server-side; frontend `src/lib/surfaces.ts` là projection đọc
config cùng shape (không tự khai client).

| Surface | Host production | Host local preview | Mode | OIDC client |
| --- | --- | --- | --- | --- |
| `apex` | `campusute.io.vn` | `apex.localhost` | redirect→portal, legacy lane | — |
| `portal` | `www.campusute.io.vn` | `portal.localhost` | BFF | `cu-portal` |
| `learn` | `learn.campusute.io.vn` | `learn.localhost` | BFF | `cu-learn` |
| `apply` | `apply.campusute.io.vn` | `apply.localhost` | BFF (registry only — UI P10) | `cu-apply` |
| `news` | `news.campusute.io.vn` | `news.localhost` | no-session, legacy lane | — |
| `docs` | `docs.campusute.io.vn` | `docs.localhost` | no-session | — |
| `identity` | `id.campusute.io.vn` | `id.localhost` | issuer | — |

`{base}` = scheme + host + port của surface host. Local preview:
`portal/learn/apply.localhost:3102` (cùng Next HTTPS dev, phân biệt Host),
`id.localhost:PORT` → TLS terminator → Java, `apex/news/docs.localhost` → Next.

**Surface resolution (KM-H2):** Host header của caller **không đủ** — prod là
Vercel→Render, custom host Java chỉ có `id`/`api`, `Host: www.campusute.io.vn`
không tới được Java BFF. Nên Next edge proxy (điểm duy nhất biết public host)
resolve surface từ Host, strip mọi `x-campuscore-*` do caller đưa, rồi set
`x-campuscore-surface: <surface>` + `x-campuscore-scheme: https` kèm
`x-campuscore-proxy-token` (pattern `CAMPUSCORE_PROXY_TOKEN` hiện hữu của
`route.ts`). **Set-or-strip bắt buộc**: không có token cấu hình thì vẫn strip
caller và set giá trị server-tính — không bao giờ forward header do caller
khai. Java BFF resolve surface từ `x-campuscore-surface` **chỉ khi** proxy
token hợp lệ; Host-header fallback chỉ trong profile dev/test (`local|dev|
test|e2e|h2` — prod `persistence` không fallback: forged Host tới Java trực
tiếp → surface null → fail closed). Stamped `x-campuscore-host` cũng chỉ
được honor khi host nằm trong `surfaces[].hosts` của surface đó — token hợp
lệ không cho phép edge redirect `baseFor` sang host lạ; không khớp → degrade
về `publicBaseUrl` canonical. Unknown/missing surface → 404 JSON
`SURFACE_UNKNOWN` — không 302 về default (tránh open redirect qua host
poisoning). Không client chọn theo query/Origin tự khai.

Callback exact per client: `{base}/session/callback`; post-logout:
`{base}/session/logged-out`.

## 2. Cookie matrix (ADR-B + abuse case cookie tossing)

| Cookie | Host | Attrs | Mục đích |
| --- | --- | --- | --- |
| `__Host-cu_session` | mỗi BFF surface host | Secure, HttpOnly, Path=/, **không Domain**, SameSite=Strict nếu redirect spec pass (Lax chỉ khi có lý do ghi lại) | opaque BFF session id |
| `cu_bff_tx_<txId>` | surface host | Secure, HttpOnly, Path=/session/callback, không Domain, SameSite=Lax, maxAge≤300s | transaction marker per-login — tên cookie mang txId để **nhiều tab login đồng thời không đè nhau** (KM-M6) |
| `cc_*` legacy | `id` + business surfaces | như hiện hữu | central session (id) + legacy lane trong transition window |
| dev tương đương | `*.localhost` HTTP | tên **không prefix** `__Host-`, Secure off — chỉ khi `identity.bff.dev-http=true` (local/test profile only) | dev không TLS |

Cookie tossing: `__Host-` + no Domain + Path=/ → sibling host không đặt đè
được. Cross-host copied opaque id bị reject bởi **surface binding**: cookie
`cu_session` của learn gửi lên portal host → lookup `WHERE id AND
surface='portal'` → miss → 401, không fallback.

Legacy cookie cleanup (KM-M11 — đã audit): `SessionCookieService` set
`cc_*` **không Domain attribute** → host-only cookies → host-only
`Set-Cookie: cc_<name>=; Max-Age=0` trên surface host xóa được. Nếu tương lai
có cookie Domain=.campusute.io.vn thì delete phải khớp Domain attr.

## 3. Java BFF — package `identity/bff/`

Session endpoints dưới `/session/*`, business proxy dưới `/bff/api/**`,
surface resolution theo §1:

- `GET /session/login` — resolve surface → tạo tx row (`txId` random,
  `state_hash` = sha256(state random), `nonce`, PKCE `verifier` S256 encrypted
  bằng `token-encryption-key` hiện hữu, `return_path` allowlisted) →
  `Set-Cookie: cu_bff_tx_<txId>` + `302` tới `id` authorize URL
  (`response_type=code`, `client_id=cu-<surface>`, `redirect_uri` exact,
  `scope=openid`, `code_challenge` S256, `state` raw, `nonce`). Return path:
  chỉ path tương đối bắt đầu `/` không `//`, prefix trong allowlist surface —
  else về `/`. Response `Cache-Control: no-store`.
- `GET /session/callback` — `SELECT … FOR UPDATE` + `DELETE` trên
  `bff_transaction` dưới tx của caller (atomic consume, portable — KM-L14) →
  verify cookie `cu_bff_tx_<tx.txId>` tồn tại + `tx.surface == surface hiện
  tại` + `tx.expires_at > now` → `POST /oauth2/token` loopback server-side
  (Basic `cu-<surface>` secret, `code_verifier` decrypt) → grant row → verify
  `id_token` (nonce == tx.nonce, signature+exp qua `IdentityJwtDecoder`
  JWK lane, `aud` chứa `cu-<surface>` — KM-L12) → **dưới `lockUserRow`**:
  re-assert account ACTIVE + `!mustChangePassword` + grant tồn tại (KM-M9)
  → insert `bff_session` + `__Host-cu_session` → `302` return_path.
  Grant đã bị delete giữa exchange và insert → xóa session row, về login.
- `GET /session/state` — **Origin-presence check** (§4 — mọi Origin khác
  surface base → 403, kể cả GET) → session từ cookie (§5 bước 1-2) → JSON
  `{ userId, roles, surface, expiresAt, csrfToken }` + `no-store`. Không
  token nào trong body.
- `POST /session/logout` — CSRF triple-check (§4) → **đọc `id_token`
  qua `findById(authorization_id)` (decrypt) TRƯỚC khi revoke** (KM-M5) →
  revoke `bff_session` (`revoked_at`) → `revokeClientGrants` → trả
  `{ logoutUrl }` = id `/connect/logout?id_token_hint&
  post_logout_redirect_uri={base}/session/logged-out` → browser full-page.
  Idempotent: session đã revoked → trả logoutUrl với hint null → id logout
  vẫn chạy (xóa `cc_session` id) → về logged-out.
- `GET /session/logged-out` — trả landing page metadata (owner của page
  là **Next static route** — endpoint này chỉ là API probe nếu cần; chọn
  Next làm owner — KM-L13).
- `ANY /bff/api/**` — business proxy (§5).

Authorization server dùng chung machinery P04: grant BFF nằm trong
`oauth2_authorization` (`campuscore_identity`), mirror Session + lineage qua
`LockingIdentityAuthorizationService`; **mọi method của
`UnifiedSessionAuthority` (`revokeAccount`, `revokeGrants`,
`revokeOtherGrants`, `revokeClientGrants`) đều xóa `bff_session` tương ứng
dưới cùng User lock** (KM-M4) — lock order thành User → Session →
`oauth2_authorization` → `bff_session`. Replay OIDC refresh lane BFF →
`OidcRefreshReplayHandler` → `revokeAccount` → mọi lane chết.

### Schema `V135` — đã landed (đồng bộ contract từ file, KM-M7)

```sql
CREATE TABLE campuscore_identity.bff_session (
  id varchar(64) PRIMARY KEY,               -- sha256(opaque cookie value)
  user_id varchar(120) NOT NULL,
  surface varchar(24) NOT NULL,
  client_id varchar(255) NOT NULL,          -- denormalized: client-scoped sweeps
  authorization_id varchar(255) NOT NULL,
  csrf_ciphertext varchar(512) NOT NULL,    -- AES-GCM (recoverable for /session/state)
  ip varchar(45), user_agent varchar(300),
  created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at timestamp NOT NULL, revoked_at timestamp);
-- indexes: (user_id), (user_id, client_id), (authorization_id), (expires_at)
CREATE TABLE campuscore_identity.bff_transaction (
  state_hash varchar(64) PRIMARY KEY,
  tx_id varchar(32) NOT NULL,                -- cookie-name suffix (KM-M6)
  surface varchar(24) NOT NULL,
  nonce varchar(64) NOT NULL, verifier varchar(512) NOT NULL,
  return_path varchar(300) NOT NULL,
  created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at timestamp NOT NULL);
-- index: (expires_at)
```

Index rationale: `user_id` cho account-revoke sweep, `authorization_id` cho
grant-delete cascade lookup, `expires_at` cho retention sweep. Opaque cookie
= `base64url(32B random)`, DB chỉ lưu sha256 — leak dump không mint cookie.
`.ip`/`.user_agent`: **record-only audit**, không reject khi đổi (KM-L14 —
proxy/NAT làm IP đổi giữa phiên là bình thường; binding cứng tạo lockout).

### Retention (KM-M8)

`IdentityGrantRetentionJob` mở rộng cùng flag/bounded-batch: delete
`bff_transaction WHERE expires_at < now` (orphan authorize legs) +
`bff_session WHERE expires_at < now OR revoked_at < now - grace`.

## 4. CSRF model (same-site siblings vẫn cross-origin)

Mutation BFF (`/bff/session/logout`, `/bff/api/**` non-GET) đòi **cả ba**:

1. `Origin` == surface `{base}` exact; absent Origin chỉ khi
   `Sec-Fetch-Site: same-origin` (navigational POST).
2. `Sec-Fetch-Site` ∈ {`same-origin`}; `cross-site`/`same-site` → 403.
3. `x-csrf-token` == csrfToken của `/session/state`, verify qua
   `csrf_ciphertext` (decrypt, constant-time compare) trong session row —
   bound session; attacker sibling không đọc được JSON state nên không có
   token.

`login`/`callback` là navigational GET — miễn CSRF; `cu_bff_tx_*` Lax chỉ
cho phép top-level GET mang cookie, state+tx consume one-time chặn replay.

Read paths (`/session/state`, mọi method `/bff/api/**`) áp **Origin-presence
check** hẹp hơn mutation guard: `Origin` header tồn tại → phải == surface
`{base}` exact, else 403 `ORIGIN_SURFACE_MISMATCH`. Lý do: credentialed
fetch từ sibling host (`learn` → `www` là **same-site** dưới eTLD+1 — cookie
`SameSite=Strict` vẫn được gửi) luôn mang `Origin` riêng; check này đóng
read-leak `/session/state` (`csrfToken`+business GET) ngay cả khi CORS
allowlist lỡ chứa sibling origin. CORS contract (đã chứng minh trên gate
run): phía Java **mọi BFF request mang Origin đều là cross-origin** — edge
hop đổi request URL thành loopback nội bộ trong khi browser gửi public
Origin, nên `app.cors.allowed-origin-patterns` **PHẢI liệt mọi public
surface origin + id origin** nếu không browser POST chết 403 trước khi tới
guard. Isolation KHÔNG nằm ở lớp CORS: sibling fetch `learn`→`portal` qua
CORS filter rồi chết tại origin guard (`Origin` ≠ resolved base → 403).
Id origin cũng bắt buộc: TLS terminator/edge không preserve scheme trên
lane `/api/v1/auth/*` (ForwardedHeaderFilter chỉ scope `/oauth2/*`,
`/.well-known/*`, `/connect/*`) → login POST mang `Origin: https://id…`
trên request http → CorsUtils gọi là CORS.

tx cookie match **exact-name**: callback chỉ chấp nhận cookie tên đúng
`cu_bff_tx_<tx.txId>` — cookie tossed từ sibling/subdomain (Domain=.
campusute.io.vn) mang txId ngoại → không match → inert, thay vì first-match
ambiguity. Residual đã ghi: login-CSRF qua link chứa (code,state) của
attacker + tossed cookie trùng tên attacker-tx vẫn khả thi **khi attacker
đã có cookie-injection primitive** (sibling/subdomain bị chiếm) — bounded
theo threat model cookie-tossing.

## 5. Business proxy `/bff/api/**`

Browser → Next edge (set `x-campuscore-surface` + proxy token) → BFF chain:

1. Resolve surface (§1); unknown → 404 `SURFACE_UNKNOWN`.
2. `__Host-cu_session` → sha256 → session row `WHERE id AND surface` →
   missing/revoked/expired → 401 `SESSION_REQUIRED`.
3. `findAccountAuthorization` dưới `lockUserRow` (User-first ordering):
   không ACTIVE → 403; `mustChangePassword` → 403
   `PASSWORD_CHANGE_REQUIRED` (rotation path = legacy lane trên `www`
   trong transition window — KM-L17); `credentialVersion` < current →
   revoke session → 401.
4. Load grant `findById(authorization_id)` → missing → revoke session +
   401 (grant đã bị authority xóa — KM-M4 bổ sung bằng check này). Access
   token hết hạn → **in-process single-flight refresh** (KM-H1):
   `ConcurrentHashMap` lock theo `(surface, session-id)` — DB locks
   KHÔNG được giữ qua loopback HTTP (lock-order User→session→grant mà
   SAS cũng lấy User lock trên connection khác = self-deadlock). Queued
   request re-read grant sau lock, thấy access token đã rotate → skip
   refresh — hai request song song cùng session KHÔNG BAO GIỜ trình cùng
   refresh token lên SAS → không false-replay → `revokeAccount` chỉ cháy
   khi replay thật. Update session `last_seen_at`.
5. Forward `GET|POST|PUT|PATCH|DELETE /api/v1/**` loopback
   `127.0.0.1:{port}` với `Authorization: Bearer <access>`; strip `cookie`,
   `x-forwarded-*`, `authorization` caller-đưa; set `x-campuscore-surface`
   + `x-campuscore-bff-secret: <per-surface secret>` (KM-M10 — config
   `identity.bff.surfaces[].proxy-secret` riêng từng surface; resource
   chain validate cặp surface↔secret trong `ClientIpResolver`-adjacent
   filter — request mang `x-campuscore-surface` mà secret sai/missing →
   403; direct request không header → xử lý như legacy lane bình thường).
   BFF forward kèm `x-campuscore-proxy-token` (token cấu hình) +
   `x-campuscore-client-ip` — client-ip chỉ được giữ khi inbound edge đã
   auth bằng token, else ghi `remoteAddr` socket (không forward giá trị
   caller tự khai). Response strip: hop-by-hop (`transfer-encoding`,
   `content-length`, `connection`, `keep-alive`, `te`, `trailer`,
   `upgrade`) + credential carriers (`set-cookie`, `www-authenticate`,
   `proxy-authenticate`, `authorization`).
6. Response pass-through + `Cache-Control: no-store` cho private; không
   bao giờ serialize token ra body.

Allowlist path: `identity.bff.api-allowlist` prefix list — path khác → 404.
Không proxy `/bff/**`, `/oauth2/**`, `/connect/**`, actuator. Loopback call
vào `/oauth2/token` + `/api/v1` đi dedicated `RateLimitFilter` bucket qua
`x-campuscore-bff-secret` auth (KM-L16 — tránh self-DoS khi burst).

### 5a. Anonymous public lane (P06)

Bước 2–4 yêu cầu opaque session; ngoại lệ duy nhất: **không có cookie
session** + `GET|HEAD` + upstream nằm trong
`identity.bff.public-api-allowlist` → forward **không** `Authorization`
(header bị bỏ hoàn toàn, không phải Bearer rỗng). Upstream `permitAll`
trong `SecurityConfig` là authority — allowlist mirror đúng tập anonymous:
`/api/v1/announcements/public`, `/api/v1/public/docs`,
`/api/v1/article-taxonomy/v2/categories`, `GET /api/v1/site-appearance`.
Cookie session có mặt nhưng không hợp lệ (revoked/expired/forged) → vẫn
401 `SESSION_REQUIRED`: không bao giờ silently downgrade caller có session
sang anonymous. Non-GET không qua lane này (csrfGuard + upstream 401/403).
Contract evidence: `EcosystemBffContractTest` — anonymous pass-through 200,
session path vẫn 401, stale cookie trên public path vẫn 401.

## 6. Frontend plumbing

- `src/lib/surfaces.ts` — đọc `NEXT_PUBLIC_SURFACE_HOSTS` JSON (env-build),
  map host→surface; `surfaceFromHost()`, `isKnownSurface`, `baseFor()`.
  Registry gồm **cả apex/news/docs** (mode redirect/no-session — KM-H3).
- `middleware.ts` — trước locale logic: host không thuộc registry → rewrite
  not-found **không redirect**; `apex` → 301 `www`; surface host request mang
  `cc_*` cookie → response `Set-Cookie cc_<name>=; Max-Age=0` per host.
- `src/app/session/[...path]/route.ts` — allowlist `{login,callback,state,
  logout}` → Java `/session/{path}`; strip caller `x-campuscore-*`,
  set `x-campuscore-surface` (từ registry theo request Host) +
  `x-campuscore-scheme` + proxy token (set-or-strip §1); `Set-Cookie`
  pass-through; `logged-out` là **Next page**, không qua proxy.
- `src/app/api/v1/[...path]/route.ts` — surface hosts → `/bff/api/v1/**`
  (BFF lane); apex/legacy behavior giữ nguyên theo `NEXT_PUBLIC_BFF_LANE`.
- Login UI portal: "Đăng nhập SSO" → `GET /session/login` (full-page);
  legacy form giữ cho transition. `logged-out` page + session-expired
  cold-start UX (`/bff/api` 401 → `302 /session/login?return=<current>`
  — return qua allowlist).
- `e2e/ecosystem-sso.spec.ts` — spec gate (§9).

## 7. `id` host surface

Java trên `id.localhost` (TLS terminator dev) / `id.campusute.io.vn` (prod —
Java custom host trực tiếp): `/oauth2/**`, `/.well-known/**`,
`/connect/logout`, `/login` (minimal HTML form — POST
`/api/v1/auth/login` qua fetch, success → `continue` allowlisted:
chỉ `/oauth2/authorize?…` cùng host), `/api/v1/auth/login|refresh|logout|
password` (central session authority). Response id host:
`frame-ancestors 'none'` (CSP + X-Frame-Options) — check trong spec.

## 8. Flag matrix + recovery

| Flag | Default | Hành vi |
| --- | --- | --- |
| `identity.bff.enabled` | `false` | `/bff/**` → 404; host validation vẫn chạy (apex/news/docs cần routing) nhưng không tạo session |
| `identity.bff.dev-http` | `false` | cookie không `__Host-`, Secure off — startup **fail** nếu không có profile nào trong `{local, dev, test, e2e, h2}` (prod `persistence` cố ý ngoài danh sách — `IDENTITY_BFF_DEV_HTTP=true` trên prod = refuse boot) |
| `app.rate-limit.proxy-token` | — | ngoài dev profiles thì **bắt buộc non-empty** khi BFF enabled (startup fail) — không token thì edge-stamped headers không auth được |
| `NEXT_PUBLIC_BFF_LANE` | `false` | `/api/v1` proxy đi `/bff/api` thay legacy direct |

Rollback: tắt `identity.bff.enabled` → consumer routes mới 404, portal
legacy lane sống trong transition window; session đã revoke vẫn revoked
(`revoked_at` durable); **không fallback cookie miền cha**. V135 expand-only
→ rollback image hợp lệ tới image còn chứa V135+.

## 9. Gate `browser-sso` — spec coverage map

`e2e/ecosystem-sso.spec.ts` (Playwright, HTTPS preview, `ignoreHTTPSErrors`
cho self-signed; VI+EN pass trên portal route):

| Case | Case trong spec |
| --- | --- |
| www/learn/apply registry + unknown host reject + apex→www | host-routing |
| SSO lần 1 full-page qua id; lần 2 learn không nhập mật khẩu | sso-journey |
| `__Host-cu_session` per host, không Domain, host cache separation | cookie-isolation |
| Malicious sibling POST (learn → portal `/bff/api` kèm portal cookie) → 401/403 | sibling-post |
| Cookie tossing: sibling cố set `cu_session`/`cu_bff_tx` → không đè | cookie-tossing |
| OAuth mix-up: state của learn dùng ở portal callback → reject; open redirect `return=//evil`/`return=https://evil` → về `/` | mixup-redirect |
| Tab refresh race: hai tab song song `/bff/api` trên session access-token-hết-hạn → cả hai 200, không revoke | tab-race |
| Business sau `revokeAccount` → 401 trên mọi host | revoke-deny |
| `no-store` trên `/bff/session/state` + private `/bff/api` | cache-headers |

## 10. Open items / không chứng minh

- HTTPS preview: `next dev --experimental-https` self-signed + Node TLS
  terminator cho id; Playwright `ignoreHTTPSErrors`. Thiếu → gate BLOCKED.
- `apply`: registry entry only — UI P10. `news`: no-session mode — UI P06.
- docs host CSP riêng hạn chế script — P06. HSTS includeSubDomains — P14.
- `id_token_hint` chỉ còn hiệu lực khi grant chưa bị delete khác — logout
  idempotent chấp nhận hint null (id logout endpoint không đòi hint khi
  cookie `cc_session` còn). Ghi rõ phạm vi "browser không nhận token":
  access/refresh **không bao giờ** rời server; `id_token` xuất hiện duy
  nhất bên trong `logoutUrl` (id_token_hint là cơ chế chuẩn RP-initiated
  logout — nó không phải credential cho `/api/v1`, resource lane đòi
  `tokenType=access`).
- Loopback `/bff/api` là một HTTP hop nội bộ — latency cộng thêm ~1-2ms
  local; honest BFF, resource chain không đổi.
