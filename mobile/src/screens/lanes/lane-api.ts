// Lane reads and writes over the shared client. Every call hits the live API;
// nothing here fabricates data. The server is the authority for grants and
// scope: a revoked or missing grant answers 403 and the screen shows a denied
// state. Staff writes carry the row version the lecturer saw, so a repeated or
// stale tap is a 409/412 conflict instead of a second action.

import { apiClient } from '../../api/client';
import { buildQuery } from '../../api/paging';
import { notificationBody, parseList, parseMetaPage, transitionBody } from './lane-model';
import type { MetaPage, NotificationDraft } from './lane-model';

const id = encodeURIComponent;

/* ---------- read shapes (only fields the screens use) ---------- */

export interface ThesisRoundRow { id: string; name: string; status: string }

export interface DeanOverview {
  faculty?: { facultyName?: string; departmentName?: string };
  round?: { id?: string; name?: string; status?: string };
  stats?: {
    totalGroups?: number; groupsPendingApproval?: number; groupsApproved?: number; groupsRejected?: number;
    groupsWithoutTopic?: number; totalMembers?: number; supervisorCount?: number;
    byDepartment?: Array<{ departmentId?: string; departmentName?: string; groupCount?: number; topicCount?: number }>;
  };
  groups?: Array<{
    id?: string; status?: string; approvalStatus?: string; topicTitle?: string; departmentName?: string;
    supervisors?: Array<{ displayName?: string }>; members?: unknown[];
  }>;
  supervisors?: Array<{ lecturerId?: string; displayName?: string; departmentName?: string; supervisedGroups?: number; supervisedTopics?: number }>;
}

export interface AdmissionApp {
  id: string; fullName?: string; applicantEmail?: string; intendedMajor?: string; status?: string;
  submittedAt?: string; version?: number; attachments?: unknown[];
}

export interface CareerApp {
  id: string; opportunityTitle?: string; organizationName?: string; candidateEmail?: string; status?: string;
  submittedAt?: string; version?: number; attachments?: unknown[];
}

export interface LoanRequest {
  id: string; title?: string; borrowerEmail?: string; barcode?: string; status?: string;
  requestedAt?: string; dueAt?: string; version?: number;
}

export interface StaffEvent {
  id: string; title?: string; status?: string; startsAt?: string; capacity?: number; registeredCount?: number; location?: string;
}

export interface RosterRow {
  registrationId?: string; studentId?: string; studentName?: string; email?: string; status?: string;
  attendanceStatus?: string; version?: number;
}

export interface CreditApplication {
  id: string; studentName?: string; studentCode?: string; roundName?: string; semesterName?: string;
  requestedLimit?: number; standardLimit?: number; reason?: string; status?: string; reviewerNote?: string;
}

export interface AnalyticsOverview {
  totals?: { total?: number; up?: number; down?: number };
  departments?: Array<{ code?: string; name?: string; students?: number; courses?: number; sections?: number }>;
  gradeDistribution?: Array<{ grade?: string; count?: number }>;
  semesterTrends?: Array<{ semester?: string; activeStudents?: number; completionRate?: number }>;
  facultyRanks?: Array<{ rank?: string; count?: number }>;
}

export interface AttendanceRow {
  id?: string; date?: string; status?: string; studentId?: string;
  section?: { sectionNumber?: string; course?: { code?: string; name?: string } };
  student?: { user?: { firstName?: string; lastName?: string } };
}

export interface EnrollmentRow {
  id?: string; status?: string; gradeStatus?: string; enrolledAt?: string;
  section?: { sectionNumber?: string; course?: { code?: string; name?: string } };
  student?: { user?: { firstName?: string; lastName?: string } };
  semester?: { name?: string };
}

export interface AuditRow {
  id?: string; action?: string; entityType?: string; entityId?: string; actorId?: string; createdAt?: string;
  [key: string]: unknown;
}

export interface NotificationRow {
  id?: string; userId?: string; title?: string; type?: string; createdAt?: string;
}

export interface Page { page: number; limit: number }

export const LANE_PAGE_SIZE = 20;

async function metaPage<T>(path: string, filters: Record<string, string | undefined>, paging: Page): Promise<MetaPage<T>> {
  const query = buildQuery({ ...filters, page: paging.page, limit: paging.limit });
  const body = await apiClient.get<unknown>(`${path}${query}`);
  return parseMetaPage<T>(body, paging.page, paging.limit);
}

const list = async <T>(path: string, filters: Record<string, string | undefined> = {}) =>
  parseList<T>(await apiClient.get<unknown>(`${path}${buildQuery(filters)}`));

