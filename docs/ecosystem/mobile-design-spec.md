# CampusCore mobile design specification

Task D1, phase 1. Design and shared-layer handoff, 2026-10-29.

## 1. Outcome, scope, and execution contract

Make the native app recognizably CampusCore: institutional navy chrome,
Be Vietnam Pro, compact academic information, clear sections, and quiet surfaces.
Students should see their current semester, immediate schedule, and shortcuts
without a large decorative panel consuming the first viewport.

Active plan: the user's Task D1 brief, implemented through this specification.
Stages: reference retrieval -> specification -> shared components -> reference
screens -> terminal verification and emulator comparison -> lead review.
Current phase: specification accepted as the bounded implementation direction.
Exit: additive shared APIs, three reference screens and navigation implemented;
requested checks and matched device captures recorded in section 8.

Authority: visual changes in the assigned components, design folder excluding
generated tokens, app layouts, dashboard, notifications, sign-in, and menu/nav.
No route, auth, data-fetching, permission, mutation, testID, or API changes.
No Git writes, Metro restart, generated-token edits, or web-source edits.
Existing content-ui and Docs/Events/Learning/News edits belong to slice 2.
Recovery: restore only this task's changes from reviewed preimages; preserve
pre-existing changes and all other workers' files. No reset/clean/stash.

Consistency ruling: legacy Stitch sign-in shows a password form. Native uses
OIDC in the system browser. Translate its centered identity/form composition,
not its credential handling. Reference copy and sample data never replace API
data or preview disclosures. All existing actions remain available.

## 2. Reference evidence and precedence

1. `frontend/DESIGN.md`, `.stitch/DESIGN.md`, `SITE.md`, and `metadata.json`.
2. Live Stitch asset `31dbebae693f4d199243d567d8df41a6`, named CampusCore
   Institutional Mobile System, project `8459672847959457355`.
3. Web `globals.css`, `WorkspaceSurface`, `AuthShell`, `NotificationsCenterPage`,
   announcement feed, events/learning/library/careers surfaces, and `ui/*`.
4. Current emulator captures and `artifacts/verification/mobile-parity/p16/`.

Live retrieval: project list-screens returned an empty object, but get-screen
and download-file resolved the seven known domain IDs. The legacy project's
list-screens and 13 known mobile records also resolved in this session, despite
the older local metadata calling that project unreachable. Do not change that
historical metadata as part of D1. Twenty HTML references are saved under
`artifacts/design/mobile-stitch/`; selected PNGs accompany them.

No named lecturer-dashboard mobile record was returned. Its layout below is
**from web code**, using `WorkspaceSurface` and the teaching dashboard. The
lecturer-directory Stitch reference is supplementary, not a dashboard claim.
Dark-mode values are **from web code and the existing native token contract**;
the live design-system asset is light-mode evidence.

Reference sizes are 780px wide (roughly 390 logical points). Layout measurements
below are React Native logical points, not screenshot pixels.

## 3. Visual language

### 3.1 Color and typography

Use `useTheme().colors` for canvas, cards, copy, controls, and semantic states.
Use `chromeFor(scheme)` for surfaces that stay navy across themes. Values in
this table are the existing mobile contract unless marked chrome projection.

| Role | Light | Dark | Source/use |
| --- | --- | --- | --- |
| Canvas | #F9F9FF | #13161B | Contract; flat workspace |
| Card | #FFFFFF | #1E2229 | Contract; reading and form surfaces |
| Low surface | #F1F5FB | #15181E | Contract; group backgrounds |
| Tonal surface | #E8EEF7 | #23272E | Contract; inactive utility chrome |
| Primary ink/action | #003F87 | #98BDD7 | Contract; active controls |
| Primary tint | #E6F0FF | #1C314A | Contract; icon chips/selection |
| Text | #17243A | #EDF0F2 | Contract; headings/body |
| Muted text | #526174 | #A9B1BC | Contract; metadata |
| Rule | #C9D5E4 | #33363D | Contract; borders/dividers |
| Navy | #00305E | #002148 | Chrome projection of web sidebar OKLCH |
| Strong navy | #001E40 | #00132F | Chrome projection of sidebar-strong |
| On navy | #FFFFFF | #EDF0F2 | Chrome; identity and headings |
| Muted on navy | #C9D8F0 | #A9B8CE | Chrome; secondary metadata |
| Brand gold | #E3B662 | #E9BD68 | Chrome projection of web brand-gold |
| On gold | #2B1C00 | #211500 | Chrome; identity badge ink |
| Chrome accent | #D1E8FA | #D1E8FA | Web chrome-accent; small rules/labels |
| Error / tint | #B42318 / #FBDAD7 | #F49A9A / #431919 | Contract |
| Success / tint | #247A4A / #DFF4E4 | #9BD4BA / #203C2F | Contract |
| Warning / tint | #946200 / #FFF0C7 | #EED1A0 / #433319 | Contract |

