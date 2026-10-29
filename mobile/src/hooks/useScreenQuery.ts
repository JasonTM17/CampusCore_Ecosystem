import { getNetworkStateAsync } from 'expo-network';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { apiClient } from '../api/client';
import { NO_CAPABILITIES } from '../auth/capabilities';
import { sessionStore } from '../auth/mobile-session-store';
import { useLocale } from '../i18n/locale-provider';
import { useSession } from '../session/SessionContext';
import {
  evictQueryCache,
  queryCacheKey,
  readQueryCache,
  writeQueryCache,
  type QueryCacheScope,
} from './query-cache';

export interface ScreenQueryOptions<T> {
  /** Defaults to live mode — preview sessions never fetch (KM-9). */
  enabled?: boolean;
  /**
   * Extra cache dimensions (filter, page). The account, locale, role and
   * capability grant always come from the session and cannot be overridden
   * away: a read model never crosses any of them.
   */
  scope?: QueryCacheScope;
  /** Expire cached memory data after this many milliseconds. */
  maxAge?: number;
  /** Friendly fallback for the error state (denied/offline copy is caller's). */
  errorMessage?: string;
  mapError?: (error: unknown) => string;
}

export interface ScreenQueryResult<T> {
  data: T | undefined;
  /** First load with no cached value. */
  isLoading: boolean;
  /** Cached data is shown while a revalidation is in flight (SWR). */
  isStale: boolean;
  /**
   * Blocking error — only set when there is NO cached/stale data to show.
   * A failed revalidation over existing data lands in `warning` instead
   * (§5 offline-stale: memory data + banner, never a bare error panel).
   */
  error: string | null;
  /**
   * Non-blocking copy for the stale-but-visible state (offline/refresh
   * failure with data still on screen). Render as a banner, not a panel.
   */
  warning: string | null;
  /** HTTP status for denied/offline-aware copy (403 → denied, no retry). */
  errorStatus: number | null;
  reload(): Promise<void>;
  setData(next: T): void;
}

function defaultError(error: unknown, fallback: string): string {
  const status = (error as { status?: number })?.status;
  if (status === 403) {
    return 'You do not have access to this resource.';
  }
  if (status === 0) {
    return 'You appear to be offline — showing the last known data.';
  }
  return fallback;
}

interface QueryBoundary {
  cacheKey: string;
  epoch: number;
  enabled: boolean;
  inFlight: boolean;
}

interface QueryState<T> {
  boundary: QueryBoundary;
  data: T | undefined;
  isLoading: boolean;
  isStale: boolean;
  error: string | null;
  warning: string | null;
  errorStatus: number | null;
}

function initialQueryState<T>(boundary: QueryBoundary, maxAge?: number): QueryState<T> {
  const data = boundary.enabled ? readQueryCache<T>(boundary.cacheKey, maxAge) : undefined;
  return { boundary, data, isLoading: boundary.enabled && data === undefined,
    isStale: false, error: null, warning: null, errorStatus: null };
}

/**
 * Query lifecycle hook (mobile-policy §5): fetch on mount, refetch when the
 * screen regains focus and when the app returns to the foreground,
 * stale-while-revalidate from the per-account cache, bounded retry handled
 * by the apiClient refresh lane (one retry after a rotation — never a loop).
 */
