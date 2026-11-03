// Pure enrollment, term and timetable helpers shared by the academic screens.
// Day convention follows the backend: 1 = Sunday ... 7 = Saturday. Calendar
// math runs on the fixed UTC+07 campus day, never the device zone.

import { campusDate, campusDayOfWeek, campusIsoDate, campusMinutesOfDay } from '../../i18n/locale';

export type AcademicLocale = 'vi' | 'en';

export interface AcademicSchedule {
  id?: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  classroom?: { building?: string | null; roomNumber?: string | null } | null;
}

export interface AcademicSection {
  id?: string;
  sectionNumber?: string;
  semesterId?: string;
  capacity?: number;
  enrolledCount?: number;
  status?: string;
  course?: { code?: string; name?: string; nameEn?: string | null; nameVi?: string | null; credits?: number };
  schedules?: AcademicSchedule[];
  lecturer?: { fullName?: string | null; user?: { firstName?: string | null; lastName?: string | null } | null } | null;
}

export interface AcademicSemester {
  id: string;
  name?: string;
  nameEn?: string | null;
  nameVi?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  status?: string;
}

export interface AcademicEnrollment {
  id: string;
  sectionId: string;
  semesterId: string;
  status: string;
  finalGrade?: number | null;
  letterGrade?: string | null;
  gradeStatus?: string;
  enrolledAt?: string | null;
  droppedAt?: string | null;
  section?: AcademicSection;
  semester?: { name?: string; nameEn?: string | null; nameVi?: string | null } | null;
}

/* ---------- enrollment status ---------- */

export type EnrollmentTab = 'active' | 'past' | 'withdrawn';

/** The backend counts these against seats and credit limits. */
export const ACTIVE_STATUSES: readonly string[] = ['ENROLLED', 'PENDING', 'CONFIRMED'];
// The server accepts a drop for every active status during add-drop.
export const DROPPABLE_STATUSES: readonly string[] = ['ENROLLED', 'PENDING', 'CONFIRMED'];
export const WITHDRAWN_STATUSES: readonly string[] = ['DROPPED', 'CANCELLED', 'WITHDRAWN'];

export const isActiveEnrollment = (status: string | null | undefined): boolean => ACTIVE_STATUSES.includes(status ?? '');
export const isDroppableEnrollment = (status: string | null | undefined): boolean => DROPPABLE_STATUSES.includes(status ?? '');

export function enrollmentTab(status: string | null | undefined): EnrollmentTab {
  if (isActiveEnrollment(status)) return 'active';
  if (WITHDRAWN_STATUSES.includes(status ?? '')) return 'withdrawn';
  return 'past';
}

export function filterEnrollments(
  enrollments: readonly AcademicEnrollment[],
  tab: EnrollmentTab,
  semesterId: string | null,
): AcademicEnrollment[] {
  return enrollments.filter((item) => enrollmentTab(item.status) === tab && (!semesterId || item.semesterId === semesterId));
}

export function tabCounts(enrollments: readonly AcademicEnrollment[], semesterId: string | null): Record<EnrollmentTab, number> {
  const counts: Record<EnrollmentTab, number> = { active: 0, past: 0, withdrawn: 0 };
  for (const item of enrollments) {
    if (!semesterId || item.semesterId === semesterId) counts[enrollmentTab(item.status)] += 1;
  }
  return counts;
}

/* ---------- names ---------- */

export function localizedName(
  row: { name?: string | null; nameEn?: string | null; nameVi?: string | null } | null | undefined,
  locale: AcademicLocale,
  fallback = '',
): string {
  if (!row) return fallback;
  const primary = locale === 'vi' ? row.nameVi || row.nameEn : row.nameEn || row.nameVi;
  return primary || row.name || fallback;
}

export const enrollmentCourseCode = (item: AcademicEnrollment): string =>
  item.section?.course?.code ?? item.section?.sectionNumber ?? item.sectionId;

export const enrollmentCourseName = (item: AcademicEnrollment, locale: AcademicLocale): string =>
  localizedName(item.section?.course, locale, enrollmentCourseCode(item));

export function lecturerName(section: AcademicSection | undefined): string {
  const lecturer = section?.lecturer;
  if (!lecturer) return '';
  if (lecturer.fullName) return lecturer.fullName;
  return `${lecturer.user?.lastName ?? ''} ${lecturer.user?.firstName ?? ''}`.trim();
}

export function roomLabel(slot: AcademicSchedule): string {
  const room = slot.classroom;
  return room ? `${room.building ?? ''} ${room.roomNumber ?? ''}`.trim() : '';
}

/* ---------- terms ---------- */

export interface TermOption {
  value: string;
  label: string;
}

const PREFERRED_STATUSES = ['IN_PROGRESS', 'ADD_DROP_OPEN', 'REGISTRATION_OPEN', 'ACTIVE', 'OPEN'];

