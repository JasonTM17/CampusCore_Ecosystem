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
