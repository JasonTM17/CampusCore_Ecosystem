// Pure lecturer read and edit models: roster marks, stale detection, score
// parsing and the changed-rows-only save payload. No React or native imports so
// the same code runs under `node --test`.

export type MarkStatus = 'PRESENT' | 'ABSENT' | 'LATE' | 'EXCUSED';

export const MARK_STATUSES: readonly MarkStatus[] = ['PRESENT', 'LATE', 'ABSENT', 'EXCUSED'];

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
  semesterId?: string;
  semesterName?: string;
}

/** Course title in the active language, falling back across the available names. */
export function courseTitle(section: SectionLike, locale: 'vi' | 'en'): string {
  const names = locale === 'en'
    ? [section.courseNameEn, section.courseName, section.courseNameVi]
    : [section.courseNameVi, section.courseName, section.courseNameEn];
  return names.find((name) => typeof name === 'string' && name.trim() !== '')?.trim() ?? '';
}

const fold = (value: string) =>
  value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\u0111/gi, 'd').toLowerCase();

/** Diacritic-insensitive match on course code, name and section number. */
export function filterSections<T extends SectionLike>(
  sections: readonly T[],
  query: string,
  semesterId: string,
  locale: 'vi' | 'en',
): T[] {
  const needle = fold(query.trim());
  return sections.filter((section) => {
    if (semesterId && section.semesterId !== semesterId) return false;
    if (!needle) return true;
    const haystack = fold([section.courseCode, courseTitle(section, locale), section.sectionNumber].filter(Boolean).join(' '));
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

export const dayNumberOf = (date: Date): number => date.getDay() + 1;

/** `limit` rows of `items`, growing by `limit` each time the lecturer asks for more. */
export const windowOf = <T>(items: readonly T[], pages: number, limit: number): { rows: T[]; hasMore: boolean } => ({
  rows: items.slice(0, pages * limit),
  hasMore: items.length > pages * limit,
});

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
}

export function baselineOf(roster: readonly RosterEntryLike[], marks: readonly MarkLike[]): AttendanceBaseline {
  return {
    roster: roster.map((entry) => entry.studentId).sort(),
    marks: Object.fromEntries(marks.filter((mark) => isMarkStatus(mark.status)).map((mark) => [mark.studentId, mark.status])),
  };
}

/** The baseline the server holds right after the rows were saved: every marked row is now stored. */
export function savedBaseline(rows: readonly RosterRow[]): AttendanceBaseline {
  return {
    roster: rows.map((row) => row.studentId).sort(),
    marks: Object.fromEntries(rows.filter((row) => row.status !== null).map((row) => [row.studentId, row.status as string])),
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
  return before.length !== after.length || before.some((id) => baseline.marks[id] !== latest.marks[id]);
}

export const setRowStatus = (rows: readonly RosterRow[], studentId: string, status: MarkStatus | null): RosterRow[] =>
  rows.map((row) => (row.studentId === studentId ? { ...row, status, notes: status ? row.notes : '' } : row));

/** Sets every row, or only `ids` when given, so a filtered view marks just what is shown. */
export const setAllStatus = (rows: readonly RosterRow[], status: MarkStatus, ids?: ReadonlySet<string>): RosterRow[] =>
  rows.map((row) => (!ids || ids.has(row.studentId) ? { ...row, status } : row));

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

/** Rows whose mark differs from the stored one. */
export function attendanceChangeCount(rows: readonly RosterRow[], baseline: AttendanceBaseline): number {
  return rows.filter((row) => (row.status ?? '') !== (baseline.marks[row.studentId] ?? '')).length;
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
  const needle = fold(query.trim());
  return needle ? rows.filter((row) => fold(`${row.name} ${row.studentCode}`).includes(needle)) : [...rows];
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
  processScore?: number | null;
  finalExamScore?: number | null;
  gradeStatus?: string;
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

export const isLockedGrade = (row: GradeRowLike): boolean => row.gradeStatus === 'PUBLISHED' || row.gradeStatus === 'APPEALED';

export interface GradeDraft {
  changes: GradeChange[];
  /** Problems keyed by enrollment id then field. */
  problems: Record<string, Partial<Record<'processScore' | 'finalExamScore', ScoreProblem>>>;
}

/**
 * Only rows whose text differs from the server value are sent, so rows the
 * lecturer never touched keep their stored scores. A final score without a
 * process score cannot be averaged and is flagged before any request.
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
    changes.push({ enrollmentId: row.enrollmentId, processScore: processScore as number | null, finalExamScore: finalExamScore as number | null });
  }
  return { changes, problems };
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
