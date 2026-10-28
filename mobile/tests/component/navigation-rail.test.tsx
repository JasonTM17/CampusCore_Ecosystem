import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Dimensions, StyleSheet, Text } from 'react-native';
import { usePathname, useRouter } from 'expo-router';

import AppGroupLayout from '../../app/(app)/_layout';
import { ResponsiveContent } from '../../src/components/ui/ResponsiveContent';
import { ResponsiveGrid } from '../../src/components/ui/ResponsiveGrid';
import { ThemeProvider } from '../../src/design/theme';
import { tokens } from '../../src/design/tokens';
import { getBottomNavigation, type UserRole } from '../../src/navigation/routes';
import { pathFor, roleHomePath } from '../../src/navigation/route-map';
import { useSession } from '../../src/session/SessionContext';

jest.mock('expo-router', () => {
  const { Text, View } = require('react-native');
  return {
    Redirect: ({ href }: { href: string }) => <Text testID="guard-redirect">{href}</Text>,
    Slot: () => <View testID="route-content" />,
    usePathname: jest.fn(),
    useRouter: jest.fn(),
  };
});
jest.mock('../../src/session/SessionContext', () => ({ useSession: jest.fn() }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: require('react-native').View }));

const push = jest.fn();
const replace = jest.fn();
const switchRole = jest.fn();

function setWindow(width: number, fontScale = 1) {
  jest.spyOn(Dimensions, 'get').mockReturnValue({ width, height: 800, scale: 2, fontScale });
}

function setSession(role: UserRole = 'student', kind: 'preview' | 'authenticated' | 'signedOut' = 'preview') {
  jest.mocked(useSession).mockReturnValue({
    kind, role, switchRole, epoch: 0, booted: true, accountId: null, blockedReason: null,
    enterPreview: () => true,
    completeSignIn: () => {},
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
  jest.mocked(useRouter).mockReturnValue({ push, replace } as unknown as ReturnType<typeof useRouter>);
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
        expect(screen.getAllByRole('tab')).toHaveLength(getBottomNavigation('student').length);
        expect(screen.getAllByRole('button', { name: 'Open menu' })).toHaveLength(1);
        expect(screen.toJSON()?.props.edges).toEqual(['top', 'bottom']);
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
          .toEqual(items.map((item) => item.label));
        for (const [index, item] of items.entries()) {
          const tab = screen.getByRole('tab', { name: item.label });
          expect(tab.props.accessibilityState).toEqual({ selected: index === 0 });
          await fireEvent.press(tab);
          expect(push).toHaveBeenLastCalledWith(pathFor(item.route));
        }
        expect(push).toHaveBeenCalledTimes(items.length);
      });
    }
  }

  test('an active secondary tab is selected after routing', async () => {
    setWindow(1000);
    jest.mocked(usePathname).mockReturnValue('/schedule');
    await renderLayout();
    expect(screen.getByRole('tab', { name: 'Schedule' })).toBeSelected();
    expect(screen.getByRole('tab', { name: 'Home' })).not.toBeSelected();
  });

  for (const width of [360, 700, 1000]) {
    test(`w${width} opens the menu, hides underlying chrome, and navigates through the same callback`, async () => {
      setWindow(width);
      await renderLayout();
      await fireEvent.press(screen.getByRole('button', { name: 'Open menu' }));
      expect(screen.getByRole('header', { name: 'Complete menu' })).toBeOnTheScreen();
      expect(screen.queryAllByRole('tab')).toHaveLength(0);
      expect(screen.getByTestId('app-chrome', { includeHiddenElements: true }).props.importantForAccessibility)
        .toBe('no-hide-descendants');
      await fireEvent.press(screen.getByRole('button', { name: 'Schedule' }));
      expect(push).toHaveBeenLastCalledWith(pathFor('schedule'));
      expect(screen.queryByRole('header', { name: 'Complete menu' })).toBeNull();
      expect(screen.getByRole('tab', { name: 'Home' })).toBeOnTheScreen();
    });
  }

  test('expanded menu can close and retains preview role switching', async () => {
    setWindow(1000);
    await renderLayout();
    await fireEvent.press(screen.getByRole('button', { name: 'Open menu' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Close' }));
    expect(screen.getByTestId('navigation-rail')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Open menu' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Lecturer' }));
    expect(switchRole).toHaveBeenCalledWith('lecturer');
    expect(replace).toHaveBeenCalledWith(roleHomePath('lecturer'));
    expect(screen.queryByRole('header', { name: 'Complete menu' })).toBeNull();
  });

  test('authenticated expanded menu does not expose preview role switching', async () => {
    setWindow(1000);
    setSession('student', 'authenticated');
    await renderLayout();
    await fireEvent.press(screen.getByRole('button', { name: 'Open menu' }));
    expect(screen.queryByText('Preview role')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Lecturer' })).toBeNull();
  });

  test.each(['signedOut', 'authenticated'] as const)('%s keeps the protected-route guard', async (kind) => {
    setWindow(1000);
    setSession('student', kind);
    jest.mocked(usePathname).mockReturnValue('/admin/dashboard');
    await renderLayout();
    expect(screen.getByTestId('guard-redirect')).toHaveTextContent(kind === 'signedOut' ? '/sign-in' : '/dashboard');
    expect(screen.queryByTestId('route-content')).toBeNull();
    expect(screen.queryByRole('tab')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Open menu' })).toBeNull();
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
