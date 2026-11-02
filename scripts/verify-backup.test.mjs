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
const backupScript = path.join(repo, 'ops', 'backup', 'backup-postgres.sh');
const restoreScript = path.join(repo, 'ops', 'backup', 'restore-postgres.sh');
const backupSource = fs.readFileSync(path.join(repo, 'ops', 'backup', 'backup-postgres.sh'), 'utf8');
const verifySource = fs.readFileSync(verifyScript, 'utf8');
const restoreSource = fs.readFileSync(restoreScript, 'utf8');

function makeShellEnv(source) {
  const file = path.join(temp, `bash-env-${crypto.randomUUID()}.sh`);
  fs.writeFileSync(file, source, 'utf8');
  return { BASH_ENV: posix(file) };
}

const validToc = [
  '1; 0 0 TABLE DATA thesis flyway_schema_history campuscore',
  '2; 0 0 TABLE DATA academic academic_term campuscore',
].join('\n');

function archiveChecksum(archive, reports) {
  const lines = [archive, reports].map((file) => {
    const digest = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    return `${digest}  ${path.basename(file)}`;
  });
  fs.writeFileSync(`${archive}.sha256`, `${lines.join('\n')}\n`);
}

function makeArchive(name, content) {
  const dir = fs.mkdtempSync(path.join(temp, `${name}-`));
  const archive = path.join(dir, `${name}.dump`);
  fs.writeFileSync(archive, content);
  const reportDir = path.join(dir, 'report-files');
  fs.mkdirSync(reportDir);
  fs.writeFileSync(path.join(reportDir, 'report.pdf'), 'synthetic report bytes');
  const reports = path.join(dir, `${name}.reports.tar`);
  const tar = spawnSync('tar', ['-cf', reports, '-C', reportDir, '.'], { encoding: 'utf8' });
  assert.equal(tar.status, 0, tar.stderr);
  archiveChecksum(archive, reports);
  return archive;
}

// On Windows the PATH ash can be the WSL launcher, which cannot read drive paths: prefer Git Bash.
const gitBash = 'C:\\Program Files\\Git\\bin\\bash.exe';
const bashCommand = process.platform === 'win32' && fs.existsSync(gitBash) ? gitBash : 'bash';
const posix = (file) => file.replaceAll('\\', '/');

function verify(archive, cwd, env = {}) {
  return spawnSync(bashCommand, [posix(verifyScript), posix(archive)], {
    cwd, encoding: 'utf8', timeout: 10000,
    env: { ...process.env, COMPOSE_PROJECT_NAME: 'campusute', ...env },
  });
}

function restore(archive, targetDb, env = {}) {
  return spawnSync(bashCommand, [posix(restoreScript), posix(archive), targetDb], {
    cwd: repo, encoding: 'utf8', timeout: 10000,
    env: { ...process.env, COMPOSE_PROJECT_NAME: 'campusute', ...env },
  });
}

function dockerReadBundleEnv(toc = validToc) {
  return makeShellEnv(`
docker() {
  case "$*" in
    *pg_restore*) printf '%s\\n' ${JSON.stringify(toc)};;
    *'tar -tf'*) printf '%s\\n' './report.pdf';;
    *) printf 'unexpected docker command' >&2; return 90;;
  esac
}
`);
}

test('the checksum sidecar records a basename resolvable from the archive directory', () => {
  assert.match(backupSource, /cd "\$staging"[\s\S]{0,180}?basename "\$staged_archive"/,
    'the digest must be computed inside the backup dir so the recorded name is a basename');
  assert.doesNotMatch(backupSource, /sha256sum "\$archive" > "\$archive\.sha256"/,
    'a cwd-relative recorded path breaks verification outside the original cwd');
});

test('verify-backup.sh checks the archive from any working directory', () => {
  const archive = makeArchive('campuscore-anywhere', 'synthetic dump payload');
  const foreign = fs.mkdtempSync(path.join(temp, 'elsewhere-'));
  const env = dockerReadBundleEnv();
  const fromForeign = verify(archive, foreign, env);
  assert.equal(fromForeign.status, 0, fromForeign.stderr);
  assert.match(fromForeign.stdout, /OK|Checksum verified/);
  const fromArchiveDir = verify(archive, path.dirname(archive), env);
  assert.equal(fromArchiveDir.status, 0, fromArchiveDir.stderr);
});

test('verify-backup.sh still fails on a corrupted archive', () => {
  const archive = makeArchive('campuscore-corrupt', 'synthetic dump payload');
  fs.appendFileSync(archive, 'tampered');
  const foreign = fs.mkdtempSync(path.join(temp, 'corrupt-cwd-'));
  const result = verify(archive, foreign, dockerReadBundleEnv());
  assert.notEqual(result.status, 0, 'a digest mismatch must not verify');
});

test('verify-backup.sh rejects a checksum-valid archive without application history', () => {
  const archive = makeArchive('campuscore-empty', 'valid but empty custom archive');
  const env = dockerReadBundleEnv('1; 0 0 SCHEMA - - - campuscore');
  const result = verify(archive, path.dirname(archive), env);
  assert.notEqual(result.status, 0, 'a valid checksum cannot make an empty database a recoverable backup');
  assert.match(result.stderr, /application.*history|flyway_schema_history/i);
});

