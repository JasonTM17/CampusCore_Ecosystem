import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import { fileURLToPath, pathToFileURL } from 'node:url';

const mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const webLib = path.resolve(mobileRoot, '..', 'frontend', 'src', 'lib');
const academic = path.join(mobileRoot, 'src', 'screens', 'academic');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cu-academic-'));

async function load(file, name) {
  const source = fs.readFileSync(file, 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    fileName: `${name}.ts`,
  });
  const out = path.join(tmp, `${name}.mjs`);
  fs.writeFileSync(out, outputText);
  return import(pathToFileURL(out).href);
}

const gpa = await load(path.join(academic, 'gpa.ts'), 'gpa');
const model = await load(path.join(academic, 'academic-model.ts'), 'academic-model');
const browse = await load(path.join(academic, 'registration-browse.ts'), 'registration-browse');
const basket = await load(path.join(academic, 'registration-basket.ts'), 'registration-basket');
const attempts = await load(path.join(academic, 'idempotency-attempts.ts'), 'idempotency-attempts');
const webScale = await load(path.join(webLib, 'grade-scale.ts'), 'web-grade-scale');
const webCharts = await load(path.join(webLib, 'transcript-charts.ts'), 'web-transcript-charts');
const webBrowse = await load(path.join(webLib, 'registration-browse.ts'), 'web-registration-browse');

const record = (courseCode, credits, letterGrade, finalGrade, extra = {}) => ({
  id: `${courseCode}-${letterGrade}`,
  courseCode,
  courseName: courseCode,
  credits,
  letterGrade,
  finalGrade,
  gradeStatus: 'PUBLISHED',
  enrollmentStatus: 'COMPLETED',
  ...extra,
});

test('score bands convert to the official letter and 4.0 point', () => {
  const cases = [[10, 'A+', 4], [9, 'A+', 4], [8.9, 'A', 4], [8.5, 'A', 4], [8.4, 'B+', 3.5], [7, 'B', 3], [6.5, 'C+', 2.5], [5.5, 'C', 2], [5, 'D+', 1.5], [4, 'D', 1], [3.9, 'F', 0]];
  for (const [score, letter, point] of cases) {
    assert.equal(gpa.letterFromScore(score), letter, `letter for ${score}`);
    assert.equal(gpa.pointFromScore(score), point, `point for ${score}`);
    assert.equal(webScale.letterFromScore(score), letter, `web letter for ${score}`);
  }
});

test('scale rows list every band without overlapping display ranges', () => {
  const rows = gpa.gradeScaleRows();
  assert.equal(rows.length, 9);
  assert.deepEqual(rows[0], { letter: 'A+', range: '9.0 - 10.0', point: '4.0' });
  assert.deepEqual(rows[1], { letter: 'A', range: '8.5 - 8.9', point: '4.0' });
  assert.deepEqual(rows.at(-1), { letter: 'F', range: '0.0 - 3.9', point: '0.0' });
});

test('grade point prefers the server value, then the letter, then the score', () => {
  assert.equal(gpa.resolveGradePoint({ gradePoint: 3.2, letterGrade: 'A' }), 3.2);
  assert.equal(gpa.resolveGradePoint({ letterGrade: 'B+' }), 3.5);
  assert.equal(gpa.resolveGradePoint({ finalGrade: 7.2 }), 3);
  assert.equal(gpa.resolveGradePoint({}), null);
});

test('GPA is credit weighted and skips records without credits or a point', () => {
  const records = [record('MA101', 3, 'A', 8.7), record('PH101', 2, 'C', 6), record('XX000', 0, 'A', 9), record('NG100', 3, null, null)];
  assert.equal(gpa.computeGpa4(records), (4 * 3 + 2 * 2) / 5);
  assert.equal(gpa.computeGpa4([]), null);
  assert.equal(webScale.computeGpa4(records.slice(0, 2)), gpa.computeGpa4(records.slice(0, 2)));
  assert.equal(gpa.computeAverage10(records), (8.7 * 3 + 6 * 2) / 5);
});

