import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  casePgit,
  caseStack,
  inspectRequestedItReports,
  preflightComposeProject,
} from './platform-verify.mjs';

const source = readFileSync(resolve(fileURLToPath(new URL('.', import.meta.url)), 'platform-verify.mjs'), 'utf8');

function report(name, { tests = 1, skipped = 0, failures = 0, errors = 0, currentRun = true } = {}) {
  return {
    file: `TEST-${name}.xml`,
    currentRun,
    xml: `<testsuite name="${name}" tests="${tests}" skipped="${skipped}" failures="${failures}" errors="${errors}"></testsuite>`,
  };
}

test('platform-verify requires every requested IT class to execute without skips', () => {
  const checks = inspectRequestedItReports([
    'AttendanceGeofencePostgresIT',
    'W14IndexMigrationPostgresIT',
  ], [
    report('io.campuscore.restfulapi.attendance.AttendanceGeofencePostgresIT', { tests: 8 }),
    report('io.campuscore.restfulapi.migration.W14IndexMigrationPostgresIT', { tests: 2 }),
  ]);

  assert.deepEqual(checks.map((check) => check.passed), [true, true]);
  assert.deepEqual(checks.map((check) => check.executed), [8, 2]);
});

test('platform-verify matches Surefire include globs and ignores exclusion selectors', () => {
  const checks = inspectRequestedItReports([
    '*PostgresIT',
    '!*CorrectionMigrationPostgresIT',
  ], [
    report('io.campuscore.BffSessionPostgresIT', { tests: 3 }),
  ]);

  assert.equal(checks.length, 1);
  assert.equal(checks[0].class, '*PostgresIT');
  assert.equal(checks[0].passed, true);
  assert.equal(checks[0].executed, 3);
});

test('platform-verify reduces recursive path globs to the simple class name', () => {
  const [check] = inspectRequestedItReports(['**/*PostgresIT'], [
    report('io.campuscore.restfulapi.attendance.AttendanceGeofencePostgresIT', { tests: 4 }),
  ]);

  assert.equal(check.passed, true);
  assert.equal(check.executed, 4);
});

test('platform-verify matches one-character Maven wildcards', () => {
  const [check] = inspectRequestedItReports(['Attendance?PostgresIT'], [
    report('io.campuscore.restfulapi.attendance.Attendance1PostgresIT', { tests: 2 }),
  ]);

  assert.equal(check.passed, true);
  assert.equal(check.executed, 2);
});

test('platform-verify applies comma-separated selectors and exclusions', () => {
  const [check] = inspectRequestedItReports(['*PostgresIT,!*CorrectionMigrationPostgresIT'], [
    report('io.campuscore.BffSessionPostgresIT', { tests: 3 }),
    report('io.campuscore.CorrectionMigrationPostgresIT', { tests: 2 }),
  ]);

  assert.equal(check.passed, true);
  assert.equal(check.executed, 3);
});

test('platform-verify rejects unsupported path selectors before starting the stack', async () => {
  let composeCalls = 0;
  await assert.rejects(casePgit({
    project: 'campuscore-selector-test',
    its: 'com/**/AttendancePostgresIT',
  }, {
    composeTry() {
      composeCalls += 1;
      return { ok: true, out: '' };
    },
  }), /Unsupported Maven --its selector/);
  assert.equal(composeCalls, 0);
});

test('platform-verify hard-fails a requested class that has no report', () => {
  const [check] = inspectRequestedItReports(['MissingPostgresIT'], [
    report('io.campuscore.restfulapi.attendance.AttendanceGeofencePostgresIT'),
  ]);

  assert.equal(check.passed, false);
  assert.equal(check.reason, 'report missing');
});

