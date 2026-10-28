// A whole-list read (no paging on the wire) presented as a `PagedList`, so the
// same list frame serves loans, applications and learning rows.

import { useCallback, useEffect, useRef, useState } from 'react';

import { apiClient } from '../../api/client';
import { useContentQuery } from './use-content-query';
import type { PagedList } from './use-paged-list';

const NOOP = () => {};

export interface ListQueryOptions<T> {
  key: string;
  fetchAll: () => Promise<T[]>;
  enabled?: boolean;
  preview?: readonly T[];
}

export function useListQuery<T>({ key, fetchAll, enabled = true, preview }: ListQueryOptions<T>): PagedList<T> {
  const query = useContentQuery<T[]>(key, fetchAll, enabled);
  const [refreshing, setRefreshing] = useState(false);
  const mountedRef = useRef(true);
  const [edits, setEdits] = useState<{ owner: unknown; patches: Array<(item: T) => T | null> }>({ owner: undefined, patches: [] });
  useEffect(() => () => { mountedRef.current = false; }, []);

  const reload = query.reload;
  const refresh = useCallback(() => {
    setRefreshing(true);
    void reload().finally(() => {
      if (mountedRef.current) setRefreshing(false);
    });
  }, [reload]);
  const patch = useCallback((change: (item: T) => T | null) => {
    setEdits((previous) => {
      const owner = query.data;
      return previous.owner === owner ? { owner, patches: [...previous.patches, change] } : { owner, patches: [change] };
    });
  }, [query.data]);

  if (apiClient.mode !== 'live') {
    return {
      items: (preview ?? []) as T[],
      total: preview?.length ?? 0,
      hasMore: false,
      loading: false,
      loadingMore: false,
      refreshing: false,
      error: null,
      warning: null,
      loadMoreError: null,
      errorStatus: null,
      loadMore: NOOP,
      refresh: NOOP,
      reload: async () => {},
      patch: NOOP,
      preview: true,
    };
  }

  let items = query.data ?? [];
  if (edits.owner === query.data) {
    for (const change of edits.patches) {
      items = items.flatMap((item) => {
        const next = change(item);
        return next === null ? [] : [next];
      });
    }
  }
  return {
    items,
    total: query.data ? items.length : undefined,
    hasMore: false,
    loading: query.isLoading && query.data === undefined,
    loadingMore: false,
    refreshing,
    error: query.error,
    warning: query.warning,
    loadMoreError: null,
    errorStatus: query.errorStatus ?? null,
    loadMore: NOOP,
    refresh,
    reload,
    patch,
    preview: false,
  };
}
