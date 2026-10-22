#!/usr/bin/env node
// Platform gate cases for phase P02 (supported runtime). Three bounded cases
// over the disposable docker-compose.e2e.yml stack — the same conventions as
// ecosystem-fixture.mjs (ephemeral host ports, project-scoped teardown in
// finally, spawnSync for full stderr capture). Evidence is written as JSON per
// case; nothing here claims production behavior — only the measured disposable
// stack on the host that ran it.
//
//   node scripts/platform-verify.mjs image   [--evidence dir]                — build the e2e image, record old/new digests
//   node scripts/platform-verify.mjs stack   --project <campuscore-*> --evidence dir — boot the full stack once, record startup/RSS/fail-closed probes
//   node scripts/platform-verify.mjs pgit    --project <campuscore-*> --evidence dir — postgres-only stack + mvn failsafe *PostgresIT

import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const COMPOSE_FILE = 'docker-compose.e2e.yml';
const IMAGE_TAG = 'student-management-ute-restful-api:e2e-local';
const ROLLBACK_TAG = 'student-management-ute-restful-api:pre-p02-boot35';
const MAX_BUFFER = 64 * 1024 * 1024;
const MIN_NODE = [22, 13];
const PROJECT_RE = /^campuscore-[a-z0-9-]+$/;

function usage(msg) {
  if (msg) console.error(`USAGE_FAIL ${msg}`);
  console.error('Usage: platform-verify.mjs <image|stack|pgit> --project <campuscore-*> [--evidence dir]');
  process.exit(2);
}

function parseArgs(argv) {
  const args = { evidence: 'artifacts/verification/platform' };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--project') args.project = argv[++i];
    else if (a === '--evidence') args.evidence = argv[++i];
    else if (a === '--its') args.its = argv[++i];
    else if (a === '--result') args.resultName = argv[++i];
    else if (a === '--log-name') args.logName = argv[++i];
    else usage(`unknown arg ${a}`);
  }
  return args;
}

function run(cmd, argv, opts = {}) {
  const res = spawnSync(cmd, argv, {
    cwd: opts.cwd || REPO, encoding: 'utf8', maxBuffer: MAX_BUFFER,
    env: { ...process.env, ...(args_env || {}), ...(opts.env || {}) },
  });
  if (res.error) {
    if (res.error.code === 'ENOENT' && process.platform === 'win32') {
      const res2 = spawnSync(cmd, argv, { cwd: opts.cwd || REPO, encoding: 'utf8', maxBuffer: MAX_BUFFER, env: { ...process.env, ...(args_env || {}), ...(opts.env || {}) }, shell: true });
      if (res2.error) throw res2.error;
      return finishRun(res2);
    }
    throw res.error;
  }
  return finishRun(res);
  function finishRun(r) {
    const out = `${r.stdout || ''}${r.stderr || ''}`;
    if (r.status !== 0) throw new Error(`${cmd} ${argv.join(' ')} exited ${r.status}\n${out.slice(-4000)}`);
    return out;
  }
}

function tryRun(cmd, argv, opts = {}) {
  let res = spawnSync(cmd, argv, {
    cwd: opts.cwd || REPO, encoding: 'utf8', maxBuffer: MAX_BUFFER,
    env: { ...process.env, ...(args_env || {}), ...(opts.env || {}) },
  });
  // npm/mvn ship as .cmd shims on Windows; execFile-style spawn cannot run them
  // without a shell — retry through cmd.exe only for that specific failure.
  if (res.error && res.error.code === 'ENOENT' && process.platform === 'win32') {
    res = spawnSync(cmd, argv, {
      cwd: opts.cwd || REPO, encoding: 'utf8', maxBuffer: MAX_BUFFER,
      env: { ...process.env, ...(args_env || {}), ...(opts.env || {}) }, shell: true,
    });
  }
  if (res.error) return { ok: false, out: `${res.stdout || ''}${res.stderr || ''}${res.error.message || ''}`, code: -1 };
  return { ok: res.status === 0, out: `${res.stdout || ''}${res.stderr || ''}`, code: res.status };
}

