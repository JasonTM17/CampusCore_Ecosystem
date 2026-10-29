# Identity contract — một session authority (P04)

Pha: P04 step 1–3 · Owner: controller · Review: Kongming R1 PASS_WITH_CONDITIONS
(findings 1–15 đã vá vào bản này), Wukong falsification sau implementation.
Liên quan: `selected-design.md` §ADR-B (dòng 67–77), `domain-contracts.md`,
`observability.md`, gate `identity` trong `verify-ecosystem.gates.json`.

## 0. Phạm vi pha

D1 nền identity, **chưa công khai consumer**: authorization server OIDC chạy
trong `restful-api`, registered clients từ config, JWKS/key rollover,
auth-code+PKCE+nonce, unified session authority bridge legacy↔OIDC, recovery
flags. Browser BFF + host isolation + sibling queue là **P05**; native client
(public + PKCE, không secret) là P07.

## 1. Characterization — trạng thái hiện hữu (oracle giữ lại)

| # | Hành vi hiện tại | Nơi | Oracle |
| --- | --- | --- | --- |
| C1 | Login: bcrypt + DUMMY_HASH burn cho unknown email, lock 5 lần/30', bypass lock nếu IP giữ session live của account | `AuthLoginService:45-119` | tests + gate pgit |
| C2 | Refresh: JWT `tokenType=refresh`+`jti`, SHA-256 vào `Session.refreshToken`, rotate in-place (stable `Session.id`); token hợp lệ nhưng hash không còn active = replay → `deleteAllRefreshSessions` + warn + 401 | `AuthLoginService:172-221` | replay tests |
| C3 | Lock order: **User → Session** (`lockUserRow` trước mọi session op; `FOR UPDATE OF se` sau) | repository | `*LockOrder*PostgresIT` |
| C4 | Logout: pin `Session.id` trước User lock; session rõ → xóa row; mơ hồ → xóa hết + `bumpCredentialVersion` + `clearUserRefreshToken` | `AuthLoginService:315-335` | logout tests |
| C5 | `credentialVersion` + status + roles/permissions/student/lecturer so DB **mỗi request** qua `AccountStateFilter`, chỉ trên URI `/api/v1/*`, fail-closed 503 | `AccountStateFilter:41-60` | account-state tests |
| C6 | `cc_access_token`/`cc_refresh_token` HttpOnly Lax path=/ + `cc_csrf` readable; double-submit cho cookie-auth mutations | `SessionCookieService`, `CsrfCookieFilter` | csrf tests |
| C7 | `User.refreshToken` là **write-mirror của session mới nhất**: được ghi ở login (`insertRefreshSession:300-303`) và mọi rotation (`rotateRefreshSession:330-333`), clear ở logout/changePassword; **không còn reader nào** | repository | — |
| C8 | Resource server: single HS256 decoder, `tokenType=access` + `roles` bắt buộc, claims khớp DB | `SecurityConfig:43-69` | resource tests |
| C9 | Access TTL 900s, refresh TTL 604800s; issuer `campuscore-restful-api`; refresh secret riêng `security.jwt.refresh-secret` | `AuthTokenService` | — |

Invariants giữ nguyên: User→Session lock order (mở rộng thành 3 bảng §2.3);
credential-revision gate; replay→account-wide revoke (ADR-B:77); không public
registration; **không password grant** — `/api/v1/auth/login` giữ nguyên là
endpoint trực tiếp của business chain, không trở thành ROPC grant.

## 2. Target contract (ADR-B → implementation)

### 2.1 Component map

