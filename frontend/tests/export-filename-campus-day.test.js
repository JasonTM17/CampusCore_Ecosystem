const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const PAGE = 'src/app/dashboard/lecturer/grades/[id]/page.tsx';
const ZONES = ['America/Los_Angeles', 'UTC'];
const originalZone = process.env.TZ;

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function inZone(zone, run) {
  process.env.TZ = zone;
  try {
    return run();
  } finally {
    process.env.TZ = originalZone;
  }
}

function loadTs(relativePath) {
  const output = ts.transpileModule(read(relativePath), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: relativePath,
  }).outputText;
  const moduleRecord = { exports: {} };
  Function('module', 'exports', 'require', output)(moduleRecord, moduleRecord.exports, require);
  return moduleRecord.exports;
}

const attendance = loadTs('src/lib/attendance-checkin.ts');

function filenameExpression() {
  const source = read(PAGE);
  const file = ts.createSourceFile('page.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let expression = '';
  const visit = (node) => {
    if (
      ts.isVariableDeclaration(node)
      && ts.isIdentifier(node.name)
      && node.name.text === 'filename'
      && node.initializer
    ) {
      expression = node.initializer.getText(file);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return expression;
}

function fixedClock(instant) {
  return class FixedDate extends Date {
    constructor(...args) {
      super(...(args.length ? args : [instant]));
    }
  };
}

function filenameAt(expression, instant) {
  const sectionData = { courseCode: 'CS101', sectionNumber: '01' };
  const FixedDate = fixedClock(instant);
  const run = new Function(
    'sectionData',
    'Date',
    'campusTodayIso',
    `return (${expression});`,
  );
  return run(sectionData, FixedDate, () => attendance.campusTodayIso(new Date(instant)));
}

test('grade export names use the campus day, not the UTC day', () => {
  const expression = filenameExpression();
  assert.ok(expression, 'the grade page must keep its CSV filename expression');

  const cases = [
    // 06:30 on 3 November campus time is still 2 November in UTC.
    ['2026-11-02T23:30:00.000Z', '2026-11-03'],
    // A minute before and at campus midnight.
    ['2026-11-03T16:59:59.000Z', '2026-11-03'],
    ['2026-11-03T17:00:00.000Z', '2026-11-04'],
  ];

  for (const zone of ZONES) {
    inZone(zone, () => {
      for (const [instant, campusDay] of cases) {
        assert.equal(
          filenameAt(expression, instant),
          `Bang_diem_CS101_Lop_01_${campusDay}.csv`,
          `${zone} export at ${instant}`,
        );
      }
    });
  }
});
