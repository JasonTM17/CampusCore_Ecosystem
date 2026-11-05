import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveBashCommand } from './bash-command.mjs';
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
  '3; 0 0 TABLE thesis thesis_group_report campuscore',
  '4; 0 0 TABLE DATA thesis thesis_group_report campuscore',
].join('\n');
const reportTableWithoutDataToc = [
  '1; 0 0 TABLE DATA thesis flyway_schema_history campuscore',
  '2; 0 0 TABLE DATA academic academic_term campuscore',
  '3; 0 0 TABLE thesis thesis_group_report campuscore',
].join('\n');

function reportCopy(rows = []) {
  return [
    'COPY thesis.thesis_group_report (storage_provider, storage_bucket, storage_key, file_sha256) FROM stdin;',
    ...rows.map(({ provider = 'local', bucket = 'reports', key }) => `${provider}\t${bucket}\t${key}\t\\N`),
    '\\.',
  ].join('\n');
}

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
  // A drive-letter path reads as a remote host to GNU tar; a relative name works with every tar.
  const tar = spawnSync('tar', ['-cf', path.basename(reports), '-C', reportDir, '.'], { encoding: 'utf8', cwd: dir });
  assert.equal(tar.status, 0, tar.stderr);
  archiveChecksum(archive, reports);
  return archive;
}

// On Windows the PATH ash can be the WSL launcher, which cannot read drive paths: prefer Git Bash.
const bashCommand = resolveBashCommand();
const posix = (file) => file.replaceAll('\\', '/');

function verify(archive, cwd, env = {}) {
  return spawnSync(bashCommand, [posix(verifyScript), posix(archive)], {
    cwd, encoding: 'utf8', timeout: 60000,
    env: { ...process.env, COMPOSE_PROJECT_NAME: 'campusute', ...env },
  });
}

function restore(archive, targetDb, env = {}) {
  return spawnSync(bashCommand, [posix(restoreScript), posix(archive), targetDb], {
    cwd: repo, encoding: 'utf8', timeout: 60000,
    env: { ...process.env, COMPOSE_PROJECT_NAME: 'campusute', ...env },
  });
}

function dockerReadBundleEnv(toc = validToc) {
  return makeShellEnv(`
docker() {
  case "$*" in
    *'pg_restore --data-only'*) printf '%s\\n' 'COPY thesis.thesis_group_report (storage_provider, storage_bucket, storage_key) FROM stdin;' '\\.';;
    *pg_restore*) printf '%b\\n' ${JSON.stringify(toc)};;
    *'tar -tf'*) printf '%s\\n' './report.pdf';;
    *'tar -tvf'*) printf '%s\\n' '-rw-r--r-- 0/0 10 2026-11-03 00:00 ./report.pdf';;
    *) printf 'unexpected docker command' >&2; return 90;;
  esac
}
`);
}

function makePathShim(name, body) {
  const directory = fs.mkdtempSync(path.join(temp, 'shim-'));
  const file = path.join(directory, name);
  fs.writeFileSync(file, `#!/usr/bin/env bash\nset -eu\n${body}\n`, 'utf8');
  fs.chmodSync(file, 0o700);
  return { env: { PATH: `${posix(directory)}${path.delimiter}${process.env.PATH}` } };
}

function reportPairDockerShim() {
  return makePathShim('docker', `
case "$*" in
  *'pg_restore --list'*) printf '%s\\n' "$FAKE_TOC";;
  *'pg_restore --data-only'*) printf '%s\\n' "$FAKE_REPORT_COPY";;
  *'tar -tf -'*) printf '%s\\n' "$FAKE_TAR_ENTRIES";;
  *'tar -tvf -'*) printf '%s\\n' "$FAKE_TAR_TYPES";;
  *'SELECT 1 FROM pg_database'*) : > "$FAKE_DATABASE_PROBE";;
  *) printf 'unexpected docker command\\n' >&2; exit 90;;
esac
`);
}

function reportPairEnv(shim, { data = reportCopy(), entries = './report.pdf', types = '-rw-r--r-- 0/0 10 2026-11-03 00:00 ./report.pdf' } = {}) {
  return {
    ...shim.env,
    FAKE_TOC: validToc,
    FAKE_REPORT_COPY: data,
    FAKE_TAR_ENTRIES: entries,
    FAKE_TAR_TYPES: types,
  };
}

function retryCaptureDockerShim() {
  return makePathShim('docker', `
case "$*" in
  *pg_dump*)
    if [[ -f "$FAKE_COUNT_FILE" ]]; then count="$(cat "$FAKE_COUNT_FILE")"; else count=0; fi
    count=$((count + 1))
    printf '%s' "$count" > "$FAKE_COUNT_FILE"
    printf 'dump-%s' "$count"
    ;;
  *'pg_restore --list'*) printf '%s\\n' "$FAKE_TOC";;
  *'pg_restore --data-only'*)
    dump="$(cat)"
    if [[ "$dump" == dump-1 ]]; then printf '%s\\n' "$FAKE_FIRST_COPY"; else printf '%s\\n' "$FAKE_SECOND_COPY"; fi
    ;;
  *'exec -T restful-api sh -ceu'*)
    count="$(cat "$FAKE_COUNT_FILE")"
    printf 'reports-%s' "$count"
    ;;
  *'tar -tf -'*) cat >/dev/null; printf '%s\\n' "./$FAKE_TAR_KEY";;
  *) printf 'unexpected docker command\\n' >&2; exit 90;;
esac
`);
}

