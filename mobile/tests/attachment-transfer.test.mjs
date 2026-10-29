import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import ts from 'typescript';
import { loadTs } from './helpers/load-ts.mjs';

function moduleUrl(source) {
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
  return `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`;
}
const sessionUrl = moduleUrl('let epoch = 0; export const sessionStore = { sessionEpoch: () => epoch, bumpEpoch: () => { epoch += 1; } };');
const { sessionStore } = await import(sessionUrl);
const nativeUrl = moduleUrl(fs.readFileSync(new URL('../src/api/native-file-adapter.ts', import.meta.url), 'utf8'));
const transferSource = fs.readFileSync(new URL('../src/screens/content/attachment-transfer.ts', import.meta.url), 'utf8')
  .replace("'../../api/native-file-adapter'", JSON.stringify(nativeUrl))
  .replace("'../../auth/mobile-session-store'", JSON.stringify(sessionUrl));
const transfer = await import(moduleUrl(transferSource));
const attempts = await loadTs('src/screens/academic/idempotency-attempts.ts');
const adapterModule = await loadTs('src/files/file-adapter.ts');

const MB = 1024 * 1024;
const pdf = { uri: 'file:///a.pdf', name: 'a.pdf', mimeType: 'application/pdf', sizeBytes: 1000 };

function fakeAdapter(overrides = {}) {
  const calls = { pick: 0, save: [] };
  return {
    calls,
    capability: () => ({ available: true }),
    pick: async () => { calls.pick += 1; return { status: 'picked', file: pdf }; },
    share: async () => ({ status: 'done' }),
    save: async (target) => { calls.save.push(target); return { status: 'done' }; },
    ...overrides,
  };
}

test('policies mirror the server ceiling and each lane keeps its own types', () => {
  assert.equal(transfer.ATTACHMENT_MAX_BYTES, 5 * MB);
  assert.equal(transfer.DOCUMENT_POLICY.mimeTypes.includes('application/zip'), false);
  assert.equal(transfer.COURSEWORK_POLICY.mimeTypes.includes('application/zip'), true);
  assert.equal(transfer.DOCUMENT_POLICY.mimeTypes.includes('application/pdf'), true);
});

test('checkPickedFile rejects empty, oversized and unaccepted files before upload', () => {
  const policy = transfer.DOCUMENT_POLICY;
  assert.deepEqual(transfer.checkPickedFile(pdf, policy), { ok: true });
  assert.deepEqual(transfer.checkPickedFile({ ...pdf, sizeBytes: 0 }, policy), { ok: false, problem: 'empty' });
  assert.deepEqual(transfer.checkPickedFile({ ...pdf, sizeBytes: 5 * MB + 1 }, policy), { ok: false, problem: 'too_large' });
  assert.deepEqual(transfer.checkPickedFile({ ...pdf, sizeBytes: 5 * MB }, policy), { ok: true });
  assert.deepEqual(transfer.checkPickedFile({ ...pdf, mimeType: 'application/x-msdownload' }, policy), { ok: false, problem: 'type' });
  assert.deepEqual(transfer.checkPickedFile({ ...pdf, mimeType: 'APPLICATION/PDF' }, policy), { ok: true });
});

test('pickForUpload with the default adapter is unavailable and never fabricates a file', async () => {
  const outcome = await transfer.pickForUpload(adapterModule.createUnavailableFileAdapter(), transfer.DOCUMENT_POLICY);
  assert.equal(outcome.status, 'unavailable');
  assert.equal(outcome.file, undefined);
});

test('pickForUpload returns a valid pick, flags an invalid one and passes cancel through', async () => {
  const ok = await transfer.pickForUpload(fakeAdapter(), transfer.DOCUMENT_POLICY);
  assert.equal(ok.status, 'picked');
  const big = await transfer.pickForUpload(
    fakeAdapter({ pick: async () => ({ status: 'picked', file: { ...pdf, sizeBytes: 6 * MB } }) }),
    transfer.DOCUMENT_POLICY,
  );
  assert.deepEqual(big, { status: 'invalid', problem: 'too_large' });
  const cancelled = await transfer.pickForUpload(fakeAdapter({ pick: async () => ({ status: 'cancelled' }) }), transfer.DOCUMENT_POLICY);
  assert.equal(cancelled.status, 'cancelled');
});

test('toUploadPart builds the multipart descriptor with a safe default type', () => {
  assert.deepEqual(transfer.toUploadPart(pdf), { uri: pdf.uri, name: 'a.pdf', type: 'application/pdf' });
  assert.equal(transfer.toUploadPart({ uri: 'u', name: 'n' }).type, 'application/octet-stream');
});

