#!/usr/bin/env node

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { ensureComposeSecrets } from './compose-secrets.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const COMPOSE_ENV_NAMES = new Set([
  ...[...readFileSync(path.join(repoRoot, '.env.example'), 'utf8').matchAll(/^([A-Z][A-Z0-9_]*)=/gm)]
    .map((match) => match[1]),
  'ASSISTANT_RETENTION_ENABLED',
  'CAMPUSCORE_IMAGE_TAG',
  'CAMPUSCORE_PROXY_TOKEN',
  'MAIL_ENABLED',
  'SSO_PREVIEW_APPLY_CLIENT_SECRET',
  'SSO_PREVIEW_APPLY_PROXY_SECRET',
  'SSO_PREVIEW_LEARN_CLIENT_SECRET',
  'SSO_PREVIEW_LEARN_PROXY_SECRET',
  'SSO_PREVIEW_PORTAL_CLIENT_SECRET',
  'SSO_PREVIEW_PORTAL_PROXY_SECRET',
  'SSO_PREVIEW_PROXY_TOKEN',
]);

const SSO_PREVIEW_SECRET_BINDINGS = [
  ['RATE_LIMIT_PROXY_TOKEN', 'SSO_PREVIEW_PROXY_TOKEN'],
  ['IDENTITY_TOKEN_ENCRYPTION_KEY', 'IDENTITY_TOKEN_ENCRYPTION_KEY'],
  ['IDENTITY_BFF_SURFACES_0_CLIENTSECRET', 'SSO_PREVIEW_PORTAL_CLIENT_SECRET'],
  ['IDENTITY_BFF_SURFACES_0_PROXYSECRET', 'SSO_PREVIEW_PORTAL_PROXY_SECRET'],
  ['IDENTITY_BFF_SURFACES_1_CLIENTSECRET', 'SSO_PREVIEW_LEARN_CLIENT_SECRET'],
  ['IDENTITY_BFF_SURFACES_1_PROXYSECRET', 'SSO_PREVIEW_LEARN_PROXY_SECRET'],
  ['IDENTITY_BFF_SURFACES_2_CLIENTSECRET', 'SSO_PREVIEW_APPLY_CLIENT_SECRET'],
  ['IDENTITY_BFF_SURFACES_2_PROXYSECRET', 'SSO_PREVIEW_APPLY_PROXY_SECRET'],
];

const PUBLISHED_SSO_SECRETS = [
  'sso-preview-proxy-token-0123456789',
  'dGVzdC1rZXktMDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY=',
  'sso-preview-portal-secret-0123456789ab',
  'sso-preview-portal-proxy-0123456789abcd',
  'sso-preview-learn-secret-0123456789abc',
  'sso-preview-learn-proxy-0123456789abcde',
  'sso-preview-apply-secret-0123456789abd',
  'sso-preview-apply-proxy-0123456789abcdef',
];

function composeEnvironment() {
  const env = { ...process.env };
  for (const name of COMPOSE_ENV_NAMES) delete env[name];
  return env;
}

function scratchDirectory(t) {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'compose-contract-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function readEnvFile(envPath) {
  return new Map(readFileSync(envPath, 'utf8').split(/\r?\n/).flatMap((line) => {
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
    return match ? [[match[1], match[2]]] : [];
  }));
}

function writeEnvFile(envPath, values) {
  writeFileSync(envPath, [...values].map(([name, value]) => `${name}=${value}`).join('\n') + '\n', {
    encoding: 'utf8',
    mode: 0o600,
  });
}

function generatedEnvFile(directory) {
  const envPath = path.join(directory, 'generated.env');
  ensureComposeSecrets({
    envPath,
    templatePath: path.join(repoRoot, '.env.example'),
    env: {},
  });
  return envPath;
}

function composeConfig(envPath, files) {
  const result = spawnSync('docker', [
    'compose', '--env-file', envPath,
    ...files.flatMap((file) => ['-f', path.join(repoRoot, file)]),
    'config', '--format', 'json',
  ], { cwd: repoRoot, env: composeEnvironment(), encoding: 'utf8' });
  return {
    status: result.status,
    stderr: result.stderr,
    model: result.status === 0 ? JSON.parse(result.stdout) : null,
  };
}

function composeIsAvailable(t) {
  const version = spawnSync('docker', ['compose', 'version'], { env: composeEnvironment(), encoding: 'utf8' });
  if (!version.error && version.status === 0) return true;
  t.skip('Docker Compose CLI is unavailable');
  return false;
}

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

test('SSO preview requires every secret with an actionable error', (t) => {
  if (!composeIsAvailable(t)) return;
  const directory = scratchDirectory(t);
  const envPath = generatedEnvFile(directory);
  const generated = readEnvFile(envPath);

  for (const [, envName] of SSO_PREVIEW_SECRET_BINDINGS) {
    const values = new Map(generated);
    values.delete(envName);
    writeEnvFile(envPath, values);

    const result = composeConfig(envPath, ['docker-compose.yml', 'docker-compose.sso-preview.yml']);

    assert.notEqual(result.status, 0, `SSO preview must reject missing ${envName}`);
    assert.match(result.stderr, new RegExp(`required variable ${envName} is missing a value: Set ${envName}`));
  }
});

