// Pure thesis rules shared by the student screens: server limits, round choice,
// topic filtering, report validation, advisor directory and error mapping.
// No React and no network here so the node suite can run it directly.

import type { ThesisCopy } from '../../i18n/thesis-messages';

/** Server rules (ThesisMutationService, ReportFilePolicy, ThesisReportService). */
export const THESIS_GROUP_MIN_MEMBERS = 3;
export const THESIS_GROUP_MAX_MEMBERS = 5;
export const THESIS_REPORT_TITLE_MAX = 240;
export const THESIS_REPORT_NOTE_MAX = 500;
export const THESIS_REPORT_FILE_MAX_BYTES = 20 * 1024 * 1024;
export const THESIS_REPORT_FILE_EXTENSIONS = ['pdf', 'doc', 'docx'] as const;
export const THESIS_REPORT_MIME_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
] as const;

export const THESIS_TOPIC_PAGE_SIZE = 20;
export const THESIS_ROUND_PAGE_SIZE = 100;
export const THESIS_STUDENT_SEARCH_MIN = 2;
/** The advisor directory is built from per-topic supervisor reads, so it is bounded. */
export const THESIS_ADVISOR_TOPIC_CAP = 60;
export const THESIS_ADVISOR_CONCURRENCY = 4;

export interface ThesisRound {
  id: string;
  name: string;
  status: string;
  registrationStart: string;
  registrationEnd: string;
  thesisType?: string | null;
  reportDeadline?: string | null;
  proposalPublishAt?: string | null;
  reportDate?: string | null;
  defenseDate?: string | null;
}

export interface ThesisTopic {
  id: string;
  roundId: string;
  departmentId: string;
  title: string;
  description: string;
  maxGroups: number;
  status: string;
}

export interface ThesisMember {
  studentId: string;
  studentNumber?: string | null;
  displayName?: string | null;
  isExternal?: boolean;
  isLeader?: boolean;
  memberOrder?: number;
}

export interface ThesisGroup {
  id: string;
  roundId: string;
  leaderStudentId: string;
  topicId?: string | null;
  status: string;
  approvalStatus: string;
  rejectionReason?: string | null;
  memberStudentIds: string[];
  members?: ThesisMember[];
}

export interface ThesisSupervisor {
  lecturerId: string;
  supervisorOrder: number;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
}

export interface ThesisProgress {
  roundId: string;
  roundStatus: string;
  participationState: string;
  currentMilestone: string;
  completedMilestones: string[];
  attentionState: string;
  groupId?: string | null;
  groupStatus?: string | null;
  approvalStatus?: string | null;
  memberCount: number;
  topicId?: string | null;
  topicTitle?: string | null;
  reportId?: string | null;
  reportSubmittedAt?: string | null;
  finalScore?: number | null;
}

export interface ThesisReport {
  groupId: string;
  title?: string | null;
  url?: string | null;
  note?: string | null;
  submittedAt?: string | null;
  updatedAt?: string | null;
  fileName?: string | null;
  fileType?: string | null;
  fileSize?: number | null;
}

export interface StudentSearchHit {
  studentId: string;
  studentNumber?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  curriculumCode?: string | null;
}

export const THESIS_MILESTONES = [
  'ROUND_SELECTED',
  'GROUP_CREATED',
  'TOPIC_ASSIGNED',
  'GROUP_APPROVED',
  'REPORT_SUBMITTED',
  'COUNCIL_ASSIGNED',
  'SCORE_FINALIZED',
  'RESULTS_PUBLISHED',
] as const;

/** Rounds a student can still act in or follow, oldest-closed last. */
const ROUND_PRIORITY = ['REGISTRATION_OPEN', 'PROPOSALS_PUBLISHED', 'REGISTRATION_CLOSED', 'RESULTS_PUBLISHED'];

