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

test('certificate date line follows the campus calendar, not the viewer zone', () => {
  const { campusTodayIso } = loadTs('src/lib/attendance-checkin.ts');

  // 20:00Z on Nov 2 is already 03:00 on Nov 3 in Ho Chi Minh City.
  assert.equal(
    campusTodayIso(new Date('2026-11-02T20:00:00Z')),
    '2026-11-03',
    'the shared campus clock pins the civil day to Asia/Ho_Chi_Minh',
  );

  const source = read('src/app/dashboard/certificates/page.tsx');
  assert.match(
    source,
    /campusTodayIso\(today\)/,
    'the city/date line must read the campus calendar day',
  );
  assert.doesNotMatch(source, /today\.getDate\(\)/);
  assert.doesNotMatch(source, /today\.getMonth\(\)/);
  assert.doesNotMatch(source, /today\.getFullYear\(\)/);
});
