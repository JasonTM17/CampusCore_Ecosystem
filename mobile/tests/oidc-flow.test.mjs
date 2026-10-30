import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import { fileURLToPath, pathToFileURL } from 'node:url';

const mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Pure OIDC core (contract §8 mobile-unit) — transpile + execute, the same
// convention as session-storage.test.mjs.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cu-oidc-'));
const src = fs.readFileSync(path.join(mobileRoot, 'src/auth/oidc-core.ts'), 'utf8');
const { outputText } = ts.transpileModule(src, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  fileName: 'oidc-core.ts',
});
fs.writeFileSync(path.join(tmp, 'oidc-core.mjs'), outputText);
const {
  OIDC_CLIENT_ID,
  OIDC_REDIRECT_URI,
  OIDC_SCOPES,
  buildAuthorizeUrl,
  buildTokenRequestBody,
  decodeJwtPayload,
  parseCallbackUrl,
  roleFromClaims,
  verifyIdToken,
} = await import(pathToFileURL(path.join(tmp, 'oidc-core.mjs')).href);

const b64url = (value) =>
  Buffer.from(typeof value === 'string' ? value : JSON.stringify(value))
    .toString('base64url');
const jwt = (payload) => `${b64url({ alg: 'none' })}.${b64url(payload)}.sig`;

const ISSUER = 'http://10.0.2.2:4010';
const NOW = 1_800_000_000;

