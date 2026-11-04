const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');

function transpile(relativePath) {
  const source = fs.readFileSync(path.join(root, relativePath), 'utf8');
  return ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    fileName: relativePath,
  }).outputText;
}

function load(relativePath, aliases = {}) {
  const moduleRecord = { exports: {} };
  const resolve = (specifier) =>
    Object.hasOwn(aliases, specifier) ? aliases[specifier] : require(specifier);
  Function('module', 'exports', 'require', transpile(relativePath))(
    moduleRecord,
    moduleRecord.exports,
    resolve,
  );
  return moduleRecord.exports;
}

const assistantStream = load('src/lib/assistant-stream.ts');
const streamHelpers = load('src/lib/assistant-stream-helpers.ts');
const arrayListPage = load('src/lib/array-list-page.ts');

/**
 * The real streaming transport composes parseAssistantStreamEvent ->
 * AssistantStreamOrder -> onEvent. Driving thesisApi.streamChat with a scripted
 * Response exercises that exact composition, including the terminal guard the
 * hook relies on, instead of asserting source strings.
 */
const thesisApi = load('src/lib/thesis-api.ts', {
  '@/lib/api': {
    API_BASE_URL: 'http://assistant.test/api/v1',
    createRequestId: () => 'request-id',
    refreshSessionSingleFlight: async () => undefined,
    default: {},
  },
  '@/lib/assistant-stream': assistantStream,
  '@/lib/assistant-stream-helpers': streamHelpers,
  '@/lib/array-list-page': arrayListPage,
}).thesisApi;

const { assistantReducer, initialState } = load('src/components/assistant/assistant-reducer.ts', {
  '@/lib/assistant-history-window': load('src/lib/assistant-history-window.ts'),
});

const encoder = new TextEncoder();

