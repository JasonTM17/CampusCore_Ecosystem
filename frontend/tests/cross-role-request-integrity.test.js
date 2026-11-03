const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

// CROSS_ROLE_SRC_ROOT lets the same regressions run against a snapshot of the
// pre-fix sources (e.g. git show HEAD:...) without touching the worktree —
// that is the recorded red pass for this file.
const root = process.env.CROSS_ROLE_SRC_ROOT
  ? path.resolve(process.env.CROSS_ROLE_SRC_ROOT)
  : path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

// Render the real module under test with its imports replaced by stubs; the
// same TypeScript transpile harness the thesis council tests use.
function loadModule(relative, aliases = {}, sourceRoot = root) {
  const output = ts.transpileModule(fs.readFileSync(path.join(sourceRoot, relative), 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
    fileName: relative,
  }).outputText;
  const moduleRecord = { exports: {} };
  const resolve = (name) => Object.prototype.hasOwnProperty.call(aliases, name)
    ? aliases[name]
    : require(name);
  Function('module', 'exports', 'require', output)(moduleRecord, moduleRecord.exports, resolve);
  return moduleRecord.exports;
}

// Execute an actual page callback, supplying its hook/API dependencies. Ref
// objects are injected as plain { current } stand-ins for useRef.
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
    ...Object.values(dependencies), (fn) => fn,
  );
}

// Extract a module-scope `function` declaration (pure helpers such as
// createGradeDrafts / buildGradeSaveRows) the same way pageFunction extracts
// const callbacks — the real production implementation is evaluated, not a stub.
function pageHelper(file, name, dependencies) {
  const source = read('src/' + file);
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let declaration;
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name && node.name.getText(tree) === name) {
      declaration = node;
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  assert.ok(declaration, `page helper ${name} exists`);
  const output = ts.transpileModule(declaration.getText(tree), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  }).outputText;
  return Function(...Object.keys(dependencies), `${output}; return ${name};`)(
    ...Object.values(dependencies),
  );
}

const gradeHelpers = (extra = {}) => ({
  hasCompletedGrade: pageHelper('app/dashboard/lecturer/grades/[id]/page.tsx', 'hasCompletedGrade', {}),
  createGradeDrafts: pageHelper('app/dashboard/lecturer/grades/[id]/page.tsx', 'createGradeDrafts', {}),
  preserveGradeDraftRows: pageHelper('app/dashboard/lecturer/grades/[id]/page.tsx', 'preserveGradeDraftRows', {}),
  isStaleVersionError: pageHelper('app/dashboard/lecturer/grades/[id]/page.tsx', 'isStaleVersionError', {}),
  buildGradeSaveRows: pageHelper('app/dashboard/lecturer/grades/[id]/page.tsx', 'buildGradeSaveRows', {
    hasCompletedGrade: pageHelper('app/dashboard/lecturer/grades/[id]/page.tsx', 'hasCompletedGrade', {}),
  }),
  ...extra,
});

// Extract an actual useEffect body (matched by a marker inside the call) and
// return its setup function — the returned cleanup is then invoked directly.
function pageEffect(file, marker, dependencies = {}) {
  const source = read('src/' + file);
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let call;
  function visit(node) {
    if (ts.isCallExpression(node)
        && node.expression.getText(tree) === 'useEffect'
        && node.getText(tree).includes(marker)) call = node;
    ts.forEachChild(node, visit);
  }
  visit(tree);
  assert.ok(call, `useEffect containing "${marker}" exists`);
  const output = ts.transpileModule(call.getText(tree), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  }).outputText;
  let captured;
  const useEffectStub = (fn) => { captured = fn; };
  Function(...Object.keys(dependencies), 'useEffect', output)(
    ...Object.values(dependencies), useEffectStub,
  );
  return captured;
}

const flush = async () => {
  for (let i = 0; i < 12; i += 1) await new Promise((resolve) => setImmediate(resolve));
};

const recorder = () => {
  const calls = [];
  const record = (name) => (value) => { calls.push([name, value]); };
  return { calls, record };
};

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

// ---------- enrollment export forwards the committed search ----------

function loadEnrollmentsApi(getImpl) {
  const noop = () => {};
  const apiInstance = {
    get: getImpl,
    post: async () => ({}),
    put: async () => ({}),
    patch: async () => ({}),
    delete: async () => ({}),
    interceptors: { request: { use: noop }, response: { use: noop } },
  };
  class AxiosError extends Error {}
  return loadModule('src/lib/api.ts', {
    axios: {
      __esModule: true,
      default: { create: () => apiInstance, isAxiosError: () => false },
      AxiosError,
    },
    '@/i18n/paths': { addLocalePrefix: (p) => p, stripLocaleFromPathname: (p) => p },
    '@/lib/public-api-url': { resolvePublicApiBaseUrl: () => '/api/v1' },
    '@/lib/safe-url': loadModule('src/lib/safe-url.ts'),
    '@/lib/session-hint': { CSRF_COOKIE_NAME: 'cc_csrf', isLogoutInProgress: () => false },
    '@/lib/session-sync': { publishSessionChange: noop },
    '@/lib/surfaces': { surfaceFromHost: () => null },
    '@/lib/observability': {
      REQUEST_ID_HEADER: 'X-Request-Id',
      newRequestId: () => 'test-request-id',
      pathOf: (url) => (url ?? '').split('?')[0],
      pathTemplate: (url) => (url ?? '').split('?')[0],
      recordApiMetric: noop,
    },
  }).enrollmentsApi;
}

test('enrollments exportCsv accepts and forwards a committed search term', async () => {
  let captured;
  const enrollmentsApi = loadEnrollmentsApi(async (_url, config) => {
    captured = config?.params;
    return { data: 'csv-body' };
  });
  await enrollmentsApi.exportCsv({ status: 'ENROLLED', search: 'kim nguyen' });
  assert.equal(captured.search, 'kim nguyen', 'committed search reaches the API params');
  assert.equal(captured.status, 'ENROLLED');
});

test('the export handler sends the committed search, never the debouncing input', async () => {
  let captured;
  const calls = [];
  const exportCsv = pageFunction('app/admin/enrollments/page.tsx', 'handleExportCsv', {
    filters: { semesterId: 'term-1', courseId: '', sectionId: '', status: 'ENROLLED' },
    search: 'committed-term',
    enrollmentsApi: {
      exportCsv: async (params) => { captured = params; return 'a,b'; },
    },
    toast: { success: (m) => calls.push(['success', m]), error: (m) => calls.push(['error', m]) },
    copy: { exportStarted: 'STARTED', exportFailed: 'FAILED' },
  });
  // jsdom-free blob/url stubs: the handler touches document + URL.
  global.Blob = class { constructor() {} };
  global.URL = { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} };
  global.document = { createElement: () => ({ click: () => {} }) };
  await exportCsv();
  assert.equal(captured.search, 'committed-term', 'export carries the committed search value');
  assert.equal(captured.status, 'ENROLLED', 'filters still forward');
  assert.deepEqual(calls, [['success', 'STARTED']]);
});

test('the export handler omits search when nothing is committed', async () => {
  let captured;
  const exportCsv = pageFunction('app/admin/enrollments/page.tsx', 'handleExportCsv', {
    filters: { semesterId: '', courseId: '', sectionId: '', status: '' },
    search: '',
    enrollmentsApi: { exportCsv: async (params) => { captured = params; return 'a,b'; } },
    toast: { success: () => {}, error: () => {} },
    copy: { exportStarted: 'STARTED', exportFailed: 'FAILED' },
  });
  await exportCsv();
  assert.equal(captured.search, undefined, 'no uncommitted search leaks into the export');
});

// ---------- admin enrollments list + section options generation guards ----------

function enrollmentDeps(api, calls, overrides = {}) {
  const { record } = calls;
  return {
    filters: { semesterId: '', courseId: '', sectionId: '', status: '' },
    page: 1,
    search: '',
    locale: 'en',
    copy: { loadFailed: 'LOAD_FAILED' },
    enrollmentsApi: api,
    setEnrollments: record('enrollments'),
    setTotalPages: record('totalPages'),
    setTotal: record('total'),
    setIsLoading: record('isLoading'),
    setError: record('error'),
    enrollmentsRequestRef: { current: 0 },
    ...overrides,
  };
}

test('a stale enrollment list completion cannot overwrite a newer page', async () => {
  const calls = recorder();
  const first = deferred();
  let call = 0;
  const fetchEnrollments = pageFunction('app/admin/enrollments/page.tsx', 'fetchEnrollments',
    enrollmentDeps({
      getAll: () => {
        call += 1;
        return call === 1 ? first.promise : Promise.resolve({ data: [{ id: 'new' }], meta: { totalPages: 2, total: 5 } });
      },
    }, calls));
  const pending = fetchEnrollments();
  await fetchEnrollments();
  first.resolve({ data: [{ id: 'old' }], meta: { totalPages: 9, total: 99 } });
  await pending;
  const writes = new Map(calls.calls.filter(([n]) => n === 'enrollments'));
  assert.deepEqual(writes.get('enrollments'), [{ id: 'new' }], 'old response must not replace the newer list');
  assert.equal(calls.calls.filter(([n, v]) => n === 'isLoading' && v === false).length, 1,
    'the stale finally must not clear the newer loading flag');
});