test('authorize URL carries the exact contract shape (§3/§7.6)', () => {
  const url = buildAuthorizeUrl({
    issuer: `${ISSUER}/`,
    codeChallenge: 'CHALLENGE',
    state: 'STATE',
    nonce: 'NONCE',
  });
  const parsed = new URL(url);
  assert.equal(parsed.origin, ISSUER);
  assert.equal(parsed.pathname, '/oauth2/authorize');
  assert.equal(parsed.searchParams.get('response_type'), 'code');
  assert.equal(parsed.searchParams.get('client_id'), OIDC_CLIENT_ID);
  assert.equal(parsed.searchParams.get('redirect_uri'), OIDC_REDIRECT_URI);
  assert.equal(parsed.searchParams.get('scope'), OIDC_SCOPES);
  assert.deepEqual(OIDC_SCOPES.split(' '), ['openid', 'profile', 'email', 'offline_access']);
  assert.equal(parsed.searchParams.get('code_challenge'), 'CHALLENGE');
  assert.equal(parsed.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(parsed.searchParams.get('state'), 'STATE');
  assert.equal(parsed.searchParams.get('nonce'), 'NONCE');
});

test('callback parsing: state verified before code is accepted', () => {
  const good = parseCallbackUrl(`${OIDC_REDIRECT_URI}?code=abc&state=S1`, 'S1');
  assert.deepEqual(good, { kind: 'code', code: 'abc' });

  // A plausible code under a mismatched state is rejected outright.
  const forged = parseCallbackUrl(`${OIDC_REDIRECT_URI}?code=abc&state=S2`, 'S1');
  assert.equal(forged.kind, 'state-mismatch');

  const missingState = parseCallbackUrl(`${OIDC_REDIRECT_URI}?code=abc`, 'S1');
  assert.equal(missingState.kind, 'state-mismatch');

  const noCode = parseCallbackUrl(`${OIDC_REDIRECT_URI}?state=S1`, 'S1');
  assert.equal(noCode.kind, 'blocked');

  const denied = parseCallbackUrl(
    `${OIDC_REDIRECT_URI}?error=access_denied&error_description=suspended&state=S1`,
    'S1',
  );
  assert.deepEqual(denied, { kind: 'blocked', reason: 'Authorization was rejected.' });
});

test('callback query is parsed separately from the fragment', () => {
  assert.deepEqual(parseCallbackUrl(`${OIDC_REDIRECT_URI}?state=S1&code=abc#ignored`, 'S1'), { kind: 'code', code: 'abc' });
  assert.deepEqual(parseCallbackUrl(`${OIDC_REDIRECT_URI}?code=abc&state=S1#ignored`, 'S1'), { kind: 'code', code: 'abc' });
  assert.notEqual(parseCallbackUrl(`${OIDC_REDIRECT_URI}#?state=S1&code=abc`, 'S1').kind, 'code');
});

test('callback rejects ambiguous, malformed and control-bearing parameters', () => {
  for (const query of [
    'state=S1&state=S1&code=abc', 'state=S1&code=a&code=b',
    'state=S1&code=', 'state=S1&code=%00abc', 'state=S1&code=abc%0d%0a',
    'state=S1&code=%ZZ', 'state=S1&code=%C0%AF',
    'state=S1&code=abc&error=access_denied',
    'state=S1&error=a&error=b', 'state=S1&code=abc&extra=%7f',
    'state=S1&code=abc\n',
  ]) {
    assert.notEqual(parseCallbackUrl(`${OIDC_REDIRECT_URI}?${query}`, 'S1').kind, 'code');
  }
  assert.equal(parseCallbackUrl(`${OIDC_REDIRECT_URI}?error=access_denied&state=wrong`, 'S1').kind, 'state-mismatch');
  const result = parseCallbackUrl(`${OIDC_REDIRECT_URI}?state=S1&error=access_denied&error_description=private-detail`, 'S1');
  assert.equal(result.kind, 'blocked');
  assert.ok(!result.reason.includes('private-detail'));
});

test('token request body exchanges code + PKCE verifier as cu-mobile', () => {
  const body = buildTokenRequestBody('CODE', 'VERIFIER');
  const params = new URLSearchParams(body);
  assert.equal(params.get('grant_type'), 'authorization_code');
  assert.equal(params.get('code'), 'CODE');
  assert.equal(params.get('redirect_uri'), OIDC_REDIRECT_URI);
  assert.equal(params.get('client_id'), OIDC_CLIENT_ID);
  assert.equal(params.get('code_verifier'), 'VERIFIER');
});

test('decodeJwtPayload decodes without atob and rejects malformed input', () => {
  assert.deepEqual(decodeJwtPayload(jwt({ sub: 'u1', n: 1 })), { sub: 'u1', n: 1 });
  // UTF-8 payloads survive (vi names in claims).
  assert.equal(decodeJwtPayload(jwt({ name: 'Nguyễn Văn' })).name, 'Nguyễn Văn');
  assert.equal(decodeJwtPayload('not-a-jwt'), null);
  assert.equal(decodeJwtPayload('a.@@@.c'), null);
  assert.equal(decodeJwtPayload(`${b64url('x')}.not-json.sig`), null);
});

test('id_token verification enforces nonce/aud/iss/exp/sub (§7.6)', () => {
  const base = { nonce: 'N', aud: OIDC_CLIENT_ID, iss: ISSUER, exp: NOW + 600, sub: 'user-1' };
  const expected = { nonce: 'N', issuer: ISSUER, nowSeconds: NOW };

  assert.deepEqual(verifyIdToken(jwt(base), expected), { accountId: 'user-1' });
  // aud as an array is also accepted.
  assert.deepEqual(
    verifyIdToken(jwt({ ...base, aud: ['other', OIDC_CLIENT_ID] }), expected),
    { accountId: 'user-1' },
  );

  for (const [label, claims, want] of [
    ['nonce mismatch', { ...base, nonce: 'WRONG' }, /nonce mismatch/],
    ['wrong audience', { ...base, aud: 'cu-web' }, /audience/],
    ['wrong issuer', { ...base, iss: 'https://evil.example' }, /issuer mismatch/],
    ['expired', { ...base, exp: NOW - 1 }, /expired/],
    ['missing sub', { ...base, sub: undefined }, /subject/],
  ]) {
    const result = verifyIdToken(jwt(claims), expected);
    assert.ok('error' in result, label);
    assert.match(result.error, want, label);
  }

  assert.ok('error' in verifyIdToken(undefined, expected));
  assert.ok('error' in verifyIdToken('a.b', expected));
});

test('role precedence is LECTURER → STUDENT → ADMIN-web-only (KM-8)', () => {
  assert.equal(roleFromClaims(['LECTURER', 'ADMIN']), 'lecturer');
  assert.equal(roleFromClaims(['STUDENT', 'ADMIN']), 'student');
  assert.equal(roleFromClaims(['STUDENT']), 'student');
  assert.equal(roleFromClaims(['FACULTY']), 'lecturer');
  assert.equal(roleFromClaims(['ADMIN']), 'admin');
  assert.equal(roleFromClaims(['SUPER_ADMIN']), 'admin');
  assert.equal(roleFromClaims(['PARENT']), null);
  assert.equal(roleFromClaims([]), null);
});

test('dean and department-head claims never select a lane on their own', () => {
  assert.equal(roleFromClaims(['TRUONG_KHOA']), null);
  assert.equal(roleFromClaims(['TRUONG_BO_MON']), null);
  assert.equal(roleFromClaims(['LECTURER', 'TRUONG_BO_MON']), 'lecturer');
  assert.equal(roleFromClaims(['STUDENT', 'TRUONG_KHOA']), 'student');
  assert.equal(roleFromClaims(['truong_khoa', 'admin']), 'admin');
});
