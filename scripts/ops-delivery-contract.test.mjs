import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { casePgit, caseStack } from './platform-verify.mjs';
import { resolveEvidenceDir } from './verify-ecosystem.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => readFileSync(path.join(repoRoot, relative), 'utf8');
const systemdService = read('ops/systemd/campuscore-backup.service');
const systemdReadme = read('ops/systemd/README.md');
const caddyfile = read('ops/caddy/Caddyfile');
const verifyEcosystem = read('scripts/verify-ecosystem.mjs');
const caddyReadme = existsSync(path.join(repoRoot, 'ops/caddy/README.md')) ? read('ops/caddy/README.md') : '';

function worktreeFixture(t, prefix) {
  const dir = mkdtempSync(path.join(repoRoot, `.test-${prefix}-`));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(dir)), path.resolve(repoRoot));
    assert.ok(path.basename(dir).startsWith(`.test-${prefix}-`));
    rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

function writeProcessStub(fixture) {
  const preload = path.join(fixture, 'preload.mjs');
  writeFileSync(preload, `
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { EventEmitter } from 'node:events';

Object.defineProperty(process, 'platform', { value: 'win32' });
const fixture = path.resolve(process.env.VERIFY_TEST_FIXTURE);
const recordPath = process.env.VERIFY_TEST_RECORD;
const originalAppend = fs.appendFileSync.bind(fs);
function record(value) { originalAppend(recordPath, JSON.stringify(value) + '\\n'); }
function isExternalRootEnv(target) {
  const resolved = path.resolve(String(target));
  const relative = path.relative(fixture, resolved);
  return resolved === path.join(process.cwd(), '.env')
    && (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative));
}
function assertFixturePath(target) {
  const resolved = path.resolve(String(target));
  const relative = path.relative(fixture, resolved);
  if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
    throw new Error('stub rejected write outside worktree fixture');
  }
}
for (const method of ['mkdirSync', 'writeFileSync']) {
  const original = fs[method].bind(fs);
  fs[method] = (target, ...args) => {
    if (method === 'writeFileSync' && isExternalRootEnv(target)) return;
    assertFixturePath(target);
    return original(target, ...args);
  };
}
const originalChmodSync = fs.chmodSync.bind(fs);
fs.chmodSync = (target, ...args) => {
  if (isExternalRootEnv(target)) return;
  assertFixturePath(target);
  return originalChmodSync(target, ...args);
};
const originalOpen = fs.openSync.bind(fs);
fs.openSync = (target, flags, ...args) => {
  if (typeof flags === 'string' && /[wax]/.test(flags)) assertFixturePath(target);
  return originalOpen(target, flags, ...args);
};

class FakeSocket extends EventEmitter {
  setTimeout() { return this; }
  connect(port) {
    const busy = process.env.VERIFY_TEST_PORT === 'busy';
    setImmediate(() => this.emit(busy ? 'connect' : 'error', busy ? undefined : new Error('closed')));
    return this;
  }
  destroy() { return this; }
}
net.Socket = FakeSocket;
net.createServer = () => {
  const server = new EventEmitter();
  server.listen = (...args) => {
    const callback = args.at(-1);
    if (process.env.VERIFY_TEST_ALLOC === 'error') {
      setImmediate(() => server.emit('error', new Error('stubbed port allocation failure')));
    } else {
      setImmediate(callback);
    }
    return server;
  };
  server.address = () => ({ port: 45678 });
  server.close = (callback) => { setImmediate(callback); return server; };
  return server;
};

const signalHandlers = {};
const originalProcessOnce = process.once.bind(process);
process.once = (event, handler) => {
  if (process.env.VERIFY_TEST_SIGNAL === event && ['SIGINT', 'SIGTERM'].includes(event)) {
    signalHandlers[event] = handler;
    return process;
  }
  return originalProcessOnce(event, handler);
};
let signalSent = false;

childProcess.spawnSync = (command, args = [], options = {}) => {
  const env = options.env || {};
  record({
    kind: 'spawnSync',
    command,
    args,
    postgresPasswordIsExpected: env.POSTGRES_PASSWORD === 'campuscore_password',
    councilPasswordIsExpected: env.CAMPUSCORE_COUNCIL_POSTGRES_PASSWORD === 'campuscore_password',
  });
  if (command === 'docker' && args.includes('ps')) {
    if (process.env.VERIFY_TEST_MODE === 'race-credentials' && args.includes('--format')) {
      return { status: 0, stdout: '{"Service":"postgres","State":"running","Health":"healthy"}\\n', stderr: '' };
    }
    if (process.env.VERIFY_TEST_MODE === 'verify-owned' && args.includes('--format')) {
      return { status: 0, stdout: '{"Service":"postgres","State":"exited"}\\n', stderr: '' };
    }
    return { status: 0, stdout: process.env.VERIFY_TEST_EXISTING === '1' ? 'abc123\\n' : '', stderr: '' };
  }
  if (command === 'docker' && args.includes('volume') && args.includes('ls')) {
    return { status: 0, stdout: process.env.VERIFY_TEST_VOLUME_EXISTING === '1' ? 'project-volume\\n' : '', stderr: '' };
  }
  if (command === 'docker' && args.includes('up') && process.env.VERIFY_TEST_SIGNAL && !signalSent) {
    signalSent = true;
    signalHandlers[process.env.VERIFY_TEST_SIGNAL]?.();
  }
  if (command === 'docker' && args.includes('up') && process.env.VERIFY_TEST_MODE === 'verify-existing') {
    return { status: 1, stdout: '', stderr: 'stubbed compose startup failure' };
  }
  if (command === 'mvn' && process.env.VERIFY_TEST_MODE === 'race-credentials') {
    return { status: 0, stdout: 'Tests run: 1, Failures: 0, Errors: 0, Skipped: 0\\n', stderr: '' };
  }
  return { status: 0, stdout: '', stderr: '' };
};
childProcess.spawn = (command, args = []) => {
  const pid = 7100 + Number(process.env.VERIFY_TEST_CHILD_COUNT || 0);
  process.env.VERIFY_TEST_CHILD_COUNT = String(Number(process.env.VERIFY_TEST_CHILD_COUNT || 0) + 1);
  record({ kind: 'spawn', command, args, pid });
  return { pid, exitCode: null, signalCode: null, kill: (signal) => record({ kind: 'childKill', pid, signal }) };
};
childProcess.execFileSync = (command, args = []) => {
  record({ kind: 'execFileSync', command, args });
  if (command === 'netstat') return ' TCP 0.0.0.0:3102 0.0.0.0:0 LISTENING 4242\\n';
  return '';
};
syncBuiltinESMExports();
let contractFirstHealth = true;
globalThis.fetch = async (url, options = {}) => {
  if (process.env.VERIFY_TEST_CONTRACT === '1'
    && String(url).includes('/api/v1/health/liveness') && contractFirstHealth) {
    contractFirstHealth = false;
    throw new Error('stubbed port is free');
  }
  const supplied = options.headers?.['X-Request-Id'];
  return new Response('{}', {
    status: 200,
    headers: { 'cache-control': 'no-store', 'x-request-id': supplied || 'generated-request-id' },
  });
};
`, 'utf8');
  return preload;
}

