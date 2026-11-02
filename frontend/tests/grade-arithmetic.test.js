const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');

function loadModule(relativePath, aliases = {}) {
  const source = fs.readFileSync(path.join(root, relativePath), 'utf8');
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const moduleRecord = { exports: {} };
  const resolve = (specifier) =>
    Object.hasOwn(aliases, specifier) ? aliases[specifier] : require(specifier);
  Function('module', 'exports', 'require', js)(moduleRecord, moduleRecord.exports, resolve);
  return moduleRecord.exports;
}

const messageFragments = [
  ['@/i18n/messages-thesis-workflow', 'src/i18n/messages-thesis-workflow.ts'],
  ['@/i18n/messages-dean-overview', 'src/i18n/messages-dean-overview.ts'],
  ['@/i18n/messages-content', 'src/i18n/messages-content.ts'],
  ['@/i18n/messages-attendance-geofence', 'src/i18n/messages-attendance-geofence.ts'],
  ['@/i18n/messages-teaching-pages', 'src/i18n/messages-teaching-pages.ts'],
  ['@/i18n/messages-admin-pages', 'src/i18n/messages-admin-pages.ts'],
  ['@/i18n/messages-student-pages', 'src/i18n/messages-student-pages.ts'],
];

function loadMessages() {
  const aliases = { '@/i18n/config': {} };
  for (const [specifier, relativePath] of messageFragments) {
    aliases[specifier] = loadModule(relativePath);
  }
  return loadModule('src/i18n/messages.ts', aliases);
}

const messages = loadMessages();
const gradeExport = loadModule('src/lib/grade-export.ts', {
  '@/i18n/messages': messages,
});
const gradeScale = loadModule('src/lib/grade-scale.ts');

const JAVA_MUTATION_SOURCE = path.resolve(
  root,
  '..',
  'java-services/restful-api/src/main/java/io/campuscore/restfulapi/academic/service/AcademicMutationService.java',
);
const JAVA_READ_SOURCE = path.resolve(
  root,
  '..',
  'java-services/restful-api/src/main/java/io/campuscore/restfulapi/academic/service/AcademicEnrollmentReadService.java',
);

function javaLetterTable() {
  const source = fs.readFileSync(JAVA_MUTATION_SOURCE, 'utf8');
  const start = source.indexOf('static String letterGrade(BigDecimal score)');
  assert.ok(start >= 0, 'the Java letterGrade method must exist');
  const block = source.slice(start, source.indexOf('\n    }', start));
  const rows = [];
  const pattern = /compareTo\(new BigDecimal\("([0-9.]+)"\)\)\s*>=\s*0\)\s*return "([^"]+)"/g;
  let match;
  while ((match = pattern.exec(block)) !== null) {
    rows.push({ min: Number(match[1]), letter: match[2] });
  }
  assert.ok(rows.length >= 8, 'the Java letter table must publish every band');
  rows.push({ min: 3.99, letter: 'F' });
  return rows;
}

function javaGradePoints() {
  const source = fs.readFileSync(JAVA_READ_SOURCE, 'utf8');
  const start = source.indexOf('GRADE_POINTS = Map.ofEntries(');
  assert.ok(start >= 0, 'the Java GRADE_POINTS table must exist');
  const block = source.slice(start, source.indexOf(');', start));
  const points = {};
  const pattern =
    /Map\.entry\("([^"]+)",\s*(?:BigDecimal\.valueOf\(([0-9.]+)\)|BigDecimal\.ZERO)\)/g;
  let match;
  while ((match = pattern.exec(block)) !== null) {
    points[match[1]] = match[2] === undefined ? 0 : Number(match[2]);
  }
  assert.ok(Object.keys(points).length >= 10, 'the Java GPA table must publish every letter');
  return points;
}

const {
  calculateGrade,
  calculateTotalScore,
  computeGradeSummary,
  escapeCsvField,
  generateGradeCsv,
} = gradeExport;
const {
  CONVERSION_TABLE,
  GRADE_POINTS,
  bandUpperDisplay,
  classifyThesisScore,
  computeGpa4,
  letterFromScore,
  pointFromScore,
  resolveGradePoint,
  summarizeGrades,
} = gradeScale;

