import assert from 'node:assert/strict';
import test from 'node:test';
import { loadTs } from './helpers/load-ts.mjs';

const native = await loadTs('src/api/native-file-adapter.ts');
const MB = 1024 * 1024;
const PDF = 'application/pdf';

function fixture(overrides = {}) {
  const files = new Map();
  const deleted = [];
  const shared = [];
  let sheetError;
  class File {
    constructor(...parts) { this.uri = parts.map((p, i) => {
      const value = typeof p === 'string' ? p : p.uri;
      return i ? value.replace(/^\/+/, '') : value.replace(/\/$/, '');
    }).join('/'); }
    get exists() { return files.has(this.uri); }
    get size() { return files.get(this.uri)?.size ?? files.get(this.uri)?.bytes?.length ?? 0; }
    create() { assert.equal(this.exists, false); files.set(this.uri, { bytes: new Uint8Array() }); }
    delete() { deleted.push(this.uri); files.delete(this.uri); }
    copy(other) { files.set(other.uri, { ...files.get(this.uri) }); }
    write(data) { files.set(this.uri, { bytes: new Uint8Array(Buffer.from(data, 'base64')) }); }
    async bytes() { return files.get(this.uri).bytes; }
    open() {
      let closed = false;
      return {
        writeBytes: value => {
          assert.equal(closed, false);
          const prev = files.get(this.uri).bytes;
          files.set(this.uri, { bytes: new Uint8Array([...prev, ...value]) });
        },
        close: () => { assert.equal(closed, false); closed = true; },
      };
    }
  }
  const source = 'file:///cache/DocumentPicker/picked.pdf';
  files.set(source, { bytes: new Uint8Array([37, 80, 68, 70]) });
  const modules = {
    os: 'android', fs: { File, Paths: { cache: { uri: 'file:///cache/' } } },
    picker: { getDocumentAsync: async options => {
      assert.equal(options.copyToCacheDirectory, true);
      assert.equal(options.multiple, false);
      return { canceled: false, assets: [{ uri: source, name: '../.transcript.pdf', mimeType: PDF, size: 1 }] };
    } },
    sharing: { isAvailableAsync: async () => true, shareAsync: async (uri, options) => {
      shared.push({ uri, options, bytes: files.get(uri)?.bytes });
      if (sheetError) throw sheetError;
    } },
    ...overrides,
  };
  return { ...native.createNativeFileRuntime(modules), files, deleted, shared, source,
    failSheet: () => { sheetError = new Error('private native error'); } };
}

function response(chunks, headers = {}) {
  return new Response(new ReadableStream({ start(controller) {
    for (const chunk of chunks) controller.enqueue(new Uint8Array(chunk));
    controller.close();
  } }), { headers: { 'content-type': PDF, ...headers } });
}

test('native pick stats the cached copy and sanitizes the display name', async () => {
  const f = fixture();
  const result = await f.adapter.pick({ mimeTypes: [PDF], maxBytes: 5 * MB });
  assert.equal(result.status, 'picked');
  assert.equal(result.file.name, 'transcript.pdf');
  assert.equal(result.file.sizeBytes, 4, 'actual stat beats inaccurate picker metadata');
  assert.match(result.file.uri, /^file:\/\/\/cache\/attachment-[\w-]+\.pdf$/);
  assert.equal(f.files.has(f.source), false, 'picker cache copy is removed');
});

test('native picker rejects oversize and MIME and removes its cache copy', async () => {
  for (const options of [{ maxBytes: 3, mimeTypes: [PDF] }, { maxBytes: 100, mimeTypes: ['text/plain'] }]) {
    const f = fixture();
    assert.equal((await f.adapter.pick(options)).status, 'failed');
    assert.equal(f.files.size, 0);
  }
});

test('native picker cancellation and missing modules/web are graceful', async () => {
  const f = fixture({ picker: { getDocumentAsync: async () => ({ canceled: true, assets: null }) } });
  assert.deepEqual(await f.adapter.pick(), { status: 'cancelled' });
  for (const modules of [{ os: 'web' }, { os: 'android' }, { os: 'ios', fs: undefined }]) {
    const { adapter } = native.createNativeFileRuntime(modules);
    for (const op of ['pick', 'save', 'share']) assert.equal(adapter.capability(op).available, false);
    assert.equal((await adapter.pick()).status, 'unavailable');
    assert.equal((await adapter.save({ uri: 'file:///x', name: 'x' })).status, 'unavailable');
  }
  assert.equal(native.loadNativeFileRuntime(), undefined, 'node has no native require/module');
});

test('native streamed download uses generated cache path, reports progress and shares then deletes', async () => {
  const f = fixture();
  const progress = [];
  const file = await f.streamDownload(response([[1, 2], [3]], { 'content-length': '3',
    'content-disposition': 'attachment; filename="../../.private.pdf"' }), undefined, (...p) => progress.push(p));
  assert.match(file.localUri, /^file:\/\/\/cache\/attachment-[\w-]+\.pdf$/);
  assert.equal(file.localUri.includes('private'), false);
  assert.deepEqual(progress, [[0, 3], [2, 3], [3, 3]]);
  assert.equal((await f.adapter.save({ uri: file.localUri, name: '../../.private.pdf', mimeType: PDF })).status, 'done');
  assert.deepEqual([...f.shared[0].bytes], [1, 2, 3]);
  assert.equal(f.shared[0].options.dialogTitle, 'private.pdf');
  assert.equal(f.files.has(file.localUri), false);
  file.release(); // Idempotent cleanup after the sheet.
});

