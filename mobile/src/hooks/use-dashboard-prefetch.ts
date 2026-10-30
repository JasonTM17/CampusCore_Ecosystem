import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';

import type { MobileEnrollment } from '../api/client';
import { NO_CAPABILITIES } from '../auth/capabilities';
import { useLocale } from '../i18n/locale-provider';
import { useSession } from '../session/SessionContext';
import { isQueryCacheFresh, queryCacheKey, writeQueryCache } from './query-cache';
import { canRevalidate, resourceStaleTime, schedulePrefetch } from './query-performance';

/** At most two small reads after dashboard paint; leaving/backgrounding aborts both. */
export function useDashboardPrefetch(pathname: string): void {
  const session = useSession();
  const { locale } = useLocale();
  const epoch = session.epoch;
  const scope = { locale, roleLane: session.role, grants: session.capabilities ?? NO_CAPABILITIES };
  const enrollmentKey = queryCacheKey(session.accountId, 'academic.enrollments', scope);
  const unreadKey = queryCacheKey(session.accountId, 'content.notifications.unread-count', scope);
  const enabled = pathname === '/dashboard' && session.kind === 'authenticated'
    && session.role === 'student';
  const identity = JSON.stringify([enabled, enrollmentKey, unreadKey, epoch]);
  const currentRef = useRef(identity);
  currentRef.current = identity;

  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    let cancel: Array<() => void> = [];
    const stop = () => { cancel.forEach((task) => task()); cancel = []; };
    const isCurrent = () => !disposed && currentRef.current === identity && canRevalidate(AppState.currentState);
    const start = () => {
      stop();
      if (!isCurrent()) return;
      const prefetch = <T,>(key: string, resource: string,
        read: (api: typeof import('../api/client'), signal: AbortSignal) => Promise<T>) => {
        if (isQueryCacheFresh(key, resourceStaleTime(resource))) return;
        cancel.push(schedulePrefetch({ isCurrent,
          load: async (signal) => {
            // These native/auth modules are non-critical work: resolve only after paint.
            const api = require('../api/client') as typeof import('../api/client');
            const { sessionStore: store } = require('../auth/mobile-session-store') as typeof import('../auth/mobile-session-store');
            if (signal.aborted || !isCurrent() || api.apiClient.mode !== 'live') throw new Error('PREFETCH_CANCELLED');
            const requestEpoch = store.sessionEpoch();
            const data = await read(api, signal);
            return { data, requestEpoch, store };
          },
          publish: ({ data, requestEpoch, store }) => {
            if (requestEpoch === store.sessionEpoch()) writeQueryCache(key, data);
          },
        }));
      };
      prefetch(enrollmentKey, 'academic.enrollments', ({ apiClient, apiRoutes }, signal) => apiClient.get<MobileEnrollment[]>(apiRoutes.enrollments, { signal }));
      prefetch(unreadKey, 'content.notifications.unread-count', async ({ apiClient }, signal) => {
        const data = await apiClient.get<{ unreadCount?: number }>('/notifications/my/unread-count', { signal });
        return typeof data?.unreadCount === 'number' ? data.unreadCount : 0;
      });
    };
    start();
    const subscription = AppState.addEventListener('change', (state) => { if (state === 'active') start(); else stop(); });
    return () => { disposed = true; stop(); subscription.remove(); };
  }, [enabled, identity, epoch, enrollmentKey, unreadKey]);
}
