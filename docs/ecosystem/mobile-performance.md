# Mobile performance — P1 evidence, 2026-10-29

Status: **DONE_WITH_CONCERNS for Lead review; smoothness acceptance remains open**.
No Git writes, commits, pushes, release publishing, or provider calls were made.
Execution authority: [P1 plan](../../plans/261029-P1-mobile-performance/plan.md).

## Method and limits

- Windows; Android 16 AVD `campuscore-demo`, `emulator-5554`, 1080×2400,
  density 420; emulator OpenGL translator uses the RTX 3060 Laptop GPU.
- Expo 57.0.31, RN 0.86.3, React 19.2.3; Hermes and new architecture enabled.
  Only the existing Metro on 8081 was used. ADB is resolved from PATH.
- Before: existing debuggable APK. After: rebuilt debuggable APK, same AVD.
  Both use Metro/dev mode; **these are relative debug observations**.
- Five process-cold `am force-stop` / `am start -W -n
  io.campuscore.mobile/.MainActivity` launches per snapshot; report TotalTime median.
  This measures Activity display, not complete JS readiness or storage-cold launch.
- Dashboard readiness: tap preview, then observe dashboard controls in UI XML.
  This is an upper bound including ADB/uiautomator overhead, not precise input TTI.
- For each feed: reset gfxinfo, alternate eight 350 ms swipes between
  (540,1900) and (540,800), then collect `dumpsys gfxinfo ... framestats`.
  Preview contains only a few records. Zero-frame/4950 ms sentinel results are N/A;
  eight-frame traces are too short to demonstrate sustained scrolling.
- The first probe tapped preview description copy; those route traces are invalid.
  `baseline-valid/` contains the corrected baseline. Its admin role switch still
  targeted the wrong label and reached dashboard: **admin baseline is NOT_RUN**.
  The after probe checks the actual admin-roster heading and is valid.
- Concurrent sign-in/news work appeared after dispatch. It was preserved and is
  included in after timings/bundle bytes. Differences cannot be attributed solely
  to P1. `final-device-source.json` identifies the measured source files.
- Raw logs, XML, exports, maps and scripts: `artifacts/verification/mobile-parity/p16/perf/`.
  These are local evidence, never staged. Baseline export and final Android export
  ran sequentially with builds/tests; a whitespace-only export repeat produced
  the same Hermes chunk hash.

## Before / after

| Metric | Before debug | After debug |
|---|---:|---:|
| Activity cold-start median, 5 runs | 3376 ms | 2338 ms |
| Dashboard UI-ready upper bound | 3568 ms | 2980 ms |
| Notifications jank | 50/68, 73.53% | 80/90, 88.89% |
| Notifications p95 | 150 ms | 89 ms |
| Hermes bytecode, one chunk | 3,748,888 B | 3,771,096 B (+0.59%) |
| Exported assets | 7,523,027 B / 65 files | 5,636,651 B / 51 files |
| Font asset references | 38 | 24 |
| Controlled 200-row initial mount | 200 eager rows | ≤8 row trees; ≤7 inside a grouped card |
| Extra dashboard executions on parent update | 1 | 0 |
| Extra news card executions on parent update | 2 | 0 |
| Extra schedule card executions on parent update | 1 | 0 |

Render counts come from a React Profiler/component-test harness with fixed props
and stable outer providers, not a physical-device or live streaming benchmark.
The three screens perform zero additional query-hook reads in that parent update
(before: dashboard 2, news 1, schedule 2). Profiler commits include the parent and
are not treated as screen executions. No production instrumentation remains.

| Feed | Before frames; jank; p90/p95/p99 ms | After frames; jank; p90/p95/p99 ms |
|---|---|---|
| Notifications | 68; 73.53%; 150/150/200 | 90; 88.89%; 85/89/113 |
| News | 56; 82.14%; 150/150/150 | 8; 100%; 19/19/19 — insufficient sample |
| Docs | 57; 80.70%; 150/150/250 | 0 — N/A |
| Events | 61; 88.52%; 150/150/200 | 8; 100%; 19/19/19 — insufficient sample |
| Library | 0 — N/A | 93; 81.72%; 69/89/93 |
| Admin students | invalid route — N/A | 92; 86.96%; 73/85/101 |

