const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

let ts;
try {
  ts = require('typescript');
} catch {
  ts = require(path.resolve(__dirname, '../node_modules/typescript'));
}

const root = path.resolve(__dirname, '..');

function loadHubModules() {
  const source = fs.readFileSync(path.join(root, 'src/lib/hub-modules.ts'), 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const moduleRecord = { exports: {} };
  Function('module', 'exports', output)(moduleRecord, moduleRecord.exports);
  return moduleRecord.exports;
}

function resolvePagePath(href) {
  const pathname = href.split('?')[0];
  const relative = pathname === '/' ? 'page.tsx' : `${pathname.replace(/^\//, '')}/page.tsx`;
  return path.join(root, 'src/app', relative);
}

function resolveLocalePagePath(href) {
  const pathname = href.split('?')[0];
  const relative = pathname === '/' ? 'page.tsx' : `${pathname.replace(/^\//, '')}/page.tsx`;
  return path.join(root, 'src/app/[locale]', relative);
}

test('every HUB_MODULES href resolves to an existing canonical app page', () => {
  const { HUB_MODULES } = loadHubModules();
  assert.ok(Array.isArray(HUB_MODULES) && HUB_MODULES.length > 0, 'HUB_MODULES must be a non-empty array');

  for (const item of HUB_MODULES) {
    const pageFile = resolvePagePath(item.href);
    assert.ok(
      fs.existsSync(pageFile),
      `Hub module "${item.key}" has href "${item.href}" which does not resolve to an existing page at "${pageFile}"`,
    );
  }
});

test('every HUB_MODULES href resolves to an existing [locale] shim page', () => {
  const { HUB_MODULES } = loadHubModules();

  for (const item of HUB_MODULES) {
    const localePageFile = resolveLocalePagePath(item.href);
    assert.ok(
      fs.existsSync(localePageFile),
      `Hub module "${item.key}" has href "${item.href}" which lacks [locale] shim at "${localePageFile}"`,
    );
  }
});

test('regression WEB-08: dead routes /admissions, /learning, /events are not used', () => {
  const { HUB_MODULES } = loadHubModules();
  const deadHrefs = ['/admissions', '/learning', '/events'];

  for (const item of HUB_MODULES) {
    const pathname = item.href.split('?')[0];
    assert.ok(
      !deadHrefs.includes(pathname),
      `Hub module "${item.key}" must not use dead href "${item.href}"`,
    );
  }
});

test('publicHubModules and workspaceHubModules return valid routes', () => {
  const { publicHubModules, workspaceHubModules } = loadHubModules();

  const publicMods = publicHubModules();
  assert.ok(publicMods.length > 0, 'publicHubModules must return entries');
  for (const mod of publicMods) {
    assert.ok(fs.existsSync(resolvePagePath(mod.href)), `Public module ${mod.key} href ${mod.href} must exist`);
  }

  const viewers = [
    { signedIn: false, student: false, lecturer: false, admin: false },
    { signedIn: true, student: true, lecturer: false, admin: false },
    { signedIn: true, student: false, lecturer: true, admin: false },
    { signedIn: true, student: false, lecturer: false, admin: true },
  ];

  for (const viewer of viewers) {
    const wsMods = workspaceHubModules(viewer);
    for (const mod of wsMods) {
      assert.ok(fs.existsSync(resolvePagePath(mod.href)), `Workspace module ${mod.key} href ${mod.href} must exist`);
    }
  }
});
