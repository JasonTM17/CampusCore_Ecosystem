import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import { fileURLToPath, pathToFileURL } from 'node:url';

const mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'campus-assistant-stream-'));
const compilerOptions = {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
};

for (const sourceFile of [
  'api/assistant-stream.ts',
  'api/assistant-stream-state.ts',
  'api/assistant-limits.ts',
  'assistant/turn-orchestrator.ts',
]) {
  const source = fs.readFileSync(path.join(mobileRoot, 'src', sourceFile), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    ...compilerOptions,
    fileName: sourceFile,
  });
  fs.writeFileSync(
    path.join(tempRoot, path.basename(sourceFile).replace('.ts', '.mjs')),
    outputText.replace(/from '(?:\.{1,2}\/)+(?:[\w-]+\/)*([\w-]+)'/g, "from './$1.mjs'"),
  );
}

const streamModule = await import(pathToFileURL(path.join(tempRoot, 'assistant-stream.mjs')).href);
const stateModule = await import(pathToFileURL(path.join(tempRoot, 'assistant-stream-state.mjs')).href);
const orchestratorModule = await import(pathToFileURL(path.join(tempRoot, 'turn-orchestrator.mjs')).href);
const fixturePath = path.resolve(mobileRoot, '../contracts/ecosystem/assistant-stream.fixture.jsonl');
const fixture = fs.readFileSync(fixturePath, 'utf8').trim().split(/\r?\n/).map(JSON.parse);
const request = {
  message: 'Synthetic question',
  locale: 'vi',
  clientRequestId: '11111111-1111-4111-8111-111111111112',
};

function fixtureWire(scenario) {
  return fixture.filter((row) => row.scenario === scenario).map((row) => row.event === 'comment'
    ? ':heartbeat\r\n\r\n'
    : `event: ${row.event}\r\ndata: ${JSON.stringify(row.data)}\r\n\r\n`).join('');
}

function responseForBytes(bytes, status = 200, headers = {}) {
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
  return new Response(stream, { status, headers });
}

function transportFor(response, extra = {}) {
  return streamModule.createSseTransport({
    fetchImpl: async () => response,
    baseUrl: 'https://api.example.test/api/v1',
    getAccessToken: () => undefined,
    ...extra,
  });
}

async function collect(iterable) {
  const events = [];
  for await (const event of iterable) events.push(event);
  return events;
}

test('the four contract fixture scenarios emit exactly their wire events', async () => {
  for (const scenario of ['normal', 'error-mid-stream', 'cancelled', 'heartbeat']) {
    const expected = fixture
      .filter((row) => row.scenario === scenario && row.event !== 'comment')
      .map((row) => row.event);
    const bytes = new TextEncoder().encode(fixtureWire(scenario));
    const actual = await collect(transportFor(responseForBytes(bytes)).stream(request));
    assert.deepEqual(actual.map((event) => event.type), expected, scenario);
  }
  assert.equal(streamModule.STREAMING_PARITY_VERIFIED, false);
});

test('TextDecoder streaming preserves UTF-8 split between bytes and parses multi-line data', async () => {
  const base = fixtureWire('normal');
  const encoded = new TextEncoder().encode(base);
  const utf8Needle = new TextEncoder().encode('â');
  const utf8Start = Buffer.from(encoded).indexOf(Buffer.from(utf8Needle));
  assert.ok(utf8Start > 0, 'fixture contains a multibyte Vietnamese character');
  const splitAt = utf8Start + 1;
  const chunks = [encoded.slice(0, splitAt), encoded.slice(splitAt)];
  const streamed = new ReadableStream({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(chunk));
      controller.close();
    },
  });
  const events = await collect(transportFor(new Response(streamed)).stream(request));
  assert.equal(events[1].text, 'Câu trả lời mẫu.');
  assert.equal(events[1].text.includes('\uFFFD'), false);

  const meta = fixture.find((row) => row.scenario === 'normal' && row.event === 'meta').data;
  const json = JSON.stringify(meta);
  const splitField = json.indexOf(',"clientRequestId"') + 1;
  const multiline = `event: meta\ndata: ${json.slice(0, splitField)}\ndata: ${json.slice(splitField)}\n\n`;
  const frameParser = new streamModule.SseFrameParser();
  const frames = frameParser.push(multiline);
  assert.equal(frames.length, 1);
  assert.deepEqual(JSON.parse(frames[0].data), meta);
});

