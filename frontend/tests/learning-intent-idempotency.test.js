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
  const resolve = (specifier) =>
    Object.prototype.hasOwnProperty.call(stubs, specifier)
      ? stubs[specifier]
      : require(specifier);
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

/** Minimal hook runtime: state and refs persist, effects rerun when deps change. */
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
        if (!(index in state)) {
          state[index] = typeof initial === 'function' ? initial() : initial;
        }
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

function buttonByText(tree, text) {
  return elements(tree).find(
    (element) => (element.type === 'button' || element.type === Button) && textOf(element).includes(text),
  );
}

const iconStub = new Proxy({}, { get: (_target, property) => (property === '__esModule' ? true : () => null) });
const Button = ({ children, onClick, disabled }) =>
  React.createElement('button', { type: 'button', onClick, disabled }, children);
const Modal = ({ isOpen, children }) =>
  isOpen ? React.createElement('div', { 'data-testid': 'modal' }, children) : null;

const learningMessages = load('src/i18n/learning-messages.ts').learningMessages.vi;

function submiss(overrides = {}) {
  return {
    id: 'sub-1',
    assignmentId: 'a1',
    status: 'DRAFT',
    draftText: 'my answer',
    draftFileName: null,
    submittedAt: null,
    ...overrides,
  };
}

function mountModal(runtime, learningApi, mintedKeys) {
  return load(
    'src/components/learning/LearningConsolePage.tsx',
    {
      react: runtime.react,
      'lucide-react': iconStub,
      sonner: { toast: { success: () => undefined, error: () => undefined } },
      '@/context/AuthContext': { useRequireAuth: () => ({ isLoading: false, user: { id: 'u1' } }) },
      '@/lib/learning-api': {
        newLearningIdempotencyKey: () => {
          const key = `key-${mintedKeys.length}`;
          mintedKeys.push(key);
          return key;
        },
        learningApi,
        readFilePayload: async () => null,
      },
      '@/lib/api': { sectionsApi: {} },
      '@/components/ui/button': { Button },
      '@/components/ui/input': { Input: (props) => React.createElement('input', props) },
      '@/components/ui/modal': { Modal },
      '@/components/ui/page-header': {
        PageHeader: ({ children }) => React.createElement('header', null, children),
        SectionEyebrow: ({ children }) => React.createElement('span', null, children),
      },
      '@/components/ui/state-block': {
        EmptyState: () => null,
        ErrorState: () => null,
        LoadingState: () => null,
      },
      '@/components/ui/status': { statusToneClass: () => '' },
      '@/lib/upload-validation': { UPLOAD_ACCEPT_COURSEWORK: '.pdf' },
      '@/lib/request-epoch': { createRequestEpoch: () => ({ begin: () => 1 }) },
      '@/lib/utils': { cn: (...values) => values.filter(Boolean).join(' ') },
      '@/i18n': {
        useI18n: () => ({ locale: 'vi', formatDateTime: (value) => String(value) }),
      },
      '@/i18n/learning-messages': { learningMessages: { vi: learningMessages, en: learningMessages } },
    },
    '\nexport { StudentWorkModal as __StudentWorkModal };\n',
    runtime.react,
  ).__StudentWorkModal;
}

async function frame(runtime, Component, props) {
  const { tree, effects } = runtime.render(Component, props);
  runtime.runEffects(effects);
  await new Promise((resolve) => setImmediate(resolve));
  return tree;
}

async function settle(runtime, Component, props) {
  let tree = null;
  for (let pass = 0; pass < 6; pass += 1) tree = await frame(runtime, Component, props);
  return tree;
}

test('draft, submit and resubmit each keep their own key across retries', async () => {
  const keys = { draft: [], submit: [], resubmit: [] };
  let submitted = 0;
  let resubmitted = 0;
  let status = 'DRAFT';

  const learningApi = {
    openDraft: async (_assignmentId, key) => {
      keys.draft.push(key);
      status = 'DRAFT';
      return submiss({ status: 'DRAFT' });
    },
    submit: async (_assignmentId, key) => {
      keys.submit.push(key);
      if (submitted === 0) {
        submitted += 1;
        throw new Error('network down');
      }
      // A returned submission reopens the resubmit intent in the same modal.
      status = 'RETURNED';
      return submiss({ status: 'SUBMITTED' });
    },
    resubmit: async (_assignmentId, _payload, key) => {
      keys.resubmit.push(key);
      if (resubmitted === 0) {
        resubmitted += 1;
        throw { response: { status: 503, data: {} } };
      }
      return submiss({ status: 'RESUBMITTED' });
    },
    mySubmission: async () => submiss({ status }),
    myRevisions: async () => [],
    myFeedback: async () => [],
    saveDraft: async () => submiss({ status: 'DRAFT' }),
    downloadRevision: async () => undefined,
  };

  const runtime = createRuntime();
  const mintedKeys = [];
  const StudentWorkModal = mountModal(runtime, learningApi, mintedKeys);
  const assignment = {
    id: 'a1',
    title: 'Essay',
    status: 'PUBLISHED',
    deadlineAt: '2026-11-10T00:00:00Z',
    mySubmissionId: null,
  };
  const props = {
    assignment,
    copy: learningMessages,
    onClose: () => undefined,
    onChanged: () => undefined,
  };

  const mounted = await settle(runtime, StudentWorkModal, props);

  buttonByText(mounted, learningMessages.draftWork).props.onClick();
  const drafted = await settle(runtime, StudentWorkModal, props);
  assert.equal(keys.draft.length, 1, 'opening the draft sends one key');

  buttonByText(drafted, learningMessages.submitWork).props.onClick();
  const failedSubmit = await settle(runtime, StudentWorkModal, props);
  assert.equal(keys.submit.length, 1, 'the first submit attempt is sent');

  buttonByText(failedSubmit, learningMessages.submitWork).props.onClick();
  const submittedTree = await settle(runtime, StudentWorkModal, props);
  assert.equal(keys.submit.length, 2, 'the retry is sent');

  assert.equal(keys.submit[1], keys.submit[0], 'a retried submit reuses its own key');
  assert.notEqual(
    keys.submit[0],
    keys.draft[0],
    'a submit after opening the draft must not reuse the draft key',
  );

  buttonByText(submittedTree, learningMessages.resubmitWork).props.onClick();
  const failedResubmit = await settle(runtime, StudentWorkModal, props);
  buttonByText(failedResubmit, learningMessages.resubmitWork).props.onClick();
  await settle(runtime, StudentWorkModal, props);

  assert.equal(keys.resubmit.length, 2, 'the resubmit retry is sent');
  assert.equal(keys.resubmit[1], keys.resubmit[0], 'a retried resubmit reuses its own key');
  assert.equal(
    new Set([keys.draft[0], keys.submit[0], keys.resubmit[0]]).size,
    3,
    'draft, submit and resubmit write intents each carry a distinct key',
  );
});
