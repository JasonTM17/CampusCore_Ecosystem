# Mobile policy — P07 contract

Contract cho phase 07 (native app hoạt động thật). Authority thừa kế:
`identity-contract.md` (OIDC authority, unified Session), `host-policy.md`
(surface registry — KHÔNG có native host), `publication-policy.md` (content
reads). Tài liệu này chỉ ghi quyết định native; điều gì không nói ở đây vẫn
theo contract gốc. Companion doc: `docs/ecosystem/mobile-matrix.md`
(native-vs-web boundary, tạo cùng phase).

## 1. Toolchain & packaging

- Expo SDK 57 + RN 0.86 + React 19 hiện hữu là nền; **không kéo SDK58**
  trong phase này (R2-F01/F04). Mọi native dependency mới được cài qua
  `npx expo install <pkg>` để nhận đúng pinned version của SDK57 —
  không ghi tay version không kiểm chứng.
- Dependencies mới (chỉ những gì phase cần):
  `expo-router`, `expo-linking`, `expo-secure-store`, `expo-web-browser`,
  `expo-auth-session`, `expo-constants`, `expo-application`,
  `react-native-safe-area-context`, `react-native-screens`,
  `@react-navigation/native`,
  `@react-native-async-storage/async-storage` (chỉ cho `installMarker`
  §3 — KM-1). NetInfo chỉ thêm nếu §5 cần offline signal —
  chọn `expo-network` (managed-compatible) thay community/netinfo nếu có.
- `eas.json` tạo mới: profile `development` (dev-client, internal),
  `preview` (internal), `production` (store — chưa submit, P13). Không
  credentials/store config trong file.
- Entry point đổi `"main": "expo-router/entry"`; `index.ts` + `App.tsx`
  legacy bị xoá **trong cùng commit** với router landing (không để hai
  entry song song — drift risk). `useFonts` BeVietnamPro + StatusBar/
  SafeArea chrome chuyển nguyên vẹn sang `app/_layout.tsx`;
  BottomNavigation/MenuPanel thuộc layout của group `(app)`, không phải
  per-screen.
- app.json giữ `scheme: "campuscore"`; `ios.bundleIdentifier`/
  `android.package` đã có — không đổi. `expo-router` plugin vào
  `plugins` nếu version yêu cầu.

## 2. Navigation — expo-router adapter + route compat

- `src/app/` là route layer (file-based). `src/navigation/routes.ts`
  giữ nguyên là **compat-map authority**: mọi `ScreenName` hiện hữu map
  tới một app-route tương đương; screen-atlas test đọc registry này để
  chứng minh không route nào rơi mất trong migration.
- Adapter = một `MobileNavigation` implementation gọi `router.push/
  replace` thay vì setState — **screen components không viết lại**
  (ngoại lệ duy nhất: `SignInScreen`, §3 — form `/auth/login` chuyển
  thành nút mở system browser), chỉ đổi prop wiring.
  `MobileNavigator.tsx` cũ bị thay thế bởi `app/_layout.tsx`
  (session/role gate + font + chrome) + route groups.
- Protected groups: `(auth)` chứa sign-in; `(app)` chứa mọi màn cần
  session. Guard chạy **ở layout + ở từng route** — deep link
  `campuscore://grades` hay back-stack synthetic không bypass được
  session hoặc role check. Sai role → redirect roleHome, không render.
- `campuscore://auth/callback` **không** đi qua compat map — nó được
  `openAuthSessionAsync` tiêu thụ trong SignInScreen; route layer
  không render route nào cho path đó (route-compat test bắt buộc phải
  exclude nó). Legacy deep-link `campuscore://<screenName>` resolve qua
  compat map như **defensive-only** (không caller hiện hữu nào phát;
  giữ để deep link trong tương lai không vượt guard).