/** Terms known from the semester list plus any term only seen on an enrollment, newest start first. */
export function termOptions(
  enrollments: readonly AcademicEnrollment[],
  semesters: readonly AcademicSemester[],
  locale: AcademicLocale,
): TermOption[] {
  const rows = new Map<string, { label: string; start: string }>();
  for (const semester of semesters) {
    rows.set(semester.id, { label: localizedName(semester, locale, semester.id), start: semester.startDate ?? '' });
  }
  for (const item of enrollments) {
    if (!rows.has(item.semesterId)) {
      rows.set(item.semesterId, { label: localizedName(item.semester, locale, item.semesterId), start: '' });
    }
  }
  return [...rows.entries()]
    .sort((left, right) => right[1].start.localeCompare(left[1].start))
    .map(([value, row]) => ({ value, label: row.label }));
}

/** Preferred open term first, otherwise the first term that has enrollments. */
export function defaultTermId(semesters: readonly AcademicSemester[], enrollments: readonly AcademicEnrollment[]): string | null {
  for (const status of PREFERRED_STATUSES) {
    const found = semesters.find((semester) => semester.status === status);
    if (found) return found.id;
  }
  return enrollments[0]?.semesterId ?? semesters[0]?.id ?? null;
}

/* ---------- timetable ---------- */

export interface AgendaItem {
  id: string;
  enrollmentId: string;
  semesterId: string;
  courseCode: string;
  courseName: string;
  sectionNumber: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  room: string;
  lecturer: string;
  credits: number;
}

export const normalizeDay = (day: number): number => (day === 0 ? 1 : day);

/** Monday-first display order for the backend day numbers. */
export const DAY_ORDER: readonly number[] = [2, 3, 4, 5, 6, 7, 1];

/** Active and completed enrollments projected into weekly meetings, sorted by day then time. */
export function buildAgenda(enrollments: readonly AcademicEnrollment[], locale: AcademicLocale): AgendaItem[] {
  const items: AgendaItem[] = [];
  for (const enrollment of enrollments) {
    if (!isActiveEnrollment(enrollment.status) && enrollment.status !== 'COMPLETED') continue;
    const section = enrollment.section;
    (section?.schedules ?? []).forEach((slot, index) => {
      items.push({
        id: `${enrollment.id}-${slot.id ?? index}`,
        enrollmentId: enrollment.id,
        semesterId: enrollment.semesterId,
        courseCode: enrollmentCourseCode(enrollment),
        courseName: enrollmentCourseName(enrollment, locale),
        sectionNumber: section?.sectionNumber ?? '',
        dayOfWeek: normalizeDay(slot.dayOfWeek),
        startTime: slot.startTime,
        endTime: slot.endTime,
        room: roomLabel(slot),
        lecturer: lecturerName(section),
        credits: section?.course?.credits ?? 0,
      });
    });
  }
  return items.sort((left, right) => DAY_ORDER.indexOf(left.dayOfWeek) - DAY_ORDER.indexOf(right.dayOfWeek) || left.startTime.localeCompare(right.startTime));
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** `YYYY-MM-DD` of the campus calendar day. */
export function civilKey(date: Date): string {
  return campusIsoDate(date);
}

/** Monday of the campus week containing `date`, shifted by whole weeks. */
export function weekStartOf(date: Date, weekOffset = 0): Date {
  const day = campusDate(date);
  const mondayOffset = (day.getUTCDay() + 6) % 7;
  return new Date(day.getTime() - mondayOffset * DAY_MS + weekOffset * 7 * DAY_MS);
}

export function weekDates(weekStart: Date): Date[] {
  const start = campusDate(weekStart).getTime();
  return Array.from({ length: 7 }, (_, index) => new Date(start + index * DAY_MS));
}

/** Backend day number for a campus calendar date. */
export const dayOfWeekOf = (date: Date): number => campusDayOfWeek(date);

/** Day of the month of the campus calendar day. */
export const civilDayOf = (date: Date): number => campusDate(date).getUTCDate();

/** Meetings that fall on a date, limited to the term dates when they are known. */
export function agendaForDate(agenda: readonly AgendaItem[], date: Date, term?: Pick<AcademicSemester, 'startDate' | 'endDate'> | null): AgendaItem[] {
  const key = civilKey(date);
  const start = term?.startDate?.slice(0, 10);
  const end = term?.endDate?.slice(0, 10);
  if ((start && key < start) || (end && key > end)) return [];
  return agenda.filter((item) => item.dayOfWeek === dayOfWeekOf(date));
}

const minutesOfDay = (value: string): number => {
  const [hours, minutes] = value.split(':');
  return (Number(hours) || 0) * 60 + (Number(minutes) || 0);
};

/** The next weekly meetings at or after `now`, ordered by their next occurrence. */
export function nextMeetings(agenda: readonly AgendaItem[], now: Date, limit: number): AgendaItem[] {
  if (limit <= 0) return [];
  const today = dayOfWeekOf(now);
  const nowMinutes = campusMinutesOfDay(now);
  return agenda
    .map((item) => {
      const days = (normalizeDay(item.dayOfWeek) - today + 7) % 7;
      return { item, days: days === 0 && minutesOfDay(item.startTime) < nowMinutes ? 7 : days };
    })
    .sort((left, right) => left.days - right.days || minutesOfDay(left.item.startTime) - minutesOfDay(right.item.startTime))
    .slice(0, limit)
    .map(({ item }) => item);
}