Jank did not converge to the requested budget. Lower percentile durations do not
turn the increased reported jank percentage into a pass.

Release-after-only check: a non-debuggable, packaged-Hermes preview APK built
successfully online with JDK 24 (46,591,714 B). Five Activity starts were
1457/1776/1842/1414/1260 ms; median **1457 ms**. Dashboard UI-ready upper bound:
**2595 ms**. There is no matched release baseline: the initial offline build
failed on uncached dependencies, not JDK incompatibility. Do not compare this
release result with the debug baseline as a controlled improvement.

| Release-after feed | Frames; jank | p90/p95/p99 ms |
|---|---|---|
| Notifications | 84; 88.10% | 89/101/125 |
| News | 8; 100%, insufficient | 19/19/19 |
| Docs | 0, N/A | N/A |
| Events | 8; 100%, insufficient | 19/19/19 |
| Library | 83; 90.36% | 97/97/125 |
| Admin students | 85; 85.88% | 93/105/121 |

The release launch budget passes; sustained-scroll acceptance does not. Debug
restore then stalled on the original Metro bundle (local request timed out at
15 s). Final state is the release preview APK on sign-in, light/1.0; original
Metro remains untouched. Reinstall debug when its bundle endpoint responds.

## Changes and file inventory

One native list engine: `src/components/perf/performance-list.tsx` wraps FlatList,
requires data/render/key props, keeps header/empty/footer/refresh/paging slots,
and centralizes gutters/navigation inset. Initial/batch counts 8, window 7,
batch interval 50 ms; Android clipping enabled except chat. No guessed fixed row
heights: bilingual text, large fonts, expanded cards and validation change height.

New helpers under `mobile/src/components/perf/`:
`list-screen-shell.tsx`, `grouped-rows.ts`, `group-card.tsx`, `virtual-rows.tsx`.
They keep a single scroll surface and flatten grouped records without eagerly
mounting a whole semester/card. Adjacent card segments retain the card outline;
their repeated shadows are removed. Pixel acceptance of these segments is pending.
Existing `mobile/src/components/ui/data-list.tsx` uses the shared engine, so
news, notifications, docs, events, library and other ListFrame feeds inherit it.

Converted screen files, all under `mobile/src/screens/`:

- `academic/CurriculumScreen.tsx` — individual curriculum records.
- `academic/EnrollmentWorkspace.tsx` — enrollments, responsive columns retained.
- `academic/TranscriptScreen.tsx` — terms and individual transcript records.
- `assistant/AssistantScreen.tsx` — message list; stable rating callback lets the
  existing memoized message/Markdown components retain completed messages.
- `assistant/AssistantHistorySheet.tsx` — cursor-paged conversation history.
- `content/AdmissionDetail.tsx` — attachments and review history.
- `content/AssignmentDetail.tsx` — revisions and feedback history.
- `content/CareerDetail.tsx` — attachments.
- `content/ConductScreen.tsx` — recorded activities.
- `content/LibraryTitleDetail.tsx` — copies.
- `lanes/AdminLaneScreens.tsx` — attendance, enrollments, audit, credit limits,
  events/roster and notification history.
- `lanes/DeanOverviewScreen.tsx` — supervisors and groups.
- `lanes/StaffDeskScreens.tsx` — admissions, careers and library queues.
- `operations/AdminScreens.tsx` — student and lecturer directory containers.
- `operations/LecturerAttendanceScreen.tsx` — attendance roster.
- `operations/LecturerGradingScreen.tsx` — grade roster.
- `operations/LecturerScheduleScreen.tsx` — section list.
- `student/AttendanceScreen.tsx` — summaries and attendance records.
- `student/GradesScreen.tsx` — individual grades in term groups.
- `student/RegistrationScreen.tsx` — course headings and individual sections.
- `student/ScheduleScreen.tsx` — day headings and individual sessions; memoization.
- `thesis/ThesisScreens.tsx` — paged topics.
- `thesis/ThesisRoundPicker.tsx` — round selection sheet.

