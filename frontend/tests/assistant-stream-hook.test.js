const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');

function loadModule(relativePath, aliases = {}) {
  const source = fs.readFileSync(path.join(root, relativePath), 'utf8');
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const mod = { exports: {} };
  const resolve = (specifier) =>
    Object.hasOwn(aliases, specifier) ? aliases[specifier] : require(specifier);
  new Function('module', 'exports', 'require', js)(mod, mod.exports, resolve);
  return mod.exports;
}

const reducerModule = loadModule('src/components/assistant/assistant-reducer.ts', {
  '@/lib/assistant-history-window': loadModule('src/lib/assistant-history-window.ts'),
});
const streamHelpers = loadModule('src/lib/assistant-stream-helpers.ts');

const ASSISTANT_MESSAGES = {
  cancelled: 'Cancelled',
  unavailable: 'Assistant unavailable',
  quotaExceeded: 'Quota exceeded',
  blocked: 'Blocked',
  sensitiveBlocked: 'Sensitive data blocked',
  technicalBlocked: 'Technical request blocked',
  turnInProgress: 'Turn in progress',
};

/**
 * Minimal hook runtime: one render pass with real state/reducer updates. The
 * hook is exercised through the functions it returns, so re-render semantics
 * are not needed beyond the state cell the dispatcher mutates.
 */
function createHookHarness() {
  let state = reducerModule.initialState;
  const dispatches = [];
  const effects = [];
  const react = {
    useState(initial) {
      let value = initial;
      return [value, (next) => {
        value = typeof next === 'function' ? next(value) : next;
      }];
    },
    useReducer(reducer, initialArg) {
      state = initialArg;
      return [state, (action) => {
        dispatches.push(action);
        state = reducer(state, action);
      }];
    },
    useRef(initial) {
      return { current: initial };
    },
    useEffect(callback) {
      effects.push(callback);
    },
    useCallback(callback) {
      return callback;
    },
  };
  return { react, dispatches, effects, getState: () => state };
}

function loadHook(harness, overrides = {}) {
  const thesisApi = {
    createAssistantRequestId: () => 'req-test-1',
    thesisApi: {
      streamChat: async () => {
        throw new Error('streamChat was not scripted');
      },
      chat: async () => {
        throw Object.assign(new Error('chat was not scripted'), { response: { status: 500 } });
      },
      cancelRequest: async () => undefined,
      ...overrides,
    },
  };
  const hookModule = loadModule('src/components/assistant/useAssistantStream.ts', {
    react: harness.react,
    '@/lib/thesis-api': thesisApi,
    './assistant-reducer': reducerModule,
    '@/lib/assistant-student-resolver': {
      isStudentAssistantQuery: () => false,
      resolveStudentAssistantQuery: async () => null,
    },
    '@/lib/assistant-input-guard': {
      inspectAssistantInput: () => ({ allowed: true }),
      isSensitiveGuardReason: () => false,
    },
    '@/lib/assistant-stream-helpers': streamHelpers,
  });
  return hookModule.useAssistantStream;
}

function mountHook(runAssistantStream, onReconcileHistory) {
  return runAssistantStream({
    locale: 'vi',
    assistantMessages: ASSISTANT_MESSAGES,
    onReconcileHistory,
  });
}

test('assistant streaming hook terminal-frame handling', async (t) => {
  const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', {
    value: { onLine: true },
    configurable: true,
  });

  try {
    await t.test('a stream that ends without a done frame reconciles instead of claiming success', async () => {
      const harness = createHookHarness();
      const calls = { stream: 0, chat: 0, reconcile: 0 };
      const runAssistantStream = loadHook(harness, {
        streamChat: async (message, locale, options) => {
          calls.stream += 1;
          options.onEvent({ type: 'meta', conversationId: 'conv-1', model: 'test-model' });
          options.onEvent({ type: 'delta', text: 'partial answer' });
          // The transport closes without the terminal frame.
        },
        chat: async () => {
          calls.chat += 1;
          throw Object.assign(new Error('reconcile unavailable'), { response: { status: 500 } });
        },
      });

      const api = mountHook(runAssistantStream, () => {
        calls.reconcile += 1;
      });
      await api.sendMessage(undefined, 'hello');

      const state = harness.getState();
      assert.equal(calls.stream, 1);
      assert.equal(calls.chat, 1, 'a missing done frame must trigger a JSON reconciliation');
      assert.equal(calls.reconcile, 0, 'an unconfirmed turn must not be reported as successful');
      assert.equal(state.error, 'unavailable');
      assert.equal(
        state.messages.some((message) => message.role === 'assistant'),
        false,
        'the unconfirmed assistant placeholder is withdrawn',
      );
    });

    await t.test('a thrown terminal race is localized without a JSON replay', async () => {
      const harness = createHookHarness();
      const calls = { chat: 0, reconcile: 0 };
      const runAssistantStream = loadHook(harness, {
        streamChat: async (message, locale, options) => {
          options.onEvent({ type: 'delta', text: 'partial answer' });
          options.onEvent({ type: 'error', code: 'TURN_TERMINAL_RACE' });
        },
        chat: async () => {
          calls.chat += 1;
          return { answer: 'must not replay', messageId: 'replayed' };
        },
      });

      const api = mountHook(runAssistantStream, () => {
        calls.reconcile += 1;
      });
      await api.sendMessage(undefined, 'hello');

      const state = harness.getState();
      const reply = state.messages.find((message) => message.role === 'assistant');
      assert.equal(calls.chat, 0, 'a terminal race must never be replayed as a JSON request');
      assert.equal(calls.reconcile, 1, 'history is reconciled once for the terminal race');
      assert.equal(state.error, undefined);
      assert.equal(reply.content, ASSISTANT_MESSAGES.unavailable);
      assert.equal(reply.reasonCode, 'TURN_TERMINAL_RACE');
      assert.equal(reply.degraded, true);
      assert.equal(reply.pending, false);
    });

    await t.test('unmount aborts the stream and no late event dispatches after teardown', async () => {
      const harness = createHookHarness();
      const calls = { cancel: 0 };
      let emit;
      let resolveStream;
      const streamPromise = new Promise((resolve) => {
        resolveStream = resolve;
      });
      const runAssistantStream = loadHook(harness, {
        streamChat: (message, locale, options) => {
          emit = options.onEvent;
          return streamPromise;
        },
        cancelRequest: async () => {
          calls.cancel += 1;
        },
      });

      const api = mountHook(runAssistantStream, () => undefined);
      const sendPromise = api.sendMessage(undefined, 'hello');
      assert.equal(harness.getState().messages.length, 2, 'the turn reserves its assistant slot');
      assert.equal(harness.effects.length, 1, 'the hook registers its unmount cleanup');

      const dispatchesBeforeTeardown = harness.dispatches.length;
      const cleanup = harness.effects[0]();
      cleanup();
      assert.equal(calls.cancel, 1, 'unmount sends the bounded server cancellation');

      emit({ type: 'delta', text: 'late delta' });
      assert.equal(
        harness.dispatches.length,
        dispatchesBeforeTeardown,
        'a stream event after teardown must not dispatch',
      );

      resolveStream();
      await sendPromise;
      assert.equal(
        harness.dispatches.length,
        dispatchesBeforeTeardown,
        'the aborted turn must not surface a cancellation message after unmount',
      );
      assert.equal(harness.getState().messages[1].content, '');
    });
  } finally {
    if (navigatorDescriptor) {
      Object.defineProperty(globalThis, 'navigator', navigatorDescriptor);
    } else {
      delete globalThis.navigator;
    }
  }
});
