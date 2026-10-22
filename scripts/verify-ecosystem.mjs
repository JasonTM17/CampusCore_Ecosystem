#!/usr/bin/env node
// Ecosystem verification runner (P01 step 3, PROPOSED contract).
//
//   node scripts/verify-ecosystem.mjs --gate <name> --target local|preview|demo --evidence <repo-relative dir>
//
// Registry: scripts/verify-ecosystem.gates.json — each phase registers named
// cases with concrete child commands (R2-1 binds contract-drift to P03 and
// host-registry/static-policy to P05).
//
// Contract (never empty-pass):
//   - unknown/unimplemented gate or target outside the allowlist → nonzero
//   - case missing a required capability → BLOCKED_CAPABILITY (nonzero overall)
//   - zero executed cases → NOT_RUN (nonzero)
//   - any required case FAIL → FAIL
// Report: <evidence>/report.json + masked run.log per case.
// Exit codes: 0 PASS · 1 FAIL · 2 usage · 3 NOT_RUN · 4 BLOCKED_CAPABILITY.

import { execFileSync, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REGISTRY_PATH = path.join(REPO, 'scripts', 'verify-ecosystem.gates.json');
const TARGETS = new Set(['local', 'preview', 'demo']);
const MIN_NODE = [22, 13, 0];
const EXIT = { PASS: 0, FAIL: 1, USAGE: 2, NOT_RUN: 3, BLOCKED: 4 };

const MASK_RE = /(password|passwd|secret|token|api[_-]?key|authorization|credential)[^\s"']{0,64}([:=]\s*|"?:\s*")([^\s"',}]+)/gi;

function usage(msg) {
  if (msg) console.error(msg);
  console.error('Usage: verify-ecosystem.mjs --gate <name> [--target local|preview|demo] [--evidence dir] [--list] [--only caseId,caseId]');
  process.exit(EXIT.USAGE);
}

function parseArgs(argv) {
  const args = { target: 'local' };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--list') args.list = true;
    else if (a === '--gate') args.gate = argv[++i];
    else if (a === '--target') args.target = argv[++i];
    else if (a === '--evidence') args.evidence = argv[++i];
    else if (a === '--only') args.only = argv[++i].split(',').map((s) => s.trim()).filter(Boolean);
    else usage(`unknown flag ${a}`);
  }
  return args;
}

function maskSecrets(text) {
  return String(text).replace(MASK_RE, (_m, k, _mid, sep) => `${k}${sep}***`);
}

function capability(name) {
  // docker is probed; everything else is an externally granted capability that
  // must be declared via ECO_CAP_<NAME>=1. Absence → BLOCKED_CAPABILITY, never skip.
  if (name === 'docker') {
    try {
      execFileSync('docker', ['compose', 'version'], { stdio: ['ignore', 'pipe', 'pipe'] });
      return true;
    } catch { return false; }
  }
  return process.env[`ECO_CAP_${name.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`] === '1';
}

function gitSha() {
  try { return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO, encoding: 'utf8' }).trim(); }
  catch { return 'unknown'; }
}

function substitute(value, ctx) {
  return value
    .replaceAll('{evidence}', ctx.evidenceDir)
    .replaceAll('{auto-project}', ctx.autoProject)
    .replaceAll('{gate}', ctx.gate)
    .replaceAll('{target}', ctx.target);
}