| Contract | Implementation | Ghi chú |
| --- | --- | --- |
| Authorization server | `spring-security-oauth2-authorization-server:7.1.1` + Boot module `4.1.1` (pom đã có, compile PASS) | không SAS 1.5/EOL |
| Issuer | `AuthorizationServerSettings.issuer = ${identity.issuer-uri}`; local demo `http://127.0.0.1:4010`, prod `https://id.campusute.io.vn` | §2.6 proxy constraint |
| Registered clients | `RegisteredClientRepository` custom đọc `identity.clients[]` config: exact `redirectUris`/`postLogoutRedirectUris`, no wildcard. **Browser surface = confidential** (secret hash qua env); **native = public + PKCE S256 bắt buộc** (KM finding 10 — native không giữ secret được) | config-driven, không DB |
| Ký bất đối xứng | `identity.keys[]` RSA PEM qua env (không vào repo/DB): `kid`, `active`, key material. `JWKSource` public toàn ring qua `/oauth2/jwks`; rollover = add key + flip active, key cũ verify trong overlap | dev/test sinh RSA in-memory khi `identity.dev-keygen=true` |
| Auth-code + PKCE + nonce | SAS `OAuth2AuthorizationService`: code one-time, `code_challenge_method=S256` required trên mọi client, state/nonce do client gửi — server embed nonce vào id_token | SAS-native |
| Authorization persistence | `JdbcOAuth2AuthorizationService` trên `campuscore_identity.oauth2_authorization` qua **Hikari pool thứ hai** (`schema=campuscore_identity`, max 4) — bảng SAS dùng tên unqualified, `currentSchema=thesis` của pool chính không đụng được | không InMemory |
| **Token at-rest encryption** | `LockingIdentityAuthorizationService` rebuild mọi token object trước persist: tất cả cột `*_token_value` là AES-256-GCM deterministic (`identity.token-encryption-key` env) — ADR-B "token mã hóa ở PostgreSQL" đúng chữ. Cột `attributes` KHÔNG encrypt (chứa metadata, không token); principal attribute được sanitize sang `UsernamePasswordAuthenticationToken` (không nhúng JWT raw) (KM finding 5) | stock SAS lưu raw — đây là lớp bọc bắt buộc |
| OIDC scopes | `openid profile email` + `offline_access` trên clients cần refresh | first-party |
| Claims trong OIDC access token | `OAuth2TokenCustomizer<JwtEncodingContext>` nhét `credentialVersion`, `roles`, `permissions`, `studentId`, `lecturerId`, `student.year` — cùng shape claims legacy để `AccountStateFilter.matchesCurrentAuthorization` chạy không đổi (KM finding 1) | gate bằng DB mỗi request giữ nguyên |
| Login/2FA qua authority | `/oauth2/authorize` yêu cầu authenticated: `cc_*` cookie → `CookieOrBearerTokenResolver` → `JwtAuthenticationToken`; `principal_name = User.id` (**join key invariant** của mọi lookup/revoke); unauthenticated → entry point redirect `identity.login-page` (default `/login?return=`), silent-refresh là việc của login UI (P05) | mustChangePassword/status gate trên authorize — §2.4 |
| Refresh OIDC | Opaque (SAS default) — không JWT; reuse detection của SAS → bridge §2.3 | |
| Resource server | `IdentityJwtDecoder` dispatch trên raw `iss` claim (string compare — `campuscore-restful-api` không phải URL nên `JwtIssuerAuthenticationManagerResolver`/trusted-issuer không dùng được, KM finding 9): legacy iss → HS256 decoder + `tokenType=access` shape; issuer-uri → `NimbusJwtDecoder` JWKSource nội bộ + aud ∈ registered clientIds | hai validator tường minh, không fallback |
| Session mở rộng | `Session` += `lane`(`LEGACY`/`OIDC`/`BFF`), `clientId`, `authorizationId`, `revokedAt`, `rotatedAt`; default `LEGACY` — old image không vỡ | Flyway V134 |
| **OIDC→Session mirror** | Session writer = `OAuth2AuthorizationService` decorator §2.3: grant chứa refresh token → upsert Session `lane='OIDC'`, `refreshToken=sha256(token)`, `authorizationId`, `expiresAt`; authorization removed → xóa row. Giữ `hasRecentSessionFromIp` cover OIDC lane (KM finding 8) | unified view = chính bảng Session |
| Idempotent logout | `/connect/logout` (SAS OIDC default, P04 scope): revoke grants **của principal đó trên client đó** (gọi lại = no-op) + `logout_audit` một row/event với requestId làm correlation column + exact `post_logout_redirect_uri`. `/api/v1/auth/logout` giữ semantics C4. Account-wide cross-surface = P05 sibling queue (KM finding 11) | per-client revoke |
| Cleanup | `IdentityGrantRetentionJob` theo pattern `PasswordResetTokenRetentionJob`: purge `oauth2_authorization` hết hạn mọi token + `logout_audit` quá retention — bounded batch, cron off-peak, flag-gated | không xóa audit trong grace |
| Recovery | bảng flag §2.5 | |

