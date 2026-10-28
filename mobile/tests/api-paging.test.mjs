import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * Optional paging over bare-array list bodies: no default limit, parameters only
 * when given, total only from X-Total-Count, a short page ends the list. The
 * parity facades are checked against a recording client, so paths and multipart
 * shapes are pinned without a network.
 */
const mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'campus-paging-'));

function transpile(file, fileName) {
  const source = fs.readFileSync(path.join(mobileRoot, file), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    fileName,
  });
  const rewritten = outputText
    .replace(/from '\.\/paging'/g, "from './paging.mjs'")
    .replace(/from '\.\/client'/g, "from './client.mjs'");
  fs.writeFileSync(path.join(tempRoot, fileName.replace(/\.ts$/, '.mjs')), rewritten);
}

fs.writeFileSync(path.join(tempRoot, 'client.mjs'), 'export const apiClient = { stub: true };\n');
transpile('src/api/paging.ts', 'paging.ts');
transpile('src/api/parity-api.ts', 'parity-api.ts');
const { buildQuery, pagingParams, parseTotalCount, toPagedResult } =
  await import(pathToFileURL(path.join(tempRoot, 'paging.mjs')).href);
const { createParityApi } = await import(pathToFileURL(path.join(tempRoot, 'parity-api.mjs')).href);

/** Client double that records calls and answers list reads with a scripted body + headers. */
function makeClient({ body = [], headers = {} } = {}) {
  const calls = [];
  return {
    calls,
    client: {
      requestWithMeta: async (requestPath, init) => {
        calls.push({ kind: 'json', path: requestPath, init });
        return { data: body, headers: new Headers(headers), requestId: 'r-1' };
      },
      upload: async (requestPath, form, init) => {
        calls.push({ kind: 'upload', path: requestPath, form, init });
        return { id: 'uploaded' };
      },
      download: async (requestPath, init) => {
        calls.push({ kind: 'download', path: requestPath, init });
        return { data: new ArrayBuffer(0), contentType: null, fileName: null, headers: new Headers(), requestId: 'r-2' };
      },
    },
  };
}

test('paging parameters are appended only when provided, with the server window rules', () => {
  assert.deepEqual(pagingParams(), {});
  assert.deepEqual(pagingParams({}), {});
  assert.deepEqual(pagingParams({ page: undefined, limit: undefined }), {});
  assert.deepEqual(pagingParams({ limit: 25 }), { limit: 25 });
  assert.deepEqual(pagingParams({ page: 0, limit: 25 }), { page: 0, limit: 25 });
  assert.throws(() => pagingParams({ page: 1 }), RangeError, 'page needs limit');
  assert.throws(() => pagingParams({ page: 0, limit: 0 }), RangeError);
  assert.throws(() => pagingParams({ page: 0, limit: 101 }), RangeError);
  assert.throws(() => pagingParams({ page: -1, limit: 10 }), RangeError);
  assert.throws(() => pagingParams({ page: 1.5, limit: 10 }), RangeError);
});

test('query building omits empty values and never invents a default limit', () => {
  assert.equal(buildQuery({}), '');
  assert.equal(buildQuery({ query: undefined, status: '', page: undefined }), '');
  assert.equal(buildQuery({ roundId: 'r 1', limit: 5 }), '?roundId=r+1&limit=5');
});

test('X-Total-Count parses only non-negative integers', () => {
  assert.equal(parseTotalCount(new Headers({ 'X-Total-Count': '42' })), 42);
  assert.equal(parseTotalCount(new Headers({ 'x-total-count': '0' })), 0);
  assert.equal(parseTotalCount(new Headers()), undefined);
  for (const bad of ['abc', '-1', '1.5', '', '1e3']) {
    assert.equal(parseTotalCount(new Headers({ 'X-Total-Count': bad })), undefined, `rejects ${bad || 'empty'}`);
  }
  assert.equal(parseTotalCount(null), undefined);
});

test('a paged read reports total and end-of-list from the header', () => {
  const items = [{ id: 'a' }, { id: 'b' }];
  const headers = new Headers({ 'X-Total-Count': '5' });
  const first = toPagedResult(items, headers, { page: 0, limit: 2 });
  assert.equal(first.items, items, 'the body stays the same bare array');
  assert.equal(first.total, 5);
  assert.equal(first.hasMore, true);
  assert.equal(toPagedResult([{ id: 'e' }], headers, { page: 2, limit: 2 }).hasMore, false);
  assert.equal(toPagedResult([], headers, { page: 3, limit: 2 }).hasMore, false);
});

test('without the header a short page ends the list and a full page may continue', () => {
  const noHeader = new Headers();
  const full = toPagedResult([{ id: 1 }, { id: 2 }], noHeader, { page: 0, limit: 2 });
  assert.equal('total' in full, false, 'no total is invented');
  assert.equal(full.hasMore, true);
  assert.equal(toPagedResult([{ id: 3 }], noHeader, { page: 1, limit: 2 }).hasMore, false);
  assert.equal(toPagedResult([], noHeader, { page: 2, limit: 2 }).hasMore, false);
});

test('an unpaged read is the whole legacy list: no total required, nothing more to fetch', () => {
  const result = toPagedResult([{ id: 1 }, { id: 2 }, { id: 3 }], new Headers());
  assert.deepEqual(result, { items: [{ id: 1 }, { id: 2 }, { id: 3 }], hasMore: false });
  assert.throws(() => toPagedResult({ data: [] }, new Headers()), TypeError, 'an envelope is not a list body');
});

