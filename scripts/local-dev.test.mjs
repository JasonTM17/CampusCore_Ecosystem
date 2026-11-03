import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  COMPOSE_MOBILE,
  DEMO_STUDENT_EMAIL,
  HOST_PORT_BINDINGS,
  MOBILE_PROFILE_ENV,
  UsageError,
  buildDownArgs,
  buildLogsArgs,
  buildUpArgs,
  doctor,
  ensureEnvFile,
  formatPortAdvice,
  formatUrlTable,
  main,
  mobileRecipeFromEas,
  parseArgs,
  parseEnvAssignments,
  pollHealth,
  portConflictAdvice,
  resolveProjectName,
  selectComposeFiles,
  suggestHostPort,
} from './local-dev.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(repoRoot, relative), 'utf8');

function databaseOutageOverrides(output, commands) {
  const root = path.join(repoRoot, '.virtual-local-dev-health');
  const files = new Map([
    [path.resolve(root, 'docker-compose.yml'), 'services: {}\n'],
    [path.resolve(root, '.env.example'), 'HEALTH_READINESS_KEY=stub-key\n'],
  ]);
  const fsStub = {
    existsSync(target) { return files.has(path.resolve(target)); },
    readFileSync(target) {
      const content = files.get(path.resolve(target));
      if (content === undefined) throw new Error('unexpected filesystem read');
      return content;
    },
    copyFileSync(source, target) { files.set(path.resolve(target), files.get(path.resolve(source))); },
    writeFileSync(target, content) { files.set(path.resolve(target), String(content)); },
    appendFileSync(target, content) {
      const key = path.resolve(target);
      files.set(key, `${files.get(key) ?? ''}${content}`);
    },
  };
  return {
    root,
    fs: fsStub,
    env: {},
    run: (command, args) => {
      commands.push({ command, args });
      if (args.includes('ps')) {
        return { code: 0, stdout: JSON.stringify([
          { Service: 'restful-api', State: 'running' },
          { Service: 'web', State: 'running' },
        ]), stderr: '' };
      }
      const portIndex = args.indexOf('port');
      if (portIndex >= 0) {
        const port = args[portIndex + 1] === 'web' ? 3000 : 4010;
        return { code: 0, stdout: `127.0.0.1:${port}\n`, stderr: '' };
      }
      if (args.includes('exec')) return { code: 1, stdout: '', stderr: 'stubbed database readiness failure' };
      return { code: 0, stdout: '', stderr: '' };
    },
    fetch: async () => ({ status: 200 }),
    sleep: async () => {},
    log: (message) => output.push(message),
    errorLog: (message) => output.push(message),
  };
}

/* ------------------------------------------------------------------ */
/* argument parsing                                                   */
/* ------------------------------------------------------------------ */

test('parseArgs applies defaults for a bare command', () => {
  const parsed = parseArgs(['up']);
  assert.equal(parsed.command, 'up');
  assert.equal(parsed.help, false);
  assert.equal(parsed.service, null);
  assert.deepEqual(parsed.flags, { mobile: false, build: true, volumes: false, project: null });
});

test('parseArgs reads every documented flag', () => {
  const parsed = parseArgs(['up', '--mobile', '--project', 'demo-stack', '--no-build']);
  assert.equal(parsed.command, 'up');
  assert.equal(parsed.flags.mobile, true);
  assert.equal(parsed.flags.build, false);
  assert.equal(parsed.flags.project, 'demo-stack');

  const down = parseArgs(['down', '--volumes']);
  assert.equal(down.flags.volumes, true);
  assert.equal(down.flags.build, true);

  const logs = parseArgs(['logs', 'restful-api']);
  assert.equal(logs.service, 'restful-api');
});

test('parseArgs rejects unknown flags, unknown commands and missing values', () => {
  assert.throws(() => parseArgs(['up', '--bogus']), (error) =>
    error instanceof UsageError && /Unknown option: --bogus/.test(error.message));
  assert.throws(() => parseArgs(['dance']), (error) =>
    error instanceof UsageError && /Unknown command: dance/.test(error.message));
  assert.throws(() => parseArgs(['up', '--project']), (error) =>
    error instanceof UsageError && /--project requires a value/.test(error.message));
  assert.throws(() => parseArgs(['doctor', '--mobile']), (error) =>
    error instanceof UsageError && /--mobile is only valid/.test(error.message));
});

