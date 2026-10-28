import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import { fileURLToPath, pathToFileURL } from 'node:url';

const mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(mobileRoot, '..');
const require = createRequire(path.join(mobileRoot, 'package.json'));
const BACKSLASH = String.fromCharCode(92);

/**
 * Pure modules are transpiled and really executed. Specifiers between the
 * transpiled modules are rewritten to their temp copies; anything React- or
 * expo-bound is replaced by a hand-written stub, so no native code is loaded.
 */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cu-roles-'));
const url = (name) => pathToFileURL(path.join(tmp, `${name}.mjs`)).href;

function transpile(name, file, { jsx = false, map = {} } = {}) {
  const src = fs.readFileSync(path.join(mobileRoot, file), 'utf8');
  const { outputText } = ts.transpileModule(src, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      ...(jsx ? { jsx: ts.JsxEmit.ReactJSX } : {}),
    },
    fileName: file,
  });
  const rewritten = outputText.replace(/from (['"])([^'"]+)\1/g, (whole, quote, spec) => {
    const target = map[spec];
    return target ? `from ${quote}${target}${quote}` : whole;
  });
  fs.writeFileSync(path.join(tmp, `${name}.mjs`), rewritten);
}

for (const [name, file] of [
  ['lane-flags', 'src/config/lane-flags.ts'],
  ['features', 'src/config/features.ts'],
  ['query-cache', 'src/hooks/query-cache.ts'],
  ['capabilities', 'src/auth/capabilities.ts'],
  ['oidc-core', 'src/auth/oidc-core.ts'],
]) {
  transpile(name, file);
}
const navMap = { '../auth/capabilities': url('capabilities'), './routes': url('routes') };
transpile('routes', 'src/navigation/routes.ts', { map: navMap });
transpile('route-map', 'src/navigation/route-map.ts', { map: navMap });

const laneFlags = await import(url('lane-flags'));
const capabilities = await import(url('capabilities'));
const routes = await import(url('routes'));
const routeMap = await import(url('route-map'));
const oidcCore = await import(url('oidc-core'));
const queryCache = await import(url('query-cache'));

const { readLaneFlags, LANES_OFF, LANE_FLAGS } = laneFlags;
const {
  NO_CAPABILITIES,
  hasDeanClaim,
  normalizeDeepLink,
  resolveCapabilities,
  staffGrantsFromResponse,
} = capabilities;
const { canAccessLaneScreen, getLaneNavigation, laneScreenRegistry } = routes;
const { lanePathFor, laneScreenForPath, resolveDeepLink, resolveGuard, screenForPath } = routeMap;
const { roleFromClaims } = oidcCore;

const ALL_ON = { dean: true, staff: true, admin: true };
const ALL_GRANTS = { desks: ['applyReview', 'careersDesk', 'libraryDesk'] };

test('lane flags are off unless the build sets the exact string true', () => {
  assert.deepEqual(readLaneFlags({}), LANES_OFF);
  assert.deepEqual(LANES_OFF, { dean: false, staff: false, admin: false });
  for (const value of ['', '1', 'TRUE', 'True', 'yes', ' true', 'true ', 'false']) {
    assert.deepEqual(
      readLaneFlags({
        EXPO_PUBLIC_LANE_DEAN: value,
        EXPO_PUBLIC_LANE_STAFF: value,
        EXPO_PUBLIC_LANE_ADMIN: value,
      }),
      LANES_OFF,
      `"${value}" must not enable a lane`,
    );
  }
  assert.deepEqual(
    readLaneFlags({ EXPO_PUBLIC_LANE_DEAN: 'true', EXPO_PUBLIC_LANE_ADMIN: 'false' }),
    { dean: true, staff: false, admin: false },
  );
  // The module-level read reflects the (unset) test environment.
  assert.deepEqual(LANE_FLAGS, LANES_OFF);
  assert.ok(Object.isFrozen(LANE_FLAGS));
});

test('flags off: no lane capability for any claim or grant', () => {
  const claims = ['LECTURER', 'TRUONG_KHOA', 'ADMIN', 'SUPER_ADMIN'];
  assert.deepEqual(
    resolveCapabilities({ claims, lanes: LANES_OFF, staffGrants: ALL_GRANTS }),
    [],
  );
  for (const role of ['student', 'lecturer', 'admin']) {
    assert.deepEqual(getLaneNavigation(role, NO_CAPABILITIES), []);
  }
});

