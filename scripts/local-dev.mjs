#!/usr/bin/env node
/**
 * local-dev - one-command local development helper for the CampusUTE EcoSystem.
 *
 *   node scripts/local-dev.mjs doctor
 *   node scripts/local-dev.mjs up [--mobile] [--project <name>] [--no-build]
 *   node scripts/local-dev.mjs status [--mobile]
 *   node scripts/local-dev.mjs logs [service]
 *   node scripts/local-dev.mjs down [--volumes]
 *
 * Design notes:
 * - Every decision is a pure exported function so node:test can cover it
 *   without Docker. Process spawning goes through one injected `run`.
 * - `.env` is created from `.env.example` only when absent; this script never
 *   reads or prints environment-file contents (Compose owns interpolation).
 * - Commands spawn `docker` directly (no shell) so PowerShell, Git Bash and
 *   POSIX shells get the same argv without hand-quoting.
 */

import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const DEFAULT_PROJECT_NAME = 'campusute';
export const COMPOSE_BASE = 'docker-compose.yml';
export const COMPOSE_MOBILE = 'docker-compose.mobile-local.yml';

// Repo requirements: java-services/pom.xml pins Java 21; frontend/package.json
// declares no engines field, so the CI setup-node version (22.13, also the
// Expo SDK57 floor) is the Node requirement.
export const REQUIRED_NODE_VERSION = '22.13.0';
export const REQUIRED_JAVA_MAJOR = 21;
export const REQUIRED_COMPOSE_MAJOR = 2;

export const HEALTH_TIMEOUT_MS = 300_000;
export const HEALTH_INTERVAL_MS = 3_000;

export const DEMO_STUDENT_EMAIL = 'student@campuscore.edu';
export const DEMO_CREDENTIALS_POINTER = 'docs/DEMO_RUNBOOK.md';

// The exact names published by mobile/eas.json (build.local.env) and
// mobile/README.md. Values are read from eas.json at run time.
export const MOBILE_PROFILE_ENV = [
  'EXPO_PUBLIC_API_MODE',
  'EXPO_PUBLIC_API_URL',
  'EXPO_PUBLIC_ISSUER_URL',
  'EXPO_PUBLIC_ALLOW_CLEARTEXT_LOCAL',
];

// Host bindings in docker-compose.yml and the real override variable names.
export const HOST_PORT_BINDINGS = [
  { port: 3000, variable: 'FRONTEND_HOST_PORT', service: 'web', containerPort: 3000 },
  { port: 4010, variable: 'RESTFUL_API_HOST_PORT', service: 'restful-api', containerPort: 4010 },
  { port: 5432, variable: 'POSTGRES_HOST_PORT', service: 'postgres', containerPort: 5432 },
  { port: 8025, variable: 'MAILPIT_UI_HOST_PORT', service: 'mailpit', containerPort: 8025 },
  { port: 1025, variable: 'MAILPIT_SMTP_HOST_PORT', service: 'mailpit', containerPort: 1025 },
];

const COMPOSE_COMMANDS = ['up', 'status', 'logs', 'down'];
const COMMANDS = ['doctor', ...COMPOSE_COMMANDS, 'help'];
const PROJECT_NAME_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;

export class UsageError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UsageError';
  }
}

function defaultFlags() {
  return { mobile: false, build: true, volumes: false, project: null };
}

/* ------------------------------------------------------------------ */
/* usage                                                              */
/* ------------------------------------------------------------------ */

export const USAGE = `local-dev - one-command local development helper for CampusUTE EcoSystem

Usage:
  node scripts/local-dev.mjs <command> [flags]

Commands:
  doctor              Check Docker, Node, Java, .env and host ports
  up                  Create .env if missing, start the stack and wait for health
  status              Show compose services and the health probes
  logs [service]      Follow logs (--tail 200 -f)
  down                Stop the stack; add --volumes to delete local DB data
  help                Show this help

Flags:
  --mobile            Add docker-compose.mobile-local.yml (OIDC for the Android emulator)
  --project <name>    Compose project name (default: name: from the compose files, else campusute)
  --no-build          Skip --build on "up"
  --volumes           With "down": also delete named volumes (local database data)
  -h, --help          Show this help and exit; never starts a container

Examples:
  node scripts/local-dev.mjs doctor
  node scripts/local-dev.mjs up
  node scripts/local-dev.mjs up --mobile
  node scripts/local-dev.mjs status
  node scripts/local-dev.mjs logs restful-api
  node scripts/local-dev.mjs down

Host ports (override in .env):
  FRONTEND_HOST_PORT=3000   RESTFUL_API_HOST_PORT=4010   POSTGRES_HOST_PORT=5432
  MAILPIT_UI_HOST_PORT=8025   MAILPIT_SMTP_HOST_PORT=1025

Doctor treats Node >= ${REQUIRED_NODE_VERSION}, Java >= ${REQUIRED_JAVA_MAJOR}, the Docker CLI,
Compose v2 and a reachable Docker engine as hard requirements. A missing .env
and busy host ports are warnings with remedies; "up" never overwrites .env.`;

