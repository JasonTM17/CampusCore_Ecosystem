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

const registeredEnrollments = [
  {
    id: 'e1',
    status: 'ENROLLED',
    section: {
      course: { code: 'SE101', credits: 3 },
      schedules: [{ startTime: '07:00', endTime: '09:30', dayOfWeek: 2 }],
    },
  },
  {
    id: 'e2',
    status: 'ENROLLED',
    section: {
      course: { code: 'SE102', credits: 3 },
      schedules: [],
    },
  },
];

// Only the first course has a timetable slot; the second is still a real
// registration that must appear in the official totals.
const agenda = [{ courseCode: 'SE101', credits: 3 }];

const totalsDependencies = {
  agenda,
  registeredEnrollments,
  useMemo: (factory) => factory(),
};

test('student totals count registered courses without timetable slots', () => {
  const uniqueCoursesCount = executeDeclaration(
    'app/dashboard/schedule/page.tsx',
    'uniqueCoursesCount',
    totalsDependencies,
  );
  const totalCreditsCount = executeDeclaration(
    'app/dashboard/schedule/page.tsx',
    'totalCreditsCount',
    totalsDependencies,
  );

  assert.equal(uniqueCoursesCount, 2, 'both registered courses count, scheduled or not');
  assert.equal(totalCreditsCount, 6, 'credits sum every registered course exactly once');
});

test('student schedule keeps registrations without timetable slots visible', () => {
  const source = read('src/app/dashboard/schedule/page.tsx');
  assert.match(
    source,
    /const registeredEnrollments = useMemo/,
    'the page derives a registration set independent of timetable slots',
  );
  assert.match(source, /isActiveEnrollment\(enrollment\.status\)/);
  assert.match(source, /enrollment\.status === 'COMPLETED'/);
  assert.match(
    source,
    /\) : registeredEnrollments\.length === 0 \? \(\s*<EmptyState[\s\S]{0,220}?scheduleMessages\.emptyTitle/,
    'only an empty registration set may render the no-courses empty state',
  );
});

test('lecturer schedule keeps assigned sections visible without timetable slots', () => {
  const source = read('src/app/dashboard/lecturer/schedule/page.tsx');
  assert.match(
    source,
    /\) : sections\.length === 0 \? \(\s*<EmptyState[\s\S]{0,220}?copy\.emptyTitle/,
    'the no-assignments empty state is gated on assigned sections, not on slots',
  );
  assert.doesNotMatch(
    source,
    /\) : agenda\.length === 0 \? \(\s*<EmptyState/,
    'missing timetable slots must not read as missing teaching assignments',
  );
});
