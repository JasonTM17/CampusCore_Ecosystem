# CampusCore Mobile

Expo + React Native + TypeScript mobile client for the Java REST API course
project.

## Design contract

The UI follows the canonical `Academic Continuity` evidence in
`frontend/.stitch/DESIGN.md`. The seven ecosystem domain lanes (news, docs,
events, learning, admissions, library, careers) resolve to generated screens
in the live Stitch project `8459672847959457355` via `stitchMobileReferences`
in `src/navigation/routes.ts`; the atlas regression pins that traceability:

- Be Vietnam Pro is bundled with Expo and loaded before the navigator renders;
  the platform system font remains the runtime fallback for native text that
  cannot use the bundled family.
- The canvas is `#F9F9FF`, cards are white, and primary actions use `#003F87`
  with `#0056B3` for filled emphasis.
- Spacing uses a 4px baseline, with a 16px mobile gutter and 8px card radius.
- Interactive controls use a minimum 44px touch target.
- Text scaling check: `adb shell settings put system font_scale 2.0`, then restore `adb shell settings put system font_scale 1.0`.
- High-frequency mobile navigation is a role-specific bottom bar; the menu
  panel exposes only routes that the active preview role may access. Navigator
  policy also rejects a direct transition to an unauthorized route.

## Run

```powershell
npm ci
npx expo start
```

The dependency-free screen-atlas regression can run now:

```powershell
npm test --prefix mobile
```

The `npm test` script runs the discovery runner
(`node scripts/run-node-tests.mjs`), which selects every top-level
`tests/*.test.mjs` — including the screen-atlas registry — and is pinned by
`--required` guards. `scripts/check-mobile-parity.mjs` verifies 59 registered
native screens and the shared Stitch token anchors. Run
`npm run typecheck --prefix mobile` from the repository root for the complete
TypeScript gate.

The default mode is `live`: API calls target the Java REST API at
`EXPO_PUBLIC_API_URL`. Preview mode remains an explicit local-only option for
design inspection and is never treated as authenticated evidence.

This repository is local-first. Production API, portal, and identity issuer
values are not configured here; the ecosystem hosts will be assigned later.

| Variable | Behavior |
| --- | --- |
| `EXPO_PUBLIC_API_MODE` | `live` calls the configured API; `preview` uses bundled sample data without network calls. |
| `EXPO_PUBLIC_API_URL` | Android emulator local API is `http://10.0.2.2:4010/api/v1`. Non-development builds require HTTPS unless the local cleartext flag and a loopback/emulator host are used. |
| `EXPO_PUBLIC_ALLOW_CLEARTEXT_LOCAL` | `1` only in the `local` EAS profile; permits HTTP only for `localhost`, `127.0.0.1`, `10.0.2.2`, or `::1`. Android cleartext traffic is enabled only for that profile. |
| `EXPO_PUBLIC_PORTAL_URL` | Optional. Development defaults to `https://portal.localhost:3102`; if unset in a non-development build, web hand-off actions are unavailable. |

The app uses one base URL for all requests and does not embed credentials. The
local preview entry point is deliberately labeled as a preview; it does not
represent a successful Java authentication. When live mode is selected, sign
in runs an OIDC authorization-code + PKCE flow against the identity issuer
(`EXPO_PUBLIC_ISSUER_URL` when a local issuer differs from the API host) inside
the system browser for the `cu-mobile`
public client — the app never sees a password. The access token lives in
session-store memory only;
the refresh token persists solely in `expo-secure-store` (`cu.refresh`,
`WHEN_UNLOCKED_THIS_DEVICE_ONLY`), and a two-layer install marker
(`cu.install` + an AsyncStorage `installMarker` twin) wipes stale refresh
material after reinstall. A live request that receives `401` attempts one issuer-side refresh rotation and
retries once only after a complete replacement pair is stored, excluding
login/refresh/logout paths to avoid auth loops. The old refresh credential is
deleted before dispatch. A definitive 400 or 401 rejection, or any ambiguous
dispatched result such as timeout, response loss, body-read failure, malformed
success, failure to save the replacement, 429, or 5xx, returns to sign-in
without restoring the old credential. Storage or
configuration failures before dispatch remain locally retryable. Refresh has a
20-second deadline; the OIDC code exchange keeps its separate 10-second limit.
The session keeps
`signedOut`, `preview`, and `authenticated` as distinct states; role
switching is available only inside the explicit preview state and is never
an authorization substitute.