// The backend table in AcademicMutationService.letterGrade and its
// AcademicMutationServiceGradeTest: min-inclusive, max-exclusive.
const JAVA_LETTER_TABLE = [
  [9.0, 'A+'],
  [8.99, 'A'],
  [8.5, 'A'],
  [8.49, 'B+'],
  [8.0, 'B+'],
  [7.99, 'B'],
  [7.0, 'B'],
  [6.99, 'C+'],
  [6.5, 'C+'],
  [6.49, 'C'],
  [5.5, 'C'],
  [5.49, 'D+'],
  [5.0, 'D+'],
  [4.99, 'D'],
  [4.0, 'D'],
  [3.99, 'F'],
  [0, 'F'],
  [10, 'A+'],
];

function student(overrides = {}) {
  return {
    studentId: 'student-1',
    studentCode: 'CS101',
    studentName: 'Nguyen Van A',
    processScore: 8,
    finalExamScore: 6,
    ...overrides,
  };
}

function gradeRecord(overrides = {}) {
  return {
    id: 'grade',
    courseCode: 'CS101',
    courseName: 'Intro',
    credits: 3,
    sectionCode: 'A',
    lecturerName: null,
    semester: '2026-FALL',
    semesterId: 'semester-1',
    processScore: null,
    finalExamScore: null,
    finalGrade: null,
    letterGrade: null,
    gradeStatus: 'PUBLISHED',
    enrollmentStatus: 'COMPLETED',
    ...overrides,
  };
}

test('every published letter boundary matches the Java grading table', () => {
  for (const [score, expected] of JAVA_LETTER_TABLE) {
    assert.equal(calculateGrade(score), expected, `calculateGrade(${score})`);
    assert.equal(letterFromScore(score), expected, `letterFromScore(${score})`);
  }
});

test('the web letter table is the same table read from the Java service', () => {
  const rows = javaLetterTable();
  for (let index = 0; index < rows.length; index += 1) {
    const { min, letter } = rows[index];
    assert.equal(calculateGrade(min), letter, `Java boundary ${min}`);
    assert.equal(letterFromScore(min), letter, `Java conversion boundary ${min}`);
    const lower = rows[index + 1];
    if (lower) {
      assert.equal(calculateGrade(min - 0.01), lower.letter, `just below ${min}`);
      assert.equal(letterFromScore(min - 0.01), lower.letter, `conversion just below ${min}`);
    }
  }
  assert.equal(rows.at(-1).letter, 'F');
});

test('the web 4.0 point table is the same table read from the Java service', () => {
  assert.deepEqual(GRADE_POINTS, javaGradePoints());
});

test('the 4.0 conversion table uses the same min-inclusive bands as the letters', () => {
  for (const row of CONVERSION_TABLE) {
    assert.equal(letterFromScore(row.min), row.letter, `table min for ${row.letter}`);
    assert.equal(pointFromScore(row.min), row.point, `point at ${row.min}`);
    const lowerBand = CONVERSION_TABLE[CONVERSION_TABLE.indexOf(row) + 1];
    if (lowerBand) {
      assert.equal(letterFromScore(row.min - 0.01), lowerBand.letter, `just below ${row.letter}`);
    }
  }
  assert.equal(letterFromScore(10), 'A+');
  assert.equal(pointFromScore(10), 4);
  assert.equal(letterFromScore(3.99), 'F');
  assert.equal(pointFromScore(3.99), 0);
});

test('band display never rounds an upper bound into the next letter band', () => {
  assert.equal(bandUpperDisplay(9.0), '8.9');
  assert.equal(bandUpperDisplay(8.5), '8.4');
  assert.equal(bandUpperDisplay(8.0), '7.9');
  assert.equal(bandUpperDisplay(4.0), '3.9');
  assert.equal(bandUpperDisplay(10.01), '10.0');
});

