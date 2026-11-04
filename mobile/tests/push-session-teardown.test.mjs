import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * Session-end push teardown: the device DELETE reuses the caller's pre-wipe
 * token snapshot, fails once when that snapshot is dead, and never enters the
 * refresh lane — an expired token at sign-out must not flip bootStatus or
 * resurrect a session-expiry path. client.ts is transpiled against stub
 * modules; SessionContext callbacks are extracted and run with injected deps.
 */
const mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'campus-push-teardown-'));
const MODULES = {
  'react-native': 'react-native.mjs',
  '../auth/mobile-session-store': 'mobile-session-store.mjs',
  './assistant-stream': 'assistant-stream.mjs',
  './observability': 'observability.mjs',
  './base-url': 'base-url.mjs',
};

globalThis.__DEV__ = true;

function transpile(file, fileName) {
  const source = fs.readFileSync(path.join(mobileRoot, file), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    fileName,
  });
  const rewritten = outputText.replace(/from '([^']+)'/g, (match, specifier) =>
    MODULES[specifier] ? `from './${MODULES[specifier]}'` : match);
  fs.writeFileSync(path.join(tempRoot, fileName.replace(/\.ts$/, '.mjs')), rewritten);
}

fs.writeFileSync(path.join(tempRoot, 'react-native.mjs'), "export const Platform = { OS: 'ios' };\n");
fs.writeFileSync(path.join(tempRoot, 'mobile-session-store.mjs'), `
export const storeState = { refreshCalls: 0, token: null };
export const sessionStore = {
  getAccessToken: () => storeState.token,
  setAccessToken: (token) => { storeState.token = token; },
  refreshAccessToken: async () => { storeState.refreshCalls += 1; return { accessToken: null }; },
  sessionEpoch: () => 0,
};
`);
fs.writeFileSync(path.join(tempRoot, 'assistant-stream.mjs'), 'export const createSseTransport = () => ({});\n');
transpile('src/api/observability.ts', 'observability.ts');
transpile('src/api/base-url.ts', 'base-url.ts');
transpile('src/api/client.ts', 'client.ts');
const { ApiClientError, createApiClient, campusApi } = await import(pathToFileURL(path.join(tempRoot, 'client.mjs')).href);
const { storeState } = await import(pathToFileURL(path.join(tempRoot, 'mobile-session-store.mjs')).href);

const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** Installs a scripted fetch; every call is recorded with its normalised headers. */
function installFetch(handler) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const headers = new Headers(init.headers);
    calls.push({ url: String(url), headers });
    return handler(calls[calls.length - 1], calls.length);
  };
  return { calls, restore: () => { globalThis.fetch = original; } };
}

