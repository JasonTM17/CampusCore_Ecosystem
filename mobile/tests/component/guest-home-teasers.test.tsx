import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen, within } from '@testing-library/react-native';

import { ThemeProvider } from '../../src/design/theme';
import { LocaleProvider } from '../../src/i18n/locale-provider';
import type { MobileScreenProps } from '../../src/navigation/types';

const mockNewsState: {
  items: unknown[];
  error: string | null;
  warning: string | null;
  loading: boolean;
  reload: jest.Mock<() => Promise<void>>;
} = { items: [], error: null, warning: null, loading: false, reload: jest.fn(async () => {}) };
const mockDocsState: typeof mockNewsState = { items: [], error: null, warning: null, loading: false, reload: jest.fn(async () => {}) };

jest.mock('../../src/screens/content/content-api', () => ({
  contentApi: { news: jest.fn(), docs: jest.fn() },
}));
jest.mock('../../src/screens/content/use-paged-list', () => ({
  usePagedList: (options: { key: string }) => {
    const state = options.key.startsWith('content.docs') ? mockDocsState : mockNewsState;
    return {
      items: state.items,
      total: state.items.length,
      hasMore: false,
      loading: state.loading,
      loadingMore: false,
      refreshing: false,
      error: state.error,
      warning: state.warning,
      loadMoreError: null,
      errorStatus: state.error ? 500 : null,
      loadMore: jest.fn(),
      refresh: jest.fn(),
      reload: state.reload,
      patch: jest.fn(),
      preview: false,
    };
  },
}));

import { GuestHomeScreen } from '../../src/screens/guest/GuestHomeScreen';
import { shellMessages } from '../../src/i18n/shell-messages';

const navigation = { navigate: jest.fn() } as unknown as MobileScreenProps['navigation'];

const renderLanding = (locale: 'vi' | 'en' = 'vi') =>
  render(
    <ThemeProvider forcedScheme="light">
      <LocaleProvider initialLocale={locale}>
        <GuestHomeScreen navigation={navigation} role="student" selectedThesisTopicId={null} />
      </LocaleProvider>
    </ThemeProvider>,
  );

const newsRow = (index: number, categoryId: string) => ({
  id: `news-${index}`,
  title: categoryId === 'academic-affairs' ? `Học vụ ${index}` : `Nghiên cứu ${index}`,
  summary: `Tóm tắt ${index}`,
  categoryId,
  priority: 'NORMAL',
  publishAt: '2026-10-28T01:00:00Z',
  coverImageUrl: `https://example.test/cover-${index}.png`,
});

const document = (index: number) => ({
  slug: `quy-che-${index}`,
  categoryId: 'regulations',
  publishedRevision: 2,
  titleVi: `Quy chế đào tạo ${index}`,
  titleEn: `Credit training regulations ${index}`,
  summaryVi: `Quy định đào tạo tín chỉ ${index}.`,
  summaryEn: `Credit training rules ${index}.`,
  publishedAt: '2026-10-15T01:00:00Z',
});

beforeEach(() => {
  jest.clearAllMocks();
  mockNewsState.items = [];
  mockNewsState.error = null;
  mockNewsState.warning = null;
  mockNewsState.loading = false;
  mockNewsState.reload = jest.fn(async () => {});
  mockDocsState.items = [];
  mockDocsState.error = null;
  mockDocsState.warning = null;
  mockDocsState.loading = false;
  mockDocsState.reload = jest.fn(async () => {});
});

