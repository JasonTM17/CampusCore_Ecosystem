# Geofenced attendance — privacy and data-safety notes

Status: draft for owner review (2026-10-29). Every claim below cites the file it
was verified in. This file is documentation only; it is not a privacy policy,
not a store submission, and no legal text derived from it may be published
without owner approval (`attendance-geofence-spec.md:92`).

Path abbreviations used below:

- `attendance/` — `java-services/restful-api/src/main/java/io/campuscore/restfulapi/attendance/`
- `V144` — `java-services/restful-api/src/main/resources/db/migration/V144__attendance_geofence.sql`
- `domain-contracts.md` — `contracts/ecosystem/domain-contracts.md`
- `app.json` — `mobile/app.json`
- `mobile-policy.md`, `baseline.md`, `environment.md`,
  `attendance-geofence-spec.md` — under `docs/ecosystem/`
- `location-service.ts`, `installation-id.ts`, `attendance-api.ts`,
  `checkin-machine.ts` — under `mobile/src/attendance-checkin/`
- `checkin-messages.ts` — `mobile/src/i18n/checkin-messages.ts`

## 1. Purpose and legal basis

- Purpose: verify that the signed-in student is physically inside an approved
  campus area while an attendance window is open. One position fix is taken per
  check-in attempt. There is no tracking purpose, no profiling, no other use
  implemented (`attendance-geofence-spec.md:7`, `mobile/src/attendance-checkin/location-service.ts:119`).
- Non-goals declared in the spec: background location, continuous tracking,
  face recognition, web check-in, Play Integrity attestation (Phase 2)
  (`attendance-geofence-spec.md:9`).
- The spec names Vietnamese Decree 13/2023 and selects consent (versioned
  notice, recorded) as the intended lawful basis
  (`attendance-geofence-spec.md:92`). The confirmed legal basis, the data
  controller identity, and the contact point are **OWNER DECISION**.

## 2. Data inventory (as implemented)

Storage is Postgres, schema `academic` (`db/migration/V144__attendance_geofence.sql`).
Retention is driven by `AttendanceRetentionJob` (`attendance/AttendanceRetentionJob.java:24-28`):

- Cron `attendance.checkin.retention-cron`, default `0 23 3 * * *`, zone
  `Asia/Ho_Chi_Minh` — runs nightly at 03:23; job enabled by default via
  `attendance.checkin.jobs-enabled` (`AttendanceRetentionJob.java:16,24`;
  `contracts/ecosystem/domain-contracts.md:21`).
- `attendance.checkin.coordinate-retention-days`, default `30`
  (`AttendanceCheckinProperties.java:13`; `domain-contracts.md:19`): `lat`/`lng`
  are set NULL for check-ins whose session `attendanceDate` is older than 30
  days (`AttendanceStore.java:187-192`). Other check-in columns stay.
- `attendance.checkin.attempt-retention-days`, default `90`
  (`AttendanceCheckinProperties.java:14`; `domain-contracts.md:20`): attempt-log
  rows older than 90 days are hard-deleted (`AttendanceStore.java:193-195`).

