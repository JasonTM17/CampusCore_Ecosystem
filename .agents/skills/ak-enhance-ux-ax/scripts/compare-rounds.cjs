#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const { validate, validateContract, parseOptions, validSnapshot, equal } = require('./validate-evidence.cjs');
const { redact, snapshot } = require('../../ak-common/scripts/verification-receipt.cjs');
function compare(root, contract, baseline, history, round, options = {}) {
  const errors = validateContract(contract);
  const fail = s => errors.push(s);
  if (!baseline || baseline.version !== 1 || baseline.runId !== contract?.runId || baseline.round !== 0 || !baseline.id ||
      !validSnapshot(baseline.source) || !equal(baseline.source, contract.initialSnapshot) || !Array.isArray(baseline.checks)) fail('invalid controller initial baseline');
  if (!history || history.version !== 1 || history.runId !== contract?.runId || history.baselineId !== baseline?.id || !Array.isArray(history.entries)) fail('invalid accepted history');
  if (errors.length) return { status: 'FAIL', errors };
  let previous = baseline;
  const retained = new Map(); const ids = new Set([baseline.id]);
  function retain(entry) {
    if (!Array.isArray(entry.checks) || new Set(entry.checks.map(c => c?.id)).size !== entry.checks.length) { fail('invalid accepted check list'); return; }
    for (const [id] of retained) if (!entry.checks.some(x => x?.id === id && x.status === 'PASS')) fail(`accepted history dropped prior PASS: ${id}`);
    for (const c of entry.checks) {
      const gate = contract.gates.find(g => g.id === c?.id);
      if (!gate || !gate.applicable || !['PASS', 'FAIL', 'NOT_RUN', 'BLOCKED_CAPABILITY'].includes(c.status) || c.status === 'PASS' && !validSnapshot(c.snapshot)) { fail('invalid accepted gate'); continue; }
      if (c.status === 'PASS') retained.set(c.id, { check: c, from: entry.id });
    }
  }
  retain(baseline);
  for (const entry of history.entries) {
    if (!entry || entry.round !== previous.round + 1 || entry.parent !== previous.id || !entry.id || ids.has(entry.id) || !validSnapshot(entry.source) || entry.round > contract.maxRounds) { fail('history gap/replay/invalid source'); break; }
    ids.add(entry.id); retain(entry); previous = entry;
  }
  if (history.head !== previous.id) fail('accepted history head mismatch');
  if (!round || !round.id || ids.has(round.id) || round.parent !== previous.id || round.bundle?.round !== previous.round + 1 || round.bundle?.round > contract.maxRounds || contract.mode === 'audit') fail('round gap/replay/budget violation');
  if (errors.length) return { status: 'FAIL', errors };
  const verdict = validate(root, contract, round.bundle, { ...options, expectedBefore: previous.source, carried: retained });
  errors.push(...verdict.errors, ...verdict.missing);
  for (const [id, prior] of retained) {
    const current = round.bundle.checks.find(x => x.id === id);
    if (!current || current.status !== 'PASS') { fail(`round loses earlier PASS: ${id}`); continue; }
    const g = contract.gates.find(x => x.id === id);
    const actual = snapshot(require('node:path').resolve(root), g.scope);
    if (current.carriedFrom && (!equal(actual, prior.check.snapshot) || current.carriedFrom !== prior.from)) fail(`affected/stale carry: ${id}`);
  }
  return { status: errors.length ? 'FAIL' : 'PASS', errors,
    retained: [...retained.keys()], parent: previous.id,
    accepted: errors.length ? null : { id: round.id, parent: previous.id, round: round.bundle.round, source: round.bundle.current, checks: round.bundle.checks },
    limitation: verdict.limitation };
}
module.exports = { compare };
if (require.main === module) {
  try {
    const o = parseOptions(process.argv.slice(2), ['root', 'contract', 'baseline', 'history', 'round']);
    const read = p => JSON.parse(fs.readFileSync(p, 'utf8'));
    const v = compare(o.root, read(o.contract), read(o.baseline), read(o.history), read(o.round));
    process.stdout.write(JSON.stringify(v) + '\n'); process.exitCode = v.status === 'PASS' ? 0 : 1;
  } catch (e) { process.stdout.write(JSON.stringify({ status: 'FAIL', errors: [redact(e.message)] }) + '\n'); process.exitCode = 1; }
}
