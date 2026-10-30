import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import { fileURLToPath, pathToFileURL } from 'node:url';

const mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ISSUER = 'http://10.0.2.2:4010';

// The store is a pure factory (KM-7: injectable impl) — transpile and drive
// it with in-memory KV mirrors so marker/epoch/logout semantics are really
// executed, not source-scanned.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cu-store-'));
const src = fs.readFileSync(
  path.join(mobileRoot, 'src/auth/session-store.ts'),
  'utf8',
);
const { outputText } = ts.transpileModule(src, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  fileName: 'session-store.ts',
});
fs.writeFileSync(path.join(tmp, 'session-store.mjs'), outputText);
const { createSessionStore } = await import(
  pathToFileURL(path.join(tmp, 'session-store.mjs')).href
);

function memoryKv() {
  const map = new Map();
  return {
    map,
    getItemAsync: async (k) => map.get(k) ?? null,
    setItemAsync: async (k, v) => void map.set(k, v),
    deleteItemAsync: async (k) => void map.delete(k),
    getItem: async (k) => map.get(k) ?? null,
    setItem: async (k, v) => void map.set(k, v),
    removeItem: async (k) => void map.delete(k),
  };
}

function makeStore(overrides = {}) {
  const secure = memoryKv();
  const sandbox = memoryKv();
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, body: init?.body });
    return overrides.respond
      ? overrides.respond(url, init)
      : new Response(JSON.stringify({ access_token: 'at-1', refresh_token: 'rt-2' }), { status: 200 });
  };
  let seq = 0;
  const store = createSessionStore({
    secure,
    sandbox,
    issuer: ISSUER,
    fetchImpl,
    newId: () => `install-${++seq}`,
    now: () => 1700000000000,
    ...overrides,
  });
  return { store, secure, sandbox, calls };
}

test('fresh install writes both marker layers and exposes no session', async () => {
  const { store, secure, sandbox } = makeStore();
  const boot = await store.loadBootstrap();
  assert.equal(boot.refreshToken, null);
  assert.equal(boot.wipedForReinstall, true);
  const install = JSON.parse(secure.map.get('cu.install'));
  const marker = JSON.parse(sandbox.map.get('installMarker'));
  assert.equal(install.appInstanceId, marker.appInstanceId);
  assert.ok(install.createdAt);
});

test('matching marker pair keeps the surviving refresh token', async () => {
  const { store, secure, sandbox } = makeStore();
  secure.map.set('cu.install', JSON.stringify({ appInstanceId: 'a1', createdAt: 'x' }));
  secure.map.set('cu.refresh', 'rt-keep');
  sandbox.map.set('installMarker', JSON.stringify({ appInstanceId: 'a1' }));
  const boot = await store.loadBootstrap();
  assert.equal(boot.refreshToken, 'rt-keep');
  assert.equal(boot.wipedForReinstall, false);
});

test('missing sandbox marker wipes the surviving keychain refresh (KM-1)', async () => {
  const { store, secure } = makeStore();
  secure.map.set('cu.install', JSON.stringify({ appInstanceId: 'old', createdAt: 'x' }));
  secure.map.set('cu.refresh', 'rt-stale');
  const boot = await store.loadBootstrap();
  assert.equal(boot.refreshToken, null);
  assert.equal(boot.wipedForReinstall, true);
  assert.equal(secure.map.has('cu.refresh'), false);
  assert.equal(JSON.parse(secure.map.get('cu.install')).appInstanceId, 'install-1');
});

test('mismatched marker regenerates the identity and drops the refresh', async () => {
  const { store, secure, sandbox } = makeStore();
  secure.map.set('cu.install', JSON.stringify({ appInstanceId: 'a1', createdAt: 'x' }));
  secure.map.set('cu.refresh', 'rt-stale');
  sandbox.map.set('installMarker', JSON.stringify({ appInstanceId: 'other' }));
  const boot = await store.loadBootstrap();
  assert.equal(boot.wipedForReinstall, true);
  assert.equal(secure.map.has('cu.refresh'), false);
  assert.equal(
    JSON.parse(sandbox.map.get('installMarker')).appInstanceId,
    JSON.parse(secure.map.get('cu.install')).appInstanceId,
  );
});

