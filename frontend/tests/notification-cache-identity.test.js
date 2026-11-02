const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');

const USER_A = {
  id: 'session-probe-a',
  email: 'session-a@example.test',
  firstName: 'Alpha',
  lastName: 'Student',
  status: 'ACTIVE',
  roles: ['STUDENT'],
};
const USER_B = {
  id: 'session-probe-b',
  email: 'session-b@example.test',
  firstName: 'Beta',
  lastName: 'Lecturer',
  status: 'ACTIVE',
  roles: ['LECTURER'],
};

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function settle() {
  return new Promise((resolve) => setImmediate(resolve));
}

function loadApiModule() {
  const postCalls = [];
  const getCalls = [];
  const logoutInProgress = { value: false };
  const interceptors = { responseError: null };
  const fakeSetTimeout = () => ({});
  const fakeClearTimeout = () => {};
  const fakeApi = Object.assign(
    () => Promise.resolve({ data: {} }),
    {
      interceptors: {
        request: { use: () => {} },
        response: {
          use: (_success, error) => {
            interceptors.responseError = error;
          },
        },
      },
      post: (...args) => {
        const call = deferred();
        call.args = args;
        postCalls.push(call);
        return call.promise;
      },
      get: (...args) => {
        const call = deferred();
        call.args = args;
        getCalls.push(call);
        return call.promise;
      },
    },
  );
  const stubs = {
    axios: {
      __esModule: true,
      default: { create: () => fakeApi },
      AxiosError: class extends Error {},
    },
    '@/i18n/paths': {
      addLocalePrefix: (value) => value,
      stripLocaleFromPathname: (value) => {
        const match = value.match(/^\/(en|vi)(?=\/|$)/);
        return {
          locale: match ? match[1] : '',
          pathname: match ? value.replace(/^\/(en|vi)/, '') || '/' : value,
        };
      },
    },
    '@/lib/public-api-url': { resolvePublicApiBaseUrl: () => '/api/v1' },
    '@/lib/session-hint': {
      CSRF_COOKIE_NAME: 'cc_csrf',
      isLogoutInProgress: () => logoutInProgress.value,
    },
    '@/lib/session-sync': {
      publishSessionChange: () => {},
    },
    '@/lib/surfaces': { surfaceFromHost: () => null },
    '@/lib/observability': {
      REQUEST_ID_HEADER: 'X-Request-Id',
      newRequestId: () => 'test-request-id',
      pathOf: (url) => (url ?? '').split('?')[0],
      pathTemplate: (url) => (url ?? '').split('?')[0],
      recordApiMetric: () => {},
    },
  };
  const source = fs.readFileSync(path.join(root, 'src/lib/api.ts'), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
    fileName: 'api.ts',
  });
  const moduleRecord = { exports: {} };
  const stubRequire = (specifier) => {
    if (Object.prototype.hasOwnProperty.call(stubs, specifier)) {
      return stubs[specifier];
    }
    throw new Error(`unexpected import in api.ts: ${specifier}`);
  };
  Function('module', 'exports', 'require', 'setTimeout', 'clearTimeout', outputText)(
    moduleRecord,
    moduleRecord.exports,
    stubRequire,
    fakeSetTimeout,
    fakeClearTimeout,
  );
  return { exports: moduleRecord.exports, getCalls, postCalls };
}

test('a cached unread count is dropped when the signed-in identity changes', async () => {
  const { exports: apiModule, getCalls, postCalls } = loadApiModule();

  const me = apiModule.authApi.me();
  await settle();
  assert.equal(getCalls.length, 1);
  getCalls[0].resolve({ data: USER_A });
  await me;

  const first = apiModule.notificationsApi.unreadCount();
  await settle();
  assert.equal(getCalls.length, 2);
  assert.equal(getCalls[1].args[0], '/notifications/my/unread-count');
  getCalls[1].resolve({ data: { unreadCount: 3 } });
  assert.equal(await first, 3);

  assert.equal(await apiModule.notificationsApi.unreadCount(), 3);
  assert.equal(getCalls.length, 2, 'the cached count is reused inside the TTL for the same user');

  const login = apiModule.authApi.login(USER_B.email, 'pw-irrelevant');
  await settle();
  assert.equal(postCalls.length, 1);
  postCalls[0].resolve({
    data: { user: USER_B, accessToken: 'stub-access', refreshToken: 'stub-refresh' },
  });
  await login;

  const second = apiModule.notificationsApi.unreadCount();
  await settle();
  assert.equal(getCalls.length, 3, 'the new identity must issue a fresh count request');
  getCalls[2].resolve({ data: { unreadCount: 1 } });
  assert.equal(await second, 1);
});
