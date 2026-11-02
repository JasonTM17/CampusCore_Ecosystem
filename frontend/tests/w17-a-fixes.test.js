const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function extractDeclaration(relativePath, name, dependencies = {}) {
  const source = read(relativePath);
  const tree = ts.createSourceFile(relativePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let declaration;

  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(tree) === name) declaration = node;
    if (ts.isFunctionDeclaration(node) && node.name?.getText(tree) === name) declaration = node;
    ts.forEachChild(node, visit);
  }

  visit(tree);
  assert.ok(declaration, relativePath + ' contains ' + name);
  const snippet = ts.isVariableDeclaration(declaration)
    ? 'const ' + declaration.getText(tree) + ';'
    : declaration.getText(tree).replace(/^export\s+/, '');
  const output = ts.transpileModule(snippet, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None },
  }).outputText;
  return Function(...Object.keys(dependencies), output + '\nreturn ' + name + ';')(
    ...Object.values(dependencies),
  );
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

test('AUD-001 section schedule reads only update the matching edit request', async () => {
  const requests = new Map();
  const scheduleRows = [];
  const handler = extractDeclaration('src/app/admin/sections/page.tsx', 'loadSectionSchedules', {
    scheduleLoadRequestRef: { current: 0 },
    adminSectionsApi: {
      getById(id) {
        const pending = deferred();
        requests.set(id, pending);
        return pending.promise;
      },
    },
    setSchedules: (value) => scheduleRows.push(value),
    setEditingSectionBaseline() {},
    setSchedulesError() {},
    setSchedulesLoaded() {},
    copy: { schedulesLoadFailed: 'failed' },
    createScheduleRowId: () => 'generated',
  });

  const requestA = handler({ id: 'section-a' });
  const requestB = handler({ id: 'section-b' });
  requests.get('section-b').resolve({ schedules: [{ id: 'schedule-b', dayOfWeek: 'MONDAY' }] });
  await requestB;
  requests.get('section-a').resolve({ schedules: [{ id: 'schedule-a', dayOfWeek: 'TUESDAY' }] });
  await requestA;

  assert.equal(scheduleRows.at(-1)[0].rowId, 'schedule-b');
  const source = read('src/app/admin/sections/page.tsx');
  assert.ok(/requestId === scheduleLoadRequestRef\.current/.test(source), 'schedule loads use a generation check');
  assert.ok(/disabled=\{!schedulesLoaded\}/.test(source), 'section edit/create actions lock during the read');
  assert.ok(/!schedulesLoaded && !schedulesError/.test(source), 'the schedule area shows its loading state');
});

test('AUD-005 enrollment detail responses cannot replace the latest selected row', async () => {
  const requests = new Map();
  let selected = null;
  const handler = extractDeclaration('src/app/admin/enrollments/page.tsx', 'handleViewDetail', {
    detailRequestRef: { current: 0 },
    setDetailLoadingId() {},
    setSelectedEnrollment: (value) => { selected = value; },
    setIsDetailOpen() {},
    enrollmentsApi: {
      getById(id) {
        const pending = deferred();
        requests.set(id, pending);
        return pending.promise;
      },
    },
    toast: { error() {} },
    copy: { detailFailed: 'failed' },
  });

  const requestA = handler({ id: 'enrollment-a' });
  const requestB = handler({ id: 'enrollment-b' });
  requests.get('enrollment-b').resolve({ id: 'enrollment-b' });
  await requestB;
  requests.get('enrollment-a').resolve({ id: 'enrollment-a' });
  await requestA;

  assert.equal(selected.id, 'enrollment-b');
  const source = read('src/app/admin/enrollments/page.tsx');
  assert.ok(/requestId === detailRequestRef\.current/.test(source), 'detail reads use a generation check');
  assert.ok(/detailLoadingId !== null/.test(source), 'view actions lock during the read');
  assert.ok(/<LoadingState label=\{copy\.loading\}/.test(source), 'the modal shows a loading state');
});

