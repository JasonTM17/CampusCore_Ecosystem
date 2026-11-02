import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * Staff-desk paging: the admissions/careers queues ask for a zero-based window
 * and read the whole size from X-Total-Count; the library queue keeps its one
 * unpaged read. The fetch layer is a recording client, so wire paths, totals,
 * versioned action bodies and the pure pager rules are pinned without a device.
 */
const mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'campus-desk-paging-'));

function transpile(file, name) {
  const source = fs.readFileSync(path.join(mobileRoot, file), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    fileName: name,
  });
  const rewritten = outputText
    .replaceAll("'../../api/client'", "'./client.mjs'")
    .replaceAll("'../../api/paging'", "'./paging.mjs'")
    .replaceAll("'./lane-model'", "'./lane-model.mjs'")
    .replaceAll("'./lane-paging'", "'./lane-paging.mjs'");
  fs.writeFileSync(path.join(tempRoot, name.replace(/\.ts$/, '.mjs')), rewritten);
}

// The recording client the lane api talks to; each test installs its own answer.
fs.writeFileSync(
  path.join(tempRoot, 'client.mjs'),
  [
    'export const apiClient = {',
    "  get: (...args) => globalThis.__laneWire.get(...args),",
    "  requestWithMeta: (...args) => globalThis.__laneWire.requestWithMeta(...args),",
    "  post: (...args) => globalThis.__laneWire.post(...args),",
    '};',
    '',
  ].join('\n'),
);
transpile('src/api/paging.ts', 'paging.ts');
transpile('src/screens/lanes/lane-model.ts', 'lane-model.ts');
transpile('src/screens/lanes/lane-paging.ts', 'lane-paging.ts');
transpile('src/screens/lanes/lane-request.ts', 'lane-request.ts');
transpile('src/screens/lanes/lane-api.ts', 'lane-api.ts');

const load = (name) => import(pathToFileURL(path.join(tempRoot, `${name}.mjs`)).href);
const { laneApi } = await load('lane-api');
const { createRequestGate } = await load('lane-request');
const {
  LANE_PAGE_SIZE,
  correctionTarget,
  deskPageView,
  deskPagingReducer,
  deskTotalPages,
  deskWindow,
  initialDeskPaging,
} = await load('lane-paging');

/** Installs a recording client; `headers` are the only thing a list response may add. */
function wire({ body = [], headers = {}, failure } = {}) {
  const calls = [];
  globalThis.__laneWire = {
    calls,
    get: async (requestPath) => {
      calls.push({ kind: 'get', path: requestPath });
      if (failure) throw failure;
      return body;
    },
    requestWithMeta: async (requestPath, init) => {
      calls.push({ kind: 'meta', path: requestPath, init });
      if (failure) throw failure;
      return { data: body, headers: new Headers(headers), requestId: 'request-1' };
    },
    post: async (requestPath, postBody) => {
      calls.push({ kind: 'post', path: requestPath, body: postBody });
      return {};
    },
  };
  return calls;
}

const rows = (count) => Array.from({ length: count }, (_, index) => ({ id: `row-${index}` }));

test('admissions asks for wire page 0 and the screen labels it as page 1', async () => {
  const calls = wire({ body: rows(20), headers: { 'X-Total-Count': '41' } });
  const page = await laneApi.admissionsQueuePaged('SUBMITTED', deskWindow(0));

  assert.equal(calls.length, 1);
  assert.equal(calls[0].kind, 'meta');
  assert.equal(calls[0].path, '/admissions/staff/queue?status=SUBMITTED&page=0&limit=20');
  assert.equal(calls[0].init.method, 'GET');
  assert.equal(LANE_PAGE_SIZE, 20);
  assert.equal(page.total, 41);
  assert.equal(page.items.length, 20);
  assert.equal(page.hasMore, true);
  assert.deepEqual(deskPageView(page, 0), { page: 1, total: 41, totalPages: 3, hasMore: true });
  assert.deepEqual(deskPageView(page, 2), { page: 3, total: 41, totalPages: 3, hasMore: false });
});

test('careers uses its own window and one-based labels over zero-based requests', async () => {
  const calls = wire({ body: rows(5), headers: { 'X-Total-Count': '25' } });
  const page = await laneApi.careersApplicationsPaged(undefined, deskWindow(1));

  assert.equal(calls[0].path, '/careers/staff/applications?page=1&limit=20');
  assert.deepEqual(deskPageView(page, 1), { page: 2, total: 25, totalPages: 2, hasMore: false });
});

test('an absent or malformed total stays unknown and is never the page length', async () => {
  wire({ body: rows(20), headers: {} });
  const absent = await laneApi.admissionsQueuePaged(undefined, deskWindow(0));
  assert.equal('total' in absent, false);
  assert.deepEqual(deskPageView(absent, 0), { page: 1, hasMore: true });

  wire({ body: rows(20), headers: { 'X-Total-Count': 'not-a-number' } });
  const malformed = await laneApi.admissionsQueuePaged(undefined, deskWindow(0));
  assert.equal('total' in malformed, false);
  assert.equal(deskPageView(malformed, 0).total, undefined);
  assert.equal(deskPageView(malformed, 0).totalPages, undefined);
});