test('a stale enrollment list failure cannot surface after a newer load', async () => {
  const calls = recorder();
  const first = deferred();
  let call = 0;
  const fetchEnrollments = pageFunction('app/admin/enrollments/page.tsx', 'fetchEnrollments',
    enrollmentDeps({
      getAll: () => {
        call += 1;
        return call === 1 ? first.promise : Promise.resolve({ data: [], meta: { totalPages: 1, total: 0 } });
      },
    }, calls));
  const pending = fetchEnrollments();
  await fetchEnrollments();
  first.reject(new Error('HTTP 500'));
  await pending;
  assert.ok(
    calls.calls.filter(([n]) => n === 'error').every(([, v]) => v === ''),
    'the stale failure must not write a visible error over the newer result',
  );
});

test('course sections clear immediately for an empty selection and invalidate a pending load', async () => {
  const calls = recorder();
  const { record } = calls;
  const pending = deferred();
  const deps = {
    locale: 'en',
    copy: { sectionsLoadFailed: 'SECTIONS_FAILED' },
    sectionsApi: { getAll: () => pending.promise },
    fetchAllPages: async (fn) => (await fn(1, 50)).data,
    setSections: record('sections'),
    setSectionReferenceError: record('sectionReferenceError'),
    sectionsRequestRef: { current: 0 },
  };
  const fetchSections = pageFunction('app/admin/enrollments/page.tsx', 'fetchSectionsForCourse', deps);
  const inFlight = fetchSections('course-1');
  await flush();
  await fetchSections('');
  assert.deepEqual(new Map(calls.calls).get('sections'), [],
    'an empty course clears the options immediately');
  pending.resolve({ data: [{ id: 'late-section' }] });
  await inFlight;
  assert.equal(new Map(calls.calls).get('sections').length, 0,
    'the cleared selection must not be repopulated by the stale response');
});

test('a pending load for the new course clears the previous options midflight', async () => {
  const calls = recorder();
  const { record } = calls;
  const second = deferred();
  let call = 0;
  const deps = {
    locale: 'en',
    copy: { sectionsLoadFailed: 'SECTIONS_FAILED' },
    sectionsApi: {
      getAll: ({ courseId }) => {
        call += 1;
        return call === 1
          ? Promise.resolve({ data: [{ id: 'sec-course-a' }] })
          : second.promise.then(() => ({ data: [{ id: `sec-${courseId}` }] }));
      },
    },
    fetchAllPages: async (fn) => (await fn(1, 50)).data,
    setSections: record('sections'),
    setSectionReferenceError: record('sectionReferenceError'),
    sectionsRequestRef: { current: 0 },
  };
  const fetchSections = pageFunction('app/admin/enrollments/page.tsx', 'fetchSectionsForCourse', deps);
  await fetchSections('course-a');
  assert.deepEqual(new Map(calls.calls).get('sections'), [{ id: 'sec-course-a' }]);
  const pending = fetchSections('course-b');
  assert.deepEqual(new Map(calls.calls).get('sections'), [],
    'selecting a new course must drop the previous options while the request runs');
  second.resolve();
  await pending;
  assert.deepEqual(new Map(calls.calls).get('sections'), [{ id: 'sec-course-b' }]);
});

test('a stale section-options completion cannot overwrite the newer course', async () => {
  const calls = recorder();
  const { record } = calls;
  const first = deferred();
  let call = 0;
  const deps = {
    locale: 'en',
    copy: { sectionsLoadFailed: 'SECTIONS_FAILED' },
    sectionsApi: {
      getAll: ({ courseId }) => {
        call += 1;
        return call === 1 ? first.promise : Promise.resolve({ data: [{ id: `sec-${courseId}` }] });
      },
    },
    fetchAllPages: async (fn) => (await fn(1, 50)).data,
    setSections: record('sections'),
    setSectionReferenceError: record('sectionReferenceError'),
    sectionsRequestRef: { current: 0 },
  };
  const fetchSections = pageFunction('app/admin/enrollments/page.tsx', 'fetchSectionsForCourse', deps);
  const pendingA = fetchSections('course-a');
  await fetchSections('course-b');
  first.resolve({ data: [{ id: 'sec-course-a' }] });
  await pendingA;
  assert.deepEqual(new Map(calls.calls).get('sections'), [{ id: 'sec-course-b' }],
    'course A options must not land after course B was selected');
});

// ---------- admin users list generation guard ----------

test('a stale users completion cannot overwrite the newer filtered list', async () => {
  const calls = recorder();
  const first = deferred();
  let call = 0;
  const fetchUsers = pageFunction('app/admin/users/page.tsx', 'fetchUsers', {
    copy: { forbidden: 'forbidden', loadFailed: 'failed' },
    locale: 'en',
    page: 1,
    search: '',
    roleFilter: 'ALL',
    usersApi: {
      getAll: () => {
        call += 1;
        return call === 1 ? first.promise : Promise.resolve({ data: [{ id: 'new-user' }], meta: { total: 1, totalPages: 1 } });
      },
    },
    setUsers: calls.record('users'),
    setTotalItems: calls.record('totalItems'),
    setTotalPages: calls.record('totalPages'),
    setIsLoading: calls.record('isLoading'),
    setError: calls.record('error'),
    usersRequestRef: { current: 0 },
  });
  const pending = fetchUsers();
  await fetchUsers();
  first.resolve({ data: [{ id: 'old-user' }], meta: { total: 1, totalPages: 1 } });
  await pending;
  assert.deepEqual(new Map(calls.calls).get('users'), [{ id: 'new-user' }],
    'the older response must not overwrite the newer list');
  assert.equal(calls.calls.filter(([n, v]) => n === 'isLoading' && v === false).length, 1);
});

// ---------- lecturer grading section-scoped guards ----------

const { teachingPagesEn } = loadModule(
  'src/i18n/messages-teaching-pages.ts',
  {},
  path.resolve(__dirname, '..'),
);
const gradesCopy = teachingPagesEn.gradeEntry;

function gradingDeps(overrides, sharedCalls) {
  const calls = sharedCalls || recorder();
  const deps = {
    sectionId: 'section-a',
    gradeEntry: gradesCopy,
    messages: { common: { campusErrors: {} } },
    campusErrorMessage: (_err, _dict, fallback) => fallback,
    publishGuard: { current: { sectionId: '', ready: false } },
    gradeRequestRef: { current: 0 },
    gradeMutationRef: { current: 0 },
    loadedSectionRef: { current: '' },
    currentSectionRef: { current: 'section-a' },
    sectionsApi: { getSectionGrades: async () => ({ sectionId: 'section-a', enrollments: [] }) },
    setSectionData: calls.record('sectionData'),
    setGrades: calls.record('grades'),
    setEditedIds: calls.record('editedIds'),
    setScoreErrors: calls.record('scoreErrors'),
    setError: calls.record('error'),
    setIsLoading: calls.record('isLoading'),
    setIsRefreshing: calls.record('isRefreshing'),
    setIsSaving: calls.record('isSaving'),
    setIsPublishing: calls.record('isPublishing'),
    setStaleVersionConflict: calls.record('staleVersionConflict'),
    setRemoteChangedRows: calls.record('remoteChangedRows'),
    ...gradeHelpers(),
    ...overrides,
  };
  return { deps, calls };
}

// Route param changes recreate the callback with a new sectionId binding while
// the refs survive (the component is not remounted). Model that with two
// extracted instances sharing the same refs and recorders.
test('a pending section-A load cannot write into the sheet after navigating to B', async () => {
  const gate = deferred();
  const shared = {
    gradeRequestRef: { current: 0 },
    loadedSectionRef: { current: 'section-a' },
    currentSectionRef: { current: 'section-a' },
    publishGuard: { current: { sectionId: '', ready: false } },
    sectionsApi: {
      getSectionGrades: async (id) => {
        if (id === 'section-a') await gate.promise;
        return { sectionId: id, enrollments: [{ id: `enr-${id}` }] };
      },
    },
  };
  const calls = recorder();
  const loadFor = (sectionId) => pageFunction(
    'app/dashboard/lecturer/grades/[id]/page.tsx', 'fetchSectionGrades',
    gradingDeps({ sectionId, ...shared }, calls).deps,
  );
  // Pre-existing A data is on screen; navigation starts while its load hangs.
  const pending = loadFor('section-a')();
  await flush();
  shared.currentSectionRef.current = 'section-b';
  await loadFor('section-b')();
  gate.resolve();
  await pending;
  const lastData = calls.calls.filter(([n]) => n === 'sectionData').map(([, v]) => v).pop();
  assert.equal(lastData?.sectionId, 'section-b', 'only the current section may write its roster');
  assert.equal(shared.loadedSectionRef.current, 'section-b');
});

test('a stale section load failure/finally cannot mark the new sheet', async () => {
  const gate = deferred();
  const shared = {
    gradeRequestRef: { current: 0 },
    loadedSectionRef: { current: '' },
    currentSectionRef: { current: 'section-a' },
    publishGuard: { current: { sectionId: '', ready: false } },
    sectionsApi: {
      getSectionGrades: async (id) => {
        if (id === 'section-a') { await gate.promise; throw new Error('HTTP 500'); }
        return { sectionId: id, enrollments: [] };
      },
    },
  };
  const calls = recorder();
  const loadFor = (sectionId) => pageFunction(
    'app/dashboard/lecturer/grades/[id]/page.tsx', 'fetchSectionGrades',
    gradingDeps({ sectionId, ...shared }, calls).deps,
  );
  const pending = loadFor('section-a')();
  await flush();
  shared.currentSectionRef.current = 'section-b';
  await loadFor('section-b')();
  gate.resolve();
  await pending;
  assert.ok(
    calls.calls.filter(([n]) => n === 'error').every(([, v]) => v === ''),
    'the stale failure must not write a visible error on the new section',
  );
  assert.equal(calls.calls.filter(([n, v]) => n === 'isLoading' && v === false).length, 1,
    'the stale finally must not clear the newer loading flag');
});

