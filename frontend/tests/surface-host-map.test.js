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

const partialOverrides = JSON.stringify([
  { surface: 'portal', host: 'portal.preview.example', devHost: 'portal-preview.localhost' },
]);

function loadSurfaces() {
  return loadTsModule('src/lib/surfaces.ts', {}, { NEXT_PUBLIC_SURFACE_HOSTS: partialOverrides });
}

class TestNextResponse {
  constructor(body, init = {}) {
    this.body = body;
    this.status = init.status ?? 200;
    this.headers = new Headers(init.headers);
  }

  static next() {
    return new TestNextResponse(null);
  }

  static redirect(url, status) {
    return new TestNextResponse(null, { status, headers: { location: String(url) } });
  }
}

function loadMiddleware() {
  const surfaces = loadSurfaces();
  return loadTsModule('src/middleware.ts', {
    'next/server': { NextResponse: TestNextResponse },
    '@/i18n/config': {
      defaultLocale: 'vi',
      isLocale: (value) => value === 'vi' || value === 'en',
    },
    '@/i18n/paths': {
      isBypassedPath: () => false,
      stripLocaleFromPathname: (pathname) => ({ pathname, locale: undefined }),
    },
    '@/lib/surfaces': surfaces,
  }, { NEXT_PUBLIC_SURFACE_HOSTS: partialOverrides });
}

function request(host, protocol = 'https:', pathname = '/apply', search = '?source=preview') {
  return {
    headers: new Headers({ host }),
    nextUrl: { protocol, pathname, search },
    cookies: { getAll: () => [] },
  };
}

test('partial surface overrides retain static hosts and drive both base URL helpers', () => {
  const surfaces = loadSurfaces();

  assert.equal(surfaces.surfaceFromHost('www.campusute.io.vn')?.id, 'portal');
  assert.equal(surfaces.surfaceFromHost('portal.preview.example')?.host, 'portal.preview.example');
  assert.equal(surfaces.surfaceFromHost('portal.localhost')?.devHost, 'portal-preview.localhost');
  assert.equal(surfaces.surfaceFromHost('unknown.preview.example'), null);
  assert.equal(surfaces.baseFor('portal'), 'https://portal.preview.example');
  assert.equal(surfaces.baseFor('portal', true), 'http://portal-preview.localhost');
  assert.equal(
    surfaces.devBaseFor('portal', 'http', 'apex.localhost:3102'),
    'http://portal-preview.localhost:3102',
  );
});

test('middleware keeps apex redirects on the effective map and unknown hosts fail closed with 404', () => {
  const { middleware } = loadMiddleware();

  const productionRedirect = middleware(request('campusute.io.vn'));
  assert.equal(productionRedirect.status, 301);
  assert.equal(
    productionRedirect.headers.get('location'),
    'https://portal.preview.example/apply?source=preview',
  );

  const developmentRedirect = middleware(request('apex.localhost:3102', 'http:'));
  assert.equal(developmentRedirect.status, 301);
  assert.equal(
    developmentRedirect.headers.get('location'),
    'http://portal-preview.localhost:3102/apply?source=preview',
  );

  const unknownHost = middleware(request('unmapped.example'));
  assert.equal(unknownHost.status, 404);
  assert.equal(unknownHost.body, 'SURFACE_UNKNOWN');
  assert.equal(unknownHost.headers.get('cache-control'), 'no-store');
});