test('parseArgs short-circuits --help without validating the rest', () => {
  const parsed = parseArgs(['up', '--help']);
  assert.equal(parsed.command, 'up');
  assert.equal(parsed.help, true);
});

test('status exits nonzero when a health probe prints FAIL', async () => {
  const output = [];
  const exitCode = await main(['status', '--project', 'campusute'], {
    root: repoRoot,
    env: {},
    run: (_command, args) => ({
      code: 0,
      stdout: args.includes('ps')
        ? JSON.stringify([{ Service: 'restful-api', State: 'running' }, { Service: 'web', State: 'running' }])
        : '127.0.0.1:4010\n',
      stderr: '',
    }),
    fetch: async () => ({ status: 503 }),
    log: (message) => output.push(message),
    errorLog: (message) => output.push(message),
  });
  assert.equal(output.some((line) => line.includes('FAIL  API liveness')), true);
  assert.equal(exitCode, 1, 'status must not report success while a health check fails');
});

test('status fails when API readiness reports a database outage', async () => {
  const output = [];
  const commands = [];
  const exitCode = await main(['status', '--project', 'campusute'], databaseOutageOverrides(output, commands));
  assert.equal(exitCode, 1, output.join('\n'));
  assert.equal(commands.some(({ args }) => args.includes('exec')), true, 'readiness must run inside the API container');
  assert.equal(output.some((line) => line.includes('FAIL  API readiness')), true);
});

test('up fails when API readiness reports a database outage', async () => {
  const output = [];
  const commands = [];
  let clock = 0;
  const overrides = databaseOutageOverrides(output, commands);
  overrides.sleep = async () => { clock += 1_000_000; };
  overrides.now = () => clock;
  const exitCode = await main(['up', '--no-build', '--project', 'campusute'], overrides);
  assert.equal(exitCode, 1, output.join('\n'));
  assert.equal(commands.some(({ args }) => args.includes('exec')), true, 'up must use the readiness probe');
  assert.equal(output.some((line) => line.includes('API readiness')), true);
});

test('status rejects a web root response outside the success range', async () => {
  const output = [];
  const commands = [];
  const overrides = databaseOutageOverrides(output, commands);
  const run = overrides.run;
  overrides.run = (command, args) => args.includes('exec')
    ? { code: 0, stdout: '', stderr: '' }
    : run(command, args);
  overrides.fetch = async (url) => ({ status: String(url).endsWith('/') ? 404 : 200 });

  const exitCode = await main(['status', '--project', 'campusute'], overrides);

  assert.equal(exitCode, 1, output.join('\n'));
  assert.equal(output.some((line) => line.includes('FAIL  web')), true);
});

test('compose argv keeps flags shell-free and mirrors --mobile/--no-build', () => {
  assert.deepEqual(
    buildUpArgs({ project: 'demo', files: ['docker-compose.yml'], build: true }),
    ['compose', '-p', 'demo', '-f', 'docker-compose.yml', 'up', '-d', '--build'],
  );
  assert.deepEqual(
    buildUpArgs({ project: 'demo', files: ['docker-compose.yml'], build: false }),
    ['compose', '-p', 'demo', '-f', 'docker-compose.yml', 'up', '-d'],
  );
  assert.deepEqual(
    buildDownArgs({ project: 'demo', files: ['docker-compose.yml'], volumes: true }),
    ['compose', '-p', 'demo', '-f', 'docker-compose.yml', 'down', '-v'],
  );
  assert.deepEqual(
    buildLogsArgs({ project: 'demo', files: ['docker-compose.yml'], service: 'web' }),
    ['compose', '-p', 'demo', '-f', 'docker-compose.yml', 'logs', '--tail', '200', '-f', 'web'],
  );
});

/* ------------------------------------------------------------------ */
/* compose files and project name                                     */
/* ------------------------------------------------------------------ */

