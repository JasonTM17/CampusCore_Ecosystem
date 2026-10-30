#!/usr/bin/env node

import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync as bashExists } from 'node:fs';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The PATH bash on Windows can be the WSL launcher (no node, no drive paths): prefer Git Bash there.
const BASH = process.platform === 'win32' && bashExists('C:\\Program Files\\Git\\bin\\bash.exe')
  ? 'C:\\Program Files\\Git\\bin\\bash.exe'
  : 'bash';

// Temp cleanup is best effort: a just-exited shell can still hold the directory on Windows.
function removeTempDir(dir) {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch (error) {
    if (error?.code !== 'EPERM' && error?.code !== 'EBUSY') throw error;
  }
}

function getYamlParser(repoRoot) {
  try {
    const frontendRequire = createRequire(path.join(repoRoot, 'frontend', 'package.json'));
    return frontendRequire('js-yaml');
  } catch {
    const scriptsRequire = createRequire(path.join(repoRoot, 'scripts', 'check-doc-hygiene.mjs'));
    return scriptsRequire('js-yaml');
  }
}

export function loadWorkflow(workflowPath, repoRoot) {
  const yaml = getYamlParser(repoRoot);
  const content = readFileSync(workflowPath, 'utf8');
  return yaml.load(content);
}

export function findReplayJobs(workflowDoc) {
  const matches = [];
  for (const [jobId, job] of Object.entries(workflowDoc?.jobs ?? {})) {
    const steps = job?.steps ?? [];
    const hasCaptureStart = steps.some((s) => s?.name === 'Capture CI job start');
    const hasWriteSummary = steps.some((s) => s?.name === 'Write and validate CI timing summary');
    const hasSentinel = steps.some(
      (s) => typeof s?.run === 'string' && s.run.includes("git grep --quiet -E 'sk-")
    );
    if (hasCaptureStart && hasWriteSummary && hasSentinel) {
      matches.push({ jobId, job });
    }
  }
  return matches;
}

export function extractSentinelBlock(stepRun) {
  if (typeof stepRun !== 'string') return null;
  const startIdx = stepRun.indexOf("if git grep --quiet -E 'sk-");
  if (startIdx === -1) return null;

  let actualStart = startIdx;
  const prefix = stepRun.substring(0, startIdx).trim();
  if (prefix.endsWith('set -o pipefail')) {
    actualStart = stepRun.lastIndexOf('set -o pipefail', startIdx);
  }

  const fiFiIdx = stepRun.indexOf('fi\nfi', startIdx);
  if (fiFiIdx !== -1) {
    return stepRun.substring(actualStart, fiFiIdx + 5).trim();
  }
  const fiRfiIdx = stepRun.indexOf('fi\r\nfi', startIdx);
  if (fiRfiIdx !== -1) {
    return stepRun.substring(actualStart, fiRfiIdx + 6).trim();
  }
  return null;
}

export function substituteGitHubExpressions(templateString, context) {
  if (typeof templateString !== 'string') return templateString;
  return templateString.replace(/\$\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_, expression) => {
    if (expression in context) {
      return String(context[expression]);
    }
    return '';
  });
}

export function assertJobTimingStructure(jobId, job) {
  const steps = job?.steps ?? [];
  const startStep = steps.find((s) => s?.name === 'Capture CI job start');
  const writeStep = steps.find((s) => s?.name === 'Write and validate CI timing summary');
  const uploadStep = steps.find(
    (s) => s?.name === 'Upload CI timing summary' || s?.uses?.startsWith('actions/upload-artifact')
  );

  assert.ok(startStep, `[${jobId}] step "Capture CI job start" is required`);
  assert.equal(
    startStep['continue-on-error'],
    true,
    `[${jobId}] "Capture CI job start" must specify continue-on-error: true`
  );

  assert.ok(writeStep, `[${jobId}] step "Write and validate CI timing summary" is required`);
  assert.equal(
    writeStep['continue-on-error'],
    true,
    `[${jobId}] "Write and validate CI timing summary" must specify continue-on-error: true`
  );
  assert.equal(
    writeStep.if,
    'always()',
    `[${jobId}] "Write and validate CI timing summary" must specify if: always()`
  );

  assert.ok(uploadStep, `[${jobId}] step "Upload CI timing summary" is required`);
  assert.equal(
    uploadStep['continue-on-error'],
    true,
    `[${jobId}] "Upload CI timing summary" must specify continue-on-error: true`
  );
  assert.equal(
    uploadStep.if,
    'always()',
    `[${jobId}] "Upload CI timing summary" must specify if: always()`
  );

  assert.equal(
    uploadStep.with?.path,
    'artifacts/ci/ci-timing-summary.json',
    `[${jobId}] upload step path must reference artifacts/ci/ci-timing-summary.json`
  );
}

