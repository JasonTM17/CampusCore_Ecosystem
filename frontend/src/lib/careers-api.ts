import api from '@/lib/api';
import { assertUploadFile } from '@/lib/upload-validation';

/**
 * Simulated careers board client (contract §9, phase-12). Opportunities
 * move DRAFT → IN_REVIEW → PUBLISHED → PAUSED → CLOSED (IN_REVIEW →
 * REJECTED; PAUSED → PUBLISHED); applications move SUBMITTED → REVIEWING
 * → INTERVIEW → OFFER → REJECTED | WITHDRAWN. Org recruiters act only
 * inside their granted organizations; platform reviewers (grant with
 * empty orgId) moderate publication and can never publish their own
 * submission. Candidates see only PUBLISHED postings and their own
 * applications — a foreign application id answers the same
 * APPLICATION_NOT_FOUND a missing id does.
 */

export type OpportunityStatus =
  'DRAFT' | 'IN_REVIEW' | 'PUBLISHED' | 'PAUSED' | 'CLOSED' | 'REJECTED';
export type ApplicationStatus =
  'SUBMITTED' | 'REVIEWING' | 'INTERVIEW' | 'OFFER' | 'REJECTED' | 'WITHDRAWN';
export type ApplicationStep = 'REVIEWING' | 'INTERVIEW' | 'OFFER';

export interface CareerOrganization {
  id: string;
  name: string;
  description: string | null;
  version: number;
}

export interface CareerOpportunity {
  id: string;
  organizationId: string;
  organizationName: string | null;
  title: string;
  description: string | null;
  location: string | null;
  employmentType: string | null;
  salaryText: string | null;
  status: OpportunityStatus;
  submittedBy: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  publishedAt: string | null;
  pausedAt: string | null;
  closedAt: string | null;
  moderationReason: string | null;
  version: number;
  createdAt: string;
}

export interface CareerAttachment {
  id: string;
  fileName: string;
  contentType: string;
  checksum: string | null;
  createdAt: string;
}

export interface CareerApplication {
  id: string;
  opportunityId: string;
  opportunityTitle: string | null;
  organizationId: string;
  organizationName: string | null;
  candidateUserId: string;
  candidateEmail: string | null;
  status: ApplicationStatus;
  coverLetter: string | null;
  submittedAt: string | null;
  statusChangedBy: string | null;
  statusChangedAt: string | null;
  moderationReason: string | null;
  version: number;
  createdAt: string;
  attachments: CareerAttachment[];
}

export interface CareerStaffGrant {
  id: string;
  userId: string;
  scope: string;
  organizationId: string;
  grantedBy: string;
  createdAt: string;
}

