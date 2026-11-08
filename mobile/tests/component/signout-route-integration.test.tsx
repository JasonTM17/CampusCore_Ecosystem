import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { beforeEach, expect, jest, test } from '@jest/globals';
import type { ReactNode } from 'react';

import { createSessionStore } from '../../src/auth/session-store';
import RootLayout from '../../app/_layout';

let mockPathname = '/sign-in';
let mockSetPath: ((path: string) => void) | null = null;
let mockStore: ReturnType<typeof createSessionStore>;
const mockApi = {
  mode: 'live',
  setOnSessionExpired: jest.fn(),
};
const mockRouter = {
  push: jest.fn((path: string) => mockSetPath?.(path)),
  replace: jest.fn((path: string) => mockSetPath?.(path)),
  dismissAll: jest.fn(),
  canGoBack: jest.fn(() => false),
  back: jest.fn(),
};

jest.mock('expo-router', () => {
  const React = require('react') as typeof import('react');
  const Native = require('react-native') as typeof import('react-native');
  return {
    Redirect: ({ href }: { href: string }) => {
      React.useEffect(() => {
        if (mockPathname !== href) mockSetPath?.(href);
      }, [href]);
      return null;
    },
    SplashScreen: { preventAutoHideAsync: () => Promise.resolve(), hideAsync: () => Promise.resolve() },
    Stack: () => {
      const { useSession } = require('../../src/session/SessionContext') as typeof import('../../src/session/SessionContext');
      const { useMobileNavigation } = require('../../src/navigation/router-adapter') as typeof import('../../src/navigation/router-adapter');
      useSession();
      const navigation = useMobileNavigation();
      if (mockPathname === '/sign-in') {
        return React.createElement(
          Native.Pressable,
          {
            accessibilityRole: 'button',
            accessibilityLabel: 'Complete sign-in',
            onPress: () => {
              navigation.completeSignIn('student', 'account-1');
              navigation.navigate('profile');
            },
          },
          React.createElement(Native.Text, null, 'Complete sign-in'),
        );
      }
      if (mockPathname === '/profile') {
        return React.createElement(
          Native.Pressable,
          { accessibilityRole: 'button', accessibilityLabel: 'Sign out', onPress: navigation.signOut },
          React.createElement(Native.Text, null, 'Sign out'),
        );
      }
      return React.createElement(Native.Text, { testID: 'current-path' }, mockPathname);
    },
    usePathname: () => mockPathname,
    useRouter: () => mockRouter,
  };
});
jest.mock('expo-font', () => ({ useFonts: () => [true, null] }));
jest.mock('../../src/api/client', () => ({ get apiClient() { return mockApi; }, campusApi: {} }));
jest.mock('../../src/auth/mobile-session-store', () => ({ get sessionStore() { return mockStore; } }));
jest.mock('../../src/hooks/query-cache', () => ({ clearQueryCache: jest.fn(), queryCacheIdentity: jest.fn(), syncQueryCacheIdentity: jest.fn() }));
jest.mock('../../src/config/lane-flags', () => ({ LANE_FLAGS: { dean: false, staff: false, admin: false, checkin: false } }));
jest.mock('../../src/design/theme', () => ({
  ThemeProvider: ({ children }: { children: ReactNode }) => children,
  useTheme: () => ({ scheme: 'light', colors: { background: '#fff' } }),
}));
jest.mock('../../src/i18n/locale-provider', () => ({
  LocaleProvider: ({ children }: { children: ReactNode }) => children,
  useLocale: () => ({ ready: true, locale: 'vi' }),
}));
jest.mock('../../src/components/ErrorBoundary', () => ({ ErrorBoundary: ({ children }: { children: ReactNode }) => children }));

function RootHarness() {
  const React = require('react') as typeof import('react');
  const [pathname, setPathname] = React.useState('/sign-in');
  mockPathname = pathname;
  mockSetPath = setPathname;
  return React.createElement(RootLayout);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockPathname = '/sign-in';
  mockSetPath = null;
  mockApi.mode = 'live';
  const secure = new Map([['cu.install', JSON.stringify({ appInstanceId: 'install' })]]);
  mockStore = createSessionStore({
    issuer: 'https://issuer.test',
    fetchImpl: jest.fn(async () => new Response('{}', { status: 503 })) as typeof fetch,
    secure: {
      getItemAsync: async (key) => secure.get(key) ?? null,
      setItemAsync: async (key, value) => { secure.set(key, value); },
      deleteItemAsync: async (key) => { secure.delete(key); },
    },
    sandbox: {
      getItem: async () => JSON.stringify({ appInstanceId: 'install' }),
      setItem: async () => {},
      removeItem: async () => {},
    },
  });
});

test('the real session provider and root guard retain the logged-out route while storage sign-out is pending', async () => {
  let releaseStorageWipe!: () => void;
  const storageWipe = new Promise<void>((resolve) => { releaseStorageWipe = resolve; });
  const signOut = jest.spyOn(mockStore, 'signOut').mockImplementation(async () => storageWipe);
  await render(<RootHarness />);
  await fireEvent.press(await screen.findByRole('button', { name: 'Complete sign-in' }));
  expect(await screen.findByRole('button', { name: 'Sign out' })).toBeOnTheScreen();

  await fireEvent.press(screen.getByRole('button', { name: 'Sign out' }));
  await waitFor(() => expect(screen.getByTestId('current-path')).toHaveTextContent('/session/logged-out'));
  expect(mockPathname).toBe('/session/logged-out');
  expect(signOut).toHaveBeenCalledTimes(1);
  expect(mockRouter.dismissAll).toHaveBeenCalledTimes(1);

  await act(async () => { releaseStorageWipe(); await storageWipe; });
});