export function replayTimingStep(jobId, job, repoRoot, syntheticOverrides = {}) {
  const steps = job?.steps ?? [];
  const startStep = steps.find((s) => s?.name === 'Capture CI job start');
  const writeStep = steps.find((s) => s?.name === 'Write and validate CI timing summary');

  const tmpDir = mkdtempSync(path.join(os.tmpdir(), `ci-replay-timing-${jobId}-`));
  try {
    const scriptsDir = path.join(tmpDir, 'scripts');
    mkdirSync(scriptsDir, { recursive: true });

    copyFileSync(
      path.join(repoRoot, 'scripts', 'ci-timing-report.mjs'),
      path.join(scriptsDir, 'ci-timing-report.mjs')
    );
    copyFileSync(
      path.join(repoRoot, 'scripts', 'check-ci-timing-report.mjs'),
      path.join(scriptsDir, 'check-ci-timing-report.mjs')
    );

    let startedAt = new Date(Date.now() - 5000).toISOString();
    if (startStep?.run) {
      const outputFilePath = path.join(tmpDir, 'github_output');
      writeFileSync(outputFilePath, '', 'utf8');
      const startRes = spawnSync(BASH, ['-c', startStep.run.replace(/\r\n/g, '\n')], {
        cwd: tmpDir,
        env: { ...process.env, GITHUB_OUTPUT: outputFilePath },
        encoding: 'utf8',
      });
      if (startRes.status === 0 && existsSync(outputFilePath)) {
        const outContent = readFileSync(outputFilePath, 'utf8');
        const m = outContent.match(/started_at=(.+)/);
        if (m) startedAt = m[1].trim();
      }
    }

    const context = {
      'github.workflow': 'Course API and Client CI',
      'github.run_id': '88881234',
      'github.run_attempt': '1',
      'github.job': jobId,
      'job.status': 'success',
      'steps.ci_timing_start.outputs.started_at': startedAt,
      ...syntheticOverrides,
    };

    const evaluatedEnv = {};
    for (const [key, val] of Object.entries(writeStep.env ?? {})) {
      evaluatedEnv[key] = substituteGitHubExpressions(val, context);
    }

    const substitutedRun = substituteGitHubExpressions(writeStep.run, context);
    const result = spawnSync(BASH, ['-c', substitutedRun.replace(/\r\n/g, '\n')], {
      cwd: tmpDir,
      env: { ...process.env, ...evaluatedEnv },
      encoding: 'utf8',
    });

    assert.equal(
      result.status,
      0,
      `[${jobId}] timing step failed with status ${result.status}:\n${result.stderr || result.stdout}`
    );

    const summaryPath = path.join(tmpDir, 'artifacts', 'ci', 'ci-timing-summary.json');
    assert.ok(
      existsSync(summaryPath),
      `[${jobId}] timing summary file missing at artifacts/ci/ci-timing-summary.json`
    );

    const checkRes = spawnSync(
      process.execPath,
      [path.join(scriptsDir, 'check-ci-timing-report.mjs'), summaryPath],
      { cwd: tmpDir, encoding: 'utf8' }
    );
    assert.equal(
      checkRes.status,
      0,
      `[${jobId}] check-ci-timing-report.mjs rejected summary: ${checkRes.stderr || checkRes.stdout}`
    );

    const summaryData = JSON.parse(readFileSync(summaryPath, 'utf8'));
    assert.equal(summaryData.job, jobId);
    assert.equal(summaryData.conclusion, context['job.status']);
    assert.equal(summaryData.runAttempt, Number(context['github.run_attempt']));
    assert.ok(summaryData.durationMs >= 0);

    return summaryData;
  } finally {
    removeTempDir(tmpDir);
  }
}

