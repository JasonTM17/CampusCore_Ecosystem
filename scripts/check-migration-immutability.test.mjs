import assert from 'node:assert/strict';
import test from 'node:test';

import { checkMigrationImmutability } from './check-migration-immutability.mjs';

function migration(version, description, blob, family = 'migration') {
  return {
    path: `java-services/restful-api/src/main/resources/db/${family}/V${version}__${description}.sql`,
    blob,
  };
}

function supabaseMigration(timestamp, description, blob) {
  return {
    path: `supabase/migrations/${timestamp}_${description}.sql`,
    blob,
  };
}

function check(baseline, head) {
  const trees = new Map([
    ['origin/main', baseline],
    ['HEAD', head],
  ]);
  return checkMigrationImmutability({
    baseRef: 'origin/main',
    readTree: async (ref) => trees.get(ref),
  });
}

test('unchanged migration content at the same version passes', async () => {
  const original = migration('10', 'create_items', 'blob-a');
  const result = await check([original], [original]);

  assert.equal(result.ok, true);
  assert.deepEqual(result.failures, []);
});

test('edited migration content fails', async () => {
  const result = await check(
    [migration('10', 'create_items', 'blob-a')],
    [migration('10', 'create_items', 'blob-b')]);

  assert.equal(result.ok, false);
  assert.equal(result.failures[0].path, migration('10', 'create_items', 'blob-a').path);
});

test('preserving old content under a new version does not protect the old migration', async () => {
  const original = migration('10', 'create_items', 'blob-a');
  const result = await check([original], [
    migration('10', 'create_items', 'blob-edited'),
    migration('11', 'copy_old_content', original.blob),
  ]);

  assert.equal(result.ok, false);
  assert.equal(result.failures[0].path, original.path);
});

test('renaming a migration while preserving its version and blob is allowed', async () => {
  const result = await check(
    [migration('10', 'old_name', 'blob-a')],
    [migration('10', 'new_name', 'blob-a')]);

  assert.equal(result.ok, true);
  assert.deepEqual(result.failures, []);
});

test('migration content cannot move between runtime families', async () => {
  const original = migration('10', 'create_items', 'blob-a');
  const result = await check(
    [original],
    [migration('10', 'create_items', 'blob-a', 'migration-h2')]);

  assert.equal(result.ok, false);
  assert.equal(result.failures[0].path, original.path);
});

test('deleting a baseline migration fails', async () => {
  const original = migration('10', 'create_items', 'blob-a');
  const result = await check([original], []);

  assert.equal(result.ok, false);
  assert.equal(result.failures[0].path, original.path);
});

test('adding a new migration does not fail immutability checks', async () => {
  const original = migration('10', 'create_items', 'blob-a');
  const result = await check([original], [
    original,
    migration('11', 'add_items', 'blob-b'),
  ]);

  assert.equal(result.ok, true);
  assert.deepEqual(result.failures, []);
});

test('unchanged supabase migration content at the same path passes', async () => {
  const original = supabaseMigration('20260101000000', 'create_items', 'blob-a');
  const result = await check([original], [original]);

  assert.equal(result.ok, true);
  assert.deepEqual(result.failures, []);
});

test('editing a baseline supabase migration fails', async () => {
  const original = supabaseMigration('20260101000000', 'create_items', 'blob-a');
  const result = await check([original], [
    supabaseMigration('20260101000000', 'create_items', 'blob-b'),
  ]);

  assert.equal(result.ok, false);
  assert.equal(result.failures[0].path, original.path);
});

test('deleting a baseline supabase migration fails', async () => {
  const original = supabaseMigration('20260101000000', 'create_items', 'blob-a');
  const result = await check([original], []);

  assert.equal(result.ok, false);
  assert.equal(result.failures[0].path, original.path);
});

test('renaming a baseline supabase migration fails', async () => {
  const original = supabaseMigration('20260101000000', 'create_items', 'blob-a');
  const result = await check([original], [
    supabaseMigration('20260101000000', 'rename_items', original.blob),
  ]);

  assert.equal(result.ok, false);
  assert.equal(result.failures[0].path, original.path);
});

test('adding a later supabase migration does not fail immutability checks', async () => {
  const original = supabaseMigration('20260101000000', 'create_items', 'blob-a');
  const result = await check([original], [
    original,
    supabaseMigration('20260102000000', 'add_items', 'blob-b'),
  ]);

  assert.equal(result.ok, true);
  assert.deepEqual(result.failures, []);
});

test('a base ref equal to HEAD compares the previous revision and rejects an edited V147', async () => {
  const original = migration('147', 'existing_index', 'blob-original');
  const edited = { ...original, blob: 'blob-edited' };
  const result = await checkMigrationImmutability({
    baseRef: 'HEAD',
    readTree: async (ref) => ref === 'HEAD^' ? [original] : [edited],
  });
  assert.equal(result.ok, false);
  assert.equal(result.failures[0].path, original.path);
});

for (const previousRef of ['push-before', '0'.repeat(40)]) {
  test(`equal resolved commits use the previous push revision (${previousRef})`, async () => {
    const original = migration('147', 'existing_index', 'blob-original');
    const reads = [];
    const expected = previousRef.startsWith('000') ? 'HEAD^' : previousRef;
    const result = await checkMigrationImmutability({
      baseRef: 'origin/main', previousRef,
      resolveRef: async () => 'same-commit',
      readTree: async (ref) => {
        reads.push(ref);
        return ref === expected ? [original] : [{ ...original, blob: 'blob-edited' }];
      },
    });
    assert.equal(result.ok, false);
    assert.equal(result.failures[0].path, original.path);
    assert.ok(reads.includes(expected));
  });
}

test('pull request comparison retains the main baseline when revisions differ', async () => {
  const original = migration('147', 'existing_index', 'blob-original');
  const reads = [];
  const result = await checkMigrationImmutability({
    baseRef: 'origin/main', previousRef: 'push-before',
    resolveRef: async (ref) => ref,
    readTree: async (ref) => { reads.push(ref); return [original]; },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(reads, ['origin/main', 'HEAD']);
});
