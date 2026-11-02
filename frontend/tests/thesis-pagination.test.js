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
  return Array.from({ length: count }, (_, index) => ({ id: `row-${index + 1}` }));
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
    authorizationScope: 'STUDENT:student-a',
    roundId: 'round-a',
    listKind: 'topics',
    status: 'PUBLISHED',
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

test('thesis page adapters send zero-based params and read totals with either header casing', async () => {
  const requests = [];
  const { thesisApi } = loadThesisApi({
    get: async (url, config) => {
      requests.push({ url, config });
      return { data: rows(20), headers: { 'x-total-count': '41' } };
    },
  });
  const controller = new AbortController();

  const topics = await thesisApi.listTopicsPage(
    'round-a',
    { status: 'DRAFT', page: 2, limit: 20 },
    controller.signal,
  );
  const groups = await thesisApi.listGroupsPage(
    'round-a',
    { page: 0, limit: 1 },
  );

  assert.deepEqual(requests[0], {
    url: '/thesis/topics',
    config: {
      params: { roundId: 'round-a', status: 'DRAFT', page: 2, limit: 20 },
      signal: controller.signal,
    },
  });
  assert.deepEqual(requests[1], {
    url: '/thesis/groups',
    config: { params: { roundId: 'round-a', page: 0, limit: 1 } },
  });
  assert.equal(topics.page, 2);
  assert.equal(topics.total, 41);
  assert.equal(topics.totalPages, 3);
  assert.equal(groups.total, 41);
});

test('thesis topic page defaults status and missing or malformed totals stay unknown', async () => {
  const responses = [
    { headers: {} },
    { headers: { 'X-Total-Count': 'many' } },
    { headers: { 'x-total-count': '-1' } },
    { headers: { 'X-Total-Count': '2.5' } },
    { headers: { 'X-Total-Count': '9007199254740992' } },
  ];
  const requests = [];
  const { thesisApi } = loadThesisApi({
    get: async (url, config) => {
      requests.push({ url, config });
      return { data: rows(3), ...responses.shift() };
    },
  });

  const first = await thesisApi.listTopicsPage('round-a', { page: 0, limit: 20 });
  assert.deepEqual(requests[0].config.params, {
    roundId: 'round-a', status: 'PUBLISHED', page: 0, limit: 20,
  });
  assert.equal(first.total, undefined);
  assert.equal(first.totalPages, undefined);
  assert.equal(first.items.length, 3, 'page length is not substituted for the missing total');

  for (let index = 0; index < 4; index += 1) {
    const result = await thesisApi.listTopicsPage('round-a', { page: index, limit: 20 });
    assert.equal(result.total, undefined, 'invalid count headers remain unknown');
    assert.equal(result.totalPages, undefined);
    assert.equal(result.items.length, 3);
  }
});

test('group count-only page never treats its one returned row as the total', async () => {
  const { thesisApi } = loadThesisApi({
    get: async () => ({ data: rows(1), headers: {} }),
  });

  const result = await thesisApi.listGroupsPage('round-a', { page: 0, limit: 1 });

  assert.equal(result.items.length, 1);
  assert.equal(result.total, undefined);
  assert.equal(result.totalPages, undefined);
});

test('legacy thesis list adapters retain their unpaged request contracts', async () => {
  const requests = [];
  const { thesisApi } = loadThesisApi({
    get: async (url, config) => {
      requests.push({ url, config });
      return { data: [] };
    },
  });

  await thesisApi.listTopics('round-a');
  await thesisApi.listTopics('round-a', 'DRAFT');
  await thesisApi.listGroups('round-a');
  await thesisApi.myGroups();
  await thesisApi.listRoundRepository('round-a');

  assert.deepEqual(requests, [
    { url: '/thesis/topics', config: { params: { roundId: 'round-a', status: 'PUBLISHED' } } },
    { url: '/thesis/topics', config: { params: { roundId: 'round-a', status: 'DRAFT' } } },
    { url: '/thesis/groups', config: { params: { roundId: 'round-a' } } },
    { url: '/thesis/groups/mine', config: undefined },
    { url: '/thesis/rounds/round-a/repository', config: undefined },
  ]);
  for (const request of requests) {
    assert.equal(Object.hasOwn(request.config?.params ?? {}, 'page'), false);
    assert.equal(Object.hasOwn(request.config?.params ?? {}, 'limit'), false);
  }
});

test('every request identity field fences late thesis page responses', async (t) => {
  const changes = [
    ['account and auth session', { accountId: 'account-b', authSessionEpoch: 5 }],
    ['authorization scope', { authorizationScope: 'LECTURER:lecturer-b' }],
    ['round', { roundId: 'round-b' }],
    ['list kind', { listKind: 'groups', status: undefined }],
    ['status', { status: 'DRAFT' }],
    ['page', { page: 1 }],
    ['limit', { limit: 10 }],
    ['retry generation', { generation: 1 }],
    ['request sequence', { requestSequence: 2 }],
  ];

  for (const [name, change] of changes) {
    await t.test(`late success after ${name} change`, async () => {
      const original = key();
      const current = { key: original };
      const response = deferred();
      const signal = new AbortController().signal;
      const writes = [];
      const task = thesisPageList.runThesisPageRequest(
        requestCallbacks(original, signal, current, () => response.promise, writes),
      );

      current.key = { ...original, ...change, requestSequence: 2 };
      response.resolve({ items: rows(1), page: original.page, total: 99, totalPages: 5 });
      await task;

      assert.deepEqual(writes, [], 'late rows, totals, errors, and finally/loading writes are all ignored');
    });
  }
});

