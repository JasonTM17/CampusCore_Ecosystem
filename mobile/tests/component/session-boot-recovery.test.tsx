import { beforeEach, expect, jest, test } from '@jest/globals';
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';
import type { ReactNode } from 'react';

import { createSessionStore } from '../../src/auth/session-store';
import { SessionProvider, useSession } from '../../src/session/SessionContext';
import { ThemeProvider } from '../../src/design/theme';
import { LocaleProvider } from '../../src/i18n/locale-provider';
import { SignInScreen } from '../../src/screens/auth/SignInScreen';
import type { MobileScreenProps } from '../../src/navigation/types';

let mockStore: ReturnType<typeof createSessionStore>;
let sessionExpiredHandler: (() => void) | undefined;
const mockApi = {
  mode: 'live',
  setOnSessionExpired: jest.fn((handler?: () => void) => { sessionExpiredHandler = handler; }),
};
jest.mock('../../src/api/client', () => ({ get apiClient() { return mockApi; }, campusApi: {} }));
jest.mock('../../src/auth/mobile-session-store', () => ({ get sessionStore() { return mockStore; } }));
jest.mock('../../src/auth/oidc-session', () => jest.requireActual('../../src/auth/oidc-core'));
jest.mock('../../src/hooks/query-cache', () => ({ clearQueryCache: jest.fn(), queryCacheIdentity: jest.fn(), syncQueryCacheIdentity: jest.fn() }));
jest.mock('../../src/config/lane-flags', () => ({ LANE_FLAGS: {} }));
jest.mock('../../src/hooks/useScreenQuery', () => ({ useScreenQuery: () => ({ data: undefined, error: null, warning: null, isLoading: false, errorStatus: null, reload: jest.fn(), setData: jest.fn() }) }));
jest.mock('expo-router', () => ({ useLocalSearchParams: () => ({}) }));

const wrapper = ({ children }: { children: ReactNode }) => <SessionProvider>{children}</SessionProvider>;
let foreground: (state: AppStateStatus) => void;
let request: jest.Mock<(...args: unknown[]) => Promise<Response>>;
let secure: Map<string, string>;
let connectivity: { isConnected?: boolean; isInternetReachable?: boolean };

function access(claims: Record<string, unknown> = {}) {
  return `e30.${Buffer.from(JSON.stringify({ sub: 'account', roles: ['STUDENT'], exp: Math.floor(Date.now() / 1000) + 600, ...claims })).toString('base64url')}.synthetic`;
}

beforeEach(() => {
  jest.restoreAllMocks();
  mockApi.mode = 'live';
  mockApi.setOnSessionExpired.mockClear();
  sessionExpiredHandler = undefined;
  secure = new Map([['cu.install', JSON.stringify({ appInstanceId: 'install' })], ['cu.refresh', 'synthetic-refresh']]);
  request = jest.fn(async () => new Response('{}', { status: 503 }));
  connectivity = {};
  mockStore = createSessionStore({
    issuer: 'https://issuer.test', fetchImpl: request as typeof fetch,
    getNetworkState: async () => connectivity,
    secure: {
      getItemAsync: async (key) => secure.get(key) ?? null,
      setItemAsync: async (key, value) => { secure.set(key, value); },
      deleteItemAsync: async (key) => { secure.delete(key); },
    },
    sandbox: { getItem: async () => JSON.stringify({ appInstanceId: 'install' }), setItem: async () => {}, removeItem: async () => {} },
  });
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
    foreground = listener;
    return { remove: jest.fn() };
  });
});

test('offline cold start stays retryable and foreground recovery restores the saved session', async () => {
  connectivity = { isConnected: false };
  const { result } = await renderHook(useSession, { wrapper });
  expect(result.current.bootStatus).toBe('unavailable');
  expect(result.current.bootUnavailableReason).toBe('offline');
  expect(result.current.accountId).toBeNull();
  expect(request).not.toHaveBeenCalled();
  expect(secure.get('cu.refresh')).toBe('synthetic-refresh');

  request.mockResolvedValueOnce(new Response(JSON.stringify({ access_token: access(), refresh_token: 'synthetic-rotation' })));
  connectivity = { isConnected: true, isInternetReachable: true };
  await act(async () => { foreground('active'); });
  expect(result.current.kind).toBe('authenticated');
  expect(result.current.bootStatus).toBe('ready');
  expect(result.current.bootUnavailableReason).toBeUndefined();
  expect(request).toHaveBeenCalledTimes(1);
  expect(secure.get('cu.refresh')).toBe('synthetic-rotation');
});

test('the provider keeps children mounted while a boot refresh is pending', async () => {
  let release!: (response: Response) => void;
  request.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
  const probe = jest.fn(() => null);
  const { result } = await renderHook(() => {
    probe();
    return useSession();
  }, { wrapper });
  expect(probe).toHaveBeenCalled();
  expect(result.current.booted).toBe(false);
  await act(async () => {
    release(new Response(JSON.stringify({ access_token: access(), refresh_token: 'synthetic-rotation' })));
  });
  expect(result.current.booted).toBe(true);
});

