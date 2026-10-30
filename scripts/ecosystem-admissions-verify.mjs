#!/usr/bin/env node
// admissions-e2e gate case (P10): boots the same HTTPS preview stack as the
// content/browser-sso cases — disposable compose API in the BFF lane, the
// id host TLS terminator, and `next dev --experimental-https` on every
// *.localhost surface — then runs e2e/ecosystem-admissions.spec.ts through
// Playwright. The spec drives the applicant + staff REST lanes on the API
// loopback for the draft → submit → claim → return → resubmit → decision
// journey, then opens /apply + /apply/review through
// the portal SSO lane to prove the decision + review-history render.
//
//   node scripts/ecosystem-admissions-verify.mjs preview --project <campuscore-*> [--evidence dir]
//
// Everything it starts is torn down in `finally`.

import { execFileSync, spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FRONTEND = path.join(REPO, 'frontend');
const E2E_COMPOSE = path.join(REPO, 'docker-compose.e2e.yml');
const SSO_OVERRIDE = path.join(REPO, 'docker-compose.sso-preview.yml');
const PLAYWRIGHT_CLI = path.join(FRONTEND, 'node_modules', 'playwright', 'cli.js');
const PROJECT_RE = /^campuscore-[a-z0-9-]+$/;
const WEB_PORT = 3102;
const ID_TLS_PORT = 4443;
const API_PORT = 4100;
const BOOT_TIMEOUT_MS = 240000;

const children = [];

function usage(msg) {
  if (msg) console.error(`USAGE_FAIL ${msg}`);
  console.error('Usage: ecosystem-admissions-verify.mjs preview --project <campuscore-*> [--evidence dir]');
  process.exit(2);
}

function parseArgs(argv) {
  const args = { evidence: 'artifacts/verification/admissions' };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--project') args.project = argv[++i];
    else if (a === '--evidence') args.evidence = argv[++i];
    else usage(`unknown arg ${a}`);
  }
  return args;
}

function tryRun(cmd, argv, opts = {}) {
  let res = spawnSync(cmd, argv, {
    cwd: opts.cwd || REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, ...(opts.env || {}) }, timeout: opts.timeoutMs || 120000,
    shell: opts.shell ?? false,
  });
  if (res.error && res.error.code === 'ENOENT' && process.platform === 'win32') {
    res = spawnSync(cmd, argv, {
      cwd: opts.cwd || REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, ...(opts.env || {}) }, shell: true,
      timeout: opts.timeoutMs || 120000,
    });
  }
  if (res.error) return { ok: false, out: `${res.stdout || ''}${res.stderr || ''}${res.error.message || ''}`, code: -1 };
  return { ok: res.status === 0, out: `${res.stdout || ''}${res.stderr || ''}`, code: res.status };
}

function composeArgs(args, argv) {
  return ['compose', '-p', args.project, '-f', E2E_COMPOSE, '-f', SSO_OVERRIDE, ...argv];
}

function spawnLog(cmd, argv, opts, logFile) {
  const out = fs.openSync(logFile, 'a');
  const child = spawn(cmd, argv, {
    cwd: opts.cwd || REPO,
    env: { ...process.env, ...(opts.env || {}) },
    stdio: ['ignore', out, out],
    shell: opts.shell ?? false,
  });
  children.push(child);
  return child;
}

async function assertPortFree(port, label) {
  const free = await new Promise((resolve) => {
    const socket = new net.Socket();
    const done = (v) => { socket.destroy(); resolve(v); };
    socket.setTimeout(300);
    socket.once('connect', () => done(false));
    socket.once('error', () => done(true));
    socket.once('timeout', () => done(true));
    socket.connect(port, '127.0.0.1');
  });
  if (!free) throw new Error(`port ${port} in use — refusing preview collision (${label})`);
}

