import { afterEach, describe, expect, jest, test } from '@jest/globals';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Dimensions, Linking } from 'react-native';
import type { ReactElement } from 'react';

import { ThemeProvider } from '../../src/design/theme';

const mockSession = {
  value: { kind: 'authenticated', role: 'student', capabilities: [] as string[] } as {
    kind: string; role: string; capabilities: string[];
  },
};
const mockQuery = {
  value: {
    data: undefined as unknown,
    warning: null as string | null,
    error: null as string | null,
    errorStatus: null as number | null,
  },
};
const mockUnreadQuery = {
  data: 1 as number | undefined,
  error: null as string | null,
};
const mockReload = jest.fn(async () => {});

jest.mock('../../src/api/client', () => ({
  apiClient: { mode: 'live', baseUrl: 'http://localhost' },
  campusApi: {
    markNotificationRead: jest.fn(async () => ({})),
    markAllNotificationsRead: jest.fn(async () => ({})),
  },
  ApiClientError: class ApiClientError extends Error {},
}));
jest.mock('../../src/screens/content/content-api', () => ({
  contentApi: {
    notifications: jest.fn(),
    unreadCount: jest.fn(),
    markNotificationRead: jest.fn(async () => ({})),
    markAllNotificationsRead: jest.fn(async () => ({})),
    deleteNotification: jest.fn(async () => ({})),
  },
}));
const mockPushOptIn = { value: false };
const mockPushPermission = {
  value: { granted: false, canAskAgain: true } as { granted: boolean; canAskAgain?: boolean },
};
jest.mock('../../src/config/features', () => ({
  get PUSH_OPT_IN_ENABLED() { return mockPushOptIn.value; },
}));
jest.mock('../../src/api/expo-push-platform', () => ({
  expoPushPlatform: {
    provider: 'EXPO',
    platform: 'ANDROID',
    getInstallationId: jest.fn(async () => 'install-1'),
    getPermissionsAsync: jest.fn(async () => mockPushPermission.value),
    requestPermissionsAsync: jest.fn(async () => mockPushPermission.value),
    getPushToken: jest.fn(async () => 'token-1'),
  },
}));
jest.mock('../../src/session/SessionContext', () => ({ useSession: () => mockSession.value }));
jest.mock('../../src/hooks/useScreenQuery', () => ({
  useScreenQuery: (key: string) => {
    if (key === 'content.notifications.unread-count') {
      return {
        data: mockUnreadQuery.data,
        error: mockUnreadQuery.error,
        warning: null,
        errorStatus: null,
        isLoading: false,
        isStale: false,
        reload: mockReload,
        setData: jest.fn(),
      };
    }
    return {
      data: mockQuery.value.data,
      error: mockQuery.value.error,
      warning: mockQuery.value.warning,
      errorStatus: mockQuery.value.errorStatus,
      isLoading: false,
      isStale: false,
      reload: mockReload,
      setData: jest.fn(),
    };
  },
}));

import * as queryCache from '../../src/hooks/query-cache';
import { contentApi } from '../../src/screens/content/content-api';
import { expoPushPlatform } from '../../src/api/expo-push-platform';
import { NotificationsScreen } from '../../src/screens/student/NotificationsScreen';
import { checkinMessages } from '../../src/i18n/checkin-messages';
import { contentMessages } from '../../src/i18n/content-messages';
import { uiMessages } from '../../src/i18n/locale';
import { notificationsCenterMessages } from '../../src/i18n/notifications-center-messages';
import { notificationsMessages } from '../../src/i18n/notifications-messages';
import { recordsMessages } from '../../src/i18n/records-messages';
import type { MobileScreenProps } from '../../src/navigation/types';

const navigate = jest.fn();
const navigateLane = jest.fn();
const navigation = { navigate, navigateLane, signOut: jest.fn() } as unknown as MobileScreenProps['navigation'];
const props = { navigation, role: 'student' } as MobileScreenProps;
const renderThemed = (element: ReactElement) => render(<ThemeProvider forcedScheme="light">{element}</ThemeProvider>);

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function setWidth(width: number) {
  jest.spyOn(Dimensions, 'get').mockReturnValue({ width, height: 800, scale: 2, fontScale: 1 } as ReturnType<typeof Dimensions.get>);
}

