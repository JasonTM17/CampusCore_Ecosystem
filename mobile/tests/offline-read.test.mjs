import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import { fileURLToPath, pathToFileURL } from 'node:url';

const mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'campus-offline-read-'));
const source = fs.readFileSync(path.join(mobileRoot, 'src/hooks/query-cache.ts'), 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  fileName: 'query-cache.ts',
});
fs.writeFileSync(path.join(tempRoot, 'query-cache.mjs'), outputText);
const { queryCacheKey, readQueryCache, writeQueryCache, clearQueryCache } = await import(
  pathToFileURL(path.join(tempRoot, 'query-cache.mjs')).href
);

test('default cache keys retain caller behavior and account keyspaces stay isolated', () => {
  clearQueryCache();
  const defaultKey = queryCacheKey('account-a', 'courses');
  assert.equal(defaultKey, 'account-a:courses');
  writeQueryCache(defaultKey, ['A course']);
  assert.deepEqual(readQueryCache(defaultKey), ['A course']);
  assert.equal(readQueryCache(queryCacheKey('account-b', 'courses')), undefined);
  assert.equal(queryCacheKey(null, 'public'), 'anonymous:public');
  assert.equal(queryCacheKey('account-a', 'courses', {}), defaultKey);
});

test('locale and role scopes cannot read each other cache entries', () => {
  clearQueryCache();
  const viStudent = queryCacheKey('account-a', 'dashboard', { locale: 'vi', roleLane: 'student' });
  const enStudent = queryCacheKey('account-a', 'dashboard', { locale: 'en', roleLane: 'student' });
  const viLecturer = queryCacheKey('account-a', 'dashboard', { locale: 'vi', roleLane: 'lecturer' });
  writeQueryCache(viStudent, { label: 'Sinh viên' });
  writeQueryCache(enStudent, { label: 'Student' });
  writeQueryCache(viLecturer, { label: 'Giảng viên' });
  assert.notEqual(viStudent, enStudent);
  assert.notEqual(viStudent, viLecturer);
  assert.notEqual(enStudent, viLecturer);
  assert.deepEqual(readQueryCache(viStudent), { label: 'Sinh viên' });
  assert.deepEqual(readQueryCache(enStudent), { label: 'Student' });
  assert.deepEqual(readQueryCache(viLecturer), { label: 'Giảng viên' });
  assert.equal(readQueryCache(queryCacheKey('account-b', 'dashboard', { locale: 'vi', roleLane: 'student' })), undefined);
});

test('maxAge returns fresh entries and evicts expired memory entries', () => {
  clearQueryCache();
  const originalNow = Date.now;
  let now = 10_000;
  Date.now = () => now;
  try {
    writeQueryCache('account-a:announcements', ['fresh']);
    now += 999;
    assert.deepEqual(readQueryCache('account-a:announcements', 1_000), ['fresh']);
    now += 2;
    assert.equal(readQueryCache('account-a:announcements', 1_000), undefined);
    assert.equal(readQueryCache('account-a:announcements'), undefined);
  } finally {
    Date.now = originalNow;
    clearQueryCache();
  }
});

test('screen query passes scope and age, and session expiry purges memory cache', () => {
  const hook = fs.readFileSync(path.join(mobileRoot, 'src/hooks/useScreenQuery.ts'), 'utf8');
  const context = fs.readFileSync(path.join(mobileRoot, 'src/session/SessionContext.tsx'), 'utf8');
  const cacheSource = fs.readFileSync(path.join(mobileRoot, 'src/hooks/query-cache.ts'), 'utf8');
  assert.match(hook, /queryCacheKey\(session\.accountId, queryKey, options\.scope\)/);
  assert.match(hook, /readQueryCache<T>\(cacheKey, options\.maxAge\)/);
  assert.match(cacheSource, /export interface QueryCacheScope/);

  const expiryHandler = context.match(/setOnSessionExpired\(\(\) => \{([\s\S]*?)\n    \}\);/)?.[1];
  assert.ok(expiryHandler, 'SessionContext registers an expiry handler');
  assert.match(expiryHandler, /clearQueryCache\(\)/);

  writeQueryCache('account-a:grades', ['memory-only']);
  assert.deepEqual(readQueryCache('account-a:grades'), ['memory-only']);
  clearQueryCache();
  assert.equal(readQueryCache('account-a:grades'), undefined);
  assert.match(context, /await sessionStore\.signOut\(\);\s*\} finally \{[\s\S]*?clearQueryCache\(\)/);
});

test('cache implementation has no disk-backed academic or assistant storage path', () => {
  assert.match(source, /new Map<string, CacheEntry>\(\)/);
  assert.doesNotMatch(source, /AsyncStorage|SecureStore|FileSystem|writeAsStringAsync|setItemAsync/);
  assert.doesNotMatch(source, /grades|thesis|assistant/);
});