test('a same-section silent reload still overlays preserved partial rows', async () => {
  const { deps, calls } = gradingDeps({
    loadedSectionRef: { current: 'section-a' },
    sectionsApi: {
      getSectionGrades: async (id) => ({
        sectionId: id,
        enrollments: [{ id: 'enr-1', processScore: 7, finalExamScore: 7 }],
      }),
    },
  });
  const load = pageFunction('app/dashboard/lecturer/grades/[id]/page.tsx', 'fetchSectionGrades', deps);
  await load({ silent: true, preserveLocalRows: [{ enrollmentId: 'enr-1', processScore: 9, finalExamScore: null }] });
  const gradesWrite = new Map(calls.calls.filter(([n]) => n === 'grades')).get('grades');
  assert.equal(gradesWrite.get('enr-1').processScore, 9,
    'preserved local rows survive the same-section silent reload');
  const editedWrite = new Map(calls.calls.filter(([n]) => n === 'editedIds')).get('editedIds');
  assert.ok(editedWrite.has('enr-1'), 'preserved rows stay flagged as edited');
});

test('a real section change clears the previous roster, drafts and errors', async () => {
  const { deps, calls } = gradingDeps({
    loadedSectionRef: { current: 'section-a' },
    sectionId: 'section-b',
    currentSectionRef: { current: 'section-b' },
    sectionsApi: {
      getSectionGrades: async (id) => ({ sectionId: id, enrollments: [{ id: `enr-${id}` }] }),
    },
  });
  const load = pageFunction('app/dashboard/lecturer/grades/[id]/page.tsx', 'fetchSectionGrades', deps);
  await load();
  assert.deepEqual(new Map(calls.calls).get('editedIds'), new Set(),
    'edited rows of the old section must not carry over');
  assert.deepEqual(new Map(calls.calls).get('scoreErrors'), new Map());
  assert.equal(deps.loadedSectionRef.current, 'section-b');
});

test('a save completing after navigation cannot refetch or touch the new sheet', async () => {
  const calls = recorder();
  const refetch = [];
  const { deps } = gradingDeps({});
  const save = pageFunction('app/dashboard/lecturer/grades/[id]/page.tsx', 'handleSave', {
    sectionId: 'section-a',
    sectionData: {
      sectionId: 'section-a',
      enrollments: [{ id: 'enr-1', processScore: 8, finalExamScore: 8 }],
    },
    isSaving: false,
    isPublishing: false,
    isRefreshing: false,
    staleVersionConflict: false,
    remoteChangedRows: null,
    ...gradeHelpers(),
    setStaleVersionConflict: () => {},
    setRemoteChangedRows: () => {},
    editedIds: new Set(['enr-1']),
    grades: new Map([['enr-1', { enrollmentId: 'enr-1', processScore: 9, finalExamScore: 9 }]]),
    scoreErrors: new Map(),
    sectionsApi: { updateSectionGrades: async () => { await new Promise((r) => setImmediate(r)); } },
    fetchSectionGrades: async (...args) => { refetch.push(args); },
    toast: { success: () => {}, warning: () => {}, error: () => {} },
    gradeEntry: { ...gradesCopy, saveFailed: 'SAVE_FAILED', partialRowsOnly: 'P {count}', partialRowsSkipped: 'S {count}' },
    formatNumber: (n) => String(n),
    messages: { common: { campusErrors: {} } },
    campusErrorMessage: (_e, _d, f) => f,
    publishGuard: deps.publishGuard,
    setIsSaving: calls.record('isSaving'),
    currentSectionRef: deps.currentSectionRef,
    gradeMutationRef: deps.gradeMutationRef,
    hasCompletedGrade: (u) => u != null && u.processScore != null && u.finalExamScore != null,
    focusFirstInvalidCell: () => {},
    focusFirstPartialCell: () => {},
  });
  const pending = save();
  // Render saw the route change: section flips and the mutation epoch bumps.
  deps.currentSectionRef.current = 'section-b';
  deps.gradeMutationRef.current += 1;
  await pending;
  assert.equal(refetch.length, 0, 'a stale save must not refetch the new section');
  assert.deepEqual(calls.calls, [['isSaving', true]],
    'the stale save finally must not clear the new section busy state');
});

function saveDeps(shared, overrides = {}) {
  return {
    sectionId: 'section-a',
    sectionData: {
      sectionId: 'section-a',
      enrollments: [{ id: 'enr-1', processScore: 8, finalExamScore: 8 }],
    },
    isSaving: false,
    isPublishing: false,
    isRefreshing: false,
    staleVersionConflict: false,
    remoteChangedRows: null,
    editedIds: new Set(['enr-1']),
    grades: new Map([['enr-1', { enrollmentId: 'enr-1', processScore: 9, finalExamScore: 9 }]]),
    scoreErrors: new Map(),
    sectionsApi: { updateSectionGrades: async () => {} },
    fetchSectionGrades: async () => {},
    toast: { success: () => {}, warning: () => {}, error: () => {} },
    gradeEntry: { ...gradesCopy, saveFailed: 'SAVE_FAILED', partialRowsOnly: 'P {count}', partialRowsSkipped: 'S {count}' },
    formatNumber: (n) => String(n),
    messages: { common: { campusErrors: {} } },
    campusErrorMessage: (_e, _d, f) => f,
    publishGuard: shared.publishGuard,
    setIsSaving: shared.setIsSaving,
    currentSectionRef: shared.currentSectionRef,
    gradeMutationRef: shared.gradeMutationRef,
    ...gradeHelpers(),
    setStaleVersionConflict: () => {},
    setRemoteChangedRows: () => {},
    focusFirstInvalidCell: () => {},
    focusFirstPartialCell: () => {},
    ...overrides,
  };
}

test('a save on section A cannot act after an A→B→A round trip', async () => {
  const calls = recorder();
  const shared = {
    publishGuard: { current: { sectionId: '', ready: false } },
    currentSectionRef: { current: 'section-a' },
    gradeMutationRef: { current: 0 },
    setIsSaving: calls.record('isSaving'),
  };
  const gate = deferred();
  const refetches = [];
  const save = pageFunction('app/dashboard/lecturer/grades/[id]/page.tsx', 'handleSave',
    saveDeps(shared, {
      sectionsApi: { updateSectionGrades: async () => { await gate.promise; } },
      fetchSectionGrades: async () => { refetches.push(1); },
      toast: {
        success: calls.record('success'),
        warning: calls.record('warning'),
        error: calls.record('toastError'),
      },
    }));
  const pending = save();
  // A→B then B→A: section id equality alone would resurrect the old save —
  // only the mutation epoch catches it.
  shared.currentSectionRef.current = 'section-b';
  shared.gradeMutationRef.current += 1;
  shared.currentSectionRef.current = 'section-a';
  shared.gradeMutationRef.current += 1;
  gate.resolve();
  await pending;
  assert.equal(refetches.length, 0, 'the old-A save must not refetch the new sheet');
  assert.equal(calls.calls.filter(([n]) => n === 'success').length, 0,
    'the old-A save must not toast on the new sheet');
  assert.deepEqual(calls.calls.filter(([n]) => n === 'isSaving'), [['isSaving', true]],
    'the old-A save finally must not clear the new busy flag');
});

test('a save rejection completing after navigation cannot toast or unbusy', async () => {
  const calls = recorder();
  const shared = {
    publishGuard: { current: { sectionId: '', ready: false } },
    currentSectionRef: { current: 'section-a' },
    gradeMutationRef: { current: 0 },
    setIsSaving: calls.record('isSaving'),
  };
  const gate = deferred();
  const save = pageFunction('app/dashboard/lecturer/grades/[id]/page.tsx', 'handleSave',
    saveDeps(shared, {
      sectionsApi: { updateSectionGrades: async () => { await gate.promise; throw new Error('HTTP 500'); } },
      toast: {
        success: calls.record('success'),
        warning: calls.record('warning'),
        error: calls.record('toastError'),
      },
    }));
  const pending = save();
  shared.currentSectionRef.current = 'section-b';
  shared.gradeMutationRef.current += 1;
  gate.resolve();
  await pending;
  assert.equal(calls.calls.filter(([n]) => n === 'toastError').length, 0,
    'the stale save failure must not toast on the new sheet');
  assert.deepEqual(calls.calls.filter(([n]) => n === 'isSaving'), [['isSaving', true]],
    'the stale save finally must not clear the new busy flag');
});

// A locale/copy refresh recreates fetchSectionGrades and reruns the load
// effect; its cleanup may invalidate stale REQUESTS but must never retire a
// still-current save — otherwise the save's finally cannot release isSaving.
test('a load-effect rerun during a pending save keeps the mutation epoch', async () => {
  const calls = recorder();
  const shared = {
    publishGuard: { current: { sectionId: '', ready: false } },
    currentSectionRef: { current: 'section-a' },
    gradeMutationRef: { current: 0 },
    gradeRequestRef: { current: 0 },
    setIsSaving: calls.record('isSaving'),
  };
  const gate = deferred();
  const refetches = [];
  const save = pageFunction('app/dashboard/lecturer/grades/[id]/page.tsx', 'handleSave',
    saveDeps(shared, {
      sectionsApi: { updateSectionGrades: async () => { await gate.promise; } },
      fetchSectionGrades: async () => { refetches.push(1); },
      toast: {
        success: calls.record('success'),
        warning: calls.record('warning'),
        error: calls.record('toastError'),
      },
    }));
  const pending = save();
  // The real load effect's cleanup — extracted from the page — must bump only
  // the request generation, not the mutation epoch.
  const effectSetup = pageEffect('app/dashboard/lecturer/grades/[id]/page.tsx',
    'gradeRequestRef', {
      hasAccess: true,
      fetchSectionGrades: async () => {},
      gradeRequestRef: shared.gradeRequestRef,
    });
  const cleanup = effectSetup();
  cleanup();
  assert.equal(shared.gradeRequestRef.current, 1, 'stale requests are invalidated');
  assert.equal(shared.gradeMutationRef.current, 1,
    'the mutation epoch must NOT advance on a non-navigation rerun');
  gate.resolve();
  await pending;
  assert.equal(refetches.length, 1, 'a still-current save refetches its sheet');
  assert.deepEqual(calls.calls.filter(([n]) => n === 'isSaving'),
    [['isSaving', true], ['isSaving', false]],
    'the save finally releases its own busy flag');
});

