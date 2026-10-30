#!/usr/bin/env node
// Static structural snapshots (token/layout tree), NOT pixel screenshots.
// Device captures are BLOCKED_CAPABILITY without a real device + capture tool.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const mobileDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : dflt; };

if (args.includes('--help')) {
  console.log(`visual-regression.mjs
  --platform static|android|ios   static = jest structural snapshots (default)
  --fixture synthetic             synthetic fixtures only, no real data
  --baseline compare|update       compare fails on snapshot diff; update writes baselines
NOTE: snapshots are normalized style/role trees, not pixel captures.`);
  process.exit(0);
}
const platform = opt('platform', 'static');
const baseline = opt('baseline', 'compare');
if (platform !== 'static') {
  console.log(`BLOCKED_CAPABILITY: device screenshot capture for platform "${platform}" requires a connected device and capture tooling (not available in this environment).`);
  process.exit(3);
}
const env = { ...process.env, ...(baseline === 'compare' ? { CI: '1' } : {}) };
const jestArgs = ['--config', 'jest.config.js', 'tests/visual', ...(baseline === 'update' ? ['-u'] : [])];
const r = spawnSync('npx', ['jest', ...jestArgs], { cwd: mobileDir, env, stdio: 'inherit', shell: true });
process.exit(r.status ?? 1);
