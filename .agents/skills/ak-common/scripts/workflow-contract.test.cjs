'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateTrace, validateHandoff, safeRelative } = require('./workflow-contract.cjs');

function fixture() {
  return {
    version: 1, owner: 'example-product-owner',
    sources: [{ id: 'S-1', locator: 'docs/example.md', revision: 'fixture-v1', authority: 'example-product-owner' }],
    rules: [{ id: 'R-1', sourceIds: ['S-1'], statement: 'Only the named actor may approve.', status: 'confirmed', confirmedBy: 'example-product-owner' }],
    actors: [{ id: 'A-1', role: 'approver' }],
    useCases: [{ id: 'U-1', ruleIds: ['R-1'], actorIds: ['A-1'], precondition: 'submitted', postcondition: 'approved', failureRecovery: 'leave submitted on denial', invariant: 'one decision per request' }],
    changes: [{ id: 'C-1', useCaseIds: ['U-1'], owner: 'implementation-worker', paths: ['src/approval.js'] }],
    tests: [{ id: 'T-1', ruleIds: ['R-1'], useCaseIds: ['U-1'], changeIds: ['C-1'], commandId: 'test:approval', oracle: 'authorized actor approves once' }],
    evidence: [{ id: 'E-1', testIds: ['T-1'], status: 'PASS', level: 'simulation', receipt: 'reports/approval.json' }]
  };
}

test('versioned trace and scoped handoff pass', () => {
  assert.deepEqual(validateTrace(fixture(), { checkpoint: true }), []);
  assert.deepEqual(validateHandoff({ plan: 'plans/example/plan.md', step: 'phase-01', owner: 'worker', snapshot: 'abc', allowedWrites: ['src'], changedPaths: ['src/approval.js'], evidence: ['reports/approval.json'], blockers: [], status: 'PASS', planStateOwner: 'controller', next: 'integration' }, { plan: 'plans/example/plan.md', step: 'phase-01', owner: 'worker', allowedWrites: ['src'] }), []);
});
for (const [label, mutate, expected] of [
  ['missing source', t => t.rules[0].sourceIds = [], 'sourceIds'],
  ['unknown rule', t => t.useCases[0].ruleIds = ['R-404'], 'unknown'],
  ['missing owner', t => t.changes[0].owner = '', 'owner'],
  ['missing test', t => t.tests = [], 'tests'],
  ['duplicate id', t => t.actors[0].id = 'S-1', 'duplicate'],
  ['absolute owned path', t => t.changes[0].paths = ['C:/secret'], 'paths'],
  ['missing receipt', t => t.evidence[0].receipt = '', 'receipt'],
  ['untested change', t => t.changes.push({ ...t.changes[0], id: 'C-2', paths: ['src/untested.js'] }), 'C-2: no test'],
]) test(`trace rejects ${label}`, () => { const t = fixture(); mutate(t); assert.match(validateTrace(t, { checkpoint: true }).join('\n'), new RegExp(expected)); });

test('proposed rule remains visible but cannot pass checkpoint', () => {
  const t = fixture(); t.rules[0].status = 'proposed'; delete t.rules[0].confirmedBy;
  assert.deepEqual(validateTrace(t), []);
  assert.match(validateTrace(t, { checkpoint: true }).join('\n'), /unresolved business authority/);
});
test('test without passing evidence cannot finish', () => {
  const t = fixture(); t.evidence[0].status = 'NOT_RUN'; t.evidence[0].reason = 'provider unavailable'; delete t.evidence[0].receipt;
  assert.deepEqual(validateTrace(t), []);
  assert.match(validateTrace(t, { checkpoint: true }).join('\n'), /missing passing evidence/);
});
test('worker cannot write outside assignment or own plan state', () => {
  const h = { plan: 'plans/x/plan.md', step: 'p2', owner: 'worker', snapshot: 'abc', allowedWrites: ['src/api'], changedPaths: ['src/data/ledger.js'], evidence: ['e'], blockers: [], status: 'PASS', planStateOwner: 'worker', next: 'review' };
  const assignment = { plan: h.plan, step: h.step, owner: h.owner, allowedWrites: ['src/api'] };
  assert.match(validateHandoff(h, assignment).join('\n'), /write outside ownership/);
  assert.match(validateHandoff(h, assignment).join('\n'), /controller must own plan state/);
});
test('PASS cannot hide an empty evidence handoff', () => {
  const h = { plan: 'p', step: 's', owner: 'o', snapshot: 'abc', allowedWrites: [], changedPaths: [], evidence: [], blockers: [], status: 'PASS', planStateOwner: 'controller', next: 'review' };
  assert.match(validateHandoff(h, { plan: h.plan, step: h.step, owner: h.owner, allowedWrites: [] }).join('\n'), /PASS requires evidence/);
});

