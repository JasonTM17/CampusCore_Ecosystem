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

/**
 * Loads the real API client with a transport stub. `send` receives every
 * outbound call and answers (or rejects) it.
 */
function loadApi(send) {
  const calls = [];
  function request(method, url, data, config) {
    calls.push({ method, url, data, config });
    return Promise.resolve().then(() => send({ method, url, data, config }));
  }
  const client = {
    get: (url, config) => request('get', url, undefined, config),
    post: (url, data, config) => request('post', url, data, config),
    put: (url, data, config) => request('put', url, data, config),
    patch: (url, data, config) => request('patch', url, data, config),
    delete: (url, config) => request('delete', url, undefined, config),
    interceptors: { request: { use: () => undefined }, response: { use: () => undefined } },
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
    '@/lib/session-hint': { CSRF_COOKIE_NAME: 'cc_csrf', isLogoutInProgress: () => false },
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
  return { api: moduleRecord.exports, calls };
}

function idempotencyKeys(calls) {
  return calls.map((call) => {
    assert.ok(call.config?.headers, 'the mutation carries request headers');
    return call.config.headers['Idempotency-Key'];
  });
}

function networkLoss() {
  const error = new Error('Network Error');
  error.isAxiosError = true;
  return error;
}

const draft = { userId: 'u-1', title: 'Reminder', message: 'Bring the form', type: 'INFO' };

test('a send retried after a lost response replays the same key', async () => {
  let attempt = 0;
  const { api, calls } = loadApi(() => {
    attempt += 1;
    if (attempt === 1) throw networkLoss();
    return { data: { id: 'n-1' } };
  });

  await assert.rejects(api.adminNotificationsApi.adminCreate(draft));
  await api.adminNotificationsApi.adminCreate(draft);

  const keys = idempotencyKeys(calls);
  assert.equal(keys.length, 2, 'the retry is sent');
  assert.equal(keys[1], keys[0], 'the retry of an unchanged compose replays its key');
});

test('a field edit starts a new intent and must not replay the old key', async () => {
  let attempt = 0;
  const { api, calls } = loadApi(() => {
    attempt += 1;
    if (attempt === 1) throw networkLoss();
    return { data: { id: 'n-2' } };
  });

  await assert.rejects(api.adminNotificationsApi.adminCreate(draft));
  await api.adminNotificationsApi.adminCreate({ ...draft, title: 'Edited reminder' });

  const keys = idempotencyKeys(calls);
  assert.notEqual(keys[1], keys[0], 'an edited compose is a different intent');
});

test('a confirmed send ends the intent so the next compose mints a fresh key', async () => {
  const { api, calls } = loadApi(() => ({ data: { id: 'n-3' } }));

  await api.adminNotificationsApi.adminCreate(draft);
  await api.adminNotificationsApi.adminCreate(draft);

  const keys = idempotencyKeys(calls);
  assert.equal(keys.length, 2);
  assert.notEqual(keys[1], keys[0], 'a settled compose does not replay its key');
});
