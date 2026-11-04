const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');

const pureModules = new Map();
function loadPure(relative) {
  if (pureModules.has(relative)) return pureModules.get(relative);
  const output = ts.transpileModule(read(relative), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  }).outputText;
  const record = { exports: {} };
  const dependency = (name) => {
    if (name === '@/lib/assistant-history-window') {
      return loadPure('src/lib/assistant-history-window.ts');
    }
    throw new Error(`Unexpected pure-module import: ${name}`);
  };
  Function('require', 'module', 'exports', output)(dependency, record, record.exports);
  pureModules.set(relative, record.exports);
  return record.exports;
}

function createHookRuntime() {
  const slots = [];
  const setters = new Map();
  let cursor = 0;
  let dirty = false;

  const depsChanged = (before, after) =>
    !before ||
    !after ||
    before.length !== after.length ||
    before.some((value, index) => value !== after[index]);

  const hooks = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) {
        slots[index] = typeof initial === 'function' ? initial() : initial;
      }
      const key = `s${index}`;
      if (!setters.has(key)) {
        setters.set(key, (value) => {
          const next = typeof value === 'function' ? value(slots[index]) : value;
          if (Object.is(next, slots[index])) return;
          slots[index] = next;
          dirty = true;
        });
      }
      return [slots[index], setters.get(key)];
    },
    useReducer(reducer, initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initial;
      const key = `r${index}`;
      if (!setters.has(key)) {
        setters.set(key, (action) => {
          const next = reducer(slots[index], action);
          if (Object.is(next, slots[index])) return;
          slots[index] = next;
          dirty = true;
        });
      }
      return [slots[index], setters.get(key)];
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
    useEffect() {
      cursor += 1;
    },
  };

  return {
    hooks,
    begin() {
      cursor = 0;
      dirty = false;
    },
    isDirty() {
      return dirty;
    },
  };
}

function loadHookModule(hooks, api) {
  const output = ts.transpileModule(
    read('src/components/assistant/useAssistantStream.ts'),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
        esModuleInterop: true,
      },
    },
  ).outputText;
  const record = { exports: {} };
  const dependency = (name) => {
    if (name === 'react') return hooks;
    if (name === '@/lib/thesis-api') {
      return {
        createAssistantRequestId: api.createAssistantRequestId,
        thesisApi: api.thesisApi,
      };
    }
    if (name === '@/lib/assistant-student-resolver') {
      return {
        isStudentAssistantQuery: () => false,
        resolveStudentAssistantQuery: async () => null,
      };
    }
    if (name === '@/lib/assistant-input-guard') {
      return {
        inspectAssistantInput: () => ({ allowed: true }),
        isSensitiveGuardReason: () => false,
      };
    }
    if (name === '@/lib/assistant-stream-helpers') {
      return loadPure('src/lib/assistant-stream-helpers.ts');
    }
    if (name === './assistant-reducer') {
      return loadPure('src/components/assistant/assistant-reducer.ts');
    }
    throw new Error(`Unexpected hook import: ${name}`);
  };
  Function('require', 'module', 'exports', output)(dependency, record, record.exports);
  return record.exports;
}

function createHarness({ streamChat, chat }) {
  const runtime = createHookRuntime();
  const streamCalls = [];
  const chatCalls = [];
  let requestCounter = 0;

  const thesisApi = {
    streamChat: async (message, locale, options) => {
      streamCalls.push({ message, options });
      return streamChat(message, options, streamCalls.length - 1);
    },
    chat: async (...args) => {
      chatCalls.push(args);
      return chat(...args);
    },
    cancelRequest: async () => undefined,
    setMessageFeedback: async () => undefined,
    deleteMessageFeedback: async () => undefined,
  };

  const hookModule = loadHookModule(runtime.hooks, {
    thesisApi,
    createAssistantRequestId: () => `request-${(requestCounter += 1)}`,
  });

  let current;
  const render = () => {
    runtime.begin();
    current = hookModule.useAssistantStream({
      locale: 'en',
      assistantMessages: {
        cancelled: 'cancelled',
        unavailable: 'unavailable',
        quotaExceeded: 'quota',
        blocked: 'blocked',
        sensitiveBlocked: 'sensitive',
        technicalBlocked: 'technical',
        turnInProgress: 'busy',
      },
    });
  };
  render();

  async function settle() {
    for (let pass = 0; pass < 12; pass += 1) {
      await new Promise((resolve) => setImmediate(resolve));
      if (runtime.isDirty()) render();
    }
    return current;
  }

  return {
    streamCalls,
    chatCalls,
    settle,
    state: () => current.state,
    send: async (message, options) => {
      await current.sendMessage(undefined, message, options);
      await settle();
    },
  };
}

function completeTurn(conversationId) {
  return async (message, options) => {
    options.onEvent({ type: 'meta', conversationId, model: 'test-model' });
    options.onEvent({ type: 'delta', text: 'Answer' });
    options.onEvent({
      type: 'done',
      messageId: '11111111-1111-4111-8111-111111111111',
      reasonCode: 'ANSWERED',
      degraded: false,
    });
  };
}

test('a retry after a settled turn continues the conversation on screen', async () => {
  const harness = createHarness({
    streamChat: completeTurn('conversation-1'),
    chat: async () => {
      throw new Error('reconciliation should not run for a settled turn');
    },
  });

  await harness.send('When is the deadline?');
  assert.equal(harness.state().conversationId, 'conversation-1');
  assert.equal(harness.chatCalls.length, 0);
  assert.equal(harness.streamCalls[0].options.conversationId, undefined);

  await harness.send('When is the deadline?', { retry: true });

  assert.equal(harness.streamCalls.length, 2);
  assert.equal(
    harness.streamCalls[1].options.conversationId,
    'conversation-1',
    'a retry of a settled turn must stay in the visible conversation',
  );
  assert.equal(
    harness.state().messages.filter((message) => message.role === 'user').length,
    1,
    'a retry must not duplicate the user message',
  );
  assert.equal(harness.chatCalls.length, 0);
});

test('a retry of a turn that never settled replays its original conversation value', async () => {
  const harness = createHarness({
    streamChat: async (message, options) => {
      options.onEvent({ type: 'meta', conversationId: 'conversation-2', model: 'test-model' });
      options.onEvent({ type: 'delta', text: 'Partial answer' });
      throw new Error('stream closed before done');
    },
    chat: async () => {
      const failure = new Error('upstream unavailable');
      failure.response = { status: 503 };
      throw failure;
    },
  });

  await harness.send('When is the deadline?');
  assert.equal(harness.state().conversationId, 'conversation-2');
  const originalRequestId = harness.streamCalls[0].options.clientRequestId;

  await harness.send('When is the deadline?', { retry: true });

  assert.equal(harness.streamCalls.length, 2);
  assert.equal(
    harness.streamCalls[1].options.conversationId,
    undefined,
    'the lost-ack replay keeps the conversation value from its request hash',
  );
  assert.equal(
    harness.streamCalls[1].options.clientRequestId,
    originalRequestId,
    'the lost-ack replay keeps its idempotency key',
  );
});