For live API access, Android Emulator uses `http://10.0.2.2:4010/api/v1`.
iOS Simulator and Expo web can use `http://127.0.0.1:4010/api/v1`. A physical
device must set `EXPO_PUBLIC_API_URL` to the development machine's LAN address,
and the host firewall must allow that development port.

## Local sign-in against the Docker stack (verified)

The default `docker-compose.yml` leaves the OIDC lane off — `/oauth2/authorize`
does not exist and sign-in cannot complete. The opt-in overlay
`docker-compose.mobile-local.yml` turns it on with the issuer the emulator
uses (`MOBILE_LOCAL_ISSUER`, default `http://10.0.2.2:4010`):

```powershell
# Once per clone: the base compose file requires the owner-assertion key.
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
$s = (openssl rand -base64 48); Add-Content .env "ASSISTANT_RAG_OWNER_ASSERTION_SECRET=$s"
docker compose -f docker-compose.yml -f docker-compose.mobile-local.yml up -d --build
node scripts/mobile-local-oidc-verify.mjs   # end-to-end smoke, no browser
```

A physical device needs `MOBILE_LOCAL_ISSUER=http://<LAN-IP>:4010` on the same
command line, matching `EXPO_PUBLIC_API_URL`/`EXPO_PUBLIC_ISSUER_URL`.

Verified release-type build (replicates the `local` EAS profile; `mobile/android`
is the generated prebuild directory — reuse it, never commit it):

```powershell
cd mobile/android
$env:JAVA_TOOL_OPTIONS='--enable-native-access=ALL-UNNAMED'
$env:CAMPUSUTE_MOBILE_PROFILE='local'
$env:EXPO_PUBLIC_API_MODE='live'
$env:EXPO_PUBLIC_API_URL='http://10.0.2.2:4010/api/v1'
$env:EXPO_PUBLIC_ISSUER_URL='http://10.0.2.2:4010'
$env:EXPO_PUBLIC_ALLOW_CLEARTEXT_LOCAL='1'
./gradlew assembleRelease     # APK: app/build/outputs/apk/release/app-release.apk
adb install app/build/outputs/apk/release/app-release.apk
```

`EXPO_PUBLIC_ISSUER_URL` is required in non-dev builds (the build fails closed
without it). The `CAMPUSUTE_MOBILE_PROFILE=local` +
`EXPO_PUBLIC_ALLOW_CLEARTEXT_LOCAL=1` pair is what enables cleartext HTTP; the
generated `AndroidManifest.xml` needs `android:usesCleartextTraffic="true"` on
`<application>` when the android/ tree predates that plugin. The `npx expo
start --android` dev-client path is equivalent in dev mode (dev falls back to
the default issuer when unset) but is not part of this verification.

Sign in with `student@campuscore.edu` and the public demo password documented
in `docs/DEMO_RUNBOOK.md`. Expected: guest Home → Đăng nhập bằng CampusUTE ID →
system browser opens the local login page at `10.0.2.2:4010` → the app returns
to the student dashboard populated from the local DB.

Troubleshooting:

- `bind: address already in use` on 5432/1025/8025 → set
  `POSTGRES_HOST_PORT`/`MAILPIT_SMTP_HOST_PORT`/`MAILPIT_UI_HOST_PORT`
  (e.g. 55432/11025/18025).
- Sign-in button does nothing / 404 on authorize → the overlay is missing from
  the compose command.
- `INSTALL_FAILED_UPDATE_INCOMPATIBLE` → uninstall the older build first
  (`adb uninstall io.campuscore.mobile`), signatures differ.
- First dashboard load may show a transient "sign in again" retry chip on one
  widget right after the token exchange — the rest of the screen is populated;
  a reload recovers it.

## API seam