- Route map (ScreenName → path): `auth.signIn → /sign-in`,
  `dashboard.student → /(app)/dashboard`, `schedule → /(app)/schedule`,
  `courses → /(app)/courses`, `grades → /(app)/grades`,
  `attendance → /(app)/attendance`, `registration → /(app)/registration`,
  `notifications → /(app)/notifications`, `profile → /(app)/profile`,
  `thesis.topics → /(app)/thesis`, `thesis.detail →
  /(app)/thesis/[topicId]`, `thesis.registration →
  /(app)/thesis/register`, `thesis.progress → /(app)/thesis/progress`,
  `assistant.chat → /(app)/assistant`, `admin.dashboard →
  /(app)/admin/dashboard`, `admin.students → /(app)/admin/students`,
  `admin.lecturers → /(app)/admin/lecturers`, `lecturer.dashboard →
  /(app)/lecturer/dashboard`, `lecturer.schedule →
  /(app)/lecturer/schedule`, `lecturer.grading → /(app)/lecturer/grading`,
  `lecturer.attendance → /(app)/lecturer/attendance`. Compat: legacy
  deep-link `campuscore://<screenName>` resolve qua map này
  (defensive-only — không caller hiện hữu nào phát link dạng đó).
- `selectedThesisTopicId` state chuyển thành route param:
  `thesis.detail → /(app)/thesis/[topicId]` và `thesis.registration →
  /(app)/thesis/register?topicId=<id>` (KM-5 — registration screen đọc
  topic id như param tùy chọn, mất nó là gãy "screens unchanged").

## 3. Native OIDC session (C-E1 + identity-contract §2)

- **Client**: `identity.clients[]` thêm entry `cu-mobile` —
  `public-client: true`, `client-authentication-method: none`,
  PKCE S256 bắt buộc (server-side `requireProofKey(true)` đã mặc định),
  `redirect-uris`: `campuscore://auth/callback` (exact-match — Expo Go
  `exp://<lan-ip>:8081/--/…` là per-host dynamic, **không thể** đăng ký
  exact-match → Expo Go unsupported cho OIDC; interactive sign-in cần
  dev-client build — BLOCKED_CAPABILITY tới khi credentialed, KM-4),
  scopes `openid profile email offline_access`. Config qua
  `IDENTITY_CLIENTS_*` env — KHÔNG hardcode vào migration hay code.
- **Probe (KM-3) — đã chạy, kết quả + additive surface**: probe
  `MobileOidcPublicClientProbeTest` (7/7) chứng minh SAS 7.1.1 KHÔNG
  hỗ trợ `client_id`-only public client ngoài authorization_code+PKCE
  exchange: `matchesPkceTokenRequest` chỉ convert request có
  `code_verifier`, `authenticateRequired` ném `invalid_grant` cho mọi
  grant khác, và `OAuth2RefreshTokenGenerator` trả null cho `NONE`
  client tại mint. Ba additive pieces (§9, server-side):
  `NativePublicClientAuthenticationConverter` (client_id-only cho
  non-auth-code requests, registered last), `NativePublicClient
  AuthenticationProvider` (xác thực NONE cho non-auth-code requests,
  registered first, null → stock vẫn own PKCE), `NativeRefreshToken
  Generator` (mint refresh cho public client trong
  `identity.oidc.native-refresh-client-ids` = `cu-mobile`; public
  client khác giữ no-refresh mặc định). Evidence còn chứng minh:
  rotation reuse-detection (`reuseRefreshTokens(false)` → burned token
  bị reject), revoke idempotent, suspended/`mustChangePassword` chặn
  refresh qua `assertCurrentCredentials` freshness gate (mạnh hơn cả
  `IdentityAccountGateFilter` — chỉ skip client-principal).
- **Flow**: `openAuthSessionAsync(authorizeUrl)` — system browser, không
  WebView nhúng. `authorizeUrl` = `{issuer}/oauth2/authorize?
  response_type=code&client_id=cu-mobile&redirect_uri=campuscore://auth/
  callback&scope=openid+profile+email+offline_access&code_challenge=
  S256&state=<random>&nonce=<random>`. Unauthenticated → login page
  (P05) trong system browser → 2FA/status gates §2.4 chạy như web.
  Callback `campuscore://auth/callback?code&state` → verify state →
  POST `{issuer}/oauth2/token` `grant_type=authorization_code&code&
  redirect_uri&client_id&code_verifier` → `access_token` +
  `refresh_token` + `id_token` (verify `nonce` match + `aud ==
  'cu-mobile'` + `exp` chưa qua — `sub` là account-cache key nên id_token
  phải kiểm tối thiểu, KM-16).