function checksumLine(file, name = path.basename(file)) {
  const digest = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  return `${digest}  ${name}`;
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

test('verify-backup.sh accepts a dump and report archive with matching storage keys', () => {
  const key = 'thesis-reports/group-a/current.pdf';
  const archive = makeArchive('campuscore-report-pair', 'synthetic database archive');
  const shim = reportPairDockerShim();
  const result = verify(archive, path.dirname(archive), reportPairEnv(shim, {
    data: reportCopy([{ key }]),
    entries: `./${key}`,
  }));
  assert.equal(result.status, 0, result.stderr);
});

test('verify-backup.sh rejects a report table without archived table data', () => {
  const archive = makeArchive('campuscore-report-data-omitted', 'synthetic database archive');
  const shim = reportPairDockerShim();
  const result = verify(archive, path.dirname(archive), {
    ...reportPairEnv(shim),
    FAKE_TOC: reportTableWithoutDataToc,
  });
  assert.notEqual(result.status, null, result.error?.message);
  assert.notEqual(result.status, 0, 'a report table without its data is not a complete backup');
  assert.match(result.stderr, /report.*(table )?data|table data.*report/i);
});

test('verify-backup.sh rejects a missing report key without printing the key', () => {
  const key = 'thesis-reports/private-student-folder/report.pdf';
  const archive = makeArchive('campuscore-report-missing', 'synthetic database archive');
  const shim = reportPairDockerShim();
  const result = verify(archive, path.dirname(archive), reportPairEnv(shim, {
    data: reportCopy([{ key }]),
    entries: './thesis-reports/group-a/current.pdf',
  }));
  assert.notEqual(result.status, null, result.error?.message);
  assert.notEqual(result.status, 0, 'a database reference absent from the report archive is unrecoverable');
  assert.match(result.stderr, /missing.*1|1.*missing/i, 'the generic failure should report the missing count');
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, new RegExp(key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    'storage keys can contain personal data and must not be printed');
});

test('verify-backup.sh treats an empty non-null storage key as missing', () => {
  const archive = makeArchive('campuscore-report-empty-key', 'synthetic database archive');
  const shim = reportPairDockerShim();
  const result = verify(archive, path.dirname(archive), reportPairEnv(shim, {
    data: reportCopy([{ key: '' }]),
    entries: './report.pdf',
  }));
  assert.notEqual(result.status, null, result.error?.message);
  assert.notEqual(result.status, 0, 'an empty key is not a recoverable local object reference');
  assert.match(result.stderr, /missing.*1|1.*missing/i);
});

test('verify-backup.sh fails closed when report table data has no COPY block', () => {
  const archive = makeArchive('campuscore-report-no-copy', 'synthetic database archive');
  const shim = reportPairDockerShim();
  const result = verify(archive, path.dirname(archive), reportPairEnv(shim, {
    data: 'INSERT INTO thesis.thesis_group_report VALUES (...);',
    entries: './report.pdf',
  }));
  assert.notEqual(result.status, null, result.error?.message);
  assert.notEqual(result.status, 0, 'a table-data entry without parseable COPY data must not be treated as empty');
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /storage_key|report.pdf/);
});