function composeArgs(args, argv) {
  const files = args.composeFiles && args.composeFiles.length
    ? args.composeFiles
    : [path.join(REPO, COMPOSE_FILE)];
  const fArgs = files.flatMap((f) => ['-f', f]);
  return ['compose', '-p', args.project, ...fArgs, ...argv];
}
function compose(args, argv, opts = {}) {
  return run('docker', composeArgs(args, argv), opts);
}
function composeTry(args, argv, opts = {}) {
  return tryRun('docker', composeArgs(args, argv), opts);
}

let args_env = null; // compose env for the active subcommand (set in main)

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

function writeJson(dir, name, obj) {
  fs.writeFileSync(path.join(dir, name), `${JSON.stringify(obj, null, 2)}\n`, 'utf8');
}

function dockerImageId(tag) {
  const res = tryRun('docker', ['image', 'inspect', tag, '--format', '{{.Id}}']);
  return res.ok ? res.out.trim() : null;
}

function serviceStates(args) {
  const res = composeTry(args, ['ps', '--format', 'json']);
  const raw = (res.out || '').trim();
  if (!raw) return [];
  try { const p = JSON.parse(raw); return Array.isArray(p) ? p : [p]; }
  catch { return raw.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); }
}

async function waitServiceHealthy(args, serviceRe, timeoutMs = 480000) {
  const start = Date.now();
  for (;;) {
    const states = serviceStates(args);
    const svc = states.find((s) => serviceRe.test(s.Service || s.Name || ''));
    if (svc && /healthy/i.test(svc.Health || svc.State || svc.Status || '')) {
      return { healthyMs: Date.now() - start, state: svc };
    }
    if (svc && /(dead|exited)/i.test(svc.State || svc.Status || '')) {
      const logs = composeTry(args, ['logs', '--tail', '60', svc.Service || svc.Name]);
      throw new Error(`${svc.Service} exited before healthy\n${logs.out.slice(-3000)}`);
    }
    if (Date.now() - start > timeoutMs) throw new Error(`timeout waiting for ${serviceRe} healthy`);
    await new Promise((r) => setTimeout(r, 4000));
  }
}

function apiContainerName(args) {
  const states = serviceStates(args);
  const svc = states.find((s) => /restful-api/.test(s.Service || s.Name || ''));
  return svc ? (svc.Name || null) : null;
}

function rssBytes(args) {
  const name = apiContainerName(args);
  if (!name) return { name: null, memUsageBytes: null, memPercent: null };
  const res = tryRun('docker', ['stats', '--no-stream', '--format', '{{.MemUsage}}|{{.MemPerc}}', name]);
  if (!res.ok) return { name, memUsageBytes: null, memPercent: null, error: res.out.trim().slice(0, 500) };
  const [memUsage] = res.out.trim().split('|');
  const m = /^([\d.]+)\s*([KMG]iB|B)/i.exec((memUsage || '').split('/')[0].trim());
  const mul = { b: 1, kib: 1024, mib: 1024 ** 2, gib: 1024 ** 3 };
  const bytes = m ? Math.round(parseFloat(m[1]) * (mul[m[2].toLowerCase()] || 1)) : null;
  return { name, memUsage: (memUsage || '').trim(), memUsageBytes: bytes };
}

async function probe(url, timeoutMs = 15000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { redirect: 'manual', signal: ctl.signal });
    return { url, status: res.status };
  } catch (e) {
    return { url, status: null, error: String(e && e.message ? e.message : e) };
  } finally {
    clearTimeout(t);
  }
}