### 2.2 Endpoint surface

SAS filter chain `@Order(1)` với `securityMatcher` **exact**:
`/oauth2/*`, `/.well-known/openid-configuration`, `/.well-known/oauth-authorization-server`
(matcher rộng sẽ nuốt `/api/v1` và phá C1–C9 — KM sequencing 5).

```
GET  /oauth2/authorize            authenticated (central session cookie); entry point → login-page redirect
POST /oauth2/token                client auth; grant=authorization_code(+PKCE)|refresh_token; client_credentials/device_code KHÔNG enable
GET  /oauth2/jwks                 public
GET  /.well-known/openid-configuration  public — discovery probe §3
POST /oauth2/revoke               client auth; idempotent
GET  /oauth2/userinfo             bearer OIDC access
GET|POST /connect/logout          session cookie + exact post_logout_redirect_uri
```

SAS chain cũng gắn `CsrfCookieFilter` + `RateLimitFilter` (KM finding 13):
`/connect/logout` cookie-auth POST cần double-submit; `/oauth2/token` dùng
chung IP bucket `DEFAULT_POST` của `RateLimitFilter` (không có bucket riêng)
— đã cover brute force ở mức endpoint POST thường.

### 2.3 Lock order 3 bảng + replay bridge (KM finding 2, 8)

Thứ tự global: **User → Session → oauth2_authorization**.

`UnifiedSessionAuthority` (`identity/` package, `@Profile("persistence")`):

- `revokeAccount(userId)` — chạy dưới `lockUserRow`: `deleteAllRefreshSessions`
  (mọi lane) + `DELETE oauth2_authorization WHERE principal_name=userId` +
  `bumpCredentialVersion` + `clearUserRefreshToken` (C7 mirror) + `logout_audit`
  row `(userId, lane='ALL', reason, requestId)`.
- Legacy replay path (`AuthLoginService.refresh` C2) gọi `revokeAccount` thay
  `deleteAllRefreshSessions` — OIDC lane chết cùng lúc.
- OIDC refresh reuse → SAS detection → `OAuth2RefreshTokenGrantAuthenticationProvider`
  xóa authorization → decorator hook gọi `revokeAccount` — legacy lane chết cùng lúc.

`LockingIdentityAuthorizationService extends JdbcOAuth2AuthorizationService`
(KM finding 2 — chống grant hồi sinh; hai interleaving do Wukong falsify):

- `save(authorization)`: `@Transactional` — `lockUserRow` → `portablePrincipal`
  (capture `presentedCredentialVersion` attribute từ JWT của request khi
  authorize — request-start freshness) → assert dưới lock: account tồn tại,
  `status=ACTIVE`, `!mustChangePassword`, và freshness == credentialVersion
  hiện tại. Freshness = presentedVersion nếu có, else credentialVersion claim
  của access token; thiếu cả hai → `INVALID_GRANT`. Existence check: save
  mang access token trên row đã mất LUÔN là second-stage update — real SAS
  không mint access token trước first save — nên `findById==null &&
  accessToken!=null` → "no longer exists", chặn resurrection qua mọi delete
  path KHÔNG bump version: per-client logout (`revokeClientGrants`),
  `remove()` của OIDC logout provider, `/oauth2/revoke`, admin session
  revoke (Wukong falsification round 3). Missing-row save duy nhất hợp lệ:
  first code stage (requestStart + chưa có access token). Row cũ trước
  attribute (không presentedVersion) thì mọi missing-row đều là resurrect
  → reject luôn.
  Sau assert → `mirrorGrant` (primary tx) → `super.save` (identity pool,
  autocommit — không cùng tx; đặt cuối để lỗi của nó chỉ rollback mirror,
  không để lại grant mồ côi trong đa số failure mode).
  Revoke giữ User lock tới commit nên save bị chặn tới sau delete; sau lock,
  presentedVersion (đóng băng lúc request bắt đầu) mismatch với version đã
  bump → reject → **không hồi sinh** kể cả khi token được mint sau bump
  (mint-time claim luôn đọc version mới, chỉ presentedVersion chứng minh
  request-start).