Gold is identity/deadline emphasis, not a general action color. Keep the
registration-only web gold CTA rule; native uses its current blue controls.
Student/lecturer/admin role identity continues to use `theme.roleColors`.
Do not infer status or role purely from color: retain the label and optional icon.

Be Vietnam Pro uses the already loaded 400/500/600/700 named font families.
Explicitly select the named weight face; do not rely on Android synthesizing
bold from `BeVietnamPro_400Regular`. Existing text variants stay supported.

| Native variant | Size/line height | Weight | Use |
| --- | --- | --- | --- |
| display | 34/40 | 700 | Existing compatibility; avoid dashboard sprawl |
| headlineLarge | 26/32 | 700 | Auth welcome and main numeric value |
| headlineMedium | 22/28 | 700 | Screen title |
| headlineSmall | 18/24 | 600 | Section title |
| bodyLarge | 17/26 | 400 | Long-form lead copy |
| bodyMedium | 16/24 | 400 | Main body/inputs |
| bodySmall | 14/20 | 400 | List description/metadata |
| label | 13/18 | 600 | Buttons, row headings |
| meta | 12/16 | 600 | Dates, pills, navigation |

These deliberately retain the native token scale; Stitch's 10px navigation and
24px-high segments are enlarged to meet the requested readability/touch floor.
Text scales to 1.5x; essential content wraps. No fixed text-container heights.
At 1.3x and above, dashboard stat/shortcut layouts stack and schedule metadata
moves under the title. Bottom labels wrap to two lines without shrinking.

### 3.2 Component anatomy

All dimensions use the 4px rhythm: 4/8/12/16/24/32. Phone gutter 16; section gap
24; related cards 12; standard card padding 16; compact rows 12. Radius 8 for
cards/fields/buttons, 4 for compact tags, pill only for status and selection.

| Component | Layout and variants | Light/dark treatment |
| --- | --- | --- |
| App bar | Minimum 56 high plus safe top; 36 insignia, 16 gap, brand, role, 44 profile target | Navy; on-navy copy; white logo backing |
| Hero band | 16 padding, 8 radius; icon/header row, 22/28 title, 14/20 detail; optional footer action | Navy/strong navy, chrome-accent eyebrow; no gradient |
| Card | 1px rule, 8 radius, 16 padding; compact variant through style | Card color; subtle 1px/3px shadow only in light |
| Section card header | 18/24 title, optional icon/count/action; bottom rule; 12 gap | Same surface, primary icon chip |
| Stat strip | Two or three cells with dividers; 26/32 value above 13/18 label | Single card, primary values; stacks at large font |
| MetricCard | Existing label/value/detail/icon API; value-led hierarchy | Card; 32 icon chip, primary value |
| List row | Minimum 48, 12 vertical; 36 chip; wrapping text; optional metadata/chevron | Card/low surface, unread primary tint and explicit label |
| Icon chip | 32/36/40 noninteractive visual, 8 radius, 20 icon | PrimaryFixed/primary; neutral uses surfaceLow/textMuted |
| Status pill | 4x8 padding; optional 14 icon and 12/16 label; wraps | Semantic fixed background/paired text |
| Primary button | Minimum 48; 8 radius, 12x16 padding; optional 20 icon | Primary/onPrimary; native dark pair retained |
| Secondary button | Same target; 1px outline; optional icon | Card/primary; on-brand variant uses chrome overlay/onSurface |
| Destructive button | Same target; semantic error fill, paired contrasting text | Error/on-error pairing derived from theme |
| Icon button | 44x44 minimum; 20 icon, optional loading/disabled | Transparent/tonal; on-brand variant supported |
| Segmented control | Tonal group, 4 inset; each tab >=44, 8 radius, wrapping label | Selected card/primary border; unselected muted |
| Filter chip | >=44 target; 8 radius; icon + label + optional count | Selected primary tint, otherwise card/rule |
| Form field | Label above; >=48 field; 16px text; 1px rule; 2px focus without size shift | Card; primary focus, semantic error/hint below |
| Loading | Existing state/live region or static skeleton; no screen-covering overlay | surfaceHigh skeleton, primary spinner |
| Empty | Compact 16-padding panel, icon and short heading; existing recovery action | Card/rule; no illustration or invented copy |
| Error/offline | Icon, message, existing retry; never replace retained cached data | ErrorFixed/error or warningFixed/warning |
| Bottom navigation | 68 minimum plus existing safe bottom; <=5 items; 20 icon, 12/16 labels; top active rule | Card/rule, primary active, muted inactive |
| Navigation rail | Same roles/routes; scrollable; compact labels; selected tonal tile | Navy chrome matching web sidebar |
| Menu | Bottom sheet max 86%; navy identity header, existing role chooser, divided rows; 48 targets | Card body, navy header, tinted selected row |
| Sheets/dialogs | 8 top corners, 16 padding, header/divider, 44 close; scroll long content | Card, themed scrim; no heavy shadow in dark |

