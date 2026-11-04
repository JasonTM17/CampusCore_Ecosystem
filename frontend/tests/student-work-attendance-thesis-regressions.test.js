const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const frontendRoot = path.resolve(__dirname, '..');

function pageFunction(relative, name, dependencies) {
  const file = `src/${relative}`;
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
  return Function(...Object.keys(dependencies), 'useCallback', `${output}; return ${name};`)(
    ...Object.values(dependencies), (callback) => callback,
  );
}

function pageHelper(relative, name, dependencies) {
  const file = `src/${relative}`;
  const source = fs.readFileSync(path.join(frontendRoot, file), 'utf8');
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let declaration;
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) declaration = node;
    ts.forEachChild(node, visit);
  }
  visit(tree);
  assert.ok(declaration, `production helper ${name} exists`);
  const declarationText = declaration.getText(tree).replace(/^export\s+/, '');
  const output = ts.transpileModule(declarationText, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  }).outputText;
  return Function(...Object.keys(dependencies), `${output}; return ${name};`)(
    ...Object.values(dependencies),
  );
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

test('student work keeps the active assignment submission when an older refresh resolves late', async () => {
  const requests = new Map(['submission-a', 'submission-b'].map((id) => [id, {
    detail: deferred(),
    revisions: deferred(),
    feedback: deferred(),
  }]));
  const assignmentRequestRef = { current: { assignmentId: 'assignment-a', generation: 1 } };
  const submissions = [];
  const refresh = pageFunction('components/learning/LearningConsolePage.tsx', 'refresh', {
    assignmentRequestRef,
    learningApi: {
      mySubmission: (id) => requests.get(id).detail.promise,
      myRevisions: (id) => requests.get(id).revisions.promise,
      myFeedback: (id) => requests.get(id).feedback.promise,
    },
    setSubmission: (value) => submissions.push(value),
    setRevisions: () => {},
    setFeedback: () => {},
  });

  const requestA = assignmentRequestRef.current;
  const refreshA = refresh('submission-a', requestA);
  const requestB = { assignmentId: 'assignment-b', generation: 2 };
  assignmentRequestRef.current = requestB;
  const refreshB = refresh('submission-b', requestB);

  requests.get('submission-b').detail.resolve({ id: 'submission-b', assignmentId: 'assignment-b' });
  requests.get('submission-b').revisions.resolve([]);
  requests.get('submission-b').feedback.resolve([]);
  await refreshB;
  requests.get('submission-a').detail.resolve({ id: 'submission-a', assignmentId: 'assignment-a' });
  requests.get('submission-a').revisions.resolve([]);
  requests.get('submission-a').feedback.resolve([]);
  await refreshA;

  assert.equal(submissions.at(-1).id, 'submission-b');
  const saved = [];
  const save = pageFunction('components/learning/LearningConsolePage.tsx', 'save', {
    run: (action) => action(),
    activeSubmission: submissions.at(-1),
    textBody: 'answer for B',
    fileRef: { current: null },
    pickFile: async () => undefined,
    learningApi: {
      saveDraft: async (id, payload) => {
        saved.push({ id, payload });
        return { id, assignmentId: 'assignment-b' };
      },
    },
    copy: { draftSaved: 'Saved' },
  });
  await save();
  assert.equal(saved[0].id, 'submission-b');
});

test('attendance marks make the sheet dirty and selection changes wait for confirmation', () => {
  let roster = [{ studentId: 'student-a', status: 'PRESENT', notes: '' }];
  let dirty = false;
  const setRoster = (update) => { roster = update(roster); };
  const markStatus = pageFunction('app/dashboard/lecturer/attendance/page.tsx', 'handleStatusChange', {
    setRoster,
    setHasUnsavedChanges: (value) => { dirty = value; },
  });
  markStatus('student-a', 'ABSENT');
  assert.equal(dirty, true, 'editing attendance marks the sheet dirty');

  let pendingAction = null;
  let date = '2026-11-02';
  let sectionId = 'section-a';
  const unsaved = {
    requestLeave(action) {
      if (dirty) pendingAction = action;
      else action();
    },
  };
  const requestSheetChange = pageFunction('app/dashboard/lecturer/attendance/page.tsx', 'requestSheetChange', {
    unsaved,
    setHasUnsavedChanges: (value) => { dirty = value; },
  });
  const changeDate = pageFunction('app/dashboard/lecturer/attendance/page.tsx', 'handleDateChange', {
    requestSheetChange,
    setSelectedDate: (value) => { date = value; },
  });
  const changeSection = pageFunction('app/dashboard/lecturer/attendance/page.tsx', 'handleSectionChange', {
    requestSheetChange,
    setSelectedSectionId: (value) => { sectionId = value; },
  });

  changeDate('2026-11-03');
  assert.equal(date, '2026-11-02');
  assert.equal(roster[0].status, 'ABSENT');
  assert.equal(typeof pendingAction, 'function');
  pendingAction = null;
  assert.equal(date, '2026-11-02', 'cancelling keeps the original date');
  assert.equal(roster[0].status, 'ABSENT', 'cancelling keeps the unsaved mark');
  assert.equal(dirty, true);

  changeSection('section-b');
  assert.equal(sectionId, 'section-a');
  pendingAction();
  assert.equal(sectionId, 'section-b');
  assert.equal(dirty, false);
});