/** The selected round when it is still listed, else the most useful open one. */
export function pickDefaultRound<T extends { id: string; status: string }>(
  rounds: readonly T[],
  selectedId?: string | null,
): T | null {
  if (selectedId) {
    const selected = rounds.find((round) => round.id === selectedId);
    if (selected) return selected;
  }
  for (const status of ROUND_PRIORITY) {
    const match = rounds.find((round) => round.status === status);
    if (match) return match;
  }
  return rounds.find((round) => round.status !== 'CANCELLED' && round.status !== 'DRAFT') ?? rounds[0] ?? null;
}

export function isRegistrationOpen(round: { status: string } | null | undefined): boolean {
  return round?.status === 'REGISTRATION_OPEN';
}

/** Case- and accent-insensitive match over title, department and brief of the loaded topics. */
export function normalizeSearch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .trim();
}

export function filterTopics<T extends Pick<ThesisTopic, 'title' | 'description' | 'departmentId'>>(
  topics: readonly T[],
  query: string,
): T[] {
  const needle = normalizeSearch(query);
  if (!needle) return [...topics];
  return topics.filter((topic) =>
    normalizeSearch(`${topic.title} ${topic.departmentId} ${topic.description}`).includes(needle));
}

export type ThesisTone = 'neutral' | 'primary' | 'success' | 'warning' | 'error';

export function statusTone(status: string | null | undefined): ThesisTone {
  switch (status) {
    case 'PUBLISHED':
    case 'APPROVED':
    case 'COMPLETED':
    case 'RESULTS_PUBLISHED':
      return 'success';
    case 'REGISTRATION_OPEN':
    case 'SUBMITTED':
    case 'ASSIGNED':
    case 'PROPOSALS_PUBLISHED':
      return 'primary';
    case 'REJECTED':
    case 'CANCELLED':
      return 'error';
    case 'REGISTRATION_CLOSED':
    case 'DRAFT':
    case 'PENDING':
    case 'PROPOSAL_OPEN':
      return 'warning';
    default:
      return 'neutral';
  }
}

export function statusLabel(copy: ThesisCopy, status: string | null | undefined): string {
  if (!status) return '';
  return copy.status[status] ?? status.replaceAll('_', ' ').toLowerCase();
}

export type GroupSizeState = 'tooSmall' | 'ok' | 'full';

export function groupSizeState(memberCount: number): GroupSizeState {
  if (memberCount < THESIS_GROUP_MIN_MEMBERS) return 'tooSmall';
  return memberCount >= THESIS_GROUP_MAX_MEMBERS ? 'full' : 'ok';
}

export function isGroupLeader(group: Pick<ThesisGroup, 'leaderStudentId'> | null | undefined, studentId: string | null | undefined): boolean {
  return Boolean(group && studentId && group.leaderStudentId === studentId);
}

/** A group can still change members or topic until it has been approved or closed. */
export function isGroupEditable(group: Pick<ThesisGroup, 'status' | 'approvalStatus'> | null | undefined): boolean {
  if (!group) return false;
  if (group.approvalStatus === 'APPROVED') return false;
  return !['CANCELLED', 'COMPLETED', 'APPROVED'].includes(group.status);
}

export function memberLabel(member: ThesisMember): string {
  const name = member.displayName?.trim();
  return name || member.studentNumber?.trim() || member.studentId;
}

export function studentHitLabel(hit: StudentSearchHit): string {
  const name = [hit.lastName, hit.firstName].filter(Boolean).join(' ').trim();
  return name || hit.studentNumber?.trim() || hit.studentId;
}

export function supervisorName(supervisor: ThesisSupervisor): string {
  const name = [supervisor.lastName, supervisor.firstName].filter(Boolean).join(' ').trim();
  return name || supervisor.email?.trim() || supervisor.lecturerId;
}

export interface AdvisorEntry {
  lecturerId: string;
  name: string;
  email: string | null;
  topics: { id: string; title: string }[];
}