/* ------------------------------------------------------------------ */
/* argument parsing and command shaping (pure)                        */
/* ------------------------------------------------------------------ */

export function parseArgs(argv = []) {
  const tokens = argv.map((value) => String(value));
  if (tokens.includes('--help') || tokens.includes('-h') || tokens[0] === 'help') {
    const first = tokens.find((token) => !token.startsWith('-'));
    const command = first && COMMANDS.includes(first) && first !== 'help' ? first : 'help';
    return { command, help: true, flags: defaultFlags(), service: null };
  }

  const flags = defaultFlags();
  let command = null;
  let service = null;

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token === '--mobile') flags.mobile = true;
    else if (token === '--no-build') flags.build = false;
    else if (token === '--volumes') flags.volumes = true;
    else if (token === '--project') {
      const value = tokens[i + 1];
      if (!value || value.startsWith('-')) throw new UsageError('--project requires a value');
      flags.project = value;
      i += 1;
    } else if (token.startsWith('-')) {
      throw new UsageError(`Unknown option: ${token}`);
    } else if (command === null) {
      if (!COMMANDS.includes(token) || token === 'help') throw new UsageError(`Unknown command: ${token}`);
      command = token;
    } else if (command === 'logs' && service === null) {
      service = token;
    } else {
      throw new UsageError(`Unexpected argument: ${token}`);
    }
  }

  if (command === null) throw new UsageError('Missing command');
  if (flags.mobile && !COMPOSE_COMMANDS.includes(command)) {
    throw new UsageError(`--mobile is only valid for: ${COMPOSE_COMMANDS.join(', ')}`);
  }
  if (flags.build === false && command !== 'up') throw new UsageError('--no-build is only valid for "up"');
  if (flags.volumes && command !== 'down') throw new UsageError('--volumes is only valid for "down"');
  if (flags.project && !COMPOSE_COMMANDS.includes(command)) {
    throw new UsageError(`--project is only valid for: ${COMPOSE_COMMANDS.join(', ')}`);
  }

  return { command, help: false, flags, service };
}

export function selectComposeFiles({ mobile = false } = {}) {
  return mobile ? [COMPOSE_BASE, COMPOSE_MOBILE] : [COMPOSE_BASE];
}

