#!/usr/bin/env node

import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workflowPath = path.join(repoRoot, '.github', 'workflows', 'ci.yml');
const workflow = readFileSync(workflowPath, 'utf8');

function extractRunBlock(stepName) {
  const lines = workflow.split(/\r?\n/);
  const marker = `- name: ${stepName}`;
  const stepStart = lines.findIndex((line) => line.trim() === marker);
  assert.notEqual(stepStart, -1, `workflow step not found: ${stepName}`);

  let runStart = -1;
  for (let index = stepStart + 1; index < lines.length; index += 1) {
    if (/^\s{6}- (?:name|uses):/.test(lines[index])) break;
    if (/^\s{8}run: \|\s*$/.test(lines[index])) {
      runStart = index + 1;
      break;
    }
  }
  assert.notEqual(runStart, -1, `run block not found: ${stepName}`);

  const block = [];
  for (let index = runStart; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim() && !line.startsWith('          ')) break;
    block.push(line.startsWith('          ') ? line.slice(10) : '');
  }
  return block.join('\n');
}

function extractSentinelCommand(runBlock) {
  const lines = runBlock.split('\n');
  const start = lines.findIndex((line) => /^\s*if git grep\b/.test(line));
  assert.notEqual(start, -1, 'secret sentinel command not found');

  let depth = 0;
  for (let index = start; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (/^if(?:\s|$)/.test(line)) depth += 1;
    if (/^fi\s*$/.test(line)) depth -= 1;
    if (depth === 0) return lines.slice(start, index + 1).join('\n');
  }
  assert.fail('secret sentinel command is missing a closing fi');
}

const sentinelSteps = [
  'Secret hygiene gate (masked secret scan and test)',
  'Secret hygiene',
];
const sentinelCommands = sentinelSteps.map((stepName) => ({
  stepName,
  command: extractSentinelCommand(extractRunBlock(stepName)),
}));
assert.equal(sentinelCommands.length, 2, 'both early workflow sentinels must be covered');

function createFixture(t, trackedContent) {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'ci-secret-sentinel-'));
  const emptyGitConfig = path.join(directory, 'empty-gitconfig');
  writeFileSync(emptyGitConfig, '', 'utf8');
  const env = {
    ...process.env,
    GIT_CONFIG_GLOBAL: emptyGitConfig,
    GIT_CONFIG_NOSYSTEM: '1',
  };
  execFileSync('git', ['init', '-q'], { cwd: directory, env });
  if (trackedContent !== undefined) {
    writeFileSync(path.join(directory, 'fixture.txt'), trackedContent, 'utf8');
    execFileSync('git', ['add', '--', 'fixture.txt'], { cwd: directory, env });
  }
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return { directory, env };
}

function executeSentinel(command, cwd, env) {
  const result = spawnSync('bash', ['-e', '-c', command], {
    cwd,
    env,
    encoding: 'utf8',
  });
  assert.equal(result.error, undefined, 'bash should execute the extracted workflow command');
  return { status: result.status, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

for (const { stepName, command } of sentinelCommands) {
  test(`${stepName} rejects a synthetic match without disclosing it`, (t) => {
    const syntheticSentinel = `sk-${'A'.repeat(20)}`;
    const { directory, env } = createFixture(t, `fixture ${syntheticSentinel}\n`);
    const result = executeSentinel(command, directory, env);

    assert.notEqual(result.status, 0, 'a match must fail the sentinel');
    assert.equal(result.output.includes(syntheticSentinel), false, 'the sentinel value must stay out of output');
  });

  test(`${stepName} accepts a clean fixture`, (t) => {
    const { directory, env } = createFixture(t, 'fixture without a matching value\n');
    const result = executeSentinel(command, directory, env);

    assert.equal(result.status, 0, 'a clean fixture must pass');
  });

  test(`${stepName} fails when git grep cannot scan`, (t) => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'ci-secret-tool-failure-'));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const result = executeSentinel(command, directory, process.env);

    assert.notEqual(result.status, 0, 'a scanner failure must not be treated as clean');
  });
}
