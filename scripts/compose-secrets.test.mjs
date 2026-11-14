#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { COMPOSE_SECRET_NAMES, ensureComposeSecrets } from './compose-secrets.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'compose-secrets-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function sequenceRandomBytes() {
  let value = 0;
  return (size) => Buffer.alloc(size, ++value);
}

test('fills only missing secrets with independent values and preserves custom volume credentials', (t) => {
  const root = fixture(t);
  const file = path.join(root, '.env');
  fs.writeFileSync(file, [
    'POSTGRES_PASSWORD=custom-existing-volume-password',
    'ASSISTANT_DB_PASSWORD=custom-runtime-role-password',
    'JWT_SECRET=',
    'JWT_REFRESH_SECRET=custom-refresh-secret-value',
    'UNKNOWN_SETTING=keep-me',
  ].join('\n') + '\n', 'utf8');

  const result = ensureComposeSecrets({ root, env: {}, randomBytes: sequenceRandomBytes() });
  const content = fs.readFileSync(file, 'utf8');
  const values = new Map([...content.matchAll(/^([A-Z][A-Z0-9_]*)=(.*)$/gm)].map((match) => [match[1], match[2]]));

  assert.deepEqual(result.generatedKeys, [
    'ASSISTANT_DB_PROVISIONER_PASSWORD',
    'HEALTH_READINESS_KEY',
    'JWT_SECRET',
    'ASSISTANT_RAG_SERVICE_TOKEN',
    'ASSISTANT_RAG_OWNER_ASSERTION_SECRET',
    'INTERNAL_SERVICE_TOKEN',
    'SSO_PREVIEW_PROXY_TOKEN',
    'IDENTITY_TOKEN_ENCRYPTION_KEY',
    'SSO_PREVIEW_PORTAL_CLIENT_SECRET',
    'SSO_PREVIEW_PORTAL_PROXY_SECRET',
    'SSO_PREVIEW_LEARN_CLIENT_SECRET',
    'SSO_PREVIEW_LEARN_PROXY_SECRET',
    'SSO_PREVIEW_APPLY_CLIENT_SECRET',
    'SSO_PREVIEW_APPLY_PROXY_SECRET',
  ]);
  assert.equal(values.get('POSTGRES_PASSWORD'), 'custom-existing-volume-password');
  assert.equal(values.get('ASSISTANT_DB_PASSWORD'), 'custom-runtime-role-password');
  assert.equal(values.get('JWT_REFRESH_SECRET'), 'custom-refresh-secret-value');
  assert.equal(values.get('UNKNOWN_SETTING'), 'keep-me');
  const generated = result.generatedKeys.map((name) => values.get(name));
  assert.equal(new Set(generated).size, generated.length, 'each missing key receives an independent random value');
  assert.ok(generated.every((value) => value.length >= 32));
  assert.equal(JSON.stringify(result).includes(generated[0]), false, 'the result never returns a secret value');
});

test('replaces recognized published Compose and E2E secrets', (t) => {
  const root = fixture(t);
  const file = path.join(root, '.env');
  const published = new Map([
    ['POSTGRES_PASSWORD', 'campuscore_password'],
    ['ASSISTANT_DB_PASSWORD', 'dev-only-not-a-secret-16+'],
    ['HEALTH_READINESS_KEY', 'local-course-health-key'],
    ['JWT_SECRET', 'local-course-jwt-secret-change-me'],
    ['JWT_REFRESH_SECRET', 'edge-e2e-refresh-secret-0123456789abcdef'],
    ['ASSISTANT_RAG_SERVICE_TOKEN', 'dev-rag-service-token-rotate-before-exposing'],
    ['ASSISTANT_RAG_OWNER_ASSERTION_SECRET', 'dev-ci-owner-assertion-not-a-secret'],
    ['INTERNAL_SERVICE_TOKEN', 'edge-e2e-internal-service-token-12345'],
  ]);
  fs.writeFileSync(file, [...published].map(([name, value]) => `${name}=${value}`).join('\n') + '\n', 'utf8');

  const result = ensureComposeSecrets({ root, env: {}, randomBytes: sequenceRandomBytes() });
  const content = fs.readFileSync(file, 'utf8');

  assert.deepEqual(result.generatedKeys, [...COMPOSE_SECRET_NAMES]);
  for (const value of published.values()) assert.equal(content.includes(value), false);
});

test('replaces the required secrets published by the previous env template', (t) => {
  const root = fixture(t);
  const file = path.join(root, '.env');
  const published = new Map([
    ['POSTGRES_PASSWORD', 'replace-with-a-local-course-password'],
    ['JWT_SECRET', 'replace-with-a-long-random-access-secret'],
    ['JWT_REFRESH_SECRET', 'replace-with-a-long-random-refresh-secret'],
  ]);
  fs.writeFileSync(file, [...published].map(([name, value]) => `${name}=${value}`).join('\n') + '\n', 'utf8');

  const result = ensureComposeSecrets({ root, env: {}, randomBytes: sequenceRandomBytes() });
  const content = fs.readFileSync(file, 'utf8');

  for (const name of published.keys()) assert.ok(result.generatedKeys.includes(name), `${name} must be regenerated`);
  for (const value of published.values()) assert.equal(content.includes(value), false);
});

