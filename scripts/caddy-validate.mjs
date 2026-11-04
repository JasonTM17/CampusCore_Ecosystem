#!/usr/bin/env node
// Validates ops/caddy/Caddyfile inside the repo's pinned Caddy Docker image.
// Ensures Caddy configuration syntax, directives, and environment substitution
// are validated against the actual Caddy release without deploying an edge host.
//
// Usage:
//   node scripts/caddy-validate.mjs [--caddyfile <path>] [--image <tag>] [--timeout <ms>]
//
// Exit codes:
//   0 PASS: Caddyfile is valid
//   1 FAIL: Caddyfile has syntax or directive errors
//   2 USAGE: Invalid arguments
//   4 BLOCKED: Docker daemon is unavailable or not running

import { existsSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const DEFAULT_CADDY_IMAGE = 'caddy:2.10.2-alpine';
export const DEFAULT_CONTAINER_NAME = 'campuscore-caddy-validate';
export const DEFAULT_TIMEOUT_MS = 30_000;
export const DEFAULT_PLACEHOLDERS = Object.freeze({
  ACME_EMAIL: 'validate@campuscore.local',
  CAMPUSCORE_DOMAIN: 'campuscore.local',
});

export const EXIT_CODES = Object.freeze({
  PASS: 0,
  FAIL: 1,
  USAGE: 2,
  BLOCKED: 4,
  TIMEOUT: 124,
});

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAX_BUFFER = 16 * 1024 * 1024;

export function defaultExecutor(cmd, argv, opts = {}) {
  const timeout = opts.timeout ?? DEFAULT_TIMEOUT_MS;
  const res = spawnSync(cmd, argv, {
    cwd: opts.cwd || repoRoot,
    encoding: 'utf8',
    maxBuffer: MAX_BUFFER,
    env: opts.env || process.env,
    timeout,
  });

  if (res.error) {
    const isTimeout = res.error.code === 'ETIMEDOUT' || res.signal === 'SIGTERM';
    return {
      ok: false,
      status: res.status ?? (isTimeout ? EXIT_CODES.TIMEOUT : -1),
      stdout: res.stdout || '',
      stderr: res.stderr || '',
      error: res.error,
      timedOut: isTimeout,
    };
  }

  return {
    ok: res.status === 0,
    status: res.status,
    stdout: res.stdout || '',
    stderr: res.stderr || '',
    error: null,
    timedOut: false,
  };
}

export function parseArgs(argv = []) {
  const args = {
    caddyfile: null,
    image: null,
    containerName: null,
    timeoutMs: null,
    env: {},
  };

  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--caddyfile') args.caddyfile = argv[++i];
    else if (a === '--image') args.image = argv[++i];
    else if (a === '--container-name') args.containerName = argv[++i];
    else if (a === '--timeout') args.timeoutMs = Number.parseInt(argv[++i], 10);
    else if (a === '--domain') args.env.CAMPUSCORE_DOMAIN = argv[++i];
    else if (a === '--email') args.env.ACME_EMAIL = argv[++i];
    else if (a === '-h' || a === '--help') {
      args.help = true;
    } else {
      throw new Error(`Unknown option: ${a}`);
    }
  }

  return args;
}

export function buildDockerArgs({
  caddyfilePath,
  image = DEFAULT_CADDY_IMAGE,
  containerName = DEFAULT_CONTAINER_NAME,
  env = {},
}) {
  const acmeEmail = env.ACME_EMAIL ?? DEFAULT_PLACEHOLDERS.ACME_EMAIL;
  const domain = env.CAMPUSCORE_DOMAIN ?? DEFAULT_PLACEHOLDERS.CAMPUSCORE_DOMAIN;
  const normalizedPath = caddyfilePath.replace(/\\/g, '/');

  return [
    'run',
    '--rm',
    '--name',
    containerName,
    '-v',
    `${normalizedPath}:/etc/caddy/Caddyfile:ro`,
    '-e',
    `ACME_EMAIL=${acmeEmail}`,
    '-e',
    `CAMPUSCORE_DOMAIN=${domain}`,
    image,
    'caddy',
    'validate',
    '--config',
    '/etc/caddy/Caddyfile',
    '--adapter',
    'caddyfile',
  ];
}

export function checkDockerAvailable(executor = defaultExecutor) {
  const result = executor('docker', ['info']);
  if (!result.ok || result.status !== 0) {
    const detail = (result.stderr || result.stdout || result.error?.message || '').trim();
    return {
      available: false,
      error: detail || 'docker info failed with non-zero exit status',
    };
  }
  return { available: true };
}

export function verifyContainerGone(containerName, executor = defaultExecutor) {
  const check = executor('docker', ['ps', '-a', '-q', '--filter', `name=${containerName}`]);
  const existing = (check.stdout || '').trim();
  if (existing.length === 0) {
    return true;
  }

  // Attempt forceful removal if still present
  executor('docker', ['rm', '-f', containerName]);

  const recheck = executor('docker', ['ps', '-a', '-q', '--filter', `name=${containerName}`]);
  const stillExisting = (recheck.stdout || '').trim();
  if (stillExisting.length > 0) {
    throw new Error(`Container ${containerName} is still present after cleanup`);
  }
  return true;
}

