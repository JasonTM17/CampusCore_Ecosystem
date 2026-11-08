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

for (const connectivity of [
  { isConnected: false },
  { isConnected: true, isInternetReachable: false },
  { isConnected: false, isInternetReachable: true },
]) {
  test(`definitive offline connectivity preserves credential and memory (${JSON.stringify(connectivity)})`, async () => {
    const { store, secure, calls } = makeStore({ getNetworkState: async () => connectivity });
    secure.map.set('cu.refresh', 'rt-existing');
    store.setAccessToken('at-existing');
    const reads = [];
    const originalRead = secure.getItemAsync;
    secure.getItemAsync = async (key) => { reads.push(key); return originalRead(key); };

    assert.deepEqual(await store.refreshAccessToken(), { kind: 'unavailable', accessToken: null, reason: 'offline' });
    assert.equal(calls.length, 0);
    assert.equal(secure.map.get('cu.refresh'), 'rt-existing');
    assert.equal(store.getAccessToken(), 'at-existing');
    assert.deepEqual(reads, [], 'offline must be established before reading the credential');
  });
}

for (const [name, getNetworkState] of [
  ['online', async () => ({ isConnected: true, isInternetReachable: true })],
  ['unknown', async () => ({})],
  ['null fields', async () => ({ isConnected: null, isInternetReachable: null })],
  ['probe failure', async () => { throw new Error('probe unavailable'); }],
]) {
  test(`${name} connectivity permits the normal refresh rotation`, async () => {
    const { store, secure, calls } = makeStore({ getNetworkState });
    secure.map.set('cu.refresh', 'rt-existing');
    assert.equal((await store.refreshAccessToken()).kind, 'refreshed');
    assert.equal(calls.length, 1);
    assert.equal(secure.map.get('cu.refresh'), 'rt-2');
    assert.equal(store.getAccessToken(), 'at-1');
  });
}

test('offline refresh can retry online without replaying a dispatched credential', async () => {
  let online = false;
  const { store, secure, calls } = makeStore({ getNetworkState: async () => ({ isConnected: online }) });
  secure.map.set('cu.refresh', 'rt-existing');
  assert.equal((await store.refreshAccessToken()).kind, 'unavailable');
  assert.equal(calls.length, 0);
  online = true;
  assert.equal((await store.refreshAccessToken()).kind, 'refreshed');
  assert.equal(calls.length, 1);
  assert.equal(secure.map.get('cu.refresh'), 'rt-2');
});

for (const isConnected of [false, true]) {
  test(`a pending connectivity probe cannot touch a replacement session (${isConnected})`, async () => {
    let resolve;
    const probe = new Promise((done) => { resolve = done; });
    const { store, secure, calls } = makeStore({ getNetworkState: () => probe });
    secure.map.set('cu.refresh', 'rt-existing');
    const pending = store.refreshAccessToken();
    store.bumpEpoch();
    await store.saveRefresh('rt-replacement');
    store.setAccessToken('at-replacement');
    resolve({ isConnected });
    assert.equal((await pending).kind, 'stale');
    assert.equal(calls.length, 0);
    assert.equal(secure.map.get('cu.refresh'), 'rt-replacement');
    assert.equal(store.getAccessToken(), 'at-replacement');
  });
}

for (const failure of ['network', 'timeout', 429, 503, 400, 401]) {
  test(`an online probe preserves dispatched quarantine semantics (${failure})`, async () => {
    let secure;
    const fixture = makeStore({
      getNetworkState: async () => ({ isConnected: true }),
      timeoutMs: 20,
      respond: async () => {
        assert.equal(secure.map.has('cu.refresh'), false, 'quarantine must precede dispatch');
        if (failure === 'network') throw new TypeError('response lost');
        if (failure === 'timeout') return new Promise(() => {});
        return new Response('{}', { status: failure });
      },
    });
    secure = fixture.secure;
    secure.map.set('cu.refresh', 'rt-existing');
    fixture.store.setAccessToken('at-existing');
    const result = await fixture.store.refreshAccessToken();
    assert.equal(result.kind, failure === 400 || failure === 401 ? 'signedOut' : 'reauthRequired');
    assert.equal(fixture.calls.length, 1);
    assert.equal(secure.map.has('cu.refresh'), false);
    assert.equal(fixture.store.getAccessToken(), null);
  });
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
  assert.equal(result.kind, 'signedOut');
  assert.equal(result.accessToken, null);
  assert.equal(secure.map.has('cu.refresh'), false);
  assert.equal(store.getAccessToken(), null);
});

