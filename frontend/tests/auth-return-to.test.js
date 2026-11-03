const test = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const {
  createDashboardShell,
  createRuntime,
  elements,
  flush,
  installBrowserEnv,
  loadMessages,
  loadTs,
  read,
  textOf,
} = require('./dashboard-shell-harness');

const root = path.resolve(__dirname, '..');
const messages = loadMessages('vi');

const iconStub = new Proxy(
  {},
  { get: (_target, property) => (property === '__esModule' ? true : () => null) },
);

const loginPortal = loadTs('src/lib/login-portal.ts');
const identity = (value) => value;

// ---------------------------------------------------------------------------
// loginHref — the next parameter is carried and validated at mint time
// ---------------------------------------------------------------------------

test('loginHref carries a validated next target', () => {
  const href = loginPortal.loginHref(identity, 'student', 'unauthorized', '/dashboard/grades');
  const url = new URL(href, 'http://portal.test');
  assert.equal(url.searchParams.get('portal'), 'student');
  assert.equal(url.searchParams.get('reason'), 'unauthorized');
  assert.equal(url.searchParams.get('next'), '/dashboard/grades');
});

test('loginHref drops targets that are not same-origin relative paths', () => {
  for (const hostile of [
    '//evil.example',
    'https://evil.example/x',
    'javascript:alert(1)',
    '/\\evil.example',
    '/%2f%2fevil.example',
    'dashboard/grades',
  ]) {
    const url = new URL(
      loginPortal.loginHref(identity, 'student', 'unauthorized', hostile),
      'http://portal.test',
    );
    assert.equal(url.searchParams.get('next'), null, `${hostile} must not become a return target`);
  }
});

test('loginHref keeps callers that pass no target unchanged', () => {
  const url = new URL(loginPortal.loginHref(identity, 'lecturer', 'session-expired'), 'http://portal.test');
  assert.equal(url.searchParams.get('portal'), 'lecturer');
  assert.equal(url.searchParams.get('reason'), 'session-expired');
  assert.equal(url.searchParams.get('next'), null);
});

// ---------------------------------------------------------------------------
// Redirect producers — every guard hands the requested page to /login
// ---------------------------------------------------------------------------

test('the dashboard guard sends the requested page as next', async () => {
  const shell = createDashboardShell({ pathname: '/dashboard/grades', user: null });
  shell.windowStub.location.search = '?semester=hk1';
  await shell.pump();

  assert.equal(shell.replaced.length, 1, 'a signed-out visitor is redirected once');
  const url = new URL(shell.replaced[0], 'http://portal.test');
  assert.equal(url.searchParams.get('portal'), 'student');
  assert.equal(url.searchParams.get('reason'), 'unauthorized');
  assert.equal(
    url.searchParams.get('next'),
    '/dashboard/grades?semester=hk1',
    'the login URL must carry the page the visitor asked for',
  );
});

test('ProtectedRoute sends the requested page as next', async () => {
  const runtime = createRuntime();
  const { windowStub } = installBrowserEnv();
  windowStub.location = { pathname: '/vi/dashboard/thesis', search: '?advisorId=lec-9' };
  const pushed = [];
  const page = loadTs('src/components/ProtectedRoute.tsx', {
    react: runtime.fakeReact,
    'react/jsx-runtime': require('react/jsx-runtime'),
    'next/navigation': { useRouter: () => ({ push: (href) => pushed.push(href), replace: () => {} }) },
    '@/context/AuthContext': { useAuth: () => ({ user: null, isLoading: false }) },
    '@/components/ui/link-button': {
      LinkButton: ({ href, children }) => React.createElement('a', { href }, children),
    },
    '@/components/ui/state-block': {
      ForbiddenState: () => null,
      LoadingState: () => null,
    },
    '@/i18n': { useI18n: () => ({ href: identity, messages, locale: 'vi' }) },
  }, { cache: false });

  runtime.runEffects(runtime.render(page.ProtectedRoute, { children: null }).effects);
  assert.equal(pushed.length, 1, 'a signed-out visitor is redirected once');
  const url = new URL(pushed[0], 'http://portal.test');
  assert.equal(url.searchParams.get('portal'), 'lecturer');
  assert.equal(
    url.searchParams.get('next'),
    '/dashboard/thesis?advisorId=lec-9',
    'the unlocalized page plus its query survives as next',
  );
});

