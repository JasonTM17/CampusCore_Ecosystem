#!/usr/bin/env node

import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const reportScript = path.join(repoRoot, 'scripts', 'ci-timing-report.mjs');
const checkerScript = path.join(repoRoot, 'scripts', 'check-ci-timing-report.mjs');

function createTempDir(t) {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'ci-timing-report-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function makeSummary(job, runId, runAttempt, durationMs, conclusion = 'success') {
  const startedAt = '2026-10-01T00:00:00.000Z';
  const completedAt = new Date(Date.parse(startedAt) + durationMs).toISOString();
  return {
    schemaVersion: 1,
    workflow: 'CI fixture',
    runId: String(runId),
    runAttempt,
    job,
    startedAt,
    completedAt,
    durationMs,
    conclusion,
  };
}

function runReport(args, input) {
  return spawnSync(process.execPath, [reportScript, ...args], { encoding: 'utf8', input });
}

test('reports nearest-rank job percentiles and rerun/failure counts from summaries', (t) => {
  const directory = createTempDir(t);
  const summaries = [
    makeSummary('java-api', '101', 1, 100),
    makeSummary('java-api', '101', 2, 200),
    makeSummary('java-api', '102', 1, 300),
    makeSummary('java-api', '103', 1, 400, 'failure'),
    makeSummary('java-api', '104', 1, 500),
  ];
  const files = summaries.map((summary, index) => {
    const filePath = path.join(directory, `summary-${index}.json`);
    writeFileSync(filePath, `${JSON.stringify(summary)}\n`, 'utf8');
    return filePath;
  });

  const result = runReport(files);
  assert.equal(result.status, 0, 'summary report should succeed');
  const report = JSON.parse(result.stdout);
  assert.deepEqual(report.runs, { runCount: 4, rerunCount: 1, failedRunCount: 1 });
  assert.deepEqual(report.jobs, [{
    job: 'java-api',
    sampleCount: 5,
    p50DurationMs: 300,
    p95DurationMs: 500,
    rerunCount: 1,
    failureCount: 1,
  }]);
});

test('summarizes reruns and failed runs from GitHub run-list JSON on stdin', () => {
  const runs = [
    { databaseId: 201, attempt: 1, status: 'completed', conclusion: 'failure' },
    { databaseId: 201, attempt: 2, status: 'completed', conclusion: 'success' },
    { databaseId: 202, attempt: 1, status: 'completed', conclusion: 'failure' },
  ];
  const result = runReport([], JSON.stringify(runs));

  assert.equal(result.status, 0, 'GitHub run-list report should succeed');
  const report = JSON.parse(result.stdout);
  assert.deepEqual(report.runs, { runCount: 2, rerunCount: 1, failedRunCount: 1 });
  assert.deepEqual(report.jobs, [], 'run-list JSON has no per-job timings unless job summaries are supplied');
});

test('writes a per-job summary from the supplied GitHub context and validates it', (t) => {
  const directory = createTempDir(t);
  const outputPath = path.join(directory, 'artifacts', 'ci', 'ci-timing-summary.json');
  const env = {
    ...process.env,
    CI_TIMING_OUTPUT: outputPath,
    CI_TIMING_WORKFLOW: 'CI fixture',
    CI_TIMING_RUN_ID: '301',
    CI_TIMING_RUN_ATTEMPT: '2',
    CI_TIMING_JOB: 'frontend',
    CI_TIMING_CONCLUSION: 'success',
    CI_TIMING_STARTED_AT: new Date(Date.now() - 1_000).toISOString(),
  };
  const result = spawnSync(process.execPath, [reportScript, '--write-job-summary'], { encoding: 'utf8', env });
  assert.equal(result.status, 0, 'job summary writer should succeed');

  const summary = JSON.parse(readFileSync(outputPath, 'utf8'));
  const check = spawnSync(process.execPath, [checkerScript, outputPath], { encoding: 'utf8' });
  assert.equal(check.status, 0, 'written summary should pass schema validation');
  assert.equal(summary.job, 'frontend');
  assert.equal(summary.runAttempt, 2);
  assert.ok(summary.durationMs >= 0);
});

test('schema checker rejects missing fields and inconsistent durations', (t) => {
  const directory = createTempDir(t);
  const invalid = { ...makeSummary('frontend', '401', 1, 50), durationMs: 49 };
  delete invalid.runAttempt;
  const filePath = path.join(directory, 'invalid.json');
  writeFileSync(filePath, `${JSON.stringify(invalid)}\n`, 'utf8');

  const result = spawnSync(process.execPath, [checkerScript, filePath], { encoding: 'utf8' });
  assert.notEqual(result.status, 0, 'invalid timing summary should fail validation');
});

test('start capture emits a UTC timestamp for the workflow output', () => {
  const result = execFileSync(process.execPath, [reportScript, '--capture-start'], { encoding: 'utf8' });
  assert.match(result.trim(), /^started_at=\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
});
