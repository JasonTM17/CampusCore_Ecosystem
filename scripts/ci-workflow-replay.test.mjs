#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  assertJobTimingStructure,
  extractSentinelBlock,
  findReplayJobs,
  loadWorkflow,
  replaySentinel,
  replayTimingStep,
  replayWorkflow,
} from './ci-workflow-replay.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workflowPath = path.join(repoRoot, '.github', 'workflows', 'ci.yml');
const workflowSource = readFileSync(workflowPath, 'utf8');

const approvedActions = new Map([
  ['actions/checkout', { sha: '11d5960a326750d5838078e36cf38b85af677262', version: 'v4.4.0' }],
  ['actions/setup-node', { sha: '49933ea5288caeca8642d1e84afbd3f7d6820020', version: 'v4.4.0' }],
  ['actions/setup-java', { sha: 'cf277c60eb25467037889841efdb72551f06f6c3', version: 'v4.9.1' }],
  ['actions/upload-artifact', { sha: 'ea165f8d65b6e75b540449e92b4886f43607fa02', version: 'v4.6.2' }],
]);

test('parses workflow definition and discovers jobs with timing summary and sentinel steps', () => {
  const doc = loadWorkflow(workflowPath, repoRoot);
  const matchingJobs = findReplayJobs(doc);
  const jobIds = matchingJobs.map((j) => j.jobId).sort();
  assert.deepEqual(jobIds, ['ecosystem-gates']);
});

test('every workflow action uses its approved immutable commit and version comment', () => {
  const usesLines = workflowSource.split(/\r?\n/).filter((line) => /^\s*-\s+uses:/.test(line));
  assert.ok(usesLines.length > 0, 'workflow must contain action references');

  for (const line of usesLines) {
    const match = /^\s*-\s+uses:\s+([^\s]+)\s+#\s+(v\d+\.\d+\.\d+)\s*$/.exec(line);
    assert.ok(match, `action reference must use a full SHA and trailing version comment: ${line.trim()}`);
    const [action, sha] = match[1].split('@');
    const approved = approvedActions.get(action);
    assert.ok(approved, `action has no approved pin in this guard: ${action}`);
    assert.equal(sha, approved.sha, `${action} must use the approved commit`);
    assert.equal(match[2], approved.version, `${action} version comment must match the approved commit`);
  }
});

