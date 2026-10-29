const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

async function loadCheckinLib() {
  const source = read('src/lib/attendance-checkin.ts');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: 'attendance-checkin.ts',
  });
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
}

const VALID_ID = '9f2c1b7a-3d4e-4a5f-8b6c-0d1e2f3a4b5c';
const SEEDED_ROW = {
  id: 'ute-main-placeholder',
  name: 'HCM-UTE Vo Van Ngan (UNVERIFIED PLACEHOLDER)',
  campusCode: 'UTE-MAIN',
  centerLat: 10.8506,
  centerLng: 106.7719,
  radiusMeters: 150,
  isActive: false,
  note: 'APPROXIMATE seeded coordinates — verify before activation',
};

test('session id validation accepts opaque backend ids and rejects traversal/injection', async () => {
  const { isValidAttendanceSessionId } = await loadCheckinLib();
  assert.equal(isValidAttendanceSessionId(VALID_ID), true);
  assert.equal(isValidAttendanceSessionId('sess_abc123'), true);
  assert.equal(isValidAttendanceSessionId('ABCDEF'), true);

  assert.equal(isValidAttendanceSessionId(''), false);
  assert.equal(isValidAttendanceSessionId('abc'), false, 'below the 6-char floor');
  assert.equal(isValidAttendanceSessionId('..'), false);
  assert.equal(isValidAttendanceSessionId('../admin'), false);
  assert.equal(isValidAttendanceSessionId('a/b'), false);
  assert.equal(isValidAttendanceSessionId(`${VALID_ID}?code=123456`), false);
  assert.equal(isValidAttendanceSessionId(`${VALID_ID}#frag`), false);
  assert.equal(isValidAttendanceSessionId('with space123'), false);
  assert.equal(isValidAttendanceSessionId('điểm-danh-01'), false);
  assert.equal(isValidAttendanceSessionId('x'.repeat(129)), false, 'above the 128-char ceiling');
  assert.equal(isValidAttendanceSessionId(null), false);
  assert.equal(isValidAttendanceSessionId(undefined), false);
  assert.equal(isValidAttendanceSessionId(123), false);
});

