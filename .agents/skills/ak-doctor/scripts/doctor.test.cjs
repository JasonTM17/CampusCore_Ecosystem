'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { run, parseArgs } = require('./doctor.cjs');
const { REQUIRED_SKILLS, REQUIRED_AGENTS } = require('../../ak-common/scripts/capability-diagnostics.cjs');

function fixture(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentkit doctor-'));
  try {
    for (const name of REQUIRED_SKILLS) {
      const directory = path.join(root, '.codex/skills', name); fs.mkdirSync(directory, { recursive: true });
      fs.writeFileSync(path.join(directory, 'SKILL.md'), `---\nname: ak:${name.slice(3)}\n---\n`);
    }
    for (const name of REQUIRED_AGENTS) {
      const directory = path.join(root, '.codex/agents'); fs.mkdirSync(directory, { recursive: true });
      fs.writeFileSync(path.join(directory, name + '.toml'), `[agents.${name}]\n`);
    }
    const files = () => fs.readdirSync(path.join(root, '.codex/skills')).sort().join(',') + ':' + fs.readdirSync(path.join(root, '.codex/agents')).sort().join(',');
    return fn(root, files);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

test('default doctor only reads and distinguishes static from live', () => fixture((root, files) => {
  const before = files();
  const report = run({ root, runtime: 'codex', deep: false });
  assert.equal(report.status, 'PASS');
  assert.equal(report.evidenceClass, 'static');
  assert.equal(report.runtimeExecution, 'NOT_RUN');
  assert.equal(report.providerExecution, 'NOT_RUN');
  assert.deepEqual(report.deep, []);
  assert.equal(files(), before);
}));

test('missing and duplicate registries are reported, never repaired', () => fixture((root) => {
  fs.rmSync(path.join(root, '.codex/skills/ak-eval'), { recursive: true });
  const report = run({ root, runtime: 'codex', deep: false });
  assert.equal(report.status, 'BLOCKED_CAPABILITY');
  assert.deepEqual(report.runtimes[0].skills.missing, ['ak-eval']);
  assert.equal(fs.existsSync(path.join(root, '.codex/skills/ak-eval')), false);
}));

test('deep mode reports absent optional validators as NOT_RUN', () => fixture(root => {
  const report = run({ root, runtime: 'codex', deep: true });
  assert.equal(report.status, 'PASS');
  assert.deepEqual(report.deep.map(d => d.status), ['NOT_RUN', 'NOT_RUN']);
}));

test('declared adapter version mismatch fails without changing files', () => fixture(root => {
  const file = path.join(root, '.agentkit/runtime-capabilities.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ kit_version: '0.3.0', runtimes: { zcode: { delivery: 'plugin' } } }));
  const plugin = path.join(root, 'engineer/.zcode-plugin/plugin.json');
  fs.mkdirSync(path.dirname(plugin), { recursive: true });
  fs.writeFileSync(plugin, JSON.stringify({ version: '0.2.0' }));
  const report = run({ root, runtime: 'zcode', deep: false });
  assert.equal(report.status, 'FAIL');
  assert.equal(report.runtimes[0].adapterMetadata.reason, 'plugin version differs from kit version');
  assert.equal(JSON.parse(fs.readFileSync(plugin)).version, '0.2.0');
}));

test('explicit user registry roots are diagnosed without project fallback', () => fixture(root => {
  const options = parseArgs(['--root', root, '--runtime', 'codex', '--skills-root', path.join(root, '.codex/skills'), '--agents-root', path.join(root, '.codex/agents')]);
  const report = run(options);
  assert.equal(report.status, 'PASS');
  assert.equal(report.registrySelection, 'explicit roots');
  assert.equal(report.runtimes[0].selectedRegistry, '<explicit-skills-root>');
  assert.equal(report.runtimes[0].adapterMetadata.status, 'NOT_RUN');
  assert.equal(report.runtimes[0].hookConfiguration.status, 'NOT_RUN');
  assert.equal(report.runtimes[0].sessionState.status, 'NOT_RUN');
  assert.equal(run({ ...options, deep: true }).deep[0].status, 'NOT_RUN');
  assert.ok(!JSON.stringify(report).includes(root));
  assert.throws(() => parseArgs(['--skills-root', root]), /require/);
}));

test('only the new workflow bundle is insufficient for whole-install PASS', () => fixture(root => {
  for (const name of REQUIRED_SKILLS) {
    if (!['ak-business-analysis', 'ak-integration-contracts', 'ak-eval', 'ak-doctor'].includes(name)) fs.rmSync(path.join(root, '.codex/skills', name), { recursive: true });
  }
  const report = run({ root, runtime: 'codex', deep: false });
  assert.equal(report.status, 'BLOCKED_CAPABILITY');
  assert.ok(report.runtimes[0].skills.missing.includes('ak-cook'));
}));

test('Devin requires native Office entries and keeps live evidence separate', () => fixture(root => {
  fs.renameSync(path.join(root, '.codex/skills'), path.join(root, '.codex/shared'));
  fs.mkdirSync(path.join(root, '.agents'), { recursive: true });
  fs.renameSync(path.join(root, '.codex/shared'), path.join(root, '.agents/skills'));
  fs.mkdirSync(path.join(root, '.devin/agents'), { recursive: true });
  for (const name of REQUIRED_AGENTS) fs.writeFileSync(path.join(root, '.devin/agents', name + '.md'), `---\nname: ${name}\n---\n`);
  const options = parseArgs(['--root', root, '--runtime', 'devin', '--json']);
  const missing = run(options);
  assert.equal(missing.status, 'BLOCKED_CAPABILITY');
  assert.equal(missing.runtimes[0].nativeSkillEntries.missing.length, 4);
  for (const name of ['docx', 'pdf', 'pptx', 'xlsx']) {
    const folder = path.join(root, '.devin/skills', 'ak-' + name);
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, 'SKILL.md'), `---\nname: ak:${name}\n---\n`);
  }
  const complete = run(options);
  assert.equal(complete.status, 'PASS');
  assert.equal(complete.runtimes[0].selectedRegistry, '.agents/skills');
  assert.equal(complete.runtimeExecution, 'NOT_RUN');
  assert.equal(complete.providerExecution, 'NOT_RUN');
  assert.equal(complete.runtimes[0].sessionState.status, 'BLOCKED_CAPABILITY');
}));