| Field | Synthetic example | Where stored | Purpose | Retention | Who can read (role) | Leaves the system? |
| --- | --- | --- | --- | --- | --- | --- |
| Check-in coordinates `lat`/`lng` | `10.85` / `106.77` | `AttendanceCheckin."lat"/"lng"` (V144:49-50) | Server-side geofence verdict | Nulled 30 days after session date | **No API role** — never returned in any DTO (`AttendanceDtos.java:36-40`; `domain-contracts.md:13`); direct DB access only | No |
| `distanceMeters` | `412.3` | `AttendanceCheckin."distanceMeters"` | Decision evidence shown to reviewer | No implemented expiry | LECTURER of that section, ADMIN, SUPER_ADMIN | No |
| `accuracyMeters` | `18.0` | `AttendanceCheckin."accuracyMeters"` | LOW_ACCURACY rule input | No implemented expiry | LECTURER (own section), ADMIN, SUPER_ADMIN | No |
| `mockProvider` | `false` | `AttendanceCheckin."mockProvider"` | Risk signal | No implemented expiry | LECTURER (own section), ADMIN, SUPER_ADMIN | No |
| `decision`, `reason` | `PENDING_REVIEW`, `BORDERLINE` | `AttendanceCheckin."decision"/"reason"` | Verdict + review queue | No implemented expiry | LECTURER (own section), ADMIN, SUPER_ADMIN | No |
| `capturedAt`, `createdAt`, `reviewedBy`, `reviewedAt`, `reviewNote` | timestamps / `GV001` | `AttendanceCheckin` columns (V144:52-56) | Fix freshness check, review audit | No implemented expiry | LECTURER (own section), ADMIN, SUPER_ADMIN | No |
| `deviceHash` | `9f2c…` (64 hex) | `AttendanceCheckin."deviceHash"` CHAR(64) | Shared-device detection | No implemented expiry | **No API role** — never returned (`AttendanceDtos.java:36-40`) | No |
| `ipHash` | `a41b…` (64 hex) | `AttendanceCheckinAttempt."ipHash"` CHAR(64) | Rate limit + abuse audit (`CheckinService.java:135-140`) | Deleted after 90 days | **No API role** | No |
| `requestHash` | `77e0…` (64 hex) | `AttendanceCheckinAttempt."requestHash"` CHAR(64) | Replay/single-use detection (`CheckinService.java:86-88`) | Deleted after 90 days | **No API role** | No |
| `outcome`, `reason`, `studentId`, `requestedSessionId`, `createdAt` | `BAD_CODE` | `AttendanceCheckinAttempt` (V144:63-73) | Audit of every attempt, incl. wrong-session and replayed requests | Deleted after 90 days | **No API role** | No |
| `studentId` | `SV0001` | `AttendanceCheckin."studentId"`, `AttendanceCheckinAttempt."studentId"`, `AttendanceLocationConsent."studentId"` | Identity of checker / consent subject | Check-in/attempt rows as above; consent row until replaced | LECTURER (own section) sees studentId in check-in list; student sees own consent | No |
| Consent `version` + `acceptedAt` | `1` | `AttendanceLocationConsent` (V144:77-81) | Proof the notice was accepted | Latest row only — re-accept deletes the previous row (`AttendanceStore.java:166-169`) | The student, own row only (`GET /attendance/location-consent`) | No |
| `codeSecret` | ciphertext | `AttendanceSession."codeSecret"` TEXT | Derive the 6-digit rotating code | Kept with the session row; no purge implemented | **Nobody** — encrypted with `attendance.checkin.encryption-key` (`CodeService.java:28-31,59-64`; `domain-contracts.md:16`); only the derived 6-digit code is returned, to LECTURER/ADMIN while OPEN, `Cache-Control: no-store` (`AttendanceSessionController.java:45-50`) | No |
| Installation UUID (client) | `3f6c9d…` UUID v4 | Device SecureStore key `cu.attendance.installation` (`installation-id.ts:3,30-37`) | Device binding | Until app data cleared or reinstall (OS-controlled) | Sent to the backend, which stores only `SHA-256(pepper ‖ "device" ‖ id)` (`CheckinService.java:84`; `RiskEvaluator.java:20-28`) | Sent to own backend over HTTPS only |
| 6-digit check-in code | `482916` | **Not stored anywhere** | In-room proof | n/a — code is derived per 30 s step, compared in memory, never persisted or logged (`attendance-geofence-spec.md:31`; `CodeService.java:38-45`) | Lecturer sees current code while session OPEN | No |
| Client IP (raw) | `192.0.2.4` | **Not persisted** | Rate limiting, audit | Transient in request handling; only `SHA-256(pepper ‖ "ip" ‖ ip)` is stored (`CheckinService.java:53`; `RiskEvaluator.java:20-28`) | **No API role** | No |

Notes on the inventory:

- Coordinates are persisted only for check-ins that reach the store
  (`ACCEPTED` or `PENDING_REVIEW`); verifier-rejected requests land in the
  attempt log only and never persist coordinates (`CheckinService.java:90-91,
  105-112`; the attempt table has no coordinate columns, V144:63-73).
- Review actions write an internal admin audit record holding the coordinate-free
  `CheckinView` before/after (`CheckinService.java:162`; `AttendanceDtos.java:38-40`).
- No third party receives this data: the mobile dependency set contains no
  analytics, ads, or crash-tracking SDK (verified `mobile/package.json`
  dependencies — expo-*, react-native, navigation only); the backend writes
  only to `academic` tables and the internal admin audit.

## 3. What is NOT collected (verified)

- **Background location** — `mobile/app.json:72-77` sets
  `locationAlwaysAndWhenInUsePermission:false`, `locationAlwaysPermission:false`,
  `isIosBackgroundLocationEnabled:false`, `isAndroidBackgroundLocationEnabled:false`,
  `isAndroidForegroundServiceEnabled:false`. The app calls only
  `getForegroundPermissionsAsync`/`requestForegroundPermissionsAsync`
  (`location-service.ts:115-116`).
- **Continuous tracking** — one `getCurrentPositionAsync` call per check-in
  attempt (`location-service.ts:119`); no watch/subscribe API is used anywhere in
  `mobile/src/attendance-checkin/`.
- **Motion/activity recognition** — `isAndroidMotionActivityEnabled:false`,
  `motionUsagePermission:false` (`app.json:74,78`).
- **Contacts, photos, advertising ID** — no contacts, media-library, ads or
  tracking dependency in `mobile/package.json`; no `android.permissions` array
  requesting them in `app.json`.
