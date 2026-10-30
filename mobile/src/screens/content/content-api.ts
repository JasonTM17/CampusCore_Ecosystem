// Live reads and idempotent writes for the content and service screens.
// Every call hits the API; preview data lives in preview-data.ts and is used
// only when the client is in preview mode. Public content uses the explicit
// public auth policy, so no Bearer token is ever sent for it.

import {
  apiClient,
  campusApi,
  createAssistantClientRequestId,
  type MobileAdmissionApplication,
  type MobileAdmissionForm,
  type MobileCareerApplication,
  type MobileLearningAssignment,
  type MobileLearningSubmission,
  type MobileNotification,
  type MobilePublicAnnouncement,
  type MobilePublicDoc,
} from '../../api/client';
import { parityApi, type SubmissionFormInput, type UploadFilePart } from '../../api/parity-api';
import { buildQuery, type PagedResult } from '../../api/paging';
import { createAttemptKeys } from '../academic/idempotency-attempts';
import { envelopeToPage } from './content-paging';

export interface PageRequest {
  /** 0-based window index. */
  page: number;
  limit: number;
  signal?: AbortSignal;
}

export interface AttachmentInfo {
  id: string;
  fileName?: string | null;
  contentType?: string | null;
  sizeBytes?: number | null;
}

export type AdmissionApplicationView = MobileAdmissionApplication & { attachments?: AttachmentInfo[] | null };
export type CareerApplicationView = MobileCareerApplication & { attachments?: AttachmentInfo[] | null };

const PUBLIC = { auth: 'public' } as const;
const enc = encodeURIComponent;

async function readEnvelope<T>(
  path: string,
  filters: Record<string, string | number | boolean | undefined>,
  request: PageRequest,
  auth?: typeof PUBLIC,
): Promise<PagedResult<T>> {
  const query = buildQuery({ ...filters, page: request.page + 1, limit: request.limit });
  const body = await apiClient.get<unknown>(`${path}${query}`, { ...(auth ?? {}), signal: request.signal });
  return envelopeToPage<T>(body, { page: request.page, limit: request.limit });
}

/** One idempotency key per intent; a retry after an unknown outcome reuses it. */
const attempts = createAttemptKeys(createAssistantClientRequestId);

async function keyed<T>(action: string, id: string, run: (key: string) => Promise<T>): Promise<T> {
  const key = attempts.keyFor(action, id);
  try {
    const result = await run(key);
    attempts.settle(action, id);
    return result;
  } catch (error) {
    attempts.settle(action, id, error);
    throw error;
  }
}

const idempotent = (key: string) => ({ headers: { 'Idempotency-Key': key } });