test('backup-postgres.sh publishes the dump and report volume as one checksummed bundle', () => {
  const outputDir = fs.mkdtempSync(path.join(temp, 'bundle-'));
  const env = makeShellEnv(`
docker() {
  case "$*" in
    *pg_dump*) printf 'synthetic database archive';;
    *pg_restore*) printf '%s\\n' ${JSON.stringify(validToc)};;
    *'tar -tf'*) printf '%s\\n' './report.pdf';;
    *tar*) printf 'synthetic report volume archive';;
    *) printf 'unexpected docker command' >&2; return 90;;
  esac
}
`);
  const result = spawnSync(bashCommand, [posix(backupScript)], {
    cwd: repo,
    encoding: 'utf8',
    timeout: 10000,
    env: {
      ...process.env,
      ...env,
      COMPOSE_PROJECT_NAME: 'campusute',
      BACKUP_DIR: posix(outputDir),
      BACKUP_RETENTION_DAYS: '14',
    },
  });
  assert.equal(result.status, 0, result.stderr);
  const entries = fs.readdirSync(outputDir);
  assert.equal(entries.filter((name) => name.endsWith('.dump')).length, 1);
  assert.equal(entries.filter((name) => name.endsWith('.reports.tar')).length, 1);
  const sidecar = entries.find((name) => name.endsWith('.dump.sha256'));
  assert.ok(sidecar, 'bundle checksum sidecar exists');
  const checksums = fs.readFileSync(path.join(outputDir, sidecar), 'utf8');
  assert.match(checksums, /campuscore-.*\.dump\n/);
  assert.match(checksums, /campuscore-.*\.reports\.tar\n/);
  assert.doesNotMatch(entries.join('\n'), /partial|\.tmp/);
});

test('backup-postgres.sh publishes the dump only after its bundle companions', () => {
  const reportsPublish = backupSource.indexOf('mv -- "$staged_reports" "$reports_archive"');
  const checksumPublish = backupSource.indexOf('mv -- "$staged_checksum" "$checksum"');
  const dumpPublish = backupSource.indexOf('mv -- "$staged_archive" "$archive"');
  assert.ok(reportsPublish >= 0 && checksumPublish > reportsPublish && dumpPublish > checksumPublish,
    'the .dump name must appear last so interruption cannot leave a lone archive that looks complete');
});

test('backup-postgres.sh removes a partial dump when pg_dump fails', () => {
  const outputDir = fs.mkdtempSync(path.join(temp, 'failed-dump-'));
  const env = makeShellEnv(`
docker() {
  case "$*" in
    *pg_dump*) printf 'truncated'; return 23;;
    *) return 90;;
  esac
}
`);
  const result = spawnSync(bashCommand, [posix(backupScript)], {
    cwd: repo,
    encoding: 'utf8',
    timeout: 10000,
    env: {
      ...process.env,
      ...env,
      COMPOSE_PROJECT_NAME: 'campusute',
      BACKUP_DIR: posix(outputDir),
    },
  });
  assert.notEqual(result.status, 0, 'failed pg_dump must reach the caller');
  assert.doesNotMatch(fs.readdirSync(outputDir).join('\n'), /\.dump|\.reports\.tar|\.sha256/,
    'a partial artifact must not remain under a successful backup name');
  assert.doesNotMatch(result.stdout, /Backup written/);
});

test('restore-postgres.sh uses one transaction and limits targets to new restore databases', () => {
  assert.match(restoreSource, /--single-transaction/,
    'pg_restore must not leave partial user objects after an error');
  assert.match(restoreSource, /campuscore_restore_/,
    'restore targets must use the isolated restore namespace');
  assert.match(restoreSource, /target database already exists|database already exists/i,
    'an existing target must be refused before any restore starts');
  assert.match(restoreSource, /DROP DATABASE/,
    'a target created by this script must be removed after a failed restore');
});

test('restore-postgres.sh removes only the database it created after pg_restore fails', () => {
  const archive = makeArchive('campuscore-restore-failure', 'synthetic database archive');
  const dropMarker = path.join(path.dirname(archive), 'drop-called');
  const env = makeShellEnv(`
docker() {
  case "$*" in
    *pg_restore*--list*) printf '%s\\n' ${JSON.stringify(validToc)};;
    *'tar -tf'*) printf '%s\\n' './report.pdf';;
    *'SELECT 1 FROM pg_database'*) return 0;;
    *'CREATE DATABASE'*) return 0;;
    *'pg_restore --single-transaction'*) return 23;;
    *'DROP DATABASE'*) printf 'dropped' > "$FAKE_DROP_MARKER"; return 0;;
    *) printf 'unexpected docker command' >&2; return 90;;
  esac
}
`);
  const result = restore(archive, 'campuscore_restore_fixture', {
    ...env,
    FAKE_DROP_MARKER: posix(dropMarker),
  });
  assert.equal(result.status, 23, result.stderr);
  assert.equal(fs.readFileSync(dropMarker, 'utf8'), 'dropped', 'failure cleanup drops the newly created target');
  assert.equal(fs.existsSync(`${archive.slice(0, -'.dump'.length)}.reports.restore`), false,
    'failed restore removes its staged report files');
  assert.doesNotMatch(result.stdout, /Restored /);
});

test('backup and restore require an explicit Compose project', () => {
  assert.doesNotMatch(backupSource, /COMPOSE_PROJECT_NAME:-campuscore-production/);
  assert.doesNotMatch(verifySource, /COMPOSE_PROJECT_NAME:-campuscore-production/);
  assert.doesNotMatch(restoreSource, /COMPOSE_PROJECT_NAME:-campuscore-production/);
});