test('unmount invalidates a pending mutation through the dedicated effect', async () => {
  const calls = recorder();
  const shared = {
    publishGuard: { current: { sectionId: '', ready: false } },
    currentSectionRef: { current: 'section-a' },
    gradeMutationRef: { current: 0 },
    setIsSaving: calls.record('isSaving'),
  };
  const gate = deferred();
  const refetches = [];
  const save = pageFunction('app/dashboard/lecturer/grades/[id]/page.tsx', 'handleSave',
    saveDeps(shared, {
      sectionsApi: { updateSectionGrades: async () => { await gate.promise; } },
      fetchSectionGrades: async () => { refetches.push(1); },
      toast: {
        success: calls.record('success'),
        warning: calls.record('warning'),
        error: calls.record('toastError'),
      },
    }));
  const pending = save();
  const unmountSetup = pageEffect('app/dashboard/lecturer/grades/[id]/page.tsx',
    'gradeMutationRef', { gradeMutationRef: shared.gradeMutationRef });
  const unmountCleanup = unmountSetup();
  unmountCleanup();
  assert.equal(shared.gradeMutationRef.current, 2, 'unmount retires in-flight mutations');
  gate.resolve();
  await pending;
  assert.equal(refetches.length, 0, 'a mutation completing after unmount does not refetch');
  assert.equal(calls.calls.filter(([n]) => n === 'success').length, 0,
    'a mutation completing after unmount does not toast');
  assert.deepEqual(calls.calls.filter(([n]) => n === 'isSaving'), [['isSaving', true]],
    'its finally is retired too — there is no new sheet whose flag it could hold');
});

test('a publish confirmed after navigation must not reach the API', async () => {
  const calls = recorder();
  const shared = {
    publishGuard: { current: { sectionId: 'section-a', ready: true } },
    currentSectionRef: { current: 'section-a' },
    gradeMutationRef: { current: 0 },
  };
  const confirmGate = deferred();
  const publishes = [];
  const publish = pageFunction('app/dashboard/lecturer/grades/[id]/page.tsx', 'handlePublish', {
    sectionId: 'section-a',
    publishGuard: shared.publishGuard,
    currentSectionRef: shared.currentSectionRef,
    gradeMutationRef: shared.gradeMutationRef,
    confirm: () => confirmGate.promise,
    gradeEntry: { ...gradesCopy, publishTitle: 'T', publishMessage: 'M', publishGrades: 'P', published: 'DONE', publishFailed: 'FAIL' },
    sectionsApi: { publishSectionGrades: async (id) => { publishes.push(id); } },
    fetchSectionGrades: async () => {},
    toast: { success: calls.record('success'), error: calls.record('toastError') },
    campusErrorMessage: (_e, _d, f) => f,
    messages: { common: { campusErrors: {} } },
    setIsPublishing: calls.record('isPublishing'),
  });
  const pending = publish();
  await flush();
  // Lecturer navigates away while the confirm dialog is still open.
  shared.currentSectionRef.current = 'section-b';
  shared.gradeMutationRef.current += 1;
  confirmGate.resolve(true);
  await pending;
  assert.equal(publishes.length, 0, 'a stale confirmation must never publish');
  assert.equal(calls.calls.filter(([n, v]) => n === 'isPublishing' && v === true).length, 0,
    'the stale publish must not even raise the busy flag');
});

// ---------- W13-DEEPSEEK-WEB-B: latest-request guards ----------

const createEpoch = () => loadModule('src/lib/request-epoch.ts').createRequestEpoch();

test('a stale admin announcement list cannot overwrite the newer filter result', async () => {
  const calls = recorder();
  const first = deferred();
  let call = 0;
  const fetchAnnouncements = pageFunction('app/admin/announcements/page.tsx', 'fetchAnnouncements', {
    page: 1,
    filters: { semesterId: '', priority: '', search: '', status: 'ACTIVE' },
    announcementsApi: {
      getAll: () => {
        call += 1;
        return call === 1
          ? first.promise
          : Promise.resolve({ data: [{ id: 'new' }], meta: { totalPages: 2 } });
      },
    },
    setItems: calls.record('items'),
    setTotalPages: calls.record('totalPages'),
    setIsLoading: calls.record('isLoading'),
    setError: calls.record('error'),
    friendlyError: () => 'ERR',
    announcementsEpoch: createEpoch(),
  });
  const pending = fetchAnnouncements();
  await fetchAnnouncements();
  first.resolve({ data: [{ id: 'old' }], meta: { totalPages: 9 } });
  await pending;
  assert.deepEqual(new Map(calls.calls).get('items'), [{ id: 'new' }],
    'the older response must not overwrite the newer filter list');
  assert.equal(calls.calls.filter(([n, v]) => n === 'isLoading' && v === false).length, 1,
    'the stale finally must not clear the newer loading flag');
});

test('a stale review-queue status response cannot overwrite the newly selected status', async () => {
  const calls = recorder();
  const first = deferred();
  const epoch = createEpoch();
  let call = 0;
  let queueItems = [];
  const dependencies = (queueStatus) => ({
    queueStatus,
    queueEpoch: epoch,
    announcementsApi: {
      getAll: () => {
        call += 1;
        return call === 1
          ? first.promise
          : Promise.resolve({ data: [{ id: 'new' }], meta: { totalPages: 1 } });
      },
    },
    setQueueItems: (update) => {
      queueItems = typeof update === 'function' ? update(queueItems) : update;
      calls.record('items')(queueItems);
    },
    setQueueTotalPages: calls.record('totalPages'),
    setQueuePage: calls.record('page'),
    setQueueLoading: calls.record('loading'),
    setQueueError: calls.record('error'),
    setQueueLoadingMore: calls.record('loadingMore'),
    setQueueLoadMoreError: calls.record('loadMoreError'),
  });
  const oldFetch = pageFunction('app/dashboard/lecturer/announcements/page.tsx', 'fetchQueue', dependencies('DRAFT'));
  const newFetch = pageFunction('app/dashboard/lecturer/announcements/page.tsx', 'fetchQueue', dependencies('PUBLISHED'));
  const pending = oldFetch();
  await newFetch();
  first.resolve({ data: [{ id: 'old' }], meta: { totalPages: 1 } });
  await pending;
  assert.deepEqual(new Map(calls.calls).get('items'), [{ id: 'new' }],
    'the DRAFT response must not replace the PUBLISHED queue');
});

test('the review queue pages past item 50 and appends only unseen rows', async () => {
  let params;
  let queueItems = [{ id: 'a' }, { id: 'b' }];
  const values = {};
  const fetchQueue = pageFunction('app/dashboard/lecturer/announcements/page.tsx', 'fetchQueue', {
    queueStatus: 'ALL',
    queueEpoch: createEpoch(),
    announcementsApi: {
      getAll: async (query) => {
        params = query;
        return { data: [{ id: 'b' }, { id: 'c' }], meta: { totalPages: 3, total: 120 } };
      },
    },
    setQueueItems: (update) => {
      queueItems = typeof update === 'function' ? update(queueItems) : update;
    },
    setQueueTotalPages: (value) => { values.totalPages = value; },
    setQueuePage: (value) => { values.page = value; },
    setQueueLoading: () => {},
    setQueueError: () => {},
    setQueueLoadingMore: () => {},
    setQueueLoadMoreError: () => {},
  });
  await fetchQueue(2);
  assert.equal(params.page, 2, 'page 2 is requested instead of re-reading page 1');
  assert.equal(params.limit, 50);
  assert.equal(params.status, 'ALL');
  assert.deepEqual(queueItems.map((item) => item.id), ['a', 'b', 'c'],
    'the next page appends without duplicating an item already on screen');
  assert.equal(values.totalPages, 3);
  assert.equal(values.page, 2);
  const source = read('src/app/dashboard/lecturer/announcements/page.tsx');
  assert.match(source, /fetchQueue\(queuePage \+ 1\)/, 'the load-more control requests the next page');
  assert.match(source, /hasNextPage\(queuePage, queueTotalPages\)/, 'the control appears only while older pages exist');
});

test('a review-queue retry clears the error and reloads page 1', async () => {
  const calls = recorder();
  const retried = deferred();
  let requests = 0;
  const fetchQueue = pageFunction('app/dashboard/lecturer/announcements/page.tsx', 'fetchQueue', {
    queueStatus: 'ALL',
    queueEpoch: createEpoch(),
    announcementsApi: {
      getAll: (query) => {
        requests += 1;
        assert.equal(query.page, 1, 'the retry reloads the first page');
        return requests === 1
          ? Promise.reject(new Error('offline'))
          : retried.promise;
      },
    },
    setQueueItems: () => {},
    setQueueTotalPages: () => {},
    setQueuePage: () => {},
    setQueueLoading: calls.record('loading'),
    setQueueError: calls.record('error'),
    setQueueLoadingMore: () => {},
    setQueueLoadMoreError: () => {},
  });

  await fetchQueue();
  assert.equal(new Map(calls.calls).get('error'), true, 'the first failure surfaces');

  const retry = fetchQueue();
  assert.equal(new Map(calls.calls).get('error'), false, 'the retry clears the error before refetching');
  retried.resolve({ data: [{ id: 'visible' }], meta: { totalPages: 1 } });
  await retry;

  assert.equal(requests, 2, 'the retry issues a fresh queue request');
});