test('every root scripts test suite is referenced exactly once by CI', () => {
  const rootTests = readdirSync(path.join(repoRoot, 'scripts'), { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.test.mjs'))
    .map((entry) => entry.name)
    .sort();
  // No root-level suite currently needs Docker or a remote network service.
  // If one is added, list it here with a concrete Docker/network reason.
  const excludedSuites = new Map();
  for (const [file, reason] of excludedSuites) {
    assert.match(reason, /docker|network/i, `${file} exclusion needs a Docker or network reason`);
  }

  const doc = loadWorkflow(workflowPath, repoRoot);
  const allRuns = Object.values(doc.jobs ?? {}).flatMap((job) =>
    (job.steps ?? []).map((step) => step.run).filter((run) => typeof run === 'string'));
  const sourceRuns = (doc.jobs?.['ecosystem-gates']?.steps ?? [])
    .map((step) => step.run)
    .filter((run) => typeof run === 'string');
  const references = (runs, file) => runs.reduce((count, run) =>
    count + [...run.matchAll(new RegExp(`\\bscripts/${file.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}\\b`, 'g'))].length, 0);

  for (const file of rootTests) {
    if (excludedSuites.has(file)) {
      assert.equal(references(allRuns, file), 0, `${file} is explicitly excluded from CI`);
      continue;
    }
    assert.equal(references(sourceRuns, file), 1, `${file} must be run once in ecosystem-gates`);
    assert.equal(references(allRuns, file), 1, `${file} must not be duplicated in another CI job`);
  }
  for (const file of excludedSuites.keys()) {
    assert.ok(rootTests.includes(file), `excluded suite must exist: ${file}`);
  }
});

test('every nested scripts/tests suite is referenced exactly once by ecosystem-gates', () => {
  const nestedDir = path.join(repoRoot, 'scripts', 'tests');
  const nestedTests = readdirSync(nestedDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.test.mjs'))
    .map((entry) => `scripts/tests/${entry.name}`)
    .sort();
  assert.ok(nestedTests.length > 0, 'the nested suite directory must not be empty');
  // Nested suites kept out of ecosystem-gates need an explicit Docker/network
  // reason here, like the root-level list above.
  const excludedSuites = new Map();
  for (const [file, reason] of excludedSuites) {
    assert.match(reason, /docker|network/i, `${file} exclusion needs a Docker or network reason`);
  }

  const doc = loadWorkflow(workflowPath, repoRoot);
  const allRuns = Object.values(doc.jobs ?? {}).flatMap((job) =>
    (job.steps ?? []).map((step) => step.run).filter((run) => typeof run === 'string'));
  const sourceRuns = (doc.jobs?.['ecosystem-gates']?.steps ?? [])
    .map((step) => step.run)
    .filter((run) => typeof run === 'string');
  const references = (runs, file) => runs.reduce((count, run) =>
    count + [...run.matchAll(new RegExp(`\\b${file.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}\\b`, 'g'))].length, 0);

  for (const file of nestedTests) {
    if (excludedSuites.has(file)) {
      assert.equal(references(sourceRuns, file), 0, `${file} is explicitly excluded from ecosystem-gates`);
      continue;
    }
    assert.equal(references(sourceRuns, file), 1, `${file} must be run once in ecosystem-gates`);
    assert.equal(references(allRuns, file), 1, `${file} must not be duplicated in another CI job`);
  }
  for (const file of excludedSuites.keys()) {
    assert.ok(nestedTests.includes(file), `excluded suite must exist: ${file}`);
  }
});

test('source-only checks run once and compose keeps its runtime probes', () => {
  const doc = loadWorkflow(workflowPath, repoRoot);
  const jobs = Object.values(doc.jobs ?? {});
  const allRuns = jobs.flatMap((job) =>
    (job.steps ?? []).map((step) => step.run).filter((run) => typeof run === 'string'));
  const countCommand = (runs, command) => runs.reduce((total, run) =>
    total + run.split(command).length - 1, 0);
  const sourceRuns = (doc.jobs?.['ecosystem-gates']?.steps ?? [])
    .map((step) => step.run)
    .filter((run) => typeof run === 'string');

  for (const command of [
    'node scripts/check-migrations.mjs',
    'node scripts/flyway-lineage-check.mjs',
    'node scripts/check-assistant-secrets.mjs',
    'node scripts/check-doc-hygiene.mjs',
    'node scripts/host-registry-verify.mjs',
    'node scripts/static-policy-verify.mjs',
  ]) {
    assert.equal(countCommand(sourceRuns, command), 1, `${command} belongs in ecosystem-gates once`);
    assert.equal(countCommand(allRuns, command), 1, `${command} must not be duplicated`);
  }

  const compose = doc.jobs?.compose;
  assert.equal(compose?.needs, 'ecosystem-gates', 'compose must consume the source-only gate result');
  const composeRuns = (compose?.steps ?? []).map((step) => step.run).filter((run) => typeof run === 'string').join('\n');
  assert.match(composeRuns, /docker compose config/, 'compose configuration validation must remain');
  assert.match(composeRuns, /docker compose up -d --build --wait/, 'fresh stack runtime validation must remain');
  assert.match(composeRuns, /flyway_schema_history/, 'the runtime Flyway boundary must remain');
});

test('migration checks enforce a baseline from the main or previous push revision', () => {
  const migrationStep = workflowSource.slice(
    workflowSource.indexOf('- name: Migration source checks'),
    workflowSource.indexOf('- name: Offline assistant evaluation gate'),
  );
  assert.match(migrationStep, /base_ref=origin\/main/,
    'pull requests must compare against the current main migration head');
  assert.match(migrationStep, /git ls-tree[\s\S]*"\$base_ref"/,
    'the baseline migration version must come from the selected base revision');
  assert.match(migrationStep, /GITHUB_EVENT_PATH[\s\S]*event\.before/,
    'pushes must compare against the prior revision in the webhook payload');
  assert.match(migrationStep, /not newer than baseline/,
    'a new migration at or below the baseline must fail CI');
  assert.match(migrationStep, /node scripts\/check-migrations\.mjs/);
});

test('push migration baseline uses the standard event payload for its prior commit', () => {
  const migrationStep = workflowSource.slice(
    workflowSource.indexOf('- name: Migration source checks'),
    workflowSource.indexOf('- name: Offline assistant evaluation gate'),
  );
  assert.match(migrationStep, /GITHUB_EVENT_PATH/,
    'push events expose the before revision through the event payload path');
  assert.match(migrationStep, /event\.before/,
    'the migration baseline must read the webhook before revision');
  assert.doesNotMatch(migrationStep, /GITHUB_EVENT_BEFORE/,
    'GITHUB_EVENT_BEFORE is not a default GitHub Actions environment variable');
});

test('e2e CI executes the mobile-only unread recovery test on mobile-390', () => {
  const mobileStep = workflowSource.match(/- name: Run mobile unread recovery on mobile-390\n([\s\S]*?)(?=\n      - name:|\n  [A-Za-z])/);
  assert.ok(mobileStep, 'a required step selects the mobile-390 Playwright project');
  assert.match(mobileStep[1], /E2E_PLAYWRIGHT_PROJECT: mobile-390/);
  assert.match(mobileStep[1], /E2E_PLAYWRIGHT_FILTER: failed mark-read restores the preview row and unread badge without duplicates/);
  assert.match(mobileStep[1], /scripts\/run-course-e2e\.mjs/);
});

test('monitoring alerts are checked with the pinned Prometheus promtool fixture', () => {
  const install = workflowSource.match(/- name: Install pinned Prometheus promtool\n([\s\S]*?)(?=\n      - name:|\n  [A-Za-z])/);
  const check = workflowSource.match(/- name: Test Prometheus alert rules\n([\s\S]*?)(?=\n      - name:|\n  [A-Za-z])/);
  assert.ok(install, 'ecosystem-gates installs promtool');
  assert.match(install[1], /PROMETHEUS_VERSION=2\.55\.1/);
  assert.match(install[1], /sha256sum --check/);
  assert.ok(check, 'ecosystem-gates executes alert-tests.yml');
  assert.match(check[1], /promtool test rules ops\/monitoring\/alert-tests\.yml/);
});

test('portal viewport gate rejects skipped or unlaunched tests', () => {
  const doc = loadWorkflow(workflowPath, repoRoot);
  const job = doc.jobs?.['portal-viewport'];
  assert.ok(job, 'portal-viewport job exists');
  assert.equal(job.env?.PORTAL_REQUIRE_BROWSER, '1', 'CI must require a real browser run');

  const step = (job.steps ?? []).find(
    (candidate) => typeof candidate.run === 'string' && candidate.run.includes('tests/portal-shell.viewport.test.js'),
  );
  assert.ok(step, 'portal viewport test step exists');
  const marker = "node -e '";
  const start = step.run.lastIndexOf(marker);
  assert.notEqual(start, -1, 'portal viewport guard script exists');
  const bodyStart = start + marker.length;
  const bodyEnd = step.run.indexOf("'", bodyStart);
  assert.notEqual(bodyEnd, -1, 'portal viewport guard script is closed');
  const script = step.run.slice(bodyStart, bodyEnd);

  const runGuard = (summary) => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'portal-guard-'));
    try {
      const logPath = path.join(directory, 'portal.log').replace(/\\/g, '/');
      writeFileSync(logPath, summary, 'utf8');
      const result = spawnSync(process.execPath, ['-e', script.replaceAll('/tmp/portal-viewport.log', logPath)], {
        encoding: 'utf8',
      });
      return result.status;
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  };

  assert.equal(runGuard('ℹ tests 2\nℹ pass 2\nℹ skipped 0\n'), 0, 'a full pass must stay green');
  assert.notEqual(runGuard('ℹ tests 2\nℹ pass 0\nℹ skipped 2\n'), 0, 'a fully skipped run must fail the gate');
});

test('timing steps enforce continue-on-error and always execution condition with matching upload path', () => {
  const doc = loadWorkflow(workflowPath, repoRoot);
  const matchingJobs = findReplayJobs(doc);
  for (const { jobId, job } of matchingJobs) {
    assertJobTimingStructure(jobId, job);
  }
});

test('replays job timing summary generation locally with valid schema output', () => {
  const doc = loadWorkflow(workflowPath, repoRoot);
  const matchingJobs = findReplayJobs(doc);
  for (const { jobId, job } of matchingJobs) {
    const summary = replayTimingStep(jobId, job, repoRoot);
    assert.equal(summary.job, jobId);
    assert.equal(summary.schemaVersion, 1);
    assert.ok(summary.durationMs >= 0);
  }
});

test('replays sentinel block across clean tree, synthetic match, and non-git failure', () => {
  const doc = loadWorkflow(workflowPath, repoRoot);
  const matchingJobs = findReplayJobs(doc);
  for (const { jobId, job } of matchingJobs) {
    replaySentinel(jobId, job);
  }
});

test('full workflow replay passes for all target jobs against current ci.yml', () => {
  const result = replayWorkflow(workflowPath, { repoRoot });
  assert.equal(result.replayedJobCount, 1);
  const replayedNames = result.jobs.map((j) => j.jobId).sort();
  assert.deepEqual(replayedNames, ['ecosystem-gates']);
});
