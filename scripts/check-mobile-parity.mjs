#!/usr/bin/env node
// Checks contracts/ecosystem/mobile-parity.json against the canonical web page
// tree and the native route registry: every declared native destination must
// resolve to a real screen or lane (role + flag + parameterized shape), and
// every notification producer link must agree with the declared app path.
// Run from the repo root: node scripts/check-mobile-parity.mjs [--json]
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const MODES = new Set(['NATIVE-FULL', 'NATIVE-READ', 'NATIVE-LITE', 'WEB-ONLY']);
const DECISIONS = new Set(['approved', 'approved-flag-gated']);
const HANDOFFS = new Set(['web-same-path', null]);
const EXPECTED_ROUTES = 77;

/**
 * Manifest actor → the UI role its declared native surface must accept.
 * 'STAFF' desks are granted per desk (lane role stays null); 'G'/'G/auth' rows
 * are checked by guest reachability, 'auth' rows by sign-in requirement.
 */
const ACTOR_ROLES = { S: 'student', L: 'lecturer', A: 'admin', D: 'lecturer' };

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (name === 'page.tsx') out.push(full);
  }
  return out;
}

/** Collapses the `[locale]` prefix and the legacy un-prefixed tree onto one canonical route. */
function canonicalRoute(appDir, file) {
  const rel = path.relative(appDir, path.dirname(file)).split(path.sep);
  const segs = rel.filter((s) => s !== '[locale]' && s !== '');
  return '/' + segs.join('/');
}

/** expo-router file tree → route paths (groups, layouts and not-found excluded). */
function appRoutePaths(mobileAppDir, out = new Set(), dir = mobileAppDir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      appRoutePaths(mobileAppDir, out, full);
      continue;
    }
    if (!entry.name.endsWith('.tsx')) continue;
    const rel = path.relative(mobileAppDir, full).split(path.sep);
    const parts = rel.filter((s) => !s.startsWith('(') && !s.startsWith('_') && !s.startsWith('+'));
    if (parts.length === 0) continue;
    parts[parts.length - 1] = parts[parts.length - 1].replace(/\.tsx$/, '');
    if (parts[parts.length - 1] === 'index') parts.pop();
    out.add('/' + parts.join('/'));
  }
  return out;
}

/** Parameterized equivalence: `[id]` and `[topicId]` are the same route shape. */
const routeShape = (route) =>
  route
    .split('/')
    .map((segment) => (/^\[[^\][\r\n/]+\]$/.test(segment) ? '[]' : segment))
    .join('/');

/** `[param]` segments become a concrete probe so the real resolvers can run. */
const concreteRoute = (route) =>
  route
    .split('/')
    .map((segment) => (/^\[[^\][\r\n/]+\]$/.test(segment) ? 'parity-probe' : segment))
    .join('/');

/**
 * The pure navigation modules are transpiled and really executed — the same
 * convention as mobile/tests/*.test.mjs — so lane, role and parameterized
 * checks evaluate the shipped registry instead of scanning source text.
 */
async function loadRouteModules(mobileRoot, errors) {
  let ts;
  try {
    ts = createRequire(path.join(mobileRoot, 'package.json'))('typescript');
  } catch {
    errors.push('native resolution needs mobile devDependencies — run npm ci in mobile/');
    return null;
  }
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'cu-parity-mod-'));
  try {
    const files = {
      capabilities: 'src/auth/capabilities.ts',
      'lane-flags': 'src/config/lane-flags.ts',
      routes: 'src/navigation/routes.ts',
      'route-map': 'src/navigation/route-map.ts',
      'push-routes': 'src/api/push-routes.ts',
    };
    const names = Object.keys(files);
    const specifier = new RegExp(`from '(?:\\.{1,2}/)+(?:[a-z-]+/)*(${names.join('|')})'`, 'g');
    for (const name of names) {
      const source = readFileSync(path.join(mobileRoot, files[name]), 'utf8');
      const { outputText } = ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
        fileName: `${name}.ts`,
      });
      writeFileSync(path.join(tmp, `${name}.mjs`), outputText.replaceAll(specifier, "from './$1.mjs'"));
    }
    const load = (name) => import(pathToFileURL(path.join(tmp, `${name}.mjs`)).href);
    const [routes, routeMap, laneFlags, pushRoutes] = await Promise.all(
      ['routes', 'route-map', 'lane-flags', 'push-routes'].map(load),
    );
    return { routes, routeMap, laneFlags, pushRoutes };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

