import { afterEach, describe, expect, jest, test } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';

import { ThemeProvider } from '../../src/design/theme';
import { LocaleProvider } from '../../src/i18n/locale-provider';
import { accountMessages } from '../../src/i18n/account-messages';

const mockSession = {
  blockedReason: null as string | null,
  markBlocked: jest.fn(),
};

jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: jest.fn() }),
}));
jest.mock('../../src/session/SessionContext', () => ({
  useSession: () => mockSession,
}));

import SignInBlocked from '../../app/sign-in-blocked';

const renderScreen = (locale: 'vi' | 'en') =>
  render(
    <ThemeProvider forcedScheme="light">
      <LocaleProvider initialLocale={locale}>
        <SignInBlocked />
      </LocaleProvider>
    </ThemeProvider>,
  );

afterEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
  mockSession.blockedReason = null;
});

describe('sign-in blocked route copy', () => {
  test('renders the Vietnamese dictionary copy', async () => {
    const copy = accountMessages.vi;
    await renderScreen('vi');
    expect(screen.getByText(copy.blocked.title)).toBeOnTheScreen();
    expect(screen.getByText(copy.blocked.fallbackReason)).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: copy.blocked.openPortal })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: copy.common.backToSignIn })).toBeOnTheScreen();
  });

  test('renders the English dictionary copy', async () => {
    const copy = accountMessages.en;
    await renderScreen('en');
    expect(screen.getByText(copy.blocked.title)).toBeOnTheScreen();
    expect(screen.getByText(copy.blocked.fallbackReason)).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: copy.blocked.openPortal })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: copy.common.backToSignIn })).toBeOnTheScreen();
  });

  test('a release build without a configured portal hides the web hand-off', async () => {
    const configured = process.env.EXPO_PUBLIC_PORTAL_URL;
    const runtime = globalThis as typeof globalThis & { __DEV__?: boolean };
    const previousDev = runtime.__DEV__;
    delete process.env.EXPO_PUBLIC_PORTAL_URL;
    runtime.__DEV__ = false;
    try {
      await renderScreen('vi');
      expect(screen.queryByRole('button', { name: accountMessages.vi.blocked.openPortal })).toBeNull();
      expect(screen.getByRole('button', { name: accountMessages.vi.common.backToSignIn })).toBeOnTheScreen();
    } finally {
      if (previousDev === undefined) delete runtime.__DEV__;
      else runtime.__DEV__ = previousDev;
      if (configured === undefined) delete process.env.EXPO_PUBLIC_PORTAL_URL;
      else process.env.EXPO_PUBLIC_PORTAL_URL = configured;
    }
  });
});
