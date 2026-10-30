const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');

// The e2e stack serves `next dev`, where reactStrictMode replays every mount
// effect (setup -> cleanup -> setup). This harness models just enough of that
// scheduling to replay the assistant panel's mount on a given pathname: state
// writes apply in call order, effects register per hook index, commit() runs
// the mount pass, and strictReplay() runs the second Strict Mode pass.
function createScheduler() {
  const slots = [];
  const effects = new Map();
  const order = [];
  const pending = new Set();
  let cursor = 0;

  const depsChanged = (before, after) =>
    !before || !after || before.length !== after.length ||
    before.some((value, index) => value !== after[index]);

  const hooks = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initial;
      return [slots[index], (value) => { slots[index] = value; }];
    },
    useRef(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { current: initial };
      return slots[index];
    },
    useCallback(callback, deps) {
      const index = cursor++;
      if (!(index in slots) || depsChanged(slots[index].deps, deps)) {
        slots[index] = { callback, deps };
      }
      return slots[index].callback;
    },
    useMemo(factory, deps) {
      const index = cursor++;
      if (!(index in slots) || depsChanged(slots[index].deps, deps)) {
        slots[index] = { value: factory(), deps };
      }
      return slots[index].value;
    },
    useEffect(setup, deps) {
      const index = cursor++;
      if (!effects.has(index)) order.push(index);
      const slot = effects.get(index) ?? { deps, setup, cleanup: null };
      if (effects.has(index) && depsChanged(slot.deps, deps)) pending.add(index);
      if (!effects.has(index)) pending.add(index);
      slot.deps = deps;
      slot.setup = setup;
      effects.set(index, slot);
    },
  };

  return {
    hooks,
    render(component) {
      cursor = 0;
      return component();
    },
    commit() {
      for (const index of order) {
        if (!pending.delete(index)) continue;
        const slot = effects.get(index);
        slot.cleanup?.();
        slot.cleanup = slot.setup() ?? null;
      }
    },
    strictReplay() {
      for (const index of order) {
        const slot = effects.get(index);
        slot.cleanup?.();
        slot.cleanup = slot.setup() ?? null;
      }
    },
  };
}

function loadAssistantPanel({ hooks, pathnameRef, stream }) {
  const output = ts.transpileModule(read('src/components/assistant/AssistantPanel.tsx'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  }).outputText;
  const record = { exports: {} };
  const jsx = (type, props) => ({ type, props });
  const assistantMessages = new Proxy({
    suggestions: ['academic'],
    adminSuggestions: ['admin'],
    facultyHeadSuggestions: ['head'],
    lecturerSuggestions: ['lecturer'],
    specializedSuggestions: ['specialized'],
    followUpsByDomain: {},
    lecturerFollowUpsByDomain: {},
  }, { get: (target, key) => (key in target ? target[key] : String(key)) });
  const dependencies = (name) => {
    if (name === 'react') return hooks;
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'Fragment' };
    if (name === 'next/navigation') {
      return { usePathname: () => pathnameRef.current, useRouter: () => ({ push() {} }) };
    }
    if (name === 'lucide-react') {
      return { ArrowDown: 'Icon', History: 'Icon', LoaderCircle: 'Icon', RotateCcw: 'Icon', X: 'Icon' };
    }
    if (name === '@/components/ui/button') return { Button: 'Button' };
    if (name === '@/components/ui/use-confirmation-dialog') {
      return { useConfirmationDialog: () => ({ confirm: async () => true, confirmationDialog: null }) };
    }
    if (name === '@/lib/utils') return { cn: (...values) => values.filter(Boolean).join(' ') };
    if (name === '@/i18n') {
      return {
        useI18n: () => ({
          locale: 'en',
          messages: { assistant: assistantMessages, common: { actions: { cancel: 'Cancel' } } },
          href: (value) => value,
        }),
      };
    }
    if (name === '@/i18n/paths') return { stripLocaleFromPathname: (pathname) => ({ pathname }) };
    if (name === '@/context/AuthContext') {
      return { useAuth: () => ({ isLecturer: false, isFacultyHead: false, isAdmin: false, isSuperAdmin: false }) };
    }
    if (name === '@/lib/thesis-api') {
      const pendingRequest = () => new Promise(() => {});
      return {
        thesisApi: {
          listConversationsPage: pendingRequest,
          getConversationMessages: pendingRequest,
          createConversation: pendingRequest,
          deleteConversation: pendingRequest,
        },
      };
    }
    if (name === './assistant-reducer') {
      return { TRANSIENT_TERMINAL_CODES: [], fromHistoryMessage: (message) => message };
    }
    if (name === './AssistantMascot') return { AssistantMascot: 'Mascot' };
    if (name === './AssistantMessages') return { AssistantMessages: 'Messages' };
    if (name === './AssistantHistoryPanel') return { AssistantHistoryPanel: 'HistoryPanel' };
    if (name === './AssistantComposer') return { AssistantComposer: 'Composer' };
    if (name === './useAssistantStream') return { useAssistantStream: () => stream };
    return require(name);
  };
  Function('require', 'module', 'exports', output)(dependencies, record, record.exports);
  return record.exports.AssistantPanel;
}

