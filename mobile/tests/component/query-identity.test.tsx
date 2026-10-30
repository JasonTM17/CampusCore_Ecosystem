import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';
import { getNetworkStateAsync } from 'expo-network';

import { useScreenQuery } from '../../src/hooks/useScreenQuery';
import { clearQueryCache, queryCacheKey, readQueryCache } from '../../src/hooks/query-cache';

let mockEpoch = 1;
let mockLocale = 'vi';
let mockSession = { accountId: 'a', role: 'student', capabilities: [] as string[] };
jest.mock('../../src/session/SessionContext', () => ({ useSession: () => mockSession }));
jest.mock('../../src/i18n/locale-provider', () => ({ useLocale: () => ({ locale: mockLocale }) }));
jest.mock('../../src/auth/mobile-session-store', () => ({ sessionStore: { sessionEpoch: () => mockEpoch } }));
jest.mock('../../src/api/client', () => ({ apiClient: { mode: 'live' } }));
jest.mock('expo-router', () => ({ useFocusEffect: jest.fn() }));
jest.mock('expo-network', () => ({ getNetworkStateAsync: jest.fn(async () => ({ isConnected: true })) }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

beforeEach(() => {
  clearQueryCache();
  mockEpoch = 1;
  mockLocale = 'vi';
  mockSession = { accountId: 'a', role: 'student', capabilities: [] };
  jest.mocked(getNetworkStateAsync).mockReset();
  jest.mocked(getNetworkStateAsync).mockResolvedValue({ isConnected: true });
});

describe('mounted query identity isolation', () => {
  test('a resource switch hides old data on the first render of the new resource', async () => {
    const pending = deferred<string>();
    const seen: Array<{ key: string; data: string | undefined }> = [];
    const { result, rerender } = await renderHook(({ keyName }: { keyName: string }) => {
      const query = useScreenQuery(keyName, () => keyName === 'one' ? Promise.resolve('private A') : pending.promise);
      seen.push({ key: keyName, data: query.data });
      return query;
    }, { initialProps: { keyName: 'one' } });
    expect(result.current.data).toBe('private A');
    await rerender({ keyName: 'two' });
    expect(seen.filter((row) => row.key === 'two').every((row) => row.data === undefined)).toBe(true);
    await act(async () => pending.resolve('B'));
    expect(result.current.data).toBe('B');
  });

  test('new-key fetch starts while old-key fetch is pending; late success is ignored', async () => {
    const old = deferred<string>();
    const next = deferred<string>();
    const fetcher = jest.fn((key: string) => key === 'one' ? old.promise : next.promise);
    const { result, rerender } = await renderHook(({ keyName }: { keyName: string }) =>
      useScreenQuery(keyName, () => fetcher(keyName)), { initialProps: { keyName: 'one' } });
    await rerender({ keyName: 'two' });
    expect(fetcher).toHaveBeenCalledWith('two');
    await act(async () => next.resolve('B'));
    await act(async () => old.resolve('private A'));
    expect(result.current.data).toBe('B');
    expect(readQueryCache(queryCacheKey('a', 'one', { locale: 'vi', roleLane: 'student', grants: [] }))).toBeUndefined();
  });

  test('a retained old-key setter cannot change the current view or repopulate cache', async () => {
    const { result, rerender } = await renderHook(({ keyName }: { keyName: string }) =>
      useScreenQuery(keyName, async () => keyName), { initialProps: { keyName: 'one' } });
    const oldSetter = result.current.setData;
    await rerender({ keyName: 'two' });
    clearQueryCache();
    await act(async () => oldSetter('stale mutation'));
    expect(result.current.data).toBe('two');
    expect(readQueryCache(queryCacheKey('a', 'one', { locale: 'vi', roleLane: 'student', grants: [] }))).toBeUndefined();
  });

  test.each(['locale', 'role', 'grants', 'account', 'epoch'] as const)('%s switch invalidates pending work', async (dimension) => {
    const old = deferred<string>();
    let calls = 0;
    const fetcher = jest.fn(() => ++calls === 1 ? old.promise : Promise.resolve('current'));
    const { result, rerender } = await renderHook(() => useScreenQuery('same', fetcher));
    if (dimension === 'locale') mockLocale = 'en';
    if (dimension === 'role') mockSession = { ...mockSession, role: 'lecturer' };
    if (dimension === 'grants') mockSession = { ...mockSession, capabilities: ['queue.read'] };
    if (dimension === 'account') mockSession = { ...mockSession, accountId: 'b' };
    if (dimension === 'epoch') mockEpoch++;
    await rerender(undefined);
    expect(fetcher).toHaveBeenCalledTimes(2);
    await act(async () => old.resolve('previous identity'));
    expect(result.current.data).toBe('current');
  });

  test('a late old-key 403 cannot clear new-key data or replace its error state', async () => {
    const old = deferred<string>();
    const { result, rerender } = await renderHook(({ keyName }: { keyName: string }) =>
      useScreenQuery(keyName, () => keyName === 'one' ? old.promise : Promise.resolve('current')),
    { initialProps: { keyName: 'one' } });
    await rerender({ keyName: 'two' });
    await act(async () => old.reject({ status: 403 }));
    expect(result.current.data).toBe('current');
    expect(result.current.errorStatus).toBeNull();
    expect(result.current.error).toBeNull();
  });

  test('disabling a query hides its data and rejects late writes', async () => {
    const { result, rerender } = await renderHook(({ enabled }: { enabled: boolean }) =>
      useScreenQuery('one', async () => 'private', { enabled }), { initialProps: { enabled: true } });
    const oldSetter = result.current.setData;
    await rerender({ enabled: false });
    await act(async () => oldSetter('late'));
    expect(result.current.data).toBeUndefined();
    expect(result.current.isLoading).toBe(false);
  });

  test('same-key reload deduplicates; offline revalidation retains its own cached data', async () => {
    const pending = deferred<string>();
    let calls = 0;
    const fetcher = jest.fn(() => ++calls === 1 ? Promise.resolve('cached') : pending.promise);
    const { result } = await renderHook(() => useScreenQuery('one', fetcher));
    let first!: Promise<void>;
    await act(async () => {
      first = result.current.reload();
      await result.current.reload();
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(result.current.data).toBe('cached');
    expect(result.current.isStale).toBe(true);
    await act(async () => { pending.reject({ status: 0 }); await first; });
    expect(result.current.data).toBe('cached');
    expect(result.current.warning).not.toBeNull();
    expect(result.current.error).toBeNull();
  });

  test('an old-key connectivity lookup finishing after a key change cannot alter the new result', async () => {
    const old = deferred<string>();
    const connectivity = deferred<Awaited<ReturnType<typeof getNetworkStateAsync>>>();
    jest.mocked(getNetworkStateAsync).mockImplementationOnce(() => connectivity.promise);
    const { result, rerender } = await renderHook(({ keyName }: { keyName: string }) =>
      useScreenQuery(keyName, () => keyName === 'one' ? old.promise : Promise.resolve('current')),
    { initialProps: { keyName: 'one' } });
    await act(async () => old.reject(new Error('unclassified transport failure')));
    expect(getNetworkStateAsync).toHaveBeenCalledTimes(1);
    await rerender({ keyName: 'two' });
    expect(result.current.data).toBe('current');
    await act(async () => connectivity.resolve({ isConnected: false }));
    expect(result.current.data).toBe('current');
    expect(result.current.error).toBeNull();
    expect(result.current.warning).toBeNull();
    expect(result.current.errorStatus).toBeNull();
    expect(result.current.isLoading).toBe(false);
  });

  test('an old-key finally cannot finish or unlock the current pending request', async () => {
    const old = deferred<string>();
    const next = deferred<string>();
    const fetcher = jest.fn((key: string) => key === 'one' ? old.promise : next.promise);
    const { result, rerender } = await renderHook(({ keyName }: { keyName: string }) =>
      useScreenQuery(keyName, () => fetcher(keyName)), { initialProps: { keyName: 'one' } });
    await rerender({ keyName: 'two' });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(result.current.isLoading).toBe(true);
    await act(async () => old.resolve('previous identity'));
    expect(result.current.data).toBeUndefined();
    expect(result.current.isLoading).toBe(true);
    await act(async () => result.current.reload());
    expect(fetcher).toHaveBeenCalledTimes(2);
    await act(async () => next.resolve('current'));
    expect(result.current.data).toBe('current');
    expect(result.current.isLoading).toBe(false);
  });

  test('a same-key 403 removes the displayed and cached read model', async () => {
    const pending = deferred<string>();
    let calls = 0;
    const fetcher = jest.fn(() => ++calls === 1 ? Promise.resolve('private') : pending.promise);
    const key = queryCacheKey('a', 'one', { locale: 'vi', roleLane: 'student', grants: [] });
    const { result } = await renderHook(() => useScreenQuery('one', fetcher));
    expect(result.current.data).toBe('private');
    expect(readQueryCache(key)).toBe('private');
    let refresh!: Promise<void>;
    await act(async () => { refresh = result.current.reload(); });
    expect(result.current.data).toBe('private');
    await act(async () => { pending.reject({ status: 403 }); await refresh; });
    expect(result.current.data).toBeUndefined();
    expect(readQueryCache(key)).toBeUndefined();
    expect(result.current.errorStatus).toBe(403);
    expect(result.current.error).not.toBeNull();
    expect(result.current.warning).toBeNull();
    expect(result.current.isLoading).toBe(false);
  });

  test('a successful lane query is readable live but is not retained for a later mount', async () => {
    const queryKey = 'staff.queue';
    const key = queryCacheKey('a', queryKey, { locale: 'vi', roleLane: 'student', grants: [] });
    const first = await renderHook(() => useScreenQuery(queryKey, async () => 'sensitive queue'));
    expect(first.result.current.data).toBe('sensitive queue');
    expect(readQueryCache(key)).toBeUndefined();
    await first.unmount();
    const pending = deferred<string>();
    const second = await renderHook(() => useScreenQuery(queryKey, () => pending.promise));
    expect(second.result.current.data).toBeUndefined();
    expect(second.result.current.isLoading).toBe(true);
    await act(async () => pending.resolve('fresh queue'));
    expect(second.result.current.data).toBe('fresh queue');
    expect(readQueryCache(key)).toBeUndefined();
  });
});