/** Groups per-topic supervisor rows into one entry per lecturer, sorted by name. */
export function buildAdvisorDirectory(
  rows: readonly { topic: Pick<ThesisTopic, 'id' | 'title'>; supervisors: readonly ThesisSupervisor[] }[],
): AdvisorEntry[] {
  const byId = new Map<string, AdvisorEntry>();
  for (const row of rows) {
    for (const supervisor of row.supervisors) {
      let entry = byId.get(supervisor.lecturerId);
      if (!entry) {
        entry = { lecturerId: supervisor.lecturerId, name: supervisorName(supervisor), email: supervisor.email?.trim() || null, topics: [] };
        byId.set(supervisor.lecturerId, entry);
      }
      if (!entry.topics.some((topic) => topic.id === row.topic.id)) {
        entry.topics.push({ id: row.topic.id, title: row.topic.title });
      }
    }
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, 'vi'));
}

/** Runs `task` over `items` with at most `limit` in flight; results keep the input order. */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  task: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await task(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

export type MilestoneState = 'done' | 'current' | 'pending';

export function milestoneState(progress: Pick<ThesisProgress, 'completedMilestones' | 'currentMilestone'>, milestone: string): MilestoneState {
  if (progress.completedMilestones.includes(milestone)) return 'done';
  return progress.currentMilestone === milestone ? 'current' : 'pending';
}

/** Share of milestones completed, 0..100. */
export function progressPercent(progress: Pick<ThesisProgress, 'completedMilestones'> | null | undefined): number {
  if (!progress) return 0;
  const done = THESIS_MILESTONES.filter((milestone) => progress.completedMilestones.includes(milestone)).length;
  return Math.round((done / THESIS_MILESTONES.length) * 100);
}

/** A report can be written only by the leader of an approved group (server: GROUP_STATE_CONFLICT otherwise). */
export function canWriteReport(group: Pick<ThesisGroup, 'approvalStatus' | 'status'> | null | undefined, leader: boolean): boolean {
  return Boolean(group && leader && group.approvalStatus === 'APPROVED' && group.status !== 'CANCELLED');
}

// --- Report input ---------------------------------------------------------

export interface ReportInput {
  title: string;
  note: string;
  url: string;
}

export type ReportInputIssue = 'titleLong' | 'noteLong' | 'urlInvalid' | 'artifactRequired';

export function isHttpUrl(value: string): boolean {
  return /^https?:\/\/[^\s/$.?#][^\s]*$/i.test(value.trim());
}

/**
 * Mirrors ThesisReportService: title <= 240, note <= 500, an http(s) link when
 * a link is given, and at least one artifact (link or file) on a new report.
 */
export function validateReportInput(input: ReportInput, hasFile: boolean): ReportInputIssue[] {
  const issues: ReportInputIssue[] = [];
  const title = input.title.trim();
  const note = input.note.trim();
  const url = input.url.trim();
  if (title.length > THESIS_REPORT_TITLE_MAX) issues.push('titleLong');
  if (note.length > THESIS_REPORT_NOTE_MAX) issues.push('noteLong');
  if (url && !isHttpUrl(url)) issues.push('urlInvalid');
  if (!url && !hasFile) issues.push('artifactRequired');
  return issues;
}

export type ReportFileIssue = 'fileType' | 'fileSize' | 'fileEmpty';

export function reportFileExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot < 0 ? '' : name.slice(dot + 1).trim().toLowerCase();
}

export function reportMimeType(name: string): string {
  switch (reportFileExtension(name)) {
    case 'pdf': return THESIS_REPORT_MIME_TYPES[0];
    case 'doc': return THESIS_REPORT_MIME_TYPES[1];
    default: return THESIS_REPORT_MIME_TYPES[2];
  }
}

export function validateReportFile(file: { name: string; sizeBytes?: number }): ReportFileIssue | null {
  if (!(THESIS_REPORT_FILE_EXTENSIONS as readonly string[]).includes(reportFileExtension(file.name))) return 'fileType';
  if (file.sizeBytes !== undefined) {
    if (file.sizeBytes <= 0) return 'fileEmpty';
    if (file.sizeBytes > THESIS_REPORT_FILE_MAX_BYTES) return 'fileSize';
  }
  return null;
}

// --- Errors ---------------------------------------------------------------

export type ThesisErrorKind = 'session' | 'forbidden' | 'offline' | 'notFound' | 'conflict' | 'unavailable' | 'rate' | 'aborted' | 'generic';

export interface ThesisErrorInfo {
  kind: ThesisErrorKind;
  status: number | null;
  code: string;
}

export function thesisErrorInfo(error: unknown): ThesisErrorInfo {
  const status = (error as { status?: unknown } | null)?.status;
  const code = (error as { code?: unknown } | null)?.code;
  const numeric = typeof status === 'number' ? status : error instanceof TypeError ? 0 : null;
  const text = typeof code === 'string' ? code : '';
  const base = { status: numeric, code: text };
  if (text === 'REQUEST_ABORTED' || text === 'SESSION_CHANGED' || (error as { name?: unknown } | null)?.name === 'AbortError') {
    return { ...base, kind: 'aborted' };
  }
  if (numeric === 0 || text === 'NETWORK_ERROR') return { ...base, kind: 'offline' };
  if (numeric === 401) return { ...base, kind: 'session' };
  if (numeric === 403) return { ...base, kind: 'forbidden' };
  if (numeric === 404) return { ...base, kind: 'notFound' };
  if (numeric === 409 || numeric === 412) return { ...base, kind: 'conflict' };
  if (numeric === 429) return { ...base, kind: 'rate' };
  if (numeric !== null && numeric >= 500) return { ...base, kind: 'unavailable' };
  return { ...base, kind: 'generic' };
}

export function isAbortLike(error: unknown): boolean {
  return thesisErrorInfo(error).kind === 'aborted';
}

/** One student-safe sentence. The server text is never shown; a known code picks specific copy. */
export function thesisErrorMessage(copy: ThesisCopy, error: unknown): string {
  const info = thesisErrorInfo(error);
  const specific = info.code ? copy.errors.codes[info.code] : undefined;
  if (specific) return specific;
  switch (info.kind) {
    case 'session': return copy.errors.session;
    case 'forbidden': return copy.errors.forbidden;
    case 'offline': return copy.errors.offline;
    case 'notFound': return copy.errors.notFound;
    case 'conflict': return copy.errors.conflict;
    case 'unavailable': return copy.errors.unavailable;
    default: return copy.errors.generic;
  }
}

// --- Report save plan -------------------------------------------------------

export interface ReportSavePlan {
  /** Ordered server calls. `file` carries title and note; `patch` carries only changed link, title or note. */
  steps: ('file' | 'link' | 'patch')[];
  patch: { title?: string; note?: string; url?: string; clearUrl?: boolean } | null;
  /** Title and note sent with the `file` or `link` step. */
  title: string;
  note: string;
  url: string;
}

/**
 * Turns the form into the smallest set of calls. A new report is created by
 * either a link or a file (the link then follows as a patch); an existing one
 * is edited non-destructively: only changed fields are patched, and a cleared
 * link uses `clearUrl`, which the server allows only while a file remains.
 */
export function planReportSave(existing: ThesisReport | null, input: ReportInput, hasPickedFile: boolean): ReportSavePlan {
  const title = input.title.trim();
  const note = input.note.trim();
  const url = input.url.trim();
  const base = { title, note, url };
  if (!existing) {
    if (hasPickedFile) {
      return { ...base, steps: url ? ['file', 'patch'] : ['file'], patch: url ? { url } : null };
    }
    return { ...base, steps: ['link'], patch: null };
  }
  const changes: NonNullable<ReportSavePlan['patch']> = {};
  const storedUrl = existing.url?.trim() ?? '';
  if (!hasPickedFile) {
    if (title !== (existing.title?.trim() ?? '')) changes.title = title;
    if (note !== (existing.note?.trim() ?? '')) changes.note = note;
  }
  if (url !== storedUrl) {
    if (url) changes.url = url;
    else changes.clearUrl = true;
  }
  const patch = Object.keys(changes).length > 0 ? changes : null;
  const steps: ReportSavePlan['steps'] = [];
  if (hasPickedFile) steps.push('file');
  if (patch) steps.push('patch');
  return { ...base, steps, patch };
}