/* ------------------------------------------------------------------ */
/* case: image — build the Boot 4 image, preserve old digest for rollback */
/* ------------------------------------------------------------------ */
function caseImage(args) {
  const dir = ensureEvidenceDir(args);
  const beforeId = dockerImageId(IMAGE_TAG);
  let retagged = false;
  if (beforeId) {
    const r = tryRun('docker', ['tag', IMAGE_TAG, ROLLBACK_TAG]);
    retagged = r.ok;
  }
  const build = run('docker', ['compose', '-p', `campuscore-p02-img-${process.pid}`,
    '-f', path.join(REPO, COMPOSE_FILE), 'build', 'restful-api'], { env: {} });
  const afterId = dockerImageId(IMAGE_TAG);
  const evidence = {
    case: 'image', builtAt: new Date().toISOString(), image: IMAGE_TAG,
    previousImageId: beforeId, previousRetaggedAs: retagged ? ROLLBACK_TAG : null,
    newImageId: afterId, changed: beforeId !== afterId,
    buildLogTail: build.slice(-1500),
  };
  writeJson(dir, 'image.json', evidence);
  if (!afterId) { console.error('FAIL image id not found after build'); process.exit(1); }
  console.log(`PASS image built ${afterId} (previous ${beforeId || 'none'}${retagged ? `, preserved as ${ROLLBACK_TAG}` : ''})`);
}

/* ------------------------------------------------------------------ */
/* case: stack — boot the full disposable stack once; startup/RSS/probes   */
/* ------------------------------------------------------------------ */
async function caseStack(args) {
  const dir = ensureEvidenceDir(args);
  args_env = {
    POSTGRES_HOST_PORT: String(await allocPort()),
    E2E_API_HOST_PORT: String(await allocPort()),
  };
  const started = Date.now();
  const result = {
    case: 'stack', target: 'local', project: args.project, image: IMAGE_TAG,
    ports: { ...args_env }, startedAt: new Date(started).toISOString(),
  };
  try {
    const up = composeTry(args, ['up', '-d', '--build', 'postgres', 'assistant-db-provisioner', 'restful-api']);
    if (!up.ok) throw new Error(`compose up failed\n${up.out.slice(-3000)}`);
    const api = await waitServiceHealthy(args, /restful-api/, 480000);
    result.startupMs = api.healthyMs;
    // let the JVM settle past the health flip before the RSS reading
    await new Promise((r) => setTimeout(r, 8000));
    result.memory = rssBytes(args);
    const apiPort = args_env.E2E_API_HOST_PORT;
    result.probes = {
      publicLiveness: await probe(`http://127.0.0.1:${apiPort}/api/v1/health/liveness`),
      protectedNoAuth: await probe(`http://127.0.0.1:${apiPort}/api/v1/thesis/topics`),
      protectedNoAuth2: await probe(`http://127.0.0.1:${apiPort}/api/v1/notifications`),
    };
    const pubOk = result.probes.publicLiveness.status === 200;
    const closedOk = [401, 403].includes(result.probes.protectedNoAuth.status)
      && [401, 403].includes(result.probes.protectedNoAuth2.status);
    result.failClosed = closedOk;
    result.fits512Mb = result.memory.memUsageBytes != null
      ? result.memory.memUsageBytes <= 512 * 1024 * 1024 : null;
    result.verdict = pubOk && closedOk ? 'PASS' : 'FAIL';
    writeJson(dir, 'stack.json', result);
    if (result.verdict !== 'PASS') {
      throw new Error(`stack probes failed: ${JSON.stringify(result.probes)}`);
    }
    console.log(`PASS stack up=${api.healthyMs}ms rss=${result.memory.memUsage} fits512Mb=${result.fits512Mb} probes=${JSON.stringify(result.probes)}`);
  } finally {
    try { composeTry(args, ['down', '-v', '--remove-orphans']); } catch { /* best-effort */ }
  }
}