test('late thesis page failures cannot write an error or clear the newer request loading state', async (t) => {
  for (const [name, change] of [
    ['account and auth session', { accountId: 'account-b', authSessionEpoch: 5 }],
    ['round', { roundId: 'round-b' }],
    ['page', { page: 2 }],
  ]) {
    await t.test(`late rejection after ${name} change`, async () => {
      const original = key();
      const current = { key: original };
      const response = deferred();
      const signal = new AbortController().signal;
      const writes = [];
      const task = thesisPageList.runThesisPageRequest(
        requestCallbacks(original, signal, current, () => response.promise, writes),
      );

      current.key = { ...original, ...change, requestSequence: 2 };
      response.reject(new Error('stale failure'));
      await task;

      assert.deepEqual(writes, [], 'a stale error and its finally block cannot update the current list');
    });
  }
});

test('empty thesis pages correct once and the corrected empty result is retryable', async () => {
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
    onError: (...args) => writes.push(['error', ...args]),
    onFinally: (...args) => writes.push(['finally', ...args]),
  });

  assert.deepEqual(corrections, [{ page: 2, refetch: true }]);
  assert.equal(calls, 1, 'the first stale page starts one corrected request');
  assert.deepEqual(writes, [], 'the redirect does not publish an intermediate empty page');

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
    onCorrection: (candidate, refetch) => corrections.push({ page: candidate.page, refetch }),
    onSuccess: (...args) => writes.push(['success', ...args]),
    onError: (error) => writes.push(['error', error.message]),
    onFinally: () => writes.push(['finally']),
  });

  assert.equal(calls, 2);
  assert.deepEqual(corrections, [{ page: 2, refetch: true }], 'the second empty result cannot correct again');
  assert.deepEqual(writes, [['error', 'The list changed while paging. Retry this page.'], ['finally']]);
});

test('known-zero correction lands on page zero without a second request', async () => {
  const original = key({ page: 1 });
  const current = { key: original };
  const writes = [];
  let calls = 0;
  await thesisPageList.runThesisPageRequest({
    requestKey: original,
    signal: new AbortController().signal,
    load: async () => {
      calls += 1;
      return { items: [], page: 1, total: 0, totalPages: 1 };
    },
    isCurrent: (candidate) => thesisPageList.sameThesisPageRequest(candidate, current.key),
    onCorrection: (candidate, refetch) => {
      assert.equal(refetch, false);
      current.key = candidate;
    },
    onSuccess: (result, candidate) => writes.push({ result, page: candidate.page }),
    onError: (error) => writes.push({ error }),
    onFinally: () => writes.push({ finally: true }),
  });

  assert.equal(calls, 1);
  assert.equal(writes[0].page, 0);
  assert.equal(writes[0].result.total, 0);
  assert.deepEqual(writes[1], { finally: true });
});

test('admin thesis group metric uses a one-row total read and leaves unknown totals unavailable', () => {
  const source = read('src/app/admin/thesis/page.tsx');

  assert.match(source, /listGroupsPage\(roundId,\s*\{\s*page:\s*0,\s*limit:\s*1\s*\}\)/);
  assert.match(source, /setGroupTotal\(groupsPage\.total \?\? null\)/);
  assert.match(source, /groupTotal !== null \? groupTotal : '—'/);
  assert.match(source, /thesisApi\.listTopics\(roundId, 'PUBLISHED'\)/);
  assert.match(source, /thesisApi\.listTopics\(roundId, 'DRAFT'\)/);
  assert.doesNotMatch(source, /thesisApi\.listGroups\(roundId\)/);
  assert.doesNotMatch(source, /groupsPage\.items\.length/);
  assert.doesNotMatch(source, /const totalGroups = groups\.length/);
});

test('round-detail page consumes the independent paged lists and server totals only', () => {
  const source = read('src/app/dashboard/thesis/[roundId]/page.tsx');

  assert.match(source, /useThesisPagedList<ThesisTopic>/);
  assert.match(source, /listKind: 'topics'/);
  assert.match(source, /listKind: 'groups'/);
  assert.match(source, /value=\{topics\.total \?\? '—'\}/);
  assert.match(source, /value=\{groups\.total \?\? '—'\}/);
  assert.match(source, /groups\.page \* groups\.limit \+ index \+ 1/);
  assert.doesNotMatch(source, /value=\{topics\.items\.length\}/);
  assert.doesNotMatch(source, /value=\{groups\.items\.length\}/);
});
