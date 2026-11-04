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
  '@/i18n/messages-teaching-pages': { teachingPagesEn: {}, teachingPagesVi: {} },
  '@/i18n/messages-admin-pages': { adminPagesEn: {}, adminPagesVi: {} },
  '@/i18n/messages-student-pages': { studentPagesEn: {}, studentPagesVi: {} },
};

function loadCatalog() {
  return loadTsModule('src/i18n/messages.ts', messageFragments);
}

// The logged-out page resolves its home link with the same path helper the
// LocalizedLink component uses, so the test exercises the real implementation
// instead of re-stating the rule.
function loadPathsModule() {
  return loadTsModule('src/i18n/paths.ts', {
    '@/i18n/config': loadTsModule('src/i18n/config.ts'),
  });
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

test('every authenticated surface declares noindex while public routes stay indexable', async () => {
  const catalog = loadCatalog();
  // Every gated surface the app router exposes: credentials and recovery,
  // dashboards, the admin console (including the events console), the three
  // staff desks, the staff start page, applications, check-in, and the
  // post-logout landing. None of them may reach a search index.
  const privateRoutes = [
    ['/login', 'login'],
    ['/forgot-password', 'forgotPassword'],
    ['/reset-password', 'resetPassword'],
    ['/register', 'register'],
    ['/dashboard', 'dashboard'],
    ['/dashboard/lecturer/grades', 'dashboard'],
    ['/dashboard/thesis/topics', 'dashboard'],
    ['/admin', 'admin'],
    ['/admin/events', 'admin'],
    ['/apply', 'apply'],
    ['/apply/review', 'apply'],
    ['/careers/desk', 'careers'],
    ['/library/desk', 'library'],
    ['/session/logged-out', 'session'],
    ['/staff', 'staff'],
    ['/attendance/checkin/session-1', 'checkinLanding'],
  ];

  for (const locale of ['vi', 'en']) {
    const messages = catalog.getMessages(locale);
    for (const [pathname, key] of privateRoutes) {
      const metadata = await loadMetadata(pathname, locale, catalog);
      assert.equal(metadata.robots.index, false, `${locale} ${pathname} must not be indexed`);
      assert.equal(metadata.robots.googleBot.index, false, `${locale} ${pathname} must not reach Google`);
      assert.equal(metadata.title.default, messages.meta[key].title, `${locale} ${pathname} title`);
    }

    // Marketing, news, docs, and the hub directory stay crawlable.
    for (const pathname of ['/', '/hub', '/news', '/docs', '/news/some-story']) {
      const metadata = await loadMetadata(pathname, locale, catalog);
      assert.equal(metadata.robots.index, true, `${locale} public route ${pathname} stays indexable`);
      assert.equal(metadata.robots.googleBot.index, true, `${locale} ${pathname} stays indexable for Google`);
    }
  }
});

test('docs pages publish their own metadata instead of the homepage fallback', async () => {
  const catalog = loadCatalog();

  for (const locale of ['vi', 'en']) {
    const messages = catalog.getMessages(locale);
    const otherLocale = catalog.getMessages(locale === 'vi' ? 'en' : 'vi');
    assert.ok(messages.meta.docs, `${locale} catalogue carries the docs metadata`);
    assert.ok(messages.meta.docs.title.trim(), `${locale} docs title is non-empty`);
    assert.ok(messages.meta.docs.description.trim(), `${locale} docs description is non-empty`);
    assert.notEqual(
      messages.meta.docs.title,
      otherLocale.meta.docs.title,
      `${locale} docs title is localized`,
    );

    for (const pathname of ['/docs', '/docs/registration-policy']) {
      const metadata = await loadMetadata(pathname, locale, catalog);
      assert.equal(
        metadata.title.default,
        messages.meta.docs.title,
        `${locale} ${pathname} carries the docs title, not the homepage title`,
      );
      assert.notEqual(metadata.title.default, messages.meta.home.title);
      assert.equal(metadata.description, messages.meta.docs.description);
      assert.equal(metadata.openGraph.title, messages.meta.docs.title);
      assert.equal(metadata.robots.index, true, `${locale} ${pathname} is a public lane`);
      assert.equal(metadata.robots.follow, true);
    }
  }
});

test('robots.txt disallows every authenticated desk root and keeps public content crawlable', () => {
  const robots = loadTsModule('src/app/robots.ts', {
    '@/lib/site': {
      buildSiteUrl: (pathValue) => new URL(pathValue, 'https://campusute.example').toString(),
      getSiteUrl: () => 'https://campusute.example',
    },
  }).default();

  const rule = robots.rules.find((entry) => entry.userAgent === '*');
  assert.ok(rule, 'the wildcard rule exists');
  const disallowed = new Set(rule.disallow);

  // Desk roots come from STAFF_DESKS (admissions = /apply/review, careers,
  // library); the events and admin consoles sit under /admin/.
  const protectedRoots = [
    '/admin/',
    '/dashboard/',
    '/apply/review',
    '/careers/desk',
    '/library/desk',
    '/staff',
    '/forgot-password',
    '/register',
    '/reset-password',
    '/attendance/checkin/',
  ];
  for (const root of protectedRoots) {
    for (const path of [root, `/en${root}`, `/vi${root}`]) {
      assert.ok(disallowed.has(path), `robots must disallow ${path}`);
    }
  }
  // The canonical desk URLs the audit named are spelled out as well.
  for (const path of ['/apply/review/', '/careers/desk/', '/library/desk/']) {
    assert.ok(disallowed.has(path), `robots must disallow ${path}`);
  }

  // Public marketing, news, docs, and the hub stay reachable for crawlers.
  for (const path of ['/', '/en/', '/vi/', '/login', '/en/login', '/vi/login']) {
    assert.ok(rule.allow.includes(path), `robots must keep ${path} in the allow list`);
  }
  for (const path of ['/news', '/en/news', '/docs', '/en/docs', '/hub', '/careers', '/library', '/apply']) {
    assert.equal(disallowed.has(path), false, `${path} must stay crawlable`);
  }

  assert.equal(robots.sitemap, 'https://campusute.example/sitemap.xml');
});

test('logged-out page renders its locale copy and keeps the home link in that locale', async () => {
  const catalog = loadCatalog();
  const paths = loadPathsModule();

  for (const locale of ['vi', 'en']) {
    const messages = catalog.getMessages(locale);
    const copy = messages.session?.loggedOut;
    assert.ok(copy, `${locale} logged-out copy is required`);

    // Unprefixed visit: the default locale keeps '/' and English moves to
    // '/en'; a prefixed visit keeps its own prefix.
    for (const [prefixed, expectedHref] of [
      [false, locale === 'vi' ? '/' : '/en'],
      [true, `/${locale}`],
    ]) {
      const page = loadTsModule('src/app/session/logged-out/page.tsx', {
        'next/link': 'a',
        '@/i18n/server': {
          getRequestLocale: async () => locale,
          isPrefixedRequest: async () => prefixed,
        },
        '@/i18n/messages': catalog,
        '@/i18n/paths': paths,
        'react/jsx-runtime': require('react/jsx-runtime'),
      }, { jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true }).default;
      const markup = renderToStaticMarkup(await page());

      assert.ok(markup.includes(copy.title), `${locale} heading is rendered`);
      assert.ok(markup.includes(copy.body), `${locale} sign-out message is rendered`);
      assert.ok(markup.includes(copy.returnHome), `${locale} home action is rendered`);
      assert.ok(
        markup.includes(`<a href="${expectedHref}"`),
        `${locale}${prefixed ? ' prefixed' : ''} home link points at ${expectedHref}`,
      );
      const otherLocale = catalog.getMessages(locale === 'en' ? 'vi' : 'en');
      const otherTitle = otherLocale.session.loggedOut.title;
      assert.notEqual(copy.title, otherTitle);
      assert.equal(markup.includes(otherTitle), false, `${locale} page does not render the other locale heading`);
    }
  }
});
