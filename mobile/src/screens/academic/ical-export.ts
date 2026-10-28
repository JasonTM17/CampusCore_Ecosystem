// Pure RFC 5545 timetable export, ported from the web generator without any
// DOM access. Event times are Vietnam wall-clock (a fixed UTC+07:00 zone), so
// the output does not depend on the device time zone. Keep behavior aligned
// with `frontend/src/lib/ical-generator.ts`; the parity test compares them.

export interface IcsEvent {
  uid: string;
  summary: string;
  description?: string;
  location?: string;
  dtstart: string; // YYYYMMDDTHHmmss
  dtend: string; // YYYYMMDDTHHmmss
  rrule?: string;
}

export interface IcsSchedule {
  id?: string;
  dayOfWeek: number;
  startTime?: string;
  endTime?: string;
  classroom?: { building?: string | null; roomNumber?: string | null } | null;
}

export interface IcsEnrollment {
  id: string;
  status: string;
  section?: {
    sectionNumber?: string;
    course?: { code?: string; name?: string; nameEn?: string | null; nameVi?: string | null; credits?: number };
    lecturer?: { fullName?: string | null; user?: { firstName?: string | null; lastName?: string | null } | null } | null;
    schedules?: IcsSchedule[];
  };
}

export interface IcsSemester {
  startDate?: string | null;
  endDate?: string | null;
}

const ACTIVE_STATUSES = ['ENROLLED', 'PENDING', 'CONFIRMED'];

