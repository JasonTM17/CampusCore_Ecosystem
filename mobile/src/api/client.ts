import { Platform } from 'react-native';
import { sessionStore } from '../auth/mobile-session-store';
import { recordApiMetric, pathTemplate } from './observability';

export type JsonObject = Record<string, unknown>;
export type AssistantLocale = 'en' | 'vi';

declare const process: {
  env: Record<string, string | undefined>;
};

export interface AssistantCitation {
  id: string;
  slug: string;
  title: string;
  source: string;
  locale: AssistantLocale | 'both';
  excerpt: string;
  domain?: string | null;
  sourceKind?: 'CURATED' | 'CATALOG' | string | null;
  sourceId?: string | null;
  revisionId?: string | null;
  revisionVersion?: number | null;
  snapshotHash?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  updatedAt?: string | null;
}

export interface AssistantReply {
  answer: string;
  model: string;
  degraded: boolean;
  reasonCode: 'ANSWERED' | 'NO_MATCH' | 'KNOWLEDGE_UNAVAILABLE' | string;
  locale: AssistantLocale;
  citations: AssistantCitation[];
  conversationId?: string | null;
  messageId?: string | null;
  requestId?: string | null;
  clientRequestId?: string | null;
  turnId?: string | null;
  replayed?: boolean;
  terminalStatus?: 'COMPLETED' | 'CANCELLED' | 'FAILED_PRE_DISPATCH' | 'FAILED_AMBIGUOUS' | 'PURGED' | string | null;
}

export interface AssistantConversation {
  id: string;
  title?: string | null;
  locale: AssistantLocale;
  createdAt: string;
  updatedAt: string;
  messageCount?: number;
}

export interface AssistantHistoryMessage {
  id: string;
  role: 'user' | 'assistant' | 'USER' | 'ASSISTANT';
  content: string;
  createdAt: string;
  model?: string | null;
  degraded?: boolean;
  reasonCode?: string | null;
  citations?: AssistantCitation[];
  feedback?: AssistantFeedbackRating | null;
}

export interface AssistantConversationListResponse {
  data: AssistantConversation[];
  nextCursor?: string | null;
}

export interface AssistantMessageListResponse {
  data: AssistantHistoryMessage[];
  nextCursor?: string | null;
}

export type AssistantFeedbackRating = 'UP' | 'DOWN';
export type AssistantFeedbackReason = 'HELPFUL' | 'CLEAR' | 'INCORRECT' | 'OUTDATED' | 'NOT_RELEVANT' | 'UNSAFE';

export interface AssistantPage<T> {
  data: T[];
  nextCursor?: string | null;
}

export interface AuthUser {
  id: string;
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  roles?: string[];
  permissions?: string[];
  studentId?: string | null;
  lecturerId?: string | null;
}

export interface MobileSection {
  id: string;
  sectionNumber: string;
  semesterId: string;
  capacity: number;
  enrolledCount: number;
  status: string;
  course?: { code?: string; name?: string; nameEn?: string; nameVi?: string; credits?: number };
  schedules?: Array<{ dayOfWeek: number; startTime: string; endTime: string; classroom?: { building?: string; roomNumber?: string } }>;
}

export interface RegistrationCatalogSection {
  id: string;
  sectionNumber: string;
  courseId?: string;
  courseCode: string;
  courseName: string;
  credits?: number;
  capacity: number;
  enrolledCount: number;
  remainingSeats: number;
  status: string;
  scheduleConflict?: boolean;
  alreadyEnrolled?: boolean;
}

export interface MobileEnrollment {
  id: string;
  sectionId: string;
  semesterId: string;
  status: string;
  finalGrade?: number | null;
  letterGrade?: string | null;
  gradeStatus?: string;
  section?: MobileSection;
}

export interface MobileGrade {
  id: string;
  courseCode: string;
  courseName: string;
  finalGrade?: number | null;
  letterGrade?: string | null;
  gradeStatus: string;
  credits?: number;
}

