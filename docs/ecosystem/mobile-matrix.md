# Mobile matrix — CampusUTE native app (P07; events row landed P08)

Lane coverage theo `mobile-policy.md` §4. Mỗi surface ghi
`native | web-only | planned`; platform evidence ghi rõ
`verified | blocked-capability` — không claim gì ngoài bằng chứng đã chạy.

## 1. Role lanes (KM-8)

| Backend roles | Native lane | Ghi chú |
| --- | --- | --- |
| `STUDENT` | student | Full student lane. |
| `LECTURER`/`FACULTY`/`TEACHER` | lecturer | Precedence LECTURER → STUDENT (KM-8). |
| `ADMIN`/`SUPER_ADMIN` only | **web-only** | Không có native lane — mọi `admin.*` route render unavailable-state + portal link. |
| `ADMIN` + `LECTURER` | lecturer | Admin role không mở lecturer.* — `lecturerRoles` đã gỡ `admin` (KM-8). |
| no mapped role | signed-out | "account không có native surface" → blocked UX + portal. |

## 2. Route matrix (22 screens → expo-router tree)

| ScreenName | Path | Role | Lane | API source |
| --- | --- | --- | --- | --- |
| `auth.signIn` | `/sign-in` | all | OIDC PKCE (system browser) | `{issuer}/oauth2/*` |
| — | `/sign-in-blocked` | all | blocked UX (KM-12) | portal link |
| `dashboard.student` | `/dashboard` | student | native | `enrollments`, `announcements/my` |
| `schedule` | `/schedule` | student | native | `enrollments` |
| `courses` | `/courses` | student | native | `enrollments` |
| `grades` | `/grades` | student | native | `enrollments/my/grades`, `transcript` |
| `attendance` | `/attendance` | student | native | `attendance/my/summary` |
| `registration` | `/registration` | student | native | `registration/rounds`, `me/registration/sections`, `me/enrollments` |
| `notifications` | `/notifications` | all | native | `notifications/my` |
| `events` | `/events` | student | native | `events`, `events/my/registrations`, register/cancel (Idempotency-Key) |
| `learning` | `/learning` | student | native (text lane) | `learning/sections`, `learning/sections/{id}/materials`, `learning/sections/{id}/assignments`, draft/save/submit/resubmit + revisions/feedback (Idempotency-Key; file picking P13) |
| `profile` | `/profile` | all | native | `auth/me`, `auth/profile`, `auth/change-password` |
| `thesis.topics` | `/thesis` | student | native | `thesis/rounds`, `thesis/topics`, `thesis/groups` |
| `thesis.detail` | `/thesis/[topicId]` | student | native | idem — dynamic segment, id trên path (KM-5) |
| `thesis.registration` | `/thesis/register?topicId=` | student | native | `thesis/groups` create/assign |
| `thesis.progress` | `/thesis/progress` | student | native | `thesis/groups` |
| `assistant.chat` | `/assistant` | all | native | `assistant/*` (live only; preview local) |
| `admin.dashboard` | `/admin/dashboard` | admin | **web-only** | — |
| `admin.students` | `/admin/students` | admin | **web-only** | — |
| `admin.lecturers` | `/admin/lecturers` | admin | **web-only** | — |
| `lecturer.dashboard` | `/lecturer/dashboard` | lecturer | native | `sections/my/schedule`, `sections/my/grading` |
| `lecturer.schedule` | `/lecturer/schedule` | lecturer | native | `sections/my/schedule` |
| `lecturer.grading` | `/lecturer/grading?sectionId=` | lecturer | native | `grades/student-grades/section`, `sections/{id}/grades` PUT/publish |
| `lecturer.attendance` | `/lecturer/attendance?sectionId=` | lecturer | native | `attendance/section/{id}/roster`, `attendance/section/{id}` GET/PUT |

Deep-link `/auth/callback` không route tới screen nào — OIDC session consumes
(KM-10); stray link → guard → `/sign-in`.

## 3. Storage & session matrix (KM-1/KM-6/KM-7)

| Item | Store | Survives uninstall | Ghi chú |
| --- | --- | --- | --- |
| access token | memory (session-store) | — | Không bao giờ disk/log. |
| refresh token | SecureStore `cu.refresh` | iOS: có (Keychain) | `WHEN_UNLOCKED_THIS_DEVICE_ONLY`. |
| install marker | SecureStore `cu.install` | iOS: có | `{appInstanceId, createdAt}`. |
| sandbox marker | AsyncStorage `installMarker` | không | Mismatch/missing → wipe `cu.refresh` + regen cả hai (KM-1). |
| query cache | memory Map `${accountId}:${key}` | — | Wipe trên sign-out. |
| academic data | **never persisted** | — | Điểm/transcript/file không ghi disk. |

Disk whitelist đóng: `cu.refresh` + `cu.install` + `installMarker` — mọi key
khác bị cấm (grep-ban trong test).

## 4. Platform/build evidence

| Item | Android | iOS | Evidence |
| --- | --- | --- | --- |
| Route tree + guards | verified (typecheck+tests) | verified (typecheck+tests) | `npm test` 51/51, `tsc` clean |
| OIDC PKCE code path | verified (unit: store/oidc pure) | verified (unit) | session-storage 12/12 |
| Interactive authorize→callback | **BLOCKED_CAPABILITY** | **BLOCKED_CAPABILITY** | Cần dev-client build trên thiết bị/emulator — Expo Go không satisfy `campuscore://auth/callback` exact redirect (mobile-policy §2). |
| SecureStore/Keychain runtime | **BLOCKED_CAPABILITY** | **BLOCKED_CAPABILITY** | Cần native build; unit mirror đã verify semantics. |
| Dev issuer `10.0.2.2:4010` | documented | LAN IP | `EXPO_PUBLIC_ISSUER_URL` mandatory khi host diverge (KM-2). |
| EAS build/signing | **BLOCKED_CAPABILITY** | **BLOCKED_CAPABILITY** | `eas.json` profile tạo ở P07e; account/credentials chưa cung cấp. |
| Store publication | **BLOCKED_CAPABILITY** | **BLOCKED_CAPABILITY** | Không được authorize. |

## 5. Query lifecycle states (§5)

Mọi data screen (student, thesis workspace, lecturer) chạy qua
`useScreenQuery` (`src/hooks/`): mount fetch → focus refetch
(`useFocusEffect`) → foreground refetch (`AppState`) → SWR từ per-account
cache → bounded retry (1 lần qua refresh lane — không loop; `reload` chỉ
depend `[cacheKey, enabled]`). States: `loading` / `error`+retry / `empty`
qua `StatePanel`; 403 → denied panel kể cả khi có cache; revalidation lỗi
trên data cũ → `DataNotice` banner (offline-stale, connectivity qua
`expo-network` + fetch-failure fallback). `useLiveResource` trong
StudentScreens là wrapper tương thích trên cùng hook.

## 6. Legacy-compat note

`src/App.tsx`/`index.ts` đã thay bằng `expo-router/entry` + `app/` tree.
`src/navigation/MobileNavigator.tsx` giữ lại như compat spec (tests đọc
nó); sign-out path của nó cũng gọi `sessionStore.signOut()` +
`clearQueryCache()` — một logout-ordering authority (KM-6).