Container adapters changed only to accept the list:
`academic/academic-ui.tsx`, `content/content-ui.tsx`, `lanes/lane-ui.tsx`,
`operations/lecturer-ui.tsx`, `operations/shared/helpers.tsx`.
Additional hot-screen changes: `student/StudentDashboardScreen.tsx` and
`student/NewsScreen.tsx` memoize unchanged props; `student/NotificationsScreen.tsx`
has optimistic mark-read/delete/all-read overlays with rollback, a synchronous
mutation latch, identity checks and post-success cache invalidation.

Remaining maps are finite controls/metadata, small schedule slots, bounded
member/search/advisor results, charts or Markdown within bounded messages.
Advisor topic lookup is capped at 60; group members at 5; student lookup is sliced.
No route/API/i18n/testID/accessibility label was intentionally changed by P1.

Queries: `mobile/src/hooks/query-cache.ts`, `useScreenQuery.ts`, plus new
`query-performance.ts`, `use-dashboard-prefetch.ts`, `use-optimistic-rows.ts`,
`use-stable-callback.ts`. Same account/locale/role/grant/filter/page keys and epoch
checks; lane cache exclusion unchanged. In-flight consumers coalesce per scoped
key/epoch, including failure cleanup. Automatic freshness defaults: list 30 s,
detail/profile 120 s, static semester/curriculum/catalog 15 min; explicit reload
still refreshes. Background blocks new revalidation; focused foreground only
revalidates stale data. Already dispatched reads may finish.

Dashboard prefetch is deferred 150 ms, student/live only, at most enrollments and
unread count; navigation/background abort, and epoch/identity changes prevent late
publication. Count key is now `content.notifications.unread-count`: the previous
count key collided with the unread paged result. No API contract changed.

Boot: `mobile/app/_layout.tsx`, `mobile/app/(app)/_layout.tsx`, `mobile/app.json`,
`mobile/package.json`, `mobile/package-lock.json`. Fonts and session bootstrap
mount in parallel; splash readiness waits for fonts/session/locale. Four direct
font-weight imports eliminate 14 unused font assets. Splash package/plugin added.
Native generated registration is outside P1 ownership and still needs integration.

The 270×342 logo is 24,505 B, already below 100 KB, with explicit display bounds
and contain scaling. No remote list images were found. Assets were not rewritten.
Existing themed-style factories and Markdown parsing were already memoized.
Context splitting, eager screen registry/i18n execution, and deeper module laziness
remain unmeasured hypotheses outside ownership; no speculative changes were made.
Both maps contain 20 i18n source modules (~133 KB source); this is inclusion data,
not a measurement of startup parse time. No animation dependency/code was added.

