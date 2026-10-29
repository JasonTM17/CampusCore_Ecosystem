import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import { fileURLToPath, pathToFileURL } from 'node:url';

const mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(mobileRoot, 'package.json'));
const read = (relative) => fs.readFileSync(path.join(mobileRoot, relative), 'utf8');

/**
 * query-cache and SessionContext are transpiled and executed; everything
 * native (client, secure store, push adapter) is a recording stub.
 */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cu-cache-scope-'));
const url = (name) => pathToFileURL(path.join(tmp, `${name}.mjs`)).href;
const pkgJson = JSON.stringify(path.join(mobileRoot, 'package.json'));

function transpile(name, file, { jsx = false, map = {} } = {}) {
  const { outputText } = ts.transpileModule(read(file), {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      ...(jsx ? { jsx: ts.JsxEmit.ReactJSX } : {}),
    },
    fileName: file,
  });
  const rewritten = outputText
    .replace(/from (['"])([^'"]+)\1/g, (whole, quote, spec) => (map[spec] ? `from ${quote}${map[spec]}${quote}` : whole))
    .replace(/import\((['"])([^'"]+)\1\)/g, (whole, quote, spec) => (map[spec] ? `import(${quote}${map[spec]}${quote})` : whole));
  fs.writeFileSync(path.join(tmp, `${name}.mjs`), rewritten);
}

const b64url = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const jwt = (payload) => `${b64url({ alg: 'none' })}.${b64url(payload)}.sig`;

const stubs = {
  react: `import { createRequire } from 'node:module';
const R = createRequire(${pkgJson})('react');
export const { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } = R;
export default R;`,
  'jsx-runtime': `import { createRequire } from 'node:module';
const J = createRequire(${pkgJson})('react/jsx-runtime');
export const { jsx, jsxs, Fragment } = J;`,
  'react-native': `export const AppState = { addEventListener: () => ({ remove() {} }) };`,
  client: `export const apiClient = {
  mode: 'live',
  setOnSessionExpired(callback) { globalThis.__onExpired = callback; },
};
export const campusApi = { tag: 'campus-api-stub' };`,
  push: `export function unregisterPushBestEffort(api, installationId, accessToken) {
  globalThis.__pushCalls.push({ api: api.tag, installationId, accessToken });
  return globalThis.__pushBehavior ? globalThis.__pushBehavior() : undefined;
}`,
  'expo-push': `export const expoPushPlatform = {
  getInstallationId: async () => {
    if (globalThis.__installationThrows) throw new Error('INSTALLATION_ID_UNAVAILABLE');
    return 'install-1';
  },
};`,
  oidcSession: `export { decodeJwtPayload, roleFromClaims } from ${JSON.stringify(url('oidc-core'))};`,
  store: `export const sessionStore = new Proxy({}, {
  get: (_target, key) => (...args) => globalThis.__sessionStoreStub[key](...args),
});`,
};
for (const [name, source] of Object.entries(stubs)) {
  fs.writeFileSync(path.join(tmp, `stub-${name}.mjs`), source);
}

transpile('query-cache', 'src/hooks/query-cache.ts');
transpile('capabilities', 'src/auth/capabilities.ts');
transpile('oidc-core', 'src/auth/oidc-core.ts');
transpile('lane-flags', 'src/config/lane-flags.ts');
const cacheModule = await import(url('query-cache'));
const {
  clearQueryCache,
  evictQueryCache,
  isLaneQueryKey,
  queryCacheIdentity,
  queryCacheKey,
  readQueryCache,
  syncQueryCacheIdentity,
  writeQueryCache,
} = cacheModule;

function transpileSession(tag, laneModule) {
  transpile(tag, 'src/session/SessionContext.tsx', {
    jsx: true,
    map: {
      react: url('stub-react'),
      'react/jsx-runtime': url('stub-jsx-runtime'),
      'react-native': url('stub-react-native'),
      '../api/client': url('stub-client'),
      '../api/push-notifications': url('stub-push'),
      '../api/expo-push-platform': url('stub-expo-push'),
      '../auth/capabilities': url('capabilities'),
      '../auth/oidc-session': url('stub-oidcSession'),
      '../auth/mobile-session-store': url('stub-store'),
      '../config/lane-flags': url(laneModule),
      '../hooks/query-cache': url('query-cache'),
    },
  });
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
    transpileSession(tag, `${tag}-lane-flags`);
    return await import(url(tag));
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

const tick = (ms = 25) => new Promise((resolve) => setTimeout(resolve, ms));

async function withSession({ laneEnv = {}, accessToken, store = {}, push = {} }, body) {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.__pushCalls = [];
  globalThis.__pushBehavior = push.behavior;
  globalThis.__installationThrows = push.installationThrows ?? false;
  globalThis.__onExpired = undefined;
  let token = accessToken;
  globalThis.__sessionStoreStub = {
    loadBootstrap: async () => ({ refreshToken: null }),
    refreshAccessToken: async () => ({ accessToken: null }),
    getAccessToken: () => token,
    sessionEpoch: () => 0,
    signOut: store.signOut ?? (async () => { token = null; }),
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
    renderer = TestRenderer.create(React.createElement(SessionProvider, null, React.createElement(Probe)));
  });
  try {
    await body(holder, (fn) => TestRenderer.act(fn));
  } finally {
    await TestRenderer.act(async () => renderer.unmount());
    clearQueryCache();
  }
}

// --- keyspace isolation ------------------------------------------------------

test('account, locale, role and grant each get their own keyspace', () => {
  clearQueryCache();
  const base = { locale: 'vi', roleLane: 'student', grants: [] };
  const mine = queryCacheKey('acct-a', 'academic.grades', base);
  writeQueryCache(mine, { gpa: 3.2 });

  assert.deepEqual(readQueryCache(mine), { gpa: 3.2 });
  const others = [
    queryCacheKey('acct-b', 'academic.grades', base),
    queryCacheKey('acct-a', 'academic.grades', { ...base, locale: 'en' }),
    queryCacheKey('acct-a', 'academic.grades', { ...base, roleLane: 'lecturer' }),
    queryCacheKey('acct-a', 'academic.grades', { ...base, grants: ['dean.overview'] }),
    queryCacheKey(null, 'academic.grades', base),
  ];
  for (const key of others) {
    assert.notEqual(key, mine);
    assert.equal(readQueryCache(key), undefined);
  }
  assert.equal(new Set([mine, ...others]).size, others.length + 1);
});

test('filter and page are part of the key; grant order is not', () => {
  const scope = { locale: 'vi', roleLane: 'student', grants: [] };
  const keys = new Set([
    queryCacheKey('a', 'content.news', scope),
    queryCacheKey('a', 'content.news', { ...scope, filter: 'q=exam' }),
    queryCacheKey('a', 'content.news', { ...scope, filter: 'q=exam', page: 1 }),
    queryCacheKey('a', 'content.news', { ...scope, filter: 'q=exam', page: 2 }),
  ]);
  assert.equal(keys.size, 4);
  assert.equal(
    queryCacheKey('a', 'x', { grants: ['staff.libraryDesk', 'dean.overview'] }),
    queryCacheKey('a', 'x', { grants: ['dean.overview', 'staff.libraryDesk', 'dean.overview'] }),
  );
  // Keys written by callers that only pass locale and role keep their shape.
  assert.equal(queryCacheKey('a', 'x', { locale: 'vi', roleLane: 'student' }), 'a:x:scope:["vi","student"]');
  assert.equal(queryCacheKey('a', 'x'), 'a:x');
});

test('lane resources are never stored, whatever the account and grant', () => {
  clearQueryCache();
  for (const resource of ['dean.overview', 'staff.applyReview', 'admin.audit', 'lane.anything']) {
    assert.equal(isLaneQueryKey(resource), true);
    const key = queryCacheKey('acct-a', resource, { grants: ['dean.overview', 'admin.oversight'] });
    writeQueryCache(key, [{ audit: 'row' }]);
    assert.equal(readQueryCache(key), undefined, resource);
  }
  for (const resource of ['academic.grades', 'content.notifications.all', 'profile', 'adminless.value']) {
    assert.equal(isLaneQueryKey(resource), false, resource);
  }
  writeQueryCache(queryCacheKey('acct-a', 'content.news'), ['public']);
  assert.deepEqual(readQueryCache(queryCacheKey('acct-a', 'content.news')), ['public']);
});

test('the cache stays memory only', () => {
  const source = read('src/hooks/query-cache.ts');
  assert.match(source, /new Map<string, CacheEntry>\(\)/);
  assert.doesNotMatch(source, /AsyncStorage|SecureStore|FileSystem|writeAsStringAsync|setItemAsync|localStorage|require\(/);
  assert.doesNotMatch(read('src/hooks/useScreenQuery.ts'), /AsyncStorage|SecureStore|FileSystem|setItem/);
});

test('expiry and 403 drop entries', () => {
  clearQueryCache();
  const originalNow = Date.now;
  let now = 5_000;
  Date.now = () => now;
  try {
    const key = queryCacheKey('acct-a', 'academic.grades');
    writeQueryCache(key, ['x']);
    now += 1_001;
    assert.equal(readQueryCache(key, 1_000), undefined);
    assert.equal(readQueryCache(key), undefined, 'expired entry is evicted, not just hidden');
  } finally {
    Date.now = originalNow;
  }
  const denied = queryCacheKey('acct-a', 'academic.transcript');
  writeQueryCache(denied, ['x']);
  evictQueryCache(denied);
  assert.equal(readQueryCache(denied), undefined);
});

test('identity sync wipes on account switch, role change and grant revoke only', () => {
  clearQueryCache();
  const dean = queryCacheIdentity('authenticated', 'acct-a', 'lecturer', ['dean.overview']);
  syncQueryCacheIdentity(dean);
  const key = queryCacheKey('acct-a', 'academic.schedule', { grants: ['dean.overview'] });
  writeQueryCache(key, ['kept']);

  syncQueryCacheIdentity(queryCacheIdentity('authenticated', 'acct-a', 'lecturer', ['dean.overview']));
  assert.deepEqual(readQueryCache(key), ['kept'], 'same identity keeps the cache');

  syncQueryCacheIdentity(queryCacheIdentity('authenticated', 'acct-a', 'lecturer', []));
  assert.equal(readQueryCache(key), undefined, 'grant revoked');

  writeQueryCache(key, ['again']);
  syncQueryCacheIdentity(queryCacheIdentity('authenticated', 'acct-b', 'lecturer', []));
  assert.equal(readQueryCache(key), undefined, 'account switch');

  writeQueryCache(key, ['again']);
  syncQueryCacheIdentity(queryCacheIdentity('authenticated', 'acct-b', 'student', []));
  assert.equal(readQueryCache(key), undefined, 'role change');

  writeQueryCache(key, ['again']);
  syncQueryCacheIdentity(queryCacheIdentity('signedOut', null, 'student', []));
  assert.equal(readQueryCache(key), undefined, 'sign-out');
  assert.notEqual(
    queryCacheIdentity('authenticated', 'a', 'student', ['x', 'y']),
    queryCacheIdentity('authenticated', 'a', 'student', ['x']),
  );
  assert.equal(
    queryCacheIdentity('authenticated', 'a', 'student', ['y', 'x']),
    queryCacheIdentity('authenticated', 'a', 'student', ['x', 'y']),
  );
});

test('useScreenQuery keys every read by session account, locale, role and grants', () => {
  const hook = read('src/hooks/useScreenQuery.ts');
  assert.match(hook, /queryCacheKey\(session\.accountId, queryKey, \{/);
  assert.match(hook, /locale: options\.scope\?\.locale \?\? locale/);
  assert.match(hook, /roleLane: options\.scope\?\.roleLane \?\? session\.role/);
  assert.match(hook, /grants: session\.capabilities \?\? NO_CAPABILITIES/);
  assert.match(hook, /evictQueryCache\(cacheKey\)/);
  // The reload dependency list stays stable (no fetch loop from a fresh options literal).
  assert.match(hook, /\}, \[cacheKey, enabled, boundary, isCurrent, update\]\);/);
  assert.match(hook, /activeBoundaryRef\.current === boundary/);
  assert.match(hook, /boundary\.epoch === sessionStore\.sessionEpoch\(\)/);
});

// --- session lifecycle -------------------------------------------------------

test('sign-out wipes the cache even when the store throws', async () => {
  const token = jwt({ sub: 'acct-1', roles: ['STUDENT'] });
  await withSession(
    { accessToken: token, store: { signOut: async () => { throw new Error('storage failed'); } } },
    async (holder, act) => {
      await act(async () => holder.current.completeSignIn('student', 'acct-1'));
      const key = queryCacheKey('acct-1', 'academic.grades');
      writeQueryCache(key, { gpa: 4 });
      const epoch = holder.current.epoch;

      await act(async () => {
        await assert.rejects(holder.current.signOut(), /storage failed/);
      });
      assert.equal(readQueryCache(key), undefined);
      assert.equal(holder.current.kind, 'signedOut');
      assert.equal(holder.current.accountId, null);
      assert.ok(holder.current.epoch > epoch);
    },
  );
});

test('sign-out wipes the cache before a hung store call returns', async () => {
  const token = jwt({ sub: 'acct-1', roles: ['STUDENT'] });
  await withSession(
    { accessToken: token, store: { signOut: () => new Promise(() => {}) } },
    async (holder, act) => {
      await act(async () => holder.current.completeSignIn('student', 'acct-1'));
      const key = queryCacheKey('acct-1', 'academic.grades');
      writeQueryCache(key, { gpa: 4 });
      void holder.current.signOut();
      await tick();
      assert.equal(readQueryCache(key), undefined, 'local wipe does not wait for the store');
    },
  );
});

test('session expiry wipes the cache and the session', async () => {
  const token = jwt({ sub: 'acct-1', roles: ['STUDENT'] });
  await withSession({ accessToken: token }, async (holder, act) => {
    await act(async () => holder.current.completeSignIn('student', 'acct-1'));
    const key = queryCacheKey('acct-1', 'academic.grades');
    writeQueryCache(key, { gpa: 4 });
    assert.equal(typeof globalThis.__onExpired, 'function');
    await act(async () => globalThis.__onExpired());
    assert.equal(readQueryCache(key), undefined);
    assert.equal(holder.current.kind, 'signedOut');
  });
});

test('signing in as another account starts from an empty cache', async () => {
  await withSession({ accessToken: jwt({ sub: 'acct-a', roles: ['STUDENT'] }) }, async (holder, act) => {
    await act(async () => holder.current.completeSignIn('student', 'acct-a'));
    writeQueryCache(queryCacheKey('acct-a', 'academic.grades'), { gpa: 4 });
    await act(async () => holder.current.signOut());
    globalThis.__sessionStoreStub.getAccessToken = () => jwt({ sub: 'acct-b', roles: ['STUDENT'] });
    await act(async () => holder.current.completeSignIn('student', 'acct-b'));
    assert.equal(readQueryCache(queryCacheKey('acct-a', 'academic.grades')), undefined);
    assert.equal(readQueryCache(queryCacheKey('acct-b', 'academic.grades')), undefined);
  });
});

// --- F4: unregister the push installation ------------------------------------

test('sign-out unregisters the installation with the pre-wipe token, whatever the opt-in flag', async () => {
  assert.match(read('src/config/features.ts'), /PUSH_OPT_IN_ENABLED = false/, 'opt-in flag is off in this build');
  assert.doesNotMatch(read('src/session/SessionContext.tsx'), /PUSH_OPT_IN_ENABLED/);
  const token = jwt({ sub: 'acct-1', roles: ['STUDENT'] });
  await withSession({ accessToken: token }, async (holder, act) => {
    await act(async () => holder.current.completeSignIn('student', 'acct-1'));
    await act(async () => holder.current.signOut());
    await tick();
    assert.deepEqual(globalThis.__pushCalls, [
      { api: 'campus-api-stub', installationId: 'install-1', accessToken: token },
    ]);
    assert.equal(globalThis.__sessionStoreStub.getAccessToken(), null, 'store token is wiped, the snapshot survives');
  });
});

test('push unregister never delays or fails sign-out', async () => {
  const token = jwt({ sub: 'acct-1', roles: ['STUDENT'] });
  const cases = [
    { push: { behavior: () => new Promise(() => {}) } },
    { push: { behavior: () => { throw new Error('boom'); } } },
    { push: { behavior: () => Promise.reject(new Error('boom')) } },
    { push: { installationThrows: true } },
  ];
  for (const { push } of cases) {
    await withSession({ accessToken: token, push }, async (holder, act) => {
      await act(async () => holder.current.completeSignIn('student', 'acct-1'));
      await act(async () => holder.current.signOut());
      assert.equal(holder.current.kind, 'signedOut');
      await tick();
    });
  }
});

test('push unregister runs even when the store sign-out throws, and is skipped without a token', async () => {
  const token = jwt({ sub: 'acct-1', roles: ['STUDENT'] });
  await withSession(
    { accessToken: token, store: { signOut: async () => { throw new Error('storage failed'); } } },
    async (holder, act) => {
      await act(async () => holder.current.completeSignIn('student', 'acct-1'));
      await act(async () => { await assert.rejects(holder.current.signOut()); });
      await tick();
      assert.equal(globalThis.__pushCalls.length, 1);
    },
  );
  await withSession({ accessToken: null }, async (holder, act) => {
    await act(async () => holder.current.completeSignIn('student', 'acct-1'));
    await act(async () => holder.current.signOut());
    await tick();
    assert.deepEqual(globalThis.__pushCalls, []);
  });
});