test('flags on: dean needs the faculty head claim, admin the admin claim', () => {
  assert.deepEqual(
    resolveCapabilities({ claims: ['LECTURER', 'truong_khoa'], lanes: ALL_ON }),
    ['dean.overview'],
  );
  assert.deepEqual(
    resolveCapabilities({ claims: ['ADMIN'], lanes: ALL_ON }),
    ['admin.oversight'],
  );
  assert.deepEqual(
    resolveCapabilities({ claims: ['SUPER_ADMIN'], lanes: { ...ALL_ON, admin: false } }),
    [],
  );
  assert.deepEqual(resolveCapabilities({ claims: ['STUDENT'], lanes: ALL_ON }), []);
});

test('dean is TRUONG_KHOA only; TRUONG_BO_MON follows the lecturer precedence', () => {
  assert.equal(hasDeanClaim(['TRUONG_KHOA']), true);
  assert.equal(hasDeanClaim(['TRUONG_BO_MON']), false);
  // Department head with a lecturer claim: lecturer lane, never dean.
  assert.equal(roleFromClaims(['LECTURER', 'TRUONG_BO_MON']), 'lecturer');
  assert.deepEqual(
    resolveCapabilities({ claims: ['LECTURER', 'TRUONG_BO_MON'], lanes: ALL_ON }),
    [],
  );
  // Department head alone: no lane, sign-in stays blocked as before.
  assert.equal(roleFromClaims(['TRUONG_BO_MON']), null);
  assert.equal(roleFromClaims(['TRUONG_KHOA']), null);
  // Both claims: the faculty head one grants dean on top of the lecturer lane.
  assert.equal(roleFromClaims(['LECTURER', 'TRUONG_KHOA', 'TRUONG_BO_MON']), 'lecturer');
  assert.deepEqual(
    resolveCapabilities({ claims: ['LECTURER', 'TRUONG_KHOA', 'TRUONG_BO_MON'], lanes: ALL_ON }),
    ['dean.overview'],
  );
});

test('staff desks come from server grants only, never from the admin claim', () => {
  assert.deepEqual(resolveCapabilities({ claims: ['ADMIN'], lanes: ALL_ON, staffGrants: null }), [
    'admin.oversight',
  ]);
  assert.deepEqual(
    resolveCapabilities({
      claims: ['STUDENT'],
      lanes: ALL_ON,
      staffGrants: { desks: ['libraryDesk'] },
    }),
    ['staff.libraryDesk'],
  );
  // Flag off drops the grant even though the server returned it.
  assert.deepEqual(
    resolveCapabilities({
      claims: ['STUDENT'],
      lanes: { ...ALL_ON, staff: false },
      staffGrants: ALL_GRANTS,
    }),
    [],
  );
  // A forged desk name is not a capability.
  assert.deepEqual(
    resolveCapabilities({
      claims: ['STUDENT'],
      lanes: ALL_ON,
      staffGrants: { desks: ['superDesk'] },
    }),
    [],
  );
});

test('a 403 (or any non-200) grant response is denied and opens nothing', () => {
  for (const status of [401, 403, 404, 500, 204]) {
    assert.deepEqual(
      staffGrantsFromResponse(status, { desks: ['applyReview'] }),
      { desks: [] },
      `status ${status}`,
    );
  }
  assert.deepEqual(staffGrantsFromResponse(200, null), { desks: [] });
  assert.deepEqual(staffGrantsFromResponse(200, { desks: 'applyReview' }), { desks: [] });
  assert.deepEqual(staffGrantsFromResponse(200, { desks: ['nope', 'careersDesk'] }), {
    desks: ['careersDesk'],
  });

  const denied = resolveCapabilities({
    claims: ['STUDENT'],
    lanes: ALL_ON,
    staffGrants: staffGrantsFromResponse(403, { desks: ['applyReview'] }),
  });
  assert.deepEqual(denied, []);
  assert.deepEqual(resolveGuard('authenticated', 'student', '/apply/review', denied), {
    action: 'redirect',
    to: 'dashboard.student',
    reason: 'lane-unavailable',
  });
});