export function composeNameFromSource(source) {
  const match = /^name:\s*['"]?([A-Za-z0-9][A-Za-z0-9_-]*)['"]?\s*(?:#.*)?$/m.exec(String(source ?? ''));
  return match ? match[1] : null;
}

export function resolveProjectName({ explicit = null, sources = [] } = {}) {
  if (explicit !== null && explicit !== undefined) {
    if (!PROJECT_NAME_PATTERN.test(explicit)) {
      throw new UsageError(`Invalid project name "${explicit}": use lowercase letters, digits, dash or underscore`);
    }
    return explicit;
  }
  for (const source of sources) {
    const name = composeNameFromSource(source);
    if (name) {
      if (!PROJECT_NAME_PATTERN.test(name)) throw new UsageError(`Compose file declares an invalid project name "${name}"`);
      return name;
    }
  }
  return DEFAULT_PROJECT_NAME;
}

export function composeArgs({ project, files }) {
  return ['compose', '-p', project, ...files.flatMap((file) => ['-f', file])];
}

export function buildUpArgs({ project, files, build = true }) {
  return [...composeArgs({ project, files }), 'up', '-d', ...(build ? ['--build'] : [])];
}

export function buildDownArgs({ project, files, volumes = false }) {
  return [...composeArgs({ project, files }), 'down', ...(volumes ? ['-v'] : [])];
}

export function buildLogsArgs({ project, files, service = null }) {
  return [...composeArgs({ project, files }), 'logs', '--tail', '200', '-f', ...(service ? [service] : [])];
}

/* ------------------------------------------------------------------ */
/* ports and advice (pure)                                            */
/* ------------------------------------------------------------------ */

export function suggestHostPort(port) {
  return Number(`1${port}`);
}

export function effectiveHostPort(env, variable, fallback) {
  const raw = env?.[variable];
  if (raw === undefined || raw === null || String(raw).trim() === '') return fallback;
  const value = Number.parseInt(String(raw), 10);
  return Number.isInteger(value) && value > 0 && value < 65536 ? value : fallback;
}

export function portConflictAdvice(binding, owner = null) {
  const suggested = suggestHostPort(binding.port);
  return {
    port: binding.port,
    variable: binding.variable,
    service: binding.service,
    suggestedPort: suggested,
    suggestedLine: `${binding.variable}=${suggested}`,
    owner,
  };
}

export function formatPortAdvice(advice) {
  return advice.owner
    ? `set ${advice.suggestedLine} in .env (currently ${advice.owner})`
    : `set ${advice.suggestedLine} in .env`;
}

export function parseDockerPsOwners(raw) {
  const owners = new Map();
  for (const line of String(raw ?? '').split(/\r?\n/)) {
    if (!line.trim()) continue;
    const [name = '', ports = '', project = '', service = ''] = line.split('\t');
    const where = [project && `project ${project}`, service && `service ${service}`].filter(Boolean).join(', ');
    const label = `container ${name}${where ? ` (${where})` : ''}`;
    for (const match of ports.matchAll(/(?:^|[,\s])(?:[\d.]+|\[[0-9a-fA-F:]+\]):(\d+)->/g)) {
      const port = Number(match[1]);
      if (!owners.has(port)) owners.set(port, label);
    }
  }
  return owners;
}

/* ------------------------------------------------------------------ */
/* .env handling (injected fs)                                        */
/* ------------------------------------------------------------------ */

export function ensureEnvFile({ root, fs: fsImpl = fs, log = () => {} }) {
  const target = path.join(root, '.env');
  if (fsImpl.existsSync(target)) {
    log('.env already exists; keeping it unchanged');
    return { created: false, path: target };
  }
  const template = path.join(root, '.env.example');
  if (!fsImpl.existsSync(template)) throw new Error('.env is missing and .env.example is not available to copy');
  fsImpl.copyFileSync(template, target);
  log('created .env from .env.example (template values; it is git-ignored)');
  return { created: true, path: target };
}

/* ------------------------------------------------------------------ */
/* mobile recipe                                                      */
/* ------------------------------------------------------------------ */

export function mobileRecipeFromEas(eas) {
  const values = eas?.build?.local?.env;
  if (!values || typeof values !== 'object') throw new Error('mobile/eas.json has no build.local.env profile');
  return MOBILE_PROFILE_ENV.map((name) => {
    const value = values[name];
    if (typeof value !== 'string' || value.length === 0) {
      throw new Error(`mobile/eas.json build.local.env is missing ${name}`);
    }
    return { name, value };
  });
}

export function readMobileRecipe({ root, fs: fsImpl = fs }) {
  const file = path.join(root, 'mobile', 'eas.json');
  if (!fsImpl.existsSync(file)) throw new Error('mobile/eas.json is missing; cannot print the --mobile recipe');
  let parsed;
  try {
    parsed = JSON.parse(fsImpl.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`mobile/eas.json is not valid JSON: ${error.message}`);
  }
  return mobileRecipeFromEas(parsed);
}

/* ------------------------------------------------------------------ */
/* output formatting (pure)                                           */
/* ------------------------------------------------------------------ */

export function formatUrlTable({
  webPort,
  apiPort,
  mailpitUiPort,
  mobileRecipe = null,
  demoEmail = DEMO_STUDENT_EMAIL,
}) {
  const rows = [
    ['Web', `http://127.0.0.1:${webPort}`],
    ['API', `http://127.0.0.1:${apiPort}/api/v1`],
    ['OpenAPI', `http://127.0.0.1:${apiPort}/v3/api-docs`],
    ['Mailpit UI', `http://127.0.0.1:${mailpitUiPort}`],
  ];
  const width = Math.max(...rows.map(([label]) => label.length));
  const lines = ['URLs', ...rows.map(([label, url]) => `  ${label.padEnd(width)}  ${url}`)];
  if (mobileRecipe) {
    lines.push('', 'Android emulator (mobile/eas.json build.local.env)');
    for (const { name, value } of mobileRecipe) lines.push(`  ${name}=${value}`);
    lines.push(`Demo student: ${demoEmail}`, `Credentials: see ${DEMO_CREDENTIALS_POINTER}`);
  }
  return lines.join('\n');
}

export function parseComposePs(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === 'object') return [parsed];
  } catch {
    // Compose can emit one JSON object per line; fall through.
  }
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object') rows.push(parsed);
    } catch {
      // Ignore non-JSON banner lines rather than failing the summary.
    }
  }
  return rows;
}

