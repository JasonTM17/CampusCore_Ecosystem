import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import { fileURLToPath, pathToFileURL } from 'node:url';

const mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cu-two-factor-'));

async function load(name) {
  const source = fs.readFileSync(path.join(mobileRoot, 'src/screens/account', `${name}.ts`), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    fileName: `${name}.ts`,
  });
  fs.writeFileSync(path.join(tmp, `${name}.mjs`), outputText);
  return import(pathToFileURL(path.join(tmp, `${name}.mjs`)).href);
}

const flow = await load('two-factor-flow');
const notice = await load('exit-notice');
const errors = await (async () => {
  const source = fs.readFileSync(path.join(mobileRoot, 'src/screens/account/account-errors.ts'), 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } });
  fs.writeFileSync(path.join(tmp, 'account-errors.mjs'), outputText);
  return import(pathToFileURL(path.join(tmp, 'account-errors.mjs')).href);
})();

const run = (state, ...events) => events.reduce(flow.twoFactorReducer, state);
const off = run(flow.initialTwoFactorState, { type: 'statusLoaded', enabled: false });
const on = run(flow.initialTwoFactorState, { type: 'statusLoaded', enabled: true });
const CHALLENGE = 'fake-challenge-id';

test('enable walks password, code, then completes and clears the challenge', () => {
  const asking = run(off, { type: 'begin', action: 'enable' });
  assert.equal(asking.stage, 'password');
  const sending = run(asking, { type: 'requestStarted' });
  assert.equal(sending.busy, true);
  const coding = run(sending, { type: 'challengeStarted', challengeId: CHALLENGE });
  assert.deepEqual([coding.stage, coding.challengeId, coding.busy], ['code', CHALLENGE, false]);
  const done = run(coding, { type: 'requestStarted' }, { type: 'succeeded', enabled: true });
  assert.deepEqual(
    [done.stage, done.enabled, done.completed, done.challengeId, done.busy],
    ['idle', true, 'enable', null, false],
  );
});

test('disable needs an explicit confirmation before it asks for the password', () => {
  const confirm = run(on, { type: 'begin', action: 'disable' });
  assert.equal(confirm.stage, 'confirmDisable');
  assert.equal(run(confirm, { type: 'requestStarted' }).busy, false, 'no request before confirmation');
  assert.equal(run(confirm, { type: 'cancel' }).stage, 'idle');
  const password = run(confirm, { type: 'confirmDisable' });
  assert.equal(password.stage, 'password');
  const done = run(
    password,
    { type: 'requestStarted' },
    { type: 'challengeStarted', challengeId: CHALLENGE },
    { type: 'requestStarted' },
    { type: 'succeeded', enabled: false },
  );
  assert.deepEqual([done.enabled, done.completed], [false, 'disable']);
});

test('actions that do not match the known status are refused', () => {
  assert.equal(run(flow.initialTwoFactorState, { type: 'begin', action: 'enable' }).stage, 'idle');
  assert.equal(run(on, { type: 'begin', action: 'enable' }).stage, 'idle');
  assert.equal(run(off, { type: 'begin', action: 'disable' }).stage, 'idle');
  const busy = run(off, { type: 'begin', action: 'enable' }, { type: 'requestStarted' });
  assert.equal(run(busy, { type: 'cancel' }).busy, true, 'cancel is ignored mid-request');
  assert.equal(run(busy, { type: 'requestStarted' }), busy, 'no second request while busy');
});

test('a wrong code keeps the challenge, a dead challenge restarts the flow', () => {
  const coding = run(
    off,
    { type: 'begin', action: 'enable' },
    { type: 'requestStarted' },
    { type: 'challengeStarted', challengeId: CHALLENGE },
    { type: 'requestStarted' },
  );
  const wrong = run(coding, { type: 'failed', error: 'codeInvalid' });
  assert.deepEqual([wrong.stage, wrong.challengeId, wrong.error, wrong.busy], ['code', CHALLENGE, 'codeInvalid', false]);
  for (const dead of ['codeLocked', 'codeExpired', 'challengeInvalid']) {
    const restarted = run(coding, { type: 'failed', error: dead });
    assert.deepEqual([restarted.stage, restarted.challengeId, restarted.error], ['idle', null, dead]);
  }
  const already = run(coding, { type: 'failed', error: 'alreadyEnabled' });
  assert.deepEqual([already.enabled, already.stage], [true, 'idle']);
});

