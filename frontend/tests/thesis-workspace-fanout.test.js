const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

function loadModule(relative) {
  const output = ts.transpileModule(read(relative), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
    fileName: relative,
  }).outputText;
  const moduleRecord = { exports: {} };
  Function('module', 'exports', 'require', output)(moduleRecord, moduleRecord.exports, require);
  return moduleRecord.exports;
}

// Execute the actual async page callback, supplying its hook/API dependencies.
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
  return Function(...Object.keys(dependencies), 'useCallback', `${output}; return ${name};`)(
    ...Object.values(dependencies), fn => fn,
  );
}

// Execute the real useEffect body that contains the marker text, with its
// closure dependencies injected, and return the cleanup function it yields.
function pageEffect(file, marker, dependencies) {
  const source = read('src/' + file);
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let arrow;
  function visit(node) {
    if (ts.isCallExpression(node)
        && node.expression.getText(tree) === 'useEffect'
        && node.arguments.length > 0
        && ts.isArrowFunction(node.arguments[0])
        && node.arguments[0].getText(tree).includes(marker)) {
      arrow = node.arguments[0];
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  assert.ok(arrow, `useEffect containing ${marker} exists`);
  const output = ts.transpileModule(`const __effect = ${arrow.getText(tree)};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  }).outputText;
  return Function(...Object.keys(dependencies), `${output}; return __effect;`)(
    ...Object.values(dependencies),
  );
}

const flush = async (rounds = 12) => {
  for (let i = 0; i < rounds; i += 1) await new Promise((resolve) => setImmediate(resolve));
};

const recorder = () => {
  const calls = [];
  const record = (name) => (value) => { calls.push([name, value]); };
  return { calls, record };
};

function approvedGroup(index) {
  return {
    id: `group-${index}`,
    roundId: 'round-1',
    leaderStudentId: `leader-${index}`,
    topicId: `topic-${index}`,
    status: 'SUBMITTED',
    approvalStatus: 'APPROVED',
    memberStudentIds: [],
  };
}

// ---------- the workspace reads a page of groups, never the whole round ----------

test('the workspace loads one bounded group page and takes the KPI from its total', async () => {
  const calls = recorder();
  const legacyCalls = [];
  const pageCalls = [];
  const detailCalls = [];
  const deps = {
    selectedRoundId: 'round-1',
    selectedRoundRef: { current: 'round-1' },
    councilRequestRef: { current: 0 },
    isStudent: false,
    canLoadStaffRelations: true,
    messages: { thesis: { loadFailed: 'LOAD_FAILED' } },
    refreshTopics: async () => {},
    thesisApi: {
      listGroups: async (roundId) => {
        legacyCalls.push(roundId);
        return Array.from({ length: 3000 }, (_, index) => approvedGroup(index));
      },
      listGroupsPage: async (roundId, options) => {
        pageCalls.push([roundId, options]);
        return {
          items: [approvedGroup(1)],
          page: 0,
          total: 2500,
          totalPages: 25,
        };
      },
      listCouncils: async () => [],
    },
    loadCouncilDetails: async (...args) => { detailCalls.push(args); },
    setError: calls.record('error'),
    setGroups: calls.record('setGroups'),
    setGroupTotal: calls.record('setGroupTotal'),
    setCouncils: calls.record('setCouncils'),
    setCouncilScores: calls.record('setCouncilScores'),
    setCouncilScoreErrors: calls.record('setCouncilScoreErrors'),
    setDraftScores: calls.record('setDraftScores'),
    setDraftComments: calls.record('setDraftComments'),
    setTopicSupervisors: calls.record('setTopicSupervisors'),
    setTopicReports: calls.record('setTopicReports'),
    setTopicReportErrors: calls.record('setTopicReportErrors'),
    setCouncilLoadError: calls.record('setCouncilLoadError'),
    GROUP_PAGE_LIMIT: 100,
    setTopics: calls.record('setTopics'),
    setViewingTopic: calls.record('setViewingTopic'),
    setActionError: calls.record('setActionError'),
    setActionSuccess: calls.record('setActionSuccess'),
    setTopicRefreshFailed: calls.record('setTopicRefreshFailed'),
    setSupervisedReports: calls.record('setSupervisedReports'),
    supervisedReportsRef: { current: {} },
    councilDetailsRoundRef: { current: '' },
  };

  pageEffect('app/dashboard/thesis/page.tsx', 'loadWorkspace', deps)();
  await flush();

  assert.equal(pageCalls.length, 1, 'exactly one page read supplies the rows and the total');
  assert.equal(legacyCalls.length, 0, 'the unpaged group read is gone');
  assert.deepEqual(pageCalls[0][0], 'round-1');
  assert.deepEqual(pageCalls[0][1], { page: 0, limit: 100 });
  const writes = new Map(calls.calls);
  assert.deepEqual(writes.get('setGroups'), [approvedGroup(1)]);
  assert.equal(writes.get('setGroupTotal'), 2500, 'the KPI uses the server total, not the page length');
  assert.equal(detailCalls.length, 0, 'the workspace sweep no longer hydrates every council');
});

// ---------- supervised report hydration is bounded and commits once ----------

function reportEffectDeps(overrides = {}) {
  const writes = [];
  const seeds = overrides.seedReports ?? {};
  const deps = {
    isSupervisorOrAdmin: true,
    lecturerTab: 'supervision',
    supervisedGroups: [],
    supervisedReportGroupIds: [],
    supervisedReports: seeds,
    supervisedReportsRef: { current: seeds },
    thesisApi: { getReport: async (id) => ({ groupId: id }) },
    setSupervisedReports: (update) => {
      writes.push(update);
    },
    setSecondaryDataError: () => undefined,
    SUPERVISED_REPORT_CONCURRENCY: 4,
    ...overrides,
  };
  return { deps, writes };
}

test('supervised reports commit through one state update', async () => {
  const groups = Array.from({ length: 12 }, (_, index) => approvedGroup(index));
  let reportCalls = 0;
  const { deps, writes } = reportEffectDeps({
    supervisedGroups: groups,
    supervisedReportGroupIds: groups.map((group) => group.id),
    thesisApi: {
      getReport: async (id) => {
        reportCalls += 1;
        return { groupId: id };
      },
    },
  });

  const cleanup = pageEffect(
    'app/dashboard/thesis/page.tsx',
    '!isSupervisorOrAdmin || supervisedGroups.length === 0',
    deps,
  )();
  await flush(16);
  cleanup();

  assert.equal(reportCalls, 12, 'every approved group on the visible page is read once');
  assert.equal(writes.length, 1, 'all resolutions commit through one state update');
});

test('supervised report reads run with a small concurrency cap', async () => {
  const groups = Array.from({ length: 12 }, (_, index) => approvedGroup(index));
  let inFlight = 0;
  let maxInFlight = 0;
  const { deps } = reportEffectDeps({
    supervisedGroups: groups,
    supervisedReportGroupIds: groups.map((group) => group.id),
    thesisApi: {
      getReport: async (id) => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setImmediate(resolve));
        inFlight -= 1;
        return { groupId: id };
      },
    },
  });

  const cleanup = pageEffect(
    'app/dashboard/thesis/page.tsx',
    '!isSupervisorOrAdmin || supervisedGroups.length === 0',
    deps,
  )();
  await flush(16);
  cleanup();

  assert.ok(maxInFlight <= 4, `at most four report reads run at once, saw ${maxInFlight}`);
});

test('report hydration is deferred until the supervision tab is selected', async () => {
  const groups = Array.from({ length: 5 }, (_, index) => approvedGroup(index));
  let reportCalls = 0;
  const { deps } = reportEffectDeps({
    lecturerTab: 'defense',
    supervisedGroups: groups,
    supervisedReportGroupIds: groups.map((group) => group.id),
    thesisApi: {
      getReport: async () => {
        reportCalls += 1;
        return null;
      },
    },
  });

  const cleanup = pageEffect(
    'app/dashboard/thesis/page.tsx',
    '!isSupervisorOrAdmin || supervisedGroups.length === 0',
    deps,
  )();
  await flush();
  if (typeof cleanup === 'function') cleanup();

  assert.equal(reportCalls, 0, 'a reader on the defense tab pays nothing for supervision reports');
});

test('a report hydration that resolves after unmount writes no state', async () => {
  const groups = [approvedGroup(1)];
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const { deps, writes } = reportEffectDeps({
    supervisedGroups: groups,
    supervisedReportGroupIds: groups.map((group) => group.id),
    thesisApi: {
      getReport: async () => {
        await gate;
        return { groupId: 'group-1' };
      },
    },
  });

  const cleanup = pageEffect(
    'app/dashboard/thesis/page.tsx',
    '!isSupervisorOrAdmin || supervisedGroups.length === 0',
    deps,
  )();
  cleanup();
  release();
  await flush();

  assert.equal(writes.length, 0, 'no state update may land after teardown');
});

// ---------- council details flush once per council ----------

function councilFixture(councils, topicsPerCouncil) {
  return Array.from({ length: councils }, (_, councilIndex) => ({
    id: `council-${councilIndex}`,
    roundId: 'round-1',
    name: `Council ${councilIndex}`,
    members: [{ lecturerId: 'me', memberRole: 'CHAIR' }],
    topicIds: Array.from(
      { length: topicsPerCouncil },
      (_, topicIndex) => `topic-${councilIndex}-${topicIndex}`,
    ),
  }));
}

function councilDetailDeps(api, writes) {
  return {
    isAdmin: false,
    myLecturerId: 'me',
    thesisApi: api,
    setCouncilScores: () => { writes.scores += 1; },
    setCouncilScoreErrors: () => { writes.scoreErrors += 1; },
    setTopicSupervisors: () => { writes.supervisors += 1; },
    setTopicReports: () => { writes.reports += 1; },
    setTopicReportErrors: () => { writes.reportErrors += 1; },
    setDraftScores: () => { writes.draftScores += 1; },
    setDraftComments: () => { writes.draftComments += 1; },
    COUNCIL_TOPIC_CONCURRENCY: 4,
  };
}

test('council details flush once per council instead of once per topic', async () => {
  const councils = councilFixture(3, 4);
  let inFlight = 0;
  let maxInFlight = 0;
  const track = async (value) => {
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((resolve) => setImmediate(resolve));
    inFlight -= 1;
    return value;
  };
  const writes = {
    scores: 0,
    scoreErrors: 0,
    supervisors: 0,
    reports: 0,
    reportErrors: 0,
    draftScores: 0,
    draftComments: 0,
  };
  const load = pageFunction(
    'app/dashboard/thesis/page.tsx',
    'loadCouncilDetails',
    councilDetailDeps({
      listScores: async () => track([]),
      listSupervisors: async () => track([]),
      getTopicReport: async () => track(null),
    }, writes),
  );

  await load(councils);

  assert.equal(writes.scores, 3, 'one score-map commit per council, not per topic');
  assert.equal(writes.supervisors, 3, 'one supervisor-map commit per council');
  assert.equal(writes.reports, 3, 'one report-map commit per council');
  assert.ok(maxInFlight >= 4, `topics are no longer awaited one pair at a time, saw ${maxInFlight}`);
});

test('the defense tab lazily hydrates councils with a live request predicate', async () => {
  const calls = [];
  const deps = {
    canLoadStaffRelations: true,
    lecturerTab: 'defense',
    selectedRoundId: 'round-1',
    visibleCouncils: councilFixture(1, 2),
    councilDetailsRoundRef: { current: '' },
    selectedRoundRef: { current: 'round-1' },
    councilRequestRef: { current: 0 },
    loadCouncilDetails: async (...args) => { calls.push(args); },
  };

  const cleanup = pageEffect(
    'app/dashboard/thesis/page.tsx',
    "lecturerTab !== 'defense'",
    deps,
  )();
  await flush();

  assert.equal(calls.length, 1, 'selecting the defense tab starts the council detail load');
  assert.equal(typeof calls[0][1], 'function');
  assert.equal(calls[0][1](), true, 'the predicate is live while the round stays selected');
  deps.councilRequestRef.current += 1;
  assert.equal(calls[0][1](), false, 'a round switch retires the in-flight load');
  if (typeof cleanup === 'function') cleanup();
});

// ---------- topic history is a memoizable set ----------

test('topic history ids come from one set built across groups and councils', () => {
  const { buildTopicHistoryIds } = loadModule(
    'src/components/dashboard/thesis/topic-history.ts',
  );
  const ids = buildTopicHistoryIds(
    [
      { topicId: 'topic-a' },
      { topicId: null },
      { topicId: 'topic-a' },
      { topicId: 'topic-b' },
    ],
    [
      { topicIds: ['topic-b', 'topic-c'] },
      { topicIds: [] },
    ],
  );

  assert.deepEqual([...ids].sort(), ['topic-a', 'topic-b', 'topic-c']);
});

test('the topic mapper reads the precomputed set instead of scanning groups per topic', () => {
  const page = read('src/app/dashboard/thesis/page.tsx');
  assert.match(page, /buildTopicHistoryIds\(groups, councils\)/);
  assert.match(page, /topicHistoryIds\.has\(topic\.id\)/);
  assert.doesNotMatch(page, /groups\.some\(\(group\) => group\.topicId === topic\.id\)/);
});