export function replaySentinel(jobId, job) {
  const steps = job?.steps ?? [];
  const sentinelStep = steps.find(
    (s) => typeof s?.run === 'string' && s.run.includes("git grep --quiet -E 'sk-")
  );
  assert.ok(sentinelStep, `[${jobId}] sentinel step required`);

  const sentinelBlock = extractSentinelBlock(sentinelStep.run);
  assert.ok(sentinelBlock, `[${jobId}] could not extract sentinel block`);
  const bashScript = sentinelBlock.replace(/\r\n/g, '\n');

  const gitEnv = {
    ...process.env,
    GIT_AUTHOR_NAME: 'CI Tester',
    GIT_AUTHOR_EMAIL: 'tester@example.com',
    GIT_COMMITTER_NAME: 'CI Tester',
    GIT_COMMITTER_EMAIL: 'tester@example.com',
    GIT_CONFIG_GLOBAL: '',
    GIT_CONFIG_SYSTEM: '',
  };

  const tempRepo = mkdtempSync(path.join(os.tmpdir(), `ci-replay-sentinel-${jobId}-`));
  try {
    execFileSync('git', ['-c', 'core.autocrlf=false', 'init', '-q'], { cwd: tempRepo, env: gitEnv });

    // Sub-case 1: clean tree -> exit 0
    writeFileSync(path.join(tempRepo, 'clean.txt'), 'ordinary clean code\n', 'utf8');
    execFileSync('git', ['-c', 'core.autocrlf=false', 'add', 'clean.txt'], { cwd: tempRepo, env: gitEnv });
    execFileSync('git', ['-c', 'core.autocrlf=false', 'commit', '-q', '-m', 'clean tree commit'], { cwd: tempRepo, env: gitEnv });

    const cleanRes = spawnSync(BASH, ['-c', bashScript], {
      cwd: tempRepo,
      encoding: 'utf8',
    });
    assert.equal(
      cleanRes.status,
      0,
      `[${jobId}] sentinel block must exit 0 on clean tree; got ${cleanRes.status}. stderr: ${cleanRes.stderr}`
    );

    // Sub-case 2: synthetic match -> exit 1
    // Invariant: construct fake key dynamically at runtime; never write literal secret string
    const prefix = ['s', 'k', '-'].join('');
    const body = 'Abc123SyntheticTokenValue99';
    const fakeKey = `${prefix}${body}`;

    writeFileSync(path.join(tempRepo, 'credentials.txt'), `dummy=${fakeKey}\n`, 'utf8');
    execFileSync('git', ['-c', 'core.autocrlf=false', 'add', 'credentials.txt'], { cwd: tempRepo, env: gitEnv });
    execFileSync('git', ['-c', 'core.autocrlf=false', 'commit', '-q', '-m', 'add token'], { cwd: tempRepo, env: gitEnv });

    const matchRes = spawnSync(BASH, ['-c', bashScript], {
      cwd: tempRepo,
      encoding: 'utf8',
    });
    assert.equal(
      matchRes.status,
      1,
      `[${jobId}] sentinel block must exit 1 on synthetic match; got ${matchRes.status}`
    );
  } finally {
    removeTempDir(tempRepo);
  }

  // Sub-case 3: non-git directory failure -> exit nonzero
  const nonGitDir = mkdtempSync(path.join(os.tmpdir(), `ci-replay-sentinel-nongit-${jobId}-`));
  try {
    const nonGitRes = spawnSync(BASH, ['-c', bashScript], {
      cwd: nonGitDir,
      encoding: 'utf8',
    });
    assert.notEqual(
      nonGitRes.status,
      0,
      `[${jobId}] sentinel block must exit nonzero when git fails; got ${nonGitRes.status}`
    );
  } finally {
    rmSync(nonGitDir, { recursive: true, force: true });
  }
}

export function replayWorkflow(workflowPath, options = {}) {
  const repoRoot =
    options.repoRoot ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const targetPath = workflowPath ?? path.join(repoRoot, '.github', 'workflows', 'ci.yml');
  const doc = loadWorkflow(targetPath, repoRoot);

  const replayJobs = findReplayJobs(doc);
  if (replayJobs.length === 0) {
    throw new Error('no matching jobs found containing capture start, timing summary, and sentinel steps');
  }

  const results = [];
  for (const { jobId, job } of replayJobs) {
    assertJobTimingStructure(jobId, job);
    const summary = replayTimingStep(jobId, job, repoRoot, options.syntheticOverrides);
    replaySentinel(jobId, job);
    results.push({ jobId, summary });
  }

  return {
    replayedJobCount: results.length,
    jobs: results,
  };
}

function main() {
  const args = process.argv.slice(2);
  const workflowFile = args[0];

  try {
    const result = replayWorkflow(workflowFile);
    console.log(
      `CI workflow local replay succeeded (${result.replayedJobCount} job(s) verified: ${result.jobs.map((j) => j.jobId).join(', ')}).`
    );
  } catch (err) {
    console.error(`CI workflow replay failed: ${err.message}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