Dependency: only `expo-splash-screen ~57.0.10`, installed with `npx expo install`.
[Expo 57 SplashScreen](https://docs.expo.dev/versions/v57.0.0/sdk/splash-screen/)
justifies it. [Expo 57 FlashList](https://docs.expo.dev/versions/v57.0.0/sdk/flash-list/)
lists 2.0.2; existing FlatList sufficed. No FlashList/expo-image/Reanimated/gesture
package was added. Reanimated already resolved transitively before P1, contrary
to the dispatch assumption. List settings follow
[RN guidance](https://reactnative.dev/docs/optimizing-flatlist-configuration).

## Verification and ownership

- PASS `npx tsc --noEmit`.
- PASS `npm test`: 406/406; no skips. New P1 Node cases: 10.
- `npx jest --runInBand`: 339 passed / 8 failed, 24 passed suites / 1 failed.
  All 8 failures are owned structural snapshots in `tests/visual/visual-static.test.tsx`:
  Courses and Assistant-initial, light/dark, widths 360/1000. Course cells/header
  now sit in FlatList's cell wrappers; assistant header/footer have native list
  wrappers. No snapshots were updated. 20 other snapshots pass.
- PASS parity: 74 mobile / 74 web routes. PASS `npx expo install --check`.
- Expo Doctor: 20/21; pre-existing missing direct peer `expo-linking`. Not repaired.
- PASS `git diff --check`; PASS final Android export; PASS debug native build
  with JDK 24 / `JAVA_TOOL_OPTIONS=--enable-native-access=ALL-UNNAMED`.
- New P1 Jest cases: 14 (list/window/group, parent render counts, lifecycle,
  prefetch cancellation/epoch, notification rejection rollback).
- Test files added: `tests/performance-{query,contract}.test.mjs` and
  `tests/component/performance-{list,query-lifecycle,render-counts,prefetch}.test.tsx`.
  Existing notification test adds rollback cases and separates the count fixture;
  `tests/student-json.test.mjs` reads named files instead of assuming function exports.
- User-owned `useScreenQuery.ts` edits were preserved. P1-only hunks: imports,
  freshness option fields, focus ref, background guard, coalesced await and
  automatic revalidate/focus/foreground callbacks. Exact 98-line incremental patch:
  `artifacts/verification/mobile-parity/p16/perf/use-screen-query-p1-only.diff`.
  Protected offline-cache-scope, phase-six-repair and query-lifecycle test files
  have zero post-dispatch differences; query-identity and scripts were not edited.
- NewsScreen's new router params, sign-in/news feature files, shell messages,
  navigation adapters/types and service-test router mock belong to concurrent work.
  P1 NewsScreen hunks are only memo import/export/closing syntax. Package test
  script additions are the two performance Node files; other new tests are external.

## Acceptance budgets and next actions

Hold release AVD median Activity cold start <2500 ms; real interactive dashboard
<2500 ms with an app/trace marker; jank <5% over at least 1000 scroll frames per
large seeded list; p95 <32 ms on a 60 Hz device; Hermes bytecode ≤ baseline +5%.
No loading-header height jumps or input/reading-position loss; account/grant
isolation and zero background revalidation remain mandatory.

Physical device, iOS, authenticated live network, input-latency TTI, loading-layout
traces and a matched release before/after pair are NOT_RUN. Do not infer web-portal
smoothness parity from debug percentiles or synthetic mount counts.

Lead: review the snapshot diffs, segmented card pixels/large fonts, long-list fill
rate, keyboard editing, chat reading position and stateful upload controls when
their rows leave the window. Integrate generated splash registration via reviewed
Expo prebuild changes; `mobile/android` was not edited. Then run:

```powershell
cd mobile
$env:JAVA_TOOL_OPTIONS='--enable-native-access=ALL-UNNAMED'
$env:EXPO_PUBLIC_API_MODE='preview'
npx expo prebuild --platform android --no-install
cd android
.\gradlew.bat :app:assembleRelease -PreactNativeArchitectures=x86_64 --console=plain
adb -s emulator-5554 install -r app/build/outputs/apk/release/app-release.apk
cd ../..
python artifacts/verification/mobile-parity/p16/perf/device-probe.py release-verified
```

For physical-device runs, explicitly assign that device, replace the script's
serial and adapt swipe bounds; do not operate the concurrently connected phone.
Use the same native configuration, seeded dataset and host load for both revisions.
Native release measurements and final emulator restoration are recorded in the
execution ledger. No commit/push/CI/release publication was performed.

## Real device (SM-A057F)

P4, 2026-10-29: **DONE_WITH_CONCERNS**. A05s, Android 15, arm64-v8a,
1080×2400, existing font scale 1.0/light scheme. Display reports 90 Hz; system
settings were unchanged. Source: `3837c1e3425c8f8898392456daa30cab7c3d4186`.
Mobile source/config/package hashes still matched the build snapshot after
journeys/performance at 17:04. Unrelated source edits appeared at final handoff;
these results bind the packaged APK, not the later dirty working tree.
Detailed journeys and defects: [P4 report](../../plans/reports/test-261029-1637-p4-real-android.md).

Fresh Expo prebuild and arm64 release build/install passed. Packaged Hermes,
preview mode, non-debuggable release variant signed with the generated debug key;
this is a local verification APK, not a distribution signing claim.
APK: **46,130,247 B (43.99 MiB)**, SHA-256
`d620c30e4f00e5ddac144a9be99be2e2162b61e00b19c62cb3aeb3fe060cc61f`.
Native document-picker/file-system/sharing modules were linked; their actual file
operations remain NOT_RUN because preview hides upload controls and public docs
have no download/share control. Release `run-as` was denied.

Commands, from `mobile/`, then `mobile/android/`:

```powershell
$env:JAVA_TOOL_OPTIONS='--enable-native-access=ALL-UNNAMED'
$env:EXPO_PUBLIC_API_MODE='preview'
$env:NODE_ENV='production'
npx expo prebuild --platform android --no-install
# Apply the local generated-only Windows path repair described below.
cd android
.\gradlew.bat :app:assembleRelease -PreactNativeArchitectures=arm64-v8a --console=plain
adb -s <serial> install -r app/build/outputs/apk/release/app-release.apk
.\gradlew.bat --stop
```

SDK was already installed under `D:/Android/Sdk`; the requested LOCALAPPDATA SDK
location was absent. Incomplete ignored dependencies first required
`npm ci --ignore-scripts --no-audit --no-fund`; package/lockfile stayed unchanged.
Initial native build failed on a gesture-handler object path over 260 characters.
The first local `CMAKE_OBJECT_PATH_MAX=128` workaround also failed. Successful
repair, only in ignored `android/app/build.gradle`: defaultConfig CMake argument
`-DCMAKE_OBJECT_PATH_MAX=256`, plus `android.externalNativeBuild.cmake`
`buildStagingDirectory file("../c")`. Fresh prebuild replaces this local repair.
Successful final build: 2m47s, 532 tasks, 114 executed/418 up-to-date.

Warnings: missing `expo-system-ui` for `userInterfaceStyle`; deprecated Gradle
features incompatible with Gradle 10; dependency Java/Kotlin/C++ deprecations;
ignored NO_COLOR under FORCE_COLOR. The initial NODE_ENV warning was resolved
by setting production on the successful build. Dependency restoration also
reported the existing test-renderer/react-reconciler React peer mismatch and
deprecated transitive packages. No app-source fixes or dependency additions.

Five process-cold `am force-stop` / `am start -W -n
io.campuscore.mobile/.MainActivity` launches: **892/602/473/600/518 ms**;
median **600 ms**. Activity display only; full JS interactive time remains
NOT_RUN. A preliminary locked-device launch was excluded. This is after-only,
not a controlled before/after comparison with P1's emulator.

Each list: validated route XML and screenshot, gfxinfo reset, 20 alternating
350 ms swipes at x=540, y=1900↔700, then framestats. Preview record counts:
notifications 3, news 2, docs 1, events 2. Raw evidence:
`artifacts/verification/mobile-parity/p16/p4/`; screenshots: `device-*.png`
in its parent. Percentiles below are Android gfxinfo histogram values.

| Metric / feed | Observed | Budget comparison / limit |
|---|---|---|
| Median Activity cold start | 600 ms, 5 runs | Below 2500 ms reference; PASS for Activity display only |
| Notifications | 965 frames; 17 janky, 1.76%; p90/p95/p99 25/26/29 ms | Observed below 5% / 32 ms; sustained-scroll gate NOT_RUN (<1000 frames, tiny preview dataset) |
| News | 0 frames | N/A; 4950 ms sentinel percentiles discarded |
| Docs | 0 frames | N/A; 4950 ms sentinel percentiles discarded |
| Events | 880 frames; 1 janky, 0.11%; p90/p95/p99 23/24/25 ms | Observed below 5% / 32 ms; sustained-scroll gate NOT_RUN (<1000 frames, tiny preview dataset) |
| TOTAL PSS | 194,262 KiB = 189.7 MiB | After >2 min active navigation; no PSS budget specified in this document |
| Interactive dashboard / bytecode growth | NOT_RUN | No app readiness trace marker / matched physical-device baseline |

Memory was sampled at 16:58:11, over two minutes after the 16:55:59 schedule
capture, with uninterrupted preview navigation between them. Display was 90 Hz;
the existing 60 Hz frame budget is a reference, not matched-hardware proof.
Long seeded list smoothness remains open. No emulator measurements were rerun.

Device acceptance found two low-severity UI defects: raw `preview-term` grades
heading, and clipped Vietnamese profile preview badge. No redesign/fixes made.
Preview chat, guest article, dashboard, schedule, notifications, content lists,
document detail and VI↔EN switching were observed. Dark mode, font 1.3 and rotation
remain NOT_RUN: the no-system-settings rule was retained and no exception arrived.
Live authentication/file transfers need an explicitly authorized synthetic demo
login policy and reachable demo API; the protected demo-acceptance doc contains
no mobile demo login authorization. Push tap-through remains NOT_RUN without a
real FCM project/build configuration and registered device token.
