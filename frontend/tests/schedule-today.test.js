const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

/** Strips comments so explanatory prose can mention banned patterns freely. */
function codeOnly(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

function loadTs(relativePath, fakeRequire) {
  const output = ts.transpileModule(read(relativePath), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const moduleRecord = { exports: {} };
  Function('module', 'exports', 'require', output)(
    moduleRecord,
    moduleRecord.exports,
    fakeRequire || (() => ({})),
  );
  return moduleRecord.exports;
}

function loadCampusDay(fakeReact) {
  return loadTs('src/lib/campus-day.ts', (id) => {
    if (id === 'react') return fakeReact || {};
    assert.match(id, /attendance-checkin/, 'the only other import is the shared campus clock');
    return loadTs('src/lib/attendance-checkin.ts');
  });
}

/** Timetable day number in an explicit zone: 1=Sunday .. 7=Saturday. */
function dayInZone(instant, timeZone) {
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(instant);
  const jsDay = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(weekday);
  return jsDay === 0 ? 1 : jsDay + 1;
}

// Timetable "Today" lives on the campus calendar (Asia/Ho_Chi_Minh). A
// viewer west of campus still sees yesterday at the same instant, and a UTC
// runner rolls its local day seven hours after campus does — so the viewer's
// getDay() can never define Today.

test('campusDayOfWeek follows the campus calendar at the midnight boundary', () => {
  const { campusDayOfWeek } = loadCampusDay();

  // Campus midnight lands at 17:00Z; one second on either side changes Today.
  assert.equal(campusDayOfWeek(new Date('2026-10-29T16:59:59Z')), 5, 'HCM Thu 23:59 → Thursday');
  assert.equal(campusDayOfWeek(new Date('2026-10-29T17:00:00Z')), 6, 'HCM Fri 00:00 → Friday');

  // At this instant a UTC runner sees Thursday and a Los Angeles viewer sees
  // Thursday too — only the campus calendar says Friday.
  const instant = new Date('2026-10-29T20:00:00Z');
  assert.equal(dayInZone(instant, 'UTC'), 5);
  assert.equal(dayInZone(instant, 'America/Los_Angeles'), 5);
  assert.equal(campusDayOfWeek(instant), 6);
  assert.equal(campusDayOfWeek(instant), dayInZone(instant, 'Asia/Ho_Chi_Minh'));

  // Sunday keeps the campus 1=Sunday convention instead of ISO 7.
  assert.equal(campusDayOfWeek(new Date('2026-11-01T02:00:00Z')), 1, 'HCM Sun 09:00 → Sunday');
});

test('msUntilNextCampusMidnight measures to the next campus midnight', () => {
  const { msUntilNextCampusMidnight } = loadCampusDay();
  const SECOND = 1000;
  const HOUR = 60 * 60 * SECOND;

  assert.equal(msUntilNextCampusMidnight(new Date('2026-10-29T16:59:59Z')), SECOND);
  assert.equal(msUntilNextCampusMidnight(new Date('2026-10-29T17:00:00Z')), 24 * HOUR);
  assert.equal(msUntilNextCampusMidnight(new Date('2026-10-29T05:00:00Z')), 12 * HOUR);
});

test('useCampusDayOfWeek rolls over at campus midnight and recovers on visibility', () => {
  const effects = [];
  const setCalls = [];
  const timers = [];
  const cleared = [];
  const listeners = {};
  const fakeReact = {
    useState: (initial) => [
      typeof initial === 'function' ? initial() : initial,
      (value) => setCalls.push(value),
    ],
    useEffect: (cb) => effects.push(cb),
  };
  const window = {
    setTimeout: (cb, ms) => { timers.push({ cb, ms }); return timers.length; },
    clearTimeout: (id) => cleared.push(id),
  };
  const document = {
    visibilityState: 'visible',
    addEventListener: (event, cb) => { listeners[event] = cb; },
    removeEventListener: (event) => { delete listeners[event]; },
  };
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  globalThis.window = window;
  globalThis.document = document;
  try {
    const { useCampusDayOfWeek } = loadCampusDay(fakeReact);
    const dow = useCampusDayOfWeek();
    assert.ok(dow >= 1 && dow <= 7, 'initial value is a campus timetable day');
    assert.equal(effects.length, 1, 'one effect owns the rollover wiring');

    const cleanup = effects[0]();
    assert.equal(timers.length, 1, 'a timer arms for the next campus midnight');
    assert.ok(timers[0].ms > 0 && timers[0].ms <= 24 * 60 * 60 * 1000 + 5_000);
    assert.equal(typeof listeners.visibilitychange, 'function',
      'a visible-tab listener recovers days slept through the boundary');

    timers[0].cb();
    assert.equal(setCalls.length, 1, 'the midnight tick re-derives the day');
    assert.ok(setCalls[0] >= 1 && setCalls[0] <= 7);
    assert.equal(timers.length, 2, 'each tick re-arms for the next midnight');

    document.visibilityState = 'hidden';
    listeners.visibilitychange();
    assert.equal(setCalls.length, 1, 'a hidden tab does not churn the clock');
    document.visibilityState = 'visible';
    listeners.visibilitychange();
    assert.equal(setCalls.length, 2, 'returning to visible re-derives the day');

    cleanup();
    assert.equal(cleared.at(-1), timers.length, 'unmount clears the armed timer');
    assert.equal(listeners.visibilitychange, undefined, 'unmount removes the listener');
  } finally {
    globalThis.window = previousWindow;
    globalThis.document = previousDocument;
  }
});

test('student, lecturer and dashboard timetable views read the campus day', () => {
  for (const page of [
    'src/app/dashboard/schedule/page.tsx',
    'src/app/dashboard/lecturer/schedule/page.tsx',
    'src/app/dashboard/page.tsx',
  ]) {
    const code = codeOnly(read(page));
    assert.match(code, /useCampusDayOfWeek/, `${page} must read the campus day`);
    assert.doesNotMatch(code, /new Date\(\)\.getDay\(\)/,
      `${page} must not derive Today from the viewer zone`);
    assert.doesNotMatch(code, /\},\s*\[\]\);?\s*\/\/.*today/i,
      `${page} must not freeze Today in a mount-only memo`);
  }
});