test('platform-verify rejects zero-test, skipped, failed, and stale class reports', () => {
  const checks = inspectRequestedItReports([
    'ZeroPostgresIT',
    'SkippedPostgresIT',
    'FailedPostgresIT',
    'StalePostgresIT',
  ], [
    report('ZeroPostgresIT', { tests: 0 }),
    report('SkippedPostgresIT', { tests: 1, skipped: 1 }),
    report('FailedPostgresIT', { tests: 1, failures: 1 }),
    report('StalePostgresIT', { currentRun: false }),
  ]);

  assert.deepEqual(checks.map((check) => check.passed), [false, false, false, false]);
  assert.deepEqual(checks.map((check) => check.reason), [
    'zero tests executed',
    'unexpected skipped tests',
    'class failures or errors',
    'report not produced by this run',
  ]);
});

test('platform-verify refuses pre-existing project containers or volumes before startup', () => {
  assert.ok(/export function preflightComposeProject/.test(source), 'ownership preflight is exported for focused verification');
  assert.ok(/ps', '-aq'/.test(source), 'the preflight queries project containers');
  assert.ok(/volume', 'ls', '-q'/.test(source), 'the preflight queries project volumes');

  const args = { project: 'campuscore-test-fixture' };
  const seen = [];
  assert.throws(() => preflightComposeProject(args, (_command, argv) => {
    seen.push(argv);
    return { ok: true, out: 'existing-container\n' };
  }), /already contains containers/);
  assert.deepEqual(seen, [[
    'compose', '-p', args.project,
    '-f', resolve(fileURLToPath(new URL('..', import.meta.url)), 'docker-compose.e2e.yml'),
    'ps', '-aq',
  ]]);

  seen.length = 0;
  assert.throws(() => preflightComposeProject(args, (_command, argv) => {
    seen.push(argv);
    return { ok: true, out: argv.includes('ps') ? '' : 'existing-volume\n' };
  }), /already contains volumes/);
  assert.equal(seen.length, 2, 'existing volumes are rejected before Compose startup');
  assert.equal(preflightComposeProject(args, () => ({ ok: true, out: '' })), true);
});

test('platform-verify preflights both destructive cases and tears down only its started stack', () => {
  const stack = source.slice(source.indexOf('async function caseStack'), source.indexOf('async function casePgit'));
  const pgit = source.slice(source.indexOf('async function casePgit'), source.indexOf('async function main'));
  assert.ok(stack.indexOf('preflightComposeProject(args,') < stack.indexOf("composeCase(args, ['up'"));
  assert.ok(pgit.indexOf('preflightComposeProject(args,') < pgit.indexOf("composeCase(args, ['up'"));
  assert.ok(/if \(stackStarted\)[\s\S]*?composeCase\(args, \['down', '-v'/.test(stack));
  assert.ok(/if \(stackStarted\)[\s\S]*?composeCase\(args, \['down', '-v'/.test(pgit));
});

test('a cleanup failure keeps the original case failure and still tears down', async (t) => {
  for (const [name, runCase] of [['stack', caseStack], ['pgit', casePgit]]) {
    const evidence = mkdtempSync(join(tmpdir(), `platform-verify-${name}-`));
    t.after(() => rmSync(evidence, { recursive: true, force: true }));
    const calls = [];
    const runner = {
      tryRun: (_command, argv) => {
        calls.push(argv);
        return { ok: true, out: '' };
      },
      composeTry: (_args, argv) => {
        calls.push(argv);
        return argv.includes('up')
          ? { ok: false, out: 'fake compose up failed', code: 1 }
          : { ok: false, out: 'fake compose down failed', code: 1 };
      },
    };

    await assert.rejects(
      () => runCase({ project: 'campuscore-test-fixture', evidence }, runner),
      (error) => {
        assert.match(error.message, /compose up failed/, `${name} keeps the original failure`);
        assert.match(
          String(error.cause?.message),
          /Owned Compose stack cleanup failed/,
          `${name} reports the cleanup failure as the cause`,
        );
        return true;
      },
    );
    assert.ok(calls.some((argv) => argv.includes('down')), `${name} still tears down its stack`);
  }
});