test('best-attempt summary counts a retaken course once and matches the web summary', () => {
  const records = [
    record('MA101', 3, 'F', 3),
    record('MA101', 3, 'B', 7.5),
    record('PH101', 2, 'A', 9.2),
    record('CS101', 4, 'D', 4.5),
  ];
  const mine = gpa.summarizeBestAttempts(records);
  const web = webScale.summarizeGrades(records.map((entry) => ({ ...entry, semesterId: 's', semester: 's', sectionCode: 'x', lecturerName: null, processScore: null, finalExamScore: null })));
  assert.equal(mine.countedCourses, 3);
  assert.equal(mine.gpa.toFixed(2), web.gpa);
  assert.equal(mine.completedCredits, web.completedCredits);
  assert.equal(mine.completedCredits, 9);
});

test('published filter keeps only published grades', () => {
  const rows = [record('A', 3, 'A', 9), record('B', 3, 'B', 7, { gradeStatus: 'DRAFT' }), record('C', 3, null, null, { gradeStatus: 'NOT_GRADED' })];
  assert.deepEqual(gpa.publishedOnly(rows).map((row) => row.courseCode), ['A']);
});

const transcriptPayload = {
  summary: { cumulativeGpa: 3.42, totalCreditsEarned: 14, totalCreditsAttempted: 16, basisNote: { vi: 'Tính theo lần học tốt nhất', en: 'Best-attempt basis' } },
  semesters: [
    { semesterId: 's2', semesterName: 'HK2', semesterNameEn: 'Spring', semesterNameVi: 'Học kỳ 2', gpa: 3.6, creditsEarned: 8, creditsAttempted: 8, records: [record('CS101', 4, 'A', 9), record('CS102', 4, 'B', 7.5)] },
    { semesterId: 's1', semesterName: 'HK1', gpa: 3.0, creditsEarned: 6, creditsAttempted: 8, records: [record('MA101', 3, 'B', 7.2), record('PH101', 2, 'C', 6)] },
  ],
};

test('transcript payload normalises names, summary and the basis note per locale', () => {
  const vi = gpa.parseTranscript(transcriptPayload, 'vi');
  assert.equal(vi.cumulativeGpa, 3.42);
  assert.equal(vi.totalCreditsEarned, 14);
  assert.equal(vi.basisNote, 'Tính theo lần học tốt nhất');
  assert.equal(vi.terms[0].name, 'Học kỳ 2');
  assert.equal(vi.terms[1].name, 'HK1');
  assert.equal(gpa.parseTranscript(transcriptPayload, 'en').terms[0].name, 'Spring');
  assert.equal(gpa.parseTranscript(transcriptPayload, 'en').basisNote, 'Best-attempt basis');
});

test('transcript without a server summary falls back to the best-attempt GPA', () => {
  const parsed = gpa.parseTranscript({ semesters: transcriptPayload.semesters }, 'en');
  assert.ok(Math.abs(parsed.cumulativeGpa - gpa.summarizeBestAttempts(transcriptPayload.semesters.flatMap((term) => term.records)).gpa) < 1e-9);
  assert.equal(parsed.totalCreditsAttempted, 16);
});

test('a payload that is not a transcript is rejected instead of rendered', () => {
  assert.equal(gpa.parseTranscript(null), null);
  assert.equal(gpa.parseTranscript({}), null);
  assert.equal(gpa.parseTranscript({ semesters: 'x' }), null);
});

test('cumulative trend is chronological, ends on the server value and matches the web series', () => {
  const parsed = gpa.parseTranscript(transcriptPayload, 'vi');
  const mine = gpa.cumulativeTrend(parsed.terms, parsed.cumulativeGpa, 'HK');
  assert.deepEqual(mine.map((point) => point.label), ['HK1', 'HK2']);
  assert.equal(mine.at(-1).value, 3.42);
  const web = webCharts.buildCumulativeGpaTrendPoints(transcriptPayload.semesters, 'vi', 3.42);
  assert.deepEqual(mine.map((point) => point.value), web.map((point) => point.gpa));
});

/* ---------- enrollments and timetable ---------- */

const enrollment = (id, status, semesterId, extra = {}) => ({ id, sectionId: `sec-${id}`, semesterId, status, ...extra });

