import { afterEach, beforeEach, expect, jest, test } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';

import { ThemeProvider } from '../../src/design/theme';
import { LocaleProvider } from '../../src/i18n/locale-provider';

const NOW = Date.parse('2026-11-09T12:00:00Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();

jest.mock('../../src/api/client', () => ({ apiClient: { mode: 'preview' } }));
jest.mock('../../src/screens/content/content-api', () => ({ contentApi: {} }));
jest.mock('../../src/screens/content/use-content-query', () => ({
  useContentQuery: () => ({ data: undefined, isLoading: false, error: null, errorStatus: null, reload: async () => {} }),
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
