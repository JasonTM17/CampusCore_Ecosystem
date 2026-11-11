import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Dimensions, StyleSheet } from 'react-native';
import type { ReactElement } from 'react';

import { ThemeProvider } from '../../src/design/theme';

const mockFlags = { dean: false, staff: false, admin: false, checkin: false };
const mockSession: { kind: string; role: string; capabilities: string[] } = { kind: 'authenticated', role: 'admin', capabilities: [] };
const mockNavigation = { navigate: jest.fn(), navigateLane: jest.fn(), goBack: jest.fn() };

jest.mock('../../src/config/lane-flags', () => ({
  get LANE_FLAGS() { return mockFlags; },
}));
jest.mock('../../src/session/SessionContext', () => ({ useSession: () => mockSession }));
jest.mock('../../src/navigation/router-adapter', () => ({ useMobileNavigation: () => mockNavigation }));
jest.mock('expo-router', () => {
  const { useEffect } = require('react');
  return { useFocusEffect: (callback: () => void) => useEffect(callback, [callback]), useLocalSearchParams: () => ({}) };
});
jest.mock('../../src/screens/lanes/lane-api', () => ({
  LANE_PAGE_SIZE: 20,
  laneApi: {
    libraryRequests: jest.fn(),
    libraryApprove: jest.fn(),
    libraryCancel: jest.fn(),
    staffEvents: jest.fn(),
    eventRoster: jest.fn(),
    eventMark: jest.fn(),
    sendNotification: jest.fn(),
    notificationHistory: jest.fn(),
    searchNotificationRecipients: jest.fn(),
    enrollments: jest.fn(),
    creditApplications: jest.fn(),
    analytics: jest.fn(),
    thesisRounds: jest.fn(),
    deanOverview: jest.fn(),
  },
}));

import { laneApi } from '../../src/screens/lanes/lane-api';
import { AdminEnrollmentsScreen, AdminEventsScreen, AdminNotificationsScreen } from '../../src/screens/lanes/AdminLaneScreens';
import { Pager, QueueCard, statusTone } from '../../src/screens/lanes/lane-ui';
import { validateNotification } from '../../src/screens/lanes/lane-model';
import { LaneRoute } from '../../src/screens/lanes/lane-registry';
import { lanesMessages } from '../../src/i18n/lanes-messages';
import { LocaleProvider } from '../../src/i18n/locale-provider';

const api = laneApi as unknown as Record<string, jest.Mock<(...args: unknown[]) => Promise<unknown>>>;
const renderThemed = async (element: ReactElement) => render(<ThemeProvider forcedScheme="light">{element}</ThemeProvider>);
const renderEnglish = async (element: ReactElement) =>
  render(
    <LocaleProvider initialLocale="en">
      <ThemeProvider forcedScheme="light">{element}</ThemeProvider>
    </LocaleProvider>,
  );
const renderInLocale = async (element: ReactElement, locale: 'vi' | 'en') =>
  render(
    <LocaleProvider initialLocale={locale}>
      <ThemeProvider forcedScheme="light">{element}</ThemeProvider>
    </LocaleProvider>,
  );
const page = (items: unknown[]) => ({
  items,
  meta: { total: items.length, page: 1, limit: 20, totalPages: 1 },
  hasMore: false,
});

async function selectNotificationRecipient() {
  api.searchNotificationRecipients.mockResolvedValue({
    items: [{ id: 'student-user-1', firstName: 'An', lastName: 'Nguyen', email: 'student@example.edu' }],
    meta: { total: 1, page: 1, limit: 5, totalPages: 1 },
    hasMore: false,
  });
  await fireEvent.changeText(screen.getByLabelText('Search by name or email'), 'student');
  await fireEvent.press(screen.getByRole('button', { name: 'Search' }));
  const result = await screen.findByRole('button', { name: /Nguyen An.*student@example.edu/ });
  await fireEvent.press(result);
}

function setViewport(width: number, fontScale: number) {
  jest.spyOn(Dimensions, 'get').mockReturnValue({ width, height: 800, scale: 2, fontScale } as ReturnType<typeof Dimensions.get>);
}

