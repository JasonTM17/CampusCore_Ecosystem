#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { safeRelative } = require('./workflow-contract.cjs');

const digest = value => crypto.createHash('sha256').update(value).digest('hex');
function redact(value) {
  let text = String(value || '');
  const home = os.homedir();
  if (home) {
    for (const spelling of new Set([home, home.replace(/\\/g, '/'), home.replace(/\//g, '\\')])) {
      const pattern = spelling.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      text = text.replace(new RegExp(pattern, process.platform === 'win32' ? 'gi' : 'g'), '[HOME]');
    }
  }
  return text
    .replace(/\b(Bearer\s+)[^\s]+/gi, '$1[REDACTED]')
    .replace(/\b(sk-[A-Za-z0-9_-]{8,}|AKIA[A-Z0-9]{16}|gh[opusr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g, '[REDACTED]')
    .replace(/\b(password|api[_-]?key|secret|token)\s*[:=]\s*[^\s,;]+/gi, '$1=[REDACTED]')
    .replace(/(https?:\/\/)[^/@\s:]+:[^/@\s]+@/gi, '$1[REDACTED]@')
    .slice(0, 4096);
}

function validateSpec(spec) {
  if (!spec || spec.version !== 1) throw Error('spec.version must be 1');
  if (!/^[a-z0-9][a-z0-9:._-]+$/i.test(spec.commandId || '')) throw Error('invalid commandId');
  if (!Array.isArray(spec.argv) || !spec.argv.length || spec.argv.some(a => typeof a !== 'string' || !a.length || a.includes('\0'))) throw Error('argv must be nonempty string array');
  if (spec.shell !== undefined || spec.env !== undefined) throw Error('shell and env overrides are unsupported');
  if (spec.cwd !== '.' && !safeRelative(spec.cwd)) throw Error('cwd must be a portable relative path');
  if (!Array.isArray(spec.scope) || !spec.scope.length || spec.scope.some(p => !safeRelative(p))) throw Error('scope must contain portable relative paths');
  if (!Number.isInteger(spec.timeoutMs) || spec.timeoutMs < 100 || spec.timeoutMs > 300000) throw Error('timeoutMs out of bounds');
  if (spec.maxAgeMs !== undefined && (!Number.isInteger(spec.maxAgeMs) || spec.maxAgeMs < 1)) throw Error('invalid maxAgeMs');
}

function inside(root, target) {
  const rel = path.relative(root, target);
  return rel === '' || (rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel));
}

function snapshot(root, scope) {
  const realRoot = fs.realpathSync(root);
  const files = [];
  const seen = new Set();
  function walk(target) {
    if (!inside(root, target)) throw Error('scope escapes root');
    const expectedReal = path.resolve(realRoot, path.relative(root, target));
    if (fs.realpathSync(target) !== expectedReal) throw Error('scope contains symlink or escapes root');
    const stat = fs.lstatSync(target);
    if (stat.isSymbolicLink()) throw Error('scope contains symlink');
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(target).sort()) walk(path.join(target, name));
    } else if (stat.isFile()) {
      const rel = path.relative(root, target).split(path.sep).join('/');
      if (!seen.has(rel)) { files.push({ path: rel, sha256: digest(fs.readFileSync(target)) }); seen.add(rel); }
    } else throw Error('unsupported scope entry');
  }
  for (const part of scope) walk(path.resolve(root, part));
  files.sort((a, b) => a.path.localeCompare(b.path));
  return { files, sha256: digest(JSON.stringify(files)) };
}

function commandHash(spec) { return digest(JSON.stringify({ argv: spec.argv, cwd: spec.cwd, timeoutMs: spec.timeoutMs })); }

function capture(root, spec) {
  validateSpec(spec);
  root = path.resolve(root);
  const cwd = path.resolve(root, spec.cwd);
  if (!inside(root, cwd) || !inside(fs.realpathSync(root), fs.realpathSync(cwd)) || !fs.statSync(cwd).isDirectory()) throw Error('invalid working directory');
  const before = snapshot(root, spec.scope);
  const startedAt = new Date().toISOString();
  const start = process.hrtime.bigint();
  const result = spawnSync(spec.argv[0], spec.argv.slice(1), { cwd, shell: false, stdio: 'ignore', timeout: spec.timeoutMs, windowsHide: true });
  const durationMs = Number((process.hrtime.bigint() - start) / 1000000n);
  let after; let scopeError = null;
  try { after = snapshot(root, spec.scope); } catch (error) { scopeError = String(error.message || error); }
  const timedOut = result.error?.code === 'ETIMEDOUT';
  const blocked = result.error?.code === 'ENOENT';
  const status = blocked ? 'BLOCKED_CAPABILITY' : result.status === 0 && !result.signal && !result.error && !scopeError && before.sha256 === after.sha256 ? 'PASS' : 'FAIL';
  return {
    version: 1, commandId: spec.commandId, commandHash: commandHash(spec), scope: spec.scope,
    startedAt, durationMs, status, exitCode: result.status, signal: result.signal || null,
    timedOut: Boolean(timedOut), reason: scopeError ? 'scope unavailable after execution' : (blocked ? 'command unavailable' : timedOut ? 'command timeout' : result.error ? 'command execution error' : before.sha256 !== after?.sha256 ? 'scope changed during run' : result.status !== 0 ? 'nonzero exit' : null),
    // Arbitrary test output can contain secrets or personal data no pattern can
    // reliably recognize. Retain execution facts, never persist raw streams.
    snapshot: after || before, outputPolicy: 'suppressed', stdout: '', stderr: ''
  };
}

function check(root, spec, receipt, now = Date.now()) {
  try { validateSpec(spec); } catch (error) { return { status: 'FAIL', reason: String(error.message || error) }; }
  if (!receipt || receipt.version !== 1 || receipt.commandId !== spec.commandId || receipt.commandHash !== commandHash(spec)) return { status: 'FAIL', reason: 'receipt command mismatch' };
  if (JSON.stringify(receipt.scope) !== JSON.stringify(spec.scope)) return { status: 'FAIL', reason: 'receipt scope mismatch' };
  if (receipt.status !== 'PASS' || receipt.exitCode !== 0 || receipt.signal || receipt.timedOut || receipt.reason) return { status: 'FAIL', reason: 'command did not pass' };
  const time = Date.parse(receipt.startedAt);
  if (!Number.isFinite(time) || time > now + 60000 || (spec.maxAgeMs && now - time > spec.maxAgeMs)) return { status: 'FAIL', reason: 'receipt expired or invalid time' };
  try {
    const current = snapshot(path.resolve(root), spec.scope);
    if (current.sha256 !== receipt.snapshot?.sha256 || JSON.stringify(current.files) !== JSON.stringify(receipt.snapshot?.files)) return { status: 'FAIL', reason: 'stale scope snapshot' };
  } catch { return { status: 'FAIL', reason: 'scope unavailable' }; }
  return { status: 'PASS', reason: null, commandId: spec.commandId, snapshot: receipt.snapshot.sha256 };
}

function parseArgs(argv) {
  const [mode, ...rest] = argv;
  if (!['capture', 'check'].includes(mode)) throw Error('expected capture or check');
  const opts = {};
  for (let i = 0; i < rest.length; i += 2) {
    if (!['--root', '--spec', '--output', '--receipt'].includes(rest[i]) || !rest[i + 1]) throw Error('invalid arguments');
    opts[rest[i].slice(2)] = rest[i + 1];
  }
  if (!opts.spec || (mode === 'capture' && !opts.output) || (mode === 'check' && !opts.receipt)) throw Error('missing spec/receipt path');
  return { mode, opts };
}

if (require.main === module) {
  try {
    const { mode, opts } = parseArgs(process.argv.slice(2));
    const root = opts.root || process.cwd();
    const spec = JSON.parse(fs.readFileSync(opts.spec, 'utf8'));
    if (mode === 'capture') {
      const receipt = capture(root, spec);
      fs.mkdirSync(path.dirname(path.resolve(opts.output)), { recursive: true });
      fs.writeFileSync(opts.output, JSON.stringify(receipt, null, 2) + '\n');
      console.log(JSON.stringify({ status: receipt.status, commandId: receipt.commandId, snapshot: receipt.snapshot.sha256 }));
      process.exitCode = receipt.status === 'PASS' ? 0 : 1;
    } else {
      const verdict = check(root, spec, JSON.parse(fs.readFileSync(opts.receipt, 'utf8')));
      console.log(JSON.stringify(verdict)); process.exitCode = verdict.status === 'PASS' ? 0 : 1;
    }
  } catch (error) { console.log(JSON.stringify({ status: 'FAIL', reason: redact(error.message || error) })); process.exitCode = 1; }
}

module.exports = { validateSpec, snapshot, redact, capture, check, parseArgs };