test('a slower lecturer feed response cannot replace the newest feed request', async () => {
  const requests = [deferred(), deferred()];
  let requestIndex = 0;
  let items = [];
  let currentEpoch = 0;
  const feedEpoch = {
    begin() { currentEpoch += 1; return currentEpoch; },
    isCurrent(epoch) { return epoch === currentEpoch; },
    invalidate() { currentEpoch += 1; },
  };
  const fetchFeed = pageFunction('app/dashboard/lecturer/announcements/page.tsx', 'fetchFeed', {
    announcementsApi: { getMy: () => requests[requestIndex++].promise },
    copy: { loadFailed: 'failed' },
    feedEpoch,
    feedAccountId: 'lecturer-a',
    feedAccountIdRef: { current: 'lecturer-a' },
    setIsLoading: () => {},
    setError: () => {},
    setIsLoadingMore: () => {},
    setLoadMoreError: () => {},
    setItems: (update) => { items = update(items); },
    setTotalPages: () => {},
    setPage: () => {},
  });

  const olderRequest = fetchFeed();
  const newerRequest = fetchFeed();
  requests[1].resolve({ data: [{ id: 'new' }], meta: { totalPages: 1 } });
  await newerRequest;
  requests[0].resolve({ data: [{ id: 'old' }], meta: { totalPages: 1 } });
  await olderRequest;

  assert.deepEqual(items, [{ id: 'new' }],
    'an older announcement response must not overwrite the latest feed');
});

test('the lecturer feed epoch retires when the page unmounts', () => {
  let invalidations = 0;
  const setup = pageEffect(
    'app/dashboard/lecturer/announcements/page.tsx',
    'feedEpoch.invalidate()',
    { feedEpoch: { invalidate: () => { invalidations += 1; } } },
  );
  const cleanup = setup();
  assert.equal(typeof cleanup, 'function');
  cleanup();
  assert.equal(invalidations, 1);
});

test('lecturer announcement page-local state is keyed to the authenticated user', () => {
  const source = read('src/app/dashboard/lecturer/announcements/page.tsx');
  assert.match(source, /<LecturerAnnouncementsWorkspace key=\{auth\.user\?\.id \?\? 'anonymous'\} auth=\{auth\} \/>/);
});

test('editor publish ignores a re-entrant invocation while a publish is in flight', async () => {
  let creates = 0;
  const publish = pageFunction('app/dashboard/editor/page.tsx', 'handlePublishAnnouncement', {
    isPublishingNotice: true,
    publishInFlightRef: { current: false },
    pendingSubmitRef: { current: null },
    editingId: null,
    handleUpdateAnnouncement: async () => {},
    title: 'Notice',
    content: '<p>Body</p>',
    priority: 'NORMAL',
    targetRole: 'ALL',
    locale: 'en',
    isVi: false,
    findAnnouncementLengthViolation: () => null,
    announcementLengthViolationMessage: () => '',
    announcementsApi: { create: async () => { creates += 1; } },
    audienceFor: () => ({}),
    clearPersistedDraft: () => {},
    fetchPublishedNotices: () => {},
    setIsPublishingNotice: () => {},
    toast: { success: () => {}, error: () => {} },
  });
  await publish();
  assert.equal(creates, 0, 'a publish already flagged in flight must not create a duplicate');
});

test('editor publish submits a new notice for review instead of claiming publication', async () => {
  const calls = [];
  const toasts = [];
  const publish = pageFunction('app/dashboard/editor/page.tsx', 'handlePublishAnnouncement', {
    isPublishingNotice: false,
    publishInFlightRef: { current: false },
    pendingSubmitRef: { current: null },
    editingId: null,
    handleUpdateAnnouncement: async () => {},
    title: 'Notice',
    content: '<p>Body</p>',
    priority: 'NORMAL',
    targetRole: 'ALL',
    locale: 'en',
    isVi: false,
    findAnnouncementLengthViolation: () => null,
    announcementLengthViolationMessage: () => '',
    copy: {
      notifications: {
        announcementPublished: 'Announcement successfully published to campus feed!',
        announcementSubmitFailed: 'Could not submit the announcement for review.',
        titleRequired: 'Title required',
      },
    },
    messages: {
      content: {
        lifecycle: {
          submitted: 'Draft submitted for review.',
          approved: 'Announcement published.',
        },
      },
    },
    announcementsApi: {
      create: async (payload) => {
        calls.push(['create', payload]);
        return { id: 'notice-1', status: 'DRAFT' };
      },
      submit: async (id) => {
        calls.push(['submit', id]);
        return { id, status: 'IN_REVIEW' };
      },
    },
    audienceFor: () => ({ isGlobal: true, targetRoles: ['STUDENT', 'LECTURER', 'ADMIN'] }),
    clearPersistedDraft: () => calls.push(['clear']),
    fetchPublishedNotices: () => calls.push(['refresh']),
    setIsPublishingNotice: () => {},
    toast: { success: (message) => toasts.push(message), error: (message) => toasts.push(message) },
  });

  await publish();

  assert.deepEqual(calls.map(([kind]) => kind), ['create', 'submit', 'clear', 'refresh']);
  assert.equal(calls[1][1], 'notice-1', 'the draft the server created is the one submitted');
  assert.deepEqual(
    toasts,
    ['Draft submitted for review.'],
    'a new draft is authored by the caller, so the server can only have queued it for review',
  );
});

test('editor publish reports publication only after the server confirms PUBLISHED', async () => {
  const toasts = [];
  let submitted = 0;
  const publish = pageFunction('app/dashboard/editor/page.tsx', 'handlePublishAnnouncement', {
    isPublishingNotice: false,
    publishInFlightRef: { current: false },
    pendingSubmitRef: { current: null },
    editingId: null,
    handleUpdateAnnouncement: async () => {},
    title: 'Notice',
    content: '<p>Body</p>',
    priority: 'NORMAL',
    targetRole: 'ALL',
    locale: 'en',
    isVi: false,
    findAnnouncementLengthViolation: () => null,
    announcementLengthViolationMessage: () => '',
    copy: {
      notifications: {
        announcementPublished: 'Announcement successfully published to campus feed!',
        announcementSubmitFailed: 'Could not submit the announcement for review.',
        titleRequired: 'Title required',
      },
    },
    messages: {
      content: {
        lifecycle: {
          submitted: 'Draft submitted for review.',
          approved: 'Announcement published.',
        },
      },
    },
    announcementsApi: {
      create: async () => ({ id: 'notice-2', status: 'DRAFT' }),
      submit: async (id) => {
        submitted += 1;
        return { id, status: 'PUBLISHED' };
      },
    },
    audienceFor: () => ({ isGlobal: true, targetRoles: ['STUDENT', 'LECTURER', 'ADMIN'] }),
    clearPersistedDraft: () => {},
    fetchPublishedNotices: () => {},
    setIsPublishingNotice: () => {},
    toast: { success: (message) => toasts.push(message), error: (message) => toasts.push(message) },
  });

  await publish();

  assert.equal(submitted, 1, 'the draft is sent to the workflow');
  assert.deepEqual(
    toasts,
    ['Announcement successfully published to campus feed!'],
    'the published copy is allowed only after the server state says PUBLISHED',
  );
});

test('a failed review submission is retried on the same draft instead of creating another', async () => {
  const calls = [];
  const toasts = [];
  let failSubmit = true;
  const pendingSubmitRef = { current: null };
  const publish = pageFunction('app/dashboard/editor/page.tsx', 'handlePublishAnnouncement', {
    isPublishingNotice: false,
    publishInFlightRef: { current: false },
    pendingSubmitRef,
    editingId: null,
    handleUpdateAnnouncement: async () => {},
    title: 'Notice',
    content: '<p>Body</p>',
    priority: 'NORMAL',
    targetRole: 'ALL',
    locale: 'en',
    isVi: false,
    findAnnouncementLengthViolation: () => null,
    announcementLengthViolationMessage: () => '',
    copy: { notifications: { announcementPublished: 'Published', announcementSubmitFailed: 'Submit failed', titleRequired: 'Title' } },
    messages: { content: { lifecycle: { submitted: 'Submitted', approved: 'Approved' } } },
    announcementsApi: {
      create: async () => {
        calls.push('create');
        return { id: 'notice-3', status: 'DRAFT' };
      },
      submit: async (id) => {
        calls.push('submit');
        if (failSubmit) throw new Error('offline');
        return { id, status: 'IN_REVIEW' };
      },
    },
    audienceFor: () => ({ isGlobal: true, targetRoles: ['STUDENT'] }),
    clearPersistedDraft: () => {},
    fetchPublishedNotices: () => {},
    setIsPublishingNotice: () => {},
    toast: { success: (message) => toasts.push(message), error: (message) => toasts.push(message) },
  });

  await publish();
  failSubmit = false;
  await publish();

  assert.deepEqual(calls, ['create', 'submit', 'submit'], 'the retry submits the draft that already exists');
  assert.deepEqual(toasts, ['Submit failed', 'Submitted']);
  assert.equal(pendingSubmitRef.current, null, 'a submitted draft is not remembered');
});
test('the editor live list reads only published notices', async () => {
  const requests = [];
  let notices = [];
  const fetchNotices = pageFunction('app/dashboard/editor/page.tsx', 'fetchPublishedNotices', {
    announcementsApi: {
      getAll: async (params) => {
        requests.push(params);
        return { data: [{ id: 'published-1' }] };
      },
    },
    siteAppearance: { postOrder: [] },
    orderByIds: (items) => items,
    setLoadingNotices: () => {},
    setPublishedNotices: (value) => {
      notices = value;
    },
    setHasUnsavedNoticeOrder: () => {},
    setNoticesLoadError: () => {},
  });

  await fetchNotices();

  assert.deepEqual(requests, [{ page: 1, limit: 15, status: 'PUBLISHED' }]);
  assert.deepEqual(notices, [{ id: 'published-1' }]);
});

