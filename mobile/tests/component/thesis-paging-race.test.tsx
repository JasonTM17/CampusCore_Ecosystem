// Thesis topic paging races: a next-page read belongs to one first-page
// snapshot. Switching round or refreshing must hand the paging lock to the new
// snapshot at once, and a late result from the old snapshot must never append
// rows, set the error, or clear the loading flag of the new one.

import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Pressable, Text, View } from 'react-native';

import type { PagedResult } from '../../src/api/paging';
import type { ThesisTopic } from '../../src/screens/thesis/thesis-model';

const mockApi: Record<string, jest.Mock<(...args: any[]) => Promise<any>>> = {
  topics: jest.fn<(...args: any[]) => Promise<any>>(),
};

jest.mock('../../src/api/client', () => ({ apiClient: { mode: 'live' }, campusApi: {} }));
jest.mock('../../src/screens/thesis/thesis-api', () => ({
  thesisApi: new Proxy({}, { get: (_target, key: string) => (...args: unknown[]) => mockApi[key](...args) }),
}));
jest.mock('../../src/session/SessionContext', () => ({
  useSession: () => ({ accountId: 'a', role: 'student', capabilities: [] }),
}));
jest.mock('../../src/i18n/locale-provider', () => ({ useLocale: () => ({ locale: 'vi' }) }));
jest.mock('../../src/auth/mobile-session-store', () => ({ sessionStore: { sessionEpoch: () => 1 } }));
jest.mock('expo-network', () => ({ getNetworkStateAsync: jest.fn(async () => ({ isConnected: true })) }));
jest.mock('expo-router', () => ({
  useFocusEffect: jest.fn(),
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
}));

import { clearQueryCache } from '../../src/hooks/query-cache';
import { useThesisTopics } from '../../src/screens/thesis/use-thesis';

// jest-expo does not set this; RNTL v14's async render needs an act environment.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface Gate<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

function deferred<T>(): Gate<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const topic = (id: string, roundId: string): ThesisTopic => ({
  id, roundId, departmentId: 'CNTT', title: id, description: '', maxGroups: 1, status: 'PUBLISHED',
});
const page = (ids: string[], roundId: string, hasMore = true): PagedResult<ThesisTopic> => ({
  items: ids.map((id) => topic(id, roundId)), total: 10, hasMore,
});

interface PendingRead {
  roundId: string;
  page: number;
  gate: Gate<PagedResult<ThesisTopic>>;
}

let pending: PendingRead[] = [];

function recordReads() {
  pending = [];
  mockApi.topics.mockImplementation((roundId: string, options: { page: number }) => {
    const gate = deferred<PagedResult<ThesisTopic>>();
    pending.push({ roundId, page: options.page, gate });
    return gate.promise;
  });
}

const reads = (roundId: string, pageIndex: number) => pending.filter((read) => read.roundId === roundId && read.page === pageIndex);
const gate = (roundId: string, pageIndex: number, index = 0) => reads(roundId, pageIndex)[index].gate;

function TopicsProbe({ roundId }: { roundId: string }) {
  const list = useThesisTopics(roundId);
  return (
    <View>
      <Text testID="items">{list.items.map((item) => item.id).join(',')}</Text>
      <Text testID="loading-more">{list.loadingMore ? 'loading' : 'idle'}</Text>
      <Text testID="load-more-error">{list.loadMoreError ?? 'none'}</Text>
      <Pressable testID="load-more" onPress={list.loadMore}><Text>more</Text></Pressable>
      <Pressable testID="refresh" onPress={() => { void list.reload(); }}><Text>refresh</Text></Pressable>
    </View>
  );
}

const shown = () => screen.getByTestId('items');

