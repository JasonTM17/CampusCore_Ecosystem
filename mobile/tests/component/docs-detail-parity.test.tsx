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
  previewDocs: () => [{
    slug: 'quy-che-dao-tao',
    categoryId: 'regulations',
    publishedRevision: 2,
    titleVi: 'Quy chế đào tạo tín chỉ',
    titleEn: 'Credit training regulations',
    summaryVi: 'Quy định đào tạo tín chỉ.',
    summaryEn: 'Credit training rules.',
    bodyVi: '<h2>Điều 2</h2><ol><li>Điều khoản một</li></ol><p><a href="https://example.test/doc">Liên kết</a></p><table><tbody><tr><td>Ô A</td><td>Ô B</td></tr></tbody></table>',
    bodyEn: 'Content',
    publishedAt: ago(2 * 60 * 60 * 1000),
  }],
}));

import { DocDetail } from '../../src/screens/content/DocDetail';

beforeEach(() => {
  mockMode.value = 'preview';
  mockQuery.value = { data: undefined, isLoading: false, error: null, errorStatus: null, reload: jest.fn(async () => {}) };
  jest.spyOn(Date, 'now').mockReturnValue(NOW);
});

afterEach(() => {
  jest.restoreAllMocks();
});

const renderDetail = (revision: number | null = null) => render(
  <ThemeProvider forcedScheme="light">
    <LocaleProvider initialLocale="vi">
      <DocDetail slug="quy-che-dao-tao" initialRevision={revision} onBack={() => {}} />
    </LocaleProvider>
  </ThemeProvider>,
);

test('P-013: uses the section title, back-to-list label, web meta and permalink action', async () => {
  await renderDetail();

  expect(screen.getByRole('header', { name: 'Tài liệu công khai' })).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Quay lại danh sách tài liệu' })).toBeOnTheScreen();
  expect(screen.getByText(/Xuất bản 2 giờ trước · Phiên bản 2/)).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Liên kết tới phiên bản này' })).toBeOnTheScreen();
});

test('P-012: renders the document body structure instead of plain text', async () => {
  await renderDetail();

  expect(screen.getByRole('header', { name: 'Điều 2' })).toBeOnTheScreen();
  expect(screen.getByText('Điều khoản một')).toBeOnTheScreen();
  expect(screen.getByRole('link', { name: 'Liên kết' })).toBeOnTheScreen();
  expect(screen.getByText('Ô A')).toBeOnTheScreen();
  expect(screen.getByText('Ô B')).toBeOnTheScreen();
});

test('P-013: uses the web superseded wording and open action', async () => {
  await renderDetail(1);

  expect(screen.getByText('Bạn đang xem phiên bản cũ. Phiên bản đã xuất bản hiện tại là 2.')).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Mở tài liệu' })).toBeOnTheScreen();
});

test('P-014: distinguishes a missing document from a load failure', async () => {
  mockMode.value = 'live';
  mockQuery.value = { data: undefined, isLoading: false, error: 'Không tìm thấy nội dung này.', errorStatus: 404, reload: jest.fn(async () => {}) };
  await renderDetail();

  expect(screen.getByText('Tài liệu không khả dụng')).toBeOnTheScreen();
  expect(screen.getByText('Tài liệu này chưa xuất bản hoặc không còn tồn tại.')).toBeOnTheScreen();
  expect(screen.queryByText('Không thể tải dữ liệu')).toBeNull();

  mockQuery.value = { data: undefined, isLoading: false, error: 'Máy chủ đang gặp sự cố.', errorStatus: 500, reload: jest.fn(async () => {}) };
  await renderDetail();

  expect(screen.getByText('Tài liệu chưa khả dụng')).toBeOnTheScreen();
  expect(screen.getByText('Không tải được tài liệu. Vui lòng thử lại.')).toBeOnTheScreen();
});