test('verify-backup.sh rejects report objects from a non-local provider', () => {
  const key = 'thesis-reports/group-a/provider-object.pdf';
  const archive = makeArchive('campuscore-report-provider', 'synthetic database archive');
  const shim = reportPairDockerShim();
  const result = verify(archive, path.dirname(archive), reportPairEnv(shim, {
    data: reportCopy([{ provider: 'object-store', key }]),
    entries: `./${key}`,
  }));
  assert.notEqual(result.status, null, result.error?.message);
  assert.notEqual(result.status, 0, 'a local tar cannot prove recovery for a non-local provider');
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, new RegExp(key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('restore-postgres.sh reconciles report keys before probing or creating a database', () => {
  const key = 'thesis-reports/private-student-folder/report.pdf';
  const archive = makeArchive('campuscore-restore-report-missing', 'synthetic database archive');
  const probe = path.join(path.dirname(archive), 'database-probed');
  const shim = reportPairDockerShim();
  const result = restore(archive, 'campuscore_restore_report_check', {
    ...reportPairEnv(shim, {
      data: reportCopy([{ key }]),
      entries: './thesis-reports/group-a/current.pdf',
    }),
    FAKE_DATABASE_PROBE: posix(probe),
  });
  assert.notEqual(result.status, null, result.error?.message);
  assert.notEqual(result.status, 0, 'restore must refuse an unrecoverable database/report pair');
  assert.equal(fs.existsSync(probe), false, 'reconciliation must finish before database probing');
});

test('restore-postgres.sh leaves restore targets untouched when report table data is absent', () => {
  const archive = makeArchive('campuscore-restore-report-data-omitted', 'synthetic database archive');
  const probe = path.join(path.dirname(archive), 'database-probed');
  const reportRestoreDir = `${archive.slice(0, -'.dump'.length)}.reports.restore`;
  const shim = reportPairDockerShim();
  const result = restore(archive, 'campuscore_restore_report_data_check', {
    ...reportPairEnv(shim),
    FAKE_TOC: reportTableWithoutDataToc,
    FAKE_DATABASE_PROBE: posix(probe),
  });
  assert.notEqual(result.status, null, result.error?.message);
  assert.notEqual(result.status, 0, 'restore must reject a database/report bundle without report rows');
  assert.equal(fs.existsSync(probe), false, 'verification must stop before probing the target database');
  assert.equal(fs.existsSync(reportRestoreDir), false, 'verification must stop before creating target files');
});

test('verify-backup.sh still fails on a corrupted archive', () => {
  const archive = makeArchive('campuscore-corrupt', 'synthetic dump payload');
  fs.appendFileSync(archive, 'tampered');
  const foreign = fs.mkdtempSync(path.join(temp, 'corrupt-cwd-'));
  const result = verify(archive, foreign, dockerReadBundleEnv());
  assert.notEqual(result.status, 0, 'a digest mismatch must not verify');
});

test('verify-backup.sh binds checksum records to literal artifact basenames before inspecting content', () => {
  const archive = makeArchive('a', 'requested database bytes');
  const directory = path.dirname(archive);
  const decoyDump = path.join(directory, 'axdump');
  const decoyReports = path.join(directory, 'axreportsxtar');
  fs.writeFileSync(decoyDump, 'checksummed decoy database bytes');
  fs.writeFileSync(decoyReports, 'checksummed decoy report bytes');
  fs.writeFileSync(`${archive}.sha256`, `${checksumLine(decoyDump)}\n${checksumLine(decoyReports)}\n`);
  const inspectedMarker = path.join(directory, 'content-inspected');
  const shim = makePathShim('docker', `
case "$*" in
  *'pg_restore --list'*) : > "$FAKE_INSPECTED_MARKER"; printf '%s\\n' "$FAKE_TOC";;
  *'tar -tf -'*) printf '%s\\n' './report.pdf';;
  *'tar -tvf -'*) printf '%s\\n' '-rw-r--r-- 0/0 10 2026-11-03 00:00 ./report.pdf';;
  *) printf 'unexpected docker command\\n' >&2; exit 90;;
esac
`);
  const result = verify(archive, directory, {
    ...shim.env,
    FAKE_INSPECTED_MARKER: posix(inspectedMarker),
    FAKE_TOC: validToc,
  });
  assert.notEqual(result.status, 0, 'decoy filenames must not satisfy checksum coverage');
  assert.equal(fs.existsSync(inspectedMarker), false, 'filename binding must fail before content inspection');
});

for (const unsafeMember of [
  { name: 'symbolic link', listing: 'lrwxrwxrwx 0/0 0 1 2026-11-03 00:00 ./report-link -> /etc/passwd' },
  { name: 'hard link', listing: 'hrw-r--r-- 0/0 0 1 2026-11-03 00:00 ./report-hard link to ./report.pdf' },
  { name: 'character device', listing: 'crw-rw---- 0/0 0 1 2026-11-03 00:00 ./report-device' },
  { name: 'block device', listing: 'brw-rw---- 0/0 0 1 2026-11-03 00:00 ./report-block' },
]) {
  test(`verify-backup.sh rejects a ${unsafeMember.name} report archive member`, () => {
    const archive = makeArchive(`campuscore-${unsafeMember.name.replaceAll(' ', '-')}`, 'synthetic database archive');
    const shim = makePathShim('docker', `
case "$*" in
  *'pg_restore --list'*) printf '%s\\n' "$FAKE_TOC";;
  *'pg_restore --data-only'*) printf '%s\\n' "$FAKE_REPORT_COPY";;
  *'tar -tf -'*) printf '%s\\n' './report.pdf';;
  *'tar -tvf -'*) printf '%s\\n' "$FAKE_TAR_VERBOSE";;
  *) printf 'unexpected docker command\\n' >&2; exit 90;;
esac
`);
    const result = verify(archive, path.dirname(archive), {
      ...shim.env,
      FAKE_TOC: validToc,
      FAKE_REPORT_COPY: reportCopy(),
      FAKE_TAR_VERBOSE: unsafeMember.listing,
    });
    assert.notEqual(result.status, 0, 'only regular files and directories may be present');
    assert.match(result.stderr, /unsafe.*(member )?type/i);
  });
}

test('backup-postgres.sh hides pg_dump stderr unless verbose diagnostics are explicitly requested', () => {
  const outputDir = fs.mkdtempSync(path.join(temp, 'dump-stderr-'));
  const stderrDir = fs.mkdtempSync(path.join(temp, 'dump-stderr-temp-'));
  const secretDiagnostic = 'synthetic-secret-child-diagnostic';
  const shim = makePathShim('docker', `
case "$*" in
  *pg_dump*) printf 'partial database archive'; printf '%s\\n' "$FAKE_SECRET_DIAGNOSTIC" >&2; exit 23;;
  *) printf 'unexpected docker command\\n' >&2; exit 90;;
esac
`);
  const result = spawnSync(bashCommand, [posix(backupScript)], {
    cwd: repo,
    encoding: 'utf8',
    timeout: 10000,
    env: {
      ...process.env,
      ...shim.env,
      COMPOSE_PROJECT_NAME: 'campusute',
      BACKUP_DIR: posix(outputDir),
      BACKUP_RETENTION_DAYS: '14',
      TMPDIR: posix(stderrDir),
      FAKE_SECRET_DIAGNOSTIC: secretDiagnostic,
    },
  });
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, new RegExp(secretDiagnostic),
    'raw child diagnostics must not reach the default output');
  assert.match(result.stderr, /Database dump failed \(exit code 23\)/);
  assert.equal(fs.readdirSync(stderrDir).length, 0, 'captured diagnostics must be deleted after exit');
});

test('backup-postgres.sh retains captured diagnostics only with VERBOSE=1', () => {
  const outputDir = fs.mkdtempSync(path.join(temp, 'verbose-dump-stderr-'));
  const stderrDir = fs.mkdtempSync(path.join(temp, 'verbose-dump-stderr-temp-'));
  const secretDiagnostic = 'synthetic-secret-verbose-diagnostic';
  const shim = makePathShim('docker', `
case "$*" in
  *pg_dump*) printf 'partial database archive'; printf '%s\\n' "$FAKE_SECRET_DIAGNOSTIC" >&2; exit 23;;
  *) printf 'unexpected docker command\\n' >&2; exit 90;;
esac
`);
  const result = spawnSync(bashCommand, [posix(backupScript)], {
    cwd: repo,
    encoding: 'utf8',
    timeout: 10000,
    env: {
      ...process.env,
      ...shim.env,
      COMPOSE_PROJECT_NAME: 'campusute',
      BACKUP_DIR: posix(outputDir),
      BACKUP_RETENTION_DAYS: '14',
      TMPDIR: posix(stderrDir),
      VERBOSE: '1',
      FAKE_SECRET_DIAGNOSTIC: secretDiagnostic,
    },
  });
  assert.equal(result.status, 23, result.stderr);
  assert.match(result.stderr, /Database dump failed \(exit code 23\)/);
  assert.match(result.stderr, new RegExp(secretDiagnostic));
  const retained = fs.readdirSync(stderrDir);
  assert.equal(retained.length, 1, 'verbose mode retains the captured diagnostic file');
  assert.match(fs.readFileSync(path.join(stderrDir, retained[0]), 'utf8'), new RegExp(secretDiagnostic));
});

test('verify-backup.sh reports tar inspection failure without exposing child stderr', () => {
  const archive = makeArchive('campuscore-tar-stderr', 'synthetic database archive');
  const stderrDir = fs.mkdtempSync(path.join(temp, 'tar-stderr-temp-'));
  const secretDiagnostic = 'synthetic-secret-tar-diagnostic';
  const shim = makePathShim('docker', `
case "$*" in
  *'pg_restore --list'*) printf '%s\\n' "$FAKE_TOC";;
  *'pg_restore --data-only'*) printf '%s\\n' "$FAKE_REPORT_COPY";;
  *'tar -tf -'*) printf '%s\\n' './report.pdf';;
  *'tar -tvf -'*) printf '%s\\n' "$FAKE_SECRET_DIAGNOSTIC" >&2; exit 37;;
  *) printf 'unexpected docker command\\n' >&2; exit 90;;
esac
`);
  const result = verify(archive, path.dirname(archive), {
    ...shim.env,
    FAKE_TOC: validToc,
    FAKE_REPORT_COPY: reportCopy(),
    FAKE_SECRET_DIAGNOSTIC: secretDiagnostic,
    TMPDIR: posix(stderrDir),
  });
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, new RegExp(secretDiagnostic),
    'raw tar diagnostics must not reach the default output');
  assert.match(result.stderr, /Thesis report archive type inspection failed \(exit code 37\)/);
  assert.equal(fs.readdirSync(stderrDir).length, 0, 'captured diagnostics must be deleted after exit');
});

test('verify-backup.sh keeps verbose report tar diagnostics free of storage keys', () => {
  const key = 'thesis-reports/private-path-redacted.pdf';
  const archive = makeArchive('campuscore-private-tar-stderr', 'synthetic database archive');
  const stderrDir = fs.mkdtempSync(path.join(temp, 'private-tar-stderr-'));
  const shim = makePathShim('docker', `
case "$*" in
  *'pg_restore --list'*) printf '%s\\n' "$FAKE_TOC";;
  *'pg_restore --data-only'*) printf '%s\\n' "$FAKE_REPORT_COPY";;
  *'tar -tf -'*) printf 'tar: %s: Cannot open\\n' "$FAKE_SECRET_PATH" >&2; exit 37;;
  *) printf 'unexpected docker command\\n' >&2; exit 90;;
esac
`);
  const result = verify(archive, path.dirname(archive), {
    ...shim.env,
    FAKE_TOC: validToc,
    FAKE_REPORT_COPY: reportCopy([{ key }]),
    FAKE_SECRET_PATH: `./${key}`,
    TMPDIR: posix(stderrDir),
    VERBOSE: '1',
  });
  assert.notEqual(result.status, null, result.error?.message);
  assert.notEqual(result.status, 0, 'a tar inspection failure must fail verification');
  assert.match(result.stderr, /Thesis report archive listing failed \(exit code 37\)/);
  assert.equal(`${result.stdout}\n${result.stderr}`.includes(key), false,
    'verbose report diagnostics must not disclose storage keys');
  assert.equal(fs.readdirSync(stderrDir).length, 0,
    'sensitive captured diagnostics must be deleted even in verbose mode');
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
  const shim = makePathShim('docker', `
case "$*" in
  *pg_dump*) printf 'synthetic database archive';;
  *'pg_restore --data-only'*) printf '%s\\n' "$FAKE_REPORT_COPY";;
  *pg_restore*) printf '%s\\n' "$FAKE_TOC";;
  *'exec -T restful-api sh -ceu'*) printf 'synthetic report volume archive';;
  *'tar -tf -'*) printf '%s\\n' './report.pdf';;
  *) printf 'unexpected docker command\\n' >&2; exit 90;;
esac
`);
  const result = spawnSync(bashCommand, [posix(backupScript)], {
    cwd: repo,
    encoding: 'utf8',
    timeout: 60000,
    env: {
      ...process.env,
      ...shim.env,
      COMPOSE_PROJECT_NAME: 'campusute',
      BACKUP_DIR: posix(outputDir),
      BACKUP_RETENTION_DAYS: '14',
      FAKE_TOC: validToc,
      FAKE_REPORT_COPY: reportCopy(),
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

test('backup-postgres.sh treats zero-padded retention days as decimal', () => {
  const outputDir = fs.mkdtempSync(path.join(temp, 'zero-padded-retention-'));
  const shim = makePathShim('docker', `
case "$*" in
  *pg_dump*) printf 'synthetic database archive';;
  *'pg_restore --data-only'*) printf '%s\\n' "$FAKE_REPORT_COPY";;
  *pg_restore*) printf '%s\\n' "$FAKE_TOC";;
  *'exec -T restful-api sh -ceu'*) printf 'synthetic report volume archive';;
  *'tar -tf -'*) printf '%s\\n' './report.pdf';;
  *) printf 'unexpected docker command\\n' >&2; exit 90;;
esac
`);
  const result = spawnSync(bashCommand, [posix(backupScript)], {
    cwd: repo,
    encoding: 'utf8',
    timeout: 60000,
    env: {
      ...process.env,
      ...shim.env,
      COMPOSE_PROJECT_NAME: 'campusute',
      BACKUP_DIR: posix(outputDir),
      BACKUP_RETENTION_DAYS: '08',
      FAKE_TOC: validToc,
      FAKE_REPORT_COPY: reportCopy(),
    },
  });
  assert.equal(result.status, 0, result.stderr);
  const entries = fs.readdirSync(outputDir);
  assert.equal(entries.filter((name) => name.endsWith('.dump')).length, 1);
  assert.equal(entries.filter((name) => name.endsWith('.reports.tar')).length, 1);
  assert.equal(entries.filter((name) => name.endsWith('.dump.sha256')).length, 1);
});

test('backup-postgres.sh retries once when the dump and report archive do not reconcile', () => {
  const outputDir = fs.mkdtempSync(path.join(temp, 'reconcile-retry-'));
  const countFile = path.join(outputDir, 'capture-count');
  const firstKey = 'thesis-reports/group-a/replaced.pdf';
  const secondKey = 'thesis-reports/group-a/current.pdf';
  const shim = retryCaptureDockerShim();
  const result = spawnSync(bashCommand, [posix(backupScript)], {
    cwd: repo,
    encoding: 'utf8',
    timeout: 60000,
    env: {
      ...process.env,
      ...shim.env,
      COMPOSE_PROJECT_NAME: 'campusute',
      BACKUP_DIR: posix(outputDir),
      BACKUP_RETENTION_DAYS: '14',
      FAKE_COUNT_FILE: posix(countFile),
      FAKE_TOC: validToc,
      FAKE_FIRST_COPY: reportCopy([{ key: firstKey }]),
      FAKE_SECOND_COPY: reportCopy([{ key: secondKey }]),
      FAKE_TAR_KEY: secondKey,
    },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.readFileSync(countFile, 'utf8'), '2', 'the whole capture should be repeated once');
  const dumpName = fs.readdirSync(outputDir).find((name) => name.endsWith('.dump'));
  const reportsName = fs.readdirSync(outputDir).find((name) => name.endsWith('.reports.tar'));
  assert.equal(fs.readFileSync(path.join(outputDir, dumpName), 'utf8'), 'dump-2');
  assert.equal(fs.readFileSync(path.join(outputDir, reportsName), 'utf8'), 'reports-2');
  assert.equal(fs.readdirSync(outputDir).filter((name) => /\.dump$|\.reports\.tar$|\.dump\.sha256$/.test(name)).length, 3);
});

test('backup-postgres.sh removes both failed captures and reports only the missing count', () => {
  const outputDir = fs.mkdtempSync(path.join(temp, 'reconcile-exhausted-'));
  const countFile = path.join(outputDir, 'capture-count');
  const firstKey = 'thesis-reports/private-group/previous.pdf';
  const secondKey = 'thesis-reports/private-group/current.pdf';
  const shim = retryCaptureDockerShim();
  const result = spawnSync(bashCommand, [posix(backupScript)], {
    cwd: repo,
    encoding: 'utf8',
    timeout: 60000,
    env: {
      ...process.env,
      ...shim.env,
      COMPOSE_PROJECT_NAME: 'campusute',
      BACKUP_DIR: posix(outputDir),
      BACKUP_RETENTION_DAYS: '14',
      FAKE_COUNT_FILE: posix(countFile),
      FAKE_TOC: validToc,
      FAKE_FIRST_COPY: reportCopy([{ key: firstKey }]),
      FAKE_SECOND_COPY: reportCopy([{ key: secondKey }]),
      FAKE_TAR_KEY: 'thesis-reports/group-a/other.pdf',
    },
  });
  assert.notEqual(result.status, 0);
  assert.equal(fs.readFileSync(countFile, 'utf8'), '2', 'only one retry is permitted');
  assert.match(result.stderr, /1 referenced report storage key.*missing/i);
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, new RegExp(`${firstKey}|${secondKey}`));
  assert.deepEqual(fs.readdirSync(outputDir), ['capture-count'], 'failed staged artifacts must be removed');
});

test('backup-postgres.sh does not retry a report-reference extraction error as a missing-key mismatch', () => {
  const outputDir = fs.mkdtempSync(path.join(temp, 'reconcile-child-failure-'));
  const countFile = path.join(outputDir, 'capture-count');
  const key = 'thesis-reports/group-a/current.pdf';
  const secretDiagnostic = 'synthetic-private-report-diagnostic';
  const shim = makePathShim('docker', `
case "$*" in
  *pg_dump*)
    if [[ -f "$FAKE_COUNT_FILE" ]]; then count="$(cat "$FAKE_COUNT_FILE")"; else count=0; fi
    count=$((count + 1))
    printf '%s' "$count" > "$FAKE_COUNT_FILE"
    printf 'dump-%s' "$count"
    ;;
  *'pg_restore --list'*) printf '%s\\n' "$FAKE_TOC";;
  *'pg_restore --data-only'*)
    printf '%s\\n' "$FAKE_REPORT_COPY"
    printf '%s\\n' "$FAKE_SECRET_DIAGNOSTIC" >&2
    exit 1
    ;;
  *'exec -T restful-api sh -ceu'*) printf 'reports';;
  *'tar -tf -'*) cat >/dev/null; printf '%s\\n' "./$FAKE_TAR_KEY";;
  *) printf 'unexpected docker command\\n' >&2; exit 90;;
esac
`);
  const result = spawnSync(bashCommand, [posix(backupScript)], {
    cwd: repo,
    encoding: 'utf8',
    timeout: 60000,
    env: {
      ...process.env,
      ...shim.env,
      COMPOSE_PROJECT_NAME: 'campusute',
      BACKUP_DIR: posix(outputDir),
      BACKUP_RETENTION_DAYS: '14',
      FAKE_COUNT_FILE: posix(countFile),
      FAKE_TOC: validToc,
      FAKE_REPORT_COPY: reportCopy([{ key }]),
      FAKE_SECRET_DIAGNOSTIC: secretDiagnostic,
      FAKE_TAR_KEY: key,
    },
  });
  assert.notEqual(result.status, 0);
  assert.equal(fs.readFileSync(countFile, 'utf8'), '1', 'a child-tool failure must not start a second capture');
  assert.match(result.stderr, /Database report-reference extraction failed \(exit code 1\)/);
  assert.doesNotMatch(result.stderr, /referenced report storage key.*missing/i);
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, new RegExp(secretDiagnostic));
  assert.deepEqual(fs.readdirSync(outputDir), ['capture-count'], 'failed staged artifacts must be removed');
});

test('backup-postgres.sh rejects a report storage provider other than local', () => {
  const outputDir = fs.mkdtempSync(path.join(temp, 'non-local-provider-'));
  const shim = makePathShim('docker', `
case "$*" in
  *pg_dump*) printf 'synthetic database archive';;
  *'exec -T restful-api sh -ceu'*)
    case "$*" in
      *'test "\${THESIS_REPORT_STORAGE_PROVIDER:-local}" = local'*) ;;
      *) printf 'provider guard was not passed to the child\\n' >&2; exit 91;;
    esac
    if [[ "$FAKE_STORAGE_PROVIDER" != local ]]; then printf 'provider details must stay private\\n' >&2; exit 1; fi
    printf 'synthetic report archive'
    ;;
  *) printf 'unexpected docker command\\n' >&2; exit 90;;
esac
`);
  const result = spawnSync(bashCommand, [posix(backupScript)], {
    cwd: repo,
    encoding: 'utf8',
    timeout: 30000,
    env: {
      ...process.env,
      ...shim.env,
      COMPOSE_PROJECT_NAME: 'campusute',
      BACKUP_DIR: posix(outputDir),
      BACKUP_RETENTION_DAYS: '14',
      FAKE_STORAGE_PROVIDER: 'object-store',
    },
  });
  assert.notEqual(result.status, 0, 'backup must reject storage that the local report tar cannot capture');
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /provider details must stay private/);
  assert.doesNotMatch(fs.readdirSync(outputDir).join('\n'), /\.dump|\.reports\.tar|\.sha256/);
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

// A shell function shadows binaries that Git Bash places ahead of an inherited PATH.
function backupShimEnv(timestamp) {
  return makeShellEnv(`
docker() {
  case "$*" in
    *pg_dump*) printf 'synthetic database archive';;
    *'pg_restore --data-only'*) printf '%s\\n' "$FAKE_REPORT_COPY";;
    *pg_restore*) printf '%s\\n' "$FAKE_TOC";;
    *'exec -T restful-api sh -ceu'*) printf 'synthetic report volume archive';;
    *'tar -tvf -'*) printf '%s\\n' '-rw-r--r-- 0/0 10 2026-11-03 00:00 ./report.pdf';;
    *'tar -tf -'*) printf '%s\\n' './report.pdf';;
    *) printf 'unexpected docker command\\n' >&2; exit 90;;
  esac
}
date() { printf '%s\\n' '${timestamp}'; }
`);
}

function runBackup(env) {
  return spawnSync(bashCommand, [posix(backupScript)], {
    cwd: repo,
    encoding: 'utf8',
    timeout: 60000,
    env: { ...process.env, ...env },
  });
}

test('backup-postgres.sh namespaces a shared backup directory by Compose project', () => {
  const outputDir = fs.mkdtempSync(path.join(temp, 'project-ns-'));
  const timestamp = '20260203T040506Z';
  const sharedEnv = {
    ...backupShimEnv(timestamp),
    BACKUP_DIR: posix(outputDir),
    BACKUP_RETENTION_DAYS: '14',
    FAKE_TOC: validToc,
    FAKE_REPORT_COPY: reportCopy(),
  };
  const first = runBackup({ ...sharedEnv, COMPOSE_PROJECT_NAME: 'campusute' });
  assert.equal(first.status, 0, first.stderr);
  const second = runBackup({ ...sharedEnv, COMPOSE_PROJECT_NAME: 'uteclone' });
  assert.equal(second.status, 0, 'a same-second run for another project must not collide');
  for (const stem of [`campuscore-campusute-${timestamp}`, `campuscore-uteclone-${timestamp}`]) {
    for (const ext of ['.dump', '.dump.sha256', '.reports.tar']) {
      assert.ok(fs.existsSync(path.join(outputDir, stem + ext)), stem + ext);
    }
  }
  const sidecar = fs.readFileSync(path.join(outputDir, `campuscore-campusute-${timestamp}.dump.sha256`), 'utf8');
  assert.match(sidecar, /campuscore-campusute-20260203T040506Z\.dump\n/);
  assert.match(sidecar, /campuscore-campusute-20260203T040506Z\.reports\.tar\n/);
  const producedDump = path.join(outputDir, `campuscore-campusute-${timestamp}.dump`);
  archiveChecksum(producedDump, path.join(outputDir, `campuscore-campusute-${timestamp}.reports.tar`));
  const verified = verify(producedDump, outputDir, sharedEnv);
  assert.equal(verified.status, 0, verified.stderr);
});

test('backup-postgres.sh retention prunes only the same project bundle names', () => {
  const outputDir = fs.mkdtempSync(path.join(temp, 'retention-ns-'));
  const runAt = (project, timestamp, retention = '14') => runBackup({
    ...backupShimEnv(timestamp),
    COMPOSE_PROJECT_NAME: project,
    BACKUP_DIR: posix(outputDir),
    BACKUP_RETENTION_DAYS: retention,
    FAKE_TOC: validToc,
    FAKE_REPORT_COPY: reportCopy(),
  });
  const ts = { own: '20260101T000000Z', sibling: '20260102T000000Z', other: '20260103T000000Z', fresh: '20260104T000000Z' };
  assert.equal(runAt('utebeta', ts.own).status, 0);
  assert.equal(runAt('utebeta-x', ts.sibling).status, 0);
  assert.equal(runAt('utealpha', ts.other).status, 0);
  const legacyTs = '20251201T000000Z';
  for (const ext of ['.dump', '.dump.sha256', '.reports.tar']) {
    fs.writeFileSync(path.join(outputDir, `campuscore-${legacyTs}${ext}`), 'legacy bundle bytes');
  }
  const aged = new Date(Date.now() - 40 * 86400_000);
  for (const name of fs.readdirSync(outputDir)) {
    fs.utimesSync(path.join(outputDir, name), aged, aged);
  }
  const pruneRun = runAt('utebeta', ts.fresh, '7');
  assert.equal(pruneRun.status, 0, pruneRun.stderr);
  const kept = (name) => assert.ok(fs.existsSync(path.join(outputDir, name)), `kept ${name}`);
  const gone = (name) => assert.ok(!fs.existsSync(path.join(outputDir, name)), `pruned ${name}`);
  for (const ext of ['.dump', '.dump.sha256', '.reports.tar']) {
    gone(`campuscore-utebeta-${ts.own}${ext}`);
    kept(`campuscore-utebeta-x-${ts.sibling}${ext}`);
    kept(`campuscore-utealpha-${ts.other}${ext}`);
    kept(`campuscore-${legacyTs}${ext}`);
  }
  kept(`campuscore-utebeta-${ts.fresh}.dump`);
});

test('backup-postgres.sh refuses a Compose project name outside the backup slug contract', () => {
  const outputDir = fs.mkdtempSync(path.join(temp, 'slug-reject-'));
  const sharedEnv = {
    ...backupShimEnv('20260203T040506Z'),
    BACKUP_DIR: posix(outputDir),
    BACKUP_RETENTION_DAYS: '14',
    FAKE_TOC: validToc,
    FAKE_REPORT_COPY: reportCopy(),
  };
  const tooLong = runBackup({ ...sharedEnv, COMPOSE_PROJECT_NAME: 'a'.repeat(41) });
  assert.equal(tooLong.status, 2, tooLong.stderr);
  const badChar = runBackup({ ...sharedEnv, COMPOSE_PROJECT_NAME: 'CampusUTE' });
  assert.equal(badChar.status, 2, badChar.stderr);
  const boundary = runBackup({ ...sharedEnv, COMPOSE_PROJECT_NAME: 'a'.repeat(40) });
  assert.equal(boundary.status, 0, boundary.stderr);
  assert.equal(fs.readdirSync(outputDir).filter((name) => name.endsWith('.dump')).length, 1,
    'only the boundary-valid run may publish a bundle');
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
    *pg_restore*--list*) printf '%b\\n' ${JSON.stringify(validToc)};;
    *'pg_restore --data-only'*) printf '%s\\n' 'COPY thesis.thesis_group_report (storage_provider, storage_bucket, storage_key) FROM stdin;' '\\.';;
    *'tar -tf'*) printf '%s\\n' './report.pdf';;
    *'tar -tvf'*) printf '%s\\n' '-rw-r--r-- 0/0 10 2026-11-03 00:00 ./report.pdf';;
    *'SELECT 1 FROM pg_database'*) return 0;;
    *'CREATE DATABASE'*) return 0;;
    *'pg_restore --single-transaction'*) printf 'synthetic-secret-restore-diagnostic' >&2; return 23;;
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
  assert.doesNotMatch(result.stderr, /synthetic-secret-restore-diagnostic/,
    'raw pg_restore diagnostics must not reach the default output');
  assert.match(result.stderr, /Database restore failed \(exit code 23\)/);
  assert.equal(fs.readFileSync(dropMarker, 'utf8'), 'dropped', 'failure cleanup drops the newly created target');
  assert.equal(fs.existsSync(`${archive.slice(0, -'.dump'.length)}.reports.restore`), false,
    'failed restore removes its staged report files');
  assert.doesNotMatch(result.stdout, /Restored /);
});

test('backup entry points are tracked as executable files', (t) => {
  const listing = spawnSync('git', ['ls-files', '-s', '--', 'ops/backup/backup-postgres.sh',
    'ops/backup/restore-postgres.sh', 'ops/backup/verify-backup.sh'], { cwd: repo, encoding: 'utf8' });
  if (listing.status !== 0 || !listing.stdout.trim()) {
    t.skip('not a git checkout');
    return;
  }
  const modes = Object.fromEntries(listing.stdout.trim().split('\n').map((line) => {
    const [mode, , , file] = line.split(/\s+/);
    return [path.basename(file), mode];
  }));
  assert.deepEqual(modes, {
    'backup-postgres.sh': '100755',
    'restore-postgres.sh': '100755',
    'verify-backup.sh': '100755',
  }, 'systemd and the restore script execute these files directly');
});

test('backup and restore require an explicit Compose project', () => {
  assert.doesNotMatch(backupSource, /COMPOSE_PROJECT_NAME:-campuscore-production/);
  assert.doesNotMatch(verifySource, /COMPOSE_PROJECT_NAME:-campuscore-production/);
  assert.doesNotMatch(restoreSource, /COMPOSE_PROJECT_NAME:-campuscore-production/);
});
