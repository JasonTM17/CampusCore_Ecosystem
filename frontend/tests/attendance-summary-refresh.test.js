const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const frontendRoot = path.resolve(__dirname, '..');
const PAGE = 'app/dashboard/lecturer/attendance/page.tsx';

function pageFunction(name, dependencies) {
  const file = `src/${PAGE}`;
  const source = fs.readFileSync(path.join(frontendRoot, file), 'utf8');
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
  return Function(...Object.keys(dependencies), `${output}; return ${name};`)(
    ...Object.values(dependencies),
  );
}

function buildHarness({ summaryOutcome }) {
  const state = {
    sectionSummary: { attendanceRate: 100, totalSessions: 9 },
    summaryRefreshFailed: false,
    successToasts: 0,
    errorToasts: 0,
  };
  const attendanceApi = {
    saveSectionAttendance: async () => ({ updatedCount: 12 }),
    getSectionSummary: summaryOutcome === 'reject'
      ? async () => { throw new Error('summary read failed'); }
      : async () => ({ attendanceRate: 42, totalSessions: 10 }),
  };
  const deps = {
    selectedSectionId: 'section-a',
    selectedDate: '2026-11-03',
    roster: [{ studentId: 's1', studentCode: 'SV01', studentName: 'A', status: 'ABSENT', notes: '' }],
    isLoadingRoster: false,
    existingReadFailed: false,
    resetStudentIds: new Set(),
    attendanceApi,
    attendanceMessages: {
      savedSuccess: 'saved {count}',
      savedSuccessSingular: 'saved {count}',
      saveFailed: 'save failed',
      noStatusSelected: 'none selected',
      existingReadWarning: 'read failed',
    },
    countLabel: (count, singular, plural) => (count === 1 ? singular : plural),
    toast: {
      success: () => { state.successToasts += 1; },
      error: () => { state.errorToasts += 1; },
      warning: () => {},
    },
    setIsSaving: () => {},
    setHasUnsavedChanges: () => {},
    setResetStudentIds: () => {},
    setSectionSummary: (value) => { state.sectionSummary = value; },
    setSummaryRefreshFailed: (value) => { state.summaryRefreshFailed = value; },
    saveSelectionRef: { current: 0 },
    selectionRef: { current: { sectionId: 'section-a', date: '2026-11-03' } },
  };
  return { state, deps, attendanceApi };
}

test('a failed summary read after save flags the rate card stale instead of keeping it silent', async () => {
  const { state, deps } = buildHarness({ summaryOutcome: 'reject' });
  const handleSave = pageFunction('handleSave', deps);
  await handleSave();

  assert.equal(state.successToasts, 1, 'the save itself still succeeds');
  assert.equal(state.summaryRefreshFailed, true,
    'a failed summary refresh must be visible, not silently keep the old rate');
});

test('the summary retry clears the stale flag and applies the fresh rate', async () => {
  const { state, deps } = buildHarness({ summaryOutcome: 'resolve' });
  const refreshSummary = pageFunction('refreshSummary', deps);

  state.summaryRefreshFailed = true;
  await refreshSummary();

  assert.equal(state.sectionSummary.attendanceRate, 42);
  assert.equal(state.summaryRefreshFailed, false);
});