export function formatStatusTable(rows) {
  const list = Array.isArray(rows) ? rows : [];
  if (list.length === 0) return 'No containers found for this project.';
  const headers = ['Service', 'State', 'Health', 'Ports'];
  const data = list.map((row) => [
    row.Service || row.Name || '-',
    row.State || '-',
    row.Health || '-',
    String(row.Ports || '-').replace(/,\s*/g, ', '),
  ]);
  const widths = headers.map((header, index) => Math.max(header.length, ...data.map((cells) => cells[index].length)));
  const render = (cells) => cells.map((cell, index) => cell.padEnd(widths[index])).join('  ').trimEnd();
  return [render(headers), ...data.map(render)].join('\n');
}

export function formatDoctorLines(checks) {
  const width = Math.max(...checks.map((check) => check.label.length));
  const lines = ['local-dev doctor', ''];
  for (const check of checks) {
    lines.push(`[${check.status}] ${check.label.padEnd(width)}  ${check.detail}`);
    if (check.remedy && check.status !== 'PASS') lines.push(`${' '.repeat(7 + width + 2)}remedy: ${check.remedy}`);
  }
  return lines;
}

/* ------------------------------------------------------------------ */
/* health polling (injected fetch/sleep/clock)                        */
/* ------------------------------------------------------------------ */

export function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function formatDuration(ms) {
  const seconds = ms / 1000;
  return `${Number.isInteger(seconds) ? seconds : seconds.toFixed(1)}s`;
}

export async function probeHttp(fetchImpl, probe) {
  try {
    const response = await fetchImpl(probe.url, { redirect: 'manual' });
    const status = typeof response?.status === 'number' ? response.status : 0;
    const ok = probe.accept ? Boolean(probe.accept({ status })) : status >= 200 && status < 400;
    return { name: probe.name, url: probe.url, ok, status };
  } catch (error) {
    return { name: probe.name, url: probe.url, ok: false, status: null, error: error?.message || String(error) };
  }
}

export async function pollHealth({
  probes,
  timeoutMs = HEALTH_TIMEOUT_MS,
  intervalMs = HEALTH_INTERVAL_MS,
  fetch: fetchImpl = globalThis.fetch,
  sleep = defaultSleep,
  now = Date.now,
  log = () => {},
  progressEvery = 5,
}) {
  if (!Array.isArray(probes) || probes.length === 0) throw new Error('pollHealth requires at least one probe');
  const startedAt = now();
  const maxAttempts = Math.ceil(timeoutMs / intervalMs) + 1;
  let attempt = 0;

  for (;;) {
    attempt += 1;
    const results = await Promise.all(probes.map((probe) => probeHttp(fetchImpl, probe)));
    const pending = results.filter((result) => !result.ok);
    const elapsedMs = now() - startedAt;

    if (pending.length === 0) {
      log(`health: ready after ${formatDuration(elapsedMs)} (${attempt} attempt(s))`);
      return { attempts: attempt, elapsedMs, results };
    }
    if (elapsedMs >= timeoutMs || attempt >= maxAttempts) {
      const waiting = pending
        .map((result) => `${result.name} ${result.url}${result.status ? ` (HTTP ${result.status})` : result.error ? ` (${result.error})` : ''}`)
        .join(', ');
      throw new Error(`health check timed out after ${formatDuration(elapsedMs)} (limit ${formatDuration(timeoutMs)}); still waiting for: ${waiting}`);
    }
    if (attempt === 1 || attempt % progressEvery === 0) {
      log(`health: ${formatDuration(elapsedMs)}/${formatDuration(timeoutMs)} waiting for ${pending.map((result) => result.name).join(', ')}`);
    }
    await sleep(intervalMs);
  }
}

/* ------------------------------------------------------------------ */
/* process runner                                                     */
/* ------------------------------------------------------------------ */