test('AUD-006 stale assistant edit success and failure cannot replace the current editor', async () => {
  const requests = new Map();
  const state = { editing: null, form: null, formOpen: false };
  const handler = extractDeclaration('src/app/admin/assistant-knowledge/page.tsx', 'openEdit', {
    editRequestRef: { current: 0 },
    setLoadingEditId() {},
    setEditing: (value) => { state.editing = value; },
    setNotice() {},
    setError() {},
    setFormError() {},
    assistantKnowledgeApi: {
      get(id) {
        const pending = deferred();
        requests.set(id, pending);
        return pending.promise;
      },
    },
    setForm: (value) => { state.form = value; },
    setFormOpen: (value) => { state.formOpen = value; },
    vi: false,
  });

  const requestA = handler({ documentId: 'doc-a' });
  const requestB = handler({ documentId: 'doc-b' });
  requests.get('doc-b').resolve({
    documentId: 'doc-b', slug: 'b', locale: 'en', title: 'B', content: 'B body',
    source: 'manual', domain: 'GENERAL_FAQ', priority: 1,
  });
  await requestB;
  requests.get('doc-a').reject(new Error('late failure'));
  await requestA;

  assert.equal(state.editing.documentId, 'doc-b');
  assert.equal(state.form.title, 'B');
  assert.equal(state.formOpen, true);
  const source = read('src/app/admin/assistant-knowledge/page.tsx');
  assert.ok(/requestId === editRequestRef\.current/.test(source), 'edit reads use a generation check');
  assert.ok(/isSaving=\{isSaving \|\| loadingEditId !== null\}/.test(source), 'edit actions lock during the read');
});

test('AUD-014 announcement history responses stay bound to the selected notice', async () => {
  const requests = new Map();
  const state = { selected: null, history: [], error: '' };
  const handler = extractDeclaration('src/app/admin/announcements/page.tsx', 'openHistory', {
    historyRequestRef: { current: 0 },
    setSelected: (value) => { state.selected = value; },
    setHistory: (value) => { state.history = value; },
    setHistoryTotal() {},
    setHistoryError: (value) => { state.error = value; },
    setHistoryLoading() {},
    setModal() {},
    announcementsApi: {
      history(id) {
        const pending = deferred();
        requests.set(id, pending);
        return pending.promise;
      },
    },
    friendlyError: () => 'failed',
    copy: { historyUnavailable: 'unavailable' },
  });

  const requestA = handler({ id: 'notice-a', title: 'A' });
  const requestB = handler({ id: 'notice-b', title: 'B' });
  requests.get('notice-b').resolve({ data: [{ id: 'history-b' }], meta: { total: 1 } });
  await requestB;
  requests.get('notice-a').resolve({ data: [{ id: 'history-a' }], meta: { total: 1 } });
  await requestA;

  assert.equal(state.selected.id, 'notice-b');
  assert.equal(state.history[0].id, 'history-b');
  const source = read('src/app/admin/announcements/page.tsx');
  assert.ok(/requestId === historyRequestRef\.current/.test(source), 'history reads use a generation check');
});

test('AUD-015 announcement history reports a capped result against meta.total in both locales', () => {
  const page = read('src/app/admin/announcements/page.tsx');
  const catalogue = read('src/i18n/messages-admin-pages.ts');
  assert.ok(/setHistoryTotal\(response\.meta\?\.total \?\? null\)/.test(page), 'history stores meta.total');
  assert.ok(/copy\.historyShowing/.test(page), 'the modal labels a capped history result');
  assert.ok(/historyTotal > history\.length/.test(page), 'the cap label appears when revisions are omitted');
  assert.ok(/historyShowing: 'Showing \{shown\} of \{total\} revisions\.'/.test(catalogue), 'English copy is present');
  assert.ok(/historyShowing: 'Hiển thị \{shown\} trên tổng số \{total\} lần thay đổi\.'/.test(catalogue), 'Vietnamese copy is present');
});

