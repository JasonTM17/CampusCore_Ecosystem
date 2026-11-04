const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const React = require('react');

const root = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function transpile(relativePath, extra = '') {
  return ts.transpileModule(`${read(relativePath)}${extra}`, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.React,
      esModuleInterop: true,
    },
    fileName: relativePath,
  }).outputText;
}

function load(relativePath, stubs = {}, extra = '', jsxRuntime = React) {
  const moduleRecord = { exports: {} };
  const resolve = (specifier) => (
    Object.prototype.hasOwnProperty.call(stubs, specifier)
      ? stubs[specifier]
      : require(specifier)
  );
  Function('module', 'exports', 'require', 'React', transpile(relativePath, extra))(
    moduleRecord,
    moduleRecord.exports,
    resolve,
    jsxRuntime,
  );
  return moduleRecord.exports;
}

function sameDeps(previous, next) {
  if (!previous || !next || previous.length !== next.length) return false;
  return previous.every((value, index) => value === next[index]);
}

function createRuntime() {
  const state = [];
  const refs = [];
  const callbacks = [];
  const effectSlots = [];
  let stateCursor = 0;
  let refCursor = 0;
  let callbackCursor = 0;
  let effectCursor = 0;
  let queued = [];

  return {
    react: {
      ...React,
      useState(initial) {
        const index = stateCursor++;
        if (!(index in state)) state[index] = typeof initial === 'function' ? initial() : initial;
        return [
          state[index],
          (next) => {
            state[index] = typeof next === 'function' ? next(state[index]) : next;
          },
        ];
      },
      useRef(initial) {
        const index = refCursor++;
        if (!(index in refs)) refs[index] = { current: initial };
        return refs[index];
      },
      useCallback(fn, deps) {
        const index = callbackCursor++;
        const previous = callbacks[index];
        if (previous && sameDeps(previous.deps, deps)) return previous.fn;
        callbacks[index] = { fn, deps };
        return fn;
      },
      useMemo(factory) {
        return factory();
      },
      useEffect(effect, deps) {
        const index = effectCursor++;
        const previous = effectSlots[index];
        if (!previous || !sameDeps(previous.deps, deps)) queued.push({ index, effect, deps });
      },
    },
    render(Component, props) {
      stateCursor = 0;
      refCursor = 0;
      callbackCursor = 0;
      effectCursor = 0;
      queued = [];
      const tree = Component(props);
      const effects = queued;
      queued = [];
      return { tree, effects };
    },
    runEffects(effects) {
      for (const { index, effect, deps } of effects) {
        const previous = effectSlots[index];
        if (previous?.cleanup) previous.cleanup();
        const cleanup = effect();
        effectSlots[index] = { deps, cleanup };
      }
    },
  };
}

function elements(tree) {
  const found = [];
  function walk(node) {
    if (node === null || node === undefined || typeof node === 'boolean') return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (typeof node !== 'object' || !React.isValidElement(node)) return;
    found.push(node);
    for (const value of Object.values(node.props ?? {})) walk(value);
  }
  walk(tree);
  return found;
}

function textOf(node) {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (React.isValidElement(node)) return textOf(node.props?.children);
  return '';
}

const iconStub = new Proxy({}, {
  get: (_target, property) => (property === '__esModule' ? true : () => null),
});
const Button = ({ children, ...props }) => React.createElement('button', { type: 'button', ...props }, children);
const Input = (props) => React.createElement('input', props);
const Modal = ({ isOpen, children }) => (
  isOpen ? React.createElement('div', { 'data-testid': 'modal' }, children) : null
);
const EmptyState = ({ title }) => React.createElement('div', { 'data-testid': 'empty-state' }, title);
const ErrorState = ({ title, description, onRetry }) => React.createElement(
  'div',
  { 'data-testid': 'error-state', role: 'alert' },
  title,
  description,
  React.createElement(Button, { onClick: onRetry }, 'Retry'),
);
const LoadingState = ({ label }) => React.createElement('div', { 'data-testid': 'loading-state' }, label);
const learningMessages = load('src/i18n/learning-messages.ts').learningMessages;

function createRequestEpoch() {
  let current = 0;
  return {
    begin() {
      current += 1;
      return current;
    },
    isCurrent(epoch) {
      return current === epoch;
    },
    invalidate() {
      current += 1;
    },
  };
}