test('editor update ignores a re-entrant invocation while an update is in flight', async () => {
  let updates = 0;
  const update = pageFunction('app/dashboard/editor/page.tsx', 'handleUpdateAnnouncement', {
    isPublishingNotice: false,
    publishInFlightRef: { current: true },
    editingId: 'notice-1',
    title: 'Notice',
    content: '<p>Body</p>',
    priorityKnown: true,
    priority: 'NORMAL',
    audienceKnown: true,
    targetRole: 'ALL',
    locale: 'en',
    isVi: false,
    editingVersion: 1,
    findAnnouncementLengthViolation: () => null,
    announcementLengthViolationMessage: () => '',
    announcementsApi: { update: async () => { updates += 1; } },
    audienceFor: () => ({}),
    setEditingVersion: () => {},
    clearPersistedDraft: () => {},
    fetchPublishedNotices: () => {},
    setIsPublishingNotice: () => {},
    toast: { success: () => {}, error: () => {} },
  });
  await update();
  assert.equal(updates, 0, 'an update already in flight must not be sent twice');
});

test('admin section delete ignores a second trigger while the first is pending', async () => {
  let deletes = 0;
  const handleDelete = pageFunction('app/admin/sections/page.tsx', 'handleDelete', {
    copy: {
      deleteTitle: 'Delete',
      deleteMessage: () => 'Confirm',
      deleteConfirm: 'Delete',
      deleted: 'Deleted',
      deleteFailed: 'Failed',
      unknownCourse: 'Unknown',
    },
    confirm: async () => true,
    deletingRef: { current: true },
    setDeletingSectionId: () => {},
    adminSectionsApi: { delete: async () => { deletes += 1; } },
    toast: { success: () => {}, error: () => {} },
    sections: [],
    page: 1,
    setPage: () => {},
    fetchSections: async () => {},
  });
  await handleDelete({ id: 'section-1', sectionNumber: '01', course: { code: 'CS101' } });
  assert.equal(deletes, 0, 'the pending delete guard must block the second call');
});

test('a stale grading-section response cannot replace the newly selected semester', async () => {
  const calls = recorder();
  const first = deferred();
  const epoch = createEpoch();
  let call = 0;
  const dependencies = (selectedSemester) => ({
    selectedSemester,
    sectionsEpoch: epoch,
    sectionsApi: {
      getMyGradingSections: () => {
        call += 1;
        return call === 1
          ? first.promise
          : Promise.resolve([{ id: 'new-section' }]);
      },
    },
    messages: { lecturerGrades: { errors: { loadFailed: 'FAILED' } } },
    setSections: calls.record('sections'),
    setIsLoading: calls.record('isLoading'),
    setError: calls.record('error'),
  });
  const oldFetch = pageFunction('app/dashboard/lecturer/grades/page.tsx', 'fetchSections', dependencies('term-a'));
  const newFetch = pageFunction('app/dashboard/lecturer/grades/page.tsx', 'fetchSections', dependencies('term-b'));
  const pending = oldFetch();
  await newFetch();
  first.resolve([{ id: 'old-section' }]);
  await pending;
  assert.deepEqual(new Map(calls.calls).get('sections'), [{ id: 'new-section' }],
    'term A sections must not land after term B was selected');
});

test('a stale audit page cannot overwrite the newer filter result', async () => {
  const calls = recorder();
  const first = deferred();
  let call = 0;
  const load = pageFunction('app/admin/audit/page.tsx', 'load', {
    page: 1,
    PAGE_SIZE: 20,
    applied: { search: 'new' },
    auditEpoch: createEpoch(),
    adminAuditApi: {
      list: () => {
        call += 1;
        return call === 1
          ? first.promise
          : Promise.resolve({ data: [{ id: 'new' }], meta: { totalPages: 2, total: 25 } });
      },
    },
    setRows: calls.record('rows'),
    setTotalPages: calls.record('totalPages'),
    setTotal: calls.record('total'),
    setLoading: calls.record('loading'),
    setError: calls.record('error'),
    campusErrorMessage: () => 'ERR',
    messages: { common: { campusErrors: {} } },
    copy: { loadFailed: 'FAILED' },
  });
  const pending = load();
  await load();
  first.resolve({ data: [{ id: 'old' }], meta: { totalPages: 9, total: 99 } });
  await pending;
  assert.deepEqual(new Map(calls.calls).get('rows'), [{ id: 'new' }],
    'the older audit response must not overwrite the newer page');
});

test('section edits omit unchanged fields and detect a changed schedule snapshot', () => {
  const scheduleListsEqual = pageHelper('app/admin/sections/page.tsx', 'sectionScheduleListsEqual', {});
  const buildPayload = pageHelper('app/admin/sections/page.tsx', 'buildSectionUpdatePayload', {
    sectionScheduleListsEqual: scheduleListsEqual,
  });
  const hasChanged = pageHelper('app/admin/sections/page.tsx', 'hasSectionSnapshotChanged', {
    sectionScheduleListsEqual: scheduleListsEqual,
  });
  const baseline = {
    id: 'section-1',
    courseId: 'course-1',
    semesterId: 'semester-1',
    sectionNumber: '01',
    lecturerId: 'lecturer-1',
    capacity: 30,
    status: 'OPEN',
    schedules: [{
      id: 'monday', dayOfWeek: 1, startTime: '08:00', endTime: '10:00', classroom: { id: 'room-1' },
    }],
  };
  const form = {
    courseId: 'course-1', semesterId: 'semester-1', sectionNumber: '01',
    lecturerId: 'lecturer-1', capacity: 40, status: 'OPEN',
  };
  const meetings = [{
    rowId: 'monday', dayOfWeek: 1, startTime: '08:00', endTime: '10:00', classroomId: 'room-1',
  }];
  assert.deepEqual(buildPayload(baseline, form, meetings, true), { capacity: 40 },
    'a capacity-only edit must not resend unchanged relations or the schedule list');

  const anotherAdminSchedule = [...baseline.schedules, {
    id: 'wednesday', dayOfWeek: 3, startTime: '10:00', endTime: '12:00', classroom: { id: 'room-2' },
  }];
  assert.equal(hasChanged(baseline, { ...baseline, schedules: anotherAdminSchedule }), true,
    'a pre-save read must detect a meeting added after the modal opened');
  assert.deepEqual(buildPayload(baseline, form, [
    ...meetings,
    { rowId: 'new', dayOfWeek: 3, startTime: '10:00', endTime: '12:00', classroomId: 'room-2' },
  ], true).schedules, [
    { dayOfWeek: 1, startTime: '08:00', endTime: '10:00', classroomId: 'room-1' },
    { dayOfWeek: 3, startTime: '10:00', endTime: '12:00', classroomId: 'room-2' },
  ], 'an explicitly changed schedule remains part of the update');
});

test('course edits send only changed catalogue fields and detect a stale credit value', () => {
  const buildPayload = pageHelper('app/admin/courses/page.tsx', 'buildCourseUpdatePayload', {});
  const hasChanged = pageHelper('app/admin/courses/page.tsx', 'hasCourseSnapshotChanged', {});
  const baseline = {
    id: 'course-1', code: 'CS101', name: 'Intro', nameEn: 'Intro', nameVi: 'Nhập môn',
    description: 'Old', descriptionEn: 'Old', descriptionVi: 'Cũ',
    credits: 3, departmentId: 'department-1', isActive: true,
  };
  const form = {
    code: 'CS101', nameEn: 'Intro', nameVi: 'Nhập môn', credits: 4,
    departmentId: 'department-1', descriptionEn: 'Old', descriptionVi: 'Cũ',
  };
  assert.deepEqual(buildPayload(baseline, form), { credits: 4 },
    'a credit edit must not resend unchanged department or text fields');
  assert.equal(hasChanged(baseline, { ...baseline, credits: 5 }), true,
    'a pre-save read must detect a credit value changed after the form loaded');
});

test('an unchanged admin user status is omitted from profile updates', () => {
  const hasChanged = pageHelper('app/admin/users/page.tsx', 'hasUserStatusChanged', {});
  assert.equal(hasChanged('ACTIVE', 'ACTIVE'), false,
    'an unchanged loaded status must not become a write that can revive a suspended account');
  assert.equal(hasChanged('ACTIVE', 'SUSPENDED'), true,
    'an explicit status change must still be sent');
});