test('a lost boot refresh requires sign-in and cannot be retried with the old token', async () => {
  request.mockRejectedValueOnce(new TypeError('offline'));
  const { result } = await renderHook(useSession, { wrapper });
  expect(result.current.kind).toBe('signedOut');
  expect(result.current.bootStatus).toBe('reauthRequired');
  expect(result.current.accountId).toBeNull();
  expect(secure.has('cu.refresh')).toBe(false);
  expect(mockStore.getAccessToken()).toBeNull();
  await act(async () => { foreground('active'); await result.current.retryBoot!(); });
  expect(request).toHaveBeenCalledTimes(1);
});

test('manual retries share a pre-dispatch bootstrap recovery', async () => {
  jest.spyOn(mockStore, 'loadBootstrap').mockRejectedValueOnce(new Error('storage unavailable'));
  const { result } = await renderHook(useSession, { wrapper });
  expect(result.current.bootStatus).toBe('unavailable');
  expect(request).not.toHaveBeenCalled();
  let release!: (response: Response) => void;
  request.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
  let first!: Promise<void>;
  let second!: Promise<void>;
  await act(async () => {
    first = result.current.retryBoot!();
    second = result.current.retryBoot!();
  });
  expect(request).toHaveBeenCalledTimes(1);
  await act(async () => {
    release(new Response(JSON.stringify({ access_token: access(), refresh_token: 'synthetic-rotation' })));
    await Promise.all([first, second]);
  });
  expect(result.current.kind).toBe('authenticated');
  expect(result.current.accountId).toBe('account');
  expect(result.current.bootStatus).toBe('ready');
  expect(request).toHaveBeenCalledTimes(1);
});

test('invalid grant ends bootstrap without a retry loop', async () => {
  request.mockResolvedValueOnce(new Response('{"error":"invalid_grant"}', { status: 400 }));
  const { result } = await renderHook(useSession, { wrapper });
  expect(result.current.kind).toBe('signedOut');
  expect(result.current.bootStatus).toBe('ready');
  expect(secure.has('cu.refresh')).toBe(false);
  await act(async () => { foreground('active'); await result.current.retryBoot!(); });
  expect(request).toHaveBeenCalledTimes(1);
});

test('boot quarantines a lost refresh response and disables manual and foreground retries', async () => {
  request.mockRejectedValueOnce(new TypeError('response lost'));
  const { result } = await renderHook(useSession, { wrapper });

  expect(result.current.kind).toBe('signedOut');
  expect(result.current.bootStatus).toBe('reauthRequired');
  expect(secure.has('cu.refresh')).toBe(false);
  await act(async () => foreground('active'));
  await act(async () => result.current.retryBoot!());
  expect(request).toHaveBeenCalledTimes(1);
});

test('boot without a refresh credential clears partial access state and remains signed out', async () => {
  secure.delete('cu.refresh');
  secure.set('cu.profile', JSON.stringify({ accountId: 'old-account' }));
  mockStore.setAccessToken(access());

  const { result } = await renderHook(useSession, { wrapper });

  expect(result.current.kind).toBe('signedOut');
  expect(result.current.accountId).toBeNull();
  expect(result.current.bootStatus).toBe('ready');
  expect(mockStore.getAccessToken()).toBeNull();
  expect(request).not.toHaveBeenCalled();
});

test('a definitive issuer rejection ends the session instead of retrying a dead grant', async () => {
  request.mockResolvedValueOnce(new Response('{}', { status: 401 }));
  const { result } = await renderHook(useSession, { wrapper });
  expect(result.current.kind).toBe('signedOut');
  expect(result.current.bootStatus).toBe('ready');
  expect(secure.has('cu.refresh')).toBe(false);
});

test('the shared terminal notification clears and fences the current session', async () => {
  request.mockResolvedValueOnce(new Response(JSON.stringify({
    access_token: access(),
    refresh_token: 'synthetic-rotation',
  })));
  const { result } = await renderHook(useSession, { wrapper });
  expect(result.current.kind).toBe('authenticated');
  const priorEpoch = mockStore.sessionEpoch();

  await act(async () => sessionExpiredHandler?.());

  expect(result.current.kind).toBe('signedOut');
  expect(result.current.bootStatus).toBe('reauthRequired');
  expect(mockStore.sessionEpoch()).toBe(priorEpoch + 1);
  expect(mockStore.getAccessToken()).toBeNull();
});

test.each([access({ exp: 1 }), access({ sub: null }), 'malformed-access'])('unusable access claims never authenticate bootstrap (%#)', async (token) => {
  request.mockResolvedValueOnce(new Response(JSON.stringify({ access_token: token, refresh_token: 'synthetic-rotation' })));
  const { result } = await renderHook(useSession, { wrapper });
  expect(result.current.kind).toBe('signedOut');
  expect(result.current.bootStatus).toBe('unavailable');
  expect(result.current.accountId).toBeNull();
  expect(mockStore.getAccessToken()).toBeNull();
  expect(secure.get('cu.refresh')).toBe('synthetic-rotation');
});