beforeEach(() => {
  clearQueryCache();
  recordReads();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('thesis topic paging races', () => {
  test('switching round starts the new round read at once and fences the old success', async () => {
    const view = await render(<TopicsProbe roundId="A" />);
    await act(async () => { gate('A', 0).resolve(page(['a1'], 'A')); });
    await waitFor(() => expect(shown()).toHaveTextContent('a1'));

    await fireEvent.press(screen.getByTestId('load-more'));
    expect(reads('A', 1)).toHaveLength(1);
    expect(screen.getByTestId('loading-more')).toHaveTextContent('loading');

    await view.rerender(<TopicsProbe roundId="B" />);
    await act(async () => { gate('B', 0).resolve(page(['b1'], 'B')); });
    await waitFor(() => expect(shown()).toHaveTextContent('b1'));

    await fireEvent.press(screen.getByTestId('load-more'));
    expect(reads('B', 1)).toHaveLength(1);

    await act(async () => { gate('B', 1).resolve(page(['b2'], 'B', false)); });
    await waitFor(() => expect(shown()).toHaveTextContent('b1,b2'));

    await act(async () => { gate('A', 1).resolve(page(['a2'], 'A', false)); });
    expect(shown()).toHaveTextContent('b1,b2');
    expect(shown()).not.toHaveTextContent('a2');
  });

  test('a late failure from the abandoned round cannot touch the new round', async () => {
    const view = await render(<TopicsProbe roundId="A" />);
    await act(async () => { gate('A', 0).resolve(page(['a1'], 'A')); });
    await waitFor(() => expect(shown()).toHaveTextContent('a1'));
    await fireEvent.press(screen.getByTestId('load-more'));

    await view.rerender(<TopicsProbe roundId="B" />);
    await act(async () => { gate('B', 0).resolve(page(['b1'], 'B')); });
    await waitFor(() => expect(shown()).toHaveTextContent('b1'));
    await fireEvent.press(screen.getByTestId('load-more'));
    expect(reads('B', 1)).toHaveLength(1);
    expect(screen.getByTestId('loading-more')).toHaveTextContent('loading');

    await act(async () => { gate('A', 1).reject(Object.assign(new Error('boom'), { status: 503 })); });
    expect(screen.getByTestId('loading-more')).toHaveTextContent('loading');
    expect(screen.getByTestId('load-more-error')).toHaveTextContent('none');

    await act(async () => { gate('B', 1).resolve(page(['b2'], 'B', false)); });
    await waitFor(() => expect(shown()).toHaveTextContent('b1,b2'));
    expect(screen.getByTestId('loading-more')).toHaveTextContent('idle');
    expect(screen.getByTestId('load-more-error')).toHaveTextContent('none');
  });

  test('refresh during paging drops the stale page and frees the lock', async () => {
    await render(<TopicsProbe roundId="A" />);
    await act(async () => { gate('A', 0).resolve(page(['a1'], 'A')); });
    await waitFor(() => expect(shown()).toHaveTextContent('a1'));

    await fireEvent.press(screen.getByTestId('load-more'));
    expect(reads('A', 1)).toHaveLength(1);

    await fireEvent.press(screen.getByTestId('refresh'));
    expect(reads('A', 0)).toHaveLength(2);
    await act(async () => { gate('A', 0, 1).resolve(page(['a1-refreshed'], 'A')); });
    await waitFor(() => expect(shown()).toHaveTextContent('a1-refreshed'));

    await fireEvent.press(screen.getByTestId('load-more'));
    expect(reads('A', 1)).toHaveLength(2);
    expect(screen.getByTestId('loading-more')).toHaveTextContent('loading');

    await act(async () => { gate('A', 1, 0).resolve(page(['a2-stale'], 'A', false)); });
    expect(shown()).toHaveTextContent('a1-refreshed');
    await act(async () => { gate('A', 1, 1).resolve(page(['a2-fresh'], 'A', false)); });
    await waitFor(() => expect(shown()).toHaveTextContent('a1-refreshed,a2-fresh'));
    expect(shown()).not.toHaveTextContent('a2-stale');
    expect(screen.getByTestId('loading-more')).toHaveTextContent('idle');
  });

  test('a second press while a page read is in flight starts nothing', async () => {
    await render(<TopicsProbe roundId="A" />);
    await act(async () => { gate('A', 0).resolve(page(['a1'], 'A')); });
    await waitFor(() => expect(shown()).toHaveTextContent('a1'));

    const more = screen.getByTestId('load-more');
    await fireEvent.press(more);
    await fireEvent.press(more);
    expect(reads('A', 1)).toHaveLength(1);

    await act(async () => { gate('A', 1).resolve(page(['a2'], 'A', false)); });
    await waitFor(() => expect(shown()).toHaveTextContent('a1,a2'));
    expect(screen.getByTestId('loading-more')).toHaveTextContent('idle');
  });
});
