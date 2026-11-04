const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function loadTs(relativePath) {
  const output = ts.transpileModule(read(relativePath), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const moduleRecord = { exports: {} };
  Function('module', 'exports', 'require', output)(moduleRecord, moduleRecord.exports, () => ({}));
  return moduleRecord.exports;
}

test('upcoming classes skip meetings that already ended today', () => {
  const { daysUntilMeeting } = loadTs('src/lib/weekly-grid.ts');
  assert.equal(typeof daysUntilMeeting, 'function', 'the next-meeting day helper exists');

  // 14:00 campus time, Friday (ISO day 5).
  assert.equal(daysUntilMeeting(5, 5, '10:00', '14:00'), 7, 'a finished meeting rolls to next week');
  assert.equal(daysUntilMeeting(5, 5, '14:00', '14:00'), 7, 'an ending meeting is not upcoming');
  assert.equal(daysUntilMeeting(5, 5, '16:00', '14:00'), 0, 'a later meeting today stays today');
  assert.equal(daysUntilMeeting(6, 5, '08:00', '14:00'), 1, 'tomorrow sorts ahead of a finished today class');
  assert.equal(daysUntilMeeting(1, 7, '08:00', '14:00'), 1, 'Sunday rolls into Monday');

  const source = read('src/app/dashboard/page.tsx');
  assert.match(
    source,
    /daysUntil: daysUntilMeeting\(isoDay, todayDow, schedule\.endTime, campusNowHHmm\)/,
    'the dashboard passes the campus clock into the next-meeting calculation',
  );
  assert.match(
    source,
    /toCampusLocalDateTimeInput\(new Date\(\)\.toISOString\(\),[\s\S]{0,40}?seconds: false/,
    'the dashboard clock is pinned to the campus time zone',
  );
});
