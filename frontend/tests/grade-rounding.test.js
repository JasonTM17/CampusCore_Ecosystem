const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function loadTs(relativePath, stubs = {}) {
  const output = ts.transpileModule(read(relativePath), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
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

const gradeExport = loadTs('src/lib/grade-export.ts', {
  '@/i18n/messages': { getMessages: () => ({ teachingPages: { gradeCsv: {} } }) },
});
const gradeScale = loadTs('src/lib/grade-scale.ts');

function student(overrides = {}) {
  return {
    studentId: 'student-1',
    studentCode: 'CS101',
    studentName: 'Nguyen Van A',
    processScore: null,
    finalExamScore: null,
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

test('the section average rounds an exact half-cent up like the Java HALF_UP', () => {
  const summary = gradeExport.computeGradeSummary([
    student({ studentId: 'a', totalScore: 0 }),
    student({ studentId: 'b', totalScore: 0.29 }),
  ]);
  assert.equal(summary.averageScore, 0.15, '0 and 0.29 average to 0.15, not 0.14');
});

test('the credit-weighted GPA rounds an exact half-cent up like the Java HALF_UP', () => {
  const summary = gradeScale.summarizeGrades([
    gradeRecord({ id: 'g1', courseCode: 'CS101', credits: 3, letterGrade: 'D-' }),
    gradeRecord({ id: 'g2', courseCode: 'MA101', credits: 1, letterGrade: 'F' }),
  ]);
  assert.equal(summary.gpa, '0.53', 'a 0.525 GPA is published as 0.53, not 0.52');
});

test('the integer-cent rounding keeps ordinary averages and GPAs unchanged', () => {
  const summary = gradeExport.computeGradeSummary([
    student({ studentId: 'a', totalScore: 8.56 }),
    student({ studentId: 'b', totalScore: 8.56 }),
    student({ studentId: 'c', totalScore: 1 }),
  ]);
  assert.equal(summary.averageScore, 6.04);

  const gpaSummary = gradeScale.summarizeGrades([
    gradeRecord({ id: 'g1', courseCode: 'CS101', letterGrade: 'F', credits: 3 }),
    gradeRecord({ id: 'g2', courseCode: 'CS101', letterGrade: 'B', credits: 4 }),
    gradeRecord({ id: 'g3', courseCode: 'MA101', letterGrade: 'A', credits: 3 }),
  ]);
  assert.equal(gpaSummary.gpa, '3.43');
});
