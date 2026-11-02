import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  LOCAL_ISSUER_HOSTS,
  PRODUCTION_UNSET_KEYS,
  assertEasProfilePolicy,
  collectProfileViolations,
  containsPublicHost,
  parseEasJson,
  readEasConfig,
} from './eas-profile-check.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const eas = readEasConfig(repoRoot);

function fixture(overrides = {}) {
  return {
    cli: { version: '>= 15.0.0', appVersionSource: 'remote' },
    build: {
      development: {},
      preview: {},
      local: {},
      production: { autoIncrement: true },
      ...overrides,
    },
  };
}

function codes(violations) {
  return violations.map(({ code }) => code);
}

test('mobile/eas.json is valid JSON with the four build profiles', () => {
  assert.equal(typeof eas, 'object');
  assert.deepEqual(Object.keys(eas.build).sort(), ['development', 'local', 'preview', 'production']);
  assert.doesNotThrow(() => assertEasProfilePolicy(eas));
});

test('the checked-in profiles pass the whole local-first policy', () => {
  assert.deepEqual(collectProfileViolations(eas), []);
});

test('development and preview carry no campusute.io.vn host', () => {
  for (const profile of ['development', 'preview']) {
    const env = eas.build[profile].env ?? {};
    for (const [key, value] of Object.entries(env)) {
      assert.equal(
        containsPublicHost(value),
        false,
        `${profile}.${key} must not reference campusute.io.vn`,
      );
    }
  }
  assert.equal(containsPublicHost('https://www.campusute.io.vn/api/v1'), true);
  assert.equal(containsPublicHost('https://campusute.io.vn'), true);
  assert.equal(containsPublicHost('https://www.campusute.io.vn.evil.test/api'), true);
  assert.equal(containsPublicHost('http://10.0.2.2:4010/api/v1'), false);
});

test('production leaves API, portal and issuer literals unset', () => {
  const env = eas.build.production.env ?? {};
  for (const key of PRODUCTION_UNSET_KEYS) {
    assert.equal(Object.prototype.hasOwnProperty.call(env, key), false, `${key} must stay unset`);
  }
});

test('the local profile pins the documented Android-emulator values', () => {
  const env = eas.build.local.env;
  assert.equal(env.CAMPUSUTE_MOBILE_PROFILE, 'local');
  assert.equal(env.EXPO_PUBLIC_API_MODE, 'live');
  assert.equal(env.EXPO_PUBLIC_API_URL, 'http://10.0.2.2:4010/api/v1');
  assert.equal(env.EXPO_PUBLIC_ISSUER_URL, 'http://10.0.2.2:4010');
  assert.equal(env.EXPO_PUBLIC_ALLOW_CLEARTEXT_LOCAL, '1');
});

test('every documented local issuer host is accepted', () => {
  for (const issuer of ['http://id.localhost:4443', 'http://10.0.2.2:4010', 'http://127.0.0.1:4010']) {
    const config = fixture({ local: { env: { EXPO_PUBLIC_ISSUER_URL: issuer } } });
    assert.deepEqual(collectProfileViolations(config), [], `${issuer} must be accepted`);
  }
  assert.deepEqual([...LOCAL_ISSUER_HOSTS], ['id.localhost', '10.0.2.2', '127.0.0.1']);
});

test('detects an inherited public API host in preview', () => {
  const config = fixture({
    preview: { env: { EXPO_PUBLIC_API_URL: 'https://www.campusute.io.vn/api/v1' } },
  });
  const violations = collectProfileViolations(config);
  assert.deepEqual(codes(violations), ['public-host']);
  assert.equal(violations[0].profile, 'preview');
  assert.equal(violations[0].key, 'env.EXPO_PUBLIC_API_URL');
});

test('detects an inherited public issuer host in development', () => {
  const config = fixture({
    development: {
      env: {
        EXPO_PUBLIC_ISSUER_URL: 'https://www.campusute.io.vn',
        EXPO_PUBLIC_PORTAL_URL: 'https://www.campusute.io.vn',
      },
    },
  });
  const violations = collectProfileViolations(config);
  assert.deepEqual(codes(violations).sort(), ['issuer-host', 'public-host', 'public-host'].sort());
  assert.ok(violations.some(({ profile }) => profile === 'development'));
});

test('detects production deployment literals', () => {
  const env = {
    EXPO_PUBLIC_API_URL: 'https://www.campusute.io.vn/api/v1',
    EXPO_PUBLIC_PORTAL_URL: 'https://www.campusute.io.vn',
    EXPO_PUBLIC_ISSUER_URL: 'https://www.campusute.io.vn',
  };
  const violations = collectProfileViolations(fixture({ production: { autoIncrement: true, env } }));
  assert.deepEqual(codes(violations), ['production-literal', 'production-literal', 'production-literal']);
  assert.deepEqual(
    violations.map(({ key }) => key).sort(),
    [...PRODUCTION_UNSET_KEYS].sort(),
  );
});

test('rejects issuer hosts outside the documented local list', () => {
  for (const issuer of [
    'https://id.localhost:4443',
    'http://id.example.edu:4443',
    'http://portal.localhost:3102',
    'not-a-url',
  ]) {
    const config = fixture({ local: { env: { EXPO_PUBLIC_ISSUER_URL: issuer } } });
    const found = collectProfileViolations(config);
    assert.ok(found.length > 0, `${issuer} must be rejected`);
    assert.ok(
      found.some(({ code }) => code === 'issuer-host' || code === 'issuer-url'),
      `${issuer} must fail as an issuer value`,
    );
  }
});

test('rejects a public host that sneaks into the local profile', () => {
  const config = fixture({
    local: {
      env: {
        EXPO_PUBLIC_API_URL: 'https://www.campusute.io.vn/api/v1',
        EXPO_PUBLIC_PORTAL_URL: 'https://www.campusute.io.vn',
      },
    },
  });
  assert.deepEqual(codes(collectProfileViolations(config)), ['local-host', 'local-host']);
});

test('rejects malformed eas.json instead of guessing a default', () => {
  assert.throws(
    () => parseEasJson('{ "build": ', 'fixture.eas.json'),
    /fixture\.eas\.json is not valid JSON/,
  );
  assert.deepEqual(codes(collectProfileViolations({ cli: {} })), ['build-missing']);
});
