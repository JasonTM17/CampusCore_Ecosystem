import { beforeEach, afterEach, expect, jest, test } from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';
import { AppState } from 'react-native';

import { useDashboardPrefetch } from '../../src/hooks/use-dashboard-prefetch';
import { clearQueryCache, queryCacheKey, readQueryCache } from '../../src/hooks/query-cache';

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

test('two dispatched reads abort on unmount and cannot populate a later session', async () => {
  const finish: Array<(value: unknown) => void> = [];
  mockGet.mockImplementation(() => new Promise((resolve) => finish.push(resolve)));
  const view = await renderHook(() => useDashboardPrefetch('/dashboard'));
  await advance();
  expect(mockGet).toHaveBeenCalledTimes(2);
  const signals = mockGet.mock.calls.map(([, init]) => init.signal);
  mockEpoch++;
  await view.unmount();
  expect(signals.every((signal) => signal.aborted)).toBe(true);
  await act(async () => { finish[0]([{ id: 'private' }]); finish[1]({ unreadCount: 9 }); });
  const scope = { locale: 'vi', roleLane: 'student', grants: [] };
  expect(readQueryCache(queryCacheKey('a', 'academic.enrollments', scope))).toBeUndefined();
  expect(readQueryCache(queryCacheKey('a', 'content.notifications.unread-count', scope))).toBeUndefined();
});