`src/api/client.ts` targets the Java REST API at `/api/v1`. It exposes generic
GET/POST/PATCH/PUT/DELETE helpers plus named probes for auth, identity, health,
notifications, thesis topics, and the CampusCore assistant route. The assistant seam sends
`{ message, locale, conversationId? }` to the buffered JSON contract and expects
`{ answer, model, degraded, reasonCode, locale, citations, conversationId?, messageId? }`.
Owner-scoped conversation list, message history, and delete helpers are available
for live sessions. Native talks to the assistant through an `AssistantTransport` seam: the
buffered JSON contract is the default, and the SSE transport stays behind
`STREAMING_PARITY_VERIFIED` until the dev-build canary passes on both platforms. The assistant screen renders provenance,
quota/error/retry states, and localised Vietnamese/English copy in live
mode, and only uses local responses in the explicit preview state. Retained role
routes must show an explicit not-available state when their Java contract is not
yet present.

## Screen atlas

The registry contains 59 verified native screens (`nativeChecked: 59` in
`scripts/check-mobile-parity.mjs`):

- Auth: sign in, forgot password, reset password, signed out.
- Applicant: capability-routed sessions (`admissions:self` / `applicant.surface`)
  land directly on `/apply` and are fenced strictly to the admissions surface.
- Student: dashboard, schedule, courses, grades, transcript, curriculum, enrollments, attendance, registration,
  events, learning (materials & assignments), admissions (simulated), library (simulated),
  careers (simulated), news, docs, notifications, academic announcements, conduct score,
  certificates, profile.
- Thesis: topics, topic detail, registration, progress.
- Assistant: CampusCore campus helpdesk chatbot.
- Staff: admin dashboard, students, lecturers; lecturer dashboard,
  schedule, grading, attendance.

This is a scaffold, not a claim of live Expo, device, API, or visual validation.

## Mobile excellence v2

Token một nguồn (`contracts/ecosystem/tokens.json`) sinh adapter cho web và mobile (`node scripts/sync-tokens.mjs --check`). Màn hình dùng `useTheme`/`useThemedStyles` (sáng/tối theo hệ thống) và `useWindowClass` (compact < 600 dp, medium 600-839, expanded >= 840). Chi tiết, dependency đã đóng băng và khóa i18n: `docs/ecosystem/mobile-excellence.md`. Test: `npm test` (node), `npm run test:component` (RNTL), `npm run typecheck`. Trợ lý dùng transport buffered cho tới khi canary SSE trên dev build qua; push mặc định tắt (`src/config/features.ts`).

## EAS profiles

`mobile/eas.json` is local-first: no profile carries a `*.campusute.io.vn` host,
and `production` leaves the deployment URLs unset so a real future deployment
supplies them deliberately. `scripts/eas-profile-check.mjs` enforces this policy
and `scripts/eas-profile-check.test.mjs` runs it in the root CI suite.

| Profile | Purpose | Expected `EXPO_PUBLIC_*` source | Works today? (local stack) |
| --- | --- | --- | --- |
| `development` | Dev client served by Metro (`developmentClient: true`, internal APK) | `mobile/.env` or the shell that starts `expo start`; nothing committed | Yes: dev mode falls back to `http://10.0.2.2:4010` on Android and `http://127.0.0.1:4010` elsewhere until a value is supplied |
| `preview` | Internal release-type APK for smoke checks | Build environment only (`eas env` or the shell); nothing committed | No: with no API URL the live client fails closed, and a non-dev build has no issuer fallback |
| `local` | Release-type APK wired to the Docker stack (`docker-compose.mobile-local.yml`) | Checked-in Android-emulator values: API `http://10.0.2.2:4010/api/v1`, issuer `http://10.0.2.2:4010`, cleartext opt-in `1` | Yes on the Android emulator; a physical device needs its own LAN values, which this profile does not provide |
| `production` | Future deployment (deferred; the real production web app lives in another repository) | Deliberately unset; a real deployment supplies API, portal, and issuer | No by design: the app fails closed until those values are configured |

`EXPO_PUBLIC_PORTAL_URL` stays unset in `local` because
`https://portal.localhost:3102` is a host-side web address the Android emulator
cannot resolve; web hand-off is therefore unavailable in a release-type local
build. That portal default applies to development builds only.