test('enrollment history is split into active, past and withdrawn - not only ENROLLED', () => {
  const rows = [
    enrollment('1', 'ENROLLED', 's2'), enrollment('2', 'PENDING', 's2'), enrollment('3', 'CONFIRMED', 's2'),
    enrollment('4', 'COMPLETED', 's1'), enrollment('5', 'DROPPED', 's2'), enrollment('6', 'CANCELLED', 's1'),
  ];
  assert.deepEqual(model.filterEnrollments(rows, 'active', null).map((row) => row.id), ['1', '2', '3']);
  assert.deepEqual(model.filterEnrollments(rows, 'past', null).map((row) => row.id), ['4']);
  assert.deepEqual(model.filterEnrollments(rows, 'withdrawn', null).map((row) => row.id), ['5', '6']);
  assert.deepEqual(model.filterEnrollments(rows, 'withdrawn', 's2').map((row) => row.id), ['5']);
  assert.deepEqual(model.tabCounts(rows, null), { active: 3, past: 1, withdrawn: 2 });
  assert.equal(model.isDroppableEnrollment('PENDING'), true);
  assert.equal(model.isDroppableEnrollment('CONFIRMED'), false);
});

test('terms merge the semester list with terms seen only on enrollments, newest first', () => {
  const semesters = [{ id: 's1', name: 'HK1', startDate: '2026-01-05' }, { id: 's2', name: 'HK2', nameVi: 'Học kỳ 2', startDate: '2026-06-01', status: 'IN_PROGRESS' }];
  const options = model.termOptions([enrollment('1', 'ENROLLED', 's0', { semester: { name: 'Old term' } })], semesters, 'vi');
  assert.deepEqual(options.map((option) => option.value), ['s2', 's1', 's0']);
  assert.equal(options[0].label, 'Học kỳ 2');
  assert.equal(options[2].label, 'Old term');
  assert.equal(model.defaultTermId(semesters, []), 's2');
  assert.equal(model.defaultTermId([], [enrollment('1', 'ENROLLED', 's9')]), 's9');
});

const sectionWith = (schedules) => ({ sectionNumber: '01', course: { code: 'CS101', nameVi: 'Nhập môn', credits: 3 }, schedules });

test('agenda covers active and completed courses, normalises Sunday and sorts Monday first', () => {
  const rows = [
    enrollment('1', 'ENROLLED', 's2', { section: sectionWith([{ dayOfWeek: 0, startTime: '08:00', endTime: '09:30' }, { dayOfWeek: 2, startTime: '13:00', endTime: '14:30', classroom: { building: 'A2', roomNumber: '204' } }]) }),
    enrollment('2', 'DROPPED', 's2', { section: sectionWith([{ dayOfWeek: 3, startTime: '07:00', endTime: '08:00' }]) }),
  ];
  const agenda = model.buildAgenda(rows, 'vi');
  assert.deepEqual(agenda.map((item) => [item.dayOfWeek, item.startTime]), [[2, '13:00'], [1, '08:00']]);
  assert.equal(agenda[0].room, 'A2 204');
  assert.equal(agenda[0].courseName, 'Nhập môn');
});

test('week dates are Monday first and respect the term window', () => {
  const wednesday = new Date(2026, 8, 2);
  const start = model.weekStartOf(wednesday);
  assert.equal(model.civilKey(start), '2026-08-31');
  assert.equal(model.civilKey(model.weekStartOf(wednesday, 1)), '2026-09-07');
  const days = model.weekDates(start);
  assert.equal(days.length, 7);
  assert.equal(model.civilKey(days[6]), '2026-09-06');
  const agenda = [{ id: 'a', dayOfWeek: 4, startTime: '08:00', endTime: '09:00' }];
  assert.equal(model.agendaForDate(agenda, wednesday, null).length, 1);
  assert.equal(model.agendaForDate(agenda, wednesday, { startDate: '2026-09-07', endDate: '2026-12-20' }).length, 0);
  assert.equal(model.agendaForDate(agenda, wednesday, { startDate: '2026-08-01', endDate: '2026-12-20' }).length, 1);
  assert.equal(model.agendaForDate(agenda, new Date(2026, 8, 3), null).length, 0);
});

/* ---------- registration browse ---------- */

const section = (id, courseCode, overrides = {}) => ({
  id, sectionNumber: '01', courseId: `c-${courseCode}`, courseCode, courseName: `Course ${courseCode}`, credits: 3,
  capacity: 40, enrolledCount: 10, remainingSeats: 30, status: 'OPEN', scheduleConflict: false, alreadyEnrolled: false, ...overrides,
});