test('lane routes cover exactly the lane-gated rows of the parity manifest', () => {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(repoRoot, 'contracts/ecosystem/mobile-parity.json'), 'utf8'),
  );
  assert.equal(manifest.routes.length, 74);
  const gated = manifest.routes.filter((route) => route.laneGated).map((route) => route.web).sort();
  const lanePaths = laneScreenRegistry.map((screen) => lanePathFor(screen.id)).sort();
  assert.deepEqual(lanePaths, gated);
  // Lane paths are not part of the always-on registry.
  for (const lanePath of lanePaths) {
    assert.equal(screenForPath(lanePath), null, lanePath);
    assert.ok(laneScreenForPath(lanePath), lanePath);
  }
});

test('flag off: deep links to lane routes redirect to the role home, fail closed', () => {
  const cases = [
    ['student', '/apply/review', 'dashboard.student'],
    ['student', '/library/desk?x=1', 'dashboard.student'],
    ['lecturer', '/dashboard/dean', 'lecturer.dashboard'],
    ['admin', '/admin', 'admin.dashboard'],
    ['admin', '/admin/audit/', 'admin.dashboard'],
    ['admin', '/admin/credit-limit-applications', 'admin.dashboard'],
  ];
  for (const session of ['preview', 'authenticated']) {
    for (const [role, pathname, to] of cases) {
      assert.deepEqual(
        resolveGuard(session, role, pathname),
        { action: 'redirect', to, reason: 'lane-unavailable' },
        `${session} ${role} ${pathname}`,
      );
    }
  }
  // The admin home is the web-only hand-off panel the redirect lands on.
  assert.equal(routeMap.roleHomePath('admin'), '/admin/dashboard');
  // Signed-out sessions still only reach sign-in.
  assert.deepEqual(resolveGuard('signedOut', 'admin', '/admin'), {
    action: 'redirect',
    to: 'auth.signIn',
  });
});

test('flag on with a grant: the lane route opens only for the right surface', () => {
  const dean = resolveCapabilities({ claims: ['LECTURER', 'TRUONG_KHOA'], lanes: ALL_ON });
  assert.deepEqual(resolveGuard('authenticated', 'lecturer', '/dashboard/dean', dean), {
    action: 'allow',
  });
  // Another surface, a preview pseudo-session or sign-out never inherits it.
  assert.equal(resolveGuard('authenticated', 'student', '/dashboard/dean', dean).action, 'redirect');
  assert.equal(resolveGuard('preview', 'lecturer', '/dashboard/dean', dean).action, 'redirect');
  assert.equal(resolveGuard('signedOut', 'lecturer', '/dashboard/dean', dean).action, 'redirect');

  const admin = resolveCapabilities({ claims: ['ADMIN'], lanes: ALL_ON });
  for (const pathname of ['/admin', '/admin/attendance', '/admin/events']) {
    assert.deepEqual(resolveGuard('authenticated', 'admin', pathname, admin), { action: 'allow' });
  }
  // Admin capability does not unlock staff desks or the dean overview.
  for (const pathname of ['/apply/review', '/careers/desk', '/library/desk', '/dashboard/dean']) {
    assert.equal(resolveGuard('authenticated', 'admin', pathname, admin).action, 'redirect', pathname);
  }
  // Admin oversight is not reachable from a lecturer surface (ADMIN+LECTURER).
  assert.equal(resolveGuard('authenticated', 'lecturer', '/admin', admin).action, 'redirect');

  const desk = resolveCapabilities({
    claims: ['STUDENT'],
    lanes: ALL_ON,
    staffGrants: { desks: ['careersDesk'] },
  });
  assert.deepEqual(resolveGuard('authenticated', 'student', '/careers/desk', desk), {
    action: 'allow',
  });
  assert.equal(resolveGuard('authenticated', 'student', '/library/desk', desk).action, 'redirect');
});

