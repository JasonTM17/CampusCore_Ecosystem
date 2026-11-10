// Pure lecturer read and edit models: roster marks, stale detection, score
// parsing and the changed-rows-only save payload. No React or native imports so
// the same code runs under `node --test`.

import { campusDayOfWeek } from '../../i18n/locale';

export type MarkStatus = 'PRESENT' | 'ABSENT' | 'LATE' | 'EXCUSED';

export const MARK_STATUSES: readonly MarkStatus[] = ['PRESENT', 'ABSENT', 'LATE', 'EXCUSED'];

/** Mirrors the web field and the attendance request DTO. */
export const ATTENDANCE_NOTE_MAX = 1000;

const isMarkStatus = (value: unknown): value is MarkStatus =>
  typeof value === 'string' && (MARK_STATUSES as readonly string[]).includes(value);

/* ---------- sections ---------- */

export interface SectionLike {
  sectionId: string;
  sectionNumber?: string;
  courseCode?: string;
  courseName?: string;
  courseNameEn?: string;
  courseNameVi?: string;
  departmentName?: string;
  departmentNameEn?: string;
  departmentNameVi?: string;
  semester?: string;
  semesterId?: string;
  semesterName?: string;
  semesterNameEn?: string;
  semesterNameVi?: string;
}

/** Course title in the active language, falling back across the available names. */
export function courseTitle(section: SectionLike, locale: 'vi' | 'en'): string {
  const names = locale === 'en'
    ? [section.courseNameEn, section.courseName, section.courseNameVi]
    : [section.courseNameVi, section.courseName, section.courseNameEn];
  return names.find((name) => typeof name === 'string' && name.trim() !== '')?.trim() ?? '';
}

/** Department title in the active language, falling back across the available names. */
export function departmentTitle(section: SectionLike, locale: 'vi' | 'en'): string {
  const names = locale === 'en'
    ? [section.departmentNameEn, section.departmentName, section.departmentNameVi]
    : [section.departmentNameVi, section.departmentName, section.departmentNameEn];
  return names.find((name) => typeof name === 'string' && name.trim() !== '')?.trim() ?? '';
}

/** Semester title in the active language, falling back across the available names. */
export function termTitle(section: SectionLike, locale: 'vi' | 'en'): string {
  const names = locale === 'en'
    ? [section.semesterNameEn, section.semester, section.semesterNameVi, section.semesterName]
    : [section.semesterNameVi, section.semester, section.semesterNameEn, section.semesterName];
  return names.find((name) => typeof name === 'string' && name.trim() !== '')?.trim() ?? '';
}

export interface DashboardMetrics {
  sections: number;
  students: number;
  readyToPublish: number;
  freshNotices: number;
}

/** The web dashboard's four metric values, computed from the same sources. */
export function dashboardMetrics(
  sections: readonly { enrolledCount?: number }[],
  gradingSections: readonly { canPublish?: boolean }[],
  announcementsTotal: number,
): DashboardMetrics {
  return {
    sections: sections.length,
    students: sections.reduce((total, section) => total + (section.enrolledCount ?? 0), 0),
    readyToPublish: gradingSections.filter((section) => section.canPublish).length,
    freshNotices: announcementsTotal,
  };
}

export const normalizeOperationsSearch = (value: string) =>
  value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\u0111/gi, 'd').toLowerCase();

/** Diacritic-insensitive match on course code, name and section number. */
export function filterSections<T extends SectionLike>(
  sections: readonly T[],
  query: string,
  semesterId: string,
  locale: 'vi' | 'en',
): T[] {
  const needle = normalizeOperationsSearch(query.trim());
  return sections.filter((section) => {
    if (semesterId && section.semesterId !== semesterId) return false;
    if (!needle) return true;
    const haystack = normalizeOperationsSearch([section.courseCode, courseTitle(section, locale), section.sectionNumber].filter(Boolean).join(' '));
    return haystack.includes(needle);
  });
}

export interface TermOption {
  value: string;
  label: string;
}

/** Distinct terms present in the lecturer's sections, in first-seen order. */
export function termOptions(sections: readonly SectionLike[]): TermOption[] {
  const seen = new Map<string, string>();
  for (const section of sections) {
    if (section.semesterId && !seen.has(section.semesterId)) {
      seen.set(section.semesterId, section.semesterName?.trim() || section.semesterId);
    }
  }
  return [...seen].map(([value, label]) => ({ value, label }));
}

/** Backend day numbers run 1 = Sunday … 7 = Saturday; 0 is read as Sunday. */
export const normalizeDay = (day: number): number => (day === 0 ? 1 : day);

