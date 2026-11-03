import assert from 'node:assert/strict';
import test from 'node:test';

import { checkMigrationImmutability } from './check-migration-immutability.mjs';

function migration(version, description, blob, family = 'migration') {
  return {
    path: `java-services/restful-api/src/main/resources/db/${family}/V${version}__${description}.sql`,
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
