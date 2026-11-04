#!/usr/bin/env node

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function requiredVariables(composeFile) {
  const source = readFileSync(path.join(repoRoot, composeFile), 'utf8');
  return [...source.matchAll(/\$\{([A-Z][A-Z0-9_]*):\?/g)].map((match) => match[1]);
}

function composeServices() {
  const source = readFileSync(path.join(repoRoot, 'docker-compose.yml'), 'utf8');
  const services = new Set();
  let inServices = false;
  for (const line of source.split(/\r?\n/)) {
    if (/^services:\s*$/.test(line)) {
      inServices = true;
      continue;
    }
    if (!inServices) continue;
    if (/^\S/.test(line)) break;
    const match = /^ {2}([A-Za-z0-9][A-Za-z0-9_-]*):\s*$/.exec(line);
    if (match) services.add(match[1]);
  }
  return services;
}

test('base Compose requires each runtime secret and keeps demo credentials disabled', () => {
  const base = readFileSync(path.join(repoRoot, 'docker-compose.yml'), 'utf8');
  const required = [...new Set(requiredVariables('docker-compose.yml'))].sort();
  assert.deepEqual(required, [
    'ASSISTANT_DB_PASSWORD',
    'ASSISTANT_RAG_OWNER_ASSERTION_SECRET',
    'ASSISTANT_RAG_SERVICE_TOKEN',
    'HEALTH_READINESS_KEY',
    'JWT_REFRESH_SECRET',
    'JWT_SECRET',
    'POSTGRES_PASSWORD',
  ]);
  const overlay = readFileSync(path.join(repoRoot, 'docker-compose.local.yml'), 'utf8');
  assert.match(base, /SECURITY_JWT_REJECT_KNOWN_DEFAULTS: "true"/);
  assert.match(base, /DEMO_ACCOUNTS_ENABLED: "false"/);
  assert.match(base, /NEXT_PUBLIC_SHOW_DEMO_CREDENTIALS: \$\{NEXT_PUBLIC_SHOW_DEMO_CREDENTIALS:-\}/);
  assert.doesNotMatch(base, /password123|DEMO_ACCOUNTS_ENABLED:\s*\$\{/);
  assert.match(overlay, /DEMO_ACCOUNTS_ENABLED: \$\{DEMO_ACCOUNTS_ENABLED:-true\}/);
  assert.match(overlay, /DEMO_ACCOUNTS_ROLES: \$\{DEMO_ACCOUNTS_ROLES:-\}/);
  assert.match(overlay, /password123/);
});

test('base Compose rejects missing runtime secrets and resolves with demos disabled', (t) => {
  const version = spawnSync('docker', ['compose', 'version'], { encoding: 'utf8' });
  if (version.error || version.status !== 0) {
    t.skip('Docker Compose CLI is unavailable; static contract assertions still run');
    return;
  }

  const directory = mkdtempSync(path.join(os.tmpdir(), 'compose-contract-'));
  try {
    const envPath = path.join(directory, 'compose.env');
    const env = { ...process.env };
    const names = [...new Set(requiredVariables('docker-compose.yml'))];
    for (const name of names) delete env[name];
    env.ASSISTANT_RAG_OWNER_ASSERTION_SECRET = 'ci-test-owner-assertion';
    writeFileSync(envPath, '', { encoding: 'utf8', mode: 0o600 });

    const missing = spawnSync('docker', [
      'compose', '--env-file', envPath, '-f', path.join(repoRoot, 'docker-compose.yml'), 'config', '-q',
    ], { cwd: repoRoot, env, encoding: 'utf8' });
    assert.notEqual(missing.status, 0, 'base Compose rejects absent runtime secrets');

    const values = Object.fromEntries(names.map((name) => [name, `ci-test-${name.toLowerCase()}`]));
    writeFileSync(envPath, Object.entries(values).map(([name, value]) => `${name}=${value}`).join('\n'), {
      encoding: 'utf8',
      mode: 0o600,
    });
    const configured = spawnSync('docker', [
      'compose', '--env-file', envPath, '-f', path.join(repoRoot, 'docker-compose.yml'), 'config', '--format', 'json',
    ], { cwd: repoRoot, env: { ...env, ...values }, encoding: 'utf8' });
    assert.equal(configured.status, 0, 'base Compose resolves when runtime secrets are supplied');
    const config = JSON.parse(configured.stdout);
    assert.equal(config.services['restful-api'].environment.DEMO_ACCOUNTS_ENABLED, 'false');
    assert.equal(config.services['rag-service'].environment.DEMO_ACCOUNTS_ENABLED, 'false');

    const local = spawnSync('docker', [
      'compose', '--env-file', envPath,
      '-f', path.join(repoRoot, 'docker-compose.yml'),
      '-f', path.join(repoRoot, 'docker-compose.local.yml'),
      'config', '-q',
    ], { cwd: repoRoot, env: { ...env, ...values }, encoding: 'utf8' });
    assert.equal(local.status, 0, 'base plus local overlay resolves with throwaway runtime secrets');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('local overlay honours an explicit demo switch and role scope', (t) => {
  const version = spawnSync('docker', ['compose', 'version'], { encoding: 'utf8' });
  if (version.error || version.status !== 0) {
    t.skip('Docker Compose CLI is unavailable; static contract assertions still run');
    return;
  }

  const directory = mkdtempSync(path.join(os.tmpdir(), 'compose-demo-'));
  try {
    const envPath = path.join(directory, 'compose.env');
    const env = { ...process.env };
    const names = [...new Set(requiredVariables('docker-compose.yml'))];
    for (const name of names) delete env[name];
    delete env.DEMO_ACCOUNTS_ENABLED;
    delete env.DEMO_ACCOUNTS_ROLES;
    const values = Object.fromEntries(names.map((name) => [name, `ci-test-${name.toLowerCase()}`]));
    const writeEnv = (extra) => writeFileSync(
      envPath,
      Object.entries({ ...values, ...extra }).map(([name, value]) => `${name}=${value}`).join('\n'),
      { encoding: 'utf8', mode: 0o600 },
    );
    const resolve = () => spawnSync('docker', [
      'compose', '--env-file', envPath,
      '-f', path.join(repoRoot, 'docker-compose.yml'),
      '-f', path.join(repoRoot, 'docker-compose.local.yml'),
      'config', '--format', 'json',
    ], { cwd: repoRoot, env, encoding: 'utf8' });

    writeEnv({ DEMO_ACCOUNTS_ENABLED: 'false', DEMO_ACCOUNTS_ROLES: 'STUDENT' });
    const explicit = resolve();
    assert.equal(explicit.status, 0, explicit.stderr);
    const explicitConfig = JSON.parse(explicit.stdout);
    for (const service of ['restful-api', 'rag-service']) {
      assert.equal(
        explicitConfig.services[service].environment.DEMO_ACCOUNTS_ENABLED,
        'false',
        `${service} must honour an explicit DEMO_ACCOUNTS_ENABLED`,
      );
      assert.equal(
        explicitConfig.services[service].environment.DEMO_ACCOUNTS_ROLES,
        'STUDENT',
        `${service} must forward DEMO_ACCOUNTS_ROLES`,
      );
    }

    writeEnv({});
    const defaults = resolve();
    assert.equal(defaults.status, 0, defaults.stderr);
    const defaultConfig = JSON.parse(defaults.stdout);
    for (const service of ['restful-api', 'rag-service']) {
      assert.equal(
        defaultConfig.services[service].environment.DEMO_ACCOUNTS_ENABLED,
        'true',
        `${service} keeps the overlay demo default when no value is set`,
      );
      assert.equal(
        defaultConfig.services[service].environment.DEMO_ACCOUNTS_ROLES,
        '',
        `${service} forwards an empty role scope when no value is set`,
      );
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('mobile overlay header uses the secret-generating runner', () => {
  const overlay = readFileSync(path.join(repoRoot, 'docker-compose.mobile-local.yml'), 'utf8');
  assert.match(overlay, /node scripts\/local-dev\.mjs up --mobile/);
  assert.doesNotMatch(overlay, /docker compose .*\bup\b/);
});

test('published-image smoke enables the demo accounts the checklist verifies', () => {
  const release = readFileSync(path.join(repoRoot, 'docs', 'RELEASE.md'), 'utf8');
  const smoke = release.split(/\r?\n/).find((line) => line.includes('--no-build'));
  assert.ok(smoke, 'docs/RELEASE.md must document the published-image smoke');
  assert.match(smoke, /-f docker-compose\.local\.yml/);
});

test('every host-side Compose stack runner uses the shared secret generator', () => {
  const runners = [
    'local-dev.mjs',
    'run-course-e2e.mjs',
    'bff-verify.mjs',
    'identity-verify.mjs',
    'platform-verify.mjs',
    'contract-verify.mjs',
    'ecosystem-fixture.mjs',
    'ecosystem-admissions-verify.mjs',
    'ecosystem-careers-verify.mjs',
    'ecosystem-content-verify.mjs',
    'ecosystem-events-verify.mjs',
    'ecosystem-learning-verify.mjs',
    'ecosystem-library-verify.mjs',
    'ecosystem-sso-verify.mjs',
  ];
  for (const runner of runners) {
    const source = readFileSync(path.join(repoRoot, 'scripts', runner), 'utf8');
    assert.match(source, /ensureComposeSecrets/, `${runner} prepares generated Compose values`);
  }
});

const composeDocs = [
  'docs/DEMO_RUNBOOK.md',
  'docs/RELEASE.md',
  'mobile/README.md',
  'java-services/restful-api/README.md',
  'ops/backup/README.md',
];

test('documented compose entry points provision the required owner-assertion secret', () => {
  for (const doc of composeDocs) {
    const content = readFileSync(path.join(repoRoot, doc), 'utf8');
    assert.match(content, /ASSISTANT_RAG_OWNER_ASSERTION_SECRET/, `${doc} must name the required compose secret`);
    assert.match(
      content,
      /(?:Add-Content \.env|export ASSISTANT_RAG_OWNER_ASSERTION_SECRET|local-dev\.mjs up|compose-secrets\.mjs --ensure)/,
      `${doc} must tell the reader how to provision it`,
    );
  }
});

test('every docker compose logs command in docs/ecosystem names a real service', () => {
  const services = composeServices();
  assert.ok(services.has('restful-api'), 'compose service inventory is readable');
  const dir = path.join(repoRoot, 'docs', 'ecosystem');
  for (const file of readdirSync(dir).filter((name) => name.endsWith('.md'))) {
    const content = readFileSync(path.join(dir, file), 'utf8');
    for (const match of content.matchAll(/docker compose logs\s+([a-z][a-z0-9-]*)/g)) {
      assert.ok(services.has(match[1]), `docs/ecosystem/${file} names unknown compose service "${match[1]}"`);
    }
  }
});