function runCase(kase, ctx) {
  const started = Date.now();
  const result = { id: kase.id, required: kase.required !== false, status: 'PASS', exitCode: 0, durationMs: 0, log: null };
  if (kase.targets && !kase.targets.includes(ctx.target)) {
    result.status = 'NOT_RUN'; result.reason = `target ${ctx.target} not in ${JSON.stringify(kase.targets)}`; return result;
  }
  if (kase.capability && !capability(kase.capability)) {
    result.status = 'BLOCKED_CAPABILITY'; result.reason = `missing capability ${kase.capability}`; return result;
  }
  if (!kase.run || !kase.run.cmd) {
    result.status = 'NOT_RUN'; result.reason = 'case has no run command registered'; return result;
  }
  const cmd = substitute(kase.run.cmd, ctx);
  const argv = (kase.run.args || []).map((a) => substitute(String(a), ctx));
  const cwd = kase.run.cwd ? path.join(REPO, substitute(kase.run.cwd, ctx)) : REPO;
  const env = { ...process.env };
  for (const [k, v] of Object.entries(kase.run.env || {})) env[k] = substitute(String(v), ctx);
  const spawnOpts = {
    cwd, env, encoding: 'utf8', timeout: kase.run.timeoutMs || 600000,
    maxBuffer: 64 * 1024 * 1024, shell: false,
  };
  let proc = spawnSync(cmd, argv, spawnOpts);
  if (proc.error && process.platform === 'win32'
      && (proc.error.code === 'ENOENT' || proc.error.code === 'EINVAL')) {
    // npm/mvn/npx ship as .cmd shims on Windows; execFile/spawn cannot run them
    // without a shell (EINVAL since Node's CVE-2024-27980 hardening).
    proc = spawnSync(cmd, argv, { ...spawnOpts, shell: true });
  }
  result.durationMs = Date.now() - started;
  result.exitCode = proc.status === null ? -1 : proc.status;
  const output = [proc.stdout || '', proc.stderr || ''].join('\n');
  result.log = maskSecrets(output.slice(-20000));
  if (proc.error) {
    result.status = 'FAIL'; result.reason = String(proc.error.message || proc.error);
  } else if (result.exitCode === 4) {
    result.status = 'BLOCKED_CAPABILITY';
  } else if (result.exitCode !== 0) {
    result.status = 'FAIL';
    if (result.exitCode === 3) result.reason = 'child reported NOT_RUN';
  }
  return result;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const [maj, min] = process.versions.node.split('.').map(Number);
  if (maj < MIN_NODE[0] || (maj === MIN_NODE[0] && min < MIN_NODE[1])) {
    console.error(`BLOCKED_CAPABILITY node ${process.versions.node} < ${MIN_NODE.join('.')}`);
    process.exit(EXIT.BLOCKED);
  }
  if (!fs.existsSync(REGISTRY_PATH)) {
    console.error(`NOT_RUN gate registry missing: ${path.relative(REPO, REGISTRY_PATH)}`);
    process.exit(EXIT.NOT_RUN);
  }
  const registry = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'));
  if (args.list) {
    for (const [name, g] of Object.entries(registry.gates || {})) {
      console.log(`${name}\towner=${g.owner_phase || '?'}\tcases=${(g.cases || []).length}\t${g.description || ''}`);
    }
    process.exit(EXIT.PASS);
  }
  if (!args.gate) usage('--gate is required');
  if (!TARGETS.has(args.target)) {
    console.error(`USAGE_FAIL target '${args.target}' outside allowlist ${[...TARGETS].join('|')}`);
    process.exit(EXIT.USAGE);
  }
  const gate = (registry.gates || {})[args.gate];
  if (!gate || !Array.isArray(gate.cases) || gate.cases.length === 0) {
    console.error(`NOT_RUN gate '${args.gate}' is not registered or has no cases`);
    process.exit(EXIT.NOT_RUN);
  }
  const evidenceDir = args.evidence
    ? path.resolve(REPO, args.evidence)
    : path.join(REPO, 'artifacts', 'verification', args.gate);
  if (!evidenceDir.startsWith(REPO)) usage('--evidence must be a repo-relative path');
  fs.mkdirSync(evidenceDir, { recursive: true });
  const ctx = {
    gate: args.gate, target: args.target, evidenceDir,
    autoProject: `campuscore-ecosystem-fixture-${process.pid}-${Date.now().toString(36)}`,
  };

  const selected = args.only ? gate.cases.filter((c) => args.only.includes(c.id)) : gate.cases;
  if (args.only && selected.length === 0) {
    console.error(`NOT_RUN --only matched no cases in gate '${args.gate}'`);
    process.exit(EXIT.NOT_RUN);
  }
  const results = [];
  const runLogLines = [];
  for (const kase of selected) {
    const res = runCase(kase, ctx);
    results.push(res);
    const line = `[${res.status}] ${res.id} exit=${res.exitCode} ${res.durationMs}ms ${res.reason || ''}`;
    runLogLines.push(line);
    console.log(line);
    const logPath = path.join(evidenceDir, `${kase.id}.log`);
    fs.writeFileSync(logPath, res.log || res.reason || '', 'utf8');
  }

  const executed = results.filter((r) => r.status === 'PASS' || r.status === 'FAIL');
  const failed = results.filter((r) => r.status === 'FAIL');
  const blocked = results.filter((r) => r.status === 'BLOCKED_CAPABILITY');
  const notRun = results.filter((r) => r.status === 'NOT_RUN');
  const requiredFailed = failed.filter((r) => r.required);
  const requiredBlocked = blocked.filter((r) => r.required);
  const requiredNotRun = notRun.filter((r) => r.required);

  let verdict = 'PASS'; let code = EXIT.PASS;
  if (executed.length === 0) { verdict = 'NOT_RUN'; code = EXIT.NOT_RUN; }
  else if (requiredFailed.length) { verdict = 'FAIL'; code = EXIT.FAIL; }
  else if (requiredBlocked.length) { verdict = 'BLOCKED_CAPABILITY'; code = EXIT.BLOCKED; }
  // A required case that never executed is an evidence gap, not a pass (ND-7).
  else if (requiredNotRun.length) { verdict = 'NOT_RUN'; code = EXIT.NOT_RUN; }
  // A --only subset that passes must never read as a full-gate PASS (tester F8).
  else if (selected.length < gate.cases.length) { verdict = 'PASS_PARTIAL'; code = EXIT.PASS; }

  const report = {
    gate: args.gate,
    owner_phase: gate.owner_phase || null,
    target: args.target,
    verdict,
    identity: {
      node: process.versions.node, platform: process.platform,
      gitSha: gitSha(), checkedAt: new Date().toISOString(),
      evidenceDir: path.relative(REPO, evidenceDir),
      runId: crypto.randomUUID(),
    },
    counts: {
      total: results.length, selected: selected.length, executed: executed.length,
      passed: results.filter((r) => r.status === 'PASS').length,
      failed: failed.length, blocked: blocked.length,
      notRun: results.filter((r) => r.status === 'NOT_RUN').length,
    },
    cases: results.map((r) => ({
      id: r.id, required: r.required, status: r.status,
      exitCode: r.exitCode, durationMs: r.durationMs,
      reason: r.reason || null, log: `${r.id}.log`,
    })),
  };
  fs.writeFileSync(path.join(evidenceDir, 'report.json'), JSON.stringify(report, null, 2) + '\n', 'utf8');
  fs.writeFileSync(path.join(evidenceDir, 'run.log'), maskSecrets(runLogLines.join('\n')) + '\n', 'utf8');
  console.log(`GATE ${args.gate} target=${args.target} verdict=${verdict} executed=${executed.length}/${results.length} evidence=${path.relative(REPO, evidenceDir)}`);
  process.exit(code);
}

main();
