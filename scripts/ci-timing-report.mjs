#!/usr/bin/env node

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateTimingSummary } from './check-ci-timing-report.mjs';

const conclusionValues = new Set(['success', 'failure', 'cancelled', 'skipped']);

function captureStart() {
  process.stdout.write(`started_at=${new Date().toISOString()}\n`);
}

function writeJobSummary() {
  const startedAt = process.env.CI_TIMING_STARTED_AT;
  const completedAt = new Date().toISOString();
  const summary = {
    schemaVersion: 1,
    workflow: process.env.CI_TIMING_WORKFLOW,
    runId: process.env.CI_TIMING_RUN_ID,
    runAttempt: Number(process.env.CI_TIMING_RUN_ATTEMPT),
    job: process.env.CI_TIMING_JOB,
    startedAt,
    completedAt,
    durationMs: Date.parse(completedAt) - Date.parse(startedAt),
    conclusion: process.env.CI_TIMING_CONCLUSION,
  };
  const errors = validateTimingSummary(summary);
  if (errors.length > 0) throw new Error(errors.join('; '));

  const outputPath = process.env.CI_TIMING_OUTPUT ?? path.join('artifacts', 'ci', 'ci-timing-summary.json');
  mkdirSync(path.dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
}

function parseJson(text, source) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`invalid JSON input from ${source}`);
  }
}

function readDocuments(filePaths) {
  if (filePaths.length === 0) {
    const text = readFileSync(0, 'utf8');
    if (text.trim() === '') throw new Error('provide summary files or JSON on stdin');
    return [{ value: parseJson(text, 'stdin'), source: 'stdin' }];
  }
  return filePaths.map((filePath) => ({
    value: parseJson(readFileSync(filePath, 'utf8'), filePath),
    source: filePath,
  }));
}

function isTimingSummary(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && 'schemaVersion' in value;
}

function isWorkflowRun(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    ('databaseId' in value || 'runId' in value || 'id' in value) &&
    ('attempt' in value || 'runAttempt' in value || 'conclusion' in value || 'status' in value)
  );
}

function normalizeWorkflowJob(job, run) {
  const jobName = job?.name ?? job?.job ?? job?.jobName;
  const startedAt = job?.startedAt ?? job?.started_at;
  const completedAt = job?.completedAt ?? job?.completed_at;
  const runId = run.databaseId ?? run.runId ?? run.id;
  const runAttempt = Number(run.attempt ?? run.runAttempt ?? 1);
  const durationMs =
    Number.isSafeInteger(job?.durationMs) ? job.durationMs :
    Number.isSafeInteger(job?.duration_ms) ? job.duration_ms :
    Number.isFinite(Date.parse(startedAt)) && Number.isFinite(Date.parse(completedAt))
      ? Date.parse(completedAt) - Date.parse(startedAt)
      : undefined;

  if (
    typeof jobName !== 'string' ||
    typeof runId === 'undefined' ||
    !Number.isSafeInteger(runAttempt) ||
    typeof startedAt !== 'string' ||
    typeof completedAt !== 'string' ||
    !Number.isSafeInteger(durationMs) ||
    durationMs < 0 ||
    !conclusionValues.has(job?.conclusion)
  ) {
    return null;
  }
  return {
    schemaVersion: 1,
    workflow: run.workflowName ?? run.workflow ?? 'GitHub Actions',
    runId: String(runId),
    runAttempt,
    job: jobName,
    startedAt,
    completedAt,
    durationMs,
    conclusion: job.conclusion,
  };
}

function percentile(sortedDurations, percentileValue) {
  if (sortedDurations.length === 0) return null;
  const rank = Math.ceil(percentileValue * sortedDurations.length);
  return sortedDurations[Math.max(0, rank - 1)];
}

function buildReport(documents) {
  const summaries = [];
  const workflowRuns = [];
  for (const { value, source } of documents) {
    const items = Array.isArray(value) ? value : [value];
    for (const item of items) {
      if (isTimingSummary(item)) {
        const errors = validateTimingSummary(item);
        if (errors.length > 0) throw new Error(`${source}: ${errors.join('; ')}`);
        summaries.push(item);
      } else if (isWorkflowRun(item)) {
        workflowRuns.push(item);
        for (const job of Array.isArray(item.jobs) ? item.jobs : []) {
          const summary = normalizeWorkflowJob(job, item);
          if (summary && validateTimingSummary(summary).length === 0) summaries.push(summary);
        }
      } else {
        throw new Error(`${source}: expected a timing summary or GitHub workflow run`);
      }
    }
  }

  const runObservations = new Map();
  function addRunObservation(runId, attempt, conclusion) {
    const observations = runObservations.get(runId) ?? [];
    observations.push({ attempt, conclusion });
    runObservations.set(runId, observations);
  }
  for (const run of workflowRuns) {
    const runId = String(run.databaseId ?? run.runId ?? run.id);
    const attempt = Number(run.attempt ?? run.runAttempt ?? 1);
    const conclusion = conclusionValues.has(run.conclusion) ? run.conclusion : null;
    addRunObservation(runId, attempt, conclusion);
  }
  for (const summary of summaries) {
    addRunObservation(summary.runId, summary.runAttempt, summary.conclusion);
  }

  const groupedJobs = new Map();
  for (const summary of summaries) {
    const records = groupedJobs.get(summary.job) ?? [];
    records.push(summary);
    groupedJobs.set(summary.job, records);
  }
  const jobs = [...groupedJobs.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([job, records]) => {
      const durations = records.map((record) => record.durationMs).sort((left, right) => left - right);
      const attemptsByRun = new Map();
      for (const record of records) {
        attemptsByRun.set(record.runId, Math.max(attemptsByRun.get(record.runId) ?? 0, record.runAttempt));
      }
      return {
        job,
        sampleCount: durations.length,
        p50DurationMs: percentile(durations, 0.5),
        p95DurationMs: percentile(durations, 0.95),
        rerunCount: [...attemptsByRun.values()].filter((attempt) => attempt > 1).length,
        failureCount: records.filter((record) => record.conclusion === 'failure').length,
      };
    });

  let rerunCount = 0;
  let failedRunCount = 0;
  for (const observations of runObservations.values()) {
    const latestAttempt = Math.max(...observations.map((observation) => observation.attempt));
    const latest = observations.filter((observation) => observation.attempt === latestAttempt);
    if (latestAttempt > 1) rerunCount += 1;
    if (latest.some((observation) => observation.conclusion === 'failure')) failedRunCount += 1;
  }

  return {
    schemaVersion: 1,
    source: workflowRuns.length > 0 && summaries.length > 0
      ? 'mixed'
      : workflowRuns.length > 0
        ? 'github-runs'
        : 'job-summaries',
    runs: {
      runCount: runObservations.size,
      rerunCount,
      failedRunCount,
    },
    jobs,
  };
}

function main() {
  const args = process.argv.slice(2);
  if (args[0] === '--capture-start' && args.length === 1) return captureStart();
  if (args[0] === '--write-job-summary' && args.length === 1) return writeJobSummary();
  if (args.some((argument) => argument.startsWith('--'))) {
    throw new Error('Usage: node scripts/ci-timing-report.mjs [summary.json ...]');
  }
  process.stdout.write(`${JSON.stringify(buildReport(readDocuments(args)), null, 2)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(`CI timing report failed: ${error.message}`);
    process.exitCode = 1;
  }
}
