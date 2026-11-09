import { beforeEach, expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactElement } from 'react';

const mockPush = jest.fn();
const mockRedirect = jest.fn();
const mockSession = {
  kind: 'signedOut' as 'signedOut' | 'authenticated' | 'preview',
  role: 'student' as 'student' | 'lecturer' | 'admin',
  capabilities: [] as string[],
  signingOut: false,
  accountId: null as string | null,
};

jest.mock('expo-router', () => ({
  Redirect: ({ href }: { href: string }) => {
    mockRedirect(href);
    return null;
  },
  useRouter: () => ({
    push: mockPush,
    replace: jest.fn(),
    dismissAll: jest.fn(),
    canGoBack: jest.fn(() => false),
    back: jest.fn(),
  }),
}));
jest.mock('../../src/session/SessionContext', () => ({
  useSession: () => mockSession,
}));
// The public teasers read the anonymous feed; the route contract is unrelated.
jest.mock('../../src/screens/content/content-api', () => ({
  contentApi: { news: jest.fn(), docs: jest.fn() },
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

import Index from '../../app/index';
import { ThemeProvider } from '../../src/design/theme';
import { LocaleProvider } from '../../src/i18n/locale-provider';

const tree = (locale: 'vi' | 'en' = 'vi'): ReactElement => (
  <ThemeProvider forcedScheme="light">
    <LocaleProvider initialLocale={locale}>
      <Index />
    </LocaleProvider>
  </ThemeProvider>
);

beforeEach(() => {
  jest.clearAllMocks();
  mockSession.kind = 'signedOut';
  mockSession.role = 'student';
  mockSession.capabilities = [];
  mockSession.signingOut = false;
  mockSession.accountId = null;
});

test('a guest at / sees the landing instead of a redirect', async () => {
  await render(tree());

  expect(mockRedirect).not.toHaveBeenCalled();
  expect(screen.getByRole('header', { name: 'Cổng Thông Tin Đào Tạo & Học Vụ Trực Tuyến' })).toBeOnTheScreen();
  expect(screen.getByRole('header', { name: 'Trung tâm trường học' })).toBeOnTheScreen();
});

test('an authenticated session at / still lands on its role home', async () => {
  mockSession.kind = 'authenticated';
  mockSession.role = 'lecturer';

  await render(tree());

  expect(mockRedirect).toHaveBeenLastCalledWith('/lecturer/dashboard');
  expect(screen.queryByText('Cổng Thông Tin Đào Tạo & Học Vụ Trực Tuyến')).toBeNull();
});

test('the hero sign-in action opens /sign-in', async () => {
  await render(tree());

  await fireEvent.press(screen.getByRole('button', { name: 'Đăng nhập' }));

  expect(mockPush).toHaveBeenCalledWith('/sign-in');
});

test('a module card that needs a session sends the guest to /sign-in', async () => {
  await render(tree());

  expect(screen.getAllByText('Cần đăng nhập').length).toBeGreaterThan(0);
  await fireEvent.press(screen.getByTestId('guest-hub-dashboard'));

  expect(mockPush).toHaveBeenLastCalledWith('/sign-in');
});

test('a public module card opens its existing guest route', async () => {
  await render(tree());

  await fireEvent.press(screen.getByTestId('guest-hub-news'));

  expect(mockPush).toHaveBeenLastCalledWith('/news');
});

test('the English landing keeps the web hub wording', async () => {
  await render(tree('en'));

  expect(screen.getByRole('header', { name: 'Academic Portal & Student Management' })).toBeOnTheScreen();
  expect(screen.getByRole('header', { name: 'Campus hub' })).toBeOnTheScreen();
  expect(screen.getAllByText('Planned').length).toBeGreaterThan(0);
  expect(screen.getAllByText('Sign in required').length).toBeGreaterThan(0);
});