test('the total score is a 50/50 average rounded half-up at two decimals', () => {
  assert.equal(calculateTotalScore(8.0, 6.0), 7);
  assert.equal(calculateTotalScore(8.55, 8.56), 8.56);
  assert.equal(calculateTotalScore(8.54, 8.55), 8.55);
  assert.equal(calculateTotalScore(3.99, 4.0), 4.0);
  assert.equal(calculateGrade(calculateTotalScore(3.99, 4.0)), 'D');
  assert.equal(calculateTotalScore(3.98, 4.0), 3.99);
  assert.equal(calculateGrade(calculateTotalScore(3.98, 4.0)), 'F');
  assert.equal(calculateTotalScore(10, 10), 10);
  assert.equal(calculateTotalScore(0, 0), 0);
});

test('null, blank and non-finite components make the total unknown', () => {
  for (const [process, final] of [
    [null, 6],
    [6, null],
    [null, null],
    [undefined, 6],
    [6, undefined],
    [Number.NaN, 6],
    [6, Number.NaN],
    [Number.POSITIVE_INFINITY, 6],
    [6, Number.NEGATIVE_INFINITY],
    ['', 6],
    [6, ''],
    ['8', '6'],
  ]) {
    assert.equal(calculateTotalScore(process, final), null, `${String(process)} / ${String(final)}`);
  }
});

test('the section summary separates graded, ungraded, passed and failed rows', () => {
  const summary = computeGradeSummary([
    student({ studentId: 'a', processScore: 9, finalExamScore: 10 }), // 9.5 A+
    student({ studentId: 'b', processScore: 8, finalExamScore: 9 }), // 8.5 A
    student({ studentId: 'c', processScore: 6, finalExamScore: 7 }), // 6.5 C+
    student({ studentId: 'd', processScore: 4, finalExamScore: 4 }), // 4.0 D
    student({ studentId: 'e', processScore: 3.99, finalExamScore: 3.99 }), // 3.99 F
    student({ studentId: 'f', processScore: null, finalExamScore: 8 }), // ungraded
    student({ studentId: 'g', processScore: 8, finalExamScore: undefined }), // ungraded
  ]);

  assert.equal(summary.totalStudents, 7);
  assert.equal(summary.gradedCount, 5);
  assert.equal(summary.ungradedCount, 2);
  assert.equal(summary.passedCount, 4);
  assert.equal(summary.failedCount, 1);
  assert.equal(summary.passRate, 80);
  assert.equal(summary.averageScore, 6.5);
  assert.deepEqual(summary.counts, {
    'A+': 1,
    A: 1,
    'B+': 0,
    B: 0,
    'C+': 1,
    C: 0,
    'D+': 0,
    D: 1,
    F: 1,
  });
});

test('an explicit saved total or letter wins over the component arithmetic', () => {
  const summary = computeGradeSummary([
    student({ studentId: 'a', processScore: 2, finalExamScore: 2, totalScore: 8.0, letterGrade: 'B' }),
    student({ studentId: 'b', processScore: null, finalExamScore: null, totalScore: 5.5 }),
    student({ studentId: 'c', processScore: 10, finalExamScore: 10, totalScore: Number.NaN }),
  ]);

  assert.equal(summary.gradedCount, 2);
  assert.equal(summary.passedCount, 2);
  assert.equal(summary.counts.B, 1);
  assert.equal(summary.counts.C, 1, 'a saved 5.5 total derives C when no letter is stored');
});

test('the summary rounds the pass rate to one decimal and the average to two', () => {
  const summary = computeGradeSummary([
    student({ studentId: 'a', processScore: 8.55, finalExamScore: 8.56 }), // 8.56
    student({ studentId: 'b', processScore: 8.55, finalExamScore: 8.56 }), // 8.56
    student({ studentId: 'c', processScore: 1, finalExamScore: 1 }), // 1.00
  ]);

  assert.equal(summary.averageScore, 6.04);
  assert.equal(summary.passRate, 66.7);
});