test('a replacement credential write that commits before rejecting is wiped', async () => {
  const secure = memoryKv();
  secure.map.set('cu.refresh', 'rt-1');
  const write = secure.setItemAsync;
  secure.setItemAsync = async (key, value) => {
    await write(key, value);
    throw new Error('native write acknowledgement lost');
  };
  const { store } = makeStore({ secure });
  store.setAccessToken('at-old');
  assert.equal((await store.refreshAccessToken()).kind, 'reauthRequired');
  assert.equal(store.getAccessToken(), null);
  assert.equal(secure.map.has('cu.refresh'), false, 'failed replacement storage must not leave a restart credential');
});

test('sign-out without a configured issuer wipes locally without a revoke request', async () => {
  const { store, secure, calls } = makeStore({ issuer: '' });
  secure.map.set('cu.refresh', 'surviving');
  await store.signOut();
  await Promise.resolve();
  assert.equal(secure.map.has('cu.refresh'), false);
  assert.equal(calls.length, 0);
});

test('a malformed success quarantines the credential without granting access', async () => {
  const { store, secure } = makeStore({
    respond: async () => new Response('{"refresh_token":"rt-2"}', { status: 200 }),
  });
  secure.map.set('cu.refresh', 'rt-1');
  const result = await store.refreshAccessToken();
  assert.equal(result.kind, 'reauthRequired');
  assert.equal(result.accessToken, null);
  assert.equal(secure.map.has('cu.refresh'), false);
  assert.equal(store.getAccessToken(), null);
});

for (const status of [400, 401]) {
  test(`a definitive HTTP ${status} invalid_grant wipes the grant instead of retrying it`, async () => {
    const { store, secure } = makeStore({
      respond: async () => new Response('{"error":"invalid_grant"}', { status }),
    });
    secure.map.set('cu.refresh', 'rt-dead');
    store.setAccessToken('at-old');
    const result = await store.refreshAccessToken();
    assert.equal(result.kind, 'signedOut');
    assert.equal(result.accessToken, null);
    assert.equal(secure.map.has('cu.refresh'), false);
    assert.equal(store.getAccessToken(), null);
  });
}

test('a refresh that never answers aborts at the app deadline', { timeout: 2000 }, async () => {
  const { store, secure } = makeStore({
    timeoutMs: 20,
    respond: (_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
    }),
  });
  secure.map.set('cu.refresh', 'rt-live');
  const result = await store.refreshAccessToken();
  assert.equal(result.kind, 'reauthRequired');
  assert.equal(result.accessToken, null);
  assert.equal(secure.map.has('cu.refresh'), false);
});

