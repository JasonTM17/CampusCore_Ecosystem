#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readRepo(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

// docker-compose.yml is parsed with plain line/indent rules, the same style as
// compose-contract.test.mjs — the file has no anchors, so a service block is
// the text between `  <name>:` and the next line indented fewer than two
// spaces, and its `environment:` map is the run of lines indented six or more.
function serviceEnvironmentBlock(compose, serviceName) {
  const lines = compose.split(/\r?\n/);
  const start = lines.findIndex((line) => line === `  ${serviceName}:`);
  assert.notEqual(start, -1, `docker-compose.yml is missing the ${serviceName} service`);
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^ {0,2}[^\s#]/.test(lines[index])) {
      end = index;
      break;
    }
  }
  const serviceLines = lines.slice(start, end);
  const envStart = serviceLines.findIndex((line) => /^    environment:\s*$/.test(line));
  assert.notEqual(envStart, -1, `${serviceName} must declare an environment map`);
  const envLines = [];
  for (let index = envStart + 1; index < serviceLines.length; index += 1) {
    const line = serviceLines[index];
    if (line.trim() === '' || /^ {6,}/.test(line)) envLines.push(line);
    else break;
  }
  return envLines.join('\n');
}

// A knob is "forwarded" when the environment map interpolates it, either as its
// own `${NAME[:...]}` entry or inside another variable's value. `.env` values
// only reach a container through that interpolation — a bare `NAME:` key that
// hardcodes a literal does not count.
function isForwarded(envBlock, name) {
  return envBlock.includes('${' + name + ':') || envBlock.includes('${' + name + '}');
}

function composeDefault(envBlock, name) {
  const match = new RegExp(`${name}:\\s*"?\\$\\{${name}:-([^}"]*)\\}`).exec(envBlock);
  return match ? match[1] : null;
}

const compose = readRepo('docker-compose.yml');
const restfulApiEnv = serviceEnvironmentBlock(compose, 'restful-api');
const ragServiceEnv = serviceEnvironmentBlock(compose, 'rag-service');

function activeEnvExampleKnobs() {
  const names = new Set();
  for (const match of readRepo('.env.example').matchAll(/^([A-Z][A-Z0-9_]*)=/gm)) {
    names.add(match[1]);
  }
  return names;
}

// environment.md documents some knobs as a wildcard family (`X_*`), so a name
// counts as referenced when it appears verbatim or starts with a documented
// family prefix.
function documentedEnvNames() {
  const doc = readRepo(path.join('docs', 'ecosystem', 'environment.md'));
  const tokens = new Set([...doc.matchAll(/[A-Z][A-Z0-9_]*\*?/g)].map((m) => m[0]));
  const wildcards = [...tokens].filter((t) => t.endsWith('*')).map((t) => t.slice(0, -1));
  return { tokens, wildcards };
}

function isDocumented(name, { tokens, wildcards }) {
  return tokens.has(name) || wildcards.some((prefix) => name.startsWith(prefix));
}