const row = (id: string, title: string, link: unknown, isRead = false) => ({
  id, title, message: `${title} message`, isRead, createdAt: '2026-10-28T08:00:00Z', link, type: 'INFO',
});

function showRows(items: unknown[], extra: Partial<typeof mockQuery.value> = {}) {
  mockQuery.value = { data: { items, total: items.length, hasMore: false }, warning: null, error: null, errorStatus: null, ...extra };
}

afterEach(() => {
  jest.clearAllMocks();
  jest.restoreAllMocks();
  mockSession.value = { kind: 'authenticated', role: 'student', capabilities: [] };
  mockQuery.value = { data: undefined, warning: null, error: null, errorStatus: null };
  mockPushOptIn.value = false;
  mockPushPermission.value = { granted: false, canAskAgain: true };
  mockUnreadQuery.data = 1;
  mockUnreadQuery.error = null;
  mockReload.mockClear();
});

/** The row's own button, not its delete button (whose label repeats the title). */
function rowButton(title: string) {
  const found = screen.getAllByRole('button', { name: new RegExp(title) })
    .filter((element) => !String(element.props.accessibilityLabel ?? '').startsWith(recordsMessages.vi.deleteNotification));
  expect(found).toHaveLength(1);
  return found[0];
}

const vi = {
  openFailed: notificationsMessages.vi.openFailed,
  offlineReadOnly: notificationsCenterMessages.vi.offlineReadOnly,
  deleteNotification: recordsMessages.vi.deleteNotification,
  markAllRead: recordsMessages.vi.markAllRead,
};

