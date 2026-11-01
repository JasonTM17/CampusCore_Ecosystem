import { afterEach, describe, expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Linking } from 'react-native';

import { ThemeProvider } from '../../src/design/theme';
import { LocaleProvider } from '../../src/i18n/locale-provider';

const mockSession = {
  blockedReason: null as string | null,
  markBlocked: jest.fn(),
};

jest.mock('../../src/session/SessionContext', () => ({
  useSession: () => mockSession,
}));

import { accountMessages } from '../../src/i18n/account-messages';
import { DEFAULT_PORTAL_URL } from '../../src/screens/operations/shared/portal-url';
import { BlockedScreen } from '../../src/screens/account/BlockedScreen';
import type { MobileScreenProps } from '../../src/navigation/types';

const navigation = { navigate: jest.fn() } as unknown as MobileScreenProps['navigation'];
const props = { navigation, role: 'student', selectedThesisTopicId: null } as MobileScreenProps;

const renderScreen = (locale: 'vi' | 'en' = 'vi') =>
  render(
    <ThemeProvider forcedScheme="light">
      <LocaleProvider initialLocale={locale}>
        <BlockedScreen {...props} />
      </LocaleProvider>
    </ThemeProvider>,
  );

afterEach(() => {
  jest.clearAllMocks();
  mockSession.blockedReason = null;
});

describe('blocked sign-in screen', () => {
  test.each(['vi', 'en'] as const)('renders the dictionary copy for $locale', async (locale) => {
    const copy = accountMessages[locale].blocked;
    await renderScreen(locale);

    expect(screen.getByRole('header', { name: copy.title })).toBeOnTheScreen();
    expect(screen.getByText(copy.subtitle)).toBeOnTheScreen();
    expect(screen.getByText(copy.status)).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: copy.openPortal })).toBeOnTheScreen();
    expect(screen.getByText(copy.fallbackReason)).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: accountMessages[locale].common.backToSignIn })).toBeOnTheScreen();
  });

  test('a session blocked reason replaces the localized fallback', async () => {
    mockSession.blockedReason = 'Phiên của bạn đã bị quản trị viên tạm khóa.';
    await renderScreen('vi');

    expect(screen.getByText(mockSession.blockedReason)).toBeOnTheScreen();
    expect(screen.queryByText(accountMessages.vi.blocked.fallbackReason)).toBeNull();
  });

  test('back to sign-in clears the block and opens the sign-in route', async () => {
    await renderScreen('en');

    await fireEvent.press(screen.getByRole('button', { name: accountMessages.en.common.backToSignIn }));

    expect(mockSession.markBlocked).toHaveBeenCalledWith(null);
    expect(navigation.navigate).toHaveBeenCalledWith('auth.signIn');
  });

  test('the portal hand-off uses the shared mode-aware default', async () => {
    const configured = process.env.EXPO_PUBLIC_PORTAL_URL;
    delete process.env.EXPO_PUBLIC_PORTAL_URL;
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    try {
      await renderScreen('en');
      await fireEvent.press(screen.getByRole('button', { name: accountMessages.en.blocked.openPortal }));
      expect(openURL).toHaveBeenCalledWith(DEFAULT_PORTAL_URL);
    } finally {
      openURL.mockRestore();
      if (configured === undefined) delete process.env.EXPO_PUBLIC_PORTAL_URL;
      else process.env.EXPO_PUBLIC_PORTAL_URL = configured;
    }
  });
});