Press feedback must not shift surrounding layout. Use tonal fill/opacity;
keyboard focus uses a visible 2px outline. Preserve all accessibility labels,
roles, live regions, disabled semantics, testIDs, and confirmation behavior.
Decorative icons are hidden from accessibility. No new explanatory UI copy.

## 4. Screen-family translation atlas

Files below are under `artifacts/design/mobile-stitch/`. IDs belong to legacy
project `16486483525927292845` except the seven domain-lane rows marked live.

| Stitch screen / ID | Reference file | RN sections and states |
| --- | --- | --- |
| Dashboard / 55abc697e13e416aa87c89fd331e6c62 | mobile-dashboard.html + .png | Compact hero, task tiles, divided updates; adapt to current academic data |
| Student home / 89b8434a99dd4fcb87ce3c84469e3186 | mobile-student-dashboard.html | Heading, semester band, stat strip, schedule, shortcuts; loading/error/empty/stale |
| Sign-in / 67e517e324ef454c810e2b41b4acdc99 | mobile-sign-in.html + .png | Identity header, centered card, existing browser OIDC or preview CTA, public links; busy/error |
| Profile / 1a12e27f4365459eb1d4ed274514d04d | mobile-profile.html | Identity card, labeled data rows, account/security groups, language/sign-out |
| Rounds / 05a2b1b196034830bc559ae72b82b6f9 | mobile-registration-rounds.html | Summary, filters, stacked rounds, dates, explicit state, action |
| Rounds variant / 4f5dfbb559504aa38f58b22599f361e4 | mobile-registration-rounds-variant.html | Alternate compact list density; do not add a route |
| Topics / 3d1a0cf1dd494919ab9095b738f0c8e4 | mobile-thesis-topics.html | Search/filters, topic cards, advisor/meta, status and detail action |
| Topic detail / be1ea000e675492d829254077907039a | mobile-thesis-detail.html | Title/status, advisor, requirements, eligibility, existing registration action |
| Thesis registration / 4ac0f22ff9c14155b071bf3c8ffa699c | mobile-thesis-registration.html | Selected topic, group/member fields, consent, submit/error |
| Progress / 5cb62add07304fa689a98c8512495482 | mobile-thesis-progress.html | Topic summary, progress, milestone rows, current submission and history |
| Evaluation / 3073bce589eb4d4e97ef9775e921a506 | mobile-thesis-evaluation.html | Criteria/status/result rows within retained progress capabilities |
| Notifications / a8940ff416834cf59245e878780e2135 | mobile-notifications.html + .png | All/unread segments, unread count/bulk action, icon rows, dates/read pills/delete |
| Lecturer directory / 36c60dec6ed9458a80bc5b1cfe6f82a5 | mobile-lecturer-directory.html | Search, advisor identity cards, department and existing selection action |
| News / 62e1c33865dc4baea955a00cc8bfb311 (live) | mobile-news.html + .png | Search/chips, priority lead article, metadata, reader and files |
| Docs / 02b1eec59ef749e199392e724ed6ca11 (live) | mobile-docs.html | Search/filters, file rows, official metadata, reader/download states |
| Events / fc5427a8d03549878d4acb90e696d646 (live) | mobile-events.html | Filters, event date/time/place cards, explicit status, registration actions |
| Learning / 44f28aa4f58a4cd2bbba9ee6efa534f5 (live) | mobile-learning.html | Due work, enrolled sections, materials, assignment/submission sheet |
| Admissions / bff380e5f2474201b169d6d6b3e7330c (live) | mobile-admissions.html | Round status, form groups, application history; simulation remains explicit |
| Library / 46104df5b291438d828c9d1d85042e6a (live) | mobile-library.html | Catalogue search, availability, holds/loans and status actions |
| Careers / 11bb52c7330c44428c503d35c343e2ff (live) | mobile-careers.html | Search/category filters, employer/opportunity cards, own applications |
| Lecturer dashboard / no returned mobile record | From web code: WorkspaceSurface + lecturer dashboard | Stat strip, upcoming teaching, grading/attendance actions; do not invent counts |