test('native share failure cleans the generated file and never exposes a native error', async () => {
  const f = fixture();
  const file = await f.streamDownload(response([[1]]));
  f.failSheet();
  assert.deepEqual(await f.adapter.share({ uri: file.localUri, name: 'a.pdf' }), { status: 'failed', reason: 'ERROR' });
  assert.equal(f.files.has(file.localUri), false);
});

test('native download rejects declared oversize/MIME before creating a file', async () => {
  for (const headers of [{ 'content-length': String(5 * MB + 1) }, { 'content-type': 'application/x-msdownload' }]) {
    const f = fixture();
    await assert.rejects(f.streamDownload(response([[1]], headers)), e => e instanceof native.NativeFileError);
    assert.equal(f.deleted.length, 0);
  }
});

test('native streaming enforces size with no content-length and deletes partial bytes', async () => {
  const f = fixture();
  const source = response([[1], new Uint8Array(5 * MB)]);
  await assert.rejects(f.streamDownload(source), e => e.code === 'ATTACHMENT_SIZE_INVALID');
  assert.equal(f.deleted.length, 1);
  assert.equal([...f.files.keys()].some(uri => uri.includes('/attachment-')), false);
});

test('native cancellation unblocks a pending read and deletes partial output', async () => {
  const f = fixture();
  const controller = new AbortController();
  let cancelled = false;
  const res = new Response(new ReadableStream({
    start(stream) { stream.enqueue(new Uint8Array([1])); },
    cancel() { cancelled = true; },
  }), { headers: { 'content-type': PDF } });
  await assert.rejects(f.streamDownload(res, controller.signal, written => {
    if (written) controller.abort();
  }), e => e.code === 'REQUEST_ABORTED');
  assert.equal(cancelled, true);
  assert.equal(f.deleted.length, 1);
});

test('native stream failure and truncated bodies close and delete partial output', async () => {
  for (const res of [response([[1]], { 'content-length': '2' }), new Response(new ReadableStream({
    pull(controller) { controller.error(new Error('connection lost')); },
  }), { headers: { 'content-type': PDF } })]) {
    const f = fixture();
    await assert.rejects(f.streamDownload(res));
    assert.equal(f.deleted.length, 1);
  }
});

test('native save accepts bounded legacy data URI and rejects remote/arbitrary paths', async () => {
  const f = fixture();
  assert.equal((await f.adapter.save({ uri: 'data:application/pdf;base64,JVBERg==', name: 'a.pdf', mimeType: PDF })).status, 'done');
  assert.equal(f.shared.length, 1);
  for (const uri of ['https://foreign.test/file', 'file:///etc/private', 'data:application/x-msdownload;base64,AA==']) {
    assert.equal((await f.adapter.save({ uri, name: 'x' })).status, 'failed');
  }
});

test('native multipart preparation validates real file size, lane MIME and sanitized filename', async () => {
  const savedForm = globalThis.FormData;
  class Form {
    _parts = [];
    append(name, value) { this._parts.push([name, value]); }
    entries() { return this._parts.values(); }
  }
  globalThis.FormData = Form;
  try {
    const f = fixture();
    const form = new Form();
    form.append('file', { uri: f.source, name: '../../.unsafe.pdf', type: PDF });
    form.append('checksum', 'digest');
    const prepared = f.prepareUpload(form, '/admissions/applications/a/attachments');
    assert.equal(prepared._parts[0][1].name, 'unsafe.pdf');
    assert.deepEqual([...await prepared._parts[0][1].bytes()], [37, 80, 68, 70]);
    assert.deepEqual(prepared._parts[1], ['checksum', 'digest']);
    form._parts[0][1].type = 'text/plain';
    assert.throws(() => f.prepareUpload(form, '/admissions/applications/a/attachments'), e => e.code === 'ATTACHMENT_TYPE_UNSUPPORTED');
    f.files.set(f.source, { size: 5 * MB + 1 });
    assert.throws(() => f.prepareUpload(form, '/learning/submissions/a/draft'), e => e.code === 'ATTACHMENT_SIZE_INVALID');
  } finally { globalThis.FormData = savedForm; }
});

test('native thesis compatibility keeps its separate 20 MiB document ceiling', async () => {
  const savedForm = globalThis.FormData;
  class Form { _parts = []; append(name, value) { this._parts.push([name, value]); } }
  globalThis.FormData = Form;
  try {
    const f = fixture();
    f.files.set(f.source, { size: 20 * MB });
    const form = new Form();
    form.append('file', { uri: f.source, name: 'report.pdf', type: PDF });
    assert.doesNotThrow(() => f.prepareUpload(form, '/thesis/groups/g1/report/file'));
    f.files.set(f.source, { size: 20 * MB + 1 });
    assert.throws(() => f.prepareUpload(form, '/thesis/groups/g1/report/file'), e => e.code === 'ATTACHMENT_SIZE_INVALID');
    f.files.set(f.source, { size: 1 });
    form._parts[0][1].type = 'application/zip';
    assert.throws(() => f.prepareUpload(form, '/thesis/groups/g1/report/file'), e => e.code === 'ATTACHMENT_TYPE_UNSUPPORTED');
  } finally { globalThis.FormData = savedForm; }
});

test('native name sanitizer bounds names and strips traversal, controls and leading dots', () => {
  for (const name of ['../../.hidden.pdf', '..\\..\\.hidden.pdf', '...hidden.pdf']) {
    assert.equal(native.sanitizeFileName(name), 'hidden.pdf');
  }
  assert.equal(native.sanitizeFileName('../..'), 'attachment');
  assert.equal(native.sanitizeFileName('a'.repeat(500)).length, 120);
});