function waitFor(url, opts = {}) {
  const deadline = Date.now() + (opts.timeoutMs ?? BOOT_TIMEOUT_MS);
  const insecure = opts.insecure ?? false;
  const target = new URL(url);
  const hostHeader = target.hostname.endsWith('.localhost') ? target.host : null;
  if (hostHeader) target.hostname = '127.0.0.1';
  return new Promise((resolve, reject) => {
    const tick = async () => {
      try {
        const prev = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
        if (insecure) process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
        try {
          const res = await fetch(target, {
            signal: AbortSignal.timeout(8000),
            headers: hostHeader ? { host: hostHeader } : undefined,
          });
          if (res.status < 500) { resolve(res.status); return; }
        } finally {
          if (insecure) process.env.NODE_TLS_REJECT_UNAUTHORIZED = prev;
        }
      } catch { /* retry */ }
      if (Date.now() > deadline) {
        reject(new Error(`timeout waiting for ${url}`));
        return;
      }
      setTimeout(tick, 2500);
    };
    tick();
  });
}

function generateCerts(dir) {
  const key = path.join(dir, 'preview-key.pem');
  const cert = path.join(dir, 'preview-cert.pem');
  if (fs.existsSync(key) && fs.existsSync(cert)) return { key, cert };
  const res = tryRun('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
    '-keyout', key, '-out', cert, '-days', '2',
    '-subj', '/CN=localhost',
    '-addext', 'subjectAltName=DNS:localhost,DNS:*.localhost,IP:127.0.0.1',
  ]);
  if (!res.ok) throw new Error(`openssl cert generation failed\n${res.out.slice(-1000)}`);
  return { key, cert };
}

function stopChildren() {
  for (const child of children) {
    if (child.exitCode !== null || child.signalCode !== null) continue;
    if (process.platform === 'win32' && child.pid) {
      try {
        execFileSync('taskkill', ['/pid', String(child.pid), '/t', '/f'],
          { stdio: 'ignore' });
      } catch { /* best effort */ }
    } else {
      try { child.kill('SIGTERM'); } catch { /* best effort */ }
    }
  }
}

