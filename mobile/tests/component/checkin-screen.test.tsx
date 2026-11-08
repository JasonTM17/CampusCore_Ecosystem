import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { AppState, Dimensions, StyleSheet, type AppStateStatus } from 'react-native';

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
const mockGoBack = jest.fn();
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
  checkinStatus?: string | null;
  accuracyAuthorization?: 'full' | 'reduced';
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
      return { decision: overrides.checkinDecision ?? 'ACCEPTED',
        status: overrides.checkinStatus === undefined ? 'PRESENT' : overrides.checkinStatus, message: 'ok' };
    }),
  };
  const location = {
    ensurePermission: jest.fn<LocationProvider['ensurePermission']>().mockResolvedValue(overrides.permission ?? 'granted'),
    accuracyAuthorization: jest.fn<() => Promise<'full' | 'reduced'>>()
      .mockResolvedValue(overrides.accuracyAuthorization ?? 'full'),
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
  navigation: { navigate: jest.fn(), navigateLane: jest.fn(), goBack: mockGoBack },
  role: 'student', selectedThesisTopicId: null,
} as unknown as MobileScreenProps;

const show = (machine: ReturnType<typeof setup>['machine']) =>
  render(<ThemeProvider forcedScheme="light"><CheckinScreen {...(props as CheckinScreenProps)} machine={machine} /></ThemeProvider>);

/** Buttons expose their label as the accessible name. */
const press = (name: string) => fireEvent.press(screen.getByRole('button', { name }));
const sessionActionName = (session = SESSION) => `${copy.entryAction}: ${session.sectionLabel}, ${session.geofenceName}`;
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
  await byRole(sessionActionName());
  press(sessionActionName());
  await byRole(copy.permissionAction);
  press(copy.permissionAction);
  await byTestId('checkin-ready');
}

let foreground: ((state: AppStateStatus) => void) | undefined;
let removeAppStateListener: ReturnType<typeof jest.fn>;

beforeEach(() => {
  mockParams = {};
  mockRouter.back.mockReset();
  mockRouter.canGoBack = () => true;
  mockGoBack.mockReset();
  foreground = undefined;
  removeAppStateListener = jest.fn();
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
    foreground = listener;
    return { remove: removeAppStateListener };
  });
});
afterEach(() => { jest.restoreAllMocks(); });

