const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const PAGE = 'src/app/admin/announcements/page.tsx';
const ZONES = ['America/Los_Angeles', 'UTC', 'Asia/Tokyo'];
const originalZone = process.env.TZ;

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function inZone(zone, run) {
  process.env.TZ = zone;
  try {
    return run();
  } finally {
    process.env.TZ = originalZone;
  }
}

function loadTs(relativePath) {
  const output = ts.transpileModule(read(relativePath), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: relativePath,
  }).outputText;
  const moduleRecord = { exports: {} };
  Function('module', 'exports', 'require', output)(moduleRecord, moduleRecord.exports, require);
  return moduleRecord.exports;
}

const attendance = loadTs('src/lib/attendance-checkin.ts');

function pageFunction(name) {
  const source = read(PAGE);
  const match = new RegExp(`function ${name}\\([\\s\\S]*?\\n\\}`).exec(source);
  assert.ok(match, `${name} must stay a top-level function in the admin editor`);
  return match[0];
}

function evaluateFunction(name) {
  const source = ts.transpileModule(pageFunction(name), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  return new Function(
    'campusLocalDateTimeToUtcIso',
    'toCampusLocalDateTimeInput',
    `return (${source});`,
  )(attendance.campusLocalDateTimeToUtcIso, attendance.toCampusLocalDateTimeInput);
}

test('publish and expiry windows are written as campus wall time', () => {
  const isoDateTime = evaluateFunction('isoDateTime');
  for (const zone of ZONES) {
    inZone(zone, () => {
      assert.equal(
        isoDateTime('2026-11-05T09:00'),
        '2026-11-05T02:00:00.000Z',
        `${zone} publishAt`,
      );
      assert.equal(
        isoDateTime('2026-11-05T17:00'),
        '2026-11-05T10:00:00.000Z',
        `${zone} expiresAt`,
      );
      assert.equal(isoDateTime(''), null);
      assert.equal(isoDateTime('not-a-date'), null);
    });
  }
});

test('the editor prefills the same campus wall time the list displays', () => {
  const localDateTime = evaluateFunction('localDateTime');
  const isoDateTime = evaluateFunction('isoDateTime');
  for (const zone of ZONES) {
    inZone(zone, () => {
      assert.equal(localDateTime('2026-11-05T02:00:00.000Z'), '2026-11-05T09:00', `${zone} publishAt`);
      assert.equal(localDateTime('2026-11-05T10:00:00.000Z'), '2026-11-05T17:00', `${zone} expiresAt`);
      // Minute-precision inputs drop seconds, but the minute itself is campus time.
      assert.equal(localDateTime('2026-11-05T02:00:30.500Z'), '2026-11-05T09:00', `${zone} seconds`);
      assert.equal(localDateTime(null), '');
      assert.equal(localDateTime('not-a-date'), '');
      // Reopening and saving an untouched minute-precision value keeps the instant.
      assert.equal(isoDateTime(localDateTime('2026-11-05T10:00:00.000Z')), '2026-11-05T10:00:00.000Z');
    });
  }
});

test('the payload and the edit prefill share those conversions', () => {
  const source = read(PAGE);
  assert.match(source, /publishAt: isoDateTime\(draft\.publishAt\)/);
  assert.match(source, /expiresAt: isoDateTime\(draft\.expiresAt\)/);
  assert.match(source, /publishAt: localDateTime\(item\.publishAt\)/);
  assert.match(source, /expiresAt: localDateTime\(item\.expiresAt\)/);
});
