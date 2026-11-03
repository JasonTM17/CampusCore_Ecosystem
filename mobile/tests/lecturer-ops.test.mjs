import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createWebModuleLoader } from './helpers/load-web-module.mjs';

const mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const webLib = path.resolve(mobileRoot, '..', 'frontend', 'src', 'lib');
const webSrc = path.resolve(mobileRoot, '..', 'frontend', 'src');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cu-lecturer-'));
const loadWeb = createWebModuleLoader(webSrc, tmp);

async function load(file, name, development, rewrites = {}) {
  let source = fs.readFileSync(file, 'utf8');
  for (const [from, to] of Object.entries(rewrites)) source = source.split(`'${from}'`).join(`'${to}'`);
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    fileName: `${name}.ts`,
  });
  const out = path.join(tmp, `${name}.mjs`);
  fs.writeFileSync(out, outputText);
  const previousDev = globalThis.__DEV__;
  if (development !== undefined) globalThis.__DEV__ = development;
  try {
    return await import(pathToFileURL(out).href);
  } finally {
    if (development !== undefined) {
      if (previousDev === undefined) delete globalThis.__DEV__;
      else globalThis.__DEV__ = previousDev;
    }
  }
}

const ops = path.join(mobileRoot, 'src', 'screens', 'operations');
const localeUrl = pathToFileURL(path.join(tmp, 'locale.mjs')).href;
const locale = await load(path.join(mobileRoot, 'src', 'i18n', 'locale.ts'), 'locale');
const model = await load(path.join(ops, 'lecturer-model.ts'), 'lecturer-model', undefined, { '../../i18n/locale': localeUrl });
const csv = await load(path.join(ops, 'lecturer-csv.ts'), 'lecturer-csv');
const portal = await load(path.join(ops, 'shared', 'portal-url.ts'), 'portal-url');
const portalDevelopment = await load(path.join(ops, 'shared', 'portal-url.ts'), 'portal-url-development', true);
const portalRelease = await load(path.join(ops, 'shared', 'portal-url.ts'), 'portal-url-release', false);
const opsMessages = await load(path.join(mobileRoot, 'src', 'i18n', 'operations-messages.ts'), 'operations-messages');
const laneMessages = await load(path.join(mobileRoot, 'src', 'i18n', 'lanes-messages.ts'), 'lanes-messages');
const webAttendance = await import(pathToFileURL(loadWeb(path.join(webLib, 'attendance-export.ts'))).href);
const webGrade = await import(pathToFileURL(loadWeb(path.join(webLib, 'grade-export.ts'))).href);

const roster = [
  { studentId: 's1', studentCode: '2110001', firstName: 'An', lastName: 'Nguyễn' },
  { studentId: 's2', studentCode: '2110002', firstName: 'Bình', lastName: 'Trần' },
  { studentId: 's3', studentCode: '2110003', firstName: 'Cúc', lastName: 'Lê, "Hoa"' },
];

test('attendance csv matches the web generator byte for byte', () => {
  const students = [
    { studentId: 's1', studentCode: '2110001', studentName: 'Nguyễn An', status: 'PRESENT' },
    { studentId: 's2', studentCode: '2110002', studentName: 'Trần Bình', status: 'LATE', notes: 'Trễ 10 phút' },
    { studentId: 's3', studentCode: '2110003', studentName: 'Lê, "Hoa" Cúc', status: null },
  ];
  const metrics = { total: 3, present: 1, absent: 0, late: 1, excused: 0, rate: 66.7 };
  for (const locale of ['vi', 'en']) {
    const options = { sectionNumber: '01', courseCode: 'CS101', courseName: 'Nhập môn', date: '2026-10-28', lecturerName: 'Cô A', semesterName: 'HK1', metrics, students, locale };
    const mine = csv.generateAttendanceCsv(options);
    assert.equal(mine, webAttendance.generateAttendanceCsv(options), `attendance ${locale}`);
    assert.ok(mine.startsWith('﻿'), 'BOM for Excel');
    assert.ok(mine.includes('\r\n'), 'CRLF rows');
  }
});

