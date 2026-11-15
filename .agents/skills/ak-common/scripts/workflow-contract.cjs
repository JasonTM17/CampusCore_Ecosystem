'use strict';

// Portable, dependency-free validation; no runtime or provider claims.
const fs = require('node:fs');
const path = require('node:path');

function validateTrace(trace, { checkpoint = false } = {}) {
  const errors = [];
  const fail = message => errors.push(message);
  const nonempty = value => typeof value === 'string' && value.trim().length > 0;
  const groups = ['sources', 'rules', 'actors', 'useCases', 'changes', 'tests', 'evidence'];
  if (!trace || trace.version !== 1) return ['trace.version must be 1'];
  if (!nonempty(trace.owner)) fail('trace.owner is required');
  const maps = {};
  const ids = new Set();
  for (const group of groups) {
    if (!Array.isArray(trace[group])) { fail(`${group} must be an array`); maps[group] = new Map(); continue; }
    maps[group] = new Map();
    for (const item of trace[group]) {
      if (!item || !nonempty(item.id) || ids.has(item.id)) { fail(`${group}: missing or duplicate id`); continue; }
      ids.add(item.id); maps[group].set(item.id, item);
    }
  }
  for (const group of groups.slice(0, -1)) if (!maps[group].size) fail(`${group} must not be empty`);
  function link(item, field, group) {
    const values = item[field];
    if (!Array.isArray(values) || !values.length) { fail(`${item.id}.${field} is required`); return []; }
    for (const id of values) if (!maps[group].has(id)) fail(`${item.id}.${field}: unknown ${id}`);
    return values;
  }
  for (const source of maps.sources.values()) {
    for (const field of ['locator', 'revision', 'authority']) if (!nonempty(source[field])) fail(`${source.id}.${field} is required`);
  }
  for (const actor of maps.actors.values()) if (!nonempty(actor.role)) fail(`${actor.id}.role is required`);
  for (const rule of maps.rules.values()) {
    link(rule, 'sourceIds', 'sources');
    if (!nonempty(rule.statement)) fail(`${rule.id}.statement is required`);
    if (!['confirmed', 'proposed', 'disputed'].includes(rule.status)) fail(`${rule.id}.status is invalid`);
    if (rule.status === 'confirmed' && !nonempty(rule.confirmedBy)) fail(`${rule.id}.confirmedBy is required`);
    if (checkpoint && rule.status !== 'confirmed') fail(`${rule.id}: unresolved business authority`);
  }
  for (const useCase of maps.useCases.values()) {
    link(useCase, 'ruleIds', 'rules'); link(useCase, 'actorIds', 'actors');
    for (const field of ['precondition', 'postcondition', 'failureRecovery', 'invariant']) {
      if (!nonempty(useCase[field])) fail(`${useCase.id}.${field} is required`);
    }
  }
  for (const change of maps.changes.values()) {
    link(change, 'useCaseIds', 'useCases');
    if (!nonempty(change.owner)) fail(`${change.id}.owner is required`);
    if (!Array.isArray(change.paths) || !change.paths.length || change.paths.some(p => !safeRelative(p))) fail(`${change.id}.paths must be portable owned paths`);
  }
  for (const test of maps.tests.values()) {
    link(test, 'ruleIds', 'rules'); link(test, 'useCaseIds', 'useCases'); link(test, 'changeIds', 'changes');
    if (!nonempty(test.oracle) || !nonempty(test.commandId)) fail(`${test.id}: oracle and commandId required`);
  }
  for (const change of maps.changes.values()) {
    if (![...maps.tests.values()].some(t => t.changeIds?.includes(change.id))) fail(`${change.id}: no test`);
  }
  for (const rule of maps.rules.values()) {
    if (![...maps.tests.values()].some(t => t.ruleIds?.includes(rule.id))) fail(`${rule.id}: no test`);
  }
  for (const useCase of maps.useCases.values()) {
    if (![...maps.changes.values()].some(c => c.useCaseIds?.includes(useCase.id))) fail(`${useCase.id}: no change`);
    if (![...maps.tests.values()].some(t => t.useCaseIds?.includes(useCase.id))) fail(`${useCase.id}: no test`);
  }
  for (const item of maps.evidence.values()) {
    link(item, 'testIds', 'tests');
    if (!['PASS', 'FAIL', 'NOT_RUN', 'BLOCKED_CAPABILITY'].includes(item.status)) fail(`${item.id}: invalid evidence status`);
    if (!['static', 'simulation', 'runtime', 'provider'].includes(item.level)) fail(`${item.id}: invalid evidence level`);
    if (item.status === 'PASS' && !safeRelative(item.receipt)) fail(`${item.id}: PASS needs a portable receipt path`);
    if (item.status !== 'PASS' && !nonempty(item.reason)) fail(`${item.id}: missing limitation`);
  }
  if (checkpoint) {
    for (const test of maps.tests.values()) {
      if (![...maps.evidence.values()].some(e => e.testIds?.includes(test.id) && e.status === 'PASS')) fail(`${test.id}: missing passing evidence`);
    }
  }
  return errors;
}