function loadLearningComponents(runtime, learningApi, sectionsApi = {}) {
  return load(
    'src/components/learning/LearningConsolePage.tsx',
    {
      react: runtime.react,
      'lucide-react': iconStub,
      sonner: { toast: { success: () => undefined, error: () => undefined } },
      '@/context/AuthContext': { useRequireAuth: () => ({ isLoading: false, user: { id: 'user-1' } }) },
      '@/lib/learning-api': {
        learningApi,
        newLearningIdempotencyKey: () => 'test-key',
        readFilePayload: async () => null,
      },
      '@/lib/api': { sectionsApi },
      '@/components/ui/button': { Button },
      '@/components/ui/input': { Input },
      '@/components/ui/modal': { Modal },
      '@/components/ui/page-header': {
        PageHeader: ({ children }) => React.createElement('header', null, children),
        SectionEyebrow: ({ children }) => React.createElement('span', null, children),
      },
      '@/components/ui/state-block': { EmptyState, ErrorState, LoadingState },
      '@/components/ui/status': { statusToneClass: () => '' },
      '@/lib/upload-validation': { UPLOAD_ACCEPT_COURSEWORK: '.pdf' },
      '@/lib/request-epoch': { createRequestEpoch },
      '@/i18n': {
        useI18n: () => ({ locale: 'vi', formatDateTime: (value) => String(value) }),
      },
      '@/i18n/learning-messages': { learningMessages },
      '@/lib/utils': { cn: (...values) => values.filter(Boolean).join(' ') },
    },
    '\nexport { StudentLearningPage as __StudentPage, LecturerLearningPage as __LecturerPage, RosterModal as __RosterModal };\n',
    runtime.react,
  );
}

async function frame(runtime, Component, props) {
  const { tree, effects } = runtime.render(Component, props);
  runtime.runEffects(effects);
  await new Promise((resolve) => setImmediate(resolve));
  return tree;
}

async function settle(runtime, Component, props) {
  let tree = null;
  for (let pass = 0; pass < 8; pass += 1) tree = await frame(runtime, Component, props);
  return tree;
}

function rowButton(tree, studentId, label) {
  const row = elements(tree).find((element) => element.props['data-student-id'] === studentId);
  return elements(row).find((element) => element.type === Button && textOf(element).includes(label));
}

function inputByPlaceholder(tree, placeholder) {
  return elements(tree).find((element) => element.type === Input && element.props.placeholder === placeholder);
}

function makeSubmission(id, studentName) {
  return {
    id,
    assignmentId: 'assignment-1',
    studentId: id === 'submission-1' ? 'student-1' : 'student-2',
    studentName,
    status: 'SUBMITTED',
    version: 1,
    submittedAt: '2026-11-01T00:00:00Z',
  };
}

const assignment = { id: 'assignment-1', title: 'Essay', status: 'PUBLISHED' };
const roster = [
  {
    enrollmentId: 'enrollment-1', studentId: 'student-1', studentName: 'Student One',
    studentEmail: 'one@example.test', submissionId: 'submission-1', submissionStatus: 'SUBMITTED',
  },
  {
    enrollmentId: 'enrollment-2', studentId: 'student-2', studentName: 'Student Two',
    studentEmail: 'two@example.test', submissionId: 'submission-2', submissionStatus: 'SUBMITTED',
  },
];

test('staff grade drafts stay with their submission when switching roster students', async () => {
  const reviews = [];
  const learningApi = {
    staffRoster: async () => roster,
    staffSubmission: async (id) => makeSubmission(id, id === 'submission-1' ? 'Student One' : 'Student Two'),
    staffRevisions: async (id) => [{
      id: `revision-${id}`, revisionNo: 1, submittedAt: '2026-11-01T00:00:00Z', textBody: `work-${id}`,
    }],
    staffFeedback: async () => [],
    staffReview: async (id, payload) => {
      reviews.push({ id, payload });
      return makeSubmission(id, 'Student Two');
    },
    staffReturn: async (id) => makeSubmission(id, 'Student Two'),
  };
  const runtime = createRuntime();
  const { __RosterModal: RosterModal } = loadLearningComponents(runtime, learningApi);
  const props = { assignment, copy: learningMessages.vi, onClose: () => undefined };

  let tree = await settle(runtime, RosterModal, props);
  rowButton(tree, 'student-1', learningMessages.vi.viewWork).props.onClick();
  tree = await settle(runtime, RosterModal, props);
  inputByPlaceholder(tree, learningMessages.vi.comment).props.onChange({ target: { value: 'First student note' } });
  inputByPlaceholder(tree, learningMessages.vi.score).props.onChange({ target: { value: '3' } });
  tree = await settle(runtime, RosterModal, props);

  rowButton(tree, 'student-2', learningMessages.vi.viewWork).props.onClick();
  tree = await settle(runtime, RosterModal, props);
  assert.equal(inputByPlaceholder(tree, learningMessages.vi.comment).props.value, '');
  assert.equal(inputByPlaceholder(tree, learningMessages.vi.score).props.value, '');

  inputByPlaceholder(tree, learningMessages.vi.comment).props.onChange({ target: { value: 'Second student note' } });
  inputByPlaceholder(tree, learningMessages.vi.score).props.onChange({ target: { value: '5' } });
  tree = await settle(runtime, RosterModal, props);
  elements(tree).find((element) => element.type === Button && textOf(element).includes(learningMessages.vi.reviewWork))
    .props.onClick();
  await settle(runtime, RosterModal, props);

  assert.deepEqual(reviews, [{
    id: 'submission-2',
    payload: { comment: 'Second student note', score: 5, expectedVersion: 1 },
  }]);
});

