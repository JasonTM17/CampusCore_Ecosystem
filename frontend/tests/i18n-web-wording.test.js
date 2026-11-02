const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function exists(relativePath) {
  return fs.existsSync(path.join(root, relativePath));
}

function loadTs(relativePath, aliases = {}) {
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
    Object.prototype.hasOwnProperty.call(aliases, specifier)
      ? aliases[specifier]
      : require(specifier);
  Function('module', 'exports', 'require', output)(moduleRecord, moduleRecord.exports, resolve);
  return moduleRecord.exports;
}

function loadMessages() {
  const aliases = { '@/i18n/config': {} };
  for (const relativePath of [
    'src/i18n/messages-thesis-workflow.ts',
    'src/i18n/messages-dean-overview.ts',
    'src/i18n/messages-content.ts',
    'src/i18n/messages-attendance-geofence.ts',
    'src/i18n/messages-teaching-pages.ts',
    'src/i18n/messages-admin-pages.ts',
    'src/i18n/messages-student-pages.ts',
  ]) {
    aliases[`@/i18n/${path.basename(relativePath, '.ts')}`] = loadTs(relativePath);
  }
  return loadTs('src/i18n/messages.ts', aliases);
}

function placeholders(value) {
  return [...value.matchAll(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g)]
    .map((match) => match[1])
    .sort();
}

test('admin classroom copy calls the entity a class section in Vietnamese', () => {
  const { adminAcademicsVi } = loadTs('src/i18n/messages-admin-academics.ts');
  const classrooms = adminAcademicsVi.classrooms;

  assert.doesNotMatch(classrooms.description, /\bsection\b/i);
  assert.doesNotMatch(classrooms.emptyDescription, /\bsection\b/i);
  assert.match(classrooms.description, /lớp học phần/);
  assert.match(classrooms.emptyDescription, /lớp học phần/);
});

test('the English schedule summary does not print the Vietnamese credit abbreviation', () => {
  const { studentPagesEn, studentPagesVi } = loadTs('src/i18n/messages-student-pages.ts');

  assert.equal(studentPagesEn.schedule.creditsAbbreviation, 'cr');
  assert.equal(studentPagesVi.schedule.creditsAbbreviation, 'TC');
  assert.match(read('src/app/dashboard/schedule/page.tsx'), /creditsAbbreviation/);
});

test('thesis rosters take the student identifier label from the catalogue', () => {
  const { en, vi } = loadMessages();
  assert.equal(en.thesis.studentIdLabel, 'Student ID');
  assert.match(vi.thesis.studentIdLabel, /MSSV/);

  for (const relativePath of [
    'src/app/dashboard/thesis/page.tsx',
    'src/features/thesis/components/StudentGroupCard.tsx',
    'src/features/thesis/components/ThesisRepositoryWorkspace.tsx',
  ]) {
    const source = read(relativePath);
    assert.ok(source.includes('messages.thesis.studentIdLabel'), relativePath);
    assert.ok(!/>\s*MSSV:/.test(source), relativePath);
  }
});

test('the login demo notes live in the catalogue without the Vietnamese thesis acronym in English', () => {
  const { en, vi } = loadMessages();
  const page = read('src/app/login/page.tsx');

  assert.equal(typeof en.login.demoGroupNote, 'string');
  assert.equal(typeof vi.login.demoGroupNote, 'string');
  assert.equal(typeof en.login.demoAccountNote, 'string');
  assert.equal(typeof vi.login.demoAccountNote, 'string');
  assert.doesNotMatch(en.login.demoGroupNote, /\bKLTN\b/);
  assert.doesNotMatch(en.login.demoAccountNote, /\bKLTN\b/);
  assert.match(page, /messages\.login\.demoGroupNote/);
  assert.match(page, /messages\.login\.demoAccountNote/);
  assert.doesNotMatch(page, /same KLTN thesis group/);
  assert.doesNotMatch(page, /💡 Bốn tài khoản/);
});