test('selectComposeFiles returns the base file, plus the mobile overlay only with --mobile', () => {
  assert.deepEqual(selectComposeFiles(), ['docker-compose.yml']);
  assert.deepEqual(selectComposeFiles({ mobile: false }), ['docker-compose.yml']);
  assert.deepEqual(selectComposeFiles({ mobile: true }), ['docker-compose.yml', COMPOSE_MOBILE]);
  for (const file of selectComposeFiles({ mobile: true })) {
    assert.ok(fs.existsSync(path.join(repoRoot, file)), `${file} must exist on disk`);
  }
});

test('resolveProjectName prefers --project, then a compose name: key, then campusute', () => {
  const base = read('docker-compose.yml');
  assert.equal(resolveProjectName({ sources: [base] }), 'campusute');
  assert.equal(resolveProjectName({ explicit: 'demo-stack', sources: [base] }), 'demo-stack');
  assert.equal(resolveProjectName({ sources: [read('docker-compose.e2e.yml')] }), 'campuscore-course-e2e');
  assert.throws(() => resolveProjectName({ explicit: 'Not Valid' }), (error) =>
    error instanceof UsageError && /Invalid project name/.test(error.message));
});

/* ------------------------------------------------------------------ */
/* port advice                                                        */
/* ------------------------------------------------------------------ */

test('every busy-port remedy uses a real docker-compose.yml override variable', () => {
  const compose = read('docker-compose.yml');
  assert.deepEqual(HOST_PORT_BINDINGS.map((binding) => binding.port), [3000, 4010, 5432, 8025, 1025]);
  assert.deepEqual(HOST_PORT_BINDINGS.map((binding) => binding.variable), [
    'FRONTEND_HOST_PORT',
    'RESTFUL_API_HOST_PORT',
    'POSTGRES_HOST_PORT',
    'MAILPIT_UI_HOST_PORT',
    'MAILPIT_SMTP_HOST_PORT',
  ]);
  for (const binding of HOST_PORT_BINDINGS) {
    const interpolation = '${' + binding.variable + ':-' + binding.port + '}';
    assert.ok(compose.includes(interpolation), `docker-compose.yml must publish ${interpolation}`);
    const advice = portConflictAdvice(binding, 'container campusute-postgres-1');
    assert.equal(advice.suggestedPort, suggestHostPort(binding.port));
    assert.notEqual(advice.suggestedPort, binding.port);
    assert.equal(advice.suggestedLine, `${binding.variable}=${advice.suggestedPort}`);
    assert.ok(formatPortAdvice(advice).includes(advice.suggestedLine), 'remedy must carry the override line');
  }
});

/* ------------------------------------------------------------------ */
/* health polling                                                     */
/* ------------------------------------------------------------------ */

test('pollHealth succeeds after failures with injected fetch, sleep and clock', async () => {
  let clock = 0;
  let calls = 0;
  const result = await pollHealth({
    probes: [{ name: 'API liveness', url: 'http://127.0.0.1:4010/api/v1/health/liveness', accept: ({ status }) => status === 200 }],
    timeoutMs: 30_000,
    intervalMs: 1_000,
    fetch: async () => ({ status: ++calls >= 3 ? 200 : 503 }),
    sleep: async (ms) => { clock += ms; },
    now: () => clock,
  });
  assert.equal(result.attempts, 3);
  assert.equal(result.elapsedMs, 2_000);
  assert.equal(result.results[0].ok, true);
});

test('pollHealth times out with a clear error naming the pending probe', async () => {
  let clock = 0;
  await assert.rejects(
    pollHealth({
      probes: [{ name: 'API liveness', url: 'http://127.0.0.1:4010/api/v1/health/liveness', accept: ({ status }) => status === 200 }],
      timeoutMs: 5_000,
      intervalMs: 1_000,
      fetch: async () => ({ status: 503 }),
      sleep: async (ms) => { clock += ms; },
      now: () => clock,
    }),
    (error) => /health check timed out after 5s \(limit 5s\)/.test(error.message)
      && /still waiting for: API liveness/.test(error.message)
      && /HTTP 503/.test(error.message),
  );
});

test('pollHealth honours the injected clock instead of the attempt cap', async () => {
  let clock = 0;
  let attempts = 0;
  await assert.rejects(
    pollHealth({
      probes: [{ name: 'web', url: 'http://127.0.0.1:3000/', accept: ({ status }) => status < 500 }],
      timeoutMs: 5_000,
      intervalMs: 250,
      fetch: async () => { attempts += 1; return { status: 502 }; },
      sleep: async () => { clock += 1_000; },
      now: () => clock,
    }),
    /timed out after 5s/,
  );
  assert.equal(attempts, 6, 'the fake clock advances 1s per attempt, so 5s elapses on the sixth');
});

