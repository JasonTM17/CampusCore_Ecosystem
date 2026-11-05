import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactNode } from 'react';

let mockPathname = '/registration';
let mockLocale: 'vi' | 'en' = 'vi';
let mockPendingCheckin: string | null = null;
let mockSession: {
  kind: 'signedOut' | 'authenticated';
  role: string;
  accountId: string | null;
  capabilities: string[];
  blockedReason: string | null;
  booted: boolean;
  bootStatus: string;
  bootUnavailableReason?: string;
  retryBoot?: () => Promise<void>;
} = {
  kind: 'signedOut',
  role: 'student',
  accountId: null,
  capabilities: [],
  blockedReason: null,
  booted: true,
  bootStatus: 'reauthRequired',
};

jest.mock('expo-router', () => {
  const React = jest.requireActual('react') as typeof import('react');
  const Native = jest.requireActual('react-native') as typeof import('react-native');
  return {
    Redirect: ({ href }: { href: string }) => React.createElement(Native.Text, { testID: 'redirect-target' }, href),
    Slot: () => React.createElement(Native.Text, { testID: 'foreign-screen' }, 'foreign screen'),
    Stack: () => null,
    SplashScreen: { preventAutoHideAsync: () => Promise.resolve(), hideAsync: () => Promise.resolve() },
    usePathname: () => mockPathname,
    useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => true }),
  };
});
jest.mock('expo-font', () => ({ useFonts: () => [true, null] }));
jest.mock('../../src/design/theme', () => ({
  ThemeProvider: ({ children }: { children: ReactNode }) => children,
  useTheme: () => ({ scheme: 'light', colors: { background: '#fff' }, window: { class: 'compact' } }),
}));
jest.mock('../../src/i18n/locale-provider', () => ({
  LocaleProvider: ({ children }: { children: ReactNode }) => children,
  useLocale: () => ({ ready: true, locale: mockLocale }),
}));
jest.mock('../../src/components/Ui', () => {
  const React = jest.requireActual('react') as typeof import('react');
  const Native = jest.requireActual('react-native') as typeof import('react-native');
  return {
    UiText: ({ children }: { children: ReactNode }) => React.createElement(Native.Text, {}, children),
    Button: ({ label, onPress, loading }: { label: string; onPress: () => void; loading?: boolean }) =>
      React.createElement(Native.Pressable, { accessibilityRole: 'button', accessibilityLabel: label, disabled: loading, onPress }, React.createElement(Native.Text, {}, label)),
  };
});
jest.mock('../../src/session/SessionContext', () => ({
  SessionProvider: ({ children }: { children: ReactNode }) => children,
  useSession: () => mockSession,
}));
jest.mock('../../src/components/ErrorBoundary', () => ({ ErrorBoundary: ({ children }: { children: ReactNode }) => children }));
jest.mock('../../src/components/AppBar', () => ({ AppBar: () => null }));
jest.mock('../../src/components/AssistantFab', () => ({ AssistantFab: () => null }));
jest.mock('../../src/components/BottomNavigation', () => ({ BottomNavigation: () => null }));
jest.mock('../../src/components/MenuPanel', () => ({ MenuPanel: () => null }));
jest.mock('../../src/components/NavigationRail', () => ({ NavigationRail: () => null }));
jest.mock('../../src/navigation/pending-checkin', () => ({
  consumePendingCheckinPath: () => {
    const next = mockPendingCheckin;
    mockPendingCheckin = null;
    return next;
  },
  rememberCheckinPath: jest.fn(),
}));
jest.mock('../../src/hooks/use-dashboard-prefetch', () => ({ useDashboardPrefetch: jest.fn() }));

import RootLayout from '../../app/_layout';
import AppGroupLayout from '../../app/(app)/_layout';

beforeEach(() => {
  mockPathname = '/registration';
  mockLocale = 'vi';
  mockPendingCheckin = null;
  mockSession = {
    kind: 'signedOut', role: 'student', accountId: null, capabilities: [],
    blockedReason: null, booted: true, bootStatus: 'reauthRequired',
  };
});

describe('route recovery and role denial', () => {
  test.each([
    ['vi', 'Không có kết nối mạng.', 'Thử lại phiên'],
    ['en', 'You are offline.', 'Retry session'],
  ] as ['vi' | 'en', string, string][])('offline bootstrap shows a %s retry surface before any signed-out redirect', async (locale, message, retryLabel) => {
    mockLocale = locale;
    const retryBoot = jest.fn(async () => {});
    mockSession = { ...mockSession, bootStatus: 'unavailable', bootUnavailableReason: 'offline', retryBoot };
    const view = await render(<RootLayout />);
    expect(screen.getByText(message)).toBeTruthy();
    expect(screen.queryByTestId('redirect-target')).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: retryLabel }));
    expect(retryBoot).toHaveBeenCalledTimes(1);
    mockSession = { ...mockSession, bootStatus: 'checking' };
    await view.rerender(<RootLayout />);
    expect(screen.getByRole('button', { name: retryLabel })).toBeDisabled();
    expect(screen.queryByTestId('redirect-target')).toBeNull();
    mockSession = { ...mockSession, kind: 'authenticated', accountId: 'student-1', bootStatus: 'ready', bootUnavailableReason: undefined };
    await view.rerender(<RootLayout />);
    expect(screen.queryByText(message)).toBeNull();
    expect(screen.queryByTestId('redirect-target')).toBeNull();
  });
  test('an expired session returns to its protected route after sign-in', async () => {
    const view = await render(<RootLayout />);
    expect(screen.getByTestId('redirect-target')).toHaveTextContent('/sign-in');

    mockPathname = '/dashboard';
    mockSession = {
      kind: 'authenticated', role: 'student', accountId: 'student-1', capabilities: [],
      blockedReason: null, booted: true, bootStatus: 'ready',
    };
    await view.rerender(<RootLayout />);

    expect(screen.getByTestId('redirect-target')).toHaveTextContent('/registration');
  });

  test('a student deep link to a lecturer route redirects before the foreign screen renders', async () => {
    mockPathname = '/lecturer/grading';
    mockSession = {
      kind: 'authenticated', role: 'student', accountId: 'student-1', capabilities: [],
      blockedReason: null, booted: true, bootStatus: 'ready',
    };

    await render(<AppGroupLayout />);

    expect(screen.getByTestId('redirect-target')).toHaveTextContent('/dashboard');
    expect(screen.queryByTestId('foreign-screen')).toBeNull();
  });

const callbackSessionCases: Array<[string, 'signedOut' | 'authenticated', '/sign-in']> = [
    ['signed out', 'signedOut', '/sign-in'],
    ['signed in', 'authenticated', '/sign-in'],
  ];

test.each(callbackSessionCases)('a stray OIDC callback from a %s session is rejected without changing the session', async (_label, kind, target) => {
    mockPathname = '/auth/callback';
    mockSession = {
      kind, role: 'student', accountId: kind === 'authenticated' ? 'student-1' : null, capabilities: [],
      blockedReason: null, booted: true, bootStatus: 'ready',
    };
    const before = mockSession;

    await render(<RootLayout />);

    expect(screen.getByTestId('redirect-target')).toHaveTextContent(target);
    expect(mockSession).toBe(before);
    expect(screen.queryByTestId('foreign-screen')).toBeNull();
  });
});