- **Authorize-gate UX (KM-12)**: `mustChangePassword`/status-paused/
  authorize-error không có callback sạch — app thấy `error` param,
  timeout, hoặc dismiss. UX định nghĩa: state `sign-in-blocked` hiển
  thị lý do + hành động "mở portal web" (id host qua `Linking`) — không
  treo ở spinner vô hạn và không hiển thị JSON thô.
- **Storage**: access token **memory-only** (biến trong session-store,
  không bao giờ đụng disk/AsyncStorage/log). Refresh token →
  `expo-secure-store` key `cu.refresh` với
  `keychainAccessible: WHEN_UNLOCKED_THIS_DEVICE_ONLY` — device-only,
  không backup/sync. `id_token` không persist (chỉ dùng `sub`/`aud`/
  `exp`/`nonce` kiểm tra trong memory rồi bỏ).
- **Install marker (KM-1)**: hai lớp, không thể dùng SecureStore một
  mình — iOS Keychain sống sót uninstall cho **cả hai** key nên
  "`cu.install` vắng nhưng `cu.refresh` còn" là vị từ không bao giờ
  cháy. Thiết kế đúng:
  - `cu.install` (SecureStore, sống sót uninstall trên iOS): ghi
    `{appInstanceId, createdAt}` lần đầu.
  - `installMarker` (AsyncStorage/app sandbox — bị wipe theo uninstall):
    ghi cùng `appInstanceId`.
  - Cold-start rule: marker sandbox vắng HOẶC khác `cu.install.
    appInstanceId` → reinstall/post-upgrade → **wipe `cu.refresh`**,
    sinh `appInstanceId` mới, ghi lại cả hai — trước mọi request.
    Cả hai khớp → upgrade bình thường, giữ session. Android: uninstall
    wipe cả hai → fresh install.
- **Session-store boundary (KM-7)**: `src/auth/session-store.ts` sở
  hữu **toàn bộ** SecureStore I/O + refresh call; refresh token
  **không bao giờ** vào memory của `apiClient` (hiện `refreshToken`
  biến + `campusApi.refresh/logout` + `setSessionTokens` đọc nó —
  phải gỡ). API rõ ràng: `sessionStore.loadBootstrap()`,
  `saveRefresh(t)`, `clearRefresh()`, `refreshAccessToken()` —
  injectable impl (SecureStore prod / in-memory test mirror cùng
  interface). `apiClient` giữ access-token getter + shared
  `sessionRefreshPromise`/`sessionEpoch`; `refreshMobileSession` gọi
  `sessionStore.refreshAccessToken()` thay `/auth/refresh` — **không
  còn** `/auth/login|refresh|logout|me` wrappers, `apiRoutes.auth`,
  `LoginResponse` trong `campusApi` (gỡ trong phase).
- **Refresh semantics**: token endpoint `{issuer}/oauth2/token`
  `grant_type=refresh_token&client_id=cu-mobile&refresh_token=
  <opaque>` (client_id-only — KM-3 probe). Sau mỗi rotation thứ tự
  apply = **epoch-check → persist SecureStore → cập nhật memory →
  resolve** (epoch check gate cả SecureStore *write*, không chỉ
  resolve — refresh in-flight lúc logout không được ghi token mới lên
  đĩa, KM-6). `sessionEpoch` bump trên sign-in/sign-out.
- **Logout ordering (KM-6)**: `epoch++` **trước** → wipe `cu.refresh`
  → clear memory access → clear per-account query cache → rồi mới
  `POST {issuer}/oauth2/revoke` `token=<refresh>&client_id=cu-mobile`
  (idempotent, best-effort — revoke fail vẫn sign-out local). Late
  refresh in-flight: epoch-check tại persist-step = no-op.
- **401/403**: 401 → shared-refresh + retry-một-lần (giữ nguyên exclude
  list + `/oauth2/*`); refresh fail → sign-out + màn sign-in. 403 →
  denied state, không retry.