/** Backslash, semicolon, comma and newline must be escaped in text values. */
export function escapeIcsText(text: string): string {
  if (!text) return '';
  return text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

const pad = (n: number): string => (n < 10 ? `0${n}` : `${n}`);

export function formatIcsLocalDateTime(date: Date): string {
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}T${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

export function formatIcsUtcDateTime(date: Date): string {
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
}

/**
 * First date on or after `baseStartDate` that falls on `dayOfWeek`
 * (1 = Sunday ... 7 = Saturday). Dates are civil dates held at UTC midnight.
 */
export function findFirstOccurrenceDate(baseStartDate: Date, dayOfWeek: number): Date {
  const targetJsDay = dayOfWeek === 1 ? 0 : dayOfWeek - 1;
  const diffDays = (targetJsDay - baseStartDate.getUTCDay() + 7) % 7;
  return new Date(Date.UTC(baseStartDate.getUTCFullYear(), baseStartDate.getUTCMonth(), baseStartDate.getUTCDate() + diffDays));
}

function formatCivilDateTime(civilDate: Date, hours: number, minutes: number): string {
  return `${civilDate.getUTCFullYear()}${pad(civilDate.getUTCMonth() + 1)}${pad(civilDate.getUTCDate())}T${pad(hours)}${pad(minutes)}00`;
}

// Asia/Ho_Chi_Minh has been a fixed UTC+07:00 offset (no DST) since 1975.
const VIETNAM_UTC_OFFSET_MS = 7 * 60 * 60 * 1000;

function vietnamCivilToday(nowMs: number): Date {
  const vnNow = new Date(nowMs + VIETNAM_UTC_OFFSET_MS);
  return new Date(Date.UTC(vnNow.getUTCFullYear(), vnNow.getUTCMonth(), vnNow.getUTCDate()));
}

function parseCivilDateOnly(value: string): Date | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return undefined;
  const date = new Date(Date.UTC(+match[1], +match[2] - 1, +match[3]));
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export function parseTimeString(timeStr?: string): { hours: number; minutes: number } {
  if (!timeStr) return { hours: 7, minutes: 0 };
  const parts = timeStr.split(':').map((p) => parseInt(p, 10));
  return {
    hours: Number.isNaN(parts[0]) ? 7 : parts[0],
    minutes: Number.isNaN(parts[1]) ? 0 : parts[1],
  };
}

/** Weekly recurring events for active and completed enrollments. */
export function buildScheduleIcsEvents(
  enrollments: readonly IcsEnrollment[],
  semester?: IcsSemester,
  locale: 'vi' | 'en' = 'vi',
  nowMs: number = Date.now(),
): IcsEvent[] {
  const events: IcsEvent[] = [];
  const baseStartDate = (semester?.startDate ? parseCivilDateOnly(semester.startDate) : undefined) ?? vietnamCivilToday(nowMs);

  let untilUtc: string | undefined;
  const endDate = semester?.endDate ? parseCivilDateOnly(semester.endDate) : undefined;
  if (endDate) {
    untilUtc = formatIcsUtcDateTime(
      new Date(Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth(), endDate.getUTCDate(), 23, 59, 59) - VIETNAM_UTC_OFFSET_MS),
    );
  }

  for (const enrollment of enrollments) {
    if (!ACTIVE_STATUSES.includes(enrollment.status) && enrollment.status !== 'COMPLETED') continue;
    const section = enrollment.section;
    if (!section) continue;

    const courseCode = section.course?.code ?? 'COURSE';
    const courseName = locale === 'vi'
      ? section.course?.nameVi || section.course?.name || courseCode
      : section.course?.nameEn || section.course?.name || courseCode;
    const sectionNumber = section.sectionNumber || '';
    const credits = section.course?.credits ?? 0;
    const lecturerName = section.lecturer?.fullName
      ?? (section.lecturer?.user ? `${section.lecturer.user.lastName ?? ''} ${section.lecturer.user.firstName ?? ''}`.trim() : '');

    const schedules = section.schedules ?? [];
    for (let i = 0; i < schedules.length; i++) {
      const schedule = schedules[i];
      const firstDate = findFirstOccurrenceDate(baseStartDate, schedule.dayOfWeek === 0 ? 1 : schedule.dayOfWeek);
      const start = parseTimeString(schedule.startTime);
      const end = parseTimeString(schedule.endTime);
      const building = schedule.classroom?.building;
      const room = schedule.classroom?.roomNumber;
      const location = [room ? (locale === 'vi' ? `Phòng ${room}` : `Room ${room}`) : '', building].filter(Boolean).join(', ');

      const lines: string[] = [];
      if (locale === 'vi') {
        lines.push(`Môn học: ${courseName} (${courseCode})`, `Lớp học phần: ${sectionNumber}`);
        if (credits > 0) lines.push(`Số tín chỉ: ${credits}`);
        if (lecturerName) lines.push(`Giảng viên: ${lecturerName}`);
        if (location) lines.push(`Địa điểm: ${location}`);
      } else {
        lines.push(`Course: ${courseName} (${courseCode})`, `Section: ${sectionNumber}`);
        if (credits > 0) lines.push(`Credits: ${credits}`);
        if (lecturerName) lines.push(`Lecturer: ${lecturerName}`);
        if (location) lines.push(`Location: ${location}`);
      }

      events.push({
        uid: `schedule-${enrollment.id}-${schedule.id || i}@campuscore.edu`,
        summary: `[${courseCode}] ${courseName} - ${sectionNumber}`,
        description: lines.join('\n'),
        location,
        dtstart: formatCivilDateTime(firstDate, start.hours, start.minutes),
        dtend: formatCivilDateTime(firstDate, end.hours, end.minutes),
        rrule: untilUtc ? `FREQ=WEEKLY;UNTIL=${untilUtc}` : undefined,
      });
    }
  }
  return events;
}

/** RFC 5545 VCALENDAR text with CRLF line endings. */
export function generateIcsCalendar(
  events: readonly IcsEvent[],
  calendarName = 'CampusUTE Timetable',
  nowMs: number = Date.now(),
): string {
  const dtstamp = formatIcsUtcDateTime(new Date(nowMs));
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//CampusUTE//Academic Timetable//VI',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeIcsText(calendarName)}`,
    'X-WR-TIMEZONE:Asia/Ho_Chi_Minh',
  ];
  for (const event of events) {
    lines.push('BEGIN:VEVENT', `UID:${event.uid}`, `DTSTAMP:${dtstamp}`);
    lines.push(`DTSTART;TZID=Asia/Ho_Chi_Minh:${event.dtstart}`, `DTEND;TZID=Asia/Ho_Chi_Minh:${event.dtend}`);
    if (event.rrule) lines.push(`RRULE:${event.rrule}`);
    lines.push(`SUMMARY:${escapeIcsText(event.summary)}`);
    if (event.description) lines.push(`DESCRIPTION:${escapeIcsText(event.description)}`);
    if (event.location) lines.push(`LOCATION:${escapeIcsText(event.location)}`);
    lines.push('STATUS:CONFIRMED', 'TRANSP:OPAQUE', 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return `${lines.join('\r\n')}\r\n`;
}

export interface TimetableExport {
  filename: string;
  content: string;
  eventCount: number;
}

export function buildTimetableExport(
  enrollments: readonly IcsEnrollment[],
  semester: IcsSemester | undefined,
  locale: 'vi' | 'en',
  calendarName: string,
  nowMs: number = Date.now(),
): TimetableExport {
  const events = buildScheduleIcsEvents(enrollments, semester, locale, nowMs);
  return {
    filename: 'campusute-timetable.ics',
    content: generateIcsCalendar(events, calendarName, nowMs),
    eventCount: events.length,
  };
}

/** `data:` URI handed to the file adapter, which decides how to materialise and share it. */
export const icsDataUri = (content: string): string => `data:text/calendar;charset=utf-8,${encodeURIComponent(content)}`;
