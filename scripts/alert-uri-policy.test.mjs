import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const scriptsDirectory = dirname(fileURLToPath(import.meta.url));
const alerts = readFileSync(resolve(scriptsDirectory, '../ops/monitoring/alerts-api-slo.yml'), 'utf8');
const fixtures = readFileSync(resolve(scriptsDirectory, '../ops/monitoring/alert-tests.yml'), 'utf8');

// Route templates come from the Spring MVC uri tag on the controllers:
// RegistrationController @RequestMapping("/api/v1") + me/enrollments(/{id}/drop),
// AcademicSectionReadController @RequestMapping("/api/v1/sections") + {id}/grades,
// AcademicEnrollmentReadController @RequestMapping("/api/v1") + enrollments/my/*.
const registrationPattern = '/api/v1/(academic/)?(me/)?enrollments.*';
const gradesPattern = '/api/v1/enrollments/my/grades|/api/v1/enrollments/my/transcript|/api/v1/sections/.*/grades';

test('registration alerts select the live enrollment route templates', () => {
  assert.ok(alerts.includes(`uri=~"${registrationPattern}"`),
    'the registration uri regex must cover /api/v1/me/enrollments*');
  const re = new RegExp(`^${registrationPattern}$`);
  for (const uri of [
    '/api/v1/me/enrollments',
    '/api/v1/me/enrollments/{id}/drop',
    '/api/v1/academic/me/enrollments',
    '/api/v1/academic/me/enrollments/{id}/drop',
  ]) {
    assert.ok(re.test(uri), `registration regex must match emitted template ${uri}`);
  }
});

test('grades read alerts select the live grade route templates', () => {
  assert.ok(alerts.includes(`uri=~"${gradesPattern}"`),
    'the grades uri regex must cover /api/v1/sections/{id}/grades');
  const re = new RegExp(`^(${gradesPattern})$`);
  for (const uri of [
    '/api/v1/enrollments/my/grades',
    '/api/v1/enrollments/my/transcript',
    '/api/v1/sections/{id}/grades',
  ]) {
    assert.ok(re.test(uri), `grades regex must match emitted template ${uri}`);
  }
  assert.ok(!alerts.includes('/api/v1/grades/'), 'no controller serves /api/v1/grades/*');
});

test('alert fixtures exercise the live enrollment and grade templates', () => {
  assert.ok(fixtures.includes('uri="/api/v1/me/enrollments"'),
    'fixtures must feed the emitted /api/v1/me/enrollments template');
  assert.ok(fixtures.includes('uri="/api/v1/sections/{id}/grades"'),
    'fixtures must feed the emitted /api/v1/sections/{id}/grades template');
});
