const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function guardCall(source, marker) {
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `${marker} must exist`);
  const end = source.indexOf('});', start);
  assert.notEqual(end, -1, `${marker} call must close`);
  return source.slice(start, end);
}

test('the site editor intercepts in-app route changes while its draft is dirty', () => {
  const editor = read('src/app/dashboard/editor/page.tsx');
  const call = guardCall(editor, 'useUnsavedChangesGuard({');

  assert.match(call, /isDirty:/, 'the guard still tracks the draft');
  assert.match(
    call,
    /interceptRouteChanges:\s*true/,
    'a language switch or sidebar link must prompt before the draft is dropped',
  );
});
