const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const PAGE = 'app/admin/appearance/page.tsx';
const CATALOG = 'src/lib/appearance-pin-catalog.ts';

const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

function loadTs(relativePath, deps = {}) {
  const output = ts.transpileModule(read(relativePath), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    fileName: relativePath,
  }).outputText;
  const moduleRecord = { exports: {} };
  const resolve = (specifier) =>
    Object.prototype.hasOwnProperty.call(deps, specifier) ? deps[specifier] : require(specifier);
  Function('module', 'exports', 'require', output)(moduleRecord, moduleRecord.exports, resolve);
  return moduleRecord.exports;
}

// Execute the actual async page callback, supplying its hook/API dependencies —
// the same extraction the workspace fan-out harness uses.
function pageFunction(file, name, dependencies) {
  const source = read('src/' + file);
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let declaration;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(tree) === name) declaration = node;
    ts.forEachChild(node, visit);
  }
  visit(tree);
  assert.ok(declaration, `page callback ${name} exists`);
  const output = ts.transpileModule(`const ${declaration.getText(tree)};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  }).outputText;
  return Function(...Object.keys(dependencies), 'useCallback', 'useMemo', `${output}; return ${name};`)(
    ...Object.values(dependencies),
    (fn) => fn,
    (fn) => fn(),
  );
}

function tryPageFunction(file, name, dependencies) {
  const source = read('src/' + file);
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let declaration;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(tree) === name) declaration = node;
    ts.forEachChild(node, visit);
  }
  visit(tree);
  if (!declaration) return undefined;
  const output = ts.transpileModule(`const ${declaration.getText(tree)};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  }).outputText;
  return Function(...Object.keys(dependencies), 'useCallback', 'useMemo', `${output}; return ${name};`)(
    ...Object.values(dependencies),
    (fn) => fn,
    (fn) => fn(),
  );
}

const flush = async (rounds = 12) => {
  for (let i = 0; i < rounds; i += 1) await new Promise((resolve) => setImmediate(resolve));
};

function pinOption(id, title = `Title ${id}`) {
  return { id, title, status: 'PUBLISHED', isGlobal: true, publishAt: null, createdAt: '2026-08-20T10:00:00Z' };
}

function pageOf(data, total, page = 1, limit = 50) {
  return {
    data,
    meta: { total, page, limit, totalPages: total === 0 ? 0 : Math.ceil(total / limit) },
  };
}

/** API stub that records pin-options calls and bombs on the archive read. */
function apiStub({ pages = 3, pageSize = 50, rows = 120 } = {}) {
  const calls = { pinOptions: [], getAll: [] };
  const catalog = Array.from({ length: rows }, (_, index) => pinOption(`row-${index + 1}`));
  const announcementsApi = {
    pinOptions: async (params = {}) => {
      calls.pinOptions.push({ ...params });
      if (Array.isArray(params.ids)) {
        const wanted = new Set(params.ids);
        return pageOf(
          params.ids.filter((id) => wanted.has(id) && catalog.some((row) => row.id === id))
            .map((id) => catalog.find((row) => row.id === id)),
          wanted.size,
        );
      }
      const page = params.page ?? 1;
      const start = (page - 1) * (params.limit ?? 50);
      return pageOf(catalog.slice(start, start + (params.limit ?? 50)), rows, page, params.limit ?? 50);
    },
    getAll: async (params) => {
      calls.getAll.push({ ...params });
      return pageOf(catalog.slice(0, params?.limit ?? 20), rows, params?.page ?? 1, params?.limit ?? 20);
    },
  };
  return { announcementsApi, calls, catalog };
}

function snapshot(overrides = {}) {
  return {
    appearance: {
      version: 7,
      updatedAt: '2026-09-21T09:00:00.000Z',
      accent: 'ute-yellow',
      hero: { image: '', en: { eyebrow: '', title: '', description: '' }, vi: { eyebrow: '', title: '', description: '' } },
      postOrder: ['row-9', 'row-3'],
      ...overrides,
    },
    expectedVersion: 7,
  };
}