- `remove(authorization)`: dưới User lock → xóa Session mirror
  `authorizationId` → `super.remove`.
- `findByToken`/`findById`: không lock (read path), decrypt ciphertext.

### 2.4 `mustChangePassword`/status trên SAS chain (KM finding 1)

`AccountStateFilter` chỉ chạy `/api/v1/*`. SAS chain thêm
`IdentityAccountGateFilter` (sau authentication): principal authenticated →
load `findAccountAuthorization` → account missing / `status != ACTIVE`:
authorize → redirect login nội bộ; user paths khác giữ 401/403 JSON.
Code-stage save từ chối credential revision cũ (kể cả revoke sau account gate)
→ SAS endpoint-specific `login_required`, chỉ redirect về exact registered URI,
không trả error description nội bộ. Protocol validation errors giữ SAS handler.
`mustChangePassword` → 403 `PASSWORD_CHANGE_REQUIRED` trên mọi `/oauth2/*`
(không rotation allowlist — SSO authorize không là đường vòng rotate).
`/oauth2/jwks` + discovery public → filter skip. Fail-closed 503 giống C5.

### 2.5 Flag matrix (KM finding 7)

| Flag | Default | Hành vi |
| --- | --- | --- |
| `identity.oidc.enabled` | `false` | toàn bộ `/oauth2/*` + `/.well-known/*` **404** (chain không đăng ký); `UnifiedSessionAuthority` vẫn là bean — revoke server-side hoạt động bình thường; legacy lane không đổi |
| `identity.oidc.authorize-paused` | `false` | chỉ `/oauth2/authorize` → 503 JSON; token/jwks/revoke/userinfo sống — "chặn authorize mới, grant cũ revoke được" |
| `identity.dev-keygen` | `false` | sinh RSA key pair in-memory mỗi boot — chỉ dev/test |

Rollback sau expand migration: Flyway `validate-on-migrate` mặc định ON và
`ignore-migration-patterns` không set (KM finding 3) → **rollback chỉ hợp lệ
tới image còn chứa file V134+** (schema tương thích nhưng image phải mang file
migration). Rollback xa hơn = ops procedure `flyway repair` thủ công — ghi vào
runbook, không nới validate.

### 2.6 Issuer vs forward-headers (KM finding 4)

`server.forward-headers-strategy` hiện `none` cố ý (anti-IP-spoofing).
`AuthorizationServerContextFilter` của SAS so scheme/host request với issuer
→ sau TLS-terminating proxy sẽ mismatch. Quyết định:

- `ForwardedHeaderFilter` đăng ký **scoped** `FilterRegistrationBean` chỉ trên
  `/oauth2/*` + `/.well-known/*` + `/connect/*`, order -200 — trước
  `springSecurityFilterChain` (-100) nên SAS endpoint thấy scheme/host đã
  rewrite; `RequestContextFilter` -210 populate `RequestContextHolder` trước
  chain (SAS endpoint terminate in-chain, trước DispatcherServlet). Không chạm
  business chain — `ClientIpResolver` semantics giữ nguyên.
- Deploy constraint ghi runbook: id host proxy **bắt buộc** ghi đè
  `X-Forwarded-Proto`/`X-Forwarded-Host` (strip client-forged). Demo local
  (issuer `http://127.0.0.1:4010`, không proxy) khớp trực tiếp → không cần.

### 2.7 Schema expand — `V134` (pg + h2 mirror)

