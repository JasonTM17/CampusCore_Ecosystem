import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import { fileURLToPath, pathToFileURL } from 'node:url';

const mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const account = (name) => path.join(mobileRoot, 'src/screens/account', name);
const read = (rel) => fs.readFileSync(path.join(mobileRoot, rel), 'utf8');

// Pure modules are transpiled into one temp folder so their relative imports
// resolve; the API client is replaced by a recording stub.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cu-account-'));
function emit(file, name) {
  const { outputText } = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    fileName: name,
  });
  const rewritten = outputText
    .replace(/from '\.\.\/\.\.\/api\/client'/g, "from './client-stub.mjs'")
    .replace(/from '\.\/([\w-]+)'/g, "from './$1.mjs'");
  fs.writeFileSync(path.join(tmp, name.replace(/\.ts$/, '.mjs')), rewritten);
}
for (const name of ['password-policy.ts', 'recovery-flow.ts', 'account-errors.ts', 'account-api.ts']) {
  emit(account(name), name);
}
emit(path.join(mobileRoot, 'src/i18n/account-messages.ts'), 'account-messages.ts');
fs.writeFileSync(path.join(tmp, 'client-stub.mjs'), `
export const calls = [];
const make = (label) => ({
  baseUrl: 'http://api.test/api/v1',
  mode: 'live',
  post: async (path, body) => { calls.push({ label, method: 'POST', path, body }); return { message: 'ok' }; },
  get: async (path) => { calls.push({ label, method: 'GET', path }); return { enabled: false }; },
});
export const apiClient = make('shared');
export const createApiClient = (options) => { calls.push({ label: 'create', options }); return make('anonymous'); };
`);
const load = (name) => import(pathToFileURL(path.join(tmp, name)).href);
const policy = await load('password-policy.mjs');
const recovery = await load('recovery-flow.mjs');
const errors = await load('account-errors.mjs');
const api = await load('account-api.mjs');
const stub = await load('client-stub.mjs');
const { accountMessages } = await load('account-messages.mjs');

// Obviously fake values; none of them is a real credential or token.
const FAKE_TOKEN = 'fake-reset-token_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const FAKE_PASSWORD = 'Fake-pass-1234';

test('password policy enforces the same rules and order as the web client', () => {
  assert.equal(policy.checkPasswordPolicy('abc1'), 'PASSWORD_TOO_SHORT');
  assert.equal(policy.checkPasswordPolicy(''), 'PASSWORD_TOO_SHORT');
  assert.equal(policy.checkPasswordPolicy('a1'.repeat(65)), 'PASSWORD_TOO_LONG');
  assert.equal(policy.checkPasswordPolicy('a1'.repeat(37)), 'PASSWORD_TOO_LONG', '74 bytes exceeds the 72 byte limit');
  assert.equal(policy.checkPasswordPolicy('onlyletters'), 'PASSWORD_TOO_WEAK');
  assert.equal(policy.checkPasswordPolicy('12345678'), 'PASSWORD_TOO_WEAK');
  assert.equal(policy.checkPasswordPolicy(FAKE_PASSWORD), null);
  assert.equal(
    policy.checkPasswordPolicy('minh.nguyen1', { email: 'minh.nguyen@ute.edu.vn' }),
    'PASSWORD_CONTAINS_IDENTITY',
  );
  assert.equal(policy.checkPasswordPolicy('Abcdef12', { currentPassword: 'Abcdef12' }), 'PASSWORD_REUSED');
  assert.equal(policy.checkPasswordPolicy('Abcdef12', { confirmPassword: 'Abcdef13' }), 'PASSWORD_MISMATCH');
  assert.equal(policy.checkPasswordPolicy('Abcdef12', { confirmPassword: 'Abcdef12' }), null);
  assert.equal(policy.checkPasswordPolicy('Mật-khẩu-12'), null, 'Vietnamese letters count as letters');
});

test('password checklist and code mapping stay in the shared namespace', () => {
  assert.deepEqual(policy.passwordChecklist('Abcdef12', 'Abcdef12').map((i) => i.met), [true, true, true]);
  assert.deepEqual(policy.passwordChecklist('abc', '').map((i) => i.met), [false, false, false]);
  assert.equal(policy.mapPasswordErrorCode('PASSWORD_TOO_COMMON'), 'PASSWORD_TOO_COMMON');
  assert.equal(policy.mapPasswordErrorCode('NOT_A_CODE'), null);
  assert.equal(policy.mapPasswordErrorCode(undefined), null);
});