export function newCareerIdempotencyKey(): string {
  return globalThis.crypto?.randomUUID?.() ?? `car-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function idempotencyHeaders(key: string) {
  return { headers: { 'Idempotency-Key': key } };
}

export const careersApi = {
  // ---------------------------- candidate -----------------------------
  organizations: async (): Promise<CareerOrganization[]> => {
    const response = await api.get<CareerOrganization[]>('/careers/organizations');
    return response.data;
  },
  opportunities: async (query?: string): Promise<CareerOpportunity[]> => {
    const response = await api.get<CareerOpportunity[]>('/careers/opportunities', {
      params: query ? { query } : {},
    });
    return response.data;
  },
  opportunity: async (opportunityId: string): Promise<CareerOpportunity> => {
    const response = await api.get<CareerOpportunity>(`/careers/opportunities/${opportunityId}`);
    return response.data;
  },
  myApplications: async (): Promise<CareerApplication[]> => {
    const response = await api.get<CareerApplication[]>('/careers/applications/my');
    return response.data;
  },
  myApplication: async (applicationId: string): Promise<CareerApplication> => {
    const response = await api.get<CareerApplication>(`/careers/applications/${applicationId}`);
    return response.data;
  },
  apply: async (opportunityId: string, coverLetter: string,
      idempotencyKey: string): Promise<CareerApplication> => {
    const response = await api.post<CareerApplication>(
      '/careers/applications', { opportunityId, coverLetter },
      idempotencyHeaders(idempotencyKey));
    return response.data;
  },
  withdraw: async (applicationId: string, expectedVersion: number,
      idempotencyKey: string): Promise<CareerApplication> => {
    const response = await api.post<CareerApplication>(
      `/careers/applications/${applicationId}/withdraw`, { expectedVersion },
      idempotencyHeaders(idempotencyKey));
    return response.data;
  },
  uploadAttachment: async (applicationId: string, file: File,
      idempotencyKey: string): Promise<CareerApplication> => {
    // Refuses before the bytes are ever buffered (UploadValidationError).
    assertUploadFile(file, 'documents');
    const dataBase64 = await fileToBase64(file);
    const response = await api.post<CareerApplication>(
      `/careers/applications/${applicationId}/attachments`,
      {
        fileName: file.name,
        contentType: file.type || 'application/octet-stream',
        dataBase64,
      },
      idempotencyHeaders(idempotencyKey));
    return response.data;
  },

  // ------------------------------- staff ------------------------------
  myOrganizations: async (): Promise<CareerOrganization[]> => {
    const response = await api.get<CareerOrganization[]>('/careers/staff/organizations/my');
    return response.data;
  },
  opportunityQueue: async (status?: OpportunityStatus | ''): Promise<CareerOpportunity[]> => {
    const response = await api.get<CareerOpportunity[]>('/careers/staff/opportunities', {
      params: status ? { status } : {},
    });
    return response.data;
  },
  staffOpportunity: async (opportunityId: string): Promise<CareerOpportunity> => {
    const response = await api.get<CareerOpportunity>(
      `/careers/staff/opportunities/${opportunityId}`);
    return response.data;
  },
  createOpportunity: async (payload: {
    organizationId: string; title: string; description?: string;
    location?: string; employmentType?: string; salaryText?: string;
  }): Promise<CareerOpportunity> => {
    const response = await api.post<CareerOpportunity>('/careers/staff/opportunities', payload);
    return response.data;
  },
  submitReview: async (opportunityId: string, expectedVersion: number): Promise<CareerOpportunity> => {
    const response = await api.post<CareerOpportunity>(
      `/careers/staff/opportunities/${opportunityId}/submit-review`, { expectedVersion });
    return response.data;
  },
  pauseOpportunity: async (opportunityId: string, expectedVersion: number,
      reason: string): Promise<CareerOpportunity> => {
    const response = await api.post<CareerOpportunity>(
      `/careers/staff/opportunities/${opportunityId}/pause`, { expectedVersion, reason });
    return response.data;
  },
  resumeOpportunity: async (opportunityId: string, expectedVersion: number): Promise<CareerOpportunity> => {
    const response = await api.post<CareerOpportunity>(
      `/careers/staff/opportunities/${opportunityId}/resume`, { expectedVersion });
    return response.data;
  },
  closeOpportunity: async (opportunityId: string, expectedVersion: number,
      reason: string): Promise<CareerOpportunity> => {
    const response = await api.post<CareerOpportunity>(
      `/careers/staff/opportunities/${opportunityId}/close`, { expectedVersion, reason });
    return response.data;
  },

  // ------------------------------ reviewer ----------------------------
  reviewQueue: async (): Promise<CareerOpportunity[]> => {
    const response = await api.get<CareerOpportunity[]>('/careers/staff/review-queue');
    return response.data;
  },
  publish: async (opportunityId: string, expectedVersion: number): Promise<CareerOpportunity> => {
    const response = await api.post<CareerOpportunity>(
      `/careers/staff/opportunities/${opportunityId}/publish`, { expectedVersion });
    return response.data;
  },
  rejectOpportunity: async (opportunityId: string, expectedVersion: number,
      reason: string): Promise<CareerOpportunity> => {
    const response = await api.post<CareerOpportunity>(
      `/careers/staff/opportunities/${opportunityId}/reject`, { expectedVersion, reason });
    return response.data;
  },

  // ----------------------- staff applications -------------------------
  applicationQueue: async (opportunityId?: string,
      status?: ApplicationStatus | ''): Promise<CareerApplication[]> => {
    const params: Record<string, string> = {};
    if (opportunityId) params.opportunityId = opportunityId;
    if (status) params.status = status;
    const response = await api.get<CareerApplication[]>('/careers/staff/applications', { params });
    return response.data;
  },
  staffApplication: async (applicationId: string): Promise<CareerApplication> => {
    const response = await api.get<CareerApplication>(
      `/careers/staff/applications/${applicationId}`);
    return response.data;
  },
  transitionApplication: async (applicationId: string, toStatus: ApplicationStep,
      expectedVersion: number): Promise<CareerApplication> => {
    const response = await api.post<CareerApplication>(
      `/careers/staff/applications/${applicationId}/transition`,
      { toStatus, expectedVersion });
    return response.data;
  },
  rejectApplication: async (applicationId: string, expectedVersion: number,
      reason: string): Promise<CareerApplication> => {
    const response = await api.post<CareerApplication>(
      `/careers/staff/applications/${applicationId}/reject`,
      { expectedVersion, reason });
    return response.data;
  },
};

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? '');
      resolve(result.includes(',') ? result.slice(result.indexOf(',') + 1) : result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
