import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import { fileURLToPath, pathToFileURL } from 'node:url';

const mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'campus-assistant-xhr-'));
for (const file of [
  'api/assistant-stream.ts',
  'api/assistant-limits.ts',
  'api/assistant-xhr-transport.ts',
]) {
  const source = fs.readFileSync(path.join(mobileRoot, 'src', file), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  });
  fs.writeFileSync(
    path.join(tempRoot, path.basename(file).replace('.ts', '.mjs')),
    outputText.replace(/from '\.\/([\w-]+)'/g, "from './$1.mjs'"),
  );
}
const load = (name) => import(pathToFileURL(path.join(tempRoot, `${name}.mjs`)).href);
const streamModule = await load('assistant-stream');
const limits = await load('assistant-limits');
const { createXhrSseTransport, parseAssistantTransportKind, selectAssistantTransport } = await load('assistant-xhr-transport');

const fixture = fs.readFileSync(
  path.resolve(mobileRoot, '../contracts/ecosystem/assistant-stream.fixture.jsonl'),
  'utf8',
).trim().split(/\r?\n/).map(JSON.parse);
const request = { message: 'Câu hỏi mẫu', locale: 'vi', clientRequestId: '11111111-1111-4111-8111-111111111112' };
const row = (scenario, event) => fixture.find((item) => item.scenario === scenario && item.event === event).data;
const frame = (event, data) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
const meta = row('normal', 'meta');
const delta = (sequence, text = 'chữ ') => ({ type: 'delta', sequence, text, sourceIds: [] });
const done = row('normal', 'done');

function fixtureWire(scenario) {
  return fixture.filter((item) => item.scenario === scenario).map((item) => item.event === 'comment'
    ? ':heartbeat\r\n\r\n'
    : `event: ${item.event}\r\ndata: ${JSON.stringify(item.data)}\r\n\r\n`).join('');
}

/** Fake XHR that mimics React Native: native progressive UTF-8 decode, cumulative responseText. */
class FakeXhr {
  constructor() {
    Object.assign(this, { readyState: 0, status: 0, responseText: '', timeout: -1, headers: {}, requestHeaders: {}, abortCalls: 0 });
    this.decoder = new TextDecoder();
    for (const name of ['onprogress', 'onload', 'onerror', 'onabort', 'ontimeout']) this[name] = null;
  }
  open(method, url) { Object.assign(this, { method, url, readyState: 1 }); }
  setRequestHeader(name, value) { this.requestHeaders[name] = value; }
  getResponseHeader(name) { return this.headers[name.toLowerCase()] ?? null; }
  send(body) { this.body = body; }
  abort() { this.abortCalls += 1; this.readyState = 0; }
  respond(status = 200, headers = {}) { Object.assign(this, { status, readyState: 2, headers }); }
  text(value) { this.responseText += value; this.readyState = 3; this.onprogress?.(); }
  bytes(value) { this.text(this.decoder.decode(value, { stream: true })); }
  complete() { this.readyState = 4; this.onload?.(); }
}

function fakeClock() {
  let now = 0;
  let sequence = 0;
  const timers = new Map();
  return {
    now: () => now,
    setTimeout(callback, ms) { sequence += 1; timers.set(sequence, { at: now + ms, callback }); return sequence; },
    clearTimeout(id) { timers.delete(id); },
    pending: () => timers.size,
    advance(ms) {
      const target = now + ms;
      for (;;) {
        const next = [...timers].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        timers.delete(next[0]);
        now = next[1].at;
        next[1].callback();
      }
      now = target;
    },
  };
}