- **Account identity**: account id = `id_token.sub` (=`principal_name`/
  `User.id` invariant) — key của per-account cache §5. Roles đọc từ
  access-token claims `roles` (decode JWT payload, không verify —
  authorization vẫn server-side; claim chỉ để chọn surface).
- **Role mapping (KM-8)**: claims `roles` là backend names; precedence
  chọn native lane theo thứ tự **[LECTURER → STUDENT]** —
  `ADMIN`/`SUPER_ADMIN` **không** có native lane: account chỉ mang
  admin roles → signed-in nhưng render web-only state (§4); account
  `ADMIN+LECTURER` → lecturer lane; không mapped role nào →
  signed-out "account không có native surface". `lecturerRoles`
  trong `routes.ts` hiện chứa `admin` — đã được quyết: admin không
  vào lane đó nữa (mobile-matrix ghi rõ).
- **Issuer config (KM-2)**: `EXPO_PUBLIC_ISSUER_URL` là **bắt buộc
  khi issuer host ≠ API host** — không bao giờ derive. Mọi call
  `/oauth2/*` đi tới **issuer host** (SAS `AuthorizationServerContext
  Filter` validate scheme+host khớp `identity.issuer-uri` — sai host =
  404 toàn bộ). Dev: `identity.issuer-uri` phải set = địa chỉ thiết bị
  thật gọi (`http://10.0.2.2:4010` cho emulator, LAN IP cho thiết bị
  vật lý) — `127.0.0.1` chỉ đúng cho web trên cùng máy. Prod:
  `id.campusute.io.vn` khác host API → env bắt buộc.
- **Boot sequence (KM-17)**: `app/_layout.tsx` bootstrap theo thứ tự:
  font load → marker-check (KM-1, có thể wipe refresh) →
  `sessionStore.loadBootstrap()` → nếu refresh còn → silent
  `refreshAccessToken()` một lần (fail → signedOut, không crash) →
  set session-state → render router guard. Guard không evaluate tới
  khi bootstrap xong (splash giữ chỗ).

## 4. Roles & surface boundary (mobile-matrix.md)

- `student`: dashboard, schedule (timetable), courses, grades/transcript
  read, attendance summary, registration (enroll/withdraw), notifications,
  thesis (topics/group/progress/report upload nếu API cho phép),
  assistant, profile, announcements feed (`/announcements/my`).
- `lecturer`: dashboard, lịch dạy, **điểm danh** và **nhập điểm** trên API
  thật (`src/screens/operations`), không còn dữ liệu tĩnh. Điểm danh: chọn
  lớp + ngày, đánh dấu từng sinh viên (chưa đánh dấu giữ nguyên là chưa
  đánh dấu), lưu bằng PUT toàn trạng thái; trước khi lưu app đọc lại
  server và dừng nếu danh sách lớp hoặc dấu điểm danh đã đổi. Nhập điểm:
  chỉ gửi các dòng đã sửa, công bố điểm qua hộp xác nhận, xuất CSV
  (BOM + CRLF, khớp byte với web) qua share sheet. Hand-off
  `web-same-path` cho thư (`/dashboard/lecturer/mail`), nhập điểm hàng
  loạt và in bảng điểm (`/dashboard/lecturer/grades`).
- `admin`/`super_admin`: route registry (`admin.dashboard`, `admin.students`,
  `admin.lecturers`) luôn là màn hand-off trung thực tới portal
  (`/admin`, `/admin/users`, `/admin/lecturers`), không có dữ liệu giả.
  Việc admin còn lại nằm ở các **lane** bên dưới, mặc định tắt.
