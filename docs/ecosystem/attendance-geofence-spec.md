# Geofenced student check-in for attendance — design and task breakdown

Status: proposed (2026-10-29). Owner: product owner. Written contract-first: workers implement against this file; changes to it go through the Lead.

## 1. Outcome

A student can mark themselves present for a class only when all of these hold: they are signed in as themselves, enrolled in that section, the lecturer has opened a check-in window, they present the short-lived code shown in the classroom, and the phone reports a position inside an approved campus area. A link, QR image or screenshot passed to a classmate at home must not be enough.

Non-goals (this release): background location, continuous tracking, face recognition, web-browser student check-in, Play Integrity attestation (Phase 2, needs Google configuration), replacing lecturer-recorded attendance (it stays; the lecturer can always override).

## 2. Threat model

| Threat | Control |
| --- | --- |
| Link or QR forwarded to someone not in class | Rotating code (§3.2) shown only in the room + geofence + own authenticated session; a link carries no authority |
| Student at home checks in | Server-side geofence check (§3.3) |
| Fake GPS app | Mock-provider flag, impossible-jump check, accuracy rule, review queue (§3.5); not preventable on a rooted device, hence Phase 2 attestation |
| One phone used for several students | Device binding: one check-in per installation per session (§3.4) |
| Replay of a captured request | Single-use nonce, session window, code step expiry, idempotency per (session, student) |
| Brute-forcing the code | 6 digits plus attempt limits per student and per session, lockout with audit (§3.6) |
| Lecturer cannot trust results | Every check-in stores decision and reason; lecturer can approve or reject flagged ones |

Residual risk (state it in the report to the owner): a determined student with a rooted phone and a spoofing tool who knows the code from a friend in the room can still pass; the design raises the cost, creates evidence, and routes doubtful cases to review.

## 3. Rules

### 3.1 Session
A lecturer (or admin) opens an attendance session for one section and one campus calendar day (Asia/Ho_Chi_Minh), with `opensAt`, `closesAt` (default 15 minutes, max 60), `lateAfterMinutes` (default 10), a geofence (campus, building or custom) and `requireCode` (default true). At most one OPEN session per (section, day, slot). Closing is explicit or by time.

### 3.2 Rotating code
Server-held secret per session. Code = 6 digits derived from HMAC-SHA256(secret, floor(now/30s)); accept the current and previous step. The lecturer app/web fetches the current code and shows it large (projector mode) refreshing every 30 s. The secret never leaves the server; the code is not stored.

### 3.3 Geofence verification (server-side, never trust a client verdict)
Inputs: latitude, longitude, horizontal accuracy in metres, client timestamp, `mockProvider` flag.
- Reject malformed or out-of-range coordinates and timestamps older than 60 s or in the future by more than 10 s.
- Distance d = haversine(point, geofence centre). Geofence = circle (centre, radius metres; default 150, min 30, max 1000). Polygon is out of scope.
- accuracy > 100 m: `LOW_ACCURACY` (ask the student to retry outdoors/near a window).
- d - accuracy > radius: `OUTSIDE_AREA` (reject).
- d <= radius and accuracy <= 50 m: inside (accept path).
- otherwise (borderline): accept as `PENDING_REVIEW` with reason `BORDERLINE`.
All decisions and reasons are stored.

### 3.4 Device binding
Client sends a random installation id generated at first launch (not a hardware id), stored hashed (SHA-256 with a server pepper). Rules: one accepted check-in per installation per session; the same installation checking in two different students in one session flags both `PENDING_REVIEW` reason `SHARED_DEVICE`.

### 3.5 Risk signals (advisory, produce PENDING_REVIEW, never silent accept)
`mockProvider=true`; speed between this and the student's previous check-in position implies > 150 km/h; coordinates with suspiciously perfect repetition across students (identical to 5 decimals in one session by more than 3 students); accuracy exactly 0.

### 3.6 Limits and audit
Rate limit: 5 attempts per student per session per 10 minutes and 30 attempts per session per minute per IP (reuse the existing rate-limit infrastructure under security/ratelimit). Every attempt (accepted or not) is recorded in the attempt log with decision, reason and a hashed IP; never log the code value.

### 3.7 Result to attendance
ACCEPTED inside window and before `lateAfterMinutes` -> attendance status PRESENT; after it -> LATE (use the exact status strings already accepted by the existing attendance write service; read AcademicAttendanceWriteService first and reuse its validation and the unique key (studentId, sectionId, date)). PENDING_REVIEW writes nothing until the lecturer approves (then PRESENT/LATE as of the check-in time) or rejects (ABSENT left as is, note recorded). A lecturer's manual entry always wins over a student check-in and cannot be overwritten by one.

