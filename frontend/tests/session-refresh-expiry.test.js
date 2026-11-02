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

/** Loads the real API client; `send` answers every call, `responseError` is the interceptor. */
function loadApi(send) {
  let responseError = null;
  function request(method, url, data, config) {
    return Promise.resolve().then(() => send({ method, url, data, config }));
  }
  const client = {
    get: (url, config) => request('get', url, undefined, config),
    post: (url, data, config) => request('post', url, data, config),
    put: (url, data, config) => request('put', url, data, config),
    patch: (url, data, config) => request('patch', url, data, config),
    delete: (url, config) => request('delete', url, undefined, config),
    interceptors: {
      request: { use: () => undefined },
      response: { use: (_ok, errorHandler) => { responseError = errorHandler; } },
    },
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

function installBrowser() {
  const previousWindow = global.window;
  const previousDocument = global.document;
  const location = {
    pathname: '/dashboard/register',
    search: '',
    host: 'localhost:3000',
    origin: 'http://localhost:3000',
    href: '',
  };
  global.window = { location };
  global.document = { cookie: '' };
  return {
    location,
    restore() {
      if (previousWindow === undefined) delete global.window;
      else global.window = previousWindow;
      if (previousDocument === undefined) delete global.document;
      else global.document = previousDocument;
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
