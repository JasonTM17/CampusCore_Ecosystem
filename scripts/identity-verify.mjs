#!/usr/bin/env node
// Identity gate cases for phase P04 (authorization server + one session
// authority). The real-PostgreSQL race evidence cannot come from H2: this
// case boots the disposable docker-compose.e2e.yml postgres, provisions the
// assistant runtime role (V84 needs it cluster-wide), creates a fresh
// campuscore_council_race_* database, and runs the env-gated
// UnifiedSessionRevocationPostgresIT through maven-failsafe. Evidence is a
// JSON summary plus the raw mvn log; nothing claims production behavior —
// only the measured disposable stack on the host that ran it.
//
//   node scripts/identity-verify.mjs pg-race --project <campuscore-*> --evidence dir

import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const COMPOSE_FILE = 'docker-compose.e2e.yml';
const MAX_BUFFER = 64 * 1024 * 1024;
const MIN_NODE = [22, 13];
const PROJECT_RE = /^campuscore-[a-z0-9-]+$/;
const COUNCIL_DB = 'campuscore_council_race_identity';
const IT_CLASS = 'UnifiedSessionRevocationPostgresIT';
const MVN_TIMEOUT_MS = 1500000;

let args_env = null; // compose env for the active subcommand (set in main)

function usage(msg) {
  if (msg) console.error(`USAGE_FAIL ${msg}`);
  console.error('Usage: identity-verify.mjs pg-race --project <campuscore-*> [--evidence dir]');
  process.exit(2);
}

function parseArgs(argv) {
  const args = { evidence: 'artifacts/verification/identity' };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--project') args.project = argv[++i];
    else if (a === '--evidence') args.evidence = argv[++i];
    else usage(`unknown arg ${a}`);
  }
  return args;
}

function nodeVersionOk() {
  const [major, minor] = process.versions.node.split('.').map(Number);
  return major > MIN_NODE[0] || (major === MIN_NODE[0] && minor >= MIN_NODE[1]);
}

function tryRun(cmd, argv, opts = {}) {
  const env = { ...process.env, ...(args_env || {}), ...(opts.env || {}) };
  let res = spawnSync(cmd, argv, {
    cwd: opts.cwd || REPO, encoding: 'utf8', maxBuffer: MAX_BUFFER,
    env, timeout: opts.timeoutMs || 120000,
  });
  // npm/mvn ship as .cmd shims on Windows; execFile-style spawn cannot run
  // them without a shell — retry through cmd.exe only for that failure.
  if (res.error && res.error.code === 'ENOENT' && process.platform === 'win32') {
    res = spawnSync(cmd, argv, {
      cwd: opts.cwd || REPO, encoding: 'utf8', maxBuffer: MAX_BUFFER,
      env, shell: true, timeout: opts.timeoutMs || 120000,
    });
  }
  if (res.error) return { ok: false, out: `${res.stdout || ''}${res.stderr || ''}${res.error.message || ''}`, code: -1 };
  return { ok: res.status === 0, out: `${res.stdout || ''}${res.stderr || ''}`, code: res.status };
}

function composeArgs(args, argv) {
  return ['compose', '-p', args.project, '-f', path.join(REPO, COMPOSE_FILE), ...argv];
}
function composeTry(args, argv, opts = {}) {
  return tryRun('docker', composeArgs(args, argv), opts);
}

