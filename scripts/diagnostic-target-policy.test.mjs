import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const scriptsDirectory = dirname(fileURLToPath(import.meta.url));
const browserDiagnostics = [
  'diagnose-login.mjs',
  'benchmark-all-roles.mjs',
  'audit-prod-browser.mjs',
];
const retiredPollers = [
  'wait-prod-e98423.mjs',
  'wait-prod-v131.mjs',
  'wait-prod-section-search.mjs',
];
const fetchDiagnostics = [
  'prod-deep-audit.mjs',
];

const readScript = (name) => readFileSync(resolve(scriptsDirectory, name), 'utf8');

test('browser diagnostics validate an explicit target before loading Playwright', () => {
  for (const name of browserDiagnostics) {
    const source = readScript(name);
    const validation = source.indexOf('parseTargetOptions(process.argv.slice(2))');
    const browserLoad = source.indexOf("require('playwright')");

    assert.ok(source.includes('--target'), `${name} must document an explicit target`);
    assert.ok(source.includes('--allow-network'), `${name} must require network opt-in for remote targets`);
    assert.ok(validation >= 0 && browserLoad > validation, `${name} must validate its target before Playwright loads`);
    assert.ok(/if\s*\(\s*!isLoopback\(url\.hostname\)\s*&&\s*!allowNetwork\s*\)/.test(source), `${name} must reject remote targets without opt-in`);
    assert.ok(source.includes("context.route('**/*'"), `${name} must guard browser requests outside loopback`);
    assert.ok(!/https:\/\/(?:www\.)?campusute\.io\.vn|https:\/\/campuscore-backend-p4em\.onrender\.com/i.test(source), `${name} must not embed a remote target`);
  }
});

test('invalid non-network targets exit before browser startup', () => {
  for (const name of browserDiagnostics) {
    const source = readScript(name);
    const validation = source.indexOf('parseTargetOptions(process.argv.slice(2))');
    const browserLoad = source.indexOf("require('playwright')");
    assert.ok(validation >= 0 && browserLoad > validation, `${name} must have a preflight guard before it can be executed`);

    const result = spawnSync(process.execPath, [resolve(scriptsDirectory, name), '--target', 'file:///invalid-target'], {
      encoding: 'utf8',
      timeout: 5000,
    });
    assert.equal(result.status, 2, `${name} must reject non-HTTP targets before starting Playwright`);
  }
});

test('help exits before browser startup', () => {
  for (const name of browserDiagnostics) {
    const source = readScript(name);
    const validation = source.indexOf('parseTargetOptions(process.argv.slice(2))');
    const browserLoad = source.indexOf("require('playwright')");
    assert.ok(validation >= 0 && browserLoad > validation, `${name} must have a preflight guard before it can be executed`);

    const result = spawnSync(process.execPath, [resolve(scriptsDirectory, name), '--help'], {
      encoding: 'utf8',
      timeout: 5000,
    });
    assert.equal(result.status, 0, `${name} help must exit cleanly without starting the browser`);
  }
});

test('browser diagnostics resolve Playwright through the installed package API', () => {
  for (const name of browserDiagnostics) {
    const source = readScript(name);
    assert.ok(source.includes('createRequire'), `${name} must use Node package resolution`);
    assert.ok(!source.includes('frontend/node_modules/playwright'), `${name} must not hard-code node_modules paths`);
  }
});

