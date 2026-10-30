import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import { fileURLToPath, pathToFileURL } from 'node:url';

const mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const webLib = path.resolve(mobileRoot, '..', 'frontend', 'src', 'lib');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cu-ical-'));

function transpile(file, name, rewrite = (text) => text) {
  const { outputText } = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    fileName: `${name}.ts`,
  });
  const out = path.join(tmp, `${name}.mjs`);
  fs.writeFileSync(out, rewrite(outputText));
  return out;
}

transpile(path.join(webLib, 'enrollment-status.ts'), 'enrollment-status');
const webFile = transpile(path.join(webLib, 'ical-generator.ts'), 'web-ical', (text) => text.replace("'./enrollment-status'", "'./enrollment-status.mjs'"));
const mobileFile = transpile(path.join(mobileRoot, 'src', 'screens', 'academic', 'ical-export.ts'), 'mobile-ical');
const web = await import(pathToFileURL(webFile).href);
const mobile = await import(pathToFileURL(mobileFile).href);

const NOW = Date.UTC(2026, 8, 1, 3, 4, 5);
const strip = (ics) => ics.split('\r\n').filter((line) => !line.startsWith('DTSTAMP:')).join('\r\n');

const semester = { id: 's1', name: 'HK1', startDate: '2026-09-01', endDate: '2026-12-31' };
const lecturer = { fullName: 'Nguyễn Văn An' };

// Shared fixtures: both generators must produce identical events and documents.
const fixtures = {
  basic: [
    {
      id: 'e1', status: 'ENROLLED',
      section: {
        sectionNumber: '01',
        course: { code: 'CS204', name: 'Software Architecture', nameEn: 'Software Architecture', nameVi: 'Kiến trúc phần mềm', credits: 3 },
        lecturer,
        schedules: [
          { id: 'sch-1', dayOfWeek: 2, startTime: '07:30', endTime: '09:00', classroom: { building: 'A2', roomNumber: '204' } },
          { id: 'sch-2', dayOfWeek: 6, startTime: '13:00:00', endTime: '15:30:00' },
        ],
      },
    },
  ],
  sundayAndLegacyZero: [
    { id: 'e2', status: 'CONFIRMED', section: { sectionNumber: '02', course: { code: 'MA101', name: 'Calculus, I; part' }, schedules: [{ dayOfWeek: 1, startTime: '08:00', endTime: '09:30' }, { dayOfWeek: 0, startTime: '10:00', endTime: '11:30' }] } },
  ],
  completedKept: [
    { id: 'e3', status: 'COMPLETED', section: { sectionNumber: '03', course: { code: 'PH101' }, lecturer: { user: { firstName: 'An', lastName: 'Trần' } }, schedules: [{ dayOfWeek: 7, startTime: '07:00', endTime: '08:30', classroom: { roomNumber: 'B1' } }] } },
  ],
  droppedAndEmptySkipped: [
    { id: 'e4', status: 'DROPPED', section: { sectionNumber: '04', course: { code: 'XX1' }, schedules: [{ dayOfWeek: 3, startTime: '07:00', endTime: '08:00' }] } },
    { id: 'e5', status: 'ENROLLED' },
    { id: 'e6', status: 'ENROLLED', section: { sectionNumber: '06', course: { code: 'XX2' }, schedules: [] } },
  ],
  missingTimes: [
    { id: 'e7', status: 'PENDING', section: { sectionNumber: '07', course: { code: 'YY1', credits: 0 }, schedules: [{ dayOfWeek: 4 }] } },
  ],
};

for (const locale of ['vi', 'en']) {
  for (const [name, enrollments] of Object.entries(fixtures)) {
    test(`events and calendar match the web generator: ${name} (${locale})`, () => {
      const webEvents = web.buildScheduleIcsEvents(enrollments, semester, locale);
      const mobileEvents = mobile.buildScheduleIcsEvents(enrollments, semester, locale, NOW);
      assert.deepEqual(mobileEvents, webEvents);
      assert.equal(strip(mobile.generateIcsCalendar(mobileEvents, 'CampusUTE Timetable', NOW)), strip(web.generateIcsCalendar(webEvents, 'CampusUTE Timetable')));
    });
  }
}

test('open-ended term without dates anchors on Vietnam today and has no recurrence end', () => {
  const realNow = Date.now;
  Date.now = () => NOW;
  try {
    const webEvents = web.buildScheduleIcsEvents(fixtures.basic, undefined, 'vi');
    const mobileEvents = mobile.buildScheduleIcsEvents(fixtures.basic, undefined, 'vi', NOW);
    assert.deepEqual(mobileEvents, webEvents);
    assert.equal(mobileEvents[0].rrule, undefined);
  } finally {
    Date.now = realNow;
  }
});

test('Vietnam civil dates do not shift with the device time zone', () => {
  const [monday] = mobile.buildScheduleIcsEvents(fixtures.basic, semester, 'vi', NOW);
  assert.equal(monday.dtstart, '20260907T073000');
  assert.equal(monday.dtend, '20260907T090000');
  assert.equal(monday.rrule, 'FREQ=WEEKLY;UNTIL=20261231T165959Z');
  assert.equal(monday.location, 'Phòng 204, A2');
});

test('document structure is RFC 5545 with CRLF endings and escaped text', () => {
  const events = mobile.buildScheduleIcsEvents(fixtures.sundayAndLegacyZero, semester, 'en', NOW);
  const ics = mobile.generateIcsCalendar(events, 'My, Timetable', NOW);
  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n'));
  assert.ok(ics.endsWith('END:VCALENDAR\r\n'));
  assert.equal(ics.includes('\n') && ics.split('\n').every((line, index, all) => index === all.length - 1 || line.endsWith('\r')), true);
  assert.match(ics, /X-WR-CALNAME:My\\, Timetable/);
  assert.match(ics, /SUMMARY:\[MA101\] Calculus\\, I\\; part - 02/);
  assert.match(ics, /DTSTAMP:20260901T030405Z/);
  assert.equal((ics.match(/BEGIN:VEVENT/g) ?? []).length, 2);
  assert.equal(mobile.escapeIcsText('A\\B;C,D\nE'), 'A\\\\B\\;C\\,D\\nE');
});

test('export bundle reports the event count and a data URI for the file adapter', () => {
  const bundle = mobile.buildTimetableExport(fixtures.basic, semester, 'vi', 'Lịch học', NOW);
  assert.equal(bundle.eventCount, 2);
  assert.equal(bundle.filename, 'campusute-timetable.ics');
  const uri = mobile.icsDataUri(bundle.content);
  assert.ok(uri.startsWith('data:text/calendar;charset=utf-8,'));
  assert.equal(decodeURIComponent(uri.slice(uri.indexOf(',') + 1)), bundle.content);
  assert.equal(mobile.buildTimetableExport([], semester, 'vi', 'x', NOW).eventCount, 0);
});

test('the port stays free of DOM access', () => {
  const source = fs.readFileSync(path.join(mobileRoot, 'src', 'screens', 'academic', 'ical-export.ts'), 'utf8');
  assert.doesNotMatch(source, /document\.|window\.|Blob|createObjectURL/);
  assert.doesNotMatch(source, /\.getDay\(\)|\.setDate\(|setHours\(/);
});
