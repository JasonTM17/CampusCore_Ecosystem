import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { composeArgs, parseArgs, validateComposeOverlay } from './contract-verify.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'contract-verify-options-'));
const fixture = path.join(temp, 'repo');
fs.mkdirSync(fixture);
fs.writeFileSync(path.join(fixture, 'overlay.yml'), 'services:\n  restful-api:\n    environment:\n      EXAMPLE: "true"\n');
fs.writeFileSync(path.join(fixture, 'not-yaml.txt'), 'services: {}\n');
test.after(() => {
  // Only the known, newly created test fixture may be removed recursively.
  assert.equal(path.dirname(path.resolve(temp)), path.resolve(os.tmpdir()));
  assert.ok(path.basename(temp).startsWith('contract-verify-options-'));
  fs.rmSync(temp, { recursive: true, force: true });
});

const argv = (...options) => ['node', 'contract-verify.mjs', 'contract-probes', ...options];

test('omitting the overlay preserves the existing compose file and defaults', () => {
  const parsed = parseArgs(argv('--project', 'campuscore-contract-test'), fixture);
  assert.equal(parsed.composeOverlay, null);
  assert.equal(parsed.project, 'campuscore-contract-test');
  assert.equal(parsed.evidence, path.join(fixture, 'artifacts/verification/contracts'));
  assert.deepEqual(composeArgs(parsed.project, parsed.composeOverlay, fixture), [
    'compose', '-p', parsed.project, '-f', path.join(fixture, 'docker-compose.e2e.yml'),
  ]);
});

test('a valid repo-relative overlay is appended after the base compose file', () => {
  const parsed = parseArgs(argv('--compose-overlay', 'overlay.yml'), fixture);
  assert.equal(parsed.composeOverlay, path.join(fixture, 'overlay.yml'));
  const prefix = composeArgs('campuscore-test', parsed.composeOverlay, fixture);
  assert.deepEqual(prefix.slice(-4), [
    '-f', path.join(fixture, 'docker-compose.e2e.yml'), '-f', path.join(fixture, 'overlay.yml'),
  ]);
});

test('missing option values and unknown flags are rejected', () => {
  for (const option of ['--compose-overlay', '--project', '--evidence', '--its']) {
    assert.throws(() => parseArgs(argv(option), fixture), /requires a value/);
    assert.throws(() => parseArgs(argv(option, '--project', 'campuscore-test'), fixture), /requires a value/);
  }
  assert.throws(() => parseArgs(argv('--compose-overly', 'overlay.yml'), fixture), /unknown option/);
});

test('overlay validation rejects missing, non-YAML, absolute and outside paths', () => {
  for (const name of ['missing.yml', 'not-yaml.txt', '../outside.yml', 'C:\\outside.yml', '/outside.yml', '.']) {
    assert.throws(() => validateComposeOverlay(name, fixture), /compose-overlay/);
  }
  fs.mkdirSync(path.join(fixture, 'directory.yml'));
  assert.throws(() => validateComposeOverlay('directory.yml', fixture), /existing YAML file/);
});

test('overlay validation rejects a link resolving outside the project', () => {
  const outside = path.join(temp, 'outside');
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'overlay.yml'), 'services: {}\n');
  fs.symlinkSync(outside, path.join(fixture, 'outside-link'), 'junction');
  assert.throws(() => validateComposeOverlay('outside-link/overlay.yml', fixture), /resolves outside/);
});

test('project validation matches the disposable platform convention; pgit consumers remain valid', () => {
  for (const project of ['other-project', 'campuscore-TEST', 'campuscore-', '../campuscore-test']) {
    assert.throws(() => parseArgs(argv('--project', project), fixture), /campuscore-\*/);
  }
  const parsed = parseArgs(['node', 'contract-verify.mjs', 'pgit-real', '--project', 'campuscore-test', '--its', 'OnePostgresIT']);
  assert.equal(parsed.its, 'OnePostgresIT');
  assert.throws(() => parseArgs(['node', 'contract-verify.mjs', 'pgit-real', '--compose-overlay', 'overlay.yml'], fixture), /only supported/);
});

