import { afterEach, expect, jest, test } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import type { ReactElement } from 'react';

import { ThemeProvider } from '../../src/design/theme';
import { LocaleProvider } from '../../src/i18n/locale-provider';
import { campusMessages } from '../../src/i18n/campus-messages';
import type { MobileScreenProps } from '../../src/navigation/types';

const mockParams = { value: {} as { focus?: string } };
const mockItems = { value: [] as unknown[] };
const mockDetail = { idOrSlug: '' };

jest.mock('../../src/api/client', () => ({ apiClient: { mode: 'live' } }));
jest.mock('expo-router', () => ({ useLocalSearchParams: () => mockParams.value }));
jest.mock('../../src/screens/content/content-api', () => ({ contentApi: { news: jest.fn() } }));
jest.mock('../../src/screens/content/NewsDetail', () => ({
  NewsDetail: ({ idOrSlug }: { idOrSlug: string }) => { mockDetail.idOrSlug = idOrSlug; return null; },
}));
jest.mock('../../src/screens/content/use-paged-list', () => ({
  usePagedList: () => ({
    items: mockItems.value,
    total: mockItems.value.length,
    hasMore: false,
    loading: false,
    loadingMore: false,
    refreshing: false,
    error: null,
    warning: null,
    loadMoreError: null,
    errorStatus: null,
    loadMore: jest.fn(),
    refresh: jest.fn(),
    reload: jest.fn(async () => {}),
    patch: jest.fn(),
    preview: false,
  }),
}));

import { NewsScreen } from '../../src/screens/student/NewsScreen';

const props = { navigation: { navigate: jest.fn() }, role: 'student' } as unknown as MobileScreenProps;
const renderThemed = (element: ReactElement) => render(
  <ThemeProvider forcedScheme="light"><LocaleProvider initialLocale="vi">{element}</LocaleProvider></ThemeProvider>,
);

afterEach(() => {
  jest.clearAllMocks();
  mockParams.value = {};
  mockItems.value = [];
  mockDetail.idOrSlug = '';
});

test('news category IDs with a CAT prefix resolve to the localized category', async () => {
  mockItems.value = [{
    id: 'news-1',
    slug: 'news-1',
    title: 'Học vụ tuần này',
    summary: 'Thông báo học vụ',
    categoryId: 'cat-training-academic',
    priority: 'NORMAL',
    publishAt: null,
  }];
  await renderThemed(<NewsScreen {...props} />);

  expect(screen.getByText(campusMessages.vi.newsCategoryLabels.ACADEMIC_AFFAIRS)).toBeOnTheScreen();
});

test('mounted news screen opens a valid focus parameter when it changes', async () => {
  const view = await renderThemed(<NewsScreen {...props} />);
  expect(mockDetail.idOrSlug).toBe('');

  mockParams.value = { focus: 'week-12-news' };
  await view.rerender(
    <ThemeProvider forcedScheme="light"><LocaleProvider initialLocale="vi"><NewsScreen {...props} navigation={{ ...props.navigation }} /></LocaleProvider></ThemeProvider>,
  );

  expect(mockDetail.idOrSlug).toBe('week-12-news');
});
