'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ArrayListPage } from '@/lib/array-list-page';
import {
  runThesisPageRequest,
  sameThesisPageRequest,
  thesisPageCorrectionScope,
  thesisPageRequestId,
  thesisPageSelectionScope,
  type ThesisPageListKind,
  type ThesisPageRequestKey,
} from '@/lib/thesis-page-list';

interface SelectionState {
  scope: string;
  page: number;
  generation: number;
}

interface ThesisPageResult<T> extends ArrayListPage<T> {
  summary?: { total?: number; files?: number; urls?: number };
  catalogTotal?: number;
}

interface PageState<T> {
  requestId: string | null;
  items: T[];
  total?: number;
  summary?: ThesisPageResult<T>['summary'];
  catalogTotal?: number;
  loading: boolean;
  failed: boolean;
}

export interface UseThesisPagedListOptions<T> {
  accountId: string;
  authSessionEpoch: number;
  authorizationScope: string;
  roundId: string;
  listKind: ThesisPageListKind;
  status?: string;
  search?: string;
  limit: number;
  enabled: boolean;
  load: (page: number, signal: AbortSignal) => Promise<ThesisPageResult<T>>;
}

export function useThesisPagedList<T>(options: UseThesisPagedListOptions<T>) {
  const selectionScope = thesisPageSelectionScope({
    accountId: options.accountId,
    authSessionEpoch: options.authSessionEpoch,
    authorizationScope: options.authorizationScope,
    roundId: options.roundId,
    listKind: options.listKind,
    status: options.status,
    search: options.search,
    limit: options.limit,
  });
  const [selection, setSelection] = useState<SelectionState>({
    scope: '',
    page: 0,
    generation: 0,
  });
  const page = selection.scope === selectionScope ? selection.page : 0;
  const generation = selection.scope === selectionScope ? selection.generation : 0;
  const [requestSequence, setRequestSequence] = useState(0);
  const requestSequenceRef = useRef(0);
  const currentKeyRef = useRef<ThesisPageRequestKey | null>(null);
  const correctionAttemptRef = useRef<{ scope: string; page: number } | null>(null);
  const skipNextRequestRef = useRef<string | null>(null);
  const [state, setState] = useState<PageState<T>>({
    requestId: null,
    items: [],
    loading: true,
    failed: false,
  });

  const visibleKey: ThesisPageRequestKey = {
    accountId: options.accountId,
    authSessionEpoch: options.authSessionEpoch,
    authorizationScope: options.authorizationScope,
    roundId: options.roundId,
    listKind: options.listKind,
    status: options.status,
    search: options.search,
    page,
    limit: options.limit,
    generation,
    requestSequence,
  };
  const visibleRequestId = thesisPageRequestId(visibleKey);
  currentKeyRef.current = visibleKey;
  const visibleState: PageState<T> = state.requestId === visibleRequestId
    ? state
    : {
      requestId: visibleRequestId,
      items: [],
      total: undefined,
      summary: undefined,
      catalogTotal: undefined,
      loading: true,
      failed: false,
    };

  useEffect(() => {
    if (!options.enabled || !options.roundId) return undefined;

    const requestedKey: ThesisPageRequestKey = {
      accountId: options.accountId,
      authSessionEpoch: options.authSessionEpoch,
      authorizationScope: options.authorizationScope,
      roundId: options.roundId,
      listKind: options.listKind,
      status: options.status,
      search: options.search,
      page,
      limit: options.limit,
      generation,
      requestSequence: requestSequenceRef.current,
    };
    const requestedId = thesisPageRequestId(requestedKey);
    if (skipNextRequestRef.current === requestedId) {
      skipNextRequestRef.current = null;
      return undefined;
    }
    skipNextRequestRef.current = null;

    const requestSequenceValue = ++requestSequenceRef.current;
    const requestKey = { ...requestedKey, requestSequence: requestSequenceValue };
    const requestId = thesisPageRequestId(requestKey);
    const correctionScope = thesisPageCorrectionScope(requestKey);
    const pendingCorrection = correctionAttemptRef.current;
    const correctionAlreadyUsed = Boolean(
      pendingCorrection &&
      pendingCorrection.scope === correctionScope &&
      pendingCorrection.page === requestKey.page,
    );
    if (pendingCorrection && !correctionAlreadyUsed) {
      correctionAttemptRef.current = null;
    }

    const controller = new AbortController();
    currentKeyRef.current = requestKey;
    setRequestSequence(requestSequenceValue);
    setState({ requestId, items: [], loading: true, failed: false });

    const isCurrent = (key: ThesisPageRequestKey) =>
      !controller.signal.aborted &&
      requestSequenceRef.current === key.requestSequence &&
      sameThesisPageRequest(currentKeyRef.current, key);

    void runThesisPageRequest<T, ThesisPageResult<T>>({
      requestKey,
      signal: controller.signal,
      correctionAlreadyUsed,
      load: options.load,
      isCurrent,
      onCorrection: (correctedKey, refetch) => {
        currentKeyRef.current = correctedKey;
        setSelection({
          scope: selectionScope,
          page: correctedKey.page,
          generation: correctedKey.generation,
        });
        if (refetch) {
          correctionAttemptRef.current = {
            scope: thesisPageCorrectionScope(correctedKey),
            page: correctedKey.page,
          };
          setState({ requestId: thesisPageRequestId(correctedKey), items: [], loading: true, failed: false });
        } else {
          skipNextRequestRef.current = thesisPageRequestId(correctedKey);
        }
      },
      onSuccess: (result, key) => {
        if (!isCurrent(key)) return;
        setState((current) => isCurrent(key)
          ? {
            requestId: thesisPageRequestId(key),
            items: result.items,
            total: result.total,
            summary: result.summary,
            catalogTotal: result.catalogTotal,
            loading: true,
            failed: false,
          }
          : current);
      },
      onError: (_error, key) => {
        if (!isCurrent(key)) return;
        setState((current) => isCurrent(key)
          ? { ...current, requestId: thesisPageRequestId(key), failed: true }
          : current);
      },
      onFinally: (key) => {
        if (!isCurrent(key)) return;
        setState((current) => (
          current.requestId === thesisPageRequestId(key) && isCurrent(key)
            ? { ...current, loading: false }
            : current
        ));
      },
    });

    return () => controller.abort();
  }, [
    options.accountId,
    options.authSessionEpoch,
    options.authorizationScope,
    options.enabled,
    options.limit,
    options.listKind,
    options.load,
    options.roundId,
    options.search,
    options.status,
    page,
    generation,
    selectionScope,
  ]);

  const goToPage = useCallback((nextPage: number) => {
    skipNextRequestRef.current = null;
    correctionAttemptRef.current = null;
    setSelection({ scope: selectionScope, page: Math.max(0, Math.trunc(nextPage) || 0), generation });
  }, [generation, selectionScope]);

  const retry = useCallback(() => {
    skipNextRequestRef.current = null;
    correctionAttemptRef.current = null;
    setSelection({ scope: selectionScope, page, generation: generation + 1 });
  }, [generation, page, selectionScope]);

  const invalidate = useCallback(() => {
    const sequence = requestSequenceRef.current + 1;
    requestSequenceRef.current = sequence;
    currentKeyRef.current = null;
    correctionAttemptRef.current = null;
    skipNextRequestRef.current = null;
    setRequestSequence(sequence);
    setSelection((current) => ({
      scope: selectionScope,
      page: current.scope === selectionScope ? current.page : 0,
      generation: (current.scope === selectionScope ? current.generation : 0) + 1,
    }));
  }, [selectionScope]);

  return {
    page,
    limit: options.limit,
    items: visibleState.items,
    total: visibleState.total,
    summary: visibleState.summary,
    catalogTotal: visibleState.catalogTotal,
    loading: visibleState.loading,
    failed: visibleState.failed,
    goToPage,
    invalidate,
    retry,
  };
}