test('menu entries follow the capability set and nothing else', () => {
  assert.deepEqual(getLaneNavigation('admin', NO_CAPABILITIES), []);
  const admin = resolveCapabilities({ claims: ['ADMIN'], lanes: ALL_ON });
  const ids = getLaneNavigation('admin', admin).map((screen) => screen.id);
  assert.equal(ids.length, 7);
  assert.ok(ids.every((id) => id.startsWith('admin.')));
  assert.deepEqual(getLaneNavigation('lecturer', admin), []);
  assert.equal(canAccessLaneScreen('admin', admin, 'dean.overview'), false);
  assert.equal(canAccessLaneScreen('admin', admin, 'not.a.lane'), false);
});

test('the always-on registry and role homes are unchanged by the lanes', () => {
  assert.equal(routes.screenRegistry.length, 31);
  for (const role of ['student', 'lecturer', 'admin']) {
    assert.equal(routes.getBottomNavigation(role).length, 4);
  }
});

test('deep links: only app-owned, well-formed targets are opened', () => {
  assert.equal(normalizeDeepLink('campuscore://dashboard'), '/dashboard');
  assert.equal(normalizeDeepLink('campuscore://thesis/abc?source=push'), '/thesis/abc?source=push');
  assert.equal(normalizeDeepLink('/schedule/'), '/schedule');
  for (const bad of [
    '',
    'https://evil.example/dashboard',
    'javascript://x',
    'dashboard',
    '//evil.example/x',
    '/a//b',
    '/a/../admin',
    '/a/%2e%2e/admin',
    '/a/%2Fadmin',
    '/a/%5cadmin',
    `/a${BACKSLASH}b`,
    `/a${String.fromCharCode(0)}b`,
    '/a%zz',
    '/a#frag',
    `/${'x'.repeat(3000)}`,
    null,
    undefined,
  ]) {
    assert.equal(normalizeDeepLink(bad), null, String(bad).slice(0, 40));
  }
});

test('resolveDeepLink sends unknown, callback and gated links to a safe screen', () => {
  assert.deepEqual(resolveDeepLink('campuscore://grades', 'authenticated', 'student'), {
    action: 'open',
    href: '/grades',
  });
  assert.deepEqual(resolveDeepLink('campuscore://auth/callback', 'authenticated', 'student'), {
    action: 'redirect',
    href: '/sign-in',
  });
  assert.deepEqual(resolveDeepLink('campuscore://wat', 'authenticated', 'lecturer'), {
    action: 'redirect',
    href: '/lecturer/dashboard',
  });
  assert.deepEqual(resolveDeepLink('https://evil.example/grades', 'authenticated', 'student'), {
    action: 'redirect',
    href: '/dashboard',
  });
  assert.deepEqual(resolveDeepLink('campuscore://admin/audit', 'authenticated', 'admin'), {
    action: 'redirect',
    href: '/admin/dashboard',
  });
  assert.deepEqual(resolveDeepLink('campuscore://grades', 'signedOut', 'student'), {
    action: 'redirect',
    href: '/sign-in',
  });
  const admin = resolveCapabilities({ claims: ['ADMIN'], lanes: ALL_ON });
  assert.deepEqual(resolveDeepLink('campuscore://admin/audit', 'authenticated', 'admin', admin), {
    action: 'open',
    href: '/admin/audit',
  });
});

// --- sign-out wipe -----------------------------------------------------------

const b64url = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const jwt = (payload) => `${b64url({ alg: 'none' })}.${b64url(payload)}.sig`;
const pkgJson = JSON.stringify(path.join(mobileRoot, 'package.json'));

const stubs = {
  react: `import { createRequire } from 'node:module';
const R = createRequire(${pkgJson})('react');
export const { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } = R;
export default R;`,
  'jsx-runtime': `import { createRequire } from 'node:module';
const J = createRequire(${pkgJson})('react/jsx-runtime');
export const { jsx, jsxs, Fragment } = J;`,
  client: `export const apiClient = { mode: 'live', setOnSessionExpired() {} };
export const campusApi = {};`,
  push: 'export async function unregisterPushBestEffort() {}',
  oidcSession: `export { decodeJwtPayload, roleFromClaims } from ${JSON.stringify(url('oidc-core'))};`,
  // The stub module is cached, so delegate per call to the current test's store.
  store: `export const sessionStore = new Proxy({}, {
  get: (_target, key) => (...args) => globalThis.__sessionStoreStub[key](...args),
});`,
};
for (const [name, source] of Object.entries(stubs)) {
  fs.writeFileSync(path.join(tmp, `stub-${name}.mjs`), source);
}

