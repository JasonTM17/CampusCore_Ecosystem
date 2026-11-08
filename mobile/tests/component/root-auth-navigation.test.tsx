import { beforeEach, expect, jest, test } from '@jest/globals';
import { act, render } from '@testing-library/react-native';
import { createRequire } from 'node:module';
import type { ReactElement, ReactNode } from 'react';

const renderToString = (createRequire(__filename)('react-dom/server') as {
  renderToString: (element: ReactElement) => string;
}).renderToString;

const mockRememberCheckinPath = jest.fn();
const mockConsumePendingCheckinPath = jest.fn(() => null);
const mockRedirect = jest.fn();
const mockSession = {
  kind: 'signedOut' as 'signedOut' | 'authenticated',
  role: 'student',
  capabilities: [] as string[],
  blockedReason: null as string | null,
  bootStatus: 'ready',
  booted: true,
};
let mockPathname = '/courses';

jest.mock('expo-font', () => ({ useFonts: () => [true, null] }));
jest.mock('expo-router', () => {
  return {
    Redirect: ({ href }: { href: string }) => { mockRedirect(href); return null; },
    SplashScreen: { preventAutoHideAsync: jest.fn(async () => {}), hideAsync: jest.fn(async () => {}) },
    Stack: () => null,
    usePathname: () => mockPathname,
  };
});
jest.mock('../../src/design/theme', () => ({
  ThemeProvider: ({ children }: { children: ReactNode }) => children,
  useTheme: () => ({ scheme: 'light', colors: { background: '#fff' }, window: { fontScale: 1 } }),
}));
jest.mock('../../src/i18n/locale-provider', () => ({
  LocaleProvider: ({ children }: { children: ReactNode }) => children,
  useLocale: () => ({ ready: true, locale: 'en' }),
}));
jest.mock('../../src/session/SessionContext', () => ({
  SessionProvider: ({ children }: { children: ReactNode }) => children,
  useSession: () => mockSession,
}));
jest.mock('../../src/components/ErrorBoundary', () => ({ ErrorBoundary: ({ children }: { children: ReactNode }) => children }));
jest.mock('../../src/components/Ui', () => ({ Button: () => null, UiText: () => null }));
jest.mock('../../src/navigation/pending-checkin', () => ({
  consumePendingCheckinPath: () => mockConsumePendingCheckinPath(),
  rememberCheckinPath: (path: string) => mockRememberCheckinPath(path),
}));
jest.mock('../../src/navigation/route-map', () => ({
  laneScreenForPath: () => null,
  pathFor: () => '/sign-in',
  resolveGuard: (kind: string) => kind === 'signedOut' ? { action: 'redirect', to: 'auth.signIn' } : { action: 'allow' },
  screenForPath: (path: string) => path === '/courses' ? { name: 'courses' } : null,
}));
jest.mock('../../src/config/lane-flags', () => ({ LANE_FLAGS: {} }));

import RootLayout from '../../app/_layout';

beforeEach(() => {
  mockRememberCheckinPath.mockClear();
  mockConsumePendingCheckinPath.mockClear();
  mockRedirect.mockClear();
  mockSession.kind = 'signedOut';
  mockSession.bootStatus = 'ready';
  mockSession.booted = true;
  mockPathname = '/courses';
});

test('rendering without effects does not write the pending check-in path', () => {
  renderToString(<RootLayout />);

  expect(mockRememberCheckinPath).not.toHaveBeenCalled();
});

test('a cold-start deep link is retained across the sign-in redirect', async () => {
  const view = await render(<RootLayout />);
  expect(mockRedirect).toHaveBeenLastCalledWith('/sign-in');

  mockPathname = '/sign-in';
  await act(async () => view.rerender(<RootLayout />));

  mockSession.kind = 'authenticated';
  await act(async () => view.rerender(<RootLayout />));

  expect(mockRedirect).toHaveBeenLastCalledWith('/courses');
});
