import { afterEach, describe, expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen, within } from '@testing-library/react-native';
import type { ReactElement } from 'react';

import { ThemeProvider } from '../../src/design/theme';
import { LocaleProvider } from '../../src/i18n/locale-provider';
import { recordsMessages } from '../../src/i18n/records-messages';
import type { MobileScreenProps } from '../../src/navigation/types';

const mockPagedLists: Record<string, { items: unknown[]; hasMore?: boolean }> = {};

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
      total: state?.items.length ?? 0,
      hasMore: state?.hasMore ?? false,
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
    };
  },
}));

import { AnnouncementsScreen } from '../../src/screens/content/AnnouncementsScreen';
import { statusTone } from '../../src/screens/content/content-rules';

const navigation = { navigate: jest.fn(), navigateLane: jest.fn() } as unknown as MobileScreenProps['navigation'];
const props = { navigation, role: 'student' } as MobileScreenProps;
const copy = recordsMessages.vi;

const notice = (id: string, title: string, extra: Record<string, unknown> = {}) => ({
  id,
  title,
  content: `${title} nội dung`,
  priority: 'NORMAL',
  publishAt: '2026-10-28T08:00:00Z',
  ...extra,
});

const renderThemed = (element: ReactElement, locale: 'vi' | 'en' = 'vi') => render(
  <ThemeProvider forcedScheme="light">
    <LocaleProvider initialLocale={locale}>{element}</LocaleProvider>
  </ThemeProvider>,
);

afterEach(() => {
  jest.restoreAllMocks();
  for (const key of Object.keys(mockPagedLists)) delete mockPagedLists[key];
});

