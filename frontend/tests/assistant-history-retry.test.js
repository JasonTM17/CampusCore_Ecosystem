const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');
const historyWindow = (() => {
  const output = ts.transpileModule(read('src/lib/assistant-history-window.ts'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  const record = { exports: {} };
  Function('module', 'exports', output)(record, record.exports);
  return record.exports;
})();

const windowCopy = {
  returnToLatest: 'Return to latest',
  returningToLatest: 'Reloading the latest messages…',
  returnToLatestHint: 'Sending is paused while you read older messages.',
  historyNavigationLocked:
    'Older messages cannot load while a reply or feedback save is in progress.',
  windowTrimmed: 'Older messages were hidden to keep this view bounded.',
};

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
      return [
        slots[index],
        (value) => {
          slots[index] =
            typeof value === 'function' ? value(slots[index]) : value;
        },
      ];
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
  };
}

function textOf(children) {
  if (typeof children === 'string' || typeof children === 'number') {
    return String(children);
  }
  if (Array.isArray(children)) return children.map(textOf).join('');
  return '';
}

function walk(node, visit) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit);
    return;
  }
  visit(node);
  walk(node.props?.children, visit);
}

function findAll(tree, predicate) {
  const matches = [];
  walk(tree, (node) => {
    if (predicate(node)) matches.push(node);
  });
  return matches;
}

function findByType(tree, type) {
  return findAll(tree, (node) => node.type === type)[0];
}

function findButton(tree, text) {
  return findAll(
    tree,
    (node) => node.type === 'Button' && textOf(node.props?.children) === text,
  )[0];
}

function findActionButton(tree, text) {
  return findAll(
    tree,
    (node) => node.type === 'Button' && textOf(node.props?.children).includes(text),
  )[0];
}

function loadAssistantPanel({ hooks, stream, thesisApi }) {
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
  const assistantMessages = new Proxy(
    {
      suggestions: ['academic'],
      adminSuggestions: ['admin'],
      facultyHeadSuggestions: ['head'],
      lecturerSuggestions: ['lecturer'],
      specializedSuggestions: ['specialized'],
      followUpsByDomain: {},
      lecturerFollowUpsByDomain: {},
    },
    { get: (target, key) => (key in target ? target[key] : String(key)) },
  );
  const dependencies = (name) => {
    if (name === 'react') return hooks;
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'Fragment' };
    if (name === 'next/navigation') {
      return { usePathname: () => '/dashboard', useRouter: () => ({ push() {} }) };
    }
    if (name === 'lucide-react') {
      return {
        ArrowDown: 'Icon',
        History: 'Icon',
        LoaderCircle: 'Icon',
        RotateCcw: 'Icon',
        X: 'Icon',
      };
    }
    if (name === '@/components/ui/button') return { Button: 'Button' };
    if (name === '@/components/ui/use-confirmation-dialog') {
      return {
        useConfirmationDialog: () => ({
          confirm: async () => true,
          confirmationDialog: null,
        }),
      };
    }
    if (name === '@/lib/utils') {
      return { cn: (...values) => values.filter(Boolean).join(' ') };
    }
    if (name === '@/lib/plural') {
      return { countLabel: (count, singular, plural) => (count === 1 ? singular : plural) };
    }
    if (name === '@/i18n') {
      return {
        useI18n: () => ({
          locale: 'en',
          messages: {
            assistant: assistantMessages,
            common: { actions: { cancel: 'Cancel' } },
          },
          href: (value) => value,
        }),
      };
    }
    if (name === '@/i18n/paths') {
      return { stripLocaleFromPathname: (pathname) => ({ pathname }) };
    }
    if (name === '@/context/AuthContext') {
      return {
        useAuth: () => ({
          isLecturer: false,
          isFacultyHead: false,
          isAdmin: false,
          isSuperAdmin: false,
        }),
      };
    }
    if (name === '@/lib/thesis-api') return { thesisApi };
    if (name === '@/lib/assistant-history-window') return historyWindow;
    if (name === './assistant-messages') {
      return {
        ASSISTANT_STREAM_PROGRESS_STEP: 120,
        getAssistantWindowMessages: () => windowCopy,
      };
    }
    if (name === './AssistantStreamProgress') {
      return { AssistantStreamProgress: 'StreamProgress' };
    }
    if (name === './assistant-reducer') {
      return { TRANSIENT_TERMINAL_CODES: [], fromHistoryMessage: (message) => message };
    }
    if (name === './AssistantMascot') return { AssistantMascot: 'Mascot' };
    if (name === './AssistantMessages') return { AssistantMessages: 'Messages' };
    if (name === './AssistantHistoryPanel') {
      return { AssistantHistoryPanel: 'HistoryPanel' };
    }
    if (name === './AssistantComposer') return { AssistantComposer: 'Composer' };
    if (name === './useAssistantStream') {
      return { useAssistantStream: () => stream };
    }
    throw new Error(`Unexpected panel import: ${name}`);
  };
  Function('require', 'module', 'exports', output)(dependencies, record, record.exports);
  return record.exports.AssistantPanel;
}