test('terminal order rejects frames after done and EOF without a terminal is incomplete', async () => {
  const meta = fixture.find((row) => row.scenario === 'normal' && row.event === 'meta').data;
  const delta = fixture.find((row) => row.scenario === 'normal' && row.event === 'delta').data;
  const done = fixture.find((row) => row.scenario === 'normal' && row.event === 'done').data;
  const wire = (event, data) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

  await assert.rejects(
    collect(transportFor(responseForBytes(new TextEncoder().encode(
      wire('meta', meta) + wire('delta', delta) + wire('done', done) + wire('delta', delta),
    ))).stream(request)),
    (error) => {
      assert.equal(error.code, 'STREAM_EVENT_AFTER_TERMINAL');
      return true;
    },
  );

  await assert.rejects(
    collect(transportFor(responseForBytes(new TextEncoder().encode(wire('meta', meta) + wire('delta', delta)))).stream(request)),
    (error) => {
      assert.equal(error.code, 'STREAM_INCOMPLETE');
      assert.equal(error.connectionLost, true);
      return true;
    },
  );
});

test('error is valid before meta and HTTP failures preserve status and Retry-After', async () => {
  const errorEvent = fixture.find((row) => row.scenario === 'error-mid-stream' && row.event === 'error').data;
  const onlyError = `event: error\ndata: ${JSON.stringify(errorEvent)}\n\n`;
  const events = await collect(transportFor(responseForBytes(new TextEncoder().encode(onlyError))).stream(request));
  assert.deepEqual(events, [errorEvent]);

  for (const [status, code] of [
    [400, 'INVALID_REQUEST'],
    [401, 'UNAUTHORIZED'],
    [403, 'FORBIDDEN'],
    [429, 'RATE_LIMITED'],
    [503, 'ASSISTANT_RLS_UNAVAILABLE'],
  ]) {
    const response = new Response('', {
      status,
      headers: status === 429 ? { 'Retry-After': '23' } : {},
    });
    await assert.rejects(
      collect(transportFor(response).stream(request)),
      (error) => {
        assert.equal(error.status, status);
        assert.equal(error.code, code);
        if (status === 429) assert.equal(error.retryAfter, '23');
        return true;
      },
    );
  }
});

test('unsupported readable bodies fail explicitly and cancellation reuses the request id', async () => {
  const unsupported = transportFor({
    ok: true,
    status: 200,
    headers: new Headers(),
    body: {},
  });
  await assert.rejects(
    collect(unsupported.stream(request)),
    (error) => {
      assert.equal(error.code, 'STREAMING_UNSUPPORTED');
      return true;
    },
  );

  const meta = fixture.find((row) => row.scenario === 'normal' && row.event === 'meta').data;
  const delta = fixture.find((row) => row.scenario === 'normal' && row.event === 'delta').data;
  const activeResponse = new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(
        `event: meta\ndata: ${JSON.stringify(meta)}\n\nevent: delta\ndata: ${JSON.stringify(delta)}\n\n`,
      ));
    },
  }));
  let cancelledId;
  const transport = transportFor(activeResponse, {
    cancelRequest: async (id) => { cancelledId = id; },
  });
  const consuming = collect(transport.stream(request));
  await new Promise((resolve) => setImmediate(resolve));
  await transport.cancel(request.clientRequestId);
  await consuming;
  assert.equal(cancelledId, request.clientRequestId);
});

