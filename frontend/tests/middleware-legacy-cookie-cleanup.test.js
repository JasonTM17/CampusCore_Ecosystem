const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');

function loadTsModule(relativePath, stubs = {}, env = {}) {
  const source = fs.readFileSync(path.join(root, relativePath), 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const moduleRecord = { exports: {} };
  const resolve = (specifier) =>
    Object.prototype.hasOwnProperty.call(stubs, specifier) ? stubs[specifier] : require(specifier);
  Function('module', 'exports', 'require', 'process', output)(
    moduleRecord,
    moduleRecord.exports,
    resolve,
    { env },
  );
  return moduleRecord.exports;
}

const LOCALE_STUB = {
  '@/i18n/config': {
    defaultLocale: 'vi',
    isLocale: (value) => value === 'vi' || value === 'en',
  },
};

class TestNextResponse {
  constructor(body, init = {}) {
    this.body = body;
    this.status = init.status ?? 200;
    this.headers = new Headers(init.headers);
    this.cookieWrites = [];
    this.cookies = {
      set: (name, value, options = {}) => {
        this.cookieWrites.push({ name, value, options });
        const parts = [`${name}=${value}`];
        if (options.path) parts.push(`Path=${options.path}`);
        if (options.maxAge !== undefined) parts.push(`Max-Age=${options.maxAge}`);
        if (options.sameSite) parts.push(`SameSite=${options.sameSite}`);
        this.headers.append('set-cookie', parts.join('; '));
      },
    };
  }

  static next(init = {}) {
    return new TestNextResponse(null, init);
  }

  static redirect(url, status) {
    return new TestNextResponse(null, { status, headers: { location: String(url) } });
  }
}

function loadMiddleware() {
  const paths = loadTsModule('src/i18n/paths.ts', LOCALE_STUB);
  const surfaces = loadTsModule('src/lib/surfaces.ts');
  return loadTsModule('src/middleware.ts', {
    'next/server': { NextResponse: TestNextResponse },
    ...LOCALE_STUB,
    '@/i18n/paths': paths,
    '@/lib/surfaces': surfaces,
  });
}

function request(host, pathname, cookies = [], protocol = 'https:') {
  const jar = new Map(cookies.map((cookie) => [cookie.name, cookie]));
  const cookieHeader = cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ');
  return {
    headers: new Headers({ host, cookie: cookieHeader }),
    nextUrl: { protocol, pathname, search: '' },
    cookies: {
      getAll: () => [...jar.values()],
      get: (name) => jar.get(name),
    },
  };
}

function expiredCookieNames(response) {
  return response.cookieWrites
    .filter((write) => write.options.maxAge === 0)
    .map((write) => write.name)
    .sort();
}

// The post-callback navigation jar: the BFF session pair plus the direct
// lane leftovers the cleanup exists to sweep, the locale preference, and an
// unlisted cc_* name that must fall outside the deletion allowlist.
const POST_LOGIN_JAR = [
  { name: '__Host-cu_session', value: 'opaque-session' },
  { name: 'cc_csrf', value: 'session-csrf-token' },
  { name: 'cc_access_token', value: 'stale-access' },
  { name: 'cc_refresh_token', value: 'stale-refresh' },
  { name: 'cc_locale', value: 'vi' },
  { name: 'cc_mystery', value: 'unlisted' },
];

test('locale-prefixed navigation on a BFF surface expires only the legacy token cookies', () => {
  const { middleware } = loadMiddleware();

  for (const host of ['www.campusute.io.vn', 'portal.localhost']) {
    const response = middleware(request(host, '/vi/dashboard', POST_LOGIN_JAR));

    assert.deepEqual(expiredCookieNames(response), ['cc_access_token', 'cc_refresh_token']);
    assert.equal(
      response.cookieWrites.filter((write) => write.name === 'cc_csrf').length,
      0,
      `${host} must never write a Set-Cookie for the BFF session hint`,
    );
  }
});

test('unprefixed navigation on a BFF surface keeps the session hint and sweeps stale tokens', () => {
  const { middleware } = loadMiddleware();

  const response = middleware(request('learn.campusute.io.vn', '/dashboard', POST_LOGIN_JAR));

  assert.deepEqual(expiredCookieNames(response), ['cc_access_token', 'cc_refresh_token']);
  assert.equal(
    response.cookieWrites.filter((write) => write.name === 'cc_csrf').length,
    0,
    'must never write a Set-Cookie for the BFF session hint',
  );
});

test('the legacy single-host lane never sweeps session cookies', () => {
  const { middleware } = loadMiddleware();

  const response = middleware(request('localhost:3000', '/dashboard', POST_LOGIN_JAR, 'http:'));

  assert.equal(response.cookieWrites.length, 0);
});