/* ------------------------------------------------------------------ */
/* URL table                                                          */
/* ------------------------------------------------------------------ */

test('formatUrlTable prints the stack URLs and never the word password', () => {
  const text = formatUrlTable({ webPort: 3000, apiPort: 4010, mailpitUiPort: 8025 });
  for (const expected of [
    'http://127.0.0.1:3000',
    'http://127.0.0.1:4010/api/v1',
    'http://127.0.0.1:4010/v3/api-docs',
    'http://127.0.0.1:8025',
  ]) {
    assert.ok(text.includes(expected), `URL table must contain ${expected}`);
  }
  assert.doesNotMatch(text, /password/i);
});

test('mobile recipe comes from mobile/eas.json and never prints a credential', () => {
  const eas = JSON.parse(read('mobile/eas.json'));
  const recipe = mobileRecipeFromEas(eas);
  assert.deepEqual(recipe.map((entry) => entry.name), MOBILE_PROFILE_ENV);
  assert.deepEqual(
    Object.fromEntries(recipe.map((entry) => [entry.name, entry.value])),
    Object.fromEntries(MOBILE_PROFILE_ENV.map((name) => [name, eas.build.local.env[name]])),
  );

  const text = formatUrlTable({ webPort: 3000, apiPort: 4010, mailpitUiPort: 8025, mobileRecipe: recipe });
  for (const { name, value } of recipe) assert.ok(text.includes(`${name}=${value}`), `${name} row is required`);
  assert.ok(text.includes(DEMO_STUDENT_EMAIL), 'the demo student email is documented');
  assert.ok(text.includes('docs/DEMO_RUNBOOK.md'), 'credentials point at the runbook');
  assert.doesNotMatch(text, /password/i);
});

/* ------------------------------------------------------------------ */
/* doctor                                                             */
/* ------------------------------------------------------------------ */

test('doctor retries a cold Docker engine before failing a hard requirement', async () => {
  let infoCalls = 0;
  const run = (command, args) => {
    if (command === 'java') return { code: 0, stdout: '', stderr: 'openjdk version "21.0.5" 2024-10-15 LTS' };
    if (args[0] === '--version') return { code: 0, stdout: 'Docker version 29.9.1, build dfc520d', stderr: '' };
    if (args[0] === 'compose') return { code: 0, stdout: 'Docker Compose version v5.6.0', stderr: '' };
    if (args[0] === 'info') {
      infoCalls += 1;
      return infoCalls < 3
        ? { code: 1, stdout: '', stderr: 'error during connect: the engine is starting' }
        : { code: 0, stdout: '29.9.1\n', stderr: '' };
    }
    if (args[0] === 'ps') return { code: 0, stdout: '', stderr: '' };
    throw new Error(`unexpected command: ${command} ${args.join(' ')}`);
  };
  const lines = [];

  const code = await doctor({
    root: repoRoot,
    env: {},
    fs,
    run,
    probePort: async () => true,
    nodeVersion: '22.13.0',
    sleep: async () => {},
    log: (message) => lines.push(message),
  });

  assert.equal(code, 0);
  assert.equal(infoCalls, 3, 'two transient failures must be retried');
  assert.match(lines.join('\n'), /\[PASS\] Docker engine\s+engine 29\.9\.1/);
  assert.match(lines.join('\n'), /local-dev doctor: PASS/);
});

/* ------------------------------------------------------------------ */
/* .env host-port overrides                                           */
/* ------------------------------------------------------------------ */

test('parseEnvAssignments reads assignments and skips comments, export and quotes', () => {
  const values = parseEnvAssignments([
    '# a comment',
    '',
    'RESTFUL_API_HOST_PORT=14010',
    'export POSTGRES_HOST_PORT=15432',
    'QUOTED="9010"',
    "SINGLE='8025'",
    'EMPTY=',
    'not an assignment',
  ].join('\n'));
  assert.equal(values.get('RESTFUL_API_HOST_PORT'), '14010');
  assert.equal(values.get('POSTGRES_HOST_PORT'), '15432');
  assert.equal(values.get('QUOTED'), '9010');
  assert.equal(values.get('SINGLE'), '8025');
  assert.equal(values.get('EMPTY'), '');
  assert.equal(values.has('not an assignment'), false);
});