test('uploadPicked reuses one idempotency key after an unknown outcome and takes a new one after a definitive answer', async () => {
  let counter = 0;
  const keys = attempts.createAttemptKeys(() => `key-${++counter}`);
  const seen = [];
  const failWith = (error) => async (_part, key) => { seen.push(key); throw error; };

  const network = await transfer.uploadPicked(pdf, { keys, intent: 'careers:1', upload: failWith(new TypeError('Network request failed')) });
  assert.equal(network.status, 'failed');
  const retry = await transfer.uploadPicked(pdf, { keys, intent: 'careers:1', upload: async (_part, key) => { seen.push(key); return 'ok'; } });
  assert.deepEqual(retry, { status: 'done', result: 'ok' });
  assert.deepEqual(seen, ['key-1', 'key-1'], 'the retry reuses the key so the server can deduplicate');

  const rejected = await transfer.uploadPicked(pdf, { keys, intent: 'careers:1', upload: failWith(Object.assign(new Error('bad'), { status: 400 })) });
  assert.equal(rejected.status, 'failed');
  await transfer.uploadPicked(pdf, { keys, intent: 'careers:1', upload: async (_part, key) => { seen.push(key); return 'ok'; } });
  assert.deepEqual(seen.slice(2), ['key-2', 'key-3'], 'a definitive 4xx ends the attempt, so the next one is new');
});

test('uploadPicked scopes the key to the intent and the file', async () => {
  let counter = 0;
  const keys = attempts.createAttemptKeys(() => `key-${++counter}`);
  const seen = [];
  const boom = async (_part, key) => { seen.push(key); throw new TypeError('offline'); };
  await transfer.uploadPicked(pdf, { keys, intent: 'careers:1', upload: boom });
  await transfer.uploadPicked(pdf, { keys, intent: 'admissions:1', upload: boom });
  await transfer.uploadPicked({ ...pdf, uri: 'file:///b.pdf' }, { keys, intent: 'careers:1', upload: boom });
  assert.equal(new Set(seen).size, 3);
});

test('downloadToDevice is unavailable on the default adapter and never fetches the file', async () => {
  let fetched = false;
  const outcome = await transfer.downloadToDevice(
    adapterModule.createUnavailableFileAdapter(),
    async () => { fetched = true; return { data: new ArrayBuffer(1), contentType: null, fileName: null }; },
    'file.pdf',
  );
  assert.equal(outcome.status, 'unavailable');
  assert.equal(fetched, false);
});

test('downloadToDevice saves the bytes as a data URI with the server name or the fallback', async () => {
  const adapter = fakeAdapter();
  const bytes = new TextEncoder().encode('hello').buffer;
  const done = await transfer.downloadToDevice(adapter, async () => ({ data: bytes, contentType: 'text/plain', fileName: 'note.txt' }), 'fallback.bin');
  assert.equal(done.status, 'done');
  assert.deepEqual(adapter.calls.save[0], { uri: `data:text/plain;base64,${Buffer.from('hello').toString('base64')}`, name: 'note.txt', mimeType: 'text/plain' });
  await transfer.downloadToDevice(adapter, async () => ({ data: bytes, contentType: null, fileName: null }), 'fallback.bin');
  assert.equal(adapter.calls.save[1].name, 'fallback.bin');
  assert.equal(adapter.calls.save[1].mimeType, 'application/octet-stream');
});

test('downloadToDevice reports a failed fetch and an empty body as failed', async () => {
  const adapter = fakeAdapter();
  const failed = await transfer.downloadToDevice(adapter, async () => { throw Object.assign(new Error('x'), { code: 'NETWORK_ERROR' }); }, 'f');
  assert.deepEqual(failed, { status: 'failed', reason: 'NETWORK_ERROR' });
  const empty = await transfer.downloadToDevice(adapter, async () => ({ data: new ArrayBuffer(0), contentType: null, fileName: null }), 'f');
  assert.equal(empty.status, 'failed');
  assert.equal(adapter.calls.save.length, 0);
});

test('bytesToBase64 round-trips binary data', () => {
  const bytes = Uint8Array.from({ length: 256 }, (_, index) => index);
  assert.equal(transfer.bytesToBase64(bytes.buffer), Buffer.from(bytes).toString('base64'));
});

test('transferStateOf maps outcomes to a row state', () => {
  assert.deepEqual(transfer.transferStateOf({ status: 'done' }), { status: 'done' });
  assert.deepEqual(transfer.transferStateOf({ status: 'unavailable', reason: 'x' }), { status: 'unavailable' });
  assert.deepEqual(transfer.transferStateOf({ status: 'failed', reason: 'x' }), { status: 'failed' });
  assert.deepEqual(transfer.transferStateOf({ status: 'cancelled' }), { status: 'idle' });
});

test('regression: server traversal names never reach the save sheet', async () => {
  const adapter = fakeAdapter();
  await transfer.downloadToDevice(adapter, async () => ({
    data: new Uint8Array([1]).buffer, contentType: 'application/pdf', fileName: '../../.hidden.pdf',
  }), 'fallback.pdf');
  assert.equal(adapter.calls.save[0].name, 'hidden.pdf');
});

