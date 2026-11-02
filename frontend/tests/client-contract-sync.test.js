const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

// The contracts below are evaluated against the production sources, not
// reimplemented here: page helpers/callbacks are extracted from their TSX and
// the API module is loaded with its transport stubbed.
const root = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

function loadModule(relative, aliases = {}) {
  const output = ts.transpileModule(fs.readFileSync(path.join(root, relative), 'utf8'), {
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

function extractDeclaration(file, name, predicate) {
  const source = read('src/' + file);
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let declaration;
  function visit(node) {
    if (predicate(node) && node.name && node.name.getText(tree) === name) declaration = node;
    ts.forEachChild(node, visit);
  }
  visit(tree);
  assert.ok(declaration, `page declaration ${name} exists`);
  return declaration.getText(tree);
}

function pageFunction(file, name, dependencies) {
  const declaration = extractDeclaration(
    file, name, (node) => ts.isVariableDeclaration(node),
  );
  const output = ts.transpileModule(`const ${declaration};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  }).outputText;
  return Function(...Object.keys(dependencies), 'useCallback', `${output}; return ${name};`)(
    ...Object.values(dependencies), (fn) => fn,
  );
}

function pageHelper(file, name, dependencies) {
  const declaration = extractDeclaration(
    file, name, (node) => ts.isFunctionDeclaration(node),
  );
  const output = ts.transpileModule(declaration, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  }).outputText;
  return Function(...Object.keys(dependencies), `${output}; return ${name};`)(
    ...Object.values(dependencies),
  );
}

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

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

// The same answer the API returns for a stale write; the page's own helper is
// covered separately so the behaviour tests below can run against old code.
const isStaleVersionError = (error) =>
  error?.response?.data?.code === 'STALE_VERSION';

// ---------- student draft restore ----------

test('a saved learning draft is restored when the assignment is reopened', () => {
  const draftFromSubmission = pageHelper(
    'components/learning/LearningConsolePage.tsx', 'draftFromSubmission', {},
  );

  assert.deepEqual(
    draftFromSubmission({ draftText: 'saved answer', draftFileName: 'essay.pdf' }),
    { textBody: 'saved answer', fileName: 'essay.pdf' },
  );
  assert.deepEqual(
    draftFromSubmission({ draftText: null, draftFileName: null }),
    { textBody: '', fileName: null },
  );
  assert.deepEqual(draftFromSubmission(null), { textBody: '', fileName: null });

  const writes = {};
  const setup = pageEffect(
    'components/learning/LearningConsolePage.tsx',
    'draftFromSubmission(submission)',
    {
      draftFromSubmission,
      submission: { draftText: 'saved answer', draftFileName: 'essay.pdf' },
      setTextBody: (value) => { writes.textBody = value; },
      setDraftFileName: (value) => { writes.fileName = value; },
    },
  );
  setup();
  assert.deepEqual(writes, { textBody: 'saved answer', fileName: 'essay.pdf' });

  assert.match(
    read('src/components/learning/LearningConsolePage.tsx'),
    /data-testid="learning-draft-file"/,
    'the saved attachment name stays visible in the editor',
  );
});

// ---------- appearance conditional save ----------

function loadSiteAppearanceApi() {
  const calls = { put: [] };
  const noop = () => {};
  const apiInstance = {
    get: async () => ({ data: {} }),
    post: async () => ({ data: {} }),
    put: async (url, body) => {
      calls.put.push({ url, body });
      return { data: body };
    },
    patch: async () => ({ data: {} }),
    delete: async () => ({ data: {} }),
    interceptors: { request: { use: noop }, response: { use: noop } },
  };
  class AxiosError extends Error {}
  const apiModule = loadModule('src/lib/api.ts', {
    axios: {
      __esModule: true,
      default: { create: () => apiInstance, isAxiosError: () => false },
      AxiosError,
    },
    '@/i18n/paths': { addLocalePrefix: (p) => p, stripLocaleFromPathname: (p) => p },
    '@/lib/public-api-url': { resolvePublicApiBaseUrl: () => '/api/v1' },
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
  });
  return { siteAppearanceApi: apiModule.siteAppearanceApi, calls };
}

const appearancePayload = () => ({
  version: 41,
  updatedAt: '2026-11-02T09:00:00.000Z',
  accent: 'river-blue',
  hero: {
    image: '',
    en: { eyebrow: 'UTE', title: 'Welcome', description: '' },
    vi: { eyebrow: 'UTE', title: 'Chào mừng', description: '' },
  },
  postOrder: ['a1'],
});

function loadAppearanceClient(get) {
  const appearance = loadModule('src/lib/site-appearance.ts');
  const client = loadModule('src/lib/site-appearance-client.ts', {
    axios: { isAxiosError: () => false },
    '@/lib/api': {
      siteAppearanceApi: { get: async () => get, put: async (payload) => payload },
    },
    '@/lib/site-appearance': appearance,
    '@/lib/session-hint': { CSRF_COOKIE_NAME: 'cc_csrf' },
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({}) });
  return {
    client,
    restore: () => { globalThis.fetch = originalFetch; },
  };
}

test('the appearance snapshot only carries a version the API actually stored', async () => {
  const stored = loadAppearanceClient(appearancePayload());
  try {
    const snapshot = await stored.client.fetchSiteAppearanceSnapshot();
    assert.equal(snapshot.expectedVersion, 41);
    assert.equal(snapshot.appearance.version, 41);
  } finally {
    stored.restore();
  }

  // An empty API row has no version to compare against; sending the sanitizer's
  // default would turn the very first save into a false STALE_VERSION.
  const empty = loadAppearanceClient({});
  try {
    const snapshot = await empty.client.fetchSiteAppearanceSnapshot();
    assert.equal(snapshot.expectedVersion, null);
  } finally {
    empty.restore();
  }
});

test('the site-appearance PUT sends the version the admin loaded', async () => {
  const { siteAppearanceApi, calls } = loadSiteAppearanceApi();
  const payload = appearancePayload();

  await siteAppearanceApi.put(payload, 41);
  assert.equal(calls.put[0].url, '/site-appearance');
  assert.equal(calls.put[0].body.expectedVersion, 41);
  assert.equal(calls.put[0].body.version, 41, 'the stored fields still travel');
  assert.equal(calls.put[0].body.accent, 'river-blue');

  // No stored row yet: a conditional write would be a false conflict.
  await siteAppearanceApi.put(payload, null);
  assert.equal('expectedVersion' in calls.put[1].body, false);
});

function appearancePersist(dependencies) {
  return pageFunction('app/admin/appearance/page.tsx', 'persist', {
    pendingAppearanceSaveRef: { current: null },
    appearanceSaveInFlightRef: { current: false },
    staleConflictRef: { current: false },
    storedVersionRef: { current: 41 },
    setIsSaving: () => {},
    saveSiteAppearance: async () => {},
    draftRef: { current: appearancePayload() },
    updateDraft: () => {},
    broadcastSiteAppearance: () => {},
    setSavedLocally: () => {},
    setStaleConflict: () => {},
    toast: { error: () => {}, warning: () => {} },
    copy: { saveFailed: 'SAVE_FAILED', saveNotDurable: 'LOCAL_ONLY' },
    isStaleVersionError,
    mergeSavedAppearanceMetadata: (current, saved) => ({
      ...current,
      version: saved.version,
      updatedAt: saved.updatedAt,
    }),
    ...dependencies,
  });
}

test('the appearance page recognizes the stale-version answer', () => {
  const isStale = pageHelper('app/admin/appearance/page.tsx', 'isStaleVersionError', {});
  assert.equal(isStale({ response: { status: 409, data: { code: 'STALE_VERSION' } } }), true);
  assert.equal(isStale({ response: { status: 500, data: { code: 'OTHER' } } }), false);
  assert.equal(isStale(new Error('offline')), false);
});

test('the appearance page adopts the version the API last stored', async () => {
  const drafts = [];
  const staleFlags = [];
  const storedVersionRef = { current: null };
  const staleConflictRef = { current: true };
  const load = pageFunction('app/admin/appearance/page.tsx', 'load', {
    setIsLoading: () => {},
    setError: () => {},
    setPostsLoadFailed: () => {},
    fetchSiteAppearanceSnapshot: async () => ({
      appearance: appearancePayload(),
      expectedVersion: 41,
    }),
    fetchPinOptionPage: async () => ({ data: [], meta: { page: 1, totalPages: 0 } }),
    fetchPinnedAnnouncementRows: async () => [],
    catalogSearchRef: { current: '' },
    setPosts: () => {},
    setPostsPage: () => {},
    setPostsTotalPages: () => {},
    setPinnedPosts: () => {},
    updateDraft: (value) => { drafts.push(value); },
    sanitizeSiteAppearance: (value) => value,
    storedVersionRef,
    staleConflictRef,
    setStaleConflict: (value) => { staleFlags.push(value); },
    copy: { loadFailed: 'LOAD_FAILED' },
  });

  await load();
  assert.equal(storedVersionRef.current, 41);
  assert.equal(staleConflictRef.current, false, 'a successful load clears the conflict latch');
  assert.deepEqual(staleFlags, [false]);
  assert.equal(drafts.length, 1);
});

test('appearance saves carry the loaded version and the next one uses the stored stamp', async () => {
  const saves = [];
  const storedVersionRef = { current: 41 };
  const persist = appearancePersist({
    storedVersionRef,
    saveSiteAppearance: async (snapshot, expectedVersion) => {
      saves.push({ snapshot, expectedVersion });
      return { ...snapshot, version: 42, updatedAt: '2026-11-02T09:05:00.000Z', persisted: true };
    },
  });

  await persist(appearancePayload());
  assert.equal(saves.length, 1);
  assert.equal(saves[0].expectedVersion, 41, 'the version the admin loaded is the guard');
  assert.equal(storedVersionRef.current, 42, 'the next edit compares against the version just stored');

  await persist({ ...appearancePayload(), accent: 'campus-gold' });
  assert.equal(saves[1].expectedVersion, 42);
});

test('a stale appearance save keeps the admin edits and never retries', async () => {
  const saves = [];
  const staleFlags = [];
  const editWrites = [];
  const toasts = [];
  const gate = deferred();
  const pendingAppearanceSaveRef = { current: null };
  const staleConflictRef = { current: false };
  const snapshot = appearancePayload();
  const persist = appearancePersist({
    pendingAppearanceSaveRef,
    staleConflictRef,
    storedVersionRef: { current: 41 },
    draftRef: { current: snapshot },
    saveSiteAppearance: (draft, expectedVersion) => {
      saves.push({ draft, expectedVersion });
      if (saves.length === 1) return gate.promise;
      return Promise.resolve({
        ...draft, version: 42, updatedAt: '2026-11-02T09:05:00.000Z', persisted: true,
      });
    },
    setStaleConflict: (value) => { staleFlags.push(value); },
    updateDraft: (value) => { editWrites.push(value); },
    toast: {
      error: (message) => { toasts.push(message); },
      warning: (message) => { toasts.push(message); },
    },
  });

  const first = persist(snapshot);
  await flush();
  // The admin kept editing while the first save was in flight; the queued
  // snapshot must not be auto-retried after a conflict.
  const queued = persist({ ...snapshot, accent: 'campus-gold' });
  gate.reject({ response: { status: 409, data: { code: 'STALE_VERSION' } } });
  await first;
  await queued;

  assert.equal(saves.length, 1, 'the conflict must not issue another write');
  assert.equal(saves[0].expectedVersion, 41);
  assert.equal(pendingAppearanceSaveRef.current, null, 'the queued snapshot is dropped, not retried');
  assert.deepEqual(staleFlags, [true], 'the conflict banner is raised');
  assert.deepEqual(editWrites, [], 'local edits are not replaced by the server copy');
  assert.deepEqual(toasts, [], 'a conflict is not reported as a generic save failure');
  assert.equal(staleConflictRef.current, true);

  // Further edits stay local until the admin reloads.
  await persist({ ...snapshot, accent: 'campus-gold' });
  assert.equal(saves.length, 1, 'editing after the conflict does not write a stale payload');
});

// ---------- geofence metadata edit ----------

test('geofence metadata edits omit the activation flag unless it changed', () => {
  const buildGeofenceUpdatePayload = pageHelper(
    'app/admin/attendance-geofences/page.tsx', 'buildGeofenceUpdatePayload', {},
  );
  const values = {
    name: 'Main campus',
    campusCode: 'UTE-MAIN',
    centerLat: 10.8506,
    centerLng: 106.7719,
    radiusMeters: 150,
    isActive: false,
  };
  const metadata = {
    name: 'Main campus',
    campusCode: 'UTE-MAIN',
    centerLat: 10.8506,
    centerLng: 106.7719,
    radiusMeters: 150,
  };

  assert.deepEqual(
    buildGeofenceUpdatePayload(values, false),
    metadata,
    'a metadata-only edit must not resend the stored activation state',
  );
  assert.deepEqual(
    buildGeofenceUpdatePayload({ ...values, isActive: true }, false),
    { ...metadata, isActive: true },
    'an explicit activation is still sent',
  );
  assert.deepEqual(
    buildGeofenceUpdatePayload(values, true),
    { ...metadata, isActive: false },
    'an explicit deactivation is still sent',
  );

  const source = read('src/app/admin/attendance-geofences/page.tsx');
  assert.match(
    source,
    /updateAdminGeofence\(\s*editor\.row\.id,\s*buildGeofenceUpdatePayload\(values, Boolean\(editor\.row\.isActive\)\)/,
    'the edit submit uses the omission helper',
  );
});