describe('notifications centre opens only allowlisted routes', () => {
  test('an unreachable notification list shows retry and renders after a successful read', async () => {
    mockQuery.value = {
      data: undefined,
      warning: null,
      error: contentMessages.vi.generic,
      errorStatus: 0,
    };
    const view = await renderThemed(<NotificationsScreen {...props} />);

    expect(screen.getByText(contentMessages.vi.generic)).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: uiMessages.vi.retry }));
    expect(mockReload).toHaveBeenCalledTimes(1);

    showRows([row('recovered-notification', 'Recovered notification', null)]);
    await view.rerender(<ThemeProvider forcedScheme="light"><NotificationsScreen {...props} /></ThemeProvider>);
    expect(screen.getByText('Recovered notification')).toBeOnTheScreen();
    expect(screen.queryByText(contentMessages.vi.generic)).toBeNull();
  });

  test('notification titles strip only leading transport tags in content and accessibility labels', async () => {
    const cases = [
      ['[Announcement] Cập nhật quy định', 'Cập nhật quy định'],
      ['Tiêu đề bình thường', 'Tiêu đề bình thường'],
      ['[Announcement]', '[Announcement]'],
      ['[aNnOuNcEmEnT] Thông báo hỗn hợp', 'Thông báo hỗn hợp'],
      ['[THÔNG BÁO] Lịch học mới', 'Lịch học mới'],
      ['See announcement in this sentence', 'See announcement in this sentence'],
    ] as const;
    const items = cases.map(([title], index) => ({
      ...row(`title-${index}`, title, null),
      message: 'Nội dung thông báo',
    }));
    showRows(items);
    await renderThemed(<NotificationsScreen {...props} />);

    for (const [original, expected] of cases) {
      expect(screen.getByText(expected)).toBeOnTheScreen();
      const row = screen.getAllByRole('button').find((element) =>
        !String(element.props.accessibilityLabel ?? '').startsWith(`${vi.deleteNotification}:`)
        && String(element.props.accessibilityLabel ?? '').includes(expected),
      );
      expect(row).toBeDefined();
      expect(row?.props.accessibilityLabel).toContain(expected);
      expect(screen.getByRole('button', { name: `${vi.deleteNotification}: ${expected}` })).toBeOnTheScreen();
      if (original !== expected) expect(screen.queryByText(original)).toBeNull();
    }
    expect(items.map((item) => item.title)).toEqual(cases.map(([original]) => original));
    await fireEvent.press(screen.getByRole('button', { name: `${vi.deleteNotification}: Cập nhật quy định` }));
    expect(screen.queryByText('[Announcement] Cập nhật quy định')).toBeNull();
  });

  test('optimistic mark-read rolls back the visible row after a rejected write', async () => {
    let reject!: (error: unknown) => void;
    jest.mocked(contentApi.markNotificationRead).mockImplementationOnce(() => new Promise((_yes, no) => { reject = no; }));
    showRows([row('rollback-read', 'Rollback read', null)]);
    await renderThemed(<NotificationsScreen {...props} />);
    expect(rowButton('Rollback read').props.accessibilityLabel).toContain(recordsMessages.vi.unread);
    await fireEvent.press(rowButton('Rollback read'));
    expect(rowButton('Rollback read').props.accessibilityLabel).not.toContain(recordsMessages.vi.unread);
    await act(async () => reject(new Error('write rejected')));
    expect(rowButton('Rollback read').props.accessibilityLabel).toContain(recordsMessages.vi.unread);
  });

  test('two rapid mark-read actions send one request', async () => {
    let resolve!: (value: Awaited<ReturnType<typeof contentApi.markNotificationRead>>) => void;
    jest.mocked(contentApi.markNotificationRead).mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    showRows([row('single-read', 'Read once', null)]);
    await renderThemed(<NotificationsScreen {...props} />);

    const action = rowButton('Read once');
    await act(async () => {
      await fireEvent.press(action);
      await fireEvent.press(action);
    });

    expect(contentApi.markNotificationRead).toHaveBeenCalledTimes(1);
    expect(contentApi.markNotificationRead).toHaveBeenCalledWith('single-read');
    await act(async () => resolve({}));
  });

  test('optimistic delete restores the row on rejection', async () => {
    let reject!: (error: unknown) => void;
    jest.mocked(contentApi.deleteNotification).mockImplementationOnce(() => new Promise((_yes, no) => { reject = no; }));
    showRows([row('rollback-delete', 'Rollback delete', null)]);
    await renderThemed(<NotificationsScreen {...props} />);
    await fireEvent.press(screen.getByRole('button', { name: `${recordsMessages.vi.deleteNotification}: Rollback delete` }));
    await fireEvent.press(screen.getByRole('button', { name: new RegExp(`^${recordsMessages.vi.deleteNotification}$`) }));
    expect(screen.queryByText('Rollback delete')).toBeNull();
    await act(async () => reject(new Error('write rejected')));
    expect(screen.getByText('Rollback delete')).toBeOnTheScreen();
  });

  test('a producer link opens its mapped screen and marks the row read', async () => {
    setWidth(360);
    showRows([row('n1', 'Điểm đã công bố', '/dashboard/transcript')]);
    await renderThemed(<NotificationsScreen {...props} />);
    await fireEvent.press(rowButton('Điểm đã công bố'));
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith('transcript', undefined);
    await waitFor(() => expect(contentApi.markNotificationRead).toHaveBeenCalledWith('n1'));
  });

  test('seeded lecturer notifications open their matching screens without a refusal', async () => {
    setWidth(360);
    mockSession.value = { kind: 'authenticated', role: 'lecturer', capabilities: [] };
    showRows([
      { ...row('lecturer-gradebook', 'Kỳ nhập điểm giữa kỳ đang mở', '/vi/dashboard/lecturer/grades'), type: 'ACADEMIC' },
      { ...row('lecturer-roster', 'Danh sách lớp có cập nhật', '/vi/dashboard/lecturer'), type: 'REGISTRATION' },
      { ...row('lecturer-training', 'Lịch tập huấn cổng học vụ', '/vi/dashboard/lecturer', true), type: 'EVENT' },
    ]);
    await renderThemed(<NotificationsScreen {...props} role="lecturer" />);

    await fireEvent.press(rowButton('Kỳ nhập điểm giữa kỳ đang mở'));
    await fireEvent.press(rowButton('Danh sách lớp có cập nhật'));
    await fireEvent.press(rowButton('Lịch tập huấn cổng học vụ'));

    expect(navigate).toHaveBeenNthCalledWith(1, 'lecturer.grading', undefined);
    expect(navigate).toHaveBeenNthCalledWith(2, 'lecturer.dashboard', undefined);
    expect(navigate).toHaveBeenNthCalledWith(3, 'lecturer.dashboard', undefined);
    expect(navigateLane).not.toHaveBeenCalled();
    expect(screen.queryByText(vi.openFailed)).toBeNull();
  });

  test('the unread count reaches the shared cache even when the screen is already gone', async () => {
    setWidth(360);
    showRows([row('n1', 'Điểm đã công bố', '/dashboard/transcript')]);
    jest.mocked(contentApi.unreadCount).mockResolvedValue(4);
    const write = jest.spyOn(queryCache, 'writeQueryCache');
    await renderThemed(<NotificationsScreen {...props} />);
    await fireEvent.press(rowButton('Điểm đã công bố'));
    await waitFor(() => expect(write).toHaveBeenCalledWith(
      expect.stringContaining('content.notifications.unread-count'), 4));
    expect(mockReload).not.toHaveBeenCalled();
  });

  test.each([
    ['unknown portal path', '/dashboard/unknown'],
    ['oidc callback', 'campuscore://auth/callback'],
    ['traversal', '/../admin/audit'],
    ['foreign scheme', 'https://evil.example/transcript'],
    ['lane without a grant', '/admin/audit'],
    ['web-only destination', '/dashboard/lecturer/thesis'],
  ])('%s is refused: nothing opens and the row says so', async (_name, link) => {
    setWidth(360);
    showRows([row('n2', 'Thông báo lạ', link)]);
    await renderThemed(<NotificationsScreen {...props} />);
    await fireEvent.press(rowButton('Thông báo lạ'));
    expect(navigate).not.toHaveBeenCalled();
    expect(navigateLane).not.toHaveBeenCalled();
    expect(await screen.findByText(vi.openFailed)).toBeOnTheScreen();
  });

  test('a granted lane opens through the lane entry, never the plain navigator', async () => {
    setWidth(360);
    mockSession.value = { kind: 'authenticated', role: 'admin', capabilities: ['admin.oversight'] };
    showRows([row('n3', 'Kiểm toán', '/admin/audit', true)]);
    await renderThemed(<NotificationsScreen {...props} role="admin" />);
    await fireEvent.press(rowButton('Kiểm toán'));
    expect(navigateLane).toHaveBeenCalledWith('admin.audit');
    expect(navigate).not.toHaveBeenCalled();
  });

  test('a row without a target only marks read, and a read row without a target is inert', async () => {
    setWidth(360);
    showRows([row('n4', 'Việc chưa xử lý', null), row('n5', 'Việc đã xong', undefined, true)]);
    await renderThemed(<NotificationsScreen {...props} />);
    await fireEvent.press(rowButton('Việc chưa xử lý'));
    await waitFor(() => expect(contentApi.markNotificationRead).toHaveBeenCalledWith('n4'));
    expect(navigate).not.toHaveBeenCalled();
    await fireEvent.press(rowButton('Việc đã xong'));
    expect(contentApi.markNotificationRead).toHaveBeenCalledTimes(1);
  });

  test('a signed-out session opens nothing', async () => {
    setWidth(360);
    mockSession.value = { kind: 'signedOut', role: 'student', capabilities: [] };
    showRows([row('n6', 'Điểm đã công bố', '/dashboard/transcript', true)]);
    await renderThemed(<NotificationsScreen {...props} />);
    await fireEvent.press(rowButton('Điểm đã công bố'));
    expect(navigate).not.toHaveBeenCalled();
  });
});

