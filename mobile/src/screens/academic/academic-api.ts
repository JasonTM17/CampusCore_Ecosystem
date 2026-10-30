// Typed academic reads and idempotent registration writes over the shared
// client. Every call hits the live API; nothing here fabricates data.

import { getNetworkStateAsync } from 'expo-network';

import { apiClient, campusApi, createAssistantClientRequestId } from '../../api/client';
import { getFileAdapter } from '../../files/file-adapter';
import type { FileActionResult } from '../../files/file-adapter';
import type { AcademicEnrollment, AcademicSemester } from './academic-model';
import { createAttemptKeys } from './idempotency-attempts';
import type { BrowseSection } from './registration-browse';
import type { GradeRecordLike } from './gpa';

export interface AcademicGradeRecord extends GradeRecordLike {
  id: string;
  courseCode: string;
  courseName: string;
  courseNameEn?: string | null;
  courseNameVi?: string | null;
  credits?: number | null;
  sectionCode?: string | null;
  lecturerName?: string | null;
  semesterId?: string | null;
  semester?: string | null;
  semesterNameEn?: string | null;
  semesterNameVi?: string | null;
  processScore?: number | null;
  finalExamScore?: number | null;
}

export interface AttendanceSummaryRow {
  sectionId: string;
  courseCode: string;
  courseName: string;
  courseNameEn?: string | null;
  courseNameVi?: string | null;
  total: number;
  present: number;
  absent: number;
  late: number;
  excused: number;
  attendanceRate: number;
}

export interface AttendanceRecordRow {
  id: string;
  date: string;
  status: string;
  notes?: string | null;
  sectionId?: string;
  section?: { sectionNumber?: string; course?: { code?: string; name?: string } } | null;
}

export interface CurriculumCourse {
  courseId: string;
  code: string;
  name: string;
  nameEn?: string | null;
  nameVi?: string | null;
  credits: number;
  year: number;
  semester: number;
  isMandatory: boolean;
  status: 'COMPLETED' | 'IN_PROGRESS' | 'NOT_STARTED';
  finalGrade?: number | null;
  letterGrade?: string | null;
  prerequisites?: string[];
}

export interface MyCurriculum {
  curriculum: { id: string; code: string; name: string; nameEn?: string | null; nameVi?: string | null; totalCredits: number };
  courses: CurriculumCourse[];
}

export interface RegistrationRound {
  id: string;
  status: string;
  kind?: string;
  semesterId?: string;
  name?: string;
  windowStart?: string;
  windowEnd?: string;
  creditLimit?: number;
}

export interface RegistrationEligibility {
  eligible: boolean;
  creditLimit?: number;
  creditsUsed?: number;
  creditsRemaining?: number;
  windowStart?: string;
  windowEnd?: string;
}

export interface RegistrationWorkspace {
  sections: BrowseSection[];
  enrollments: AcademicEnrollment[];
  roundOpen: boolean;
  eligibility: RegistrationEligibility | null;
  /** Server code when the catalog is closed to this student, for example WINDOW_CLOSED. */
  closedReason: string | null;
}

const CLOSED_CODES = ['WINDOW_CLOSED', 'COHORT_INELIGIBLE', 'ROUND_NOT_FOUND'];

function listOf<T>(payload: unknown): T[] {
  if (Array.isArray(payload)) return payload as T[];
  const data = (payload as { data?: unknown } | null)?.data;
  return Array.isArray(data) ? (data as T[]) : [];
}

const query = (semesterId?: string | null) => (semesterId ? `?semesterId=${encodeURIComponent(semesterId)}` : '');

