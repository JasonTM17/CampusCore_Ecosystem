import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  verifyMigrationLineage,
  DEFAULT_MIGRATIONS_DIR,
  DEFAULT_ALLOWED_GAPS
} from './flyway-lineage-check.mjs';

function createTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'flyway-test-'));
}

function cleanupTempDir(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors in temporary directory
  }
}

test('flyway-lineage-check: real repository migration directory passes verification', () => {
  const result = verifyMigrationLineage();

  assert.equal(result.success, true, 'Verification of real migrations should succeed');
  assert.equal(result.filesCount, 142, 'Should have exactly 142 migration files');
  assert.equal(result.minVersion, 1, 'Minimum version should be 1');
  assert.equal(result.maxVersion, 145, 'Maximum version should be 145');
  assert.deepEqual(result.duplicates, [], 'Should have zero duplicates');
  assert.deepEqual(result.unexpectedGaps, [], 'Should have zero unexpected gaps');
  assert.deepEqual(result.allowedGapsFound, [56, 91, 119], 'Should verify exactly the allowed gaps [56, 91, 119]');
  assert.deepEqual(result.namingErrors, [], 'Should have zero naming errors');
});

test('flyway-lineage-check: detects duplicate migration versions', () => {
  const tempDir = createTempDir();
  try {
    fs.writeFileSync(path.join(tempDir, 'V1__initial.sql'), '-- schema');
    fs.writeFileSync(path.join(tempDir, 'V1__duplicate.sql'), '-- duplicate');
    fs.writeFileSync(path.join(tempDir, 'V2__next.sql'), '-- next');

    const result = verifyMigrationLineage({ dir: tempDir, allowedGaps: [] });

    assert.equal(result.success, false);
    assert.equal(result.duplicates.length, 1);
    assert.equal(result.duplicates[0].version, 1);
    assert.equal(result.duplicates[0].files.length, 2);
  } finally {
    cleanupTempDir(tempDir);
  }
});

test('flyway-lineage-check: detects unexpected gaps not present in allowlist', () => {
  const tempDir = createTempDir();
  try {
    fs.writeFileSync(path.join(tempDir, 'V1__initial.sql'), '-- 1');
    fs.writeFileSync(path.join(tempDir, 'V2__step.sql'), '-- 2');
    fs.writeFileSync(path.join(tempDir, 'V4__skipped.sql'), '-- 4'); // Gap at 3

    const result = verifyMigrationLineage({ dir: tempDir, allowedGaps: [] });

    assert.equal(result.success, false);
    assert.deepEqual(result.unexpectedGaps, [3]);
    assert.deepEqual(result.allowedGapsFound, []);
  } finally {
    cleanupTempDir(tempDir);
  }
});

test('flyway-lineage-check: allows explicit gaps documented in allowlist', () => {
  const tempDir = createTempDir();
  try {
    fs.writeFileSync(path.join(tempDir, 'V1__initial.sql'), '-- 1');
    fs.writeFileSync(path.join(tempDir, 'V2__step.sql'), '-- 2');
    fs.writeFileSync(path.join(tempDir, 'V4__skipped.sql'), '-- 4'); // Gap at 3

    const result = verifyMigrationLineage({ dir: tempDir, allowedGaps: [3] });

    assert.equal(result.success, true);
    assert.deepEqual(result.unexpectedGaps, []);
    assert.deepEqual(result.allowedGapsFound, [3]);
  } finally {
    cleanupTempDir(tempDir);
  }
});

test('flyway-lineage-check: detects invalid filenames and non-positive versions', () => {
  const tempDir = createTempDir();
  try {
    fs.writeFileSync(path.join(tempDir, 'V0__zero_version.sql'), '-- 0');
    fs.writeFileSync(path.join(tempDir, 'V1_single_underscore.sql'), '-- wrong separator');
    fs.writeFileSync(path.join(tempDir, 'migration.sql'), '-- no version prefix');
    fs.writeFileSync(path.join(tempDir, 'untracked.txt'), 'some text');

    const result = verifyMigrationLineage({ dir: tempDir });

    assert.equal(result.success, false);
    assert.ok(result.namingErrors.length >= 4, `Expected at least 4 naming errors, got ${result.namingErrors.length}`);
  } finally {
    cleanupTempDir(tempDir);
  }
});

test('flyway-lineage-check: ignores recognized non-migration documentation files like README.md', () => {
  const tempDir = createTempDir();
  try {
    fs.writeFileSync(path.join(tempDir, 'V1__initial.sql'), '-- 1');
    fs.writeFileSync(path.join(tempDir, 'README.md'), '# Documentation');
    fs.writeFileSync(path.join(tempDir, '.gitkeep'), '');

    const result = verifyMigrationLineage({ dir: tempDir, allowedGaps: [] });

    assert.equal(result.success, true);
    assert.equal(result.filesCount, 1);
    assert.deepEqual(result.namingErrors, []);
  } finally {
    cleanupTempDir(tempDir);
  }
});

test('flyway-lineage-check: fails gracefully on missing or invalid directory', () => {
  const nonExistent = path.join(os.tmpdir(), 'non-existent-dir-' + Date.now());
  const result = verifyMigrationLineage({ dir: nonExistent });

  assert.equal(result.success, false);
  assert.equal(result.filesCount, 0);
  assert.ok(result.namingErrors.length > 0);
});

test('flyway-lineage-check: CLI invocation succeeds with default options', () => {
  const scriptPath = path.resolve('scripts/flyway-lineage-check.mjs');
  const stdout = execFileSync(process.execPath, [scriptPath], { encoding: 'utf8' });

  assert.match(stdout, /Checked 142 migration files/);
  assert.match(stdout, /Version range: V1 to V145/);
  assert.match(stdout, /Allowed gaps verified: V56, V91, V119/);
  assert.match(stdout, /MIGRATION LINEAGE PASS/);
});

test('flyway-lineage-check: CLI supports --json format', () => {
  const scriptPath = path.resolve('scripts/flyway-lineage-check.mjs');
  const stdout = execFileSync(process.execPath, [scriptPath, '--json'], { encoding: 'utf8' });

  const parsed = JSON.parse(stdout);
  assert.equal(parsed.success, true);
  assert.equal(parsed.filesCount, 142);
  assert.equal(parsed.minVersion, 1);
  assert.equal(parsed.maxVersion, 145);
  assert.deepEqual(parsed.allowedGapsFound, [56, 91, 119]);
});

test('flyway-lineage-check: CLI fails when gap is not allowlisted', () => {
  const scriptPath = path.resolve('scripts/flyway-lineage-check.mjs');
  let threw = false;

  try {
    // Only allow gap 56 and 91, but omit 119
    execFileSync(process.execPath, [scriptPath, '--allow-gaps', '56,91'], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe']
    });
  } catch (err) {
    threw = true;
    assert.equal(err.status, 1);
    const combinedOutput = (err.stdout || '') + (err.stderr || '');
    assert.match(combinedOutput, /FAIL Unexpected migration gap at V119/);
  }

  assert.equal(threw, true, 'CLI should exit with code 1 when an unexpected gap exists');
});