test('the app deadline completes when fetch ignores abort', { timeout: 1000 }, async () => {
  const { store, secure, calls } = makeStore({
    timeoutMs: 20,
    respond: () => new Promise(() => {}),
  });
  secure.map.set('cu.refresh', 'rt-live');

  const result = await store.refreshAccessToken();

  assert.equal(result.kind, 'reauthRequired');
  assert.equal(result.accessToken, null);
  assert.equal(secure.map.has('cu.refresh'), false);
  assert.equal(calls.length, 1);
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

test('fifty concurrent refresh callers share one issuer request', async () => {
  const { store, secure, calls } = makeStore();
  secure.map.set('cu.refresh', 'rt-1');

  const results = await Promise.all(Array.from({ length: 50 }, () => store.refreshAccessToken()));

  assert.equal(calls.length, 1);
  assert.ok(results.every((result) => result.kind === 'refreshed' && result.accessToken === 'at-1'));
  assert.equal(secure.map.get('cu.refresh'), 'rt-2');
});

test('an aborted refresh quarantines its token and prevents a later resend', { timeout: 2000 }, async () => {
  const { store, secure, calls } = makeStore({
    timeoutMs: 20,
    respond: (_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
    }),
  });
  secure.map.set('cu.refresh', 'rt-live');

  const result = await store.refreshAccessToken();
  const later = await store.refreshAccessToken();

  assert.equal(result.kind, 'reauthRequired');
  assert.equal(result.accessToken, null);
  assert.equal(secure.map.has('cu.refresh'), false);
  assert.equal(later.kind, 'signedOut');
  assert.equal(calls.length, 1);
});

test('a lost refresh response quarantines its token and prevents a later resend', async () => {
  const { store, secure, calls } = makeStore({
    respond: async () => { throw new TypeError('response lost'); },
  });
  secure.map.set('cu.refresh', 'rt-live');

  const result = await store.refreshAccessToken();
  const later = await store.refreshAccessToken();

  assert.equal(result.kind, 'reauthRequired');
  assert.equal(secure.map.has('cu.refresh'), false);
  assert.equal(later.kind, 'signedOut');
  assert.equal(calls.length, 1);
});

test('a refresh response must include a different replacement token', async () => {
  const { store, secure } = makeStore({
    respond: async () => new Response(JSON.stringify({ access_token: 'at-new', refresh_token: 'rt-1' })),
  });
  secure.map.set('cu.refresh', 'rt-1');
  store.setAccessToken('at-old');

  const result = await store.refreshAccessToken();

  assert.equal(result.kind, 'reauthRequired');
  assert.equal(result.accessToken, null);
  assert.equal(secure.map.has('cu.refresh'), false);
  assert.equal(store.getAccessToken(), null);
});

test('a refresh response without a replacement token requires reauthentication', async () => {
  const { store, secure } = makeStore({
    respond: async () => new Response(JSON.stringify({ access_token: 'at-new' })),
  });
  secure.map.set('cu.refresh', 'rt-1');

  const result = await store.refreshAccessToken();

  assert.equal(result.kind, 'reauthRequired');
  assert.equal(secure.map.has('cu.refresh'), false);
  assert.equal(store.getAccessToken(), null);
});

test('a response body read failure requires reauthentication', async () => {
  const { store, secure, calls } = makeStore({
    respond: async () => ({ ok: true, status: 200, text: async () => { throw new Error('body lost'); } }),
  });
  secure.map.set('cu.refresh', 'rt-1');

  const result = await store.refreshAccessToken();
  const later = await store.refreshAccessToken();

  assert.equal(result.kind, 'reauthRequired');
  assert.equal(secure.map.has('cu.refresh'), false);
  assert.equal(later.kind, 'signedOut');
  assert.equal(calls.length, 1);
});

test('failure to persist a replacement requires reauthentication without restoring the old token', async () => {
  const { store, secure } = makeStore();
  const write = secure.setItemAsync;
  secure.map.set('cu.refresh', 'rt-1');
  secure.setItemAsync = async (key, value) => {
    if (key === 'cu.refresh' && value === 'rt-2') throw new Error('storage unavailable');
    return write(key, value);
  };

  const result = await store.refreshAccessToken();

  assert.equal(result.kind, 'reauthRequired');
  assert.equal(result.accessToken, null);
  assert.equal(secure.map.has('cu.refresh'), false);
  assert.equal(store.getAccessToken(), null);
});

test('a refresh credential is deleted before issuer dispatch', async () => {
  const release = deferred();
  const secure = memoryKv();
  const remove = secure.deleteItemAsync;
  let deleteStarted = false;
  secure.deleteItemAsync = async (key) => {
    deleteStarted = true;
    await release.promise;
    await remove(key);
  };
  const { store, calls } = makeStore({ secure });
  secure.map.set('cu.refresh', 'rt-1');

  const pending = store.refreshAccessToken();
  await new Promise((resolve) => setImmediate(resolve));
  const callsBeforeDelete = calls.length;
  release.resolve();
  const result = await pending;

  assert.equal(callsBeforeDelete, 0);
  assert.equal(deleteStarted, true);
  assert.equal(result.kind, 'refreshed');
  assert.equal(calls.length, 1);
});

test('an epoch change during credential deletion prevents the issuer request', async () => {
  const release = deferred();
  const secure = memoryKv();
  const remove = secure.deleteItemAsync;
  let deleteStarted = false;
  secure.deleteItemAsync = async (key) => {
    deleteStarted = true;
    await release.promise;
    await remove(key);
  };
  const { store, calls } = makeStore({ secure });
  secure.map.set('cu.refresh', 'account-a');

  const pending = store.refreshAccessToken();
  await new Promise((resolve) => setImmediate(resolve));
  store.bumpEpoch();
  const signin = store.saveRefresh('account-b');
  release.resolve();
  const result = await pending;
  await signin;
  store.setAccessToken('access-b');

  assert.equal(deleteStarted, true);
  assert.equal(result.kind, 'stale');
  assert.equal(calls.length, 0);
  assert.equal(secure.map.get('cu.refresh'), 'account-b');
  assert.equal(store.getAccessToken(), 'access-b');
});

test('failure to delete a refresh credential prevents issuer dispatch', async () => {
  const { store, secure, calls } = makeStore();
  secure.map.set('cu.refresh', 'rt-1');
  secure.deleteItemAsync = async () => { throw new Error('storage unavailable'); };

  const result = await store.refreshAccessToken();

  assert.equal(result.kind, 'unavailable');
  assert.equal(result.reason, 'storage');
  assert.equal(secure.map.get('cu.refresh'), 'rt-1');
  assert.equal(calls.length, 0);
});

test('invalid issuer configuration does not consume a refresh credential', async () => {
  const { store, secure, calls } = makeStore({ issuer: '' });
  secure.map.set('cu.refresh', 'rt-1');

  const result = await store.refreshAccessToken();

  assert.equal(result.kind, 'unavailable');
  assert.equal(result.reason, 'configuration');
  assert.equal(secure.map.get('cu.refresh'), 'rt-1');
  assert.equal(calls.length, 0);
});

for (const status of [429, 500, 502, 503, 504]) {
  test(`HTTP ${status} quarantines a dispatched refresh credential`, async () => {
    const { store, secure, calls } = makeStore({
      respond: async () => new Response('{"error":"server_error"}', { status }),
    });
    secure.map.set('cu.refresh', 'rt-1');

    const result = await store.refreshAccessToken();
    const later = await store.refreshAccessToken();

    assert.equal(result.kind, 'reauthRequired');
    assert.equal(secure.map.has('cu.refresh'), false);
    assert.equal(later.kind, 'signedOut');
    assert.equal(calls.length, 1);
  });
}

function deferred() {
  let resolve;
  const promise = new Promise((yes) => { resolve = yes; });
  return { promise, resolve };
}

for (const [label, respond] of [
  ['rate limit', async () => new Response('{}', { status: 429 })],
  ['issuer outage', async () => new Response('{"error":"invalid_grant"}', { status: 503 })],
  ['network loss', async () => { throw new TypeError('offline'); }],
  ['issuer refusal', async () => new Response('{"error":"access_denied"}', { status: 403 })],
]) {
  test(`${label} after dispatch requires a fresh sign-in`, async () => {
    const { store, secure, calls } = makeStore({ respond });
    secure.map.set('cu.refresh', 'surviving');
    store.setAccessToken('expired');
    const result = await store.refreshAccessToken();
    assert.equal(result.kind, 'reauthRequired');
    assert.equal(result.accessToken, null);
    assert.equal(secure.map.has('cu.refresh'), false);
    assert.equal(store.getAccessToken(), null);
    assert.equal(calls.length, 1);
    assert.equal((await store.refreshAccessToken()).kind, 'signedOut');
    assert.equal(calls.length, 1);
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

test('a sign-out tombstone prevents a retained refresh token from returning after restart', async () => {
  const { store, secure, sandbox } = makeStore();
  secure.map.set('cu.install', JSON.stringify({ appInstanceId: 'install' }));
  secure.map.set('cu.refresh', 'retained-refresh');
  sandbox.map.set('installMarker', JSON.stringify({ appInstanceId: 'install' }));
  const order = [];
  const deleteItemAsync = secure.deleteItemAsync;
  sandbox.setItem = async (key, value) => {
    order.push('tombstone');
    sandbox.map.set(key, value);
  };
  secure.deleteItemAsync = async () => {
    order.push('secure-delete');
    throw new Error('secure deletion unavailable');
  };

  await store.signOut();

  assert.deepEqual(order, ['tombstone', 'secure-delete']);
  assert.equal(JSON.parse(sandbox.map.get('installMarker')).signedOut, true);
  assert.equal(JSON.parse(secure.map.get('cu.install')).signedOut, undefined);
  const restarted = createSessionStore({ secure, sandbox, issuer: ISSUER });
  assert.equal((await restarted.loadBootstrap()).refreshToken, null);

  secure.deleteItemAsync = deleteItemAsync;
  await restarted.saveRefresh('fresh-sign-in-refresh');
  assert.equal(JSON.parse(sandbox.map.get('installMarker')).signedOut, undefined);
  assert.equal(JSON.parse(secure.map.get('cu.install')).signedOut, undefined);
  const nextRestart = createSessionStore({ secure, sandbox, issuer: ISSUER });
  assert.equal((await nextRestart.loadBootstrap()).refreshToken, 'fresh-sign-in-refresh');
});

test('the secure install marker prevents restoration when the sandbox tombstone cannot be written', async () => {
  const { store, secure, sandbox } = makeStore();
  secure.map.set('cu.install', JSON.stringify({ appInstanceId: 'install', createdAt: '2023-11-14T22:13:20.000Z' }));
  secure.map.set('cu.refresh', 'retained-refresh');
  sandbox.map.set('installMarker', JSON.stringify({ appInstanceId: 'install' }));
  sandbox.setItem = async () => { throw new Error('sandbox marker unavailable'); };
  secure.deleteItemAsync = async () => { throw new Error('secure deletion unavailable'); };

  await store.signOut();

  const restarted = createSessionStore({ secure, sandbox, issuer: ISSUER });
  assert.equal((await restarted.loadBootstrap()).refreshToken, null);
  assert.equal(JSON.parse(secure.map.get('cu.install')).signedOut, true);

  await restarted.saveRefresh('fresh-sign-in-refresh');
  assert.equal(JSON.parse(secure.map.get('cu.install')).signedOut, undefined);
  const nextRestart = createSessionStore({ secure, sandbox, issuer: ISSUER });
  assert.equal((await nextRestart.loadBootstrap()).refreshToken, 'fresh-sign-in-refresh');
});
