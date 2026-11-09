import { afterEach, describe, expect, jest, test } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';

import { ThemeProvider } from '../../src/design/theme';
import { LocaleProvider } from '../../src/i18n/locale-provider';

const mockApi = { mode: 'live' as 'preview' | 'live' };

jest.mock('../../src/api/client', () => ({
  get apiClient() { return { mode: mockApi.mode, get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() }; },
  campusApi: {},
  createAssistantClientRequestId: () => 'request-id',
  ApiClientError: class ApiClientError extends Error {},
}));
jest.mock('../../src/hooks/useScreenQuery', () => ({
  useScreenQuery: () => ({
    data: undefined,
    error: null,
    warning: null,
    errorStatus: null,
    isLoading: false,
    isStale: false,
    reload: jest.fn(async () => {}),
    setData: jest.fn(),
  }),
}));
jest.mock('../../src/session/SessionContext', () => ({
  useSession: () => ({ kind: 'signedOut', role: 'student', capabilities: [], bootStatus: 'ready' }),
}));
jest.mock('../../src/auth/oidc-session', () => ({ signInWithOidc: jest.fn(async () => ({ kind: 'cancelled' })) }));
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
import { setPasswordResetNotice } from '../../src/screens/account/password-reset-notice';
import type { MobileScreenProps } from '../../src/navigation/types';

const navigation = { navigate: jest.fn() } as unknown as MobileScreenProps['navigation'];
const props = { navigation, role: 'student', selectedThesisTopicId: null } as MobileScreenProps;

const renderScreen = (locale: 'vi' | 'en') =>
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
});

describe('sign-in hero and card copy', () => {
  test('the live hero keeps the brand without the welcome tagline', async () => {
    await renderScreen('vi');
    expect(screen.queryByText('Chào mừng trở lại')).toBeNull();
    expect(screen.getByText('CampusUTE')).toBeOnTheScreen();
    expect(screen.getByText('Cổng học vụ CampusUTE')).toBeOnTheScreen();
  });

  test('the live card drops the browser-architecture helper paragraph', async () => {
    await renderScreen('vi');
    expect(screen.queryByText(/Tiếp tục trong trình duyệt/)).toBeNull();
    expect(screen.getByRole('header', { name: 'Đăng nhập cổng học vụ' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Đăng nhập bằng tài khoản campus' })).toBeOnTheScreen();
  });

  test('the English live hero and card drop the same tagline and helper', async () => {
    await renderScreen('en');
    expect(screen.queryByText('Welcome back')).toBeNull();
    expect(screen.queryByText(/Continue in your browser/)).toBeNull();
    expect(screen.getByText('Campus academic portal')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Sign in with your campus account' })).toBeOnTheScreen();
  });

  test('the sign-in card explains that accounts are issued by the Academic Office', async () => {
    await renderScreen('en');
    expect(screen.getByText('Your campus account is issued by the Academic Office.')).toBeOnTheScreen();
    expect(screen.getByText('There is no public self-registration form for students or lecturers.')).toBeOnTheScreen();
    expect(screen.getByText('Contact the Academic Office (Room A-105) for issuance or account recovery.')).toBeOnTheScreen();
  });

  test('a completed password reset carries the password-updated notice into sign-in', async () => {
    setPasswordResetNotice();
    await renderScreen('vi');
    expect(screen.getByText('Đã cập nhật mật khẩu')).toBeOnTheScreen();
    expect(screen.getByText('Mật khẩu của bạn đã được đặt lại. Hãy đăng nhập bằng mật khẩu mới.')).toBeOnTheScreen();
  });
});