export async function runCaddyValidate(options = {}, executor = defaultExecutor) {
  const targetRepoRoot = options.repoRoot || repoRoot;
  const targetCaddyfile = options.caddyfile
    ? path.resolve(targetRepoRoot, options.caddyfile)
    : path.join(targetRepoRoot, 'ops', 'caddy', 'Caddyfile');

  if (!existsSync(targetCaddyfile)) {
    return {
      ok: false,
      status: 'FAIL',
      code: EXIT_CODES.FAIL,
      output: `Caddyfile not found: ${targetCaddyfile}`,
      containerProvenGone: true,
    };
  }

  const image = options.image || process.env.CADDY_IMAGE || DEFAULT_CADDY_IMAGE;
  const containerName = options.containerName || DEFAULT_CONTAINER_NAME;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const env = {
    ACME_EMAIL: options.env?.ACME_EMAIL || process.env.ACME_EMAIL || DEFAULT_PLACEHOLDERS.ACME_EMAIL,
    CAMPUSCORE_DOMAIN: options.env?.CAMPUSCORE_DOMAIN || process.env.CAMPUSCORE_DOMAIN || DEFAULT_PLACEHOLDERS.CAMPUSCORE_DOMAIN,
  };

  // Step 1: Check Docker reachability
  const dockerCheck = checkDockerAvailable(executor);
  if (!dockerCheck.available) {
    return {
      ok: false,
      status: 'BLOCKED',
      code: EXIT_CODES.BLOCKED,
      reason: 'Docker is not reachable or not running (BLOCKED_CAPABILITY)',
      output: dockerCheck.error,
      containerProvenGone: true,
    };
  }

  // Step 2: Clean up any stale container of the same name before starting
  try {
    executor('docker', ['rm', '-f', containerName]);
  } catch {
    // Best-effort cleanup
  }

  // Step 3: Run validation inside pinned container
  const argv = buildDockerArgs({
    caddyfilePath: targetCaddyfile,
    image,
    containerName,
    env,
  });

  let runResult;
  try {
    runResult = executor('docker', argv, { timeout: timeoutMs });
  } catch (err) {
    runResult = {
      ok: false,
      status: -1,
      stdout: '',
      stderr: err.message || String(err),
      error: err,
      timedOut: false,
    };
  }

  // Step 4: Prove container is gone
  let containerProvenGone = false;
  try {
    containerProvenGone = verifyContainerGone(containerName, executor);
  } catch (cleanupErr) {
    containerProvenGone = false;
  }

  // Step 5: Format result
  if (runResult.timedOut || runResult.error?.code === 'ETIMEDOUT') {
    return {
      ok: false,
      status: 'TIMEOUT',
      code: EXIT_CODES.FAIL,
      output: `caddy validate timed out after ${timeoutMs}ms`,
      containerProvenGone,
    };
  }

  if (runResult.ok && runResult.status === 0) {
    if (!containerProvenGone) {
      return {
        ok: false,
        status: 'FAIL',
        code: EXIT_CODES.FAIL,
        output: `caddy validate passed but container ${containerName} could not be proven removed`,
        containerProvenGone,
      };
    }
    return {
      ok: true,
      status: 'PASS',
      code: EXIT_CODES.PASS,
      output: (runResult.stdout || runResult.stderr || 'Valid configuration').trim(),
      containerProvenGone,
    };
  }

  const output = `${runResult.stdout || ''}\n${runResult.stderr || ''}`.trim();
  return {
    ok: false,
    status: 'FAIL',
    code: EXIT_CODES.FAIL,
    output: output || `caddy validate exited with status ${runResult.status}`,
    containerProvenGone,
  };
}

export async function main(argv = process.argv.slice(2)) {
  let parsed;
  try {
    parsed = parseArgs(argv);
  } catch (err) {
    console.error(`USAGE_FAIL ${err.message}`);
    process.exit(EXIT_CODES.USAGE);
  }

  if (parsed.help) {
    console.log(`Usage: node scripts/caddy-validate.mjs [--caddyfile <path>] [--image <tag>] [--timeout <ms>] [--domain <domain>] [--email <email>]`);
    process.exit(EXIT_CODES.PASS);
  }

  const result = await runCaddyValidate(parsed);

  if (result.status === 'PASS') {
    console.log(`PASS: caddy validate succeeded\n${result.output}`);
    process.exit(EXIT_CODES.PASS);
  }

  if (result.status === 'BLOCKED') {
    console.error(`BLOCKED: ${result.reason}\n${result.output}`);
    process.exit(EXIT_CODES.BLOCKED);
  }

  console.error(`FAIL: caddy validate failed (${result.status})\n${result.output}`);
  process.exit(result.code ?? EXIT_CODES.FAIL);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((err) => {
    console.error(`UNCAUGHT: ${err.message}`);
    process.exit(EXIT_CODES.FAIL);
  });
}