async function casePreview(args) {
  const dir = path.resolve(REPO, args.evidence);
  fs.mkdirSync(dir, { recursive: true });
  const result = { case: 'admissions-e2e-preview', project: args.project };
  let ownsStack = false;
  try {
    const which = tryRun('openssl', ['version']);
    if (!which.ok) throw new Error('openssl unavailable — HTTPS preview cannot build certs (BLOCKED_CAPABILITY)');
    await assertPortFree(WEB_PORT, 'next-dev');
    await assertPortFree(ID_TLS_PORT, 'id-tls');
    const existing = tryRun('docker', ['ps', '-aq', '--filter',
      `label=com.docker.compose.project=${args.project}`]);
    if (existing.out.trim()) {
      throw new Error(`compose project ${args.project} already exists — refusing collision`);
    }

    ownsStack = true;
    const up = tryRun('docker', composeArgs(args,
      ['up', '-d', '--build', 'postgres', 'assistant-db-provisioner', 'restful-api']),
      { timeoutMs: 600000 });
    if (!up.ok) throw new Error(`compose up failed\n${up.out.slice(-3000)}`);
    await waitFor(`http://127.0.0.1:${API_PORT}/api/v1/health/liveness`,
      { timeoutMs: BOOT_TIMEOUT_MS });
    result.apiHealthy = true;
    const spec = await fetch(`http://127.0.0.1:${API_PORT}/v3/api-docs`);
    if (!spec.ok) throw new Error(`OpenAPI capture failed: ${spec.status}`);
    fs.writeFileSync(path.join(dir, 'runtime-openapi.json'), JSON.stringify(await spec.json(), null, 2) + '\n');

    const { key, cert } = generateCerts(dir);
    spawnLog(process.execPath, [
      path.join(REPO, 'scripts', 'dev-id-tls.mjs'),
      '--key', key, '--cert', cert,
      '--port', String(ID_TLS_PORT),
      '--target', `http://127.0.0.1:${API_PORT}`,
    ], {}, path.join(dir, 'id-tls.log'));
    await waitFor(`https://id.localhost:${ID_TLS_PORT}/api/v1/health/liveness`,
      { insecure: true, timeoutMs: 30000 });
    result.idTlsUp = true;

    const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    spawnLog(npmCmd, [
      'run', 'dev', '--',
      '--experimental-https',
      '--experimental-https-key', key,
      '--experimental-https-cert', cert,
      '--hostname', '127.0.0.1',
      '--port', String(WEB_PORT),
    ], {
      cwd: FRONTEND,
      env: {
        NEXT_PUBLIC_API_URL: '/api/v1',
        NEXT_PUBLIC_BFF_LANE: 'true',
        JAVA_API_ORIGIN: `http://127.0.0.1:${API_PORT}`,
        CAMPUSCORE_PROXY_TOKEN: 'sso-preview-proxy-token-0123456789',
        // Dashboard pages fetch a lot of JS on first compile; keep the heap
        // headroom that earlier preview runs needed under memory pressure.
        NODE_OPTIONS: '--max-old-space-size=6144',
      },
      shell: process.platform === 'win32',
    }, path.join(dir, 'next-dev.log'));
    await waitFor(`https://portal.localhost:${WEB_PORT}/`, { insecure: true });
    result.nextUp = true;

    const pw = tryRun(process.execPath, [
      PLAYWRIGHT_CLI, 'test', 'e2e/ecosystem-admissions.spec.ts',
      '--project', 'chromium', '--reporter', 'list',
    ], {
      cwd: FRONTEND, timeoutMs: 900000,
      env: {
        E2E_BASE_URL: `https://portal.localhost:${WEB_PORT}`,
        SSO_PORTAL_BASE: `https://portal.localhost:${WEB_PORT}`,
        SSO_ID_BASE: `https://id.localhost:${ID_TLS_PORT}`,
        ADMISSIONS_API_BASE: `http://127.0.0.1:${API_PORT}`,
        E2E_ADMIN_PASSCODE: 'password123',
        E2E_ADMIN2_PASSCODE: 'password123',
        E2E_LECTURER_PASSCODE: 'password123',
        E2E_STUDENT_PASSCODE: 'password123',
        E2E_STUDENT2_PASSCODE: 'password123',
      },
    });
    fs.writeFileSync(path.join(dir, 'playwright.log'), pw.out, 'utf8');
    result.playwrightExit = pw.code;
    result.ok = pw.ok;
    if (!pw.ok) result.error = `playwright exit ${pw.code} — see playwright.log`;
  } catch (error) {
    result.ok = false;
    result.error = String(error.message || error).slice(-3000);
  } finally {
    stopChildren();
    if (ownsStack) {
      const down = tryRun('docker', composeArgs(args,
        ['down', '-v', '--remove-orphans']), { timeoutMs: 120000 });
      result.teardown = down.ok ? 'clean' : `degraded: ${down.out.slice(-300)}`;
    } else {
      result.teardown = 'not-created';
    }
  }
  fs.writeFileSync(path.join(dir, 'preview.json'),
    `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  if (!result.ok) {
    console.error(`FAIL admissions-e2e: ${result.error || 'see preview.json'}`);
    process.exit(1);
  }
  console.log(`PASS admissions-e2e: preview admissions journey green (evidence ${dir})`);
}

async function main() {
  const [cmd, ...argv] = process.argv.slice(2);
  if (!cmd) usage('missing subcommand');
  const args = parseArgs(argv);
  if (!args.project || !PROJECT_RE.test(args.project)) {
    usage('--project must match /^campuscore-[a-z0-9-]+$/ (stack isolation)');
  }
  if (cmd === 'preview') {
    await casePreview(args);
    return;
  }
  usage(`unknown subcommand ${cmd}`);
}

main().catch((error) => {
  console.error(`FAIL ${error.message || error}`);
  stopChildren();
  process.exit(1);
});