test('search ignores Vietnamese diacritics and matches lecturer and room', () => {
  const target = section('1', 'CS201', { courseName: 'Điện toán đám mây', schedules: [{ dayOfWeek: 2, startTime: '07:00', endTime: '09:00', room: 'B1.108', lecturer: 'Nguyễn Văn An' }] });
  assert.equal(browse.matchesSectionSearch(target, 'dien toan'), true);
  assert.equal(browse.matchesSectionSearch(target, 'nguyen an'), true);
  assert.equal(browse.matchesSectionSearch(target, 'b1.108'), true);
  assert.equal(browse.matchesSectionSearch(target, 'physics'), false);
  assert.equal(webBrowse.matchesSectionSearch(target, 'dien toan'), true);
});

test('browse filters, hides full sections and sorts by code, credits or seats', () => {
  const rows = [
    section('1', 'CS300', { credits: 2, remainingSeats: 5, curriculumRelevance: 'ELECTIVE' }),
    section('2', 'CS100', { credits: 4, remainingSeats: 0, curriculumRelevance: 'MANDATORY' }),
    section('3', 'CS200', { credits: 3, remainingSeats: 20, curriculumRelevance: 'MANDATORY' }),
  ];
  const base = { search: '', curriculum: 'ALL', hideFull: false, sort: 'code' };
  assert.deepEqual(browse.browseSections(rows, base).map((group) => group.courseCode), ['CS100', 'CS200', 'CS300']);
  assert.deepEqual(browse.browseSections(rows, { ...base, sort: 'credits' }).map((group) => group.courseCode), ['CS100', 'CS200', 'CS300']);
  assert.deepEqual(browse.browseSections(rows, { ...base, sort: 'seats' }).map((group) => group.courseCode), ['CS200', 'CS300', 'CS100']);
  assert.deepEqual(browse.browseSections(rows, { ...base, hideFull: true }).map((group) => group.courseCode), ['CS200', 'CS300']);
  assert.deepEqual(browse.browseSections(rows, { ...base, curriculum: 'MANDATORY' }).map((group) => group.courseCode), ['CS100', 'CS200']);
});

test('seat tiers and overlap rules match the web helpers', () => {
  for (const [remaining, capacity] of [[0, 40], [5, 40], [20, 40], [3, 0]]) {
    assert.equal(browse.seatTier({ remainingSeats: remaining, capacity }), webBrowse.seatTier({ remainingSeats: remaining, capacity }));
  }
  const monday = { dayOfWeek: 2, startTime: '07:00', endTime: '09:00' };
  assert.equal(browse.meetingsOverlap(monday, { dayOfWeek: 2, startTime: '08:30', endTime: '10:00' }), true);
  assert.equal(browse.meetingsOverlap(monday, { dayOfWeek: 2, startTime: '09:00', endTime: '10:00' }), false);
  assert.equal(browse.meetingsOverlap(monday, { dayOfWeek: 3, startTime: '07:00', endTime: '09:00' }), false);
  assert.equal(browse.meetingsOverlap({ dayOfWeek: 0, startTime: '07:00', endTime: '09:00' }, { dayOfWeek: 1, startTime: '08:00', endTime: '10:00' }), true);
});

test('availability reports the reason a section cannot be selected, in priority order', () => {
  const open = { roundOpen: true, creditsRemaining: 10 };
  assert.equal(browse.sectionAvailability(section('1', 'A'), open), 'open');
  assert.equal(browse.sectionAvailability(section('1', 'A', { alreadyEnrolled: true }), open), 'enrolled');
  assert.equal(browse.sectionAvailability(section('1', 'A'), { ...open, roundOpen: false }), 'closed');
  assert.equal(browse.sectionAvailability(section('1', 'A', { status: 'CLOSED' }), open), 'closed');
  assert.equal(browse.sectionAvailability(section('1', 'A', { remainingSeats: 0 }), open), 'full');
  assert.equal(browse.sectionAvailability(section('1', 'A', { scheduleConflict: true }), open), 'conflict');
  const clash = section('1', 'A', { schedules: [{ dayOfWeek: 2, startTime: '08:00', endTime: '10:00' }] });
  assert.equal(browse.sectionAvailability(clash, { ...open, enrolledMeetings: [{ dayOfWeek: 2, startTime: '09:00', endTime: '11:00' }] }), 'conflict');
  assert.equal(browse.sectionAvailability(section('1', 'A', { credits: 4 }), { ...open, creditsRemaining: 3 }), 'creditLimit');
  assert.equal(browse.canSelect('open'), true);
  assert.equal(browse.canSelect('conflict'), false);
});