```sql
ALTER TABLE campuscore_auth."Session"
  ADD "lane" VARCHAR(16) NOT NULL DEFAULT 'LEGACY',
  ADD "clientId" VARCHAR(80),
  ADD "authorizationId" VARCHAR(120),
  ADD "revokedAt" TIMESTAMP,
  ADD "rotatedAt" TIMESTAMP;

CREATE SCHEMA campuscore_identity;
-- SAS 7.1.1 JdbcOAuth2AuthorizationService column list (đã dump từ jar):
-- 34 cột, *_token_value là TEXT không varchar(4000) (KM finding 14 —
-- id_token/access JWT + claims có thể vượt 4000)
CREATE TABLE campuscore_identity.oauth2_authorization (
  id varchar(255) PRIMARY KEY,
  registered_client_id varchar(255) NOT NULL,
  principal_name varchar(200) NOT NULL,
  authorization_grant_type varchar(100) NOT NULL,
  authorized_scopes varchar(1000),
  attributes TEXT, state varchar(500),
  authorization_code_value TEXT, _issued_at/_expires_at timestamp, _metadata TEXT,
  access_token_value TEXT, access_token_issued_at/expires_at timestamp,
  access_token_metadata TEXT, access_token_type varchar(100), access_token_scopes varchar(1000),
  oidc_id_token_value TEXT, oidc_id_token_issued_at/expires_at timestamp, oidc_id_token_metadata TEXT,
  refresh_token_value TEXT, refresh_token_issued_at/expires_at timestamp, refresh_token_metadata TEXT,
  user_code_value TEXT, user_code_issued_at/expires_at timestamp, user_code_metadata TEXT,
  device_code_value TEXT, device_code_issued_at/expires_at timestamp, device_code_metadata TEXT
);
CREATE TABLE campuscore_identity.oauth2_authorization_consent (
  registered_client_id varchar(255) NOT NULL,
  principal_name varchar(200) NOT NULL,
  authorities varchar(1000) NOT NULL,
  PRIMARY KEY (registered_client_id, principal_name)
);
CREATE TABLE campuscore_identity.logout_audit (
  id varchar(64) PRIMARY KEY, user_id varchar(80) NOT NULL,
  lane varchar(16) NOT NULL, reason varchar(60) NOT NULL,
  request_id varchar(128), created_at timestamp NOT NULL
);
```

`oauth2_registered_client` của SAS **không dùng** — registry là config.

### 2.8 Discovery contract (probe riêng)

`/.well-known/openid-configuration` phải trả JSON: `issuer == identity.issuer-uri`
và `authorization_endpoint|token_endpoint|jwks_uri|response_types_supported|
subject_types_supported|id_token_signing_alg_values_supported` đầy đủ —
HTTP200 trơn không đủ.

### 2.9 Commit-time revoke/save semantics (hợp đồng UX + security)

Một grant save và một revoke serialize trên cùng User row lock — bên nào
commit sau thắng deterministic. Phân biệt hai trường hợp authorize đang dở:

- **Authorize đã save code-stage TRƯỚC revoke**: revoke (per-client
  `revokeClientGrants` hay account-wide `revokeAccount`) xóa row → token-stage
  save thấy `findById` null + mang access token → **reject** — leg đang dở
  chết tại exchange (browser thấy lỗi, user đăng nhập lại). Đây là semantics
  "logout giết những gì đã tồn tại". Test: `secondStageSaveCannotResurrect
  AfterPerClientLogout`, `codeStageSaveAfterCommittedRevokeIsRejected`,
  `grantMintedAfterRevokeStillDiesOnExchange`.
- **Authorize save code-stage SAU revoke commit**: đây là một login MỚI hợp
  lệ — user thực sự re-authenticate sau logout, session mới được phép sống.
  Logout không thể veto một login diễn ra sau nó (UX contract: tab authorize
  treo sẵn từ trước logout vẫn hoàn tất được **như một phiên mới**, không
  phải hồi sinh phiên cũ).
- **Per-client vs account-wide**: `revokeClientGrants` chỉ xóa grants +
  `bff_session` của client đó — session legacy và surface khác sống tiếp
  (`perClientLogoutKeepsOtherLanesAlive`); `revokeAccount` xóa mọi lane +
  bump `credentialVersion` nên cả bearer JWT đã phát hành cũng chết ở
  request kế (`legacyRefreshReplayRevokesEveryLane`). Admin mutation
  (deactivate/role-change/delete) đi qua `revokeAccount` — bump bắt buộc
  vì access token là stateless, chỉ epoch mới giết claims cũ.

