import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { resolveEvidenceDir } from './verify-ecosystem.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => readFileSync(path.join(repoRoot, relative), 'utf8');
const systemdService = read('ops/systemd/campuscore-backup.service');
const systemdReadme = read('ops/systemd/README.md');
const caddyfile = read('ops/caddy/Caddyfile');
const verifyEcosystem = read('scripts/verify-ecosystem.mjs');
const caddyReadme = existsSync(path.join(repoRoot, 'ops/caddy/README.md')) ? read('ops/caddy/README.md') : '';

test('systemd backup service declares the local Compose project', () => {
  assert.match(systemdService, /^Environment=COMPOSE_PROJECT_NAME=campusute$/m);
  assert.match(systemdReadme, /COMPOSE_PROJECT_NAME=campusute/);
});

test('Caddy allows five minutes for graceful stream shutdown', () => {
  const grace = caddyfile.match(/^\s*grace_period\s+(\d+)([smh])\s*$/m);
  assert.ok(grace, 'Caddy grace period is configured');
  const units = { s: 1, m: 60, h: 3600 };
  assert.ok(Number(grace[1]) * units[grace[2]] >= 300,
    'long assistant SSE responses get a five-minute graceful shutdown window');
  assert.match(caddyReadme, /five minutes/);
});

test('evidence directory boundary compares path segments and resolves symlinks', () => {
  assert.match(verifyEcosystem, /path\.relative\(/,
    'a sibling path sharing the repo prefix must not be considered inside');
  assert.match(verifyEcosystem, /realpathSync/,
    'an existing symlink target must be resolved before writing evidence');
  assert.doesNotMatch(verifyEcosystem, /evidenceDir\.startsWith\(REPO\)/);
});

test('evidence resolver rejects a sibling whose name starts with the repository name', () => {
  const parent = mkdtempSync(path.join(os.tmpdir(), 'evidence-boundary-'));
  const repo = path.join(parent, 'CampusUTE_EcoSystem');
  mkdirSync(repo, { recursive: true });
  try {
    assert.throws(
      () => resolveEvidenceDir(repo, '../CampusUTE_EcoSystemEvil'),
      /resolve inside the repository/,
    );
    assert.equal(
      resolveEvidenceDir(repo, 'artifacts/verification'),
      path.join(repo, 'artifacts', 'verification'),
    );
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});
