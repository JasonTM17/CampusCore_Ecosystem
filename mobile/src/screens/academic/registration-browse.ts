// Pure browse, filter, sort and availability helpers for course registration.
// Mirrors the web browse helpers; the server stays the authority for every
// enrollment decision, these only decide what to show and which button to offer.

export type CurriculumRelevance = 'MANDATORY' | 'ELECTIVE' | 'OUTSIDE';
export type CurriculumFilter = 'ALL' | CurriculumRelevance;
export type SectionSortMode = 'code' | 'credits' | 'seats';
export type SeatTier = 'open' | 'low' | 'full';

export interface SectionMeeting {
  /** 1 = Sunday ... 7 = Saturday. */
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  room?: string | null;
  lecturer?: string | null;
}

export interface BrowseSection {
  id: string;
  sectionNumber: string;
  courseId?: string;
  courseCode: string;
  courseName: string;
  credits?: number;
  capacity: number;
  enrolledCount: number;
  remainingSeats: number;
  status: string;
  scheduleConflict?: boolean;
  alreadyEnrolled?: boolean;
  curriculumRelevance?: CurriculumRelevance | string;
  schedules?: SectionMeeting[] | null;
}

export interface CourseGroup<T extends BrowseSection = BrowseSection> {
  courseKey: string;
  courseCode: string;
  courseName: string;
  credits: number;
  sections: T[];
}

/** Lowercases and strips diacritics so "dien toan" matches "Điện toán". */
export function normalizeVietnameseText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'd')
    .toLowerCase();
}

export function matchesSectionSearch(section: BrowseSection, rawQuery: string): boolean {
  const query = normalizeVietnameseText(rawQuery.trim());
  if (!query) return true;
  const extras = (section.schedules ?? []).map((slot) => `${slot.lecturer ?? ''} ${slot.room ?? ''}`).join(' ');
  const haystack = normalizeVietnameseText(`${section.courseCode} ${section.sectionNumber} ${section.courseName} ${extras}`);
  return haystack.includes(query) || query.split(/\s+/).filter(Boolean).every((token) => haystack.includes(token));
}

export function matchesCurriculumFilter(section: BrowseSection, filter: CurriculumFilter): boolean {
  return filter === 'ALL' || section.curriculumRelevance === filter;
}

/** Open above 30% of capacity, low from 1 to 30%, full at zero. */
export function seatTier(section: Pick<BrowseSection, 'remainingSeats' | 'capacity'>): SeatTier {
  if (section.remainingSeats <= 0) return 'full';
  if (section.capacity > 0) return section.remainingSeats / section.capacity > 0.3 ? 'open' : 'low';
  return 'low';
}

export function groupByCourse<T extends BrowseSection>(sections: readonly T[]): CourseGroup<T>[] {
  const groups = new Map<string, CourseGroup<T>>();
  for (const section of sections) {
    const key = section.courseId ?? section.courseCode;
    const group = groups.get(key) ?? { courseKey: key, courseCode: section.courseCode, courseName: section.courseName, credits: section.credits ?? 0, sections: [] };
    group.sections.push(section);
    groups.set(key, group);
  }
  return [...groups.values()];
}

export function sortSectionGroups<T extends BrowseSection>(groups: readonly CourseGroup<T>[], mode: SectionSortMode): CourseGroup<T>[] {
  const bySection = (left: T, right: T): number => {
    const primary = mode === 'credits' ? (right.credits ?? 0) - (left.credits ?? 0) : mode === 'seats' ? right.remainingSeats - left.remainingSeats : 0;
    return primary || left.courseCode.localeCompare(right.courseCode) || left.sectionNumber.localeCompare(right.sectionNumber);
  };
  const seatsOf = (group: CourseGroup<T>) => group.sections.reduce((sum, section) => sum + section.remainingSeats, 0);
  return groups
    .map((group) => ({ ...group, sections: [...group.sections].sort(bySection) }))
    .sort((left, right) => {
      const primary = mode === 'credits' ? right.credits - left.credits : mode === 'seats' ? seatsOf(right) - seatsOf(left) : 0;
      return primary || left.courseCode.localeCompare(right.courseCode);
    });
}