## 3. Test matrix (gate `identity`)

| Case | Test | Lane |
| --- | --- | --- |
| Protocol negatives | wrong `iss`/`aud` token → 401; reused code → invalid_grant; PKCE verifier sai → invalid_grant; state mismatch → error; **id_token chứa đúng nonce của request** (server embed, client verify — sửa chủ thể theo KM 15); callback ngoài exact list → authorize error | `EcosystemIdentityContractTest` MockMvc |
| Disabled/must-change/stale | missing/inactive account → authorize login redirect; stale credential revision → registered callback `login_required`, không 500; token reject; `mustChangePassword` → authorize 403 `PASSWORD_CHANGE_REQUIRED`; OIDC access trên `/api/v1/*` qua `AccountStateFilter` như legacy | contract test + `MobileOidcTwoFactorFlowTest` |
| Key rollover | JWKS ≥2 kid; token kid cũ verify trong overlap; active đổi → token mới kid mới | contract test |
| Replay bridge | legacy replay → Session mọi lane + `oauth2_authorization` principal đó đều mất + credentialVersion+1; OIDC refresh reuse → legacy sessions mất; **OIDC refresh in-flight ‖ revokeAccount → không hồi sinh** (KM 2 test) | `UnifiedSessionRevocationPostgresIT` |
| Race | concurrent refresh cùng session (serialize, không deadlock); logout‖refresh; password‖refresh; lock order User→Session→authz vi phạm = deadlock được phát hiện | PostgresIT pattern `AuthSessionLockOrderingPostgresIT` |
| Flags | `enabled=false` → `/oauth2/*`+discovery 404; `authorize-paused` → authorize 503, token sống | contract test |
| Token at-rest | `*_token_value` ciphertext ≠ plaintext (AES-GCM), decrypt round-trip đúng | contract test |
| Legacy oracle | C1–C9 không regression | `mvn verify` + pgit reuse |

## 4. Open items / không chứng minh

- Host routing `id.` subdomain, `__Host-cu_session`, sibling queue — **P05**.
- Native public client registration + system-browser — **P07**.
- Consent screen third-party — không có third-party client; consent off.
- `/oauth2/introspect`, device grant, client_credentials — không mở.
- Login UI silent-refresh trước khi redirect — P05 (login UI thuộc frontend).
- **Client-add checklist**: existence check §2.3 dựa trên invariant "access
  token chỉ xuất hiện sau first save" — đúng với `authorization_code` +
  `refresh_token`. Nếu tương lai đăng ký `client_credentials`,
  `token_exchange`, hoặc `device_code` (các grant mint access token trước
  first save), first save hợp lệ sẽ bị reject — **fail-closed**, phải mở
  rộng check khi thêm grant type.
- `IdentityGrantRetentionJob.purgeExpired` là delete duy nhất không giữ
  User lock — victim set disjoint (4 expiry column < grace cutoff vs live
  token) nên không phải live-grant hole; worst case re-insert dead-token
  row, provider expiry + JWT exp đã reject.
- `handleLogout` nuốt lỗi `revokeClientGrants` (best-effort): logout thành
  công nhưng grant có thể sót — ghi nhận, monitor bằng `logout_audit` +
  UNIFIED_SESSION_CLIENT_REVOKE log.

## 5. Identity/logout policy exception inventory (AUD-06)

Code inventory: `identity/IdentityPolicyInventoryTest` (test source). It scans
all identity MVC handlers regardless of feature flags, pins the executable
exception predicates, and checks the default anonymous BFF allowlist. Changes
require an explicit inventory review. These entries describe current policy;
they do not certify the stricter AUD-06 acceptance criteria.