test('thesis writes remain successful when the topic refresh fails and can be retried', async () => {
  const loadError = 'Thesis data could not be loaded.';
  let finalizeActionError = '';
  let finalizeActionSuccess = '';
  let finalizeRefreshFailed = false;
  const finalize = pageFunction('app/dashboard/thesis/page.tsx', 'handleFinalizeScore', {
    setIsActionPending: () => {},
    setActionError: (value) => { finalizeActionError = value; },
    setActionSuccess: (value) => { finalizeActionSuccess = value; },
    thesisApi: {
      finalizeScores: async () => ({ finalScore: 91 }),
      listScores: async () => [],
    },
    fillCopy: (_template, values) => `Finalized ${values.score}`,
    pageCopy: { scoreFinalised: 'Score {score}', councilScoresPending: '', topicAlreadyFinalised: '' },
    toast: { success: () => {}, error: () => {}, info: () => {} },
    selectedRoundId: 'round-a',
    setCouncilScores: () => {},
    setCouncilScoreErrors: () => {},
    refreshTopics: async () => { throw new Error('read unavailable'); },
    getThesisErrorCode: () => 'INTERNAL',
    thesisActionError: () => 'write failed',
    setTopicRefreshFailed: (value) => { finalizeRefreshFailed = value; },
    messages: { thesis: { loadFailed: loadError } },
  });
  await finalize('council-a', 'topic-a');
  assert.equal(finalizeActionSuccess, 'Finalized 91');
  assert.equal(finalizeActionError, loadError);
  assert.equal(finalizeRefreshFailed, true);
  let retryCalls = 0;
  const retry = pageFunction('app/dashboard/thesis/page.tsx', 'retryTopicRefresh', {
    refreshTopics: async () => { retryCalls += 1; },
    selectedRoundId: 'round-a',
    setTopicRefreshFailed: (value) => { finalizeRefreshFailed = value; },
    setActionError: (value) => { finalizeActionError = value; },
    messages: { thesis: { loadFailed: loadError } },
  });
  await retry();
  assert.equal(retryCalls, 1);
  assert.equal(finalizeRefreshFailed, false);
  assert.equal(finalizeActionError, '');

  let editActionError = '';
  let editActionSuccess = '';
  let editRefreshFailed = false;
  let editModalOpen = true;
  let writes = 0;
  const edit = pageFunction('app/dashboard/thesis/page.tsx', 'handleEditTopic', {
    topics: [{ id: 'topic-a' }],
    editingTopicId: 'topic-a',
    isActionPending: false,
    topicCapabilities: () => ({ canEdit: true }),
    editTitle: ' Updated title ',
    editDescription: ' Updated description ',
    editDepartmentId: 'department-a',
    editMaxGroups: 2,
    setEditError: () => {},
    setIsActionPending: () => {},
    setActionSuccess: (value) => { editActionSuccess = value; },
    setActionError: (value) => { editActionError = value; },
    setIsEditModalOpen: (value) => { editModalOpen = value; },
    setViewingTopic: () => {},
    thesisApi: { updateTopic: async () => { writes += 1; } },
    selectedRoundId: 'round-a',
    refreshTopics: async () => { throw new Error('read unavailable'); },
    messages: { thesis: {
      allFieldsRequired: 'Required',
      editTopicSuccess: 'Topic updated.',
      roundNotAcceptingProposals: 'Round closed',
      lecturerWindowNotOpen: 'Window not open',
      lecturerWindowClosed: 'Window closed',
      topicDepartmentForbidden: 'Department forbidden',
      loadFailed: loadError,
    } },
    getThesisErrorCode: () => 'INTERNAL',
    thesisActionError: () => 'write failed',
    setTopicRefreshFailed: (value) => { editRefreshFailed = value; },
  });
  await edit({ preventDefault() {} });
  assert.equal(writes, 1);
  assert.equal(editActionSuccess, 'Topic updated.');
  assert.equal(editActionError, loadError);
  assert.equal(editRefreshFailed, true);
  assert.equal(editModalOpen, false);
});

test('attendance default date follows the campus calendar under different process timezones', () => {
  const campusTodayIso = pageHelper('lib/attendance-checkin.ts', 'campusTodayIso', {
    CAMPUS_TIME_ZONE: 'Asia/Ho_Chi_Minh',
  });
  const getTodayString = pageHelper('app/dashboard/lecturer/attendance/page.tsx', 'getTodayString', {
    campusTodayIso,
  });
  const RealDate = global.Date;
  const originalTimezone = process.env.TZ;
  const fixedInstant = '2026-11-02T17:30:00.000Z';
  global.Date = class FixedDate extends RealDate {
    constructor(...args) {
      super(...(args.length ? args : [fixedInstant]));
    }

    static now() {
      return RealDate.parse(fixedInstant);
    }
  };
  try {
    for (const timezone of ['UTC', 'America/Los_Angeles', 'Asia/Tokyo']) {
      process.env.TZ = timezone;
      assert.equal(getTodayString(), '2026-11-03', `campus date under ${timezone}`);
    }
  } finally {
    global.Date = RealDate;
    if (originalTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = originalTimezone;
  }
});
