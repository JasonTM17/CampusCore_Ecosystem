import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const scriptsDirectory = dirname(fileURLToPath(import.meta.url));
const alerts = readFileSync(resolve(scriptsDirectory, '../ops/monitoring/alerts-api-slo.yml'), 'utf8');
const infrastructure = readFileSync(resolve(scriptsDirectory, '../ops/monitoring/alerts-infrastructure.yml'), 'utf8');
const assistant = readFileSync(resolve(scriptsDirectory, '../ops/monitoring/alerts-assistant.yml'), 'utf8');
const fixtures = readFileSync(resolve(scriptsDirectory, '../ops/monitoring/alert-tests.yml'), 'utf8');
const metrics = readFileSync(resolve(
  scriptsDirectory,
  '../java-services/restful-api/src/main/java/io/campuscore/restfulapi/config/MetricsConfiguration.java',
), 'utf8');

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

test('blackbox alerts and fixtures use only the configured job and instance labels', () => {
  for (const job of [
    'blackbox-http-api-liveness',
    'blackbox-http-api-readiness',
    'blackbox-http-frontend-health',
  ]) {
    assert.ok(infrastructure.includes(`job="${job}"`), `alert rules must use configured job ${job}`);
    assert.ok(fixtures.includes(`job="${job}"`), `alert tests must cover configured job ${job}`);
  }
  assert.match(infrastructure, /and on \(instance\)/,
    'liveness and readiness use the shared API instance label across jobs');
  assert.doesNotMatch(fixtures, /probe_success\{[^\n]*(?:endpoint|service)=/,
    'blackbox fixtures must not invent endpoint or service labels');
  assert.match(fixtures, /probe_success\{job="blackbox-http-api-liveness",instance="api-[12]"\}/);
  assert.match(fixtures, /probe_success\{job="blackbox-http-api-readiness",instance="api-[12]"\}/);
  assert.match(fixtures, /probe_success\{job="blackbox-http-frontend-health",instance="web-1"\}/);
});

test('assistant alert metric names match the Micrometer producers', () => {
  assert.match(metrics, /registry\.counter\("campuscore\.assistant\.requests"/);
  assert.match(metrics, /Gauge\.builder\("campuscore\.assistant\.quota\.consumed\.daily"/);
  assert.match(metrics, /Gauge\.builder\("campuscore\.assistant\.rls\.verified"/);
  for (const metric of [
    'campuscore_assistant_requests_total',
    'campuscore_assistant_quota_consumed_daily',
    'campuscore_assistant_rls_verified',
  ]) {
    assert.ok(assistant.includes(metric), `assistant alert rules must select exported metric ${metric}`);
  }
});
