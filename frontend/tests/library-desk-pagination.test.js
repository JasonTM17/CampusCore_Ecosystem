const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function loadTsModule(relativePath, stubs = {}) {
  const output = ts.transpileModule(read(relativePath), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
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

const arrayListPage = loadTsModule('src/lib/array-list-page.ts');

function loadLibraryApi(api) {
  return loadTsModule('src/lib/library-api.ts', {
    '@/lib/api': { __esModule: true, default: api },
    '@/lib/array-list-page': arrayListPage,
  });
}

function rows(count, prefix = 'loan') {
  return Array.from({ length: count }, (_, index) => ({
    id: `${prefix}-${index + 1}`,
  }));
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

test('library staff queue pages through 41 rows on zero-based wire pages with one-based display', async () => {
  const synthetic = rows(41);
  const requests = [];
  const { libraryApi } = loadLibraryApi({
    get: async (url, config) => {
      requests.push({ url, config });
      const { page, limit } = config.params;
      return {
        data: synthetic.slice(page * limit, page * limit + limit),
        headers: { 'x-total-count': String(synthetic.length) },
      };
    },
  });

  const first = await libraryApi.queuePage(undefined, 0, 20);
  assert.deepEqual(requests[0], {
    url: '/library/staff/requests',
    config: { params: { page: 0, limit: 20 } },
  });
  assert.equal(first.page, 0, 'the wire page stays zero-based');
  assert.equal(first.page + 1, 1, 'display labels are one-based');
  assert.equal(first.items.length, 20);
  assert.equal(first.items[0].id, 'loan-1');
  assert.equal(first.total, 41);
  assert.equal(first.totalPages, 3);

  const middle = await libraryApi.queuePage(undefined, 1, 20);
  assert.deepEqual(requests[1], {
    url: '/library/staff/requests',
    config: { params: { page: 1, limit: 20 } },
  });
  assert.equal(middle.items[0].id, 'loan-21');

  const last = await libraryApi.queuePage(undefined, 2, 20);
  assert.equal(last.items.length, 1);
  assert.equal(last.items[0].id, 'loan-41');
  assert.equal(last.page + 1, 3, 'the counted last page is a one-based display label');
});

test('library staff queue page keeps the status filter alongside the page window', async () => {
  let request;
  const { libraryApi } = loadLibraryApi({
    get: async (url, config) => {
      request = { url, config };
      return { data: [{ id: 'loan-1' }], headers: { 'x-total-count': '47' } };
    },
  });

  const page = await libraryApi.queuePage('REQUESTED', 1, 20);

  assert.deepEqual(request, {
    url: '/library/staff/requests',
    config: { params: { status: 'REQUESTED', page: 1, limit: 20 } },
  });
  assert.equal(page.total, 47);
  assert.equal(page.totalPages, 3);
});

test('an absent X-Total-Count leaves the library desk total unknown instead of faking a count', async () => {
  const { libraryApi } = loadLibraryApi({
    get: async () => ({ data: rows(20), headers: {} }),
  });

  const page = await libraryApi.queuePage(undefined, 0, 20);

  assert.equal(page.total, undefined);
  assert.equal(page.totalPages, undefined);
  assert.equal(page.items.length, 20, 'the page length is not the global count');
});

test('library legacy queue keeps its bare array contract and sends no paging params', async () => {
  const requests = [];
  const { libraryApi } = loadLibraryApi({
    get: async (url, config) => {
      requests.push({ url, config });
      return { data: [{ id: 'legacy-loan' }], headers: {} };
    },
  });

  assert.deepEqual(await libraryApi.queue('APPROVED'), [{ id: 'legacy-loan' }]);
  assert.deepEqual(await libraryApi.queue(), [{ id: 'legacy-loan' }]);
  assert.deepEqual(requests, [
    { url: '/library/staff/requests', config: { params: { status: 'APPROVED' } } },
    { url: '/library/staff/requests', config: { params: {} } },
  ]);
});

test('an empty out-of-range library page is corrected once, including a page emptied by a mutation', () => {
  const { correctEmptyPage } = arrayListPage;

  assert.deepEqual(
    correctEmptyPage(2, { items: [], total: 40 }, 20),
    { page: 1, refetch: true },
    'deleting the last row of the last page returns the reader to the surviving page',
  );
  assert.deepEqual(
    correctEmptyPage(3, { items: [], total: 41 }, 20),
    { page: 2, refetch: true },
    'a stale counted page past the end lands on the counted last page',
  );
  assert.deepEqual(
    correctEmptyPage(1, { items: [], total: undefined }, 20),
    { page: 0, refetch: true },
    'without a total the reader steps back exactly one page',
  );
  assert.deepEqual(
    correctEmptyPage(2, { items: [], total: 0 }, 20),
    { page: 0, refetch: false },
    'an emptied queue shows page zero without another request',
  );
});

test('a stale page-zero response is fenced after the desk moves to page one', async () => {
  const { createSequenceGuard } = arrayListPage;
  const guard = createSequenceGuard();
  let selection = { page: 0 };
  let desk = { page: 0, items: [] };
  const staleResponse = deferred();
  const latestResponse = deferred();

  const load = async (requestedPage, response) => {
    const requestId = guard.begin();
    selection = { page: requestedPage };
    const items = await response.promise;
    if (!guard.isCurrent(requestId)) return;
    if (selection.page !== requestedPage) return;
    desk = { page: requestedPage, items };
  };

  const staleLoad = load(0, staleResponse);
  const latestLoad = load(1, latestResponse);
  latestResponse.resolve(['page-1-row']);
  await latestLoad;
  staleResponse.resolve(['page-0-row']);
  await staleLoad;

  assert.deepEqual(desk, { page: 1, items: ['page-1-row'] },
    'the late page-zero response cannot overwrite page one');
  assert.equal(selection.page, 1);
});

test('library desk requests 20-row pages and fences by both request and requested page', () => {
  const source = read('src/components/library/LibraryDeskPage.tsx');

  assert.match(source, /const PAGE_SIZE = 20/);
  assert.match(source, /libraryApi\.queuePage\(status \|\| undefined, requestedPage, PAGE_SIZE\)/);
  assert.match(source, /const requestSequence = useRef\(createSequenceGuard\(\)\)/);
  assert.match(source, /currentSelection\.current = \{ status, page: requestedPage \}/);
  assert.match(source, /const selectionMatches = \(\) =>\s*currentSelection\.current\.status === status\s*&& currentSelection\.current\.page === requestedPage/);
  assert.match(source, /if \(!requestSequence\.current\.isCurrent\(requestId\) \|\| !selectionMatches\(\)\) return;/);
  assert.doesNotMatch(source, /libraryApi\.queue\(status \|\| undefined\)/,
    'the desk no longer reads the unbounded queue');
});

test('library desk resets the filter to page zero and refreshes the current page after mutations', () => {
  const source = read('src/components/library/LibraryDeskPage.tsx');

  assert.match(source, /const changeFilter = \(nextFilter: LoanStatus \| ''\) => \{\s*setFilter\(nextFilter\);\s*setPage\(0\);\s*void load\(nextFilter, 0\);/, 
    'a new status filter starts on page zero');
  assert.match(source, /const reloadCurrent = useCallback\(\s*\(\) => load\(currentSelection\.current\.status, currentSelection\.current\.page\),\s*\[load\],\s*\)/);
  assert.match(source, /await reloadCurrent\(\);/, 'mutations keep the reader on the current page');
  assert.match(source, /libraryApi\.approve\(loan\.id, loan\.version\)/,
    'expectedVersion behavior is unchanged');
  assert.match(source, /libraryApi\.cancelStaff\(loan\.id, loan\.version, cancelReason \|\| undefined\)/);
});

test('library desk displays one-based labels and never labels the page length as the total', () => {
  const source = read('src/components/library/LibraryDeskPage.tsx');
  const summary = source.slice(
    source.indexOf('const paginationSummary'),
    source.indexOf('const paginationSummary') + 900,
  );

  assert.match(source, /correctEmptyPage\(/);
  assert.match(source, /if \(correction\.refetch\)/);
  assert.match(source, /const totalPages = pageCount\(total \?\? undefined, PAGE_SIZE\)/);
  assert.match(source, /role="status" aria-live="polite"/);
  assert.match(source, /aria-label=\{messages\.common\.states\.page\}/);
  assert.match(source, /messages\.common\.states\.page\} \{page \+ 1\}/,
    'the displayed page label is one-based over zero-based requests');
  assert.match(source, /messages\.common\.states\.goToPreviousPage/);
  assert.match(source, /messages\.common\.states\.goToNextPage/);
  assert.match(summary, /total === null\s*\?/, 'an absent total takes the unknown branch');
  assert.match(summary, /messages\.common\.states\.of/, 'the global count is shown only when known');
  assert.doesNotMatch(summary, /\$\{loans\.length\} \$\{messages\.common\.states\.results\}/);
});

test('library desk keeps forbidden, retryable and empty states distinct while paging', () => {
  const source = read('src/components/library/LibraryDeskPage.tsx');

  assert.match(source, /kind === 'forbidden' \|\| kind === 'unauthorized'/);
  assert.match(source, /setDenied\(true\)/);
  assert.match(source, /<ForbiddenState/);
  assert.match(source, /<LinkButton href="\/dashboard"/);
  assert.match(source, /onRetry=\{\(\) => void reloadCurrent\(\)\}/);
  assert.match(source, /!isLoading && !error && !denied && loans\.length === 0/,
    'an empty page shows the real empty state');
  assert.match(source,
    /result\.items\.length === 0 && result\.total !== undefined && result\.total > 0/,
    'a contradictory positive total stays an error instead of appearing empty');
});
