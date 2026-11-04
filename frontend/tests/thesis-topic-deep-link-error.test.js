const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const frontendRoot = path.resolve(__dirname, '..');
const PAGE = 'src/components/dashboard/thesis/ThesisTopicDetailPage.tsx';

function pageFunction(name, dependencies) {
  const source = fs.readFileSync(path.join(frontendRoot, PAGE), 'utf8');
  const tree = ts.createSourceFile(PAGE, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let declaration;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(tree) === name) declaration = node;
    ts.forEachChild(node, visit);
  }
  visit(tree);
  assert.ok(declaration, `page callback ${name} exists`);
  const output = ts.transpileModule(`const ${declaration.getText(tree)};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  }).outputText;
  return Function(...Object.keys(dependencies), 'useCallback', `${output}; return ${name};`)(
    ...Object.values(dependencies),
    (callback) => callback,
  );
}

function buildState() {
  return {
    directTopic: null,
    directError: '',
    loading: [],
    roundSwitches: [],
  };
}

function deps(state, getTopic) {
  return {
    thesisApi: { getTopic },
    selectedRoundId: 'round-a',
    setSelectedRoundId: (id) => state.roundSwitches.push(id),
    setDirectTopic: (value) => { state.directTopic = value; },
    setDirectError: (value) => { state.directError = value; },
    setDirectLoading: (value) => { state.loading.push(value); },
  };
}

test('a rejected direct topic read flags a load error instead of an empty result', async () => {
  const state = buildState();
  const fetchDirectTopic = pageFunction('fetchDirectTopic', deps(state, async () => {
    throw new Error('500 or missing topic');
  }));

  const { request } = fetchDirectTopic('topic-gone');
  await request;

  assert.deepEqual(state.directTopic, { id: 'topic-gone', topic: null });
  assert.equal(state.directError, 'topic-gone',
    'the failed read must be distinguishable from a resolved empty result');
});

test('a successful direct topic read clears the error and sets the round', async () => {
  const state = buildState();
  state.directError = 'stale-error';
  const fetchDirectTopic = pageFunction('fetchDirectTopic', deps(state, async (id) => ({
    id,
    title: 'Recovered topic',
    roundId: 'round-b',
  })));

  const { request } = fetchDirectTopic('topic-ok');
  await request;

  assert.deepEqual(state.directTopic, { id: 'topic-ok', topic: { id: 'topic-ok', title: 'Recovered topic', roundId: 'round-b' } });
  assert.equal(state.directError, '');
  assert.deepEqual(state.roundSwitches, ['round-b']);
});

test('the page renders the retryable error state before the empty-topic state', () => {
  const source = fs.readFileSync(path.join(frontendRoot, PAGE), 'utf8');
  const errorBranch = source.indexOf('!topic && directError');
  const emptyBranch = source.indexOf('if (!topic)');
  assert.notEqual(errorBranch, -1, 'a load failure must take the error branch, not the empty state');
  assert.ok(errorBranch < emptyBranch, 'the error branch must be evaluated before the empty state');
  assert.match(source.slice(errorBranch, emptyBranch), /<ErrorState/);
});
