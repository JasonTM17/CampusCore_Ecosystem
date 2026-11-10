import { localizedNavLabel, shellMessages } from '../../src/i18n/shell-messages';
import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { AccessibilityInfo, Dimensions, StyleSheet, Text } from 'react-native';
import { usePathname, useRouter } from 'expo-router';

import AppGroupLayout from '../../app/(app)/_layout';
import { ResponsiveContent } from '../../src/components/ui/ResponsiveContent';
import { ResponsiveGrid } from '../../src/components/ui/ResponsiveGrid';
import { ThemeProvider } from '../../src/design/theme';
import { tokens } from '../../src/design/tokens';
import { getBottomNavigation, type UserRole } from '../../src/navigation/routes';
import { pathFor, roleHomePath } from '../../src/navigation/route-map';
import { useSession } from '../../src/session/SessionContext';

jest.mock('react-native', () => {
  const native = jest.requireActual('react-native') as typeof import('react-native');
  Object.defineProperty(native, 'findNodeHandle', { configurable: true, value: jest.fn(() => 1) });
  return native;
});

const mockUnreadCount = { value: undefined as number | undefined };

jest.mock('expo-router', () => {
  const { Text, View } = require('react-native');
  return {
    Redirect: ({ href }: { href: string }) => <Text testID="guard-redirect">{href}</Text>,
    Slot: () => <View testID="route-content" />,
    usePathname: jest.fn(),
    useRouter: jest.fn(),
  };
});
jest.mock('../../src/session/SessionContext', () => ({ useSession: jest.fn(), useOptionalSession: () => null }));
jest.mock('../../src/hooks/useScreenQuery', () => ({ useScreenQuery: () => ({ data: undefined }) }));
jest.mock('../../src/api/client', () => ({ apiClient: { mode: 'live' } }));
jest.mock('../../src/hooks/use-dashboard-prefetch', () => ({ useDashboardPrefetch: jest.fn() }));
jest.mock('../../src/screens/content/use-content-query', () => ({
  useContentQuery: jest.fn((_key: string, _fetcher: unknown, enabled = true) => ({
    data: enabled ? mockUnreadCount.value : undefined,
  })),
}));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: require('react-native').View }));

const push = jest.fn();
const replace = jest.fn();
const dismissAll = jest.fn();
const switchRole = jest.fn();

function setWindow(width: number, fontScale = 1) {
  jest.spyOn(Dimensions, 'get').mockReturnValue({ width, height: 800, scale: 2, fontScale });
}

function setSession(role: UserRole = 'student', kind: 'preview' | 'authenticated' | 'signedOut' = 'preview') {
  jest.mocked(useSession).mockReturnValue({
    kind, role, signingOut: false, switchRole, epoch: 0, booted: true, accountId: null, blockedReason: null,
    enterPreview: () => true,
    completeSignIn: () => {},
    beginSignOut: jest.fn(),
    clearSigningOut: jest.fn(),
    signOut: async () => {},
    markBlocked: () => {},
    setRole: () => {},
  });
  jest.mocked(usePathname).mockReturnValue(roleHomePath(role));
}

const renderLayout = (scheme: 'light' | 'dark' = 'light') => render(
  <ThemeProvider forcedScheme={scheme}><AppGroupLayout /></ThemeProvider>,
);

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(AccessibilityInfo, 'setAccessibilityFocus').mockImplementation(() => {});
  mockUnreadCount.value = undefined;
  jest.mocked(useRouter).mockReturnValue({ push, replace, dismissAll } as unknown as ReturnType<typeof useRouter>);
  setSession();
});
afterEach(() => { jest.restoreAllMocks(); });