test('AUD-017 department overview uses server totals and labels the active page count', () => {
  const countOverview = extractDeclaration('src/app/admin/departments/page.tsx', 'departmentOverviewCounts');
  const result = countOverview(45, [
    { id: '1', isActive: true },
    { id: '2', isActive: false },
    { id: '3', isActive: true },
  ]);
  assert.deepEqual(result, { unitCount: 45, activeOnPageCount: 2 });

  const page = read('src/app/admin/departments/page.tsx');
  const catalogue = read('src/i18n/messages-admin-academics.ts');
  assert.match(page, /setTotalItems\(response\.meta\?\.total \?\? null\)/);
  assert.match(page, /copy\.banner\.activeOnPage/);
  assert.match(catalogue, /activeOnPage: 'Active on this page'/);
  assert.match(catalogue, /activeOnPage: 'Đang hoạt động trong trang này'/);
});

test('AUD-018 only one admin user delete can enter confirmation or mutation at a time', async () => {
  const pendingDeletes = [];
  const handler = extractDeclaration('src/app/admin/users/page.tsx', 'handleDelete', {
    deleteInFlightRef: { current: null },
    deletingUserId: null,
    setDeletingUserId() {},
    user: { id: 'admin-id', email: 'admin@example.test' },
    isSuperAdmin: true,
    isRecordSuperAdmin: () => false,
    confirm: async () => true,
    usersApi: {
      delete() {
        const pending = deferred();
        pendingDeletes.push(pending);
        return pending.promise;
      },
    },
    toast: { error() {}, success() {} },
    copy: {
      deleteTitle: 'Delete',
      deleteMessage: 'Delete {lastName} {firstName}',
      deleteConfirm: 'Delete',
      cannotDeleteSelf: 'self',
      cannotDeleteSuperAdmin: 'privileged',
      deleted: 'deleted',
      deleteFailed: 'failed',
    },
    users: [{ id: 'target-id' }, { id: 'other-id' }],
    page: 1,
    setPage() {},
    fetchUsers: async () => {},
  });

  const target = { id: 'target-id', email: 'target@example.test', firstName: 'Test', lastName: 'User' };
  const first = handler(target);
  const second = handler(target);
  await Promise.resolve();
  assert.equal(pendingDeletes.length, 1);
  pendingDeletes[0].resolve();
  await Promise.all([first, second]);

  const source = read('src/app/admin/users/page.tsx');
  assert.match(source, /if \(deleteInFlightRef\.current !== null\) return/);
  assert.equal((source.match(/disabled=\{isSelf \|\| !canManageTarget\}/g) || []).length, 2);
});

test('AUD-018 shared list delete guard blocks duplicate enrollment and department deletes', async () => {
  const scenarios = [
    {
      path: 'src/app/admin/enrollments/page.tsx',
      id: 'enrollment-id',
      setDeletingId() {},
      dependencies(pendingDeletes, confirmCalls) {
        return {
          deletingRef: { current: false },
          setDeletingEnrollmentId() {},
          getLearnerLabel: () => 'Learner',
          confirm: async () => {
            confirmCalls.count += 1;
            return true;
          },
          copy: {
            deleteTitle: 'Delete', deleteMessage: 'Delete {learnerLabel}', deleteConfirm: 'Delete',
            deleted: 'deleted', deleteFailed: 'failed',
          },
          enrollmentsApi: {
            delete() {
              const pending = deferred();
              pendingDeletes.push(pending);
              return pending.promise;
            },
          },
          toast: { error() {}, success() {} },
          enrollments: [{ id: 'enrollment-id' }],
          page: 1,
          setPage() {},
          fetchEnrollments: async () => {},
        };
      },
    },
    {
      path: 'src/app/admin/departments/page.tsx',
      id: 'department-id',
      setDeletingId() {},
      dependencies(pendingDeletes, confirmCalls) {
        return {
          deletingRef: { current: false },
          setDeletingDepartmentId() {},
          locale: 'en',
          getLocalizedName: () => 'Department',
          confirm: async () => {
            confirmCalls.count += 1;
            return true;
          },
          copy: {
            deleteTitle: 'Delete', deleteMessage: 'Delete {name}', deleteConfirm: 'Delete',
            deleted: 'deleted', deleteFailed: 'failed',
          },
          departmentsApi: {
            delete() {
              const pending = deferred();
              pendingDeletes.push(pending);
              return pending.promise;
            },
          },
          toast: { error() {}, success() {} },
          departments: [{ id: 'department-id' }],
          page: 1,
          setPage() {},
          fetchDepartments: async () => {},
        };
      },
    },
  ];

  for (const scenario of scenarios) {
    const pendingDeletes = [];
    const confirmCalls = { count: 0 };
    const handler = extractDeclaration(
      scenario.path,
      'handleDelete',
      scenario.dependencies(pendingDeletes, confirmCalls),
    );
    const item = { id: scenario.id, name: 'Department' };
    const first = handler(item);
    const second = handler(item);
    await Promise.resolve();

    assert.equal(confirmCalls.count, 1, scenario.path + ' only opens one confirmation');
    assert.equal(pendingDeletes.length, 1, scenario.path + ' only starts one delete');
    pendingDeletes[0].resolve();
    await Promise.all([first, second]);

    const source = read(scenario.path);
    assert.match(source, /if \(deletingRef\.current\) return/);
    assert.match(source, /disabled=\{deleting(?:Enrollment|Department)Id !== null\}/);
  }
});

