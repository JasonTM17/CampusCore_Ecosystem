import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const script = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), 'ecosystem-backup-drill.mjs'), 'utf8');

test('the Flyway history probe targets the application default schema', () => {
  // application.yml sets spring.flyway.default-schema=thesis, so the history
  // table only exists as thesis.flyway_schema_history; an unqualified name
  // resolves through search_path and fails on this drill's database.
  assert.ok(script.includes('thesis.flyway_schema_history'),
    'the drill must qualify the history table with the thesis schema');
  assert.doesNotMatch(script, /FROM\s+flyway_schema_history/i,
    'an unqualified flyway_schema_history misses the thesis schema');
});