export function createRunner({ cwd = REPO_ROOT, env = process.env } = {}) {
  return function run(command, args = [], options = {}) {
    const result = spawnSync(command, args, {
      cwd,
      env,
      encoding: options.stdio === 'inherit' ? undefined : 'utf8',
      maxBuffer: 8 * 1024 * 1024,
      ...options,
    });
    return {
      code: result.error ? -1 : result.status,
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
      error: result.error ?? null,
    };
  };
}

/* ------------------------------------------------------------------ */
/* port probing                                                       */
/* ------------------------------------------------------------------ */

export function probePort(port, host = '127.0.0.1', timeoutMs = 2000) {
  return new Promise((resolve) => {
    const server = net.createServer();
    let settled = false;
    const finish = (free) => {
      if (settled) return;
      settled = true;
      try {
        server.close();
      } catch {
        // Already closed.
      }
      resolve(free);
    };
    const timer = setTimeout(() => finish(true), timeoutMs);
    timer.unref?.();
    server.once('error', (error) => {
      clearTimeout(timer);
      finish(error?.code !== 'EADDRINUSE');
    });
    server.listen({ host, port, exclusive: true }, () => {
      clearTimeout(timer);
      finish(true);
    });
  });
}

/* ------------------------------------------------------------------ */
/* version parsing                                                    */
/* ------------------------------------------------------------------ */

export function compareVersions(left, right) {
  const parse = (value) => String(value ?? '').split('.').map((part) => Number.parseInt(part, 10) || 0);
  const a = parse(left);
  const b = parse(right);
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}

export function parseJavaMajor(versionOutput) {
  const match = /version\s+"(\d+)(?:\.(\d+))?/i.exec(String(versionOutput ?? ''));
  if (!match) return null;
  const major = Number(match[1]);
  return major === 1 && match[2] ? Number(match[2]) : major;
}

export function parseComposeMajor(versionOutput) {
  const match = /version\s+v?(\d+)\.(\d+)/i.exec(String(versionOutput ?? ''));
  return match ? Number(match[1]) : null;
}

/* ------------------------------------------------------------------ */
/* doctor                                                             */
/* ------------------------------------------------------------------ */