test('grade csv, summary and letter scale match the web generator', () => {
  const students = [
    { studentId: 's1', studentCode: '2110001', studentName: 'Nguyễn An', email: 'an@x.edu', processScore: 9, finalExamScore: 9 },
    { studentId: 's2', studentCode: '2110002', studentName: 'Trần Bình', processScore: 4, finalExamScore: 3 },
    { studentId: 's3', studentCode: '2110003', studentName: 'Lê Cúc', processScore: null, finalExamScore: null },
  ];
  for (const score of [10, 9, 8.9, 8.5, 8, 7, 6.5, 5.5, 5, 4, 3.9, 0]) {
    assert.equal(csv.calculateGrade(score), webGrade.calculateGrade(score), `letter ${score}`);
  }
  assert.equal(csv.calculateTotalScore(7, 8), webGrade.calculateTotalScore(7, 8));
  assert.equal(csv.calculateTotalScore(null, 8), webGrade.calculateTotalScore(null, 8));
  assert.deepEqual(csv.computeGradeSummary(students), webGrade.computeGradeSummary(students));
  for (const locale of ['vi', 'en']) {
    const options = { sectionNumber: '01', courseCode: 'CS101', courseName: 'Nhập môn', semesterName: 'HK1', lecturerName: 'Cô A', students, locale };
    assert.equal(csv.generateGradeCsv(options), webGrade.generateGradeCsv(options), `grades ${locale}`);
  }
  assert.equal(csv.escapeCsvField('a,"b"\nc'), webAttendance.escapeCsvField('a,"b"\nc'));
});

test('escapeCsvField neutralizes formula characters preceded by line breaks', () => {
  assert.equal(
    csv.escapeCsvField('\n=HYPERLINK("https://attacker.example","Review")'),
    '"\'\n=HYPERLINK(""https://attacker.example"",""Review"")"',
  );
  assert.equal(csv.escapeCsvField('\r\n+1234'), '"\'\r\n+1234"');
  assert.equal(csv.escapeCsvField('\n-5'), '"\'\n-5"');
  assert.equal(csv.escapeCsvField('\n@SUM(1,2)'), '"\'\n@SUM(1,2)"');
  assert.equal(csv.escapeCsvField('\n\t123'), '"\'\n\t123"');
});

test('csv file names and data uri carry no path separators', () => {
  assert.equal(csv.attendanceCsvFilename('01', '2026-10-28'), 'diem-danh-01-2026-10-28.csv');
  assert.equal(csv.gradeCsvFilename('CS101', '01', '2026-10-28'), 'Bang_diem_CS101_Lop_01_2026-10-28.csv');
  assert.ok(csv.csvDataUri('a,b').startsWith('data:text/csv;charset=utf-8,'));
});

test('unmarked students stay unmarked and only marked rows are saved', () => {
  const rows = model.buildRosterRows(roster, [{ studentId: 's1', status: 'PRESENT' }]);
  assert.deepEqual(rows.map((row) => row.status), ['PRESENT', null, null]);
  assert.deepEqual(model.buildAttendanceRecords(rows), [{ studentId: 's1', status: 'PRESENT' }]);
});

test('a mark cleared after it was stored is sent as RESET', () => {
  let rows = model.buildRosterRows(roster, [{ studentId: 's1', status: 'PRESENT' }, { studentId: 's2', status: 'ABSENT' }]);
  rows = model.setRowStatus(rows, 's2', null);
  assert.deepEqual(model.buildAttendanceRecords(rows), [
    { studentId: 's1', status: 'PRESENT' },
    { studentId: 's2', status: 'RESET' },
  ]);
  const saved = model.commitRows(rows);
  assert.deepEqual(model.buildAttendanceRecords(saved), [{ studentId: 's1', status: 'PRESENT' }]);
});

