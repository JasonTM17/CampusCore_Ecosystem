const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { renderToStaticMarkup } = require('react-dom/server');

const root = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function loadTsModule(relativePath, stubs = {}, options = {}) {
  const output = ts.transpileModule(read(relativePath), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: options.jsx,
      esModuleInterop: options.esModuleInterop,
    },
  }).outputText;
  const moduleRecord = { exports: {} };
  const resolve = (specifier) =>
    Object.prototype.hasOwnProperty.call(stubs, specifier)
      ? stubs[specifier]
      : require(specifier);
  Function('module', 'exports', 'require', output)(moduleRecord, moduleRecord.exports, resolve);
  return moduleRecord.exports;
}

const messageFragments = {
  '@/i18n/messages-thesis-workflow': { thesisWorkflowEn: {}, thesisWorkflowVi: {} },
  '@/i18n/messages-dean-overview': { deanOverviewEn: {}, deanOverviewVi: {} },
  '@/i18n/messages-content': { contentEn: {}, contentVi: {} },
  '@/i18n/messages-attendance-geofence': {
    attendanceGeofenceEn: {},
    attendanceGeofenceVi: {},
  },
};

function loadCatalog() {
  return loadTsModule('src/i18n/messages.ts', messageFragments);
}

async function loadMetadata(pathname, locale, catalog) {
  const requestHeaders = new Map([
    ['x-cc-locale', locale],
    ['x-cc-stripped-pathname', pathname],
  ]);
  const stubs = {
    'next/cache': { unstable_noStore() {} },
    'next/headers': {
      headers: async () => ({ get: (name) => requestHeaders.get(name) ?? null }),
      cookies: async () => ({ get: () => undefined }),
    },
    '@/i18n/config': loadTsModule('src/i18n/config.ts'),
    '@/i18n/messages': catalog,
    '@/i18n/paths': {
      buildCanonicalPath: (pathValue, language) => `/${language}${pathValue === '/' ? '' : pathValue}`,
      getAlternateLanguagePaths: (pathValue) => ({
        en: `/en${pathValue}`,
        vi: `/vi${pathValue}`,
        'x-default': pathValue,
      }),
      stripLocaleFromPathname: (pathValue) => ({ pathname: pathValue, locale: undefined }),
    },
    '@/lib/site': {
      buildSiteUrl: (pathValue) => new URL(pathValue, 'https://campusute.example').toString(),
      getSiteUrl: () => 'https://campusute.example',
    },
  };
  return loadTsModule('src/i18n/server.ts', stubs).getLocalizedMetadata();
}

test('auth-gated surfaces use localized noindex metadata while public routes remain indexable', async () => {
  const catalog = loadCatalog();
  const routes = [
    ['/apply', 'apply'],
    ['/apply/review', 'apply'],
    ['/careers', 'careers'],
    ['/careers/desk', 'careers'],
    ['/library', 'library'],
    ['/library/desk', 'library'],
    ['/session/logged-out', 'session'],
  ];

  for (const locale of ['vi', 'en']) {
    const messages = catalog.getMessages(locale);
    for (const [pathname, key] of routes) {
      const metadata = await loadMetadata(pathname, locale, catalog);
      assert.equal(metadata.robots.index, false, `${locale} ${pathname} must not be indexed`);
      assert.equal(metadata.robots.follow, false, `${locale} ${pathname} links must not be followed`);
      assert.equal(metadata.title.default, messages.meta[key].title, `${locale} ${pathname} title`);
      assert.equal(metadata.openGraph.title, messages.meta[key].title, `${locale} ${pathname} OG title`);
    }

    for (const pathname of ['/', '/hub', '/news']) {
      const metadata = await loadMetadata(pathname, locale, catalog);
      assert.equal(metadata.robots.index, true, `${locale} public route ${pathname} stays indexable`);
      assert.equal(metadata.robots.googleBot.index, true, `${locale} public route ${pathname} stays indexable for Google`);
    }
  }
});

test('logged-out page renders its locale copy and preserves the home link', async () => {
  const catalog = loadCatalog();

  for (const locale of ['vi', 'en']) {
    const messages = catalog.getMessages(locale);
    const copy = messages.session?.loggedOut;
    assert.ok(copy, `${locale} logged-out copy is required`);

    const page = loadTsModule('src/app/session/logged-out/page.tsx', {
      'next/link': 'a',
      '@/i18n/server': { getRequestLocale: async () => locale },
      '@/i18n/messages': catalog,
      'react/jsx-runtime': require('react/jsx-runtime'),
    }, { jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true }).default;
    const markup = renderToStaticMarkup(await page());

    assert.ok(markup.includes(copy.title), `${locale} heading is rendered`);
    assert.ok(markup.includes(copy.body), `${locale} sign-out message is rendered`);
    assert.ok(markup.includes(copy.returnHome), `${locale} home action is rendered`);
    assert.match(markup, /<a href="\/"/);
    const otherLocale = catalog.getMessages(locale === 'en' ? 'vi' : 'en');
    const otherTitle = otherLocale.session.loggedOut.title;
    assert.notEqual(copy.title, otherTitle);
    assert.equal(markup.includes(otherTitle), false, `${locale} page does not render the other locale heading`);
  }
});