export const academicApi = {
  semesters: async (): Promise<AcademicSemester[]> => listOf<AcademicSemester>(await apiClient.get<unknown>('/semesters')),
  enrollments: async (semesterId?: string | null): Promise<AcademicEnrollment[]> =>
    (await campusApi.enrollments(semesterId ?? undefined)) as unknown as AcademicEnrollment[],
  grades: async (semesterId?: string | null): Promise<AcademicGradeRecord[]> =>
    (await campusApi.grades(semesterId ?? undefined)) as unknown as AcademicGradeRecord[],
  transcript: (): Promise<unknown> => campusApi.transcript(),
  curriculum: (): Promise<MyCurriculum> => apiClient.get<MyCurriculum>('/me/curriculum'),
  attendanceSummary: async (semesterId?: string | null): Promise<AttendanceSummaryRow[]> =>
    (await campusApi.attendanceSummary(semesterId ?? undefined)) as unknown as AttendanceSummaryRow[],
  attendanceRecords: async (semesterId?: string | null): Promise<AttendanceRecordRow[]> =>
    listOf<AttendanceRecordRow>(await apiClient.get<unknown>(`/attendance/my${query(semesterId)}`)),

  /** Catalog, rounds, eligibility and enrollments. A closed window is data, any other failure throws. */
  async registrationWorkspace(): Promise<RegistrationWorkspace> {
    const enrollments = await academicApi.enrollments();
    try {
      const [rounds, sections] = await Promise.all([campusApi.registrationRounds(), campusApi.registrationSections()]);
      const eligibility = await apiClient.get<RegistrationEligibility>('/me/registration/eligibility').catch(() => null);
      return {
        sections: sections as unknown as BrowseSection[],
        enrollments,
        roundOpen: (rounds as RegistrationRound[]).some((round) => round.status === 'OPEN'),
        eligibility,
        closedReason: null,
      };
    } catch (error) {
      const code = (error as { code?: string } | null)?.code;
      if (code && CLOSED_CODES.includes(code)) {
        return { sections: [], enrollments, roundOpen: false, eligibility: null, closedReason: code };
      }
      throw error;
    }
  },
};

/* ---------- idempotent registration writes ---------- */

const attemptKeys = createAttemptKeys(createAssistantClientRequestId);

/** Keys are module-scoped so a retry after a lost response reuses the attempt's key. */
export async function enrollInSection(sectionId: string, locale: 'vi' | 'en'): Promise<AcademicEnrollment> {
  const key = attemptKeys.keyFor('enroll', sectionId);
  try {
    const result = await apiClient.post<AcademicEnrollment>('/me/enrollments', { sectionId, locale }, { headers: { 'Idempotency-Key': key } });
    attemptKeys.settle('enroll', sectionId);
    return result;
  } catch (error) {
    attemptKeys.settle('enroll', sectionId, error);
    throw error;
  }
}

export async function dropEnrollmentById(enrollmentId: string): Promise<void> {
  const key = attemptKeys.keyFor('drop', enrollmentId);
  try {
    await apiClient.post<unknown>(`/me/enrollments/${enrollmentId}/drop`, {}, { headers: { 'Idempotency-Key': key } });
    attemptKeys.settle('drop', enrollmentId);
  } catch (error) {
    attemptKeys.settle('drop', enrollmentId, error);
    throw error;
  }
}

/** True only when the OS reports no link; an unknown state allows the attempt. */
export async function isDeviceOffline(): Promise<boolean> {
  try {
    return (await getNetworkStateAsync()).isConnected === false;
  } catch {
    return false;
  }
}

/** Offline, or the failure says the request never reached the server. */
export function isOfflineError(error: unknown): boolean {
  const status = (error as { status?: unknown } | null)?.status;
  return status === 0 || error instanceof TypeError;
}

/* ---------- file hand-off ---------- */

export type FileOutcome =
  | { status: 'done' | 'cancelled' }
  | { status: 'unavailable'; reason: string }
  | { status: 'failed'; reason: string };

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

const outcome = (result: FileActionResult): FileOutcome => result;

/** Registration slip: fetched through the authenticated client, then saved through the file adapter. */
export async function saveRegistrationSlip(semesterId: string | null): Promise<FileOutcome> {
  const adapter = getFileAdapter();
  const capability = adapter.capability('save');
  if (!capability.available) return { status: 'unavailable', reason: capability.reason };
  try {
    const slip = await apiClient.download(`/me/registration/slip${query(semesterId)}`);
    if (slip.data.byteLength === 0) return { status: 'failed', reason: 'EMPTY' };
    return outcome(await adapter.save({
      uri: `data:application/pdf;base64,${toBase64(slip.data)}`,
      name: slip.fileName ?? 'registration-slip.pdf',
      mimeType: slip.contentType ?? 'application/pdf',
    }));
  } catch (error) {
    return { status: 'failed', reason: (error as { code?: string } | null)?.code ?? 'ERROR' };
  }
}

export function timetableShareCapability(): { available: true } | { available: false; reason: string } {
  return getFileAdapter().capability('share');
}

export async function shareTimetable(uri: string, name: string): Promise<FileOutcome> {
  const adapter = getFileAdapter();
  const capability = adapter.capability('share');
  if (!capability.available) return { status: 'unavailable', reason: capability.reason };
  return outcome(await adapter.share({ uri, name, mimeType: 'text/calendar' }));
}