function runPreviewStub(fixture, scriptName, mode, evidenceName = scriptName) {
  const preload = writeProcessStub(fixture);
  const record = path.join(fixture, `${scriptName}-${mode}.jsonl`);
  const evidence = path.join(fixture, evidenceName);
  const result = spawnSync(process.execPath, [
    '--import', pathToFileURL(preload).href,
    path.join(repoRoot, 'scripts', `${scriptName}.mjs`),
    'preview', '--project', 'campuscore-preview-safety', '--evidence', evidence,
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: 15000,
    env: {
      ...process.env,
      VERIFY_TEST_FIXTURE: fixture,
      VERIFY_TEST_RECORD: record,
      VERIFY_TEST_EXISTING: ['existing', 'verify-existing'].includes(mode) ? '1' : '0',
      VERIFY_TEST_VOLUME_EXISTING: mode === 'existing-volume' ? '1' : '0',
      VERIFY_TEST_SIGNAL: mode === 'signal' ? 'SIGINT' : '',
      VERIFY_TEST_MODE: mode === 'existing' ? 'verify-existing' : mode,
      VERIFY_TEST_PORT: mode === 'busy' ? 'busy' : 'free',
      VERIFY_TEST_CHILD_COUNT: '0',
    },
  });
  const calls = existsSync(record)
    ? readFileSync(record, 'utf8').trim().split(/\r?\n/).filter(Boolean).map(JSON.parse)
    : [];
  return { result, calls };
}