test('sign-out during boot retry fences the late result', async () => {
  jest.spyOn(mockStore, 'loadBootstrap').mockRejectedValueOnce(new Error('storage unavailable'));
  const { result } = await renderHook(useSession, { wrapper });
  let release!: (response: Response) => void;
  request.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
  let retry!: Promise<void>;
  await act(async () => { retry = result.current.retryBoot!(); });
  await act(async () => result.current.signOut());
  await act(async () => { release(new Response(JSON.stringify({ access_token: access() }))); await retry; });
  expect(result.current.kind).toBe('signedOut');
  expect(mockStore.getAccessToken()).toBeNull();
  expect(secure.has('cu.refresh')).toBe(false);
});

test('bootstrap storage errors become recoverable and preview does no storage work', async () => {
  const load = jest.spyOn(mockStore, 'loadBootstrap').mockRejectedValueOnce(new Error('storage unavailable'));
  const view = await renderHook(useSession, { wrapper });
  expect(view.result.current.bootStatus).toBe('unavailable');
  await view.unmount();
  mockApi.mode = 'preview';
  load.mockClear();
  const preview = await renderHook(useSession, { wrapper });
  expect(preview.result.current.bootStatus).toBe('ready');
  expect(load).not.toHaveBeenCalled();
});

test('sign-out ends local state before a paused disk wipe and cannot erase a new sign-in', async () => {
  request.mockResolvedValueOnce(new Response(JSON.stringify({ access_token: access() })));
  const { result } = await renderHook(useSession, { wrapper });
  let release!: () => void;
  const wipe = new Promise<void>((resolve) => { release = resolve; });
  jest.spyOn(mockStore, 'signOut').mockImplementationOnce(async () => {
    mockStore.bumpEpoch();
    mockStore.setAccessToken(null);
    await wipe;
  });
  let logout!: Promise<void>;
  await act(async () => { logout = result.current.signOut(); });
  expect(result.current.kind).toBe('signedOut');
  await act(async () => {
    mockStore.setAccessToken(access({ sub: 'new-account' }));
    result.current.completeSignIn('student', 'new-account');
  });
  await act(async () => { release(); await logout; });
  expect(result.current.kind).toBe('authenticated');
  expect(result.current.accountId).toBe('new-account');
});

test.each(['network', 'malformed'] as const)('foreground does not automatically repeat an ambiguous %s refresh', async (failure) => {
  if (failure === 'network') request.mockRejectedValueOnce(new TypeError('response lost'));
  else request.mockResolvedValueOnce(new Response('{"refresh_token":"synthetic-rotation"}'));
  const { result } = await renderHook(useSession, { wrapper });
  expect(result.current.bootStatus).toBe('reauthRequired');
  expect(secure.has('cu.refresh')).toBe(false);
  await act(async () => foreground('active'));
  await act(async () => result.current.retryBoot!());
  expect(result.current.kind).toBe('signedOut');
  expect(request).toHaveBeenCalledTimes(1);
});

test.each([['vi', 'Thử lại phiên'], ['en', 'Retry session']] as ['vi' | 'en', string][])('the %s sign-in screen exposes a bounded manual boot retry', async (locale, retryLabel) => {
  jest.spyOn(mockStore, 'loadBootstrap').mockRejectedValueOnce(new Error('storage unavailable'));
  const props = { navigation: { navigate: jest.fn() }, role: 'student', selectedThesisTopicId: null } as unknown as MobileScreenProps;
  await render(
    <ThemeProvider forcedScheme="light"><LocaleProvider initialLocale={locale}>
      <SessionProvider><SignInScreen {...props} /></SessionProvider>
    </LocaleProvider></ThemeProvider>,
  );
  let release!: (response: Response) => void;
  request.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
  await fireEvent.press(screen.getByRole('button', { name: retryLabel }));
  expect(screen.getByRole('button', { name: retryLabel })).toBeDisabled();
  expect(request).toHaveBeenCalledTimes(1);
  await act(async () => release(new Response(JSON.stringify({ access_token: access(), refresh_token: 'synthetic-rotation' }))));
  expect(screen.queryByRole('button', { name: retryLabel })).toBeNull();
});

test.each([
  ['vi', 'Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.'],
  ['en', 'Your session has expired. Sign in again.'],
] as ['vi' | 'en', string][])(`the %s sign-in screen explains why fresh authentication is required`, async (locale, reason) => {
  request.mockRejectedValueOnce(new TypeError('response lost'));
  const props = { navigation: { navigate: jest.fn() }, role: 'student', selectedThesisTopicId: null } as unknown as MobileScreenProps;

  await render(
    <ThemeProvider forcedScheme="light"><LocaleProvider initialLocale={locale}>
      <SessionProvider><SignInScreen {...props} /></SessionProvider>
    </LocaleProvider></ThemeProvider>,
  );

  expect(await screen.findByText(reason)).toBeTruthy();
  expect(screen.queryByRole('button', { name: locale === 'vi' ? 'Thử lại phiên' : 'Retry session' })).toBeNull();
  expect(secure.has('cu.refresh')).toBe(false);
});