test('English count copy inflects while Vietnamese count copy stays unchanged', () => {
  const helperPath = 'src/lib/plural.ts';
  assert.equal(exists(helperPath), true, 'the shared plural helper must exist');
  const { countLabel } = loadTs(helperPath);
  const { en, vi } = loadMessages();

  const render = (template, count) => template.replace('{count}', String(count));

  assert.equal(
    render(countLabel(1, en.courseRegistration.headerCreditRemaining, en.courseRegistration.headerCreditsRemaining), 1),
    '1 credit left',
  );
  assert.equal(
    render(countLabel(2, en.courseRegistration.headerCreditRemaining, en.courseRegistration.headerCreditsRemaining), 2),
    '2 credits left',
  );
  assert.equal(
    render(countLabel(1, en.courseRegistration.sectionCountSingular, en.courseRegistration.sectionCount), 1),
    '1 section',
  );
  assert.equal(
    render(countLabel(2, en.courseRegistration.sectionCountSingular, en.courseRegistration.sectionCount), 2),
    '2 sections',
  );
  assert.equal(
    `${1} ${countLabel(1, en.curriculum.creditLabel, en.curriculum.creditsLabel)}`,
    '1 credit',
  );
  assert.equal(
    `${2} ${countLabel(2, en.curriculum.creditLabel, en.curriculum.creditsLabel)}`,
    '2 credits',
  );
  assert.equal(
    render(countLabel(1, en.lecturerAttendance.savedSuccessSingular, en.lecturerAttendance.savedSuccess), 1),
    'Attendance recorded successfully for 1 student',
  );
  assert.equal(
    render(countLabel(2, en.lecturerAttendance.savedSuccessSingular, en.lecturerAttendance.savedSuccess), 2),
    'Attendance recorded successfully for 2 students',
  );

  for (const [key, singular] of [
    ['headerCreditRemaining', en.courseRegistration.headerCreditRemaining],
    ['sectionCountSingular', en.courseRegistration.sectionCountSingular],
    ['savedSuccessSingular', en.lecturerAttendance.savedSuccessSingular],
  ]) {
    assert.deepEqual(placeholders(singular), ['count'], key);
  }
  assert.equal(vi.courseRegistration.headerCreditRemaining, vi.courseRegistration.headerCreditsRemaining);
  assert.equal(vi.courseRegistration.sectionCountSingular, vi.courseRegistration.sectionCount);
  assert.equal(vi.curriculum.creditLabel, vi.curriculum.creditsLabel);
  assert.equal(vi.lecturerAttendance.savedSuccessSingular, vi.lecturerAttendance.savedSuccess);

  assert.match(read('src/app/dashboard/register/page.tsx'), /countLabel\(/);
  assert.match(read('src/app/dashboard/curriculum/page.tsx'), /countLabel\(/);
  assert.match(read('src/app/dashboard/lecturer/attendance/page.tsx'), /countLabel\(/);
});

function assertCoursework(value, label) {
  assert.match(value, /Coursework/, label);
  assert.doesNotMatch(value, /\bProcess\b|\bIn-Course\b/, label);
}

test('the 50% process component uses one English term on the web and in the CSV', () => {
  const { studentPortalEn, studentPortalVi } = loadTs('src/i18n/messages-student-portal.ts');
  const { teachingPagesEn, teachingPagesVi } = loadTs('src/i18n/messages-teaching-pages.ts');

  assertCoursework(studentPortalEn.grades.tableHeaders.processScore, 'grades table header');
  assertCoursework(studentPortalEn.gradeDetail.processItem, 'grade detail item');
  assertCoursework(studentPortalEn.gradeDetail.componentsTitle, 'grade components title');
  assertCoursework(studentPortalEn.gradeDetail.formula, 'grade formula');
  assertCoursework(teachingPagesEn.gradeEntry.headers.processScore, 'lecturer grade header');
  assertCoursework(teachingPagesEn.gradeEntry.processScoreLabel, 'lecturer grade cell label');
  assert.ok(
    teachingPagesEn.gradeCsv.rosterHeaders.includes('Coursework (50%)'),
    'CSV roster header',
  );

  assert.match(studentPortalVi.grades.tableHeaders.processScore, /Quá trình/);
  assert.match(studentPortalVi.gradeDetail.processItem, /quá trình/);
  assert.match(teachingPagesVi.gradeEntry.headers.processScore, /ĐQT/);
});

test('the enrollment action column has a localized accessible name', () => {
  const { studentPortalEn, studentPortalVi } = loadTs('src/i18n/messages-student-portal.ts');
  const page = read('src/app/dashboard/enrollments/page.tsx');

  assert.equal(studentPortalEn.enrollments.colActions, 'Actions');
  assert.equal(studentPortalVi.enrollments.colActions, 'Tác vụ');
  assert.match(page, /aria-label=\{copy\.colActions\}/);
  assert.doesNotMatch(page, /aria-label="actions"/);
});
