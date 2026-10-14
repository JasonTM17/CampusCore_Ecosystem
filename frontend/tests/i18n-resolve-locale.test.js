const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');

async function loadTsModule(file) {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: path.basename(file),
  });
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
}

async function loadResolveLocale() {
  const realConfig = await loadTsModule('src/i18n/config.ts');
  const source = fs.readFileSync(path.join(root, 'src/i18n/resolve-locale.ts'), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: 'resolve-locale.ts',
  });
  const mod = { exports: {} };
  const requireStub = (spec) => {
    if (spec === '@/i18n/config') return realConfig;
    throw new Error(`unexpected import in resolve-locale.ts: ${spec}`);
  };
  new Function('require', 'module', 'exports', outputText)(requireStub, mod, mod.exports);
  return mod.exports;
}

test('the URL locale prefix wins over the cookie and the server-rendered locale', async () => {
  const { resolveClientLocale } = await loadResolveLocale();
  assert.equal(resolveClientLocale({ routeLocale: 'vi', cookieLocale: 'en', serverLocale: 'en' }), 'vi');
  assert.equal(resolveClientLocale({ routeLocale: 'en', cookieLocale: 'vi', serverLocale: 'vi' }), 'en');
});

test('a valid cookie beats the server-rendered locale when the URL has no prefix', async () => {
  const { resolveClientLocale } = await loadResolveLocale();
  // Cookie changed after SSR (e.g. locale switch on a prefixed page followed
  // by an unprefixed navigation): the freshest client-side truth wins.
  assert.equal(resolveClientLocale({ cookieLocale: 'en', serverLocale: 'vi' }), 'en');
  assert.equal(resolveClientLocale({ cookieLocale: 'vi', serverLocale: 'en' }), 'vi');
});

test('invalid or missing cookie values fall back to the server-rendered locale', async () => {
  const { resolveClientLocale } = await loadResolveLocale();
  for (const bad of ['fr', 'en-US', 'EN', '', 'null', 'undefined']) {
    assert.equal(
      resolveClientLocale({ cookieLocale: bad, serverLocale: 'en' }),
      'en',
      `cookie=${JSON.stringify(bad)} should fall through to serverLocale`,
    );
  }
  assert.equal(resolveClientLocale({ serverLocale: 'en' }), 'en');
});

test('the default locale applies only when nothing else is usable', async () => {
  const { resolveClientLocale } = await loadResolveLocale();
  assert.equal(resolveClientLocale({}), 'vi');
  assert.equal(resolveClientLocale({ routeLocale: 'de', cookieLocale: 'xx' }), 'vi');
});

test('readLocaleCookie extracts only the cc_locale value', async () => {
  const { readLocaleCookie } = await loadResolveLocale();
  assert.equal(readLocaleCookie('cc_locale=en'), 'en');
  assert.equal(readLocaleCookie('a=1; cc_locale=vi; b=2'), 'vi');
  assert.equal(readLocaleCookie('cc_locale=vi'), 'vi');
  assert.equal(readLocaleCookie('cc_theme=dark'), null);
  // A different cookie whose name merely contains the key must not match.
  assert.equal(readLocaleCookie('xcc_locale=en'), null);
  assert.equal(readLocaleCookie(''), null);
  assert.equal(readLocaleCookie('cc_locale='), '');
});

test('readLocaleCookie decodes encoded values without throwing on malformed input', async () => {
  const { readLocaleCookie } = await loadResolveLocale();
  assert.equal(readLocaleCookie('cc_locale=%65n'), 'en');
  assert.equal(readLocaleCookie('cc_locale=%E0%A4%A'), '%E0%A4%A');
});

function loadTsCommonJs(file, stubs) {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: path.basename(file),
  });
  const mod = { exports: {} };
  const requireStub = (spec) => {
    if (spec in stubs) return stubs[spec];
    throw new Error(`unexpected import in ${file}: ${spec}`);
  };
  new Function('require', 'module', 'exports', outputText)(requireStub, mod, mod.exports);
  return mod.exports;
}