function runContractStub(fixture) {
  const preload = writeProcessStub(fixture);
  const record = path.join(fixture, 'contract-volume.jsonl');
  const evidence = path.join(fixture, 'contract-volume-evidence');
  const result = spawnSync(process.execPath, [
    '--import', pathToFileURL(preload).href,
    path.join(repoRoot, 'scripts/contract-verify.mjs'),
    'contract-probes', '--project', 'campuscore-contract-volume', '--evidence', evidence,
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: 15000,
    env: {
      ...process.env,
      VERIFY_TEST_FIXTURE: fixture,
      VERIFY_TEST_RECORD: record,
      VERIFY_TEST_EXISTING: '0',
      VERIFY_TEST_VOLUME_EXISTING: '1',
      VERIFY_TEST_CONTRACT: '1',
    },
  });
  const calls = existsSync(record)
    ? readFileSync(record, 'utf8').trim().split(/\r?\n/).filter(Boolean).map(JSON.parse)
    : [];
  return { result, calls };
}

function runRaceVerifyStub(fixture, scriptName, mode) {
  const preload = writeProcessStub(fixture);
  const record = path.join(fixture, `${scriptName}-${mode}.jsonl`);
  const evidence = path.join(fixture, `${scriptName}-${mode}-evidence`);
  const result = spawnSync(process.execPath, [
    '--import', pathToFileURL(preload).href,
    path.join(repoRoot, 'scripts', `${scriptName}.mjs`),
    'pg-race', '--project', 'campuscore-custom-project', '--evidence', evidence,
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: 15000,
    env: {
      ...process.env,
      VERIFY_TEST_FIXTURE: fixture,
      VERIFY_TEST_RECORD: record,
      VERIFY_TEST_EXISTING: mode === 'existing' ? '1' : '0',
      VERIFY_TEST_MODE: mode === 'existing' ? 'verify-existing' : mode,
      VERIFY_TEST_ALLOC: mode === 'alloc-error' ? 'error' : 'free',
      VERIFY_TEST_CHILD_COUNT: '0',
    },
  });
  const calls = existsSync(record)
    ? readFileSync(record, 'utf8').trim().split(/\r?\n/).filter(Boolean).map(JSON.parse)
    : [];
  return { result, calls };
}

function runRaceCredentialVerifyStub(fixture, scriptName) {
  const preload = writeProcessStub(fixture);
  const repo = path.join(fixture, 'repo');
  const scripts = path.join(repo, 'scripts');
  mkdirSync(scripts, { recursive: true });
  copyFileSync(path.join(repoRoot, 'scripts', `${scriptName}.mjs`), path.join(scripts, `${scriptName}.mjs`));
  copyFileSync(path.join(repoRoot, 'scripts', 'compose-secrets.mjs'), path.join(scripts, 'compose-secrets.mjs'));
  copyFileSync(path.join(repoRoot, '.env.example'), path.join(repo, '.env.example'));
  const record = path.join(fixture, `${scriptName}-credentials.jsonl`);
  const evidence = path.join(fixture, `${scriptName}-credentials-evidence`);
  const result = spawnSync(process.execPath, [
    '--import', pathToFileURL(preload).href,
    path.join(scripts, `${scriptName}.mjs`),
    'pg-race', '--project', 'campuscore-custom-project', '--evidence', evidence,
  ], {
    cwd: repo,
    encoding: 'utf8',
    timeout: 15000,
    env: {
      ...process.env,
      VERIFY_TEST_FIXTURE: fixture,
      VERIFY_TEST_RECORD: record,
      VERIFY_TEST_EXISTING: '0',
      VERIFY_TEST_MODE: 'race-credentials',
      VERIFY_TEST_ALLOC: 'free',
      VERIFY_TEST_CHILD_COUNT: '0',
    },
  });
  const calls = existsSync(record)
    ? readFileSync(record, 'utf8').trim().split(/\r?\n/).filter(Boolean).map(JSON.parse)
    : [];
  return { result, calls };
}

