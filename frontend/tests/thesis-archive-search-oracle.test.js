/**
 * Golden-case oracle for the W19 archive server search.
 *
 * The archive search predicate lives inline in the round page. This test does
 * not re-implement it: it extracts the exact `filteredRepositoryReports`
 * useMemo block from `src/app/dashboard/thesis/page.tsx`, strips the TypeScript
 * annotations with the project's own compiler, and runs that real function over
 * `contracts/thesis-archive-search-cases.json`.
 *
 * The same fixture is consumed by the Java oracle and by the H2/PostgreSQL
 * contract suites, so a change to the web predicate that is not mirrored in the
 * server search fails here first.
 *
 * If this test cannot find the block it must fail loudly: that means the web
 * predicate moved or was rewritten, and the frozen expectations are stale.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const fixture = JSON.parse(
  fs.readFileSync(path.join(root, '..', 'contracts', 'thesis-archive-search-cases.json'), 'utf8'),
);
const pageSource = fs.readFileSync(path.join(root, 'src/app/dashboard/thesis/page.tsx'), 'utf8');

const PREFIX = 'const filteredRepositoryReports = useMemo(';
const SUFFIX = '}, [repositoryReports, repositorySearch]);';

/**
 * Strips the three TS annotations in the block without needing a full compiler
 * when one is not installed (plain `node --test` outside CI). The installed
 * `typescript` compiler is always preferred; Node's built-in stripper is the
 * fallback for a checkout without `node_modules`.
 */
function stripTypes(expression) {
  let typescript = null;
  try {
    typescript = require('typescript');
  } catch {
    typescript = null;
  }
  if (typescript) {
    return typescript.transpileModule(`const predicate = ${expression};`, {
      compilerOptions: { module: typescript.ModuleKind.CommonJS, target: typescript.ScriptTarget.ES2020 },
    }).outputText;
  }
  const { stripTypeScriptTypes } = require('node:module');
  assert.equal(typeof stripTypeScriptTypes, 'function',
    'neither the typescript compiler nor node:module.stripTypeScriptTypes is available');
  return stripTypeScriptTypes(`const predicate = ${expression};`, { mode: 'strip' });
}

function loadWebPredicate() {
  const start = pageSource.indexOf(PREFIX);
  assert.notEqual(start, -1, `page.tsx no longer declares ${PREFIX}`);
  const end = pageSource.indexOf(SUFFIX, start);
  assert.notEqual(end, -1, `page.tsx no longer closes the block with ${SUFFIX}`);
  // The useMemo argument is the arrow function; keep it and drop the deps array.
  const arrow = pageSource.slice(start + PREFIX.length, end + 1);
  const compiled = stripTypes(arrow);
  // `predicate` is a zero-argument closure over the component state; re-create
  // that scope by binding the two names the block closes over.
  const factory = new Function('repositorySearch', 'repositoryReports', `${compiled}\nreturn predicate();`);
  return { predicate: factory, arrow };
}

// The fixture stores DTO-shaped rows; the web predicate reads exactly these
// fields, plus supervisor/member child arrays.
const reports = fixture.reports.map((report) => ({
  ...report,
  supervisors: (report.supervisors || []).map((supervisor) => ({ displayName: supervisor.displayName })),
  members: (report.members || []).map((member) => ({
    displayName: member.displayName,
    studentNumber: member.studentNumber,
  })),
}));

const { predicate, arrow } = loadWebPredicate();

test('the extracted block is the accent-folding, token-splitting archive predicate', () => {
  assert.match(arrow, /normalize\('NFD'\)/);
  assert.match(arrow, /\\u0300-\\u036f/);
  assert.match(arrow, /replace\(\/đ\/g, 'd'\)/);
  assert.match(arrow, /split\(\/\\s\+\/\)/);
  assert.match(arrow, /topicTitle \|\| report\.title \|\| ''/);
  assert.match(arrow, /report\.supervisors\.map/);
  assert.match(arrow, /report\.members\.map/);
});

test('the fixture is a real freeze, not an empty placeholder', () => {
  assert.ok(fixture.cases.length >= 25, 'fixture must keep the fail-first case table');
  const matching = fixture.cases.filter((item) => item.expect.length > 0);
  assert.ok(matching.length >= 15, 'most cases must pin at least one report');
  assert.deepEqual(fixture.summary, {
    total: reports.length,
    files: reports.filter((report) => typeof report.fileName === 'string' && report.fileName !== '').length,
    urls: reports.filter((report) => typeof report.url === 'string' && report.url !== '').length,
  });
});

for (const item of fixture.cases) {
  test(`web predicate reproduces "${item.name}"`, () => {
    const ids = predicate(item.search, reports).map((report) => report.id);
    assert.deepEqual(ids, item.expect);
  });
}