test('diagnostic logs omit URL queries and unknown option values', () => {
  for (const name of browserDiagnostics) {
    const source = readScript(name);
    assert.ok(!source.includes('Unknown option:'), `${name} must not echo untrusted option text`);
    assert.ok(!source.includes('err.message'), `${name} must not log raw browser error details`);
    const urlLogLines = source.split(/\r?\n/).filter((line) => /console\.(?:log|error)/.test(line)
      && /(?:page\.url\(\)|req\.url\(\)|res\.url\(\)|r\.url)/.test(line));
    assert.ok(urlLogLines.every((line) => line.includes('.pathname')), `${name} must log URL paths without query data`);

    const result = spawnSync(process.execPath, [resolve(scriptsDirectory, name), '--unrecognized-option=probe'], {
      encoding: 'utf8',
      timeout: 5000,
    });
    assert.equal(result.status, 2, `${name} must reject unknown options before browser startup`);
    assert.ok(!result.stderr.includes('--unrecognized-option=probe'), `${name} must not echo the rejected option`);
  }
});

test('role diagnostics require named environment credentials', () => {
  for (const name of ['benchmark-all-roles.mjs', 'audit-prod-browser.mjs', 'diagnose-login.mjs']) {
    const source = readScript(name);
    assert.ok(source.includes('CAMPUS_DIAGNOSTIC_'), `${name} must name its credential environment variables`);
    assert.ok(source.includes('process.env'), `${name} must read credentials from the environment`);
    assert.ok(source.includes('process.env[emailName]'), `${name} must read the email only from its named environment variable`);
    assert.ok(source.includes('process.env[passwordName]'), `${name} must read the password only from its named environment variable`);
    assert.ok(!/@campuscore\.(?:edu|demo)/i.test(source), `${name} must not embed default account identifiers`);
    const passwordFillLines = source.split(/\r?\n/).filter((line) => /page\.fill/i.test(line) && /password/i.test(line));
    assert.equal(passwordFillLines.length, 1, `${name} must submit one password field`);
    assert.ok(/\.(?:password)\s*\);$/.test(passwordFillLines[0].trim()), `${name} must not submit a literal password`);
  }
});

test('role diagnostics reject missing environment credentials before browser startup', () => {
  const credentialRoles = ['STUDENT', 'LECTURER', 'DEPARTMENT_HEAD', 'DEAN', 'ADMIN'];
  for (const name of ['benchmark-all-roles.mjs', 'audit-prod-browser.mjs']) {
    const source = readScript(name);
    const rolesPrepared = source.search(/const roles\s*=\s*(?:ROLES|ROLES_TO_TEST)\.map/);
    const browserStart = source.indexOf('chromium.launch');
    assert.ok(rolesPrepared >= 0 && browserStart > rolesPrepared, `${name} must validate credentials before browser startup`);

    const env = { ...process.env };
    for (const role of credentialRoles) {
      env[`CAMPUS_DIAGNOSTIC_${role}_EMAIL`] = '';
      env[`CAMPUS_DIAGNOSTIC_${role}_PASSWORD`] = '';
    }
    const result = spawnSync(process.execPath, [resolve(scriptsDirectory, name), '--target', 'http://127.0.0.1:3000'], {
      encoding: 'utf8',
      timeout: 5000,
      env,
    });
    assert.equal(result.status, 2, `${name} must refuse to run without configured credentials`);
  }
});

test('login diagnostic rejects missing environment credentials before browser startup', () => {
  const env = { ...process.env };
  env.CAMPUS_DIAGNOSTIC_STUDENT_EMAIL = '';
  env.CAMPUS_DIAGNOSTIC_STUDENT_PASSWORD = '';
  const result = spawnSync(process.execPath, [resolve(scriptsDirectory, 'diagnose-login.mjs'), '--target', 'http://127.0.0.1:3000'], {
    encoding: 'utf8',
    timeout: 5000,
    env,
  });
  assert.equal(result.status, 2, 'diagnose-login.mjs must refuse to run without configured credentials');
});

test('login diagnostic writes screenshots only under the ignored artifact tree', () => {
  const source = readScript('diagnose-login.mjs');
  assert.ok(source.includes('artifacts/verification/diagnostics/'), 'screenshot output must stay under artifacts');
  assert.ok(!source.includes('scripts/dashboard-rendered.png'), 'screenshot output must not dirty scripts');
});