export interface BrowseQuery {
  search: string;
  curriculum: CurriculumFilter;
  /** Hide sections with no seats left. */
  hideFull: boolean;
  sort: SectionSortMode;
}

export function browseSections<T extends BrowseSection>(sections: readonly T[], query: BrowseQuery): CourseGroup<T>[] {
  const visible = sections.filter(
    (section) => matchesSectionSearch(section, query.search)
      && matchesCurriculumFilter(section, query.curriculum)
      && (!query.hideFull || section.remainingSeats > 0 || section.alreadyEnrolled === true),
  );
  return sortSectionGroups(groupByCourse(visible), query.sort);
}

/* ---------- conflicts ---------- */

export const normalizeDayOfWeek = (day: number): number => (day === 0 ? 1 : day);

export function meetingsOverlap(left: SectionMeeting, right: SectionMeeting): boolean {
  if (normalizeDayOfWeek(left.dayOfWeek) !== normalizeDayOfWeek(right.dayOfWeek)) return false;
  // "HH:MM" strings compare correctly as text.
  return left.startTime < right.endTime && right.startTime < left.endTime;
}

export function findScheduleConflict(
  candidate: readonly SectionMeeting[] | null | undefined,
  existing: readonly SectionMeeting[] | null | undefined,
): SectionMeeting | null {
  for (const meeting of candidate ?? []) {
    for (const other of existing ?? []) {
      if (meetingsOverlap(meeting, other)) return meeting;
    }
  }
  return null;
}

/* ---------- availability ---------- */

export type SectionAvailability = 'enrolled' | 'closed' | 'full' | 'conflict' | 'creditLimit' | 'open';

export interface AvailabilityContext {
  /** Meetings of the student's active enrollments, used when the server did not flag a conflict. */
  enrolledMeetings?: readonly SectionMeeting[];
  /** Credits still allowed this round; null or undefined when unknown. */
  creditsRemaining?: number | null;
  roundOpen: boolean;
}

/** What to tell the student about a section, in priority order. The server re-checks on submit. */
export function sectionAvailability(section: BrowseSection, context: AvailabilityContext): SectionAvailability {
  if (section.alreadyEnrolled) return 'enrolled';
  if (!context.roundOpen || (section.status !== 'OPEN' && section.status !== '')) return 'closed';
  if (section.remainingSeats <= 0) return 'full';
  if (section.scheduleConflict || findScheduleConflict(section.schedules, context.enrolledMeetings)) return 'conflict';
  if (typeof context.creditsRemaining === 'number' && (section.credits ?? 0) > context.creditsRemaining) return 'creditLimit';
  return 'open';
}

/** Only an open section can be added to the basket. */
export const canSelect = (availability: SectionAvailability): boolean => availability === 'open';

/** Registration-specific backend error codes mapped to copy keys. */
const ERROR_KEYS: Record<string, string> = {
  SECTION_FULL: 'sectionFull',
  SCHEDULE_CONFLICT: 'scheduleConflict',
  CREDIT_CAP_EXCEEDED: 'creditCapExceeded',
  PREREQUISITE_UNMET: 'prerequisiteUnmet',
  COREQUISITE_UNMET: 'corequisiteUnmet',
  WINDOW_CLOSED: 'windowClosed',
  COHORT_INELIGIBLE: 'cohortIneligible',
};

export function registrationErrorKey(code: string | null | undefined): string | null {
  if (!code) return null;
  if (ERROR_KEYS[code]) return ERROR_KEYS[code];
  return code.startsWith('IDEMPOTENCY_') ? 'idempotencyRetry' : null;
}