test('admin catalog and credit-limit lists ignore late responses from older filters', async (t) => {
  const cases = [
    {
      label: 'sections', file: 'app/admin/sections/page.tsx', callback: 'fetchSections',
      epochName: 'sectionsEpoch', apiName: 'adminSectionsApi', method: 'getAll',
      setter: 'setSections', oldParams: { page: 2, semesterFilter: 'term-a', search: 'first' },
      newParams: { page: 1, semesterFilter: 'term-b', search: 'second' },
    },
    {
      label: 'courses', file: 'app/admin/courses/page.tsx', callback: 'fetchCourses',
      epochName: 'coursesEpoch', apiName: 'coursesApi', method: 'getAll',
      setter: 'setCourses', oldParams: { page: 2, departmentFilter: 'department-a', search: 'first' },
      newParams: { page: 1, departmentFilter: 'department-b', search: 'second' },
    },
    {
      label: 'semesters', file: 'app/admin/semesters/page.tsx', callback: 'fetchSemesters',
      epochName: 'semestersEpoch', apiName: 'adminSemestersApi', method: 'getAll',
      setter: 'setSemesters', oldParams: { page: 2, search: 'first' },
      newParams: { page: 1, search: 'second' },
    },
    {
      label: 'credit-limit applications', file: 'app/admin/credit-limit-applications/page.tsx', callback: 'load',
      epochName: 'applicationsEpoch', apiName: 'adminRegistrationApi', method: 'creditLimitApplications',
      setter: 'setApplications', oldParams: { filter: 'PENDING' }, newParams: { filter: 'APPROVED' },
    },
    {
      label: 'departments', file: 'app/admin/departments/page.tsx', callback: 'fetchDepartments',
      epochName: 'departmentsEpoch', apiName: 'departmentsApi', method: 'getAll',
      setter: 'setDepartments', oldParams: { page: 2, search: 'first' },
      newParams: { page: 1, search: 'second' },
    },
    {
      label: 'classrooms', file: 'app/admin/classrooms/page.tsx', callback: 'fetchClassrooms',
      epochName: 'classroomsEpoch', apiName: 'classroomsApi', method: 'getAll',
      setter: 'setClassrooms', oldParams: { page: 2, search: 'first' },
      newParams: { page: 1, search: 'second' },
    },
    {
      label: 'academic years', file: 'app/admin/academic-years/page.tsx', callback: 'fetchAcademicYears',
      epochName: 'academicYearsEpoch', apiName: 'academicYearsApi', method: 'getAll',
      setter: 'setAcademicYears', oldParams: { page: 2, search: 'first' },
      newParams: { page: 1, search: 'second' },
    },
    {
      label: 'lecturers', file: 'app/admin/lecturers/page.tsx', callback: 'fetchLecturers',
      epochName: 'lecturersEpoch', apiName: 'lecturersApi', method: 'getAll',
      setter: 'setLecturers', oldParams: { page: 2, search: 'first' },
      newParams: { page: 1, search: 'second' },
    },
    {
      label: 'attendance', file: 'app/admin/attendance/page.tsx', callback: 'fetchRecords',
      epochName: 'attendanceEpoch', apiName: 'attendanceApi', method: 'adminList',
      setter: 'setRecords', oldParams: { page: 2, sectionFilter: 'sec-a', dateFilter: '2026-11-01' },
      newParams: { page: 1, sectionFilter: 'sec-b', dateFilter: '2026-11-02' },
    },
  ];

  for (const entry of cases) {
    await t.test(entry.label, async () => {
      const calls = recorder();
      const first = deferred();
      let request = 0;
      const epoch = createEpoch();
      const api = {
        [entry.method]: () => {
          request += 1;
          return request === 1 ? first.promise : Promise.resolve(
            entry.label === 'credit-limit applications'
              ? [{ id: 'new' }]
              : { data: [{ id: 'new' }], meta: { totalPages: 2, total: 5 } },
          );
        },
      };
      const base = {
        [entry.epochName]: epoch,
        [entry.apiName]: api,
        [entry.setter]: calls.record('rows'),
        setTotalItems: calls.record('totalItems'),
        setError: calls.record('error'),
        setTotalPages: calls.record('totalPages'),
        setTotal: calls.record('total'),
        setIsLoading: calls.record('loading'),
        setLoading: calls.record('loading'),
        page: 1,
        search: '',
        departmentFilter: '',
        semesterFilter: '',
        sectionFilter: '',
        dateFilter: '',
        PAGE_LIMIT: 20,
        filter: 'PENDING',
        copy: { loadFailed: 'FAILED', errorDescription: 'FAILED' },
        messages: { common: { campusErrors: {} } },
        campusErrorMessage: () => 'ERROR',
      };
      const oldLoad = pageFunction(entry.file, entry.callback, { ...base, ...entry.oldParams });
      const newLoad = pageFunction(entry.file, entry.callback, { ...base, ...entry.newParams });
      const pending = oldLoad();
      await newLoad();
      first.resolve(entry.label === 'credit-limit applications'
        ? [{ id: 'old' }]
        : { data: [{ id: 'old' }], meta: { totalPages: 9, total: 99 } });
      await pending;
      assert.deepEqual(new Map(calls.calls).get('rows'), [{ id: 'new' }],
        'the earlier filter or page must not replace the latest result');
      assert.equal(calls.calls.filter(([name, value]) => name === 'loading' && value === false).length, 1,
        'a stale finally block must not clear the current loading state');
    });
  }
});

test('an already-reviewed credit-limit request gets specific copy and reloads the list', async () => {
  const calls = recorder();
  let reloads = 0;
  const submitReview = pageFunction('app/admin/credit-limit-applications/page.tsx', 'submitReview', {
    selected: { id: 'application-1' },
    note: '',
    decision: 'APPROVED',
    setReviewError: calls.record('reviewError'),
    setSaving: calls.record('saving'),
    adminRegistrationApi: {
      reviewCreditLimitApplication: async () => {
        throw { response: { status: 409, data: { code: 'CREDIT_LIMIT_APPLICATION_NOT_PENDING' } } };
      },
    },
    setSelected: calls.record('selected'),
    toast: { success: () => {}, error: () => {} },
    copy: { alreadyReviewed: 'ALREADY_REVIEWED', loadFailed: 'LOAD_FAILED' },
    messages: { common: { campusErrors: {
      network: 'NETWORK', validation: 'VALIDATION', conflict: 'GENERIC_CONFLICT',
      unauthorized: 'UNAUTHORIZED', forbidden: 'FORBIDDEN', notFound: 'NOT_FOUND',
      server: 'SERVER', unknown: 'UNKNOWN',
    } } },
    campusErrorCode: (error) => loadModule('src/lib/campus-error.ts').campusErrorCode(error),
    campusErrorMessage: (error, copy, fallback) => loadModule('src/lib/campus-error.ts')
      .campusErrorMessage(error, copy, fallback),
    campusCodeMessage: (error, copy, fallback) => loadModule('src/lib/campus-error.ts')
      .campusCodeMessage(error, copy, fallback),
    load: async () => { reloads += 1; },
  });
  await submitReview({ preventDefault() {} });
  assert.equal(new Map(calls.calls).get('reviewError'), 'ALREADY_REVIEWED',
    'a reviewed conflict must not be rendered as the generic 409 line');
  assert.equal(reloads, 1, 'the changed application list must be reloaded');
});

test('academic-year edits send only changed fields so a stale form cannot revert another admin', async () => {
  const buildPayload = pageHelper('app/admin/academic-years/page.tsx', 'buildAcademicYearUpdatePayload', {});
  let saved = null;
  const handleSubmit = pageFunction('app/admin/academic-years/page.tsx', 'handleSubmit', {
    formData: { year: 2026, startDate: '2026-09-01', endDate: '2027-01-20' },
    copy: { endDateBeforeStart: 'ORDER', saveFailed: 'FAILED' },
    setIsSaving: () => {},
    editingYear: {
      id: 'year-1', year: 2026,
      startDate: '2026-09-01T00:00:00.000Z', endDate: '2027-01-15T00:00:00.000Z',
    },
    academicYearsApi: {
      update: async (id, payload) => { saved = { id, payload }; },
    },
    toast: { success: () => {}, error: () => {} },
    closeModal: () => {},
    fetchAcademicYears: async () => {},
    campusErrorMessage: () => 'ERR',
    messages: { common: { campusErrors: {} } },
    buildAcademicYearUpdatePayload: buildPayload,
  });
  await handleSubmit({ preventDefault() {} });
  assert.deepEqual(saved, { id: 'year-1', payload: { endDate: '2027-01-20' } },
    'an end-date edit must not resend the unchanged year or start date');
});

test('semester edits send only changed fields so a stale form cannot revert another admin', async () => {
  const buildPayload = pageHelper('app/admin/semesters/page.tsx', 'buildSemesterUpdatePayload', {});
  let saved = null;
  const handleSubmit = pageFunction('app/admin/semesters/page.tsx', 'handleSubmit', {
    formData: {
      nameEn: 'Fall 2026', nameVi: 'Học kỳ 1', type: 'FIRST',
      academicYearId: 'year-1', startDate: '2026-09-01', endDate: '2027-01-20',
    },
    copy: { updated: 'UPDATED', created: 'CREATED', saveFailed: 'FAILED' },
    setIsSaving: () => {},
    editingSemester: {
      id: 'semester-1', name: 'Fall 2026', nameEn: 'Fall 2026', nameVi: 'Học kỳ 1',
      type: 'FIRST', academicYearId: 'year-1',
      startDate: '2026-09-01T00:00:00.000Z', endDate: '2027-01-15T00:00:00.000Z',
      status: 'DRAFT',
    },
    adminSemestersApi: {
      update: async (id, payload) => { saved = { id, payload }; },
    },
    toast: { success: () => {}, error: () => {} },
    closeModal: () => {},
    fetchSemesters: async () => {},
    campusErrorMessage: () => 'ERR',
    messages: { common: { campusErrors: {} } },
    buildSemesterUpdatePayload: buildPayload,
  });
  await handleSubmit({ preventDefault() {} });
  assert.deepEqual(saved, { id: 'semester-1', payload: { endDate: '2027-01-20' } },
    'an end-date edit must not resend the unchanged names, type, year, or start date');
});

