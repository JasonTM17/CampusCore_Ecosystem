#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { cases } = require('./workflow-simulations.cjs');
const { validateTrace } = require('../../ak-common/scripts/workflow-contract.cjs');

const fixtureRoot = path.resolve(__dirname, '..');
const expectedCases = ['success', 'denied', 'recovery', 'contention'];

function recipeSource(workflow) {
  const slug = workflow.slug;
  if (typeof slug !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) ||
      workflow.source !== `references/workflows/${slug}.md`) throw Error('invalid recipe source');
  return workflow.source;
}

function makeTrace(workflow) {
  const base = workflow.id;
  const source = recipeSource(workflow);
  return {
    version: 1, owner: 'synthetic-fixture-owner',
    sources: [{ id: `${base}-SRC`, locator: `engineer/skills/ak-eval/${source}`, revision: 'fixture-v1', authority: 'synthetic-fixture-owner' }],
    rules: [{ id: workflow.ruleId, sourceIds: [`${base}-SRC`], statement: workflow.rule, status: 'confirmed', confirmedBy: 'synthetic-fixture-owner' }],
    actors: [{ id: `${base}-ACTOR`, role: workflow.owner }],
    useCases: [{ id: base, ruleIds: [workflow.ruleId], actorIds: [`${base}-ACTOR`], precondition: workflow.inputs, postcondition: 'case-specific expected state', failureRecovery: 'case-specific retry or resume', invariant: workflow.invariant }],
    changes: [{ id: `${base}-SIM`, useCaseIds: [base], owner: 'fixture-maintainer', paths: ['engineer/skills/ak-eval/scripts/workflow-simulations.cjs'] }],
    tests: expectedCases.map(kind => ({ id: workflow.caseIds[kind], ruleIds: [workflow.ruleId], useCaseIds: [base], changeIds: [`${base}-SIM`], commandId: `workflow:${workflow.slug}`, oracle: `${kind}: ${workflow.invariant}` })),
    evidence: []
  };
}

function validateFixture(workflows) {
  if (!Array.isArray(workflows) || workflows.length !== 12) throw Error('expected twelve workflow recipes');
  const ids = new Set(); const slugs = new Set(); const caseIds = new Set();
  for (const item of workflows) {
    if (ids.has(item.id) || slugs.has(item.slug)) throw Error('duplicate workflow ID or slug');
    ids.add(item.id); slugs.add(item.slug);
    if (!fs.existsSync(path.join(fixtureRoot, recipeSource(item)))) throw Error(`missing recipe ${item.slug}`);
    if (!cases[item.slug] || expectedCases.some(k => typeof cases[item.slug][k] !== 'function')) throw Error(`missing case handler ${item.slug}`);
    for (const kind of expectedCases) {
      if (caseIds.has(item.caseIds[kind])) throw Error('duplicate case ID');
      caseIds.add(item.caseIds[kind]);
    }
    const errors = validateTrace(makeTrace(item));
    if (errors.length) throw Error(`invalid trace for ${item.slug}: ${errors.join('; ')}`);
  }
  if (Object.keys(cases).length !== workflows.length) throw Error('unregistered case handlers');
}

function run(workflows, only) {
  validateFixture(workflows);
  const selected = only ? workflows.filter(w => w.slug === only || w.id === only) : workflows;
  if (!selected.length) throw Error('unknown workflow');
  const result = [];
  for (const w of selected) {
    const checks = [];
    for (const kind of expectedCases) {
      const started = performance.now();
      try {
        cases[w.slug][kind]();
        checks.push({ id: w.caseIds[kind], kind, status: 'PASS', durationMs: +(performance.now() - started).toFixed(3) });
      } catch (error) {
        checks.push({ id: w.caseIds[kind], kind, status: 'FAIL', durationMs: +(performance.now() - started).toFixed(3), reason: String(error.message || error).slice(0, 300) });
      }
    }
    result.push({ id: w.id, slug: w.slug, ruleId: w.ruleId, source: w.source, checks });
  }
  const flat = result.flatMap(r => r.checks);
  return { schemaVersion: 1, level: 'simulation', environment: { runtime: `node ${process.version}`, platform: process.platform }, status: flat.every(c => c.status === 'PASS') ? 'PASS' : 'FAIL', counts: { workflows: result.length, cases: flat.length, passed: flat.filter(c => c.status === 'PASS').length, failed: flat.filter(c => c.status === 'FAIL').length }, providerStatus: 'NOT_RUN', providerReason: 'No authenticated model or service was called', tokenUsage: null, workflows: result };
}

function parseArgs(argv) {
  const options = { json: false, only: null, output: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--json') options.json = true;
    else if (['--only', '--output'].includes(argv[i]) && argv[i + 1]) options[argv[i++].slice(2)] = argv[i];
    else throw Error(`unknown argument ${argv[i]}`);
  }
  return options;
}

if (require.main === module) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const fixtures = JSON.parse(fs.readFileSync(path.join(fixtureRoot, 'fixtures/workflows.json'), 'utf8'));
    if (fixtures.version !== 1) throw Error('unsupported fixture version');
    const result = run(fixtures.workflows, options.only);
    if (options.output) {
      const out = path.resolve(options.output);
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, JSON.stringify(result, null, 2) + '\n');
    }
    if (options.json) console.log(JSON.stringify(result));
    else console.log(`${result.status}: ${result.counts.passed}/${result.counts.cases} cases across ${result.counts.workflows} synthetic workflows; provider ${result.providerStatus}`);
    process.exitCode = result.status === 'PASS' ? 0 : 1;
  } catch (error) { console.error(`FAIL: ${String(error.message || error).slice(0, 300)}`); process.exitCode = 1; }
}

module.exports = { makeTrace, validateFixture, run, parseArgs };
