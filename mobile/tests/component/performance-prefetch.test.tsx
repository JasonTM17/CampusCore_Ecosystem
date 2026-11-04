import { beforeEach, afterEach, expect, jest, test } from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';
import { AppState } from 'react-native';

import { useDashboardPrefetch } from '../../src/hooks/use-dashboard-prefetch';
import { clearQueryCache, queryCacheKey, readQueryCache } from '../../src/hooks/query-cache';
import { coalesceQueryRequest } from '../../src/hooks/query-performance';

let mockEpoch = 1;
const mockGet = jest.fn<(path: string, init: { signal: AbortSignal }) => Promise<unknown>>();
jest.mock('../../src/api/client', () => ({ apiClient: { mode: 'live', get: (...args: Parameters<typeof mockGet>) => mockGet(...args) }, apiRoutes: { enrollments: '/enrollments/my' } }));
jest.mock('../../src/auth/mobile-session-store', () => ({ sessionStore: { sessionEpoch: () => mockEpoch } }));
jest.mock('../../src/session/SessionContext', () => ({ useSession: () => ({ kind: 'authenticated', accountId: 'a', role: 'student', capabilities: [], epoch: 1 }) }));
jest.mock('../../src/i18n/locale-provider', () => ({ useLocale: () => ({ locale: 'vi' }) }));

beforeEach(() => { jest.useFakeTimers(); clearQueryCache(); mockEpoch = 1; mockGet.mockReset(); AppState.currentState = 'active'; });
afterEach(() => { jest.useRealTimers(); });
const advance = () => act(async () => { await jest.advanceTimersByTimeAsync(200); });

test('leaving the dashboard before dispatch cancels both speculative reads', async () => {
  const view = await renderHook(({ path }: { path: string }) => useDashboardPrefetch(path), { initialProps: { path: '/dashboard' } });
  await view.rerender({ path: '/news' });
  await advance();
  expect(mockGet).not.toHaveBeenCalled();
  await view.unmount();
});

test('a prefetch joins the dashboard read already in flight for the same cache key', async () => {
  const scope = { locale: 'vi', roleLane: 'student', grants: [] };
  const key = queryCacheKey('a', 'academic.enrollments', scope);
  let finishScreen!: (value: unknown) => void;
  const screenRead = new Promise((resolve) => { finishScreen = resolve; });
  void coalesceQueryRequest(JSON.stringify([key, 1]), () => screenRead);

  const view = await renderHook(() => useDashboardPrefetch('/dashboard'));
  await advance();
  expect(mockGet.mock.calls.filter(([path]) => path === '/enrollments/my')).toHaveLength(0);

  await act(async () => { finishScreen([{ id: 'shared' }]); });
  expect(readQueryCache(key)).toEqual([{ id: 'shared' }]);
  await view.unmount();
});

test('a prefetch-led shared read still resolves for joined consumers after cancel', async () => {
  const scope = { locale: 'vi', roleLane: 'student', grants: [] };
  const key = queryCacheKey('a', 'content.notifications.unread-count', scope);
  let finish!: () => void;
  mockGet.mockImplementation((path: string, init?: { signal?: AbortSignal }) => new Promise((resolve, reject) => {
    if (path !== '/notifications/my/unread-count') { resolve([]); return; }
    finish = () => resolve({ unreadCount: 3 });
    init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
  }));
  const view = await renderHook(({ path }: { path: string }) => useDashboardPrefetch(path), { initialProps: { path: '/dashboard' } });
  await advance();
  expect(mockGet).toHaveBeenCalledTimes(2);

  // A screen joining the same [key, epoch] identity shares the leader's promise.
  const joined = coalesceQueryRequest(JSON.stringify([key, 1]), () => Promise.resolve('joiner-read'));
  const outcome = joined.then(
    (value) => ({ resolved: true as const, value }),
    (error) => ({ resolved: false as const, error }),
  );

  await view.rerender({ path: '/news' });
  await act(async () => finish());

  expect(await outcome).toEqual({ resolved: true, value: 3 });
  await view.unmount();
});

test('two dispatched reads outlive unmount and cannot populate a later session', async () => {
  const finish: Array<(value: unknown) => void> = [];
  mockGet.mockImplementation(() => new Promise((resolve) => finish.push(resolve)));
  const view = await renderHook(() => useDashboardPrefetch('/dashboard'));
  await advance();
  expect(mockGet).toHaveBeenCalledTimes(2);
  mockEpoch++;
  await view.unmount();
  await act(async () => { finish[0]([{ id: 'private' }]); finish[1]({ unreadCount: 9 }); });
  const scope = { locale: 'vi', roleLane: 'student', grants: [] };
  expect(readQueryCache(queryCacheKey('a', 'academic.enrollments', scope))).toBeUndefined();
  expect(readQueryCache(queryCacheKey('a', 'content.notifications.unread-count', scope))).toBeUndefined();
});
