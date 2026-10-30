import { afterEach, describe, expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Dimensions } from 'react-native';
import type { ReactElement } from 'react';

import { ThemeProvider } from '../../src/design/theme';
import { LocaleProvider } from '../../src/i18n/locale-provider';

const mockApi = { mode: 'live' as 'preview' | 'live' };
const mockQuery = {
  value: {
    data: undefined as unknown,
    error: null as string | null,
    warning: null as string | null,
    isLoading: false,
    errorStatus: null as number | null,
  },
};
const mockReload = jest.fn(async () => {});

jest.mock('../../src/api/client', () => ({
  get apiClient() { return { mode: mockApi.mode, get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() }; },
  campusApi: {},
  createAssistantClientRequestId: () => 'request-id',
  ApiClientError: class ApiClientError extends Error {},
}));
jest.mock('../../src/hooks/useScreenQuery', () => ({
  useScreenQuery: () => ({ ...mockQuery.value, reload: mockReload, setData: jest.fn() }),
}));
jest.mock('../../src/session/SessionContext', () => ({
  useSession: () => ({ kind: 'signedOut', role: 'student', capabilities: [] }),
}));
// Native auth surfaces are out of scope here — the feed never touches OIDC.
jest.mock('../../src/auth/oidc-session', () => ({
  signInWithOidc: jest.fn(async () => ({ kind: 'cancelled' })),
}));
jest.mock('../../src/auth/mobile-session-store', () => ({
  sessionStore: {
    issuer: 'http://issuer.test',
    saveRefresh: jest.fn(async () => {}),
    setAccessToken: jest.fn(),
    bumpEpoch: jest.fn(),
  },
}));
jest.mock('expo-router', () => ({ useLocalSearchParams: () => ({}) }));
jest.mock('../../src/api/parity-api', () => ({
  parityApi: new Proxy({}, { get: () => jest.fn(async () => ({ items: [], hasMore: false })) }),
}));

import { SignInScreen } from '../../src/screens/auth/SignInScreen';
import type { MobileScreenProps } from '../../src/navigation/types';
import { shellMessages } from '../../src/i18n/shell-messages';

const navigation = { navigate: jest.fn() } as unknown as MobileScreenProps['navigation'];
const props = { navigation, role: 'student', selectedThesisTopicId: null } as MobileScreenProps;

const ITEMS = [
  {
    id: 'a',
    title: 'Lịch thi cuối kỳ đã công bố',
    summary: 'Phòng Đào tạo thông báo lịch thi.',
    slug: 'lich-thi-cuoi-ky',
    publishAt: '2026-10-28T01:00:00Z',
    categoryId: 'academic-affairs',
    priority: 'NORMAL',
    coverImageUrl: 'https://example.test/cover.png',
  },
  { id: 'b', title: 'Thông báo khẩn của trường', priority: 'URGENT', publishAt: '2026-10-27T01:00:00Z' },
  { id: 'c', title: 'Tin học vụ thường', priority: 'HIGH' },
];

function paged(items: unknown[]) {
  return { items, hasMore: false, total: items.length };
}

const renderScreen = (locale: 'vi' | 'en' = 'vi') =>
  render(
    <ThemeProvider forcedScheme="light">
      <LocaleProvider initialLocale={locale}>
        <SignInScreen {...props} />
      </LocaleProvider>
    </ThemeProvider>,
  );

afterEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
  mockApi.mode = 'live';
  mockQuery.value = { data: undefined, error: null, warning: null, isLoading: false, errorStatus: null };
});