test('the machine never stores the password or the code', () => {
  const states = [
    run(off, { type: 'begin', action: 'enable' }, { type: 'requestStarted' }),
    run(off, { type: 'begin', action: 'enable' }, { type: 'requestStarted' }, { type: 'challengeStarted', challengeId: CHALLENGE }),
  ];
  for (const state of states) {
    assert.deepEqual(
      Object.keys(state).sort(),
      ['action', 'busy', 'challengeId', 'completed', 'enabled', 'error', 'stage', 'statusFailed'],
    );
  }
});

test('status failure is recoverable and does not unlock actions', () => {
  const failed = run(flow.initialTwoFactorState, { type: 'statusFailed' });
  assert.equal(failed.statusFailed, true);
  assert.equal(run(failed, { type: 'begin', action: 'enable' }).stage, 'idle');
  assert.equal(run(failed, { type: 'statusLoaded', enabled: false }).statusFailed, false);
});

test('otp normalisation keeps six digits and masks the address for display', () => {
  assert.equal(flow.normalizeOtpCode('12 34-56'), '123456');
  assert.equal(flow.normalizeOtpCode('1234567890'), '123456');
  assert.equal(flow.normalizeOtpCode('abc'), '');
  assert.equal(flow.normalizeOtpCode(null), '');
  assert.equal(flow.isCompleteOtp('123 456'), true);
  assert.equal(flow.isCompleteOtp('12345'), false);
  assert.equal(flow.maskEmail('student@example.edu'), 's***@example.edu');
  assert.equal(flow.maskEmail('plain'), 'p***');
  assert.equal(flow.maskEmail(undefined), '');
});

test('failures map to specific, safe message keys', () => {
  const key = (error, step) => flow.twoFactorErrorKey(errors.classifyError(error), step);
  assert.equal(key({ status: 400, code: 'TWO_FACTOR_CODE_INVALID' }, 'code'), 'codeInvalid');
  assert.equal(key({ status: 400, code: 'TWO_FACTOR_CODE_LOCKED' }, 'code'), 'codeLocked');
  assert.equal(key({ status: 400, code: 'TWO_FACTOR_CODE_EXPIRED' }, 'code'), 'codeExpired');
  assert.equal(key({ status: 400, code: 'TWO_FACTOR_CHALLENGE_INVALID' }, 'code'), 'challengeInvalid');
  assert.equal(key({ status: 409, code: 'TWO_FACTOR_ALREADY_ENABLED' }, 'password'), 'alreadyEnabled');
  assert.equal(key({ status: 409, code: 'TWO_FACTOR_NOT_ENABLED' }, 'password'), 'notEnabled');
  assert.equal(key({ status: 502, code: 'MAIL_DELIVERY_FAILED' }, 'password'), 'mailFailed');
  assert.equal(key({ status: 502 }, 'password'), 'mailFailed');
  assert.equal(key({ status: 400 }, 'password'), 'passwordIncorrect', 'bare 400 at the password step');
  assert.equal(key({ status: 400 }, 'code'), 'failed');
  assert.equal(key({ status: 429 }, 'code'), 'rateLimited');
  assert.equal(key({ status: 0 }, 'code'), 'network');
  assert.equal(key({ status: 401 }, 'code'), 'unauthorized');
  assert.equal(key({ status: 500 }, 'code'), 'failed');
});

test('exit notice is delivered once and defaults to a plain sign-out', () => {
  assert.equal(notice.takeExitNotice(), 'signedOut');
  notice.setExitNotice('passwordChanged');
  assert.equal(notice.takeExitNotice(), 'passwordChanged');
  assert.equal(notice.takeExitNotice(), 'signedOut');
});

test('profile screen guards destructive actions behind a confirmation', () => {
  const profile = fs.readFileSync(path.join(mobileRoot, 'src/screens/student/ProfileScreen.tsx'), 'utf8');
  assert.match(profile, /setConfirmPasswordChange\(true\)/);
  assert.match(profile, /<SignOutDialog/);
  assert.match(profile, /endSession\('signedOut'\)/);
  assert.match(profile, /endSession\('passwordChanged'\)/);
  assert.doesNotMatch(profile, /onPress=\{navigation\.signOut\}/);
  const card = fs.readFileSync(path.join(mobileRoot, 'src/screens/account/TwoFactorCard.tsx'), 'utf8');
  assert.match(card, /confirmDisable/);
  assert.match(card, /setPassword\(''\)/);
  assert.match(card, /setCode\(''\)/);
});
