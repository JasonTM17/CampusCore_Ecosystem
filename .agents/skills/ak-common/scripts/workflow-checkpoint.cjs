#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { validateTrace, safeRelative } = require('./workflow-contract.cjs');
const { check } = require('./verification-receipt.cjs');

function covers(scope, changed) { return scope.some(p => changed === p || changed.startsWith(`${p}/`)); }
function validateCheckpoint(root, trace, links) {
  const errors = validateTrace(trace, { checkpoint: true });
  if (!Array.isArray(links)) return { status: 'FAIL', errors: [...errors, 'links must be an array'], testsChecked: 0 };
  const byId = new Map();
  for (const link of links) {
    if (!link || typeof link.testId !== 'string' || byId.has(link.testId)) { errors.push('duplicate or missing link.testId'); continue; }
    byId.set(link.testId, link);
  }
  let testsChecked = 0;
  for (const test of trace.tests || []) {
    const link = byId.get(test.id);
    if (!link) { errors.push(`${test.id}: missing receipt link`); continue; }
    if (!safeRelative(link.spec) || !safeRelative(link.receipt)) { errors.push(`${test.id}: invalid link path`); continue; }
    const evidence = (trace.evidence || []).find(e => e.testIds?.includes(test.id) && e.status === 'PASS' && e.receipt === link.receipt);
    if (!evidence) { errors.push(`${test.id}: receipt not referenced by passing evidence`); continue; }
    try {
      const spec = JSON.parse(fs.readFileSync(path.join(root, link.spec), 'utf8'));
      const receipt = JSON.parse(fs.readFileSync(path.join(root, link.receipt), 'utf8'));
      if (spec.commandId !== test.commandId) { errors.push(`${test.id}: command ID mismatch`); continue; }
      const changes = (trace.changes || []).filter(c => test.changeIds?.includes(c.id)).flatMap(c => c.paths || []);
      if (!changes.length || changes.some(p => !covers(spec.scope || [], p))) { errors.push(`${test.id}: changed path outside verified scope`); continue; }
      const verdict = check(root, spec, receipt);
      testsChecked++;
      if (verdict.status !== 'PASS') errors.push(`${test.id}: ${verdict.reason}`);
    } catch (error) { errors.push(`${test.id}: unreadable spec or receipt`); }
  }
  for (const id of byId.keys()) if (!(trace.tests || []).some(t => t.id === id)) errors.push(`${id}: unknown test link`);
  return { status: errors.length ? 'FAIL' : 'PASS', errors, testsChecked };
}

if (require.main === module) {
  try {
    const args = process.argv.slice(2);
    const options = {};
    for (let i = 0; i < args.length; i += 2) {
      if (!['--root', '--trace', '--links'].includes(args[i]) || !args[i + 1]) throw Error('usage: --root dir --trace file --links file');
      options[args[i].slice(2)] = args[i + 1];
    }
    if (!options.root || !options.trace || !options.links) throw Error('missing checkpoint inputs');
    const root = path.resolve(options.root);
    const trace = JSON.parse(fs.readFileSync(path.resolve(root, options.trace), 'utf8'));
    const links = JSON.parse(fs.readFileSync(path.resolve(root, options.links), 'utf8'));
    const verdict = validateCheckpoint(root, trace, links);
    console.log(JSON.stringify(verdict)); process.exitCode = verdict.status === 'PASS' ? 0 : 1;
  } catch { console.log(JSON.stringify({ status: 'FAIL', errors: ['invalid checkpoint input'], testsChecked: 0 })); process.exitCode = 1; }
}
module.exports = { validateCheckpoint };