test('SSO preview renders generated secrets instead of published values', (t) => {
  if (!composeIsAvailable(t)) return;
  const directory = scratchDirectory(t);
  const envPath = generatedEnvFile(directory);
  const result = composeConfig(envPath, ['docker-compose.yml', 'docker-compose.sso-preview.yml']);

  assert.equal(result.status, 0, 'generated preview secrets must resolve');
  const environment = result.model.services['restful-api'].environment;
  for (const [composeName] of SSO_PREVIEW_SECRET_BINDINGS) {
    const value = environment[composeName];
    assert.ok(value, `${composeName} must be configured`);
    assert.equal(PUBLISHED_SSO_SECRETS.includes(value), false, `${composeName} must not use a published secret`);
  }
  assert.equal(Buffer.from(environment.IDENTITY_TOKEN_ENCRYPTION_KEY, 'base64').length, 32);
});

test('web receives the optional CampusCore proxy token from the effective model', (t) => {
  if (!composeIsAvailable(t)) return;
  const directory = scratchDirectory(t);
  const envPath = generatedEnvFile(directory);
  const values = readEnvFile(envPath);
  values.set('CAMPUSCORE_PROXY_TOKEN', 'compose-test-edge-token');
  writeEnvFile(envPath, values);
  const result = composeConfig(envPath, ['docker-compose.yml']);

  assert.equal(result.status, 0, 'base Compose must resolve');
  assert.equal(result.model.services.web.environment.CAMPUSCORE_PROXY_TOKEN, 'compose-test-edge-token');
});

test('generated environment preserves the base port and lets e2e use its own Postgres port', (t) => {
  if (!composeIsAvailable(t)) return;
  const directory = scratchDirectory(t);
  const envPath = generatedEnvFile(directory);
  const base = composeConfig(envPath, ['docker-compose.yml']);
  const e2e = composeConfig(envPath, ['docker-compose.e2e.yml']);

  assert.equal(base.status, 0, 'base Compose must resolve with generated secrets');
  assert.equal(e2e.status, 0, 'e2e Compose must resolve');
  assert.equal(base.model.services.postgres.ports[0].published, '5432');
  assert.equal(e2e.model.services.postgres.ports[0].published, '5433');
});

test('RAG retention switch reaches the single purger and keeps the API purger disabled', (t) => {
  if (!composeIsAvailable(t)) return;
  const directory = scratchDirectory(t);
  const envPath = generatedEnvFile(directory);
  const values = readEnvFile(envPath);
  values.delete('ASSISTANT_RETENTION_ENABLED');
  writeEnvFile(envPath, values);
  const defaults = composeConfig(envPath, ['docker-compose.yml']);
  values.set('ASSISTANT_RETENTION_ENABLED', 'false');
  writeEnvFile(envPath, values);
  const disabled = composeConfig(envPath, ['docker-compose.yml']);

  assert.equal(defaults.status, 0, 'base Compose must resolve with the default retention policy');
  assert.equal(defaults.model.services['rag-service'].environment.ASSISTANT_RETENTION_ENABLED, 'true');
  assert.equal(disabled.status, 0, 'base Compose must resolve with retention disabled');
  assert.equal(disabled.model.services['rag-service'].environment.ASSISTANT_RETENTION_ENABLED, 'false');
  assert.equal(disabled.model.services['restful-api'].environment.ASSISTANT_RETENTION_ENABLED, 'false');
});

test('e2e disables outbound mail by default in its effective API environment', (t) => {
  if (!composeIsAvailable(t)) return;
  const directory = scratchDirectory(t);
  const envPath = generatedEnvFile(directory);
  const values = readEnvFile(envPath);
  values.delete('MAIL_ENABLED');
  writeEnvFile(envPath, values);
  const result = composeConfig(envPath, ['docker-compose.e2e.yml']);

  assert.equal(result.status, 0, 'e2e Compose must resolve');
  assert.equal(result.model.services['restful-api'].environment.MAIL_ENABLED, 'false');
});

test('DeepSeek stays disabled by default and an enabled provider receives an empty key', (t) => {
  if (!composeIsAvailable(t)) return;
  const directory = scratchDirectory(t);
  const envPath = generatedEnvFile(directory);
  const values = readEnvFile(envPath);
  values.set('DEEPSEEK_ENABLED', 'true');
  writeEnvFile(envPath, values);
  const result = composeConfig(envPath, ['docker-compose.yml']);

  assert.equal(result.status, 0, 'base Compose must resolve with the provider enabled');
  assert.equal(result.model.services['rag-service'].environment.DEEPSEEK_ENABLED, 'true');
  assert.equal(result.model.services['rag-service'].environment.DEEPSEEK_API_KEY, '');
});

test('SSO BFF issuer follows the API port owned by each compose base', (t) => {
  if (!composeIsAvailable(t)) return;
  const directory = scratchDirectory(t);
  const envPath = generatedEnvFile(directory);
  const base = composeConfig(envPath, ['docker-compose.yml', 'docker-compose.sso-preview.yml']);
  const e2e = composeConfig(envPath, ['docker-compose.e2e.yml', 'docker-compose.sso-preview.yml']);

  assert.equal(base.status, 0, 'base plus SSO preview must resolve');
  assert.equal(e2e.status, 0, 'e2e plus SSO preview must resolve');
  assert.equal(base.model.services['restful-api'].environment.IDENTITY_BFF_ISSUER_LOOPBACK, 'http://127.0.0.1:4010');
  assert.equal(e2e.model.services['restful-api'].environment.IDENTITY_BFF_ISSUER_LOOPBACK, 'http://127.0.0.1:4100');
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