async function allocPort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen({ host: '127.0.0.1', port: 0 }, () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function ensureEvidenceDir(args) {
  const dir = path.resolve(REPO, args.evidence);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function serviceStates(args) {
  const res = composeTry(args, ['ps', '--format', 'json']);
  const raw = (res.out || '').trim();
  if (!raw) return [];
  try {
    return raw.split('\n').map((l) => JSON.parse(l));
  } catch {
    try { return [JSON.parse(raw)]; } catch { return []; }
  }
}

async function waitServiceHealthy(args, serviceRe, timeoutMs = 240000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const states = serviceStates(args);
    const svc = states.find((s) => serviceRe.test(s.Service || s.Name || ''));
    if (svc && /healthy/i.test(svc.Health || svc.State || '')) return svc;
    if (svc && /(exited|dead)/i.test(svc.State || '')) {
      const logs = composeTry(args, ['logs', '--tail', '60', svc.Service || svc.Name]);
      throw new Error(`service ${svc.Service || svc.Name} died\n${logs.out.slice(-2000)}`);
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error(`service ${serviceRe} not healthy within ${timeoutMs}ms`);
}

/** Parse the last surefire/failsafe "Tests run" summary line (per-class lines end with ', Time elapsed'). */
function parseTotals(out) {
  const re = /Tests run:\s*(\d+),\s*Failures:\s*(\d+),\s*Errors:\s*(\d+),\s*Skipped:\s*(\d+)\s*$/gm;
  let match; let last = null;
  while ((match = re.exec(out)) !== null) last = match;
  if (!last) return null;
  return { run: +last[1], failures: +last[2], errors: +last[3], skipped: +last[4] };
}

async function casePgRace(args) {
  const dir = ensureEvidenceDir(args);
  args_env = {
    POSTGRES_HOST_PORT: String(await allocPort()),
    E2E_API_HOST_PORT: String(await allocPort()),
  };
  const result = { case: 'pg-race', target: 'local', project: args.project, ports: { ...args_env } };
  try {
    const up = composeTry(args, ['up', '-d', 'postgres']);
    if (!up.ok) throw new Error(`compose up failed\n${up.out.slice(-3000)}`);
    await waitServiceHealthy(args, /postgres/, 240000);
    const pgPort = args_env.POSTGRES_HOST_PORT;
    // The @EnabledIf gate requires a loopback jdbc:postgresql URL whose db
    // name starts with campuscore_council_race_ — one fresh disposable db.
    const mk = composeTry(args, ['exec', '-T', 'postgres', 'sh', '-c',
      `psql --no-psqlrc --set ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres -c "DROP DATABASE IF EXISTS ${COUNCIL_DB}" -c "CREATE DATABASE ${COUNCIL_DB}"`]);
    if (!mk.ok) throw new Error(`could not provision db ${COUNCIL_DB}\n${mk.out.slice(-1000)}`);
    // V84 creates campuscore_assistant_runtime NOLOGIN; the provisioner flips
    // it to LOGIN with the dev-only password, matching the e2e chain.
    const prov = composeTry(args, ['run', '--rm', 'assistant-db-provisioner']);
    result.provisionerExit = prov.code;
    if (!prov.ok) throw new Error(`assistant-db-provisioner failed\n${prov.out.slice(-1500)}`);
    const councilUrl = `jdbc:postgresql://127.0.0.1:${pgPort}/${COUNCIL_DB}`;
    const mvn = tryRun('mvn', [
      '-f', path.join(REPO, 'java-services', 'restful-api', 'pom.xml'),
      'failsafe:integration-test', 'failsafe:verify',
      `-Dit.test=${IT_CLASS}`, '-DfailIfNoTests=false', '-Dstyle.color=never',
    ], {
      timeoutMs: MVN_TIMEOUT_MS,
      env: {
        CAMPUSCORE_COUNCIL_POSTGRES_URL: councilUrl,
        CAMPUSCORE_COUNCIL_POSTGRES_USER: 'campuscore',
        CAMPUSCORE_COUNCIL_POSTGRES_PASSWORD: 'campuscore_password',
      },
    });
    fs.writeFileSync(path.join(dir, 'pg-race-mvn.log'), mvn.out, 'utf8');
    result.mvnExit = mvn.code;
    result.totals = parseTotals(mvn.out);
    // Zero executed tests is a failure signal, never a vacuous pass.
    if (!mvn.ok || !result.totals || (result.totals.run - result.totals.skipped) === 0) {
      result.ok = false;
      result.error = !result.totals
        ? 'no failsafe totals parsed'
        : 'zero executed tests (all skipped or none matched)';
    } else {
      result.ok = result.totals.failures === 0 && result.totals.errors === 0;
    }
  } catch (e) {
    result.ok = false;
    result.error = String(e.message || e).slice(-3000);
  } finally {
    const down = composeTry(args, ['down', '-v', '--remove-orphans']);
    result.teardown = down.ok ? 'clean' : `degraded: ${down.out.slice(-300)}`;
  }
  fs.writeFileSync(path.join(dir, 'pg-race.json'), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  if (!result.ok) {
    console.error(`FAIL pg-race: ${result.error || 'see pg-race.json'}`);
    process.exit(1);
  }
  console.log(`PASS pg-race: ${result.totals.run} run, ${result.totals.skipped} skipped (db ${COUNCIL_DB} @ :${args_env.POSTGRES_HOST_PORT})`);
}

async function main() {
  const [cmd, ...argv] = process.argv.slice(2);
  if (!cmd) usage('missing subcommand');
  if (!nodeVersionOk()) {
    console.error(`FAIL node ${process.versions.node} < required ${MIN_NODE.join('.')}`);
    process.exit(1);
  }
  const args = parseArgs(argv);
  if (!args.project || !PROJECT_RE.test(args.project)) {
    usage('--project must match /^campuscore-[a-z0-9-]+$/ (stack isolation)');
  }
  if (cmd === 'pg-race') {
    await casePgRace(args);
    return;
  }
  usage(`unknown subcommand ${cmd}`);
}

main().catch((e) => {
  console.error(`FAIL ${e.message || e}`);
  try {
    const args = { project: process.env.IDENTITY_VERIFY_PROJECT || 'campuscore-identity-verify' };
    composeTry(args, ['down', '-v', '--remove-orphans']);
  } catch { /* best-effort */ }
  process.exit(1);
});