function makeMessages(count, prefix = 'm') {
  return Array.from({ length: count }, (_, index) => ({
    id: `${prefix}-${index}`,
    role: index % 2 === 0 ? 'user' : 'assistant',
    content: `message ${index}`,
  }));
}

function createHarness() {
  const resetCalls = [];
  const sendCalls = [];
  const stream = {
    state: {
      messages: [],
      error: undefined,
      conversationId: 'conv-0',
      windowEvictionCount: 0,
    },
    dispatch(action) {
      if (action.type === 'prepend') {
        stream.state = {
          ...stream.state,
          messages: historyWindow.prependHistoryPage(
            stream.state.messages,
            action.messages,
          ).messages,
        };
      } else if (action.type === 'error') {
        stream.state = { ...stream.state, error: action.kind ?? 'unavailable' };
      }
    },
    input: '',
    setInput() {},
    isSending: false,
    isReconciling: false,
    lastPrompt: null,
    sendMessage: async (...args) => {
      sendCalls.push(args);
    },
    stopGeneration: async () => {},
    abortStream() {},
    setFeedback: async () => {},
    resetConversation(conversationId, messages) {
      resetCalls.push({ conversationId, messages });
      stream.state = {
        messages: messages ?? [],
        error: undefined,
        conversationId,
        windowEvictionCount: 0,
      };
    },
  };

  const thesisApi = {
    listConversationsPage: async () => ({ items: [], nextCursor: undefined }),
    getConversationMessages: async () => ({ items: [], nextCursor: undefined }),
    createConversation: async () => ({ id: 'new-conversation' }),
    deleteConversation: async () => undefined,
  };

  const scheduler = createScheduler();
  const Panel = loadAssistantPanel({ hooks: scheduler.hooks, stream, thesisApi });
  const component = () => Panel({});

  const render = () => scheduler.render(component);
  const commit = () => scheduler.commit();

  async function settle() {
    for (let pass = 0; pass < 5; pass += 1) {
      await new Promise((resolve) => setImmediate(resolve));
      render();
      commit();
    }
    return render();
  }

  async function openPanel() {
    render();
    commit();
    window.dispatchEvent(
      new CustomEvent('open-campus-assistant', {
        detail: { mode: 'academic', trigger: {} },
      }),
    );
    return settle();
  }

  async function showHistory() {
    let tree = render();
    const toggle = findAll(
      tree,
      (node) => node.type === 'Button' && node.props?.['aria-label'] === 'history',
    )[0];
    toggle.props.onClick();
    return settle();
  }

  return {
    stream,
    thesisApi,
    resetCalls,
    sendCalls,
    render,
    settle,
    openPanel,
    showHistory,
    tree: () => render(),
  };
}

function findAlertRetry(tree) {
  const alert = findAll(tree, (node) => node.props?.role === 'alert')[0];
  if (!alert) return undefined;
  return findActionButton(alert, 'retry');
}

