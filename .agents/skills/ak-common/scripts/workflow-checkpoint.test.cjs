'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { capture } = require('./verification-receipt.cjs');
const { validateCheckpoint } = require('./workflow-checkpoint.cjs');

function fixture(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentkit checkpoint '));
  try {
    fs.mkdirSync(path.join(root, 'src'));
    fs.mkdirSync(path.join(root, 'reports'));
    fs.writeFileSync(path.join(root, 'src/change.txt'), 'approved-v1');
    const spec = { version: 1, commandId: 'test:approval', argv: [process.execPath, '-e', 'process.stdout.write("verified")'], cwd: '.', scope: ['src/change.txt'], timeoutMs: 1000 };
    fs.writeFileSync(path.join(root, 'reports/spec.json'), JSON.stringify(spec));
    const receipt = capture(root, spec);
    fs.writeFileSync(path.join(root, 'reports/receipt.json'), JSON.stringify(receipt));
    const trace = {
      version: 1, owner: 'example-owner',
      sources: [{ id: 'S', locator: 'docs/rules.md', revision: 'v1', authority: 'example-owner' }],
      rules: [{ id: 'R', sourceIds: ['S'], statement: 'Approver only', status: 'confirmed', confirmedBy: 'example-owner' }],
      actors: [{ id: 'A', role: 'approver' }],
      useCases: [{ id: 'U', ruleIds: ['R'], actorIds: ['A'], precondition: 'submitted', postcondition: 'approved', failureRecovery: 'retry same key', invariant: 'one decision' }],
      changes: [{ id: 'C', useCaseIds: ['U'], owner: 'worker', paths: ['src/change.txt'] }],
      tests: [{ id: 'T', ruleIds: ['R'], useCaseIds: ['U'], changeIds: ['C'], commandId: 'test:approval', oracle: 'one approval' }],
      evidence: [{ id: 'E', testIds: ['T'], status: 'PASS', level: 'simulation', receipt: 'reports/receipt.json' }]
    };
    const links = [{ testId: 'T', spec: 'reports/spec.json', receipt: 'reports/receipt.json' }];
    return fn(root, trace, links, spec, receipt);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

test('declared checkpoint accepts current real receipt', () => fixture((root, trace, links) => {
  assert.deepEqual(validateCheckpoint(root, trace, links), { status: 'PASS', errors: [], testsChecked: 1 });
}));
test('changed scope is stale; unrelated file is excluded', () => fixture((root, trace, links) => {
  fs.writeFileSync(path.join(root, 'unrelated.txt'), 'noise');
  assert.equal(validateCheckpoint(root, trace, links).status, 'PASS');
  fs.writeFileSync(path.join(root, 'src/change.txt'), 'changed');
  assert.match(validateCheckpoint(root, trace, links).errors.join('\n'), /stale scope/);
}));
test('unconfirmed rule, missing link, command drift and uncovered change fail', () => fixture((root, trace, links, spec) => {
  trace.rules[0].status = 'proposed'; delete trace.rules[0].confirmedBy;
  assert.match(validateCheckpoint(root, trace, links).errors.join('\n'), /unresolved business authority/);
  trace.rules[0].status = 'confirmed'; trace.rules[0].confirmedBy = 'example-owner';
  assert.match(validateCheckpoint(root, trace, []).errors.join('\n'), /missing receipt link/);
  trace.tests[0].commandId = 'test:other';
  assert.match(validateCheckpoint(root, trace, links).errors.join('\n'), /command ID mismatch/);
  trace.tests[0].commandId = 'test:approval';
  fs.writeFileSync(path.join(root, 'reports/spec.json'), JSON.stringify({ ...spec, scope: ['reports/spec.json'] }));
  assert.match(validateCheckpoint(root, trace, links).errors.join('\n'), /outside verified scope/);
}));
test('receipt cannot be promoted from a failed command', () => fixture((root, trace, links, spec) => {
  const failed = capture(root, { ...spec, argv: [process.execPath, '-e', 'process.exit(9)'] });
  fs.writeFileSync(path.join(root, 'reports/receipt.json'), JSON.stringify({ ...failed, status: 'PASS' }));
  assert.match(validateCheckpoint(root, trace, links).errors.join('\n'), /receipt command mismatch|command did not pass/);
}));

test('a claimed change without its own test connection cannot pass checkpoint', () => fixture((root, trace, links) => {
  trace.changes.push({ ...trace.changes[0], id: 'C2', paths: ['src/untested.txt'] });
  assert.match(validateCheckpoint(root, trace, links).errors.join('\n'), /C2: no test/);
}));