describe('guest landing public content teasers', () => {
  test('renders the web news and documents blocks with public data', async () => {
    mockNewsState.items = [newsRow(1, 'academic-affairs'), newsRow(2, 'research-tech')];
    mockDocsState.items = [document(1)];

    await renderLanding();

    expect(screen.getByTestId('guest-news-section')).toBeOnTheScreen();
    expect(screen.getByTestId('guest-docs-section')).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: shellMessages.vi.guest.newsTitle })).toBeOnTheScreen();
    expect(screen.getByText(shellMessages.vi.guest.newsDescription)).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: shellMessages.vi.screens.docs })).toBeOnTheScreen();
    expect(screen.getByText(shellMessages.vi.guest.docsDescription)).toBeOnTheScreen();
    expect(screen.getByText('Học vụ 1')).toBeOnTheScreen();
    expect(screen.getByText('Quy chế đào tạo 1')).toBeOnTheScreen();

    await fireEvent.press(screen.getByTestId('guest-news-see-all'));
    expect(navigation.navigate).toHaveBeenCalledWith('news');
    await fireEvent.press(screen.getByTestId('guest-docs-see-all'));
    expect(navigation.navigate).toHaveBeenCalledWith('docs');
    await fireEvent.press(screen.getByTestId('guest-news-featured'));
    expect(navigation.navigate).toHaveBeenCalledWith('news', { newsItem: 'news-1' });
  });

  test('a failed news read shows only the web unavailable copy for that block', async () => {
    mockNewsState.error = 'Không tải được bản tin.';
    mockDocsState.items = [document(1)];

    await renderLanding();

    expect(screen.getByTestId('guest-news-error')).toBeOnTheScreen();
    expect(screen.getByText('Chưa tải được bản tin')).toBeOnTheScreen();
    expect(screen.getByText('Máy chủ thông báo đang không phản hồi. Vui lòng thử lại.')).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: shellMessages.vi.guestHome.title })).toBeOnTheScreen();
    expect(screen.getByText('Quy chế đào tạo 1')).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole('button', { name: shellMessages.vi.guest.retry }));
    expect(mockNewsState.reload).toHaveBeenCalledTimes(1);
  });

  test('a failed documents read shows only the web unavailable copy for that block', async () => {
    mockNewsState.items = [newsRow(1, 'academic-affairs')];
    mockDocsState.error = 'Không tải được tài liệu.';

    await renderLanding();

    expect(screen.getByTestId('guest-docs-error')).toBeOnTheScreen();
    expect(screen.getByText('Tài liệu chưa khả dụng')).toBeOnTheScreen();
    expect(screen.getByText('Không tải được tài liệu. Vui lòng thử lại.')).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: shellMessages.vi.guestHome.title })).toBeOnTheScreen();
    expect(screen.getByText('Học vụ 1')).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole('button', { name: shellMessages.vi.guest.retry }));
    expect(mockDocsState.reload).toHaveBeenCalledTimes(1);
  });

  test('renders the web category counts and the special feature gallery with expand', async () => {
    mockNewsState.items = [
      ...Array.from({ length: 5 }, (_, index) => newsRow(index + 1, 'academic-affairs')),
      ...Array.from({ length: 6 }, (_, index) => newsRow(index + 6, 'research-tech')),
    ];

    await renderLanding();

    expect(screen.getByText(shellMessages.vi.guest.newsDescription)).toBeOnTheScreen();
    expect(within(screen.getByRole('button', { name: 'Tất cả bài viết' })).getByText('11')).toBeOnTheScreen();
    expect(within(screen.getByRole('button', { name: 'Học vụ' })).getByText('5')).toBeOnTheScreen();
    expect(screen.getByText('Phóng sự & Chuyên đề Khác')).toBeOnTheScreen();
    expect(screen.getByText('7 bài viết')).toBeOnTheScreen();
    expect(screen.getAllByTestId(/^guest-news-gallery-/)).toHaveLength(6);

    await fireEvent.press(screen.getByRole('button', { name: 'Xem thêm 1 bài viết khác' }));
    expect(screen.getAllByTestId(/^guest-news-gallery-/)).toHaveLength(7);
    expect(screen.getByRole('button', { name: 'Thu gọn bài viết' })).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole('button', { name: 'Học vụ' }));
    expect(screen.queryByText('Nghiên cứu 1')).toBeNull();
    expect(screen.queryByTestId('guest-news-expand')).toBeNull();
    expect(screen.getByText('Học vụ 1')).toBeOnTheScreen();
  });

  test('english renders the web teaser wording', async () => {
    mockNewsState.items = [
      ...Array.from({ length: 5 }, (_, index) => newsRow(index + 1, 'academic-affairs')),
      ...Array.from({ length: 6 }, (_, index) => newsRow(index + 6, 'research-tech')),
    ];
    mockDocsState.items = [document(1)];

    await renderLanding('en');

    expect(screen.getByText('CAMPUS PRESS & MAGAZINE')).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: 'HCMUTE Academic Life & Innovation' })).toBeOnTheScreen();
    expect(screen.getByText('Official academic announcements, research breakthroughs, student initiatives, and university governance updates.')).toBeOnTheScreen();
    expect(screen.getByText('Special Feature Stories')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'View 1 More Story' })).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: 'Public documents' })).toBeOnTheScreen();
    expect(screen.getByText('Published regulations, guides, and reference material.')).toBeOnTheScreen();
    expect(screen.getByTestId('guest-docs-see-all')).toBeOnTheScreen();
  });
});
