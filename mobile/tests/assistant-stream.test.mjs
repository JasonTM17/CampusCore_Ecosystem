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

for (const [sourceName, outputName] of [
  ['assistant-stream.ts', 'assistant-stream.mjs'],
  ['assistant-stream-state.ts', 'assistant-stream-state.mjs'],
]) {
  const source = fs.readFileSync(path.join(mobileRoot, 'src/api', sourceName), 'utf8');
  let { outputText } = ts.transpileModule(source, {
    ...compilerOptions,
    fileName: sourceName,
  });
  if (sourceName === 'assistant-stream-state.ts') {
    outputText = outputText.replace("from './assistant-stream'", "from './assistant-stream.mjs'");
  }
  fs.writeFileSync(path.join(tempRoot, outputName), outputText);
}

const streamModule = await import(pathToFileURL(path.join(tempRoot, 'assistant-stream.mjs')).href);
const stateModule = await import(pathToFileURL(path.join(tempRoot, 'assistant-stream-state.mjs')).href);
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