function hasDialog(node) {
  if (!node || typeof node !== 'object') return false;
  if (node.props?.role === 'dialog') return true;
  const children = node.props?.children;
  return Array.isArray(children) ? children.some(hasDialog) : hasDialog(children);
}

function mountAssistantPanel(pathname) {
  const pathnameRef = { current: pathname };
  const stream = {
    state: { messages: [], error: null, conversationId: undefined },
    dispatch() {},
    input: '',
    setInput() {},
    isSending: false,
    lastPrompt: null,
    sendMessage: async () => {},
    stopGeneration: async () => {},
    abortStream() {},
    setFeedback: async () => {},
    resetConversation() {},
  };
  const scheduler = createScheduler();
  const Panel = loadAssistantPanel({ hooks: scheduler.hooks, pathnameRef, stream });
  // Mirrors LazyAssistantPanel.handleReady: the captured first activation is
  // replayed once; the latched readyRef makes later onReady calls inert.
  let replayed = false;
  const onReady = () => {
    if (replayed) return;
    replayed = true;
    window.dispatchEvent(new CustomEvent('open-campus-assistant', {
      detail: { trigger: { id: 'header-assistant-button' } },
    }));
  };
  const component = () => Panel({ onReady });
  scheduler.render(component);
  scheduler.commit();
  scheduler.strictReplay();
  return {
    pathnameRef,
    // React re-renders so effects re-register with the new deps, then commits
    // the ones whose deps changed — the model for a client-side navigation.
    navigate() {
      scheduler.render(component);
      scheduler.commit();
    },
    dialog: () => hasDialog(scheduler.render(component)),
  };
}

test.beforeEach(() => {
  global.window = new EventTarget();
  global.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  global.document = new EventTarget();
  global.document.activeElement = null;
  global.requestAnimationFrame = () => 0;
  if (typeof globalThis.CustomEvent !== 'function') {
    globalThis.CustomEvent = class CustomEvent extends Event {
      constructor(type, init) { super(type); this.detail = init?.detail; }
    };
  }
});

test('a replayed open request survives the Strict Mode effect replay on the specialized route', () => {
  const mounted = mountAssistantPanel('/dashboard/assistant-specialized');
  assert.equal(
    mounted.dialog(),
    true,
    'the header assistant button must open the academic panel on the specialized route',
  );
});

test('an open drawer carried over from another route still closes on the specialized route', () => {
  const mounted = mountAssistantPanel('/dashboard');
  assert.equal(mounted.dialog(), true, 'sanity: the replayed open mounts the dialog');
  mounted.pathnameRef.current = '/dashboard/assistant-specialized';
  mounted.navigate();
  assert.equal(
    mounted.dialog(),
    false,
    'navigating onto the specialized workspace must close a carried-over drawer',
  );
});
