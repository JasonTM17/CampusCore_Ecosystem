import { afterEach, describe, expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';

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
// Native auth surfaces are out of scope here — the sign-in screen never touches OIDC until pressed.
jest.mock('../../src/auth/oidc-session', () => ({
  signInWithOidc: jest.fn(async () => ({ kind: 'cancelled' })),
}));
jest.mock('../../src/auth/mobile-session-store', () => ({
  sessionStore: {
    issuer: 'http://issuer.test',
    sessionEpoch: jest.fn(() => 0),
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
import { NewsDetail } from '../../src/screens/content/NewsDetail';
import type { MobileScreenProps } from '../../src/navigation/types';
import { shellMessages } from '../../src/i18n/shell-messages';
import { signInWithOidc } from '../../src/auth/oidc-session';

const navigation = { navigate: jest.fn() } as unknown as MobileScreenProps['navigation'];
const props = { navigation, role: 'student', selectedThesisTopicId: null } as MobileScreenProps;

const renderScreen = (locale: 'vi' | 'en' = 'vi') =>
  render(
    <ThemeProvider forcedScheme="light">
      <LocaleProvider initialLocale={locale}>
        <SignInScreen {...props} />
      </LocaleProvider>
    </ThemeProvider>,
  );

const renderNewsDetail = (locale: 'vi' | 'en' = 'vi') =>
  render(
    <ThemeProvider forcedScheme="light">
      <LocaleProvider initialLocale={locale}>
        <NewsDetail idOrSlug="notice-1" onBack={() => {}} />
      </LocaleProvider>
    </ThemeProvider>,
  );

afterEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
  mockApi.mode = 'live';
  mockQuery.value = { data: undefined, error: null, warning: null, isLoading: false, errorStatus: null };
});

describe('sign-in screen', () => {
  test('is a pure authentication form without the guest news magazine or browse buttons', async () => {
    await renderScreen();

    expect(screen.queryByTestId('signin-news-section')).toBeNull();
    expect(screen.queryByText(shellMessages.vi.guest.newsTitle)).toBeNull();
    expect(screen.queryByRole('button', { name: shellMessages.vi.screens.news })).toBeNull();
    expect(screen.queryByRole('button', { name: shellMessages.vi.screens.docs })).toBeNull();
    expect(screen.getByRole('button', { name: 'Đăng nhập bằng tài khoản nhà trường để tiếp tục.' })).toBeOnTheScreen();
  });

  test.each([
    { locale: 'vi' as const, message: 'Đăng nhập chưa được cấu hình cho bản này.' },
    { locale: 'en' as const, message: 'Sign-in is not configured for this build.' },
  ])('shows the localized unavailable message for a missing issuer ($locale)', async ({ locale, message }) => {
    jest.mocked(signInWithOidc).mockResolvedValueOnce({
      kind: 'unavailable',
      code: 'issuer_not_configured',
    });
    await renderScreen(locale);
    await fireEvent.press(screen.getByRole('button', {
      name: locale === 'vi' ? 'Đăng nhập bằng tài khoản nhà trường để tiếp tục.' : 'Sign in with your campus account to continue.',
    }));

    expect(await screen.findByText(message)).toBeOnTheScreen();
    expect(screen.queryByTestId('signin-news-section')).toBeNull();
  });
});

describe('news detail byline', () => {
  const UUID = '3f2a9c1e-0000-4000-8000-000000000000';

  const detail = (overrides: Record<string, unknown> = {}) => ({
    id: 'notice-1',
    title: 'Thông báo học vụ',
    content: '<p>Nội dung thông báo.</p>',
    priority: 'NORMAL',
    publishAt: '2026-10-28T01:00:00Z',
    publishedBy: UUID,
    lecturerDisplayName: null,
    ...overrides,
  });

  test('never prints an internal publisher subject id', async () => {
    mockApi.mode = 'live';
    mockQuery.value.data = detail();
    await renderNewsDetail();
    expect(screen.getByText('Thông báo học vụ')).toBeOnTheScreen();
    expect(screen.queryByText(new RegExp(UUID))).toBeNull();
  });

  test('prints the publisher display name when the server has one', async () => {
    mockApi.mode = 'live';
    mockQuery.value.data = detail({ lecturerDisplayName: 'Phòng Đào tạo' });
    await renderNewsDetail();
    expect(screen.getByText(new RegExp('Phòng Đào tạo'))).toBeOnTheScreen();
    expect(screen.queryByText(new RegExp(UUID))).toBeNull();
  });
});
