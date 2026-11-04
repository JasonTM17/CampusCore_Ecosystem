const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

/** Extract one declaration from a page and run it with injected dependencies. */
function executeDeclaration(file, name, dependencies) {
  const source = fs.readFileSync(path.join(root, 'src', file), 'utf8');
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let declaration;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(tree) === name) declaration = node;
    ts.forEachChild(node, visit);
  }
  visit(tree);
  assert.ok(declaration, `${file} contains ${name}`);
  const text = `const ${declaration.getText(tree)};`;
  const output = ts.transpileModule(text, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  }).outputText;
  return Function(...Object.keys(dependencies), `${output}; return ${name};`)(
    ...Object.values(dependencies),
  );
}

test('registration separates cohort ineligibility from a closed round', () => {
  const source = read('src/app/dashboard/register/page.tsx');
  const copy = read('src/i18n/messages.ts');

  const blockedForCohort = executeDeclaration(
    'app/dashboard/register/page.tsx',
    'eligibilityBlocked',
    { eligibilityErrorCode: 'COHORT_INELIGIBLE', eligibilityQuery: { data: undefined } },
  );
  const blockedForFlag = executeDeclaration(
    'app/dashboard/register/page.tsx',
    'eligibilityBlocked',
    { eligibilityErrorCode: undefined, eligibilityQuery: { data: { eligible: false } } },
  );
  const openForEveryoneElse = executeDeclaration(
    'app/dashboard/register/page.tsx',
    'eligibilityBlocked',
    { eligibilityErrorCode: 'WINDOW_CLOSED', eligibilityQuery: { data: { eligible: true } } },
  );

  assert.equal(blockedForCohort, true, 'a cohort rejection is an eligibility answer');
  assert.equal(blockedForFlag, true, 'an explicit ineligible answer is an eligibility answer');
  assert.equal(openForEveryoneElse, false, 'a closed window is not a cohort rejection');

  assert.match(
    source,
    /\) : eligibilityBlocked \? \(\s*<EmptyState[\s\S]{0,260}?copy\.errorCodes\.cohortIneligible/,
    'an ineligible student sees the eligibility reason, not "no round is open"',
  );
  assert.match(source, /copy\.roundUnavailable/, 'a genuinely closed round keeps its own copy');
  assert.equal(
    (copy.match(/cohortIneligibleDescription:/g) || []).length,
    2,
    'the eligibility explanation exists in both locale catalogues',
  );
});