test('CSV fields are quoted, doubled and formula-safe', () => {
  assert.equal(escapeCsvField(null), '""');
  assert.equal(escapeCsvField(undefined), '""');
  assert.equal(escapeCsvField('Nguyen Van A'), '"Nguyen Van A"');
  assert.equal(escapeCsvField(0), '"0"');
  assert.equal(escapeCsvField('a"b'), '"a""b"');
  assert.equal(escapeCsvField('a\nb'), '"a\nb"');
  for (const value of ['=1+1', '+cmd', '-10', '@x', '\tvalue']) {
    assert.equal(escapeCsvField(value), `"'${value}"`, value);
  }
});

test('the exported roster uses the production totals, letters and status copy', () => {
  const csv = generateGradeCsv({
    sectionNumber: 'CS101-01',
    courseCode: 'CS101',
    courseName: 'Intro',
    students: [
      student({
        studentId: 'a',
        studentCode: 'CS-001',
        studentName: '=1+1',
        processScore: 3.99,
        finalExamScore: 4.0,
        gradeStatus: 'PUBLISHED',
      }),
      student({
        studentId: 'b',
        studentCode: 'CS-002',
        processScore: null,
        finalExamScore: null,
        gradeStatus: 'DRAFT',
      }),
      student({
        studentId: 'c',
        studentCode: 'CS-003',
        processScore: 2,
        finalExamScore: 2,
        totalScore: 8.0,
        letterGrade: 'B',
        gradeStatus: 'PUBLISHED',
      }),
      student({
        studentId: 'd',
        studentCode: 'CS-004',
        processScore: 3.98,
        finalExamScore: 4.0,
        gradeStatus: 'PUBLISHED',
      }),
    ],
    locale: 'en',
  });

  const copy = messages.getMessages('en').teachingPages.gradeCsv;
  assert.ok(csv.startsWith('\uFEFF'));
  assert.ok(csv.includes('\r\n'));
  assert.ok(csv.includes(`"${copy.institution.replace(/"/g, '""')}"`));
  assert.ok(csv.includes('"4.00","D","' + copy.statuses.published + '"'));
  assert.ok(csv.includes('"3.99","F","' + copy.statuses.published + '"'));
  assert.ok(csv.includes('"8.00","B","' + copy.statuses.published + '"'));
  assert.ok(csv.includes('"' + "'=1+1" + '"'), 'formula-leading name stays neutralised');
  const ungradedRow = csv
    .slice(1)
    .split('\r\n')
    .find((line) => line.startsWith('"2","CS-002"'));
  assert.equal(
    ungradedRow,
    `"2","CS-002","Nguyen Van A","","","","","","${copy.statuses.draft}"`,
  );
});

test('the CSV summary line agrees with computeGradeSummary', () => {
  const students = [
    student({ studentId: 'a', processScore: 9, finalExamScore: 10 }),
    student({ studentId: 'b', processScore: 8, finalExamScore: 9 }),
    student({ studentId: 'c', processScore: 3.99, finalExamScore: 4.0 }),
    student({ studentId: 'd', processScore: null, finalExamScore: null }),
  ];
  const summary = computeGradeSummary(students);
  const csv = generateGradeCsv({ sectionNumber: 'S1', students, locale: 'en' });
  const copy = messages.getMessages('en').teachingPages.gradeCsv;

  const lines = csv.slice(1).split('\r\n');
  const statistics = lines.find((line) => line.includes(`"${copy.statistics.total}"`));
  assert.ok(statistics);
  assert.ok(statistics.includes(`"${summary.totalStudents}"`));
  assert.ok(statistics.includes(`"${summary.gradedCount}"`));
  assert.ok(statistics.includes(`"${summary.ungradedCount}"`));
  assert.ok(statistics.includes(`"${summary.passedCount}"`));
  assert.ok(statistics.includes(`"${summary.failedCount}"`));
  assert.ok(statistics.includes(`"${summary.passRate.toFixed(1)}%"`));
  assert.ok(statistics.includes(`"${summary.averageScore.toFixed(2)}"`));
});

