import { afterEach, describe, expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ReactElement } from 'react';

const mockContentQuery = {
  data: undefined as unknown,
  error: null as string | null,
  warning: null,
  isLoading: false,
  isStale: false,
  errorStatus: null,
  reload: jest.fn(async () => undefined),
  reloadData: jest.fn(async () => undefined),
  setData: jest.fn(),
};

jest.mock('../../src/screens/content/use-content-query', () => ({
  useContentQuery: () => mockContentQuery,
}));
jest.mock('../../src/screens/content/content-api', () => ({
  contentApi: {
    notifications: jest.fn(async () => ({ items: [], page: 0, limit: 5, hasMore: false })),
    markNotificationRead: jest.fn(async () => undefined),
  },
}));
jest.mock('../../src/api/client', () => ({
  apiClient: { mode: 'live' },
}));

import { NotificationPreview } from '../../src/components/NotificationPreview';
import { ThemeProvider } from '../../src/design/theme';
import { LocaleProvider } from '../../src/i18n/locale-provider';
import { shellMessages } from '../../src/i18n/shell-messages';

afterEach(() => {
  jest.clearAllMocks();
  mockContentQuery.data = undefined;
  mockContentQuery.error = null;
  mockContentQuery.isLoading = false;
});

function wrap(ui: ReactElement) {
  return (
    <ThemeProvider forcedScheme="light">
      <LocaleProvider initialLocale="vi">{ui}</LocaleProvider>
    </ThemeProvider>
  );
}

function rows(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `n-${index}`,
    title: `[THÔNG BÁO] Tiêu đề ${index}`,
    message: `Nội dung ${index}`,
    isRead: false,
    createdAt: '2026-11-09T01:00:00.000Z',
    link: '/dashboard/announcements',
  }));
}

const handlers = () => ({
  onClose: jest.fn(),
  onOpen: jest.fn(),
  onMarkedRead: jest.fn(),
  onNoticeBoard: jest.fn(),
  onOpenInbox: jest.fn(),
});

describe('header notification preview', () => {
  test('renders at most five unread rows and opens their target', async () => {
    mockContentQuery.data = rows(6);
    const props = handlers();
    await render(wrap(<NotificationPreview unreadCount={6} {...props} />));

    expect(screen.getByRole('header', { name: shellMessages.vi.notifications.title })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Tiêu đề 0' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Tiêu đề 4' })).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Tiêu đề 5' })).toBeNull();

    await fireEvent.press(screen.getByRole('button', { name: 'Tiêu đề 0' }));
    expect(props.onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 'n-0' }));
    await waitFor(() => expect(props.onMarkedRead).toHaveBeenCalledTimes(1));
  });

  test('offers the notice board and the inbox from the preview footer', async () => {
    mockContentQuery.data = rows(1);
    const props = handlers();
    await render(wrap(<NotificationPreview unreadCount={1} {...props} />));

    await fireEvent.press(screen.getByRole('button', { name: shellMessages.vi.notifications.noticeBoard }));
    expect(props.onNoticeBoard).toHaveBeenCalledTimes(1);
    await fireEvent.press(screen.getByRole('button', { name: shellMessages.vi.notifications.openInbox }));
    expect(props.onOpenInbox).toHaveBeenCalledTimes(1);
  });

  test('distinguishes loading, empty and failed loads', async () => {
    const props = handlers();
    mockContentQuery.isLoading = true;
    const view = await render(wrap(<NotificationPreview unreadCount={0} {...props} />));
    expect(screen.getByText(shellMessages.vi.notifications.loading)).toBeOnTheScreen();

    mockContentQuery.isLoading = false;
    mockContentQuery.data = [];
    await view.rerender(wrap(<NotificationPreview unreadCount={0} {...props} />));
    expect(screen.getByText(shellMessages.vi.notifications.empty)).toBeOnTheScreen();

    mockContentQuery.error = shellMessages.vi.notifications.loadFailed;
    await view.rerender(wrap(<NotificationPreview unreadCount={0} {...props} />));
    expect(screen.getByText(shellMessages.vi.notifications.loadFailed)).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: shellMessages.vi.notifications.retry }));
    expect(mockContentQuery.reload).toHaveBeenCalledTimes(1);
  });
});
