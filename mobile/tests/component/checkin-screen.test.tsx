import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { ThemeProvider } from '../../src/design/theme';
import { createCheckinMachine } from '../../src/attendance-checkin/checkin-machine';
import {
  AttendanceApiError,
  type AttendanceApi,
  type AttendanceErrorCode,
  type OpenAttendanceSession,
} from '../../src/attendance-checkin/attendance-api';
import type { LocationProvider } from '../../src/attendance-checkin/location-service';
import { checkinMessages } from '../../src/i18n/checkin-messages';
import type { CheckinScreenProps } from '../../src/screens/attendance-checkin/CheckinScreen';
import type { MobileScreenProps } from '../../src/navigation/types';

const mockRouter = { back: jest.fn(), push: jest.fn(), replace: jest.fn(), canGoBack: () => true };
let mockParams: { sessionId?: string } = {};

jest.mock('../../src/api/client', () => ({ apiClient: { mode: 'live' } }));
jest.mock('expo-router', () => {
  const { useEffect } = require('react');
  return {
    useFocusEffect: (callback: () => void) => useEffect(callback, [callback]),
    useLocalSearchParams: () => mockParams,
    useRouter: () => mockRouter,
  };
});

import { CheckinScreen } from '../../src/screens/attendance-checkin/CheckinScreen';

// jest-expo does not set this; without it RNTL's internal act() cannot flush
// updates, which leaves presses landing on stale/disabled elements.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const copy = checkinMessages.vi;
const NOW = 1_800_000_000_000;
const ID = '12345678-1234-4abc-8def-123456789abc';
const SESSION: OpenAttendanceSession = {
  id: ID, sectionId: 'section', sectionLabel: 'CT101 · Class', closesAt: new Date(NOW + 600_000).toISOString(),
  requireCode: true, geofenceName: 'Campus A',
};

function setup(overrides: {
  sessions?: OpenAttendanceSession[];
  consent?: boolean;
  permission?: 'granted' | 'denied-can-ask' | 'denied-blocked';
  services?: boolean;
  checkinError?: AttendanceApiError;
  checkinDecision?: 'ACCEPTED' | 'PENDING_REVIEW' | 'REJECTED';
  accuracy?: number;
} = {}) {
  const api = {
    openSessions: jest.fn<AttendanceApi['openSessions']>().mockResolvedValue(overrides.sessions ?? [SESSION]),
    getConsent: jest.fn<AttendanceApi['getConsent']>().mockResolvedValue({
      accepted: overrides.consent ?? true, version: 'v1', acceptedAt: null,
    }),
    acceptConsent: jest.fn<AttendanceApi['acceptConsent']>().mockResolvedValue({ accepted: true, version: 'v1', acceptedAt: null }),
    checkin: jest.fn<AttendanceApi['checkin']>().mockImplementation(async () => {
      if (overrides.checkinError) throw overrides.checkinError;
      return { decision: overrides.checkinDecision ?? 'ACCEPTED', status: 'PRESENT', message: 'ok' };
    }),
  };
  const location = {
    ensurePermission: jest.fn<LocationProvider['ensurePermission']>().mockResolvedValue(overrides.permission ?? 'granted'),
    isServicesEnabled: jest.fn<LocationProvider['isServicesEnabled']>().mockResolvedValue(overrides.services ?? true),
    getFreshFix: jest.fn<LocationProvider['getFreshFix']>().mockImplementation(async () => ({
      latitude: 10, longitude: 106, accuracyMeters: overrides.accuracy ?? 20,
      capturedAt: new Date(NOW).toISOString(), mocked: false,
    })),
  };
  const machine = createCheckinMachine({
    api, location, getInstallationId: async () => 'inst', identity: () => 1, now: () => NOW,
  });
  return { api, location, machine };
}

const props = {
  navigation: { navigate: jest.fn(), navigateLane: jest.fn(), goBack: jest.fn() },
  role: 'student', selectedThesisTopicId: null,
} as unknown as MobileScreenProps;

const show = (machine: ReturnType<typeof setup>['machine']) =>
  render(<ThemeProvider forcedScheme="light"><CheckinScreen {...(props as CheckinScreenProps)} machine={machine} /></ThemeProvider>);

/** Buttons expose their label as the accessible name. */
const press = (name: string) => fireEvent.press(screen.getByRole('button', { name }));
const byRole = (name: string) => waitFor(() => expect(screen.getByRole('button', { name })).toBeOnTheScreen());
const byTestId = (id: string) => waitFor(() => expect(screen.getByTestId(id)).toBeTruthy());

/**
 * The submit button stays disabled until the code state flushes; a press on a
 * disabled target is swallowed, so wait for enablement before pressing.
 */
async function submitCode(code: string) {
  fireEvent.changeText(screen.getByTestId('checkin-code'), code);
  await waitFor(() => expect(screen.getByRole('button', { name: copy.submit })).toBeEnabled());
  press(copy.submit);
}

/** Drive to readyForCode: card → (consent already accepted) → permission → fix. */
async function reachReady() {
  await byRole(copy.entryAction);
  press(copy.entryAction);
  await byRole(copy.permissionAction);
  press(copy.permissionAction);
  await byTestId('checkin-ready');
}

beforeEach(() => { mockParams = {}; mockRouter.back.mockReset(); });

