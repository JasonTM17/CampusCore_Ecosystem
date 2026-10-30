import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const { runParityCheck } = await import(
  pathToFileURL(path.join(scriptDir, 'check-mobile-parity.mjs')).href,
);

/**
 * Fixture roots mirror the repository layout: the real manifest (mutated per
 * case), one canonical web page per declared route, the real pure navigation
 * modules, and the real expo-router file tree. The route registry is executed
 * through the same transpile path the checker uses, so a declared native
 * destination is checked by resolution — role, flag and parameterized shape —
 * not by string counting.
 */
const MOBILE_SOURCES = [
  'src/auth/capabilities.ts',
  'src/config/lane-flags.ts',
  'src/navigation/routes.ts',
  'src/navigation/route-map.ts',
  'src/api/push-routes.ts',
];

function createFixture({ mutateManifest, omitAppRoutes = [] } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cu-parity-'));
  const write = (rel, content) => {
    const file = path.join(root, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  };

  const manifest = JSON.parse(
    fs.readFileSync(path.join(repoRoot, 'contracts/ecosystem/mobile-parity.json'), 'utf8'),
  );
  if (mutateManifest) mutateManifest(manifest);
  write('contracts/ecosystem/mobile-parity.json', `${JSON.stringify(manifest, null, 2)}\n`);

  // One canonical web page per manifest route keeps the web/manifest leg stable.
  for (const route of manifest.routes) {
    const segments = route.web === '/' ? '' : route.web;
    write(`frontend/src/app/[locale]${segments}/page.tsx`, 'export default function Page() {}\n');
  }

  for (const rel of MOBILE_SOURCES) {
    write(`mobile/${rel}`, fs.readFileSync(path.join(repoRoot, 'mobile', rel), 'utf8'));
  }
  write('mobile/package.json', '{"name":"mobile-fixture","private":true}\n');
  // The checker resolves TypeScript through mobile/package.json; a junction
  // reuses the real install without copying it.
  fs.symlinkSync(
    path.join(repoRoot, 'mobile', 'node_modules'),
    path.join(root, 'mobile', 'node_modules'),
    'junction',
  );

  const realAppDir = path.join(repoRoot, 'mobile', 'app');
  const copyAppTree = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      const rel = path.relative(realAppDir, full).split(path.sep).join('/');
      if (entry.isDirectory()) copyAppTree(full);
      else if (entry.name.endsWith('.tsx')) {
        write(`mobile/app/${rel}`, 'export default function Route() {}\n');
      }
    }
  };
  copyAppTree(realAppDir);
  for (const rel of omitAppRoutes) {
    fs.rmSync(path.join(root, 'mobile', 'app', rel), { force: true });
  }
  return root;
}

function withFixture(options, verify) {
  const fixture = createFixture(options);
  return Promise.resolve()
    .then(() => verify(() => runParityCheck(fixture)))
    .finally(() => fs.rmSync(fixture, { recursive: true, force: true }));
}

const mutateRoute = (web, patch) => (manifest) => {
  const route = manifest.routes.find((entry) => entry.web === web);
  assert.ok(route, `fixture route ${web} must exist`);
  Object.assign(route, patch);
};

// --- real repository ----------------------------------------------------------

test('the checked-in manifest resolves every declared native destination', async () => {
  const result = await runParityCheck(repoRoot);
  assert.deepEqual(result.errors, []);
});

// --- declared native mapping ---------------------------------------------------

test('a native mode without a declared native destination fails', () =>
  withFixture(
    { mutateManifest: (m) => { delete m.routes.find((r) => r.web === '/dashboard').native; } },
    async (run) => {
      const result = await run();
      assert.ok(
        result.errors.some((e) => e.includes('/dashboard') && /native/.test(e)),
        JSON.stringify(result.errors),
      );
    },
  ));

test('a native destination that resolves to nothing fails', () =>
  withFixture(
    { mutateManifest: mutateRoute('/dashboard', { native: '/no-such-screen' }) },
    async (run) => {
      const result = await run();
      assert.ok(
        result.errors.some((e) => e.includes('/dashboard')),
        JSON.stringify(result.errors),
      );
    },
  ));

test('a missing app route file fails even when the path is registered', () =>
  withFixture(
    { omitAppRoutes: ['(app)/thesis/[topicId].tsx'] },
    async (run) => {
      const result = await run();
      assert.ok(
        result.errors.some((e) => e.includes('/dashboard/thesis/topics/[id]')),
        JSON.stringify(result.errors),
      );
    },
  ));

// --- web-only handoff ---------------------------------------------------------

test('an intentional WEB-ONLY handoff carries no native claim and passes', () =>
  withFixture({}, async (run) => {
    const result = await run();
    assert.deepEqual(result.errors, []);
    assert.ok(result.nativeChecked < result.routes, 'WEB-ONLY rows are not native destinations');
  }));

test('a WEB-ONLY route that still declares a native destination fails', () =>
  withFixture(
    { mutateManifest: mutateRoute('/admin/users', { native: '/admin' }) },
    async (run) => {
      const result = await run();
      assert.ok(
        result.errors.some((e) => e.includes('/admin/users')),
        JSON.stringify(result.errors),
      );
    },
  ));

// --- lanes, roles, parameterized equivalence ---------------------------------

test('a flag-gated row must resolve to its lane, not a shared screen', () =>
  withFixture(
    { mutateManifest: mutateRoute('/admin/audit', { native: '/dashboard' }) },
    async (run) => {
      const result = await run();
      assert.ok(
        result.errors.some((e) => e.includes('/admin/audit')),
        JSON.stringify(result.errors),
      );
    },
  ));

test('a declared native outside the actor role fails', () =>
  withFixture(
    { mutateManifest: mutateRoute('/dashboard/lecturer', { native: '/dashboard' }) },
    async (run) => {
      const result = await run();
      // /dashboard resolves to the student home — a lecturer actor cannot hold it.
      assert.ok(
        result.errors.some((e) => e.includes('/dashboard/lecturer')),
        JSON.stringify(result.errors),
      );
    },
  ));

test('a removed lane file fails the parameterized check-in equivalence', () =>
  withFixture(
    { omitAppRoutes: ['(app)/attendance/checkin/[sessionId].tsx'] },
    async (run) => {
      const result = await run();
      assert.ok(
        result.errors.some((e) => e.includes('/attendance/checkin')),
        JSON.stringify(result.errors),
      );
    },
  ));

test('a native destination that drifts from the producer mapping fails', () =>
  withFixture(
    { mutateManifest: mutateRoute('/dashboard/transcript', { native: '/announcements' }) },
    async (run) => {
      const result = await run();
      assert.ok(
        result.errors.some((e) => e.includes('/dashboard/transcript')),
        JSON.stringify(result.errors),
      );
    },
  ));

// --- count discipline ----------------------------------------------------------

test('route count inflation still fails', () =>
  withFixture(
    { mutateManifest: (m) => { m.routes.pop(); } },
    async (run) => {
      const result = await run();
      assert.ok(
        result.errors.some((e) => /77/.test(e)),
        JSON.stringify(result.errors),
      );
    },
  ));