test('buffered chat adapter emits the same meta, body, citation and terminal contract', async () => {
  const buffered = streamModule.createBufferedTransport(async (received, init) => {
    assert.deepEqual(received, request);
    assert.ok(init.signal instanceof AbortSignal);
    return {
      answer: 'Buffered answer',
      model: 'synthetic-rag',
      degraded: true,
      reasonCode: 'NO_MATCH',
      locale: 'vi',
      citations: [{ id: 'cite-buffered', sourceId: 'source-buffered' }],
      conversationId: 'conversation-buffered',
      messageId: 'message-buffered',
    };
  });
  const events = await collect(buffered.stream(request));
  assert.deepEqual(events.map((event) => event.type), ['meta', 'delta', 'citation', 'done']);
  assert.equal(events[0].clientRequestId, request.clientRequestId);
  assert.equal(events[0].conversationId, 'conversation-buffered');
  assert.equal(events[1].text, 'Buffered answer');
  assert.deepEqual(events[1].sourceIds, ['source-buffered']);
  assert.equal(events[2].citation.id, 'cite-buffered');
  assert.equal(events[3].terminalStatus, 'COMPLETED');
  assert.equal(events[3].degraded, true);

  const failed = streamModule.createBufferedTransport(async () => {
    throw { code: 'RATE_LIMITED', status: 429 };
  });
  assert.deepEqual(await collect(failed.stream(request)), [
    { type: 'error', code: 'RATE_LIMITED', retryable: true },
  ]);
});

test('assistant reducer covers lifecycle, replace, citation, duplicate, cancellation and retry intent', () => {
  const { assistantStreamReducer: reduce, initialAssistantStreamState: idle, selectAssistantStreamView } = stateModule;
  let state = reduce(idle, { type: 'send', clientRequestId: request.clientRequestId });
  assert.equal(state.phase, 'sending');
  assert.equal(state.clientRequestId, request.clientRequestId);

  const meta = fixture.find((row) => row.scenario === 'normal' && row.event === 'meta').data;
  const delta = fixture.find((row) => row.scenario === 'normal' && row.event === 'delta').data;
  const citation = fixture.find((row) => row.scenario === 'normal' && row.event === 'citation').data;
  const done = fixture.find((row) => row.scenario === 'normal' && row.event === 'done').data;
  state = reduce(state, { type: 'event', event: meta });
  assert.equal(state.phase, 'streaming');
  state = reduce(state, { type: 'event', event: delta });
  assert.equal(state.answer, delta.text);
  const beforeDuplicate = state;
  state = reduce(state, { type: 'event', event: delta });
  assert.equal(state, beforeDuplicate);

  state = reduce(state, { type: 'event', event: { type: 'replace', text: 'replaced', sourceIds: ['src-synth-02'], reasonCode: 'FILTERED' } });
  assert.equal(state.answer, 'replaced');
  assert.deepEqual(state.sourceIds, ['src-synth-01', 'src-synth-02']);
  state = reduce(state, { type: 'event', event: citation });
  assert.equal(state.citations.length, 1);
  state = reduce(state, { type: 'event', event: done });
  assert.equal(state.phase, 'complete');
  assert.equal(state.degraded, false);
  assert.equal(selectAssistantStreamView(state).canResubmitSameRequest, false);
  assert.equal(reduce(state, { type: 'cancel' }), state);

  let interrupted = reduce(idle, { type: 'send', clientRequestId: request.clientRequestId });
  interrupted = reduce(interrupted, { type: 'connectionLost' });
  assert.equal(interrupted.phase, 'error');
  assert.equal(selectAssistantStreamView(interrupted).canResubmitSameRequest, true);
  assert.equal(interrupted.clientRequestId, request.clientRequestId);
  let unauthorized = reduce(idle, { type: 'send', clientRequestId: request.clientRequestId });
  unauthorized = reduce(unauthorized, { type: 'event', event: { type: 'error', code: 'UNAUTHORIZED', retryable: false } });
  assert.equal(selectAssistantStreamView(unauthorized).canResubmitSameRequest, false);
  let terminalStreamError = reduce(idle, { type: 'send', clientRequestId: request.clientRequestId });
  terminalStreamError = reduce(terminalStreamError, {
    type: 'event',
    event: { type: 'error', code: 'STREAM_INCOMPLETE', retryable: true },
  });
  assert.equal(selectAssistantStreamView(terminalStreamError).canResubmitSameRequest, false);

  let cancelled = reduce(idle, { type: 'send', clientRequestId: request.clientRequestId });
  cancelled = reduce(cancelled, { type: 'cancel' });
  assert.equal(cancelled.phase, 'cancelled');
  assert.equal(cancelled.terminalStatus, 'CANCELLED');
  const background = reduce(reduce(cancelled, { type: 'background' }), { type: 'unmount' });
  assert.equal(background.backgrounded, true);
  assert.equal(background.mounted, false);
  assert.equal(reduce(background, { type: 'mount' }).mounted, true);
  assert.equal(reduce(background, { type: 'foreground' }).backgrounded, false);
});

