import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ReactElement } from 'react';

import { ThemeProvider } from '../../src/design/theme';

const mockFlags = { dean: false, staff: false, admin: false };
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
    sendNotification: jest.fn(),
    notificationHistory: jest.fn(),
  },
}));

import { laneApi } from '../../src/screens/lanes/lane-api';
import { LaneRoute } from '../../src/screens/lanes/lane-registry';

const api = laneApi as unknown as Record<string, jest.Mock<(...args: unknown[]) => Promise<unknown>>>;
const renderThemed = async (element: ReactElement) => render(<ThemeProvider forcedScheme="light">{element}</ThemeProvider>);

beforeEach(() => {
  mockFlags.dean = false;
  mockFlags.staff = false;
  mockFlags.admin = false;
  mockSession.kind = 'authenticated';
  mockSession.role = 'admin';
  mockSession.capabilities = [];
  for (const fn of Object.values(api)) fn.mockReset();
});
afterEach(() => {
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
    await renderThemed(<LaneRoute id="admin.notifications" />);
    await waitFor(() => expect(screen.getByText('Xem trước')).toBeTruthy());
    await fireEvent.press(screen.getByText('Xem trước'));
    expect(screen.getByText('Mã người nhận chưa hợp lệ')).toBeTruthy();
    expect(api.sendNotification).not.toHaveBeenCalled();
  });

  test('a network failure on send is reported as unknown and never retried', async () => {
    api.sendNotification.mockRejectedValue({ status: 0 });
    await renderThemed(<LaneRoute id="admin.notifications" />);
    await waitFor(() => expect(screen.getByText('Xem trước')).toBeTruthy());
    await fireEvent.changeText(screen.getByLabelText('Mã người nhận'), '3f2b8c1e-5d4a-4e6f-9a7b-0c1d2e3f4a5b');
    await fireEvent.changeText(screen.getByLabelText('Tiêu đề'), 'Nhắc lịch');
    await fireEvent.changeText(screen.getByLabelText('Nội dung'), 'Nội dung');
    await fireEvent.press(screen.getByText('Xem trước'));
    await fireEvent.press(screen.getByText('Gửi thông báo'));
    await waitFor(() => expect(screen.getByText(/Chưa rõ thông báo đã gửi chưa/)).toBeTruthy());
    expect(api.sendNotification).toHaveBeenCalledTimes(1);
  });
});
