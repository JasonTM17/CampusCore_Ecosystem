import { afterEach, describe, expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactElement } from 'react';

import { ThemeProvider } from '../../src/design/theme';
import { LocaleProvider } from '../../src/i18n/locale-provider';
import { eventsMessages } from '../../src/i18n/events-messages';
import { libraryMessages } from '../../src/i18n/library-messages';
import { uiMessages } from '../../src/i18n/locale';
import type { MobileScreenProps } from '../../src/navigation/types';

const mockPagedLists: Record<string, { loadMore: jest.Mock; hasMore: boolean; items: unknown[] }> = {};

jest.mock('../../src/api/client', () => ({
  get apiClient() {
    return { mode: 'live', get: jest.fn(async () => []), post: jest.fn(), put: jest.fn(), delete: jest.fn() };
  },
  campusApi: {},
  ApiClientError: class ApiClientError extends Error {},
}));
jest.mock('../../src/hooks/useScreenQuery', () => ({
  useScreenQuery: () => ({ data: undefined, error: null, warning: null, errorStatus: null, isLoading: false, reload: jest.fn(async () => {}), setData: jest.fn() }),
}));
jest.mock('../../src/screens/content/use-paged-list', () => ({
  usePagedList: ({ key }: { key: string }) => {
    const state = mockPagedLists[key];
    return {
      items: state?.items ?? [],
      total: 201,
      hasMore: state?.hasMore ?? false,
      loading: false,
      loadingMore: false,
      refreshing: false,
      error: null,
      warning: null,
      loadMoreError: null,
      errorStatus: null,
      loadMore: state?.loadMore ?? jest.fn(),
      refresh: jest.fn(),
      reload: jest.fn(async () => {}),
      patch: jest.fn(),
      preview: false,
    };
  },
}));
jest.mock('../../src/session/SessionContext', () => ({
  useSession: () => ({ kind: 'authenticated', role: 'student', accountId: 'student-1', capabilities: [] }),
}));
jest.mock('expo-router', () => ({ useLocalSearchParams: () => ({}) }));

import { EventsScreen } from '../../src/screens/student/EventsScreen';
import { LibraryScreen } from '../../src/screens/student/LibraryScreen';
import { NewsScreen } from '../../src/screens/student/NewsScreen';

const navigation = { navigate: jest.fn(), navigateLane: jest.fn() } as unknown as MobileScreenProps['navigation'];
const props = { navigation, role: 'student' } as MobileScreenProps;
const loadedRows = (row: Record<string, unknown>) => Array.from({ length: 200 }, (_, index) => ({ ...row, id: `${String(row.id)}-${index}` }));
const renderThemed = (element: ReactElement) => render(
  <ThemeProvider forcedScheme="light">
    <LocaleProvider initialLocale="vi">{element}</LocaleProvider>
  </ThemeProvider>,
);

afterEach(() => {
  jest.restoreAllMocks();
  for (const key of Object.keys(mockPagedLists)) delete mockPagedLists[key];
});

describe('filtered student lists with more server pages', () => {
  test('news can continue paging without a client priority filter', async () => {
    const loadMore = jest.fn();
    mockPagedLists['content.news'] = {
      loadMore,
      hasMore: true,
      items: loadedRows({ id: 'news-normal', title: 'Thông báo thường', priority: 'NORMAL' }),
    };
    await renderThemed(<NewsScreen {...props} />);

    const more = screen.getByRole('button', { name: uiMessages.vi.loadMore });
    await fireEvent.press(more);
    expect(loadMore).toHaveBeenCalledTimes(1);
  });

  test('events can continue paging when no loaded row matches the status filter', async () => {
    const loadMore = jest.fn();
    mockPagedLists['content.events'] = {
      loadMore,
      hasMore: true,
      items: loadedRows({ id: 'event-open', title: 'Sự kiện đang mở', status: 'REGISTRATION_OPEN' }),
    };
    mockPagedLists['content.events.mine'] = { loadMore: jest.fn(), hasMore: false, items: [] };
    await renderThemed(<EventsScreen {...props} />);

    await fireEvent.press(screen.getByRole('button', { name: eventsMessages.vi.statusLabels.CANCELLED }));

    const more = screen.getByRole('button', { name: uiMessages.vi.loadMore });
    await fireEvent.press(more);
    expect(loadMore).toHaveBeenCalledTimes(1);
  });

  test('library can continue paging when no loaded row is available', async () => {
    const loadMore = jest.fn();
    mockPagedLists['content.library.catalogue.'] = {
      loadMore,
      hasMore: true,
      items: loadedRows({ id: 'unavailable-book', title: 'Sách hết bản', availableCopies: 0 }),
    };
    await renderThemed(<LibraryScreen {...props} />);

    await fireEvent.press(screen.getByRole('button', { name: libraryMessages.vi.availableOnly }));

    const more = screen.getByRole('button', { name: uiMessages.vi.loadMore });
    await fireEvent.press(more);
    expect(loadMore).toHaveBeenCalledTimes(1);
  });
});