## 4. Data model (Flyway V144+, schema academic, camelCase quoted columns like V8; read the newest migrations for conventions)
- `AttendanceGeofence`(id, name, campusCode, centerLat numeric(9,6), centerLng numeric(9,6), radiusMeters int, isActive, createdBy, createdAt, updatedAt). Seed ONE row for the main HCM-UTE campus (Vo Van Ngan, Thu Duc) with isActive=false and a note that an admin must verify the coordinates and radius in the admin console before enabling; never ship unverified coordinates enabled.
- `AttendanceSession`(id, sectionId, attendanceDate, geofenceId, opensAt, closesAt, lateAfterMinutes, requireCode, status OPEN|CLOSED, codeSecret (encrypted or at least not exposed), openedBy, closedAt, createdAt) with the one-open-session constraint.
- `AttendanceCheckin`(id, sessionId, studentId, deviceHash, decision ACCEPTED|PENDING_REVIEW|REJECTED, reason, distanceMeters, accuracyMeters, lat/lng (nullable, nulled after retention), mockProvider bool, capturedAt, createdAt, reviewedBy, reviewedAt, reviewNote) unique (sessionId, studentId) for accepted/pending.
- `AttendanceCheckinAttempt`(id, sessionId, studentId, outcome, reason, ipHash, createdAt) — no code, no coordinates.
- Retention: coordinates in AttendanceCheckin are nulled 30 days after the session date by a scheduled job (use the project's existing scheduler pattern); distance, decision and reason stay. Attempt log kept 90 days.
- Consent: `AttendanceLocationConsent`(studentId, version, acceptedAt) recorded when the student accepts the in-app location notice; check-in is refused without it (`CONSENT_REQUIRED`).

## 5. API (paths under /api/v1; add to the OpenAPI so web and mobile types regenerate; roles from the JWT, never from the body)

Lecturer/admin (ROLE LECTURER of the section, ADMIN, SUPER_ADMIN):
- `POST /attendance/sessions` body {sectionId, date, opensAt?, closesAt?, lateAfterMinutes?, geofenceId, requireCode?} -> 201 session
- `GET /attendance/sessions/{id}` -> session + counts (accepted, pending, rejected, enrolled)
- `GET /attendance/sessions/{id}/code` -> {code, expiresAt, stepSeconds} (only while OPEN; no-store)
- `POST /attendance/sessions/{id}/close`
- `GET /attendance/sessions/{id}/checkins` -> list incl. flagged; `POST /attendance/checkins/{id}/review` body {decision: APPROVE|REJECT, note}
Student (ROLE STUDENT, must be enrolled):
- `GET /attendance/sessions/open` -> open sessions for my sections today (id, section label, closesAt, requireCode, geofence name; never the centre/radius)
- `POST /attendance/sessions/{id}/checkin` body {code?, latitude, longitude, accuracyMeters, capturedAt, mockProvider, installationId} -> 200 {decision, status, message}; errors: 400 INVALID_LOCATION, 403 NOT_ENROLLED, 403 CONSENT_REQUIRED, 409 ALREADY_CHECKED_IN, 410 SESSION_CLOSED, 422 BAD_CODE, 422 OUTSIDE_AREA, 422 LOW_ACCURACY, 429 TOO_MANY_ATTEMPTS. Error bodies use the project's existing error contract.
- `POST /attendance/location-consent` body {version}; `GET /attendance/location-consent`
Admin:
- `GET/POST/PUT /admin/attendance/geofences` (CRUD, validation of ranges, audit); deactivate instead of delete when sessions reference it.
Rules: server rejects check-in when the geofence is inactive; all inputs validated (bean validation); authorization on every method explicit (@PreAuthorize); responses never include the code secret or other students' coordinates.

## 6. Mobile (Expo)
- Dependency: `expo-location` via `npx expo install` (needs a native rebuild; foreground permission only: Android ACCESS_FINE_LOCATION + ACCESS_COARSE_LOCATION; no background permission, no foreground service). Add the iOS usage string for completeness.
- Student "Check in" screen (route `attendance.checkin`, lane-gated like other lanes, reachable from the attendance screen and a dashboard card when an open session exists): consent notice (first time, versioned, vi+en, states exactly what is collected: position once at the moment of check-in, kept 30 days, used only to verify presence), session card, code input (6 digits, numeric keypad, paste allowed), "Check in" button -> request permission -> get a fresh high-accuracy fix (timeout 15 s; use `Location.getCurrentPositionAsync` with accuracy High, reject cached fixes older than 30 s) -> send. States: permission denied (explain + open settings), GPS off, low accuracy (retry with tips), outside area (show distance band only, e.g. "about 1.2 km away", never the geofence centre), wrong code, success (status PRESENT/LATE or "waiting for lecturer review"), already checked in, session closed, offline (do not queue: check-in must be live), rate-limited.
- Send `mockProvider` from the location object's `mocked` field (Android); generate the installation id once (random UUID in SecureStore).
- Lecturer: in the attendance screen add "Open check-in" (choose geofence, window), a projector-style large rotating code view (refreshes every 30 s, keep-awake while open), live counters, close button, flagged list with approve/reject. Preview mode uses sample data labelled by the preview pill.
- All strings vi+en in message files, testIDs prefixed `checkin-`, accessibility roles/labels, light/dark, font 1.5, tablet.

## 7. Web
- Lecturer attendance page: "Open check-in" panel, projector view (big code + QR of the app deep link only for convenience; the code is still required), live counts, flagged review table.
- Admin: geofence management page (name, centre latitude/longitude with a "pick on map" helper using an external map link or an embedded OpenStreetMap preview without a new heavy dependency, radius, active), campus list, audit of changes.
- Student attendance page: show check-in method and review state per day.

## 8. Privacy and compliance
Location is personal data under Vietnamese Decree 13/2023: lawful basis = consent (versioned notice, recorded), purpose limitation (attendance only), minimisation (one fix at check-in), retention (30 days for coordinates), access/erasure on request. Update the Data safety draft and privacy text inputs (docs) when this ships; do not publish legal text without the owner's approval.

## 9. Tasks

| Id | Task | Worker class | Owns (disjoint) | Depends on |
| --- | --- | --- | --- | --- |
| G1 | Backend: migration, services, controllers, rate limit, audit, retention job, OpenAPI, unit tests, Postgres integration tests (NOT_RUN if no Docker) | HARD (Codex gpt-6.1-sol high) | java-services/restful-api/**, contracts/ecosystem/openapi.json (additive paths only) | this spec |
| G2 | Regenerate typed clients and mobile/web API wrappers (additive) | STANDARD | frontend/src/types/generated-api.ts, frontend/src/lib/api.ts additions, mobile/src/api/generated-api.ts, mobile/src/api/client.ts additions | G1 contract |
| G3 | Mobile student check-in flow + consent + states + tests | STANDARD (Luna) | mobile/src/screens/attendance-checkin/**, route-map/lane flag, messages, expo-location install | G2, no other mobile worker active |
| G4 | Mobile lecturer open/close/projector/review | STANDARD | mobile/src/screens/operations/** attendance files, messages | G2, G3 shared messages: serialise |
| G5 | Web lecturer panel + admin geofence console + student status | STANDARD | frontend/src/app/**/attendance, admin/attendance-geofences, i18n | G2 |
| G6 | Adversarial security review of G1..G5 (read-only) and abuse-case tests | HARD | tests only | G1..G5 |
| G7 | Privacy/data-safety/docs/runbook updates and demo seed policy | FLASH or FREE | docs/** | G1, G3 |
| G8 | Real-device test of check-in inside/outside (field test at campus) | HUMAN + HARD worker | evidence | G3, G4 |

Waves: G1 -> G2 -> (G3, G5 in parallel, different trees) -> G4 -> G6 -> G7 -> G8. Mobile native rebuild once after G3 (expo-location).

## 10. Defaults chosen (owner may change) and open decisions
- Student check-in is mobile-only (a browser's geolocation is trivially spoofable and shareable links are the very problem).
- Geofence = circle per campus/building, radius default 150 m, editable by admin; seeded campus entry disabled until verified. Owner decision needed: which campuses/buildings and exact coordinates (the real centres and radii must come from the school).
- Code step 30 s, accepted current+previous; session default 15 min, max 60.
- Coordinates kept 30 days. Owner decision: confirm the retention period with the school's data-protection officer.
- Mock-location and shared-device signals send the check-in to lecturer review instead of rejecting. Owner decision (2026-10-29): keep manual review, do not reject outright.
- Residual risk: coordinates travel over plain HTTPS JSON, so a determined attacker can fabricate a fix. Exploiting that still requires a valid student account, active enrolment in the section, the in-room rotating code, and a forged request body. Mitigations present: the rotating code is only visible in the room, per-student/per-session rate limits, shared-device and impossible-speed signals, lecturer review of every flagged check-in, and full audit of attempts and reviews. Device attestation (Play Integrity / App Attest) is Phase 2 and is intentionally not part of this release.
- Phase 2: Play Integrity attestation (needs a Google Cloud project and Play console, BLOCKED_HUMAN).