- **Lane có cờ (P13)** — màn thật trong `src/screens/lanes`, đăng ký ở
  `laneComponents` (tách khỏi `screenComponents`), mỗi lane có file route
  `app/(app)/...` đúng đường dẫn `lanePathById` và chỉ là host
  `<LaneRoute id="…" />`. Một lane mở khi **đồng thời**: cờ build
  `EXPO_PUBLIC_LANE_DEAN|STAFF|ADMIN` bằng đúng chuỗi `true` (mặc định
  tắt), capability từ claim/grant, và session `authenticated`. Kiểm hai
  lần: `resolveGuard` khi vào route và `laneAllowed` lúc render trong
  `LaneRoute`; thiếu một điều kiện thì redirect về trang chính của role
  (`reason: 'lane-unavailable'`) hoặc màn "không có quyền", không bao giờ
  mount nội dung lane. Preview và signed-out không bao giờ có lane. Dữ
  liệu lane không cache (không SWR/offline): mất grant thì danh sách biến
  mất, audit không nằm trong cache đĩa; 401/403 hiện trạng thái từ chối.
  Mọi ghi đều qua hộp xác nhận, chỉ một yêu cầu tại một thời điểm, kèm
  `expectedVersion` của dòng đã xem (409/412 → tải lại danh sách).

  | Lane | Cờ + capability | Việc trên app | Hand-off web (`web-same-path`) |
  | --- | --- | --- | --- |
  | `dean.overview` | `DEAN` + `dean.overview`; chỉ claim `TRUONG_KHOA` (không phải `TRUONG_BO_MON`) | Tổng quan khóa luận toàn khoa theo đợt: số liệu, theo bộ môn, giảng viên hướng dẫn, nhóm (đọc) | `/dashboard/dean` |
  | `staff.applyReview` | `STAFF` + `staff.applyReview` (grant theo bàn) | Hàng đợi hồ sơ tuyển sinh: nhận duyệt, trả hồ sơ (ghi chú bắt buộc), trúng tuyển/từ chối | `/apply/review` (tệp đính kèm, quyền) |
  | `staff.careersDesk` | `STAFF` + `staff.careersDesk` | Đơn ứng tuyển: chuyển bước, từ chối (lý do bắt buộc) | `/careers/desk` |
  | `staff.libraryDesk` | `STAFF` + `staff.libraryDesk` | Yêu cầu mượn: duyệt, phát, nhận trả, hủy (lý do bắt buộc) | `/library/desk` |
  | `admin.overview` | `ADMIN` + `admin.oversight`; role admin | Số liệu và biểu đồ giám sát (có bản tóm tắt chữ), lối tắt tới các lane admin | `/admin` |
  | `admin.attendance` | như trên | Điểm danh toàn trường: lọc lớp/sinh viên/ngày, phân trang server (đọc) | `/admin/attendance` |
  | `admin.enrollments` | như trên | Đăng ký học phần: lọc, phân trang server (đọc) | `/admin/enrollments` (xuất hàng loạt) |
  | `admin.audit` | như trên | Nhật ký kiểm toán tối thiểu (hành động, đối tượng, người thực hiện rút gọn, thời gian), lọc, phân trang, không cache | `/admin/audit` |
  | `admin.creditLimits` | như trên | Đơn nâng hạn mức: duyệt/từ chối (từ chối cần ghi chú) | `/admin/credit-limit-applications` |
  | `admin.events` | như trên | Sự kiện: đăng, đóng đăng ký, hoàn tất, hủy; điểm danh thủ công khi đã đóng đăng ký/hoàn tất | `/admin/events` (tạo, mở đăng ký cần ngày) |
  | `admin.notifications` | như trên | Soạn, xem trước, xác nhận và gửi thông báo cho một người nhận; lịch sử. Server không có idempotency nên không tự thử lại: lỗi mạng hiện "chưa rõ đã gửi", kiểm tra lịch sử trước khi gửi lại | `/admin/notifications` (gửi hàng loạt, đặt lịch) |

  Quyền thật luôn do server quyết định: lane bàn việc và sự kiện cần grant
  phía server (và quyền sở hữu với sự kiện), nên admin chưa có grant sẽ
  thấy trạng thái từ chối thay vì dữ liệu.
- **Preview pseudo-session (KM-9)**: `preview` là session-state trong
  memory, **không bao giờ** đụng SecureStore/refresh/token; `switchRole`
  chỉ tồn tại trong preview và chỉ đổi role-claim pseudo (guard coi
  preview như "(app) access với role ảo"). Preview không đi qua OIDC
  và không được coi là authenticated evidence — giữ nguyên semantics
  hiện hữu.