export const dayNumberOf = (date: Date): number => campusDayOfWeek(date);

/** `limit` rows of `items`, growing by `limit` each time the lecturer asks for more. */
export const windowOf = <T>(items: readonly T[], pages: number, limit: number): { rows: T[]; hasMore: boolean } => ({
  rows: items.slice(0, pages * limit),
  hasMore: items.length > pages * limit,
});

/** Monday-first week, matching the web teaching timetable. */
export const TEACHING_WEEK = [2, 3, 4, 5, 6, 7, 1] as const;

export interface MeetingSource {
  sectionId: string;
  courseCode?: string;
  sectionNumber?: string;
  schedules?: readonly {
    id?: string;
    dayOfWeek: number;
    startTime?: string;
    endTime?: string;
    classroom?: { building?: string; roomNumber?: string };
  }[];
}

export interface TeachingMeeting {
  key: string;
  sectionId: string;
  courseCode: string;
  sectionNumber: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  room: string;
}

/** `A2-204`, matching the teaching timetable. A missing room number stays the pending label. */
export function meetingRoom(building?: string, roomNumber?: string, pending = ''): string {
  const room = (roomNumber ?? '').trim();
  if (!room) return pending;
  const block = (building ?? '').trim();
  return block ? `${block}-${room}` : room;
}

/** Section chip beside the course code. A number that repeats the code keeps only the suffix. */
export function sectionSuffix(courseCode: string, sectionNumber?: string): string {
  const number = (sectionNumber ?? '').trim();
  if (!number) return '';
  const escaped = courseCode.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return number.replace(new RegExp(`^${escaped}[-\\s]?`), '') || number;
}

/** Sections, weekly meetings and enrolled students for the schedule stat cards. */
export function scheduleLoadStats(sections: readonly { enrolledCount?: number; schedules?: readonly unknown[] }[]): {
  sections: number;
  slots: number;
  students: number;
} {
  return {
    sections: sections.length,
    slots: sections.reduce((total, section) => total + (section.schedules?.length ?? 0), 0),
    students: sections.reduce((total, section) => total + (section.enrolledCount ?? 0), 0),
  };
}

/** Day columns and start-time rows for the teaching timetable. Incomplete meetings are dropped. */
export function teachingGrid(sections: readonly MeetingSource[], roomPending: string): {
  days: readonly number[];
  slots: string[];
  cells: Record<string, TeachingMeeting[]>;
} {
  const cells: Record<string, TeachingMeeting[]> = {};
  const slotSet = new Set<string>();
  sections.forEach((section, sectionIndex) => {
    (section.schedules ?? []).forEach((slot, slotIndex) => {
      const day = normalizeDay(slot.dayOfWeek);
      const start = (slot.startTime ?? '').trim();
      if (!start || day < 1 || day > 7) return;
      const courseCode = section.courseCode?.trim() || section.sectionId;
      const room = meetingRoom(slot.classroom?.building, slot.classroom?.roomNumber, roomPending);
      const meeting: TeachingMeeting = {
        key: slot.id ?? `${section.sectionId}-${sectionIndex}-${slotIndex}`,
        sectionId: section.sectionId,
        courseCode,
        sectionNumber: sectionSuffix(courseCode, section.sectionNumber),
        dayOfWeek: day,
        startTime: start,
        endTime: (slot.endTime ?? '').trim(),
        room,
      };
      (cells[`${day}-${start}`] ??= []).push(meeting);
      slotSet.add(start);
    });
  });
  return { days: TEACHING_WEEK, slots: [...slotSet].sort((left, right) => left.localeCompare(right)), cells };
}

/** Queue totals for the grade-management list: sections, captured grades, publish-ready sections. */
export function gradingQueueStats(sections: readonly { gradedCount?: number; canPublish?: boolean }[]): {
  sections: number;
  captured: number;
  ready: number;
} {
  return {
    sections: sections.length,
    captured: sections.reduce((total, section) => total + (section.gradedCount ?? 0), 0),
    ready: sections.filter((section) => section.canPublish).length,
  };
}

/** Rows that already have a letter or both component scores, the web's graded-record count. */
export function gradedRecordCount(rows: readonly { processScore?: number | null; finalExamScore?: number | null; letterGrade?: string | null }[]): number {
  return rows.filter((row) => {
    if (typeof row.letterGrade === 'string' && row.letterGrade.trim() !== '') return true;
    return typeof row.processScore === 'number' && typeof row.finalExamScore === 'number';
  }).length;
}

/** Credits when the grading payload carries them; absent fields stay hidden. */
export function sectionCredits(section: object): number | undefined {
  const credits = (section as { credits?: unknown }).credits;
  return typeof credits === 'number' ? credits : undefined;
}

