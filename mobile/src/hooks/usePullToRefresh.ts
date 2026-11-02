import { useCallback, useRef, useState } from 'react';

export interface PullToRefresh {
  /** True only while a pull started by the user is in flight. */
  refreshing: boolean;
  onRefresh: () => void;
}

/**
 * Pull-to-refresh state for a screen. Focus and foreground revalidation run
 * through the query cache, so they must not show this spinner.
 */
export function usePullToRefresh(reload: () => Promise<unknown> | unknown): PullToRefresh {
  const [refreshing, setRefreshing] = useState(false);
  const running = useRef(false);
  const latest = useRef(reload);
  latest.current = reload;

  const onRefresh = useCallback(() => {
    if (running.current) return;
    running.current = true;
    setRefreshing(true);
    void (async () => {
      try {
        await latest.current();
      } catch {
        // The query hook owns the error state; a pull only ends the spinner.
      } finally {
        running.current = false;
        setRefreshing(false);
      }
    })();
  }, []);

  return { refreshing, onRefresh };
}
