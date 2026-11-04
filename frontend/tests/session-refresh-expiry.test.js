const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const apiPath = 'src/lib/api.ts';

let compiledApi = null;

function compileApi() {
  if (compiledApi) return compiledApi;
  compiledApi = ts.transpileModule(fs.readFileSync(path.join(root, apiPath), 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    fileName: apiPath,
  }).outputText;
  return compiledApi;
}

/** Loads the real URL guard — it is dependency-free, so no stub is needed. */
function loadSafeUrl() {
  const rel = 'src/lib/safe-url.ts';
  const { outputText } = ts.transpileModule(fs.readFileSync(path.join(root, rel), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: rel,
  });
  const moduleRecord = { exports: {} };
  Function('module', 'exports', 'require', outputText)(moduleRecord, moduleRecord.exports, require);
  return moduleRecord.exports;
}

/** Loads the real API client; `send` answers every call, `responseError` is the interceptor. */
function loadApi(send) {
  let responseError = null;
  function request(method, url, data, config) {
    return Promise.resolve().then(() => send({ method, url, data, config }));
  }
  const client = (config) => request(config.method ?? 'get', config.url, config.data, config);
  client.get = (url, config) => request('get', url, undefined, config);
  client.post = (url, data, config) => request('post', url, data, config);
  client.put = (url, data, config) => request('put', url, data, config);
  client.patch = (url, data, config) => request('patch', url, data, config);
  client.delete = (url, config) => request('delete', url, undefined, config);
  client.interceptors = {
    request: { use: () => undefined },
    response: { use: (_ok, errorHandler) => { responseError = errorHandler; } },
  };
  const stubs = {
    axios: { create: () => client },
    '@/lib/observability': {
      newRequestId: () => 'request-id',
      pathTemplate: (value) => value,
      recordApiMetric: () => undefined,
      REQUEST_ID_HEADER: 'X-Request-Id',
    },
    '@/lib/public-api-url': { resolvePublicApiBaseUrl: () => 'http://api.local/api/v1' },
    '@/lib/session-hint': {
      CSRF_COOKIE_NAME: 'cc_csrf',
      isLogoutInProgress: () => false,
    },
    '@/lib/session-sync': { publishSessionChange: () => undefined },
    '@/lib/safe-url': loadSafeUrl(),
    '@/lib/surfaces': { surfaceFromHost: () => null },
    '@/i18n/paths': {
      addLocalePrefix: (pathname) => pathname,
      stripLocaleFromPathname: (pathname) => ({ locale: null, pathname }),
    },
  };
  const moduleRecord = { exports: {} };
  const resolve = (specifier) =>
    Object.prototype.hasOwnProperty.call(stubs, specifier)
      ? stubs[specifier]
      : require(specifier);
  Function('module', 'exports', 'require', compileApi())(
    moduleRecord,
    moduleRecord.exports,
    resolve,
  );
  return {
    api: moduleRecord.exports,
    handle: (error) => {
      assert.ok(responseError, 'the response interceptor is registered');
      return responseError(error);
    },
  };
}

function installBrowser({ withoutLocks = false, indexedDB } = {}) {
  const previousWindow = global.window;
  const previousDocument = global.document;
  const previousNavigator = Object.getOwnPropertyDescriptor(global, 'navigator');
  const location = {
    pathname: '/dashboard/register',
    search: '',
    host: 'localhost:3000',
    origin: 'http://localhost:3000',
    href: '',
  };
  const browserWindow = { location };
  if (indexedDB) browserWindow.indexedDB = indexedDB;
  global.window = browserWindow;
  global.document = { cookie: '' };
  if (withoutLocks) {
    Object.defineProperty(global, 'navigator', {
      configurable: true,
      value: { locks: undefined },
    });
  }
  return {
    location,
    window: browserWindow,
    restore() {
      if (previousWindow === undefined) delete global.window;
      else global.window = previousWindow;
      if (previousDocument === undefined) delete global.document;
      else global.document = previousDocument;
      if (withoutLocks) {
        if (previousNavigator) Object.defineProperty(global, 'navigator', previousNavigator);
        else delete global.navigator;
      }
    },
  };
}

