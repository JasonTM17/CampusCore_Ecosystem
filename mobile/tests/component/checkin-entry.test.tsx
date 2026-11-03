import { afterEach, beforeEach, expect, jest, test } from '@jest/globals';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';
import type { ReactElement } from 'react';

import { ThemeProvider } from '../../src/design/theme';
import { LocaleProvider } from '../../src/i18n/locale-provider';
import { checkinMessages } from '../../src/i18n/checkin-messages';
import type { AttendanceApi, OpenAttendanceSession } from '../../src/attendance-checkin';
import type { MobileNavigation } from '../../src/navigation/types';

let focusEffect: (() => void | (() => void)) | undefined;
let foreground: ((state: AppStateStatus) => void) | undefined;

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
jest.mock('expo-router', () => {
  const { useEffect } = require('react');
  return {
    useFocusEffect: (callback: () => void | (() => void)) => {
      focusEffect = callback;
      useEffect(callback, [callback]);
    },
  };
});

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

beforeEach(() => {
  focusEffect = undefined;
  foreground = undefined;
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
    foreground = listener;
    return { remove: jest.fn() };
  });
});
afterEach(() => { jest.restoreAllMocks(); });

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

test('a session opened while the screen is mounted surfaces when it regains focus', async () => {
  const openSessions = jest.fn<AttendanceApi['openSessions']>().mockResolvedValue([]);
  const api = { openSessions } as unknown as AttendanceApi;
  await render(screenElement(<CheckinEntryCard api={api} navigation={navigation} />));
  await waitFor(() => expect(openSessions).toHaveBeenCalledTimes(1));
  expect(screen.queryByTestId('checkin-entry')).toBeNull();

  openSessions.mockResolvedValue([session]);
  await act(async () => { focusEffect?.(); });

  await waitFor(() => expect(screen.getByTestId('checkin-entry')).toBeOnTheScreen());
  expect(screen.getByText('1 open check-in session')).toBeOnTheScreen();
  expect(openSessions).toHaveBeenCalledTimes(2);
});

test('a session opened while the app was backgrounded surfaces on foreground', async () => {
  const openSessions = jest.fn<AttendanceApi['openSessions']>().mockResolvedValue([]);
  const api = { openSessions } as unknown as AttendanceApi;
  await render(screenElement(<CheckinEntryCard api={api} navigation={navigation} />));
  await waitFor(() => expect(openSessions).toHaveBeenCalledTimes(1));
  expect(screen.queryByTestId('checkin-entry')).toBeNull();

  openSessions.mockResolvedValue([session]);
  await act(async () => { foreground?.('active'); });

  await waitFor(() => expect(screen.getByTestId('checkin-entry')).toBeOnTheScreen());
  expect(screen.getByText('1 open check-in session')).toBeOnTheScreen();
  expect(openSessions).toHaveBeenCalledTimes(2);
});
