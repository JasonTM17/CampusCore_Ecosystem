const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function assertSourceMatches(source, pattern, message) {
  assert.ok(pattern.test(source), message);
}

function loadApi(relativePath, api) {
  const source = read(relativePath);
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const loadedModule = { exports: {} };
  const mockedRequire = (specifier) => {
    if (specifier === '@/lib/api') return { __esModule: true, default: api };
    if (specifier === '@/lib/upload-validation') return { assertUploadFile() {} };
    return require(specifier);
  };
  Function('module', 'exports', 'require', output)(
    loadedModule,
    loadedModule.exports,
    mockedRequire,
  );
  return loadedModule.exports;
}

test('careers and library catalogue clients request explicit pages and read X-Total-Count', async () => {
  const cases = [
    {
      file: 'src/lib/careers-api.ts',
      method: 'opportunitiesPage',
      endpoint: '/careers/opportunities',
      rows: [{ id: 'career-21' }],
    },
    {
      file: 'src/lib/library-api.ts',
      method: 'cataloguePage',
      endpoint: '/library/catalogue',
      rows: [{ id: 'book-21' }],
    },
  ];

  for (const item of cases) {
    let request;
    const { careersApi, libraryApi } = loadApi(item.file, {
      get: async (url, config) => {
        request = { url, config };
        return { data: item.rows, headers: { 'x-total-count': '47' } };
      },
    });
    const client = careersApi ?? libraryApi;
    const page = await client[item.method]('cloud', 1, 20);

    assert.deepEqual(request, {
      url: item.endpoint,
      config: { params: { query: 'cloud', page: 1, limit: 20 } },
    });
    assert.deepEqual(page, { items: item.rows, total: 47 });
  }
});

test('legacy catalogue calls keep returning arrays when the paging header is absent', async () => {
  const cases = [
    { file: 'src/lib/careers-api.ts', method: 'opportunities', endpoint: '/careers/opportunities' },
    { file: 'src/lib/library-api.ts', method: 'catalogue', endpoint: '/library/catalogue' },
  ];

  for (const item of cases) {
    const rows = [{ id: 'legacy-row' }];
    let request;
    const { careersApi, libraryApi } = loadApi(item.file, {
      get: async (url, config) => {
        request = { url, config };
        return { data: rows, headers: {} };
      },
    });
    const client = careersApi ?? libraryApi;

    assert.deepEqual(await client[item.method]('search'), rows);
    assert.deepEqual(request, {
      url: item.endpoint,
      config: { params: { query: 'search' } },
    });
  }
});

test('both catalogue pages render a bounded localized count and accessible page controls', () => {
  const pages = [
    {
      file: 'src/components/careers/CareersBoardPage.tsx',
      client: 'careersApi.opportunitiesPage',
      rows: 'opportunities',
    },
    {
      file: 'src/components/library/LibraryCataloguePage.tsx',
      client: 'libraryApi.cataloguePage',
      rows: 'titles',
    },
  ];

  for (const item of pages) {
    const source = read(item.file);
    assertSourceMatches(source, /const PAGE_SIZE = 20/, 'each page uses 20 rows');
    assertSourceMatches(source, new RegExp(`${item.client}\\(search, requestedPage, PAGE_SIZE\\)`),
      'the request carries the active page and page size');
    assertSourceMatches(source, /messages\.common\.states\.goToPreviousPage/,
      'the previous control uses localized copy');
    assertSourceMatches(source, /messages\.common\.states\.goToNextPage/,
      'the next control uses localized copy');
    assertSourceMatches(source, /messages\.common\.states\.showingResults/,
      'the visible range uses localized copy');
    assertSourceMatches(source, /messages\.common\.states\.results/,
      'the result count uses localized copy');
    assertSourceMatches(source, /aria-live="polite"/, 'the result count is announced');
    assertSourceMatches(source, /requestSequence\.current/,
      'an older search or page request must not overwrite the latest results');
    assertSourceMatches(source, /currentSelection\.current/,
      'a delayed mutation refresh must keep the latest submitted search and page');
    assertSourceMatches(source, /setPage\(0\)/,
      'starting a new search returns to the first page');
    assertSourceMatches(source, /const hasPreviousPage = page > 0/,
      'previous is available only after the first page');
    assertSourceMatches(source, /page \+ 1 < totalPages/,
      'next is available only when another counted page exists');
    assertSourceMatches(source, /disabled=\{!hasPreviousPage\}/,
      'the previous control reflects its boundary');
    assertSourceMatches(source, /disabled=\{!hasNextPage\}/,
      'the next control reflects its boundary');
    assertSourceMatches(source, /Math\.max\(0, Math\.ceil\(pageResult\.total \/ PAGE_SIZE\) - 1\)/,
      'an empty page beyond the new total must be corrected after data changes');
    assertSourceMatches(source,
      new RegExp(`!isLoading && !error && !denied && ${item.rows}\\.length === 0`),
      'empty results are shown only without a failed or denied request');
    assertSourceMatches(source,
      /pageResult\.items\.length === 0 && pageResult\.total !== null && pageResult\.total > 0/,
      'a contradictory positive total stays an error instead of appearing empty');
    assertSourceMatches(source, /catch \(cause\)/,
      'failed requests remain in the error path rather than becoming empty results');
  }
});