test('the shared validator rejects repeated or decreasing delta sequences', () => {
  const validator = new streamModule.AssistantEventValidator();
  const metaData = fixture.find((row) => row.scenario === 'normal' && row.event === 'meta').data;
  validator.accept(metaData);
  validator.accept({ type: 'delta', sequence: 3, text: 'a', sourceIds: [] });
  for (const sequence of [3, 1]) {
    assert.throws(
      () => validator.accept({ type: 'delta', sequence, text: 'b', sourceIds: [] }),
      (error) => error.code === 'STREAM_EVENT_ORDER_INVALID',
    );
  }
  validator.accept({ type: 'delta', sequence: 4, text: 'c', sourceIds: [] });
});

// ---- turn orchestrator ------------------------------------------------------

const tick = () => new Promise((resolve) => setImmediate(resolve));
const metaEvent = fixture.find((row) => row.scenario === 'normal' && row.event === 'meta').data;
const doneEvent = fixture.find((row) => row.scenario === 'normal' && row.event === 'done').data;
const deltaEvent = (sequence, text = 'Một phần ') => ({ type: 'delta', sequence, text, sourceIds: [] });
const turnInput = { message: 'Xin chào trợ lý', locale: 'vi' };
const reply = {
  answer: 'Câu trả lời đã chốt', model: 'synthetic-rag', degraded: false, reasonCode: 'ANSWERED', locale: 'vi',
  citations: [{ id: 'cite-1', sourceId: 'src-1' }], conversationId: 'conv-1', messageId: 'msg-1',
};
const httpError = (status, code) => Object.assign(new Error(code ?? 'http'), { status, code });
const lostError = () => new streamModule.AssistantStreamError('STREAM_CONNECTION_LOST', { retryable: true, connectionLost: true });
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

/** Discrete-event clock: time only moves when a test jumps to the next timer. */
function virtualClock() {
  let now = 0;
  let sequence = 0;
  const timers = new Map();
  return {
    now: () => now,
    setTimeout(callback, ms) { sequence += 1; timers.set(sequence, { at: now + ms, callback }); return sequence; },
    clearTimeout(id) { timers.delete(id); },
    advanceToNext() {
      const next = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) return false;
      timers.delete(next[0]);
      now = next[1].at;
      next[1].callback();
      return true;
    },
  };
}

async function drive(promise, clock) {
  let finished = false;
  promise.then(() => { finished = true; }, () => { finished = true; });
  for (let guard = 0; !finished && guard < 200; guard += 1) {
    await tick();
    if (!finished) clock.advanceToNext();
  }
  return promise;
}

function controlledStream() {
  const queue = [];
  let wake;
  let signal;
  const push = (item) => { queue.push(item); wake?.(); wake = undefined; };
  return {
    stream(_request, options) {
      signal = options.signal;
      signal.addEventListener('abort', () => push({ end: true }), { once: true });
      return (async function* () {
        for (;;) {
          if (queue.length === 0) await new Promise((resolve) => { wake = resolve; });
          const item = queue.shift();
          if (!item) continue;
          if (item.end) return;
          if (item.error) throw item.error;
          yield item.event;
        }
      }());
    },
    push: (event) => push({ event }),
    fail: (error) => push({ error }),
    get aborted() { return signal?.aborted === true; },
  };
}

function throwingStream(error) {
  return () => (async function* () { throw error; }());
}

function turnHarness({ stream, chat, cancelRequest, isTurnVisible } = {}) {
  const clock = virtualClock();
  let state = stateModule.initialAssistantStreamState;
  const calls = { stream: [], chat: [], cancel: [], actions: 0 };
  const settled = [];
  const orchestrator = orchestratorModule.createTurnOrchestrator({
    clock,
    stream: (request, options) => {
      calls.stream.push({ id: request.clientRequestId, at: clock.now(), signal: options.signal });
      return stream(request, options);
    },
    chat: async (request, init) => {
      calls.chat.push({ id: request.clientRequestId, at: clock.now(), signal: init.signal });
      if (!chat) throw httpError(503);
      return chat(request, init);
    },
    cancelRequest: async (id) => { calls.cancel.push(id); return cancelRequest ? cancelRequest(id) : undefined; },
    dispatch: (action) => { calls.actions += 1; state = stateModule.assistantStreamReducer(state, action); },
    isTurnVisible,
    onSettled: (outcome) => settled.push(outcome),
  });
  return { orchestrator, clock, calls, settled, get state() { return state; } };
}