test('link builder carries the session id and can never carry the rotating code', async () => {
  const {
    buildCheckinLandingPath,
    buildCheckinShareUrl,
    buildCheckinDeepLink,
  } = await loadCheckinLib();

  const landingPath = buildCheckinLandingPath(VALID_ID);
  assert.equal(landingPath, `/attendance/checkin/${VALID_ID}`);
  assert.equal(buildCheckinLandingPath('../x'), null);

  // The API accepts only a session id — there is no code parameter at all,
  // so a share/deep link cannot leak the rotating code by construction.
  const share = buildCheckinShareUrl('https://portal.example.edu', `/en${landingPath}`);
  assert.equal(share, `https://portal.example.edu/en/attendance/checkin/${VALID_ID}`);
  assert.ok(!/[?#]/.test(share), 'share URL must be a bare path, no query or hash');
  assert.ok(!/code/i.test(share), 'share URL must not contain the code word/param');
  assert.equal((share.match(/9f2c1b7a/g) ?? []).length, 1, 'session id appears exactly once');

  assert.equal(buildCheckinShareUrl('https://portal.example.edu/', landingPath), `https://portal.example.edu${landingPath}`);
  assert.equal(buildCheckinShareUrl('not-a-url', landingPath), null);
  assert.equal(buildCheckinShareUrl('https://x', `${landingPath}?code=1`), null);
  assert.equal(buildCheckinShareUrl('https://x', 'javascript:alert(1)'), null);

  const deepLink = buildCheckinDeepLink(VALID_ID);
  assert.equal(deepLink, `campuscore://attendance/checkin/${VALID_ID}`);
  assert.equal(buildCheckinDeepLink('a/b'), null);
});

test('OpenStreetMap helper builds an external marker link only', async () => {
  const { buildOsmMarkerUrl } = await loadCheckinLib();
  const url = buildOsmMarkerUrl(10.8506, 106.7719);
  assert.ok(url.startsWith('https://www.openstreetmap.org/'), 'must be an external https link');
  assert.match(url, /mlat=10\.850600/);
  assert.match(url, /mlon=106\.771900/);
  assert.match(url, /#map=17\/10\.850600\/106\.771900/);
  assert.equal(buildOsmMarkerUrl(91, 0), null, 'latitude out of range');
  assert.equal(buildOsmMarkerUrl(0, 181), null, 'longitude out of range');
  assert.equal(buildOsmMarkerUrl(Number.NaN, 0), null);
});

test('campus timezone helpers keep session windows on Asia/Ho_Chi_Minh dates', async () => {
  const {
    campusTodayIso,
    campusLocalTimeToUtcIso,
    planSessionWindow,
  } = await loadCheckinLib();

  // 2025-01-01T20:30Z is already 2025-01-02 03:30 in Ho Chi Minh City.
  assert.equal(campusTodayIso(new Date('2025-01-01T20:30:00Z')), '2025-01-02');
  assert.equal(campusTodayIso(new Date('2025-01-01T16:29:00Z')), '2025-01-01');

  assert.equal(
    campusLocalTimeToUtcIso('2099-03-05', '08:30'),
    '2099-03-05T01:30:00.000Z',
    '08:30 campus time is 01:30 UTC (+07:00, no DST)',
  );
  assert.equal(campusLocalTimeToUtcIso('2099-03-05', '24:00'), null);
  assert.equal(campusLocalTimeToUtcIso('bad', '08:30'), null);

  const now = new Date('2025-06-10T02:00:00Z'); // campus today = 2025-06-10
  const sameDay = planSessionWindow(
    { date: '2025-06-10', durationMinutes: 15, lateAfterMinutes: 10 },
    now,
  );
  assert.deepEqual(sameDay.errors, {});
  assert.equal(sameDay.opensAtIso, undefined, 'same-day sessions let the server default opensAt');
  assert.equal(sameDay.closesAtIso, '2025-06-10T02:15:00.000Z');

  const pastDay = planSessionWindow(
    { date: '2025-06-09', durationMinutes: 15, lateAfterMinutes: 10 },
    now,
  );
  assert.equal(pastDay.errors.date, 'past');

  const futureNoStart = planSessionWindow(
    { date: '2025-06-11', durationMinutes: 30, lateAfterMinutes: 10 },
    now,
  );
  assert.equal(futureNoStart.errors.startTime, 'required');

  const future = planSessionWindow(
    { date: '2025-06-11', durationMinutes: 30, lateAfterMinutes: 10, startTime: '07:45' },
    now,
  );
  assert.deepEqual(future.errors, {});
  assert.equal(future.opensAtIso, '2025-06-11T00:45:00.000Z');
  assert.equal(future.closesAtIso, '2025-06-11T01:15:00.000Z');

  const tooLate = planSessionWindow(
    { date: '2025-06-10', durationMinutes: 15, lateAfterMinutes: 20 },
    now,
  );
  assert.equal(tooLate.errors.lateAfter, 'invalid', 'late-after cannot exceed the window');

  const badDuration = planSessionWindow(
    { date: '2025-06-10', durationMinutes: 90, lateAfterMinutes: 10 },
    now,
  );
  assert.equal(badDuration.errors.duration, 'invalid');
});

test('projector code rotation follows the server expiresAt', async () => {
  const { nextCodeRefreshMs } = await loadCheckinLib();
  const now = Date.parse('2025-06-10T02:00:00Z');

  // Server says the code rotates in 30s — refetch just after that boundary.
  const inThirty = nextCodeRefreshMs(
    { code: '123456', expiresAt: '2025-06-10T02:00:30Z', stepSeconds: 30 },
    now,
  );
  assert.ok(inThirty > 30_000 && inThirty <= 31_000, `expected ~30s+skew, got ${inThirty}`);

  // Missing expiresAt falls back to the step length.
  assert.equal(nextCodeRefreshMs({ code: '1', stepSeconds: 20 }, now), 20_000);
  assert.equal(nextCodeRefreshMs({ code: '1' }, now), 30_000, 'default 30s step');
  assert.equal(nextCodeRefreshMs(null, now), 30_000);

  // A boundary already passed asks for a short retry, not a busy loop.
  const missed = nextCodeRefreshMs({ expiresAt: '2025-06-10T01:59:59Z' }, now);
  assert.ok(missed >= 1_000 && missed <= 2_000);
});

test('projector rotation loop refetches at expiry under fake timers', async (t) => {
  const { nextCodeRefreshMs } = await loadCheckinLib();
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 });

  const fetches = [];
  const schedule = (code) => {
    setTimeout(() => {
      // Each tick performs a fetch whose response re-arms the timer — this is
      // the same loop the overlay effect runs.
      fetches.push(Date.now());
      schedule({ expiresAt: new Date(Date.now() + 30_000).toISOString(), stepSeconds: 30 });
    }, nextCodeRefreshMs(code, Date.now()));
  };

  schedule({ expiresAt: new Date(1_000_000 + 30_000).toISOString(), stepSeconds: 30 });
  t.mock.timers.tick(30_249);
  assert.equal(fetches.length, 0, 'no early refetch before the rotation boundary');
  t.mock.timers.tick(1);
  assert.equal(fetches.length, 1, 'one refetch right after expiresAt');
  t.mock.timers.tick(30_250);
  assert.equal(fetches.length, 2, 'the loop re-arms on each new expiresAt');
  // A timer armed inside a tick does not fire in that same tick — step
  // through each subsequent boundary explicitly.
  t.mock.timers.tick(30_250);
  assert.equal(fetches.length, 3);
  t.mock.timers.tick(30_250);
  assert.equal(fetches.length, 4);
  t.mock.timers.reset();
});

test('session polling gate honors visibility and open status', async () => {
  const { shouldPollSession, sessionSecondsLeft, splitCheckinReasons } = await loadCheckinLib();
  assert.equal(shouldPollSession('visible', 'OPEN'), true);
  assert.equal(shouldPollSession('hidden', 'OPEN'), false);
  assert.equal(shouldPollSession('visible', 'CLOSED'), false);
  assert.equal(shouldPollSession('hidden', 'CLOSED'), false);

  assert.equal(sessionSecondsLeft('2025-06-10T02:01:30Z', Date.parse('2025-06-10T02:00:00Z')), 90);
  assert.equal(sessionSecondsLeft('2025-06-10T01:00:00Z', Date.parse('2025-06-10T02:00:00Z')), 0);
  assert.equal(sessionSecondsLeft(undefined, Date.now()), null);

  assert.deepEqual(splitCheckinReasons('BORDERLINE,LOW_ACCURACY'), ['BORDERLINE', 'LOW_ACCURACY']);
  assert.deepEqual(splitCheckinReasons(' MOCK_PROVIDER , IDENTICAL_COORDINATES '), ['MOCK_PROVIDER', 'IDENTICAL_COORDINATES']);
  assert.deepEqual(splitCheckinReasons(''), []);
  assert.deepEqual(splitCheckinReasons(undefined), []);
});

test('geofence draft validation enforces ranges and decimal input', async () => {
  const { validateGeofenceDraft } = await loadCheckinLib();
  const base = {
    name: 'Main campus',
    campusCode: 'UTE-MAIN',
    centerLat: '10.850600',
    centerLng: '106.771900',
    radiusMeters: '150',
    isActive: false,
    note: '',
  };

  const ok = validateGeofenceDraft(base);
  assert.deepEqual(ok.errors, {});
  assert.deepEqual(ok.values, {
    name: 'Main campus',
    campusCode: 'UTE-MAIN',
    centerLat: 10.8506,
    centerLng: 106.7719,
    radiusMeters: 150,
    isActive: false,
  });

  const range = (patch, field) =>
    validateGeofenceDraft({ ...base, ...patch }).errors[field];

  assert.equal(range({ centerLat: '90' }, 'centerLat'), undefined);
  assert.equal(range({ centerLat: '-90' }, 'centerLat'), undefined);
  assert.equal(range({ centerLat: '90.0001' }, 'centerLat'), 'range');
  assert.equal(range({ centerLat: '-91' }, 'centerLat'), 'range');
  assert.equal(range({ centerLat: 'abc' }, 'centerLat'), 'invalid');
  assert.equal(range({ centerLat: '10,85' }, 'centerLat'), 'invalid', 'comma decimal is not allowed');
  assert.equal(range({ centerLat: '' }, 'centerLat'), 'required');
  assert.equal(range({ centerLat: '  ' }, 'centerLat'), 'required');

  assert.equal(range({ centerLng: '180' }, 'centerLng'), undefined);
  assert.equal(range({ centerLng: '-180' }, 'centerLng'), undefined);
  assert.equal(range({ centerLng: '180.5' }, 'centerLng'), 'range');
  assert.equal(range({ centerLng: '-180.5' }, 'centerLng'), 'range');

  assert.equal(range({ radiusMeters: '29' }, 'radiusMeters'), 'range');
  assert.equal(range({ radiusMeters: '30' }, 'radiusMeters'), undefined);
  assert.equal(range({ radiusMeters: '1000' }, 'radiusMeters'), undefined);
  assert.equal(range({ radiusMeters: '1001' }, 'radiusMeters'), 'range');
  assert.equal(range({ radiusMeters: '150.5' }, 'radiusMeters'), 'invalid', 'radius is int32');
  assert.equal(range({ radiusMeters: '' }, 'radiusMeters'), 'required');

  assert.equal(range({ name: '' }, 'name'), 'required');
  assert.equal(range({ name: 'x'.repeat(241) }, 'name'), 'tooLong');
  assert.equal(range({ campusCode: '' }, 'campusCode'), 'required');
  assert.equal(range({ note: 'x'.repeat(501) }, 'note'), 'tooLong');

  assert.equal(validateGeofenceDraft({ ...base, centerLat: 'bad' }).values, null);
});

test('the seeded geofence is flagged as unverified, real rows are not', async () => {
  const { isUnverifiedGeofence } = await loadCheckinLib();
  assert.equal(isUnverifiedGeofence(SEEDED_ROW), true);
  assert.equal(isUnverifiedGeofence({ name: 'HCM-UTE Vo Van Ngan', note: '', isActive: true }), false);
  assert.equal(isUnverifiedGeofence({ name: 'Campus A', note: 'APPROXIMATE pilot', isActive: false }), true);
  assert.equal(isUnverifiedGeofence({}), false);
});

test('lecturer page mounts the geofenced check-in panel behind the lecturer guard', () => {
  const page = read('src/app/dashboard/lecturer/attendance/page.tsx');
  assert.match(page, /useRequireAuth\(\s*\['LECTURER'\]\s*\)/, 'lecturer role guard must remain');
  assert.match(page, /<GeofenceCheckinPanel/, 'page must render the check-in panel');
  assert.match(page, /sectionId=\{selectedSectionId\}/, 'panel receives the selected section');
  assert.match(page, /date=\{selectedDate\}/, 'panel receives the selected date');
});

test('check-in panel never stores the code and polls only while visible', () => {
  const panel = read('src/components/lecturer/GeofenceCheckinPanel.tsx');
  const overlay = read('src/components/lecturer/ProjectorCodeOverlay.tsx');

  for (const [name, source] of [['panel', panel], ['overlay', overlay]]) {
    assert.doesNotMatch(source, /localStorage|sessionStorage/, `${name} must not persist state`);
    assert.doesNotMatch(source, /console\.(log|info|debug|warn|error)/, `${name} must not log`);
    assert.doesNotMatch(source, /navigator\.geolocation/, `${name} must not use browser geolocation`);
  }

  // The share input is built by buildCheckinLandingPath/buildCheckinShareUrl —
  // neither accepts a code argument, so the link cannot carry one.
  assert.match(panel, /buildCheckinLandingPath\(session\.id\)/);
  assert.match(panel, /buildCheckinShareUrl\(/);
  assert.doesNotMatch(panel, /shareUrl[^;]*code/i, 'share URL must not embed the code');

  assert.match(panel, /POLL_INTERVAL_MS = 10_000/, '10s polling cadence');
  assert.match(panel, /visibilitychange/, 'visibility-aware polling');
  assert.match(panel, /shouldPollSession\(document\.visibilityState/, 'hidden tabs skip fetches');
  assert.match(panel, /confirm\(\{[\s\S]*closeSessionTitle/, 'close requires confirmation');
  assert.match(panel, /geofencedAttendanceApi\.openSession/);
  assert.match(panel, /geofencedAttendanceApi\.listActiveGeofences/);
  assert.match(panel, /geofencedAttendanceApi\.listSessionCheckins/);
  assert.match(panel, /geofencedAttendanceApi\.reviewCheckin/);
  assert.match(panel, /data-testid="checkin-review-table"/, 'flagged review table marker');

  assert.match(overlay, /getCurrentCode/, 'projector fetches the rotating code');
  assert.match(overlay, /nextCodeRefreshMs/, 'refresh driven by server expiresAt');
  assert.match(overlay, /requestFullscreen/, 'Fullscreen API button');
  assert.match(overlay, /motion-reduce:transition-none/, 'prefers-reduced-motion respected');
  assert.match(overlay, /aria-live="polite"/, 'code announcements are polite');
  assert.doesNotMatch(overlay, /searchParams|useSearchParams|location\.search/, 'code never enters the URL');
});

test('admin geofence console is role-guarded and uses the external map link only', () => {
  const page = read('src/app/admin/attendance-geofences/page.tsx');
  assert.match(page, /isAdmin \|\| isSuperAdmin/, 'ADMIN/SUPER_ADMIN guard required');
  assert.match(page, /listAdminGeofences/);
  assert.match(page, /createAdminGeofence/);
  assert.match(page, /updateAdminGeofence/);
  assert.match(page, /isUnverifiedGeofence/, 'seeded placeholder must be warned about');
  assert.match(page, /buildOsmMarkerUrl/, 'external OSM helper in use');
  assert.match(page, /target="_blank"/);
  assert.match(page, /rel="noopener noreferrer"/);
  // CSP frame-src 'self' blob: forbids an embedded OSM iframe — the console
  // must not try to render one.
  assert.doesNotMatch(page, /<iframe/, 'no embedded map iframe under the current CSP');
  assert.doesNotMatch(page, /localStorage|sessionStorage|console\.(log|info|debug|warn|error)/);

  const localeMirror = read('src/app/[locale]/admin/attendance-geofences/page.tsx');
  assert.match(localeMirror, /export \{ default \} from '\.\.\/\.\.\/\.\.\/admin\/attendance-geofences\/page'/);

  const frame = read('src/components/admin/AdminFrame.tsx');
  assert.match(frame, /href:\s*'\/admin\/attendance-geofences'/, 'admin nav links the console');
});

test('landing page is public, fetch-free, noindex and deep-link only', () => {
  const landing = read('src/app/attendance/checkin/[sessionId]/page.tsx');
  assert.match(landing, /buildCheckinDeepLink\(sessionId\)/, 'hands off via the app scheme');
  assert.match(landing, /isValidAttendanceSessionId/, 'validates the id client-side');
  assert.match(landing, /data-testid="checkin-landing"/);
  assert.doesNotMatch(landing, /fetch\(|axios|Api\b|Api\.|Api\(/, 'landing must not call any API');
  assert.doesNotMatch(landing, /submitStudentCheckin/, 'landing can never check a student in');
  assert.doesNotMatch(landing, /navigator\.geolocation/, 'landing must not request geolocation');
  assert.doesNotMatch(landing, /localStorage|sessionStorage/, 'landing persists nothing');
  assert.doesNotMatch(landing, /<form|type="text"/, 'landing has no input form');

  const localeMirror = read('src/app/[locale]/attendance/checkin/[sessionId]/page.tsx');
  assert.match(localeMirror, /export \{ default, dynamic \}/);

  const server = read('src/i18n/server.ts');
  const branch = /pathname\.startsWith\('\/attendance\/checkin'\)[\s\S]*?robots:\s*\{([^}]+)\}/.exec(server);
  assert.ok(branch, 'route metadata must special-case the check-in landing');
  assert.match(branch[1], /index: false/, 'landing metadata must be noindex');
  assert.match(branch[1], /follow: false/, 'landing links must not be followed');

  const robots = read('src/app/robots.ts');
  assert.match(robots, /'\/attendance\/checkin\/'/, 'robots.txt disallows the landing');
  assert.match(robots, /'\/en\/attendance\/checkin\/'/, 'robots.txt disallows the en landing');
  assert.match(robots, /'\/vi\/attendance\/checkin\/'/, 'robots.txt disallows the vi landing');
});

test('attendance geofence messages are mounted in both dictionaries with parity', () => {
  const messages = read('src/i18n/messages.ts');
  assert.match(messages, /attendanceGeofence: attendanceGeofenceEn/, 'en dictionary mounts the block');
  assert.match(messages, /attendanceGeofence: attendanceGeofenceVi/, 'vi dictionary mounts the block');
  assert.equal(
    (messages.match(/menuAttendanceGeofences:/g) ?? []).length,
    2,
    'admin nav label exists in both locales',
  );
  assert.equal(
    (messages.match(/checkinLanding: \{/g) ?? []).length,
    2,
    'landing metadata exists in both locales',
  );

  const copy = read('src/i18n/messages-attendance-geofence.ts');
  // vi is typed against the widened en shape (compile-checked); spot-check the
  // tokens that drive localized chips exist in both dictionaries.
  for (const token of [
    'BORDERLINE',
    'LOW_ACCURACY',
    'OUTSIDE_AREA',
    'MOCK_PROVIDER',
    'SHARED_DEVICE',
    'ZERO_ACCURACY',
    'IDENTICAL_COORDINATES',
    'IMPOSSIBLE_SPEED',
  ]) {
    assert.ok(
      (copy.match(new RegExp(`${token}:`, 'g')) ?? []).length >= 2,
      `reason chip '${token}' must exist in both locales`,
    );
  }
  for (const key of ['PENDING_REVIEW', 'ACCEPTED', 'REJECTED']) {
    assert.ok(
      (copy.match(new RegExp(`${key}:`, 'g')) ?? []).length >= 2,
      `decision '${key}' must exist in both locales`,
    );
  }
});

test('rotating code requests opt out of caching at the API wrapper', () => {
  const api = read('src/lib/api.ts');
  const block = /getCurrentCode[\s\S]*?no-store/.exec(api);
  assert.ok(block, 'getCurrentCode must send Cache-Control: no-store');
});

test('student attendance API still lacks method/review fields — nothing fabricated', () => {
  // The per-day check-in method/review columns are added only when the API
  // exposes them. Guard the contract that they do not yet exist so this test
  // fails loudly the day the backend ships the fields and the UI stays stale.
  const generated = read('src/types/generated-api.ts');
  const record = /AttendanceResponse: \{[\s\S]*?\};/m.exec(generated)?.[0] ?? '';
  assert.ok(record, 'AttendanceResponse schema must exist');
  assert.doesNotMatch(record, /checkinId|checkInMethod|reviewState|mockProvider/i);

  const studentPage = read('src/app/dashboard/attendance/page.tsx');
  assert.doesNotMatch(
    studentPage,
    /submitStudentCheckin|geofencedAttendanceApi|navigator\.geolocation|checkinMethod|reviewState/i,
    'the student web page must never expose a browser check-in or fabricated fields',
  );
});