/** Executes a SessionContext useCallback body with its imports injected. */
function callbackFactory(file, name) {
  const source = fs.readFileSync(new URL(file, import.meta.url), 'utf8');
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let callback;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name) {
      const initializer = node.initializer;
      callback = ts.isCallExpression(initializer) ? initializer.arguments[0] : initializer;
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(callback, `Production callback ${name} exists`);
  const { outputText } = ts.transpileModule(`const callback = ${callback.getText(ast)};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  });
  return (deps) => new Function(...Object.keys(deps), `${outputText}; return callback;`)(...Object.values(deps));
}

const makeExpireSession = callbackFactory('../src/session/SessionContext.tsx', 'expireSession');
const makeSignOut = callbackFactory('../src/session/SessionContext.tsx', 'signOut');

function sessionDeps(overrides = {}) {
  return {
    initialState: { kind: 'signedOut', role: 'student', accountId: null, blockedReason: null },
    foregroundRetrySafe: { current: false },
    sessionStore: {
      getAccessToken: () => 'pre-wipe-token',
      setAccessToken: () => {},
      bumpEpoch: () => {},
      signOut: async () => {},
    },
    clearQueryCache: () => {},
    selectThesisRound: () => {},
    stateRef: { current: { kind: 'authenticated' } },
    setEpoch: (update) => update(0),
    setState: () => {},
    updateBootStatus: () => {},
    scheduleDevicePushUnregister: () => {},
    ...overrides,
  };
}

test('expireSession schedules a device push unregister with the pre-wipe token', () => {
  const order = [];
  const unregisters = [];
  const expireSession = makeExpireSession(sessionDeps({
    sessionStore: {
      getAccessToken: () => { order.push('getAccessToken'); return 'pre-wipe-token'; },
      setAccessToken: () => { order.push('setAccessToken'); },
      bumpEpoch: () => {},
    },
    scheduleDevicePushUnregister: (token) => { unregisters.push(token); },
  }));

  expireSession();

  assert.deepEqual(unregisters, ['pre-wipe-token'],
    "a session that ends in place must still drop this device's registration");
  assert.ok(order.indexOf('getAccessToken') !== -1
    && order.indexOf('getAccessToken') < order.indexOf('setAccessToken'),
    'the snapshot is captured before the memory token is cleared');
});

test('manual sign-out keeps scheduling the unregister with the pre-wipe snapshot', async () => {
  const unregisters = [];
  const signOut = makeSignOut(sessionDeps({
    sessionStore: { getAccessToken: () => 'sign-out-token', signOut: async () => {} },
    scheduleDevicePushUnregister: (token) => { unregisters.push(token); },
  }));

  await signOut();

  assert.deepEqual(unregisters, ['sign-out-token']);
});

test('a snapshot-authed request keeps the supplied token and never enters the refresh lane', async () => {
  let refreshCalls = 0;
  let expired = 0;
  const client = createApiClient({
    baseUrl: 'http://api.test/api/v1',
    mode: 'live',
    getAccessToken: () => 'live-token',
    sessionEpoch: () => 7,
    refreshSession: async () => { refreshCalls += 1; return 'reauthRequired'; },
    onSessionExpired: () => { expired += 1; },
  });
  const net = installFetch(() => json(401, { message: 'expired' }));
  try {
    await assert.rejects(
      client.delete('/notifications/my/devices/install-9', {
        auth: 'snapshot',
        headers: { Authorization: 'Bearer dead-snapshot' },
      }),
      (error) => error instanceof ApiClientError && error.status === 401,
    );
    assert.equal(net.calls.length, 1, 'the dead snapshot fails once, silently');
    assert.equal(net.calls[0].headers.get('authorization'), 'Bearer dead-snapshot',
      'the caller snapshot wins over the live in-memory token');
    assert.equal(refreshCalls, 0, 'a dead snapshot must not start a session refresh');
    assert.equal(expired, 0, 'a dead snapshot must not flip a fresh session to reauthRequired');
  } finally {
    net.restore();
  }
});

test('unregisterPushDevice sends the snapshot lane for a sign-out token', async () => {
  storeState.refreshCalls = 0;
  const net = installFetch(() => json(401, { message: 'expired' }));
  try {
    await assert.rejects(
      campusApi.unregisterPushDevice('install-9', 'dead-snapshot'),
      (error) => error instanceof ApiClientError && error.status === 401,
    );
    assert.equal(net.calls.length, 1);
    assert.equal(net.calls[0].headers.get('authorization'), 'Bearer dead-snapshot');
    assert.equal(storeState.refreshCalls, 0,
      'a dead sign-out snapshot must not start a store refresh');
  } finally {
    net.restore();
  }
});

test('unregisterPushDevice without a token stays on the normal protected lane', async () => {
  storeState.refreshCalls = 0;
  storeState.token = 'live-token';
  const net = installFetch((call) =>
    call.headers.get('authorization') === 'Bearer live-token' ? new Response(null, { status: 204 }) : json(401, {}));
  try {
    await campusApi.unregisterPushDevice('install-9');
    assert.equal(net.calls.length, 1);
    assert.equal(net.calls[0].headers.get('authorization'), 'Bearer live-token');
  } finally {
    storeState.token = null;
    net.restore();
  }
});