/* ------------------------------------------------------------------ */
/* case: pgit — disposable postgres + full *PostgresIT failsafe run        */
/* ------------------------------------------------------------------ */
async function casePgit(args) {
  const dir = ensureEvidenceDir(args);
  args_env = {
    POSTGRES_HOST_PORT: String(await allocPort()),
    E2E_API_HOST_PORT: String(await allocPort()),
  };
  const result = { case: 'pgit', target: 'local', project: args.project, ports: { ...args_env } };
  try {
    // One IT pins the historical audit rig at 127.0.0.1:5452 — publish the same
    // disposable postgres on that fixed port too when it is free; if taken,
    // proceed without the override and that class stays skipped (honest).
    const rigFree = await new Promise((resolve) => {
      const s = net.connect(5452, '127.0.0.1');
      s.once('connect', () => { s.destroy(); resolve(false); });
      s.once('error', () => resolve(true));
      s.setTimeout(2000, () => { s.destroy(); resolve(true); });
    });
    result.fixedRigPort = rigFree ? 5452 : null;
    const overrideFile = path.join(ensureEvidenceDir(args), 'pgit-compose-override.yml');
    if (rigFree) {
      fs.writeFileSync(overrideFile, [
        'services:',
        '  postgres:',
        '    ports:',
        '      - "127.0.0.1:${POSTGRES_HOST_PORT:-5433}:5432"',
        '      - "127.0.0.1:5452:5432"',
        '',
      ].join('\n'), 'utf8');
      // every compose call (up/exec/run/ps/down) must see the same file set —
      // base-file-only calls would compute a different service config and let
      // compose recreate postgres without the 5452 binding mid-run.
      args.composeFiles = [path.join(REPO, COMPOSE_FILE), overrideFile];
    }
    const up = composeTry(args, ['up', '-d', 'postgres']);
    if (!up.ok) throw new Error(`compose up failed\n${up.out.slice(-3000)}`);
    await waitServiceHealthy(args, /postgres/, 240000);
    const pgPort = args_env.POSTGRES_HOST_PORT;
    // Each IT env-family gets its own disposable database — several ITs state
    // "the caller must supply a separate disposable database" and all of them
    // run full production migrations plus their own seeds.
    // The council-family @EnabledIf check requires the db name to start with
    // campuscore_council_race_; CredentialSessionLockOrderPostgresIT pins the
    // historical audit rig at 127.0.0.1:5452/campuscore_council_race_credential_20261016.
    // One URL satisfies both when the rig db is reachable on 5452.
    const policyScenarios = ['local', 'human', 'concurrent', 'current_supabase', 'previous_supabase'];
    const certScenarios = [
      'local', 'concurrent', 'clean', 'base_drift', 'foreign', 'newer',
      'drift_draft', 'drift_published', 'drift_content', 'drift_revision_content',
      'drift_document_metadata', 'drift_revision_metadata', 'drift_status',
    ];
    const dbs = [
      'campuscore_restful_e2e', // created by POSTGRES_DB, listed for completeness
      'campuscore_restful_e2e_upgrade',
      'campuscore_restful_e2e_rls',
      'campuscore_restful_e2e_assistant',
      'campuscore_restful_e2e_assistant_mig',
      'campuscore_council_race_credential_20261016',
      'campuscore_restful_e2e_report',
      // correction-migration ITs require a *fresh* db per scenario whose name
      // matches /policy_migration_test_[a-z0-9_]+ (asserted by the fixtures)
      ...policyScenarios.map((s) => `policy_migration_test_policy_${s}`),
      ...certScenarios.map((s) => `policy_migration_test_cert_${s}`),
      'policy_migration_test_notify',
    ];
    for (const db of dbs.slice(1)) {
      // DROP DATABASE cannot run inside a transaction block — separate -c calls.
      const mk = composeTry(args, ['exec', '-T', 'postgres', 'sh', '-c',
        `psql --no-psqlrc --set ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres -c "DROP DATABASE IF EXISTS ${db}" -c "CREATE DATABASE ${db}"`]);
      if (!mk.ok) throw new Error(`could not provision db ${db}\n${mk.out.slice(-1000)}`);
    }
    result.dbsProvisioned = dbs;
    // V84 creates campuscore_assistant_runtime NOLOGIN; the one-shot provisioner
    // flips it to LOGIN with the dev-only password, matching the e2e compose
    // dependency chain the restful-api service relies on.
    const prov = composeTry(args, ['run', '--rm', 'assistant-db-provisioner']);
    result.provisionerExit = prov.code;
    if (!prov.ok) throw new Error(`assistant-db-provisioner failed\n${prov.out.slice(-1500)}`);
    const jdbcBase = `jdbc:postgresql://127.0.0.1:${pgPort}`;
    const rigJdbc = `jdbc:postgresql://127.0.0.1:${result.fixedRigPort || pgPort}`;
    const cred = (db) => ({
      URL: `${jdbcBase}/${db}`, USER: 'campuscore', PASSWORD: 'campuscore_password',
    });
    const env = (f, db) => {
      const c = cred(db);
      return {
        [`${f}_URL`]: c.URL,
        [`${f}_USER`]: c.USER,
        [`${f}_PASSWORD`]: c.PASSWORD,
      };
    };
    const mvnEnv = {
      ...env('CAMPUSCORE_E2E_POSTGRES', 'campuscore_restful_e2e'),
      ...env('CAMPUSCORE_E2E_POSTGRES_UPGRADE', 'campuscore_restful_e2e_upgrade'),
      CAMPUSCORE_COUNCIL_POSTGRES_URL: `${rigJdbc}/campuscore_council_race_credential_20261016`,
      CAMPUSCORE_COUNCIL_POSTGRES_USER: 'campuscore',
      CAMPUSCORE_COUNCIL_POSTGRES_PASSWORD: 'campuscore_password',
      ...env('CAMPUSCORE_REPORT_POSTGRES', 'campuscore_restful_e2e_report'),
      ...env('ASSISTANT_POSTGRES', 'campuscore_restful_e2e_assistant'),
      ...env('ASSISTANT_MIGRATION_POSTGRES', 'campuscore_restful_e2e_assistant_mig'),
      // demo-team/spring-focus ITs create their own scenario DBs through an
      // admin URL that must point at the maintenance database /postgres
      CAMPUSCORE_DEMO_TEAM_PG_ADMIN_URL: `${jdbcBase}/postgres`,
      CAMPUSCORE_DEMO_TEAM_PG_USER: 'campuscore',
      CAMPUSCORE_DEMO_TEAM_PG_PASSWORD: 'campuscore_password',
      CAMPUSCORE_SPRING_FOCUS_PG_ADMIN_URL: `${jdbcBase}/postgres`,
      CAMPUSCORE_SPRING_FOCUS_PG_USER: 'campuscore',
      CAMPUSCORE_SPRING_FOCUS_PG_PASSWORD: 'campuscore_password',
      // correction-migration ITs require one fresh db per scenario, named
      // policy_migration_test_* — the fixture asserts the pattern AND that
      // flyway_schema_history is absent on first connect
      ...Object.fromEntries(policyScenarios.map((s) => [
        `CAMPUSCORE_POLICY_MIGRATION_${s.toUpperCase()}_URL`,
        `${jdbcBase}/policy_migration_test_policy_${s}`,
      ])),
      CAMPUSCORE_POLICY_MIGRATION_USER: 'campuscore',
      CAMPUSCORE_POLICY_MIGRATION_PASSWORD: 'campuscore_password',
      ...Object.fromEntries(certScenarios.map((s) => [
        `CAMPUSCORE_CERTIFICATE_MIGRATION_${s.toUpperCase()}_URL`,
        `${jdbcBase}/policy_migration_test_cert_${s}`,
      ])),
      CAMPUSCORE_CERTIFICATE_MIGRATION_USER: 'campuscore',
      CAMPUSCORE_CERTIFICATE_MIGRATION_PASSWORD: 'campuscore_password',
      CAMPUSCORE_NOTIFICATION_AUDIT_URL: `${jdbcBase}/policy_migration_test_notify`,
      CAMPUSCORE_NOTIFICATION_AUDIT_USER: 'campuscore',
      CAMPUSCORE_NOTIFICATION_AUDIT_PASSWORD: 'campuscore_password',
      // real-RLS IT: primary connects as owner, runtime role gets the
      // provisioner password (dev-only, disposable stack)
      ASSISTANT_RLS_POSTGRES_URL: `${jdbcBase}/campuscore_restful_e2e_rls`,
      ASSISTANT_RLS_PRIMARY_USER: 'campuscore',
      ASSISTANT_RLS_PRIMARY_PASSWORD: 'campuscore_password',
      ASSISTANT_RLS_RUNTIME_PASSWORD: 'dev-only-not-a-secret-16+',
      ASSISTANT_RLS_JWT_SECRET: 'edge-e2e-jwt-secret-0123456789abcdef',
      ASSISTANT_RLS_JWT_REFRESH_SECRET: 'edge-e2e-refresh-secret-0123456789abcdef',
      // feature flags some ITs gate on (EnabledIfEnvironmentVariable ... = true)
      CAMPUSCORE_NOTIFICATION_AUDIT_ENABLED: 'true',
      CAMPUSCORE_CERTIFICATE_MIGRATION_ENABLED: 'true',
      CAMPUSCORE_POLICY_MIGRATION_ENABLED: 'true',
      CAMPUSCORE_DEMO_TEAM_PG_ENABLED: 'true',
      CAMPUSCORE_SPRING_FOCUS_PG_ENABLED: 'true',
    };
    const t0 = Date.now();
    const res = tryRun('mvn', [
      '-f', 'java-services/pom.xml', '-pl', 'restful-api', 'verify',
      '-Passistant-postgres-it',
      `-Dit.test=${args.its || '*PostgresIT'}`, '-Dtest=__none__', '-Dsurefire.failIfNoSpecifiedTests=false',
      '-Dstyle.color=never',
    ], { env: mvnEnv });
    result.mvnMs = Date.now() - t0;
    result.mvnExit = res.code;
    fs.writeFileSync(path.join(dir, args.logName || 'pgit-mvn.log'), res.out, 'utf8');
    // reactor summary lines end right after the skipped count; per-class lines
    // continue with ", Time elapsed:" — only the former are totals.
    const summary = [...res.out.matchAll(/Tests run: (\d+), Failures: (\d+), Errors: (\d+), Skipped: (\d+)\s*$/gm)]
      .map((m) => m.slice(1).map(Number));
    const totals = summary.length ? summary[summary.length - 1] : [0, 0, 0, 0];
    result.totals = { tests: totals[0], failures: totals[1], errors: totals[2], skipped: totals[3] };
    const executed = totals[0] - totals[3];
    const itRan = executed > 0;
    result.executedTests = executed;
    result.verdict = res.ok && itRan && totals[1] === 0 && totals[2] === 0 ? 'PASS' : 'FAIL';
    result.zeroTestGuard = itRan ? 'executed' : 'NO_ITS_RAN — refuse to count as pass';
    writeJson(dir, args.resultName || 'pgit.json', result);
    if (result.verdict !== 'PASS') {
      throw new Error(`pgit verdict FAIL exit=${res.code} totals=${JSON.stringify(result.totals)} — see ${args.logName || 'pgit-mvn.log'}`);
    }
    console.log(`PASS pgit tests=${totals[0]} failures=${totals[1]} errors=${totals[2]} skipped=${totals[3]} in ${result.mvnMs}ms`);
  } finally {
    try { composeTry(args, ['down', '-v', '--remove-orphans']); } catch { /* best-effort */ }
  }
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  if (!cmd) usage();
  const args = parseArgs(rest);
  const [maj, min] = process.versions.node.split('.').map(Number);
  if (maj < MIN_NODE[0] || (maj === MIN_NODE[0] && min < MIN_NODE[1])) {
    console.error(`BLOCKED_CAPABILITY node ${process.versions.node} < ${MIN_NODE.join('.')}`);
    process.exit(4);
  }
  if (cmd !== 'image') {
    if (!args.project || !PROJECT_RE.test(args.project)) usage('--project must match campuscore-*');
    if (!tryRun('docker', ['compose', 'version']).ok) {
      console.error('BLOCKED_CAPABILITY docker compose unavailable');
      process.exit(4);
    }
  }
  if (cmd === 'image') caseImage(args);
  else if (cmd === 'stack') await caseStack(args);
  else if (cmd === 'pgit') await casePgit(args);
  else usage(`unknown subcommand ${cmd}`);
}

main().catch((e) => { console.error(`FAIL ${e.message || e}`); process.exit(1); });
