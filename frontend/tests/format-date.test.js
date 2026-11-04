const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function loadTs(relativePath, stubs = {}) {
  const output = ts.transpileModule(read(relativePath), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
    fileName: relativePath,
  }).outputText;
  const moduleRecord = { exports: {} };
  const resolve = (specifier) =>
    Object.prototype.hasOwnProperty.call(stubs, specifier)
      ? stubs[specifier]
      : require(specifier);
  Function('module', 'exports', 'require', output)(moduleRecord, moduleRecord.exports, resolve);
  return moduleRecord.exports;
}

const React = require('react');

function fakeReactHooks() {
  return {
    ...React,
    useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => undefined],
    useEffect: () => undefined,
    useMemo: (factory) => factory(),
    useCallback: (callback) => callback,
    useRef: (initial) => ({ current: initial }),
  };
}

function loadFormatter() {
  const config = loadTs('src/i18n/config.ts');
  const provider = loadTs('src/i18n/index.tsx', {
    react: fakeReactHooks(),
    'next/navigation': { usePathname: () => '/dashboard' },
    '@/i18n/config': config,
    '@/i18n/messages': { getMessages: () => ({}) },
    '@/i18n/paths': {
      buildLocaleSwitchPath: () => '/',
      localizePathname: (pathname) => pathname,
      stripLocaleFromPathname: () => ({ locale: null }),
    },
    '@/i18n/resolve-locale': {
      readLocaleCookie: () => null,
      resolveClientLocale: ({ serverLocale }) => serverLocale,
    },
  }).I18nProvider;
  return (locale) => provider({ locale, isPrefixed: false, children: null }).props.value;
}

const formatters = loadFormatter();
const mobileLocale = loadTs('../mobile/src/i18n/locale.ts');

const ZONES = ['America/Los_Angeles', 'UTC', 'Asia/Tokyo'];
const originalZone = process.env.TZ;

function inZone(zone, run) {
  process.env.TZ = zone;
  try {
    return run();
  } finally {
    process.env.TZ = originalZone;
  }
}

test('civil dates keep their calendar day in every runner time zone', () => {
  for (const zone of ZONES) {
    inZone(zone, () => {
      const vi = formatters('vi');
      const en = formatters('en');
      assert.equal(vi.formatDate('2026-10-30'), '30/10/2026', `${zone} vi civil date`);
      assert.equal(en.formatDate('2026-10-30'), 'Oct 30, 2026', `${zone} en civil date`);
      assert.equal(vi.formatDate('2004-05-15'), '15/05/2004', `${zone} vi birth date`);
      assert.equal(en.formatDate('2004-05-15'), 'May 15, 2004', `${zone} en birth date`);
    });
  }
});

test('instants render on the fixed campus day in every runner time zone', () => {
  for (const zone of ZONES) {
    inZone(zone, () => {
      const vi = formatters('vi');
      const en = formatters('en');
      assert.equal(vi.formatDate('2004-05-15T00:00:00Z'), '15/05/2004', `${zone} vi instant`);
      assert.equal(en.formatDate('2004-05-15T00:00:00Z'), 'May 15, 2004', `${zone} en instant`);
      assert.equal(vi.formatDate('2026-10-29T18:00:00Z'), '30/10/2026', `${zone} vi late instant`);
      assert.equal(en.formatDate('2026-10-29T18:00:00Z'), 'Oct 30, 2026', `${zone} en late instant`);
      const campusStamp = vi.formatDateTime('2026-10-29T18:00:00Z');
      assert.ok(campusStamp.includes('30/10/2026'), `${zone} vi campus date`);
      assert.ok(campusStamp.includes('01:00'), `${zone} vi campus time`);
    });
  }
});

test('the Vietnamese web date matches the mobile formatter exactly', () => {
  const values = [
    '2026-10-30',
    '2004-05-15T00:00:00Z',
    '2026-10-29T18:00:00Z',
  ];
  for (const zone of ZONES) {
    inZone(zone, () => {
      for (const locale of ['vi']) {
        const web = formatters(locale);
        for (const value of values) {
          assert.equal(
            web.formatDate(value),
            mobileLocale.formatDate(value, locale),
            `${zone} ${locale} ${value}`,
          );
        }
      }
    });
  }
});

test('explicit caller time zones still override the campus default', () => {
  inZone('America/Los_Angeles', () => {
    const vi = formatters('vi');
    assert.equal(
      vi.formatDate('2026-10-29T18:00:00Z', { timeZone: 'UTC' }),
      '29/10/2026',
      'an instant formatted in an explicit zone keeps that zone',
    );
    assert.equal(
      vi.formatDate('2026-10-30', { timeZone: 'UTC' }),
      '30/10/2026',
      'a civil date does not move when the display zone is pinned',
    );
  });
});

test('the propose-topic window prints campus dates instead of UTC date parts', () => {
  inZone('America/Los_Angeles', () => {
    const source = read('src/app/dashboard/thesis/page.tsx');
    const tree = ts.createSourceFile('page.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const endpoints = {};
    const visit = (node) => {
      if (ts.isJsxExpression(node) && node.expression) {
        const text = node.expression.getText(tree);
        if (text.includes('lecturerSubmitStart') && !text.includes('lecturerSubmitEnd')) endpoints.start = node.expression;
        if (text.includes('lecturerSubmitEnd') && !text.includes('lecturerSubmitStart')) endpoints.end = node.expression;
      }
      ts.forEachChild(node, visit);
    };
    visit(tree);
    assert.ok(endpoints.start && endpoints.end, 'the propose window renders both endpoints');

    const evaluate = (expression) => {
      const output = ts.transpileModule(
        `module.exports = (currentProposeRound, formatDate) => (${expression.getText(tree)});`,
        { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } },
      ).outputText;
      const record = { exports: {} };
      Function('module', 'exports', output)(record, record.exports);
      return record.exports;
    };

    const vi = formatters('vi');
    const window = {
      lecturerSubmitStart: '2026-11-03T17:00:00.000Z',
      lecturerSubmitEnd: '2026-11-30T17:00:00.000Z',
    };
    const start = evaluate(endpoints.start)(window, vi.formatDate);
    const end = evaluate(endpoints.end)(window, vi.formatDate);
    assert.equal(start, '04/11/2026');
    assert.equal(end, '01/12/2026');
    assert.equal(`${start} → ${end}`.includes('2026-11-03'), false);
  });
});

test('unparseable values keep the shared em dash', () => {
  const vi = formatters('vi');
  assert.equal(vi.formatDate('not-a-date'), '—');
  assert.equal(vi.formatDateTime(''), '—');
  assert.equal(vi.formatDate('2026-13-40'), '—');
});
