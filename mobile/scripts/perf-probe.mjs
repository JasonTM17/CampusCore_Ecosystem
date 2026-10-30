#!/usr/bin/env node
// Static perf probe: measurement only, NO pass/fail thresholds.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const mobileDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(mobileDir, '..');
const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : dflt; };

if (args.includes('--help')) {
  console.log(`perf-probe.mjs
  --platform static           expo export + JS bundle size measurement (measurement only)
  --platform android|ios      BLOCKED_CAPABILITY (cold start/scroll need a device)
  --out <path>                JSON report (default artifacts/verification/mobile-perf/static.json)`);
  process.exit(0);
}

const platform = opt('platform', 'static');
if (platform !== 'static') {
  console.log(`BLOCKED_CAPABILITY: runtime perf (cold start, scroll fps, first-event latency) for "${platform}" requires a connected device.`);
  process.exit(3);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'perf-export-'));
try {
  const r = spawnSync('npx', ['expo', 'export', '--platform', 'android', '--output-dir', tmp], {
    cwd: mobileDir,
    env: { ...process.env, CI: '1' },
    stdio: 'inherit',
    shell: true,
    timeout: 10 * 60 * 1000,
  });
  if (r.status !== 0) {
    console.error(`expo export exited ${r.status}`);
    process.exit(r.status ?? 1);
  }
  let jsBytes = 0;
  let assets = 0;
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(hbc|js)$/.test(e.name)) jsBytes += fs.statSync(p).size;
      else assets += 1;
    }
  };
  walk(tmp);
  const report = { platform: 'static', jsBundleBytes: jsBytes, assetFiles: assets, mode: 'measurement only' };
  const out = opt('out', path.join(repoRoot, 'artifacts', 'verification', 'mobile-perf', 'static.json'));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(report, null, 2));
  console.log(`PERF jsBytes=${jsBytes} assets=${assets} (measurement only) -> ${path.relative(repoRoot, out)}`);
  process.exit(0);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
