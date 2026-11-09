import { afterEach, describe, expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { TextInput } from 'react-native';
import type { ReactElement } from 'react';

const mockApi = { mode: 'live' as 'preview' | 'live' };

jest.mock('../../src/api/client', () => ({
  get apiClient() { return { mode: mockApi.mode }; },
  campusApi: {},
}));
jest.mock('../../src/screens/content/use-paged-list', () => ({
  usePagedList: () => ({
    items: [],
    total: 0,
    hasMore: false,
    loading: false,
    loadingMore: false,
    refreshing: false,
    error: null,
    warning: null,
    loadMoreError: null,
    errorStatus: null,
    loadMore: jest.fn(),
    refresh: jest.fn(),
    reload: jest.fn(async () => {}),
    patch: jest.fn(),
    preview: false,
  }),
}));
jest.mock('../../src/session/SessionContext', () => ({
  useSession: () => ({ kind: 'signedOut', role: 'student', capabilities: [] }),
}));
jest.mock('../../src/auth/oidc-session', () => ({
  signInWithOidc: jest.fn(async () => ({ kind: 'cancelled' })),
}));
jest.mock('../../src/auth/mobile-session-store', () => ({
  sessionStore: {
    issuer: 'http://issuer.test',
    sessionEpoch: jest.fn(() => 0),
    saveRefresh: jest.fn(async () => {}),
    setAccessToken: jest.fn(),
    bumpEpoch: jest.fn(),
  },
}));
jest.mock('expo-router', () => ({ useLocalSearchParams: () => ({}) }));
jest.mock('../../src/api/parity-api', () => ({
  parityApi: new Proxy({}, { get: () => jest.fn(async () => ({ items: [], hasMore: false })) }),
}));

import { ThemeProvider } from '../../src/design/theme';
import { LocaleProvider } from '../../src/i18n/locale-provider';
import type { MobileScreenProps } from '../../src/navigation/types';
import { AccountFrame } from '../../src/screens/account/AccountFrame';
import { SignInScreen } from '../../src/screens/auth/SignInScreen';
import { GuestHomeScreen } from '../../src/screens/guest/GuestHomeScreen';

const THEME_KEY = 'campusute.theme';
const navigation = { navigate: jest.fn() } as unknown as MobileScreenProps['navigation'];
const props = { navigation, role: 'student' } as MobileScreenProps;

function storageWith(setItem: jest.Mock<(_key: string, _value: string) => Promise<void>>) {
  return {
    getItem: jest.fn(async (_key: string): Promise<string | null> => null),
    setItem,
  };
}

function themed(ui: ReactElement, storage: ReturnType<typeof storageWith>) {
  return render(
    <ThemeProvider initialPreference="light" storage={storage}>
      <LocaleProvider initialLocale="vi">{ui}</LocaleProvider>
    </ThemeProvider>,
  );
}

afterEach(() => {
  mockApi.mode = 'live';
  jest.clearAllMocks();
});

describe('guest screens theme control', () => {
  const cases: Array<[string, (storage: ReturnType<typeof storageWith>) => Promise<unknown>]> = [
    ['guest landing', (storage) => themed(<GuestHomeScreen {...props} />, storage)],
    ['sign-in', (storage) => themed(<SignInScreen {...props} />, storage)],
    ['account frame', (storage) => themed(<AccountFrame title="Khôi phục"><TextInput /></AccountFrame>, storage)],
  ];

  test.each(cases)('%s header cycles the theme preference and persists it', async (_name, build) => {
    const setItem = jest.fn(async (_key: string, _value: string): Promise<void> => undefined);
    const storage = storageWith(setItem);
    await build(storage);

    const toggle = screen.getByRole('button', { name: 'Giao diện sáng, Chuyển sang giao diện tối' });
    await fireEvent.press(toggle);

    expect(setItem).toHaveBeenCalledWith(THEME_KEY, 'dark');
    expect(screen.getByRole('button', { name: 'Giao diện tối, Chuyển sang giao diện hệ thống' })).toBeOnTheScreen();
  });
});
