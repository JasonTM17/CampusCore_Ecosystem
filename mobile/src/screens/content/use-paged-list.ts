// Paged list lifecycle for the content screens. The first page rides
// `useScreenQuery` (per-account cache, focus and foreground revalidation,
// offline and denied classification); further pages are appended locally and
// dropped whenever the first page is refreshed, so a refresh never mixes
// windows from two different server snapshots.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { apiClient } from '../../api/client';
import type { PagedResult } from '../../api/paging';
import { useScreenQuery } from '../../hooks/useScreenQuery';
import { contentMessages } from '../../i18n/content-messages';
import { useLocale } from '../../i18n/locale-provider';
import { contentErrorMessage, isAbortError } from './content-errors';
import {
  CONTENT_PAGE_SIZE,
  EAGER_PAGE_CAP,
  appendPage,
  patchItems,
  startView,
  type PagedView,
} from './content-paging';

export interface PagedListOptions<T> {
  /** Cache key; include every filter that changes the server query. */
  key: string;
  fetchPage: (page: number, limit: number, signal: AbortSignal) => Promise<PagedResult<T>>;
  keyOf: (item: T) => string;
  pageSize?: number;
  enabled?: boolean;
  /** Fetch every remaining page (bounded) so a client-side filter sees the whole list. */
  eager?: boolean;
  /** Rows shown in preview mode; the live path never reads them. */
  preview?: readonly T[];
}

export interface PagedList<T> {
  items: T[];
  total?: number;
  hasMore: boolean;
  /** First load, nothing to show yet. */
  loading: boolean;
  loadingMore: boolean;
  refreshing: boolean;
  /** Blocking error: nothing to show. */
  error: string | null;
  /** Non-blocking: data is on screen but the last refresh failed. */
  warning: string | null;
  loadMoreError: string | null;
  errorStatus: number | null;
  loadMore: () => void;
  refresh: () => void;
  reload: () => Promise<void>;
  /** Applies a local change (return null to drop a row) without a refetch. */
  patch: (change: (item: T) => T | null) => void;
  preview: boolean;
}

const EMPTY: never[] = [];

/**
 * First-page reads are shared: `useScreenQuery` coalesces one in-flight
 * request per cache identity, so several mounted lists can await the same
 * work and a leaving subscriber must never abort a signal another screen
 * still needs. A lease counts the live lists per content key and hands every
 * one of them the same controller; when the last subscriber detaches, the
 * abort lands one microtask later — a synchronous remount keeps the request.
 */
interface FirstPageLease {
  live: number;
  controller: AbortController;
}

const firstPageLeases = new Map<string, FirstPageLease>();