export async function doctor(deps) {
  const { root, env, run, probePort: probe, fs: fsImpl, log } = deps;
  const nodeVersion = deps.nodeVersion ?? process.versions.node;
  const checks = [];
  const add = (check) => checks.push(check);

  const nodeOk = compareVersions(nodeVersion, REQUIRED_NODE_VERSION) >= 0;
  add({
    label: 'Node',
    status: nodeOk ? 'PASS' : 'FAIL',
    detail: `v${nodeVersion} (required >= ${REQUIRED_NODE_VERSION}, the repo CI setup-node version)`,
    remedy: nodeOk ? null : `Install Node ${REQUIRED_NODE_VERSION} or newer (nvm/fnm/Volta).`,
  });

  const java = run('java', ['-version'], { timeout: 20_000 });
  const javaMajor = parseJavaMajor(`${java.stdout}\n${java.stderr}`);
  if (java.code !== 0 || javaMajor === null) {
    add({
      label: 'Java',
      status: 'FAIL',
      detail: 'java -version did not report a version',
      remedy: `Install JDK ${REQUIRED_JAVA_MAJOR} (java-services/pom.xml targets ${REQUIRED_JAVA_MAJOR}).`,
    });
  } else {
    const javaOk = javaMajor >= REQUIRED_JAVA_MAJOR;
    add({
      label: 'Java',
      status: javaOk ? 'PASS' : 'FAIL',
      detail: `Java ${javaMajor} (required >= ${REQUIRED_JAVA_MAJOR} per java-services/pom.xml)`,
      remedy: javaOk ? null : `Install JDK ${REQUIRED_JAVA_MAJOR} and put it first on PATH (JAVA_HOME).`,
    });
  }

  // The Docker Desktop shim can take ~10s to answer while it restarts, so the
  // probes below are patient instead of reporting a false hard failure.
  const dockerCli = run('docker', ['--version'], { timeout: 60_000 });
  const cliOk = dockerCli.code === 0;
  add({
    label: 'Docker CLI',
    status: cliOk ? 'PASS' : 'FAIL',
    detail: cliOk
      ? dockerCli.stdout.trim() || 'docker --version reported success'
      : `docker --version failed${dockerCli.error ? ` (${dockerCli.error.code ?? 'spawn error'})` : ''}; Docker is not installed, not on PATH, or not responding`,
    remedy: cliOk ? null : 'Install Docker Desktop (Windows/macOS) or Docker Engine (Linux), then reopen the shell.',
  });

  let composeOk = false;
  if (cliOk) {
    const compose = run('docker', ['compose', 'version'], { timeout: 60_000 });
    const composeMajor = parseComposeMajor(`${compose.stdout}\n${compose.stderr}`);
    composeOk = compose.code === 0 && composeMajor !== null && composeMajor >= REQUIRED_COMPOSE_MAJOR;
    add({
      label: 'Compose v2',
      status: composeOk ? 'PASS' : 'FAIL',
      detail: composeOk
        ? (compose.stdout.trim() || `Compose v${composeMajor}`)
        : `docker compose version failed or reports Compose v${composeMajor ?? '?'} (requires v2+)`,
      remedy: composeOk ? null : 'Update Docker Desktop or install the Docker Compose v2 plugin. Use "docker compose", not docker-compose.',
    });
  } else {
    add({ label: 'Compose v2', status: 'FAIL', detail: 'skipped because the Docker CLI is unavailable', remedy: 'Install Docker Desktop or the Compose v2 plugin.' });
  }

  let engineOk = false;
  if (cliOk) {
    // Docker Desktop often answers "engine unreachable" for a few seconds while
    // it starts; give it three bounded attempts before calling the engine down.
    const sleep = deps.sleep ?? defaultSleep;
    let info = null;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      info = run('docker', ['info', '--format', '{{.ServerVersion}}'], { timeout: 60_000 });
      if (info.code === 0 || attempt === 3) break;
      await sleep(2_000);
    }
    engineOk = info.code === 0;
    const firstError = (info.stderr || info.stdout).trim().split(/\r?\n/).find(Boolean) ?? '';
    const reason = info.error ? (info.error.code ?? 'spawn error') : firstError.slice(0, 160);
    add({
      label: 'Docker engine',
      status: engineOk ? 'PASS' : 'FAIL',
      detail: engineOk ? `engine ${info.stdout.trim()}` : `engine unreachable${reason ? `: ${reason}` : ''}`,
      remedy: engineOk ? null : 'Start Docker Desktop or dockerd, wait for it to be ready, then rerun doctor.',
    });
  } else {
    add({ label: 'Docker engine', status: 'FAIL', detail: 'skipped because the Docker CLI is unavailable', remedy: 'Start Docker Desktop or dockerd after installing the CLI.' });
  }

  const envExists = fsImpl.existsSync(path.join(root, '.env'));
  add({
    label: '.env',
    status: envExists ? 'PASS' : 'WARN',
    detail: envExists ? '.env present (its contents are not read here)' : '.env is missing',
    remedy: envExists ? null : 'Run "node scripts/local-dev.mjs up" to copy .env.example to .env (it never overwrites an existing file).',
  });

  let owners = new Map();
  if (engineOk) {
    const ps = run('docker', [
      'ps',
      '--format',
      '{{.Names}}\t{{.Ports}}\t{{.Label "com.docker.compose.project"}}\t{{.Label "com.docker.compose.service"}}',
    ], { timeout: 60_000 });
    if (ps.code === 0) owners = parseDockerPsOwners(ps.stdout);
  }

  const busy = [];
  for (const binding of HOST_PORT_BINDINGS) {
    const port = effectiveHostPort(env, binding.variable, binding.port);
    const free = await probe(port);
    if (free) {
      add({ label: `port ${port}`, status: 'PASS', detail: `127.0.0.1:${port} free (${binding.service})`, remedy: null });
      continue;
    }
    const owner = owners.get(port) ?? null;
    const advice = portConflictAdvice({ ...binding, port }, owner);
    busy.push(advice);
    const running = owner?.includes(`project ${DEFAULT_PROJECT_NAME}`) ?? false;
    add({
      label: `port ${port}`,
      status: 'WARN',
      detail: `127.0.0.1:${port} busy${owner ? ` - ${owner}` : ' - held by a non-Docker process'}`,
      remedy: running
        ? `your stack may already be running (use "status"); or ${formatPortAdvice(advice)}`
        : formatPortAdvice(advice),
    });
  }

  const failures = checks.filter((check) => check.status === 'FAIL');
  const warnings = checks.filter((check) => check.status === 'WARN');
  const lines = formatDoctorLines(checks);
  lines.push('');
  if (failures.length > 0) {
    lines.push(`local-dev doctor: FAIL (${failures.length} hard requirement(s) missing${warnings.length ? `, ${warnings.length} warning(s)` : ''})`);
  } else if (warnings.length > 0) {
    lines.push(`local-dev doctor: PASS (${warnings.length} warning(s); busy ports are not blocking, see remedies above)`);
  } else {
    lines.push('local-dev doctor: PASS');
  }
  log(lines.join('\n'));
  return failures.length > 0 ? 1 : 0;
}

