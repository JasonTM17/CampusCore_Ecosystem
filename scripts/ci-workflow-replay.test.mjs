#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
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
