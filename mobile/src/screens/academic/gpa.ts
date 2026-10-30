// Pure grade-scale and transcript helpers. No React or native imports so they
// run unchanged under `node --test`. The conversion table mirrors the web
// grade scale (10-point score -> letter -> 4.0 point).

export interface GradeRecordLike {
  courseCode?: string | null;
  credits?: number | null;
  finalGrade?: number | null;
  letterGrade?: string | null;
  gradePoint?: number | null;
  gradeStatus?: string | null;
  enrollmentStatus?: string | null;
  semesterId?: string | null;
}

export const GRADE_POINTS: Record<string, number> = {
  'A+': 4, A: 4, 'A-': 3.7, 'B+': 3.5, B: 3, 'B-': 2.7, 'C+': 2.5, C: 2, 'C-': 1.7, 'D+': 1.5, D: 1, 'D-': 0.7, F: 0,
};

export interface GradeConversionRow {
  letter: string;
  min: number;
  max: number;
  point: number;
}

/** `min` inclusive, `max` exclusive; the top band reaches 10 inclusive. */
export const CONVERSION_TABLE: readonly GradeConversionRow[] = [
  { letter: 'A+', min: 9.0, max: 10.01, point: 4 },
  { letter: 'A', min: 8.5, max: 9.0, point: 4 },
  { letter: 'B+', min: 8.0, max: 8.5, point: 3.5 },
  { letter: 'B', min: 7.0, max: 8.0, point: 3 },
  { letter: 'C+', min: 6.5, max: 7.0, point: 2.5 },
  { letter: 'C', min: 5.5, max: 6.5, point: 2 },
  { letter: 'D+', min: 5.0, max: 5.5, point: 1.5 },
  { letter: 'D', min: 4.0, max: 5.0, point: 1 },
  { letter: 'F', min: 0, max: 4.0, point: 0 },
];

const isNum = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

function bandFor(score: number): GradeConversionRow | undefined {
  return CONVERSION_TABLE.find((row) => score >= row.min && score < row.max);
}

export function letterFromScore(score: number): string {
  return bandFor(score)?.letter ?? 'F';
}

export function pointFromScore(score: number): number {
  return bandFor(score)?.point ?? 0;
}

/** Highest one-decimal score inside a `[min, max)` band, floored onto the 0.1 grid. */
export function bandUpperDisplay(maxExclusive: number): string {
  return (Math.floor((maxExclusive - 0.005) * 10) / 10).toFixed(1);
}

export interface GradeScaleRow {
  letter: string;
  range: string;
  point: string;
}

/** Rows for the scale explanation, for example `A+`, `9.0 - 10.0`, `4.0`. */
export function gradeScaleRows(): GradeScaleRow[] {
  return CONVERSION_TABLE.map((row) => ({
    letter: row.letter,
    range: `${row.min.toFixed(1)} - ${bandUpperDisplay(row.max)}`,
    point: row.point.toFixed(1),
  }));
}

/** Server grade point first, then the letter, then the numeric score. Null when none is derivable. */
export function resolveGradePoint(record: GradeRecordLike): number | null {
  if (isNum(record.gradePoint)) return record.gradePoint;
  const letter = record.letterGrade;
  if (letter && GRADE_POINTS[letter] !== undefined) return GRADE_POINTS[letter];
  if (isNum(record.finalGrade)) return pointFromScore(record.finalGrade);
  return null;
}

export function isPublishedGrade(record: GradeRecordLike): boolean {
  return record.gradeStatus === 'PUBLISHED';
}

export function publishedOnly<T extends GradeRecordLike>(records: readonly T[]): T[] {
  return records.filter(isPublishedGrade);
}

/** Credit-weighted 4.0 GPA over records with a derivable point and positive credits. */
export function computeGpa4(records: readonly GradeRecordLike[]): number | null {
  let weighted = 0;
  let credits = 0;
  for (const record of records) {
    const point = resolveGradePoint(record);
    if (point === null || !isNum(record.credits) || record.credits <= 0) continue;
    weighted += point * record.credits;
    credits += record.credits;
  }
  return credits > 0 ? weighted / credits : null;
}

/** Credit-weighted average of the 0-10 final grades; null when no record has one. */
export function computeAverage10(records: readonly GradeRecordLike[]): number | null {
  let weighted = 0;
  let credits = 0;
  for (const record of records) {
    if (!isNum(record.finalGrade) || !isNum(record.credits) || record.credits <= 0) continue;
    weighted += record.finalGrade * record.credits;
    credits += record.credits;
  }
  return credits > 0 ? weighted / credits : null;
}

export interface BestAttemptSummary {
  gpa: number | null;
  countedCourses: number;
  completedCredits: number;
}

/** Each course counts once through its best attempt (repeat-course policy). */
export function summarizeBestAttempts(records: readonly GradeRecordLike[]): BestAttemptSummary {
  const best = new Map<string, GradeRecordLike>();
  for (const record of records) {
    const key = record.courseCode;
    const point = resolveGradePoint(record);
    if (!key || point === null) continue;
    const current = best.get(key);
    if (!current || point > (resolveGradePoint(current) ?? -1)) best.set(key, record);
  }
  const counted = [...best.values()];
  const completedCredits = counted
    .filter((record) => record.enrollmentStatus === 'COMPLETED' && (resolveGradePoint(record) ?? 0) > 0)
    .reduce((sum, record) => sum + (isNum(record.credits) ? record.credits : 0), 0);
  return { gpa: computeGpa4(counted), countedCourses: counted.length, completedCredits };
}