test('refresh grant hits the issuer host and persists the rotated token', async () => {
  const { store, secure, calls } = makeStore();
  secure.map.set('cu.refresh', 'rt-1');
  const result = await store.refreshAccessToken();
  assert.equal(result.accessToken, 'at-1');
  assert.equal(store.getAccessToken(), 'at-1');
  assert.equal(secure.map.get('cu.refresh'), 'rt-2');
  assert.equal(calls.length, 1);
  assert.ok(calls[0].url.startsWith(ISSUER + '/oauth2/token'));
  const form = new URLSearchParams(calls[0].body);
  assert.equal(form.get('grant_type'), 'refresh_token');
  assert.equal(form.get('client_id'), 'cu-mobile');
  assert.equal(form.get('refresh_token'), 'rt-1');
});

test('a failed refresh wipes the refresh token and clears memory', async () => {
  const { store, secure } = makeStore({
    respond: async () => new Response('{"error":"invalid_grant"}', { status: 400 }),
  });
  secure.map.set('cu.refresh', 'rt-dead');
  store.setAccessToken('at-old');
  const result = await store.refreshAccessToken();
  assert.equal(result.accessToken, null);
  assert.equal(secure.map.has('cu.refresh'), false);
  assert.equal(store.getAccessToken(), null);
});

test('a malformed success retains the credential without granting access', async () => {
  const { store, secure } = makeStore({
    respond: async () => new Response('{"refresh_token":"rt-2"}', { status: 200 }),
  });
  secure.map.set('cu.refresh', 'rt-1');
  const result = await store.refreshAccessToken();
  assert.equal(result.accessToken, null);
  assert.equal(secure.map.get('cu.refresh'), 'rt-1');
  assert.equal(result.kind, 'unavailable');
  assert.equal(store.getAccessToken(), null);
});

test('a late refresh resolving after sign-out never writes disk (KM-6)', async () => {
  let resolveFetch;
  const pending = new Promise((resolve) => {
    resolveFetch = resolve;
  });
  const { store, secure } = makeStore({
    respond: async (url) => url.includes('/oauth2/token')
      ? pending
      : new Response('{}', { status: 200 }),
  });
  secure.map.set('cu.refresh', 'rt-1');
  const inflight = store.refreshAccessToken();
  await store.signOut();
  resolveFetch(new Response(JSON.stringify({ access_token: 'at-late', refresh_token: 'rt-late' }), { status: 200 }));
  const result = await inflight;
  assert.equal(result.accessToken, null);
  assert.equal(secure.map.has('cu.refresh'), false);
  assert.equal(store.getAccessToken(), null);
});

test('signOut ordering: wipe disk + memory before best-effort revoke', async () => {
  const { store, secure, calls } = makeStore();
  secure.map.set('cu.refresh', 'rt-1');
  store.setAccessToken('at-1');
  await store.signOut();
  assert.equal(secure.map.has('cu.refresh'), false);
  assert.equal(store.getAccessToken(), null);
  assert.equal(calls.length, 1);
  assert.ok(calls[0].url.startsWith(ISSUER + '/oauth2/revoke'));
  const form = new URLSearchParams(calls[0].body);
  assert.equal(form.get('token'), 'rt-1');
  assert.equal(form.get('client_id'), 'cu-mobile');
});

test('signOut with no refresh skips revoke and never throws on revoke failure', async () => {
  const empty = makeStore();
  await empty.store.signOut();
  assert.equal(empty.calls.length, 0);
  const failing = makeStore({ respond: async () => { throw new Error('net down'); } });
  failing.secure.map.set('cu.refresh', 'rt-1');
  await failing.store.signOut();
  assert.equal(failing.secure.map.has('cu.refresh'), false);
});

test('post-sign-out refresh cannot resurrect the session', async () => {
  const { store, calls } = makeStore();
  store.setAccessToken('at-1');
  await store.signOut();
  const result = await store.refreshAccessToken();
  assert.equal(result.accessToken, null);
  assert.equal(calls.length, 0);
});

test('saveRefresh/clearRefresh touch only the whitelisted keys', async () => {
  const { store, secure, sandbox } = makeStore();
  await store.loadBootstrap();
  await store.saveRefresh('rt-x');
  assert.equal(secure.map.get('cu.refresh'), 'rt-x');
  await store.clearRefresh();
  assert.equal(secure.map.has('cu.refresh'), false);
  assert.deepEqual(
    [...secure.map.keys()].sort(),
    ['cu.install'],
  );
  assert.deepEqual([...sandbox.map.keys()], ['installMarker']);
});

