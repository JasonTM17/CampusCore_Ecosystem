import { afterEach, describe, expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
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

const renderThemed = (element: ReactElement) => render(
  <ThemeProvider forcedScheme="light">
    <LocaleProvider initialLocale="vi">{element}</LocaleProvider>
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
});
