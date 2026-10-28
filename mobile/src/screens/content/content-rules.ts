// Pure presentation rules for the service screens. The server owns every
// transition; these helpers only decide which control is worth showing.

export type EventAction = 'register' | 'cancel' | 'full' | 'none';

interface EventLike {
  status: string;
  seatsRemaining: number;
  myRegistrationId?: string | null;
  myRegistrationStatus?: string | null;
}

export function eventAction(event: EventLike): EventAction {
  const registered = event.myRegistrationStatus === 'REGISTERED';
  if (registered) {
    const ended = event.status === 'CANCELLED' || event.status === 'COMPLETED';
    return !ended && event.myRegistrationId ? 'cancel' : 'none';
  }
  if (event.status !== 'REGISTRATION_OPEN') return 'none';
  return event.seatsRemaining > 0 ? 'register' : 'full';
}

/** Statuses a student can usefully filter the published catalogue by. */
export const EVENT_FILTER_STATUSES = ['REGISTRATION_OPEN', 'PUBLISHED', 'REGISTRATION_CLOSED', 'COMPLETED', 'CANCELLED'] as const;

export function filterByStatus<T extends { status: string }>(items: readonly T[], statuses: readonly string[]): T[] {
  return statuses.length === 0 ? items.slice() : items.filter((item) => statuses.includes(item.status));
}

/** A row without a priority counts as NORMAL, as the server does. */
export function filterByPriority<T extends { priority?: string | null }>(items: readonly T[], priorities: readonly string[]): T[] {
  return priorities.length === 0 ? items.slice() : items.filter((item) => priorities.includes(item.priority ?? 'NORMAL'));
}

/* ---------- library ---------- */

export type LoanTab = 'active' | 'history';

export function isLoanCancellable(loan: { status: string }): boolean {
  return loan.status === 'REQUESTED' || loan.status === 'APPROVED';
}

export function isLoanActive(loan: { status: string }): boolean {
  return loan.status === 'REQUESTED' || loan.status === 'APPROVED' || loan.status === 'ISSUED';
}

export function filterLoans<T extends { status: string }>(loans: readonly T[], tab: LoanTab): T[] {
  return loans.filter((loan) => (tab === 'active' ? isLoanActive(loan) : !isLoanActive(loan)));
}

export function firstAvailableCopy<C extends { status: string }>(copies: readonly C[] | null | undefined): C | null {
  return (copies ?? []).find((copy) => copy.status === 'AVAILABLE') ?? null;
}

/* ---------- careers ---------- */

const WITHDRAWABLE = ['SUBMITTED', 'REVIEWING', 'INTERVIEW', 'OFFER'];

export function isApplicationWithdrawable(application: { status: string }): boolean {
  return WITHDRAWABLE.includes(application.status);
}

export function activeOpportunityIds(applications: readonly { opportunityId: string; status: string }[]): Set<string> {
  return new Set(applications.filter(isApplicationWithdrawable).map((application) => application.opportunityId));
}

/* ---------- admissions ---------- */

export type AdmissionPhase = 'editable' | 'returned' | 'locked' | 'terminal';

export function admissionPhase(status: string): AdmissionPhase {
  if (status === 'DRAFT') return 'editable';
  if (status === 'RETURNED') return 'returned';
  if (status === 'ACCEPTED' || status === 'REJECTED' || status === 'WITHDRAWN') return 'terminal';
  return 'locked';
}

export const ADMISSION_REQUIRED_FIELDS = ['fullName', 'dateOfBirth', 'schoolName', 'intendedMajor'] as const;
export type AdmissionRequiredField = (typeof ADMISSION_REQUIRED_FIELDS)[number];

/** Fields the server refuses to submit without; the check mirrors its completeness rule. */
export function missingAdmissionFields(form: Partial<Record<AdmissionRequiredField, string | null | undefined>>): AdmissionRequiredField[] {
  return ADMISSION_REQUIRED_FIELDS.filter((field) => !(form[field] ?? '').trim());
}

/** Attachments can change only while the applicant can still edit the file. */
export function canChangeAttachments(phase: AdmissionPhase): boolean {
  return phase === 'editable' || phase === 'returned';
}

/* ---------- learning ---------- */

export type SubmissionPhase = 'none' | 'draft' | 'submitted' | 'returned' | 'reviewed';

export function submissionPhase(status: string | null | undefined): SubmissionPhase {
  switch (status) {
    case 'DRAFT': return 'draft';
    case 'SUBMITTED':
    case 'RESUBMITTED': return 'submitted';
    case 'RETURNED': return 'returned';
    case 'REVIEWED': return 'reviewed';
    default: return 'none';
  }
}

export function deadlinePassed(deadlineAt: string | null | undefined, now: number = Date.now()): boolean {
  if (!deadlineAt) return false;
  const at = Date.parse(deadlineAt);
  return Number.isFinite(at) && at < now;
}

/** A submission needs a typed answer or a chosen file. */
export function hasSubmissionContent(text: string, hasFile: boolean): boolean {
  return text.trim().length > 0 || hasFile;
}

/* ---------- notifications ---------- */

export type NotificationTab = 'all' | 'unread';

export function notificationReadParam(tab: NotificationTab): boolean | undefined {
  return tab === 'unread' ? false : undefined;
}

export function countUnread(items: readonly { isRead: boolean }[]): number {
  return items.filter((item) => !item.isRead).length;
}

/* ---------- shared ---------- */

/** Text for a status label, falling back to the raw code so an unknown state is still visible. */
export function labelFor(labels: Readonly<Record<string, string>>, code: string | null | undefined): string {
  if (!code) return '';
  return labels[code] ?? code;
}

export function joinMeta(parts: ReadonlyArray<string | null | undefined | false>): string {
  return parts.filter((part): part is string => typeof part === 'string' && part.length > 0).join(' · ');
}

export type StatusTone = 'neutral' | 'primary' | 'success' | 'warning' | 'error';

const TONES: Record<string, StatusTone> = {
  REGISTRATION_OPEN: 'primary', PUBLISHED: 'primary', IN_REVIEW: 'primary', REVIEWING: 'primary', INTERVIEW: 'primary',
  REQUESTED: 'warning', APPROVED: 'primary', ISSUED: 'primary', SUBMITTED: 'primary', RESUBMITTED: 'primary', DRAFT: 'neutral',
  RETURNED: 'warning', PENDING: 'warning', REGISTRATION_CLOSED: 'warning',
  ACCEPTED: 'success', OFFER: 'success', REVIEWED: 'success', REGISTERED: 'success', ATTENDED: 'success', COMPLETED: 'success',
  REJECTED: 'error', CANCELLED: 'error', ABSENT: 'error', WITHDRAWN: 'neutral', CLOSED: 'neutral', ARCHIVED: 'neutral',
};

export function statusTone(code: string | null | undefined): StatusTone {
  return (code && TONES[code]) || 'neutral';
}