/* ------------------------------------------------------------------ */
/* compose helpers                                                    */
/* ------------------------------------------------------------------ */

function readComposeSources(root, fsImpl, files) {
  return files.map((file) => fsImpl.readFileSync(path.join(root, file), 'utf8'));
}

function publishedPort(deps, composePrefix, service, containerPort, fallback) {
  const result = deps.run('docker', [...composePrefix, 'port', service, String(containerPort)], {
    cwd: deps.root,
    timeout: 60_000,
  });
  if (result.code !== 0) return fallback;
  const firstLine = result.stdout.trim().split(/\r?\n/)[0] ?? '';
  const match = /:(\d+)\s*$/.exec(firstLine);
  return match ? Number(match[1]) : fallback;
}

function healthProbes({ apiPort, webPort }) {
  return [
    { name: 'API liveness', url: `http://127.0.0.1:${apiPort}/api/v1/health/liveness`, accept: ({ status }) => status === 200 },
    { name: 'web', url: `http://127.0.0.1:${webPort}/`, accept: ({ status }) => status < 500 },
  ];
}

async function resolveStack({ flags, deps }) {
  const files = selectComposeFiles({ mobile: flags.mobile });
  for (const file of files) {
    if (!deps.fs.existsSync(path.join(deps.root, file))) throw new Error(`Missing compose file: ${file}`);
  }
  const sources = readComposeSources(deps.root, deps.fs, files);
  const project = resolveProjectName({ explicit: flags.project, sources });
  return { files, project, prefix: composeArgs({ project, files }) };
}

/* ------------------------------------------------------------------ */
/* commands                                                           */
/* ------------------------------------------------------------------ */

async function up(flags, deps) {
  const { root, log, errorLog } = deps;
  ensureEnvFile({ root, fs: deps.fs, log });
  const { files, project, prefix } = await resolveStack({ flags, deps });
  const mobileRecipe = flags.mobile ? readMobileRecipe({ root, fs: deps.fs }) : null;

  const args = buildUpArgs({ project, files, build: flags.build });
  log(`docker ${args.join(' ')}`);
  const result = deps.run('docker', args, { cwd: root });
  if (result.code !== 0) {
    errorLog(`docker compose up failed (exit ${result.code})`);
    const tail = (result.stderr || result.stdout || '').trim().split(/\r?\n/).slice(-20).join('\n');
    if (tail) errorLog(tail);
    return 1;
  }

  const webFallback = effectiveHostPort(deps.env, 'FRONTEND_HOST_PORT', 3000);
  const apiFallback = effectiveHostPort(deps.env, 'RESTFUL_API_HOST_PORT', 4010);
  const mailpitFallback = effectiveHostPort(deps.env, 'MAILPIT_UI_HOST_PORT', 8025);
  const webPort = publishedPort(deps, prefix, 'web', 3000, webFallback);
  const apiPort = publishedPort(deps, prefix, 'restful-api', 4010, apiFallback);
  const mailpitUiPort = publishedPort(deps, prefix, 'mailpit', 8025, mailpitFallback);

  log('waiting for the stack to become healthy ...');
  let healthy = true;
  try {
    await pollHealth({
      probes: healthProbes({ apiPort, webPort }),
      timeoutMs: HEALTH_TIMEOUT_MS,
      intervalMs: HEALTH_INTERVAL_MS,
      fetch: deps.fetch,
      sleep: deps.sleep,
      now: deps.now,
      log,
    });
  } catch (error) {
    healthy = false;
    errorLog(`health check failed: ${error.message}`);
    errorLog('Inspect the stack with: node scripts/local-dev.mjs status');
    errorLog('Follow logs with:      node scripts/local-dev.mjs logs restful-api');
  }

  log('');
  log(formatUrlTable({ webPort, apiPort, mailpitUiPort, mobileRecipe }));
  return healthy ? 0 : 1;
}

