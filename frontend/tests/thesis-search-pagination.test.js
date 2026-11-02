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
const thesisPageList = loadTsModule('src/lib/thesis-page-list.ts', {
  '@/lib/array-list-page': arrayListPage,
});

function loadThesisApi(api) {
  return loadTsModule('src/lib/thesis-api.ts', {
    '@/lib/api': {
      __esModule: true,
      default: api,
      API_BASE_URL: 'http://api.test',
      createRequestId: () => 'request-id',
      refreshSessionSingleFlight: async () => {},
    },
    '@/lib/array-list-page': arrayListPage,
    '@/lib/assistant-stream-helpers': { CANCEL_REQUEST_TIMEOUT_MS: 1000 },
    '@/lib/assistant-stream': {
      createAssistantSseParser: () => ({}),
      parseAssistantStreamEvent: () => ({}),
      AssistantStreamOrder: class AssistantStreamOrder {},
    },
  });
}

function rows(count) {
  return Array.from({ length: count }, (_, index) => ({ id: 'row-' + (index + 1) }));
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function key(overrides = {}) {
  return {
    accountId: 'account-a',
    authSessionEpoch: 4,
    authorizationScope: 'LECTURER:lecturer-a',
    roundId: 'round-a',
    listKind: 'repository',
    search: 'alpha',
    page: 0,
    limit: 20,
    generation: 0,
    requestSequence: 1,
    ...overrides,
  };
}

function requestCallbacks(requestKey, signal, current, load, writes) {
  return {
    requestKey,
    signal,
    load,
    isCurrent: (candidate) => thesisPageList.sameThesisPageRequest(candidate, current.key),
    onCorrection: (candidate, refetch) => writes.push(['correction', candidate, refetch]),
    onSuccess: (result, candidate) => writes.push(['success', candidate, result]),
    onError: (error, candidate) => writes.push(['error', candidate, error]),
    onFinally: (candidate) => writes.push(['finally', candidate]),
  };
}

test('topic and archive adapters send search and parse their independent count headers', async () => {
  const requests = [];
  const { thesisApi } = loadThesisApi({
    get: async (url, config) => {
      requests.push({ url, config });
      if (url === '/thesis/topics') {
        return {
          data: rows(2),
          headers: { 'x-total-count': '5', 'x-topic-total-count': '19' },
        };
      }
      return {
        data: rows(2),
        headers: {
          'x-total-count': '2',
          'x-archive-total-count': '17',
          'x-archive-file-count': '6',
          'x-archive-url-count': '9',
        },
      };
    },
  });
  const controller = new AbortController();

  const topics = await thesisApi.listTopicsPage(
    'round-a',
    { search: 'AI', page: 1, limit: 10 },
    controller.signal,
  );
  const archive = await thesisApi.listRoundRepositoryPage(
    'round-a',
    { search: 'alpha', page: 0, limit: 20 },
    controller.signal,
  );

  assert.deepEqual(requests, [
    {
      url: '/thesis/topics',
      config: {
        params: { roundId: 'round-a', status: 'PUBLISHED', search: 'AI', page: 1, limit: 10 },
        signal: controller.signal,
      },
    },
    {
      url: '/thesis/rounds/round-a/repository',
      config: {
        params: { search: 'alpha', page: 0, limit: 20 },
        signal: controller.signal,
      },
    },
  ]);
  assert.equal(topics.total, 5);
  assert.equal(topics.catalogTotal, 19);
  assert.deepEqual(archive.summary, { total: 17, files: 6, urls: 9 });
  assert.equal(archive.total, 2, 'the archive page total remains the filtered total');
});

test('missing and malformed catalogue or archive headers remain unknown', async () => {
  const responses = [
    { data: rows(3), headers: { 'X-Total-Count': '4' } },
    { data: rows(2), headers: { 'X-Total-Count': 'many' } },
    {
      data: rows(2),
      headers: {
        'X-Total-Count': 'bad',
        'X-Archive-Total-Count': 'bad',
        'X-Archive-File-Count': '-1',
        'X-Archive-Url-Count': '1.5',
      },
    },
  ];
  const { thesisApi } = loadThesisApi({
    get: async () => responses.shift(),
  });

  const topics = await thesisApi.listTopicsPage('round-a', { search: 'cloud', page: 0, limit: 20 });
  const missingArchive = await thesisApi.listRoundRepositoryPage(
    'round-a',
    { search: 'none', page: 0, limit: 20 },
  );
  const malformedArchive = await thesisApi.listRoundRepositoryPage(
    'round-a',
    { search: 'none', page: 0, limit: 20 },
  );

  assert.equal(topics.total, 4);
  assert.equal(topics.catalogTotal, undefined);
  assert.equal(missingArchive.summary.total, undefined);
  assert.equal(missingArchive.summary.files, undefined);
  assert.equal(missingArchive.summary.urls, undefined);
  assert.equal(malformedArchive.summary.total, undefined);
  assert.equal(malformedArchive.summary.files, undefined);
  assert.equal(malformedArchive.summary.urls, undefined);
  assert.equal(malformedArchive.items.length, 2);
});

test('legacy topic and repository adapters remain unpaged', async () => {
  const requests = [];
  const { thesisApi } = loadThesisApi({
    get: async (url, config) => {
      requests.push({ url, config });
      return { data: [] };
    },
  });

  await thesisApi.listTopics('round-a');
  await thesisApi.listRoundRepository('round-a');

  assert.deepEqual(requests, [
    { url: '/thesis/topics', config: { params: { roundId: 'round-a', status: 'PUBLISHED' } } },
    { url: '/thesis/rounds/round-a/repository', config: undefined },
  ]);
});

test('search is part of page ownership and fences late success after scope changes', async (t) => {
  const changes = [
    ['account', { accountId: 'account-b' }],
    ['round', { roundId: 'round-b' }],
    ['search', { search: 'beta' }],
    ['page', { page: 1 }],
  ];

  for (const [name, change] of changes) {
    await t.test('late success after ' + name + ' change', async () => {
      const original = key();
      const current = { key: original };
      const response = deferred();
      const writes = [];
      const task = thesisPageList.runThesisPageRequest(
        requestCallbacks(original, new AbortController().signal, current, () => response.promise, writes),
      );
      current.key = { ...original, ...change, requestSequence: 2 };
      response.resolve({ items: rows(1), page: original.page, total: 99, totalPages: 5 });
      await task;
      assert.deepEqual(writes, [], 'stale rows, totals, summary, and finally callbacks are ignored');
    });
  }
});

test('search is part of page ownership and fences late failure and finally callbacks', async (t) => {
  const changes = [
    ['account and session', { accountId: 'account-b', authSessionEpoch: 5 }],
    ['round', { roundId: 'round-b' }],
    ['search', { search: 'beta' }],
    ['page', { page: 2 }],
  ];

  for (const [name, change] of changes) {
    await t.test('late rejection after ' + name + ' change', async () => {
      const original = key();
      const current = { key: original };
      const response = deferred();
      const writes = [];
      const task = thesisPageList.runThesisPageRequest(
        requestCallbacks(original, new AbortController().signal, current, () => response.promise, writes),
      );
      current.key = { ...original, ...change, requestSequence: 2 };
      response.reject(new Error('stale failure'));
      await task;
      assert.deepEqual(writes, [], 'stale errors cannot overwrite a newer loading state');
    });
  }

  assert.notEqual(
    thesisPageList.thesisPageSelectionScope(key()),
    thesisPageList.thesisPageSelectionScope(key({ search: 'beta' })),
    'a submitted search resets the page selection scope',
  );
  assert.equal(
    thesisPageList.sameThesisPageRequest(key(), key({ search: 'beta' })),
    false,
    'a changed search is a different in-flight request even before sequence changes',
  );
});

test('a stale empty page can correct once and the corrected page cannot loop', async () => {
  const original = key({ page: 3 });
  const current = { key: original };
  const corrections = [];
  const writes = [];
  let calls = 0;
  const signal = new AbortController().signal;

  await thesisPageList.runThesisPageRequest({
    requestKey: original,
    signal,
    load: async () => {
      calls += 1;
      return { items: [], page: 3, total: 41, totalPages: 3 };
    },
    isCurrent: (candidate) => thesisPageList.sameThesisPageRequest(candidate, current.key),
    onCorrection: (candidate, refetch) => {
      corrections.push({ page: candidate.page, refetch });
      current.key = candidate;
    },
    onSuccess: (...args) => writes.push(['success', ...args]),
    onError: (error) => writes.push(['error', error.message]),
    onFinally: () => writes.push(['finally']),
  });

  assert.deepEqual(corrections, [{ page: 2, refetch: true }]);
  assert.equal(calls, 1);

  const corrected = { ...current.key, requestSequence: 2 };
  current.key = corrected;
  await thesisPageList.runThesisPageRequest({
    requestKey: corrected,
    signal,
    correctionAlreadyUsed: true,
    load: async () => {
      calls += 1;
      return { items: [], page: corrected.page, total: 41, totalPages: 3 };
    },
    isCurrent: (candidate) => thesisPageList.sameThesisPageRequest(candidate, current.key),
    onCorrection: (...args) => corrections.push(args),
    onSuccess: (...args) => writes.push(['success', ...args]),
    onError: (error) => writes.push(['error', error.message]),
    onFinally: () => writes.push(['finally']),
  });

  assert.equal(calls, 2);
  assert.deepEqual(corrections, [{ page: 2, refetch: true }]);
  assert.deepEqual(writes, [
    ['error', 'The list changed while paging. Retry this page.'],
    ['finally'],
  ]);
});

test('archive empty state uses filtered and unfiltered totals without guessing unknown counts', () => {
  assert.equal(thesisPageList.archiveEmptyState(0, 0), 'empty');
  assert.equal(thesisPageList.archiveEmptyState(12, 0), 'no-match');
  assert.equal(thesisPageList.archiveEmptyState(undefined, 0), 'unknown');
  assert.equal(thesisPageList.archiveEmptyState(12, 2), null);
});

test('catalogue empty state distinguishes an empty round from a filtered no-match', () => {
  assert.equal(thesisPageList.catalogEmptyState(0, 0), 'empty');
  assert.equal(thesisPageList.catalogEmptyState(15, 0), 'no-match');
  assert.equal(thesisPageList.catalogEmptyState(undefined, 0), 'unknown');
  assert.equal(thesisPageList.catalogEmptyState(15, 3), 'unknown');
});

test('catalogue requests remain gated until submit, quick-pill, or View All actions', () => {
  const source = read('src/components/dashboard/thesis/ThesisTopicCatalogPage.tsx');
  assert.match(source, /const searchActive = showAll \|\| submittedQuery\.trim\(\)\.length > 0/);
  assert.match(source, /topicsEnabled: false/);
  assert.match(source, /enabled: searchActive && Boolean\(workspace\.selectedRoundId\)/);
  assert.match(source, /setSubmittedQuery\(searchInput\.trim\(\)\)/);
  assert.match(source, /setSubmittedQuery\(query\)/);
  assert.match(source, /setSubmittedQuery\('all'\)/);
  assert.match(source, /thesisApi\.listTopicsPage\(/);
  assert.match(source, /search: submittedQuery/);
  assert.match(source, /catalogTotal/);
  assert.match(source, /catalogEmptyState\(topicsPage\.catalogTotal, topicsPage\.total\)/);
  assert.doesNotMatch(source, /workspace\.topics/);
  assert.doesNotMatch(source, /normalizeVietnameseText/);
  const workspace = read('src/components/dashboard/thesis/useThesisWorkspace.ts');
  assert.match(workspace, /topicsEnabled \? thesisApi\.listTopics\(selectedRoundId\)/);
});

test('archive search input and icon-only clear button have explicit accessible names', () => {
  const archive = read('src/features/thesis/components/ThesisRepositoryWorkspace.tsx');
  assert.match(archive, /aria-label=\{copy\.searchLabel\}/);
  assert.match(archive, /aria-label=\{copy\.clearSearch\}/);
  assert.match(archive, /<Search[^>]*aria-hidden="true"/);
});

test('archive paging is independent while the group read stays bounded', () => {
  const page = read('src/app/dashboard/thesis/page.tsx');
  assert.match(page, /listRoundRepositoryPage/);
  assert.doesNotMatch(page, /listRoundRepository\(selectedRoundId\)/);
  assert.doesNotMatch(page, /filteredRepositoryReports/);
  assert.match(page, /thesisApi\.listTopics\(roundId, 'PUBLISHED'\)/);
  assert.match(page, /thesisApi\.listGroupsPage\(selectedRoundId, \{ page: 0, limit: GROUP_PAGE_LIMIT \}\)/);
  assert.doesNotMatch(page, /thesisApi\.listGroups\(selectedRoundId\)/,
    'the complete round group read no longer runs from the workspace');
});