async function flush() {
  for (let pass = 0; pass < 6; pass += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

function unauthorizedRequest() {
  return {
    config: { url: '/profile', method: 'get' },
    response: { status: 401, headers: {}, data: {} },
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function createSharedIndexedDb() {
  const values = new Map();
  const stores = new Set();
  let initialized = false;
  let transactionQueue = Promise.resolve();
  let readCount = 0;
  const readWaiters = [];
  const clone = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  const noteRead = () => {
    readCount += 1;
    while (readWaiters.length > 0 && readWaiters[0].count <= readCount) {
      readWaiters.shift().resolve();
    }
  };
  const database = {
    objectStoreNames: { contains: (name) => stores.has(name) },
    createObjectStore(name) { stores.add(name); },
    close() {},
    transaction() {
      const requests = [];
      const writes = new Map();
      const transaction = { oncomplete: null, onabort: null };
      const objectStore = {
        get(key) {
          noteRead();
          const request = { result: undefined, onsuccess: null, onerror: null };
          requests.push({ key, request });
          return request;
        },
        put(value, key) {
          writes.set(key, clone(value));
          return {};
        },
      };
      transaction.objectStore = () => objectStore;
      const run = transactionQueue.then(() => new Promise((resolve) => {
        const complete = () => {
          writes.forEach((value, key) => values.set(key, value));
          setImmediate(() => {
            transaction.oncomplete?.({ target: transaction });
            resolve();
          });
        };
        const runRequest = (index) => {
          if (index >= requests.length) {
            complete();
            return;
          }
          const { key, request } = requests[index];
          request.result = clone(writes.has(key) ? writes.get(key) : values.get(key));
          setImmediate(() => {
            request.onsuccess?.({ target: request });
            runRequest(index + 1);
          });
        };
        runRequest(0);
      }));
      transactionQueue = run.catch(() => undefined);
      return transaction;
    },
  };
  const factory = {
    open() {
      const request = {
        result: database,
        onupgradeneeded: null,
        onsuccess: null,
        onerror: null,
        onblocked: null,
      };
      setImmediate(() => {
        if (!initialized) {
          initialized = true;
          request.onupgradeneeded?.({ target: request });
        }
        request.onsuccess?.({ target: request });
      });
      return request;
    },
  };
  return {
    factory,
    values,
    waitForSessionStateReads(count) {
      if (readCount >= count) return Promise.resolve();
      return new Promise((resolve) => { readWaiters.push({ count, resolve }); });
    },
  };
}

async function waitFor(predicate) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail('condition was not reached before the coordination timeout');
}

async function rejectRefresh(refreshError) {
  const { handle } = loadApi(({ url }) => {
    if (url === '/auth/refresh') throw refreshError;
    if (url === '/auth/me') throw { response: { status: 401, headers: {}, data: {} } };
    return { data: {} };
  });
  const browser = installBrowser();
  try {
    await assert.rejects(handle(unauthorizedRequest()));
    await flush();
    return browser.location.href;
  } finally {
    browser.restore();
  }
}

test('a refresh rejected 400 for a missing cookie sends the user to sign-in', async () => {
  const href = await rejectRefresh({ response: { status: 400, data: {} } });
  assert.match(href, /\/login\?reason=session-expired/, 'a malformed refresh is a dead session');
});

test('a refresh rejected 403 sends the user to sign-in', async () => {
  const href = await rejectRefresh({ response: { status: 403, data: {} } });
  assert.match(href, /\/login\?reason=session-expired/);
});

test('a refresh rejected 401 keeps sending the user to sign-in', async () => {
  const href = await rejectRefresh({ response: { status: 401, data: {} } });
  assert.match(href, /\/login\?reason=session-expired/);
});

test('an offline refresh failure does not sign the user out', async () => {
  const href = await rejectRefresh(Object.assign(new Error('Network Error'), { isAxiosError: true }));
  assert.equal(href, '', 'a transport failure is not an expired session');
});

test('a server-side refresh failure does not sign the user out', async () => {
  const href = await rejectRefresh({ response: { status: 500, data: {} } });
  assert.equal(href, '', 'a 5xx is not a terminal auth rejection');
});

test('concurrent tab refreshes share one cookie rotation and both retry with the successor cookie', async () => {
  const indexedDB = createSharedIndexedDb();
  const browser = installBrowser({ withoutLocks: true, indexedDB: indexedDB.factory });
  const cookieJar = { generation: 0 };
  let activeServerGeneration = 0;
  const refreshRequests = [];
  const retriedCookieGenerations = [];
  const releaseRefresh = deferred();
  const send = async ({ url }) => {
    if (url === '/auth/refresh') {
      const presentedGeneration = cookieJar.generation;
      refreshRequests.push(presentedGeneration);
      await releaseRefresh.promise;
      if (presentedGeneration !== activeServerGeneration) {
        throw { response: { status: 401, data: {} } };
      }
      activeServerGeneration += 1;
      cookieJar.generation = activeServerGeneration;
      return {
        data: {
          user: { id: 'user-a' },
          accessToken: 'access-a',
          refreshToken: 'refresh-a',
        },
      };
    }
    if (url === '/profile') {
      retriedCookieGenerations.push(cookieJar.generation);
      if (cookieJar.generation !== activeServerGeneration) {
        throw { response: { status: 401, data: {} } };
      }
      return { data: { ok: true } };
    }
    throw new Error(`unexpected request: ${url}`);
  };
  const firstTab = loadApi(send);
  const secondTab = loadApi(send);
  const pending = [
    firstTab.handle(unauthorizedRequest()),
    secondTab.handle(unauthorizedRequest()),
  ];

  try {
    await waitFor(() => refreshRequests.length > 0);
    // Two state reads per tab (generation probe, then lease claim) prove both
    // tabs reached the shared lease before the first refresh is released.
    await indexedDB.waitForSessionStateReads(4);
    assert.equal(
      refreshRequests.length,
      1,
      'only one tab may present a refresh cookie while its generation is current',
    );
  } finally {
    releaseRefresh.resolve();
    await Promise.allSettled(pending);
    browser.restore();
  }

  const responses = await Promise.all(pending);
  assert.equal(responses.length, 2, 'both original requests are retried');
  assert.deepEqual(refreshRequests, [0], 'the old cookie generation is refreshed once');
  assert.deepEqual(retriedCookieGenerations, [1, 1], 'both retries use the rotated cookie');
  assert.equal(activeServerGeneration, 1, 'the mock session remains active');
  const sharedMarkers = JSON.stringify([...indexedDB.values.values()]);
  assert.doesNotMatch(sharedMarkers, /access-a|refresh-a|user-a/);
  assert.deepEqual(
    Object.keys([...indexedDB.values.values()][0]).sort(),
    ['activeFence', 'fence', 'generation', 'leaseExpiresAt'],
  );
});

test('an expired refresh lease can be reclaimed after its owner stops responding', async () => {
  const indexedDB = createSharedIndexedDb();
  indexedDB.values.set('session-refresh', {
    generation: 0,
    fence: 2,
    activeFence: 2,
    leaseExpiresAt: Date.now() - 1,
  });
  const browser = installBrowser({ withoutLocks: true, indexedDB: indexedDB.factory });
  const cookieJar = { generation: 0 };
  const refreshRequests = [];
  const context = loadApi(({ url }) => {
    if (url === '/auth/refresh') {
      refreshRequests.push(cookieJar.generation);
      cookieJar.generation += 1;
      return {
        data: {
          user: { id: 'user-a' },
          accessToken: 'access-a',
          refreshToken: 'refresh-a',
        },
      };
    }
    if (url === '/profile') return { data: { ok: true } };
    throw new Error(`unexpected request: ${url}`);
  });
  try {
    const response = await context.handle(unauthorizedRequest());
    assert.deepEqual(response.data, { ok: true });
    assert.deepEqual(refreshRequests, [0]);
    assert.equal(indexedDB.values.get('session-refresh').generation, 1);
  } finally {
    browser.restore();
  }
});

test('refresh coordination falls back without deadlocking when shared storage throws', async () => {
  const browser = installBrowser({
    withoutLocks: true,
    indexedDB: { open() { throw new Error('storage unavailable'); } },
  });
  const context = loadApi(({ url }) => {
    if (url === '/auth/refresh') {
      return {
        data: {
          user: { id: 'user-a' },
          accessToken: 'access-a',
          refreshToken: 'refresh-a',
        },
      };
    }
    if (url === '/profile') return { data: { ok: true } };
    throw new Error(`unexpected request: ${url}`);
  });
  let timeout;
  try {
    const response = await Promise.race([
      context.handle(unauthorizedRequest()),
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error('refresh fallback deadlocked')), 250);
      }),
    ]);
    assert.deepEqual(response.data, { ok: true });
  } finally {
    clearTimeout(timeout);
    browser.restore();
  }
});
