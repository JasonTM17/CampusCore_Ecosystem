'use strict';
const fs = require('node:fs');
const path = require('node:path');

const roster = require('../references/capability-roster.json');
const REQUIRED_SKILLS = roster.skills;
const REQUIRED_AGENTS = roster.agents;
const RUNTIMES = {
  codex: { skills: '.codex/skills', agents: '.codex/agents', hooks: '.codex/hooks.json', stateHook: true },
  claude: { skills: '.claude/skills', agents: '.claude/agents', hooks: '.claude/settings.json', stateHook: true },
  cursor: { skills: '.cursor/skills', agents: '.cursor/agents', hooks: '.cursor/hooks.json', stateHook: false },
  gemini: { skills: '.agents/skills', agents: '.gemini/agents', hooks: '.gemini/settings.json', stateHook: false },
  opencode: { skills: '.agents/skills', agents: '.opencode/agents', stateHook: false },
  omp: { skills: '.agents/skills', agents: '.omp/agents', stateHook: false },
  devin: { skills: '.agents/skills', agents: '.devin/agents', stateHook: false },
  grok: { skills: '.grok/skills', agents: '.grok/agents', stateHook: false },
  antigravity: { skills: '.agents/skills', agents: '.agents/agents', stateHook: false },
  zcode: { skills: 'engineer/skills', agents: 'engineer/agents', hooks: 'engineer/hooks', stateHook: false }
};

function inventory(root, relative, kind, explicitDirectory) {
  const directory = explicitDirectory ? path.resolve(explicitDirectory) : path.join(root, relative);
  if (!fs.existsSync(directory)) return { status: 'BLOCKED_CAPABILITY', count: 0, missingDirectory: relative, names: [], duplicates: [] };
  const names = [];
  const source = [];
  function collect(current, depth = 0, ancestors = new Set()) {
    const realDirectory = fs.realpathSync(current);
    if (ancestors.has(realDirectory)) return; // Junction/symlink cycles add no capabilities.
    const nextAncestors = new Set(ancestors).add(realDirectory);
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const file = path.join(current, entry.name);
      const target = entry.isSymbolicLink() ? fs.statSync(file) : entry;
      if (target.isDirectory() && depth < 4 && !entry.name.startsWith('.') && !['node_modules', 'scripts', 'references', 'assets', 'data', '__pycache__'].includes(entry.name)) collect(file, depth + 1, nextAncestors);
      else if (target.isFile() && (kind === 'skill' ? entry.name === 'SKILL.md' : /\.(toml|md)$/.test(entry.name))) source.push(file);
    }
  }
  collect(directory);
  let invalidNames = 0;
  for (const file of source) {
    const body = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
    const front = body.startsWith('---\n') ? body.slice(4, body.indexOf('\n---\n', 4)) : '';
    const declared = kind === 'skill' ? /^name:\s*['"]?ak[:-]([a-z0-9-]+)/m.exec(front)?.[1] : /^name:\s*['"]?([a-z0-9-]+)/m.exec(front)?.[1];
    const fallback = kind === 'skill' || path.basename(file) === 'agent.md' ? path.basename(path.dirname(file)).replace(/^ak-/, '') : path.basename(file).replace(/\.(toml|md)$/, '');
    if (kind === 'skill' && !declared) invalidNames++;
    names.push(kind === 'agent' ? (declared || fallback).toLowerCase().replace(/^ak-/, '') : declared || fallback);
  }
  const duplicates = names.filter((n, i) => names.indexOf(n) !== i);
  return { status: duplicates.length || invalidNames ? 'FAIL' : 'PASS', count: names.length, names: [...new Set(names)].sort(), duplicates: [...new Set(duplicates)], invalidNames };
}

function hookMetrics(logFile) {
  if (!fs.existsSync(logFile)) return { status: 'NOT_RUN', runs: 0, failures: 0, totalDurationMs: 0, maxDurationMs: 0, contextStatus: 'NOT_RUN', contextRuns: 0, totalContextBytes: null };
  const lines = fs.readFileSync(logFile, 'utf8').split(/\r?\n/).filter(Boolean).slice(-500);
  const entries = [];
  for (const line of lines) { try { const x = JSON.parse(line); if (typeof x.dur === 'number' && Number.isFinite(x.dur)) entries.push(x); } catch { /* malformed old line */ } }
  const measured = entries.filter(e => Number.isSafeInteger(e.contextBytes) && e.contextBytes >= 0);
  return { status: entries.length ? 'PASS' : 'NOT_RUN', runs: entries.length, failures: entries.filter(e => e.status === 'error' || e.status === 'crash' || e.exit !== 0).length, totalDurationMs: entries.reduce((n, e) => n + e.dur, 0), maxDurationMs: Math.max(0, ...entries.map(e => e.dur)), contextStatus: measured.length ? 'PASS' : 'NOT_RUN', contextRuns: measured.length, totalContextBytes: measured.length ? measured.reduce((n, e) => n + e.contextBytes, 0) : null };
}