test('classroom edits send only changed fields so a stale form cannot revert another admin', async () => {
  const buildPayload = pageHelper('app/admin/classrooms/page.tsx', 'buildClassroomUpdatePayload', {});
  let saved = null;
  const handleSubmit = pageFunction('app/admin/classrooms/page.tsx', 'handleSubmit', {
    formData: { building: 'A', roomNumber: '101', capacity: 40, type: 'LECTURE' },
    copy: { updated: 'UPDATED', created: 'CREATED', saveFailed: 'FAILED' },
    setIsSaving: () => {},
    editingRoom: {
      id: 'room-1', building: 'A', roomNumber: '101', capacity: 30, type: 'LECTURE', isActive: true,
    },
    classroomsApi: {
      update: async (id, payload) => { saved = { id, payload }; },
    },
    toast: { success: () => {}, error: () => {} },
    closeModal: () => {},
    fetchClassrooms: async () => {},
    campusErrorMessage: () => 'ERR',
    messages: { common: { campusErrors: {} } },
    buildClassroomUpdatePayload: buildPayload,
  });
  await handleSubmit({ preventDefault() {} });
  assert.deepEqual(saved, { id: 'room-1', payload: { capacity: 40 } },
    'a capacity edit must not resend the unchanged building, room, or type');
});

test('department edits send only changed fields so a stale form cannot revert another admin', async () => {
  const buildPayload = pageHelper('app/admin/departments/page.tsx', 'buildDepartmentUpdatePayload', {});
  let saved = null;
  const handleSubmit = pageFunction('app/admin/departments/page.tsx', 'handleSubmit', {
    formData: {
      nameEn: 'Computing', nameVi: 'Khoa học máy tính', code: 'CS',
      descriptionEn: 'Old', descriptionVi: 'Cũ',
    },
    copy: { updated: 'UPDATED', created: 'CREATED', saveFailed: 'FAILED' },
    setIsSaving: () => {},
    editingDepartment: {
      id: 'department-1', name: 'Computing', nameEn: 'Computing', nameVi: 'Máy tính', code: 'CS',
      description: 'Old', descriptionEn: 'Old', descriptionVi: 'Cũ', isActive: true,
    },
    departmentsApi: {
      update: async (id, payload) => { saved = { id, payload }; },
    },
    toast: { success: () => {}, error: () => {} },
    closeModal: () => {},
    fetchDepartments: async () => {},
    campusErrorMessage: () => 'ERR',
    messages: { common: { campusErrors: {} } },
    buildDepartmentUpdatePayload: buildPayload,
  });
  await handleSubmit({ preventDefault() {} });
  assert.deepEqual(saved, { id: 'department-1', payload: { nameVi: 'Khoa học máy tính' } },
    'a Vietnamese-name edit must not resend the unchanged code, fallback name, or descriptions');
});

test('lecturer edits send only changed profile fields so a stale form cannot revert another admin', async () => {
  const buildPayload = pageHelper('app/admin/lecturers/page.tsx', 'buildLecturerUpdatePayload', {});
  let saved = null;
  const handleSubmit = pageFunction('app/admin/lecturers/page.tsx', 'handleSubmit', {
    formData: {
      employeeId: 'E1', userId: 'user-1', departmentId: 'department-2', specialization: 'AI',
    },
    copy: { updated: 'UPDATED', created: 'CREATED', saveFailed: 'FAILED' },
    setIsSaving: () => {},
    editingLecturer: {
      id: 'lecturer-1', employeeId: 'E1', userId: 'user-1', departmentId: 'department-1',
      specialization: 'AI', isActive: true,
    },
    lecturersApi: {
      update: async (id, payload) => { saved = { id, payload }; },
    },
    toast: { success: () => {}, error: () => {} },
    closeModal: () => {},
    fetchLecturers: async () => {},
    campusErrorMessage: () => 'ERR',
    messages: { common: { campusErrors: {} } },
    buildLecturerUpdatePayload: buildPayload,
  });
  await handleSubmit({ preventDefault() {} });
  assert.deepEqual(saved, { id: 'lecturer-1', payload: { departmentId: 'department-2' } },
    'a department edit must not resend the unchanged employee, user, or specialization');
});

test('catalogue edits with no changed fields do not call the update endpoint', async (t) => {
  const cases = [
    {
      label: 'academic years', file: 'app/admin/academic-years/page.tsx',
      helper: 'buildAcademicYearUpdatePayload', apiName: 'academicYearsApi',
      editingName: 'editingYear',
      baseline: {
        id: 'year-1', year: 2026,
        startDate: '2026-09-01T00:00:00.000Z', endDate: '2027-01-15T00:00:00.000Z',
      },
      formData: { year: 2026, startDate: '2026-09-01', endDate: '2027-01-15' },
      extraDeps: { fetchAcademicYears: async () => {} },
    },
    {
      label: 'semesters', file: 'app/admin/semesters/page.tsx',
      helper: 'buildSemesterUpdatePayload', apiName: 'adminSemestersApi',
      editingName: 'editingSemester',
      baseline: {
        id: 'semester-1', name: 'Fall 2026', nameEn: 'Fall 2026', nameVi: 'Học kỳ 1',
        type: 'FIRST', academicYearId: 'year-1',
        startDate: '2026-09-01T00:00:00.000Z', endDate: '2027-01-15T00:00:00.000Z',
        status: 'DRAFT',
      },
      formData: {
        nameEn: 'Fall 2026', nameVi: 'Học kỳ 1', type: 'FIRST',
        academicYearId: 'year-1', startDate: '2026-09-01', endDate: '2027-01-15',
      },
      extraDeps: { fetchSemesters: async () => {} },
    },
    {
      label: 'classrooms', file: 'app/admin/classrooms/page.tsx',
      helper: 'buildClassroomUpdatePayload', apiName: 'classroomsApi',
      editingName: 'editingRoom',
      baseline: {
        id: 'room-1', building: 'A', roomNumber: '101', capacity: 30, type: 'LECTURE',
      },
      formData: { building: 'A', roomNumber: '101', capacity: 30, type: 'LECTURE' },
      extraDeps: { fetchClassrooms: async () => {} },
    },
    {
      label: 'departments', file: 'app/admin/departments/page.tsx',
      helper: 'buildDepartmentUpdatePayload', apiName: 'departmentsApi',
      editingName: 'editingDepartment',
      baseline: {
        id: 'department-1', name: 'Computing', nameEn: 'Computing', nameVi: 'Máy tính',
        code: 'CS', description: 'Old', descriptionEn: 'Old', descriptionVi: 'Cũ',
      },
      formData: {
        nameEn: 'Computing', nameVi: 'Máy tính', code: 'CS',
        descriptionEn: 'Old', descriptionVi: 'Cũ',
      },
      extraDeps: { fetchDepartments: async () => {} },
    },
    {
      label: 'lecturers', file: 'app/admin/lecturers/page.tsx',
      helper: 'buildLecturerUpdatePayload', apiName: 'lecturersApi',
      editingName: 'editingLecturer',
      baseline: {
        id: 'lecturer-1', employeeId: 'E1', userId: 'user-1',
        departmentId: 'department-1', specialization: 'AI',
      },
      formData: {
        employeeId: 'E1', userId: 'user-1', departmentId: 'department-1', specialization: 'AI',
      },
      extraDeps: { fetchLecturers: async () => {} },
    },
  ];

  for (const entry of cases) {
    await t.test(entry.label, async () => {
      const buildPayload = pageHelper(entry.file, entry.helper, {});
      let updates = 0;
      let success = '';
      const handleSubmit = pageFunction(entry.file, 'handleSubmit', {
        formData: entry.formData,
        copy: { updated: 'UPDATED', created: 'CREATED', saveFailed: 'FAILED' },
        setIsSaving: () => {},
        [entry.editingName]: entry.baseline,
        [entry.apiName]: {
          update: async () => { updates += 1; },
        },
        toast: { success: (message) => { success = message; }, error: () => {} },
        closeModal: () => {},
        campusErrorMessage: () => 'ERR',
        messages: { common: { campusErrors: {} } },
        [entry.helper]: buildPayload,
        ...entry.extraDeps,
      });
      await handleSubmit({ preventDefault() {} });
      assert.equal(updates, 0, 'no field changed means there is nothing to write');
      assert.equal(success, 'UPDATED', 'the no-op save still reports success');
    });
  }
});

test('a campus-wide announcement save never carries a section scope', () => {
  const adminPage = read('src/app/admin/announcements/page.tsx');
  assert.match(adminPage, /sectionId: draft\.isGlobal \? null : draft\.sectionId \|\| null/);
  const quickEdit = read('src/components/announcements/AnnouncementEditModal.tsx');
  assert.match(quickEdit, /sectionId: isGlobal \? null : announcement\.sectionId/);
  assert.match(adminPage, /lecturerId: draft\.isGlobal \? null : draft\.lecturerId \|\| null/);
  assert.match(quickEdit, /lecturerId: isGlobal \? null : announcement\.lecturerId/);
});

test('choosing a section or lecturer in the admin editor turns the notice into a targeted one', () => {
  const adminPage = read('src/app/admin/announcements/page.tsx');
  assert.match(adminPage, /isGlobal: event\.target\.value \? false : current\.isGlobal, sectionId: event\.target\.value/);
  assert.match(adminPage, /isGlobal: event\.target\.value \? false : current\.isGlobal, lecturerId: event\.target\.value/);
});