test('historical deployment pollers are retired without requests', () => {
  for (const name of retiredPollers) {
    const source = readScript(name);
    assert.ok(/retired/i.test(source), `${name} must identify itself as retired`);
    assert.ok(source.includes('--help'), `${name} must provide guarded help`);
    assert.ok(!/\bfetch\s*\(/.test(source), `${name} must not issue a request`);

    const help = spawnSync(process.execPath, [resolve(scriptsDirectory, name), '--help'], { encoding: 'utf8', timeout: 5000 });
    const defaultRun = spawnSync(process.execPath, [resolve(scriptsDirectory, name)], { encoding: 'utf8', timeout: 5000 });
    assert.equal(help.status, 0, `${name} help must exit cleanly`);
    assert.equal(defaultRun.status, 2, `${name} must fail closed without network access`);
  }
});

test('fetch diagnostics validate an explicit target before issuing requests', () => {
  for (const name of fetchDiagnostics) {
    const source = readScript(name);
    const validation = source.indexOf('parseTargetOptions(process.argv.slice(2))');
    const firstRequest = source.indexOf('fetch(');

    assert.ok(source.includes('--target'), `${name} must document an explicit target`);
    assert.ok(source.includes('--allow-network'), `${name} must require network opt-in for remote targets`);
    assert.ok(validation >= 0 && firstRequest > validation, `${name} must validate its target before any request helper exists`);
    assert.ok(/if\s*\(\s*!isLoopback\(url\.hostname\)\s*&&\s*!allowNetwork\s*\)/.test(source), `${name} must reject remote targets without opt-in`);
    assert.ok(!/https:\/\/(?:www\.)?campusute\.io\.vn|https:\/\/campuscore-backend-p4em\.onrender\.com/i.test(source), `${name} must not embed a remote target`);
  }
});

test('fetch diagnostics reject bad targets and unknown options before any request', () => {
  for (const name of fetchDiagnostics) {
    const invalidTarget = spawnSync(process.execPath, [resolve(scriptsDirectory, name), '--target', 'file:///invalid-target'], {
      encoding: 'utf8',
      timeout: 5000,
    });
    assert.equal(invalidTarget.status, 2, `${name} must reject non-HTTP targets`);

    const missingTarget = spawnSync(process.execPath, [resolve(scriptsDirectory, name)], {
      encoding: 'utf8',
      timeout: 5000,
    });
    assert.equal(missingTarget.status, 2, `${name} must fail closed without an explicit target`);

    const help = spawnSync(process.execPath, [resolve(scriptsDirectory, name), '--help'], {
      encoding: 'utf8',
      timeout: 5000,
    });
    assert.equal(help.status, 0, `${name} help must exit cleanly`);

    const unknown = spawnSync(process.execPath, [resolve(scriptsDirectory, name), '--unrecognized-option=probe'], {
      encoding: 'utf8',
      timeout: 5000,
    });
    assert.equal(unknown.status, 2, `${name} must reject unknown options`);
    assert.ok(!unknown.stderr.includes('--unrecognized-option=probe'), `${name} must not echo the rejected option`);
  }
});

test('Java container health reports unauthenticated liveness only', () => {
  const dockerfile = readFileSync(resolve(scriptsDirectory, '../java-services/restful-api/Dockerfile'), 'utf8');
  assert.ok(/^HEALTHCHECK\b/m.test(dockerfile), 'Dockerfile must declare a native healthcheck');
  assert.ok(dockerfile.includes('/api/v1/health/liveness'), 'healthcheck must call liveness');
  assert.ok(dockerfile.includes('${PORT:-${SERVER_PORT:-4010}}'), 'healthcheck must follow the configured application port');
  assert.ok(!dockerfile.includes('/api/v1/health/readiness'), 'healthcheck must not claim readiness');
  assert.ok(!dockerfile.includes('X-Health-Key'), 'healthcheck must not embed a readiness key');
});
