const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '..');
const repoRoot = path.resolve(root, '..');

const DENY_ALL = 'camera=(), microphone=(), geolocation=(), payment=(), usb=()';
const CHECKIN_SELF = 'camera=(), microphone=(), geolocation=(self), payment=(), usb=()';

async function headerEntries() {
  const cfg = (await import(pathToFileURL(path.join(root, 'next.config.mjs')).href)).default;
  return cfg.headers();
}

/** Translate a Next `headers()` source pattern into a matcher for real paths. */
function sourceRegExp(source) {
  return new RegExp(
    '^'
    + source
        .replace(/\/:path\*$/g, '(?:/.*)?')
        .replace(/:locale\(en\|vi\)/g, '(?:en|vi)')
    + '$',
  );
}

/** Effective Permissions-Policy for a path: the last matching entry wins. */
function permissionsPolicyFor(entries, pathname) {
  let value;
  for (const entry of entries) {
    const header = entry.headers.find((item) => item.key === 'Permissions-Policy');
    if (header && sourceRegExp(entry.source).test(pathname)) {
      value = header.value;
    }
  }
  return value;
}

test('the check-in surface permits same-origin geolocation at both locale prefixes', async () => {
  const entries = await headerEntries();

  for (const pathname of [
    '/attendance/checkin',
    '/attendance/checkin/session-1',
    '/en/attendance/checkin/session-1',
    '/vi/attendance/checkin/session-1',
  ]) {
    assert.equal(
      permissionsPolicyFor(entries, pathname),
      CHECKIN_SELF,
      `${pathname} must allow geolocation=(self) only`,
    );
  }
});

test('every other path keeps the geolocation denial', async () => {
  const entries = await headerEntries();

  for (const pathname of [
    '/',
    '/staff',
    '/dashboard',
    '/attendance',
    '/attendance/checkin-evil',
    '/de/attendance/checkin/session-1',
    '/library/desk',
    '/apply/review',
    '/careers/desk',
  ]) {
    assert.equal(
      permissionsPolicyFor(entries, pathname),
      DENY_ALL,
      `${pathname} must keep geolocation=()`,
    );
  }
});

test('the policy is narrowly scoped: only the two check-in sources carry the allowance', async () => {
  const entries = await headerEntries();
  const policyEntries = entries
    .map((entry, index) => ({
      index,
      source: entry.source,
      value: entry.headers.find((item) => item.key === 'Permissions-Policy')?.value,
    }))
    .filter((entry) => entry.value !== undefined);

  assert.deepEqual(
    policyEntries.map((entry) => entry.source),
    [
      '/(.*)',
      '/attendance/checkin/:path*',
      '/:locale(en|vi)/attendance/checkin/:path*',
    ],
    'exactly the catch-all plus the two check-in sources set Permissions-Policy',
  );

  const catchAll = policyEntries[0];
  assert.equal(catchAll.value, DENY_ALL, 'the catch-all keeps the full denial set');
  for (const scoped of policyEntries.slice(1)) {
    assert.equal(scoped.value, CHECKIN_SELF);
    assert.ok(scoped.index > catchAll.index, 'scoped entries must follow the catch-all to override it');
  }
});

test('no Permissions-Policy grants a wildcard or third-party origin', async () => {
  const entries = await headerEntries();
  for (const entry of entries) {
    for (const header of entry.headers) {
      if (header.key !== 'Permissions-Policy') continue;
      assert.doesNotMatch(header.value, /geolocation=\(\s*\*/, 'no geolocation=* wildcard');
      assert.doesNotMatch(header.value, /geolocation=\(\s*"https?:/i, 'no third-party geolocation origin');
      assert.match(header.value, /camera=\(\)/, 'camera stays denied');
      assert.match(header.value, /microphone=\(\)/, 'microphone stays denied');
      assert.match(header.value, /payment=\(\)/, 'payment stays denied');
      assert.match(header.value, /usb=\(\)/, 'usb stays denied');
    }
  }
});

test('the edge proxy mirrors the same scoped policy', () => {
  const caddy = fs.readFileSync(path.join(repoRoot, 'ops/caddy/Caddyfile'), 'utf8');
  const policyLines = caddy.split('\n').filter((line) => /^\s*header\s.*Permissions-Policy/.test(line));

  assert.equal(policyLines.length, 2, 'exactly two matcher-scoped Permissions-Policy directives');

  const checkinLine = policyLines.find((line) => line.includes('@geolocation_checkin'));
  const deniedLine = policyLines.find((line) => line.includes('@geolocation_denied'));
  assert.ok(checkinLine, 'a check-in-scoped directive exists');
  assert.ok(deniedLine, 'a denied-scoped directive exists');
  assert.match(checkinLine, /"camera=\(\), microphone=\(\), geolocation=\(self\)"/);
  assert.match(deniedLine, /"camera=\(\), microphone=\(\), geolocation=\(\)"/);

  // The check-in matcher covers the base route, its subpaths and both locale
  // mirrors; the denied matcher is its exact complement.
  const checkinMatcher = caddy.match(/@geolocation_checkin\s+path\s+([^\n]+)/);
  const deniedMatcher = caddy.match(/@geolocation_denied\s*\{\s*not\s+path\s+([^\n]+)/);
  assert.ok(checkinMatcher, '@geolocation_checkin must be a path matcher');
  assert.ok(deniedMatcher, '@geolocation_denied must be a not-path matcher');
  const expectedPaths = [
    '/attendance/checkin',
    '/attendance/checkin/*',
    '/en/attendance/checkin',
    '/en/attendance/checkin/*',
    '/vi/attendance/checkin',
    '/vi/attendance/checkin/*',
  ];
  for (const expected of expectedPaths) {
    assert.ok(checkinMatcher[1].includes(expected), `check-in matcher covers ${expected}`);
    assert.ok(deniedMatcher[1].includes(expected), `denied matcher excludes ${expected}`);
  }

  assert.doesNotMatch(caddy, /geolocation=\(\s*\*/, 'no edge-level geolocation wildcard');
  assert.doesNotMatch(caddy, /geolocation=\(\s*"https?:/i, 'no edge-level third-party geolocation');
});