function sseResponse(frames, chunkSize) {
  const bytes = encoder.encode(frames.join(''));
  const stream = new ReadableStream({
    start(controller) {
      if (!chunkSize) {
        controller.enqueue(bytes);
      } else {
        for (let offset = 0; offset < bytes.length; offset += chunkSize) {
          controller.enqueue(bytes.slice(offset, offset + chunkSize));
        }
      }
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

async function runStream(frames, options = {}) {
  const events = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => sseResponse(frames, options.chunkSize);
  try {
    await thesisApi.streamChat('explain the registration window', 'en', {
      clientRequestId: 'stream-test',
      onEvent: (event) => events.push(event),
    });
    return { events, error: null };
  } catch (error) {
    return { events, error };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

const META = 'event: meta\ndata: {"type":"meta","model":"campus-model","conversationId":"c1"}\n\n';
const DELTA = 'event: delta\ndata: {"type":"delta","sequence":0,"text":"Hello"}\n\n';
const DONE = 'event: done\ndata: {"type":"done","messageId":"m1","reasonCode":"ANSWERED","degraded":false}\n\n';

function streamedState(events) {
  let state = assistantReducer(initialState, {
    type: 'assistant-start',
    message: { id: 'local-assistant', role: 'assistant', content: '', pending: true },
  });
  for (const event of events) {
    if (event.type === 'meta') {
      state = assistantReducer(state, {
        type: 'meta',
        model: event.model,
        conversationId: event.conversationId,
      });
    } else if (event.type === 'delta') {
      state = assistantReducer(state, { type: 'delta', text: event.text });
    } else if (event.type === 'done') {
      state = assistantReducer(state, {
        type: 'complete',
        reply: {
          messageId: event.messageId,
          reasonCode: event.reasonCode,
          degraded: event.degraded,
        },
      });
    } else if (event.type === 'error') {
      state = assistantReducer(state, { type: 'error', kind: 'unavailable' });
    }
  }
  return state;
}

test('a stream that ends after deltas without done is rejected and leaves the turn pending', async () => {
  const { events, error } = await runStream([META, DELTA]);

  assert.match(String(error?.message), /ended without a terminal event/);
  assert.deepEqual(events.map((event) => event.type), ['meta', 'delta']);
  const state = streamedState(events);
  assert.equal(state.messages[0].pending, true, 'a truncated turn must not read as completed');
  assert.equal(state.messages[0].content, 'Hello');
});

test('a duplicate done frame is rejected by the terminal guard after the first done', async () => {
  const { events, error } = await runStream([META, DELTA, DONE, DONE]);

  assert.match(String(error?.message), /already terminal/);
  assert.deepEqual(events.map((event) => event.type), ['meta', 'delta', 'done']);
  const state = streamedState(events);
  assert.equal(state.messages[0].pending, false);
  assert.equal(state.messages[0].id, 'm1');
});

test('an error frame after done cannot overwrite the terminal answer', async () => {
  const errorFrame = 'event: error\ndata: {"type":"error","code":"TURN_CANCELLED"}\n\n';
  const { events, error } = await runStream([META, DELTA, DONE, errorFrame]);

  assert.match(String(error?.message), /already terminal/);
  assert.deepEqual(events.map((event) => event.type), ['meta', 'delta', 'done']);
  const state = streamedState(events);
  assert.equal(state.messages[0].content, 'Hello');
  assert.equal(state.messages[0].pending, false);
  assert.equal(state.error, undefined, 'a post-terminal error never reaches reducer state');
});

test('a truncated JSON frame is reported as malformed instead of being rendered', async () => {
  const truncated = 'event: delta\ndata: {"type":"delta","text":"Hel';
  const { events, error } = await runStream([META, truncated]);

  assert.match(String(error?.message), /malformed event/);
  assert.deepEqual(events.map((event) => event.type), ['meta']);
});

test('a complete frame without its trailing blank line is flushed at end of stream', async () => {
  const completeDone = 'event: done\ndata: {"type":"done","messageId":"m2","reasonCode":"ANSWERED","degraded":false}';
  const { events, error } = await runStream([META, DELTA, completeDone]);

  assert.equal(error, null);
  assert.deepEqual(events.map((event) => event.type), ['meta', 'delta', 'done']);
  const state = streamedState(events);
  assert.equal(state.messages[0].pending, false);
  assert.equal(state.messages[0].id, 'm2');
});

test('an unknown frame type is rejected before it reaches the reducer', async () => {
  const unknown = 'event: mystery\ndata: {"type":"mystery","text":"?"}\n\n';
  const { events, error } = await runStream([META, unknown]);

  assert.match(String(error?.message), /unknown assistant event type/);
  assert.deepEqual(events.map((event) => event.type), ['meta']);
});

test('heartbeat-only streams emit no events and are rejected as missing a terminal frame', async () => {
  const { events, error } = await runStream([
    ':heartbeat\n\n',
    ':heartbeat\n\n',
    ':heartbeat\n\n',
  ]);

  assert.match(String(error?.message), /ended without a terminal event/);
  assert.deepEqual(events, []);
});

test('an error frame may terminate a stream that never produced meta or body', async () => {
  const errorFrame = 'event: error\ndata: {"type":"error","code":"TURN_CANCELLED"}\n\n';
  const { events, error } = await runStream([errorFrame]);

  assert.equal(error, null);
  assert.deepEqual(events, [{ type: 'error', code: 'TURN_CANCELLED' }]);
});

test('done without a body frame is rejected as an invalid terminal transition', async () => {
  const { events, error } = await runStream([META, DONE]);

  assert.match(String(error?.message), /done requires body event/);
  assert.deepEqual(events.map((event) => event.type), ['meta']);
});

test('chunk boundaries inside frames do not change terminal handling', async () => {
  const { events, error } = await runStream([META, DELTA, DONE], { chunkSize: 7 });

  assert.equal(error, null);
  assert.deepEqual(events.map((event) => event.type), ['meta', 'delta', 'done']);
  const state = streamedState(events);
  assert.equal(state.messages[0].pending, false);
  assert.equal(state.messages[0].content, 'Hello');
});

test('a failed turn is removed instead of being left as a completed message', () => {
  let state = assistantReducer(initialState, {
    type: 'assistant-start',
    message: { id: 'local-assistant', role: 'assistant', content: '', pending: true },
  });
  state = assistantReducer(state, { type: 'delta', text: 'partial' });
  state = assistantReducer(state, { type: 'stream-failed', kind: 'unavailable' });

  assert.deepEqual(state.messages, []);
  assert.equal(state.error, 'unavailable');
});