Every list preserves loading, error/retry, empty, offline/read-only, paging,
preview, busy, and permission states applicable to its current implementation.

## 5. Additive shared APIs

Keep existing exports/props working. No data hooks live in visual components.

| API | Change / intended use |
| --- | --- |
| UiText | Named loaded font face per weight; optional title/body styles remain accepted |
| Button | Add icon, destructive and onBrand variants; label and callbacks unchanged |
| HeroCard | Add optional icon; existing eyebrow/title/detail/children/style retained |
| ActionTile | Add style and compact horizontal layout; current icon/label/action retained |
| Badge | Existing tones retained; use StatusPill when an icon is needed |
| IconChip | Decorative typed MaterialCommunityIcons glyph, size/tone/onBrand |
| IconButton | Required accessibilityLabel, icon, action, disabled/busy, onBrand |
| StatusPill | label + existing semantic tone + optional icon; noninteractive |
| SectionCard | title, optional icon/action/count; children; divided header |
| StatStrip | items [{label,value,icon?}]; theme-driven, accessible values; responsive stack |
| FilterChip | label, selected, onPress, optional icon/count, disabled |
| SheetHeader | title, closeLabel, onClose, optional subtitle; preserved existing Sheet API |
| ListRow | Add optional icon and stackedMeta; preserve leading/trailing/unread/action |
| ScreenShell | Add optional header visibility/content positioning; default unchanged |
| FormField | Focus treatment composes caller onFocus/onBlur; preserve native input props |

## 6. Proposed contract tokens (proposal only)

Do not edit `contracts/ecosystem/tokens.json`, generated `tokens.ts`, web tokens,
or run sync-tokens. Existing local chrome projection is maintained in
`mobile/src/design/chrome.ts`, not represented as canonical contract parity.

Propose a future shared review of: `spacing.compact = 12`,
`layout.appBarMinHeight = 56`, `layout.controlMinHeight = 48`,
`typography.fontFaces.{regular,medium,semibold,bold}`, chrome sidebar/strong/
onSurface/accent/brandGold pairs, `elevation.cardShadow`, and `scrim` pairs.
D1 derives compact spacing from existing 8+4 steps and uses native styles;
no generated contract changes are needed for downstream workers.

## 7. Three disjoint follow-up slices

D1 remains sole owner of shared components/design/app layouts. The screen
owners below consume these APIs; send shared changes back to the lead/D1.
D1 reference screens are models: avoid rewriting them while splitting work.

Common acceptance C: vi/en, light/dark, 1.5x, >=44 targets, no essential text
clipping, original route/testID/a11y/action preserved, real state branches,
no invented API values, typecheck and affected regressions. Specific checks
below add to C. Each route belongs to exactly one slice.

### Slice 1: student academic and account

| Screen / files | Reference file | Target layout | Acceptance in addition to C |
| --- | --- | --- | --- |
| Student dashboard (D1 model) | mobile-student-dashboard.html | Semester band/stat strip/schedule/quick links | Counts/data unchanged; tasks above fold at 1x |
| Schedule / ScheduleExport | mobile-learning.html (adaptation) | Day selector + time/room rows + existing export | No time/room loss; calendar export unchanged |
| Courses | mobile-learning.html | Course code/title/status, detail groups | Original section actions and credits remain |
| Grades | mobile-thesis-evaluation.html (adaptation) | Semester selector, grade summary, subject rows | Both grading scales and explanations retained |
| Transcript | mobile-thesis-evaluation.html (adaptation) | GPA/stat strip + accessible semester groups | GPA calculation/export untouched |
| Curriculum | mobile-learning.html (adaptation) | Requirement summary, module/status groups | Required/elective/completed distinctions retained |
| Enrollments + EnrollmentDetail | mobile-registration-rounds.html | Registration summary, slips and detail rows | Reconciliation/status data intact |
| Attendance | mobile-learning.html (adaptation) | Attendance summary, dated course rows | Attendance state and denominator unchanged |
| Registration + controls/basket | mobile-registration-rounds.html | Search/filter group, course rows, selection summary | Capacity/conflict/idempotency behavior untouched |
| Conduct | mobile-profile.html (adaptation) | Score summary + period details | Explicit unavailability remains when unsupported |
| Certificates | mobile-docs.html (adaptation) | Request/status rows, existing form | Existing request eligibility/validation preserved |
| Profile + language/two-factor/sign-out | mobile-profile.html | Identity, data/security/language groups | 2FA states and sign-out confirmation intact |