class FakeNextRequest {
  constructor(url, headers = {}) {
    this.nextUrl = new URL(url);
    this.headers = new Headers(headers);
    const jar = new Map();
    for (const part of (this.headers.get('cookie') ?? '').split(';')) {
      const [key, ...rest] = part.trim().split('=');
      if (key) jar.set(key, rest.join('='));
    }
    this.cookies = {
      get: (name) => (jar.has(name) ? { name, value: jar.get(name) } : undefined),
    };
  }
}

const FakeNextResponse = {
  next(init = {}) {
    const response = {
      requestHeaders: init.request?.headers ?? new Headers(),
      headers: new Headers(),
      _setCookies: [],
      cookies: {
        set(name, value, options) {
          response._setCookies.push({ name, value, options });
        },
      },
    };
    return response;
  },
};

async function loadMiddleware() {
  const realConfig = await loadTsModule('src/i18n/config.ts');
  const realPaths = loadTsCommonJs('src/i18n/paths.ts', { '@/i18n/config': realConfig });
  return loadTsCommonJs('src/middleware.ts', {
    '@/i18n/config': realConfig,
    '@/i18n/paths': realPaths,
    'next/server': { NextRequest: FakeNextRequest, NextResponse: FakeNextResponse },
  });
}

test('prefetch requests never receive a cc_locale response cookie but still get the route locale', async () => {
  const { middleware } = await loadMiddleware();
  const prefetchHeaders = [
    { 'next-router-prefetch': '1' },
    { 'next-router-prefetch': '2' },
    { 'next-router-prefetch': '1', rsc: '1', 'next-url': '/login' },
    { rsc: '1' },
    { purpose: 'prefetch' },
    { 'sec-purpose': 'prefetch' },
    { 'sec-purpose': 'prefetch; prerender' },
    { 'sec-fetch-dest': 'empty' },
    { 'sec-fetch-dest': 'empty', rsc: '1', 'next-url': '/login' },
  ];
  for (const extra of prefetchHeaders) {
    const response = middleware(new FakeNextRequest('http://local.test/en/login', {
      cookie: 'cc_locale=vi',
      ...extra,
    }));
    assert.equal(
      response._setCookies.length,
      0,
      `speculative request ${JSON.stringify(extra)} must not rotate cc_locale`,
    );
    assert.equal(response.requestHeaders.get('x-cc-locale'), 'en', `route locale lost for ${JSON.stringify(extra)}`);
    assert.match(response.requestHeaders.get('cookie') ?? '', /cc_locale=en/);
  }
});

test('committed prefixed navigations still persist the selected locale', async () => {
  const { middleware } = await loadMiddleware();
  for (const [pathname, expected] of [['/vi/login', 'vi'], ['/en/login', 'en']]) {
    const response = middleware(new FakeNextRequest(`http://local.test${pathname}`));
    assert.deepEqual(
      response._setCookies.map((entry) => [entry.name, entry.value]),
      [['cc_locale', expected]],
      `${pathname} should write the committed locale`,
    );
  }
});

test('unprefixed requests honor the saved cookie and never write cc_locale', async () => {
  const { middleware } = await loadMiddleware();
  const response = middleware(new FakeNextRequest('http://local.test/login', {
    cookie: 'cc_locale=en',
  }));
  assert.equal(response.requestHeaders.get('x-cc-locale'), 'en');
  assert.equal(response._setCookies.length, 0);
});

test('bypassed API paths carry no locale request override or response cookie', async () => {
  const { middleware } = await loadMiddleware();
  const response = middleware(new FakeNextRequest('http://local.test/api/v1/auth/login', {
    cookie: 'cc_locale=en',
  }));
  assert.equal(response.requestHeaders.get('x-cc-locale'), null);
  assert.equal(response._setCookies.length, 0);
});