test('a late staff submission response cannot replace the currently selected work', async () => {
  let resolveFirst;
  const firstSubmission = new Promise((resolve) => { resolveFirst = resolve; });
  const learningApi = {
    staffRoster: async () => roster,
    staffSubmission: (id) => (
      id === 'submission-1'
        ? firstSubmission
        : Promise.resolve(makeSubmission(id, 'Student Two'))
    ),
    staffRevisions: async (id) => [{
      id: `revision-${id}`, revisionNo: 1, submittedAt: '2026-11-01T00:00:00Z', textBody: `work-${id}`,
    }],
    staffFeedback: async () => [],
    staffReview: async (id) => makeSubmission(id, 'Student Two'),
    staffReturn: async (id) => makeSubmission(id, 'Student Two'),
  };
  const runtime = createRuntime();
  const { __RosterModal: RosterModal } = loadLearningComponents(runtime, learningApi);
  const props = { assignment, copy: learningMessages.vi, onClose: () => undefined };

  let tree = await settle(runtime, RosterModal, props);
  rowButton(tree, 'student-1', learningMessages.vi.viewWork).props.onClick();
  tree = await settle(runtime, RosterModal, props);
  rowButton(tree, 'student-2', learningMessages.vi.viewWork).props.onClick();
  tree = await settle(runtime, RosterModal, props);
  assert.match(textOf(elements(tree).find((element) => element.props['data-testid'] === 'learning-staff-work')), /Student Two/);

  resolveFirst(makeSubmission('submission-1', 'Student One'));
  tree = await settle(runtime, RosterModal, props);
  assert.match(textOf(elements(tree).find((element) => element.props['data-testid'] === 'learning-staff-work')), /Student Two/);
});

test('student section read failures show a retry state instead of empty materials and assignments', async () => {
  let materialReads = 0;
  const learningApi = {
    mySections: async () => [{ sectionId: 'section-1', courseCode: 'CS101', sectionNumber: '01', courseName: 'Course' }],
    materials: async () => {
      materialReads += 1;
      if (materialReads === 1) throw new Error('temporary read failure');
      return [{ id: 'material-1', title: 'Recovered material', description: '', fileName: null }];
    },
    assignments: async () => [],
  };
  const runtime = createRuntime();
  const { __StudentPage: StudentPage } = loadLearningComponents(runtime, learningApi);
  const props = {};

  let tree = await settle(runtime, StudentPage, props);
  const error = elements(tree).find((element) => element.type === ErrorState);
  assert.ok(error, 'the failed section read should render an error state');
  assert.equal(elements(tree).filter((element) => element.type === EmptyState).length, 0);
  error.props.onRetry();
  tree = await settle(runtime, StudentPage, props);

  assert.equal(elements(tree).some((element) => element.type === ErrorState), false);
  assert.match(textOf(tree), /Recovered material/);
  assert.equal(materialReads, 2);
});

test('lecturer section read failures show a retry state instead of empty materials and assignments', async () => {
  let assignmentReads = 0;
  const learningApi = {
    staffMaterials: async () => [],
    staffAssignments: async () => {
      assignmentReads += 1;
      if (assignmentReads === 1) throw new Error('temporary read failure');
      return [{
        id: 'assignment-2', title: 'Recovered assignment', status: 'PUBLISHED', deadlineAt: null, maxScore: 10,
      }];
    },
  };
  const sectionsApi = {
    getMyGradingSections: async () => [{ id: 'section-1', courseCode: 'CS101', sectionNumber: '01', courseName: 'Course' }],
  };
  const runtime = createRuntime();
  const { __LecturerPage: LecturerPage } = loadLearningComponents(runtime, learningApi, sectionsApi);
  const props = {};

  let tree = await settle(runtime, LecturerPage, props);
  const error = elements(tree).find((element) => element.type === ErrorState);
  assert.ok(error, 'the failed section read should render an error state');
  assert.equal(elements(tree).filter((element) => element.type === EmptyState).length, 0);
  error.props.onRetry();
  tree = await settle(runtime, LecturerPage, props);

  assert.equal(elements(tree).some((element) => element.type === ErrorState), false);
  assert.match(textOf(tree), /Recovered assignment/);
  assert.equal(assignmentReads, 2);
});