function deferred() {
  let resolve;
  const promise = new Promise((yes) => { resolve = yes; });
  return { promise, resolve };
}

for (const [label, respond] of [
  ['rate limit', async () => new Response('{}', { status: 429 })],
  ['issuer outage', async () => new Response('{"error":"invalid_grant"}', { status: 503 })],
  ['network loss', async () => { throw new TypeError('offline'); }],
  ['client configuration', async () => new Response('{"error":"invalid_client"}', { status: 401 })],
]) {
  test(`${label} retains refresh and allows a later explicit recovery`, async () => {
    let recovered = false;
    const { store, secure, calls } = makeStore({ respond: (...args) => recovered
      ? new Response('{"access_token":"recovered","refresh_token":"rotated"}')
      : respond(...args) });
    secure.map.set('cu.refresh', 'surviving');
    store.setAccessToken('expired');
    const result = await store.refreshAccessToken();
    assert.equal(secure.map.get('cu.refresh'), 'surviving');
    assert.equal(result.kind, 'unavailable');
    assert.equal(result.accessToken, null);
    assert.equal(store.getAccessToken(), null);
    assert.equal(calls.length, 1);
    recovered = true;
    assert.equal((await store.refreshAccessToken()).accessToken, 'recovered');
  });
}

test('paused credential rotation cannot overwrite the next account', async () => {
  const entered = deferred();
  const release = deferred();
  const secure = memoryKv();
  const write = secure.setItemAsync;
  secure.setItemAsync = async (key, value) => {
    if (key === 'cu.refresh' && value === 'rt-2') {
      entered.resolve();
      await release.promise;
    }
    await write(key, value);
  };
  const { store } = makeStore({ secure });
  secure.map.set('cu.refresh', 'account-a');
  const refresh = store.refreshAccessToken();
  await entered.promise;
  const logout = store.signOut();
  store.bumpEpoch();
  const signin = store.saveRefresh('account-b').then(() => store.setAccessToken('access-b'));
  release.resolve();
  const [result] = await Promise.all([refresh, logout, signin]);
  assert.equal(result.accessToken, null);
  assert.equal(secure.map.get('cu.refresh'), 'account-b');
  assert.equal(store.getAccessToken(), 'access-b');
});

test('reinstall wipe follows a paused credential rotation', async () => {
  const entered = deferred();
  const release = deferred();
  const secure = memoryKv();
  secure.map.set('cu.refresh', 'survivor');
  const write = secure.setItemAsync;
  secure.setItemAsync = async (key, value) => {
    if (key === 'cu.refresh') { entered.resolve(); await release.promise; }
    await write(key, value);
  };
  const { store } = makeStore({ secure });
  const refresh = store.refreshAccessToken();
  await entered.promise;
  const boot = store.loadBootstrap();
  release.resolve();
  await Promise.all([refresh, boot]);
  assert.equal(secure.map.has('cu.refresh'), false);
  assert.equal(store.getAccessToken(), null);
});

for (const operation of ['getItemAsync', 'deleteItemAsync']) {
  test(`sign-out clears memory immediately when ${operation} rejects`, async () => {
    const { store, secure } = makeStore();
    secure.map.set('cu.refresh', 'stored');
    store.setAccessToken('old-access');
    secure[operation] = async () => { throw new Error('storage unavailable'); };
    const logout = store.signOut();
    assert.equal(store.getAccessToken(), null);
    await assert.doesNotReject(logout);
    if (operation === 'getItemAsync') assert.equal(secure.map.has('cu.refresh'), false);
    await store.saveRefresh('next-account');
    assert.equal(secure.map.get('cu.refresh'), 'next-account');
  });
}

test('a bootstrap marker read finishing after account switch cannot invalidate the new credential write', async () => {
  const entered = deferred();
  const release = deferred();
  const secure = memoryKv();
  secure.getItemAsync = async (key) => {
    if (key === 'cu.install') { entered.resolve(); await release.promise; }
    return secure.map.get(key) ?? null;
  };
  const { store } = makeStore({ secure });
  const boot = store.loadBootstrap();
  await entered.promise;
  const logout = store.signOut();
  store.bumpEpoch();
  const signin = store.saveRefresh('current-account');
  // Attach before releasing storage: a stale bootstrap must not reject sign-in.
  const completed = Promise.all([boot, logout, signin]);
  release.resolve();
  await completed;
  assert.equal(secure.map.get('cu.refresh'), 'current-account');
});
