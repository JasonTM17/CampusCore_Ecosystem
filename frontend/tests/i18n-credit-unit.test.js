const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function loadModule(relativePath) {
  const output = ts.transpileModule(read(relativePath), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const moduleRecord = { exports: {} };
  Function('module', 'exports', 'require', output)(
    moduleRecord,
    moduleRecord.exports,
    require,
  );
  return moduleRecord.exports;
}

const surfaces = [
  'src/components/dashboard/StudentUteProfileGradeView.tsx',
  'src/app/admin/users/page.tsx',
];

test('the shared credit abbreviation is localized (en = cr, vi = TC)', () => {
  const { studentPagesEn, studentPagesVi } = loadModule('src/i18n/messages-student-pages.ts');
  assert.equal(studentPagesEn.schedule.creditsAbbreviation, 'cr');
  assert.equal(studentPagesVi.schedule.creditsAbbreviation, 'TC');
});

test('no English surface hard-codes the Vietnamese credit abbreviation TC', () => {
  for (const file of surfaces) {
    const source = read(file);
    assert.doesNotMatch(
      source,
      /` TC\)|\} TC<|\b\d+\s*TC\b(?!<)/,
      `${file} must use the localized credit unit instead of a literal TC`,
    );
  }
});

test('both credit surfaces render the localized abbreviation', () => {
  for (const file of surfaces) {
    const source = read(file);
    assert.match(
      source,
      /creditsAbbreviation/,
      `${file} must render studentPages.schedule.creditsAbbreviation`,
    );
  }
});