function safeRelative(value) {
  // Colons can select NTFS streams, including aliases of protected plan files.
  return typeof value === 'string' && value.length > 0 && !path.isAbsolute(value) &&
    !/^[a-z]:/i.test(value) && !value.includes(':') && !value.includes('\\') && !value.split('/').some(p => p === '..' || p === '.' || p === '') && !value.includes('\0');
}

function validateHandoff(handoff, assignment) {
  if (!handoff || typeof handoff !== 'object') return ['handoff is required'];
  const errors = [];
  if (!assignment || !Array.isArray(assignment.allowedWrites)) return ['controller assignment is required'];
  for (const key of ['plan', 'step', 'owner']) {
    if (typeof assignment[key] !== 'string' || !assignment[key].trim() || handoff[key] !== assignment[key]) errors.push(`${key} differs from controller assignment`);
  }
  const assigned = assignment.allowedWrites.filter(safeRelative);
  if (assigned.length !== assignment.allowedWrites.length) errors.push('invalid controller ownership path');
  for (const key of ['plan', 'step', 'owner', 'snapshot', 'next']) if (typeof handoff[key] !== 'string' || !handoff[key].trim()) errors.push(`${key} is required`);
  for (const key of ['allowedWrites', 'changedPaths', 'evidence', 'blockers']) if (!Array.isArray(handoff[key])) errors.push(`${key} must be an array`);
  if (!['PASS', 'FAIL', 'NOT_RUN', 'BLOCKED_CAPABILITY'].includes(handoff.status)) errors.push('invalid status');
  if (handoff.planStateOwner !== 'controller') errors.push('controller must own plan state');
  const planPath = safeRelative(handoff.plan) ? handoff.plan : null;
  if (!planPath) errors.push('plan must be a portable path');
  const planDirectory = planPath ? path.posix.dirname(planPath) : null;
  for (const p of handoff.allowedWrites || []) {
    if (!safeRelative(p)) errors.push('invalid ownership path');
    else if (!assigned.some(a => p === a || p.startsWith(`${a}/`))) errors.push('worker expanded controller write scope');
  }
  for (const p of handoff.changedPaths || []) {
    const normalized = typeof p === 'string' ? p.toLowerCase() : '';
    const basename = path.posix.basename(normalized);
    if (normalized === planPath?.toLowerCase() ||
        (planDirectory && normalized.startsWith(planDirectory.toLowerCase() + '/') &&
          (basename === 'plan.md' || /^phase-\d+-.*\.md$/.test(basename) || basename === 'execution-ledger.md'))) {
      errors.push(`worker cannot write controller plan state: ${p}`);
    }
    if (!safeRelative(p) || !assigned.some(a => p === a || p.startsWith(`${a}/`)) || !(handoff.allowedWrites || []).some(a => safeRelative(a) && (p === a || p.startsWith(`${a}/`)))) errors.push(`write outside ownership: ${p}`);
  }
  if (handoff.status === 'PASS' && !handoff.evidence?.length) errors.push('PASS requires evidence');
  if (handoff.status === 'PASS' && handoff.blockers?.length) errors.push('PASS cannot have blockers');
  return errors;
}

module.exports = { validateTrace, validateHandoff, safeRelative };
if (require.main === module) {
  try {
    const data = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
    const assignmentIndex = process.argv.indexOf('--assignment');
    const assignment = assignmentIndex >= 0 ? JSON.parse(fs.readFileSync(process.argv[assignmentIndex + 1], 'utf8')) : null;
    const errors = process.argv.includes('--handoff') ? validateHandoff(data, assignment) : validateTrace(data, { checkpoint: process.argv.includes('--checkpoint') });
    console.log(JSON.stringify({ status: errors.length ? 'FAIL' : 'PASS', errors }));
    process.exitCode = errors.length ? 1 : 0;
  } catch { console.log(JSON.stringify({ status: 'FAIL', errors: ['unreadable or malformed artifact'] })); process.exitCode = 1; }
}