test('a streamed turn completes under a fresh UUID and sends the same id on every call', async () => {
  const wire = controlledStream();
  const harness = turnHarness({ stream: wire.stream });
  const sending = harness.orchestrator.send(turnInput);
  const id = harness.calls.stream[0].id;
  assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  for (const event of [metaEvent, deltaEvent(0), doneEvent]) wire.push(event);
  const outcome = await sending;
  assert.deepEqual(outcome, { status: 'completed', clientRequestId: id, resubmittable: false });
  assert.equal(harness.state.phase, 'complete');
  assert.equal(harness.state.answer, 'Một phần ');
  assert.equal(harness.orchestrator.isBusy(), false);
  assert.equal(harness.settled.length, 1);
});

test('empty, oversize and concurrent sends never reach the transport', async () => {
  const wire = controlledStream();
  const harness = turnHarness({ stream: wire.stream });
  assert.deepEqual(await harness.orchestrator.send({ ...turnInput, message: '   ' }), { status: 'empty' });
  assert.deepEqual(
    await harness.orchestrator.send({ ...turnInput, message: 'x'.repeat(2001) }),
    { status: 'too-long' },
  );
  assert.equal(harness.calls.actions, 0);
  const first = harness.orchestrator.send(turnInput);
  assert.deepEqual(await harness.orchestrator.send(turnInput), { status: 'busy' });
  assert.equal(harness.calls.stream.length, 1);
  for (const event of [metaEvent, deltaEvent(0), doneEvent]) wire.push(event);
  assert.equal((await first).status, 'completed');
});

test('a dropped stream replays through JSON with the same id and keeps the answer', async () => {
  const wire = controlledStream();
  const harness = turnHarness({ stream: wire.stream, chat: async () => reply });
  const sending = harness.orchestrator.send(turnInput);
  wire.push(metaEvent);
  wire.push(deltaEvent(0));
  wire.fail(lostError());
  const outcome = await drive(sending, harness.clock);
  assert.equal(outcome.status, 'reconciled');
  assert.equal(harness.calls.chat.length, 1);
  assert.equal(harness.calls.chat[0].id, harness.calls.stream[0].id);
  assert.equal(harness.state.phase, 'complete');
  assert.equal(harness.state.answer, reply.answer, 'the partial text is replaced, not appended');
  assert.deepEqual(harness.state.citations, reply.citations);
});

test('an ordering violation is reconciled instead of surfacing a broken answer', async () => {
  const harness = turnHarness({
    stream: throwingStream(new streamModule.AssistantStreamError('STREAM_EVENT_ORDER_INVALID')),
    chat: async () => reply,
  });
  const outcome = await drive(harness.orchestrator.send(turnInput), harness.clock);
  assert.equal(outcome.status, 'reconciled');
  assert.equal(harness.state.answer, reply.answer);
});

test('reconcile polls TURN_IN_PROGRESS on the 250ms ladder and stops after four attempts', async () => {
  let attempts = 0;
  const poll = turnHarness({
    stream: throwingStream(lostError()),
    chat: async () => {
      attempts += 1;
      if (attempts < 3) throw httpError(409, 'TURN_IN_PROGRESS');
      return reply;
    },
  });
  assert.equal((await drive(poll.orchestrator.send(turnInput), poll.clock)).status, 'reconciled');
  assert.deepEqual(poll.calls.chat.map((call) => call.at), [0, 250, 750]);

  const exhausted = turnHarness({
    stream: throwingStream(lostError()),
    chat: async () => { throw httpError(409, 'TURN_IN_PROGRESS'); },
  });
  const outcome = await drive(exhausted.orchestrator.send(turnInput), exhausted.clock);
  assert.equal(outcome.status, 'failed');
  assert.equal(outcome.resubmittable, true);
  assert.deepEqual(exhausted.calls.chat.map((call) => call.at), [0, 250, 750, 1500]);
  assert.equal(exhausted.state.phase, 'error');
  assert.equal(stateModule.selectAssistantStreamView(exhausted.state).canResubmitSameRequest, true);

  const again = await drive(exhausted.orchestrator.retry(), exhausted.clock);
  assert.equal(again.clientRequestId, outcome.clientRequestId, 'retry keeps the original intent id');
  assert.equal(exhausted.calls.stream[1].id, exhausted.calls.stream[0].id);
});

