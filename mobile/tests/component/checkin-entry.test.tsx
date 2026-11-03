import { expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ReactElement } from 'react';

import { ThemeProvider } from '../../src/design/theme';
import { LocaleProvider } from '../../src/i18n/locale-provider';
import { checkinMessages } from '../../src/i18n/checkin-messages';
import type { AttendanceApi, OpenAttendanceSession } from '../../src/attendance-checkin';
import type { MobileNavigation } from '../../src/navigation/types';

jest.mock('../../src/api/client', () => ({ apiClient: { mode: 'live' } }));
jest.mock('../../src/config/lane-flags', () => ({
  LANE_FLAGS: { dean: false, staff: false, admin: false, checkin: true },
}));
jest.mock('../../src/session/SessionContext', () => ({
  useSession: () => ({ kind: 'authenticated', role: 'student', capabilities: ['student.checkin'] }),
}));
jest.mock('../../src/attendance-checkin', () => ({
  createNativeAttendanceApi: jest.fn(),
}));

import { CheckinEntryCard } from '../../src/screens/attendance-checkin/CheckinEntryCard';

const copy = checkinMessages.en;
const session: OpenAttendanceSession = {
  id: '12345678-1234-4abc-8def-123456789abc',
  sectionId: 'section-1',
  sectionLabel: 'CT101 · Class',
  closesAt: '2026-11-03T01:00:00Z',
  requireCode: true,
  geofenceName: 'Campus A',
};
const navigation = { navigateLane: jest.fn() } as unknown as MobileNavigation;

const screenElement = (element: ReactElement) => (
  <ThemeProvider forcedScheme="light">
    <LocaleProvider initialLocale="en">{element}</LocaleProvider>
  </ThemeProvider>
);

test('a failed open-session read shows an error with retry instead of hiding the entry', async () => {
  const openSessions = jest.fn<AttendanceApi['openSessions']>().mockRejectedValue(new Error('offline'));
  const api = { openSessions } as unknown as AttendanceApi;
  await render(screenElement(<CheckinEntryCard api={api} navigation={navigation} />));

  expect(await screen.findByTestId('inline-error')).toBeOnTheScreen();
  expect(screen.getByText('Could not load open check-in sessions')).toBeOnTheScreen();

  openSessions.mockResolvedValue([session]);
  await fireEvent.press(screen.getByRole('button', { name: copy.retry }));
  await waitFor(() => expect(screen.getByTestId('checkin-entry')).toBeOnTheScreen());
  expect(screen.getByText('1 open check-in session')).toBeOnTheScreen();
  expect(openSessions).toHaveBeenCalledTimes(2);
});