describe('notifications centre offline', () => {
  test('cached rows stay readable with an offline notice; every mutation is blocked', async () => {
    setWidth(360);
    showRows(
      [row('n7', 'Đã tải', '/dashboard/transcript'), row('n8', 'Không có đích', null)],
      { warning: contentMessages.vi.offline, errorStatus: 0 },
    );
    await renderThemed(<NotificationsScreen {...props} />);
    expect(screen.getByText('Đã tải')).toBeOnTheScreen();
    expect(screen.getByText(contentMessages.vi.offline)).toBeOnTheScreen();
    expect(screen.getByText(vi.offlineReadOnly)).toBeOnTheScreen();

    expect(screen.getByRole('button', { name: vi.markAllRead })).toBeDisabled();
    for (const button of screen.getAllByRole('button', { name: new RegExp(`^${vi.deleteNotification}`) })) {
      expect(button).toBeDisabled();
    }
    // A row with no target would only mutate, so it is inert offline.
    expect(rowButton('Không có đích')).toBeDisabled();
    await fireEvent.press(rowButton('Không có đích'));

    // Opening a cached row is local navigation and still works, without a write.
    await fireEvent.press(rowButton('Đã tải'));
    expect(navigate).toHaveBeenCalledWith('transcript', undefined);
    expect(contentApi.markNotificationRead).not.toHaveBeenCalled();
    expect(contentApi.markAllNotificationsRead).not.toHaveBeenCalled();
    expect(contentApi.deleteNotification).not.toHaveBeenCalled();
  });

  test('online shows no offline notice and keeps the controls enabled', async () => {
    setWidth(360);
    showRows([row('n9', 'Bình thường', null)]);
    await renderThemed(<NotificationsScreen {...props} />);
    expect(screen.queryByText(vi.offlineReadOnly)).toBeNull();
    expect(screen.getByRole('button', { name: vi.markAllRead })).toBeEnabled();
  });

  test('copy keys match in both locales', () => {
    expect(notificationsCenterMessages.en.offlineReadOnly).toMatch(/offline/i);
    expect(Object.keys(notificationsCenterMessages.en)).toEqual(Object.keys(notificationsCenterMessages.vi));
  });
});

