const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

async function loadHelpers(relativePath, functionNames, variableNames = []) {
  const source = read(relativePath);
  const ast = ts.createSourceFile(relativePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const statements = ast.statements.filter((node) => {
    if (ts.isFunctionDeclaration(node)) {
      return functionNames.includes(node.name?.text);
    }
    if (ts.isVariableStatement(node)) {
      return node.declarationList.declarations.some(
        (declaration) => variableNames.includes(declaration.name.getText(ast)),
      );
    }
    return false;
  });
  const found = statements
    .filter((node) => ts.isFunctionDeclaration(node))
    .map((node) => node.name.text);
  assert.deepEqual([...found].sort(), [...functionNames].sort(),
    `${relativePath} must keep its state helpers directly testable`);

  const helperSource = `${statements.map((node) => node.getFullText(ast)).join('\n')}\nexport { ${[...functionNames, ...variableNames].join(', ')} };`;
  const { outputText } = ts.transpileModule(helperSource, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: 'admissions-helpers.ts',
  });
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
}

function loadAdmissionsApi(api) {
  const source = read('src/lib/admissions-api.ts');
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  }).outputText;
  const moduleRecord = { exports: {} };
  Function('module', 'exports', 'require', output)(moduleRecord, moduleRecord.exports, (specifier) => {
    if (specifier === '@/lib/api') return { __esModule: true, default: api };
    if (specifier === '@/lib/array-list-page') return { fetchArrayListPage: async () => ({ items: [] }) };
    return require(specifier);
  });
  return moduleRecord.exports;
}

test('submitting an application persists the visible form before the transition', () => {
  const source = read('src/components/admissions/AdmissionsApplyPage.tsx');
  const block = source.slice(
    source.indexOf('const transition = async'),
    source.indexOf('const upload = async'),
  );
  const save = block.indexOf('admissionsApi.save(');
  const submit = block.indexOf('admissionsApi.submit(');

  assert.ok(save >= 0, 'submit must persist the visible form first');
  assert.ok(submit > save, 'the save call must run before the submit call');
  assert.match(block, /const saved = await admissionsApi\.save\(selected\.id, form, selected\.version\)/);
  assert.match(block, /admissionsApi\.submit\(selected\.id, saved\.version/);
});

test('review actions only run for the detail row that is currently selected', async () => {
  const { canActOnDetail } = await loadHelpers(
    'src/components/admissions/AdmissionsReviewPage.tsx',
    ['canActOnDetail'],
  );

  assert.equal(canActOnDetail('application-a', 'application-a'), true);
  assert.equal(canActOnDetail('application-a', 'application-b'), false, 'a stale detail cannot act');
  assert.equal(canActOnDetail(null, 'application-b'), false);
  assert.equal(canActOnDetail('', ''), false);

  const source = read('src/components/admissions/AdmissionsReviewPage.tsx');
  const loadDetail = source.slice(
    source.indexOf('const loadDetail = useCallback'),
    source.indexOf('const changeFilter'),
  );
  assert.match(loadDetail, /setDetail\(null\)/, 'the previous detail is cleared while the next row loads');
  assert.match(source, /detail\.id === selectedId/, 'the panel renders only the selected row');
  assert.match(source, /if \(selectedId\) void loadDetail\(selectedId\)/,
    'refresh reloads the visible detail as well as the queue');
});

test('a decision carries the reviewer checklist and drops blank rows', async () => {
  const { cleanChecklist } = await loadHelpers(
    'src/components/admissions/AdmissionsReviewPage.tsx',
    ['cleanChecklist'],
  );

  assert.deepEqual(
    cleanChecklist([
      { item: 'Transcript', result: 'PASS' },
      { item: '   ', result: 'NOTE' },
      { item: ' Essay ', result: 'FAIL' },
    ]),
    [
      { item: 'Transcript', result: 'PASS' },
      { item: 'Essay', result: 'FAIL' },
    ],
  );

  let body;
  const { admissionsApi } = loadAdmissionsApi({
    post: async (url, data) => {
      body = { url, data };
      return { data: {} };
    },
  });
  await admissionsApi.decide('application-a', 'ACCEPTED', 'note', 7, [
    { item: 'Transcript', result: 'PASS' },
  ]);

  assert.deepEqual(body, {
    url: '/admissions/staff/applications/application-a/decision',
    data: {
      decision: 'ACCEPTED',
      note: 'note',
      expectedVersion: 7,
      checklist: [{ item: 'Transcript', result: 'PASS' }],
    },
  });

  const source = read('src/components/admissions/AdmissionsReviewPage.tsx');
  assert.match(source, /admissionsApi\.decide\(detail!\.id, decision, decisionNote, detail!\.version, cleanChecklist\(checklist\)\)/);
});

test('an attachment version bump keeps the draft while a selection change re-seeds it', async () => {
  const { formForSelection, EMPTY_FORM } = await loadHelpers(
    'src/components/admissions/AdmissionsApplyPage.tsx',
    ['formForSelection'],
    ['EMPTY_FORM'],
  );

  const application = (id, version, essay) => ({
    id,
    version,
    fullName: 'A',
    dateOfBirth: '2000-01-01',
    schoolName: 'S',
    intendedMajor: 'M',
    essay,
  });

  const kept = formForSelection('application-a', application('application-a', 4, 'server'));
  assert.equal(kept.ownerId, 'application-a');
  assert.equal(kept.form, null, 'a same-row version bump keeps the typed draft');

  const reSeeded = formForSelection('application-a', application('application-b', 1, 'other'));
  assert.equal(reSeeded.ownerId, 'application-b');
  assert.equal(reSeeded.form.essay, 'other');

  const cleared = formForSelection('application-a', null);
  assert.equal(cleared.ownerId, '');
  assert.deepEqual(cleared.form, EMPTY_FORM);

  const source = read('src/components/admissions/AdmissionsApplyPage.tsx');
  assert.match(source, /const next = formForSelection\(formOwner\.current, selected\)/);
  assert.match(source, /if \(next\.form\) \{\s*setForm\(next\.form\);/);
});