- mọi entry trong matrix ghi `native | web-only | planned` — đồng bộ
  `hub-modules.ts` khi module phía sau lên (P08+).

## 5. Academic surfaces & query lifecycle

- Data access giữ `campusApi`/`apiClient` — bearer header đã đúng;
  chỉ đổi token source (§3). Không viết lại endpoint wrappers nếu
  contract không đổi.
- **Query lifecycle**: mỗi data screen chạy qua một `useQuery`-like
  hook nội bộ (`src/hooks/useScreenQuery.ts`): fetch khi mount, refetch
  khi screen focus lại (`AppState` active + navigation focus), stale-
  while-revalidate trong session, retry bounded (1 lần sau refresh).
  Không đưa react-query vào — dependency trọng cho SDK57 chưa cần.
- **Per-account memory cache**: Map trong memory, key =
  `${accountId}:${queryKey}`; đổi account = đổi keyspace tự nhiên
  (account cũ không lộ). Wipe toàn cache trên sign-out.
- **Không persist academic data**: điểm/transcript/file thesis/attendance
  KHÔNG bao giờ ghi disk (không AsyncStorage ngoài marker, không
  cache-dir write). Whitelist đóng — chỉ 3 thứ lên đĩa: SecureStore
  `cu.refresh` + `cu.install`, AsyncStorage `installMarker` (KM-1).
- **Offline/UX states**: mọi data screen phân biệt rõ `loading` /
  `empty` / `error` (retry) / `denied` (403) / `offline-stale` (dữ
  liệu memory cũ + banner "offline — dữ liệu có thể cũ"). Connectivity
  signal qua `expo-network` (managed-compatible, cài qua `expo
  install`), fallback: fetch-failure classification (network error ≠
  API error — `TypeError`/timeout → offline, HTTP status → API error).
- **Lecturer attendance/feedback**: nối API thật theo endpoints hiện có
  (`/lecturer/*` hoặc attendance write surface đã có trong backend —
  khảo sát trước khi implement; nếu backend thiếu write lane cho
  attendance → scope rõ trong matrix thay vì giả lập). Static/fake
  rows bị loại bỏ — "hoạt động thật" là exit criterion.
- **Thesis report upload (KM-15)**: nếu backend có upload lane → dùng
  (+ `expo-document-picker` dependency có điều kiện); nếu chỉ có
  status/read → render status trung thực + web-only marker.
- **Preview mode**: giữ nguyên — explicit `EXPO_PUBLIC_API_MODE=preview`,
  không token, không claim authenticated; session-state `preview` tách
  biệt `authenticated` như hiện hữu.

## 6. Observability

- `recordApiMetric` giữ nguyên; thêm `surface: 'native'` + `clientId`
  tag trên metric envelope. Không log token/refresh/code_verifier ở
  bất kỳ đâu (kể cả debug builds).

## 7. Security invariants (test phải chứng minh)

1. Refresh token chỉ tồn tại trong SecureStore (mọi read/write qua
   `session-store.ts` — grep-test cấm AsyncStorage/FileSystem cho
   token material và academic data; `installMarker` là ngoại lệ duy
   nhất và chỉ được đọc/ghi bên trong `session-store.ts`).
2. Access token không persist: cold restart không có token phải vào
   sign-in hoặc silent-refresh từ SecureStore refresh — không có access
   nào sống sót.
3. Reinstall-wipe (KM-1): sandbox `installMarker` vắng hoặc mismatch
   `cu.install.appInstanceId` → wipe `cu.refresh` trước request đầu
   tiên; match → giữ.
4. Logout (KM-6): ordering `epoch++ → wipe cu.refresh → clear memory →
   revoke` — refresh promise in-flight lúc logout **không được** persist
   token mới (epoch check gate cả write), resolve = no-op.
5. Role gate: deep-link tới route role khác → redirect roleHome,
   screen không render — pure-function guard unit test trên compat-map
   (`resolveGuard(session, role, path)` trả decision — test gọi trực
   tiếp, KM-13a), không chỉ source-scan.
