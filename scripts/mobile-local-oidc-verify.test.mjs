import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  base64url,
  s256,
  authorizeQuery,
  callbackParams,
  decodeJwtPayload,
} from './mobile-local-oidc-verify.mjs';

test('base64url strips padding and replaces non-url characters', () => {
  assert.equal(base64url(Buffer.from([0xfb, 0xff, 0x3e])), '-_8-');
  assert.ok(!base64url(Buffer.from('hello world')).includes('='));
});

test('s256 computes the RFC 7636 challenge', () => {
  const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
  const expected = createHash('sha256').update(verifier).digest('base64url');
  assert.equal(s256(verifier), expected);
});

test('authorizeQuery mirrors the mobile client request', () => {
  const query = authorizeQuery({ state: 'st', nonce: 'nn', challenge: 'cc' });
  const params = new URLSearchParams(query);
  assert.equal(params.get('response_type'), 'code');
  assert.equal(params.get('client_id'), 'cu-mobile');
  assert.equal(params.get('redirect_uri'), 'campuscore://auth/callback');
  assert.equal(params.get('scope'), 'openid profile email offline_access');
  assert.equal(params.get('code_challenge_method'), 'S256');
  assert.equal(params.get('state'), 'st');
  assert.equal(params.get('nonce'), 'nn');
});

test('callbackParams extracts code/state/error from the app scheme', () => {
  const ok = callbackParams('campuscore://auth/callback?code=abc&state=s1');
  assert.deepEqual(ok, { code: 'abc', state: 's1', error: null });
  const bad = callbackParams('campuscore://auth/callback?error=access_denied');
  assert.equal(bad.error, 'access_denied');
  assert.equal(bad.code, null);
});

test('decodeJwtPayload reads the middle segment', () => {
  const payload = Buffer.from(JSON.stringify({ iss: 'x', capabilities: ['a'] })).toString('base64url');
  const token = `head.${payload}.sig`;
  const decoded = decodeJwtPayload(token);
  assert.equal(decoded.iss, 'x');
  assert.deepEqual(decoded.capabilities, ['a']);
  assert.equal(decodeJwtPayload('not-a-jwt'), null);
});
