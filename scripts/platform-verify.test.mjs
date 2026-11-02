import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectRequestedItReports } from './platform-verify.mjs';

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