test('a hung JSON replay is cut at the 30s budget and the turn stays resubmittable', async () => {
  const harness = turnHarness({
    stream: throwingStream(lostError()),
    chat: () => new Promise(() => undefined),
  });
  const outcome = await drive(harness.orchestrator.send(turnInput), harness.clock);
  assert.equal(outcome.resubmittable, true);
  assert.equal(harness.clock.now(), 30_000);
  assert.equal(harness.calls.chat.length, 1);
  assert.equal(harness.calls.chat[0].signal.aborted, true);
});

test('definitive failures are shown once; 401 still replays so the JSON client can refresh', async () => {
  const limited = turnHarness({
    stream: throwingStream(new streamModule.AssistantStreamError('RATE_LIMIT_EXCEEDED', { status: 429, retryable: true })),
    chat: async () => reply,
  });
  assert.equal((await limited.orchestrator.send(turnInput)).status, 'failed');
  assert.equal(limited.calls.chat.length, 0);
  assert.deepEqual(limited.state.error, { code: 'RATE_LIMIT_EXCEEDED', retryable: true });

  const expired = turnHarness({
    stream: throwingStream(new streamModule.AssistantStreamError('UNAUTHORIZED', { status: 401 })),
    chat: async () => reply,
  });
  assert.equal((await drive(expired.orchestrator.send(turnInput), expired.clock)).status, 'reconciled');

  const gone = turnHarness({
    stream: throwingStream(lostError()),
    chat: async () => { throw httpError(409, 'FAILED_AMBIGUOUS'); },
  });
  const outcome = await drive(gone.orchestrator.send(turnInput), gone.clock);
  assert.equal(outcome.resubmittable, false);
  assert.equal(stateModule.selectAssistantStreamView(gone.state).canResubmitSameRequest, false);
  assert.equal(gone.state.error.code, 'FAILED_AMBIGUOUS');
});

test('a fenced cancellation event ends the turn without a JSON replay', async () => {
  const wire = controlledStream();
  const harness = turnHarness({ stream: wire.stream, chat: async () => reply });
  const sending = harness.orchestrator.send(turnInput);
  wire.push(metaEvent);
  wire.push({ type: 'error', code: 'TURN_CANCELLED', retryable: false });
  assert.equal((await sending).status, 'cancelled');
  assert.equal(harness.state.phase, 'cancelled');
  assert.equal(harness.calls.chat.length, 0);
});

test('cancel posts the same id, stops the stream and frees the send lock', async () => {
  const wire = controlledStream();
  const harness = turnHarness({ stream: wire.stream });
  const sending = harness.orchestrator.send(turnInput);
  wire.push(metaEvent);
  wire.push(deltaEvent(0));
  await tick();
  assert.deepEqual(await harness.orchestrator.cancel(), { status: 'cancelled', confirmed: true });
  assert.deepEqual(harness.calls.cancel, [harness.calls.stream[0].id]);
  assert.equal(wire.aborted, true);
  assert.equal(harness.state.phase, 'cancelled');
  assert.equal((await sending).status, 'cancelled');
  assert.equal(harness.orchestrator.isBusy(), false);
});

test('cancel 409 replays the committed answer instead of overwriting it as cancelled', async () => {
  const wire = controlledStream();
  const harness = turnHarness({
    stream: wire.stream,
    chat: async () => reply,
    cancelRequest: async () => { throw httpError(409, 'TURN_TERMINAL_RACE'); },
  });
  const sending = harness.orchestrator.send(turnInput);
  wire.push(metaEvent);
  wire.push(deltaEvent(0));
  await tick();
  assert.deepEqual(await harness.orchestrator.cancel(), { status: 'reconciled' });
  assert.equal(harness.state.phase, 'complete');
  assert.equal(harness.state.answer, reply.answer);
  assert.equal(harness.calls.chat[0].id, harness.calls.stream[0].id);
  assert.equal(wire.aborted, true);
  assert.equal((await sending).status, 'reconciled');
  assert.equal(harness.settled.length, 1);
});