### Slice 2: content, thesis, assistant

Owns `content/content-ui.tsx`, News/Docs/Events/Learning and their unfinished edits.

| Screen / files | Reference file | Target layout | Acceptance in addition to C |
| --- | --- | --- | --- |
| Notifications (D1 model) | mobile-notifications.html | Segments, count/actions, wrapping icon rows | All/unread, route allowlist, mark/delete unchanged |
| News + announcements + reader | mobile-news.html | Search/chips, lead/regular articles, reader | Priority/authored content/files still accessible |
| Docs + file preview | mobile-docs.html | Filter/search header, file/meta rows, preview | File transfer states and limits unchanged |
| Events | mobile-events.html | Date chip, place/time, status and actions | Closed/cancelled/waitlist/registration states remain |
| Learning | mobile-learning.html | Due tasks, course sections, materials, submission | Existing upload/submission/feedback unchanged |
| Admissions (student) | mobile-admissions.html | Round summary, short field groups, history | Simulation and validation remain explicit |
| Library (student) | mobile-library.html | Search/catalogue/availability + own loans | Server availability/hold expiry retained |
| Careers (student) | mobile-careers.html | Opportunities/category + own applications | Existing apply/withdraw/attachments retained |
| Thesis topics + advisors | mobile-thesis-topics.html; mobile-lecturer-directory.html | Filters/topic cards, advisor rows | Selected topic/advisor IDs survive navigation |
| Thesis detail | mobile-thesis-detail.html | Summary, requirements, eligibility/action | No hidden restrictions or new CTA routes |
| Thesis registration | mobile-thesis-registration.html | Topic, group/member form, submit | Member/group rules and original errors retained |
| Thesis progress + submission/evaluation | mobile-thesis-progress.html; mobile-thesis-evaluation.html | Milestones/progress, files, feedback | Deadlines, current file/history, grades preserved |
| Assistant + history/composer/messages | mobile-learning.html (visual adaptation); web AssistantPanel | Quiet conversation, citations, composer/history sheet | Stream/quota/provenance/retry/keyboard behavior retained |

### Slice 3: auth, chrome, lecturer/admin/staff/lanes

Shared chrome is D1-owned; this slice proposes changes to D1/lead and owns
only its auth/operations/lane screen implementations in the next phase.

| Screen / files | Reference file | Target layout | Acceptance in addition to C |
| --- | --- | --- | --- |
| Sign-in (D1 model) | mobile-sign-in.html | Institutional identity, centered auth card, public links | OIDC/browser and preview entry unchanged |
| Forgot/reset/logged-out/blocked + forced rotation | mobile-sign-in.html (adaptation) | Compact auth card, field groups/status | Recovery/OTP/expiry/blocked flow unchanged |
| AppBar, MenuPanel, bottom nav, rail, app layouts (D1 owner) | mobile-news.html + web sidebar | Navy identity, clear active nav, divided menu | Role/nav guard/safe area/a11y isolation retained |
| Lecturer dashboard | No mobile dashboard returned; web WorkspaceSurface | Stat strip, teaching rows, quick work | Show only supplied counts and assignments |
| Lecturer schedule | mobile-learning.html (adaptation) | Day/time/room cards | Existing teaching actions remain |
| Lecturer grading + GradeRow | mobile-thesis-evaluation.html (adaptation) | Course selector, student grade rows, save controls | Lock/publish/import rules unchanged |
| Lecturer attendance + roster | mobile-learning.html (adaptation) | Session selector, roster/status rows | Existing write eligibility unchanged |
| Admin dashboard/students/lecturers | mobile-profile.html; mobile-lecturer-directory.html | Metrics, search, identity/status rows | Role and edit restrictions preserved |
| Dean overview | mobile-thesis-progress.html (adaptation) | Thesis totals, grouped status rows | Existing capability guard untouched |
| Staff admissions review | mobile-admissions.html | Application queue/detail/decision form | Explicit grant/decision rules retained |
| Staff careers desk | mobile-careers.html | Opportunities and application queue | Existing decision/status actions preserved |
| Staff library desk | mobile-library.html | Requests/loans, issue/return actions | Copy availability and transition checks remain |
| Admin overview/attendance/audit | mobile-profile.html (adaptation) | Summary, filters, read-only log/attendance rows | Audit IDs/details and read-only mode preserved |
| Admin credit limits/enrollments | mobile-registration-rounds.html (adaptation) | Review queue, credit/status details | Existing approvals/versions/limits unchanged |
| Admin events/notifications | mobile-events.html; mobile-notifications.html | Lifecycle/roster or inbox management | Capability-gated mutation semantics intact |