function passingDoctorDeps(root, env, probed, lines) {
  return {
    root,
    env,
    fs,
    run: (command, args) => {
      if (command === 'java') return { code: 0, stdout: '', stderr: 'openjdk version "21.0.5" 2024-10-15 LTS' };
      if (args[0] === '--version') return { code: 0, stdout: 'Docker version 29.9.1, build dfc520d', stderr: '' };
      if (args[0] === 'compose') return { code: 0, stdout: 'Docker Compose version v5.6.0', stderr: '' };
      if (args[0] === 'info') return { code: 0, stdout: '29.9.1\n', stderr: '' };
      if (args[0] === 'ps') return { code: 0, stdout: '', stderr: '' };
      throw new Error(`unexpected command: ${command} ${args.join(' ')}`);
    },
    probePort: async (port) => {
      probed.push(port);
      return true;
    },
    nodeVersion: '22.13.0',
    sleep: async () => {},
    log: (message) => lines.push(message),
  };
}

test('doctor probes the .env host-port override instead of the compose default', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'local-dev-doctor-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, '.env'), 'RESTFUL_API_HOST_PORT=14010\n', 'utf8');
  const probed = [];
  const lines = [];

  const code = await doctor(passingDoctorDeps(root, {}, probed, lines));

  assert.equal(code, 0, lines.join('\n'));
  assert.deepEqual(probed, [3000, 14010, 5432, 8025, 1025]);
  assert.match(lines.join('\n'), /127\.0\.0\.1:14010 free/);
  assert.doesNotMatch(lines.join('\n'), /:4010\b/);
});

test('process.env wins over the .env host-port override', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'local-dev-doctor-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, '.env'), 'RESTFUL_API_HOST_PORT=14010\n', 'utf8');
  const probed = [];
  const lines = [];

  await doctor(passingDoctorDeps(root, { RESTFUL_API_HOST_PORT: '14020' }, probed, lines));

  assert.deepEqual(probed, [3000, 14020, 5432, 8025, 1025]);
});

test('status falls back to the .env host-port override when compose port has no answer', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'local-dev-status-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'docker-compose.yml'), 'services: {}\n', 'utf8');
  fs.writeFileSync(path.join(root, '.env'), 'RESTFUL_API_HOST_PORT=14010\n', 'utf8');
  const output = [];

  const code = await main(['status', '--project', 'campusute'], {
    root,
    env: {},
    run: (_command, args) => {
      if (args.includes('ps')) {
        return { code: 0, stdout: JSON.stringify([{ Service: 'restful-api', State: 'running' }]), stderr: '' };
      }
      if (args.includes('port')) return { code: 1, stdout: '', stderr: 'no such service' };
      if (args.includes('exec')) return { code: 0, stdout: '', stderr: '' };
      return { code: 0, stdout: '', stderr: '' };
    },
    fetch: async () => ({ status: 200 }),
    log: (message) => output.push(message),
    errorLog: (message) => output.push(message),
  });

  assert.equal(code, 0, output.join('\n'));
  assert.equal(
    output.some((line) => line.includes('http://127.0.0.1:14010/api/v1/health/liveness')),
    true,
    `status must probe the .env port override:\n${output.join('\n')}`,
  );
  assert.equal(output.some((line) => line.includes(':4010')), false, 'the compose default must not be probed');
});

test('up falls back to the .env host-port override when compose port has no answer', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'local-dev-up-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'docker-compose.yml'), 'services: {}\n', 'utf8');
  fs.writeFileSync(path.join(root, '.env.example'), 'POSTGRES_HOST_PORT=5432\n', 'utf8');
  fs.writeFileSync(path.join(root, '.env'), 'RESTFUL_API_HOST_PORT=14010\n', 'utf8');
  const output = [];

  const code = await main(['up', '--no-build'], {
    root,
    env: {},
    run: (_command, args) => {
      if (args.includes('port')) return { code: 1, stdout: '', stderr: 'no such service' };
      return { code: 0, stdout: '', stderr: '' };
    },
    fetch: async () => ({ status: 200 }),
    sleep: async () => {},
    now: () => 0,
    log: (message) => output.push(message),
    errorLog: (message) => output.push(message),
  });

  assert.equal(code, 0, output.join('\n'));
  assert.equal(
    output.some((line) => line.includes('http://127.0.0.1:14010/api/v1')),
    true,
    `the URL table must show the .env port override:\n${output.join('\n')}`,
  );
});

