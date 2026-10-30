import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, '..', '..');
const manifestPath = path.join(repoRoot, 'frontend', 'public', 'images', 'asset-manifest.json');
const checkScript = path.join(repoRoot, 'scripts', 'check-public-image-provenance.mjs');

test('asset manifest exists and satisfies provenance schema for all banners and events', () => {
  assert.ok(existsSync(manifestPath), 'asset-manifest.json must exist');
  const raw = readFileSync(manifestPath, 'utf8');
  const entries = JSON.parse(raw);
  assert.ok(Array.isArray(entries), 'manifest must be an array of entries');

  const bannerDir = path.join(repoRoot, 'frontend', 'public', 'images', 'banners');
  const eventDir = path.join(repoRoot, 'frontend', 'public', 'images', 'events');
  const bannerFiles = readdirSync(bannerDir);
  const eventFiles = readdirSync(eventDir);
  const expectedTotal = bannerFiles.length + eventFiles.length;

  assert.equal(entries.length, expectedTotal, `expected ${expectedTotal} entries in asset manifest`);

  const requiredFields = [
    'path',
    'sha256',
    'bytes',
    'referencedBy',
    'alt',
    'source',
    'rights',
    'depiction',
    'verifiedBy',
    'verifiedOn',
  ];

  for (const entry of entries) {
    for (const field of requiredFields) {
      assert.ok(field in entry, `entry ${entry.path} must contain field "${field}"`);
    }

    assert.equal(typeof entry.path, 'string');
    assert.match(entry.sha256, /^[0-9a-f]{64}$/);
    assert.ok(Number.isSafeInteger(entry.bytes) && entry.bytes > 0);
    assert.ok(Array.isArray(entry.referencedBy));
    assert.ok(entry.alt === null || typeof entry.alt === 'string');

    // Baseline unverified invariant: never infer a license or source without owner verification
    assert.equal(entry.source, 'UNVERIFIED');
    assert.equal(entry.rights, 'UNVERIFIED');
    assert.equal(entry.depiction, 'UNVERIFIED');
    assert.equal(entry.verifiedBy, null);
    assert.equal(entry.verifiedOn, null);

    // Verify disk parity
    const resolvedPath = path.join(repoRoot, entry.path);
    assert.ok(existsSync(resolvedPath), `file must exist on disk: ${resolvedPath}`);
    const buf = readFileSync(resolvedPath);
    const hash = createHash('sha256').update(buf).digest('hex');
    assert.equal(entry.sha256, hash, `sha256 mismatch for ${entry.path}`);
    assert.equal(entry.bytes, statSync(resolvedPath).size, `bytes mismatch for ${entry.path}`);
  }
});

test('manifest isolates public banners and events from news cover media', () => {
  const entries = JSON.parse(readFileSync(manifestPath, 'utf8'));
  for (const entry of entries) {
    assert.ok(
      !entry.path.includes('/news/') && !entry.path.includes('\\news\\'),
      `entry ${entry.path} must not include news directory`
    );
  }
});

test('check-public-image-provenance script exits 0 on valid unverified manifest', () => {
  const result = spawnSync(process.execPath, [checkScript, manifestPath], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, `expected check script to pass: ${result.stderr}`);
  assert.match(result.stdout, /Static media provenance manifest is valid/);
});

test('check-public-image-provenance script fails with --require-verified gate flag', () => {
  const result = spawnSync(process.execPath, [checkScript, '--require-verified', manifestPath], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.notEqual(result.status, 0, 'expected check script to exit nonzero when unverified entries exist');
  const combined = result.stdout + result.stderr;
  assert.match(combined, /publication gate failed/);
});

test('check-public-image-provenance script rejects missing files and digest discrepancies', (t) => {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'image-provenance-test-'));
  t.after(() => rmSync(tmpDir, { recursive: true, force: true }));

  const entries = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const tamperedEntries = entries.map((entry, idx) => {
    if (idx === 0) {
      return { ...entry, sha256: '0000000000000000000000000000000000000000000000000000000000000000' };
    }
    return entry;
  });

  const tamperedPath = path.join(tmpDir, 'tampered-manifest.json');
  writeFileSync(tamperedPath, JSON.stringify(tamperedEntries, null, 2), 'utf8');

  const result = spawnSync(process.execPath, [checkScript, tamperedPath], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.notEqual(result.status, 0, 'expected tampered sha256 to cause validation error');
  const combined = result.stdout + result.stderr;
  assert.match(combined, /sha256 mismatch/);
});