describe('sign-in guest news feed', () => {
  test('renders the magazine section: featured card, compact rows, urgent pill only', async () => {
    mockQuery.value.data = paged(ITEMS);
    await renderScreen();
    expect(screen.getByTestId('signin-news-section')).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: shellMessages.vi.guest.newsTitle })).toBeOnTheScreen();
    expect(screen.getByText('Lịch thi cuối kỳ đã công bố')).toBeOnTheScreen();
    expect(screen.getByText('Thông báo khẩn của trường')).toBeOnTheScreen();
    // Category pill via the label helper, cover image, "Đọc bài" cue.
    expect(screen.getByText('Học vụ')).toBeOnTheScreen();
    expect(screen.getByTestId('signin-news-cover')).toBeOnTheScreen();
    expect(screen.getByText(shellMessages.vi.guest.readArticle)).toBeOnTheScreen();
    // Only the URGENT row carries the "Khẩn" pill.
    expect(screen.getAllByText('Khẩn').length).toBe(1);
    // The OIDC entry point is never blocked by the feed.
    expect(screen.getByRole('button', { name: 'Đăng nhập bằng CampusUTE ID' })).toBeOnTheScreen();
  });

  test('a card opens the guest news detail route and see-all opens the feed', async () => {
    mockQuery.value.data = paged(ITEMS);
    await renderScreen();
    await fireEvent.press(screen.getByTestId('signin-news-featured'));
    expect(navigation.navigate).toHaveBeenCalledWith('news', { newsItem: 'lich-thi-cuoi-ky' });
    await fireEvent.press(screen.getByTestId('signin-news-row-0'));
    expect(navigation.navigate).toHaveBeenCalledWith('news', { newsItem: 'b' });
    await fireEvent.press(screen.getByTestId('signin-news-see-all'));
    expect(navigation.navigate).toHaveBeenCalledWith('news');
  });

  test('a missing cover falls back to the neutral placeholder', async () => {
    mockQuery.value.data = paged([{ id: 'x', title: 'Không ảnh bìa', priority: 'NORMAL' }]);
    await renderScreen();
    expect(screen.getByTestId('signin-news-cover-placeholder')).toBeOnTheScreen();
    expect(screen.queryByTestId('signin-news-cover')).toBeNull();
  });

  test('loading shows skeleton blocks while sign-in stays interactive', async () => {
    mockQuery.value = { data: undefined, error: null, warning: null, isLoading: true, errorStatus: null };
    await renderScreen();
    expect(screen.getByTestId('signin-news-loading')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Đăng nhập bằng CampusUTE ID' })).toBeOnTheScreen();
  });

  test('empty feed shows the quiet empty state', async () => {
    mockQuery.value.data = paged([]);
    await renderScreen();
    expect(screen.getByTestId('signin-news-empty')).toBeOnTheScreen();
    expect(screen.getByText('Chưa có bài viết')).toBeOnTheScreen();
  });

  test('error shows a retry that reloads without touching sign-in', async () => {
    mockQuery.value = { data: undefined, error: 'Không thể tải dữ liệu', warning: null, isLoading: false, errorStatus: 500 };
    await renderScreen();
    expect(screen.getByTestId('signin-news-error')).toBeOnTheScreen();
    expect(screen.getByText('Không thể tải dữ liệu')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: shellMessages.vi.guest.retry }));
    expect(mockReload).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Đăng nhập bằng CampusUTE ID' })).toBeOnTheScreen();
  });

  test('error container announces the error, never the stale loading label (ux-m1-01)', async () => {
    mockQuery.value = { data: undefined, error: 'Không thể tải dữ liệu', warning: null, isLoading: false, errorStatus: 500 };
    await renderScreen();
    const errorBox = screen.getByTestId('signin-news-error');
    expect(errorBox.props.accessible).toBe(true);
    expect(errorBox.props.accessibilityRole).toBe('alert');
    expect(errorBox.props.accessibilityLabel).toBe('Không thể tải dữ liệu');
    expect(errorBox.props.accessibilityLabel).not.toBe(shellMessages.vi.guest.loading);
  });

  test('a failed revalidate keeps data visible with a stale banner', async () => {
    mockQuery.value = { data: paged(ITEMS.slice(0, 1)), error: null, warning: 'Không có kết nối mạng.', isLoading: false, errorStatus: 0 };
    await renderScreen();
    expect(screen.getByTestId('signin-news-warning')).toBeOnTheScreen();
    expect(screen.getByText('Lịch thi cuối kỳ đã công bố')).toBeOnTheScreen();
  });

  test('english locale renders the web magazine labels', async () => {
    mockQuery.value.data = paged([]);
    await renderScreen('en');
    expect(screen.getByText('CAMPUS PRESS & MAGAZINE')).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: 'HCMUTE Academic Life & Innovation' })).toBeOnTheScreen();
    expect(screen.getByText('No articles yet')).toBeOnTheScreen();
  });
});
