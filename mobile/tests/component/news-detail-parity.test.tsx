import { afterEach, beforeEach, expect, jest, test } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';

import { ThemeProvider } from '../../src/design/theme';
import { LocaleProvider } from '../../src/i18n/locale-provider';

const NOW = Date.parse('2026-11-09T12:00:00Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();

const mockMode: { value: 'preview' | 'live' } = { value: 'preview' };
const mockQuery: { value: Record<string, unknown> } = { value: {} };

jest.mock('../../src/api/client', () => ({
  get apiClient() { return { mode: mockMode.value }; },
}));
jest.mock('../../src/screens/content/content-api', () => ({ contentApi: {} }));
jest.mock('../../src/screens/content/use-content-query', () => ({
  useContentQuery: () => mockQuery.value,
}));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('../../src/screens/content/preview-data', () => ({
  previewNews: () => [{
    id: 'news-1',
    slug: 'news-1',
    title: 'Tin khẩn',
    summary: 'Tóm tắt',
    content: '<h2>Điều 1</h2><p>Nội dung <strong>quan trọng</strong>.</p><ul><li>Mục một</li></ul><p><a href="https://example.test/story">Liên kết</a></p><table><tbody><tr><td>Ô A</td><td>Ô B</td></tr></tbody></table>',
    priority: 'URGENT',
    publishAt: ago(2 * 60 * 60 * 1000),
    lecturerDisplayName: 'Phòng Đào tạo',
    semesterName: 'HK1',
  }],
}));

import { NewsDetail } from '../../src/screens/content/NewsDetail';

beforeEach(() => {
  mockMode.value = 'preview';
  mockQuery.value = { data: undefined, isLoading: false, error: null, errorStatus: null, reload: jest.fn(async () => {}) };
  jest.spyOn(Date, 'now').mockReturnValue(NOW);
});

afterEach(() => {
  jest.restoreAllMocks();
});

const renderDetail = () => render(
  <ThemeProvider forcedScheme="light">
    <LocaleProvider initialLocale="vi">
      <NewsDetail idOrSlug="news-1" onBack={() => {}} />
    </LocaleProvider>
  </ThemeProvider>,
);

test('P-008: uses the section title, back-to-list label and published sentence', async () => {
  await renderDetail();

  expect(screen.getByRole('header', { name: 'Tin tức trường' })).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Quay lại danh sách tin' })).toBeOnTheScreen();
  expect(screen.getByText(/Xuất bản 2 giờ trước/)).toBeOnTheScreen();
  expect(screen.getByText(/Phòng Đào tạo/)).toBeOnTheScreen();
});

test('P-007: renders headings, bold text, lists, links and table cells from the body', async () => {
  await renderDetail();

  expect(screen.getByRole('header', { name: 'Điều 1' })).toBeOnTheScreen();
  expect(screen.getByText(/quan trọng/)).toBeOnTheScreen();
  expect(screen.getByText('Mục một')).toBeOnTheScreen();
  expect(screen.getByRole('link', { name: 'Liên kết' })).toBeOnTheScreen();
  expect(screen.getByText('Ô A')).toBeOnTheScreen();
  expect(screen.getByText('Ô B')).toBeOnTheScreen();
});

test('distinguishes a missing story from a load failure', async () => {
  mockMode.value = 'live';
  mockQuery.value = { data: undefined, isLoading: false, error: 'Không tìm thấy nội dung này.', errorStatus: 404, reload: jest.fn(async () => {}) };
  await renderDetail();

  expect(screen.getByText('Bài viết không khả dụng')).toBeOnTheScreen();
  expect(screen.getByText('Bài viết này chưa xuất bản hoặc không còn tồn tại.')).toBeOnTheScreen();
  expect(screen.queryByText('Không thể tải dữ liệu')).toBeNull();

  mockQuery.value = { data: undefined, isLoading: false, error: 'Máy chủ đang gặp sự cố.', errorStatus: 500, reload: jest.fn(async () => {}) };
  await renderDetail();

  expect(screen.getByText('Bảng tin chưa khả dụng')).toBeOnTheScreen();
  expect(screen.getByText('Không tải được bảng tin. Vui lòng thử lại.')).toBeOnTheScreen();
});
