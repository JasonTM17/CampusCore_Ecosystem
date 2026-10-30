#!/usr/bin/env node
/** Capped synthetic GET workload. No dependencies, credentials, or env-file reads. */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

export const LIMITS = Object.freeze({ concurrency: 50, durationSeconds: 300 });
const scenarios = Object.freeze({
  'mixed-academic': [
    { routeClass: 'academic-catalogue', route: '/api/v1/sections' },
    { routeClass: 'library-catalogue', route: '/api/v1/library/catalogue' },
    { routeClass: 'events-catalogue', route: '/api/v1/events' },
    { routeClass: 'careers-catalogue', route: '/api/v1/careers/opportunities' },
  ],
});

export function parseLoadArgs(args) {
  const required = ['--base-url', '--scenario', '--fixture', '--concurrency', '--duration-seconds', '--out'];
  const allowed = [...required, '--invariant-hook'];
  const values = {};
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (!allowed.includes(key) || Object.hasOwn(values, key)) throw new Error('Unknown or duplicate load option');
    const value = args[++i];
    if (!value?.trim() || value.startsWith('--')) throw new Error('Missing load option value');
    values[key] = value;
  }
  if (required.some((key) => !Object.hasOwn(values, key))) throw new Error('All load options are required; see --help');
  // Check literal authority too: URL normalizes alternate numeric IP forms.
  const rawUrl = values['--base-url'];
  if (/\s/.test(rawUrl) || !/^https?:\/\/(?:localhost|127\.0\.0\.1)(?::[0-9]+)?\/?$/.test(rawUrl)) throw new Error('Base URL must be an explicit localhost or 127.0.0.1 HTTP(S) origin');
  let url;
  try { url = new URL(rawUrl); } catch { throw new Error('Invalid base URL'); }
  if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.username || url.password || url.search || url.hash || url.pathname !== '/' || url.port === '0') throw new Error('Invalid loopback origin');
  // Pin localhost to literal loopback; no DNS lookup can escape it.
  url.hostname = '127.0.0.1';
  const positiveInteger = (key, maximum) => {
    const value = values[key];
    if (!/^[1-9][0-9]*$/.test(value) || /\s/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) > maximum) throw new Error('Concurrency or duration exceeds positive-integer limits');
    return Number(value);
  };
  if (!Object.hasOwn(scenarios, values['--scenario'])) throw new Error('Unknown workload scenario');
  if (values['--fixture'] !== 'synthetic') throw new Error('Only synthetic fixtures are allowed');
  if (values['--out'].includes('\0')) throw new Error('Invalid output directory');
  const invariantHook = values['--invariant-hook'];
  if (invariantHook && (path.extname(invariantHook) !== '.mjs' || invariantHook.includes('\0'))) throw new Error('Invariant hook must be a .mjs file');
  return { baseUrl: url.origin, scenario: values['--scenario'], fixture: 'synthetic',
    concurrency: positiveInteger('--concurrency', LIMITS.concurrency), durationSeconds: positiveInteger('--duration-seconds', LIMITS.durationSeconds),
    outDir: path.resolve(values['--out']), invariantHook: invariantHook ? path.resolve(invariantHook) : null };
}

// Millisecond buckets bound memory independently of achieved request rate.
function percentile(histogram, count, fraction) {
  if (!count) return null;
  const target = Math.ceil(count * fraction);
  let cumulative = 0;
  for (let i = 0; i < histogram.length; i++) {
    cumulative += histogram[i];
    if (cumulative >= target) return i;
  }
  return null;
}