6. PKCE: verifier ≥ 43 ký tự base64url, challenge = S256(verifier) ≠
   verifier, state/nonce ≥ 16 bytes random, mỗi attempt mới (không
   reuse); callback verify state trước exchange; id_token verify
   `nonce` + `aud == 'cu-mobile'` + `exp` (KM-16).
7. Bearer không lộ (KM-13d): Authorization header chỉ gắn trên
   `EXPO_PUBLIC_API_URL` origin — token request tới issuer host không
   đính Bearer, code_verifier không bao giờ đi header. Unit test assert
   header-matrix per origin.
8. Chỉ 3 key/file được lên đĩa: `cu.refresh`, `cu.install`
   (SecureStore), `installMarker` (AsyncStorage) — mọi key khác
   (academic data) bị cấm (grep-test).

## 8. Gate `mobile-core`

Runner local, evidence `artifacts/verification/mobile-core`. Cases:

- `mobile-oidc-probe` (KM-3, backend lane): contract test trong
  `EcosystemIdentityContractTest` family chứng minh `cu-mobile`
  public-client `client_id`-only được chấp nhận trên `grant_type=
  refresh_token` và `/oauth2/revoke`, và authorize-code+PKCE full
  exchange — trước khi implementation commit thiết kế logout.
- `mobile-unit`: `npm test` — `package.json` test script phải enumerate
  **tất cả** file mới (KM-13c): existing atlas/repair/student-json +
  `tests/session-storage.test.mjs` + `tests/oidc-flow.test.mjs` +
  `tests/route-compat.test.mjs`.
- `mobile-typecheck`: `npm run typecheck`.
- `mobile-auth`: focused session tests — PKCE shape, session-store
  contract (in-memory impl mirror SecureStore API), refresh-epoch
  (persist-gated, late apply no-op), logout ordering + no-resurrect,
  reinstall-wipe hai-lớp, compat-map coverage (21/21 ScreenName →
  route, `auth/callback` excluded), role-guard pure-function,
  bearer-origin matrix.
- `mobile-smoke` (non-required): Android/iOS dev-build launch smoke —
  cần EAS account + device credentials → `BLOCKED_CAPABILITY` khi
  thiếu, ghi rõ trong report. **Tất cả** runtime-dependent exits
  (cold-restart, reinstall marker, system-browser PKCE journey) degrade
  thành BLOCKED_CAPABILITY cho tới khi credentialed — gate vẫn đánh
  giá static+unit evidence, nhưng report phải ghi explicit
  BLOCKED/NOT_RUN từng item (KM-13b, verdict note).
- Recovery trong gate: `eas.json` parse check, `app.json` scheme check,
  `package.json` main = `expo-router/entry`.

## 9. Recovery

- App build ổn định trước mọi thứ: nếu router migration gãy runtime
  thì revert `main` về `index.ts` + giữ screens (screens không đổi,
  chỉ lớp route).
- Server-side chỉ additive: `identity.clients[]` entry mới, không đụng
  client/surface cũ; rollback = bỏ env entries.
- SecureStore schema đổi (key name/format) → bump `cu.install` version
  field → wipe-toàn-bộ trên mismatch (không migrate từng key).
- Không OTA (`expo-updates` không nằm trong scope phase); native change
  = build mới.

## 10. Explicit non-goals (phase này)

- Không store publication, không EAS submit, không push notification
  registration (notifications = in-app list đọc API), không OTA.
- Không biometric/PIN unlock, không multi-account switcher.
- Lane có cờ (§4) không bật mặc định; app không thay trang quản trị web:
  tạo/sửa danh mục, gửi thông báo hàng loạt, xuất enrollments hàng loạt,
  nhập điểm hàng loạt, in bảng điểm, tệp đính kèm hồ sơ và quản lý grant
  bàn việc vẫn là hand-off `web-same-path`.
- Điểm danh và điểm của giảng viên không có khóa idempotency/version phía
  server; app chỉ giảm rủi ro (đọc lại trước khi lưu, chỉ gửi dòng đã
  sửa, xác nhận khi công bố), không tuyên bố ghi độc quyền.