/* ---------- attendance ---------- */

export interface RosterEntryLike {
  studentId: string;
  studentCode?: string;
  firstName?: string;
  lastName?: string;
}

export interface MarkLike {
  studentId: string;
  status: string;
  notes?: string;
}

export interface RosterRow {
  studentId: string;
  studentCode: string;
  name: string;
  status: MarkStatus | null;
  notes: string;
  /** A record exists on the server for this student and day. */
  stored: boolean;
}

export const rosterName = (entry: RosterEntryLike): string =>
  `${entry.lastName ?? ''} ${entry.firstName ?? ''}`.trim() || entry.studentCode || entry.studentId;

export function buildRosterRows(roster: readonly RosterEntryLike[], marks: readonly MarkLike[]): RosterRow[] {
  const byStudent = new Map(marks.map((mark) => [mark.studentId, mark]));
  return roster.map((entry) => {
    const mark = byStudent.get(entry.studentId);
    const status = isMarkStatus(mark?.status) ? mark.status : null;
    return {
      studentId: entry.studentId,
      studentCode: entry.studentCode ?? entry.studentId,
      name: rosterName(entry),
      status,
      notes: status ? mark?.notes ?? '' : '',
      stored: status !== null,
    };
  });
}

/** What the server held when the rows were loaded: roster ids and one mark per student. */
export interface AttendanceBaseline {
  roster: string[];
  marks: Record<string, string>;
  /** Stored note per marked student, so a note edited elsewhere also makes the sheet stale. */
  notes?: Record<string, string>;
  /** Present-by-default rows the lecturer has not saved yet; never part of the server baseline. */
  defaults?: Record<string, string>;
}

export function baselineOf(roster: readonly RosterEntryLike[], marks: readonly MarkLike[]): AttendanceBaseline {
  const stored = marks.filter((mark) => isMarkStatus(mark.status));
  return {
    roster: roster.map((entry) => entry.studentId).sort(),
    marks: Object.fromEntries(stored.map((mark) => [mark.studentId, mark.status])),
    notes: Object.fromEntries(stored.map((mark) => [mark.studentId, mark.notes?.trim() ?? ''])),
  };
}

/** The baseline the server holds right after the rows were saved: every marked row is now stored. */
export function savedBaseline(rows: readonly RosterRow[]): AttendanceBaseline {
  const stored = rows.filter((row) => row.status !== null);
  return {
    roster: rows.map((row) => row.studentId).sort(),
    marks: Object.fromEntries(stored.map((row) => [row.studentId, row.status as string])),
    notes: Object.fromEntries(stored.map((row) => [row.studentId, row.notes.trim()])),
  };
}

/** Rows after a successful save: marked rows are stored, cleared rows are gone. */
export const commitRows = (rows: readonly RosterRow[]): RosterRow[] =>
  rows.map((row) => ({ ...row, stored: row.status !== null }));

/**
 * True when the server no longer matches what the lecturer started from, so a
 * save would overwrite someone else's marks or a changed roster.
 */
export function isStaleAttendance(
  baseline: AttendanceBaseline,
  roster: readonly RosterEntryLike[],
  marks: readonly MarkLike[],
): boolean {
  const latest = baselineOf(roster, marks);
  if (latest.roster.length !== baseline.roster.length || latest.roster.some((id, index) => id !== baseline.roster[index])) {
    return true;
  }
  const before = Object.keys(baseline.marks);
  const after = Object.keys(latest.marks);
  if (before.length !== after.length || before.some((id) => baseline.marks[id] !== latest.marks[id])) return true;
  const notes = baseline.notes;
  if (!notes) return false;
  const latestNotes = latest.notes ?? {};
  return Object.keys(notes).some((id) => notes[id] !== (latestNotes[id] ?? ''));
}

export const setRowStatus = (rows: readonly RosterRow[], studentId: string, status: MarkStatus | null): RosterRow[] =>
  rows.map((row) => (row.studentId === studentId ? { ...row, status, notes: status ? row.notes : '' } : row));

/** Sets every row, or only `ids` when given, so a filtered view marks just what is shown. */
export const setAllStatus = (rows: readonly RosterRow[], status: MarkStatus, ids?: ReadonlySet<string>): RosterRow[] =>
  rows.map((row) => (!ids || ids.has(row.studentId) ? { ...row, status } : row));

/** Clears every mark and note. Stored rows become RESET records on the next save. */
export const clearRosterMarks = (rows: readonly RosterRow[]): RosterRow[] =>
  rows.map((row) => ({ ...row, status: null, notes: '' }));