describe('check-in screen states', () => {
  test('session choice actions identify their session to screen readers', async () => {
    const otherSession: OpenAttendanceSession = {
      ...SESSION,
      id: '22345678-1234-4abc-8def-123456789abc',
      sectionLabel: 'CT102 · Class',
      geofenceName: 'Campus B',
    };
    const fixture = setup({ sessions: [SESSION, otherSession] });
    await show(fixture.machine);

    expect(await screen.findByRole('button', {
      name: `${copy.entryAction}: ${SESSION.sectionLabel}, ${SESSION.geofenceName}`,
    })).toBeOnTheScreen();
    expect(screen.getByRole('button', {
      name: `${copy.entryAction}: ${otherSession.sectionLabel}, ${otherSession.geofenceName}`,
    })).toBeOnTheScreen();
  });

  test.each([[360, 640, 1], [393, 360, 2], [839, 393, 1.3], [1000, 600, 2]])(
    'gives the session action its own line at %s x %s and font %s',
    async (width, height, fontScale) => {
      jest.spyOn(Dimensions, 'get').mockReturnValue({ width, height, scale: 2, fontScale });
      const fixture = setup({ sessions: [{ ...SESSION, sectionLabel: 'Học phần có tên dài và nhiều thông tin', geofenceName: 'Cơ sở đào tạo chính' }] });
      await show(fixture.machine);
      const action = await screen.findByTestId(`checkin-select-${ID}`);
      const rowStyle = StyleSheet.flatten(action.parent?.props.style);
      expect(rowStyle.flexWrap).toBe('wrap');
      expect(StyleSheet.flatten(action.props.style).width).toBe('100%');
      let scroll = action.parent;
      while (scroll && !scroll.props.keyboardShouldPersistTaps) scroll = scroll.parent;
      expect(scroll).toBeTruthy();
    },
  );

  test('unauthorized submission shows explicit recovery and retry only reloads reads', async () => {
    const fixture = setup({ checkinError: new AttendanceApiError('UNKNOWN', 401) });
    await show(fixture.machine); await reachReady(); await submitCode('123456');
    await byTestId('checkin-state-authRecovery');
    expect(screen.getByText('Cần xác thực lại phiên đăng nhập')).toBeTruthy();
    press(copy.retry);
    await byRole(sessionActionName());
    expect(fixture.api.checkin).toHaveBeenCalledTimes(1);
  });

  test('changed consent renders the current version and re-acceptance message', async () => {
    const fixture = setup({ consent: false });
    fixture.api.acceptConsent.mockRejectedValueOnce({ status: 400, code: 'INVALID_CONSENT_VERSION' });
    await show(fixture.machine);
    await byRole(sessionActionName()); press(sessionActionName());
    await byTestId('checkin-consent');
    fixture.api.getConsent.mockResolvedValue({ accepted: false, version: 'v2', acceptedAt: null });
    press(copy.consentAccept);
    await waitFor(() => expect(screen.getByText('Thông báo phiên bản v2')).toBeTruthy());
    expect(screen.getByText('Thông báo vị trí đã thay đổi. Vui lòng đồng ý lại.')).toBeTruthy();
    expect(screen.getByRole('button', { name: copy.consentAccept })).toBeOnTheScreen();
    expect(fixture.api.checkin).not.toHaveBeenCalled();
  });

  test('session card → consent → permission → code → accepted', async () => {
    const fixture = setup({ consent: false });
    await show(fixture.machine);
    await waitFor(() => expect(screen.getByText('CT101 · Class')).toBeTruthy());
    expect(screen.getByText('Campus A')).toBeTruthy();
    press(sessionActionName());
    await byTestId('checkin-consent');
    press(copy.consentAccept);
    await byTestId('checkin-state-needsPermission');
    press(copy.permissionAction);
    await byTestId('checkin-ready');
    await submitCode('123456');
    await byTestId('checkin-state-accepted');
    expect(fixture.api.checkin).toHaveBeenCalledWith(ID, expect.objectContaining({ code: '123456' }));
  });

  test('completion from a cold deep link uses guarded navigation back', async () => {
    mockRouter.canGoBack = () => false;
    const fixture = setup();
    await show(fixture.machine);
    await reachReady();
    await submitCode('123456');
    await byTestId('checkin-state-accepted');

    press(copy.done);

    expect(mockGoBack).toHaveBeenCalledTimes(1);
    expect(mockRouter.back).not.toHaveBeenCalled();
  });

  test('empty session list shows the empty state', async () => {
    const fixture = setup({ sessions: [] });
    await show(fixture.machine);
    await waitFor(() => expect(screen.getByText(copy.noSessions)).toBeTruthy());
  });

  test('permission denied re-shows the ask', async () => {
    const fixture = setup({ permission: 'denied-can-ask' });
    await show(fixture.machine);
    await byRole(sessionActionName());
    press(sessionActionName());
    await byTestId('checkin-state-needsPermission');
    press(copy.permissionAction);
    await byTestId('checkin-state-needsPermission');
  });

  test('permission blocked shows the settings action', async () => {
    const fixture = setup({ permission: 'denied-blocked' });
    await show(fixture.machine);
    await byRole(sessionActionName());
    press(sessionActionName());
    await byRole(copy.permissionAction);
    press(copy.permissionAction);
    await byTestId('checkin-state-permissionBlocked');
    expect(screen.getByText(copy.openSettings)).toBeTruthy();
  });

  test('services off shows the location-settings state', async () => {
    const fixture = setup({ services: false });
    await show(fixture.machine);
    await byRole(sessionActionName());
    press(sessionActionName());
    await byRole(copy.permissionAction);
    press(copy.permissionAction);
    await byTestId('checkin-state-servicesOff');
    expect(screen.getByText(copy.openLocationSettings)).toBeTruthy();
  });

  test('returning from settings re-checks a blocked permission', async () => {
    const fixture = setup({ permission: 'denied-blocked' });
    const view = await show(fixture.machine);
    await byRole(sessionActionName());
    press(sessionActionName());
    await byRole(copy.permissionAction);
    press(copy.permissionAction);
    await byTestId('checkin-state-permissionBlocked');

    fixture.location.ensurePermission.mockResolvedValue('granted');
    await act(async () => { foreground?.('active'); });

    await byTestId('checkin-ready');
    expect(fixture.location.getFreshFix).toHaveBeenCalledTimes(1);
    await act(async () => { view.unmount(); });
    expect(removeAppStateListener).toHaveBeenCalledTimes(1);
  });

  test('returning from settings re-checks location services', async () => {
    const fixture = setup({ services: false });
    await show(fixture.machine);
    await byRole(sessionActionName());
    press(sessionActionName());
    await byRole(copy.permissionAction);
    press(copy.permissionAction);
    await byTestId('checkin-state-servicesOff');

    fixture.location.isServicesEnabled.mockResolvedValue(true);
    await act(async () => { foreground?.('active'); });

    await byTestId('checkin-ready');
    expect(fixture.location.getFreshFix).toHaveBeenCalledTimes(1);
  });

  test('low accuracy shows tips and retry', async () => {
    const fixture = setup({ accuracy: 250 });
    await show(fixture.machine);
    await byRole(sessionActionName());
    press(sessionActionName());
    await byRole(copy.permissionAction);
    press(copy.permissionAction);
    await byTestId('checkin-state-lowAccuracy');
    expect(screen.getByText(copy.lowAccuracyBody)).toBeTruthy();
    expect(screen.getByRole('button', { name: copy.retry })).toBeOnTheScreen();
  });

  test('reduced location accuracy offers settings and rechecks when the app returns', async () => {
    const fixture = setup({ accuracyAuthorization: 'reduced' });
    await show(fixture.machine);
    await byRole(sessionActionName());
    press(sessionActionName());
    await byRole(copy.permissionAction);
    press(copy.permissionAction);
    await byTestId('checkin-state-reducedAccuracy');

    expect(screen.getByText('Bật Vị trí chính xác trong cài đặt ứng dụng rồi thử lại.')).toBeTruthy();
    expect(screen.getByRole('button', { name: copy.openSettings })).toBeOnTheScreen();

    fixture.location.accuracyAuthorization.mockResolvedValue('full');
    await act(async () => { foreground?.('active'); });
    await byTestId('checkin-ready');
  });

  test('retry after a rejected code clears the previous code', async () => {
    const fixture = setup({ checkinError: new AttendanceApiError('BAD_CODE', 422) });
    await show(fixture.machine);
    await reachReady();
    await submitCode('123456');
    await byTestId('checkin-state-rejected');

    press(copy.retry);
    await byTestId('checkin-ready');

    expect(screen.getByTestId('checkin-code')).toHaveProp('value', '');
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

  test.each(['MANUAL_RECORD_PRESERVED', null, 'UNKNOWN'] as const)(
    'accepted check-in status %s is not shown as present', async (checkinStatus) => {
      const fixture = setup({ checkinStatus });
      await show(fixture.machine);
      await reachReady();
      await submitCode('123456');
      await byTestId('checkin-state-accepted');

      expect(screen.queryByText(copy.statusPresent)).toBeNull();
      expect(screen.getByText(copy.statusPreserved)).toBeTruthy();
    },
  );

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
