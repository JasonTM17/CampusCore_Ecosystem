import { beforeEach, expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Pressable, Text } from 'react-native';
import { ThemeProvider } from '../../src/design/theme';
import { LocaleProvider } from '../../src/i18n/locale-provider';
import { LoggedOutScreen } from '../../src/screens/account/LoggedOutScreen';
import type { MobileScreenProps } from '../../src/navigation/types';

const mockRouter = {
  push: jest.fn(),
  replace: jest.fn(),
  dismissAll: jest.fn(),
  canGoBack: jest.fn(() => false),
  back: jest.fn(),
};
const mockSession = {
  kind: 'authenticated' as const,
  role: 'student' as const,
  capabilities: [],
  accountId: 'account-1',
  signingOut: false,
  beginSignOut: jest.fn(),
  clearSigningOut: jest.fn(),
  enterPreview: jest.fn(() => true),
  completeSignIn: jest.fn(),
  signOut: jest.fn(() => new Promise<void>(() => {})),
  switchRole: jest.fn(),
};

jest.mock('expo-router', () => ({ useRouter: () => mockRouter }));
jest.mock('../../src/session/SessionContext', () => ({
  useSession: () => mockSession,
  useOptionalSession: () => mockSession,
}));

import { useMobileNavigation } from '../../src/navigation/router-adapter';

function NavigationHarness() {
  const navigation = useMobileNavigation();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel="Sign out" onPress={navigation.signOut}>
      <Text>Sign out</Text>
    </Pressable>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSession.signingOut = false;
});

test('clears the navigation stack and selects logged-out before awaiting sign-out storage', async () => {
  await render(<NavigationHarness />);
  await fireEvent.press(screen.getByRole('button', { name: 'Sign out' }));

  expect(mockRouter.dismissAll).toHaveBeenCalledTimes(1);
  expect(mockRouter.replace).toHaveBeenCalledWith('/session/logged-out');
  expect(mockSession.beginSignOut).toHaveBeenCalledTimes(1);
  expect(mockSession.signOut).toHaveBeenCalledTimes(1);
  expect(mockSession.beginSignOut.mock.invocationCallOrder[0]).toBeLessThan(mockRouter.dismissAll.mock.invocationCallOrder[0]);
  expect(mockRouter.dismissAll.mock.invocationCallOrder[0]).toBeLessThan(mockRouter.replace.mock.invocationCallOrder[0]);
  expect(mockRouter.replace.mock.invocationCallOrder[0]).toBeLessThan(mockSession.signOut.mock.invocationCallOrder[0]);
});

test('clears the signing-out marker when the logged-out screen mounts', async () => {
  mockSession.signingOut = true;
  const props = {
    navigation: { navigate: jest.fn(), signOut: jest.fn() },
    role: 'student',
    selectedThesisTopicId: null,
  } as unknown as MobileScreenProps;
  await render(
    <ThemeProvider forcedScheme="light">
      <LocaleProvider initialLocale="vi"><LoggedOutScreen {...props} /></LocaleProvider>
    </ThemeProvider>,
  );

  expect(mockSession.clearSigningOut).toHaveBeenCalledTimes(1);
});