test('AUD-003 appearance save responses merge only server-owned metadata', () => {
  const merge = extractDeclaration('src/app/admin/appearance/page.tsx', 'mergeSavedAppearanceMetadata');
  const currentDraft = {
    version: 3,
    updatedAt: 'before-save',
    accent: 'river-blue',
    hero: { image: '', en: { eyebrow: 'new local edit', title: 'Local', description: '' }, vi: { eyebrow: '', title: '', description: '' } },
    postOrder: ['local-order'],
  };
  const serverResponse = {
    version: 4,
    updatedAt: 'after-save',
    accent: 'ute-yellow',
    hero: { image: '', en: { eyebrow: 'stale snapshot', title: 'Stale', description: '' }, vi: { eyebrow: '', title: '', description: '' } },
    postOrder: ['server-order'],
  };

  assert.deepEqual(merge(currentDraft, serverResponse), {
    ...currentDraft,
    version: 4,
    updatedAt: 'after-save',
  });
  const source = read('src/app/admin/appearance/page.tsx');
  assert.doesNotMatch(source, /setDraft\(saved\)/);
  const persistStart = source.indexOf('const persist = useCallback');
  const persistEnd = source.indexOf('const orderedPosts', persistStart);
  assert.ok(persistStart > -1 && persistEnd > persistStart);
  assert.doesNotMatch(source.slice(persistStart, persistEnd), /void load\(\)/);
});

test('AUD-012 appearance serializes queued snapshots and disables accent and order controls while saving', () => {
  const source = read('src/app/admin/appearance/page.tsx');
  assert.ok(/pendingAppearanceSaveRef/.test(source), 'save requests are coalesced');
  assert.ok(/appearanceSaveInFlightRef/.test(source), 'only one save is in flight');
  assert.ok(/while \(pendingAppearanceSaveRef\.current\)/.test(source), 'queued snapshots drain serially');

  const accentStart = source.indexOf('SITE_APPEARANCE_ACCENTS.map');
  const accentEnd = source.indexOf('</section>', accentStart);
  const accentBlock = source.slice(accentStart, accentEnd);
  assert.match(accentBlock, /disabled=\{isSaving\}/);

  const reorderStart = source.indexOf('<SortableList');
  const moveUp = source.indexOf('aria-label=\{copy.moveUp\}', reorderStart);
  const moveDown = source.indexOf('aria-label=\{copy.moveDown\}', moveUp);
  assert.match(source.slice(moveUp, moveDown), /disabled=\{isSaving \|\| index === 0\}/);
  assert.match(source.slice(moveDown, source.indexOf('</Button>', moveDown)), /disabled=\{isSaving \|\| index === orderedPosts.length - 1\}/);
});