test('cancel 409 with a failing replay keeps the stream alive for its own done frame', async () => {
  const wire = controlledStream();
  const harness = turnHarness({
    stream: wire.stream,
    cancelRequest: async () => { throw httpError(409); },
  });
  const sending = harness.orchestrator.send(turnInput);
  wire.push(metaEvent);
  wire.push(deltaEvent(0));
  await tick();
  assert.deepEqual(await drive(harness.orchestrator.cancel(), harness.clock), { status: 'cas-pending' });
  assert.equal(wire.aborted, false);
  assert.equal(harness.state.phase, 'streaming');
  wire.push(doneEvent);
  assert.equal((await sending).status, 'completed');
  assert.equal(harness.state.phase, 'complete');
});

test('a hung cancel is bounded at eight seconds and still stops the turn locally', async () => {
  const wire = controlledStream();
  const harness = turnHarness({ stream: wire.stream, cancelRequest: () => new Promise(() => undefined) });
  const sending = harness.orchestrator.send(turnInput);
  wire.push(metaEvent);
  await tick();
  const result = await drive(harness.orchestrator.cancel(), harness.clock);
  assert.deepEqual(result, { status: 'cancelled', confirmed: false });
  assert.equal(harness.clock.now(), 8_000);
  assert.equal(harness.state.phase, 'cancelled');
  assert.equal((await sending).status, 'cancelled');
});

test('a done frame that wins the race against a slow cancel is never turned into cancelled', async () => {
  const wire = controlledStream();
  const pending = deferred();
  const harness = turnHarness({ stream: wire.stream, cancelRequest: () => pending.promise });
  const sending = harness.orchestrator.send(turnInput);
  wire.push(metaEvent);
  wire.push(deltaEvent(0));
  await tick();
  const cancelling = harness.orchestrator.cancel();
  wire.push(doneEvent);
  assert.equal((await sending).status, 'completed');
  pending.resolve();
  assert.deepEqual(await cancelling, { status: 'idle' });
  assert.equal(harness.state.phase, 'complete');
});

test('an orphaned lock is released once, the stale turn is cancelled and the new send proceeds', async () => {
  const streams = [controlledStream(), controlledStream()];
  let visible = true;
  const harness = turnHarness({
    stream: (request, options) => streams[harness.calls.stream.length - 1].stream(request, options),
    isTurnVisible: () => visible,
  });
  const first = harness.orchestrator.send(turnInput);
  assert.deepEqual(await harness.orchestrator.send(turnInput), { status: 'busy' });
  visible = false;
  const second = harness.orchestrator.send({ ...turnInput, message: 'Câu hỏi mới' });
  assert.equal(harness.calls.stream.length, 2);
  assert.notEqual(harness.calls.stream[1].id, harness.calls.stream[0].id);
  assert.equal(streams[0].aborted, true);
  assert.equal((await first).status, 'aborted');
  await tick();
  assert.deepEqual(harness.calls.cancel, [harness.calls.stream[0].id]);
  visible = true;
  for (const event of [metaEvent, deltaEvent(0), doneEvent]) streams[1].push(event);
  assert.equal((await second).status, 'completed');
});

test('dispose on sign-out aborts the stream, cancels server-side and emits nothing afterwards', async () => {
  const wire = controlledStream();
  const harness = turnHarness({ stream: wire.stream });
  const sending = harness.orchestrator.send(turnInput);
  wire.push(metaEvent);
  await tick();
  const dispatched = harness.calls.actions;
  harness.orchestrator.dispose();
  wire.push(deltaEvent(0));
  assert.equal((await sending).status, 'aborted');
  await tick();
  assert.equal(harness.calls.actions, dispatched);
  assert.equal(wire.aborted, true);
  assert.deepEqual(harness.calls.cancel, [harness.calls.stream[0].id]);
  assert.equal(harness.orchestrator.isBusy(), false);
});
