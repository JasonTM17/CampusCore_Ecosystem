import { afterEach, describe, expect, jest, test } from '@jest/globals';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Keyboard, StyleSheet } from 'react-native';
import type { ReactElement } from 'react';

const mockApi = { mode: 'preview' as 'preview' | 'live' };
jest.mock('../../src/api/client', () => ({
  get apiClient() { return { mode: mockApi.mode }; },
}));

import { AssistantFab, ASSISTANT_FAB_SIZE, isAssistantFabVisible } from '../../src/components/AssistantFab';
import { MenuPanel } from '../../src/components/MenuPanel';
import { PreviewPill } from '../../src/components/PreviewPill';
import { resolveCapabilities, NO_CAPABILITIES } from '../../src/auth/capabilities';
import { ThemeProvider } from '../../src/design/theme';
import { LocaleProvider } from '../../src/i18n/locale-provider';
import { shellMessages } from '../../src/i18n/shell-messages';
import { roleHomePath } from '../../src/navigation/route-map';
import type { UserRole } from '../../src/navigation/routes';

afterEach(() => {
  jest.restoreAllMocks();
  mockApi.mode = 'preview';
});

function wrap(ui: ReactElement, locale: 'vi' | 'en' = 'vi') {
  return (
    <ThemeProvider forcedScheme="light">
      <LocaleProvider initialLocale={locale}>{ui}</LocaleProvider>
    </ThemeProvider>
  );
}

