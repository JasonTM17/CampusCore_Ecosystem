#!/usr/bin/env node
// Checks contracts/ecosystem/mobile-parity.json against the canonical web page tree.
// Run from the repo root: node scripts/check-mobile-parity.mjs [--json]
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const appDir = path.join(root, 'frontend', 'src', 'app');
const manifestPath = path.join(root, 'contracts', 'ecosystem', 'mobile-parity.json');

const MODES = new Set(['NATIVE-FULL', 'NATIVE-READ', 'NATIVE-LITE', 'WEB-ONLY']);
const DECISIONS = new Set(['approved', 'approved-flag-gated']);
const HANDOFFS = new Set(['web-same-path', null]);
const EXPECTED_ROUTES = 77;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (name === 'page.tsx') out.push(full);
  }
  return out;
}

/** Collapses the `[locale]` prefix and the legacy un-prefixed tree onto one canonical route. */
function canonicalRoute(file) {
  const rel = path.relative(appDir, path.dirname(file)).split(path.sep);
  const segs = rel.filter((s) => s !== '[locale]' && s !== '');
  return '/' + segs.join('/');
}

const errors = [];
const webRoutes = new Set(walk(appDir).map(canonicalRoute));
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const routes = manifest.routes ?? [];

const seen = new Map();
for (const r of routes) {
  if (seen.has(r.web)) errors.push(`duplicate route ${r.web} (ids ${seen.get(r.web)}, ${r.id})`);
  seen.set(r.web, r.id);
  if (!MODES.has(r.mode)) errors.push(`${r.web}: invalid mode ${r.mode}`);
  if (!DECISIONS.has(r.decision)) errors.push(`${r.web}: missing decision`);
  if (!HANDOFFS.has(r.handoff ?? null)) errors.push(`${r.web}: hand-off outside allowlist`);
  if (r.mode !== 'NATIVE-FULL' && !r.handoff) errors.push(`${r.web}: ${r.mode} needs a hand-off`);
  if (!/^P\d{2}/.test(r.phase)) errors.push(`${r.web}: missing phase`);
}
for (const w of webRoutes) if (!seen.has(w)) errors.push(`web route ${w} has no mobile decision`);
for (const w of seen.keys()) if (!webRoutes.has(w)) errors.push(`manifest route ${w} has no web page`);
if (routes.length !== EXPECTED_ROUTES) errors.push(`expected ${EXPECTED_ROUTES} routes, manifest has ${routes.length}`);
if (webRoutes.size !== EXPECTED_ROUTES) errors.push(`expected ${EXPECTED_ROUTES} canonical web routes, found ${webRoutes.size}`);

const counts = {};
for (const r of routes) counts[r.mode] = (counts[r.mode] ?? 0) + 1;
const gated = routes.filter((r) => r.laneGated).length;

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ routes: routes.length, web: webRoutes.size, counts, laneGated: gated, errors }, null, 2));
} else {
  console.log(`mobile-parity: ${routes.length} routes, web ${webRoutes.size}; ${Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(' ')}; lane-gated=${gated}`);
  for (const e of errors) console.error(`FAIL ${e}`);
  if (!errors.length) console.log('PASS check-mobile-parity');
}
process.exit(errors.length ? 1 : 0);