async function mountSession(laneEnv) {
  const previous = {};
  for (const [key, value] of Object.entries(laneEnv)) {
    previous[key] = process.env[key];
    process.env[key] = value;
  }
  try {
    const tag = `session-${Math.random().toString(36).slice(2)}`;
    transpile(`${tag}-lane-flags`, 'src/config/lane-flags.ts');
    transpile(tag, 'src/session/SessionContext.tsx', {
      jsx: true,
      map: {
        react: url('stub-react'),
        'react/jsx-runtime': url('stub-jsx-runtime'),
        '../api/client': url('stub-client'),
        '../api/push-notifications': url('stub-push'),
        '../auth/capabilities': url('capabilities'),
        '../auth/oidc-session': url('stub-oidcSession'),
        '../auth/mobile-session-store': url('stub-store'),
        '../config/features': url('features'),
        '../config/lane-flags': url(`${tag}-lane-flags`),
        '../hooks/query-cache': url('query-cache'),
      },
    });
    const module = await import(url(tag));
    // Flags are read once at module load, so they are baked in by here.
    return module;
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

async function withSession(laneEnv, accessToken, signOut, body) {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.__sessionStoreStub = {
    loadBootstrap: async () => ({ refreshToken: null }),
    refreshAccessToken: async () => ({ accessToken: null }),
    getAccessToken: () => accessToken,
    signOut,
  };
  const { SessionProvider, useSession } = await mountSession(laneEnv);
  const React = require('react');
  const TestRenderer = require('react-test-renderer');
  const holder = { current: null };
  const Probe = () => {
    holder.current = useSession();
    return null;
  };
  let renderer;
  await TestRenderer.act(async () => {
    renderer = TestRenderer.create(
      React.createElement(SessionProvider, null, React.createElement(Probe)),
    );
  });
  try {
    await body(holder, (fn) => TestRenderer.act(fn));
  } finally {
    await TestRenderer.act(async () => renderer.unmount());
    queryCache.clearQueryCache();
  }
}

test('sign-out wipes the query cache and session even when the store throws', async () => {
  let calls = 0;
  const token = jwt({ sub: 'acct-1', roles: ['LECTURER', 'TRUONG_KHOA'] });
  await withSession(
    { EXPO_PUBLIC_LANE_DEAN: 'true' },
    token,
    async () => {
      calls += 1;
      throw new Error('revoke failed');
    },
    async (holder, act) => {
      await act(async () => holder.current.completeSignIn('lecturer', 'acct-1'));
      assert.equal(holder.current.kind, 'authenticated');
      assert.deepEqual(holder.current.capabilities, ['dean.overview']);
      const epochBefore = holder.current.epoch;

      queryCache.writeQueryCache('acct-1:grades', { gpa: 4 });
      assert.deepEqual(queryCache.readQueryCache('acct-1:grades'), { gpa: 4 });

      await act(async () => {
        await assert.rejects(holder.current.signOut(), /revoke failed/);
      });
      assert.equal(calls, 1);
      assert.equal(queryCache.readQueryCache('acct-1:grades'), undefined);
      assert.equal(holder.current.kind, 'signedOut');
      assert.equal(holder.current.accountId, null);
      assert.deepEqual(holder.current.capabilities, []);
      assert.ok(holder.current.epoch > epochBefore);
    },
  );
});

test('sign-in with every lane flag off grants no lane capability', async () => {
  const token = jwt({ sub: 'acct-2', roles: ['ADMIN', 'LECTURER', 'TRUONG_KHOA'] });
  await withSession({}, token, async () => undefined, async (holder, act) => {
    await act(async () => holder.current.completeSignIn('lecturer', 'acct-2'));
    assert.equal(holder.current.kind, 'authenticated');
    assert.deepEqual(holder.current.capabilities, []);

    queryCache.writeQueryCache('acct-2:schedule', [1]);
    await act(async () => holder.current.signOut());
    assert.equal(queryCache.readQueryCache('acct-2:schedule'), undefined);
    assert.equal(holder.current.kind, 'signedOut');
  });
});
