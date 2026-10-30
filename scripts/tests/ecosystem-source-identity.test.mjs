import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { captureSourceIdentity } from '../ecosystem-source-identity.mjs';

test('source identity detects unstaged/new/deleted inputs and excludes secrets/output', () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'campusute-source-'));
  try {
    execFileSync('git', ['init', '--quiet', fixture]);
    fs.mkdirSync(path.join(fixture, 'scripts'));
    const tracked = path.join(fixture, 'scripts', 'tracked.mjs');
    fs.writeFileSync(tracked, 'export const value = 1;\n');
    execFileSync('git', ['add', '--', 'scripts/tracked.mjs'], { cwd: fixture });
    const initial = captureSourceIdentity(fixture);
    fs.writeFileSync(tracked, 'export const value = 2;\n');
    const changed = captureSourceIdentity(fixture);
    assert.notEqual(changed.sha256, initial.sha256);
    fs.writeFileSync(path.join(fixture, 'scripts', 'new.mjs'), 'export {};\n');
    const added = captureSourceIdentity(fixture);
    assert.notEqual(added.sha256, changed.sha256);
    assert.equal(added.fileCount, 2);
    fs.writeFileSync(path.join(fixture, 'scripts', '.env.local'), 'PRIVATE_VALUE');
    fs.writeFileSync(path.join(fixture, 'scripts', 'fixture.key'), 'PRIVATE_KEY');
    assert.equal(captureSourceIdentity(fixture).sha256, added.sha256);
    fs.unlinkSync(tracked);
    assert.equal(captureSourceIdentity(fixture).files['scripts/tracked.mjs'], 'DELETED');

    // ops/ and database/ hold deploy and recovery inputs; editing them must
    // move the identity digest like any other source lane.
    fs.mkdirSync(path.join(fixture, 'ops', 'monitoring'), { recursive: true });
    fs.mkdirSync(path.join(fixture, 'database'), { recursive: true });
    const alertFile = path.join(fixture, 'ops', 'monitoring', 'alerts.yml');
    fs.writeFileSync(alertFile, 'groups: []\n');
    fs.writeFileSync(path.join(fixture, 'database', 'Dockerfile'), 'FROM postgres:16\n');
    const withOps = captureSourceIdentity(fixture);
    assert.ok(withOps.files['ops/monitoring/alerts.yml'], 'ops inputs must join the identity');
    assert.ok(withOps.files['database/Dockerfile'], 'database inputs must join the identity');
    fs.writeFileSync(alertFile, 'groups: [changed]\n');
    assert.notEqual(captureSourceIdentity(fixture).sha256, withOps.sha256);
  } finally {
    const resolved = path.resolve(fixture);
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
    assert.ok(path.basename(resolved).startsWith('campusute-source-'));
    fs.rmSync(resolved, { recursive: true, force: true });
  }
});
