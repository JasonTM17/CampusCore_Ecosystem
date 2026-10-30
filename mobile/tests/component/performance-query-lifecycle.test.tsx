import { beforeEach, afterEach, expect, jest, test } from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';

import { useScreenQuery } from '../../src/hooks/useScreenQuery';
import { clearQueryCache } from '../../src/hooks/query-cache';

jest.mock('../../src/session/SessionContext', () => ({ useSession: () => ({ accountId: 'a', role: 'student', capabilities: [] }) }));
jest.mock('../../src/i18n/locale-provider', () => ({ useLocale: () => ({ locale: 'vi' }) }));
jest.mock('../../src/auth/mobile-session-store', () => ({ sessionStore: { sessionEpoch: () => 1 } }));
jest.mock('../../src/api/client', () => ({ apiClient: { mode: 'live' } }));
jest.mock('expo-router', () => ({ useFocusEffect: (callback: () => (() => void)) => {
  const React = jest.requireActual<typeof import('react')>('react');
  React.useEffect(callback, [callback]);
} }));
jest.mock('expo-network', () => ({ getNetworkStateAsync: jest.fn(async () => ({ isConnected: true })) }));

const listeners = new Set<(state: AppStateStatus) => void>();
beforeEach(() => {
  clearQueryCache(); listeners.clear(); AppState.currentState = 'active';
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, callback) => {
    listeners.add(callback);
    return { remove: () => { listeners.delete(callback); } };
  });
});
afterEach(() => { jest.restoreAllMocks(); });
async function state(next: AppStateStatus) {
  await act(async () => { AppState.currentState = next; listeners.forEach((callback) => callback(next)); });
}

test('two mounted consumers and mount/focus share one in-flight request', async () => {
  let finish!: (value: string) => void;
  const pending = new Promise<string>((resolve) => { finish = resolve; });
  const fetcher = jest.fn(() => pending);
  const view = await renderHook(() => [useScreenQuery('content.news', fetcher), useScreenQuery('content.news', fetcher)]);
  expect(fetcher).toHaveBeenCalledTimes(1);
  await act(async () => finish('data'));
  expect(view.result.current.map((query) => query.data)).toEqual(['data', 'data']);
  await view.unmount();
});

test('background pauses new reads; foreground only refreshes stale data', async () => {
  const now = jest.spyOn(Date, 'now').mockReturnValue(1_000);
  const fetcher = jest.fn(async () => 'data');
  const view = await renderHook(() => useScreenQuery('content.news', fetcher));
  expect(fetcher).toHaveBeenCalledTimes(1);
  await state('background');
  await act(async () => view.result.current.reload());
  expect(fetcher).toHaveBeenCalledTimes(1);
  await state('active');
  expect(fetcher).toHaveBeenCalledTimes(1);
  now.mockReturnValue(32_000);
  await state('background'); await state('active');
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(view.result.current.data).toBe('data');
  await view.unmount();
});

test('mounting in background waits for foreground without losing the first load', async () => {
  AppState.currentState = 'background';
  const fetcher = jest.fn(async () => 'data');
  const view = await renderHook(() => useScreenQuery('content.news', fetcher));
  expect(fetcher).not.toHaveBeenCalled();
  expect(view.result.current.isLoading).toBe(true);
  await state('active');
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(view.result.current.data).toBe('data');
  await view.unmount();
});

test('unread count and paged rows retain different result shapes', async () => {
  const view = await renderHook(() => [
    useScreenQuery('content.notifications.unread', async () => ({ items: [{ id: 'one' }] })),
    useScreenQuery('content.notifications.unread-count', async () => 1),
  ]);
  expect(view.result.current[0].data).toEqual({ items: [{ id: 'one' }] });
  expect(view.result.current[1].data).toBe(1);
  await view.unmount();
});
