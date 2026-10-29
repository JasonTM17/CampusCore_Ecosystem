import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const docPath = path.join(rootDir, 'docs', 'ecosystem', 'environment.md');
const ymlPath = path.join(rootDir, 'java-services', 'restful-api', 'src', 'main', 'resources', 'application.yml');

test('runtime environment documentation file exists and is readable', () => {
  assert.ok(fs.existsSync(docPath), 'docs/ecosystem/environment.md must exist');
  const content = fs.readFileSync(docPath, 'utf8');
  assert.ok(content.length > 0, 'environment.md must not be empty');
});

test('runtime environment documentation covers all explicit placeholders in application configuration', () => {
  const ymlContent = fs.readFileSync(ymlPath, 'utf8');
  const docContent = fs.readFileSync(docPath, 'utf8');

  // Extract explicit ${VAR:...} or ${VAR} placeholders from application.yml
  const placeholderRegex = /\$\{([A-Za-z0-9_]+)(?::[^}]*)?\}/g;
  let match;
  const placeholders = new Set();
  while ((match = placeholderRegex.exec(ymlContent)) !== null) {
    placeholders.add(match[1]);
  }

  assert.ok(placeholders.size >= 110, 'Expected at least 110 placeholder variables in application configuration');

  const missing = [];
  for (const name of placeholders) {
    if (!docContent.includes(name)) {
      missing.push(name);
    }
  }

  assert.deepEqual(missing, [], `Missing explicit configuration placeholders in documentation: ${missing.join(', ')}`);
});

test('runtime environment documentation covers attendance checkin properties and fail-closed behavior', () => {
  const docContent = fs.readFileSync(docPath, 'utf8');

  const attendanceVars = [
    'ATTENDANCE_CHECKIN_PEPPER',
    'ATTENDANCE_CHECKIN_ENCRYPTION_KEY',
    'ATTENDANCE_CHECKIN_CONSENT_VERSION',
    'ATTENDANCE_CHECKIN_COORDINATE_RETENTION_DAYS',
    'ATTENDANCE_CHECKIN_ATTEMPT_RETENTION_DAYS',
  ];

  for (const v of attendanceVars) {
    assert.ok(docContent.includes(v), `Documentation must include attendance variable ${v}`);
  }

  // Verify attendance crypto fail-closed runtime semantics vs startup semantics
  assert.match(
    docContent,
    /fail-closed|fails closed/i,
    'Documentation must describe attendance crypto fail-closed behavior'
  );
  assert.match(
    docContent,
    /not (?:a )?startup failure|startup succeeds|boots cleanly/i,
    'Documentation must clarify that unconfigured attendance crypto is not a startup failure'
  );
  assert.match(
    docContent,
    /CHECKIN_NOT_CONFIGURED|503/i,
    'Documentation must document the runtime 503 / CHECKIN_NOT_CONFIGURED error code'
  );
});

test('runtime environment documentation covers push notification properties and relaxed binding', () => {
  const docContent = fs.readFileSync(docPath, 'utf8');

  const pushVars = [
    'APP_NOTIFICATIONS_PUSH_ENABLED',
    'APP_NOTIFICATIONS_PUSH_TOKEN_KEY',
    'APP_NOTIFICATIONS_PUSH_DISPATCHER_ENABLED',
    'APP_NOTIFICATIONS_PUSH_BATCH_SIZE',
    'APP_NOTIFICATIONS_PUSH_LEASE_SECONDS',
    'APP_NOTIFICATIONS_PUSH_SEND_TIMEOUT_MS',
    'APP_NOTIFICATIONS_PUSH_MAX_ATTEMPTS',
    'APP_NOTIFICATIONS_PUSH_RETRY_INITIAL_MS',
    'APP_NOTIFICATIONS_PUSH_RETRY_CAP_MS',
    'APP_NOTIFICATIONS_PUSH_RETRY_JITTER_RATIO',
  ];

  for (const v of pushVars) {
    assert.ok(docContent.includes(v), `Documentation must include push variable ${v}`);
  }

  assert.match(
    docContent,
    /relaxed[- ]binding/i,
    'Documentation must distinguish relaxed binding from explicit placeholders'
  );
});

test('runtime environment documentation covers mobile lane flags, token TTLs, pools, and storage', () => {
  const docContent = fs.readFileSync(docPath, 'utf8');

  const mobileLanes = [
    'EXPO_PUBLIC_LANE_DEAN',
    'EXPO_PUBLIC_LANE_STAFF',
    'EXPO_PUBLIC_LANE_ADMIN',
    'EXPO_PUBLIC_LANE_CHECKIN',
  ];
  for (const v of mobileLanes) {
    assert.ok(docContent.includes(v), `Documentation must include mobile lane flag ${v}`);
  }

  const tokenTtls = ['JWT_ACCESS_TOKEN_TTL_SECONDS', 'JWT_REFRESH_TOKEN_TTL_SECONDS'];
  for (const v of tokenTtls) {
    assert.ok(docContent.includes(v), `Documentation must include token TTL variable ${v}`);
  }

  const pools = ['DB_POOL_MAX', 'ASSISTANT_DB_POOL_MAX', 'TOMCAT_MAX_THREADS'];
  for (const v of pools) {
    assert.ok(docContent.includes(v), `Documentation must include pool variable ${v}`);
  }

  const storage = ['THESIS_REPORT_STORAGE_PROVIDER', 'SUPABASE_URL'];
  for (const v of storage) {
    assert.ok(docContent.includes(v), `Documentation must include storage variable ${v}`);
  }
});

test('runtime environment documentation marks owner policy unknown and avoids secret leakage', () => {
  const docContent = fs.readFileSync(docPath, 'utf8');

  assert.match(
    docContent,
    /owner policy unknown|deployment policy unknown/i,
    'Documentation must explicitly state owner policy is unknown where provisioning decisions are deferred'
  );

  // Assert that documentation does not leak dummy real secrets or violate hygiene rules
  assert.doesNotMatch(
    docContent,
    /\bsk-[A-Za-z0-9_-]{20,}\b/,
    'Documentation must not contain real or synthetic provider keys'
  );
});
