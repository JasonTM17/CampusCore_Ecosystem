import { afterEach, beforeEach, expect, jest, test } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import type { ReactElement } from 'react';

import { ThemeProvider } from '../../src/design/theme';
import { LocaleProvider } from '../../src/i18n/locale-provider';
import type { MobileScreenProps } from '../../src/navigation/types';

const mockState: { items: unknown[]; error: string | null } = { items: [], error: null };

jest.mock('../../src/api/client', () => ({ apiClient: { mode: 'live' } }));
jest.mock('expo-router', () => ({ useLocalSearchParams: () => ({}) }));
jest.mock('../../src/screens/content/content-api', () => ({ contentApi: { news: jest.fn() } }));
jest.mock('../../src/screens/content/NewsDetail', () => ({ NewsDetail: () => null }));
jest.mock('../../src/screens/content/use-paged-list', () => ({
  usePagedList: () => ({
    items: mockState.items,
    total: mockState.items.length,
    hasMore: false,
    loading: false,
    loadingMore: false,
    refreshing: false,
    error: mockState.error,
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

const NOW = Date.parse('2026-11-09T12:00:00Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();

beforeEach(() => {
  mockState.items = [];
  mockState.error = null;
  jest.spyOn(Date, 'now').mockReturnValue(NOW);
});

afterEach(() => {
  jest.restoreAllMocks();
});

function announcement(overrides: Record<string, unknown> = {}) {
  return {
    id: 'news-1',
    slug: 'news-1',
    title: 'Thông báo học vụ',
    summary: 'Tóm tắt thông báo.',
    content: '<p>Nội dung</p>',
    priority: 'NORMAL',
    publishAt: ago(2 * 60 * 60 * 1000),
    lecturerDisplayName: 'Phòng Đào tạo',
    ...overrides,
  };
}

test('P-001: renders the priority chip and the category pill together', async () => {
  mockState.items = [announcement({ priority: 'URGENT', categoryId: 'cat-academic-affairs' })];
  await renderThemed(<NewsScreen {...props} />);

  expect(screen.getAllByText('Khẩn').length).toBeGreaterThan(1);
  expect(screen.getByText('Học vụ')).toBeOnTheScreen();
});

test('P-002: uses the web title, subtitle, empty and priority copy', async () => {
  mockState.items = [announcement({ priority: 'NORMAL' })];
  await renderThemed(<NewsScreen {...props} />);

  expect(screen.getByRole('header', { name: 'Tin tức trường' })).toBeOnTheScreen();
  expect(screen.getByText('Thông báo đã xuất bản của nhà trường.')).toBeOnTheScreen();
  expect(screen.getAllByText('Bình thường').length).toBeGreaterThan(1);

  mockState.items = [];
  await renderThemed(<NewsScreen {...props} />);
  expect(screen.getByText('Chưa có bài viết nào được xuất bản.')).toBeOnTheScreen();
});

test('P-003: shows relative time and falls back to createdAt', async () => {
  mockState.items = [
    announcement({ id: 'news-1', title: 'Bài mới', publishAt: ago(2 * 60 * 60 * 1000) }),
    announcement({ id: 'news-2', title: 'Bài cũ', publishAt: null, createdAt: ago(25 * 60 * 60 * 1000) }),
  ];
  await renderThemed(<NewsScreen {...props} />);

  expect(screen.getByText('2 giờ trước')).toBeOnTheScreen();
  expect(screen.getByText('Hôm qua')).toBeOnTheScreen();
});

test('P-004: prints the publisher byline on the card', async () => {
  mockState.items = [announcement({ lecturerDisplayName: 'Phòng Đào tạo' })];
  await renderThemed(<NewsScreen {...props} />);

  expect(screen.getByText('Phòng Đào tạo')).toBeOnTheScreen();
});

test('P-005: shows the news-specific error title and retry sentence', async () => {
  mockState.error = 'Không thể tải dữ liệu';
  await renderThemed(<NewsScreen {...props} />);

  expect(screen.getByText('Bảng tin chưa khả dụng')).toBeOnTheScreen();
  expect(screen.getByText('Không tải được bảng tin. Vui lòng thử lại.')).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Thử lại' })).toBeOnTheScreen();
});

test('P-006: shows the read-the-story call to action', async () => {
  mockState.items = [announcement()];
  await renderThemed(<NewsScreen {...props} />);

  expect(screen.getByText('Đọc bài viết')).toBeOnTheScreen();
});