/** The web roll-call default: rows with no stored mark start Present but stay unsaved. */
export function defaultUnmarkedStatus(rows: readonly RosterRow[], status: MarkStatus): {
  rows: RosterRow[];
  defaults: Record<string, string>;
} {
  const defaults: Record<string, string> = {};
  for (const row of rows) {
    if (!row.status) defaults[row.studentId] = status;
  }
  return { rows: setAllStatus(rows, status, new Set(Object.keys(defaults))), defaults };
}

export interface AttendanceSaveRecord {
  studentId: string;
  status: MarkStatus | 'RESET';
  notes?: string;
}

/** Marked rows plus RESET for rows cleared after they had a stored mark, as the web does. */
export function buildAttendanceRecords(rows: readonly RosterRow[]): AttendanceSaveRecord[] {
  const records: AttendanceSaveRecord[] = [];
  for (const row of rows) {
    if (row.status) {
      records.push(row.notes.trim() ? { studentId: row.studentId, status: row.status, notes: row.notes.trim() } : { studentId: row.studentId, status: row.status });
    } else if (row.stored) {
      records.push({ studentId: row.studentId, status: 'RESET' });
    }
  }
  return records;
}

/** Rows whose mark or note differs from the loaded server state and roll-call defaults. */
export function attendanceChangeCount(rows: readonly RosterRow[], baseline: AttendanceBaseline): number {
  return rows.filter((row) => {
    const expectedStatus = baseline.marks[row.studentId] ?? baseline.defaults?.[row.studentId] ?? '';
    const expectedNote = baseline.notes?.[row.studentId] ?? '';
    return (row.status ?? '') !== expectedStatus || row.notes.trim() !== expectedNote;
  }).length;
}

export interface AttendanceMetrics {
  total: number;
  present: number;
  absent: number;
  late: number;
  excused: number;
  unmarked: number;
  /** (present + late) / total as a percentage, the web's definition. */
  rate: number;
}

export function attendanceMetrics(rows: readonly RosterRow[]): AttendanceMetrics {
  const count = (status: MarkStatus) => rows.filter((row) => row.status === status).length;
  const present = count('PRESENT');
  const late = count('LATE');
  return {
    total: rows.length,
    present,
    absent: count('ABSENT'),
    late,
    excused: count('EXCUSED'),
    unmarked: rows.filter((row) => row.status === null).length,
    rate: rows.length > 0 ? ((present + late) / rows.length) * 100 : 0,
  };
}

export const filterRoster = (rows: readonly RosterRow[], query: string): RosterRow[] => {
  const needle = normalizeOperationsSearch(query.trim());
  return needle ? rows.filter((row) => normalizeOperationsSearch(`${row.name} ${row.studentCode}`).includes(needle)) : [...rows];
};

