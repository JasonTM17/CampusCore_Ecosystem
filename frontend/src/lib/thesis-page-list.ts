import {
  correctEmptyPage,
  type ArrayListPage,
} from '@/lib/array-list-page';

export type ThesisPageListKind = 'topics' | 'groups' | 'catalog' | 'repository';

/** Complete ownership identity for one page-list request. */
export interface ThesisPageRequestKey {
  accountId: string;
  authSessionEpoch: number;
  authorizationScope: string;
  roundId: string;
  listKind: ThesisPageListKind;
  status?: string;
  search?: string;
  page: number;
  limit: number;
  generation: number;
  requestSequence: number;
}

export function sameThesisPageRequest(
  left: ThesisPageRequestKey | null | undefined,
  right: ThesisPageRequestKey | null | undefined,
): boolean {
  return Boolean(
    left && right &&
    left.accountId === right.accountId &&
    left.authSessionEpoch === right.authSessionEpoch &&
    left.authorizationScope === right.authorizationScope &&
    left.roundId === right.roundId &&
    left.listKind === right.listKind &&
    left.status === right.status &&
    left.search === right.search &&
    left.page === right.page &&
    left.limit === right.limit &&
    left.generation === right.generation &&
    left.requestSequence === right.requestSequence,
  );
}

export function thesisPageRequestId(key: ThesisPageRequestKey): string {
  return JSON.stringify([
    key.accountId,
    key.authSessionEpoch,
    key.authorizationScope,
    key.roundId,
    key.listKind,
    key.status ?? null,
    key.search ?? null,
    key.page,
    key.limit,
    key.generation,
    key.requestSequence,
  ]);
}

/** Page state is scoped so account, session, round, status, and limit changes start at page zero. */
export function thesisPageSelectionScope(key: Omit<ThesisPageRequestKey, 'page' | 'generation' | 'requestSequence'>): string {
  return JSON.stringify([
    key.accountId,
    key.authSessionEpoch,
    key.authorizationScope,
    key.roundId,
    key.listKind,
    key.status ?? null,
    key.search ?? null,
    key.limit,
  ]);
}

/** A correction may carry across its one follow-up request, but never across retry generations. */
export function thesisPageCorrectionScope(key: ThesisPageRequestKey): string {
  return JSON.stringify([
    thesisPageSelectionScope(key),
    key.generation,
  ]);
}

export interface ThesisPageRequestCallbacks<T, Page extends ArrayListPage<T> = ArrayListPage<T>> {
  requestKey: ThesisPageRequestKey;
  signal: AbortSignal;
  correctionAlreadyUsed?: boolean;
  load: (page: number, signal: AbortSignal) => Promise<Page>;
  isCurrent: (key: ThesisPageRequestKey) => boolean;
  onCorrection: (key: ThesisPageRequestKey, refetch: boolean) => void;
  onSuccess: (result: Page, key: ThesisPageRequestKey) => void;
  onError: (error: unknown, key: ThesisPageRequestKey) => void;
  onFinally: (key: ThesisPageRequestKey) => void;
}

/**
 * Executes one page read and fences every state callback against its full key.
 * A stale empty page redirects to one corrected request; a second inconsistent
 * empty response becomes an ordinary retryable error instead of a loop.
 */
export async function runThesisPageRequest<T, Page extends ArrayListPage<T> = ArrayListPage<T>>(
  options: ThesisPageRequestCallbacks<T, Page>,
): Promise<void> {
  let currentKey = options.requestKey;
  let redirected = false;

  try {
    const result = await options.load(currentKey.page, options.signal);
    if (options.signal.aborted || !options.isCurrent(currentKey)) return;

    if (
      options.correctionAlreadyUsed &&
      result.items.length === 0 &&
      result.total !== 0
    ) {
      throw new Error('The list changed while paging. Retry this page.');
    }

    const correction = options.correctionAlreadyUsed
      ? null
      : correctEmptyPage(currentKey.page, result, currentKey.limit);

    if (correction) {
      currentKey = { ...currentKey, page: correction.page };
      options.onCorrection(currentKey, correction.refetch);
      if (correction.refetch) {
        redirected = true;
        return;
      }
      if (!options.signal.aborted && options.isCurrent(currentKey)) {
        options.onSuccess({ ...result, page: correction.page }, currentKey);
      }
      return;
    }

    if (options.isCurrent(currentKey)) {
      options.onSuccess(result, currentKey);
    }
  } catch (error) {
    if (!options.signal.aborted && options.isCurrent(currentKey)) {
      options.onError(error, currentKey);
    }
  } finally {
    if (!redirected && !options.signal.aborted && options.isCurrent(currentKey)) {
      options.onFinally(currentKey);
    }
  }
}

export function archiveEmptyState(
  archiveTotal: number | undefined,
  filteredTotal: number | undefined,
): 'empty' | 'no-match' | 'unknown' | null {
  if (archiveTotal === 0) return 'empty';
  if (archiveTotal !== undefined && archiveTotal > 0 && filteredTotal === 0) return 'no-match';
  if (archiveTotal === undefined && filteredTotal === 0) return 'unknown';
  return null;
}

export function catalogEmptyState(
  catalogTotal: number | undefined,
  filteredTotal: number | undefined,
): 'empty' | 'no-match' | 'unknown' {
  if (catalogTotal === 0) return 'empty';
  if (catalogTotal !== undefined && catalogTotal > 0 && filteredTotal === 0) return 'no-match';
  return 'unknown';
}