test('backend registration error codes map to copy keys', () => {
  assert.equal(browse.registrationErrorKey('SCHEDULE_CONFLICT'), 'scheduleConflict');
  assert.equal(browse.registrationErrorKey('IDEMPOTENCY_KEY_REUSED'), 'idempotencyRetry');
  assert.equal(browse.registrationErrorKey('UNKNOWN'), null);
  assert.equal(browse.registrationErrorKey(undefined), null);
});

/* ---------- selection and idempotency ---------- */

test('a conflict keeps the selection and its reason; success and toggle remove it', () => {
  let state = basket.emptyBasket;
  state = basket.basketReducer(state, { type: 'toggle', sectionId: 'a' });
  state = basket.basketReducer(state, { type: 'toggle', sectionId: 'b' });
  state = basket.basketReducer(state, { type: 'fail', sectionId: 'a', failure: { code: 'SCHEDULE_CONFLICT', messageKey: 'scheduleConflict' } });
  assert.deepEqual(state.selected, ['a', 'b']);
  assert.equal(state.failures.a.code, 'SCHEDULE_CONFLICT');
  state = basket.basketReducer(state, { type: 'succeed', sectionId: 'b' });
  assert.deepEqual(state.selected, ['a']);
  assert.equal(state.failures.a.messageKey, 'scheduleConflict');
  state = basket.basketReducer(state, { type: 'toggle', sectionId: 'a' });
  assert.deepEqual(state.selected, []);
  assert.deepEqual(state.failures, {});
});

test('pruning drops selections that left the catalog but keeps the rest untouched', () => {
  let state = basket.basketReducer(basket.emptyBasket, { type: 'toggle', sectionId: 'a' });
  state = basket.basketReducer(state, { type: 'toggle', sectionId: 'b' });
  state = basket.basketReducer(state, { type: 'fail', sectionId: 'b', failure: { code: null, messageKey: 'generic' } });
  const pruned = basket.basketReducer(state, { type: 'prune', validIds: ['b'] });
  assert.deepEqual(pruned.selected, ['b']);
  assert.ok(pruned.failures.b);
});

test('an attempt reuses one idempotency key until a definitive answer', () => {
  let counter = 0;
  const keys = attempts.createAttemptKeys(() => `key-${++counter}`);
  const first = keys.keyFor('enroll', 'sec-1');
  assert.equal(keys.keyFor('enroll', 'sec-1'), first);
  keys.settle('enroll', 'sec-1', { status: 0 });
  assert.equal(keys.keyFor('enroll', 'sec-1'), first, 'network loss keeps the key');
  keys.settle('enroll', 'sec-1', { status: 503 });
  assert.equal(keys.keyFor('enroll', 'sec-1'), first, 'server error keeps the key');
  keys.settle('enroll', 'sec-1', new TypeError('Network request failed'));
  assert.equal(keys.keyFor('enroll', 'sec-1'), first, 'transport failure keeps the key');
  keys.settle('enroll', 'sec-1', { status: 409, code: 'SCHEDULE_CONFLICT' });
  assert.notEqual(keys.keyFor('enroll', 'sec-1'), first, 'a definitive conflict ends the attempt');
  const second = keys.keyFor('enroll', 'sec-1');
  keys.settle('enroll', 'sec-1');
  assert.equal(keys.has('enroll', 'sec-1'), false, 'success ends the attempt');
  assert.notEqual(keys.keyFor('enroll', 'sec-1'), second);
  assert.notEqual(keys.keyFor('drop', 'sec-1'), keys.keyFor('enroll', 'sec-1'));
});

test('an in-flight duplicate keeps the key so the retry deduplicates', () => {
  assert.equal(attempts.isOutcomeUnknown({ status: 409, code: 'IDEMPOTENCY_IN_PROGRESS' }), true);
  assert.equal(attempts.isOutcomeUnknown({ status: 422, code: 'SECTION_FULL' }), false);
  assert.equal(attempts.isOutcomeUnknown(undefined), false);
});