export interface MobileAttendanceSummary {
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

export interface MobileThesisRound {
  id: string;
  name: string;
  status: string;
  registrationStart: string;
  registrationEnd: string;
}

export interface MobileThesisTopic {
  id: string;
  roundId: string;
  departmentId: string;
  title: string;
  description: string;
  maxGroups: number;
  status: string;
}

export interface MobileThesisGroup {
  id: string;
  roundId: string;
  leaderStudentId: string;
  topicId?: string | null;
  status: string;
  approvalStatus: string;
  memberStudentIds: string[];
}

export interface MobileNotification {
  id: string;
  title: string;
  message: string;
  isRead: boolean;
  createdAt: string;
}

/** D4 events contract (P08): student register/cancel/history surface. */
export type MobileEventStatus =
  | 'DRAFT'
  | 'PUBLISHED'
  | 'REGISTRATION_OPEN'
  | 'REGISTRATION_CLOSED'
  | 'COMPLETED'
  | 'CANCELLED';

export interface MobileEvent {
  id: string;
  title: string;
  description?: string | null;
  location?: string | null;
  organizer: string;
  status: MobileEventStatus;
  capacity: number;
  registeredCount: number;
  seatsRemaining: number;
  startsAt: string;
  endsAt: string;
  registrationOpensAt?: string | null;
  registrationClosesAt?: string | null;
  myRegistrationId?: string | null;
  myRegistrationStatus?: 'REGISTERED' | 'CANCELLED' | null;
  myAttendanceStatus?: 'ABSENT' | 'ATTENDED' | null;
}

export interface MobileEventRegistration {
  registrationId: string;
  registrationStatus: 'REGISTERED' | 'CANCELLED';
  attendanceStatus: 'ABSENT' | 'ATTENDED';
  registeredAt: string;
  cancelledAt?: string | null;
  event: MobileEvent;
}

export interface LecturerScheduleEntry {
  sectionId: string;
  sectionNumber?: string;
  courseCode?: string;
  courseName?: string;
  courseNameEn?: string;
  courseNameVi?: string;
  semesterId?: string;
  semesterName?: string;
  enrolledCount?: number;
  capacity?: number;
  schedules?: Array<{
    id?: string;
    dayOfWeek: number;
    startTime: string;
    endTime: string;
    classroom?: { building?: string; roomNumber?: string };
  }>;
}

export interface LecturerGradingSection {
  sectionId: string;
  sectionNumber?: string;
  courseCode?: string;
  courseName?: string;
  courseNameEn?: string;
  courseNameVi?: string;
  semesterId?: string;
  enrolledCount: number;
  gradedCount: number;
  publishedCount: number;
  gradeStatus?: string;
  canPublish?: boolean;
}

export interface AttendanceRosterEntry {
  studentId: string;
  studentCode?: string;
  firstName?: string;
  lastName?: string;
  studentEmail?: string;
  enrollmentStatus?: string;
}

export type AttendanceStatus = 'PRESENT' | 'ABSENT' | 'LATE' | 'EXCUSED' | 'RESET';

export interface AttendanceRecord {
  id?: string;
  studentId: string;
  status: string;
  date?: string;
  notes?: string;
}

/** GET /sections/{id}/grades — SectionGradesResponse.enrollments item. */
export interface SectionGradeEnrollment {
  id: string;
  studentId: string;
  studentName: string;
  studentCode: string;
  email?: string;
  processScore?: number | null;
  finalExamScore?: number | null;
  finalGrade?: number | null;
  letterGrade?: string | null;
  gradeStatus?: string;
  enrollmentStatus?: string;
}

interface SectionGradesResponse {
  sectionId: string;
  enrollments: SectionGradeEnrollment[];
}

export interface StudentGradeRow {
  enrollmentId: string;
  studentId?: string;
  studentCode?: string;
  studentName?: string;
  calculatedTotal?: number;
  finalGrade?: number | null;
  letterGrade?: string | null;
  gradeStatus?: string;
  processScore?: number | null;
  finalExamScore?: number | null;
  grades?: Array<{
    gradeItemId?: string;
    gradeItemName?: string;
    gradeItemType?: string;
    score?: number;
    maxScore?: number;
    weight?: number;
  }>;
}

export interface ApiClientOptions {
  baseUrl?: string;
  mode?: ApiMode;
  getAccessToken?: () => string | undefined;
  setAccessToken?: (token: string | undefined) => void;
  /**
   * Delegated session refresh (mobile-policy §3, KM-7): the apiClient owns the
   * shared single-flight promise; the actual grant lives in session-store so
   * refresh material never enters client memory.
   */
  refreshSession?: () => Promise<boolean>;
  onSessionExpired?: () => void;
  /**
   * Session epoch reader (mobile-policy §3): a request that started under an
   * older epoch and fails after a sign-out/sign-in cycle must not kick the
   * NEW session out — its 401 belongs to a dead lane (review F4).
   */
  sessionEpoch?: () => number;
}

export type ApiMode = 'preview' | 'live';

export interface ApiClient {
  readonly baseUrl: string;
  readonly mode: ApiMode;
  setAccessToken(token: string | undefined): void;
  setOnSessionExpired(handler: (() => void) | undefined): void;
  clearAccessToken(): void;
  request<TResponse>(path: string, init?: RequestInit): Promise<TResponse>;
  requestWithMeta<TResponse>(path: string, init?: RequestInit): Promise<{ data: TResponse; headers: Headers; requestId: string }>;
  get<TResponse>(path: string, init?: RequestInit): Promise<TResponse>;
  post<TResponse>(path: string, body?: unknown, init?: RequestInit): Promise<TResponse>;
  put<TResponse>(path: string, body?: unknown, init?: RequestInit): Promise<TResponse>;
  patch<TResponse>(path: string, body?: unknown, init?: RequestInit): Promise<TResponse>;
  delete<TResponse>(path: string, init?: RequestInit): Promise<TResponse>;
}

export class ApiClientError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly requestId: string;

