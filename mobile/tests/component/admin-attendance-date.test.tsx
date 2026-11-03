import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';

import { ThemeProvider } from '../../src/design/theme';
import { LocaleProvider } from '../../src/i18n/locale-provider';

jest.mock('expo-router', () => {
  const { useEffect } = require('react');
  return { useFocusEffect: (callback: () => void) => useEffect(callback, [callback]) };
});
jest.mock('../../src/screens/lanes/lane-api', () => ({
  LANE_PAGE_SIZE: 20,
  laneApi: { attendance: jest.fn() },
}));

import { laneApi } from '../../src/screens/lanes/lane-api';
import { AdminAttendanceScreen } from '../../src/screens/lanes/AdminLaneScreens';

const api = laneApi as unknown as { attendance: jest.Mock<(...args: unknown[]) => Promise<unknown>> };

beforeEach(() => {
  api.attendance.mockReset();
  api.attendance.mockResolvedValue({ items: [], meta: { total: 0, totalPages: 0 } });
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
  jest.clearAllMocks();
});

describe('admin attendance date filter', () => {
  test('the maximum is the campus day, not the device calendar day', async () => {
    jest.useFakeTimers({
      now: new Date('2026-11-02T17:30:00Z'),
      doNotFake: ['setTimeout', 'setInterval', 'setImmediate', 'nextTick', 'queueMicrotask'],
    });
    // A device set behind UTC+07 sees 2 November while campus is already on 3 November.
    jest.spyOn(Date.prototype, 'getFullYear').mockReturnValue(2026);
    jest.spyOn(Date.prototype, 'getMonth').mockReturnValue(10);
    jest.spyOn(Date.prototype, 'getDate').mockReturnValue(2);

    await render(
      <ThemeProvider forcedScheme="light">
        <LocaleProvider initialLocale="vi">
          <AdminAttendanceScreen />
        </LocaleProvider>
      </ThemeProvider>,
    );
    await waitFor(() => expect(api.attendance).toHaveBeenCalledTimes(1));

    await fireEvent.press(screen.getByRole('button', { name: 'Ngày: Chưa chọn' }));
    const sheet = screen.getByLabelText('Ngày');
    await fireEvent.changeText(within(sheet).getByLabelText('Chọn ngày'), '03/11/2026');
    await fireEvent.press(within(sheet).getByRole('button', { name: 'Áp dụng' }));

    expect(screen.queryByText('Ngày không được muộn hơn 02/11/2026')).toBeNull();
    expect(screen.getByRole('button', { name: 'Ngày: 03/11/2026' })).toBeOnTheScreen();
  });
});