export function usePagedList<T>(options: PagedListOptions<T>): PagedList<T> {
  const { locale } = useLocale();
  const copy = contentMessages[locale];
  const live = apiClient.mode === 'live';
  const enabled = live && (options.enabled ?? true);
  const size = options.pageSize ?? CONTENT_PAGE_SIZE;
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const firstPageSignal = useRef(new AbortController());

  // Own a lease slot for this list key. On key change the previous lease is
  // released and, if no other subscriber keeps it alive, its first-page read
  // is aborted; on unmount the same happens for the final subscriber.
  useEffect(() => {
    const key = options.key;
    let lease = firstPageLeases.get(key);
    if (!lease) {
      lease = { live: 0, controller: new AbortController() };
      firstPageLeases.set(key, lease);
    }
    lease.live += 1;
    firstPageSignal.current = lease.controller;
    return () => {
      firstPageSignal.current = new AbortController();
      lease.live -= 1;
      if (lease.live !== 0) return;
      const released = lease;
      queueMicrotask(() => {
        if (released.live !== 0 || firstPageLeases.get(key) !== released) return;
        firstPageLeases.delete(key);
        released.controller.abort();
      });
    };
  }, [options.key]);

  const first = useScreenQuery<PagedResult<T>>(
    options.key,
    () => optionsRef.current.fetchPage(0, size, firstPageSignal.current.signal),
    {
      enabled,
      errorMessage: copy.generic,
      mapError: (error) => contentErrorMessage(copy, error),
    },
  );

  // Pages beyond the first, owned by one first-page snapshot.
  const [extra, setExtra] = useState<{ owner: PagedResult<T> | undefined; view: PagedView<T> | null }>({ owner: undefined, view: null });
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [localEdit, setLocalEdit] = useState<{ owner: unknown; patches: Array<(item: T) => T | null> }>({ owner: undefined, patches: [] });
  const loadingMoreRef = useRef<AbortController | null>(null);
  const extraRequestsRef = useRef(new Map<PagedResult<T>, AbortController>());
  const ownerRef = useRef<PagedResult<T> | undefined>(undefined);
  const mountedRef = useRef(true);

  useEffect(() => () => {
    mountedRef.current = false;
    for (const controller of extraRequestsRef.current.values()) controller.abort();
    extraRequestsRef.current.clear();
  }, []);

  ownerRef.current = first.data;

  const baseView = useMemo(
    () => (first.data ? startView(first.data, options.keyOf) : null),
    // keyOf is stable per screen; the snapshot identity is the real dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [first.data],
  );

  const view = useMemo<PagedView<T> | null>(() => {
    let current = extra.owner === first.data && extra.view ? extra.view : baseView;
    if (current && localEdit.owner === first.data) {
      for (const patch of localEdit.patches) current = patchItems(current, patch);
    }
    return current;
  }, [baseView, extra, first.data, localEdit]);

  const viewRef = useRef(view);
  viewRef.current = view;

  const loadMore = useCallback(() => {
    const current = viewRef.current;
    const owner = ownerRef.current;
    if (!current || !owner || !current.hasMore || loadingMoreRef.current) return;
    const requested = current.nextPage;
    const controller = new AbortController();
    loadingMoreRef.current = controller;
    extraRequestsRef.current.set(owner, controller);
    setLoadingMore(true);
    setLoadMoreError(null);
    optionsRef.current
      .fetchPage(requested, size, controller.signal)
      .then((page) => {
        if (!mountedRef.current || ownerRef.current !== owner) return;
        setExtra((previous) => {
          const base = previous.owner === owner && previous.view ? previous.view : startView(owner, optionsRef.current.keyOf);
          return { owner, view: appendPage(base, page, requested, optionsRef.current.keyOf) };
        });
      })
      .catch((error: unknown) => {
        if (!mountedRef.current || isAbortError(error) || ownerRef.current !== owner) return;
        setLoadMoreError(contentErrorMessage(copy, error));
      })
      .finally(() => {
        if (extraRequestsRef.current.get(owner) === controller) extraRequestsRef.current.delete(owner);
        if (loadingMoreRef.current === controller) {
          loadingMoreRef.current = null;
          if (mountedRef.current) setLoadingMore(false);
        }
      });
  }, [copy, size]);

  // A new first-page snapshot orphans every page read launched for the
  // previous one: abort them so dead work stops, and hand the paging lock to
  // the new owner instead of waiting for a request that can never land.
  useEffect(() => {
    const requests = extraRequestsRef.current;
    for (const [owner, controller] of requests) {
      if (owner === first.data) continue;
      controller.abort();
      requests.delete(owner);
    }
    if (loadingMoreRef.current?.signal.aborted) {
      loadingMoreRef.current = null;
      setLoadingMore(false);
    }
  }, [first.data]);

  // Client-side filters need every row: keep fetching, bounded, until the list ends.
  useEffect(() => {
    if (!options.eager || !view || !view.hasMore || loadingMore || loadMoreError) return;
    if (view.nextPage >= EAGER_PAGE_CAP) return;
    loadMore();
  }, [options.eager, view, loadingMore, loadMoreError, loadMore]);

  const reload = first.reload;
  const refresh = useCallback(() => {
    setRefreshing(true);
    void reload().finally(() => {
      if (mountedRef.current) setRefreshing(false);
    });
  }, [reload]);

  const patch = useCallback((change: (item: T) => T | null) => {
    setLocalEdit((previous) => {
      const owner = ownerRef.current;
      return previous.owner === owner
        ? { owner, patches: [...previous.patches, change] }
        : { owner, patches: [change] };
    });
  }, []);

  if (!live) {
    const rows = (options.preview ?? EMPTY) as T[];
    return {
      items: rows,
      total: rows.length,
      hasMore: false,
      loading: false,
      loadingMore: false,
      refreshing: false,
      error: null,
      warning: null,
      loadMoreError: null,
      errorStatus: null,
      loadMore: () => {},
      refresh: () => {},
      reload: async () => {},
      patch: () => {},
      preview: true,
    };
  }

  return {
    items: view?.items ?? (EMPTY as T[]),
    total: view?.total,
    hasMore: view?.hasMore ?? false,
    loading: first.isLoading && !view,
    loadingMore,
    refreshing,
    error: first.error,
    warning: first.warning,
    loadMoreError,
    errorStatus: first.errorStatus ?? null,
    loadMore,
    refresh,
    reload,
    patch,
    preview: false,
  };
}
