import assert from 'node:assert/strict';
import test from 'node:test';
import { loadTs } from './helpers/load-ts.mjs';

const runtime = await loadTs('src/hooks/query-performance.ts');
const cache = await loadTs('src/hooks/query-cache.ts');
const { groupedRows } = await loadTs('src/components/perf/grouped-rows.ts');
const tick = () => new Promise((resolve) => setTimeout(resolve, 10));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test('coalesces concurrent reads, releases success and rejection, isolates epochs', async () => {
  const pending = deferred();
  let calls = 0;
  const read = () => { calls++; return pending.promise; };
  const one = runtime.coalesceQueryRequest('account:vi:student:grants:resource:epoch1', read);
  const two = runtime.coalesceQueryRequest('account:vi:student:grants:resource:epoch1', read);
  assert.equal(one, two);
  await Promise.resolve();
  assert.equal(calls, 1);
  const next = runtime.coalesceQueryRequest('account:vi:student:grants:resource:epoch2', async () => 'new');
  assert.equal(await next, 'new');
  pending.resolve('old');
  assert.equal(await one, 'old');
  assert.equal(await runtime.coalesceQueryRequest('account:vi:student:grants:resource:epoch1', async () => 'fresh'), 'fresh');
  await assert.rejects(runtime.coalesceQueryRequest('failure', async () => { throw Error('expected'); }));
  assert.equal(await runtime.coalesceQueryRequest('failure', async () => 'retry'), 'retry');
});

test('background/inactive pause; only focused active surfaces revalidate', () => {
  for (const state of ['background', 'inactive', 'extension', 'unknown']) assert.equal(runtime.canRevalidate(state), false);
  assert.equal(runtime.canRevalidate('active'), true);
  assert.equal(runtime.canRevalidate('active', false), false);
  assert.equal(runtime.canRevalidate(null), true);
});

test('resource freshness preserves stale reads and never retains lane data', () => {
  cache.clearQueryCache();
  const key = cache.queryCacheKey('a', 'content.news', { locale: 'vi', roleLane: 'student', grants: [] });
  cache.writeQueryCache(key, ['row']);
  assert.equal(cache.isQueryCacheFresh(key, 30_000), true);
  assert.equal(cache.isQueryCacheFresh(key, 30_000, Date.now() + 31_000), false);
  assert.deepEqual(cache.readQueryCache(key), ['row']);
  assert.equal(runtime.resourceStaleTime('content.news'), 30_000);
  assert.equal(runtime.resourceStaleTime('academic.profile'), 120_000);
  assert.equal(runtime.resourceStaleTime('academic.semesters'), 900_000);
  for (const name of ['lane.queue', 'dean.overview', 'staff.queue', 'admin.audit']) {
    const laneKey = cache.queryCacheKey('a', name);
    cache.writeQueryCache(laneKey, 'sensitive');
    assert.equal(cache.readQueryCache(laneKey), undefined);
    assert.equal(runtime.resourceStaleTime(name), 0);
  }
});

test('prefetch canceled before dispatch never loads; after dispatch aborts and never publishes', async () => {
  let calls = 0, published = 0;
  const pending = deferred();
  let signal;
  const task = () => runtime.schedulePrefetch({ delay: 0, isCurrent: () => true,
    load: (s) => { signal = s; calls++; return pending.promise; }, publish: () => published++ });
  const cancelEarly = task(); cancelEarly(); await tick();
  assert.equal(calls, 0);
  const cancelLate = task(); await tick(); cancelLate();
  assert.equal(calls, 1);
  assert.equal(signal.aborted, true);
  pending.resolve('data'); await tick();
  assert.equal(published, 0);
});

test('late prefetch cannot publish across account/locale/grant/epoch changes or background', async () => {
  let current = true, published = 0;
  const pending = deferred();
  const cancel = runtime.schedulePrefetch({ delay: 0, isCurrent: () => current,
    load: () => pending.promise, publish: () => published++ });
  await tick(); current = false; pending.resolve('private'); await tick(); cancel();
  assert.equal(published, 0);
});

test('scoping dimensions and grant-order normalization are unchanged', () => {
  const scope = { locale: 'vi', roleLane: 'student', grants: ['read', 'export'], filter: 'x', page: 0 };
  const key = cache.queryCacheKey('a', 'content.news', scope);
  assert.equal(key, cache.queryCacheKey('a', 'content.news', { ...scope, grants: ['export', 'read'] }));
  for (const changed of [{ locale: 'en' }, { roleLane: 'admin' }, { grants: ['read'] }, { filter: 'y' }, { page: 1 }]) {
    assert.notEqual(key, cache.queryCacheKey('a', 'content.news', { ...scope, ...changed }));
  }
  assert.notEqual(key, cache.queryCacheKey('b', 'content.news', scope));
});

test('large groups flatten to per-record data with stable collision-free keys', () => {
  const records = Array.from({ length: 200 }, (_, id) => ({ id: String(id) }));
  const groups = [{ id: 'one', records }, { id: 'two', records: [records[0]] }];
  const rows = groupedRows(groups, (group) => group.id, (group) => group.records, (row) => row.id);
  assert.equal(rows.length, 203);
  assert.equal(new Set(rows.map((row) => row.key)).size, 203);
  assert.equal(rows[1].item, records[0]);
  assert.equal(rows[200].last, true);
  assert.equal(rows[201].kind, 'header');
});
