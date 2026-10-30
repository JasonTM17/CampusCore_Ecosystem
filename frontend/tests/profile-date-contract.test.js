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

function loadCivilDate() {
  return loadTs('src/lib/civil-date.ts');
}

// The birth date on a profile is school-managed and stored through UTC
// fields. It must render as the stored civil day on every runner — UTC,
// America/Los_Angeles or Asia/Ho_Chi_Minh — and the client must never send a
// client-side value back to the profile endpoint.

test('bare civil dates pass through unchanged', () => {
  const { civilDateInputValue } = loadCivilDate();
  assert.equal(civilDateInputValue('2003-05-15'), '2003-05-15');
  assert.equal(civilDateInputValue('2004-02-29'), '2004-02-29');
});

test('a stored instant keeps its UTC calendar day regardless of the runner zone', () => {
  const { civilDateInputValue } = loadCivilDate();
  // 2003-05-15T00:00:00Z is still 2003-05-14 west of UTC; the stored UTC civil
  // day is authoritative, so a western viewer must still see the 15th.
  assert.equal(civilDateInputValue('2003-05-15T00:00:00Z'), '2003-05-15');
  assert.equal(civilDateInputValue('2003-05-15T23:30:00Z'), '2003-05-15');
  // An explicit offset still resolves to the instant's UTC day: this one is
  // 2003-05-16T04:30:00Z in UTC.
  assert.equal(civilDateInputValue('2003-05-15T23:30:00-05:00'), '2003-05-16');
  // Zone-less datetimes carry the server's UTC fields.
  assert.equal(civilDateInputValue('2003-05-15T12:00:00'), '2003-05-15');
});

test('empty and unparseable values render no civil date instead of a shifted one', () => {
  const { civilDateInputValue } = loadCivilDate();
  assert.equal(civilDateInputValue(undefined), '');
  assert.equal(civilDateInputValue(''), '');
  assert.equal(civilDateInputValue('   '), '');
  assert.equal(civilDateInputValue('not a date'), '');
});

test('the pinned display zone renders the same civil day on every viewer', () => {
  const { civilDateInputValue, CIVIL_DATE_TIME_ZONE } = loadCivilDate();
  assert.equal(CIVIL_DATE_TIME_ZONE, 'UTC');
  const civil = civilDateInputValue('2003-05-15T00:00:00Z');
  const rendered = new Intl.DateTimeFormat('en-US', {
    timeZone: CIVIL_DATE_TIME_ZONE,
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(new Date(`${civil}T00:00:00Z`));
  assert.equal(rendered, 'May 15, 2003');
});

test('profile page shows the birth date read-only and never sends it back', () => {
  const source = read('src/app/dashboard/profile/page.tsx');
  const code = codeOnly(source);

  assert.match(code, /import\s*\{\s*civilDateInputValue\s*\}\s*from\s*'@\/lib\/civil-date'/);
  assert.doesNotMatch(code, /localDateInput/, 'viewer-zone date conversion must be gone');

  const dobBlock = source.slice(
    source.indexOf('fields.dateOfBirth'),
    source.indexOf('fields.address'),
  );
  assert.match(codeOnly(dobBlock), /value=\{civilDateInputValue\(user\?\.dateOfBirth\)\}/);
  assert.match(codeOnly(dobBlock), /disabled/);
  assert.doesNotMatch(codeOnly(dobBlock), /onChange/, 'a read-only field must not accept edits');

  const putBlock = code.slice(
    code.indexOf('authApi.updateProfile'),
    code.indexOf('handlePasswordSubmit'),
  );
  assert.doesNotMatch(putBlock, /dateOfBirth/, 'the profile PUT must not carry a client DOB');
  // Phone, address and avatar saves stay intact.
  assert.match(putBlock, /phone:/);
  assert.match(putBlock, /address:/);
  assert.match(putBlock, /avatar:/);
});

test('the identity card renders the stored civil day in the pinned zone', () => {
  const source = read('src/components/dashboard/StudentUteProfileGradeView.tsx');
  const code = codeOnly(source);
  assert.match(code, /civilDateInputValue\(user\.dateOfBirth\)/);
  assert.match(code, /formatDate\(civil, \{ timeZone: CIVIL_DATE_TIME_ZONE \}\)/);
  assert.doesNotMatch(code, /formatDate\(parsed\)/,
    'viewer-zone rendering of the birth date must be gone');
});

test('the profile update payload type no longer advertises dateOfBirth', () => {
  const code = codeOnly(read('src/lib/api.ts'));
  assert.doesNotMatch(code, /dateOfBirth/, 'no client payload may type or send a birth date');
});
