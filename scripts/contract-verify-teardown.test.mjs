import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'contract-verify-teardown-'));
test.after(() => {
  // Only the known, newly created test fixture may be removed recursively.
  assert.equal(path.dirname(path.resolve(temp)), path.resolve(os.tmpdir()));
  assert.ok(path.basename(temp).startsWith('contract-verify-teardown-'));
  fs.rmSync(temp, { recursive: true, force: true });
});

// Preload stubs replace every subprocess and HTTP call in the child. No Docker
// binary, service, provider or dependency installation is used by these tests.
// CONTRACT_TEARDOWN_TEST_OCCUPIED=1 makes the API port probe answer "occupied".
// CONTRACT_TEARDOWN_TEST_EXISTING=1 makes `compose ps -aq` report a container id.
const preload = path.join(temp, 'preload.mjs');
fs.writeFileSync(preload, `
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import fs from 'node:fs';
childProcess.spawnSync = (command, args, options) => {
  fs.appendFileSync(process.env.CONTRACT_TEARDOWN_TEST_RECORD, JSON.stringify({ command, args }) + '\\n');
  if (args.includes('ps')) {
    return { status: 0, stdout: process.env.CONTRACT_TEARDOWN_TEST_EXISTING === '1' ? 'abc123def456\\n' : '', stderr: '' };
  }
  return { status: 0, stdout: args.includes('logs') ? 'synthetic container log' : '{}', stderr: '' };
};
syncBuiltinESMExports();
let firstHealth = true;
globalThis.fetch = async (url, options = {}) => {
  if (String(url).includes('/health/liveness') && firstHealth) {
    firstHealth = false;
    if (process.env.CONTRACT_TEARDOWN_TEST_OCCUPIED === '1') return new Response('{}', { status: 200 });
    throw new Error('port free');
  }
  const supplied = options.headers?.['X-Request-Id'];
  const requestId = supplied && /^[A-Za-z0-9._:-]{1,128}$/.test(supplied) ? supplied : 'generated-request-id';
  return new Response('{}', { status: String(url).includes('/notifications') ? 401 : 200,
    headers: { 'cache-control': 'no-store', 'x-request-id': requestId } });
};
`);

function runCli(name, extraEnv = {}) {
  const record = path.join(temp, `${name}-calls.jsonl`);
  const evidence = path.join(temp, `${name}-evidence`);
  const result = spawnSync(process.execPath, [
    '--import', pathToFileURL(preload).href, path.join(repo, 'scripts/contract-verify.mjs'),
    'contract-probes', '--project', 'campuscore-teardown-test', '--evidence', evidence,
  ], {
    cwd: repo, encoding: 'utf8', timeout: 10000,
    env: { ...process.env, CONTRACT_TEARDOWN_TEST_RECORD: record, ...extraEnv },
  });
  assert.equal(result.error, undefined, result.error?.message);
  const calls = fs.existsSync(record) ? fs.readFileSync(record, 'utf8').trim().split('\n').map(JSON.parse) : [];
  const receipt = JSON.parse(fs.readFileSync(path.join(evidence, 'contract-probes.json'), 'utf8'));
  return { result, calls, receipt };
}

test('an occupied API port aborts before any compose call, so nothing is torn down', () => {
  const { result, calls, receipt } = runCli('occupied', { CONTRACT_TEARDOWN_TEST_OCCUPIED: '1' });
  assert.equal(result.status, 1);
  assert.match(receipt.error, /4100|occupied/i);
  assert.deepEqual(calls.filter((call) => call.command === 'docker'), [],
    'a stack the run never started must never see a compose call');
});

test('a pre-existing compose project is refused before up and never torn down', () => {
  const { result, calls } = runCli('existing', { CONTRACT_TEARDOWN_TEST_EXISTING: '1' });
  assert.equal(result.status, 1);
  const docker = calls.filter((call) => call.command === 'docker');
  const verbs = docker.map((call) => call.args.find((arg) => ['config', 'ps', 'up', 'logs', 'down'].includes(arg)));
  assert.deepEqual(verbs, ['ps'], 'only the read-only ownership probe may run');
  assert.ok(!docker.some((call) => call.args.includes('down')),
    'a pre-existing project must never see `down -v`');
});

test('a stack this run started is still torn down with its volumes', () => {
  const { result, calls } = runCli('owned');
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const docker = calls.filter((call) => call.command === 'docker');
  const verbs = docker.map((call) => call.args.find((arg) => ['ps', 'up', 'logs', 'down'].includes(arg)));
  assert.deepEqual(verbs, ['ps', 'up', 'logs', 'down']);
  const down = docker.find((call) => call.args.includes('down'));
  assert.ok(down.args.includes('-v'), 'the disposable stack keeps volume cleanup');
});
