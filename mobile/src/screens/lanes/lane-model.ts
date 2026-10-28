// Pure lane read models and action rules. No React or native imports so the
// same code runs under `node --test`. Parsers are tolerant of missing fields
// and never invent data; action rules mirror the server state machines, and the
// server stays the authority (every write carries the row version it saw).

export interface PageMeta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface MetaPage<T> {
  items: T[];
  meta: PageMeta;
  hasMore: boolean;
}

const num = (value: unknown, fallback: number) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);

/** `{ data, meta }` list body (1-based pages) to items and paging; anything else is an empty page. */
export function parseMetaPage<T>(body: unknown, requestedPage: number, requestedLimit: number): MetaPage<T> {
  const record = (body && typeof body === 'object' ? body : {}) as { data?: unknown; meta?: Record<string, unknown> };
  const items = Array.isArray(record.data) ? (record.data as T[]) : [];
  const meta: PageMeta = {
    total: num(record.meta?.total, items.length),
    page: num(record.meta?.page, requestedPage),
    limit: num(record.meta?.limit, requestedLimit),
    totalPages: num(record.meta?.totalPages, 1),
  };
  return { items, meta, hasMore: meta.page < meta.totalPages };
}

/** Bare-array body to items; anything else is empty. */
export const parseList = <T>(body: unknown): T[] => (Array.isArray(body) ? (body as T[]) : []);

/* ---------- staff queues ---------- */

export type QueueAction =
  | 'claim' | 'return' | 'accept' | 'reject'
  | 'approve' | 'issue' | 'returnLoan' | 'cancel'
  | 'toReviewing' | 'toInterview' | 'toOffer';

/** Admissions: SUBMITTED allows claim; IN_REVIEW allows return (note required) or a decision. */
export function admissionsActions(status: string | undefined): QueueAction[] {
  if (status === 'SUBMITTED') return ['claim'];
  if (status === 'IN_REVIEW') return ['accept', 'reject', 'return'];
  return [];
}

/** Careers: one step forward, or reject (reason required) while the application is open. */
export function careersActions(status: string | undefined): QueueAction[] {
  switch (status) {
    case 'SUBMITTED': return ['toReviewing', 'reject'];
    case 'REVIEWING': return ['toInterview', 'reject'];
    case 'INTERVIEW': return ['toOffer', 'reject'];
    case 'OFFER': return ['reject'];
    default: return [];
  }
}

export const CAREERS_NEXT_STATUS: Readonly<Record<string, string>> = {
  toReviewing: 'REVIEWING',
  toInterview: 'INTERVIEW',
  toOffer: 'OFFER',
};

/** Library: REQUESTED allows approve/cancel; APPROVED allows issue/cancel; ISSUED allows return. */
export function libraryActions(status: string | undefined): QueueAction[] {
  switch (status) {
    case 'REQUESTED': return ['approve', 'cancel'];
    case 'APPROVED': return ['issue', 'cancel'];
    case 'ISSUED': return ['returnLoan'];
    default: return [];
  }
}

/** Actions that must carry written text: a return note, a rejection reason, a cancellation reason. */
export const NEEDS_TEXT: ReadonlySet<QueueAction> = new Set<QueueAction>(['return', 'reject', 'cancel']);

export interface Versioned {
  version?: number;
}

/** Body for a versioned transition; expectedVersion turns a repeated tap into a conflict, not a second action. */
export function transitionBody(row: Versioned, text?: string): { expectedVersion?: number; reason?: string } {
  const body: { expectedVersion?: number; reason?: string } = {};
  if (typeof row.version === 'number') body.expectedVersion = row.version;
  if (text && text.trim()) body.reason = text.trim();
  return body;
}

/* ---------- events ---------- */

export type EventAction = 'publish' | 'closeRegistration' | 'complete' | 'cancel';

/** Status transitions the app offers; opening registration needs dates and stays on the web. */
export function eventActions(status: string | undefined): EventAction[] {
  switch (status) {
    case 'DRAFT': return ['publish', 'cancel'];
    case 'PUBLISHED': return ['cancel'];
    case 'REGISTRATION_OPEN': return ['closeRegistration', 'cancel'];
    case 'REGISTRATION_CLOSED': return ['complete', 'cancel'];
    default: return [];
  }
}

/** The server accepts manual marks once registration is closed or the event is complete. */
export const canMarkAttendance = (status: string | undefined): boolean => status === 'REGISTRATION_CLOSED' || status === 'COMPLETED';

/** One manual mark; the roster row version rides along so a concurrent change is a conflict. */
export function attendanceMark(row: { registrationId?: string; version?: number }, status: 'ATTENDED' | 'ABSENT') {
  if (!row.registrationId || typeof row.version !== 'number') return null;
  return { registrationId: row.registrationId, status, version: row.version };
}

/* ---------- notifications ---------- */

export const NOTIFICATION_TYPES = ['INFO', 'SUCCESS', 'WARNING', 'ERROR'] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export interface NotificationDraft {
  userId: string;
  title: string;
  message: string;
  type: NotificationType;
}

export type DraftProblem = 'recipient' | 'title' | 'message';

/** Field problems for a one-recipient system notification; empty means ready to preview. */
export function validateNotification(draft: NotificationDraft): DraftProblem[] {
  const problems: DraftProblem[] = [];
  if (!UUID.test(draft.userId.trim())) problems.push('recipient');
  if (draft.title.trim() === '' || draft.title.trim().length > 200) problems.push('title');
  if (draft.message.trim() === '' || draft.message.length > 2000) problems.push('message');
  return problems;
}

/** The exact JSON body sent; no link and no extra fields (the server rejects unknown properties). */
export const notificationBody = (draft: NotificationDraft) => ({
  userId: draft.userId.trim(),
  title: draft.title.trim(),
  message: draft.message.trim(),
  type: draft.type,
});

/* ---------- oversight ---------- */

export interface FilterQuery {
  [key: string]: string | number | undefined;
}

/** Query string for the defined, non-blank values only, encoded. */
export function queryString(values: FilterQuery): string {
  const parts = Object.entries(values)
    .filter((entry): entry is [string, string | number] => entry[1] !== undefined && String(entry[1]).trim() !== '')
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value).trim())}`);
  return parts.length > 0 ? `?${parts.join('&')}` : '';
}

/** Share of `value` in `total` as a whole percentage, 0 when the total is empty. */
export const percentOf = (value: number, total: number): number => (total > 0 ? Math.round((value / total) * 100) : 0);

export type FailureKind = 'offline' | 'unauthorized' | 'denied' | 'conflict' | 'invalid' | 'other';

/** Failure class a screen reacts to: conflicts reload the list, denial is a full state. */
export function failureKind(error: unknown): FailureKind {
  const status = (error as { status?: number } | null)?.status;
  if (status === 0 || error instanceof TypeError) return 'offline';
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'denied';
  if (status === 409 || status === 412) return 'conflict';
  if (status === 400 || status === 422) return 'invalid';
  return 'other';
}
