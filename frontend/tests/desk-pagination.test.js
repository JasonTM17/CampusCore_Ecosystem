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

function loadApi(relativePath, api) {
  return loadTsModule(relativePath, {
    '@/lib/api': { __esModule: true, default: api },
    '@/lib/array-list-page': arrayListPage,
    '@/lib/upload-validation': { assertUploadFile() {} },
  });
}

function rows(count, prefix = 'row') {
  return Array.from({ length: count }, (_, index) => ({
    id: `${prefix}-${index + 1}`,
  }));
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

test('array-list-page asks for 20-row zero-based pages and derives the count from X-Total-Count', async () => {
  const { fetchArrayListPage } = arrayListPage;
  const synthetic = rows(41);
  const requests = [];
  const fetchPage = async (page, limit) => {
    requests.push({ page, limit });
    return {
      data: synthetic.slice(page * limit, page * limit + limit),
      headers: { 'x-total-count': String(synthetic.length) },
    };
  };

  const first = await fetchArrayListPage(0, 20, fetchPage);
  assert.deepEqual(requests[0], { page: 0, limit: 20 }, 'the wire page stays zero-based');
  assert.equal(first.page, 0);
  assert.equal(first.items.length, 20);
  assert.equal(first.total, 41);
  assert.equal(first.totalPages, 3);

  const middle = await fetchArrayListPage(1, 20, fetchPage);
  assert.equal(middle.items.length, 20);
  assert.equal(middle.items[0].id, 'row-21');

  const last = await fetchArrayListPage(2, 20, fetchPage);
  assert.equal(last.items.length, 1);
  assert.equal(last.items[0].id, 'row-41');
  assert.equal(last.totalPages, 3);
});

test('an absent total is unknown: no totalPages and no fabricated count', async () => {
  const { fetchArrayListPage } = arrayListPage;
  const page = await fetchArrayListPage(0, 20, async () => ({
    data: rows(20),
    headers: {},
  }));

  assert.equal(page.total, undefined);
  assert.equal(page.totalPages, undefined);
  assert.equal(page.page, 0);
});

test('a malformed or blank total header is treated as unknown', async () => {
  const { fetchArrayListPage } = arrayListPage;
  for (const header of ['', '  ', 'abc', '-1', '1.5']) {
    const page = await fetchArrayListPage(0, 20, async () => ({
      data: rows(1),
      headers: { 'x-total-count': header },
    }));
    assert.equal(page.total, undefined, `header ${JSON.stringify(header)} is not a count`);
    assert.equal(page.totalPages, undefined);
  }
});

test('the total header is read case-insensitively and through a Headers-like getter', async () => {
  const { fetchArrayListPage, parseTotalCount } = arrayListPage;
  assert.equal(parseTotalCount({ 'X-Total-Count': '37' }), 37);
  assert.equal(parseTotalCount({ get: (name) => (name.toLowerCase() === 'x-total-count' ? '37' : null) }), 37);

  const page = await fetchArrayListPage(1, 20, async () => ({
    data: rows(20, 'second'),
    headers: { 'X-Total-Count': '57' },
  }));
  assert.equal(page.total, 57);
  assert.equal(page.totalPages, 3);
});

test('pager boundaries stop at the counted last page and only guess forward when the total is unknown', () => {
  const { hasNextPage, hasPreviousPage, pageCount } = arrayListPage;

  assert.equal(pageCount(41, 20), 3);
  assert.equal(pageCount(1, 20), 1);
  assert.equal(pageCount(0, 20), 1);
  assert.equal(pageCount(undefined, 20), undefined);

  assert.equal(hasPreviousPage(0), false);
  assert.equal(hasPreviousPage(1), true);

  assert.equal(hasNextPage(0, 3, 20, 20), true);
  assert.equal(hasNextPage(1, 3, 20, 20), true);
  assert.equal(hasNextPage(2, 3, 1, 20), false);
  assert.equal(hasNextPage(0, undefined, 20, 20), true, 'a full page may have a successor');
  assert.equal(hasNextPage(0, undefined, 19, 20), false, 'a short page is the end');
});

test('an empty out-of-range page is corrected once, and an empty total needs no refetch', () => {
  const { correctEmptyPage } = arrayListPage;

  assert.deepEqual(
    correctEmptyPage(1, { items: [], page: 1, total: 20 }, 20),
    { page: 0, refetch: true },
  );
  assert.deepEqual(
    correctEmptyPage(3, { items: [], page: 3, total: 41 }, 20),
    { page: 2, refetch: true },
  );
  assert.deepEqual(
    correctEmptyPage(2, { items: [], page: 2, total: undefined }, 20),
    { page: 1, refetch: true },
    'without a total, step back exactly one page',
  );
  assert.deepEqual(
    correctEmptyPage(3, { items: [], page: 3, total: 0 }, 20),
    { page: 0, refetch: false },
    'an empty queue lands on page zero without another request',
  );
  assert.equal(correctEmptyPage(0, { items: [], page: 0, total: 0 }, 20), null);
  assert.equal(correctEmptyPage(1, { items: [{ id: 'still-here' }], page: 1, total: 21 }, 20), null);
});

test('a sequence guard applies only the latest of two out-of-order responses', async () => {
  const { createSequenceGuard } = arrayListPage;
  const guard = createSequenceGuard();
  const firstResponse = deferred();
  const secondResponse = deferred();
  const firstRequest = guard.begin();
  const secondRequest = guard.begin();
  let queue = [];

  const first = firstResponse.promise.then((value) => {
    if (guard.isCurrent(firstRequest)) queue = value;
  });
  const second = secondResponse.promise.then((value) => {
    if (guard.isCurrent(secondRequest)) queue = value;
  });

  secondResponse.resolve(['latest']);
  await second;
  firstResponse.resolve(['stale']);
  await first;

  assert.deepEqual(queue, ['latest'], 'the stale response must never overwrite the desk state');
  assert.equal(guard.isCurrent(firstRequest), false);
  assert.equal(guard.isCurrent(secondRequest), true);
});

test('a filter/page race keeps only the newest desk selection', async () => {
  const { createSequenceGuard } = arrayListPage;
  const guard = createSequenceGuard();
  const oldFilter = deferred();
  const newFilterPage = deferred();
  const oldToken = guard.begin();
  const newToken = guard.begin();
  let desk = { status: '', page: 0, rows: [] };

  const oldLoad = oldFilter.promise.then((rows) => {
    if (guard.isCurrent(oldToken)) desk = { status: '', page: 0, rows };
  });
  const newLoad = newFilterPage.promise.then((rows) => {
    if (guard.isCurrent(newToken)) desk = { status: 'SUBMITTED', page: 1, rows };
  });

  newFilterPage.resolve(['page-1-submitted']);
  await newLoad;
  oldFilter.resolve(['page-0-all']);
  await oldLoad;

  assert.deepEqual(desk, {
    status: 'SUBMITTED',
    page: 1,
    rows: ['page-1-submitted'],
  }, 'the old filter/page response cannot overwrite the newest selection');
});

test('a single-flight guard refuses the second concurrent click', async () => {
  const { createSingleFlight } = arrayListPage;
  const flight = createSingleFlight();
  let calls = 0;
  const release = deferred();

  const first = flight.run(async () => {
    calls += 1;
    await release.promise;
    return 'first';
  });
  const second = await flight.run(async () => {
    calls += 1;
    return 'second';
  });

  assert.equal(second.started, false, 'the in-flight button cannot fire another request');
  release.resolve();
  const finished = await first;
  assert.equal(finished.started, true);
  assert.equal(finished.value, 'first');
  assert.equal(calls, 1);
});

test('admissions staff queue page sends the filter, zero-based page and limit', async () => {
  let request;
  const { admissionsApi } = loadApi('src/lib/admissions-api.ts', {
    get: async (url, config) => {
      request = { url, config };
      return { data: [{ id: 'application-1' }], headers: { 'x-total-count': '47' } };
    },
  });

  const page = await admissionsApi.queuePage('SUBMITTED', 1, 20);

  assert.deepEqual(request, {
    url: '/admissions/staff/queue',
    config: { params: { status: 'SUBMITTED', page: 1, limit: 20 } },
  });
  assert.deepEqual(page.items, [{ id: 'application-1' }]);
  assert.equal(page.page, 1);
  assert.equal(page.total, 47);
  assert.equal(page.totalPages, 3);
});

test('admissions legacy queue keeps its array contract and sends no paging params', async () => {
  let request;
  const { admissionsApi } = loadApi('src/lib/admissions-api.ts', {
    get: async (url, config) => {
      request = { url, config };
      return { data: [{ id: 'legacy' }], headers: {} };
    },
  });

  assert.deepEqual(await admissionsApi.queue('RETURNED'), [{ id: 'legacy' }]);
  assert.deepEqual(request, {
    url: '/admissions/staff/queue',
    config: { params: { status: 'RETURNED' } },
  });
});

test('the three careers staff queues send explicit 20-row pages', async () => {
  const requests = [];
  const { careersApi } = loadApi('src/lib/careers-api.ts', {
    get: async (url, config) => {
      requests.push({ url, config });
      return { data: [{ id: 'career-row' }], headers: { 'x-total-count': '61' } };
    },
  });

  const opportunities = await careersApi.opportunityQueuePage(undefined, 0, 20);
  const applications = await careersApi.applicationQueuePage(undefined, undefined, 1, 20);
  const review = await careersApi.reviewQueuePage(2, 20);

  assert.deepEqual(requests, [
    { url: '/careers/staff/opportunities', config: { params: { page: 0, limit: 20 } } },
    { url: '/careers/staff/applications', config: { params: { page: 1, limit: 20 } } },
    { url: '/careers/staff/review-queue', config: { params: { page: 2, limit: 20 } } },
  ]);
  for (const page of [opportunities, applications, review]) {
    assert.equal(page.total, 61);
    assert.equal(page.totalPages, 4);
  }
});

test('careers staff page methods keep their existing filters alongside the page window', async () => {
  const requests = [];
  const { careersApi } = loadApi('src/lib/careers-api.ts', {
    get: async (url, config) => {
      requests.push({ url, config });
      return { data: [], headers: {} };
    },
  });

  await careersApi.opportunityQueuePage('PAUSED', 0, 20);
  await careersApi.applicationQueuePage('opportunity-9', 'INTERVIEW', 0, 20);

  assert.deepEqual(requests, [
    {
      url: '/careers/staff/opportunities',
      config: { params: { status: 'PAUSED', page: 0, limit: 20 } },
    },
    {
      url: '/careers/staff/applications',
      config: { params: { opportunityId: 'opportunity-9', status: 'INTERVIEW', page: 0, limit: 20 } },
    },
  ]);
});

test('careers legacy staff queue methods still return bare arrays without page params', async () => {
  const requests = [];
  const { careersApi } = loadApi('src/lib/careers-api.ts', {
    get: async (url, config) => {
      requests.push({ url, config });
      return { data: [{ id: 'legacy-career' }], headers: {} };
    },
  });

  assert.deepEqual(await careersApi.opportunityQueue('PUBLISHED'), [{ id: 'legacy-career' }]);
  assert.deepEqual(await careersApi.applicationQueue(undefined, 'SUBMITTED'), [{ id: 'legacy-career' }]);
  assert.deepEqual(await careersApi.reviewQueue(), [{ id: 'legacy-career' }]);

  assert.deepEqual(requests, [
    { url: '/careers/staff/opportunities', config: { params: { status: 'PUBLISHED' } } },
    { url: '/careers/staff/applications', config: { params: { status: 'SUBMITTED' } } },
    { url: '/careers/staff/review-queue', config: undefined },
  ]);
});

test('admissions review pages the queue and handles filter, empty-page and race rules', () => {
  const source = read('src/components/admissions/AdmissionsReviewPage.tsx');

  assert.match(source, /const PAGE_SIZE = 20/);
  assert.match(source, /admissionsApi\.queuePage\(status \|\| undefined, requestedPage, PAGE_SIZE\)/);
  assert.match(source, /setPage\(0\)/, 'a new status filter starts on page zero');
  assert.match(source, /queueSequence\.current/);
  assert.match(source, /queueSequence\.current\.isCurrent\(requestId\)/);
  assert.match(source, /correctEmptyPage\(/, 'an empty page past the end is corrected once');
  assert.match(source, /if \(correction\.refetch\)/);
  assert.match(source, /role="status" aria-live="polite"/);
  assert.match(source, /aria-label=\{messages\.common\.states\.page\}/);
  assert.match(source, /messages\.common\.states\.page\} \{page \+ 1\}/,
    'the displayed page label is one-based over zero-based requests');
  assert.match(source, /messages\.common\.states\.goToPreviousPage/);
  assert.match(source, /messages\.common\.states\.goToNextPage/);
  assert.match(source, /const hasPreviousPage = page > 0/);
  assert.match(source, /disabled=\{!hasPreviousPage\}/);
  assert.match(source, /disabled=\{!hasNextPage\}/);
  assert.match(source, /setForbidden\(true\)/);
  assert.match(source, /kind === 'forbidden' \|\| kind === 'unauthorized'/);
  assert.match(source, /onRetry=\{\(\) => void loadQueue\(\)\}/);
});

test('admissions review detail ignores a superseded selection and refreshes the current version after a mutation', () => {
  const source = read('src/components/admissions/AdmissionsReviewPage.tsx');

  assert.match(source, /detailSequence\.current/);
  assert.match(source, /const row = await admissionsApi\.staffApplication\(id\)/);
  assert.match(source, /detailSequence\.current\.isCurrent\(requestId\)/);
  assert.match(source, /loadDetail\(detail\.id\)/);
  assert.match(source, /detail!\.version/);
  assert.match(source, /loadQueue\(\)/, 'the current queue page is refreshed after a mutation');
});

test('admissions review never labels the current page length as the global count', () => {
  const source = read('src/components/admissions/AdmissionsReviewPage.tsx');
  const summary = source.slice(
    source.indexOf('const paginationSummary'),
    source.indexOf('const paginationSummary') + 900,
  );

  assert.match(summary, /total === null\s*\?/, 'an absent total takes the unknown branch');
  assert.match(summary, /messages\.common\.states\.of/, 'the global count is shown only when known');
  assert.doesNotMatch(summary, /\$\{queue\.length\} \$\{messages\.common\.states\.results\}/);
});

test('careers desk keeps three independent page windows and sequence guards', () => {
  const source = read('src/components/careers/CareersDeskPage.tsx');

  assert.match(source, /const PAGE_SIZE = 20/);
  assert.match(source, /careersApi\.opportunityQueuePage\(undefined, requestedPage, PAGE_SIZE\)/);
  assert.match(source, /careersApi\.applicationQueuePage\(undefined, undefined, requestedPage, PAGE_SIZE\)/);
  assert.match(source, /careersApi\.reviewQueuePage\(requestedPage, PAGE_SIZE\)/);

  for (const [page, total, sequence] of [
    ['opportunityPage', 'opportunityTotal', 'opportunitySequence'],
    ['applicationPage', 'applicationTotal', 'applicationSequence'],
    ['reviewPage', 'reviewTotal', 'reviewSequence'],
  ]) {
    assert.match(source, new RegExp(`const \\[${page}, set`), `${page} is its own state`);
    assert.match(source, new RegExp(`const \\[${total}, set`), `${total} is its own state`);
    assert.match(source, new RegExp(`${sequence}\\.current`), `${sequence} fences its section`);
  }

  assert.match(source, /const loadOpportunities = useCallback/);
  assert.match(source, /const loadApplications = useCallback/);
  assert.match(source, /const loadReviewQueue = useCallback/);
  assert.match(source, /correctEmptyPage\(/);
  assert.match(source, /role="status" aria-live="polite"/);
  assert.match(source, /props\.navLabel\} \{props\.page \+ 1\}/,
    'each section displays a one-based page label over its zero-based requests');
  assert.match(source, /messages\.common\.states\.goToPreviousPage/);
  assert.match(source, /messages\.common\.states\.goToNextPage/);
  assert.match(source, /totalCount === null\s*\?/, 'unknown totals use the unbounded summary');
});

test('careers mutations refresh the current page and keep expectedVersion', () => {
  const source = read('src/components/careers/CareersDeskPage.tsx');

  assert.match(source, /const run = async \(action: \(\) => Promise<unknown>, okMessage: string,\s*refresh: \(\) => Promise<void>\)/);
  assert.match(source, /await refresh\(\)/);
  assert.match(source, /reloadCurrentOpportunities/);
  assert.match(source, /reloadCurrentApplications/);
  assert.match(source, /reloadCurrentReview/);
  assert.match(source, /careersApi\.pauseOpportunity\(opportunity\.id,\s*opportunity\.version/);
  assert.match(source, /careersApi\.resumeOpportunity\(opportunity\.id, opportunity\.version\)/);
  assert.match(source, /careersApi\.closeOpportunity\(opportunity\.id,\s*opportunity\.version/);
  assert.match(source, /careersApi\.transitionApplication\(application\.id,\s*NEXT_STEP\[application\.status\]\.step, application\.version\)/);
  assert.match(source, /careersApi\.publish\(opportunity\.id, opportunity\.version\)/);
  assert.match(source, /careersApi\.rejectOpportunity\(opportunity\.id,\s*opportunity\.version/);
});

test('careers desk keeps denials separate from retryable failures', () => {
  const source = read('src/components/careers/CareersDeskPage.tsx');

  assert.match(source, /CAREERS_STAFF_REQUIRED/);
  assert.match(source, /CAREERS_REVIEWER_REQUIRED/);
  assert.match(source, /setDenied\(true\)/);
  assert.match(source, /<ForbiddenState/);
  assert.match(source, /onRetry=\{\(\) => void load\(\)\}/);
});

test('library desk fences out-of-order status filters without adding paging params', () => {
  const source = read('src/components/library/LibraryDeskPage.tsx');

  assert.match(source, /requestSequence\.current/);
  assert.match(source, /requestSequence\.current\.isCurrent\(requestId\)/);
  assert.match(source, /libraryApi\.queue\(status \|\| undefined\)/);
  assert.doesNotMatch(source, /queuePage|PAGE_SIZE/, 'P4b owns library paging');
  assert.match(source, /onRetry=\{\(\) => void load\(filter\)\}/);
  assert.match(source, /setDenied\(true\)/);
});

test('admissions apply disables upload and remove while saving and single-flights each request', () => {
  const source = read('src/components/admissions/AdmissionsApplyPage.tsx');

  assert.match(source, /const savingRef = useRef\(createSingleFlight\(\)\)/);
  assert.equal(
    (source.match(/savingRef\.current\.run\(/g) ?? []).length,
    2,
    'upload and removeAttachment both enter the single-flight guard',
  );

  const uploadButton = source.slice(
    source.indexOf('data-testid="admissions-upload"') - 250,
    source.indexOf('data-testid="admissions-upload"') + 250,
  );
  assert.match(uploadButton, /disabled=\{isSaving\}/, 'the upload button is disabled while saving');

  const removeButton = source.slice(
    source.indexOf('data-testid={`admissions-remove-') - 250,
    source.indexOf('data-testid={`admissions-remove-') + 250,
  );
  assert.match(removeButton, /disabled=\{isSaving\}/, 'the remove button is disabled while saving');
});
