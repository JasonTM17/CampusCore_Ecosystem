#!/usr/bin/env node

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scannerScript = path.join(repoRoot, 'scripts', 'check-assistant-secrets.mjs');

function checkIgnoreStatus(relativePath) {
  const result = spawnSync(
    'git',
    ['check-ignore', '-q', '--no-index', '--', relativePath],
    { cwd: repoRoot },
  );
  return result.status;
}

function makeRepo(t) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'secret-hygiene-'));
  const emptyGitConfig = path.join(dir, 'empty-gitconfig');
  writeFileSync(emptyGitConfig, '', 'utf8');
  const env = {
    ...process.env,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: emptyGitConfig,
  };
  execFileSync('git', ['init', '-q'], { cwd: dir, env });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return { dir, env };
}

function runScanner(env, cwd) {
  const result = spawnSync(process.execPath, [scannerScript], {
    cwd,
    env,
    encoding: 'utf8',
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

test('gitignore covers credential stores and dump destinations, keeps examples', () => {
  const ignored = [
    '.env.staging',
    'frontend/.env.preview',
    'private.pem',
    'release.keystore',
    '.aws/credentials',
    'prod-backup.sql.gz',
    'prod-backup.dump',
    'id_rsa_backup',
    '.npmrc',
    '.netrc',
  ];
  for (const relativePath of ignored) {
    assert.equal(checkIgnoreStatus(relativePath), 0, `${relativePath} should be ignored`);
  }
  const trackedExamples = [
    '.env.example',
    '.env.production.example',
    'frontend/.env.example',
    'mobile/.env.example',
  ];
  for (const relativePath of trackedExamples) {
    assert.equal(checkIgnoreStatus(relativePath), 1, `${relativePath} must stay un-ignored`);
  }
});

test('scanner reports planted secret by path and never prints its value', (t) => {
  const { dir, env } = makeRepo(t);
  const secretValue = ['sk-', 'UN1Q', 'secretHygiene', 'Probe', 'Value', '00000001'].join('');
  writeFileSync(path.join(dir, 'leaky.txt'), `token=${secretValue}\n`, 'utf8');
  mkdirSync(path.join(dir, 'conf'));
  writeFileSync(path.join(dir, 'conf', 'service-account-dev.json'), '{"synthetic":true}\n', 'utf8');
  const { status, output } = runScanner(env, dir);
  assert.equal(status, 1, output);
  assert.match(output, /leaky\.txt/);
  assert.match(output, /service-account-dev\.json/);
  assert.ok(!output.includes(secretValue), 'scanner output must never contain the secret value');
});

test('scanner passes on a clean tree with allow-listed example/public names', (t) => {
  const { dir, env } = makeRepo(t);
  writeFileSync(path.join(dir, 'README.md'), '# synthetic fixture\n', 'utf8');
  writeFileSync(path.join(dir, '.env.example'), 'API_URL=https://example.invalid\n', 'utf8');
  writeFileSync(path.join(dir, 'id_rsa.pub'), 'ssh-rsa synthetic-public-key\n', 'utf8');
  const { status, output } = runScanner(env, dir);
  assert.equal(status, 0, output);
  assert.match(output, /PASS/);
});