test('self-declared write scope never authorizes worker plan-state writes', () => {
  const handoff = { plan: 'plans/p/plan.md', step: 'p4', owner: 'worker', snapshot: 'abc', allowedWrites: ['plans/p'], changedPaths: [], evidence: ['reports/receipt.json'], blockers: [], status: 'PASS', planStateOwner: 'controller', next: 'review' };
  const assignment = { plan: handoff.plan, step: handoff.step, owner: handoff.owner, allowedWrites: ['plans/p'] };
  for (const changed of ['plans/p/plan.md', 'plans/p/phase-04-test.md', 'plans/p/reports/execution-ledger.md', 'plans/p/PHASE-04-TEST.md']) {
    assert.match(validateHandoff({ ...handoff, changedPaths: [changed] }, assignment).join('\n'), /worker cannot write controller plan state/);
  }
  assert.deepEqual(validateHandoff({ ...handoff, changedPaths: ['plans/p/reports/test-result.json'] }, assignment), []);
  assert.match(validateHandoff(handoff).join('\n'), /controller assignment is required/);
  assert.match(validateHandoff(handoff, { ...assignment, allowedWrites: ['src'] }).join('\n'), /expanded controller write scope/);
});

test('portable paths reject colons and NTFS stream syntax in every segment', () => {
  for (const value of ['src/component:metadata', 'src:metadata/component.js', 'plans/p/plan.md::$DATA', 'src/file:stream:$DATA']) {
    assert.equal(safeRelative(value), false, value);
  }
  for (const value of ['src/component.js', 'plans/p/reports/test-result.json', 'src/Unicode-λ/file.js']) {
    assert.equal(safeRelative(value), true, value);
  }
});

test('NTFS aliases cannot authorize plan-state writes under a broad assignment', () => {
  const handoff = { plan: 'plans/p/plan.md', step: 'p4', owner: 'worker', snapshot: 'abc', allowedWrites: ['plans/p'], changedPaths: [], evidence: ['reports/receipt.json'], blockers: [], status: 'PASS', planStateOwner: 'controller', next: 'review' };
  const assignment = { plan: handoff.plan, step: handoff.step, owner: handoff.owner, allowedWrites: ['plans/p'] };
  for (const file of ['plan.md', 'phase-04-test.md', 'reports/execution-ledger.md', 'PHASE-04-TEST.md']) {
    for (const stream of ['::$DATA', ':metadata', ':metadata:$DATA']) {
      const changed = `plans/p/${file}${stream}`;
      assert.match(validateHandoff({ ...handoff, changedPaths: [changed] }, assignment).join('\n'), /write outside ownership/, changed);
    }
  }
  assert.match(validateHandoff({ ...handoff, allowedWrites: ['plans/p:metadata'] }, assignment).join('\n'), /invalid ownership path/);
  assert.match(validateHandoff(handoff, { ...assignment, allowedWrites: ['plans/p:metadata'] }).join('\n'), /invalid controller ownership path/);
  const aliasPlan = 'plans/p/plan.md::$DATA';
  assert.match(validateHandoff({ ...handoff, plan: aliasPlan }, { ...assignment, plan: aliasPlan }).join('\n'), /plan must be a portable path/);
});

test('trace change paths and passing receipts reject NTFS stream syntax', () => {
  const trace = fixture();
  trace.changes[0].paths = ['src/approval.js:metadata'];
  assert.match(validateTrace(trace).join('\n'), /paths must be portable owned paths/);
  trace.changes[0].paths = ['src/approval.js'];
  trace.evidence[0].receipt = 'reports/approval.json::$DATA';
  assert.match(validateTrace(trace).join('\n'), /PASS needs a portable receipt path/);
});
