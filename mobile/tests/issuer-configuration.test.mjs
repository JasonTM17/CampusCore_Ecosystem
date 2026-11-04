import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mobileSessionSource = fs.readFileSync(path.join(mobileRoot, 'src/auth/mobile-session-store.ts'), 'utf8');
const oidcSessionSource = fs.readFileSync(path.join(mobileRoot, 'src/auth/oidc-session.ts'), 'utf8');
const defaultIssuerMatch = mobileSessionSource.match(/function defaultIssuer\(\): string \{[\s\S]*?\n\}/);
assert.ok(defaultIssuerMatch, 'mobile-session-store.ts must define defaultIssuer()');
const defaultIssuerSource = defaultIssuerMatch[0].replace('function defaultIssuer(): string', 'function defaultIssuer()');
const makeDefaultIssuer = new Function('process', 'Platform', '__DEV__', `return (${defaultIssuerSource});`);

function resolveIssuer(value, development, platform, allowCleartextLocal = false) {
  return makeDefaultIssuer(
    { env: { EXPO_PUBLIC_ISSUER_URL: value, EXPO_PUBLIC_ALLOW_CLEARTEXT_LOCAL: allowCleartextLocal ? '1' : undefined } },
    { OS: platform },
    development,
  )();
}

test('development with an unset issuer keeps the platform loopback fallback', () => {
  assert.equal(resolveIssuer(undefined, true, 'android'), 'http://10.0.2.2:4010');
  assert.equal(resolveIssuer(undefined, true, 'ios'), 'http://127.0.0.1:4010');
});

test('release with an unset or blank issuer stays empty', () => {
  assert.equal(resolveIssuer(undefined, false, 'android'), '');
  assert.equal(resolveIssuer('', false, 'android'), '');
  assert.equal(resolveIssuer('   ', false, 'ios'), '');
});

test('sign-in returns a typed configuration error before PKCE', () => {
  const typedGuard = /if\s*\(!issuer\)\s*\{\s*return\s*\{\s*kind:\s*'unavailable',\s*code:\s*'issuer_not_configured'\s*\};\s*\}/;
  assert.match(oidcSessionSource, typedGuard);
  const guardPosition = oidcSessionSource.search(typedGuard);
  const pkcePosition = oidcSessionSource.indexOf('await buildCodeAsync()');
  assert.ok(pkcePosition > guardPosition, 'issuer configuration must be checked before PKCE/browser work');
});

test('a configured issuer remains available with trailing slashes trimmed', () => {
  assert.equal(resolveIssuer('https://id.example///', false, 'android'), 'https://id.example');
});

test('release rejects a remote cleartext issuer even with local opt-in', () => {
  assert.equal(resolveIssuer('http://auth.example.com', false, 'android'), '');
  assert.equal(resolveIssuer('http://auth.example.com', false, 'android', true), '');
  assert.equal(resolveIssuer('http://localhost.evil.test', false, 'android', true), '');
});

test('release loopback HTTP requires explicit opt-in and development keeps LAN access', () => {
  for (const host of ['localhost', '127.0.0.1', '10.0.2.2', '[::1]']) {
    assert.equal(resolveIssuer(`http://${host}:4010`, false, 'android'), '');
    assert.equal(resolveIssuer(`http://${host}:4010`, false, 'android', true), `http://${host}:4010`);
  }
  assert.equal(resolveIssuer('http://192.168.1.20:4010', true, 'android'), 'http://192.168.1.20:4010');
});

test('invalid issuer configuration is unavailable without throwing or exposing URL credentials', () => {
  for (const value of ['not a URL', 'file:///tmp/issuer', 'https://user:secret@issuer.test', 'https://issuer.test?token=secret', 'https://issuer.test#fragment']) {
    assert.equal(resolveIssuer(value, false, 'android'), '');
  }
});