| Exception | Current boundary / evidence |
| --- | --- |
| SAS framework CSRF disabled | Protocol clients use client authentication/PKCE. Cookie mutations still require `CsrfCookieFilter` **inside the SAS chain**; external servlet filters run too late for terminating SAS endpoints. AUD-06 repairs that placement. |
| Safe methods / Bearer / no legacy auth cookie | Legacy double-submit exempts GET, HEAD, OPTIONS, explicit `Bearer ` transport, and requests without access/refresh cookies. `/bff/` and `/session/` use the separate BFF guard. |
| SAS GET end-session | `GET /connect/logout` is deliberately supported, including cross-origin RP navigation. Exact registered redirect and validated ID-token hint remain required; POST also accepts double-submit pairs from another login and has no Origin/Referer guard. Tightening this policy needs owner approval. |
| Best-effort OIDC revoke | A revoke-store failure rolls its transaction back but currently returns successful redirect/204 with cookies unchanged. Fault test demonstrates live grants remain. **Open AUD-06 proposal:** fail closed with a stable retryable response before claiming logout success. |
| Optional OIDC `client_id` | SAS permits omission. Revocation now resolves the validated hint's stored grant to identify the client; omission must not silently skip documented per-client revocation. |
| Legacy cleanup paths | Login, two-factor verification, forgot/reset-password, refresh and logout bypass the current credential-state gate. Repeated legacy logout may return 200 with a stale access token; protected reads still reject it. Double-submit is cookie/header equality, not session binding; Referer alone is not checked. |
| Public identity MVC handlers | `/login`, `/session/login`, `/session/callback`, `/session/logged-out`, `/session/state`, `/session/logout`, `/bff/api/**` are filter-permitted. Callback state/transaction-cookie/PKCE/nonce, opaque sessions, proxy credentials and handler CSRF remain the authority. The landing page itself does not revoke anything. |
| Dead/no-cookie BFF logout | Origin-only idempotence intentionally skips the token check after session deletion/revocation. It returns 200 and expires both BFF cookies; stale business mutations return 403. Requiring stale logout itself to reject conflicts with this policy. |
| BFF-to-SAS logout bridge gap | BFF deletes the hint's grant before returning `logoutUrl`; SAS rejects that now-unresolvable hint with 400. Retry omits the hint, which SAS 7.1 also rejects with 400. The host-policy §3 claim that hint-null end-session succeeds needs owner reconciliation; BFF cookie deletion alone does not prove central end-session completion. |
| BFF Origin fallback | A live mutation without Origin requires `Sec-Fetch-Site: same-origin` plus session-bound CSRF. Reads/dead-session logout allow absent Origin. Referer is currently ignored; foreign Origin and cross-site metadata are rejected. |
| BFF anonymous reads | No-cookie GET/HEAD only: default prefixes `/api/v1/announcements/public`, `/api/v1/public/docs`, `/api/v1/article-taxonomy/v2/categories`, `/api/v1/site-appearance`. Upstream public policy still applies; an invalid present cookie cannot downgrade to anonymous. |
| BFF return/redirect inputs | Configured `/` return prefix allows local relative paths; absolute/protocol-relative/backslash/reserved paths fall back to `/`. Logout ignores `returnTo` and caller `post_logout_redirect_uri`, including duplicates, and builds the fixed registered landing URL. Runtime registry configuration is external authority, not verified by the source inventory. |
| Development compatibility | Dev/test profiles, or no active profile, permit Host fallback and non-TLS dev cookies. Outside those profiles the edge context must be authenticated; stamped hosts must be registered. No-surface legacy calls and paths outside `/api/v1/` skip the per-surface proxy credential filter. |

H2/local HTTP evidence: `EcosystemIdentityContractTest` and
`EcosystemBffContractTest` cover revoke faults/rollback/recovery, missing/wrong/
foreign-session CSRF, Origin/Referer, GET-vs-POST, redirects, malformed/duplicate
inputs and stale tabs. Tests named `KnownContractGap`/`KnownPolicyGap` are
characterizations of unresolved policy defects, **not acceptance passes**.
Generic revoke-store failures currently produce 500 on legacy/BFF routes,
preserve cookies and roll back changes; stable 503/retry guidance needs an owner
decision. PostgreSQL locking and real-provider behavior require separate proof.