/** Today as YYYY-MM-DD from local calendar fields. */
export function localIsoDate(date: Date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/* ---------- grading ---------- */

export interface GradeRowLike {
  enrollmentId: string;
  studentName?: string;
  studentCode?: string;
  email?: string;
  processScore?: number | null;
  finalExamScore?: number | null;
  gradeStatus?: string;
  /** `Enrollment.version` loaded with the sheet; absent on legacy responses. */
  version?: number;
}

export interface ScoreEdit {
  processScore?: string;
  finalExamScore?: string;
}

export type ScoreProblem = 'invalid' | 'needsProcess';

export interface GradeChange {
  enrollmentId: string;
  processScore: number | null;
  finalExamScore: number | null;
  /** The version this row was loaded with; omitted for a legacy last-write-wins save. */
  version?: number;
}

/** A loaded grade sheet: the rows form the baseline every save is checked against. */
export interface GradeSheetLike {
  sectionId: string;
  rows: readonly GradeRowLike[];
}

/**
 * Two loaded sheets are the same only when every row is equal, including the
 * row version: a version-only bump means the server moved under the draft.
 */
export const sameGradeSheet = (left: GradeSheetLike, right: GradeSheetLike): boolean =>
  left.sectionId === right.sectionId && JSON.stringify(left.rows) === JSON.stringify(right.rows);

/** Fields that make two rows a different editing baseline, version included. */
const gradeRowSignature = (row: GradeRowLike | undefined): string | null =>
  row === undefined
    ? null
    : JSON.stringify([
      row.processScore ?? null,
      row.finalExamScore ?? null,
      row.gradeStatus ?? null,
      row.version ?? null,
    ]);

/** Enrollment ids whose stored row appeared, disappeared or moved between two loads. */
export function changedGradeRows(
  previous: readonly GradeRowLike[],
  next: readonly GradeRowLike[],
): string[] {
  const before = new Map(previous.map((row) => [row.enrollmentId, row]));
  const after = new Map(next.map((row) => [row.enrollmentId, row]));
  return [...new Set([...before.keys(), ...after.keys()])]
    .filter((id) => gradeRowSignature(before.get(id)) !== gradeRowSignature(after.get(id)));
}

/** Empty text is a cleared score (null); anything outside 0–10 or not a number is undefined. */
export function parseScore(text: string): number | null | undefined {
  const trimmed = text.trim().replace(',', '.');
  if (trimmed === '') return null;
  if (!/^\d{1,2}(\.\d{1,2})?$/.test(trimmed)) return undefined;
  const value = Number(trimmed);
  return value >= 0 && value <= 10 ? value : undefined;
}

export const scoreText = (value: number | null | undefined): string => (value === null || value === undefined ? '' : String(value));

export const isLockedGrade = (row: GradeRowLike): boolean => row.gradeStatus === 'PUBLISHED';

export interface GradeDraft {
  changes: GradeChange[];
  /** Problems keyed by enrollment id then field. */
  problems: Record<string, Partial<Record<'processScore' | 'finalExamScore', ScoreProblem>>>;
}

/**
 * Only rows whose text differs from the server value are sent, so rows the
 * lecturer never touched keep their stored scores. A final score without a
 * process score cannot be averaged and is flagged before any request. Each
 * change carries the version its row was loaded with; legacy rows without one
 * stay unversioned so the server keeps last-write-wins for them.
 */
export function buildGradeDraft(rows: readonly GradeRowLike[], edits: Readonly<Record<string, ScoreEdit>>): GradeDraft {
  const changes: GradeChange[] = [];
  const problems: GradeDraft['problems'] = {};
  for (const row of rows) {
    const edit = edits[row.enrollmentId];
    if (!edit || isLockedGrade(row)) continue;
    const processText = edit.processScore ?? scoreText(row.processScore);
    const finalText = edit.finalExamScore ?? scoreText(row.finalExamScore);
    if (processText === scoreText(row.processScore) && finalText === scoreText(row.finalExamScore)) continue;
    const processScore = parseScore(processText);
    const finalExamScore = parseScore(finalText);
    const rowProblems: GradeDraft['problems'][string] = {};
    if (processScore === undefined) rowProblems.processScore = 'invalid';
    if (finalExamScore === undefined) rowProblems.finalExamScore = 'invalid';
    if (processScore === null && typeof finalExamScore === 'number') rowProblems.processScore = 'needsProcess';
    if (Object.keys(rowProblems).length > 0) {
      problems[row.enrollmentId] = rowProblems;
      continue;
    }
    const change: GradeChange = {
      enrollmentId: row.enrollmentId,
      processScore: processScore as number | null,
      finalExamScore: finalExamScore as number | null,
    };
    if (typeof row.version === 'number') change.version = row.version;
    changes.push(change);
  }
  return { changes, problems };
}

/**
 * Rows as the grade cards show them: a valid draft text replaces the loaded
 * score, while invalid text keeps the loaded one, as the web sheet does.
 */
export function mergeGradeEdits<T extends GradeRowLike>(rows: readonly T[], edits: Readonly<Record<string, ScoreEdit>>): T[] {
  return rows.map((row) => {
    const edit = edits[row.enrollmentId];
    if (!edit) return row;
    const processScore = edit.processScore === undefined ? row.processScore : parseScore(edit.processScore);
    const finalExamScore = edit.finalExamScore === undefined ? row.finalExamScore : parseScore(edit.finalExamScore);
    return {
      ...row,
      processScore: processScore === undefined ? row.processScore : processScore,
      finalExamScore: finalExamScore === undefined ? row.finalExamScore : finalExamScore,
    };
  });
}

/** Number of rows with unsaved text, valid or not. */
export function dirtyGradeCount(rows: readonly GradeRowLike[], edits: Readonly<Record<string, ScoreEdit>>): number {
  return rows.filter((row) => {
    const edit = edits[row.enrollmentId];
    if (!edit || isLockedGrade(row)) return false;
    return (edit.processScore ?? scoreText(row.processScore)) !== scoreText(row.processScore)
      || (edit.finalExamScore ?? scoreText(row.finalExamScore)) !== scoreText(row.finalExamScore);
  }).length;
}

/** Share of enrolled students that have both scores, as a whole percentage. */
export const gradedPercent = (graded: number, enrolled: number): number =>
  enrolled > 0 ? Math.min(100, Math.round((graded / enrolled) * 100)) : 0;