test('the 4.0 GPA is credit-weighted and skips records without a derivable point', () => {
  const records = [
    gradeRecord({ grades: undefined, credits: 4, gradePoint: 4.0 }),
    gradeRecord({ credits: 3, letterGrade: 'B' }),
    gradeRecord({ credits: 1, finalGrade: 5.0 }),
    gradeRecord({ credits: 2 }),
    gradeRecord({ credits: 0, gradePoint: 4.0 }),
  ];
  assert.equal(computeGpa4(records), (4 * 4 + 3 * 3 + 1 * 1.5) / 8);
  assert.equal(computeGpa4([]), null);
  assert.equal(computeGpa4([gradeRecord({ credits: 3 })]), null);
});

test('resolveGradePoint prefers the saved point, then the letter, then the score', () => {
  assert.equal(resolveGradePoint({ gradePoint: 3.5, letterGrade: 'A', finalGrade: 9 }), 3.5);
  assert.equal(resolveGradePoint({ gradePoint: null, letterGrade: 'A-', finalGrade: 9 }), 3.7);
  assert.equal(resolveGradePoint({ gradePoint: Number.NaN, letterGrade: null, finalGrade: 5.0 }), 1.5);
  assert.equal(resolveGradePoint({ gradePoint: null, letterGrade: null, score: 8.5 }), 4);
  assert.equal(resolveGradePoint({ gradePoint: null, letterGrade: null }), null);
});

test('the grade summary counts a retaken course once through its best attempt', () => {
  const summary = summarizeGrades([
    gradeRecord({ id: 'g1', courseCode: 'CS101', letterGrade: 'F', credits: 3 }),
    gradeRecord({ id: 'g2', courseCode: 'CS101', letterGrade: 'B', credits: 4 }),
    gradeRecord({ id: 'g3', courseCode: 'MA101', letterGrade: 'A', credits: 3, enrollmentStatus: 'ENROLLED' }),
  ]);

  assert.equal(summary.courseCount, 3);
  assert.equal(summary.gradedCount, 3);
  assert.equal(summary.completedCredits, 4);
  assert.equal(summary.gpa, '3.43');
});

test('the thesis classifier shares the course letter and band boundaries', () => {
  assert.deepEqual(classifyThesisScore(9.0), { letter: 'A+', gpa4: '4.0', band: 'EXCELLENT' });
  assert.deepEqual(classifyThesisScore(8.5), { letter: 'A', gpa4: '4.0', band: 'EXCELLENT' });
  assert.deepEqual(classifyThesisScore(8.0), { letter: 'B+', gpa4: '3.5', band: 'GOOD' });
  assert.deepEqual(classifyThesisScore(7.0), { letter: 'B', gpa4: '3.0', band: 'FAIR' });
  assert.deepEqual(classifyThesisScore(6.5), { letter: 'C+', gpa4: '2.5', band: 'UPPER_AVERAGE' });
  assert.deepEqual(classifyThesisScore(5.5), { letter: 'C', gpa4: '2.0', band: 'AVERAGE' });
  assert.deepEqual(classifyThesisScore(5.0), { letter: 'D+', gpa4: '1.5', band: 'BELOW_AVERAGE' });
  assert.deepEqual(classifyThesisScore(4.0), { letter: 'D', gpa4: '1.0', band: 'PASS' });
  assert.deepEqual(classifyThesisScore(3.99), { letter: 'F', gpa4: '0.0', band: 'RETAKE' });
});

test('the shared letter table maps every published letter to the official 4.0 point', () => {
  const expected = {
    'A+': 4,
    A: 4,
    'A-': 3.7,
    'B+': 3.5,
    B: 3,
    'B-': 2.7,
    'C+': 2.5,
    C: 2,
    'C-': 1.7,
    'D+': 1.5,
    D: 1,
    'D-': 0.7,
    F: 0,
  };
  assert.deepEqual(GRADE_POINTS, expected);
});