- **Raw IP, raw installation ID, raw coordinates in logs, and the code value** —
  only peppered SHA-256 pseudonyms are persisted (`RiskEvaluator.java:20-28`);
  `CheckinRequest.toString()` returns `"CheckinRequest[redacted]"`
  (`AttendanceDtos.java:32`); the attempt log has no code column.
- Other personal data the check-in payload carries: only `code`, `latitude`,
  `longitude`, `accuracyMeters`, `capturedAt`, `mockProvider`,
  `installationId`, optional `nonce` (`AttendanceDtos.java:25-31`;
  `attendance-api.ts:9-12,197-201`).

## 4. Consent versioning (as implemented)

- Required version: `attendance.checkin.consent-version`, default `1`
  (`AttendanceCheckinProperties.java:12`; `domain-contracts.md:18`).
- `GET /attendance/location-consent` (STUDENT) returns `{accepted, version,
  acceptedVersion, acceptedAt}` where `version` is always the *currently
  required* version so an outdated client learns what to show
  (`AttendanceStore.java:159-165`; `AttendanceDtos.java:46-50`).
- `POST /attendance/location-consent {version}` accepts **only** the current
  required version; anything else → `400 INVALID_CONSENT_VERSION`
  (`CheckinService.java:168-170`).
- Check-in without a current consent → `403 CONSENT_REQUIRED`
  (`CheckinService.java:68`).
- When the owner bumps `consent-version`, stored `acceptedVersion` no longer
  matches → `accepted=false` → next check-in is refused → the app re-shows the
  notice for the new version (`checkin-machine.ts:77-83,99-103`). Only the
  newest accepted row is kept (DELETE + INSERT, `AttendanceStore.java:166-169`).
- The student sees: notice title, the version number, three statements (read
  once, kept 30 days, attendance-only) and Accept/Decline — strings in
  `mobile/src/i18n/checkin-messages.ts:17-23` (vi) and `102-108` (en).
- Decline handling: a `consentDecline` label exists; a server-side withdrawal
  endpoint does **not** exist — see §8.

## 5. Student-facing notice (in-app consent text)

The strings below already ship in `mobile/src/i18n/checkin-messages.ts`
(verified, quoted verbatim — not a proposal).

Notice 1 — consent screen (`checkin-messages.ts:17-23` / `:102-108`):

- vi: «Cho phép dùng vị trí» — «Thông báo phiên bản {version}» —
  «Vị trí chỉ được đọc một lần tại thời điểm điểm danh.» —
  «Vị trí được giữ 30 ngày.» —
  «Vị trí chỉ dùng để xác minh bạn có mặt tại lớp.» — «Đồng ý» / «Từ chối»
- en: «Location consent» — «Notice version {version}» —
  «Your position is read once at the moment of check-in.» —
  «Your position is kept for 30 days.» —
  «It is used only to verify your presence in class.» — «Accept» / «Decline»

Notice 2 — OS permission rationale (`mobile/app.json:71`, and iOS
`NSLocationWhenInUseUsageDescription` at `app.json:15`):

- vi+en (single bilingual string, as configured):
  «CampusUTE sử dụng vị trí một lần khi bạn điểm danh để xác minh bạn có mặt
  tại lớp. CampusUTE uses your location once when you check in to verify class
  attendance.»

## 6. Lecturer and admin duties

- **Flagged review.** `GET /attendance/sessions/{id}/checkins` lists check-ins
  including `PENDING_REVIEW` rows; `POST /attendance/checkins/{id}/review`
  with `{decision: APPROVE|REJECT, note}` (note is required,
  `AttendanceDtos.java:42-43`) finalises them (`AttendanceSessionController.java:57-68`;
  `CheckinService.java:146-164`). Signals that produce `PENDING_REVIEW`:
  `BORDERLINE`, `MOCK_PROVIDER`, `SHARED_DEVICE`, `ZERO_ACCURACY`,
  `IDENTICAL_COORDINATES`, `IMPOSSIBLE_SPEED` (`RiskEvaluator.java:30-42`;
  `GeofenceVerifier.java:27`). Every review is written to the admin audit log
  (`CheckinService.java:162`).
- **Section scoping, verified.** Every lecturer-facing endpoint calls
  `SessionService.authorize`, which requires ADMIN/SUPER_ADMIN *or* that
  `isSectionOwnedByLecturer(section, lecturerId)` holds, re-checked under the
  section lock (`SessionService.java:33-38,90,148-152`). A lecturer cannot list
  or review another section's check-ins.
- **Lecturers do NOT see coordinates.** `CheckinView` deliberately omits
  `lat`/`lng`, `deviceHash` and IP data (`AttendanceDtos.java:36-40`;
  `domain-contracts.md:13`); lecturers see `distanceMeters`, `accuracyMeters`,
  `mockProvider`, decision and reason only.