test('the auth-context session-expired redirect keeps the requested page', () => {
  const source = read('src/context/AuthContext.tsx');
  assert.match(
    source,
    /loginHref\(\s*href,\s*portalFromPathname\([^)]*\),\s*'session-expired',\s*[^)]/,
    'useRequireAuth must pass the current page to the session-expired login link',
  );
});

// ---------------------------------------------------------------------------
// The API session-death path
// ---------------------------------------------------------------------------

let compiledApi = null;
function compileApi() {
  if (compiledApi) return compiledApi;
  const relative = 'src/lib/api.ts';
  compiledApi = ts.transpileModule(
    fs.readFileSync(path.join(root, relative), 'utf8'),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
      fileName: relative,
    },
  ).outputText;
  return compiledApi;
}

/** Loads the real API client; `send` answers every call, `responseError` is the interceptor. */
function loadApi(send, { surface, i18nPaths } = {}) {
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
    '@/lib/safe-url': loadTs('src/lib/safe-url.ts'),
    '@/lib/surfaces': { surfaceFromHost: () => surface ?? null },
    '@/i18n/paths': i18nPaths ?? {
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
    handle: (error) => {
      assert.ok(responseError, 'the response interceptor is registered');
      return responseError(error);
    },
  };
}

function installBrowser({ host = 'localhost:3000', pathname = '/dashboard/register', search = '' } = {}) {
  const previousWindow = global.window;
  const previousDocument = global.document;
  const location = { pathname, search, host, origin: `http://${host}`, href: '' };
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

async function settle() {
  for (let pass = 0; pass < 6; pass += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

test('a dead session lands on login carrying the requested page', async () => {
  const { handle } = loadApi(({ url }) => {
    if (url === '/auth/refresh') throw { response: { status: 400, data: {} } };
    if (url === '/auth/me') throw { response: { status: 401, headers: {}, data: {} } };
    return { data: {} };
  });
  const browser = installBrowser({ pathname: '/dashboard/register', search: '?section=12' });
  try {
    await assert.rejects(handle({ config: { url: '/profile', method: 'get' }, response: { status: 401, headers: {}, data: {} } }));
    await settle();
    const url = new URL(browser.location.href, 'http://portal.test');
    assert.equal(url.searchParams.get('reason'), 'session-expired');
    assert.equal(
      url.searchParams.get('next'),
      '/dashboard/register?section=12',
      'the session-death redirect must carry the requested page',
    );
  } finally {
    browser.restore();
  }
});

test('a BFF surface keeps its full-page SSO return untouched', async () => {
  const { handle } = loadApi(
    ({ url }) => {
      if (url === '/auth/refresh') throw { response: { status: 400, data: {} } };
      if (url === '/auth/me') throw { response: { status: 401, headers: {}, data: {} } };
      return { data: {} };
    },
    { surface: { mode: 'bff' } },
  );
  const browser = installBrowser({ host: 'portal.localhost:3102', pathname: '/dashboard/thesis', search: '' });
  try {
    await assert.rejects(handle({ config: { url: '/profile', method: 'get' }, response: { status: 401, headers: {}, data: {} } }));
    await settle();
    assert.equal(
      browser.location.href,
      `/session/login?return=${encodeURIComponent('/dashboard/thesis')}`,
      'the Java-allowlisted SSO return still carries the live path',
    );
  } finally {
    browser.restore();
  }
});

test('a BFF surface return strips the locale prefix before the allowlist', async () => {
  const { handle } = loadApi(
    ({ url }) => {
      if (url === '/auth/refresh') throw { response: { status: 400, data: {} } };
      if (url === '/auth/me') throw { response: { status: 401, headers: {}, data: {} } };
      return { data: {} };
    },
    { surface: { mode: 'bff' }, i18nPaths: loadTs('src/i18n/paths.ts') },
  );
  const browser = installBrowser({ host: 'portal.localhost:3102', pathname: '/vi/admin/users', search: '' });
  try {
    await assert.rejects(handle({ config: { url: '/profile', method: 'get' }, response: { status: 401, headers: {}, data: {} } }));
    await settle();
    assert.equal(
      browser.location.href,
      `/session/login?return=${encodeURIComponent('/admin/users')}`,
      'the SSO return must carry the locale-stripped path the allowlist understands',
    );
  } finally {
    browser.restore();
  }
});

// ---------------------------------------------------------------------------
// The login page consumes next for credentials, two-factor, and the SSO leg
// ---------------------------------------------------------------------------

function loginStubs(runtime, pushed, { search = '', login, verifyTwoFactor }) {
  return {
    react: runtime.fakeReact,
    'react/jsx-runtime': require('react/jsx-runtime'),
    'next/navigation': {
      useRouter: () => ({ push: (href) => pushed.push(href), replace: () => {} }),
      useSearchParams: () => new URLSearchParams(search),
    },
    axios: { AxiosError: class AxiosError extends Error {} },
    'lucide-react': iconStub,
    '@/context/AuthContext': {
      useAuth: () => ({
        login,
        verifyTwoFactor,
        logout: async () => {},
      }),
    },
    '@/components/auth/AuthShell': {
      AuthShell: ({ children }) => React.createElement('div', null, children),
    },
    '@/components/LocalizedLink': {
      LocalizedLink: ({ href, children, ...rest }) => React.createElement('a', { href, ...rest }, children),
    },
    '@/components/ui/button': {
      Button: ({ children, ...rest }) => React.createElement(
        'button',
        { type: rest.type ?? 'button', disabled: rest.disabled },
        children,
      ),
    },
    '@/components/ui/input': {
      Input: ({ icon, endAction, ...rest }) => React.createElement('input', rest),
    },
    '@/i18n': {
      useI18n: () => ({ href: identity, messages, locale: 'vi' }),
    },
    '@/lib/api': {
      API_BASE_URL: 'http://127.0.0.1:9/api/v1',
      SessionVerificationError: class SessionVerificationError extends Error {},
    },
  };
}

const studentUser = { id: 'user-1', roles: ['STUDENT'], role: 'STUDENT' };

async function renderLogin({ host = 'localhost:3000', search = '', auth = {}, lane } = {}) {
  const runtime = createRuntime();
  const { windowStub } = installBrowserEnv();
  windowStub.location = { host, pathname: '/login', search: '' };
  const pushed = [];
  const previousLane = process.env.NEXT_PUBLIC_BFF_LANE;
  if (lane === undefined) delete process.env.NEXT_PUBLIC_BFF_LANE;
  else process.env.NEXT_PUBLIC_BFF_LANE = lane;
  const previousFetch = global.fetch;
  global.fetch = async () => ({ ok: true });
  const page = loadTs('src/app/login/page.tsx', loginStubs(runtime, pushed, {
    search,
    login: auth.login ?? (async () => studentUser),
    verifyTwoFactor: auth.verifyTwoFactor ?? (async () => studentUser),
  }), { cache: false });
  const render = async () => {
    let tree = null;
    for (let pass = 0; pass < 4; pass += 1) {
      const rendered = runtime.render(page.default, {});
      runtime.runEffects(rendered.effects);
      tree = rendered.tree;
      await flush();
    }
    return tree;
  };
  try {
    const tree = await render();
    return { tree, pushed, render, page, runtime };
  } finally {
    global.fetch = previousFetch;
    if (previousLane === undefined) delete process.env.NEXT_PUBLIC_BFF_LANE;
    else process.env.NEXT_PUBLIC_BFF_LANE = previousLane;
  }
}

function submitForm(tree) {
  const form = elements(tree).find((node) => node.type === 'form');
  assert.ok(form, 'a form renders');
  form.props.onSubmit({ preventDefault: () => {} });
}

test('the credential form returns the visitor to the requested page', async () => {
  const { tree, pushed } = await renderLogin({
    search: 'portal=student&next=%2Fdashboard%2Fgrades',
  });
  submitForm(tree);
  await flush();
  assert.deepEqual(pushed, ['/dashboard/grades'], 'finishLogin must consume next, not the portal root');
});

test('the two-factor step returns to the same requested page', async () => {
  const session = await renderLogin({
    search: 'portal=student&next=%2Fdashboard%2Fgrades',
    auth: {
      login: async () => ({ twoFactorRequired: true, challengeId: 'ch-1', email: 's@x.edu' }),
      verifyTwoFactor: async () => studentUser,
    },
  });
  submitForm(session.tree);
  let tree = await session.render();

  const otp = elements(tree).find((node) => node.props.id === 'otp-code');
  assert.ok(otp, 'the code field renders after the challenge');
  otp.props.onChange({ target: { value: '123456' } });
  tree = await session.render();
  submitForm(tree);
  await flush();
  assert.deepEqual(session.pushed, ['/dashboard/grades'], 'the verified login keeps the same next');
});

test('the portal tabs preserve the requested page', async () => {
  const { tree } = await renderLogin({
    search: 'portal=student&reason=unauthorized&next=%2Fdashboard%2Fgrades',
  });
  const tabs = elements(tree).filter((node) => node.props.role === 'tab');
  assert.equal(tabs.length > 0, true, 'portal tabs render');
  for (const tab of tabs) {
    const url = new URL(tab.props.href, 'http://portal.test');
    assert.equal(url.searchParams.get('reason'), 'unauthorized');
    assert.equal(
      url.searchParams.get('next'),
      '/dashboard/grades',
      `the ${url.searchParams.get('portal')} tab keeps the requested page`,
    );
  }
});

test('hostile next values fall back to the portal root', async () => {
  for (const hostile of [
    '//evil.example',
    'https://evil.example/x',
    'javascript:alert(1)',
    '/\\evil.example',
    '/%2f%2fevil.example',
  ]) {
    const { tree, pushed } = await renderLogin({
      search: `portal=student&next=${encodeURIComponent(hostile)}`,
    });
    submitForm(tree);
    await flush();
    assert.deepEqual(pushed, ['/dashboard'], `${hostile} must not become the landing page`);
  }
});

test('a login without next still lands on the portal root', async () => {
  const { tree, pushed } = await renderLogin({
    search: 'portal=lecturer',
    auth: { login: async () => ({ id: 'user-2', roles: ['LECTURER'], role: 'LECTURER' }) },
  });
  submitForm(tree);
  await flush();
  assert.deepEqual(pushed, ['/dashboard/lecturer']);
});

test('the BFF SSO return uses the same validated next', async () => {
  const { tree } = await renderLogin({
    host: 'portal.localhost:3102',
    search: 'portal=student&next=%2Fdashboard%2Fthesis',
  });
  const sso = elements(tree).find((node) =>
    String(node.props.href ?? '').startsWith('/session/login?return='),
  );
  assert.ok(sso, 'the SSO action renders on the BFF host');
  assert.equal(
    sso.props.href,
    `/session/login?return=${encodeURIComponent('/dashboard/thesis')}`,
    'the SSO return carries the requested page, not the portal root',
  );
});

test('the BFF SSO return rejects a hostile next the same way', async () => {
  const { tree } = await renderLogin({
    host: 'portal.localhost:3102',
    search: 'portal=student&next=https%3A%2F%2Fevil.example',
  });
  const sso = elements(tree).find((node) =>
    String(node.props.href ?? '').startsWith('/session/login?return='),
  );
  assert.ok(sso, 'the SSO action renders on the BFF host');
  assert.equal(
    sso.props.href,
    `/session/login?return=${encodeURIComponent('/dashboard')}`,
    'a hostile next degrades to the portal root, never to an external URL',
  );
});
