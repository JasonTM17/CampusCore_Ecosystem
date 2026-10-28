import assert from 'node:assert/strict';
import test from 'node:test';
import { loadTs } from './helpers/load-ts.mjs';

const transfer = await loadTs('src/screens/content/attachment-transfer.ts');
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
