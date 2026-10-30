import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';

import type { PagedResult } from '../../src/api/paging';
import { clearQueryCache } from '../../src/hooks/query-cache';
import { EAGER_PAGE_CAP } from '../../src/screens/content/content-paging';
import { usePagedList } from '../../src/screens/content/use-paged-list';

jest.mock('../../src/session/SessionContext', () => ({ useSession: () => ({ accountId: 'a', role: 'student', capabilities: [] }) }));
jest.mock('../../src/i18n/locale-provider', () => ({ useLocale: () => ({ locale: 'vi' }) }));
jest.mock('../../src/auth/mobile-session-store', () => ({ sessionStore: { sessionEpoch: () => 1 } }));
jest.mock('../../src/api/client', () => ({ apiClient: { mode: 'live' } }));
jest.mock('expo-router', () => ({ useFocusEffect: jest.fn() }));
jest.mock('expo-network', () => ({ getNetworkStateAsync: jest.fn(async () => ({ isConnected: true })) }));

interface Row {
  id: string;
}

const keyOf = (row: Row) => row.id;
const page = (id: string, hasMore = true): PagedResult<Row> => ({ items: [{ id }], total: 42, hasMore });

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const listeners = new Set<(state: AppStateStatus) => void>();

beforeEach(() => {
  clearQueryCache();
  listeners.clear();
  AppState.currentState = 'active';
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, callback) => {
    listeners.add(callback);
    return { remove: () => { listeners.delete(callback); } };
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('paged list abandonment', () => {
  test('unmount aborts an in-flight next-page read instead of letting it finish unseen', async () => {
    const signals: AbortSignal[] = [];
    const pending = deferred<PagedResult<Row>>();
    const fetchPage = jest.fn((pageIndex: number, _limit: number, signal: AbortSignal) => {
      signals.push(signal);
      return pageIndex === 0 ? Promise.resolve(page('first')) : pending.promise;
    });
    const view = await renderHook(() => usePagedList<Row>({ key: 'content.abort.unmount', fetchPage, keyOf }));
    await act(async () => view.result.current.loadMore());
    expect(signals).toHaveLength(2);
    expect(signals[1].aborted).toBe(false);
    await view.unmount();
    expect(signals[1].aborted).toBe(true);
  });

  test('a new first-page snapshot aborts the abandoned read and frees the paging lock', async () => {
    const signals: AbortSignal[] = [];
    const fetchPage = jest.fn((pageIndex: number, _limit: number, signal: AbortSignal) => {
      signals.push(signal);
      if (pageIndex === 0) return Promise.resolve(page(`first-${signals.length}`));
      return new Promise<PagedResult<Row>>(() => {});
    });
    const view = await renderHook(() => usePagedList<Row>({ key: 'content.abort.owner', fetchPage, keyOf }));
    await act(async () => view.result.current.loadMore());
    expect(view.result.current.loadingMore).toBe(true);
    await act(async () => { await view.result.current.reload(); });
    expect(signals[1].aborted).toBe(true);
    expect(view.result.current.loadingMore).toBe(false);
    expect(view.result.current.loadMoreError).toBeNull();
    await act(async () => view.result.current.loadMore());
    expect(signals).toHaveLength(4);
    expect(signals[3].aborted).toBe(false);
    expect(fetchPage.mock.calls.filter((call) => call[0] === 1)).toHaveLength(2);
    await view.unmount();
  });

  test('a leaving subscriber keeps the shared first-page read alive for the one that stays', async () => {
    const signals: AbortSignal[] = [];
    const gate = deferred<PagedResult<Row>>();
    const fetchPage = jest.fn((_pageIndex: number, _limit: number, signal: AbortSignal) => {
      signals.push(signal);
      return gate.promise;
    });
    const first = await renderHook(() => usePagedList<Row>({ key: 'content.abort.shared', fetchPage, keyOf }));
    const second = await renderHook(() => usePagedList<Row>({ key: 'content.abort.shared', fetchPage, keyOf }));
    expect(fetchPage).toHaveBeenCalledTimes(1);
    await first.unmount();
    expect(signals[0].aborted).toBe(false);
    await act(async () => { gate.resolve(page('shared')); });
    expect(second.result.current.items.map(keyOf)).toEqual(['shared']);
    await second.unmount();
    await act(async () => {});
    expect(signals[0].aborted).toBe(true);
  });

  test('changing the list key abandons and aborts the previous key work', async () => {
    const signals: AbortSignal[] = [];
    const pending = deferred<PagedResult<Row>>();
    const fetchPage = jest.fn((pageIndex: number, _limit: number, signal: AbortSignal) => {
      signals.push(signal);
      return pageIndex === 0 ? Promise.resolve(page('first')) : pending.promise;
    });
    const view = await renderHook(
      ({ key }: { key: string }) => usePagedList<Row>({ key, fetchPage, keyOf }),
      { initialProps: { key: 'content.abort.before' } },
    );
    await act(async () => view.result.current.loadMore());
    await view.rerender({ key: 'content.abort.after' });
    await act(async () => {});
    expect(signals[1].aborted).toBe(true);
    expect(signals[0].aborted).toBe(true);
    await view.unmount();
  });

  test('eager paging stays bounded and issues no further reads after unmount', async () => {
    const signals: AbortSignal[] = [];
    const fetchPage = jest.fn((pageIndex: number, _limit: number, signal: AbortSignal) => {
      signals.push(signal);
      return Promise.resolve(page(`row-${pageIndex}`));
    });
    const view = await renderHook(() => usePagedList<Row>({ key: 'content.abort.eager', fetchPage, keyOf, eager: true, pageSize: 1 }));
    await act(async () => {});
    expect(fetchPage).toHaveBeenCalledTimes(EAGER_PAGE_CAP);
    expect(view.result.current.items).toHaveLength(EAGER_PAGE_CAP);
    expect(view.result.current.hasMore).toBe(true);
    const settled = fetchPage.mock.calls.length;
    await view.unmount();
    await act(async () => {});
    expect(fetchPage).toHaveBeenCalledTimes(settled);
  });
});
