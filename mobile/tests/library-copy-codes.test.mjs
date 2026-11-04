import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadTs } from './helpers/load-ts.mjs';

const mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rules = await loadTs('src/screens/content/content-rules.ts');

const copy = {
  noCopiesAvailable: 'no copies',
  copyUnavailable: 'copy taken',
};

test('library copy failures pick the patron-facing message for every server code', () => {
  assert.equal(rules.copyFailureMessage(copy, { code: 'NO_COPY' }), 'no copies');
  assert.equal(rules.copyFailureMessage(copy, { status: 409, code: 'COPY_UNAVAILABLE' }), 'copy taken');
  assert.equal(rules.copyFailureMessage(copy, { status: 409, code: 'COPY_TERMINAL' }), 'copy taken');
  assert.equal(rules.copyFailureMessage(copy, { status: 409, code: 'OTHER' }), null);
  assert.equal(rules.copyFailureMessage(copy, new Error('offline')), null);
});

test('the library screen maps a hold conflict through the shared rule', () => {
  const source = fs.readFileSync(path.join(mobileRoot, 'src/screens/student/LibraryScreen.tsx'), 'utf8');
  assert.match(source, /copyFailureMessage\(copy, error\)/);
  assert.doesNotMatch(source, /errorCode\(error\) === 'NO_COPY'/);
});