test('reset token extraction accepts only a single well-formed token', () => {
  assert.equal(recovery.extractResetToken(FAKE_TOKEN), FAKE_TOKEN);
  assert.equal(recovery.extractResetToken(`  ${FAKE_TOKEN} `), FAKE_TOKEN);
  assert.equal(recovery.extractResetToken([FAKE_TOKEN]), FAKE_TOKEN);
  assert.equal(recovery.extractResetToken([FAKE_TOKEN, FAKE_TOKEN]), null);
  assert.equal(recovery.extractResetToken(undefined), null);
  assert.equal(recovery.extractResetToken(''), null);
  assert.equal(recovery.extractResetToken('short'), null);
  assert.equal(recovery.extractResetToken(`${FAKE_TOKEN}<script>`), null);
  assert.equal(recovery.extractResetToken('x'.repeat(201)), null);
});

test('email validation is local and neutral', () => {
  assert.equal(recovery.validateEmail(''), 'required');
  assert.equal(recovery.validateEmail('   '), 'required');
  assert.equal(recovery.validateEmail('not-an-email'), 'invalid');
  assert.equal(recovery.validateEmail(`${'a'.repeat(320)}@x.vn`), 'invalid');
  assert.equal(recovery.validateEmail(' student@example.edu '), null);
});

test('forgot flow ends in one neutral sent state and ignores double submit', () => {
  const sent = [
    { type: 'submit', email: ' student@example.edu ' },
    { type: 'submit', email: 'other@example.edu' },
    { type: 'accepted' },
  ].reduce(recovery.forgotReducer, recovery.initialForgotState);
  assert.equal(sent.phase, 'sent');
  assert.equal(sent.email, 'student@example.edu');
  const failed = recovery.forgotReducer(
    recovery.forgotReducer(recovery.initialForgotState, { type: 'submit', email: 'a@b.co' }),
    { type: 'rejected', failure: errors.classifyError({ status: 429 }) },
  );
  assert.equal(failed.phase, 'failed');
  assert.equal(failed.failure.kind, 'rateLimited');
  assert.equal(recovery.forgotReducer(sent, { type: 'startOver' }).phase, 'idle');
  assert.equal(recovery.forgotReducer(recovery.initialForgotState, { type: 'accepted' }).phase, 'idle');
});

test('reset flow reaches safe terminal states and never leaves them', () => {
  assert.equal(recovery.initialResetState(null).phase, 'tokenInvalid');
  assert.equal(recovery.initialResetState(FAKE_TOKEN).phase, 'form');
  const step = (state, ...events) => events.reduce(recovery.resetReducer, state);
  const form = recovery.initialResetState(FAKE_TOKEN);

  assert.equal(step(form, { type: 'succeeded' }).phase, 'form', 'success needs a submit first');
  assert.equal(step(form, { type: 'submit' }, { type: 'succeeded' }).phase, 'done');
  const rejected = step(form, { type: 'submit' }, {
    type: 'failed',
    failure: errors.classifyError({ status: 400, code: 'RESET_TOKEN_INVALID' }),
  });
  assert.equal(rejected.phase, 'tokenInvalid');
  const retryable = step(form, { type: 'submit' }, {
    type: 'failed',
    failure: errors.classifyError({ status: 400, code: 'PASSWORD_TOO_COMMON' }),
  });
  assert.equal(retryable.phase, 'form');
  assert.equal(retryable.failure.code, 'PASSWORD_TOO_COMMON');
  for (const terminal of [rejected, step(form, { type: 'submit' }, { type: 'succeeded' })]) {
    assert.equal(step(terminal, { type: 'submit' }).phase, terminal.phase);
  }
});

test('error classification covers 429, 5xx, offline, preview and business codes', () => {
  const kind = (error) => errors.classifyError(error).kind;
  assert.equal(kind({ status: 429 }), 'rateLimited');
  assert.equal(kind({ status: 400, code: 'RATE_LIMIT_EXCEEDED' }), 'rateLimited');
  assert.equal(kind({ status: 503 }), 'server');
  assert.equal(kind({ status: 502 }), 'server');
  assert.equal(kind({ status: 401 }), 'unauthorized');
  assert.equal(kind({ status: 403 }), 'forbidden');
  assert.equal(kind({ status: 0 }), 'network');
  assert.equal(kind(new TypeError('Network request failed')), 'network');
  assert.equal(kind({ status: 0, code: 'MOBILE_API_PREVIEW' }), 'preview');
  assert.equal(kind(new Error('boom')), 'unknown');
  assert.equal(kind(null), 'unknown');
});

