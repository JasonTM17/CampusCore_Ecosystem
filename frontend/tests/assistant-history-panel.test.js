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

const plural = (() => {
  const output = ts.transpileModule(read('src/lib/plural.ts'), {
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
      rateLimited: 'Too many requests — please wait {seconds} seconds and retry.',
      rateLimitedOne: 'Too many requests — please wait {seconds} second and retry.',
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
    if (name === '@/lib/plural') return plural;
    if (name === '@/lib/login-portal') return { sessionExpiredLoginHref: () => '/login' };
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
    return require(name);
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
  const pathnameRef = { current: '/dashboard' };
  const resetCalls = [];
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
    sendMessage: async () => {},
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
    pathnameRef,
    render,
    settle,
    openPanel,
    showHistory,
    tree: () => render(),
  };
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

test('the conversation sidebar is bounded to 100 newest entries', async () => {
  const harness = createHarness();
  harness.thesisApi.listConversationsPage = async () => ({
    items: Array.from({ length: 120 }, (_, index) => ({
      id: `conversation-${index}`,
      title: `Conversation ${index}`,
    })),
    nextCursor: 'more',
  });

  await harness.openPanel();
  const tree = await harness.showHistory();
  const historyPanel = findByType(tree, 'HistoryPanel');

  assert.ok(historyPanel, 'history drawer renders');
  assert.equal(historyPanel.props.history.length, 100);
  assert.equal(historyPanel.props.nextCursor, undefined, 'the bound hides the older cursor');
});

test('older-history paging shows Return to latest and pauses sending until restored', async () => {
  const harness = createHarness();
  const latest = makeMessages(100, 'latest');
  const older = makeMessages(50, 'older');
  harness.thesisApi.listConversationsPage = async () => ({
    items: [{ id: 'conv-1', title: 'Conversation 1' }],
    nextCursor: undefined,
  });
  harness.thesisApi.getConversationMessages = async (conversationId, params) => {
    if (conversationId !== 'conv-1') return { items: [], nextCursor: undefined };
    if (!params?.cursor) return { items: latest, nextCursor: 'cursor-1' };
    if (params.cursor === 'cursor-1') return { items: older, nextCursor: 'cursor-2' };
    return { items: [], nextCursor: undefined };
  };

  let tree = await harness.openPanel();
  tree = await harness.showHistory();
  findByType(tree, 'HistoryPanel').props.onSelect({ id: 'conv-1', title: 'Conversation 1' });
  tree = await harness.settle();

  assert.equal(harness.stream.state.messages.length, 100);
  const loadOlder = findButton(tree, 'loadMoreMessages');
  assert.ok(loadOlder, 'older messages control is offered');
  assert.equal(loadOlder.props.disabled, false);

  loadOlder.props.onClick();
  tree = await harness.settle();

  assert.equal(harness.stream.state.messages.length, 100);
  assert.ok(harness.stream.state.messages.some((message) => message.id === 'older-0'));
  const returnButton = findButton(tree, 'Return to latest');
  assert.ok(returnButton, 'older-history view exposes Return to latest');
  assert.equal(findByType(tree, 'Composer').props.historyLocked, true);

  returnButton.props.onClick();
  tree = await harness.settle();

  assert.equal(harness.resetCalls.at(-1).conversationId, 'conv-1');
  assert.equal(findButton(tree, 'Return to latest'), undefined);
  assert.equal(findByType(tree, 'Composer').props.historyLocked, false);
});

test('late history selection responses are fenced by conversation and generation', async () => {
  const harness = createHarness();
  let resolveA;
  let resolveB;
  const pageA = new Promise((resolve) => { resolveA = resolve; });
  const pageB = new Promise((resolve) => { resolveB = resolve; });
  harness.thesisApi.listConversationsPage = async () => ({
    items: [
      { id: 'A', title: 'Conversation A' },
      { id: 'B', title: 'Conversation B' },
    ],
    nextCursor: undefined,
  });
  harness.thesisApi.getConversationMessages = (conversationId) =>
    conversationId === 'A' ? pageA : pageB;

  let tree = await harness.openPanel();
  tree = await harness.showHistory();
  const historyPanel = findByType(tree, 'HistoryPanel');

  historyPanel.props.onSelect({ id: 'A', title: 'Conversation A' });
  await harness.settle();
  historyPanel.props.onSelect({ id: 'B', title: 'Conversation B' });
  await harness.settle();

  resolveB({ items: makeMessages(4, 'b'), nextCursor: undefined });
  await harness.settle();
  assert.deepEqual(
    harness.resetCalls.map((call) => call.conversationId),
    ['B'],
    'the latest selection resets the conversation',
  );

  resolveA({ items: makeMessages(4, 'a'), nextCursor: undefined });
  await harness.settle();
  assert.deepEqual(
    harness.resetCalls.map((call) => call.conversationId),
    ['B'],
    'the stale response cannot replace the newer conversation',
  );
});

test('a live eviction rebases older history from the latest server page before using the old cursor', async () => {
  const harness = createHarness();
  const latest = makeMessages(100, 'latest');
  const calls = [];
  let latestFetches = 0;
  harness.thesisApi.listConversationsPage = async () => ({
    items: [{ id: 'conv-1', title: 'Conversation 1' }],
    nextCursor: undefined,
  });
  harness.thesisApi.getConversationMessages = async (conversationId, params) => {
    calls.push(params?.cursor);
    if (!params?.cursor) {
      latestFetches += 1;
      return {
        items: latest,
        nextCursor: latestFetches === 1 ? 'stale-cursor' : 'fresh-cursor',
      };
    }
    if (params.cursor === 'fresh-cursor') {
      return { items: makeMessages(50, 'older'), nextCursor: 'older-cursor' };
    }
    return { items: [], nextCursor: undefined };
  };

  let tree = await harness.openPanel();
  tree = await harness.showHistory();
  findByType(tree, 'HistoryPanel').props.onSelect({ id: 'conv-1', title: 'Conversation 1' });
  tree = await harness.settle();
  assert.deepEqual(calls, [undefined], 'the initial selection loads the latest page');

  // A live eviction drops messages from the oldest end; the stored cursor no
  // longer describes the displayed window.
  harness.stream.state = {
    ...harness.stream.state,
    windowEvictionCount: 1,
  };
  tree = await harness.settle();
  findButton(tree, 'loadMoreMessages').props.onClick();
  tree = await harness.settle();

  assert.deepEqual(
    calls,
    [undefined, undefined, 'fresh-cursor'],
    'the stale cursor is replaced by the latest page boundary before paging',
  );
  assert.equal(calls.includes('stale-cursor'), false);
  assert.equal(harness.stream.state.messages.length, 100);
  assert.ok(harness.stream.state.messages.some((message) => message.id === 'older-0'));
});

test('a one-second rate limit notice uses the singular second', async () => {
  const harness = createHarness();
  harness.stream.state = {
    ...harness.stream.state,
    error: 'rate-limited',
    retryAfterSeconds: 1,
  };

  const tree = await harness.openPanel();
  const notice = findAll(
    tree,
    (node) =>
      node.type === 'p' &&
      textOf(node.props?.children).includes('Too many requests'),
  )[0];

  assert.ok(notice, 'the rate-limit banner renders');
  assert.equal(
    textOf(notice.props.children),
    'Too many requests — please wait 1 second and retry.',
  );
});

test('history navigation is disabled while reconciling or when a feedback write would be evicted', async () => {
  const harness = createHarness();
  const latest = makeMessages(100, 'latest');
  harness.thesisApi.listConversationsPage = async () => ({
    items: [{ id: 'conv-1', title: 'Conversation 1' }],
    nextCursor: undefined,
  });
  harness.thesisApi.getConversationMessages = async () => ({
    items: latest,
    nextCursor: 'cursor-1',
  });

  let tree = await harness.openPanel();
  tree = await harness.showHistory();
  findByType(tree, 'HistoryPanel').props.onSelect({ id: 'conv-1', title: 'Conversation 1' });
  tree = await harness.settle();

  harness.stream.isReconciling = true;
  tree = await harness.settle();
  assert.equal(
    findButton(tree, 'loadMoreMessages').props.disabled,
    true,
    'reconciliation blocks older-history navigation',
  );

  harness.stream.isReconciling = false;
  harness.stream.state = {
    ...harness.stream.state,
    // The last message falls inside the 50-message newest-end eviction window.
    messages: harness.stream.state.messages.map((message, index) =>
      index === harness.stream.state.messages.length - 1
        ? { ...message, feedbackPending: true }
        : message,
    ),
  };
  tree = await harness.settle();
  assert.equal(
    findButton(tree, 'loadMoreMessages').props.disabled,
    true,
    'an in-flight feedback write that would be evicted blocks navigation',
  );
});
