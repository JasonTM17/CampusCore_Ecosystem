# Device runbook — CampusUTE native acceptance (P13)

Gate `devices` combines two per-OS evidence sets (Android + iOS). It does
**not** self-PASS from build logs: each OS needs a complete scenario run
recorded with the exact OS/build/runtime/hash fields from
`device-evidence-template.md`. Missing one OS leaves the demo `BLOCKED`.

## 0. Prerequisites (external capabilities — not committed)

| Item | Source | Status |
| --- | --- | --- |
| EAS account + project id | Expo dashboard; `eas init` on the operator machine | BLOCKED_CAPABILITY |
| Android signing fingerprint (SHA-256) | Play console / EAS credentials — injected into `frontend/public/.well-known/assetlinks.json` at release, never committed | BLOCKED_CAPABILITY |
| Apple TeamID | Apple Developer account — replaces `SYNTH00000` in `apple-app-site-association` at release | BLOCKED_CAPABILITY |
| Physical Android device (API 30+) or emulator | Operator hardware | BLOCKED_CAPABILITY |
| Physical iOS device + provisioning | Mac/EAS — iOS acceptance must run on a signed physical device per phase | BLOCKED_CAPABILITY |

The committed `.well-known` files carry **synthetic placeholders** so the
association-document shape, host scope and path policy are reviewable.
The all-zero fingerprint and `SYNTH00000` TeamID must be replaced by the
real values at signing time — a signed build that still carries the
placeholders is a gate FAIL, not a cosmetic fix.

## 1. Exact commands

```bash
cd mobile
eas build --profile preview --platform android      # internal APK
eas build --profile preview --platform ios          # internal device build (Mac/EAS)
eas build --profile production --platform android   # AAB for store lane
eas build --profile production --platform ios
```

Record `eas build:inspect --id <buildId>` output (fingerprint,
runtime version, git SHA) into the evidence file per build.

Deep-link/association verification (Android):

```bash
adb shell am start -a android.intent.action.VIEW \
  -d "https://www.campusute.io.vn/news" io.campuscore.mobile
adb shell pm get-app-links io.campuscore.mobile   # autoVerify state
```

iOS: install the signed build, then open `https://www.campusute.io.vn/news`
from Safari/Notes — the app must claim the link without a browser loop.
The universal-link allowlist intentionally excludes `/session/*` and
`/api/*`: an auth callback must never route into the app (loop guard,
route-map.ts KM-10), and login-resume deep links carry no open redirect.

## 2. Scenario matrix (per OS — every row required)

| # | Scenario | Expected | Evidence field |
| --- | --- | --- | --- |
| 1 | Fresh install → first launch → OIDC sign-in (system browser, PKCE) | session lands, no token in logs | install/login |
| 2 | Force-close → cold restart | session survives (secure-store refresh), no re-login | restart |
| 3 | Update over prior version | state + session preserved | update |
| 4 | Sign-out → sign back in | wipe ordering, no resurrected session | logout/replay |
| 5 | Old refresh token replay after sign-out | denied, forced re-auth | replay |
| 6 | Browser SSO: `https://www.campusute.io.vn/news` link → app | opens news screen, not browser | deep-link |
| 7 | `campuscore://auth/callback` stray link | guard → sign-in, no loop | loop-guard |
| 8 | File picker (learning attachment lane) | picks + uploads; denied-permission path polite | picker |
| 9 | Slow API (throttled) | loading/error states, retry works | slow-api |
| 10 | Cold start with API down | error state, no crash, retry after recovery | cold-api |
| 11 | Denied-role account signs in | blocked UX + portal handoff, no crash | denied-role |
| 12 | Reinstall → sign in | clean state, session re-established | reinstall |

## 3. Per-OS evidence file

Copy `docs/ecosystem/device-evidence-template.md` to
`artifacts/verification/devices/android-<build>.md` and
`artifacts/verification/devices/ios-<build>.md`; every row records
PASS/FAIL/BLOCKED with a note. Build metadata (OS version, device model,
build number, runtime version, certificate fingerprint, git SHA) is
mandatory — a row without build identity does not count.

## 4. Recovery posture (R2-F11)

- Previous signed binary stays installable; the update rollback is valid
  only while the signing fingerprint is unchanged.
- A native-code change requires a new build; an OTA-update rollback is
  allowed only when both runtimes share the compatible fingerprint.
- Never change the bundle ID / package name to sidestep a failure —
  that invalidates the association files and the store identity.

## 5. What CI/local already covers

`npm test --prefix mobile` (registry, route-map parity against `app/`,
deep-link guard, domain contracts, session storage, OIDC flow) and
`npm run typecheck` run on every change; `scripts/ecosystem-devices-verify.mjs`
proves the committed association contract (synthetic identifiers only,
`/session/*` + `/api/*` excluded, lanes scoped to the exact portal paths
that resolve to native screens). The `devices` gate also registers
`devices-android` / `devices-ios` capability cases — they report
`BLOCKED_CAPABILITY` until `ECO_CAP_DEVICES_ANDROID=1` /
`ECO_CAP_DEVICES_IOS=1` plus a runner are supplied, so a local PASS never
reads as device coverage. The per-OS evidence files
(`artifacts/verification/devices/<os>-evidence.json`) are produced by the
device runners, not by this gate.
