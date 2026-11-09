// Pure presentation rules for the service screens. The server owns every
// transition; these helpers only decide which control is worth showing.

export type EventAction = 'register' | 'cancel' | 'full' | 'none';

interface EventLike {
  status: string;
  seatsRemaining: number;
  startsAt?: string | null;
  registrationOpensAt?: string | null;
  registrationClosesAt?: string | null;
  myRegistrationId?: string | null;
  myRegistrationStatus?: string | null;
}

export function eventAction(event: EventLike, now: number = Date.now()): EventAction {
  const registered = event.myRegistrationStatus === 'REGISTERED';
  if (registered) {
    const ended = event.status === 'CANCELLED' || event.status === 'COMPLETED';
    const startsAt = event.startsAt ? Date.parse(event.startsAt) : Number.NaN;
    const started = Number.isFinite(startsAt) && startsAt <= now;
    return !ended && !started && event.myRegistrationId ? 'cancel' : 'none';
  }
  if (event.status !== 'REGISTRATION_OPEN') return 'none';
  const startsAt = event.startsAt ? Date.parse(event.startsAt) : Number.NaN;
  const opensAt = event.registrationOpensAt ? Date.parse(event.registrationOpensAt) : Number.NaN;
  const closesAt = event.registrationClosesAt ? Date.parse(event.registrationClosesAt) : Number.NaN;
  if ((Number.isFinite(startsAt) && startsAt <= now)
    || (Number.isFinite(opensAt) && opensAt > now)
    || (Number.isFinite(closesAt) && closesAt <= now)) return 'none';
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

/* ---------- announcements ---------- */

export type AnnouncementCategory = 'ALL' | 'GLOBAL' | 'STUDENT_ONLY' | 'REGISTRATION' | 'THESIS' | 'SCHOLARSHIP' | 'EXAM';

export const ANNOUNCEMENT_CATEGORIES: readonly AnnouncementCategory[] = [
  'ALL', 'GLOBAL', 'STUDENT_ONLY', 'REGISTRATION', 'THESIS', 'SCHOLARSHIP', 'EXAM',
];

interface AnnouncementFilterItem {
  title: string;
  content?: string | null;
  isGlobal?: boolean | null;
  targetRoles?: string[] | null;
}

type AnnouncementAudience = 'GLOBAL' | 'STUDENT' | 'LECTURER' | 'OTHER';

function announcementAudience(item: Pick<AnnouncementFilterItem, 'isGlobal' | 'targetRoles'>): AnnouncementAudience {
  if (item.isGlobal) return 'GLOBAL';
  const roles = (item.targetRoles ?? [])
    .map((role) => (typeof role === 'string' ? role.trim().toUpperCase() : ''))
    .filter(Boolean);
  const hasStudent = roles.includes('STUDENT');
  const hasLecturer = roles.includes('LECTURER');
  if (hasStudent && hasLecturer) return 'GLOBAL';
  if (hasLecturer) return 'LECTURER';
  if (hasStudent) return 'STUDENT';
  return 'OTHER';
}

const ANNOUNCEMENT_TOPICS: Partial<Record<AnnouncementCategory, RegExp>> = {
  REGISTRATION: /\b(đăng ký|học phần|registration|course registration)\b/i,
  THESIS: /\b(luận văn|đề tài|thesis|kltn|tlcn|đồ án|capstone)\b/i,
  SCHOLARSHIP: /\b(học bổng|rèn luyện|scholarship|financial aid)\b/i,
  EXAM: /\b(thi|khảo thí|phúc khảo|exam|examination|kỳ thi|lịch thi)\b/i,
};

/** The web feed filters loaded notices by audience, topic and free text. */
export function filterByAnnouncementQuery<T extends AnnouncementFilterItem>(
  items: readonly T[],
  category: AnnouncementCategory,
  query: string,
): T[] {
  const search = query.trim().toLowerCase();
  const topic = ANNOUNCEMENT_TOPICS[category];
  return items.filter((item) => {
    if (category === 'GLOBAL' && announcementAudience(item) !== 'GLOBAL') return false;
    if (category === 'STUDENT_ONLY' && announcementAudience(item) !== 'STUDENT') return false;
    const fullText = `${item.title} ${item.content ?? ''}`;
    if (topic && !topic.test(fullText)) return false;
    return search.length === 0 || fullText.toLowerCase().includes(search);
  });
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

/**
 * The server and the local detail read use different codes for "this copy is
 * gone"; both must reach the patron as the specific message, not the generic
 * conflict copy. An unknown code returns null so the caller falls back to the
 * shared error classifier.
 */
export function copyFailureMessage(
  copy: { noCopiesAvailable: string; copyUnavailable: string },
  error: unknown,
): string | null {
  const code = (error as { code?: unknown } | null)?.code;
  if (code === 'NO_COPY') return copy.noCopiesAvailable;
  if (code === 'COPY_UNAVAILABLE' || code === 'COPY_TERMINAL') return copy.copyUnavailable;
  return null;
}

/* ---------- careers ---------- */

const WITHDRAWABLE = ['SUBMITTED', 'REVIEWING', 'INTERVIEW', 'OFFER'];

export function isApplicationWithdrawable(application: { status: string }): boolean {
  return WITHDRAWABLE.includes(application.status);
}

export function activeOpportunityIds(applications: readonly { opportunityId: string; status: string }[]): Set<string> {
  return new Set(applications.filter(isApplicationWithdrawable).map((application) => application.opportunityId));
}

/** Turns an enum-ish server code into readable words: FULL_TIME → "Full time". */
export function humanizeEmploymentType(code: string): string {
  const words = code
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .replace(/[_.\-/]+/g, ' ')
    .trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1).toLowerCase() : '';
}

/** Employment type for display: localized label for known enums, humanized fallback for unknown ones. */
export function employmentTypeLabel(labels: Readonly<Record<string, string>>, code: string | null | undefined): string {
  if (!code) return '';
  const trimmed = code.trim();
  if (!trimmed) return '';
  return labels[trimmed] ?? humanizeEmploymentType(trimmed);
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

/* ---------- guest landing feed ---------- */

/** First feed rows shaped as a magazine: the lead article plus the follow-ups shown under it. */
export function newsHighlights<T>(items: readonly T[], max: number): { featured: T | null; rest: T[] } {
  const top = items.slice(0, Math.max(0, max));
  return { featured: top[0] ?? null, rest: top.slice(1) };
}

/** Only the server URGENT code earns the "Khẩn" pill — HIGH stays a normal row. */
export function isUrgentPriority(priority: string | null | undefined): boolean {
  return priority === 'URGENT';
}

/** Server category ids arrive in several casings/separators; labels key on UPPER_SNAKE. */
export function newsCategoryLabel(labels: Readonly<Record<string, string>>, categoryId: string | null | undefined): string {
  const key = categoryId?.trim().toUpperCase().replace(/[ -]+/g, '_').replace(/^CAT_/, '') ?? '';
  const alias = key === 'TRAINING_ACADEMIC' ? 'ACADEMIC_AFFAIRS' : key;
  return alias ? labels[alias] ?? '' : '';
}

/** The detail target one announcement row opens: the permalink slug, else the id. */
export function newsTargetOf(item: { id: string; slug?: string | null }): string {
  return item.slug ?? item.id;
}

/**
 * The publisher a reader can name. Internal subject ids and technical
 * placeholders are not names, so the mobile reader omits the byline instead of
 * printing an account id (the web reader applies the same guard).
 */
const TECHNICAL_PUBLISHER =
  /^(?:admin(?:[-_].*)?|super_admin|system|user)$|^[0-9a-f]{8}-[0-9a-f]{4}/i;

export function publisherName(
  displayName: string | null | undefined,
  publishedBy?: string | null,
): string | null {
  for (const candidate of [displayName, publishedBy]) {
    const trimmed = candidate?.trim();
    if (trimmed && !TECHNICAL_PUBLISHER.test(trimmed)) return trimmed;
  }
  return null;
}

export function joinMeta(parts: ReadonlyArray<string | null | undefined | false>): string {
  return parts.filter((part): part is string => typeof part === 'string' && part.length > 0).join(' · ');
}

export type StatusTone = 'neutral' | 'primary' | 'success' | 'warning' | 'error';

const TONES: Record<string, StatusTone> = {
  URGENT: 'error', HIGH: 'warning', NORMAL: 'primary', LOW: 'neutral',
  REGISTRATION_OPEN: 'success', PUBLISHED: 'primary', IN_REVIEW: 'primary', REVIEWING: 'primary', INTERVIEW: 'primary',
  REQUESTED: 'warning', APPROVED: 'primary', ISSUED: 'primary', SUBMITTED: 'primary', RESUBMITTED: 'primary', DRAFT: 'neutral',
  RETURNED: 'warning', PENDING: 'warning', REGISTRATION_CLOSED: 'primary',
  ACCEPTED: 'success', OFFER: 'success', REVIEWED: 'success', REGISTERED: 'success', ATTENDED: 'success', COMPLETED: 'primary',
  REJECTED: 'error', CANCELLED: 'error', ABSENT: 'error', WITHDRAWN: 'neutral', CLOSED: 'warning', ARCHIVED: 'neutral',
};

export function statusTone(code: string | null | undefined): StatusTone {
  return (code && TONES[code]) || 'neutral';
}

/* ---------- service status roles ---------- */

// The careers board and the library catalogue draw their own colour roles; the
// shared map above still serves news, docs, events and learning.

const CAREER_OPPORTUNITY_TONES: Record<string, StatusTone> = {
  DRAFT: 'neutral', IN_REVIEW: 'warning', PUBLISHED: 'success', PAUSED: 'warning', CLOSED: 'neutral', REJECTED: 'error',
};

export function careerOpportunityTone(code: string | null | undefined): StatusTone {
  return (code && CAREER_OPPORTUNITY_TONES[code]) || 'neutral';
}

const CAREER_APPLICATION_TONES: Record<string, StatusTone> = {
  SUBMITTED: 'warning', REVIEWING: 'primary', INTERVIEW: 'primary', OFFER: 'success', REJECTED: 'error', WITHDRAWN: 'neutral',
};

export function careerApplicationTone(code: string | null | undefined): StatusTone {
  return (code && CAREER_APPLICATION_TONES[code]) || 'neutral';
}

const LIBRARY_LOAN_TONES: Record<string, StatusTone> = {
  REQUESTED: 'warning', APPROVED: 'primary', ISSUED: 'primary', RETURNED: 'success', CANCELLED: 'neutral',
};

export function libraryLoanTone(code: string | null | undefined): StatusTone {
  return (code && LIBRARY_LOAN_TONES[code]) || 'neutral';
}

const LIBRARY_COPY_TONES: Record<string, StatusTone> = {
  AVAILABLE: 'success', RESERVED: 'warning', ON_LOAN: 'primary', RETIRED: 'neutral',
};

export function libraryCopyTone(code: string | null | undefined): StatusTone {
  return (code && LIBRARY_COPY_TONES[code]) || 'neutral';
}