describe('check-in screen states', () => {
  test('session card → consent → permission → code → accepted', async () => {
    const fixture = setup({ consent: false });
    await show(fixture.machine);
    await waitFor(() => expect(screen.getByText('CT101 · Class')).toBeTruthy());
    expect(screen.getByText('Campus A')).toBeTruthy();
    press(copy.entryAction);
    await byTestId('checkin-consent');
    press(copy.consentAccept);
    await byTestId('checkin-state-needsPermission');
    press(copy.permissionAction);
    await byTestId('checkin-ready');
    await submitCode('123456');
    await byTestId('checkin-state-accepted');
    expect(fixture.api.checkin).toHaveBeenCalledWith(ID, expect.objectContaining({ code: '123456' }));
  });

  test('empty session list shows the empty state', async () => {
    const fixture = setup({ sessions: [] });
    await show(fixture.machine);
    await waitFor(() => expect(screen.getByText(copy.noSessions)).toBeTruthy());
  });

  test('permission denied re-shows the ask', async () => {
    const fixture = setup({ permission: 'denied-can-ask' });
    await show(fixture.machine);
    await byRole(copy.entryAction);
    press(copy.entryAction);
    await byTestId('checkin-state-needsPermission');
    press(copy.permissionAction);
    await byTestId('checkin-state-needsPermission');
  });

  test('permission blocked shows the settings action', async () => {
    const fixture = setup({ permission: 'denied-blocked' });
    await show(fixture.machine);
    await byRole(copy.entryAction);
    press(copy.entryAction);
    await byRole(copy.permissionAction);
    press(copy.permissionAction);
    await byTestId('checkin-state-permissionBlocked');
    expect(screen.getByText(copy.openSettings)).toBeTruthy();
  });

  test('services off shows the location-settings state', async () => {
    const fixture = setup({ services: false });
    await show(fixture.machine);
    await byRole(copy.entryAction);
    press(copy.entryAction);
    await byRole(copy.permissionAction);
    press(copy.permissionAction);
    await byTestId('checkin-state-servicesOff');
    expect(screen.getByText(copy.openLocationSettings)).toBeTruthy();
  });

  test('low accuracy shows tips and retry', async () => {
    const fixture = setup({ accuracy: 250 });
    await show(fixture.machine);
    await byRole(copy.entryAction);
    press(copy.entryAction);
    await byRole(copy.permissionAction);
    press(copy.permissionAction);
    await byTestId('checkin-state-lowAccuracy');
    expect(screen.getByText(copy.lowAccuracyBody)).toBeTruthy();
    expect(screen.getByRole('button', { name: copy.retry })).toBeOnTheScreen();
  });

  test.each<[AttendanceErrorCode, string, keyof typeof copy]>([
    ['OUTSIDE_AREA', 'checkin-state-rejected', 'outsideTitle'],
    ['BAD_CODE', 'checkin-state-rejected', 'badCodeTitle'],
    ['NOT_ENROLLED', 'checkin-state-notEnrolled', 'notEnrolledTitle'],
    ['ALREADY_CHECKED_IN', 'checkin-state-alreadyCheckedIn', 'alreadyTitle'],
    ['SESSION_CLOSED', 'checkin-state-sessionClosed', 'closedTitle'],
    ['NETWORK_ERROR', 'checkin-state-networkError', 'offlineTitle'],
    ['TOO_MANY_ATTEMPTS', 'checkin-state-tooManyAttempts', 'rateLimitTitle'],
  ])('server %s renders its state', async (code, testId, copyKey) => {
    const error = new AttendanceApiError(code, code === 'TOO_MANY_ATTEMPTS' ? 429 : 422, false, code === 'TOO_MANY_ATTEMPTS' ? 30 : null);
    const fixture = setup({ checkinError: error });
    await show(fixture.machine);
    await reachReady();
    await submitCode('123456');
    await byTestId(testId);
    expect(screen.getByText(copy[copyKey] as string)).toBeTruthy();
  });

  test('pending review renders the waiting state', async () => {
    const fixture = setup({ checkinDecision: 'PENDING_REVIEW' });
    await show(fixture.machine);
    await reachReady();
    await submitCode('123456');
    await byTestId('checkin-state-pendingReview');
    expect(screen.getByText(copy.pendingTitle)).toBeTruthy();
  });

  test('a short code stays client-side — submit is blocked', async () => {
    const fixture = setup();
    await show(fixture.machine);
    await reachReady();
    fireEvent.changeText(screen.getByTestId('checkin-code'), '12');
    await waitFor(() => expect(screen.getByTestId('checkin-code')).toHaveProp('value', '12'));
    expect(screen.getByRole('button', { name: copy.submit })).toBeDisabled();
    expect(fixture.api.checkin).not.toHaveBeenCalled();
  });

  test('deep-link param with a bad session id shows the invalid-link error', async () => {
    mockParams = { sessionId: 'not-a-uuid' };
    const fixture = setup();
    await show(fixture.machine);
    await byTestId('checkin-state-error');
    expect(screen.getByText(copy.invalidLinkTitle)).toBeTruthy();
    expect(fixture.api.openSessions).not.toHaveBeenCalled();
  });

  test('deep-link param lands on the named session', async () => {
    mockParams = { sessionId: ID };
    const fixture = setup({ consent: false });
    await show(fixture.machine);
    await byTestId('checkin-consent');
    expect(fixture.api.openSessions).toHaveBeenCalled();
  });
});