describe('adaptive app navigation', () => {
  for (const scheme of ['light', 'dark'] as const) {
    for (const width of [360, 700, 839, 840, 1000]) {
      test(`${scheme} w${width} renders exactly one navigation surface`, async () => {
        setWindow(width);
        await renderLayout(scheme);
        if (width >= tokens.windowClasses.mediumMax) {
          expect(screen.getByTestId('navigation-rail')).toBeOnTheScreen();
          expect(screen.queryByTestId('bottom-navigation')).toBeNull();
          const content = screen.getByTestId('app-route-content');
          expect(StyleSheet.flatten(screen.getByTestId('app-chrome').props.style).flexDirection).toBe('row');
          expect(StyleSheet.flatten(content.props.style)).toMatchObject({ flex: 1, minWidth: 0 });
        } else {
          expect(screen.getByTestId('bottom-navigation')).toBeOnTheScreen();
          expect(screen.queryByTestId('navigation-rail')).toBeNull();
        }
        expect(screen.getByText(shellMessages.vi.roles.student)).toBeOnTheScreen();
        expect(screen.getAllByRole('tab')).toHaveLength(getBottomNavigation('student').length);
        expect(screen.getAllByRole('button', { name: 'Mở danh mục' })).toHaveLength(1);
        expect(screen.toJSON()?.props.edges).toEqual(['bottom']);
      });
    }
  }

  for (const width of [360, 700, 1000]) {
    for (const role of ['student', 'lecturer', 'admin'] as const) {
      test(`w${width} preserves ${role} tab order, labels, selection and navigation`, async () => {
        setWindow(width, 1.5);
        setSession(role);
        await renderLayout();
        const items = getBottomNavigation(role);
        expect(screen.getAllByRole('tab').map((tab) => tab.props.accessibilityLabel))
          .toEqual(items.map((item) => localizedNavLabel('vi', item.label)));
        for (const [index, item] of items.entries()) {
          const tab = screen.getByRole('tab', { name: localizedNavLabel('vi', item.label) });
          expect(tab.props.accessibilityState).toEqual({ selected: index === 0 });
          const calls = push.mock.calls.length;
          await fireEvent.press(tab);
          if (pathFor(item.route) === roleHomePath(role)) {
            expect(push).toHaveBeenCalledTimes(calls);
          } else {
            expect(push).toHaveBeenLastCalledWith(pathFor(item.route));
          }
        }
        expect(push).toHaveBeenCalledTimes(items.length - 1);
      });
    }
  }

  test('pressing the already-active tab does not stack a duplicate screen', async () => {
    setWindow(700);
    jest.mocked(usePathname).mockReturnValue('/grades');
    await renderLayout();
    const tab = screen.getByRole('tab', { name: localizedNavLabel('vi', 'Grades') });
    expect(tab).toBeSelected();
    await fireEvent.press(tab);
    expect(push).not.toHaveBeenCalled();
  });

  test('an active secondary tab is selected after routing', async () => {
    setWindow(1000);
    jest.mocked(usePathname).mockReturnValue('/schedule');
    await renderLayout();
    expect(screen.getByRole('tab', { name: localizedNavLabel('vi', 'Schedule') })).toBeSelected();
    expect(screen.getByRole('tab', { name: 'Trang chủ' })).not.toBeSelected();
  });

  for (const width of [360, 700, 1000]) {
    test(`w${width} opens the menu, hides underlying chrome, and navigates through the same callback`, async () => {
      setWindow(width);
      await renderLayout();
      await fireEvent.press(screen.getByRole('button', { name: 'Mở danh mục' }));
      expect(screen.getByRole('header', { name: shellMessages.vi.menuTitle })).toBeOnTheScreen();
      expect(screen.queryAllByRole('tab')).toHaveLength(0);
      expect(screen.getByTestId('app-chrome', { includeHiddenElements: true }).props.importantForAccessibility)
        .toBe('no-hide-descendants');
      await fireEvent.press(screen.getByRole('button', { name: shellMessages.vi.screens.schedule }));
      expect(push).toHaveBeenLastCalledWith(pathFor('schedule'));
      expect(screen.queryByRole('header', { name: shellMessages.vi.menuTitle })).toBeNull();
      expect(screen.getByRole('tab', { name: 'Trang chủ' })).toBeOnTheScreen();
    });
  }

  test('expanded menu can close and retains preview role switching', async () => {
    setWindow(1000);
    await renderLayout();
    await fireEvent.press(screen.getByRole('button', { name: 'Mở danh mục' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Đóng' }));
    expect(screen.getByTestId('navigation-rail')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Mở danh mục' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Giảng viên' }));
    expect(switchRole).toHaveBeenCalledWith('lecturer');
    expect(replace).toHaveBeenCalledWith(roleHomePath('lecturer'));
    expect(screen.queryByRole('header', { name: shellMessages.vi.menuTitle })).toBeNull();
  });

  test('authenticated expanded menu does not expose preview role switching', async () => {
    setWindow(1000);
    setSession('student', 'authenticated');
    await renderLayout();
      await fireEvent.press(screen.getByRole('button', { name: 'Mở danh mục' }));
    expect(screen.queryByText('Vai trò xem thử')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Giảng viên' })).toBeNull();
  });

  test('an authenticated student keeps the student chip and mobile tabs', async () => {
    setWindow(360);
    setSession('student', 'authenticated');
    await renderLayout();
    expect(screen.getByText(shellMessages.vi.roles.student)).toBeOnTheScreen();
    expect(screen.getByTestId('bottom-navigation')).toBeOnTheScreen();
    expect(screen.getAllByRole('tab')).toHaveLength(getBottomNavigation('student').length);
  });

  test.each([360, 1000])('w%s shows the unread count on the menu and header bell', async (width) => {
    setWindow(width);
    setSession('student', 'authenticated');
    mockUnreadCount.value = 3;
    await renderLayout();

    expect(screen.getByRole('button', { name: 'Mở danh mục, 3 Chưa đọc' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Thông báo, 3 Chưa đọc' })).toBeOnTheScreen();
    expect(screen.getAllByText('3', { includeHiddenElements: true }).length).toBeGreaterThan(0);
  });

  test.each([360, 1000])('w%s moves accessibility focus into and back out of the menu', async (width) => {
    setWindow(width);
    await renderLayout();

    await fireEvent.press(screen.getByRole('button', { name: 'Mở danh mục' }));
    await waitFor(() => expect(AccessibilityInfo.setAccessibilityFocus).toHaveBeenCalledTimes(1));
    await fireEvent.press(screen.getByRole('button', { name: 'Đóng' }));
    await waitFor(() => expect(AccessibilityInfo.setAccessibilityFocus).toHaveBeenCalledTimes(2));
  });

  test.each([360, 1000])('an applicant session has no student navigation and can sign out at w%s', async (width) => {
    setWindow(width);
    const signOut = jest.fn(() => new Promise<void>(() => {}));
    const beginSignOut = jest.fn();
    jest.mocked(useSession).mockReturnValue({
      kind: 'authenticated', role: 'student', signingOut: false, switchRole, epoch: 0, booted: true,
      accountId: 'acct-applicant', blockedReason: null,
      capabilities: ['admissions.self', 'applicant.surface'],
      enterPreview: () => true,
      completeSignIn: () => {},
      beginSignOut,
      clearSigningOut: jest.fn(),
      signOut,
      markBlocked: () => {},
      setRole: () => {},
    });
    jest.mocked(usePathname).mockReturnValue('/apply');

    await renderLayout();

    expect(screen.getByText('Thí sinh')).toBeOnTheScreen();
    expect(screen.queryByText(shellMessages.vi.roles.student)).toBeNull();
    expect(screen.queryByTestId('bottom-navigation')).toBeNull();
    expect(screen.queryByTestId('navigation-rail')).toBeNull();
    expect(screen.queryAllByRole('tab')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: shellMessages.vi.openMenu })).toBeNull();
    expect(screen.queryByTestId('menu-panel-role-row')).toBeNull();
    expect(screen.queryByTestId('assistant-fab')).toBeNull();
    expect(StyleSheet.flatten(screen.getByTestId('app-route-content').props.style)).toMatchObject({ flex: 1 });
    expect(screen.toJSON()?.props.edges).toEqual(['bottom']);

    const signOutControl = screen.getByRole('button', { name: shellMessages.vi.signOut });
    expect(screen.queryByRole('button', { name: shellMessages.vi.screens.profile })).toBeNull();
    await fireEvent.press(signOutControl);
    expect(dismissAll).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith('/session/logged-out');
    expect(beginSignOut).toHaveBeenCalledTimes(1);
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(beginSignOut.mock.invocationCallOrder[0]).toBeLessThan(dismissAll.mock.invocationCallOrder[0]);
    expect(dismissAll.mock.invocationCallOrder[0]).toBeLessThan(replace.mock.invocationCallOrder[0]);
    expect(replace.mock.invocationCallOrder[0]).toBeLessThan(signOut.mock.invocationCallOrder[0]);
  });

  test.each(['signedOut', 'authenticated'] as const)('%s keeps the protected-route guard', async (kind) => {
    setWindow(1000);
    setSession('student', kind);
    jest.mocked(usePathname).mockReturnValue('/admin/dashboard');
    await renderLayout();
    expect(screen.getByTestId('guard-redirect')).toHaveTextContent(kind === 'signedOut' ? '/sign-in' : '/dashboard');
    expect(screen.queryByTestId('route-content')).toBeNull();
    expect(screen.queryByRole('tab')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Mở danh mục' })).toBeNull();
  });
});

describe('semantic content width caps', () => {
  for (const Component of [ResponsiveContent, ResponsiveGrid]) {
    for (const [width, windowClass] of [[360, 'compact'], [700, 'medium'], [1000, 'expanded']] as const) {
      test(`${Component.name} w${width} follows the window token`, async () => {
        setWindow(width);
        await render(<Component><Text>Content</Text></Component>);
        const style = StyleSheet.flatten(screen.toJSON()?.props.style) ?? {};
        if (windowClass === 'compact') {
          expect(style.maxWidth).toBeUndefined();
          expect(style.width).toBeUndefined();
        } else {
          expect(style.maxWidth).toBe(tokens.windowClasses.contentMaxWidth[windowClass]);
          expect(style.width).toBe('100%');
          expect(style.alignSelf).toBe('center');
        }
      });
    }
  }
});