function loadDeps({ announcementsApi, catalog, snapshotValue }) {
  const writes = [];
  const record = (name) => (value) => writes.push([name, value]);
  const catalogModule = loadTs(CATALOG, { '@/lib/api': { announcementsApi } });
  const appearanceLib = loadTs('src/lib/site-appearance.ts');
  const deps = {
    announcementsApi,
    fetchSiteAppearanceSnapshot: async () => snapshotValue,
    sanitizeSiteAppearance: appearanceLib.sanitizeSiteAppearance,
    fetchPinOptionPage: catalogModule.fetchPinOptionPage,
    fetchPinnedAnnouncementRows: catalogModule.fetchPinnedAnnouncementRows,
    setPosts: record('setPosts'),
    setPinnedPosts: record('setPinnedPosts'),
    setPostsPage: record('setPostsPage'),
    setPostsTotalPages: record('setPostsTotalPages'),
    setPostsLoadFailed: record('setPostsLoadFailed'),
    setPostSearch: record('setPostSearch'),
    setIsLoading: record('setIsLoading'),
    setError: record('setError'),
    setStaleConflict: record('setStaleConflict'),
    updateDraft: record('updateDraft'),
    catalogSearchRef: { current: '' },
    storedVersionRef: { current: null },
    staleConflictRef: { current: false },
    copy: { loadFailed: 'LOAD_FAILED' },
  };
  // If the archive burst loader is still declared it must never run; on the
  // bounded implementation the name is unreferenced, so the bomb stays cold.
  deps.fetchAllAnnouncementRows =
    tryPageFunction(PAGE, 'fetchAllAnnouncementRows', deps) ??
    (async () => {
      throw new Error('the full-archive loader must not run');
    });
  return { deps, writes };
}

// ---------- bounded catalog reads, never the archive ----------

test('the pin catalog requests one bounded page and resolves pins by id list', async () => {
  const { announcementsApi, calls } = apiStub();
  const catalogModule = loadTs(CATALOG, { '@/lib/api': { announcementsApi } });

  const page = await catalogModule.fetchPinOptionPage(1, '');
  assert.equal(calls.pinOptions.length, 1);
  assert.equal(calls.pinOptions[0].page, 1);
  assert.ok(
    calls.pinOptions[0].limit > 0 && calls.pinOptions[0].limit <= 200,
    `the page size is bounded by the server cap, saw ${calls.pinOptions[0].limit}`,
  );
  assert.equal(calls.getAll.length, 0, 'the archive read is not part of the pin picker');
  assert.equal(page.meta.totalPages, 3);

  const pinned = await catalogModule.fetchPinnedAnnouncementRows(['row-9', 'row-3', 'row-1']);
  assert.equal(calls.pinOptions.length, 2, 'one id-list read resolves every pin');
  assert.deepEqual(calls.pinOptions[1].ids, ['row-9', 'row-3', 'row-1']);
  assert.deepEqual(
    pinned.map((row) => row.id),
    ['row-9', 'row-3', 'row-1'],
    'pinned rows come back in pin order',
  );
  assert.equal(calls.getAll.length, 0);

  assert.deepEqual(await catalogModule.fetchPinnedAnnouncementRows([]), [], 'no pins cost no request');
  assert.equal(calls.pinOptions.length, 2);
});

test('the appearance loader issues one catalog page plus one pin resolution', async () => {
  const { announcementsApi, calls } = apiStub({ rows: 900 });
  const { deps, writes } = loadDeps({
    announcementsApi,
    snapshotValue: snapshot(),
  });

  const load = pageFunction(PAGE, 'load', deps);
  await load();
  await flush();

  assert.equal(calls.getAll.length, 0, 'the archive burst is gone');
  const catalogReads = calls.pinOptions.filter((params) => params.ids === undefined);
  const pinReads = calls.pinOptions.filter((params) => Array.isArray(params.ids));
  assert.equal(catalogReads.length, 1, 'one bounded page, not a totalPages burst');
  assert.ok(catalogReads[0].limit <= 200, `bounded limit, saw ${catalogReads[0].limit}`);
  assert.equal(pinReads.length, 1, 'pinned items resolve by id, not by crawling');
  assert.deepEqual(pinReads[0].ids, ['row-9', 'row-3']);

  const writes_ = new Map();
  for (const [name, value] of writes) writes_.set(name, value);
  assert.equal(writes_.get('setPostsPage'), 1);
  assert.equal(writes_.get('setPostsTotalPages'), 18);
  assert.equal(writes_.get('setPostsLoadFailed'), false);
  const pinned = writes_.get('setPinnedPosts');
  assert.deepEqual(
    pinned.map((row) => row.id),
    ['row-9', 'row-3'],
    'pinned rows resolve to titles without loading the archive',
  );
});