// Documented .env.example knobs that deliberately never reach the API process:
// compose `ports:` publishes, web/mobile build-time variables, the Flyway
// switch the api pins off (rag-service owns migrations in this stack), and the
// DeepSeek provider chain that only the rag-service sidecar runs.
const NOT_FORWARDED_TO_API = new Map([
  ['POSTGRES_HOST_PORT', 'host port publish for postgres'],
  ['RESTFUL_API_HOST_PORT', 'host port publish for restful-api'],
  ['FRONTEND_HOST_PORT', 'host port publish for web'],
  ['MAILPIT_UI_HOST_PORT', 'host port publish for mailpit'],
  ['MAILPIT_SMTP_HOST_PORT', 'host port publish for mailpit'],
  ['ASSISTANT_RETENTION_ENABLED', 'rag-service owns the single retention purger; restful-api pins it off'],
  ['CAMPUSCORE_PROXY_TOKEN', 'web service proxy token'],
  ['JAVA_API_ORIGIN', 'web service proxy target'],
  ['NEXT_PUBLIC_API_URL', 'Next.js bundle variable'],
  ['NEXT_PUBLIC_SHOW_DEMO_CREDENTIALS', 'web build arg'],
  ['NEXT_PUBLIC_DEMO_STUDENT_PASSWORD', 'web build arg'],
  ['NEXT_PUBLIC_DEMO_LECTURER_PASSWORD', 'web build arg'],
  ['NEXT_PUBLIC_DEMO_DEAN_PASSWORD', 'web build arg'],
  ['EXPO_PUBLIC_API_URL', 'mobile build-time variable'],
  ['EXPO_PUBLIC_API_MODE', 'mobile build-time variable'],
  ['FLYWAY_ENABLED', 'restful-api pins it off; rag-service applies migrations'],
  ['DEEPSEEK_ENABLED', 'rag-service sidecar runs the provider chain'],
  ['DEEPSEEK_API_KEY', 'rag-service sidecar runs the provider chain'],
  ['DEEPSEEK_BASE_URL', 'rag-service sidecar runs the provider chain'],
  ['DEEPSEEK_MODEL', 'rag-service sidecar runs the provider chain'],
  ['DEEPSEEK_TIMEOUT_MS', 'rag-service sidecar runs the provider chain'],
  ['DEEPSEEK_MAX_OUTPUT_TOKENS', 'rag-service sidecar runs the provider chain'],
  ['SSO_PREVIEW_PROXY_TOKEN', 'sso-preview overlay maps it to RATE_LIMIT_PROXY_TOKEN'],
  ['IDENTITY_TOKEN_ENCRYPTION_KEY', 'sso-preview overlay maps it to the OIDC token cipher'],
  ['SSO_PREVIEW_PORTAL_CLIENT_SECRET', 'sso-preview overlay maps it to the portal client'],
  ['SSO_PREVIEW_PORTAL_PROXY_SECRET', 'sso-preview overlay maps it to the portal proxy'],
  ['SSO_PREVIEW_LEARN_CLIENT_SECRET', 'sso-preview overlay maps it to the learn client'],
  ['SSO_PREVIEW_LEARN_PROXY_SECRET', 'sso-preview overlay maps it to the learn proxy'],
  ['SSO_PREVIEW_APPLY_CLIENT_SECRET', 'sso-preview overlay maps it to the apply client'],
  ['SSO_PREVIEW_APPLY_PROXY_SECRET', 'sso-preview overlay maps it to the apply proxy'],
]);

test('every documented active .env.example knob reaches restful-api or is allowlisted', () => {
  const doc = documentedEnvNames();
  const missing = [];
  const staleAllowlist = [];
  for (const name of [...activeEnvExampleKnobs()].sort()) {
    if (!isDocumented(name, doc)) continue;
    const forwarded = isForwarded(restfulApiEnv, name);
    if (NOT_FORWARDED_TO_API.has(name)) {
      if (forwarded) staleAllowlist.push(name);
      continue;
    }
    if (!forwarded) missing.push(name);
  }
  assert.deepEqual(
    missing,
    [],
    `documented .env.example knobs not forwarded by restful-api: ${missing.join(', ')}`,
  );
  assert.deepEqual(
    staleAllowlist,
    [],
    `allowlist entries that are now forwarded — remove them: ${staleAllowlist.join(', ')}`,
  );
});

// Operator-facing switches that environment.md and .env.example tell a
// deployment to set. Each must interpolate into the named service's
// environment with the same default the application resolves today, so the
// Compose default changes no behaviour.
const FORWARDED_KNOBS = [
  { name: 'RATE_LIMIT_TRUST_PROXY_HEADERS', service: 'restful-api', expected: 'false' },
  { name: 'RATE_LIMIT_TRUST_REAL_IP', service: 'restful-api', expected: 'false' },
  { name: 'RATE_LIMIT_PROXY_TOKEN', service: 'restful-api', expected: '' },
  { name: 'APP_PUBLIC_BASE_URL', service: 'restful-api', expected: 'http://localhost:3100' },
  { name: 'ASSISTANT_LEXICAL_FAST_PATH', service: 'restful-api', expected: 'true' },
  { name: 'ASSISTANT_LEXICAL_CONFIDENT_SCORE', service: 'restful-api', expected: '11' },
];