test.beforeEach(() => {
  global.window = new EventTarget();
  global.window.matchMedia = () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  });
  global.document = new EventTarget();
  global.document.activeElement = null;
  global.requestAnimationFrame = () => 0;
  if (typeof globalThis.CustomEvent !== 'function') {
    globalThis.CustomEvent = class CustomEvent extends Event {
      constructor(type, init) {
        super(type);
        this.detail = init?.detail;
      }
    };
  }
});

async function selectConversation(harness) {
  let tree = await harness.openPanel();
  tree = await harness.showHistory();
  findByType(tree, 'HistoryPanel').props.onSelect({
    id: 'conv-1',
    title: 'Conversation 1',
  });
  return harness.settle();
}

test('a failed older-page load retries the page instead of re-sending the prompt', async () => {
  const harness = createHarness();
  const latest = makeMessages(100, 'latest');
  let olderPageRequests = 0;
  harness.stream.lastPrompt = 'When is the deadline?';
  harness.thesisApi.listConversationsPage = async () => ({
    items: [{ id: 'conv-1', title: 'Conversation 1' }],
    nextCursor: undefined,
  });
  harness.thesisApi.getConversationMessages = async (conversationId, params) => {
    if (!params?.cursor) return { items: latest, nextCursor: 'cursor-1' };
    if (params.cursor === 'cursor-1') {
      olderPageRequests += 1;
      if (olderPageRequests === 1) throw new Error('service unavailable');
      return { items: makeMessages(50, 'older'), nextCursor: 'cursor-2' };
    }
    return { items: [], nextCursor: undefined };
  };

  let tree = await selectConversation(harness);
  assert.equal(harness.stream.state.messages.length, 100);

  findButton(tree, 'loadMoreMessages').props.onClick();
  tree = await harness.settle();

  assert.equal(olderPageRequests, 1);
  assert.ok(
    harness.stream.state.messages.some((message) => message.id === 'latest-99'),
    'the failed page load leaves the last answer on screen',
  );
  const retry = findAlertRetry(tree);
  assert.ok(retry, 'the failed page load offers a retry action');
  retry.props.onClick();
  tree = await harness.settle();

  assert.equal(harness.sendCalls.length, 0, 'the retry must not send a chat turn');
  assert.equal(olderPageRequests, 2, 'the retry re-requests the failed history page');
  assert.ok(
    harness.stream.state.messages.some((message) => message.id === 'older-0'),
    'the retried page is applied to the transcript',
  );
  assert.equal(
    harness.stream.state.error,
    undefined,
    'a page failure must not raise the chat error state',
  );
});

test('a failed conversation creation retries creation instead of re-sending the prompt', async () => {
  const harness = createHarness();
  harness.stream.lastPrompt = 'When is the deadline?';
  harness.stream.state = {
    ...harness.stream.state,
    messages: makeMessages(4, 'chat'),
  };
  let createRequests = 0;
  harness.thesisApi.createConversation = async () => {
    createRequests += 1;
    if (createRequests === 1) throw new Error('service unavailable');
    return { id: 'new-conversation' };
  };

  let tree = await harness.openPanel();
  const newChat = findAll(
    tree,
    (node) => node.type === 'Button' && node.props?.['aria-label'] === 'newConversation',
  )[0];
  assert.ok(newChat, 'the header offers New Chat');
  newChat.props.onClick();
  tree = await harness.settle();

  assert.equal(createRequests, 1);
  const retry = findAlertRetry(tree);
  assert.ok(retry, 'the failed creation offers a retry action');
  retry.props.onClick();
  tree = await harness.settle();

  assert.equal(harness.sendCalls.length, 0, 'the retry must not send a chat turn');
  assert.equal(createRequests, 2, 'the retry re-requests conversation creation');
  assert.equal(harness.resetCalls.at(-1).conversationId, 'new-conversation');
  assert.equal(
    harness.stream.state.error,
    undefined,
    'a creation failure must not raise the chat error state',
  );
});
