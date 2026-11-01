import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import { fileURLToPath, pathToFileURL } from 'node:url';

const mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cu-student-errors-'));
function emit(rel, name, rewrite = (text) => text) {
  const { outputText } = ts.transpileModule(fs.readFileSync(path.join(mobileRoot, rel), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    fileName: rel,
  });
  fs.writeFileSync(path.join(tmp, name), rewrite(outputText));
}

emit('src/i18n/locale.ts', 'locale.mjs');
emit('src/i18n/academic-messages.ts', 'academic-messages.mjs');
emit('src/screens/student/shared/errors.ts', 'errors.mjs', (text) => text
  .replace(/from '\.\.\/\.\.\/\.\.\/api\/client'/g, "from './client-stub.mjs'")
  .replace(/from '\.\.\/\.\.\/\.\.\/i18n\/academic-messages'/g, "from './academic-messages.mjs'")
  .replace(/from '\.\.\/\.\.\/\.\.\/i18n\/locale'/g, "from './locale.mjs'"));
fs.writeFileSync(path.join(tmp, 'client-stub.mjs'), `
export class ApiClientError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}
`);

const { studentFriendlyErrorMessage } = await import(pathToFileURL(path.join(tmp, 'errors.mjs')).href);
const { academicMessages } = await import(pathToFileURL(path.join(tmp, 'academic-messages.mjs')).href);
const { ApiClientError } = await import(pathToFileURL(path.join(tmp, 'client-stub.mjs')).href);

// The English sentences that lived in src/screens/student/shared/errors.ts.
const EN = {
  ACCESS_DENIED: 'You do not have access to this action.',
  COHORT_INELIGIBLE: 'Registration is not available for your year group yet.',
  CONFLICT: 'This change conflicts with your current record.',
  HTTP_400: 'Please review the information and try again.',
  HTTP_401: 'Please sign in again to continue.',
  HTTP_403: 'You do not have access to this action.',
  HTTP_404: 'We could not find that item.',
  INVALID_REQUEST: 'Please review the information and try again.',
  ROUND_NOT_FOUND: 'Registration is not open right now.',
  UNAUTHENTICATED: 'Please sign in again to continue.',
  WINDOW_CLOSED: 'Registration is not open right now.',
};

test('the error-code map resolves the vi sentence under vi and the original English under en', () => {
  for (const [code, english] of Object.entries(EN)) {
    const error = new ApiClientError('server text', code);
    assert.equal(studentFriendlyErrorMessage(error, 'fallback', 'en'), english, code);
    assert.equal(studentFriendlyErrorMessage(error, 'fallback', 'vi'), academicMessages.vi.studentErrors[code], code);
    assert.notEqual(academicMessages.vi.studentErrors[code], english, code);
  }
});

test('studentErrors carries the same non-empty keys in both locales', () => {
  assert.deepEqual(
    Object.keys(academicMessages.vi.studentErrors).sort(),
    Object.keys(academicMessages.en.studentErrors).sort(),
  );
  for (const locale of ['vi', 'en']) {
    for (const [code, text] of Object.entries(academicMessages[locale].studentErrors)) {
      assert.ok(text.trim(), `${locale}.${code}`);
    }
  }
});

test('unknown codes and non-API errors keep the caller fallback', () => {
  assert.equal(studentFriendlyErrorMessage(new ApiClientError('x', 'NOT_A_CODE'), 'fallback', 'vi'), 'fallback');
  assert.equal(studentFriendlyErrorMessage(new ApiClientError('x', undefined), 'fallback', 'en'), 'fallback');
  assert.equal(studentFriendlyErrorMessage(new Error('boom'), 'fallback', 'vi'), 'fallback');
  assert.equal(studentFriendlyErrorMessage(null, 'fallback', 'en'), 'fallback');
});

test('the live resource passes the active locale into the mapper', () => {
  const source = fs.readFileSync(path.join(mobileRoot, 'src/screens/student/shared/useLiveResource.ts'), 'utf8');
  assert.match(source, /const \{ locale \} = useLocale\(\)/);
  assert.match(source, /studentFriendlyErrorMessage\(error, fallbackMessage, locale\)/);
});