## 8. Verification checkpoints and evidence

Implementation lane: one changed-source typecheck only when needed to unblock
composition. Terminal budget: run the four commands below once, repair observed
in-scope failures narrowly, rerun only affected checks. Jest snapshot update is
authorized once at the end; list changed entries. Do not weaken behavior tests.

From `mobile/`:

```powershell
npx tsc --noEmit
npm test
npx jest --runInBand
node ..\scripts\check-mobile-parity.mjs
```

Also run `git diff --check` on owned paths and read-only token parity check.
No commit/push/CI claims. Node/Jest checks are not live OIDC or production proof.

Device: emulator-5554, io.campuscore.mobile, existing Metro 8081, preview mode.
Matched raw screenshots in `artifacts/verification/mobile-parity/p16/`:
`d1-before-{light,dark,font15}-{dashboard,notifications,signin,menu}.png` and
`d1-after-{light,dark,font15}-{dashboard,notifications,signin,menu}.png`.
font15 is light theme at 1.5x. Capture/inspect all four screens, scroll for
offscreen essential actions, then leave sign-in/light/font 1.0. This is Android
preview evidence only; iOS, tablet, authenticated provider are NOT_RUN.

Final results and any residual limits will be recorded here after verification.

## 9. Status (D1b handoff, 2026-10-29)

**Implemented.** Shared layer: `ui/institutional.tsx` (IconChip, IconButton,
StatusPill, SectionCard, StatStrip, FilterChip, SheetHeader), extended
`Ui.tsx` (HeroCard icon, ActionTile compact, ListRow icon/stackedMeta,
ScreenShell hideHeader), Button icon/destructive/onBrand, UiText named
weight faces + `maxFontSizeMultiplier` cap, `design/chrome.ts` navy/gold
projection, and new `AppBar`. Chrome/layouts: `(app)/_layout.tsx` mounts
AppBar + BottomNavigation/NavigationRail + MenuPanel; sign-in, student
dashboard, notifications restyled per §3/§4. Verified on emulator-5554:
light, dark, and 1.5x captures in
`artifacts/verification/mobile-parity/p16/d1b-*.png`. No clipped text,
>=44 targets held, both schemes correct. AppBar row gap corrected to 16
per §3.2 (snapshot `AppGroupLayout` x4 updated).

**Slices must still do.** Slice 2 was editing `content/*`, `thesis/*`,
`Docs/Events/Learning/News` during this run; its in-flight files currently
fail typecheck (`StyleSheet` not imported in DocDetail/LibraryTitleDetail/
CareerDetail/NewsDetail; `tone="neutral"` vs TextTone in thesis-ui) and 8
visual snapshots (Events, Assistant-initial). Slice 1 screens and slice 3
auth/chrome consumers are untouched and still on the pre-redesign visual
language.

**Known gaps.** `npm test` has 1 pre-existing failure in
`tests/offline-read.test.mjs` — it asserts the old
`readQueryCache<T>(cacheKey, options.maxAge)` call shape that the
query-identity refactor (`src/hooks/useScreenQuery.ts`, outside D1
ownership) replaced with `boundary.cacheKey`; the sibling tests were
updated, this one was missed. Content-list screens still show the
pre-slice-2 layout behind ListFrame's navy header. iOS, tablet (rail is
code-reviewed only), and live-OIDC paths are NOT_RUN.