test('documented operator knobs interpolate into their service with the application default', () => {
  const envBlocks = { 'restful-api': restfulApiEnv, 'rag-service': ragServiceEnv };
  const applicationYml = readRepo(path.join('java-services', 'restful-api', 'src', 'main', 'resources', 'application.yml'));
  const securityConfig = readRepo(path.join('java-services', 'restful-api', 'src', 'main', 'java', 'io', 'campuscore', 'restfulapi', 'security', 'SecurityConfig.java'));
  const failures = [];
  for (const { name, service, expected } of FORWARDED_KNOBS) {
    const block = envBlocks[service];
    if (!block.includes(`${name}:`)) {
      failures.push(`${service} is missing a ${name} environment entry`);
      continue;
    }
    const actual = composeDefault(block, name);
    if (actual !== expected) {
      failures.push(`${service} ${name} default is ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
    }
    // Guard the other end of the contract: the compose default must equal the
    // default the application itself resolves for that property.
    if (name === 'SECURITY_JWT_REJECT_KNOWN_DEFAULTS') {
      if (!securityConfig.includes('security.jwt.reject-known-defaults:' + expected)) {
        failures.push(`SecurityConfig no longer defaults security.jwt.reject-known-defaults to ${expected}`);
      }
    } else {
      const appDefault = new RegExp(`\\$\\{${name}:([^}]*)\\}`).exec(applicationYml);
      if (!appDefault || appDefault[1] !== expected) {
        failures.push(`application.yml no longer defaults ${name} to ${JSON.stringify(expected)}`);
      }
    }
  }
  assert.deepEqual(failures, [], failures.join('\n'));
});

test('base Compose pins known-default rejection on for both Java services', () => {
  for (const service of ['restful-api', 'rag-service']) {
    assert.match(
      serviceEnvironmentBlock(compose, service),
      /SECURITY_JWT_REJECT_KNOWN_DEFAULTS: "true"/,
      `${service} must reject published JWT defaults`,
    );
  }
});

test('frontend Dockerfile declares every demo env key the login page reads', () => {
  const loginPage = readRepo(path.join('frontend', 'src', 'app', 'login', 'page.tsx'));
  const dockerfile = readRepo(path.join('frontend', 'Dockerfile'));
  const needed = new Set(
    [...loginPage.matchAll(/process\.env\.(NEXT_PUBLIC_(?:DEMO_[A-Z_]+|SHOW_DEMO_CREDENTIALS))/g)].map(
      (m) => m[1],
    ),
  );
  assert.ok(needed.size > 0, 'login page must read at least one demo env key');
  const missing = [];
  for (const name of [...needed].sort()) {
    if (!new RegExp(`^ARG ${name}=`, 'm').test(dockerfile)) missing.push(`ARG ${name}`);
    if (!new RegExp(`^ENV ${name}=`, 'm').test(dockerfile)) missing.push(`ENV ${name}`);
  }
  assert.deepEqual(missing, [], `frontend/Dockerfile is missing declarations: ${missing.join(', ')}`);
});

test('release runbook restore targets match the restore-postgres.sh namespace', () => {
  const script = readRepo(path.join('ops', 'backup', 'restore-postgres.sh'));
  const guard = /target_db" =~ \^([a-zA-Z_]+)\[a-zA-Z0-9_\]\+/.exec(script);
  assert.ok(guard, 'restore-postgres.sh must carry a restore-target namespace guard');
  const namespace = guard[1];
  const runbook = readRepo(path.join('docs', 'ecosystem', 'release-runbook.md'));
  const targets = [...runbook.matchAll(/[a-z][a-z0-9]*_restore_[a-zA-Z0-9_*]+/g)].map((m) => m[0]);
  assert.ok(targets.length > 0, 'release-runbook.md must name the isolated restore target');
  const invalid = targets.filter((target) => !new RegExp(`^${namespace}[a-zA-Z0-9_*]+$`).test(target));
  assert.deepEqual(
    invalid,
    [],
    `release-runbook.md restore targets must use the ${namespace} prefix: ${invalid.join(', ')}`,
  );
});