/* ---------- transcript payload ---------- */

export interface TranscriptRecord extends GradeRecordLike {
  id: string;
  courseCode: string;
  courseName: string;
  credits: number;
}

export interface TranscriptTerm {
  semesterId: string;
  name: string;
  gpa: number | null;
  creditsEarned: number;
  creditsAttempted: number;
  records: TranscriptRecord[];
}

export interface TranscriptModel {
  cumulativeGpa: number | null;
  totalCreditsEarned: number;
  totalCreditsAttempted: number;
  basisNote: string | null;
  /** Newest term first, as delivered. */
  terms: TranscriptTerm[];
}

type Json = Record<string, unknown>;
const asObject = (value: unknown): Json | null => (value && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : null);
const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value.trim() : null);
const num = (value: unknown): number | null => (isNum(value) ? value : null);

function pickName(row: Json, locale: 'vi' | 'en', base: string, en: string, vi: string): string {
  const primary = locale === 'vi' ? text(row[vi]) ?? text(row[en]) : text(row[en]) ?? text(row[vi]);
  return primary ?? text(row[base]) ?? '';
}

function parseRecord(raw: unknown, index: number, locale: 'vi' | 'en'): TranscriptRecord | null {
  const row = asObject(raw);
  if (!row) return null;
  const courseCode = text(row.courseCode) ?? '';
  return {
    id: text(row.id) ?? `${courseCode || 'record'}-${index}`,
    courseCode,
    courseName: pickName(row, locale, 'courseName', 'courseNameEn', 'courseNameVi') || courseCode,
    credits: num(row.credits) ?? 0,
    finalGrade: num(row.finalGrade),
    letterGrade: text(row.letterGrade),
    gradePoint: num(row.gradePoint),
    gradeStatus: text(row.gradeStatus),
    enrollmentStatus: text(row.enrollmentStatus),
    semesterId: text(row.semesterId),
  };
}

function parseBasisNote(raw: unknown, locale: 'vi' | 'en'): string | null {
  if (typeof raw === 'string') return text(raw);
  const row = asObject(raw);
  if (!row) return null;
  return (locale === 'vi' ? text(row.vi) ?? text(row.en) : text(row.en) ?? text(row.vi)) ?? null;
}

/** Normalises the transcript JSON. Returns null when the payload is not a transcript. */
export function parseTranscript(raw: unknown, locale: 'vi' | 'en' = 'vi'): TranscriptModel | null {
  const root = asObject(raw);
  if (!root || !Array.isArray(root.semesters)) return null;
  const summary = asObject(root.summary) ?? {};
  const terms: TranscriptTerm[] = [];
  root.semesters.forEach((entry, termIndex) => {
    const row = asObject(entry);
    if (!row) return;
    const records = (Array.isArray(row.records) ? row.records : [])
      .map((record, index) => parseRecord(record, index, locale))
      .filter((record): record is TranscriptRecord => record !== null);
    terms.push({
      semesterId: text(row.semesterId) ?? `term-${termIndex}`,
      name: pickName(row, locale, 'semesterName', 'semesterNameEn', 'semesterNameVi') || `#${termIndex + 1}`,
      gpa: num(row.gpa),
      creditsEarned: num(row.creditsEarned) ?? 0,
      creditsAttempted: num(row.creditsAttempted) ?? 0,
      records,
    });
  });
  const fallback = summarizeBestAttempts(terms.flatMap((term) => publishedOnly(term.records)));
  return {
    cumulativeGpa: num(summary.cumulativeGpa) ?? fallback.gpa,
    totalCreditsEarned: num(summary.totalCreditsEarned) ?? fallback.completedCredits,
    totalCreditsAttempted: num(summary.totalCreditsAttempted) ?? terms.reduce((sum, term) => sum + term.creditsAttempted, 0),
    basisNote: parseBasisNote(summary.basisNote, locale),
    terms,
  };
}

export interface TrendPoint {
  label: string;
  value: number;
}

/**
 * Running cumulative GPA, oldest term first. The last point takes the server
 * cumulative value when present so the chart ends on the official number.
 */
export function cumulativeTrend(terms: readonly TranscriptTerm[], serverCumulative: number | null, prefix = 'T'): TrendPoint[] {
  const chronological = [...terms].reverse();
  let points = 0;
  let credits = 0;
  return chronological.map((term, index) => {
    const termGpa = term.gpa ?? 0;
    points += termGpa * term.creditsAttempted;
    credits += term.creditsAttempted;
    let value = credits > 0 ? points / credits : termGpa;
    if (index === chronological.length - 1 && serverCumulative !== null) value = serverCumulative;
    return { label: `${prefix}${index + 1}`, value: Math.round(value * 100) / 100 };
  });
}