export async function runLoad(config) {
  // Revalidate programmatic callers before filesystem, hooks, or fetch.
  config = parseLoadArgs(['--base-url', config.baseUrl, '--scenario', config.scenario, '--fixture', config.fixture,
    '--concurrency', String(config.concurrency), '--duration-seconds', String(config.durationSeconds), '--out', config.outDir,
    ...(config.invariantHook ? ['--invariant-hook', config.invariantHook] : [])]);
  if (config.invariantHook && !fs.statSync(config.invariantHook).isFile()) throw new Error('Invariant hook unavailable');
  // Optional synthetic-principal token from the process environment only.
  const bearerToken = process.env.ECO_LOAD_BEARER_TOKEN;
  if (bearerToken && (bearerToken.length > 16_384 || !/^[a-zA-Z0-9._~+/-]+=*$/.test(bearerToken) || /\s/.test(bearerToken))) throw new Error('Invalid synthetic bearer token');
  const headers = { 'X-CampusUTE-Fixture': 'synthetic', ...(bearerToken ? { Authorization: `Bearer ${bearerToken}` } : {}) };
  fs.mkdirSync(config.outDir, { recursive: true });
  const routes = scenarios[config.scenario];
  const stats = Object.fromEntries(routes.map(({ routeClass }) => [routeClass, { requests: 0, errors: 0, httpErrors: 0, transportErrors: 0, conflicts: 0, redirects: 0, histogram: new Uint32Array(10_001) }]));
  let nextRoute = 0;
  const start = performance.now();
  const deadline = start + config.durationSeconds * 1000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.durationSeconds * 1000);
  const worker = async () => {
    while (!controller.signal.aborted && performance.now() < deadline) {
      const { routeClass, route } = routes[nextRoute++ % routes.length];
      const bucket = stats[routeClass];
      const before = performance.now();
      let requestFailed = false;
      bucket.requests++;
      try {
        const response = await fetch(new URL(route, config.baseUrl), { method: 'GET', redirect: 'manual',
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]), headers });
        if (!response.ok) { requestFailed = true; bucket.httpErrors++; }
        if (response.status === 409) bucket.conflicts++;
        if (response.status >= 300 && response.status < 400) bucket.redirects++;
        // Stream/discard within the request deadline; never retain or log bodies.
        if (response.body) {
          const reader = response.body.getReader();
          let bytes = 0;
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              bytes += value.byteLength;
              if (bytes > 4 * 1024 * 1024) { await reader.cancel(); throw new Error('Response limit exceeded'); }
            }
          } finally { reader.releaseLock(); }
        }
      } catch { requestFailed = true; bucket.transportErrors++; }
      if (requestFailed) bucket.errors++;
      const latency = Math.min(10_000, Math.max(0, Math.ceil(performance.now() - before)));
      bucket.histogram[latency]++;
    }
  };
  try { await Promise.all(Array.from({ length: config.concurrency }, worker)); }
  finally { clearTimeout(timer); }
  const elapsedSeconds = (performance.now() - start) / 1000;
  const routeClasses = Object.fromEntries(Object.entries(stats).map(([name, bucket]) => [name, {
    requests: bucket.requests, errors: bucket.errors, httpErrors: bucket.httpErrors, transportErrors: bucket.transportErrors,
    conflicts: bucket.conflicts, redirects: bucket.redirects, requestsPerSecond: bucket.requests / elapsedSeconds,
    p50Ms: percentile(bucket.histogram, bucket.requests, 0.5), p95Ms: percentile(bucket.histogram, bucket.requests, 0.95), p99Ms: percentile(bucket.histogram, bucket.requests, 0.99),
  }]));
  let invariants = { status: 'NOT_RUN' };
  if (config.invariantHook) {
    // Lead-owned trusted code, separate from the capped fetch loop. No shell.
    const result = spawnSync(process.execPath, [config.invariantHook], { input: JSON.stringify({ baseUrl: config.baseUrl, scenario: config.scenario, fixture: config.fixture, routeClasses }),
      encoding: 'utf8', timeout: 30_000, maxBuffer: 64 * 1024 });
    try { invariants = { status: result.status === 0 && JSON.parse(result.stdout).status === 'PASS' ? 'PASS' : 'FAIL' }; }
    catch { invariants = { status: 'FAIL' }; }
  }
  const hasErrors = Object.values(routeClasses).some((route) => route.errors > 0 || route.requests === 0);
  const verdict = hasErrors || invariants.status === 'FAIL' ? 'FAIL' : invariants.status === 'PASS' ? 'PASS' : 'INCOMPLETE';
  const report = { verdict, fixture: 'synthetic', scenario: config.scenario, baseUrl: config.baseUrl, concurrency: config.concurrency,
    durationSeconds: config.durationSeconds, elapsedSeconds, checkedAt: new Date().toISOString(),
    latencyMethod: 'ceil-ms histogram; 10000ms overflow bucket; includes body consumption and failed requests', routeClasses, invariants };
  fs.writeFileSync(path.join(config.outDir, 'platform-load.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
  return verdict === 'PASS' ? 0 : verdict === 'INCOMPLETE' ? 4 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length === 3 && process.argv[2] === '--help') {
    console.log('Usage: node scripts/platform-load.mjs --base-url <http(s)://localhost:port> --scenario mixed-academic --fixture synthetic --concurrency <1..50> --duration-seconds <1..300> --out <dir> [--invariant-hook <trusted.mjs>]');
  } else {
    try { process.exitCode = await runLoad(parseLoadArgs(process.argv.slice(2))); }
    catch { console.error('REFUSED: invalid load configuration or unavailable local capability; see docs/ecosystem/capacity-baseline.md'); process.exitCode = 2; }
  }
}
