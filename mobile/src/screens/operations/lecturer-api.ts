// Lecturer reads and writes over the shared client. Every call hits the live
// API; nothing here fabricates data. The attendance and grade endpoints carry
// no row version or idempotency key, so the writes are safe by construction:
// both are full-state PUTs that converge on replay, attendance re-reads the
// server just before saving, and grades send only the rows that changed.

import { campusApi } from '../../api/client';
import type { AttendanceRecord, AttendanceRosterEntry, StudentGradeRow } from '../../api/client';
import { getFileAdapter } from '../../files/file-adapter';
import type { FileActionResult } from '../../files/file-adapter';
import { isStaleAttendance } from './lecturer-model';
import type { AttendanceBaseline, AttendanceSaveRecord, GradeChange } from './lecturer-model';
import { csvDataUri } from './lecturer-csv';

/** Carries its own key: the query hook keeps the previous key's data on screen until the next fetch lands. */
export interface AttendanceSheet {
  sectionId: string;
  date: string;
  roster: AttendanceRosterEntry[];
  marks: AttendanceRecord[];
}

/** A 404 for the day's sheet means nothing is marked yet; every other failure surfaces. */
async function readSheet(sectionId: string, date: string): Promise<AttendanceSheet> {
  const [roster, marks] = await Promise.all([
    campusApi.attendanceRoster(sectionId),
    campusApi.sectionAttendance(sectionId, date).catch((error: unknown) => {
      if ((error as { status?: number } | null)?.status === 404) return [] as AttendanceRecord[];
      throw error;
    }),
  ]);
  return { sectionId, date, roster, marks };
}

export interface SectionGradeSheet {
  sectionId: string;
  rows: StudentGradeRow[];
}

export class StaleAttendanceError extends Error {
  constructor() {
    super('ATTENDANCE_STALE');
    this.name = 'StaleAttendanceError';
  }
}

export const lecturerApi = {
  schedule: () => campusApi.lecturerSchedule(),
  gradingSections: () => campusApi.lecturerGradingSections(),
  attendanceSheet: readSheet,

  /** Re-reads the server first; throws StaleAttendanceError instead of overwriting a newer sheet. */
  async saveAttendance(
    sectionId: string,
    date: string,
    records: readonly AttendanceSaveRecord[],
    baseline: AttendanceBaseline,
  ): Promise<number> {
    const latest = await readSheet(sectionId, date);
    if (isStaleAttendance(baseline, latest.roster, latest.marks)) throw new StaleAttendanceError();
    const result = await campusApi.saveSectionAttendance(sectionId, date, records as AttendanceRecord[]);
    return result.updatedCount ?? records.length;
  },

  async sectionGrades(sectionId: string): Promise<SectionGradeSheet> {
    return { sectionId, rows: await campusApi.sectionGrades(sectionId) };
  },
  saveGrades: (sectionId: string, changes: readonly GradeChange[]) =>
    campusApi.saveSectionGrades(sectionId, changes as GradeChange[]),
  publishGrades: (sectionId: string) => campusApi.publishSectionGrades(sectionId),
};

export type CsvOutcome =
  | { status: 'done' | 'cancelled' }
  | { status: 'unavailable'; reason: string }
  | { status: 'failed'; reason: string };

export const csvShareAvailable = (): boolean => getFileAdapter().capability('share').available;

/** Shares a CSV through the file adapter and reports only what the adapter returned. */
export async function shareCsv(content: string, name: string): Promise<CsvOutcome> {
  const adapter = getFileAdapter();
  const capability = adapter.capability('share');
  if (!capability.available) return { status: 'unavailable', reason: capability.reason };
  const result: FileActionResult = await adapter.share({ uri: csvDataUri(content), name, mimeType: 'text/csv' });
  return result;
}
