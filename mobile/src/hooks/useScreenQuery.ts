import { getNetworkStateAsync } from 'expo-network';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { apiClient } from '../api/client';
import { sessionStore } from '../auth/mobile-session-store';
import { useSession } from '../session/SessionContext';
import {
  queryCacheKey,
  readQueryCache,
  writeQueryCache,
} from './query-cache';

export interface ScreenQueryOptions<T> {
  /** Defaults to live mode — preview sessions never fetch (KM-9). */
  enabled?: boolean;
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
  const enabled = options.enabled ?? apiClient.mode === 'live';
  const cacheKey = queryCacheKey(session.accountId, queryKey);

  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  // options is a fresh literal per render — hoist into a ref so `reload`
  // keeps a stable identity and useEffect([reload]) never refires in a
  // fetch→render→fetch loop.
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const inFlightRef = useRef(false);
  const mountedRef = useRef(true);

  const [data, setDataState] = useState<T | undefined>(() =>
    enabled ? readQueryCache<T>(cacheKey) : undefined,
  );
  const [isLoading, setIsLoading] = useState(enabled && data === undefined);
  const [isStale, setIsStale] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [errorStatus, setErrorStatus] = useState<number | null>(null);

  useEffect(() => () => {
    mountedRef.current = false;
  }, []);

  const setData = useCallback((next: T) => {
    writeQueryCache(cacheKey, next);
    if (mountedRef.current) {
      setDataState(next);
    }
  }, [cacheKey]);

  const reload = useCallback(async () => {
    if (!enabled || inFlightRef.current) {
      return;
    }
    inFlightRef.current = true;
    // Stale-lane writeback guard (review R1, KM-16): a fetch that resolves
    // after a sign-out/sign-in cycle rode a newer session's token — its
    // payload must never be written under the OLD account key.
    const fetchEpoch = sessionStore.sessionEpoch();
    const cached = readQueryCache<T>(cacheKey);
    if (cached === undefined) {
      setIsLoading(true);
    } else {
      setDataState(cached);
      setIsStale(true);
    }
    setError(null);
    setWarning(null);
    setErrorStatus(null);
    try {
      const next = await fetcherRef.current();
      if (fetchEpoch !== sessionStore.sessionEpoch()) {
        return;
      }
      writeQueryCache(cacheKey, next);
      if (mountedRef.current) {
        setDataState(next);
      }
    } catch (nextError) {
      if (!mountedRef.current) {
        return;
      }
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
      if (!mountedRef.current) {
        return;
      }
      // Denied is always a full state (§5). Other failures degrade to a
      // stale-data banner when the screen already has something to show.
      if (status === 403 || readQueryCache<T>(cacheKey) === undefined) {
        setError(message);
        setErrorStatus(status);
      } else {
        setWarning(message);
        setErrorStatus(status);
      }
    } finally {
      if (mountedRef.current) {
        setIsLoading(false);
        setIsStale(false);
      }
      inFlightRef.current = false;
    }
  }, [cacheKey, enabled]);

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

  return { data, isLoading, isStale, error, warning, errorStatus, reload, setData };
}
