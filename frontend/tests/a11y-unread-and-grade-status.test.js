const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const root = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function loadTs(relativePath, stubs = {}) {
  const output = ts.transpileModule(read(relativePath), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
    fileName: relativePath,
  }).outputText;
  const moduleRecord = { exports: {} };
  const resolve = (specifier) =>
    Object.prototype.hasOwnProperty.call(stubs, specifier)
      ? stubs[specifier]
      : require(specifier);
  Function('module', 'exports', 'require', output)(moduleRecord, moduleRecord.exports, resolve);
  return moduleRecord.exports;
}

/** Run one declaration from a page with injected dependencies. */
function executeDeclaration(file, name, dependencies = {}) {
  const source = fs.readFileSync(path.join(root, 'src', file), 'utf8');
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let declaration;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(tree) === name) declaration = node;
    if (ts.isFunctionDeclaration(node) && node.name?.getText(tree) === name) declaration = node;
    ts.forEachChild(node, visit);
  }
  visit(tree);
  assert.ok(declaration, `${file} contains ${name}`);
  const text = ts.isVariableDeclaration(declaration)
    ? `const ${declaration.getText(tree)};`
    : declaration.getText(tree).replace(/^export\s+/, '');
  const output = ts.transpileModule(text, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  }).outputText;
  return Function(...Object.keys(dependencies), `${output}; return ${name};`)(
    ...Object.values(dependencies),
  );
}

test('the bell and mobile menu names include the unread count', () => {
  const label = executeDeclaration('app/dashboard/layout.tsx', 'unreadAriaLabel');
  assert.equal(label('Toggle notifications panel', 0, 'Unread'), 'Toggle notifications panel');
  assert.equal(
    label('Toggle notifications panel', 3, 'Unread'),
    'Toggle notifications panel, 3 unread',
  );
  assert.equal(
    label('Open sidebar navigation', 12, 'Chưa đọc'),
    'Open sidebar navigation, 12 chưa đọc',
  );

  const layout = read('src/app/dashboard/layout.tsx');
  const bellStart = layout.indexOf('ref={notificationsTriggerRef}');
  const bellBlock = layout.slice(bellStart, layout.indexOf('</Button>', bellStart));
  assert.match(
    bellBlock,
    /aria-label=\{unreadAriaLabel\(\s*messages\.dashboardShell\.controls\.toggleNotifications,/,
    'the bell label is built from the unread-aware helper',
  );

  const menuStart = layout.indexOf('key="mobile-menu"');
  const menuBlock = layout.slice(menuStart, layout.indexOf('</button>', menuStart));
  assert.match(
    menuBlock,
    /aria-label=\{unreadAriaLabel\(\s*messages\.dashboardShell\.controls\.openSidebar,/,
    'the mobile menu label is built from the unread-aware helper',
  );

  const bellClass = layout.indexOf('absolute right-2 top-2 h-2.5 w-2.5');
  const bellBadge = layout.slice(
    layout.lastIndexOf('<span', bellClass),
    layout.indexOf('/>', bellClass),
  );
  assert.match(bellBadge, /aria-hidden="true"/, 'the visual bell dot is hidden from assistive tech');
  const menuClass = layout.indexOf('min-w-4 rounded-md bg-primary');
  const menuBadge = layout.slice(
    layout.lastIndexOf('<span', menuClass),
    layout.indexOf('</span>', menuClass),
  );
  assert.match(menuBadge, /aria-hidden="true"/, 'the visual menu badge is hidden from assistive tech');
});

function renderWithState(props, stateValues) {
  let cursor = 0;
  const fakeReact = {
    ...React,
    useState: () => [stateValues[cursor++], () => undefined],
    useEffect: () => undefined,
  };
  const output = ts.transpileModule(read('src/components/dashboard/GradeDetailModal.tsx'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
    fileName: 'src/components/dashboard/GradeDetailModal.tsx',
  }).outputText;
  const moduleRecord = { exports: {} };
  const portal = loadTs('src/i18n/messages-student-portal.ts');
  const stubs = {
    react: fakeReact,
    'lucide-react': new Proxy(
      {},
      { get: (_target, property) => (property === '__esModule' ? true : () => null) },
    ),
    '@/components/ui/modal': {
      Modal: ({ isOpen, title, children }) =>
        isOpen
          ? React.createElement('div', { role: 'dialog', 'aria-label': title }, children)
          : null,
    },
    '@/lib/api': {
      gradesApi: {
        getStudentGradesByEnrollment: async () => ({ grades: [] }),
      },
    },
    '@/i18n': { useI18n: () => ({ locale: 'vi' }) },
    '@/i18n/messages-student-portal': portal,
    '@/lib/academic-content': {
      getLocalizedFlatLabel: (_locale, ...values) => values.find(Boolean) || '',
    },
    '@/lib/grade-scale': { resolveGradePoint: () => 4 },
  };
  const resolve = (specifier) =>
    Object.prototype.hasOwnProperty.call(stubs, specifier)
      ? stubs[specifier]
      : require(specifier);
  Function('module', 'exports', 'require', output)(moduleRecord, moduleRecord.exports, resolve);
  return renderToStaticMarkup(
    React.createElement(moduleRecord.exports.GradeDetailModal, props),
  );
}

const gradeRecord = {
  id: 'e1',
  courseCode: 'CS101',
  courseName: 'Intro to Computing',
  courseNameEn: 'Intro to Computing',
  courseNameVi: 'Nhập môn tin học',
  sectionCode: '01',
  credits: 3,
  lecturerName: 'Nguyen Van A',
  semester: '2026-FALL',
  semesterNameEn: 'Fall 2026',
  semesterNameVi: 'Học kỳ 1 2026',
  processScore: 8,
  finalExamScore: 9,
  finalGrade: 8.5,
  letterGrade: 'A',
  gradePoint: 4,
};

test('grade-detail loading and failure states are announced', () => {
  const portal = loadTs('src/i18n/messages-student-portal.ts').studentPortalVi.gradeDetail;

  const loading = renderWithState(
    { isOpen: true, onClose: () => undefined, record: gradeRecord },
    [null, true, false],
  );
  assert.match(loading, /role="status"/, 'the loading row is a live status');
  assert.match(loading, /aria-busy="true"/, 'the loading row is marked busy');
  assert.ok(loading.includes(portal.loading), 'the loading copy is still visible');

  const failed = renderWithState(
    { isOpen: true, onClose: () => undefined, record: gradeRecord },
    [null, false, true],
  );
  assert.match(failed, /role="alert"/, 'the failure banner is announced as an alert');
  assert.ok(failed.includes(portal.detailFailed), 'the failure copy is still visible');
});
