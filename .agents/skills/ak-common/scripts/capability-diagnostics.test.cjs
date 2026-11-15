'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { diagnose, hookMetrics, REQUIRED_SKILLS, REQUIRED_AGENTS } = require('./capability-diagnostics.cjs');

function fixture(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentkit capabilities '));
  try {
    for (const name of REQUIRED_SKILLS) {
      const dir = path.join(root, '.codex/skills', name);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'SKILL.md'), `---\nname: ak:${name.slice(3)}\n---\n# Example\n`);
    }
    for (const name of REQUIRED_AGENTS) {
      const dir = path.join(root, '.codex/agents'); fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `${name}.toml`), `[agents.${name}]\ndeveloper_instructions = '''example'''\n`);
    }
    fs.mkdirSync(path.join(root, '.codex'), { recursive: true });
    fs.writeFileSync(path.join(root, '.codex/hooks.json'), '{}');
    return fn(root);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

test('static inventory passes without claiming live execution', () => fixture(root => {
  const report = diagnose(root, 'codex', { CK_SESSION_ID: 'session' });
  assert.equal(report.skills.status, 'PASS'); assert.equal(report.agents.status, 'PASS');
  assert.equal(report.hookConfiguration.status, 'PASS');
  assert.equal(report.sessionState.status, 'NOT_RUN');
  assert.equal(report.liveRuntime, 'NOT_RUN'); assert.equal(report.provider, 'NOT_RUN');
}));

test('missing capability, duplicate name and unsupported state are visible', () => fixture(root => {
  fs.rmSync(path.join(root, '.codex/skills/ak-doctor'), { recursive: true });
  let report = diagnose(root, 'codex', {});
  assert.deepEqual(report.skills.missing, ['ak-doctor']);
  assert.equal(report.skills.status, 'BLOCKED_CAPABILITY');
  assert.equal(report.sessionState.status, 'BLOCKED_CAPABILITY');
  const dup = path.join(root, '.codex/skills/ak-duplicate'); fs.mkdirSync(dup);
  fs.writeFileSync(path.join(dup, 'SKILL.md'), '---\nname: ak:eval\n---\nduplicate\n');
  report = diagnose(root, 'codex', {});
  assert.equal(report.skills.status, 'FAIL'); assert.deepEqual(report.skills.duplicates, ['eval']);
  assert.equal(diagnose(root, 'cursor', {}).sessionState.status, 'BLOCKED_CAPABILITY');
}));

test('hook metrics aggregate duration and errors without raw log content', () => fixture(root => {
  const log = path.join(root, 'hook-log.jsonl');
  fs.writeFileSync(log, '{"hook":"one","dur":8,"status":"ok","exit":0,"contextBytes":120}\n{"hook":"two","dur":25,"status":"error","exit":1,"target":"secret"}\n{"hook":"three","dur":2,"status":"crash","exit":0}\n');
  assert.deepEqual(hookMetrics(log), { status: 'PASS', runs: 3, failures: 2, totalDurationMs: 35, maxDurationMs: 25, contextStatus: 'PASS', contextRuns: 1, totalContextBytes: 120 });
}));

test('core skill missing from an otherwise complete install is blocked', () => fixture(root => {
  fs.rmSync(path.join(root, '.codex/skills/ak-cook'), { recursive: true });
  const report = diagnose(root, 'codex', {});
  assert.equal(report.skills.status, 'BLOCKED_CAPABILITY');
  assert.ok(report.skills.missing.includes('ak-cook'));
}));

test('existing Cursor Explore filename is matched to the canonical agent role', () => fixture(root => {
  fs.renameSync(path.join(root, '.codex/agents/explore.toml'), path.join(root, '.codex/agents/Explore.md'));
  fs.writeFileSync(path.join(root, '.codex/agents/Explore.md'), '---\nname: Explore\n---\n');
  assert.equal(diagnose(root, 'codex', {}).agents.status, 'PASS');
}));

test('linked skill installs are discovered and cycles are bounded', () => fixture(root => {
  const link = path.join(root, '.codex/skills/ak-cook');
  const target = path.join(root, 'linked-cook');
  fs.renameSync(link, target);
  fs.symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir');
  fs.symlinkSync(target, path.join(target, 'cycle'), process.platform === 'win32' ? 'junction' : 'dir');
  const report = diagnose(root, 'codex', {});
  assert.equal(report.skills.status, 'PASS');
  assert.equal(report.skills.count, REQUIRED_SKILLS.length);
  // A second registry alias must remain visible as a duplicate, not be hidden
  // by global realpath deduplication used for cycle protection.
  fs.symlinkSync(target, path.join(root, '.codex/skills/cook-alias'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.deepEqual(diagnose(root, 'codex', {}).skills.duplicates, ['cook']);
}));