  constructor(message: string, status: number, requestId: string, code?: string) {
    super(message);
    this.name = 'ApiClientError';
    this.status = status;
    this.requestId = requestId;
    this.code = code;
  }
}

export const DEFAULT_API_BASE_URL = Platform.OS === 'android'
  ? 'http://10.0.2.2:4010/api/v1'
  : 'http://127.0.0.1:4010/api/v1';

const configuredApiBaseUrl = process.env.EXPO_PUBLIC_API_URL;
const configuredApiMode: ApiMode = process.env.EXPO_PUBLIC_API_MODE === 'preview' ? 'preview' : 'live';

function normalizeBaseUrl(value: string) {
  return value.replace(/\/+$/, '');
}

function normalizePath(path: string) {
  return path.startsWith('/') ? path : `/${path}`;
}

function createRequestId() {
  return `mobile-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** RFC 4122 id used for the assistant idempotency contract. */
export function createAssistantClientRequestId() {
  const cryptoApi = globalThis.crypto as Crypto | undefined;
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16);
    const value = character === 'x' ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

async function readResponseBody(response: Response) {
  if (response.status === 204) {
    return undefined;
  }

  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('json')) {
    return response.json();
  }

  const text = await response.text();
  return text || undefined;
}

function getErrorDetails(body: unknown) {
  if (!body || typeof body !== 'object') {
    return { message: 'The API request failed', code: undefined };
  }

  const payload = body as JsonObject;
  return {
    message:
      typeof payload.message === 'string'
        ? payload.message
        : 'The API request failed',
    code: typeof payload.code === 'string' ? payload.code : undefined,
  };
}

function shouldRefreshAfterUnauthorized(_path: string, status: number) {
  // Legacy /auth/login|refresh|logout excludes are gone with the OIDC lane —
  // any 401 on the API host is a refresh candidate (issuer calls never
  // reach this client; they run through session-store on the issuer host).
  return status === 401;
}

export function createApiClient(options: ApiClientOptions = {}): ApiClient {
  const baseUrl = normalizeBaseUrl(
    options.baseUrl ?? configuredApiBaseUrl ?? DEFAULT_API_BASE_URL,
  );
  const mode = options.mode ?? configuredApiMode;
  let accessToken: string | undefined;
  const getAccessToken = options.getAccessToken ?? (() => accessToken);
  const setAccessTokenExternal = options.setAccessToken;
  let onSessionExpired = options.onSessionExpired;
  // All transports share one refresh promise: the issuer rotates refresh tokens
  // on every refresh, so concurrent independent refreshes race and log the user
  // out even though one rotation succeeded.
  let sessionRefreshPromise: Promise<boolean> | null = null;

  function refreshSessionOnce(): Promise<boolean> {
    if (!sessionRefreshPromise) {
      sessionRefreshPromise = Promise.resolve()
        .then(() => options.refreshSession?.() ?? false)
        .finally(() => {
          sessionRefreshPromise = null;
        });
    }
    return sessionRefreshPromise;
  }

  const client: ApiClient = {
    baseUrl,
    mode,

    setAccessToken(token) {
      if (setAccessTokenExternal) {
        setAccessTokenExternal(token);
      } else {
        accessToken = token;
      }
    },

    setOnSessionExpired(handler) {
      onSessionExpired = handler;
    },

    clearAccessToken() {
      if (setAccessTokenExternal) {
        setAccessTokenExternal(undefined);
      } else {
        accessToken = undefined;
      }
    },

    async requestWithMeta<TResponse>(path: string, init: RequestInit = {}) {
      const requestId = createRequestId();
      const startedAt = Date.now();
      const method = (init.method ?? 'GET').toUpperCase();
      const requestEpoch = options.sessionEpoch?.();
      if (mode !== 'live') {
        throw new ApiClientError(
          'Live mobile API mode is disabled for this preview build',
          0,
          requestId,
          'MOBILE_API_PREVIEW',
        );
      }
      const headers = new Headers(init.headers);
      const token = getAccessToken();

      headers.set('Accept', 'application/json');
      headers.set('X-Request-Id', requestId);
      if (init.body && !headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json');
      }
      if (token) {
        headers.set('Authorization', `Bearer ${token}`);
      }

      let response = await fetch(`${baseUrl}${normalizePath(path)}`, {
        ...init,
        headers,
      });
      let body = await readResponseBody(response);

      if (shouldRefreshAfterUnauthorized(path, response.status) && options.refreshSession) {
        const refreshed = await refreshSessionOnce();
        const rotated = getAccessToken();
        if (!refreshed || !rotated) {
          // Failed refresh = dead session: the store already wiped; bridge
          // back to sign-in instead of leaving screens in a dead end. A
          // stale lane (request predates the current epoch) is skipped so a
          // previous account's dying request can never evict the session
          // that replaced it.
          const staleLane = requestEpoch !== undefined
            && options.sessionEpoch !== undefined
            && options.sessionEpoch() !== requestEpoch;
          if (!staleLane) {
            onSessionExpired?.();
          }
        } else {
          headers.set('Authorization', `Bearer ${rotated}`);
          response = await fetch(`${baseUrl}${normalizePath(path)}`, {
            ...init,
            headers,
          });
          body = await readResponseBody(response);
        }
      }

      recordApiMetric({
        method,
        path: pathTemplate(normalizePath(path)),
        status: response.status,
        durationMs: Date.now() - startedAt,
        requestId,
        at: startedAt,
        // §6 envelope tags — surface + client so mobile traffic is
        // distinguishable in the metric ring without leaking identity.
        surface: 'native',
        clientId: 'cu-mobile',
      });

      if (!response.ok) {
        const details = getErrorDetails(body);
        throw new ApiClientError(
          details.message,
          response.status,
          requestId,
          details.code,
        );
      }

      return { data: body as TResponse, headers: response.headers, requestId };
    },

    async request<TResponse>(path: string, init: RequestInit = {}) {
      const result = await client.requestWithMeta<TResponse>(path, init);
      return result.data;
    },

    get<TResponse>(path: string, init: RequestInit = {}) {
      return client.request<TResponse>(path, { ...init, method: 'GET' });
    },

    post<TResponse>(path: string, body: unknown = undefined, init: RequestInit = {}) {
      return client.request<TResponse>(path, {
        ...init,
        method: 'POST',
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    },

    put<TResponse>(path: string, body: unknown = undefined, init: RequestInit = {}) {
      return client.request<TResponse>(path, {
        ...init,
        method: 'PUT',
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    },

    patch<TResponse>(path: string, body: unknown = undefined, init: RequestInit = {}) {
      return client.request<TResponse>(path, {
        ...init,
        method: 'PATCH',
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    },

    delete<TResponse>(path: string, init: RequestInit = {}) {
      return client.request<TResponse>(path, { ...init, method: 'DELETE' });
    },
  };

  return client;
}

export const apiClient = createApiClient({
  getAccessToken: () => sessionStore.getAccessToken() ?? undefined,
  setAccessToken: (token) => sessionStore.setAccessToken(token ?? null),
  refreshSession: async () =>
    (await sessionStore.refreshAccessToken()).accessToken !== null,
  sessionEpoch: () => sessionStore.sessionEpoch(),
});

export const apiRoutes = {
  identity: '/me',
  health: '/health/liveness',
  contract: '/contract',
  notifications: '/notifications/my',
  thesis: {
    rounds: '/thesis/rounds',
    topics: '/thesis/topics',
    groups: '/thesis/groups',
  },
  assistant: {
    chat: '/assistant/chat',
    conversations: '/assistant/conversations',
    requests: '/assistant/requests',
    messages: '/assistant/messages',
  },
  sections: '/sections',
  enrollments: '/enrollments/my',
  grades: '/enrollments/my/grades',
  attendanceSummary: '/attendance/my/summary',
} as const;

export const campusApi = {
  health: () => apiClient.get<JsonObject>(apiRoutes.health),
  contract: () => apiClient.get<JsonObject>(apiRoutes.contract),
  me: () => apiClient.get<JsonObject>(apiRoutes.identity),
  profile: () => apiClient.get<AuthUser>('/auth/me'),
  sections: (semesterId?: string) =>
    apiClient.get<{ data: MobileSection[] }>(
      apiRoutes.sections + (semesterId ? `?semesterId=${encodeURIComponent(semesterId)}` : ''),
    ),
  enrollments: (semesterId?: string) =>
    apiClient.get<MobileEnrollment[]>(
      apiRoutes.enrollments + (semesterId ? `?semesterId=${encodeURIComponent(semesterId)}` : ''),
    ),
  enroll: (sectionId: string, locale: AssistantLocale = 'vi') =>
    apiClient.post<MobileEnrollment>(
      '/me/enrollments',
      { sectionId, locale },
      { headers: { 'Idempotency-Key': createAssistantClientRequestId() } },
    ),
  dropEnrollment: (enrollmentId: string) =>
    apiClient.post<{ message: string }>(
      `/me/enrollments/${enrollmentId}/drop`,
      {},
      { headers: { 'Idempotency-Key': createAssistantClientRequestId() } },
    ),
  registrationRounds: () =>
    apiClient.get<Array<{ id: string; status: string; kind?: string }>>('/registration/rounds'),
  registrationSections: () =>
    apiClient.get<RegistrationCatalogSection[]>('/me/registration/sections'),
  transcript: () => apiClient.get<JsonObject>('/enrollments/my/transcript'),
  announcements: () => apiClient.get<{ data: JsonObject[] }>('/announcements/my'),
  updateProfile: (body: JsonObject) => apiClient.put<AuthUser>('/auth/profile', body),
  changePassword: (oldPassword: string, newPassword: string) =>
    apiClient.post<JsonObject>('/auth/change-password', { oldPassword, newPassword }),
  grades: (semesterId?: string) =>
    apiClient.get<MobileGrade[]>(
      apiRoutes.grades + (semesterId ? `?semesterId=${encodeURIComponent(semesterId)}` : ''),
    ),
  attendanceSummary: (semesterId?: string) =>
    apiClient.get<MobileAttendanceSummary[]>(
      apiRoutes.attendanceSummary + (semesterId ? `?semesterId=${encodeURIComponent(semesterId)}` : ''),
    ),
  notifications: () => apiClient.get<{ data: MobileNotification[] }>(apiRoutes.notifications),
  markNotificationRead: (id: string) =>
    apiClient.patch<JsonObject>(`/notifications/my/${id}/read`, {}),
  markAllNotificationsRead: () =>
    apiClient.patch<{ updated: number }>('/notifications/my/read-all', {}),
  thesisRounds: () => apiClient.get<MobileThesisRound[]>(apiRoutes.thesis.rounds),
  thesisTopics: (roundId: string) =>
    apiClient.get<MobileThesisTopic[]>(
      `${apiRoutes.thesis.topics}?roundId=${encodeURIComponent(roundId)}&status=PUBLISHED`,
    ),
  thesisGroups: (roundId: string) =>
    apiClient.get<MobileThesisGroup[]>(
      `${apiRoutes.thesis.groups}?roundId=${encodeURIComponent(roundId)}`,
    ),
  lecturerSchedule: () =>
    apiClient.get<LecturerScheduleEntry[]>('/sections/my/schedule'),
  lecturerGradingSections: () =>
    apiClient.get<LecturerGradingSection[]>('/sections/my/grading'),
  attendanceRoster: (sectionId: string) =>
    apiClient.get<AttendanceRosterEntry[]>(
      `/attendance/section/${encodeURIComponent(sectionId)}/roster`,
    ),
  sectionAttendance: (sectionId: string, date?: string) =>
    apiClient.get<AttendanceRecord[]>(
      `/attendance/section/${encodeURIComponent(sectionId)}`
        + (date ? `?date=${encodeURIComponent(date)}` : ''),
    ),
  saveSectionAttendance: (sectionId: string, date: string, records: AttendanceRecord[]) =>
    apiClient.put<{ updatedCount?: number; message?: string }>(
      `/attendance/section/${encodeURIComponent(sectionId)}`,
      { date, records: records.map((r) => ({ studentId: r.studentId, status: r.status, ...(r.notes ? { notes: r.notes } : {}) })) },
    ),
  /**
   * Gradebook editor source — GET /sections/{id}/grades returns the draft
   * process/final scores per enrollment (`SectionGradeEnrollmentResponse`).
   * `/grades/student-grades/section/{id}` is the itemised read model and
   * does NOT carry editable scores — saving rows built from it would wipe
   * every draft (review F2).
   */
  sectionGrades: async (sectionId: string): Promise<StudentGradeRow[]> => {
    const response = await apiClient.get<SectionGradesResponse>(
      `/sections/${encodeURIComponent(sectionId)}/grades`,
    );
    return response.enrollments.map((entry) => ({
      enrollmentId: entry.id,
      studentId: entry.studentId,
      studentCode: entry.studentCode,
      studentName: entry.studentName,
      processScore: entry.processScore,
      finalExamScore: entry.finalExamScore,
      finalGrade: entry.finalGrade,
      letterGrade: entry.letterGrade,
      gradeStatus: entry.gradeStatus,
    }));
  },
  saveSectionGrades: (
    sectionId: string,
    grades: Array<{ enrollmentId: string; processScore?: number | null; finalExamScore?: number | null }>,
  ) =>
    apiClient.put<JsonObject>(
      `/sections/${encodeURIComponent(sectionId)}/grades`,
      { grades },
    ),
  publishSectionGrades: (sectionId: string) =>
    apiClient.post<JsonObject>(
      `/sections/${encodeURIComponent(sectionId)}/grades/publish`,
      {},
    ),
  // Events (D4): published catalog, self register/cancel with
  // Idempotency-Key, and the student's own registration history.
  events: () => apiClient.get<MobileEvent[]>('/events'),
  myEventRegistrations: () =>
    apiClient.get<MobileEventRegistration[]>('/events/my/registrations'),
  registerEvent: (eventId: string) =>
    apiClient.post<JsonObject>(
      `/events/${encodeURIComponent(eventId)}/register`,
      {},
      { headers: { 'Idempotency-Key': createAssistantClientRequestId() } },
    ),
  cancelEventRegistration: (registrationId: string) =>
    apiClient.post<JsonObject>(
      `/events/registrations/${encodeURIComponent(registrationId)}/cancel`,
      {},
      { headers: { 'Idempotency-Key': createAssistantClientRequestId() } },
    ),
  createThesisGroup: (roundId: string) =>
    apiClient.post<MobileThesisGroup>(apiRoutes.thesis.groups, { roundId }),
  assignThesisTopic: (groupId: string, topicId: string) =>
    apiClient.post<MobileThesisGroup>(`${apiRoutes.thesis.groups}/${groupId}/topic`, { topicId }),
  assistantChat: (
    message: string,
    locale: AssistantLocale = 'en',
    conversationId?: string,
    clientRequestIdOrInit?: string | RequestInit,
    init?: RequestInit,
  ) =>
    apiClient.post<AssistantReply>(
      apiRoutes.assistant.chat,
      {
        message,
        locale,
        clientRequestId: typeof clientRequestIdOrInit === 'string' ? clientRequestIdOrInit : createAssistantClientRequestId(),
        ...(conversationId ? { conversationId } : {}),
      },
      typeof clientRequestIdOrInit === 'string' ? init : clientRequestIdOrInit,
    ),
  assistantConversationsPage: async (limit = 20, cursor?: string): Promise<AssistantPage<AssistantConversation>> => {
    const query = new URLSearchParams({ limit: String(limit) });
    if (cursor) query.set('cursor', cursor);
    const response = await apiClient.requestWithMeta<AssistantConversation[] | AssistantConversationListResponse>(
      `${apiRoutes.assistant.conversations}?${query.toString()}`,
      { method: 'GET' },
    );
    const payload = Array.isArray(response.data) ? response.data : response.data.data;
    return { data: payload, nextCursor: response.headers.get('X-Next-Cursor') ?? (Array.isArray(response.data) ? null : response.data.nextCursor) };
  },
  assistantConversations: async () => campusApi.assistantConversationsPage(),
  assistantConversationMessagesPage: async (conversationId: string, limit = 50, cursor?: string): Promise<AssistantPage<AssistantHistoryMessage>> => {
    const query = new URLSearchParams({ limit: String(limit) });
    if (cursor) query.set('cursor', cursor);
    const response = await apiClient.requestWithMeta<AssistantHistoryMessage[] | AssistantMessageListResponse>(
      `${apiRoutes.assistant.conversations}/${encodeURIComponent(conversationId)}/messages?${query.toString()}`,
      { method: 'GET' },
    );
    const payload = Array.isArray(response.data) ? response.data : response.data.data;
    return { data: payload, nextCursor: response.headers.get('X-Next-Cursor') ?? (Array.isArray(response.data) ? null : response.data.nextCursor) };
  },
  assistantConversationMessages: async (conversationId: string) => campusApi.assistantConversationMessagesPage(conversationId),
  deleteAssistantConversation: (conversationId: string) =>
    apiClient.delete<void>(
      `${apiRoutes.assistant.conversations}/${encodeURIComponent(conversationId)}`,
    ),
  cancelAssistantRequest: (clientRequestId: string) =>
    apiClient.post<void>(`${apiRoutes.assistant.requests}/${encodeURIComponent(clientRequestId)}/cancel`, {}),
  putAssistantFeedback: (messageId: string, rating: AssistantFeedbackRating, reason?: AssistantFeedbackReason) =>
    apiClient.put<void>(`${apiRoutes.assistant.messages}/${encodeURIComponent(messageId)}/feedback`, { rating, ...(reason ? { reason } : {}) }),
  deleteAssistantFeedback: (messageId: string) =>
    apiClient.delete<void>(`${apiRoutes.assistant.messages}/${encodeURIComponent(messageId)}/feedback`),
};
