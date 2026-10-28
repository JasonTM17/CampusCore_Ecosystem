import {
  apiClient,
  type ApiClient,
  type ApiDownload,
  type MobileCareerOpportunity,
  type MobileEvent,
  type MobileEventRegistration,
  type MobileLibraryTitle,
  type MobileThesisGroup,
  type MobileThesisRound,
  type MobileThesisTopic,
} from './client';
import type { components } from './generated-api';
import {
  buildQuery,
  pagingParams,
  toPagedResult,
  type PageParams,
  type PagedResult,
} from './paging';

type Schemas = components['schemas'];

/** Server window (`page` is 0-based) plus the caller's cancellation signal. */
export interface ListOptions extends PageParams {
  signal?: AbortSignal;
}

export interface ThesisTopicListOptions extends ListOptions {
  /** Defaults to PUBLISHED, the only status the student lane may browse. */
  status?: string;
}

/** A file part: a Blob on web/tests, or the `{ uri, name, type }` descriptor React Native uploads. */
export type UploadFilePart = Blob | { uri: string; name: string; type: string };

export interface TransferOptions {
  signal?: AbortSignal;
}

/**
 * The key identifies the user's intent. A retry of the same intent after an
 * unknown outcome must pass the same key; a changed payload needs a new one.
 */
export interface IdempotentTransferOptions extends TransferOptions {
  idempotencyKey: string;
}

export interface AttachmentUploadOptions extends IdempotentTransferOptions {
  /** Optional hex digest the server verifies against the received bytes. */
  checksum?: string;
}

export interface SubmissionFormInput {
  textBody?: string;
  file?: UploadFilePart;
  checksum?: string;
}

export type ApplicationResult = Schemas['ApplicationResponse'];
export type SubmissionResult = Schemas['SubmissionResponse'];

function appendPart(form: FormData, name: string, value: UploadFilePart) {
  // React Native's FormData takes the descriptor object; DOM typings only know Blob.
  (form as unknown as { append(partName: string, partValue: unknown): void }).append(name, value);
}

function buildAttachmentForm(file: UploadFilePart, checksum?: string) {
  const form = new FormData();
  appendPart(form, 'file', file);
  if (checksum) form.append('checksum', checksum);
  return form;
}

function buildSubmissionForm(input: SubmissionFormInput) {
  const form = new FormData();
  if (input.textBody !== undefined) form.append('textBody', input.textBody);
  if (input.checksum) form.append('checksum', input.checksum);
  if (input.file) appendPart(form, 'file', input.file);
  return form;
}

/**
 * Typed facades over the shared transport. List bodies stay bare arrays on
 * the wire; the optional paging window and `X-Total-Count` are handled here.
 * File calls ride the client's refresh, epoch and abort authority.
 */
export function createParityApi(client: ApiClient) {
  async function readPage<T>(
    path: string,
    filters: Record<string, string | undefined>,
    options: ListOptions,
  ): Promise<PagedResult<T>> {
    const { signal, page, limit } = options;
    const paging: PageParams = { page, limit };
    const query = buildQuery({ ...filters, ...pagingParams(paging) });
    const { data, headers } = await client.requestWithMeta<T[]>(`${path}${query}`, {
      method: 'GET',
      signal,
    });
    return toPagedResult<T>(data, headers, paging);
  }

  const id = encodeURIComponent;

  return {
    events: (options: ListOptions = {}) =>
      readPage<MobileEvent>('/events', {}, options),
    myEventRegistrations: (options: ListOptions = {}) =>
      readPage<MobileEventRegistration>('/events/my/registrations', {}, options),
    libraryCatalogue: (options: ListOptions & { query?: string } = {}) =>
      readPage<MobileLibraryTitle>('/library/catalogue', { query: options.query }, options),
    careersOpportunities: (options: ListOptions & { query?: string } = {}) =>
      readPage<MobileCareerOpportunity>('/careers/opportunities', { query: options.query }, options),
    thesisRounds: (options: ListOptions & { status?: string } = {}) =>
      readPage<MobileThesisRound>('/thesis/rounds', { status: options.status }, options),
    thesisTopics: (roundId: string, options: ThesisTopicListOptions = {}) =>
      readPage<MobileThesisTopic>(
        '/thesis/topics',
        { roundId, status: options.status ?? 'PUBLISHED' },
        options,
      ),
    thesisGroups: (roundId: string, options: ListOptions = {}) =>
      readPage<MobileThesisGroup>('/thesis/groups', { roundId }, options),
    myThesisGroups: (options: ListOptions = {}) =>
      readPage<MobileThesisGroup>('/thesis/groups/mine', {}, options),

    // Admissions: applicant-owned attachment (multipart overload of the JSON upload path).
    admissionsUploadAttachment: (
      applicationId: string,
      file: UploadFilePart,
      options: AttachmentUploadOptions,
    ) =>
      client.upload<ApplicationResult>(
        `/admissions/applications/${id(applicationId)}/attachments`,
        buildAttachmentForm(file, options.checksum),
        { idempotencyKey: options.idempotencyKey, signal: options.signal },
      ),
    admissionsDownloadAttachment: (
      applicationId: string,
      attachmentId: string,
      options: TransferOptions = {},
    ): Promise<ApiDownload> =>
      client.download(
        `/admissions/applications/${id(applicationId)}/attachments/${id(attachmentId)}/file`,
        { signal: options.signal },
      ),

    // Careers: candidate-owned attachment.
    careersUploadAttachment: (
      applicationId: string,
      file: UploadFilePart,
      options: AttachmentUploadOptions,
    ) =>
      client.upload<ApplicationResult>(
        `/careers/applications/${id(applicationId)}/attachments`,
        buildAttachmentForm(file, options.checksum),
        { idempotencyKey: options.idempotencyKey, signal: options.signal },
      ),
    careersDownloadAttachment: (
      applicationId: string,
      attachmentId: string,
      options: TransferOptions = {},
    ): Promise<ApiDownload> =>
      client.download(
        `/careers/applications/${id(applicationId)}/attachments/${id(attachmentId)}/download`,
        { signal: options.signal },
      ),

    // Learning (student lane): draft save and resubmit accept an optional file part.
    learningSaveDraftMultipart: (
      submissionId: string,
      input: SubmissionFormInput,
      options: TransferOptions = {},
    ) =>
      client.upload<SubmissionResult>(
        `/learning/submissions/${id(submissionId)}/draft`,
        buildSubmissionForm(input),
        { method: 'PUT', signal: options.signal },
      ),
    learningResubmitMultipart: (
      assignmentId: string,
      input: SubmissionFormInput,
      options: IdempotentTransferOptions,
    ) =>
      client.upload<SubmissionResult>(
        `/learning/assignments/${id(assignmentId)}/resubmit`,
        buildSubmissionForm(input),
        { idempotencyKey: options.idempotencyKey, signal: options.signal },
      ),
    learningDownloadMaterial: (materialId: string, options: TransferOptions = {}): Promise<ApiDownload> =>
      client.download(`/learning/materials/${id(materialId)}/file`, { signal: options.signal }),
    learningDownloadRevision: (revisionId: string, options: TransferOptions = {}): Promise<ApiDownload> =>
      client.download(`/learning/revisions/${id(revisionId)}/file`, { signal: options.signal }),
  };
}

export type ParityApi = ReturnType<typeof createParityApi>;

export const parityApi: ParityApi = createParityApi(apiClient);
