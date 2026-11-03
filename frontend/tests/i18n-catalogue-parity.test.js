const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function loadModule(relativePath, aliases = {}) {
  const code = read(relativePath);
  const output = ts.transpileModule(code, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const moduleRecord = { exports: {} };
  const resolve = (specifier) => {
    if (Object.hasOwn(aliases, specifier)) return aliases[specifier];
    if (specifier.startsWith('.')) {
      const resolvedPath = path.resolve(path.dirname(path.join(root, relativePath)), specifier);
      for (const ext of ['.ts', '.tsx', '.js', '/index.ts', '/index.tsx']) {
        const p = resolvedPath + ext;
        if (fs.existsSync(p)) return loadModule(path.relative(root, p), aliases);
      }
    }
    return {};
  };
  Function('module', 'exports', 'require', output)(moduleRecord, moduleRecord.exports, resolve);
  return moduleRecord.exports;
}

function placeholders(val) {
  return [...String(val).matchAll(/\{([A-Za-z0-9_]+)\}/g)].map(m => m[1]).sort();
}

function assertCatalogParity(en, vi, prefix, options = {}) {
  if (en === undefined && vi === undefined) return;
  assert.notEqual(en, undefined, `${prefix} is missing in EN`);
  assert.notEqual(vi, undefined, `${prefix} is missing in VI`);

  if (Array.isArray(en)) {
    assert.ok(Array.isArray(vi), `${prefix} must be an array in both locales`);
    assert.equal(vi.length, en.length, `${prefix} array lengths must match`);
    en.forEach((item, idx) => assertCatalogParity(item, vi[idx], `${prefix}[${idx}]`, options));
    return;
  }

  if (typeof en === 'object' && en !== null) {
    assert.ok(typeof vi === 'object' && vi !== null && !Array.isArray(vi), `${prefix} must be an object in both locales`);
    const enKeys = Object.keys(en).sort();
    const viKeys = Object.keys(vi).sort();
    assert.deepEqual(enKeys, viKeys, `${prefix} keys must match`);
    for (const k of enKeys) {
      assertCatalogParity(en[k], vi[k], `${prefix}.${k}`, options);
    }
    return;
  }

  if (typeof en === 'string' && typeof vi === 'string') {
    assert.notEqual(en.trim(), '', `${prefix} EN must not be empty`);
    assert.notEqual(vi.trim(), '', `${prefix} VI must not be empty`);
    if (options.skipPlaceholderKeys && options.skipPlaceholderKeys.includes(prefix)) {
      return;
    }
    const enPh = placeholders(en);
    const viPh = placeholders(vi);
    assert.deepEqual(enPh, viPh, `${prefix} placeholders must match: en has [${enPh}], vi has [${viPh}]`);
  }
}

const fragments = [
  ['@/i18n/messages-thesis-workflow', 'src/i18n/messages-thesis-workflow.ts'],
  ['@/i18n/messages-dean-overview', 'src/i18n/messages-dean-overview.ts'],
  ['@/i18n/messages-content', 'src/i18n/messages-content.ts'],
  ['@/i18n/messages-attendance-geofence', 'src/i18n/messages-attendance-geofence.ts'],
  ['@/i18n/messages-teaching-pages', 'src/i18n/messages-teaching-pages.ts'],
  ['@/i18n/messages-admin-pages', 'src/i18n/messages-admin-pages.ts'],
  ['@/i18n/messages-student-pages', 'src/i18n/messages-student-pages.ts'],
];

const aliases = { '@/i18n/config': {} };
for (const [spec, f] of fragments) {
  aliases[spec] = loadModule(f);
}

test('frontend catalogues define matching recursive keys and placeholders', () => {
  const i18nDir = path.join(root, 'src/i18n');
  const files = fs.readdirSync(i18nDir).filter(f => f.endsWith('.ts') && !['config.ts', 'paths.ts', 'resolve-locale.ts', 'server.ts'].includes(f));

  const skipOptions = {
    // certificates.cityDateLine intentionally formats {date} in English and {day}/{month}/{year} in Vietnamese
    skipPlaceholderKeys: [
      'messages.ts.certificates.cityDateLine',
      'messages.ts.dictionaries.certificates.cityDateLine',
    ],
  };

  let catalogCount = 0;
  for (const f of files) {
    const mod = loadModule(`src/i18n/${f}`, aliases);
    if (mod.en && mod.vi) {
      catalogCount++;
      assertCatalogParity(mod.en, mod.vi, f, skipOptions);
    }
    for (const key of Object.keys(mod)) {
      if (mod[key] && typeof mod[key] === 'object' && mod[key].en && mod[key].vi) {
        catalogCount++;
        assertCatalogParity(mod[key].en, mod[key].vi, `${f}.${key}`, skipOptions);
      }
      if (key.endsWith('En')) {
        const base = key.slice(0, -2);
        const viKey = base + 'Vi';
        if (mod[viKey]) {
          catalogCount++;
          assertCatalogParity(mod[key], mod[viKey], `${f}.${base}`, skipOptions);
        }
      }
    }
  }
  assert.ok(catalogCount >= 22, `Expected at least 22 catalogues tested, found ${catalogCount}`);
});

test('Vietnamese catalogue translates the department banner and the geofence campus column', () => {
  const academics = loadModule('src/i18n/messages-admin-academics.ts', aliases);
  const geofence = loadModule('src/i18n/messages-attendance-geofence.ts', aliases);

  const pairs = [
    ['departments banner image alt', academics.adminAcademicsEn.departments.banner.imageAlt, academics.adminAcademicsVi.departments.banner.imageAlt],
    ['departments banner lab label', academics.adminAcademicsEn.departments.banner.labLabel, academics.adminAcademicsVi.departments.banner.labLabel],
    ['geofence campus column', geofence.attendanceGeofenceEn.admin.colCampus, geofence.attendanceGeofenceVi.admin.colCampus],
  ];

  for (const [label, en, vi] of pairs) {
    assert.notEqual(en, undefined, `${label} is missing in EN`);
    assert.notEqual(vi, undefined, `${label} is missing in VI`);
    assert.notEqual(vi, en, `${label} must be translated in the VI catalogue, not copied from EN`);
  }
});

test('admin analytics charts reads distribution copy from the catalogue', () => {
  const charts = read('src/components/admin/AdminAnalyticsCharts.tsx');
  assert.doesNotMatch(
    charts,
    /isVi\s*\?\s*['"]Dữ liệu thống kê phân bố sinh viên/,
    'AdminAnalyticsCharts must read noDistributionDescription from the catalogue',
  );
  assert.match(
    charts,
    /opsCopy\.noDistributionDescription/,
    'AdminAnalyticsCharts must bind opsCopy.noDistributionDescription',
  );
});
