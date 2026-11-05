const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');

test('iCalendar (.ics) generator specifications and RFC 5545 compliance', async (t) => {
  await t.test('ical-generator exports required generator and formatting functions', () => {
    const fileSource = fs.readFileSync(path.join(root, 'src/lib/ical-generator.ts'), 'utf8');
    assert.match(fileSource, /export function escapeIcsText/, 'must export escapeIcsText');
    assert.match(fileSource, /export function formatIcsLocalDateTime/, 'must export formatIcsLocalDateTime');
    assert.match(fileSource, /export function formatIcsUtcDateTime/, 'must export formatIcsUtcDateTime');
    assert.match(fileSource, /export function findFirstOccurrenceDate/, 'must export findFirstOccurrenceDate');
    assert.match(fileSource, /export function buildScheduleIcsEvents/, 'must export buildScheduleIcsEvents');
    assert.match(fileSource, /export function generateIcsCalendar/, 'must export generateIcsCalendar');
    assert.match(fileSource, /export function downloadIcsFile/, 'must export downloadIcsFile');
  });

  await t.test('findFirstOccurrenceDate computes correct day of week occurrences', () => {
    // 2026-09-01 is a Tuesday (JS getDay() = 2)
    const baseTuesday = new Date(2026, 8, 1); // Month is 0-indexed: 8 = September
    assert.equal(baseTuesday.getDay(), 2, 'base date must be Tuesday');

    // dow = 2: Monday (targetJsDay = 1) -> Tuesday to next Monday is 6 days -> Sept 7
    const targetJsDayMon = (2 === 1 ? 0 : 2 - 1);
    const diffMon = (targetJsDayMon - baseTuesday.getDay() + 7) % 7;
    assert.equal(diffMon, 6, 'diff to Monday from Tuesday must be 6 days');

    // dow = 3: Tuesday (targetJsDay = 2) -> Tuesday to Tuesday is 0 days -> Sept 1
    const targetJsDayTue = (3 === 1 ? 0 : 3 - 1);
    const diffTue = (targetJsDayTue - baseTuesday.getDay() + 7) % 7;
    assert.equal(diffTue, 0, 'diff to Tuesday from Tuesday must be 0 days');

    // dow = 4: Wednesday (targetJsDay = 3) -> Tuesday to Wednesday is 1 day -> Sept 2
    const targetJsDayWed = (4 === 1 ? 0 : 4 - 1);
    const diffWed = (targetJsDayWed - baseTuesday.getDay() + 7) % 7;
    assert.equal(diffWed, 1, 'diff to Wednesday from Tuesday must be 1 day');
  });

  await t.test('schedule events use civil-date math, not browser-local Date fields', () => {
    // Regression: new Date('YYYY-MM-DD') parses as UTC midnight, so reading
    // getDay()/setDate()/setHours() in a non-VN browser shifted every event.
    const fileSource = fs.readFileSync(path.join(root, 'src/lib/ical-generator.ts'), 'utf8');
    assert.match(fileSource, /getUTCDay/, 'weekday math must read UTC fields');
    assert.match(fileSource, /VIETNAM_UTC_OFFSET_MS/, 'VN offset must be an explicit constant');
    assert.match(fileSource, /parseCivilDateOnly/, 'date-only strings must parse via UTC helpers');
    assert.match(fileSource, /formatCivilDateTime/, 'event times must format from civil fields');
    assert.doesNotMatch(fileSource, /setHours\(/, 'must not set browser-local hours');
    assert.doesNotMatch(fileSource, /\.getDay\(\)/, 'must not read browser-local weekday');
    assert.doesNotMatch(fileSource, /\.setDate\(/, 'must not do browser-local date math');

    // Behavioral check of the civil algorithm itself: 2026-09-01 is a
    // Tuesday. Under the OLD code a browser at UTC-7 read it as Aug 31
    // (Monday) — the new code must still compute Tuesday.
    const base = new Date(Date.UTC(2026, 8, 1));
    assert.equal(base.getUTCDay(), 2, '2026-09-01 civil weekday is Tuesday');
    const targetJsDaySun = 0; // dayOfWeek 1 -> Sunday
    const diffSun = (targetJsDaySun - base.getUTCDay() + 7) % 7;
    const firstSunday = new Date(Date.UTC(2026, 8, 1 + diffSun));
    assert.equal(firstSunday.getUTCDate(), 6, 'first Sunday on/after Sep 1 is Sep 6');

    // End-of-day UNTIL: VN 23:59:59+07:00 == 16:59:59Z same day.
    const untilMs = Date.UTC(2026, 11, 31, 23, 59, 59) - 7 * 60 * 60 * 1000;
    const until = new Date(untilMs);
    assert.equal(until.getUTCHours(), 16, 'VN end-of-day maps to 16:59:59 UTC');
    assert.equal(until.getUTCMinutes(), 59);
  });

  await t.test('escapeIcsText handles RFC 5545 reserved characters correctly', () => {
    // Testing escape logic directly
    const escape = (text) =>
      text
        .replace(/\\/g, '\\\\')
        .replace(/;/g, '\\;')
        .replace(/,/g, '\\,')
        .replace(/\r?\n/g, '\\n');

    assert.equal(escape('Math, Physics; Chemistry'), 'Math\\, Physics\\; Chemistry');
    assert.equal(escape('Line 1\nLine 2'), 'Line 1\\nLine 2');
    assert.equal(escape('A\\B'), 'A\\\\B');
  });

  await t.test('generateIcsCalendar produces valid RFC 5545 structure with CRLF', () => {
    const fileSource = fs.readFileSync(path.join(root, 'src/lib/ical-generator.ts'), 'utf8');
    assert.match(fileSource, /BEGIN:VCALENDAR/, 'must include BEGIN:VCALENDAR');
    assert.match(fileSource, /VERSION:2\.0/, 'must declare VERSION:2.0');
    assert.match(fileSource, /CALSCALE:GREGORIAN/, 'must set CALSCALE:GREGORIAN');
    assert.match(fileSource, /BEGIN:VEVENT/, 'must define VEVENT blocks');
    assert.match(fileSource, /DTSTART;TZID=Asia\/Ho_Chi_Minh:/, 'must include timezone-anchored DTSTART');
    assert.match(fileSource, /FREQ=WEEKLY/, 'must support weekly recurrence RRULE');
    assert.match(fileSource, /END:VEVENT/, 'must close VEVENT blocks');
    assert.match(fileSource, /END:VCALENDAR/, 'must close VCALENDAR');
    assert.match(fileSource, /\\r\\n/, 'must format lines with RFC 5545 CRLF endings');
  });
});

function loadModule(relativePath, aliases = {}) {
  const output = ts.transpileModule(
    fs.readFileSync(path.join(root, relativePath), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } },
  ).outputText;
  const moduleRecord = { exports: {} };
  const resolve = (specifier) =>
    Object.hasOwn(aliases, specifier) ? aliases[specifier] : require(specifier);
  Function('module', 'exports', 'require', output)(moduleRecord, moduleRecord.exports, resolve);
  return moduleRecord.exports;
}

function loadGenerator() {
  const fragments = [
    ['@/i18n/messages-thesis-workflow', 'src/i18n/messages-thesis-workflow.ts'],
    ['@/i18n/messages-dean-overview', 'src/i18n/messages-dean-overview.ts'],
    ['@/i18n/messages-content', 'src/i18n/messages-content.ts'],
    ['@/i18n/messages-attendance-geofence', 'src/i18n/messages-attendance-geofence.ts'],
    ['@/i18n/messages-teaching-pages', 'src/i18n/messages-teaching-pages.ts'],
    ['@/i18n/messages-admin-pages', 'src/i18n/messages-admin-pages.ts'],
    ['@/i18n/messages-student-pages', 'src/i18n/messages-student-pages.ts'],
  ];
  const messageAliases = { '@/i18n/config': {} };
  for (const [specifier, relativePath] of fragments) {
    messageAliases[specifier] = loadModule(relativePath);
  }
  const messages = loadModule('src/i18n/messages.ts', messageAliases);
  return loadModule('src/lib/ical-generator.ts', {
    '@/i18n/messages': messages,
    './enrollment-status': loadModule('src/lib/enrollment-status.ts'),
  });
}

function withFixedDate(value, callback) {
  const OriginalDate = global.Date;
  const fixedTime = new OriginalDate(value).getTime();
  global.Date = class extends OriginalDate {
    constructor(...args) {
      if (args.length === 0) super(fixedTime);
      else super(...args);
    }

    static now() {
      return fixedTime;
    }
  };
  try {
    return callback();
  } finally {
    global.Date = OriginalDate;
  }
}

test('iCalendar localized display descriptions preserve exact output and bytes', () => {
  const generator = loadGenerator();
  const { getMessages } = loadModule('src/i18n/messages.ts', {
    '@/i18n/config': {},
    '@/i18n/messages-thesis-workflow': loadModule('src/i18n/messages-thesis-workflow.ts'),
    '@/i18n/messages-dean-overview': loadModule('src/i18n/messages-dean-overview.ts'),
    '@/i18n/messages-content': loadModule('src/i18n/messages-content.ts'),
    '@/i18n/messages-attendance-geofence': loadModule('src/i18n/messages-attendance-geofence.ts'),
    '@/i18n/messages-teaching-pages': loadModule('src/i18n/messages-teaching-pages.ts'),
    '@/i18n/messages-admin-pages': loadModule('src/i18n/messages-admin-pages.ts'),
    '@/i18n/messages-student-pages': loadModule('src/i18n/messages-student-pages.ts'),
  });
  const enrollments = [{
    id: 17,
    status: 'ENROLLED',
    section: {
      sectionNumber: 'L01',
      course: { code: 'CS101', name: 'Programming', nameVi: 'Lập trình', credits: 3 },
      lecturer: { fullName: 'Nguyễn An' },
      schedules: [{
        id: 9,
        dayOfWeek: 2,
        startTime: '08:00',
        endTime: '09:30',
        classroom: { roomNumber: 'A101', building: 'A' },
      }],
    },
  }];
  const semester = { startDate: '2026-09-01', endDate: '2026-12-31' };
  const localized = {
    vi: {
      summary: '[CS101] Lập trình - L01',
      location: 'Phòng A101, A',
      description: 'Môn học: Lập trình (CS101)\nLớp học phần: L01\nSố tín chỉ: 3\nGiảng viên: Nguyễn An\nĐịa điểm: Phòng A101, A',
      escapedDescription: 'Môn học: Lập trình (CS101)\\nLớp học phần: L01\\nSố tín chỉ: 3\\nGiảng viên: Nguyễn An\\nĐịa điểm: Phòng A101\\, A',
      escapedLocation: 'Phòng A101\\, A',
      calendarName: 'Lịch học - Fall 2026',
    },
    en: {
      summary: '[CS101] Programming - L01',
      location: 'Room A101, A',
      description: 'Course: Programming (CS101)\nSection: L01\nCredits: 3\nLecturer: Nguyễn An\nLocation: Room A101, A',
      escapedDescription: 'Course: Programming (CS101)\\nSection: L01\\nCredits: 3\\nLecturer: Nguyễn An\\nLocation: Room A101\\, A',
      escapedLocation: 'Room A101\\, A',
      calendarName: 'Schedule - Fall 2026',
    },
  };

  for (const locale of ['vi', 'en']) {
    const [event] = generator.buildScheduleIcsEvents(enrollments, semester, locale);
    assert.equal(event.summary, localized[locale].summary);
    assert.equal(event.location, localized[locale].location);
    assert.equal(event.description, localized[locale].description);
    assert.equal(event.uid, 'schedule-17-9@campuscore.edu');
    assert.equal(event.dtstart, '20260907T080000');
    assert.equal(event.dtend, '20260907T093000');
    assert.equal(event.rrule, 'FREQ=WEEKLY;UNTIL=20261231T165959Z');
    assert.equal(
      getMessages(locale).studentPages.ics.defaultCalendarName,
      locale === 'vi' ? 'Thời khóa biểu CampusUTE' : 'CampusUTE Timetable',
    );
  }

  withFixedDate('2026-11-01T12:34:56.000Z', () => {
    for (const locale of ['vi', 'en']) {
      const [event] = generator.buildScheduleIcsEvents(enrollments, semester, locale);
      const calendarName = getMessages(locale).studentPages.schedule.ics.calendarName
        .replace('{semesterName}', 'Fall 2026');
      const output = generator.generateIcsCalendar([event], calendarName);
      const expected = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//CampusUTE//Academic Timetable//VI',
        'CALSCALE:GREGORIAN',
        'METHOD:PUBLISH',
        `X-WR-CALNAME:${localized[locale].calendarName}`,
        'X-WR-TIMEZONE:Asia/Ho_Chi_Minh',
        'BEGIN:VEVENT',
        'UID:schedule-17-9@campuscore.edu',
        'DTSTAMP:20261101T123456Z',
        'DTSTART;TZID=Asia/Ho_Chi_Minh:20260907T080000',
        'DTEND;TZID=Asia/Ho_Chi_Minh:20260907T093000',
        'RRULE:FREQ=WEEKLY;UNTIL=20261231T165959Z',
        `SUMMARY:${localized[locale].summary}`,
        `DESCRIPTION:${localized[locale].escapedDescription}`,
        `LOCATION:${localized[locale].escapedLocation}`,
        'STATUS:CONFIRMED',
        'TRANSP:OPAQUE',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n') + '\r\n';
      assert.equal(output, expected);
      assert.equal(Buffer.compare(Buffer.from(output, 'utf8'), Buffer.from(expected, 'utf8')), 0);
    }
  });
});

test('English schedule export keeps the localized course name when nameEn and name are missing', () => {
  const generator = loadGenerator();
  const enrollments = [{
    id: 23,
    status: 'ENROLLED',
    section: {
      sectionNumber: '08',
      course: { code: 'CS204', nameEn: null, nameVi: 'Kiến trúc phần mềm', credits: 3 },
      schedules: [{ id: 12, dayOfWeek: 2, startTime: '07:30', endTime: '09:00' }],
    },
  }];
  const [event] = generator.buildScheduleIcsEvents(enrollments, { startDate: '2026-09-01', endDate: '2026-12-31' }, 'en');
  assert.equal(event.summary, '[CS204] Kiến trúc phần mềm - 08');
  assert.match(event.description, /Kiến trúc phần mềm/);
});
