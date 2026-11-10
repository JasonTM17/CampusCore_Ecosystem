import { afterEach, beforeEach, expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactElement } from 'react';

import { ThemeProvider } from '../../src/design/theme';
import { LocaleProvider } from '../../src/i18n/locale-provider';
import type { MobileScreenProps } from '../../src/navigation/types';

const mockState: { items: unknown[]; error: string | null; key: string } = { items: [], error: null, key: '' };

jest.mock('../../src/api/client', () => ({ apiClient: { mode: 'live' } }));
jest.mock('expo-router', () => ({ useLocalSearchParams: () => ({}), useRouter: () => ({ replace: jest.fn(), push: jest.fn() }) }));
jest.mock('../../src/screens/content/content-api', () => ({ contentApi: { docs: jest.fn() } }));
jest.mock('../../src/screens/content/DocDetail', () => ({ DocDetail: () => null }));
jest.mock('../../src/screens/content/use-paged-list', () => ({
  usePagedList: (options: { key: string }) => {
    mockState.key = options.key;
    return {
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
    };
  },
}));

import { DocsScreen } from '../../src/screens/student/DocsScreen';

const props = { navigation: { navigate: jest.fn() }, role: 'student' } as unknown as MobileScreenProps;
const renderThemed = (element: ReactElement, locale: 'vi' | 'en' = 'vi') => render(
  <ThemeProvider forcedScheme="light"><LocaleProvider initialLocale={locale}>{element}</LocaleProvider></ThemeProvider>,
);

const NOW = Date.parse('2026-11-09T12:00:00Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();

beforeEach(() => {
  mockState.items = [];
  mockState.error = null;
  mockState.key = '';
  jest.spyOn(Date, 'now').mockReturnValue(NOW);
});

afterEach(() => {
  jest.restoreAllMocks();
});

function document(overrides: Record<string, unknown> = {}) {
  return {
    slug: 'quy-che-dao-tao',
    categoryId: 'regulations',
    publishedRevision: 2,
    titleVi: 'Quy chế đào tạo tín chỉ',
    titleEn: 'Credit training regulations',
    summaryVi: 'Quy định đào tạo tín chỉ.',
    summaryEn: 'Credit training rules.',
    bodyVi: 'Nội dung',
    bodyEn: 'Content',
    publishedAt: ago(2 * 60 * 60 * 1000),
    ...overrides,
  };
}

test('P-009: uses the bilingual search placeholder and shows a search action', async () => {
  await renderThemed(<DocsScreen {...props} />);

  expect(screen.getByPlaceholderText('Tìm tài liệu (tiếng Việt hoặc tiếng Anh)…')).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Tìm kiếm' })).toBeOnTheScreen();
});

test('P-010: uses relative time, drops the web-absent category and shows the open label', async () => {
  mockState.items = [document()];
  await renderThemed(<DocsScreen {...props} />);

  expect(screen.getByText('2 giờ trước')).toBeOnTheScreen();
  expect(screen.queryByText('Quy chế')).toBeNull();
  expect(screen.getByText('Mở tài liệu')).toBeOnTheScreen();
});

test('P-011: uses the public-documents title and empty copy', async () => {
  await renderThemed(<DocsScreen {...props} />);

  expect(screen.getByRole('header', { name: 'Tài liệu công khai' })).toBeOnTheScreen();
  expect(screen.getByText('Không có tài liệu nào phù hợp.')).toBeOnTheScreen();
});

test('shows the web documents subtitle in Vietnamese', async () => {
  await renderThemed(<DocsScreen {...props} />);
  expect(screen.getByText('Quy định, hướng dẫn và tài liệu tham khảo đã xuất bản.')).toBeOnTheScreen();
});

test('shows the web documents subtitle in English', async () => {
  await renderThemed(<DocsScreen {...props} />, 'en');
  expect(screen.getByText('Published regulations, guides, and reference material.')).toBeOnTheScreen();
});

test('shows the search button submitting the typed query', async () => {
  const view = await renderThemed(<DocsScreen {...props} />);
  await fireEvent.changeText(screen.getByPlaceholderText('Tìm tài liệu (tiếng Việt hoặc tiếng Anh)…'), 'quy chế');
  await fireEvent.press(screen.getByRole('button', { name: 'Tìm kiếm' }));
  await view.rerender(
    <ThemeProvider forcedScheme="light"><LocaleProvider initialLocale="vi"><DocsScreen {...props} /></LocaleProvider></ThemeProvider>,
  );

  expect(mockState.key).toContain('quy chế');
});

test('shows the docs-specific error title and retry sentence', async () => {
  mockState.error = 'Không thể tải dữ liệu';
  await renderThemed(<DocsScreen {...props} />);

  expect(screen.getByText('Tài liệu chưa khả dụng')).toBeOnTheScreen();
  expect(screen.getByText('Không tải được tài liệu. Vui lòng thử lại.')).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Thử lại' })).toBeOnTheScreen();
});
