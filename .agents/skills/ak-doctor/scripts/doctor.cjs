#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { diagnose, RUNTIMES } = require('../../ak-common/scripts/capability-diagnostics.cjs');

function parseArgs(argv) {
  const options = { root: process.cwd(), runtime: null, deep: false, json: false, skillsRoot: null, agentsRoot: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--root' && argv[i + 1]) options.root = argv[++i];
    else if (argv[i] === '--runtime' && argv[i + 1]) options.runtime = argv[++i];
    else if (argv[i] === '--skills-root' && argv[i + 1]) options.skillsRoot = argv[++i];
    else if (argv[i] === '--agents-root' && argv[i + 1]) options.agentsRoot = argv[++i];
    else if (argv[i] === '--deep') options.deep = true;
    else if (argv[i] === '--json') options.json = true;
    else throw Error(`unknown argument ${argv[i]}`);
  }
  if (options.runtime && !RUNTIMES[options.runtime]) throw Error('unsupported runtime');
  if ((options.skillsRoot || options.agentsRoot) && (!options.runtime || !options.skillsRoot || !options.agentsRoot)) throw Error('explicit registry roots require --runtime, --skills-root and --agents-root together');
  return options;
}

function deepChecks(root) {
  const checks = [];
  const scripts = [
    ['skill-crossrefs', 'engineer/.agentkit/scripts/validate-skill-crossrefs.py', ['engineer/skills', '--json']],
    ['install-manifest', 'engineer/.agentkit/scripts/generate-install-manifest.py', ['--check']]
  ];
  for (const [name, script, arguments_] of scripts) {
    if (!fs.existsSync(path.join(root, script))) { checks.push({ name, status: 'NOT_RUN', reason: 'validator source absent' }); continue; }
    const result = spawnSync(process.platform === 'win32' ? 'python' : 'python3', [path.join(root, script), ...arguments_], { cwd: root, shell: false, timeout: 15000, encoding: 'utf8', windowsHide: true, maxBuffer: 1024 * 1024 });
    checks.push({ name, status: result.error?.code === 'ENOENT' ? 'BLOCKED_CAPABILITY' : result.status === 0 && !result.error ? 'PASS' : 'FAIL', reason: result.error?.code === 'ENOENT' ? 'Python unavailable' : result.error ? 'validator error or timeout' : result.status === 0 ? null : 'validator returned nonzero' });
  }
  return checks;
}

function adapterMetadata(root, runtime) {
  const capabilityFile = path.join(root, '.agentkit/runtime-capabilities.json');
  if (!fs.existsSync(capabilityFile)) return { status: 'NOT_RUN', reason: 'kit capability manifest absent' };
  try {
    const manifest = JSON.parse(fs.readFileSync(capabilityFile, 'utf8'));
    const kitVersion = manifest.kit_version;
    const delivery = manifest.runtimes?.[runtime]?.delivery;
    if (typeof kitVersion !== 'string' || !/^\d+\.\d+\.\d+$/.test(kitVersion) || typeof delivery !== 'string') {
      return { status: 'FAIL', reason: 'kit version or runtime delivery metadata invalid' };
    }
    let declaredVersion = null;
    if (runtime === 'zcode') {
      const pluginFile = path.join(root, 'engineer/.zcode-plugin/plugin.json');
      if (!fs.existsSync(pluginFile)) return { status: 'NOT_RUN', kitVersion, delivery, reason: 'ZCode plugin metadata absent' };
      declaredVersion = JSON.parse(fs.readFileSync(pluginFile, 'utf8')).version;
      if (declaredVersion !== kitVersion) return { status: 'FAIL', kitVersion, declaredVersion, delivery, reason: 'plugin version differs from kit version' };
    }
    return { status: 'PASS', kitVersion, declaredVersion, delivery, source: '.agentkit/runtime-capabilities.json' };
  } catch {
    return { status: 'FAIL', reason: 'adapter metadata is unreadable or invalid JSON' };
  }
}

function run(options) {
  const root = path.resolve(options.root);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw Error('project root not found');
  const runtimes = options.runtime ? [options.runtime] : Object.keys(RUNTIMES).filter(name => {
    const profile = RUNTIMES[name];
    if (profile.skills === '.agents/skills') return fs.existsSync(path.join(root, profile.agents));
    return fs.existsSync(path.join(root, profile.skills)) || fs.existsSync(path.join(root, profile.agents));
  });
  const reports = runtimes.map(name => ({ ...diagnose(root, name, process.env, options), adapterMetadata: options.skillsRoot ? { status: 'NOT_RUN', reason: 'explicit registry roots do not establish adapter metadata' } : adapterMetadata(root, name) }));
  const deep = options.deep ? options.skillsRoot ? [{ name: 'project-validators', status: 'NOT_RUN', reason: 'explicit registry roots do not establish a project validator scope' }] : deepChecks(root) : [];
  const status = !reports.length ? 'BLOCKED_CAPABILITY' : reports.some(r => r.skills.status === 'FAIL' || r.agents.status === 'FAIL' || r.adapterMetadata.status === 'FAIL' || deep.some(c => c.status === 'FAIL')) ? 'FAIL' : reports.some(r => r.skills.status !== 'PASS' || r.agents.status !== 'PASS') ? 'BLOCKED_CAPABILITY' : 'PASS';
  return { schemaVersion: 1, status, evidenceClass: 'static', registrySelection: options.skillsRoot ? 'explicit roots' : 'project root', runtimes: reports, deep,
    runtimeExecution: 'NOT_RUN', providerExecution: 'NOT_RUN',
    note: 'Static PASS does not qualify a runtime event, workflow behavior or authenticated provider' };
}

if (require.main === module) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const result = run(options);
    console.log(options.json ? JSON.stringify(result) : `${result.status}: ${result.runtimes.length} runtime registries inspected; live runtime/provider NOT_RUN`);
    process.exitCode = result.status === 'PASS' ? 0 : 1;
  } catch (error) { console.log(JSON.stringify({ status: 'FAIL', reason: String(error.message || error).slice(0, 200) })); process.exitCode = 1; }
}
module.exports = { parseArgs, run, deepChecks, adapterMetadata };
