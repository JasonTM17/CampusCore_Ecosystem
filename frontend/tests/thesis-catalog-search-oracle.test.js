const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

/**
 * Equivalence oracle for the topic-catalogue search.
 *
 * The Java side must reproduce the browser predicate exactly, so this test runs
 * the *real* function over the shared golden fixture: the `matchingTopics`
 * memo and its `searchActive` / `normalizedQuery` inputs are extracted from the
 * live component with the TypeScript AST, and the real
 * `plainTextThesisDescription` and `normalizeVietnameseText` helpers are
 * loaded. Nothing is re-implemented here; if the screen changes, this test
 * fails until the fixture (and therefore Java) follows.
 */

const root = path.resolve(__dirname, '..');
const componentPath = 'src/components/dashboard/thesis/ThesisTopicCatalogPage.tsx';
const fixture = JSON.parse(
  fs.readFileSync(path.resolve(root, '../contracts/thesis-topic-catalog-search-cases.json'), 'utf8'),
);

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function loadTsModule(relativePath) {
  const output = ts.transpileModule(read(relativePath), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const moduleRecord = { exports: {} };
  Function('module', 'exports', 'require', output)(moduleRecord, moduleRecord.exports, require);
  return moduleRecord.exports;
}

const source = read(componentPath);
const tree = ts.createSourceFile(componentPath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

function findVariable(name, scope) {
  let found;
  (function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(tree) === name) found = node;
    ts.forEachChild(node, visit);
  })(scope || tree);
  return found;
}

/** Compile one extracted expression/arrow; `params` become its closure names. */
function compileExpression(expression, params, invoke) {
  const output = ts.transpileModule(`const __value = (${expression});`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return Function(...params, `${output} return __value${invoke ? '()' : ''};`);
}

const memo = findVariable('matchingTopics');
assert.ok(memo, `${componentPath} declares matchingTopics`);
const memoCall = memo.initializer;
assert.equal(memoCall.expression.getText(tree), 'useMemo', 'matchingTopics is built with useMemo');
const matchArrow = memoCall.arguments[0];
assert.ok(ts.isArrowFunction(matchArrow), 'matchingTopics is an arrow function');

const dictionaryNode = findVariable('topicBilingualKeywords', matchArrow);
assert.ok(dictionaryNode, 'the synonym dictionary lives inside the matching function');
const componentDictionary = compileExpression(dictionaryNode.initializer.getText(tree), [])();

const searchActive = compileExpression(
  findVariable('searchActive').initializer.getText(tree),
  ['showAll', 'submittedQuery'],
);
const normalizeQuery = compileExpression(
  findVariable('normalizedQuery').initializer.getText(tree),
  ['submittedQuery'],
);
const matchTopics = compileExpression(matchArrow.getText(tree), [
  'searchActive',
  'showAll',
  'normalizedQuery',
  'workspace',
  'plainTextDescription',
  'normalizeVietnameseText',
], true);

const { plainTextThesisDescription } = loadTsModule('src/lib/thesis-text.ts');
const { normalizeVietnameseText } = loadTsModule('src/lib/registration-browse.ts');

function matchedIds(topics, search, showAll) {
  const submitted = search;
  return matchTopics(
    searchActive(showAll, submitted),
    showAll,
    normalizeQuery(submitted),
    { topics },
    plainTextThesisDescription,
    normalizeVietnameseText,
  ).map(topic => topic.id);
}

test('the shared fixture carries the live component dictionary verbatim', () => {
  assert.deepEqual(componentDictionary, fixture.dictionary);
  assert.deepEqual(Object.keys(componentDictionary), [
    'artificial intelligence',
    'software & web',
    'robotics & mechatronics',
    'information systems',
    'iot & telecom',
    'automotive',
    'civil engineering',
  ]);
});

test('the real web predicate reproduces every golden case', () => {
  for (const item of fixture.cases) {
    assert.deepEqual(
      matchedIds(fixture.topics, item.search, item.showAll),
      item.expectedIds,
      item.name,
    );
  }
});

test('the real web predicate reproduces the empty-catalogue cases', () => {
  for (const item of fixture.emptyCatalogue.cases) {
    assert.deepEqual(matchedIds([], item.search, item.showAll), item.expectedIds, item.name);
  }
});

test('fixture answers distinguish an empty catalogue from an empty result', () => {
  const noMatch = fixture.cases.find(item => item.name === 'no matches');
  assert.ok(noMatch);
  assert.deepEqual(noMatch.expectedIds, []);
  assert.ok(fixture.topics.length > 0);
  assert.ok(fixture.cases.some(item => item.expectedIds.length === fixture.topics.length));
});