test('error messages prefer business codes and never echo server text', () => {
  const copy = accountMessages.en.errors;
  const failure = { ...errors.classifyError({ status: 400, code: 'RESET_TOKEN_INVALID' }), message: 'leaky detail' };
  assert.equal(errors.errorMessage(failure, copy), copy.codes.RESET_TOKEN_INVALID);
  assert.equal(errors.errorMessage(errors.classifyError({ status: 500 }), copy), copy.server);
  assert.equal(errors.errorMessage(errors.classifyError({ status: 400, code: 'X' }), copy, { X: 'override' }), 'override');
  assert.equal(errors.errorMessage(errors.classifyError({ status: 400, code: 'UNLISTED' }), copy), copy.validation);
});

test('vi and en account messages have identical keys, placeholders and non-empty text', () => {
  const flatten = (value, prefix = '') => Object.entries(value).flatMap(([key, item]) =>
    typeof item === 'string' ? [[`${prefix}${key}`, item]] : flatten(item, `${prefix}${key}.`));
  const vi = new Map(flatten(accountMessages.vi));
  const en = new Map(flatten(accountMessages.en));
  assert.deepEqual([...vi.keys()].sort(), [...en.keys()].sort());
  for (const [key, text] of vi) {
    assert.ok(text.trim(), key);
    assert.ok(en.get(key).trim(), key);
    assert.deepEqual(text.match(/\{\w+\}/g) ?? [], en.get(key).match(/\{\w+\}/g) ?? [], key);
  }
  for (const code of ['PASSWORD_TOO_SHORT', 'PASSWORD_TOO_COMMON', 'RESET_TOKEN_INVALID', 'INVALID_OLD_PASSWORD']) {
    assert.ok(accountMessages.vi.errors.codes[code]);
    assert.notEqual(accountMessages.vi.errors.codes[code], accountMessages.en.errors.codes[code]);
  }
});

test('recovery calls use an anonymous client and the documented endpoints', async () => {
  stub.calls.length = 0;
  await api.accountApi.forgotPassword('student@example.edu');
  await api.accountApi.resetPassword(FAKE_TOKEN, FAKE_PASSWORD);
  await api.accountApi.forgotPassword('again@example.edu');

  const created = stub.calls.filter((call) => call.label === 'create');
  assert.equal(created.length, 1, 'the anonymous client is built once and reused');
  assert.deepEqual(Object.keys(created[0].options).sort(), ['baseUrl', 'mode']);
  const posts = stub.calls.filter((call) => call.method === 'POST');
  assert.ok(posts.every((call) => call.label === 'anonymous'), 'never the shared Bearer client');
  assert.deepEqual(posts[0], { label: 'anonymous', method: 'POST', path: '/auth/forgot-password', body: { email: 'student@example.edu' } });
  assert.deepEqual(posts[1].body, { token: FAKE_TOKEN, newPassword: FAKE_PASSWORD });
  assert.equal(posts[1].path, '/auth/reset-password');
});

test('account sources never log, persist or print secrets', () => {
  const dir = path.join(mobileRoot, 'src/screens/account');
  const sources = fs.readdirSync(dir).filter((f) => /\.tsx?$/.test(f))
    .map((f) => ({ f, text: fs.readFileSync(path.join(dir, f), 'utf8') }));
  for (const { f, text } of sources) {
    assert.doesNotMatch(text, /console\.(log|info|warn|error|debug)/, f);
    assert.doesNotMatch(text, /AsyncStorage|SecureStore|localStorage|sessionStore/, f);
    assert.doesNotMatch(text, /recordApiMetric|analytics|Sentry/i, f);
    assert.ok(text.split('\n').length < 300, `${f} stays under 300 lines`);
  }
  const route = read('src/screens/account/ResetPasswordRoute.tsx');
  assert.match(route, /router\.setParams\(\{ token: undefined \}\)/);
  assert.match(route, /extractResetToken\(params\.token\)/);
  const screen = read('src/screens/account/ResetPasswordScreen.tsx');
  assert.match(screen, /tokenRef\.current = null/);
  assert.doesNotMatch(screen, /\{(initialToken|tokenRef\.current)\}/, 'the token is never rendered');
});

test('sign-in keeps the browser-owned flow and respects the status bar inset', () => {
  const signIn = read('src/screens/auth/SignInScreen.tsx');
  assert.match(signIn, /SafeAreaInsetsContext/);
  assert.match(signIn, /insets\?\.top/);
  assert.match(signIn, /signInWithOidc\(/);
  assert.doesNotMatch(signIn, /password|campusApi\.login|TextInput/);
});
