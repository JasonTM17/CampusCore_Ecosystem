import { afterEach, beforeEach, expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';

import { ThemeProvider } from '../../src/design/theme';
import { LocaleProvider } from '../../src/i18n/locale-provider';
import { shellMessages } from '../../src/i18n/shell-messages';
import { MobileNavigator } from '../../src/navigation/MobileNavigator';

jest.mock('react-native', () => {
  const native = jest.requireActual('react-native') as typeof import('react-native');
  Object.defineProperty(native, 'findNodeHandle', { configurable: true, value: jest.fn(() => 1) });
  return native;
});

jest.mock('../../src/api/client', () => ({ apiClient: {
  mode: 'preview',
  clearAccessToken: jest.fn(),
  setOnSessionExpired: jest.fn(),
} }));
jest.mock('../../src/auth/mobile-session-store', () => ({ sessionStore: { signOut: jest.fn() } }));
jest.mock('../../src/hooks/query-cache', () => ({ clearQueryCache: jest.fn() }));
jest.mock('../../src/screens', () => {
  const React = require('react');
  const { Pressable, Text } = require('react-native');
  const SignIn = ({ navigation }: { navigation: { enterPreview(): void } }) => React.createElement(
    Pressable,
    { accessibilityRole: 'button', accessibilityLabel: 'Enter preview', onPress: navigation.enterPreview },
    React.createElement(Text, null, 'Enter preview'),
  );
  const Home = () => React.createElement(Text, null, 'Home content');
  const Schedule = () => React.createElement(Text, null, 'Schedule content');
  return { screenComponents: { 'auth.signIn': SignIn, 'dashboard.student': Home, schedule: Schedule } };
});

beforeEach(() => {
  jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
  jest.spyOn(AccessibilityInfo, 'setAccessibilityFocus').mockImplementation(() => {});
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

const renderNavigator = () => render(
  <ThemeProvider forcedScheme="light">
    <LocaleProvider initialLocale="vi"><MobileNavigator /></LocaleProvider>
  </ThemeProvider>,
);

test('announces the localized destination after a route change, once', async () => {
  await renderNavigator();
  expect(AccessibilityInfo.announceForAccessibility).not.toHaveBeenCalled();

  await fireEvent.press(screen.getByRole('button', { name: 'Enter preview' }));
  await waitFor(() => expect(AccessibilityInfo.announceForAccessibility)
    .toHaveBeenCalledWith(shellMessages.vi.screens['dashboard.student']));

  jest.mocked(AccessibilityInfo.announceForAccessibility).mockClear();
  await fireEvent.press(screen.getByRole('tab', { name: shellMessages.vi.nav.schedule }));
  await waitFor(() => expect(AccessibilityInfo.announceForAccessibility)
    .toHaveBeenCalledTimes(1));
  expect(AccessibilityInfo.announceForAccessibility)
    .toHaveBeenCalledWith(shellMessages.vi.screens.schedule);
});

test('moves focus into the compact menu and restores it to the opener', async () => {
  await renderNavigator();
  await fireEvent.press(screen.getByRole('button', { name: 'Enter preview' }));
  jest.mocked(AccessibilityInfo.setAccessibilityFocus).mockClear();

  await fireEvent.press(screen.getByRole('button', { name: shellMessages.vi.openMenu }));
  await waitFor(() => expect(AccessibilityInfo.setAccessibilityFocus).toHaveBeenCalledTimes(1));
  await fireEvent.press(screen.getByRole('button', { name: shellMessages.vi.close }));
  await waitFor(() => expect(AccessibilityInfo.setAccessibilityFocus).toHaveBeenCalledTimes(2));
});
