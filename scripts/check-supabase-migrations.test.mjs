import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const script = path.join(repoRoot, 'scripts', 'check-supabase-migrations.mjs');

function runIn(directory) {
  return spawnSync(process.execPath, [script], { cwd: directory, encoding: 'utf8' });
}

function run(files) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'supabase-migrations-'));
  try {
    const migrations = path.join(root, 'supabase', 'migrations');
    mkdirSync(migrations, { recursive: true });
    for (const [name, content] of Object.entries(files)) {
      writeFileSync(path.join(migrations, name), content, 'utf8');
    }
    return runIn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('the repository migrations pass the gate', () => {
  const result = runIn(repoRoot);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^checked \d+ migration files in supabase\/migrations$/m);
  assert.match(result.stdout, /^SUPABASE MIGRATION NAMES PASS$/m);
});

test('a malformed migration filename fails', () => {
  const result = run({ '2026010100000_short.sql': 'select 1;\n' });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /bad migration filename: 2026010100000_short\.sql/);
});

test('duplicate timestamps fail', () => {
  const result = run({
    '20260101000000_first.sql': 'select 1;\n',
    '20260101000000_second.sql': 'select 2;\n',
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /duplicate migration timestamp 20260101000000: 20260101000000_first\.sql and 20260101000000_second\.sql/);
});

test('duplicate names fail', () => {
  const result = run({
    '20260101000000_shared_name.sql': 'select 1;\n',
    '20260102000000_shared_name.sql': 'select 2;\n',
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /duplicate migration name shared_name: 20260101000000_shared_name\.sql and 20260102000000_shared_name\.sql/);
});

test('empty migration files fail', () => {
  const result = run({ '20260101000000_empty.sql': '' });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /empty migration file: 20260101000000_empty\.sql/);
});