describe('push opt-in denial recovery', () => {
  function showOptIn(permission: { granted: boolean; canAskAgain?: boolean }) {
    mockPushOptIn.value = true;
    mockPushPermission.value = permission;
    showRows([]);
  }

  test('the opt-in card stays hidden while the feature flag is off', async () => {
    showRows([]);
    await renderThemed(<NotificationsScreen {...props} />);
    expect(screen.queryByRole('button', { name: notificationsMessages.vi.enableAction })).toBeNull();
  });

  test('double-tapping push opt-in starts one permission flow', async () => {
    showOptIn({ granted: false, canAskAgain: true });
    const permission = deferred<{ granted: boolean; canAskAgain?: boolean }>();
    jest.mocked(expoPushPlatform.requestPermissionsAsync).mockReturnValue(permission.promise);
    await renderThemed(<NotificationsScreen {...props} />);
    const button = screen.getByRole('button', { name: notificationsMessages.vi.enableAction });
    try {
      await fireEvent.press(button);
      await waitFor(() => expect(jest.mocked(expoPushPlatform.requestPermissionsAsync)).toHaveBeenCalledTimes(1));
      await fireEvent.press(screen.getByRole('button', { name: notificationsMessages.vi.enableAction }));

      expect(jest.mocked(expoPushPlatform.requestPermissionsAsync)).toHaveBeenCalledTimes(1);
      expect(screen.getByRole('button', { name: notificationsMessages.vi.enableAction })).toBeDisabled();

      await act(async () => {
        permission.resolve({ granted: false, canAskAgain: true });
        await permission.promise;
      });
      expect(await screen.findByText(notificationsMessages.vi.permissionDenied)).toBeOnTheScreen();
    } finally {
      await act(async () => {
        permission.resolve({ granted: false, canAskAgain: true });
        await permission.promise;
      });
      jest.mocked(expoPushPlatform.requestPermissionsAsync).mockImplementation(async () => mockPushPermission.value);
    }
  });

  test('a denial the OS will still prompt for offers a retry, and a final denial swaps to settings', async () => {
    showOptIn({ granted: false, canAskAgain: true });
    await renderThemed(<NotificationsScreen {...props} />);
    await fireEvent.press(screen.getByRole('button', { name: notificationsMessages.vi.enableAction }));
    expect(await screen.findByText(notificationsMessages.vi.permissionDenied)).toBeOnTheScreen();
    expect(jest.mocked(expoPushPlatform.requestPermissionsAsync)).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: checkinMessages.vi.openSettings })).toBeNull();

    // The second denial comes back final: retry disappears, no prompt is re-issued.
    mockPushPermission.value = { granted: false, canAskAgain: false };
    await fireEvent.press(screen.getByRole('button', { name: uiMessages.vi.retry }));
    expect(await screen.findByRole('button', { name: checkinMessages.vi.openSettings })).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: uiMessages.vi.retry })).toBeNull();
    expect(jest.mocked(expoPushPlatform.requestPermissionsAsync)).toHaveBeenCalledTimes(1);
  });

  test('a blocked denial offers settings, and a rejected open stays honestly denied', async () => {
    showOptIn({ granted: false, canAskAgain: false });
    const openSettings = jest.spyOn(Linking, 'openSettings').mockRejectedValue(new Error('no settings handler'));
    await renderThemed(<NotificationsScreen {...props} />);
    await fireEvent.press(screen.getByRole('button', { name: notificationsMessages.vi.enableAction }));
    expect(await screen.findByText(notificationsMessages.vi.permissionDenied)).toBeOnTheScreen();
    expect(jest.mocked(expoPushPlatform.requestPermissionsAsync)).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: uiMessages.vi.retry })).toBeNull();

    await fireEvent.press(screen.getByRole('button', { name: checkinMessages.vi.openSettings }));
    expect(openSettings).toHaveBeenCalledTimes(1);
    // The rejection is not hidden and nothing pretends the grant succeeded.
    expect(screen.getByText(notificationsMessages.vi.permissionDenied)).toBeOnTheScreen();
    expect(jest.mocked(expoPushPlatform.getPushToken)).not.toHaveBeenCalled();
  });

  test('displays an indeterminate unread count when unread-count query fails and list has more', async () => {
    mockUnreadQuery.data = undefined;
    mockUnreadQuery.error = '500 Internal Server Error';
    const items = Array.from({ length: 25 }, (_, i) => row(`id-${i}`, `Title ${i}`, null, false));
    showRows(items, { data: { items, total: 45, hasMore: true } });
    await renderThemed(<NotificationsScreen {...props} />);
    expect(screen.queryByText('25 chưa đọc')).toBeNull();
    expect(screen.getByText('25+ chưa đọc')).toBeOnTheScreen();
  });

  test('shows an unknown unread count when no unread rows are loaded but more pages exist', async () => {
    mockUnreadQuery.data = undefined;
    mockUnreadQuery.error = '500 Internal Server Error';
    showRows([row('read-1', 'Read notice', null, true)], { data: { items: [row('read-1', 'Read notice', null, true)], total: 40, hasMore: true } });
    await renderThemed(<NotificationsScreen {...props} />);
    expect(screen.getByText('Số thông báo chưa đọc chưa xác định')).toBeOnTheScreen();
    expect(screen.queryByText('0+ chưa đọc')).toBeNull();
  });
});