function harness(extra = {}) {
  const clock = fakeClock();
  const created = [];
  const cancelled = [];
  const transport = createXhrSseTransport({
    baseUrl: 'https://api.example.test/api/v1/',
    getAccessToken: () => 'synthetic-token',
    cancelRequest: async (id) => { cancelled.push(id); },
    createXhr: () => { const xhr = new FakeXhr(); created.push(xhr); return xhr; },
    clock,
    ...extra,
  });
  const run = (signal, req = request) => {
    const events = [];
    const settled = (async () => {
      try {
        for await (const event of transport.stream(req, { signal })) events.push(event);
        return { events };
      } catch (error) {
        return { events, error };
      }
    })();
    return { events, settled, xhr: created.at(-1) };
  };
  return { clock, created, cancelled, transport, run };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

/** A session lane whose epoch rotates and whose shared refresh swaps the token once. */
function sessionHarness({ token = 'stale-token', epoch = 1, refreshResult = true, ...extra } = {}) {
  const state = { token, epoch, refreshCalls: 0, refreshEpochs: [], refreshGate: undefined, refreshResult };
  const session = {
    epoch: () => state.epoch,
    refresh: async (requestEpoch) => {
      state.refreshCalls += 1;
      state.refreshEpochs.push(requestEpoch);
      await state.refreshGate;
      if (state.refreshResult) state.token = 'rotated-token';
      return state.refreshResult;
    },
  };
  const rig = harness({ session, getAccessToken: () => state.token, ...extra });
  return { state, session, ...rig };
}

test('request carries bearer auth, JSON body and no watchdog leak after the terminal frame', async () => {
  const { run, clock } = harness();
  const { xhr, settled } = run();
  assert.equal(xhr.method, 'POST');
  assert.equal(xhr.url, 'https://api.example.test/api/v1/assistant/chat/stream');
  assert.equal(xhr.requestHeaders.Authorization, 'Bearer synthetic-token');
  assert.equal(xhr.requestHeaders.Accept, 'text/event-stream');
  assert.deepEqual(JSON.parse(xhr.body), request);
  xhr.respond();
  xhr.text(frame('meta', meta) + frame('delta', delta(0)) + frame('done', done));
  const result = await settled;
  assert.equal(result.error, undefined);
  assert.deepEqual(result.events.map((event) => event.type), ['meta', 'delta', 'done']);
  assert.equal(clock.pending(), 0);
  assert.equal(xhr.abortCalls, 1, 'the socket is released once the terminal frame is read');
});

test('contract scenarios survive 3-byte chunks that split frames and Vietnamese UTF-8', async () => {
  for (const scenario of ['normal', 'error-mid-stream', 'cancelled', 'heartbeat']) {
    const expected = fixture.filter((item) => item.scenario === scenario && item.event !== 'comment').map((item) => item.event);
    const { run } = harness();
    const scenarioRequest = { ...request, clientRequestId: row(scenario, 'meta').clientRequestId };
    const { xhr, settled } = run(undefined, scenarioRequest);
    xhr.respond();
    const bytes = new TextEncoder().encode(fixtureWire(scenario));
    for (let index = 0; index < bytes.length; index += 3) {
      xhr.bytes(bytes.slice(index, index + 3));
      await tick();
    }
    xhr.complete();
    const result = await settled;
    assert.equal(result.error, undefined, scenario);
    assert.deepEqual(result.events.map((event) => event.type), expected, scenario);
    if (scenario === 'normal') {
      assert.equal(result.events[1].text, 'Câu trả lời mẫu.');
      assert.equal(result.events.every((event) => !JSON.stringify(event).includes('�')), true);
    }
  }
});

test('a text split inside a surrogate pair and CRLF terminators reassemble without loss', async () => {
  const { run } = harness();
  const { xhr, settled } = run();
  xhr.respond();
  const wire = (frame('meta', meta) + frame('delta', delta(0, 'ok 😀 xong')) + frame('done', done)).replace(/\n/g, '\r\n');
  const cut = wire.indexOf('\uD83D') + 1;
  xhr.text(wire.slice(0, cut));
  xhr.text(wire.slice(cut, cut + 40));
  xhr.text(wire.slice(cut + 40));
  const result = await settled;
  assert.equal(result.events[1].text, 'ok 😀 xong');
  assert.equal(result.events[2].type, 'done');
});

test('idle watchdog ignores meta and heartbeats, resets only on useful content', async () => {
  const { run, clock } = harness();
  const { xhr, settled } = run();
  xhr.respond();
  xhr.text(frame('meta', meta));
  for (let beat = 0; beat < 4; beat += 1) {
    clock.advance(10_000);
    xhr.text(':heartbeat\n\n');
  }
  clock.advance(5_000);
  const result = await settled;
  assert.equal(result.error.code, 'STREAM_IDLE_TIMEOUT');
  assert.equal(result.error.connectionLost, true);
  assert.equal(limits.ASSISTANT_STREAM_IDLE_TIMEOUT_MS, 45_000);
  assert.equal(xhr.abortCalls, 1);
  assert.equal(clock.pending(), 0);

  const second = harness();
  const live = second.run();
  live.xhr.respond();
  live.xhr.text(frame('meta', meta));
  second.clock.advance(40_000);
  live.xhr.text(frame('delta', delta(0)));
  second.clock.advance(44_000);
  assert.equal(second.clock.pending(), 2, 'a delta re-armed the idle window');
  second.clock.advance(1_000);
  assert.equal((await live.settled).error.code, 'STREAM_IDLE_TIMEOUT');
});

test('total watchdog stops a stream that keeps producing deltas', async () => {
  const { run, clock } = harness();
  const { xhr, settled } = run();
  xhr.respond();
  xhr.text(frame('meta', meta));
  for (let sequence = 0; sequence < 3; sequence += 1) {
    clock.advance(30_000);
    xhr.text(frame('delta', delta(sequence)));
  }
  clock.advance(30_000);
  const result = await settled;
  assert.equal(result.error.code, 'STREAM_TOTAL_TIMEOUT');
  assert.equal(result.events.length, 4);
  assert.equal(limits.ASSISTANT_STREAM_TOTAL_TIMEOUT_MS, 120_000);
  assert.equal(clock.pending(), 0);
});

test('caller abort ends quietly and a pre-aborted signal never opens a request', async () => {
  const { run, created } = harness();
  const controller = new AbortController();
  const { xhr, settled } = run(controller.signal);
  xhr.respond();
  xhr.text(frame('meta', meta));
  controller.abort();
  const result = await settled;
  assert.equal(result.error, undefined);
  assert.equal(xhr.abortCalls, 1);

  const before = created.length;
  const pre = new AbortController();
  pre.abort();
  const second = run(pre.signal);
  assert.equal((await second.settled).events.length, 0);
  assert.equal(created.length, before);
});

test('HTTP failures keep status, code and Retry-After and never parse the body as SSE', async () => {
  for (const [status, body, code, retryable] of [
    [429, '{"code":"RATE_LIMIT_EXCEEDED"}', 'RATE_LIMIT_EXCEEDED', true],
    [401, '', 'UNAUTHORIZED', false],
    [503, 'upstream down', 'ASSISTANT_RLS_UNAVAILABLE', true],
  ]) {
    const { run } = harness();
    const { xhr, settled } = run();
    xhr.respond(status, { 'retry-after': '23' });
    xhr.text(body);
    xhr.complete();
    const { error, events } = await settled;
    assert.equal(error.code, code);
    assert.equal(error.status, status);
    assert.equal(error.retryable, retryable);
    assert.equal(error.retryAfter, '23');
    assert.equal(events.length, 0);
  }
});

test('ordering violations raise after the valid prefix; EOF and socket loss mark the connection lost', async () => {
  const cases = [
    ['delta before meta', frame('delta', delta(0)), 'STREAM_EVENT_ORDER_INVALID', 0],
    ['repeated sequence', frame('meta', meta) + frame('delta', delta(1)) + frame('delta', delta(1)), 'STREAM_EVENT_ORDER_INVALID', 2],
    ['decreasing sequence', frame('meta', meta) + frame('delta', delta(5)) + frame('delta', delta(2)), 'STREAM_EVENT_ORDER_INVALID', 2],
    ['frame after done', frame('meta', meta) + frame('delta', delta(0)) + frame('done', done) + frame('delta', delta(1)), 'STREAM_EVENT_AFTER_TERMINAL', 3],
    ['malformed json', 'event: meta\ndata: {nope\n\n', 'STREAM_INVALID_JSON', 0],
  ];
  for (const [label, wire, code, delivered] of cases) {
    const { run } = harness();
    const { xhr, settled } = run();
    xhr.respond();
    xhr.text(wire);
    xhr.complete();
    const result = await settled;
    assert.equal(result.error?.code, code, label);
    assert.equal(result.events.length, delivered, label);
  }

  const eof = harness();
  const ended = eof.run();
  ended.xhr.respond();
  ended.xhr.text(frame('meta', meta) + frame('delta', delta(0)));
  ended.xhr.complete();
  const incomplete = (await ended.settled).error;
  assert.equal(incomplete.code, 'STREAM_INCOMPLETE');
  assert.equal(incomplete.connectionLost, true);

  const dropped = harness();
  const lostRun = dropped.run();
  lostRun.xhr.respond();
  lostRun.xhr.onerror();
  assert.equal((await lostRun.settled).error.code, 'STREAM_CONNECTION_LOST');
});

test('response memory is bounded and a shrinking responseText is rejected', async () => {
  const big = harness({ maxResponseChars: 64 });
  const bigRun = big.run();
  bigRun.xhr.respond();
  bigRun.xhr.text('x'.repeat(65));
  const tooLarge = (await bigRun.settled).error;
  assert.equal(tooLarge.code, 'STREAM_RESPONSE_TOO_LARGE');
  assert.equal(bigRun.xhr.abortCalls, 1);

  const reset = harness();
  const resetRun = reset.run();
  resetRun.xhr.respond();
  resetRun.xhr.text(frame('meta', meta));
  resetRun.xhr.responseText = '';
  resetRun.xhr.onprogress();
  assert.equal((await resetRun.settled).error.code, 'STREAM_RESPONSE_RESET');
});

test('cancel aborts the live stream locally and forwards the same request id', async () => {
  const { run, transport, cancelled } = harness();
  const { xhr, settled } = run();
  xhr.respond();
  xhr.text(frame('meta', meta) + frame('delta', delta(0)));
  await transport.cancel(request.clientRequestId);
  const result = await settled;
  assert.deepEqual(cancelled, [request.clientRequestId]);
  assert.equal(result.error, undefined);
  assert.equal(xhr.abortCalls, 1);
});

test('a pre-frame 401 joins the session refresh once and replays the same logical request', async () => {
  const { state, run, created } = sessionHarness();
  const { settled } = run();
  const first = created[0];
  assert.equal(first.requestHeaders.Authorization, 'Bearer stale-token');
  first.respond(401);
  first.complete();
  for (let flush = 0; flush < 3; flush += 1) await tick();
  const second = created[1];
  assert.ok(second, 'one retry attempt is sent after the shared refresh');
  assert.equal(second.requestHeaders.Authorization, 'Bearer rotated-token');
  assert.equal(second.body, first.body, 'the retry is the same logical request');
  assert.equal(second.requestHeaders['X-Request-Id'], first.requestHeaders['X-Request-Id']);
  second.respond();
  second.text(frame('meta', meta) + frame('delta', delta(0)) + frame('done', done));
  const result = await settled;
  assert.equal(result.error, undefined);
  assert.deepEqual(result.events.map((event) => event.type), ['meta', 'delta', 'done']);
  assert.equal(state.refreshCalls, 1);
  assert.deepEqual(state.refreshEpochs, [1], 'the retry joins the refresh for the epoch it started under');
});

test('a repeated 401 stays a single retry and surfaces the original failure', async () => {
  const { state, run, created } = sessionHarness();
  const { settled } = run();
  created[0].respond(401);
  created[0].complete();
  for (let flush = 0; flush < 3; flush += 1) await tick();
  const second = created[1];
  assert.ok(second, 'exactly one retry attempt');
  second.respond(401, { 'retry-after': '4' });
  second.complete();
  const result = await settled;
  assert.equal(result.error.code, 'UNAUTHORIZED');
  assert.equal(result.error.status, 401);
  assert.equal(result.error.retryAfter, '4');
  assert.equal(created.length, 2, 'exactly one retry was sent');
  assert.equal(state.refreshCalls, 1);
});

test('a failed refresh keeps the first 401 and sends nothing further', async () => {
  const { state, run, created } = sessionHarness({ refreshResult: false });
  const { settled } = run();
  created[0].respond(401);
  created[0].complete();
  const result = await settled;
  assert.equal(result.error.code, 'UNAUTHORIZED');
  assert.equal(result.error.status, 401);
  assert.equal(created.length, 1);
  assert.equal(state.refreshCalls, 1);
});

test('an epoch switch during the refresh wait aborts instead of replaying into the new session', async () => {
  const gate = deferred();
  const { state, run, created } = sessionHarness();
  state.refreshGate = gate.promise;
  const { settled } = run();
  created[0].respond(401);
  created[0].complete();
  for (let flush = 0; flush < 3; flush += 1) await tick();
  assert.equal(state.refreshCalls, 1);
  state.epoch = 2;
  gate.resolve();
  const result = await settled;
  assert.equal(created.length, 1, 'no replay is sent under the replacement session');
  assert.equal(result.error, undefined);
  assert.deepEqual(result.events.at(-1), { type: 'error', code: 'SESSION_CHANGED', retryable: false });
});

test('frames arriving after an epoch switch never leak into the replacement session', async () => {
  const { state, run } = sessionHarness();
  const { xhr, settled } = run();
  xhr.respond();
  xhr.text(frame('meta', meta) + frame('delta', delta(0)));
  await tick();
  state.epoch = 2;
  xhr.text(frame('delta', delta(1)));
  xhr.complete();
  const result = await settled;
  assert.deepEqual(result.events.map((event) => event.type), ['meta', 'delta', 'error']);
  assert.deepEqual(result.events.at(-1), { type: 'error', code: 'SESSION_CHANGED', retryable: false });
});

test('the epoch watch aborts a quiet stream once the session is replaced', async () => {
  const { state, run, clock } = sessionHarness();
  const { xhr, settled } = run();
  xhr.respond();
  xhr.text(frame('meta', meta));
  await tick();
  state.epoch = 2;
  clock.advance(250);
  xhr.text(frame('delta', delta(0)));
  xhr.complete();
  const result = await settled;
  assert.deepEqual(result.events.at(-1), { type: 'error', code: 'SESSION_CHANGED', retryable: false });
  assert.equal(result.events.length, 2, 'the settled stream stayed closed');
});

test('a meta clientRequestId that differs from the request is rejected before any delta', async () => {
  const { run } = harness();
  const { xhr, settled } = run();
  xhr.respond();
  xhr.text(frame('meta', { ...meta, clientRequestId: 'ffffffff-ffff-4fff-8fff-ffffffffffff' })
    + frame('delta', delta(0)) + frame('done', done));
  xhr.complete();
  const result = await settled;
  assert.equal(result.error?.code, 'STREAM_REQUEST_MISMATCH');
  assert.equal(result.events.length, 0, 'mismatched content never reaches the caller');
});

test('the transport is chosen only by the explicit kind and the parity constant stays false', () => {
  const buffered = { name: 'buffered' };
  const xhr = { name: 'xhr' };
  const pick = (kind) => selectAssistantTransport({ kind, buffered: () => buffered, xhr: () => xhr });
  assert.equal(parseAssistantTransportKind(undefined), 'buffered');
  assert.equal(parseAssistantTransportKind('true'), 'buffered');
  assert.equal(parseAssistantTransportKind('xhr-sse'), 'xhr-sse');
  assert.equal(pick(parseAssistantTransportKind(undefined)), buffered);
  assert.equal(pick(parseAssistantTransportKind('xhr-sse')), xhr);
  assert.equal(streamModule.STREAMING_PARITY_VERIFIED, false);
});
