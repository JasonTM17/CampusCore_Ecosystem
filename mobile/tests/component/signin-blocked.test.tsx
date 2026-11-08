import { afterEach, describe, expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Linking } from 'react-native';
import type { ReactElement } from 'react';

import { ThemeProvider } from '../../src/design/theme';
import { LocaleProvider } from '../../src/i18n/locale-provider';

const mockApi = { mode: 'live' as 'preview' | 'live' };
const mockSignIn = jest.fn<() => Promise<unknown>>();
const mockSession = {
  kind: 'signedOut',
  role: 'student',
  capabilities: [],
  bootStatus: 'ready',
  markBlocked: jest.fn(),
};

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
  useSession: () => mockSession,
}));
jest.mock('../../src/auth/oidc-session', () => ({ signInWithOidc: () => mockSignIn() }));
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

import { accountMessages } from '../../src/i18n/account-messages';
import { SignInScreen } from '../../src/screens/auth/SignInScreen';
import type { MobileScreenProps } from '../../src/navigation/types';

const navigation = { navigate: jest.fn() } as unknown as MobileScreenProps['navigation'];
const props = { navigation, role: 'student', selectedThesisTopicId: null } as MobileScreenProps;

const renderScreen = (locale: 'vi' | 'en' = 'en') =>
  render(
    <ThemeProvider forcedScheme="light">
      <LocaleProvider initialLocale={locale}>
        <SignInScreen {...props} />
      </LocaleProvider>
    </ThemeProvider>,
  );

const configured = process.env.EXPO_PUBLIC_PORTAL_URL;

afterEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
  mockApi.mode = 'live';
  mockSession.kind = 'signedOut';
  mockSession.role = 'student';
  mockSession.capabilities = [];
  mockSession.bootStatus = 'ready';
  if (configured === undefined) delete process.env.EXPO_PUBLIC_PORTAL_URL;
  else process.env.EXPO_PUBLIC_PORTAL_URL = configured;
});

describe('sign-in blocked outcome', () => {
  test('an account with no mobile surface gets its own copy and the portal hand-off', async () => {
    process.env.EXPO_PUBLIC_PORTAL_URL = 'https://portal.example.edu';
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    mockSignIn.mockResolvedValueOnce({
      kind: 'blocked',
      code: 'no_mobile_surface',
      reason: 'private provider text',
    });
    expect(accountMessages.en.signIn.noMobileSurface).toBeTruthy();

    await renderScreen('en');
    await fireEvent.press(screen.getByRole('button', { name: 'Sign in with CampusUTE ID' }));

    expect(await screen.findByText(accountMessages.en.signIn.noMobileSurface)).toBeOnTheScreen();
    expect(screen.queryByText(accountMessages.en.signIn.invalid)).toBeNull();
    expect(screen.queryByText('private provider text')).toBeNull();

    await fireEvent.press(screen.getByRole('button', { name: accountMessages.en.blocked.openPortal }));
    expect(openURL).toHaveBeenCalledWith('https://portal.example.edu');
  });

  test.each([
    { locale: 'vi' as const, reason: 'Bạn cần đổi mật khẩu trên cổng thông tin trước khi đăng nhập.' },
    { locale: 'en' as const, reason: 'Change your password in the web portal before signing in.' },
  ])('a password-change gate routes with safe localized copy ($locale)', async ({ locale, reason }) => {
    process.env.EXPO_PUBLIC_PORTAL_URL = 'https://portal.example.edu';
    mockSignIn.mockResolvedValueOnce({
      kind: 'blocked',
      code: 'password_change_required',
      reason: 'private provider text',
    });

    await renderScreen(locale);
    await fireEvent.press(screen.getByRole('button', {
      name: locale === 'vi' ? 'Đăng nhập bằng CampusUTE ID' : 'Sign in with CampusUTE ID',
    }));

    expect(mockSession.markBlocked).toHaveBeenCalledWith(reason);
    expect(screen.queryByText('private provider text')).toBeNull();
    expect(screen.queryByText(accountMessages[locale].signIn.invalid)).toBeNull();
  });
});