export async function runParityCheck(root = scriptRoot) {
  const appDir = path.join(root, 'frontend', 'src', 'app');
  const manifestPath = path.join(root, 'contracts', 'ecosystem', 'mobile-parity.json');
  const mobileRoot = path.join(root, 'mobile');

  const errors = [];
  const webRoutes = new Set(walk(appDir).map((file) => canonicalRoute(appDir, file)));
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

  // ── Native-presence leg ──────────────────────────────────────────────
  let nativeChecked = 0;
  const modules = await loadRouteModules(mobileRoot, errors);
  if (modules !== null) {
    const {
      laneScreenForPath,
      screenForPath,
      resolveGuard,
    } = modules.routeMap;
    const {
      getScreenDefinition,
      getLaneScreen,
      canAccessLaneScreen,
      laneGroupOf,
    } = modules.routes;
    const flagGroups = new Set(Object.keys(modules.laneFlags.LANES_OFF));
    const appShapes = new Set([...appRoutePaths(path.join(mobileRoot, 'app'))].map(routeShape));

    for (const r of routes) {
      if (r.mode === 'WEB-ONLY') {
        if (r.native != null) errors.push(`${r.web}: WEB-ONLY must not declare a native destination`);
        continue;
      }
      nativeChecked += 1;
      const native = r.native;
      if (typeof native !== 'string' || native.length === 0) {
        errors.push(`${r.web}: ${r.mode} declares no native destination`);
        continue;
      }
      if (
        !native.startsWith('/') ||
        native.includes('?') ||
        native.includes('#') ||
        native.includes('\\') ||
        (native.length > 1 && native.endsWith('/')) ||
        (native !== '/' && native.split('/').slice(1).some((segment) => segment.length === 0))
      ) {
        errors.push(`${r.web}: malformed native destination ${native}`);
        continue;
      }
      const probe = concreteRoute(native);
      const lane = laneScreenForPath(probe);
      if (r.laneGated === true) {
        if (lane === null) {
          errors.push(`${r.web}: lane-gated but native ${native} resolves to no lane`);
        } else {
          const def = getLaneScreen(lane);
          if (!flagGroups.has(laneGroupOf(lane))) {
            errors.push(`${r.web}: lane ${lane} has no lane flag group`);
          }
          const wanted = ACTOR_ROLES[r.actor] ?? null;
          if (r.actor === 'STAFF' ? def.role !== null : def.role !== wanted) {
            errors.push(`${r.web}: actor ${r.actor} cannot hold lane ${lane} (role ${def.role ?? 'any'})`);
          }
          if (!canAccessLaneScreen(def.role ?? 'student', [def.capability], lane)) {
            errors.push(`${r.web}: lane ${lane} is not reachable through its own grant`);
          }
        }
      } else {
        if (lane !== null) {
          errors.push(`${r.web}: native ${native} is a flag-gated lane but the row is not lane-gated`);
        }
        const screen = probe === '/' ? null : screenForPath(probe);
        if (probe !== '/' && screen === null) {
          errors.push(`${r.web}: native ${native} resolves to no registered screen`);
        } else if (screen !== null) {
          const def = getScreenDefinition(screen);
          const wanted = ACTOR_ROLES[r.actor];
          if (wanted !== undefined && !def.roles.includes(wanted)) {
            errors.push(`${r.web}: actor ${r.actor} cannot hold screen ${screen}`);
          }
          if (r.actor === 'auth') {
            if (def.roles.length === 0) errors.push(`${r.web}: ${screen} accepts no signed-in role`);
            if (resolveGuard('signedOut', 'student', probe).action === 'allow') {
              errors.push(`${r.web}: actor auth must require sign-in on ${native}`);
            }
          }
        }
        if (r.actor === 'G' || r.actor === 'G/auth') {
          if (resolveGuard('signedOut', 'student', probe).action !== 'allow') {
            errors.push(`${r.web}: guest actor cannot reach native ${native} signed out`);
          }
        }
      }
      if (!appShapes.has(routeShape(native))) {
        errors.push(`${r.web}: native ${native} has no app route file`);
      }
    }

    // Producer-link agreement: a mapped app path must be the same surface the
    // manifest declares for that producer link's web route.
    for (const row of modules.pushRoutes.NOTIFICATION_PRODUCER_ROUTES) {
      if (row.route === null) continue;
      const manifestRow = routes.find((entry) => entry.web === row.link);
      if (!manifestRow) {
        errors.push(`producer link ${row.link} has no manifest route`);
      } else if (manifestRow.native !== row.route) {
        errors.push(
          `${row.link}: producer maps ${row.route} but the manifest declares ${manifestRow.native ?? 'no native'}`,
        );
      }
    }
  }

  const counts = {};
  for (const r of routes) counts[r.mode] = (counts[r.mode] ?? 0) + 1;
  const gated = routes.filter((r) => r.laneGated).length;

  return {
    routes: routes.length,
    web: webRoutes.size,
    counts,
    laneGated: gated,
    nativeChecked,
    errors,
  };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const result = await runParityCheck();
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`mobile-parity: ${result.routes} routes, web ${result.web}; ${Object.entries(result.counts).map(([k, v]) => `${k}=${v}`).join(' ')}; lane-gated=${result.laneGated}; native=${result.nativeChecked}`);
    for (const e of result.errors) console.error(`FAIL ${e}`);
    if (!result.errors.length) console.log('PASS check-mobile-parity');
  }
  process.exit(result.errors.length ? 1 : 0);
}