export function useScreenQuery<T>(
  queryKey: string,
  fetcher: () => Promise<T>,
  options: ScreenQueryOptions<T> = {},
): ScreenQueryResult<T> {
  const session = useSession();
  const { locale } = useLocale();
  const enabled = options.enabled ?? apiClient.mode === 'live';
  const cacheKey = queryCacheKey(session.accountId, queryKey, {
    ...options.scope,
    locale: options.scope?.locale ?? locale,
    roleLane: options.scope?.roleLane ?? session.role,
    grants: session.capabilities ?? NO_CAPABILITIES,
  });

  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  // options is a fresh literal per render — hoist into a ref so `reload`
  // keeps a stable identity and useEffect([reload]) never refires in a
  // fetch→render→fetch loop.
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const mountedRef = useRef(true);
  const epoch = sessionStore.sessionEpoch();
  const boundary = useMemo<QueryBoundary>(() => ({ cacheKey, epoch, enabled, inFlight: false }),
    [cacheKey, epoch, enabled]);
  const activeBoundaryRef = useRef(boundary);
  activeBoundaryRef.current = boundary;
  const [state, setState] = useState<QueryState<T>>(() => initialQueryState<T>(boundary, options.maxAge));
  // State belongs to its query identity. An effect-only reset would expose the
  // old account/resource for one render before the reset effect can run.
  const visible = state.boundary === boundary ? state : initialQueryState<T>(boundary, options.maxAge);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const isCurrent = useCallback(() => mountedRef.current
    && activeBoundaryRef.current === boundary
    && boundary.epoch === sessionStore.sessionEpoch(), [boundary]);

  const update = useCallback((patch: Partial<QueryState<T>>) => {
    if (!isCurrent()) return;
    setState((previous) => ({
      ...(previous.boundary === boundary ? previous : initialQueryState<T>(boundary, optionsRef.current.maxAge)),
      ...patch,
    }));
  }, [boundary, isCurrent]);

  const setData = useCallback((next: T) => {
    if (!enabled || !isCurrent()) return;
    writeQueryCache(cacheKey, next);
    update({ data: next });
  }, [cacheKey, enabled, isCurrent, update]);

  const reload = useCallback(async () => {
    if (!enabled || boundary.inFlight || !isCurrent()) {
      return;
    }
    // Dedupe only this identity. A pending old resource must not suppress the
    // first request for the newly selected resource/account/locale/grants.
    boundary.inFlight = true;
    const cached = readQueryCache<T>(cacheKey, optionsRef.current.maxAge);
    update({ data: cached, isLoading: cached === undefined, isStale: cached !== undefined,
      error: null, warning: null, errorStatus: null });
    try {
      const next = await fetcherRef.current();
      if (!isCurrent()) return;
      writeQueryCache(cacheKey, next);
      update({ data: next });
    } catch (nextError) {
      if (!isCurrent()) return;
      const opts = optionsRef.current;
      const message = (opts.mapError ?? defaultError)(nextError, opts.errorMessage ?? 'This data is unavailable.');
      let status = typeof (nextError as { status?: number })?.status === 'number'
        ? (nextError as { status: number }).status
        : (nextError instanceof TypeError ? 0 : null);
      if (status === null) {
        // Connectivity signal (§5): an unclassified failure while the OS
        // reports no link is treated as offline, not an API error.
        try {
          const network = await getNetworkStateAsync();
          if (network.isConnected === false) {
            status = 0;
          }
        } catch {
          // expo-network unavailable (tests/preview) — classification
          // already fell back to the fetch-failure signal.
        }
      }
      if (!isCurrent()) return;
      // Denied is always a full state (§5). Other failures degrade to a
      // stale-data banner when the screen already has something to show.
      if (status === 403 || readQueryCache<T>(cacheKey, optionsRef.current.maxAge) === undefined) {
        if (status === 403) {
          // A revoked grant must not keep showing what it used to allow.
          evictQueryCache(cacheKey);
        }
        update({ data: undefined, error: message, errorStatus: status });
      } else {
        update({ warning: message, errorStatus: status });
      }
    } finally {
      update({ isLoading: false, isStale: false });
      boundary.inFlight = false;
    }
  }, [cacheKey, enabled, boundary, isCurrent, update]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Focus refetch — re-entering a screen revalidates through SWR.
  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  // Foreground refetch — the app becoming active revalidates the surface.
  useEffect(() => {
    if (!enabled) {
      return;
    }
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void reload();
      }
    });
    return () => subscription.remove();
  }, [enabled, reload]);

  return { data: visible.data, isLoading: visible.isLoading, isStale: visible.isStale,
    error: visible.error, warning: visible.warning, errorStatus: visible.errorStatus, reload, setData };
}
