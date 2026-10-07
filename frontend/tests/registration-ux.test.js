const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

function load(relativePath, dependencies = {}) {
  const output = ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const moduleRecord = { exports: {} };
  Function('module', 'exports', 'require', output)(moduleRecord, moduleRecord.exports, (id) => dependencies[id] ?? {});
  return moduleRecord.exports;
}
const grid = load('src/lib/weekly-grid.ts');
const labels = load('src/components/schedule/weekly-grid.tsx', { '@/lib/weekly-grid': grid });

test('agenda ordering uses start/end time and preserves equal meetings and cached input', () => {
  const rows = Object.freeze([
    Object.freeze({ id: 'afternoon', dayOfWeek: 1, startTime: '13:00', endTime: '15:30' }),
    Object.freeze({ id: 'long', dayOfWeek: 0, startTime: '09:45', endTime: '12:00' }),
    Object.freeze({ id: 'short-a', dayOfWeek: 1, startTime: '09:45', endTime: '11:15' }),
    Object.freeze({ id: 'short-b', dayOfWeek: 1, startTime: '09:45', endTime: '11:15' }),
  ]);
  const sorted = grid.sortWeeklyMeetings(rows);
  assert.deepEqual(sorted.map((row) => row.id), ['short-a', 'short-b', 'long', 'afternoon']);
  assert.deepEqual(rows.map((row) => row.id), ['afternoon', 'long', 'short-a', 'short-b']);
  assert.equal(sorted.length, rows.length);
  assert.deepEqual(grid.sortWeeklyMeetings([]), []);
});

test('shared day labels normalize legacy Sunday and safely describe invalid days in both locales', () => {
  for (const locale of ['vi', 'en']) {
    assert.equal(labels.dayLabel(locale, 0), labels.dayLabel(locale, 1));
    assert.equal(labels.shortDayLabel(locale, 0), labels.shortDayLabel(locale, 1));
    for (const day of [-1, 8, 99, NaN]) {
      assert.equal(typeof labels.dayLabel(locale, day), 'string');
      assert.equal(typeof labels.shortDayLabel(locale, day), 'string');
      assert.ok(labels.dayLabel(locale, day).length);
      assert.doesNotMatch(labels.dayLabel(locale, day), /undefined/);
    }
  }
  assert.equal(labels.shortDayLabel('en', 0), 'Sun');
  assert.equal(labels.shortDayLabel('vi', 0), 'CN');
});