async function status(flags, deps) {
  const { root, log, errorLog } = deps;
  const { prefix } = await resolveStack({ flags, deps });
  const ps = deps.run('docker', [...prefix, 'ps', '--format', 'json'], { cwd: root, timeout: 60_000 });
  if (ps.code !== 0) {
    errorLog(`docker compose ps failed (exit ${ps.code})`);
    const tail = (ps.stderr || ps.stdout || '').trim().split(/\r?\n/).slice(-20).join('\n');
    if (tail) errorLog(tail);
    return 1;
  }

  log('Compose services');
  log(formatStatusTable(parseComposePs(ps.stdout)));

  const webPort = publishedPort(deps, prefix, 'web', 3000, effectiveHostPort(deps.env, 'FRONTEND_HOST_PORT', 3000));
  const apiPort = publishedPort(deps, prefix, 'restful-api', 4010, effectiveHostPort(deps.env, 'RESTFUL_API_HOST_PORT', 4010));
  const results = await Promise.all(healthProbes({ apiPort, webPort }).map((probe) => probeHttp(deps.fetch, probe)));
  log('');
  log('Health');
  for (const result of results) {
    const detail = result.status ? `HTTP ${result.status}` : (result.error ?? 'no response');
    log(`  ${result.ok ? 'PASS' : 'FAIL'}  ${result.name}  ${result.url}  ${detail}`);
  }
  return 0;
}

async function logs(flags, deps, service) {
  const { root } = deps;
  const { files, project } = await resolveStack({ flags, deps });
  const args = buildLogsArgs({ project, files, service });
  const result = deps.run('docker', args, { cwd: root, stdio: 'inherit' });
  return result.code === 0 ? 0 : (result.code ?? 1);
}

async function down(flags, deps) {
  const { root, log } = deps;
  const { files, project } = await resolveStack({ flags, deps });
  if (flags.volumes) {
    log('WARNING: --volumes deletes the named volumes, including the local Postgres database data.');
  }
  const args = buildDownArgs({ project, files, volumes: flags.volumes });
  log(`docker ${args.join(' ')}`);
  const result = deps.run('docker', args, { cwd: root });
  if (result.code !== 0) {
    deps.errorLog(`docker compose down failed (exit ${result.code})`);
    const tail = (result.stderr || result.stdout || '').trim().split(/\r?\n/).slice(-20).join('\n');
    if (tail) deps.errorLog(tail);
    return 1;
  }
  log(flags.volumes ? 'stack stopped and volumes removed' : 'stack stopped; volumes kept');
  return 0;
}

/* ------------------------------------------------------------------ */
/* entry point                                                        */
/* ------------------------------------------------------------------ */

export async function main(argv = process.argv.slice(2), overrides = {}) {
  const deps = {
    root: REPO_ROOT,
    env: process.env,
    fs,
    run: createRunner({ cwd: REPO_ROOT }),
    probePort,
    fetch: (...args) => globalThis.fetch(...args),
    sleep: defaultSleep,
    now: Date.now,
    nodeVersion: process.versions.node,
    log: (message) => console.log(message),
    errorLog: (message) => console.error(message),
    ...overrides,
  };

  let parsed;
  try {
    parsed = parseArgs(argv);
  } catch (error) {
    if (error instanceof UsageError) {
      deps.errorLog(`local-dev: ${error.message}`);
      deps.errorLog('');
      deps.errorLog(USAGE);
      return 2;
    }
    throw error;
  }

  if (parsed.help || parsed.command === 'help') {
    deps.log(USAGE);
    return 0;
  }

  try {
    switch (parsed.command) {
      case 'doctor':
        return await doctor(deps);
      case 'up':
        return await up(parsed.flags, deps);
      case 'status':
        return await status(parsed.flags, deps);
      case 'logs':
        return await logs(parsed.flags, deps, parsed.service);
      case 'down':
        return await down(parsed.flags, deps);
      default:
        deps.errorLog(`local-dev: Unknown command: ${parsed.command}`);
        return 2;
    }
  } catch (error) {
    deps.errorLog(`local-dev: ${error?.message || String(error)}`);
    return 1;
  }
}

const invoked = process.argv[1];
const isMain = Boolean(invoked) && pathToFileURL(path.resolve(invoked)).href === import.meta.url;
if (isMain) {
  main()
    .then((code) => {
      if (code) process.exitCode = code;
    })
    .catch((error) => {
      console.error(`local-dev: ${error?.stack || error?.message || String(error)}`);
      process.exitCode = 1;
    });
}