test('list facades keep the legacy path when no paging is given', async () => {
  const { client, calls } = makeClient({ body: [{ id: 'e1' }] });
  const api = createParityApi(client);
  assert.deepEqual(await api.events(), { items: [{ id: 'e1' }], hasMore: false });
  await api.myEventRegistrations();
  await api.libraryCatalogue();
  await api.careersOpportunities();
  await api.thesisRounds();
  await api.myThesisGroups();
  assert.deepEqual(calls.map((call) => call.path), [
    '/events',
    '/events/my/registrations',
    '/library/catalogue',
    '/careers/opportunities',
    '/thesis/rounds',
    '/thesis/groups/mine',
  ]);
  assert.ok(calls.every((call) => call.init.method === 'GET'));
});

test('list facades add page, limit and filters, and carry the cancellation signal', async () => {
  const { client, calls } = makeClient({ body: [{ id: 'a' }, { id: 'b' }], headers: { 'X-Total-Count': '7' } });
  const api = createParityApi(client);
  const controller = new AbortController();

  const events = await api.events({ page: 1, limit: 2, signal: controller.signal });
  assert.equal(events.total, 7);
  assert.equal(events.hasMore, true);
  assert.equal(calls[0].path, '/events?page=1&limit=2');
  assert.equal(calls[0].init.signal, controller.signal);

  await api.libraryCatalogue({ query: 'clean code', limit: 5 });
  await api.careersOpportunities({ query: 'intern', page: 0, limit: 10 });
  await api.thesisRounds({ status: 'REGISTRATION_OPEN', limit: 3 });
  await api.thesisTopics('round-1', { page: 2, limit: 10 });
  await api.thesisTopics('round-1', { status: 'APPROVED' });
  await api.thesisGroups('round 2', { limit: 4 });
  assert.deepEqual(calls.slice(1).map((call) => call.path), [
    '/library/catalogue?query=clean+code&limit=5',
    '/careers/opportunities?query=intern&page=0&limit=10',
    '/thesis/rounds?status=REGISTRATION_OPEN&limit=3',
    '/thesis/topics?roundId=round-1&status=PUBLISHED&page=2&limit=10',
    '/thesis/topics?roundId=round-1&status=APPROVED',
    '/thesis/groups?roundId=round+2&limit=4',
  ]);
});

test('an invalid window fails before any request is made', async () => {
  const { client, calls } = makeClient();
  const api = createParityApi(client);
  await assert.rejects(api.events({ page: 1 }), RangeError);
  await assert.rejects(api.events({ page: 0, limit: 500 }), RangeError);
  assert.equal(calls.length, 0);
});

test('attachment uploads use the existing JSON paths as multipart with the caller idempotency key', async () => {
  const { client, calls } = makeClient();
  const api = createParityApi(client);
  const file = new Blob(['%PDF'], { type: 'application/pdf' });
  const controller = new AbortController();

  await api.admissionsUploadAttachment('app/1', file, {
    idempotencyKey: 'intent-A',
    checksum: 'abc123',
    signal: controller.signal,
  });
  await api.careersUploadAttachment('app-2', file, { idempotencyKey: 'intent-B' });

  const [admissions, careers] = calls;
  assert.equal(admissions.kind, 'upload');
  assert.equal(admissions.path, '/admissions/applications/app%2F1/attachments');
  assert.equal(admissions.init.idempotencyKey, 'intent-A');
  assert.equal(admissions.init.signal, controller.signal);
  assert.ok(admissions.form instanceof FormData);
  assert.equal(admissions.form.get('checksum'), 'abc123');
  assert.equal(admissions.form.get('file').size, 4);
  assert.equal(careers.path, '/careers/applications/app-2/attachments');
  assert.equal(careers.init.idempotencyKey, 'intent-B');
  assert.equal(careers.form.has('checksum'), false, 'checksum is sent only when given');
});

test('learning multipart facades match the backend overloads', async () => {
  const { client, calls } = makeClient();
  const api = createParityApi(client);
  const file = new Blob(['answer']);

  await api.learningSaveDraftMultipart('sub-1', { textBody: 'draft', file });
  await api.learningSaveDraftMultipart('sub-1', { textBody: '' });
  await api.learningResubmitMultipart('asg-1', { file, checksum: 'c0ffee' }, { idempotencyKey: 'intent-R' });

  const [draftWithFile, draftTextOnly, resubmit] = calls;
  assert.equal(draftWithFile.path, '/learning/submissions/sub-1/draft');
  assert.equal(draftWithFile.init.method, 'PUT');
  assert.equal(draftWithFile.form.get('textBody'), 'draft');
  assert.ok(draftWithFile.form.get('file'));
  assert.equal(draftTextOnly.form.get('textBody'), '');
  assert.equal(draftTextOnly.form.has('file'), false, 'the file part is optional');
  assert.equal(resubmit.path, '/learning/assignments/asg-1/resubmit');
  assert.equal(resubmit.init.idempotencyKey, 'intent-R');
  assert.equal(resubmit.form.has('textBody'), false);
  assert.equal(resubmit.form.get('checksum'), 'c0ffee');
});

test('download facades target the existing file paths', async () => {
  const { client, calls } = makeClient();
  const api = createParityApi(client);
  const controller = new AbortController();
  await api.admissionsDownloadAttachment('a1', 'f1', { signal: controller.signal });
  await api.careersDownloadAttachment('a2', 'f2');
  await api.learningDownloadMaterial('m1');
  await api.learningDownloadRevision('rev 1');
  assert.deepEqual(calls.map((call) => call.path), [
    '/admissions/applications/a1/attachments/f1/file',
    '/careers/applications/a2/attachments/f2/download',
    '/learning/materials/m1/file',
    '/learning/revisions/rev%201/file',
  ]);
  assert.ok(calls.every((call) => call.kind === 'download'));
  assert.equal(calls[0].init.signal, controller.signal);
});