test('stale attendance is detected when the server marks or roster changed', () => {
  const marks = [{ studentId: 's1', status: 'PRESENT' }];
  const baseline = model.baselineOf(roster, marks);
  assert.equal(model.isStaleAttendance(baseline, roster, marks), false);
  assert.equal(model.isStaleAttendance(baseline, roster, [{ studentId: 's1', status: 'ABSENT' }]), true);
  assert.equal(model.isStaleAttendance(baseline, roster, [...marks, { studentId: 's2', status: 'LATE' }]), true);
  assert.equal(model.isStaleAttendance(baseline, roster.slice(1), marks), true);
});

test('a note-only server edit makes the attendance sheet stale', () => {
  const marks = [{ studentId: 's1', status: 'EXCUSED', notes: 'sick' }];
  const baseline = model.baselineOf(roster, marks);
  assert.equal(model.isStaleAttendance(baseline, roster, marks), false);
  assert.equal(
    model.isStaleAttendance(baseline, roster, [{ studentId: 's1', status: 'EXCUSED', notes: 'medical leave' }]),
    true,
    'a note edited elsewhere is a newer server state',
  );
  assert.equal(
    model.isStaleAttendance(baseline, roster, [{ studentId: 's1', status: 'EXCUSED', notes: ' sick ' }]),
    false,
    'surrounding whitespace is not an edit',
  );

  const saved = model.savedBaseline(model.buildRosterRows(roster, marks));
  assert.equal(
    model.isStaleAttendance(saved, roster, [{ studentId: 's1', status: 'EXCUSED', notes: 'medical leave' }]),
    true,
    'the baseline after a save still tracks notes',
  );
});

test('the attendance day is the fixed UTC+07 campus day', () => {
  assert.equal(typeof locale.campusIsoDate, 'function', 'a campus-day helper exists');
  assert.equal(locale.campusIsoDate(new Date('2026-11-02T23:30:00Z')), '2026-11-03');
  assert.equal(locale.campusIsoDate(new Date('2026-11-03T16:59:59Z')), '2026-11-03');
  assert.equal(locale.campusIsoDate(new Date('2026-11-03T17:00:00Z')), '2026-11-04');

  const screen = fs.readFileSync(path.join(ops, 'LecturerAttendanceScreen.tsx'), 'utf8');
  assert.match(screen, /const today = campusIsoDate\(\);/);
  assert.doesNotMatch(screen, /localIsoDate/);
});

test('grade CSV file names follow the fixed UTC+07 campus day', () => {
  const screen = fs.readFileSync(path.join(ops, 'LecturerGradingScreen.tsx'), 'utf8');
  assert.match(screen, /gradeCsvFilename\([^)]*campusIsoDate\(\)/);
  assert.doesNotMatch(screen, /localIsoDate/);
});

test('lecturer today follows the fixed UTC+07 campus day', () => {
  const getDay = Date.prototype.getDay;
  Date.prototype.getDay = Date.prototype.getUTCDay;
  try {
    assert.equal(model.dayNumberOf(new Date('2026-11-02T23:00:00Z')), 3);
    assert.equal(model.dayNumberOf(new Date('2026-11-03T16:59:00Z')), 3);
    assert.equal(model.dayNumberOf(new Date('2026-11-03T17:00:00Z')), 4);
  } finally {
    Date.prototype.getDay = getDay;
  }
});

test('attendance metrics use present plus late over the whole roster', () => {
  let rows = model.buildRosterRows(roster, []);
  rows = model.setRowStatus(rows, 's1', 'PRESENT');
  rows = model.setRowStatus(rows, 's2', 'LATE');
  const metrics = model.attendanceMetrics(rows);
  assert.equal(metrics.total, 3);
  assert.equal(metrics.unmarked, 1);
  assert.ok(Math.abs(metrics.rate - (2 / 3) * 100) < 1e-9);
  const filtered = model.filterRoster(rows, 'tran');
  assert.deepEqual(filtered.map((row) => row.studentId), ['s2'], 'accent-insensitive search');
});