beforeEach(() => {
  mockFlags.dean = false;
  mockFlags.staff = false;
  mockFlags.admin = false;
  mockFlags.checkin = false;
  mockSession.kind = 'authenticated';
  mockSession.role = 'admin';
  mockSession.capabilities = [];
  for (const fn of Object.values(api)) fn.mockReset();
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

describe('lane host fails closed', () => {
  test('flag off: shows the denied state and never calls the lane api', async () => {
    mockSession.capabilities = ['staff.libraryDesk'];
    await renderThemed(<LaneRoute id="staff.libraryDesk" />);
    expect(screen.getAllByText('Không có quyền truy cập').length).toBeGreaterThan(0);
    expect(api.libraryRequests).not.toHaveBeenCalled();
  });

  test('flag on without the grant: denied', async () => {
    mockFlags.staff = true;
    await renderThemed(<LaneRoute id="staff.libraryDesk" />);
    expect(screen.getAllByText('Không có quyền truy cập').length).toBeGreaterThan(0);
    expect(api.libraryRequests).not.toHaveBeenCalled();
  });

  test('preview session: denied even with flag and grant', async () => {
    mockFlags.staff = true;
    mockSession.kind = 'preview';
    mockSession.capabilities = ['staff.libraryDesk'];
    await renderThemed(<LaneRoute id="staff.libraryDesk" />);
    expect(screen.getAllByText('Không có quyền truy cập').length).toBeGreaterThan(0);
    expect(api.libraryRequests).not.toHaveBeenCalled();
  });
});

describe('library desk', () => {
  beforeEach(() => {
    mockFlags.staff = true;
    mockSession.capabilities = ['staff.libraryDesk'];
  });

  test('lists live requests with the actions the status allows and confirms before writing', async () => {
    api.libraryRequests.mockResolvedValue([{ id: 'r1', title: 'Giải tích', borrowerEmail: 'sv@x.edu', status: 'REQUESTED', version: 2 }]);
    api.libraryApprove.mockResolvedValue({});
    await renderThemed(<LaneRoute id="staff.libraryDesk" />);
    await waitFor(() => expect(screen.getByText('Giải tích')).toBeTruthy());
    // The library queue is still read whole: no page window and no pager control.
    expect(api.libraryRequests).toHaveBeenCalledWith(undefined);
    expect(screen.queryByText('Trang sau')).toBeNull();
    expect(screen.queryByText('Phát sách')).toBeNull();
    await fireEvent.press(screen.getByText('Duyệt'));
    expect(api.libraryApprove).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByText('Xác nhận'));
    await waitFor(() => expect(api.libraryApprove).toHaveBeenCalledTimes(1));
    expect((api.libraryApprove.mock.calls[0] as unknown[])[0]).toMatchObject({ id: 'r1', version: 2 });
  });

  test('a cancel needs a written reason before anything is sent', async () => {
    api.libraryRequests.mockResolvedValue([{ id: 'r1', title: 'Giải tích', status: 'REQUESTED', version: 1 }]);
    await renderThemed(<LaneRoute id="staff.libraryDesk" />);
    await waitFor(() => expect(screen.getByText('Giải tích')).toBeTruthy());
    await fireEvent.press(screen.getByText('Hủy đơn'));
    await fireEvent.press(screen.getByText('Xác nhận'));
    expect(screen.getByText('Cần nhập nội dung')).toBeTruthy();
    expect(api.libraryCancel).not.toHaveBeenCalled();
  });

  test('a denied read shows an error state with no rows', async () => {
    api.libraryRequests.mockRejectedValue({ status: 403 });
    await renderThemed(<LaneRoute id="staff.libraryDesk" />);
    await waitFor(() => expect(screen.getByText('Bạn không có quyền với nội dung này.')).toBeTruthy());
    expect(screen.queryByText('Giải tích')).toBeNull();
  });

  test('a resource 401 stays retryable and never claims an expired session', async () => {
    api.libraryRequests
      .mockRejectedValueOnce({ status: 401, code: 'HTTP_401' })
      .mockResolvedValueOnce([]);
    await renderThemed(<LaneRoute id="staff.libraryDesk" />);
    await waitFor(() => expect(screen.queryByText(lanesMessages.vi.signIn)).toBeNull());
    expect(screen.getAllByText(lanesMessages.vi.errorTitle).length).toBeGreaterThan(0);
    await fireEvent.press(screen.getByText(lanesMessages.vi.retry));
    await waitFor(() => expect(api.libraryRequests).toHaveBeenCalledTimes(2));
  });

  test('an empty queue shows the empty state', async () => {
    api.libraryRequests.mockResolvedValue([]);
    await renderThemed(<LaneRoute id="staff.libraryDesk" />);
    await waitFor(() => expect(screen.getByText('Không có mục nào')).toBeTruthy());
  });
});

describe('admin notifications', () => {
  beforeEach(() => {
    mockFlags.admin = true;
    mockSession.capabilities = ['admin.oversight'];
    api.notificationHistory.mockResolvedValue({ items: [], meta: { total: 0, page: 1, limit: 20, totalPages: 1 }, hasMore: false });
  });

  test('an invalid draft shows field errors and sends nothing', async () => {
    await renderInLocale(<LaneRoute id="admin.notifications" />, 'en');
    await waitFor(() => expect(screen.getByText('Preview')).toBeTruthy());
    await fireEvent.press(screen.getByText('Preview'));
    expect(screen.getByText('Select a recipient from the account list')).toBeTruthy();
    expect(api.sendNotification).not.toHaveBeenCalled();
  });

  test('notification recipients accept a directory id up to the server limit', () => {
    expect(validateNotification({ userId: 'student-user-1', title: 'Title', message: 'Message', type: 'INFO' })).toEqual([]);
    expect(validateNotification({ userId: 'x'.repeat(121), title: 'Title', message: 'Message', type: 'INFO' })).toContain('recipient');
  });

  test('a directory selection previews and sends its account id', async () => {
    api.sendNotification.mockResolvedValue({});
    await renderEnglish(<LaneRoute id="admin.notifications" />);
    await selectNotificationRecipient();
    await fireEvent.changeText(screen.getByLabelText('Title'), 'Schedule update');
    await fireEvent.changeText(screen.getByLabelText('Message'), 'Please check your schedule.');
    await fireEvent.press(screen.getByRole('button', { name: 'Preview' }));
    expect(await screen.findByText(/Sent to student-user-1/)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Send notification' }));
    await waitFor(() => expect(api.sendNotification).toHaveBeenCalledWith(expect.objectContaining({ userId: 'student-user-1' })));
  });

  test('free-text recipient input cannot preview or send without selecting a directory result', async () => {
    await renderEnglish(<LaneRoute id="admin.notifications" />);
    await fireEvent.changeText(screen.getByLabelText('Search by name or email'), 'student-user-1');
    await fireEvent.changeText(screen.getByLabelText('Title'), 'Schedule update');
    await fireEvent.changeText(screen.getByLabelText('Message'), 'Please check your schedule.');
    await fireEvent.press(screen.getByRole('button', { name: 'Preview' }));
    expect(screen.getByText('Select a recipient from the account list')).toBeTruthy();
    expect(screen.queryByText('Notification preview')).toBeNull();
    expect(api.sendNotification).not.toHaveBeenCalled();
    expect(api.searchNotificationRecipients).not.toHaveBeenCalled();
  });

  test('history failure keeps the compose fields visible with an inline retry', async () => {
    api.notificationHistory.mockRejectedValue({ status: 500 });
    await renderEnglish(<AdminNotificationsScreen />);
    expect(await screen.findByText(lanesMessages.en.errorTitle)).toBeTruthy();
    expect(screen.getByLabelText('Search by name or email')).toBeTruthy();
    expect(screen.getByLabelText('Title')).toBeTruthy();
    expect(screen.getByLabelText('Message')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });

  test('a network failure on send is reported as unknown and never retried', async () => {
    api.sendNotification.mockRejectedValue({ status: 0 });
    await renderEnglish(<LaneRoute id="admin.notifications" />);
    await selectNotificationRecipient();
    await fireEvent.changeText(screen.getByLabelText('Title'), 'Schedule update');
    await fireEvent.changeText(screen.getByLabelText('Message'), 'Please check your schedule.');
    await fireEvent.press(screen.getByRole('button', { name: 'Preview' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Send notification' }));
    await waitFor(() => expect(screen.getByText(lanesMessages.en.notifUnknown)).toBeTruthy());
    expect(api.sendNotification).toHaveBeenCalledTimes(1);
  });

  test('an unknown send reloads history and blocks a new send until resolved', async () => {
    api.sendNotification.mockRejectedValue({ status: 0 });
    await renderEnglish(<LaneRoute id="admin.notifications" />);
    expect(api.notificationHistory).toHaveBeenCalledTimes(1);
    await selectNotificationRecipient();
    await fireEvent.changeText(screen.getByLabelText('Title'), 'Schedule update');
    await fireEvent.changeText(screen.getByLabelText('Message'), 'Please check your schedule.');
    await fireEvent.press(screen.getByRole('button', { name: 'Preview' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Send notification' }));
    await waitFor(() => expect(screen.getByText(lanesMessages.en.notifUnknown)).toBeTruthy());
    // The history is refreshed so the admin can check whether the send landed.
    await waitFor(() => expect(api.notificationHistory).toHaveBeenCalledTimes(2));
    // No new send may start while the outcome is unresolved.
    const preview = screen.getByRole('button', { name: 'Preview' });
    expect(preview.props.accessibilityState?.disabled).toBe(true);
    await fireEvent.press(preview);
    expect(screen.queryByText('Notification preview')).toBeNull();
    // The explicit acknowledgement re-enables the preview, nothing retries itself.
    await fireEvent.press(screen.getByRole('button', { name: lanesMessages.en.notifCheckedHistory }));
    await fireEvent.press(screen.getByRole('button', { name: 'Preview' }));
    await waitFor(() => expect(screen.getByText('Notification preview')).toBeTruthy());
    expect(api.sendNotification).toHaveBeenCalledTimes(1);
  });

  test('a maximum-length preview scrolls while the send action stays pinned', async () => {
    const message = 'x'.repeat(2000);
    await renderEnglish(<LaneRoute id="admin.notifications" />);
    await selectNotificationRecipient();
    await fireEvent.changeText(screen.getByLabelText('Title'), 'Schedule update');
    await fireEvent.changeText(screen.getByLabelText('Message'), message);
    await fireEvent.press(screen.getByRole('button', { name: 'Preview' }));
    await waitFor(() => expect(screen.getByText('Notification preview')).toBeTruthy());
    // The long body scrolls inside the sheet's own container…
    const nearestScroll = (start: { parent: unknown; type: string }) => {
      let node: { parent: unknown; type: string } | null = start;
      while (node) {
        if (node.type.includes('ScrollView')) return node;
        node = node.parent as typeof node;
      }
      return null;
    };
    const bodyScroll = nearestScroll(screen.getByText(message));
    // …a different container than the one the pinned Back/Send actions sit in.
    const actionsScroll = nearestScroll(screen.getByRole('button', { name: 'Send notification' }));
    expect(bodyScroll).toBeTruthy();
    expect(actionsScroll).toBeTruthy();
    expect(bodyScroll).not.toBe(actionsScroll);
  });
});

describe('admin enrollment queue', () => {
  const confirmedRow = {
    id: 'enrollment-confirmed',
    status: 'CONFIRMED',
    student: { user: { firstName: 'An', lastName: 'Nguyễn' } },
    section: { sectionNumber: '01', course: { code: 'CS101', name: 'Canonical course', nameEn: 'Software Engineering', nameVi: 'Kỹ thuật phần mềm' } },
    semester: { name: 'Canonical term', nameEn: 'Fall 2026', nameVi: 'Học kỳ mùa thu 2026' },
  };

  beforeEach(() => {
    api.enrollments.mockResolvedValue(page([confirmedRow]));
  });

  test('confirmed rows and filter options are localized and use a success tone', async () => {
    for (const [locale, statusLabel, filterName] of [
      ['vi', 'Đã xác nhận', 'Trạng thái: Tất cả'],
      ['en', 'Confirmed', 'Status: All'],
    ] as const) {
      const view = await renderInLocale(<AdminEnrollmentsScreen />, locale);
      await waitFor(() => expect(screen.getByText(statusLabel)).toBeTruthy());
      expect(statusTone('CONFIRMED')).toBe('success');
      await fireEvent.press(screen.getByRole('button', { name: filterName }));
      expect(screen.getByRole('radio', { name: statusLabel })).toBeTruthy();
      await view.unmount();
    }
  });

  test('the enrollment search field sends a student code as search, not studentId', async () => {
    await renderThemed(<AdminEnrollmentsScreen />);
    await fireEvent.changeText(screen.getByLabelText('Mã sinh viên'), '21110123');
    await fireEvent.press(screen.getByRole('button', { name: 'Áp dụng' }));
    await waitFor(() => expect(api.enrollments).toHaveBeenLastCalledWith(
      expect.objectContaining({ search: '21110123' }),
      expect.objectContaining({ page: 1, limit: 20 }),
    ));
    expect((api.enrollments.mock.calls.at(-1)?.[0] as Record<string, unknown>).studentId).toBeUndefined();
  });

  test('course and semester names use the English payload fields', async () => {
    await renderEnglish(<AdminEnrollmentsScreen />);
    expect(await screen.findByText(/Software Engineering/)).toBeTruthy();
    expect(screen.getByText('Fall 2026')).toBeTruthy();
    expect(screen.queryByText('Canonical course')).toBeNull();
    expect(screen.queryByText('Canonical term')).toBeNull();
  });
});

describe('event time boundaries', () => {
  test('event actions and attendance controls update when an event starts', async () => {
    const base = Date.parse('2026-11-05T00:00:00.000Z');
    jest.useFakeTimers();
    jest.setSystemTime(base);
    api.staffEvents.mockResolvedValue([
      { id: 'draft-1', title: 'Draft briefing', status: 'DRAFT', startsAt: new Date(base + 1000).toISOString() },
      { id: 'event-1', title: 'Closed briefing', status: 'REGISTRATION_CLOSED', startsAt: new Date(base + 2000).toISOString() },
    ]);
    api.eventRoster.mockResolvedValue([
      { registrationId: 'registration-1', studentName: 'Lê Văn A', email: 'a@example.edu', attendanceStatus: 'ABSENT', version: 1 },
    ]);

    let unmount: (() => void) | undefined;
    try {
      const view = await renderThemed(<AdminEventsScreen />);
      unmount = view.unmount;
      await act(async () => { await Promise.resolve(); await Promise.resolve(); });
      expect(screen.getByText('Draft briefing')).toBeTruthy();
      expect(screen.getByRole('button', { name: lanesMessages.vi.publish })).toBeTruthy();

      await act(async () => { jest.advanceTimersByTime(1001); });
      expect(screen.queryByRole('button', { name: lanesMessages.vi.publish })).toBeNull();

      await fireEvent.press(screen.getAllByRole('button', { name: lanesMessages.vi.eventDetail })[1]);
      await act(async () => { await Promise.resolve(); await Promise.resolve(); });
      expect(screen.getByText('Lê Văn A')).toBeTruthy();
      expect(screen.queryByRole('button', { name: lanesMessages.vi.markAttended })).toBeNull();

      await act(async () => { jest.advanceTimersByTime(1000); });
      expect(screen.getByRole('button', { name: lanesMessages.vi.markAttended })).toBeTruthy();
    } finally {
      if (unmount) await act(() => { unmount?.(); });
      jest.clearAllTimers();
      jest.useRealTimers();
    }
  });

  test('an event far in the future never schedules an oversized timer', async () => {
    const base = Date.parse('2026-11-05T00:00:00.000Z');
    jest.useFakeTimers();
    jest.setSystemTime(base);
    const timeout = jest.spyOn(global, 'setTimeout');
    api.staffEvents.mockResolvedValue([
      { id: 'draft-far', title: 'Far briefing', status: 'DRAFT', startsAt: new Date(base + 60 * 24 * 3600 * 1000).toISOString() },
    ]);
    let unmount: (() => void) | undefined;
    try {
      const view = await renderThemed(<AdminEventsScreen />);
      unmount = view.unmount;
      await act(async () => { await Promise.resolve(); await Promise.resolve(); });
      expect(screen.getByText('Far briefing')).toBeTruthy();
      const delays = timeout.mock.calls.map((call) => Number(call[1] ?? 0));
      expect(Math.max(0, ...delays)).toBeLessThanOrEqual(2 ** 31 - 1);
    } finally {
      timeout.mockRestore();
      if (unmount) await act(() => { unmount?.(); });
      jest.clearAllTimers();
      jest.useRealTimers();
    }
  });
});

describe('lane literals follow the locale', () => {
  beforeEach(() => {
    mockSession.role = 'lecturer';
  });

  test('dean supervisor group counts are localized', async () => {
    mockFlags.dean = true;
    mockSession.capabilities = ['dean.overview'];
    api.thesisRounds.mockResolvedValue([{ id: 'r1', name: 'Round 1', status: 'OPEN' }]);
    api.deanOverview.mockResolvedValue({
      supervisors: [{ lecturerId: 'gv1', displayName: 'Lecturer One', supervisedGroups: 3, supervisedTopics: 2 }],
      groups: [],
    });
    await renderEnglish(<LaneRoute id="dean.overview" />);
    await waitFor(() => expect(screen.getByText('3 groups')).toBeTruthy());
    expect(screen.queryByText(/nhóm/)).toBeNull();
  });

  test('credit-limit counts carry a localized credit unit', async () => {
    mockFlags.admin = true;
    mockSession.role = 'admin';
    mockSession.capabilities = ['admin.oversight'];
    api.creditApplications.mockResolvedValue([{ id: 'c1', studentName: 'An', requestedLimit: 25, status: 'PENDING' }]);
    await renderEnglish(<LaneRoute id="admin.creditLimits" />);
    await waitFor(() => expect(screen.getByText('25 credits')).toBeTruthy());
    expect(screen.queryByText('25 tín')).toBeNull();
  });

  test('a single group and member keep the singular English noun', async () => {
    mockFlags.dean = true;
    mockSession.capabilities = ['dean.overview'];
    api.thesisRounds.mockResolvedValue([{ id: 'r1', name: 'Round 1', status: 'OPEN' }]);
    api.deanOverview.mockResolvedValue({
      supervisors: [{ lecturerId: 'gv1', displayName: 'Lecturer One', supervisedGroups: 1, supervisedTopics: 1 }],
      groups: [{
        id: 'g1',
        topicTitle: 'Topic',
        approvalStatus: 'APPROVED',
        departmentName: 'CS',
        members: [{ studentId: 's1' }],
        supervisors: [],
      }],
    });
    await renderEnglish(<LaneRoute id="dean.overview" />);
    await waitFor(() => expect(screen.getByText('1 group')).toBeTruthy());
    expect(screen.getByText('1 group · 1 topic')).toBeTruthy();
    expect(screen.getByText('1 member')).toBeTruthy();
  });

  test('a single requested credit keeps the singular English noun', async () => {
    mockFlags.admin = true;
    mockSession.role = 'admin';
    mockSession.capabilities = ['admin.oversight'];
    api.creditApplications.mockResolvedValue([{ id: 'c1', studentName: 'An', requestedLimit: 1, status: 'PENDING' }]);
    await renderEnglish(<LaneRoute id="admin.creditLimits" />);
    await waitFor(() => expect(screen.getAllByText('1 credit').length).toBeGreaterThan(0));
    expect(screen.queryByText('1 credits')).toBeNull();
  });

  test('a one-item page keeps the singular English noun', async () => {
    await renderEnglish(<Pager copy={lanesMessages.en} page={1} totalPages={1} total={1} onPage={() => {}} />);
    expect(screen.getByText('Page 1/1 · 1 item')).toBeTruthy();
    expect(screen.queryByText('Page 1/1 · 1 items')).toBeNull();
  });
});

describe('queue card head', () => {
  test('a long unbreakable title stays inside the card at large text', async () => {
    setViewport(360, 2);
    const title = 'nguyenvan.a@ute.edu.vn';
    await renderThemed(<QueueCard title={title} lines={[]} status="SUBMITTED" copy={lanesMessages.vi} />);
    const heading = screen.getByRole('header', { name: title });
    expect(heading.props.numberOfLines).toBe(1);
    expect(heading.props.ellipsizeMode).toBe('tail');
    expect(heading.props.accessibilityLabel).toBe(title);
    expect(StyleSheet.flatten(heading.props.style).flexGrow).toBe(0);
    expect(StyleSheet.flatten(heading.parent?.props.style).flexDirection).toBe('column');
  });

  test('a missing title falls back to the first content line instead of an empty heading', async () => {
    setViewport(360, 2);
    const email = 'nguyenvan.a@ute.edu.vn';
    await renderThemed(<QueueCard title="" lines={[email]} status="SUBMITTED" copy={lanesMessages.vi} />);
    const heading = screen.getByRole('header');
    expect(heading).toHaveTextContent(email);
    expect(heading.props.accessibilityLabel).toBe(email);
  });

  test('an absent title never renders undefined', async () => {
    setViewport(360, 2);
    const email = 'nguyenvan.a@ute.edu.vn';
    await renderThemed(<QueueCard lines={[email]} status="SUBMITTED" copy={lanesMessages.vi} />);
    expect(screen.getByRole('header')).toHaveTextContent(email);
    expect(screen.queryByText('undefined')).toBeNull();
  });

  test('the queue head keeps the row layout at the default text scale', async () => {
    setViewport(390, 1);
    const title = 'Nguyễn Văn A';
    await renderThemed(<QueueCard title={title} lines={[]} status="SUBMITTED" copy={lanesMessages.vi} />);
    const heading = screen.getByRole('header', { name: title });
    expect(heading.props.numberOfLines).toBeUndefined();
    expect(StyleSheet.flatten(heading.parent?.props.style).flexDirection).toBe('row');
  });
});

describe('dean overview web parity', () => {
  beforeEach(() => {
    mockFlags.dean = true;
    mockSession.role = 'lecturer';
    mockSession.capabilities = ['dean.overview'];
    api.thesisRounds.mockResolvedValue([{ id: 'r1', name: 'Round 1', status: 'OPEN' }]);
  });

  test('shows the seven faculty metrics with the web formulas', async () => {
    api.deanOverview.mockResolvedValue({
      faculty: { facultyName: 'Khoa Công nghệ Thông tin' },
      stats: {
        totalGroups: 11,
        groupsPendingApproval: 2,
        groupsApproved: 5,
        groupsRejected: 1,
        groupsWithoutTopic: 3,
        totalMembers: 27,
        facultyTopics: 9,
        supervisorCount: 4,
        byDepartment: [],
      },
      supervisors: [],
      groups: [],
    });
    await renderThemed(<LaneRoute id="dean.overview" />);
    await waitFor(() => expect(screen.getByText('Quan sát khóa luận toàn khoa')).toBeTruthy());
    for (const [label, value] of [
      ['Nhóm', '11'],
      ['Chờ xét duyệt', '2'],
      ['Đã duyệt', '5'],
      ['Chưa có đề tài', '3'],
      ['Sinh viên tham gia', '27'],
      ['Đề tài của khoa', '9'],
      ['GV hướng dẫn', '4'],
    ] as const) {
      expect(screen.getByLabelText(`${label}: ${value}`)).toBeTruthy();
    }
    expect(screen.queryByText('Bị từ chối')).toBeNull();
  });

  test('a group row expands to members, supervisors and the rejection reason', async () => {
    api.deanOverview.mockResolvedValue({
      stats: { totalGroups: 1, groupsPendingApproval: 0, groupsApproved: 0, byDepartment: [] },
      supervisors: [],
      groups: [{
        id: 'g1',
        topicTitle: 'Hệ thống campus',
        status: 'SUBMITTED',
        approvalStatus: 'REJECTED',
        departmentName: 'CNTT',
        rejectionReason: 'Thiếu nhóm trưởng',
        members: [
          { displayName: 'Nguyễn Văn A', studentNumber: '21110001', isLeader: true },
          { displayName: 'Trần Thị B', studentNumber: '21110002', isExternal: true },
        ],
        supervisors: [{ displayName: 'Giảng viên Một', employeeId: 'GV001', departmentName: 'Khoa CNTT' }],
      }],
    });
    await renderThemed(<LaneRoute id="dean.overview" />);
    await waitFor(() => expect(screen.getByText('Hệ thống campus')).toBeTruthy());
    expect(screen.queryByText('Nguyễn Văn A')).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Hệ thống campus' }));
    expect(screen.getByText('Nguyễn Văn A')).toBeTruthy();
    expect(screen.getByText('21110001')).toBeTruthy();
    expect(screen.getByText('Nhóm trưởng')).toBeTruthy();
    expect(screen.getByText('Ngoài trường')).toBeTruthy();
    expect(screen.getByText('Giảng viên Một')).toBeTruthy();
    expect(screen.getByText('GV001')).toBeTruthy();
    expect(screen.getByText('Khoa CNTT')).toBeTruthy();
    expect(screen.getByText('Thiếu nhóm trưởng')).toBeTruthy();
    expect(screen.getByText('Đã gửi')).toBeTruthy();
    expect(screen.getByText('Bị từ chối')).toBeTruthy();
  });

  test('uses the web title and supervisor section wording', async () => {
    api.deanOverview.mockResolvedValue({
      stats: { totalGroups: 0, groupsPendingApproval: 0, groupsApproved: 0, byDepartment: [] },
      supervisors: [{ lecturerId: 'gv1', displayName: 'Giảng viên Một', supervisedGroups: 1, supervisedTopics: 1 }],
      groups: [],
    });
    await renderThemed(<LaneRoute id="dean.overview" />);
    await waitFor(() => expect(screen.getByText('Khối lượng hướng dẫn')).toBeTruthy());
    expect(screen.getByText('Quan sát khóa luận toàn khoa')).toBeTruthy();
    expect(screen.getByText('Giảng viên đang hướng dẫn ít nhất một nhóm trong đợt.')).toBeTruthy();
    expect(screen.getByText('Chờ xét duyệt')).toBeTruthy();
  });
});

describe('admin overview web parity', () => {
  beforeEach(() => {
    mockFlags.admin = true;
    mockSession.role = 'admin';
    mockSession.capabilities = ['admin.oversight'];
    api.analytics.mockResolvedValue({
      totals: { students: 5, lecturers: 3, courses: 2, enrollments: 4 },
      departments: [{ code: 'CNTT', name: 'Information Technology', students: 5, courses: 2, sections: 1 }],
      gradeDistribution: [{ grade: 'A', count: 2 }],
      semesterTrends: [{ semester: 'HK1', activeStudents: 5, completionRate: 80 }],
      facultyRanks: [{ rank: 'PROFESSOR', count: 1 }],
    });
  });

  test('KPI labels match the web without the long detail lines', async () => {
    await renderThemed(<LaneRoute id="admin.overview" />);
    await waitFor(() => expect(screen.getByText('Sinh viên')).toBeTruthy());
    for (const [label, value, detail] of [
      ['Sinh viên', '5', 'Hồ sơ người dùng hiện có.'],
      ['Giảng viên', '3', 'Tài khoản giảng viên đang hoạt động.'],
      ['Môn học', '2', 'Sẵn sàng mở lớp và đăng ký.'],
      ['Đăng ký học phần', '4', 'Hồ sơ đăng ký hiện có.'],
    ] as const) {
      expect(screen.getByLabelText(`${label}: ${value}`)).toBeTruthy();
      expect(screen.queryByText(detail)).toBeNull();
    }
  });

  test('page identity and management copy match the web', async () => {
    await renderThemed(<LaneRoute id="admin.overview" />);
    await waitFor(() => expect(screen.getByText('Tổng quan quản trị')).toBeTruthy());
    expect(screen.getByText('Tổng quan campus')).toBeTruthy();
    expect(screen.getByText('Quản lý tài khoản, hồ sơ học vụ, thông báo và luồng luận văn cốt lõi trong một cổng thống nhất.')).toBeTruthy();
    expect(screen.getByText('Công cụ quản trị')).toBeTruthy();
    expect(screen.getByText('Mở đúng khu vực cần xử lý.')).toBeTruthy();
  });

  test('analytics heading, live notice and chart titles match the web', async () => {
    await renderThemed(<LaneRoute id="admin.overview" />);
    await waitFor(() => expect(screen.getByText('Trung tâm phân tích & giám sát học vụ')).toBeTruthy());
    expect(screen.getByText('Dữ liệu trực tiếp')).toBeTruthy();
    expect(screen.getByText('Các biểu đồ dưới đây được vẽ trực tiếp từ API hồ sơ học vụ thực tế.')).toBeTruthy();
    expect(screen.getByText('Theo khoa')).toBeTruthy();
    expect(screen.getByText('Xu hướng ĐKHP')).toBeTruthy();
    expect(screen.getByText('Đội ngũ giảng viên')).toBeTruthy();
    expect(screen.getByText('Xếp loại học lực')).toBeTruthy();
  });
});
