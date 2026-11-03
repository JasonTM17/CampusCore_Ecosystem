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

// The selector is lifted out of the named rule block in the alerts file, never
// retyped here: a corrupted or drifted rule fails instead of passing on a local
// copy of the regex (a substring scan cannot tell a live selector from a comment).
// Evaluation uses JS RegExp; deployed patterns stay within its RE2-compatible subset.
function uriSelectorOf(source, alertName) {
  const start = source.indexOf(`- alert: ${alertName}`);
  assert.notEqual(start, -1, `alerts-api-slo.yml must define ${alertName}`);
  const end = source.indexOf('- alert:', start + 1);
  const rule = source.slice(start, end === -1 ? source.length : end);
  const match = rule.match(/uri=~"([^"]+)"/);
  assert.ok(match, `${alertName} must select on the uri label`);
  return match[1];
}

test('registration alerts select the live enrollment route templates', () => {
  for (const alertName of ['RegistrationLatencyP95Breached', 'RegistrationServerErrorRateHigh']) {
    const selector = uriSelectorOf(alerts, alertName);
    assert.equal(selector, registrationPattern,
      `${alertName} uri regex must cover /api/v1/me/enrollments*`);
    const re = new RegExp(`^${selector}$`);
    for (const uri of [
      '/api/v1/me/enrollments',
      '/api/v1/me/enrollments/{id}/drop',
      '/api/v1/academic/me/enrollments',
      '/api/v1/academic/me/enrollments/{id}/drop',
    ]) {
      assert.ok(re.test(uri), `${alertName} regex must match emitted template ${uri}`);
    }
  }
});

test('grades read alerts select the live grade route templates', () => {
  for (const alertName of ['GradesReadLatencyP95Breached', 'GradesReadServerErrorRateHigh']) {
    const selector = uriSelectorOf(alerts, alertName);
    assert.equal(selector, gradesPattern,
      `${alertName} uri regex must cover /api/v1/sections/{id}/grades`);
    const re = new RegExp(`^(${selector})$`);
    for (const uri of [
      '/api/v1/enrollments/my/grades',
      '/api/v1/enrollments/my/transcript',
      '/api/v1/sections/{id}/grades',
    ]) {
      assert.ok(re.test(uri), `${alertName} regex must match emitted template ${uri}`);
    }
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
  const exportedMetrics = new Set([
    ...[...metrics.matchAll(/registry\.counter\("(campuscore\.assistant\.[^"]+)"/g)]
      .map(([, name]) => `${name.replaceAll('.', '_')}_total`),
    ...[...metrics.matchAll(/Gauge\.builder\("(campuscore\.assistant\.[^"]+)"/g)]
      .map(([, name]) => name.replaceAll('.', '_')),
  ]);
  const referencedMetrics = new Set(
    [...assistant.matchAll(/\bcampuscore_assistant_[a-z0-9_]+\b/g)].map(([name]) => name),
  );

  for (const metric of [
    'campuscore_assistant_requests_total',
    'campuscore_assistant_quota_consumed_daily',
    'campuscore_assistant_quota_limit_daily',
    'campuscore_assistant_rls_verified',
  ]) {
    assert.ok(exportedMetrics.has(metric), `MetricsConfiguration must export assistant metric ${metric}`);
    assert.ok(assistant.includes(metric), `assistant alert rules must select exported metric ${metric}`);
  }
  for (const metric of referencedMetrics) {
    assert.ok(exportedMetrics.has(metric), `assistant alert metric ${metric} must be exported by MetricsConfiguration`);
  }
});
