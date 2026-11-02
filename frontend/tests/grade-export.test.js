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
  const mod = { exports: {} };
  const resolve = (specifier) =>
    Object.hasOwn(aliases, specifier) ? aliases[specifier] : require(specifier);
  new Function('module', 'exports', 'require', js)(mod, mod.exports, resolve);
  return mod.exports;
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

const gradeExport = loadModule('src/lib/grade-export.ts', {
  '@/i18n/messages': loadMessages(),
});

const {
  calculateGrade,
  calculateTotalScore,
  computeGradeSummary,
  escapeCsvField,
  generateGradeCsv,
} = gradeExport;

test('Lecturer grade sheet CSV export and print roster integrity', async (t) => {
  await t.test('grade-export exposes the production grade and CSV helpers', () => {
    assert.equal(typeof calculateGrade, 'function', 'must export calculateGrade');
    assert.equal(typeof calculateTotalScore, 'function', 'must export calculateTotalScore');
    assert.equal(typeof computeGradeSummary, 'function', 'must export computeGradeSummary');
    assert.equal(typeof escapeCsvField, 'function', 'must export escapeCsvField');
    assert.equal(typeof generateGradeCsv, 'function', 'must export generateGradeCsv');
    assert.equal(typeof gradeExport.downloadCsvFile, 'function', 'must export downloadCsvFile');
  });

  await t.test('calculateGrade follows standard HCMUTE credit grading scale', () => {
    assert.equal(calculateGrade(9.5), 'A+');
    assert.equal(calculateGrade(9.0), 'A+');
    assert.equal(calculateGrade(8.7), 'A');
    assert.equal(calculateGrade(8.5), 'A');
    assert.equal(calculateGrade(8.2), 'B+');
    assert.equal(calculateGrade(8.0), 'B+');
    assert.equal(calculateGrade(7.5), 'B');
    assert.equal(calculateGrade(7.0), 'B');
    assert.equal(calculateGrade(6.8), 'C+');
    assert.equal(calculateGrade(6.5), 'C+');
    assert.equal(calculateGrade(5.8), 'C');
    assert.equal(calculateGrade(5.5), 'C');
    assert.equal(calculateGrade(5.2), 'D+');
    assert.equal(calculateGrade(5.0), 'D+');
    assert.equal(calculateGrade(4.5), 'D');
    assert.equal(calculateGrade(4.0), 'D');
    assert.equal(calculateGrade(3.9), 'F');
    assert.equal(calculateGrade(0), 'F');
  });

  await t.test('calculateTotalScore applies the integer-cent 50/50 weighting', () => {
    // The 3.99 + 4.00 tie is the reason the implementation rounds each score to
    // integer cents before averaging: a plain float average lands below 4.00.
    assert.equal(calculateTotalScore(3.99, 4.0), 4);
    assert.equal(calculateTotalScore(4.0, 3.99), 4);
    assert.equal(calculateTotalScore(3.98, 4.0), 3.99);
    assert.equal(calculateTotalScore(8.5, 9.0), 8.75);
    assert.equal(calculateTotalScore(10, 10), 10);
    assert.equal(calculateTotalScore(0, 0), 0);
    // Partial or non-finite scores stay ungraded instead of becoming a number.
    assert.equal(calculateTotalScore(null, 4.0), null);
    assert.equal(calculateTotalScore(4.0, null), null);
    assert.equal(calculateTotalScore(null, null), null);
    assert.equal(calculateTotalScore(Number.NaN, 4.0), null);
    assert.equal(calculateTotalScore(4.0, Number.POSITIVE_INFINITY), null);
  });

  await t.test('computeGradeSummary calculates distribution, pass rate, and average correctly', () => {
    const students = [
      { studentId: '1', studentCode: '21110001', studentName: 'Nguyễn Văn An', processScore: 9.0, finalExamScore: 9.0, totalScore: 9.0, letterGrade: 'A+' },
      { studentId: '2', studentCode: '21110002', studentName: 'Trần Thị Bình', processScore: 8.0, finalExamScore: 8.0, totalScore: 8.0, letterGrade: 'B+' },
      { studentId: '3', studentCode: '21110003', studentName: 'Lê Hoàng Cường', processScore: 3.0, finalExamScore: 4.0, totalScore: 3.5, letterGrade: 'F' },
      { studentId: '4', studentCode: '21110004', studentName: 'Phạm Minh Đức', processScore: null, finalExamScore: null, totalScore: null, letterGrade: null },
    ];

    assert.deepEqual(computeGradeSummary(students), {
      totalStudents: 4,
      gradedCount: 3,
      ungradedCount: 1,
      passedCount: 2,
      failedCount: 1,
      passRate: 66.7,
      averageScore: 6.83,
      counts: { 'A+': 1, A: 0, 'B+': 1, B: 0, 'C+': 0, C: 0, 'D+': 0, D: 0, F: 1 },
    });

    // Summary letters and totals come from the production arithmetic when a
    // row has no precomputed total or letter.
    assert.deepEqual(computeGradeSummary([
      { studentId: '5', studentCode: '21110005', studentName: 'Boundary', processScore: 3.99, finalExamScore: 4.0 },
    ]), {
      totalStudents: 1,
      gradedCount: 1,
      ungradedCount: 0,
      passedCount: 1,
      failedCount: 0,
      passRate: 100,
      averageScore: 4,
      counts: { 'A+': 0, A: 0, 'B+': 0, B: 0, 'C+': 0, C: 0, 'D+': 0, D: 1, F: 0 },
    });
  });

  await t.test('escapeCsvField neutralizes spreadsheet formula cells', () => {
    assert.equal(escapeCsvField('=1+1'), '"\'=1+1"');
    assert.equal(escapeCsvField('+cmd|\'/C calc\'!A0'), '"\'+cmd|\'/C calc\'!A0"');
    assert.equal(escapeCsvField('-2.5'), '"\'-2.5"');
    assert.equal(escapeCsvField('@cmd'), '"\'@cmd"');
    assert.equal(escapeCsvField('\t=1+1'), '"\'\t=1+1"');
    assert.equal(escapeCsvField(8.5), '"8.5"');
  });

  await t.test('escapeCsvField quotes commas, quotes, and newlines per RFC 4180', () => {
    assert.equal(escapeCsvField('Nguyen Van A'), '"Nguyen Van A"');
    assert.equal(escapeCsvField('A, B and C'), '"A, B and C"');
    assert.equal(escapeCsvField('He said "Hello"'), '"He said ""Hello"""');
    assert.equal(escapeCsvField('a"b'), '"a""b"');
    assert.equal(escapeCsvField('line1\nline2'), '"line1\nline2"');
    assert.equal(escapeCsvField(null), '""');
    assert.equal(escapeCsvField(undefined), '""');
  });

  await t.test('generateGradeCsv contains UTF-8 BOM, UTE institutional headers and RFC 4180 columns', () => {
    const csv = generateGradeCsv({
      sectionNumber: 'SEC-01',
      courseCode: 'CS101',
      courseName: 'Intro to Programming',
      semesterName: 'HK1 2026-2027',
      lecturerName: 'Nguyen Van A',
      students: [
        {
          studentId: '1',
          studentCode: '21110001',
          studentName: '=1+1',
          email: 'a@example.test',
          processScore: 8.0,
          finalExamScore: 8.0,
          gradeStatus: 'PUBLISHED',
        },
        {
          studentId: '2',
          studentCode: '21110002',
          studentName: '3.99 Tie',
          processScore: 3.99,
          finalExamScore: 4.0,
        },
      ],
    });

    assert.ok(csv.startsWith('\uFEFF'), 'must include UTF-8 BOM prefix for Excel');
    assert.ok(csv.includes('\r\n'), 'RFC 4180 rows use CRLF');
    assert.ok(
      csv.includes('"STT","Mã sinh viên","Họ và tên","Email","Điểm quá trình (50%)","Điểm thi kết thúc (50%)","Tổng kết (Hệ 10)","Điểm chữ","Trạng thái"'),
      'roster header comes from the Vietnamese catalogue',
    );
    assert.ok(
      csv.includes('"1","21110001","\'=1+1","a@example.test","8.0","8.0","8.00","B+","Đã công bố"'),
      'formula-like names are neutralized in the exported row',
    );
    assert.ok(
      csv.includes('"2","21110002","3.99 Tie","","4.0","4.0","4.00","D","Bản nháp"'),
      'the 3.99/4.00 tie exports the production total and letter',
    );
    assert.ok(csv.trimEnd().endsWith('"Bản nháp"'), 'last row is terminated');

    const english = generateGradeCsv({ sectionNumber: 'SEC-01', students: [], locale: 'en' });
    assert.ok(
      english.includes('"No.","Student ID","Full Name","Email","Process Score (50%)","Final Exam Score (50%)","Total (Scale 10)","Letter Grade","Status"'),
      'the requested locale selects the roster header',
    );
    assert.equal(
      english.slice(1).split('\r\n')[0],
      '"HO CHI MINH CITY UNIVERSITY OF TECHNOLOGY AND ENGINEERING — CAMPUSUTE"',
    );
  });
});
