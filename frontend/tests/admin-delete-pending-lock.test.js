const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');

function pageFunction(relative, name, dependencies) {
  const file = `src/${relative}`;
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let declaration;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(tree) === name) declaration = node;
    ts.forEachChild(node, visit);
  }
  visit(tree);
  assert.ok(declaration, `page callback ${name} exists in ${relative}`);
  const output = ts.transpileModule(`const ${declaration.getText(tree)};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  }).outputText;
  return Function(...Object.keys(dependencies), 'useCallback', `${output}; return ${name};`)(
    ...Object.values(dependencies),
    (callback) => callback,
  );
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

const campusErrorKind = (error) => {
  const status = error?.response?.status;
  return status === 404 ? 'notFound' : 'unknown';
};

const PAGES = [
  {
    file: 'app/admin/lecturers/page.tsx',
    api: 'lecturersApi',
    list: 'lecturers',
    refetch: 'fetchLecturers',
    row: { id: 'l-1', employeeId: 'GV01' },
    extra: {},
  },
  {
    file: 'app/admin/courses/page.tsx',
    api: 'coursesApi',
    list: 'courses',
    refetch: 'fetchCourses',
    row: { id: 'c-1', code: 'CS101' },
    extra: {},
  },
  {
    file: 'app/admin/semesters/page.tsx',
    api: 'adminSemestersApi',
    list: 'semesters',
    refetch: 'fetchSemesters',
    row: { id: 's-1', name: 'HK1' },
    extra: { locale: 'en', getLocalizedName: (_locale, entity, name) => name },
  },
  {
    file: 'app/admin/academic-years/page.tsx',
    api: 'academicYearsApi',
    list: 'academicYears',
    refetch: 'fetchAcademicYears',
    row: { id: 'y-1', year: 2026 },
    extra: {},
  },
  {
    file: 'app/admin/classrooms/page.tsx',
    api: 'classroomsApi',
    list: 'classrooms',
    refetch: 'fetchClassrooms',
    row: { id: 'r-1', building: 'A', roomNumber: '101' },
    extra: {},
  },
];

function buildDeps(page, deleteImpl) {
  const state = {
    calls: 0,
    successToasts: 0,
    errorToasts: 0,
    refetches: 0,
    pendingIds: [],
    deletingRef: { current: false },
  };
  const deps = {
    confirm: async () => true,
    copy: {
      deleteTitle: 'delete',
      deleteMessage: 'sure {employeeId} {code} {name} {year} {building} {roomNumber}',
      deleteConfirm: 'yes',
      deleted: 'deleted',
      deleteFailed: 'delete failed',
    },
    toast: {
      success: () => { state.successToasts += 1; },
      error: () => { state.errorToasts += 1; },
    },
    [page.api]: {
      delete: async (id) => {
        state.calls += 1;
        await deleteImpl(id);
      },
    },
    [page.list]: [page.row],
    page: 1,
    setPage: () => {},
    [page.refetch]: async () => { state.refetches += 1; },
    campusErrorKind,
    deletingRef: state.deletingRef,
    setDeletingLecturerId: (id) => state.pendingIds.push(id),
    setDeletingCourseId: (id) => state.pendingIds.push(id),
    setDeletingSemesterId: (id) => state.pendingIds.push(id),
    setDeletingYearId: (id) => state.pendingIds.push(id),
    setDeletingRoomId: (id) => state.pendingIds.push(id),
    ...page.extra,
  };
  return { state, deps };
}

for (const page of PAGES) {
  test(`${page.file}: a second delete while the first is in flight sends no extra request`, async () => {
    const gate = deferred();
    const { state, deps } = buildDeps(page, () => gate.promise);
    const handleDelete = pageFunction(page.file, 'handleDelete', deps);

    const first = handleDelete(page.row);
    const second = handleDelete(page.row);
    gate.resolve();
    await Promise.all([first, second]);

    assert.equal(state.calls, 1, 'the duplicate click must not issue a second DELETE');
    assert.equal(state.successToasts, 1);
    assert.equal(state.errorToasts, 0, 'no deleteFailed may be shown for the duplicate');
  });

  test(`${page.file}: an already-deleted row is reported as deleted, not failed`, async () => {
    const { state, deps } = buildDeps(page, () => {
      throw { response: { status: 404 } };
    });
    const handleDelete = pageFunction(page.file, 'handleDelete', deps);

    await handleDelete(page.row);

    assert.equal(state.errorToasts, 0, 'a 404 after a completed delete is not a failure');
    assert.equal(state.successToasts, 1);
    assert.equal(state.refetches, 1, 'the list still resyncs');
  });

  test(`${page.file}: delete buttons stay disabled while a delete is pending`, () => {
    const source = fs.readFileSync(path.join(root, 'src', page.file), 'utf8');
    const guards = source.match(/disabled=\{deleting[A-Za-z]+Id !== null\}/g) ?? [];
    assert.ok(
      guards.length >= 2,
      `${page.file} must disable both delete action buttons while a delete is pending (found ${guards.length})`,
    );
  });
}