test('regression: disk download is released when the save sheet fails', async () => {
  let released = 0;
  const adapter = fakeAdapter({ save: async () => ({ status: 'failed', reason: 'ERROR' }) });
  const outcome = await transfer.downloadToDevice(adapter, async () => ({
    data: new ArrayBuffer(0), localUri: 'file:///cache/generated.pdf',
    contentType: 'application/pdf', fileName: 'server.pdf', release: () => { released += 1; },
  }), 'fallback.pdf');
  assert.equal(outcome.status, 'failed');
  assert.equal(released, 1);
});

for (const status of ['done', 'failed', 'cancelled', 'unavailable']) {
  test(`disk download stays on disk and is released after save returns ${status}`, async () => {
    let released = 0;
    const result = status === 'failed' || status === 'unavailable' ? { status, reason: 'ERROR' } : { status };
    const file = {
      get data() { assert.fail('native results must never be read into bytes/base64'); },
      get fileName() { assert.fail('native save must never use a server name'); },
      localUri: 'file:///cache/attachment-generated.pdf', contentType: 'application/pdf',
      release: () => { released += 1; },
    };
    const adapter = fakeAdapter({ save: async target => {
      assert.equal(released, 0, 'keep the file until the sheet settles');
      assert.deepEqual(target, {
        uri: file.localUri, name: 'attachment-generated.pdf', mimeType: 'application/pdf',
      });
      return result;
    } });
    assert.deepEqual(await transfer.downloadToDevice(adapter, async () => file, '../../server-fallback.pdf'), result);
    assert.equal(released, 1);
  });
}

test('disk download is released when the save sheet throws and preserves the error code', async () => {
  let released = 0;
  const adapter = fakeAdapter({ save: async () => { throw { code: 'REQUEST_ABORTED' }; } });
  assert.deepEqual(await transfer.downloadToDevice(adapter, async () => ({
    data: new ArrayBuffer(0), localUri: 'file:///cache/attachment-generated.pdf',
    contentType: 'application/pdf', fileName: '../../private.pdf', release: () => { released += 1; },
  }), 'fallback.pdf'), { status: 'failed', reason: 'REQUEST_ABORTED' });
  assert.equal(released, 1);
});

test('logout before the download returns releases the disk file without opening the sheet', async () => {
  let released = 0;
  const adapter = fakeAdapter();
  const result = await transfer.downloadToDevice(adapter, async () => {
    sessionStore.bumpEpoch();
    return { data: new ArrayBuffer(0), localUri: 'file:///cache/attachment-generated.pdf',
      contentType: 'application/pdf', fileName: 'private.pdf', release: () => { released += 1; } };
  }, 'fallback.pdf');
  assert.deepEqual(result, { status: 'failed', reason: 'SESSION_CHANGED' });
  assert.equal(adapter.calls.save.length, 0);
  assert.equal(released, 1);
});

test('logout while the save sheet is pending releases the disk file and stops watching', async context => {
  context.mock.timers.enable({ apis: ['setInterval'] });
  let released = 0;
  let finishSheet;
  let enterSheet;
  const sheetEntered = new Promise(resolve => { enterSheet = resolve; });
  const pending = transfer.downloadToDevice(fakeAdapter({ save: () => new Promise(resolve => { finishSheet = resolve; enterSheet(); }) }), async () => ({
    data: new ArrayBuffer(0), localUri: 'file:///cache/attachment-generated.pdf',
    contentType: 'application/pdf', fileName: 'private.pdf', release: () => { released += 1; },
  }), 'fallback.pdf');
  await sheetEntered;
  assert.equal(typeof finishSheet, 'function');
  sessionStore.bumpEpoch();
  context.mock.timers.tick(100);
  assert.equal(released, 1, 'delete immediately on the session check, without waiting for the sheet');
  finishSheet({ status: 'done' });
  assert.deepEqual(await pending, { status: 'failed', reason: 'SESSION_CHANGED' });
  context.mock.timers.tick(1000);
  assert.equal(released, 1);
});

test('disk cleanup errors return only the existing safe error code', async () => {
  const result = await transfer.downloadToDevice(fakeAdapter(), async () => ({
    data: new ArrayBuffer(0), localUri: 'file:///cache/attachment-generated.pdf',
    contentType: 'application/pdf', fileName: null,
    release: () => { throw new Error('private native error'); },
  }), 'fallback.pdf');
  assert.deepEqual(result, { status: 'failed', reason: 'ERROR' });
});

test('legacy fallback names are sanitized before reaching the save sheet', async () => {
  const adapter = fakeAdapter();
  await transfer.downloadToDevice(adapter, async () => ({
    data: new Uint8Array([1]).buffer, contentType: 'application/pdf', fileName: null,
  }), '..\\..\\.hidden.pdf');
  assert.equal(adapter.calls.save[0].name, 'hidden.pdf');
});
