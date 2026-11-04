#!/usr/bin/env node

import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadWorkflow } from './ci-workflow-replay.mjs';
import { ECOSYSTEM_LANES, laneEnvironment } from './ecosystem-e2e-verify.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workflow = loadWorkflow(path.join(repoRoot, '.github', 'workflows', 'ci.yml'), repoRoot);
const frontendRequire = createRequire(path.join(repoRoot, 'frontend', 'package.json'));
const ts = frontendRequire('typescript');

function stepsFor(jobId) {
  return workflow.jobs?.[jobId]?.steps ?? [];
}

function runsFor(jobId) {
  return stepsFor(jobId)
    .map((step) => step.run)
    .filter((run) => typeof run === 'string');
}

function loadPlaywrightConfig(ssoPortalBase) {
  const output = ts.transpileModule(
    readFileSync(path.join(repoRoot, 'frontend', 'playwright.config.ts'), 'utf8'),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
      fileName: 'playwright.config.ts',
    },
  ).outputText;
  const previous = process.env.SSO_PORTAL_BASE;
  if (ssoPortalBase === undefined) delete process.env.SSO_PORTAL_BASE;
  else process.env.SSO_PORTAL_BASE = ssoPortalBase;
  try {
    const moduleRecord = { exports: {} };
    const playwrightStub = {
      defineConfig: (config) => config,
      devices: new Proxy({}, { get: () => ({}) }),
    };
    Function('module', 'exports', 'require', output)(
      moduleRecord,
      moduleRecord.exports,
      (specifier) => (specifier === '@playwright/test' ? playwrightStub : frontendRequire(specifier)),
    );
    return moduleRecord.exports.default;
  } finally {
    if (previous === undefined) delete process.env.SSO_PORTAL_BASE;
    else process.env.SSO_PORTAL_BASE = previous;
  }
}

test('the Java gate runs the disposable-PostgreSQL integration lane', () => {
  const step = stepsFor('java-api').find(
    (candidate) => typeof candidate.run === 'string'
      && /scripts\/platform-verify\.mjs\s+pgit\b/.test(candidate.run),
  );
  assert.ok(step, 'java-api must run platform-verify pgit so *PostgresIT classes cannot be skipped');
  assert.match(
    step.run,
    /--project\s+campuscore-[a-z0-9-]*\$\{\{\s*github\.run_id\s*\}\}/,
    'the lane must use a run-scoped disposable compose project',
  );
  assert.notEqual(step['continue-on-error'], true, 'a failing integration lane must block merge');

  const platformVerify = readFileSync(path.join(repoRoot, 'scripts', 'platform-verify.mjs'), 'utf8');
  assert.match(platformVerify, /zeroTestGuard/, 'pgit must record its zero-test guard');
  assert.match(platformVerify, /executed > 0/, 'pgit must refuse a run with zero executed tests');
});

test('the e2e gate runs every ecosystem preview spec through its own lane', () => {
  const specs = readdirSync(path.join(repoRoot, 'frontend', 'e2e'))
    .filter((name) => /^ecosystem-.*\.spec\.ts$/.test(name))
    .map((name) => name.replace(/^ecosystem-/, '').replace(/\.spec\.ts$/, ''))
    .sort();
  assert.ok(specs.length > 0, 'the ecosystem specs must exist');
  assert.deepEqual(
    [...ECOSYSTEM_LANES].sort(),
    specs,
    'every ecosystem spec needs a preview lane and every lane needs a spec',
  );

  for (const lane of ECOSYSTEM_LANES) {
    assert.ok(
      existsSync(path.join(repoRoot, 'scripts', `ecosystem-${lane}-verify.mjs`)),
      `ecosystem lane ${lane} must have a runner`,
    );
  }

  const step = stepsFor('e2e').find(
    (candidate) => typeof candidate.run === 'string'
      && candidate.run.includes('scripts/ecosystem-e2e-verify.mjs'),
  );
  assert.ok(step, 'the e2e job must run the ecosystem lane orchestrator');
  assert.match(
    step.run,
    /--project-prefix\s+campuscore-[a-z0-9-]*\$\{\{\s*github\.run_id\s*\}\}/,
    'every lane must use a run-scoped disposable compose project',
  );
  assert.notEqual(step['continue-on-error'], true, 'a failing ecosystem lane must block merge');
});

test('Playwright forbids focused tests and only hides the ecosystem lane from the single-host suite', () => {
  const singleHost = loadPlaywrightConfig();
  assert.equal(singleHost.forbidOnly, true, 'a leftover .only must fail the suite');
  assert.deepEqual(
    singleHost.testIgnore,
    ['**/ecosystem-*.spec.ts'],
    'the single-host lane may exclude exactly the ecosystem specs',
  );

  const ecosystem = loadPlaywrightConfig('https://portal.localhost:3102');
  assert.equal(ecosystem.testIgnore, undefined, 'the ecosystem lane must collect its specs');
});

test('the gate jobs stay merge blocking', () => {
  for (const jobId of ['java-api', 'e2e']) {
    const job = workflow.jobs?.[jobId];
    assert.ok(job, `${jobId} job exists`);
    assert.notEqual(job['continue-on-error'], true, `${jobId} must not be report-only`);
    assert.ok(runsFor(jobId).length > 0, `${jobId} must run commands`);
  }
});

test('every ecosystem lane overrides the database host port pinned by the generated env file', () => {
  const env = laneEnvironment(54321);
  assert.equal(env.POSTGRES_HOST_PORT, '54321');
});
