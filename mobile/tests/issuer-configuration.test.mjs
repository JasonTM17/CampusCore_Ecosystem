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

function resolveIssuer(value, development, platform) {
  return makeDefaultIssuer(
    { env: { EXPO_PUBLIC_ISSUER_URL: value } },
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