describe('announcements page parity', () => {
  test('the page carries the institutional heading, eyebrow and description', async () => {
    mockPagedLists['content.announcements'] = { items: [notice('n1', 'Thông báo chung')] };
    await renderThemed(<AnnouncementsScreen {...props} />);

    expect(screen.getByRole('header', { name: copy.announcementsTitle })).toBeOnTheScreen();
    expect(screen.getByText(copy.announcementsEyebrow)).toBeOnTheScreen();
    expect(screen.getByText(copy.announcementsDescription)).toBeOnTheScreen();
  });

  test('category chips filter by audience and by notice topic', async () => {
    mockPagedLists['content.announcements'] = {
      items: [
        notice('global', 'Thông báo toàn trường', { isGlobal: true }),
        notice('student', 'Thông báo sinh viên', { targetRoles: ['STUDENT'] }),
        notice('registration', 'Đăng ký học phần HK1'),
        notice('thesis', 'Đề tài luận văn tốt nghiệp'),
        notice('scholarship', 'Học bổng khuyến khích'),
        notice('exam', 'Lịch thi cuối kỳ'),
      ],
    };
    await renderThemed(<AnnouncementsScreen {...props} />);

    await fireEvent.press(screen.getByRole('button', { name: copy.announcementsCategories.GLOBAL }));
    expect(screen.getByText('Thông báo toàn trường')).toBeOnTheScreen();
    expect(screen.queryByText('Thông báo sinh viên')).toBeNull();

    await fireEvent.press(screen.getByRole('button', { name: copy.announcementsCategories.STUDENT_ONLY }));
    expect(screen.getByText('Thông báo sinh viên')).toBeOnTheScreen();
    expect(screen.queryByText('Thông báo toàn trường')).toBeNull();

    await fireEvent.press(screen.getByRole('button', { name: copy.announcementsCategories.REGISTRATION }));
    expect(screen.getByText('Đăng ký học phần HK1')).toBeOnTheScreen();
    expect(screen.queryByText('Lịch thi cuối kỳ')).toBeNull();

    await fireEvent.press(screen.getByRole('button', { name: copy.announcementsCategories.THESIS }));
    expect(screen.getByText('Đề tài luận văn tốt nghiệp')).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole('button', { name: copy.announcementsCategories.SCHOLARSHIP }));
    expect(screen.getByText('Học bổng khuyến khích')).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole('button', { name: copy.announcementsCategories.EXAM }));
    expect(screen.getByText('Lịch thi cuối kỳ')).toBeOnTheScreen();
  });

  test('keyword search matches title or body text', async () => {
    mockPagedLists['content.announcements'] = {
      items: [
        notice('n1', 'Thông báo chung'),
        notice('n2', 'Học bổng khuyến khích', { content: 'Hồ sơ học bổng mở đến tháng 12' }),
        notice('n3', 'Lịch thi cuối kỳ'),
      ],
    };
    await renderThemed(<AnnouncementsScreen {...props} />);

    await fireEvent.changeText(screen.getByLabelText(copy.announcementsSearch), 'học bổng');
    expect(screen.getByText('Học bổng khuyến khích')).toBeOnTheScreen();
    expect(screen.queryByText('Thông báo chung')).toBeNull();
    expect(screen.queryByText('Lịch thi cuối kỳ')).toBeNull();

    await fireEvent.changeText(screen.getByLabelText(copy.announcementsSearch), 'lịch thi');
    expect(screen.getByText('Lịch thi cuối kỳ')).toBeOnTheScreen();
    expect(screen.queryByText('Học bổng khuyến khích')).toBeNull();
  });

  test('an unmatched filter shows the web empty copy and resets every filter', async () => {
    mockPagedLists['content.announcements'] = { items: [notice('n1', 'Thông báo chung')] };
    await renderThemed(<AnnouncementsScreen {...props} />);

    await fireEvent.press(screen.getByRole('button', { name: copy.announcementsCategories.EXAM }));
    expect(screen.getByText(copy.announcementsEmpty)).toBeOnTheScreen();
    expect(screen.getByText(copy.announcementsEmptyDescription)).toBeOnTheScreen();

    await fireEvent.press(screen.getAllByRole('button', { name: copy.announcementsCategories.ALL }).at(-1)!);
    expect(screen.getByText('Thông báo chung')).toBeOnTheScreen();
  });

  test('priority chips carry the web names and the web colour roles', async () => {
    mockPagedLists['content.announcements'] = {
      items: [
        notice('urgent', 'Tin khẩn', { priority: 'URGENT' }),
        notice('high', 'Tin cao', { priority: 'HIGH' }),
        notice('normal', 'Tin thường'),
        notice('low', 'Tin thấp', { priority: 'LOW' }),
      ],
    };
    await renderThemed(<AnnouncementsScreen {...props} />);

    expect(screen.getByText(copy.priorityLabels.URGENT)).toBeOnTheScreen();
    expect(screen.getByText(copy.priorityLabels.HIGH)).toBeOnTheScreen();
    expect(screen.getByText(copy.priorityLabels.NORMAL)).toBeOnTheScreen();
    expect(screen.getByText(copy.priorityLabels.LOW)).toBeOnTheScreen();

    expect(statusTone('URGENT')).toBe('error');
    expect(statusTone('HIGH')).toBe('warning');
    expect(statusTone('NORMAL')).toBe('primary');
    expect(statusTone('LOW')).toBe('neutral');
  });

  test('the first notice is the featured card when no filter is active', async () => {
    mockPagedLists['content.announcements'] = {
      items: [
        notice('featured', 'Thông báo tiêu điểm'),
        notice('standard', 'Thông báo thường'),
      ],
    };
    await renderThemed(<AnnouncementsScreen {...props} />);

    const featured = screen.getByTestId('announcement-featured');
    expect(within(featured).getByText('Bài viết tiêu điểm')).toBeOnTheScreen();
    expect(within(featured).getByText('Thông báo tiêu điểm')).toBeOnTheScreen();
    expect(screen.getAllByText('Thông báo tiêu điểm')).toHaveLength(1);
    expect(screen.getByText('Thông báo thường')).toBeOnTheScreen();
  });

  test.each([
    { locale: 'vi' as const, magazine: 'Dạng Bản tin', dispatch: 'Dạng Công văn' },
    { locale: 'en' as const, magazine: 'Magazine Feed', dispatch: 'Official Dispatches' },
  ])('the view switcher restores the magazine layout in $locale', async ({ locale, magazine, dispatch }) => {
    mockPagedLists['content.announcements'] = {
      items: [notice('n1', 'Course registration opens'), notice('n2', 'Academic calendar updated')],
    };
    await renderThemed(<AnnouncementsScreen {...props} />, locale);

    expect(screen.getByTestId('announcement-featured')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('tab', { name: dispatch }));
    expect(screen.queryByTestId('announcement-featured')).toBeNull();

    await fireEvent.press(screen.getByRole('tab', { name: magazine }));
    expect(screen.getByTestId('announcement-featured')).toBeOnTheScreen();
  });

  test.each([
    {
      locale: 'vi' as const,
      dispatch: 'Dạng Công văn',
      code: 'Số: 659/TB-ĐHCNKT-ĐT',
      category: '🌐 Thông báo toàn trường',
      priority: 'Cao',
      date: '15:00 28/10/2026',
    },
    {
      locale: 'en' as const,
      dispatch: 'Official Dispatches',
      code: 'Ref: 659/TB-ĐHCNKT-ĐT',
      category: '🌐 Campus-wide Notice',
      priority: 'High',
      date: 'Oct 28, 2026, 03:00 PM',
    },
  ])('dispatch rows show the web fields in $locale', async ({ locale, dispatch, code, category, priority, date }) => {
    mockPagedLists['content.announcements'] = {
      items: [notice('n1', 'Course registration opens', { isGlobal: true, priority: 'HIGH' })],
    };
    await renderThemed(<AnnouncementsScreen {...props} />, locale);

    await fireEvent.press(screen.getByRole('tab', { name: dispatch }));

    expect(screen.getByText(code)).toBeOnTheScreen();
    expect(screen.getByText('Course registration opens')).toBeOnTheScreen();
    const row = screen.getByRole('button', {
      name: [code, 'Course registration opens', category, priority, date].join(' · '),
    });
    expect(within(row).getByText(category)).toBeOnTheScreen();
    expect(screen.getByText(priority)).toBeOnTheScreen();
    expect(screen.getByText(date)).toBeOnTheScreen();
    await fireEvent.press(row);
    expect(screen.getByText('Course registration opens nội dung')).toBeOnTheScreen();
  });

  test('an HTML notice body renders its headings and list items', async () => {
    mockPagedLists['content.announcements'] = {
      items: [notice('html', 'Thông báo học vụ', {
        content: '<h2>Quy định học vụ</h2><ul><li>Điều một</li><li>Điều hai</li></ul>',
      })],
    };
    await renderThemed(<AnnouncementsScreen {...props} />);

    await fireEvent.press(screen.getByRole('button', { name: `${copy.expand}: Thông báo học vụ` }));

    expect(screen.getByRole('header', { name: 'Quy định học vụ' })).toBeOnTheScreen();
    expect(screen.getByText('Điều một')).toBeOnTheScreen();
    expect(screen.getByText('Điều hai')).toBeOnTheScreen();
  });

  test('a hostile notice body keeps its safe text and drops every active payload', async () => {
    mockPagedLists['content.announcements'] = {
      items: [notice('hostile', 'Thông báo an toàn', {
        content: '<h2>Nội dung an toàn</h2><script>alert(1)</script><img src="javascript:alert(2)" alt="ảnh xấu" onerror="alert(3)" />',
      })],
    };
    await renderThemed(<AnnouncementsScreen {...props} />);

    await fireEvent.press(screen.getByRole('button', { name: `${copy.expand}: Thông báo an toàn` }));

    expect(screen.getByRole('header', { name: 'Nội dung an toàn' })).toBeOnTheScreen();
    expect(screen.queryByText(/alert\(/)).toBeNull();
    expect(screen.queryByLabelText('ảnh xấu')).toBeNull();
  });

  test('a plain text notice body is rendered unchanged', async () => {
    mockPagedLists['content.announcements'] = {
      items: [
        notice('featured', 'Thông báo tiêu điểm'),
        notice('plain', 'Thông báo thường', { content: 'Dòng một\nDòng hai' }),
      ],
    };
    await renderThemed(<AnnouncementsScreen {...props} />);

    await fireEvent.press(screen.getByRole('button', { name: `${copy.expand}: Thông báo thường` }));

    expect(screen.getByText('Dòng một\nDòng hai')).toBeOnTheScreen();
  });

  test('attachment links inside a notice are listed like the web reader', async () => {
    mockPagedLists['content.announcements'] = {
      items: [notice('attachment', 'Thông báo có tệp', {
        content: '<p>Danh sách đính kèm bên dưới.</p>[Danh sách lớp](https://files.example.test/danh-sach.pdf)',
      })],
    };
    await renderThemed(<AnnouncementsScreen {...props} />);

    await fireEvent.press(screen.getByRole('button', { name: `${copy.expand}: Thông báo có tệp` }));

    expect(screen.getByText('Tệp đính kèm chính thức')).toBeOnTheScreen();
    expect(screen.getByText('1 tệp')).toBeOnTheScreen();
    expect(screen.getByRole('link', { name: 'Danh sách lớp' })).toBeOnTheScreen();
  });
});
