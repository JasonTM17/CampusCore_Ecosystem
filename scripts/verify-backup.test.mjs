import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-backup-'));
test.after(() => {
  // Only the known, newly created test fixture may be removed recursively.
  assert.equal(path.dirname(path.resolve(temp)), path.resolve(os.tmpdir()));
  assert.ok(path.basename(temp).startsWith('verify-backup-'));
  fs.rmSync(temp, { recursive: true, force: true });
});

const verifyScript = path.join(repo, 'ops', 'backup', 'verify-backup.sh');
const backupSource = fs.readFileSync(path.join(repo, 'ops', 'backup', 'backup-postgres.sh'), 'utf8');
const verifySource = fs.readFileSync(verifyScript, 'utf8');

function makeArchive(name, content) {
  const dir = fs.mkdtempSync(path.join(temp, `${name}-`));
  const archive = path.join(dir, `${name}.dump`);
  fs.writeFileSync(archive, content);
  const digest = crypto.createHash('sha256').update(content).digest('hex');
  // The sidecar records the archive basename, resolvable from the archive dir.
  fs.writeFileSync(`${archive}.sha256`, `${digest}  ${name}.dump\n`);
  return archive;
}

// On Windows the PATH ash can be the WSL launcher, which cannot read drive paths: prefer Git Bash.
const gitBash = 'C:\\Program Files\\Git\\bin\\bash.exe';
const bashCommand = process.platform === 'win32' && fs.existsSync(gitBash) ? gitBash : 'bash';
const posix = (file) => file.replaceAll('\\', '/');

function verify(archive, cwd) {
  return spawnSync(bashCommand, [posix(verifyScript), posix(archive)], { cwd, encoding: 'utf8', timeout: 10000 });
}

test('the checksum sidecar records a basename resolvable from the archive directory', () => {
  assert.match(backupSource, /cd "\$backup_dir"[\s\S]{0,160}?basename "\$archive"/,
    'the digest must be computed inside the backup dir so the recorded name is a basename');
  assert.doesNotMatch(backupSource, /sha256sum "\$archive" > "\$archive\.sha256"/,
    'a cwd-relative recorded path breaks verification outside the original cwd');
});

test('verify-backup.sh checks the archive from any working directory', () => {
  const archive = makeArchive('campuscore-anywhere', 'synthetic dump payload');
  const foreign = fs.mkdtempSync(path.join(temp, 'elsewhere-'));
  const fromForeign = verify(archive, foreign);
  assert.equal(fromForeign.status, 0, fromForeign.stderr);
  assert.match(fromForeign.stdout, /OK|Checksum verified/);
  const fromArchiveDir = verify(archive, path.dirname(archive));
  assert.equal(fromArchiveDir.status, 0, fromArchiveDir.stderr);
});

test('verify-backup.sh still fails on a corrupted archive', () => {
  const archive = makeArchive('campuscore-corrupt', 'synthetic dump payload');
  fs.appendFileSync(archive, 'tampered');
  const foreign = fs.mkdtempSync(path.join(temp, 'corrupt-cwd-'));
  const result = verify(archive, foreign);
  assert.notEqual(result.status, 0, 'a digest mismatch must not verify');
});
