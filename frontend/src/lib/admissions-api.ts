import api from '@/lib/api';

/**
 * Simulated admissions client (contract §7, phase-10). Applicants are auth
 * users — an ACCEPTED decision never creates a Student record and always
 * carries decisionLabel='SIMULATED'. Foreign application ids answer the same
 * APPLICATION_NOT_FOUND a missing id does.
 */

export type ApplicationStatus =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'IN_REVIEW'
  | 'RETURNED'
  | 'ACCEPTED'
  | 'REJECTED'
  | 'WITHDRAWN';

export interface AdmissionAttachment {
  id: string;
  fileName: string;
  contentType: string | null;
  sizeBytes: number | null;
  checksum: string;
  createdAt: string;
}

export interface AdmissionReview {
  id: string;
  reviewerId: string;
  action: 'CLAIM' | 'RETURN' | 'DECISION';
  checklist: string | null;
  note: string | null;
  decision: 'ACCEPTED' | 'REJECTED' | null;
  createdAt: string;
}

export interface AdmissionApplication {
  id: string;
  applicantUserId: string;
  applicantEmail: string | null;
  cycle: string;
  status: ApplicationStatus;
  fullName: string | null;
  dateOfBirth: string | null;
  schoolName: string | null;
  intendedMajor: string | null;
  essay: string | null;
  claimedBy: string | null;
  submittedAt: string | null;
  decision: 'ACCEPTED' | 'REJECTED' | null;
  decisionLabel: 'SIMULATED' | null;
  decisionAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  attachments: AdmissionAttachment[];
  reviews: AdmissionReview[];
}

export interface ChecklistItem {
  item: string;
  result?: 'PASS' | 'FAIL' | 'NOTE';
  note?: string;
}

export interface ApplicationForm {
  fullName: string;
  dateOfBirth: string;
  schoolName: string;
  intendedMajor: string;
  essay: string;
}

export function newAdmissionsIdempotencyKey(): string {
  return globalThis.crypto?.randomUUID?.() ?? `ad-${Date.now()}-${Math.random().toString(36).slice(2)}`;
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

export const admissionsApi = {
  // ------------------------------ applicant ------------------------------
  myApplications: async (): Promise<AdmissionApplication[]> => {
    const response = await api.get<AdmissionApplication[]>('/admissions/applications/my');
    return response.data;
  },
  create: async (cycle: string, idempotencyKey: string): Promise<AdmissionApplication> => {
    const response = await api.post<AdmissionApplication>(
      '/admissions/applications', { cycle }, idempotencyHeaders(idempotencyKey));
    return response.data;
  },
  application: async (id: string): Promise<AdmissionApplication> => {
    const response = await api.get<AdmissionApplication>(`/admissions/applications/${id}`);
    return response.data;
  },
  save: async (id: string, form: ApplicationForm, expectedVersion: number): Promise<AdmissionApplication> => {
    const response = await api.put<AdmissionApplication>(
      `/admissions/applications/${id}`, { ...form, expectedVersion });
    return response.data;
  },
  submit: async (id: string, expectedVersion: number, idempotencyKey: string): Promise<AdmissionApplication> => {
    const response = await api.post<AdmissionApplication>(
      `/admissions/applications/${id}/submit`, { expectedVersion }, idempotencyHeaders(idempotencyKey));
    return response.data;
  },
  withdraw: async (id: string, expectedVersion: number, idempotencyKey: string): Promise<AdmissionApplication> => {
    const response = await api.post<AdmissionApplication>(
      `/admissions/applications/${id}/withdraw`, { expectedVersion }, idempotencyHeaders(idempotencyKey));
    return response.data;
  },
  uploadAttachment: async (id: string, fileName: string, contentType: string,
      dataBase64: string, idempotencyKey: string): Promise<AdmissionApplication> => {
    const response = await api.post<AdmissionApplication>(
      `/admissions/applications/${id}/attachments`, { fileName, contentType, dataBase64 },
      idempotencyHeaders(idempotencyKey));
    return response.data;
  },
  deleteAttachment: async (id: string, attachmentId: string, idempotencyKey: string): Promise<AdmissionApplication> => {
    const response = await api.delete<AdmissionApplication>(
      `/admissions/applications/${id}/attachments/${attachmentId}`,
      idempotencyHeaders(idempotencyKey));
    return response.data;
  },
  downloadAttachment: (id: string, attachmentId: string, fallbackName = 'attachment'): Promise<void> =>
    downloadFile(`/admissions/applications/${id}/attachments/${attachmentId}/file`, fallbackName),

  // -------------------------------- staff --------------------------------
  queue: async (status?: ApplicationStatus | ''): Promise<AdmissionApplication[]> => {
    const response = await api.get<AdmissionApplication[]>('/admissions/staff/queue', {
      params: status ? { status } : {},
    });
    return response.data;
  },
  staffApplication: async (id: string): Promise<AdmissionApplication> => {
    const response = await api.get<AdmissionApplication>(`/admissions/staff/applications/${id}`);
    return response.data;
  },
  claim: async (id: string, expectedVersion: number): Promise<AdmissionApplication> => {
    const response = await api.post<AdmissionApplication>(
      `/admissions/staff/applications/${id}/claim`, { expectedVersion });
    return response.data;
  },
  returnApplication: async (id: string, checklist: ChecklistItem[], note: string, expectedVersion: number): Promise<AdmissionApplication> => {
    const response = await api.post<AdmissionApplication>(
      `/admissions/staff/applications/${id}/return`, { checklist, note, expectedVersion });
    return response.data;
  },
  decide: async (id: string, decision: 'ACCEPTED' | 'REJECTED', note: string, expectedVersion: number): Promise<AdmissionApplication> => {
    const response = await api.post<AdmissionApplication>(
      `/admissions/staff/applications/${id}/decision`, { decision, note, expectedVersion });
    return response.data;
  },
  staffDownloadAttachment: (id: string, attachmentId: string, fallbackName = 'attachment'): Promise<void> =>
    downloadFile(`/admissions/staff/applications/${id}/attachments/${attachmentId}/file`, fallbackName),
};