/* ------------------------------------------------------------------ */
/* .env creation                                                      */
/* ------------------------------------------------------------------ */

test('ensureEnvFile copies .env.example only when .env is missing', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'local-dev-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, '.env.example'), 'POSTGRES_HOST_PORT=5432\n', 'utf8');
  const messages = [];

  const result = ensureEnvFile({ root, log: (message) => messages.push(message) });

  assert.equal(result.created, true);
  assert.equal(fs.readFileSync(path.join(root, '.env'), 'utf8'), 'POSTGRES_HOST_PORT=5432\n');
  assert.match(messages.join('\n'), /created \.env from \.env\.example/);
});

test('ensureEnvFile refuses to overwrite an existing .env', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'local-dev-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, '.env.example'), 'POSTGRES_HOST_PORT=5432\n', 'utf8');
  fs.writeFileSync(path.join(root, '.env'), 'POSTGRES_HOST_PORT=15432\n', 'utf8');
  const guardedFs = {
    ...fs,
    copyFileSync() {
      throw new Error('overwrite attempted');
    },
  };
  const messages = [];

  const result = ensureEnvFile({ root, fs: guardedFs, log: (message) => messages.push(message) });

  assert.equal(result.created, false);
  assert.equal(fs.readFileSync(path.join(root, '.env'), 'utf8'), 'POSTGRES_HOST_PORT=15432\n');
  assert.match(messages.join('\n'), /keeping it unchanged/);
});

function upFixture(t, envContent) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'local-dev-up-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'docker-compose.yml'), 'services: {}\n', 'utf8');
  fs.writeFileSync(path.join(root, '.env.example'), 'POSTGRES_HOST_PORT=5432\n', 'utf8');
  if (envContent !== undefined) fs.writeFileSync(path.join(root, '.env'), envContent, 'utf8');
  return root;
}

function runUp(root) {
  const messages = [];
  const run = () => ({ code: 0, stdout: '', stderr: '' });
  return main(['up', '--no-build'], {
    root,
    run,
    fetch: async () => ({ status: 200 }),
    sleep: async () => {},
    now: () => 0,
    log: (message) => messages.push(message),
    errorLog: (message) => messages.push(message),
  }).then((code) => ({ code, messages }));
}

test('up generates the compose owner-assertion secret into the git-ignored .env', async (t) => {
  const root = upFixture(t);

  const { code, messages } = await runUp(root);

  assert.equal(code, 0);
  const env = fs.readFileSync(path.join(root, '.env'), 'utf8');
  const values = [...env.matchAll(/^ASSISTANT_RAG_OWNER_ASSERTION_SECRET=(.*)$/gm)].map((match) => match[1]);
  assert.equal(values.length, 1, '.env must carry exactly one generated owner-assertion secret');
  assert.ok(values[0].trim().length >= 32, 'the generated key must satisfy the HS256 minimum');
  assert.equal(messages.join('\n').includes(values[0]), false, 'the generated key must never be logged');
});

test('up keeps an existing owner-assertion secret instead of rotating it', async (t) => {
  const existing = 'local-owner-assertion-value-0123456789abcdef';
  const root = upFixture(t, `POSTGRES_HOST_PORT=5432\nASSISTANT_RAG_OWNER_ASSERTION_SECRET=${existing}\n`);

  const { code } = await runUp(root);

  assert.equal(code, 0);
  const env = fs.readFileSync(path.join(root, '.env'), 'utf8');
  assert.equal(env.match(/^ASSISTANT_RAG_OWNER_ASSERTION_SECRET=/gm).length, 1);
  assert.match(env, new RegExp(`^ASSISTANT_RAG_OWNER_ASSERTION_SECRET=${existing}$`, 'm'));
});
