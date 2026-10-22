import api from '@/lib/api';

/**
 * Learning domain client (contract D5 / §6, phase-09). Staff calls resolve
 * lecturer authority server-side — the section's assigned lecturer only;
 * SECTION_NOT_ASSIGNED / NOT_ENROLLED are authorization answers, not crashes.
 */

export type AssignmentStatus = 'DRAFT' | 'PUBLISHED' | 'CLOSED' | 'ARCHIVED';
export type SubmissionStatus =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'RETURNED'
  | 'RESUBMITTED'
  | 'REVIEWED';

export interface LearningMaterial {
  id: string;
  sectionId: string;
  title: string;
  description: string | null;
  fileName: string | null;
  contentType: string | null;
  sizeBytes: number | null;
  checksum: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface LearningAssignment {
  id: string;
  sectionId: string;
  title: string;
  description: string | null;
  deadlineAt: string | null;
  maxScore: number | null;
  status: AssignmentStatus;
  version: number;
  createdAt: string;
  updatedAt: string;
  mySubmissionId: string | null;
  mySubmissionStatus: SubmissionStatus | null;
}

export interface LearningSubmission {
  id: string;
  assignmentId: string;
  studentId: string;
  status: SubmissionStatus;
  currentRevisionId: string | null;
  submittedAt: string | null;
  returnedAt: string | null;
  reviewedAt: string | null;
  version: number;
  studentName: string | null;
  studentEmail: string | null;
}

export interface LearningRevision {
  id: string;
  submissionId: string;
  revisionNo: number;
  fileName: string | null;
  contentType: string | null;
  sizeBytes: number | null;
  checksum: string | null;
  textBody: string | null;
  submittedAt: string;
}

export interface LearningFeedback {
  id: string;
  submissionId: string;
  revisionId: string | null;
  authorId: string;
  comment: string | null;
  score: number | null;
  createdAt: string;
}

export interface LearningRosterRow {
  enrollmentId: string;
  studentId: string;
  studentName: string | null;
  studentEmail: string | null;
  enrollmentStatus: string;
  submissionId: string | null;
  submissionStatus: SubmissionStatus | null;
  submittedAt: string | null;
}

export interface LearningSection {
  sectionId: string;
  sectionNumber: string;
  courseCode: string;
  courseName: string;
  enrollmentStatus: string;
  materialCount: number;
  assignmentCount: number;
}

export interface FilePayload {
  fileName: string;
  contentType: string;
  contentBase64: string;
  checksum: string;
}

export interface AssignmentUpsert {
  title: string;
  description?: string | null;
  deadlineAt?: string | null;
  maxScore?: number | null;
  version?: number;
}

export interface MaterialUpsert {
  title: string;
  description?: string | null;
  version?: number;
  file?: FilePayload | null;
}

export interface SubmissionUpsert {
  textBody?: string | null;
  fileName?: string | null;
  contentType?: string | null;
  contentBase64?: string | null;
  checksum?: string | null;
}

export function newLearningIdempotencyKey(): string {
  return globalThis.crypto?.randomUUID?.() ?? `lm-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Read a picked file into the (base64, sha256) pair the API expects. */
export async function readFilePayload(file: File): Promise<FilePayload> {
  const buffer = await file.arrayBuffer();
  const digest = await globalThis.crypto.subtle.digest('SHA-256', buffer);
  const hash = Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const chunk = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
  }
  return {
    fileName: file.name,
    contentType: file.type || 'application/octet-stream',
    contentBase64: btoa(binary),
    checksum: hash,
  };
}

function idempotencyHeaders(key: string) {
  return { headers: { 'Idempotency-Key': key } };
}

async function downloadFile(path: string, fallbackName: string): Promise<void> {
  const response = await api.get<Blob>(path, { responseType: 'blob' });
  const disposition = String(response.headers['content-disposition'] ?? '');
  const match = /filename\*?=(?:UTF-8''|"?)([^";]+)/i.exec(disposition);
  const name = match ? decodeURIComponent(match[1].replace(/"$/, '')) : fallbackName;
  const url = URL.createObjectURL(response.data);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export const learningApi = {
  // ------------------------------ student ------------------------------
  mySections: async (): Promise<LearningSection[]> => {
    const response = await api.get<LearningSection[]>('/learning/sections');
    return response.data;
  },
  materials: async (sectionId: string): Promise<LearningMaterial[]> => {
    const response = await api.get<LearningMaterial[]>(`/learning/sections/${sectionId}/materials`);
    return response.data;
  },
  downloadMaterial: (materialId: string, fallbackName = 'material'): Promise<void> =>
    downloadFile(`/learning/materials/${materialId}/file`, fallbackName),
  assignments: async (sectionId: string): Promise<LearningAssignment[]> => {
    const response = await api.get<LearningAssignment[]>(`/learning/sections/${sectionId}/assignments`);
    return response.data;
  },
  assignment: async (assignmentId: string): Promise<LearningAssignment> => {
    const response = await api.get<LearningAssignment>(`/learning/assignments/${assignmentId}`);
    return response.data;
  },
  openDraft: async (assignmentId: string, idempotencyKey: string): Promise<LearningSubmission> => {
    const response = await api.post<LearningSubmission>(
      `/learning/assignments/${assignmentId}/draft`, null, idempotencyHeaders(idempotencyKey));
    return response.data;
  },
  saveDraft: async (submissionId: string, payload: SubmissionUpsert): Promise<LearningSubmission> => {
    const response = await api.put<LearningSubmission>(`/learning/submissions/${submissionId}/draft`, payload);
    return response.data;
  },
  submit: async (assignmentId: string, idempotencyKey: string): Promise<LearningSubmission> => {
    const response = await api.post<LearningSubmission>(
      `/learning/assignments/${assignmentId}/submit`, null, idempotencyHeaders(idempotencyKey));
    return response.data;
  },
  resubmit: async (assignmentId: string, payload: SubmissionUpsert, idempotencyKey: string): Promise<LearningSubmission> => {
    const response = await api.post<LearningSubmission>(
      `/learning/assignments/${assignmentId}/resubmit`, payload, idempotencyHeaders(idempotencyKey));
    return response.data;
  },
  mySubmissions: async (sectionId: string): Promise<LearningSubmission[]> => {
    const response = await api.get<LearningSubmission[]>(`/learning/sections/${sectionId}/submissions`);
    return response.data;
  },
  mySubmission: async (submissionId: string): Promise<LearningSubmission> => {
    const response = await api.get<LearningSubmission>(`/learning/submissions/${submissionId}`);
    return response.data;
  },
  myRevisions: async (submissionId: string): Promise<LearningRevision[]> => {
    const response = await api.get<LearningRevision[]>(`/learning/submissions/${submissionId}/revisions`);
    return response.data;
  },
  myFeedback: async (submissionId: string): Promise<LearningFeedback[]> => {
    const response = await api.get<LearningFeedback[]>(`/learning/submissions/${submissionId}/feedback`);
    return response.data;
  },
  downloadRevision: (revisionId: string, fallbackName = 'submission'): Promise<void> =>
    downloadFile(`/learning/revisions/${revisionId}/file`, fallbackName),

  // ------------------------------- staff -------------------------------
  staffMaterials: async (sectionId: string): Promise<LearningMaterial[]> => {
    const response = await api.get<LearningMaterial[]>(`/learning/staff/sections/${sectionId}/materials`);
    return response.data;
  },
  staffCreateMaterial: async (sectionId: string, payload: MaterialUpsert): Promise<LearningMaterial> => {
    const response = await api.post<LearningMaterial>(`/learning/staff/sections/${sectionId}/materials`, payload);
    return response.data;
  },
  staffUpdateMaterial: async (materialId: string, payload: MaterialUpsert): Promise<LearningMaterial> => {
    const response = await api.put<LearningMaterial>(`/learning/staff/materials/${materialId}`, payload);
    return response.data;
  },
  staffDeleteMaterial: async (materialId: string, version: number): Promise<void> => {
    await api.delete(`/learning/staff/materials/${materialId}`, { params: { version } });
  },
  staffDownloadMaterial: (materialId: string, fallbackName = 'material'): Promise<void> =>
    downloadFile(`/learning/staff/materials/${materialId}/file`, fallbackName),
  staffAssignments: async (sectionId: string): Promise<LearningAssignment[]> => {
    const response = await api.get<LearningAssignment[]>(`/learning/staff/sections/${sectionId}/assignments`);
    return response.data;
  },
  staffAssignment: async (assignmentId: string): Promise<LearningAssignment> => {
    const response = await api.get<LearningAssignment>(`/learning/staff/assignments/${assignmentId}`);
    return response.data;
  },
  staffCreateAssignment: async (sectionId: string, payload: AssignmentUpsert): Promise<LearningAssignment> => {
    const response = await api.post<LearningAssignment>(`/learning/staff/sections/${sectionId}/assignments`, payload);
    return response.data;
  },
  staffUpdateAssignment: async (assignmentId: string, payload: AssignmentUpsert): Promise<LearningAssignment> => {
    const response = await api.put<LearningAssignment>(`/learning/staff/assignments/${assignmentId}`, payload);
    return response.data;
  },
  staffPublish: async (assignmentId: string): Promise<LearningAssignment> => {
    const response = await api.post<LearningAssignment>(`/learning/staff/assignments/${assignmentId}/publish`);
    return response.data;
  },
  staffClose: async (assignmentId: string): Promise<LearningAssignment> => {
    const response = await api.post<LearningAssignment>(`/learning/staff/assignments/${assignmentId}/close`);
    return response.data;
  },
  staffArchive: async (assignmentId: string): Promise<LearningAssignment> => {
    const response = await api.post<LearningAssignment>(`/learning/staff/assignments/${assignmentId}/archive`);
    return response.data;
  },
  staffRoster: async (assignmentId: string): Promise<LearningRosterRow[]> => {
    const response = await api.get<LearningRosterRow[]>(`/learning/staff/assignments/${assignmentId}/roster`);
    return response.data;
  },
  staffSubmission: async (submissionId: string): Promise<LearningSubmission> => {
    const response = await api.get<LearningSubmission>(`/learning/staff/submissions/${submissionId}`);
    return response.data;
  },
  staffRevisions: async (submissionId: string): Promise<LearningRevision[]> => {
    const response = await api.get<LearningRevision[]>(`/learning/staff/submissions/${submissionId}/revisions`);
    return response.data;
  },
  staffFeedback: async (submissionId: string): Promise<LearningFeedback[]> => {
    const response = await api.get<LearningFeedback[]>(`/learning/staff/submissions/${submissionId}/feedback`);
    return response.data;
  },
  staffReturn: async (submissionId: string, payload: { comment: string; score?: number | null; expectedVersion?: number }): Promise<LearningSubmission> => {
    const response = await api.post<LearningSubmission>(`/learning/staff/submissions/${submissionId}/return`, payload);
    return response.data;
  },
  staffReview: async (submissionId: string, payload: { comment?: string | null; score?: number | null; expectedVersion?: number }): Promise<LearningSubmission> => {
    const response = await api.post<LearningSubmission>(`/learning/staff/submissions/${submissionId}/review`, payload);
    return response.data;
  },
  staffDownloadRevision: (revisionId: string, fallbackName = 'submission'): Promise<void> =>
    downloadFile(`/learning/staff/revisions/${revisionId}/file`, fallbackName),
};

/** True when the caller holds no authority for the staff lane. */
export function isLearningStaffDenied(error: unknown): boolean {
  const code = (error as { response?: { data?: { code?: string } } })?.response?.data?.code;
  const status = (error as { response?: { status?: number } })?.response?.status;
  return status === 403 && code === 'SECTION_NOT_ASSIGNED';
}