- **Admin duties.** Geofence CRUD under `/api/v1/admin/attendance/geofences`
  (ADMIN/SUPER_ADMIN only, `AttendanceGeofenceController.java:21-40`); radius
  must be 30–1000 m and coordinates in range (`GeofenceService.java:28-29`);
  deactivation via `isActive=false` — there is deliberately no delete route
  (`GeofenceService.java:39`). The seeded campus geofence is `isActive=false`
  and must be verified before enabling (`V144:84-88`).
- **Expiry.** Coordinates expire automatically (nulled after 30 days); attempt
  rows are deleted after 90 days — see §2 for exact constants. The remaining
  check-in columns (`decision`, `distanceMeters`, `deviceHash`, review fields)
  have **no implemented deletion** and persist with the row.
- **Data-subject requests.** Existing student endpoints: `GET
  /attendance/location-consent` (own consent state) and `GET
  /attendance/sessions/open` (own open sessions). Endpoints for a student to
  export or erase their own check-in/attempt/consent records: **NOT
  IMPLEMENTED**. Note `AttendanceCheckin."studentId"` references `Student`
  without a cascade (V144:43), so a hard student delete while check-in rows
  exist is blocked at the FK level — end-to-end erasure flow is **NOT
  VERIFIED**. Until endpoints exist, access/erasure requests are answered by
  an admin querying Postgres directly — owner decision on the process.

## 7. Google Play Data safety form — DRAFT

Draft only, to help the owner fill the form — **not a submission**. Store
publication is not authorised in this phase (`mobile-policy.md:375`;
`baseline.md:99`). Cells needing the owner are marked **OWNER DECISION**.

| Data type | Collected? | Shared? | Ephemeral? | Required / optional | Purpose | Encrypted in transit | Deletion |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Location — precise | Yes — one foreground fix per check-in (`location-service.ts:115-119`) | No | No — stored ≤30 days | Required for the check-in feature; feature itself optional — **OWNER DECISION** | App functionality (attendance verification) | Yes — HTTPS (`attendance-geofence-spec.md:115`; `environment.md:48,95`) | Auto-nulled after 30 days; self-service deletion **NOT IMPLEMENTED** — **OWNER DECISION** |
| Location — approximate | Not separately collected (the single fix is precise) | No | n/a | n/a | n/a | n/a | n/a |
| Personal info — user IDs | Yes — `studentId`/account identity from the JWT | No | No | Required — **OWNER DECISION** | App functionality, account management | Yes | No self-service endpoint — **OWNER DECISION** |
| Device or other IDs | Yes — random installation UUID v4, stored server-side as a peppered SHA-256 hash (`installation-id.ts:15-18`; `RiskEvaluator.java:20-28`) | No | No — hash kept with the check-in row | Required — **OWNER DECISION** | Fraud prevention (shared-device signal) | Yes | On-device id clears on reinstall/data-wipe; server hash has no purge — **OWNER DECISION** |
| App activity — check-in attempts/outcomes | Yes — `AttendanceCheckinAttempt` audit rows | No | No — kept 90 days | Required — **OWNER DECISION** | Security/audit | Yes | Auto-deleted after 90 days |

Also on the form: **privacy policy URL** — no URL exists in the repository;
**NOT VERIFIED / OWNER DECISION**.

## 8. Open decisions for the owner

1. Retention periods — confirm `30` days coordinates / `90` days attempt log
   with the school's data-protection officer
   (`attendance-geofence-spec.md:113`; constants in
   `AttendanceCheckinProperties.java:13-14`).
2. Legal basis — the spec selects consent under Decree 13/2023
   (`attendance-geofence-spec.md:92`); final legal basis is unconfirmed.
3. Data controller identity and contact for data-subject requests —
   **NOT VERIFIED** anywhere in the repository.
4. Whether lecturers should ever see raw coordinates — current implementation
   shows distance only (§6); changing that is an owner decision.
5. Whether rejected attempts should be kept the full 90 days — the attempt
   log currently retains all outcomes (accepted, rejected, replayed,
   invalid) identically for 90 days (`AttendanceStore.java:170-177,193-195`).
6. Play Integrity attestation (Phase 2) — declared out of scope, needs Google
   configuration, `BLOCKED_HUMAN` (`attendance-geofence-spec.md:9,116`).
7. Store privacy policy URL and publisher/contact details for the listing —
   none exist in the repository.
8. Consent withdrawal — the UI has a Decline label but there is no
   server-side withdraw/revoke endpoint (**NOT IMPLEMENTED**); owner decision
   whether declining should purge stored consent/location data.
9. Student self-service access and erasure endpoints for check-in data —
   **NOT IMPLEMENTED** (§6); owner decision on scope and deadline handling.