describe('notifications centre parity', () => {
  test('the filter names all notifications and the page explains the inbox', async () => {
    showRows([row('n1', 'Thông báo chung', null)]);
    await renderThemed(<NotificationsScreen {...props} />);

    expect(screen.getByRole('tab', { name: recordsMessages.vi.tabAll })).toBeOnTheScreen();
    expect(screen.getByText(recordsMessages.vi.notificationsDescription)).toBeOnTheScreen();
  });

  test('an unread row offers mark as read and shows the read state afterwards', async () => {
    jest.mocked(contentApi.unreadCount).mockResolvedValue(0);
    showRows([row('mark-1', 'Cần đánh dấu', null)]);
    await renderThemed(<NotificationsScreen {...props} />);

    await fireEvent.press(screen.getByRole('button', { name: recordsMessages.vi.markRead }));
    await waitFor(() => expect(contentApi.markNotificationRead).toHaveBeenCalledWith('mark-1'));
    expect(await screen.findByText(recordsMessages.vi.read)).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: recordsMessages.vi.markRead })).toBeNull();
    expect(navigate).not.toHaveBeenCalled();
  });

  test('a read row states that it is read', async () => {
    showRows([row('read-1', 'Đã xử lý', null, true)]);
    await renderThemed(<NotificationsScreen {...props} />);

    expect(screen.getByText(recordsMessages.vi.read)).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: recordsMessages.vi.markRead })).toBeNull();
  });

  test('the empty inbox uses the web copy and opens the dashboard', async () => {
    showRows([]);
    await renderThemed(<NotificationsScreen {...props} />);

    expect(screen.getByText(recordsMessages.vi.notificationsEmpty)).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: recordsMessages.vi.openDashboard }));
    expect(navigate).toHaveBeenCalledWith('dashboard.student');
  });

  test('the empty unread filter uses the web copy and the same exit', async () => {
    showRows([]);
    await renderThemed(<NotificationsScreen {...props} />);

    await fireEvent.press(screen.getByRole('tab', { name: recordsMessages.vi.tabUnread }));
    expect(screen.getByText(recordsMessages.vi.notificationsUnreadEmpty)).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: recordsMessages.vi.openDashboard })).toBeOnTheScreen();
  });
});