function diagnose(root, runtime, env = process.env, directories = {}) {
  const profile = RUNTIMES[runtime];
  if (!profile) throw Error(`unsupported runtime ${runtime}`);
  root = path.resolve(root);
  const explicitRoots = Boolean(directories.skillsRoot || directories.agentsRoot);
  const skills = inventory(root, profile.skills, 'skill', directories.skillsRoot);
  const agents = inventory(root, profile.agents, 'agent', directories.agentsRoot);
  const missingSkills = REQUIRED_SKILLS.filter(name => !skills.names.includes(name.replace(/^ak-/, '')));
  const officeEntries = runtime === 'devin' && !explicitRoots
    ? ['docx', 'pdf', 'pptx', 'xlsx'].filter(name => !fs.existsSync(path.join(root, `.devin/skills/ak-${name}/SKILL.md`))) : [];
  const missingAgents = REQUIRED_AGENTS.filter(name => !agents.names.includes(name));
  const hooksConfigured = Boolean(!explicitRoots && profile.hooks && fs.existsSync(path.join(root, profile.hooks)));
  const selectedSkills = profile.skills;
  const secondary = selectedSkills === '.agents/skills' ? '.codex/skills' : '.agents/skills';
  const overlap = !explicitRoots && fs.existsSync(path.join(root, secondary)) ? missingSkills.length === 0 ? REQUIRED_SKILLS.filter(name => fs.existsSync(path.join(root, secondary, name, 'SKILL.md'))) : [] : [];
  const logRoot = !explicitRoots && ['codex', 'claude', 'cursor'].includes(runtime) ? `.${runtime}/hooks/.logs/hook-log.jsonl` : null;
  const metrics = logRoot ? hookMetrics(path.join(root, logRoot)) : { status: 'NOT_RUN', runs: 0, failures: 0, totalDurationMs: 0, maxDurationMs: 0, contextStatus: 'NOT_RUN', contextRuns: 0, totalContextBytes: null };
  return {
    schemaVersion: 1, runtime, selectedRegistry: directories.skillsRoot ? '<explicit-skills-root>' : selectedSkills,
    inventoryScope: 'bundled canonical roster', expectedSkills: REQUIRED_SKILLS.length, expectedAgents: REQUIRED_AGENTS.length,
    skills: { status: skills.status === 'PASS' && !missingSkills.length && !officeEntries.length ? 'PASS' : skills.status === 'FAIL' ? 'FAIL' : 'BLOCKED_CAPABILITY', count: skills.count, missing: missingSkills, duplicates: skills.duplicates },
    ...(runtime === 'devin' ? { nativeSkillEntries: { status: explicitRoots ? 'NOT_RUN' : officeEntries.length ? 'BLOCKED_CAPABILITY' : 'PASS', missing: officeEntries, note: 'Native folder aliases plus four sparse Office entries; static coverage only' } } : {}),
    agents: { status: agents.status === 'PASS' && !missingAgents.length ? 'PASS' : agents.status === 'FAIL' ? 'FAIL' : 'BLOCKED_CAPABILITY', count: agents.count, missing: missingAgents, duplicates: agents.duplicates },
    registryOverlap: { count: overlap.length, status: overlap.length ? 'PASS' : 'NOT_RUN', note: overlap.length ? 'Expected multi-runtime mirrors; select one registry per task' : 'No selected-name overlap observed' },
    hookConfiguration: { status: hooksConfigured ? 'PASS' : 'NOT_RUN', eventExecution: 'NOT_RUN' },
    sessionState: explicitRoots ? { status: 'NOT_RUN', reason: 'Explicit registry roots establish inventory only' } : { status: profile.stateHook ? env.CK_SESSION_ID && hooksConfigured ? 'NOT_RUN' : 'BLOCKED_CAPABILITY' : 'BLOCKED_CAPABILITY', reason: profile.stateHook ? env.CK_SESSION_ID ? 'Marker present; persistence needs an observed runtime receipt' : 'CK_SESSION_ID absent' : 'No reviewed session-state bridge' },
    hookMetrics: metrics,
    liveRuntime: 'NOT_RUN', provider: 'NOT_RUN'
  };
}

module.exports = { diagnose, inventory, hookMetrics, REQUIRED_SKILLS, REQUIRED_AGENTS, RUNTIMES };
