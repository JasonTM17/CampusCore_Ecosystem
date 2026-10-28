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

It verifies 28 registered screens and the shared Stitch token anchors. Run
`npm run typecheck --prefix mobile` from the repository root for the complete
TypeScript gate.

The default mode is `live`: API calls target the Java REST API at
`EXPO_PUBLIC_API_URL`. Preview mode remains an explicit local-only option for
design inspection and is never treated as authenticated evidence.
The app uses one base URL for all requests and does not embed credentials. The
local preview entry point is deliberately labeled as a preview; it does not
represent a successful Java authentication. When live mode is selected, sign
in runs an OIDC authorization-code + PKCE flow against the identity issuer
(`EXPO_PUBLIC_ISSUER_URL`, mandatory when the issuer host differs from the API
host) inside the system browser for the `cu-mobile` public client — the app
never sees a password. The access token lives in session-store memory only;
the refresh token persists solely in `expo-secure-store` (`cu.refresh`,
`WHEN_UNLOCKED_THIS_DEVICE_ONLY`), and a two-layer install marker
(`cu.install` + an AsyncStorage `installMarker` twin) wipes stale refresh
material after reinstall. A live request that receives `401` attempts one
issuer-side refresh rotation and retries once, excluding
login/refresh/logout paths to avoid auth loops. The session keeps
`signedOut`, `preview`, and `authenticated` as distinct states; role
switching is available only inside the explicit preview state and is never
an authorization substitute.

For live API access, Android Emulator uses `http://10.0.2.2:4010/api/v1`.
iOS Simulator and Expo web can use `http://127.0.0.1:4010/api/v1`. A physical
device must set `EXPO_PUBLIC_API_URL` to the development machine's LAN address,
and the host firewall must allow that development port.

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

The registry contains 37 navigable screens:

- Auth: sign in, forgot password, reset password, signed out.
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