describe('AssistantFab', () => {
  test('visibility follows role guard, lane capability, keyboard and route', () => {
    const roles: UserRole[] = ['student', 'lecturer', 'admin'];
    for (const role of roles) {
      expect(isAssistantFabVisible({
        session: 'authenticated', role, capabilities: NO_CAPABILITIES,
        pathname: roleHomePath(role), keyboardVisible: false,
      })).toBe(true);
    }
    expect(isAssistantFabVisible({
      session: 'preview', role: 'student', capabilities: NO_CAPABILITIES,
      pathname: '/dashboard', keyboardVisible: false,
    })).toBe(true);
    expect(isAssistantFabVisible({
      session: 'signedOut', role: 'student', capabilities: NO_CAPABILITIES,
      pathname: '/sign-in', keyboardVisible: false,
    })).toBe(false);
    expect(isAssistantFabVisible({
      session: 'authenticated', role: 'student', capabilities: NO_CAPABILITIES,
      pathname: '/lecturer/dashboard', keyboardVisible: false,
    })).toBe(false);
    expect(isAssistantFabVisible({
      session: 'authenticated', role: 'student', capabilities: NO_CAPABILITIES,
      pathname: '/assistant', keyboardVisible: false,
    })).toBe(false);
    expect(isAssistantFabVisible({
      session: 'authenticated', role: 'student', capabilities: NO_CAPABILITIES,
      pathname: '/dashboard', keyboardVisible: true,
    })).toBe(false);
    expect(isAssistantFabVisible({
      session: 'signedOut', role: 'student', capabilities: NO_CAPABILITIES,
      pathname: '/forgot-password', keyboardVisible: false,
    })).toBe(false);
    for (const pathname of ['/sign-in-blocked', '/reset-password']) {
      expect(isAssistantFabVisible({
        session: 'signedOut', role: 'student', capabilities: NO_CAPABILITIES,
        pathname, keyboardVisible: false,
      })).toBe(false);
    }

    const lanesOff = { dean: false, staff: false, admin: false, checkin: false };
    const lanesAdminOn = { ...lanesOff, admin: true };
    const adminWithoutLane = resolveCapabilities({ claims: ['ADMIN'], lanes: lanesOff });
    const adminWithLane = resolveCapabilities({ claims: ['ADMIN'], lanes: lanesAdminOn });
    expect(isAssistantFabVisible({
      session: 'authenticated', role: 'admin', capabilities: adminWithoutLane,
      pathname: '/admin', keyboardVisible: false,
    })).toBe(false);
    expect(isAssistantFabVisible({
      session: 'authenticated', role: 'admin', capabilities: adminWithLane,
      pathname: '/admin', keyboardVisible: false,
    })).toBe(true);
  });

  test('renders a localized accessible 56 dp button and invokes its action', async () => {
    const onPress = jest.fn();
    await render(wrap(
      <AssistantFab session="authenticated" role="student" capabilities={NO_CAPABILITIES} pathname="/dashboard" onPress={onPress} />,
      'en',
    ));
    const button = screen.getByRole('button', { name: 'CampusUTE Assistant' });
    expect(button).toBeOnTheScreen();
    expect(button.props.testID).toBe('assistant-fab');
    expect(ASSISTANT_FAB_SIZE).toBe(56);
    expect(StyleSheet.flatten(button.props.style)).toMatchObject({ height: 56, width: 56 });
    await fireEvent.press(button);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  test('shows the Assistant menu item for student, lecturer and admin roles', async () => {
    const props = {
      activeRoute: 'dashboard.student' as const,
      onClose: jest.fn(),
      onNavigate: jest.fn(),
      onSwitchRole: jest.fn(),
      allowRoleSwitch: false,
    };
    const { rerender } = await render(wrap(<MenuPanel {...props} role="student" />));
    expect(screen.getByRole('button', { name: shellMessages.vi.screens['assistant.chat'] })).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: shellMessages.vi.sections.assistant })).toBeOnTheScreen();
    await rerender(wrap(<MenuPanel {...props} role="lecturer" />));
    expect(screen.getByRole('button', { name: shellMessages.vi.screens['assistant.chat'] })).toBeOnTheScreen();
    await rerender(wrap(<MenuPanel {...props} role="admin" />));
    expect(screen.getByRole('button', { name: shellMessages.vi.screens['assistant.chat'] })).toBeOnTheScreen();
  });

  test('hides while the keyboard is open and restores when it closes', async () => {
    const listeners = new Map<string, () => void>();
    const addListener = jest.spyOn(Keyboard, 'addListener');
    addListener.mockImplementation(((event: string, listener: (...args: never[]) => unknown) => {
      listeners.set(event, () => { listener(); });
      return { remove: jest.fn() };
    }) as never);
    await render(wrap(
      <AssistantFab session="authenticated" role="student" capabilities={NO_CAPABILITIES} pathname="/dashboard" onPress={() => {}} />,
    ));
    expect(screen.getByTestId('assistant-fab')).toBeOnTheScreen();
    await act(async () => { listeners.get('keyboardDidShow')?.(); });
    expect(screen.queryByTestId('assistant-fab')).toBeNull();
    await act(async () => { listeners.get('keyboardDidHide')?.(); });
    expect(screen.getByTestId('assistant-fab')).toBeOnTheScreen();
  });

  test('starts hidden when mounted while the keyboard is already open', async () => {
    jest.spyOn(Keyboard, 'isVisible').mockReturnValue(true);
    await render(wrap(
      <AssistantFab session="authenticated" role="student" capabilities={NO_CAPABILITIES} pathname="/dashboard" onPress={() => {}} />,
    ));
    expect(screen.queryByTestId('assistant-fab')).toBeNull();
  });
});

describe('PreviewPill', () => {
  test('is absent in live mode', async () => {
    mockApi.mode = 'live';
    await render(wrap(<PreviewPill />));
    expect(screen.queryByTestId('preview-pill')).toBeNull();
  });

  test('shows in preview with the full accessible sentence and opens its explanation', async () => {
    const disclosure = shellMessages.vi.dashboard.previewData;
    await render(wrap(<PreviewPill />));
    const pill = screen.getByRole('button', { name: disclosure });
    expect(pill).toBeOnTheScreen();
    await fireEvent.press(pill);
    expect(screen.getByText(disclosure)).toBeOnTheScreen();
  });

  test('localizes the disclosure in English', async () => {
    const disclosure = shellMessages.en.dashboard.previewData;
    await render(wrap(<PreviewPill />, 'en'));
    await fireEvent.press(screen.getByRole('button', { name: disclosure }));
    expect(screen.getByText(disclosure)).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Close' })).toBeOnTheScreen();
  });
});