export const contentApi = {
  attempts,

  /* ----- public content ----- */
  news: (request: PageRequest) => readEnvelope<MobilePublicAnnouncement>('/announcements/public', {}, request, PUBLIC),
  newsDetail: (idOrSlug: string, signal?: AbortSignal) =>
    apiClient.get<MobilePublicAnnouncement>(`/announcements/public/${enc(idOrSlug)}`, { ...PUBLIC, signal }),
  docs: (request: PageRequest & { search?: string; category?: string; tag?: string }) =>
    readEnvelope<MobilePublicDoc>(
      '/public/docs',
      { search: request.search, category: request.category, tag: request.tag },
      request,
      PUBLIC,
    ),
  docDetail: (slug: string, signal?: AbortSignal) =>
    apiClient.get<MobilePublicDoc & { superseded?: boolean }>(`/public/docs/${enc(slug)}`, { ...PUBLIC, signal }),
  docRevision: (slug: string, revision: number, signal?: AbortSignal) =>
    apiClient.get<MobilePublicDoc & { superseded?: boolean }>(`/public/docs/${enc(slug)}/revisions/${revision}`, { ...PUBLIC, signal }),

  /* ----- announcements inbox and notifications ----- */
  announcementsInbox: (request: PageRequest) => readEnvelope<MobilePublicAnnouncement>('/announcements/my', {}, request),
  notifications: (request: PageRequest & { isRead?: boolean }) =>
    readEnvelope<MobileNotification>('/notifications/my', { isRead: request.isRead }, request),
  unreadCount: async (signal?: AbortSignal): Promise<number> => {
    const body = await apiClient.get<{ unreadCount?: number }>('/notifications/my/unread-count', { signal });
    return typeof body?.unreadCount === 'number' ? body.unreadCount : 0;
  },
  markNotificationRead: (id: string) => campusApi.markNotificationRead(id),
  markAllNotificationsRead: () => campusApi.markAllNotificationsRead(),
  deleteNotification: (id: string) => apiClient.delete<unknown>(`/notifications/my/${enc(id)}`),

  /* ----- records ----- */
  conduct: (signal?: AbortSignal) => apiClient.get<unknown>('/conduct/my', { signal }),

  /* ----- events ----- */
  events: parityApi.events,
  myEventRegistrations: parityApi.myEventRegistrations,
  registerEvent: (eventId: string) =>
    keyed('event-register', eventId, (key) => apiClient.post<unknown>(`/events/${enc(eventId)}/register`, {}, idempotent(key))),
  cancelEventRegistration: (registrationId: string) =>
    keyed('event-cancel', registrationId, (key) =>
      apiClient.post<unknown>(`/events/registrations/${enc(registrationId)}/cancel`, {}, idempotent(key))),

  /* ----- library ----- */
  libraryCatalogue: parityApi.libraryCatalogue,
  libraryTitle: (titleId: string) => campusApi.libraryTitle(titleId),
  libraryLoans: () => campusApi.libraryMyLoans(),
  libraryRequest: (copyId: string) =>
    keyed('library-request', copyId, (key) => apiClient.post<unknown>('/library/requests', { copyId }, idempotent(key))),
  libraryCancel: (requestId: string, expectedVersion: number) =>
    keyed('library-cancel', `${requestId}:${expectedVersion}`, (key) =>
      apiClient.post<unknown>(`/library/requests/${enc(requestId)}/cancel`, { expectedVersion }, idempotent(key))),

  /* ----- careers ----- */
  careersOpportunities: parityApi.careersOpportunities,
  careersApplications: () => apiClient.get<CareerApplicationView[]>('/careers/applications/my'),
  careersApply: (opportunityId: string, coverLetter: string) =>
    keyed('careers-apply', opportunityId, (key) =>
      apiClient.post<CareerApplicationView>('/careers/applications', { opportunityId, coverLetter: coverLetter || undefined }, idempotent(key))),
  careersWithdraw: (applicationId: string, expectedVersion: number) =>
    keyed('careers-withdraw', `${applicationId}:${expectedVersion}`, (key) =>
      apiClient.post<unknown>(`/careers/applications/${enc(applicationId)}/withdraw`, { expectedVersion }, idempotent(key))),
  careersUpload: (applicationId: string, file: UploadFilePart, idempotencyKey: string) =>
    parityApi.careersUploadAttachment(applicationId, file, { idempotencyKey }),
  careersDownload: (applicationId: string, attachmentId: string) =>
    parityApi.careersDownloadAttachment(applicationId, attachmentId),

  /* ----- admissions ----- */
  admissionsApplications: () => apiClient.get<AdmissionApplicationView[]>('/admissions/applications/my'),
  admissionsCreate: (cycle: string) =>
    keyed('admissions-create', cycle, (key) =>
      apiClient.post<AdmissionApplicationView>('/admissions/applications', { cycle }, idempotent(key))),
  admissionsSave: (applicationId: string, form: MobileAdmissionForm, expectedVersion: number) =>
    apiClient.put<AdmissionApplicationView>(`/admissions/applications/${enc(applicationId)}`, { ...form, expectedVersion }),
  admissionsSubmit: (applicationId: string, expectedVersion: number) =>
    keyed('admissions-submit', `${applicationId}:${expectedVersion}`, (key) =>
      apiClient.post<AdmissionApplicationView>(`/admissions/applications/${enc(applicationId)}/submit`, { expectedVersion }, idempotent(key))),
  admissionsWithdraw: (applicationId: string, expectedVersion: number) =>
    keyed('admissions-withdraw', `${applicationId}:${expectedVersion}`, (key) =>
      apiClient.post<AdmissionApplicationView>(`/admissions/applications/${enc(applicationId)}/withdraw`, { expectedVersion }, idempotent(key))),
  admissionsUpload: (applicationId: string, file: UploadFilePart, idempotencyKey: string) =>
    parityApi.admissionsUploadAttachment(applicationId, file, { idempotencyKey }),
  admissionsDeleteAttachment: (applicationId: string, attachmentId: string) =>
    keyed('admissions-delete-file', `${applicationId}:${attachmentId}`, (key) =>
      apiClient.delete<unknown>(
        `/admissions/applications/${enc(applicationId)}/attachments/${enc(attachmentId)}`,
        idempotent(key),
      )),
  admissionsDownload: (applicationId: string, attachmentId: string) =>
    parityApi.admissionsDownloadAttachment(applicationId, attachmentId),

  /* ----- learning ----- */
  learningSections: () => campusApi.learningSections(),
  learningMaterials: (sectionId: string) => campusApi.learningMaterials(sectionId),
  learningAssignments: (sectionId: string) => campusApi.learningAssignments(sectionId),
  learningSubmission: (submissionId: string) =>
    apiClient.get<MobileLearningSubmission>(`/learning/submissions/${enc(submissionId)}`),
  learningRevisions: (submissionId: string) => campusApi.learningRevisions(submissionId),
  learningFeedback: (submissionId: string) => campusApi.learningFeedback(submissionId),
  learningOpenDraft: (assignment: Pick<MobileLearningAssignment, 'id'>) =>
    keyed('learning-draft', assignment.id, (key) =>
      apiClient.post<MobileLearningSubmission>(`/learning/assignments/${enc(assignment.id)}/draft`, {}, idempotent(key))),
  learningSaveDraft: (submissionId: string, input: SubmissionFormInput) =>
    input.file
      ? parityApi.learningSaveDraftMultipart(submissionId, input)
      : campusApi.learningSaveDraft(submissionId, input.textBody ?? ''),
  learningSubmit: (assignmentId: string, submissionVersion: number) =>
    keyed('learning-submit', `${assignmentId}:${submissionVersion}`, (key) =>
      apiClient.post<MobileLearningSubmission>(`/learning/assignments/${enc(assignmentId)}/submit`, {}, idempotent(key))),
  learningResubmit: (assignmentId: string, input: SubmissionFormInput, scope: string) =>
    keyed('learning-resubmit', `${assignmentId}:${scope}`, (key) =>
      parityApi.learningResubmitMultipart(assignmentId, input, { idempotencyKey: key })),
  learningDownloadMaterial: (materialId: string) => parityApi.learningDownloadMaterial(materialId),
  learningDownloadRevision: (revisionId: string) => parityApi.learningDownloadRevision(revisionId),
};
