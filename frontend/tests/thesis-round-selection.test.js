const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');

// Load the pure helper through the TypeScript compiler so the assertions run
// against the real module, not a copied reimplementation.
const source = fs.readFileSync(path.join(root, 'src/lib/thesis-round.ts'), 'utf8');
const js = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;
const mod = { exports: {} };
new Function('module', 'exports', 'require', js)(mod, mod.exports, require);
const { pickPreferredThesisRound, sortThesisRoundsForOverview, thesisRoundsForStudent, pickDefaultThesisRound } = mod.exports;

const round = (id, status = 'REGISTRATION_CLOSED', start = '2026-09-01', thesisType = 'KLTN') => ({
  id,
  status,
  registrationStart: start,
  thesisType,
});
const group = (roundId, status = 'SUBMITTED') => ({ roundId, status });

test('a round holding the student group beats the newest open round', () => {
  const rounds = [
    round('round-new-open', 'PROPOSAL_OPEN', '2027-01-10'),
    round('round-with-group', 'REGISTRATION_CLOSED', '2026-09-15'),
  ];
  // Newest-first group listing: the only membership lives in the closed round.
  const mine = [group('round-with-group')];
  assert.equal(pickPreferredThesisRound(rounds, mine), 'round-with-group');
});

test('no membership anywhere leaves the default selection untouched', () => {
  const rounds = [round('round-new-open', 'PROPOSAL_OPEN', '2027-01-10')];
  assert.equal(pickPreferredThesisRound(rounds, []), undefined);
  assert.equal(pickPreferredThesisRound(rounds, null), undefined);
});

test('a cancelled membership yields to an active one', () => {
  const rounds = [round('a'), round('b')];
  const mine = [group('b', 'CANCELLED'), group('a', 'APPROVED')];
  assert.equal(pickPreferredThesisRound(rounds, mine), 'a');
});

test('groups in unknown rounds are ignored', () => {
  const rounds = [round('a')];
  assert.equal(pickPreferredThesisRound(rounds, [group('ghost')]), undefined);
});

test('thesis page wires the membership-aware round selection', () => {
  const page = fs.readFileSync(
    path.join(root, 'src/app/dashboard/thesis/page.tsx'),
    'utf8',
  );
  assert.match(page, /pickPreferredThesisRound/);
  assert.match(page, /thesisApi\s*\.myGroups\(\)/);
  const api = fs.readFileSync(path.join(root, 'src/lib/thesis-api.ts'), 'utf8');
  assert.match(api, /\/thesis\/groups\/mine/);
});

test('sortThesisRoundsForOverview prioritizes active registration/execution KLTN cohorts ahead of future proposal-only rounds', () => {
  const rounds = [
    round('b3d980d4', 'PROPOSAL_OPEN', '2027-01-10', 'KLTN'),
    round('22d65ee6', 'REGISTRATION_CLOSED', '2026-09-10', 'TLCN'),
    round('c8f1a234', 'REGISTRATION_CLOSED', '2026-09-15', 'KLTN'),
    round('be1aa853', 'RESULTS_PUBLISHED', '2025-09-01', 'KLTN'),
  ];
  const sorted = sortThesisRoundsForOverview(rounds);
  assert.deepEqual(
    sorted.map((r) => r.id),
    ['c8f1a234', '22d65ee6', 'b3d980d4', 'be1aa853'],
  );
  const deanPage = fs.readFileSync(
    path.join(root, 'src/app/dashboard/dean/page.tsx'),
    'utf8',
  );
  assert.match(deanPage, /sortThesisRoundsForOverview/);
});

test('a draft round never becomes the student default or stays in the student round list', () => {
  const rounds = [
    round('draft-2027', 'DRAFT', '2027-01-05', 'KLTN'),
    round('active-2026', 'PROPOSALS_PUBLISHED', '2026-09-01', 'TLCN'),
  ];
  assert.equal(pickDefaultThesisRound(rounds)?.id, 'active-2026');
  assert.equal(pickDefaultThesisRound([round('draft-only', 'DRAFT', '2027-01-05', 'KLTN')]), undefined);
  assert.deepEqual(thesisRoundsForStudent(rounds, true).map((r) => r.id), ['active-2026']);
  assert.deepEqual(
    thesisRoundsForStudent(rounds, false).map((r) => r.id),
    ['draft-2027', 'active-2026'],
  );

  const page = fs.readFileSync(path.join(root, 'src/app/dashboard/thesis/page.tsx'), 'utf8');
  const workspace = fs.readFileSync(
    path.join(root, 'src/components/dashboard/thesis/useThesisWorkspace.ts'),
    'utf8',
  );
  for (const [name, source] of [['thesis page', page], ['workspace hook', workspace]]) {
    assert.match(source, /thesisRoundsForStudent\(/, `${name} filters draft rounds through the shared helper`);
    assert.match(source, /pickDefaultThesisRound\(/, `${name} picks the default through the shared helper`);
  }
});
