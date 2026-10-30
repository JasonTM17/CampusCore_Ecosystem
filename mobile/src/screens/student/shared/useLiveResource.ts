import { apiClient } from '../../../api/client';
import { useScreenQuery } from '../../../hooks/useScreenQuery';
import { studentFriendlyErrorMessage } from './errors';

/**
 * Screen-local resource helper — the shared lifecycle lives in
 * `useScreenQuery` (mobile-policy §5: mount/focus/foreground refetch,
 * per-account SWR cache); this keeps the legacy call-site shape and adds the
 * student-friendly error mapping.
 */
export function useLiveResource<T>(
  key: string,
  initialValue: T,
  request: () => Promise<T>,
  fallbackMessage: string,
) {
  const query = useScreenQuery<T>(key, request, {
    enabled: apiClient.mode === 'live',
    errorMessage: fallbackMessage,
    mapError: (error) => studentFriendlyErrorMessage(error, fallbackMessage),
  });
  return {
    data: query.data ?? initialValue,
    error: query.error,
    warning: query.warning,
    isLoading: query.isLoading,
    reload: query.reload,
    setData: (next: T | ((current: T) => T)) =>
      query.setData(
        typeof next === 'function'
          ? (next as (current: T) => T)(query.data ?? initialValue)
          : next,
      ),
  };
}