test('generates SSO preview credentials and rotates the previously published values', (t) => {
  const root = fixture(t);
  const file = path.join(root, '.env');
  const published = new Map([
    ['SSO_PREVIEW_PROXY_TOKEN', 'sso-preview-proxy-token-0123456789'],
    ['IDENTITY_TOKEN_ENCRYPTION_KEY', 'dGVzdC1rZXktMDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY='],
    ['SSO_PREVIEW_PORTAL_CLIENT_SECRET', 'sso-preview-portal-secret-0123456789ab'],
    ['SSO_PREVIEW_PORTAL_PROXY_SECRET', 'sso-preview-portal-proxy-0123456789abcd'],
    ['SSO_PREVIEW_LEARN_CLIENT_SECRET', 'sso-preview-learn-secret-0123456789abc'],
    ['SSO_PREVIEW_LEARN_PROXY_SECRET', 'sso-preview-learn-proxy-0123456789abcde'],
    ['SSO_PREVIEW_APPLY_CLIENT_SECRET', 'sso-preview-apply-secret-0123456789abd'],
    ['SSO_PREVIEW_APPLY_PROXY_SECRET', 'sso-preview-apply-proxy-0123456789abcdef'],
  ]);
  fs.writeFileSync(file, [...published].map(([name, value]) => `${name}=${value}`).join('\n') + '\n', 'utf8');

  const result = ensureComposeSecrets({ root, env: {}, randomBytes: sequenceRandomBytes() });
  const content = fs.readFileSync(file, 'utf8');
  const values = new Map([...content.matchAll(/^([A-Z][A-Z0-9_]*)=(.*)$/gm)].map((match) => [match[1], match[2]]));

  for (const [name, value] of published) {
    assert.ok(result.generatedKeys.includes(name), `${name} must be generated`);
    assert.equal(content.includes(value), false, `${name} must not keep its published value`);
  }
  assert.equal(Buffer.from(values.get('IDENTITY_TOKEN_ENCRYPTION_KEY'), 'base64').length, 32);
});

test('replaces published defaults followed by dotenv inline comments', (t) => {
  const root = fixture(t);
  const file = path.join(root, '.env');
  fs.writeFileSync(file, [
    'POSTGRES_PASSWORD=campuscore_password # legacy bootstrap default',
    'ASSISTANT_DB_PASSWORD="dev-only-not-a-secret-16+" # legacy runtime default',
  ].join('\n') + '\n', 'utf8');

  const result = ensureComposeSecrets({ root, env: {}, randomBytes: sequenceRandomBytes() });
  const content = fs.readFileSync(file, 'utf8');

  assert.ok(result.generatedKeys.includes('POSTGRES_PASSWORD'));
  assert.ok(result.generatedKeys.includes('ASSISTANT_DB_PASSWORD'));
  assert.doesNotMatch(content, /campuscore_password|dev-only-not-a-secret-16\+/);
});

test('replaces inherited published defaults and persists custom shell values', (t) => {
  const root = fixture(t);
  const file = path.join(root, '.env');
  fs.writeFileSync(file, 'POSTGRES_PASSWORD=campuscore_password\nASSISTANT_DB_PASSWORD=\n', 'utf8');
  const env = {
    POSTGRES_PASSWORD: 'campuscore_password',
    ASSISTANT_DB_PASSWORD: 'custom-shell-runtime-password',
  };
  const result = ensureComposeSecrets({ root, env, randomBytes: sequenceRandomBytes() });
  const content = fs.readFileSync(file, 'utf8');

  assert.ok(result.generatedKeys.includes('POSTGRES_PASSWORD'));
  assert.ok(!result.generatedKeys.includes('ASSISTANT_DB_PASSWORD'));
  assert.notEqual(env.POSTGRES_PASSWORD, 'campuscore_password');
  assert.match(content, new RegExp(`^POSTGRES_PASSWORD=${env.POSTGRES_PASSWORD}$`, 'm'));
  assert.match(content, /^ASSISTANT_DB_PASSWORD=custom-shell-runtime-password$/m);
  assert.equal(env.ASSISTANT_DB_PASSWORD, 'custom-shell-runtime-password');
  assert.doesNotMatch(content, /campuscore_password/);
});

test('creates the ignored dotenv from its template and writes with owner-only intent', (t) => {
  const root = fixture(t);
  const template = path.join(root, '.env.example');
  const file = path.join(root, '.env');
  fs.writeFileSync(template, '# checkout values\nPOSTGRES_PASSWORD=\nCUSTOM_PORT=15432\n', 'utf8');
  let writeOptions;
  let chmodMode;
  const fsOps = {
    existsSync: fs.existsSync,
    readFileSync: fs.readFileSync,
    writeFileSync(target, content, options) {
      writeOptions = options;
      return fs.writeFileSync(target, content, options);
    },
    chmodSync(target, mode) {
      chmodMode = mode;
      return fs.chmodSync(target, mode);
    },
  };

  const result = ensureComposeSecrets({ root, fs: fsOps, env: {}, randomBytes: sequenceRandomBytes() });
  const content = fs.readFileSync(file, 'utf8');

  assert.equal(fs.existsSync(file), true);
  assert.match(content, /^# checkout values/m);
  assert.match(content, /^CUSTOM_PORT=15432$/m);
  assert.deepEqual(writeOptions, { encoding: 'utf8', mode: 0o600 });
  assert.equal(chmodMode, 0o600);
  assert.equal(result.path, file);
});