test('a short page without a total ends the list instead of inventing more', async () => {
  wire({ body: rows(3), headers: {} });
  const page = await laneApi.admissionsQueuePaged(undefined, deskWindow(0));
  assert.deepEqual(deskPageView(page, 0), { page: 1, hasMore: false });
});

test('changing the status filter returns to wire page 0 and clears the correction guard', () => {
  let state = deskPagingReducer(initialDeskPaging, { type: 'page', page: 4 });
  state = deskPagingReducer(state, { type: 'emptyPage', target: 3, lastPage: 3 });
  assert.deepEqual(state, { status: '', page: 3, corrected: true, lastPage: 3 });

  assert.deepEqual(deskPagingReducer(state, { type: 'filter', status: 'IN_REVIEW' }), {
    status: 'IN_REVIEW',
    page: 0,
    corrected: false,
  });
  assert.deepEqual(deskPagingReducer(state, { type: 'page', page: 1 }), {
    status: '',
    page: 1,
    corrected: false,
    lastPage: 3,
  });
  assert.equal(deskPagingReducer(state, { type: 'page', page: -2 }).page, 0);
});

test('an empty page past the end is corrected exactly once', () => {
  const pastEnd = { items: [], total: 41, hasMore: false };
  assert.equal(correctionTarget(pastEnd, 3), 2);
  assert.equal(deskTotalPages(41), 3);
  let state = deskPagingReducer({ status: '', page: 3, corrected: false }, { type: 'emptyPage', target: 2, lastPage: 2 });
  assert.deepEqual(state, { status: '', page: 2, corrected: true, lastPage: 2 });
  // A second empty reply does not cascade; the member sees the empty state.
  assert.equal(deskPagingReducer(state, { type: 'emptyPage', target: 1, lastPage: 1 }), state);

  // Page 0 is always a real page, and an empty window inside a known range is not "past the end".
  assert.equal(correctionTarget({ items: [], total: 0, hasMore: false }, 0), null);
  assert.equal(correctionTarget({ items: [], total: 100, hasMore: false }, 2), null);
  // A queue that shrank far below the open page lands on the last allowed page in one step.
  assert.equal(correctionTarget({ items: [], total: 20, hasMore: false }, 9), 0);

  // Without a total the previous page is the only target, and it becomes the known last page.
  assert.equal(correctionTarget({ items: [], hasMore: false }, 1), 0);
  assert.deepEqual(deskPageView({ items: rows(20), hasMore: true }, 0, 0), { page: 1, hasMore: false });
});

test('a late read for an older page or focus never wins over the newest one', () => {
  const gate = createRequestGate();
  const pageZero = gate.begin();
  const pageOne = gate.begin();
  assert.equal(gate.isLatest(pageZero), false, 'the page 0 response is stale');
  assert.equal(gate.isLatest(pageOne), true);

  const focusReload = gate.begin();
  assert.equal(gate.isLatest(pageOne), false, 'a focus reload supersedes the in-flight page');
  assert.equal(gate.isLatest(focusReload), true);
});

test('queue actions keep expectedVersion and idempotency-shaped bodies', async () => {
  const calls = wire();
  const admission = { id: 'app/1', version: 7 };
  const career = { id: 'career-1', version: 3 };
  const loan = { id: 'loan-1', version: 9 };

  await laneApi.admissionsClaim(admission);
  await laneApi.admissionsDecide(admission, 'ACCEPTED');
  await laneApi.admissionsReturn(admission, '  missing transcript  ');
  await laneApi.careersTransition(career, 'INTERVIEW');
  await laneApi.careersReject(career, '  no match  ');
  await laneApi.libraryApprove(loan);

  assert.deepEqual(calls.map((call) => call.path), [
    '/admissions/staff/applications/app%2F1/claim',
    '/admissions/staff/applications/app%2F1/decision',
    '/admissions/staff/applications/app%2F1/return',
    '/careers/staff/applications/career-1/transition',
    '/careers/staff/applications/career-1/reject',
    '/library/staff/requests/loan-1/approve',
  ]);
  assert.deepEqual(calls.map((call) => call.body), [
    { expectedVersion: 7 },
    { decision: 'ACCEPTED', expectedVersion: 7 },
    { note: 'missing transcript', expectedVersion: 7 },
    { toStatus: 'INTERVIEW', expectedVersion: 3 },
    { expectedVersion: 3, reason: 'no match' },
    { expectedVersion: 9 },
  ]);
});

test('the library desk keeps its single unpaged read, with no page parameters', async () => {
  const calls = wire({ body: [{ id: 'loan-1' }] });
  const rowsRead = await laneApi.libraryRequests('REQUESTED');

  assert.deepEqual(rowsRead, [{ id: 'loan-1' }]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].kind, 'get');
  assert.equal(calls[0].path, '/library/staff/requests?status=REQUESTED');
  assert.equal(calls[0].path.includes('page='), false);
});

test('the legacy array reads still exist for callers that need the whole list', async () => {
  const calls = wire({ body: [{ id: 'a' }] });
  assert.deepEqual(await laneApi.admissionsQueue(), [{ id: 'a' }]);
  assert.deepEqual(await laneApi.careersApplications(), [{ id: 'a' }]);
  assert.deepEqual(calls.map((call) => call.path), [
    '/admissions/staff/queue',
    '/careers/staff/applications',
  ]);
});