test('grade drafts send only changed rows and flag invalid input before any request', () => {
  const rows = [
    { enrollmentId: 'e1', processScore: 7, finalExamScore: 8 },
    { enrollmentId: 'e2', processScore: null, finalExamScore: null },
    { enrollmentId: 'e3', processScore: 6, finalExamScore: 6, gradeStatus: 'PUBLISHED' },
    { enrollmentId: 'e4', processScore: 5, finalExamScore: null },
  ];
  const draft = model.buildGradeDraft(rows, {
    e1: { finalExamScore: '9,5' },
    e2: { finalExamScore: '8' },
    e3: { processScore: '1' },
    e4: { processScore: '11' },
  });
  assert.deepEqual(draft.changes, [{ enrollmentId: 'e1', processScore: 7, finalExamScore: 9.5 }]);
  assert.equal(draft.problems.e2.processScore, 'needsProcess');
  assert.equal(draft.problems.e4.processScore, 'invalid');
  assert.equal(draft.problems.e3, undefined, 'published rows are locked');
  assert.equal(model.dirtyGradeCount(rows, { e1: { finalExamScore: '9,5' }, e3: { processScore: '1' } }), 1);
  assert.equal(model.parseScore(''), null);
  assert.equal(model.parseScore('10.5'), undefined);
  assert.equal(model.parseScore('abc'), undefined);
});

test('weekday numbering is 1 = Sunday like the backend', () => {
  assert.equal(model.dayNumberOf(new Date(2026, 9, 25)), 1);
  assert.equal(model.dayNumberOf(new Date(2026, 9, 26)), 2);
  assert.equal(model.normalizeDay(0), 1);
  assert.equal(model.localIsoDate(new Date(2026, 0, 5)), '2026-01-05');
});

test('portal hand-off joins only a fixed same-path onto the configured base', () => {
  assert.equal(portal.portalUrl('/admin/users', 'https://portal.example.edu/'), 'https://portal.example.edu/admin/users');
  for (const bad of ['//evil.com', '/a/../b', '/a?x=1', 'https://evil.com', '', '/a b']) {
    assert.equal(portal.portalUrl(bad, 'https://portal.example.edu'), 'https://portal.example.edu', bad);
  }
});

test('the default portal URL follows the build mode', () => {
  assert.equal(portal.defaultPortalUrl(true), 'https://portal.localhost:3102');
  assert.equal(portal.defaultPortalUrl(false), undefined);
  assert.equal(portal.DEFAULT_PORTAL_URL, undefined);
  assert.equal(portalDevelopment.DEFAULT_PORTAL_URL, 'https://portal.localhost:3102');
  assert.equal(portalRelease.DEFAULT_PORTAL_URL, undefined);
  assert.equal(portal.resolvePortalBaseUrl(undefined, true), 'https://portal.localhost:3102');
  assert.equal(portal.resolvePortalBaseUrl('', false), undefined);
  assert.equal(portal.resolvePortalBaseUrl(undefined, false), undefined);
  assert.equal(portal.resolvePortalBaseUrl('https://portal.example.edu', false), 'https://portal.example.edu');
  assert.equal(portal.portalUrl('/admin/users', undefined), undefined);
});

const keyShape = (value) =>
  Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, item && typeof item === 'object' ? keyShape(item) : typeof item]),
  );

test('operations and lanes copy has the same keys in vi and en', () => {
  for (const messages of [opsMessages.operationsMessages, laneMessages.lanesMessages]) {
    assert.deepEqual(keyShape(messages.vi), keyShape(messages.en));
  }
});

test('operations copy never uses the word operations', () => {
  for (const locale of ['vi', 'en']) {
    const text = JSON.stringify(opsMessages.operationsMessages[locale]).toLowerCase();
    assert.ok(!text.includes('operations'), `${locale} copy`);
  }
});