test('loading more appends exactly one page per request', async () => {
  const { announcementsApi, calls } = apiStub({ rows: 120 });
  const catalogModule = loadTs(CATALOG, { '@/lib/api': { announcementsApi } });
  const writes = [];
  const record = (name) => (value) => writes.push([name, value]);
  const current = [pinOption('row-1')];
  const deps = {
    fetchPinOptionPage: catalogModule.fetchPinOptionPage,
    catalogSearchRef: { current: '' },
    postsPage: 1,
    postsTotalPages: 3,
    isLoadingMorePosts: false,
    setIsLoadingMorePosts: record('setIsLoadingMorePosts'),
    setPosts: (update) => {
      const next = typeof update === 'function' ? update(current) : update;
      writes.push(['setPosts', next]);
    },
    setPostsPage: record('setPostsPage'),
    setPostsTotalPages: record('setPostsTotalPages'),
    copy: { postsLoadFailed: 'FAILED' },
    toast: { error: () => writes.push(['toast.error']) },
  };

  const loadMore = pageFunction(PAGE, 'loadMorePosts', deps);
  await loadMore();

  const catalogReads = calls.pinOptions.filter((params) => params.ids === undefined);
  assert.equal(catalogReads.length, 1, 'one page per load-more');
  assert.equal(catalogReads[0].page, 2);
  assert.equal(calls.getAll.length, 0);
  const appended = writes.find(([name]) => name === 'setPosts')[1];
  assert.equal(appended[0].id, 'row-1', 'loaded rows stay');
  assert.ok(appended.length > 1, 'page two rows append');
});

test('a search term reaches the server instead of filtering loaded rows', async () => {
  const { announcementsApi, calls } = apiStub({ rows: 120 });
  const catalogModule = loadTs(CATALOG, { '@/lib/api': { announcementsApi } });
  const writes = [];
  const record = (name) => (value) => writes.push([name, value]);
  const effectSource = read('src/' + PAGE);
  const tree = ts.createSourceFile(PAGE, effectSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let arrow;
  function visit(node) {
    if (
      ts.isCallExpression(node) &&
      node.expression.getText(tree) === 'useEffect' &&
      node.arguments.length > 0 &&
      ts.isArrowFunction(node.arguments[0]) &&
      node.arguments[0].getText(tree).includes('postSearch')
    ) {
      arrow = node.arguments[0];
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  assert.ok(arrow, 'the search effect exists');
  const output = ts.transpileModule(`const __effect = ${arrow.getText(tree)};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const deps = {
    postSearch: 'exam',
    catalogSearchRef: { current: '' },
    fetchPinOptionPage: catalogModule.fetchPinOptionPage,
    setPosts: record('setPosts'),
    setPostsPage: record('setPostsPage'),
    setPostsTotalPages: record('setPostsTotalPages'),
    setPostsLoadFailed: record('setPostsLoadFailed'),
    window: { setTimeout, clearTimeout },
  };
  const effect = Function(...Object.keys(deps), `${output}; return __effect;`)(
    ...Object.values(deps),
  );
  const cleanup = effect();
  await new Promise((resolve) => setTimeout(resolve, 400));
  if (typeof cleanup === 'function') cleanup();

  const catalogReads = calls.pinOptions.filter((params) => params.ids === undefined);
  assert.equal(catalogReads.length, 1, 'one server-side search request');
  assert.equal(catalogReads[0].search, 'exam');
  assert.equal(catalogReads[0].page, 1);
});

// ---------- the rendered pin list ----------

test('the rendered list seats resolved pins first and never duplicates ids', () => {
  const orderedPosts = pageFunction(PAGE, 'orderedPosts', {
    draft: { postOrder: ['row-9', 'row-3', 'archived-away'] },
    posts: [pinOption('row-1'), pinOption('row-3'), pinOption('row-2')],
    pinnedPosts: [pinOption('row-9'), pinOption('row-3')],
  });

  assert.deepEqual(
    orderedPosts.map((row) => row.id),
    ['row-9', 'row-3', 'row-1', 'row-2'],
    'pins keep their order, the catalog follows, unresolvable pins stay invisible',
  );
});

// ---------- source-level wiring ----------

test('the picker no longer walks the full announcement archive', () => {
  const page = read('src/' + PAGE);
  const api = read('src/lib/api.ts');

  assert.doesNotMatch(page, /fetchAllAnnouncementRows/, 'the archive burst loader is gone');
  assert.doesNotMatch(page, /announcementsApi\.getAll/, 'the pin picker never reads the archive endpoint');
  assert.match(page, /appearance-pin-catalog/, 'the bounded catalog module is wired in');
  assert.match(api, /pin-options/, 'the API client exposes the lightweight list');
});