// Preload stubs replace every subprocess and HTTP call in the child. No Docker
// binary, service, provider or dependency installation is used by these tests.
const preload = path.join(temp, 'preload.mjs');
fs.writeFileSync(preload, `
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import fs from 'node:fs';
childProcess.spawnSync = (command, args, options) => {
  fs.appendFileSync(process.env.CONTRACT_OPTIONS_TEST_RECORD, JSON.stringify({ command, args, env: {
    POSTGRES_HOST_PORT: options?.env?.POSTGRES_HOST_PORT,
    E2E_API_HOST_PORT: options?.env?.E2E_API_HOST_PORT,
  } }) + '\\n');
  const invalid = args.includes('config') && process.env.CONTRACT_OPTIONS_TEST_INVALID === '1';
  return { status: invalid ? 1 : 0, stdout: args.includes('logs') ? 'synthetic container log' : '{}', stderr: '' };
};
syncBuiltinESMExports();
let firstHealth = true;
globalThis.fetch = async (url, options = {}) => {
  if (String(url).includes('/health/liveness') && firstHealth) {
    firstHealth = false;
    throw new Error('port free');
  }
  const supplied = options.headers?.['X-Request-Id'];
  const requestId = supplied && /^[A-Za-z0-9._:-]{1,128}$/.test(supplied) ? supplied : 'generated-request-id';
  return new Response('{}', { status: String(url).includes('/notifications') ? 401 : 200,
    headers: { 'cache-control': 'no-store', 'x-request-id': requestId } });
};
`);

function runCli(name, options, invalidConfig = false) {
  const record = path.join(temp, `${name}-calls.jsonl`);
  const evidence = path.join(temp, `${name}-evidence`);
  const result = spawnSync(process.execPath, [
    '--import', pathToFileURL(preload).href, path.join(repo, 'scripts/contract-verify.mjs'),
    'contract-probes', '--project', 'campuscore-options-test', '--evidence', evidence, ...options,
  ], {
    cwd: repo, encoding: 'utf8', timeout: 10000,
    env: { ...process.env, CONTRACT_OPTIONS_TEST_RECORD: record, CONTRACT_OPTIONS_TEST_INVALID: invalidConfig ? '1' : '0' },
  });
  assert.equal(result.error, undefined, result.error?.message);
  const calls = fs.existsSync(record) ? fs.readFileSync(record, 'utf8').trim().split('\n').map(JSON.parse) : [];
  return { result, calls, evidence };
}

test('the actual CLI rejects invalid options before Docker calls or evidence creation', () => {
  const { result, calls, evidence } = runCli('invalid-option', ['--unknown']);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /unknown option/);
  assert.deepEqual(calls, []);
  assert.equal(fs.existsSync(evidence), false);
});

test('up, logs and down use the same validated overlay and interpolation environment', () => {
  const overlay = path.join(repo, 'docker-compose.sso-preview.yml');
  const { result, calls, evidence } = runCli('overlay', ['--compose-overlay', 'docker-compose.sso-preview.yml']);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const docker = calls.filter((call) => call.command === 'docker');
  const prefix = composeArgs('campuscore-options-test', overlay);
  assert.deepEqual(docker.map((call) => call.args[prefix.length]), ['config', 'up', 'logs', 'down']);
  for (const call of docker) {
    assert.deepEqual(call.args.slice(0, prefix.length), prefix);
    assert.deepEqual(call.env, docker[0].env);
  }
  const receipt = JSON.parse(fs.readFileSync(path.join(evidence, 'contract-probes.json'), 'utf8'));
  assert.equal(receipt.composeOverlay, 'docker-compose.sso-preview.yml');
  assert.equal(receipt.verdict, 'PASS');
});

test('a YAML/schema validation failure never starts or tears down the stack', () => {
  const { result, calls } = runCli('invalid-config', ['--compose-overlay', 'docker-compose.sso-preview.yml'], true);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /compose overlay validation failed/);
  const prefix = composeArgs('campuscore-options-test', path.join(repo, 'docker-compose.sso-preview.yml'));
  assert.deepEqual(calls.map((call) => call.args.slice(prefix.length)), [['config', '--quiet']]);
});

test('the actual CLI without an overlay retains the single-file up/logs/down flow', () => {
  const { result, calls, evidence } = runCli('default', []);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const docker = calls.filter((call) => call.command === 'docker');
  const prefix = composeArgs('campuscore-options-test');
  assert.deepEqual(docker.map((call) => call.args[prefix.length]), ['up', 'logs', 'down']);
  for (const call of docker) assert.deepEqual(call.args.slice(0, prefix.length), prefix);
  const receipt = JSON.parse(fs.readFileSync(path.join(evidence, 'contract-probes.json'), 'utf8'));
  assert.equal(receipt.composeOverlay, undefined);
  assert.equal(receipt.verdict, 'PASS');
});