function git(repo, ...args) {
  const result = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 0, `${args.join(' ')} failed: ${result.stdout}${result.stderr}`);
  return result.stdout.trim();
}

function migrationFixture(fixture) {
  const repo = path.join(fixture, 'repo');
  const oldPath = 'java-services/restful-api/src/main/resources/db/migration/V150__add_optional_grade_versions.sql';
  const oldFile = path.join(repo, oldPath);
  mkdirSync(path.dirname(oldFile), { recursive: true });
  const stableLines = Array.from({ length: 40 }, (_, index) => `-- stable line ${index + 1}`);
  writeFileSync(oldFile, ['-- baseline migration', 'CREATE TABLE grade_versions (id BIGINT);', ...stableLines, ''].join('\n'), 'utf8');
  git(repo, 'init', '--quiet');
  git(repo, 'config', 'user.name', 'Migration Gate Test');
  git(repo, 'config', 'user.email', 'migration-gate-test@example.invalid');
  git(repo, 'config', 'diff.renames', 'true');
  git(repo, 'add', '.');
  git(repo, 'commit', '--quiet', '-m', 'baseline migration');
  git(repo, 'branch', '-M', 'main');
  git(repo, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  return { repo, oldPath, oldFile };
}

function runMigrationGate(repo) {
  return spawnSync(process.execPath, [path.join(repoRoot, 'scripts/check-migration-immutability.mjs'), 'origin/main'], {
    cwd: repo,
    encoding: 'utf8',
    timeout: 10000,
  });
}

test('systemd backup service declares the local Compose project', () => {
  assert.match(systemdService, /^Environment=COMPOSE_PROJECT_NAME=campusute$/m);
  assert.match(systemdReadme, /COMPOSE_PROJECT_NAME=campusute/);
});

test('Caddy allows five minutes for graceful stream shutdown', () => {
  const grace = caddyfile.match(/^\s*grace_period\s+(\d+)([smh])\s*$/m);
  assert.ok(grace, 'Caddy grace period is configured');
  const units = { s: 1, m: 60, h: 3600 };
  assert.ok(Number(grace[1]) * units[grace[2]] >= 300,
    'long assistant SSE responses get a five-minute graceful shutdown window');
  assert.match(caddyReadme, /five minutes/);
});

test('edge still upgrades plain HTTP when automatic redirects are disabled', () => {
  assert.match(caddyfile, /auto_https\s+disable_redirects/, 'global option under contract');
  assert.match(caddyfile,
    /^http:\/\/\{\$CAMPUSCORE_DOMAIN\}\s*\{[^}]*\bredir\s+https:\/\//ms,
    'with automatic redirects disabled an explicit http:// site must redirect to https');
});

test('evidence directory boundary compares path segments and resolves symlinks', () => {
  assert.match(verifyEcosystem, /path\.relative\(/,
    'a sibling path sharing the repo prefix must not be considered inside');
  assert.match(verifyEcosystem, /realpathSync/,
    'an existing symlink target must be resolved before writing evidence');
  assert.doesNotMatch(verifyEcosystem, /evidenceDir\.startsWith\(REPO\)/);
});

test('evidence resolver rejects a sibling whose name starts with the repository name', () => {
  const parent = mkdtempSync(path.join(os.tmpdir(), 'evidence-boundary-'));
  const repo = path.join(parent, 'CampusUTE_EcoSystem');
  mkdirSync(repo, { recursive: true });
  try {
    assert.throws(
      () => resolveEvidenceDir(repo, '../CampusUTE_EcoSystemEvil'),
      /resolve inside the repository/,
    );
    assert.equal(
      resolveEvidenceDir(repo, 'artifacts/verification'),
      path.join(repo, 'artifacts', 'verification'),
    );
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test('preview collision refusal never tears down the pre-existing project', (t) => {
  const fixture = worktreeFixture(t, 'preview-collision');
  for (const script of ['ecosystem-content-verify', 'ecosystem-sso-verify']) {
    const { result, calls } = runPreviewStub(fixture, script, 'existing', `${script}-evidence`);
    assert.equal(result.error, undefined, JSON.stringify(result));
    assert.equal(result.status, 1, result.stdout + result.stderr);
    const docker = calls.filter((call) => call.command === 'docker');
    assert.deepEqual(docker.map((call) => call.args.find((arg) => ['ps', 'up', 'down'].includes(arg))), ['ps'], JSON.stringify({ result, calls }));
  }
});

test('preview and contract verifiers refuse a project with volumes but no containers', (t) => {
  const fixture = worktreeFixture(t, 'volume-collision');
  const previewScripts = [
    'ecosystem-content-verify',
    'ecosystem-sso-verify',
    'ecosystem-admissions-verify',
    'ecosystem-careers-verify',
    'ecosystem-events-verify',
    'ecosystem-learning-verify',
    'ecosystem-library-verify',
  ];

  for (const script of previewScripts) {
    const { result, calls } = runPreviewStub(fixture, script, 'existing-volume', `${script}-volume-evidence`);
    assert.equal(result.status, 1, `${script}: ${result.stdout}${result.stderr}`);
    const docker = calls.filter((call) => call.command === 'docker');
    assert.deepEqual(docker.map((call) => call.args.includes('volume') ? 'volume' : call.args.find((arg) => ['ps', 'up', 'down'].includes(arg))),
      ['ps', 'volume'], JSON.stringify({ script, result, calls }));
    assert.ok(docker.every((call) => !call.args.some((arg) => ['up', 'down'].includes(arg))));
    const volumeQuery = docker.find((call) => call.args.includes('volume'));
    assert.ok(volumeQuery.args.includes('label=com.docker.compose.project=campuscore-preview-safety'));
  }

  const { result, calls } = runContractStub(fixture);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  const docker = calls.filter((call) => call.command === 'docker');
  assert.deepEqual(docker.map((call) => call.args.includes('volume') ? 'volume' : call.args.find((arg) => ['ps', 'up', 'down'].includes(arg))),
    ['ps', 'volume'], JSON.stringify({ result, calls }));
  assert.ok(docker.every((call) => !call.args.some((arg) => ['up', 'down'].includes(arg))));
  const volumeQuery = docker.find((call) => call.args.includes('volume'));
  assert.ok(volumeQuery.args.includes('label=com.docker.compose.project=campuscore-contract-volume'));
});

test('preview SIGINT tears down the stack started by this run before exit', (t) => {
  const fixture = worktreeFixture(t, 'preview-sigint');
  const { result, calls } = runPreviewStub(fixture, 'ecosystem-content-verify', 'signal');

  assert.equal(result.status, 130, result.stdout + result.stderr);
  const docker = calls.filter((call) => call.command === 'docker');
  assert.deepEqual(docker.map((call) => call.args.includes('volume') ? 'volume' : call.args.find((arg) => ['ps', 'up', 'down'].includes(arg))),
    ['ps', 'volume', 'up', 'down']);
  const down = docker.find((call) => call.args.includes('down'));
  assert.ok(down.args.includes('campuscore-preview-safety'));
  assert.ok(down.args.includes('-v'));
});

test('preview port refusal never kills an unrelated listener', (t) => {
  const fixture = worktreeFixture(t, 'preview-port-refusal');
  for (const script of ['ecosystem-content-verify', 'ecosystem-sso-verify']) {
    const { result, calls } = runPreviewStub(fixture, script, 'busy', `${script}-evidence`);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    const taskkills = calls.filter((call) => call.kind === 'execFileSync' && call.command === 'taskkill');
    assert.deepEqual(taskkills, []);
  }
});

test('preview cleanup kills only child processes started by this run', (t) => {
  const fixture = worktreeFixture(t, 'preview-child-cleanup');
  for (const script of ['ecosystem-content-verify', 'ecosystem-sso-verify']) {
    const { result, calls } = runPreviewStub(fixture, script, 'run', `${script}-evidence`);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const childPids = calls.filter((call) => call.kind === 'spawn').map((call) => String(call.pid));
    const taskkillPids = calls.filter((call) => call.kind === 'execFileSync' && call.command === 'taskkill')
      .map((call) => call.args[1]);
    assert.deepEqual(taskkillPids, childPids);
    const docker = calls.filter((call) => call.command === 'docker');
    assert.deepEqual(docker.map((call) => call.args.includes('volume') ? 'volume' : call.args.find((arg) => ['ps', 'up', 'down'].includes(arg))),
      ['ps', 'volume', 'up', 'down']);
    const down = docker.find((call) => call.args.includes('down'));
    assert.ok(down.args.includes('campuscore-preview-safety'));
    assert.ok(down.args.includes('-v'));
  }
});

test('identity and BFF allocation failures never clean up an unstarted default project', (t) => {
  const fixture = worktreeFixture(t, 'verify-allocation-failure');
  for (const script of ['identity-verify', 'bff-verify']) {
    const { result, calls } = runRaceVerifyStub(fixture, script, 'alloc-error');
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.deepEqual(calls.filter((call) => call.command === 'docker'), []);
  }
});

test('identity and BFF collision preflights never start or tear down a selected project', (t) => {
  const fixture = worktreeFixture(t, 'verify-project-collision');
  for (const script of ['identity-verify', 'bff-verify']) {
    const { result, calls } = runRaceVerifyStub(fixture, script, 'existing');
    assert.equal(result.status, 1, result.stdout + result.stderr);
    const docker = calls.filter((call) => call.command === 'docker');
    const mutating = docker.filter((call) => call.args.some((arg) => ['up', 'down'].includes(arg)));
    assert.deepEqual(mutating, []);
    assert.ok(docker.every((call) => call.args.join(' ').includes('campuscore-custom-project')));
  }
});

test('identity and BFF teardown targets the custom project started by this run', (t) => {
  const fixture = worktreeFixture(t, 'verify-owned-stack');
  for (const script of ['identity-verify', 'bff-verify']) {
    const { result, calls } = runRaceVerifyStub(fixture, script, 'verify-owned');
    assert.equal(result.status, 1, result.stdout + result.stderr);
    const down = calls.find((call) => call.command === 'docker' && call.args.includes('down'));
    assert.ok(down, 'a stack successfully started by this run must be cleaned up');
    assert.ok(down.args.includes('campuscore-custom-project'));
  }
});

test('identity and BFF pg-race give Compose the password used by their IT', (t) => {
  const fixture = worktreeFixture(t, 'verify-race-credentials');
  for (const script of ['identity-verify', 'bff-verify']) {
    const { result, calls } = runRaceCredentialVerifyStub(fixture, script);
    assert.equal(result.status, 0, `${script}: ${result.stdout}${result.stderr}`);
    const composeUp = calls.find((call) => call.command === 'docker' && call.args.includes('up') && call.args.includes('postgres'));
    const maven = calls.find((call) => call.command === 'mvn');
    assert.ok(composeUp, `${script} must start the disposable PostgreSQL service`);
    assert.ok(maven, `${script} must run its PostgreSQL IT`);
    assert.equal(composeUp.postgresPasswordIsExpected, true, `${script} Compose password must match the IT credential`);
    assert.equal(maven.councilPasswordIsExpected, true, `${script} IT must keep using the expected council credential`);
  }
});

test('platform verify tears down the project it created when compose up fails', async (t) => {
  const fixture = worktreeFixture(t, 'platform-up-failure');
  const originalCreateServer = net.createServer;
  net.createServer = () => {
    const server = {
      once() { return this; },
      listen(_options, callback) { setImmediate(callback); return this; },
      address() { return { port: 45678 }; },
      close(callback) { setImmediate(callback); return this; },
    };
    return server;
  };
  const composeCalls = [];
  try {
    await assert.rejects(caseStack({ project: 'campuscore-platform-up-failure', evidence: fixture }, {
      tryRun: () => ({ ok: true, out: '' }),
      composeTry: (_args, argv) => {
        composeCalls.push(argv);
        return argv[0] === 'up' ? { ok: false, out: 'stubbed compose startup failure' } : { ok: true, out: '' };
      },
    }), /compose up failed/);
  } finally {
    net.createServer = originalCreateServer;
  }
  assert.deepEqual(composeCalls.map((argv) => argv[0]), ['up', 'down']);
});

test('platform pgit tears down the project it created when compose up fails', async (t) => {
  const fixture = worktreeFixture(t, 'platform-pgit-up-failure');
  const originalCreateServer = net.createServer;
  const originalConnect = net.connect;
  net.createServer = () => {
    const server = {
      once() { return this; },
      listen(_options, callback) { setImmediate(callback); return this; },
      address() { return { port: 45678 }; },
      close(callback) { setImmediate(callback); return this; },
    };
    return server;
  };
  net.connect = () => {
    const socket = new EventEmitter();
    socket.setTimeout = () => socket;
    socket.destroy = () => socket;
    setImmediate(() => socket.emit('error', new Error('stubbed closed port')));
    return socket;
  };
  const composeCalls = [];
  try {
    await assert.rejects(casePgit({ project: 'campuscore-pgit-up-failure', evidence: fixture }, {
      tryRun: () => ({ ok: true, out: '' }),
      composeTry: (_args, argv) => {
        composeCalls.push(argv);
        return argv[0] === 'up' ? { ok: false, out: 'stubbed compose startup failure' } : { ok: true, out: '' };
      },
    }), /compose up failed/);
  } finally {
    net.createServer = originalCreateServer;
    net.connect = originalConnect;
  }
  assert.deepEqual(composeCalls.map((argv) => argv[0]), ['up', 'down', 'ps']);
});

test('immutable migration gate rejects a renamed migration whose contents changed', (t) => {
  const fixture = worktreeFixture(t, 'migration-rename-edit');
  const { repo, oldPath, oldFile } = migrationFixture(fixture);
  const newPath = oldPath.replace('grade_versions.sql', 'grade_version.sql');
  git(repo, 'mv', oldPath, newPath);
  const newFile = path.join(repo, newPath);
  writeFileSync(newFile, readFileSync(newFile, 'utf8').replace('grade_versions', 'grade_version'), 'utf8');
  git(repo, 'add', '-A');
  git(repo, 'commit', '--quiet', '-m', 'rename migration with edit');
  assert.match(git(repo, 'diff', '--name-status', 'origin/main...HEAD'), /^R\d+\t/);

  const result = runMigrationGate(repo);

  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout + result.stderr, /IMMUTABLE migration content changed or removed: .*V150__add_optional_grade_versions\.sql/);
  assert.ok(existsSync(oldFile) === false);
});

test('immutable migration gate recognizes exact content identity after a rename', (t) => {
  const fixture = worktreeFixture(t, 'migration-rename-exact');
  const { repo, oldPath } = migrationFixture(fixture);
  const newPath = oldPath.replace('grade_versions.sql', 'grade_version.sql');
  git(repo, 'mv', oldPath, newPath);
  git(repo, 'commit', '--quiet', '-m', 'rename migration without edit');

  const result = runMigrationGate(repo);

  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
