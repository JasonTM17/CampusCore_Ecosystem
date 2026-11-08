import { afterEach, beforeEach, expect, jest, test } from '@jest/globals';
import { act, render, screen } from '@testing-library/react-native';
import { AppState } from 'react-native';
import type { ReactNode } from 'react';

import { createSessionStore } from '../../src/auth/session-store';

let mockStore: ReturnType<typeof createSessionStore>;
let mockRequest: jest.Mock<(...args: unknown[]) => Promise<Response>>;
let mockSecure: Map<string, string>;
let releaseRefresh: ((response: Response) => void) | undefined;
const mockApi = {
  mode: 'live',
  setOnSessionExpired: jest.fn(),
};

jest.mock('../../src/api/client', () => ({ get apiClient() { return mockApi; }, campusApi: {} }));
jest.mock('../../src/auth/mobile-session-store', () => ({ get sessionStore() { return mockStore; } }));
jest.mock('../../src/hooks/query-cache', () => ({ clearQueryCache: jest.fn(), queryCacheIdentity: jest.fn(), syncQueryCacheIdentity: jest.fn() }));
jest.mock('../../src/config/lane-flags', () => ({ LANE_FLAGS: {} }));
jest.mock('expo-font', () => ({ useFonts: () => [true, null] }));
jest.mock('expo-router', () => {
  const React = jest.requireActual('react') as typeof import('react');
  const { View } = jest.requireActual('react-native') as typeof import('react-native');
  return {
    Redirect: () => null,
    SplashScreen: { preventAutoHideAsync: jest.fn(async () => {}), hideAsync: jest.fn(async () => {}) },
    Stack: () => React.createElement(View, { testID: 'protected-route-content' }),
    usePathname: () => '/courses',
  };
});
jest.mock('@expo-google-fonts/be-vietnam-pro/400Regular', () => ({ BeVietnamPro_400Regular: {} }));
jest.mock('@expo-google-fonts/be-vietnam-pro/500Medium', () => ({ BeVietnamPro_500Medium: {} }));
jest.mock('@expo-google-fonts/be-vietnam-pro/600SemiBold', () => ({ BeVietnamPro_600SemiBold: {} }));
jest.mock('@expo-google-fonts/be-vietnam-pro/700Bold', () => ({ BeVietnamPro_700Bold: {} }));
jest.mock('../../src/design/theme', () => ({
  ThemeProvider: ({ children }: { children: ReactNode }) => children,
  useTheme: () => ({ scheme: 'light', colors: { background: '#fff', primary: '#123', text: '#000' } }),
}));
jest.mock('../../src/i18n/locale-provider', () => ({
  LocaleProvider: ({ children }: { children: ReactNode }) => children,
  useLocale: () => ({ ready: true, locale: 'vi' }),
}));
jest.mock('../../src/components/ErrorBoundary', () => ({ ErrorBoundary: ({ children }: { children: ReactNode }) => children }));

import RootLayout from '../../app/_layout';

function accessToken() {
  const claims = { sub: 'account-a', roles: ['STUDENT'], exp: Math.floor(Date.now() / 1000) + 600 };
  return `e30.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.synthetic`;
}

beforeEach(() => {
  mockApi.mode = 'live';
  mockApi.setOnSessionExpired.mockClear();
  mockSecure = new Map([
    ['cu.install', JSON.stringify({ appInstanceId: 'install-a' })],
    ['cu.refresh', 'refresh-a'],
  ]);
  mockRequest = jest.fn(() => new Promise((resolve) => { releaseRefresh = resolve; }));
  releaseRefresh = undefined;
  mockStore = createSessionStore({
    issuer: 'https://issuer.test',
    fetchImpl: mockRequest as typeof fetch,
    getNetworkState: async () => ({ isConnected: true, isInternetReachable: true }),
    secure: {
      getItemAsync: async (key) => mockSecure.get(key) ?? null,
      setItemAsync: async (key, value) => { mockSecure.set(key, value); },
      deleteItemAsync: async (key) => { mockSecure.delete(key); },
    },
    sandbox: {
      getItem: async () => JSON.stringify({ appInstanceId: 'install-a' }),
      setItem: async () => {},
      removeItem: async () => {},
    },
  });
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, _listener) => ({ remove: jest.fn() }));
});

afterEach(async () => {
  if (releaseRefresh) {
    await act(async () => releaseRefresh!(new Response(JSON.stringify({ access_token: accessToken(), refresh_token: 'refresh-b' }))));
  }
  jest.restoreAllMocks();
});

test('boot shell stays visible while refresh is pending and reveals routes only after boot', async () => {
  await render(<RootLayout />);

  expect(screen.getByLabelText('Đang kiểm tra phiên đăng nhập…')).toBeOnTheScreen();
  expect(screen.queryByTestId('protected-route-content')).toBeNull();
  expect(mockRequest).toHaveBeenCalledTimes(1);

  await act(async () => {
    releaseRefresh!(new Response(JSON.stringify({ access_token: accessToken(), refresh_token: 'refresh-b' })));
  });

  expect(screen.getByTestId('protected-route-content')).toBeOnTheScreen();
});