export const laneApi = {
  /* dean (TRUONG_KHOA only on the server) */
  thesisRounds: () => list<ThesisRoundRow>('/thesis/rounds'),
  deanOverview: (roundId: string) => apiClient.get<DeanOverview>(`/thesis/dean/overview${buildQuery({ roundId })}`),

  /* admissions desk */
  admissionsQueue: (status?: string) => list<AdmissionApp>('/admissions/staff/queue', { status }),
  admissionsClaim: (row: AdmissionApp) =>
    apiClient.post<AdmissionApp>(`/admissions/staff/applications/${id(row.id)}/claim`, { expectedVersion: row.version }),
  admissionsReturn: (row: AdmissionApp, note: string) =>
    apiClient.post<AdmissionApp>(`/admissions/staff/applications/${id(row.id)}/return`, { note: note.trim(), expectedVersion: row.version }),
  admissionsDecide: (row: AdmissionApp, decision: 'ACCEPTED' | 'REJECTED', note?: string) =>
    apiClient.post<AdmissionApp>(`/admissions/staff/applications/${id(row.id)}/decision`, {
      decision, expectedVersion: row.version, ...(note && note.trim() ? { note: note.trim() } : {}),
    }),

  /* careers desk */
  careersApplications: (status?: string) => list<CareerApp>('/careers/staff/applications', { status }),
  careersTransition: (row: CareerApp, toStatus: string) =>
    apiClient.post<CareerApp>(`/careers/staff/applications/${id(row.id)}/transition`, { toStatus, expectedVersion: row.version }),
  careersReject: (row: CareerApp, reason: string) =>
    apiClient.post<CareerApp>(`/careers/staff/applications/${id(row.id)}/reject`, transitionBody(row, reason)),

  /* library desk */
  libraryRequests: (status?: string) => list<LoanRequest>('/library/staff/requests', { status }),
  libraryApprove: (row: LoanRequest) => apiClient.post<LoanRequest>(`/library/staff/requests/${id(row.id)}/approve`, transitionBody(row)),
  libraryIssue: (row: LoanRequest) => apiClient.post<LoanRequest>(`/library/staff/requests/${id(row.id)}/issue`, transitionBody(row)),
  libraryReturn: (row: LoanRequest) => apiClient.post<LoanRequest>(`/library/staff/requests/${id(row.id)}/return`, transitionBody(row)),
  libraryCancel: (row: LoanRequest, reason: string) =>
    apiClient.post<LoanRequest>(`/library/staff/requests/${id(row.id)}/cancel`, transitionBody(row, reason)),

  /* admin oversight */
  analytics: () => apiClient.get<AnalyticsOverview>('/academic/distribution-overview/overview'),
  attendance: (filters: { sectionId?: string; studentId?: string; date?: string }, paging: Page) =>
    metaPage<AttendanceRow>('/attendance', filters, paging),
  enrollments: (filters: { status?: string; semesterId?: string; sectionId?: string; studentId?: string; search?: string }, paging: Page) =>
    metaPage<EnrollmentRow>('/enrollments', filters, paging),
  audit: (filters: { action?: string; entityType?: string; search?: string }, paging: Page) =>
    metaPage<AuditRow>('/admin/audit', filters, paging),
  creditApplications: (status: string) =>
    list<CreditApplication>('/admin/registration/credit-limit-applications', { status }),
  creditReview: (row: CreditApplication, decision: 'APPROVED' | 'REJECTED', note?: string) =>
    apiClient.post<CreditApplication>(`/admin/registration/credit-limit-applications/${id(row.id)}/review`, {
      decision, ...(note && note.trim() ? { note: note.trim() } : {}),
    }),

  /* admin events (owner-scoped on the server, needs the events staff grant) */
  staffEvents: () => list<StaffEvent>('/events/staff'),
  eventRoster: (eventId: string) => list<RosterRow>(`/events/staff/${id(eventId)}/roster`),
  eventMark: (eventId: string, mark: { registrationId: string; status: 'ATTENDED' | 'ABSENT'; version: number }) =>
    apiClient.post<RosterRow[]>(`/events/staff/${id(eventId)}/attendance`, { marks: [mark] }),
  eventTransition: (eventId: string, action: 'publish' | 'close-registration' | 'complete') =>
    apiClient.post<StaffEvent>(`/events/staff/${id(eventId)}/${action}`, {}),
  eventCancel: (eventId: string, reason: string) =>
    apiClient.post<StaffEvent>(`/events/staff/${id(eventId)}/cancel`, reason.trim() ? { reason: reason.trim() } : {}),

  /* admin notifications: one recipient, no server idempotency, so callers never auto-retry */
  notificationHistory: (paging: Page) => metaPage<NotificationRow>('/notifications', {}, paging),
  sendNotification: (draft: NotificationDraft) => apiClient.post<NotificationRow>('/notifications', notificationBody(draft)),
};
