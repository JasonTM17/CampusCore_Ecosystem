// Typed thesis reads and mutations over the shared transport. Lists reuse the
// paged parity reads; everything else maps to the Java thesis endpoints that
// the student role may call. No payload is invented client-side.

import { apiClient, type ApiClient, type ApiDownload } from '../../api/client';
import { createParityApi, type ListOptions } from '../../api/parity-api';
import type { PagedResult } from '../../api/paging';
import type {
  StudentSearchHit,
  ThesisGroup,
  ThesisProgress,
  ThesisReport,
  ThesisRound,
  ThesisSupervisor,
  ThesisTopic,
} from './thesis-model';

export interface ReportFilePart {
  uri: string;
  name: string;
  type: string;
}

export interface ReportFileInput {
  file: ReportFilePart;
  title?: string;
  note?: string;
}

export interface ReportLinkInput {
  title?: string;
  note?: string;
  url: string;
}

export interface ReportPatchInput {
  title?: string;
  note?: string;
  url?: string;
  clearUrl?: boolean;
}

interface Transfer {
  signal?: AbortSignal;
}

export function createThesisApi(client: ApiClient = apiClient) {
  const parity = createParityApi(client);
  const id = encodeURIComponent;
  const base = '/thesis';

  return {
    rounds: (options: ListOptions = {}) =>
      parity.thesisRounds(options) as Promise<PagedResult<ThesisRound>>,
    topics: (roundId: string, options: ListOptions = {}) =>
      parity.thesisTopics(roundId, options) as Promise<PagedResult<ThesisTopic>>,
    topic: (topicId: string, options: Transfer = {}) =>
      client.get<ThesisTopic>(`${base}/topics/${id(topicId)}`, { signal: options.signal }),
    supervisors: (topicId: string, options: Transfer = {}) =>
      client.get<ThesisSupervisor[]>(`${base}/topics/${id(topicId)}/supervisors`, { signal: options.signal }),
    /** Every group the student belongs to; the caller keeps the one for the selected round. */
    myGroups: (options: ListOptions = {}) =>
      parity.myThesisGroups(options) as Promise<PagedResult<ThesisGroup>>,
    progress: (roundId: string, options: Transfer = {}) =>
      client.get<ThesisProgress>(`${base}/me/progress?roundId=${id(roundId)}`, { signal: options.signal }),
    searchStudents: (query: string, options: Transfer = {}) =>
      client.get<StudentSearchHit[]>(`${base}/students/search?q=${id(query)}`, { signal: options.signal }),

    createGroup: (roundId: string) =>
      client.post<ThesisGroup>(`${base}/groups`, { roundId }),
    addMember: (groupId: string, studentId: string) =>
      client.post<ThesisGroup>(`${base}/groups/${id(groupId)}/members`, { studentId }),
    removeMember: (groupId: string, studentId: string) =>
      client.delete<ThesisGroup>(`${base}/groups/${id(groupId)}/members/${id(studentId)}`),
    assignTopic: (groupId: string, topicId: string) =>
      client.post<ThesisGroup>(`${base}/groups/${id(groupId)}/topic`, { topicId }),

    /** 404 means no report yet; the caller maps that to an empty state. */
    report: (groupId: string, options: Transfer = {}) =>
      client.get<ThesisReport>(`${base}/groups/${id(groupId)}/report`, { signal: options.signal }),
    submitReportLink: (groupId: string, input: ReportLinkInput) =>
      client.post<ThesisReport>(`${base}/groups/${id(groupId)}/report`, input),
    submitReportFile: (groupId: string, input: ReportFileInput, options: Transfer = {}) => {
      const form = new FormData();
      form.append('file', input.file as unknown as Blob);
      if (input.title) form.append('title', input.title);
      if (input.note) form.append('note', input.note);
      return client.upload<ThesisReport>(`${base}/groups/${id(groupId)}/report/file`, form, { signal: options.signal });
    },
    updateReport: (groupId: string, input: ReportPatchInput) =>
      client.patch<ThesisReport>(`${base}/groups/${id(groupId)}/report`, input),
    removeReportFile: (groupId: string) =>
      client.delete<ThesisReport>(`${base}/groups/${id(groupId)}/report/file`),
    downloadReportFile: (groupId: string, options: Transfer = {}): Promise<ApiDownload> =>
      client.download(`${base}/groups/${id(groupId)}/report/file`, { signal: options.signal }),
  };
}

export type ThesisApi = ReturnType<typeof createThesisApi>;

export const thesisApi = createThesisApi();
