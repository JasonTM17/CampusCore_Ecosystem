const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const pagePath = path.join(root, 'src/app/dashboard/lecturer/grades/[id]/page.tsx');
const pageSource = fs.readFileSync(pagePath, 'utf8');

function loadGradeVersionHelpers() {
  const sourceFile = ts.createSourceFile(pagePath, pageSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const names = [
    'hasCompletedGrade',
    'createGradeDrafts',
    'applyImportedGradeRows',
    'preserveGradeDraftRows',
    'buildGradeSaveRows',
    'isStaleVersionError',
  ];
  const declarations = sourceFile.statements.filter(
    (statement) => ts.isFunctionDeclaration(statement) && names.includes(statement.name?.text),
  );

  for (const name of names) {
    assert.ok(declarations.some((declaration) => declaration.name?.text === name), `page must define ${name}`);
  }

  const moduleSource = [
    ...declarations.map((declaration) => declaration.getText(sourceFile)),
    `module.exports = { ${names.join(', ')} };`,
  ].join('\n');
  const output = ts.transpileModule(moduleSource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const moduleRecord = { exports: {} };
  Function('module', 'exports', output)(moduleRecord, moduleRecord.exports);
  return moduleRecord.exports;
}

test('grade writes carry loaded versions for edited, cleared, and imported rows', () => {
  const { createGradeDrafts, applyImportedGradeRows, buildGradeSaveRows } = loadGradeVersionHelpers();
  const enrollments = [
    { id: 'edited', processScore: 6, finalExamScore: 7, version: 4 },
    { id: 'cleared', processScore: 5, finalExamScore: 6, version: 8 },
    { id: 'imported', processScore: 3, finalExamScore: 4, version: 12 },
  ];
  const drafts = createGradeDrafts(enrollments);
  drafts.set('edited', { ...drafts.get('edited'), processScore: 9 });
  drafts.set('cleared', { ...drafts.get('cleared'), processScore: null, finalExamScore: null });
  const importedDrafts = applyImportedGradeRows(drafts, [
    { enrollmentId: 'imported', processScore: 8, finalExamScore: 9 },
  ]);
  const { updates } = buildGradeSaveRows(
    enrollments,
    new Set(['edited', 'cleared', 'imported']),
    importedDrafts,
  );

  assert.deepEqual(
    updates.map(({ enrollmentId, version }) => [enrollmentId, version]),
    [['edited', 4], ['imported', 12], ['cleared', 8]],
  );
  assert.deepEqual(
    updates.find((row) => row.enrollmentId === 'cleared'),
    { enrollmentId: 'cleared', processScore: null, finalExamScore: null, version: 8 },
  );
  assert.deepEqual(
    updates.find((row) => row.enrollmentId === 'imported'),
    { enrollmentId: 'imported', processScore: 8, finalExamScore: 9, version: 12 },
  );
});

test('a mocked STALE_VERSION response is classified for reconciliation without replaying the save', async () => {
  const { isStaleVersionError } = loadGradeVersionHelpers();
  const localDrafts = new Map([['enrollment-1', {
    enrollmentId: 'enrollment-1', processScore: 9, finalExamScore: 8, version: 3,
  }]]);
  const before = structuredClone([...localDrafts]);
  const staleResponse = {
    response: { status: 409, data: { code: 'STALE_VERSION', message: 'reload before editing' } },
  };
  let saveCalls = 0;
  const mockedSave = async () => {
    saveCalls += 1;
    throw staleResponse;
  };

  await assert.rejects(mockedSave(), (error) => isStaleVersionError(error));
  assert.equal(saveCalls, 1);
  assert.deepEqual([...localDrafts], before, 'a stale response must leave all draft values and versions intact');

  const saveSectionStart = pageSource.indexOf('const handleSave = async () => {');
  const reloadSectionStart = pageSource.indexOf('const handleReloadStaleGrades =', saveSectionStart);
  const saveSection = pageSource.slice(saveSectionStart, reloadSectionStart);
  const saveCatch = saveSection.match(/catch \(requestError: any\) \{([\s\S]*?)\n    \} finally \{/);
  assert.ok(saveCatch, 'grade save must keep an explicit error branch');
  const staleBranch = saveCatch[1].match(/if \(isStaleVersionError\(requestError\)\) \{([\s\S]*?)\n        \} else \{/);
  assert.ok(staleBranch, 'STALE_VERSION must have its own user-visible branch');
  assert.match(staleBranch[1], /setStaleVersionConflict\(true\)/);
  assert.doesNotMatch(staleBranch[1], /fetchSectionGrades|updateSectionGrades/);
  assert.match(pageSource, /onClick=\{handleReloadStaleGrades\}/);
});

test('a later sheet refetch preserves the loaded draft version until explicit reconciliation', () => {
  const { createGradeDrafts, preserveGradeDraftRows } = loadGradeVersionHelpers();
  const originalDraft = createGradeDrafts([
    { id: 'enrollment-1', processScore: 6, finalExamScore: 7, version: 3 },
  ]).get('enrollment-1');
  const latestRemoteDrafts = createGradeDrafts([
    { id: 'enrollment-1', processScore: 8, finalExamScore: 8, version: 4 },
  ]);
  const reconciledView = preserveGradeDraftRows(latestRemoteDrafts, [originalDraft]);

  assert.deepEqual(reconciledView.get('enrollment-1'), originalDraft);
  assert.equal(reconciledView.get('enrollment-1').version, 3);
  assert.match(pageSource, /onClick=\{rebaseLocalGradeVersions\}/);
});

test('a legacy grade-sheet response without version still builds a versionless save row', () => {
  const { createGradeDrafts, buildGradeSaveRows } = loadGradeVersionHelpers();
  const enrollments = [{ id: 'legacy', processScore: 6, finalExamScore: 7 }];
  const drafts = createGradeDrafts(enrollments);
  const { updates } = buildGradeSaveRows(enrollments, new Set(['legacy']), drafts);

  assert.equal(Object.hasOwn(updates[0], 'version'), false);
  assert.equal(JSON.stringify(updates[0]).includes('version'), false);
  const apiSource = fs.readFileSync(path.join(root, 'src/lib/api.ts'), 'utf8');
  assert.match(apiSource, /updateSectionGrades:[\s\S]*?\{ grades \}/);
});
