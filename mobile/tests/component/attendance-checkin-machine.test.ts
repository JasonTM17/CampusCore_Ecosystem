import { expect, jest, test } from '@jest/globals';
import { createCheckinMachine } from '../../src/attendance-checkin/checkin-machine';
import { AttendanceApiError, type AttendanceApi, type AttendanceErrorCode, type OpenAttendanceSession } from '../../src/attendance-checkin/attendance-api';
import { LocationServiceError, type LocationErrorCode, type LocationProvider } from '../../src/attendance-checkin/location-service';

const now = 1800000000000;
const id = '12345678-1234-4abc-8def-123456789abc';
const session: OpenAttendanceSession = { id, sectionId: 'section', sectionLabel: 'Class',
  closesAt: new Date(now + 600000).toISOString(), requireCode: true, geofenceName: 'Campus' };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
function setup() {
  let epoch = 1;
  let clock = now;
  const api = {
    openSessions: jest.fn<AttendanceApi['openSessions']>().mockResolvedValue([session]),
    getConsent: jest.fn<AttendanceApi['getConsent']>().mockResolvedValue({ accepted: true, version: 'server-3', acceptedAt: null }),
    acceptConsent: jest.fn<AttendanceApi['acceptConsent']>().mockResolvedValue({ accepted: true, version: 'server-3', acceptedAt: null }),
    checkin: jest.fn<AttendanceApi['checkin']>().mockResolvedValue({ decision: 'ACCEPTED', status: 'ATTENDED', message: 'INSIDE' }),
  };
  const location = {
    ensurePermission: jest.fn<LocationProvider['ensurePermission']>().mockResolvedValue('granted'),
    isServicesEnabled: jest.fn<LocationProvider['isServicesEnabled']>().mockResolvedValue(true),
    getFreshFix: jest.fn<LocationProvider['getFreshFix']>().mockImplementation(async () => ({
      latitude: 10, longitude: 106, accuracyMeters: 20, capturedAt: new Date(clock).toISOString(), mocked: true,
    })),
  };
  const machine = createCheckinMachine({ api, location, getInstallationId: async () => 'installation',
    identity: () => epoch, now: () => clock });
  const states: string[] = [];
  machine.subscribe(({ state }) => states.push(state.type));
  async function ready() { await machine.loadSessions(); await machine.selectSession(id); await machine.acquireLocation(); }
  return { api, location, machine, states, ready, switchIdentity: () => { epoch += 1; }, advance: (ms: number) => { clock += ms; } };
}
test('lists open sessions and picks an authenticated session from a validated link', async () => {
  const { machine, api, states } = setup();
  expect(machine.getSnapshot().state.type).toBe('idle');
  await machine.loadSessions(`campuscore://attendance/checkin/${id}`);
  expect(states).toContain('loadingSessions');
  expect(machine.getSnapshot().selectedSession?.id).toBe(id);
  expect(machine.getSnapshot().state.type).toBe('needsPermission');
  expect(api.getConsent).toHaveBeenCalledTimes(1);
});
test('invalid links cannot trigger any API reads', async () => {
  const { machine, api } = setup();
  await machine.loadSessions('https://evil.com');
  expect(machine.getSnapshot().state).toEqual({ type: 'error', code: 'INVALID_LINK' });
  expect(api.openSessions).not.toHaveBeenCalled();
});
test('empty lists expose noOpenSession', async () => {
  const { machine, api } = setup(); api.openSessions.mockResolvedValue([]);
  await machine.loadSessions();
  expect(machine.getSnapshot().state.type).toBe('noOpenSession');
});
test('session absent from enrolled open list is refused', async () => {
  const { machine, api } = setup();
  await machine.loadSessions(); await machine.selectSession('other');
  expect(machine.getSnapshot().state).toEqual({ type: 'error', code: 'INVALID_SESSION' });
  expect(api.getConsent).not.toHaveBeenCalled();
});
test('consent uses the exact server version before permission or position requests', async () => {
  const { machine, api, location } = setup();
  api.getConsent.mockResolvedValue({ accepted: false, version: 'server-3', acceptedAt: null });
  await machine.loadSessions(); await machine.selectSession(id);
  expect(machine.getSnapshot().state).toEqual({ type: 'needsConsent', version: 'server-3' });
  await machine.acquireLocation(); await machine.submit('123456');
  expect(location.ensurePermission).not.toHaveBeenCalled();
  expect(api.checkin).not.toHaveBeenCalled();
  await machine.acceptConsent();
  expect(api.acceptConsent).toHaveBeenCalledWith('server-3');
  expect(machine.getSnapshot().state.type).toBe('needsPermission');
});
test('full success forwards actual fix timestamp and mock flag and exposes no private input in state', async () => {
  const { machine, api, states, ready } = setup();
  await ready();
  expect(machine.getSnapshot().state).toEqual({ type: 'readyForCode', requireCode: true });
  await machine.submit('123456');
  expect(api.checkin).toHaveBeenCalledWith(id, { code: '123456', latitude: 10, longitude: 106,
    accuracyMeters: 20, capturedAt: new Date(now).toISOString(), mockProvider: true, installationId: 'installation' });
  expect(machine.getSnapshot().state).toEqual({ type: 'accepted', status: 'ATTENDED' });
  expect(states).toEqual(expect.arrayContaining(['idle', 'needsPermission', 'acquiringFix', 'readyForCode', 'submitting', 'accepted']));
  expect(JSON.stringify(machine.getSnapshot())).not.toMatch(/latitude|longitude|123456"/);
});
test.each(['PENDING_REVIEW', 'REJECTED'] as const)('maps result %s', async (decision) => {
  const { machine, api, ready } = setup();
  api.checkin.mockResolvedValue({ decision, status: null, message: 'reason' });
  await ready(); await machine.submit('123456');
  expect(machine.getSnapshot().state.type).toBe(decision === 'PENDING_REVIEW' ? 'pendingReview' : 'rejected');
});
test.each<[AttendanceErrorCode, string, number]>([
  ['INVALID_LOCATION', 'rejected', 400], ['NOT_ENROLLED', 'notEnrolled', 403],
  ['CONSENT_REQUIRED', 'needsConsent', 403], ['ALREADY_CHECKED_IN', 'alreadyCheckedIn', 409],
  ['SESSION_CLOSED', 'sessionClosed', 410], ['BAD_CODE', 'rejected', 422],
  ['OUTSIDE_AREA', 'rejected', 422], ['LOW_ACCURACY', 'lowAccuracy', 422],
  ['TOO_MANY_ATTEMPTS', 'tooManyAttempts', 429], ['NETWORK_ERROR', 'networkError', 0],
  ['UNKNOWN', 'error', 401], ['UNKNOWN', 'networkError', 503],
])('maps server %s to %s without automatic retries', async (code, state, status) => {
  const { machine, api, ready } = setup();
  api.checkin.mockRejectedValue(new AttendanceApiError(code, status, code === 'NETWORK_ERROR', 123));
  await ready();
  api.getConsent.mockResolvedValue({ accepted: false, version: 'new-version', acceptedAt: null });
  await machine.submit('123456');
  expect(machine.getSnapshot().state.type).toBe(state);
  if (code === 'TOO_MANY_ATTEMPTS') expect(machine.getSnapshot().state).toEqual({ type: state, retryAfterSeconds: 123 });
  if (code === 'NETWORK_ERROR') expect(machine.getSnapshot().state).toEqual({ type: state, retryable: true });
  await machine.submit('123456');
  expect(api.checkin).toHaveBeenCalledTimes(1);
});
test.each<[LocationErrorCode, string]>([
  ['PERMISSION_DENIED', 'needsPermission'], ['PERMISSION_BLOCKED', 'permissionBlocked'],
  ['SERVICES_OFF', 'servicesOff'], ['LOW_ACCURACY', 'lowAccuracy'],
  ['TIMEOUT', 'error'], ['STALE_FIX', 'error'],
])('maps native %s to %s', async (code, state) => {
  const { machine, location, api } = setup();
  location.getFreshFix.mockRejectedValue(new LocationServiceError(code));
  await machine.loadSessions(); await machine.selectSession(id); await machine.acquireLocation();
  expect(machine.getSnapshot().state.type).toBe(state);
  expect(api.checkin).not.toHaveBeenCalled();
});
test.each(['denied-can-ask', 'denied-blocked'] as const)('permission state %s prevents native GPS request', async (permission) => {
  const { machine, location } = setup(); location.ensurePermission.mockResolvedValue(permission);
  await machine.loadSessions(); await machine.selectSession(id); await machine.acquireLocation();
  expect(machine.getSnapshot().state.type).toBe(permission === 'denied-can-ask' ? 'needsPermission' : 'permissionBlocked');
  expect(location.getFreshFix).not.toHaveBeenCalled();
});
test('disabled GPS prevents acquisition', async () => {
  const { machine, location } = setup(); location.isServicesEnabled.mockResolvedValue(false);
  await machine.loadSessions(); await machine.selectSession(id); await machine.acquireLocation();
  expect(machine.getSnapshot().state.type).toBe('servicesOff');
  expect(location.getFreshFix).not.toHaveBeenCalled();
});
test('double submit is one physical request even across reset', async () => {
  const { machine, api, ready } = setup();
  const pending = deferred<Awaited<ReturnType<AttendanceApi['checkin']>>>();
  api.checkin.mockReturnValue(pending.promise);
  await ready();
  const first = machine.submit('123456');
  await Promise.resolve(); await Promise.resolve();
  await machine.submit('123456');
  expect(api.checkin).toHaveBeenCalledTimes(1);
  machine.reset(); await machine.loadSessions(); await machine.submit('123456');
  expect(api.checkin).toHaveBeenCalledTimes(1);
  pending.resolve({ decision: 'ACCEPTED', status: 'ATTENDED', message: '' }); await first;
  expect(machine.getSnapshot().state.type).toBe('idle');
});
test('reset clears session and position; returning requires another native fix', async () => {
  const { machine, location, ready } = setup();
  await ready(); machine.reset();
  expect(machine.getSnapshot()).toEqual({ state: { type: 'idle' }, sessions: [], selectedSession: null });
  await ready();
  expect(location.getFreshFix).toHaveBeenCalledTimes(2);
});
test('reset prevents a late native fix from reviving the flow', async () => {
  const { machine, location } = setup();
  const pending = deferred<Awaited<ReturnType<LocationProvider['getFreshFix']>>>();
  location.getFreshFix.mockReturnValue(pending.promise);
  await machine.loadSessions(); await machine.selectSession(id);
  const acquiring = machine.acquireLocation();
  await Promise.resolve(); await Promise.resolve();
  machine.reset(); pending.resolve({ latitude: 10, longitude: 106, accuracyMeters: 10, capturedAt: new Date(now).toISOString(), mocked: false });
  await acquiring;
  expect(machine.getSnapshot().state.type).toBe('idle');
});
test('account epoch changes invalidate pending reads and all visible old state', async () => {
  const { machine, api, switchIdentity } = setup();
  const pending = deferred<OpenAttendanceSession[]>(); api.openSessions.mockReturnValue(pending.promise);
  const loading = machine.loadSessions(); switchIdentity(); pending.resolve([session]); await loading;
  expect(machine.getSnapshot()).toEqual({ state: { type: 'idle' }, sessions: [], selectedSession: null });
});
test('an aged position is reacquired before the first POST', async () => {
  const { machine, location, ready, advance } = setup();
  await ready(); advance(30001); await machine.submit('123456');
  expect(location.getFreshFix).toHaveBeenCalledTimes(2);
});
test('failed attempts consume the position and require an explicit fresh acquisition', async () => {
  const { machine, location, api, ready } = setup(); api.checkin.mockRejectedValue(new AttendanceApiError('BAD_CODE', 422));
  await ready(); await machine.submit('123456'); await machine.submit('654321');
  expect(api.checkin).toHaveBeenCalledTimes(1);
  await machine.acquireLocation(); await machine.submit('654321');
  expect(api.checkin).toHaveBeenCalledTimes(2); expect(location.getFreshFix).toHaveBeenCalledTimes(2);
});
test('invalid code is refused locally without consuming the server quota', async () => {
  const { machine, api, ready } = setup(); await ready(); await machine.submit('12');
  expect(machine.getSnapshot().state).toEqual({ type: 'rejected', reason: 'BAD_CODE' });
  expect(api.checkin).not.toHaveBeenCalled();
});
test('code-free sessions omit code rather than accepting link-provided authority', async () => {
  const { machine, api, ready } = setup(); api.openSessions.mockResolvedValue([{ ...session, requireCode: false }]);
  await ready(); await machine.submit('ignored');
  expect(api.checkin.mock.calls[0][1]).not.toHaveProperty('code');
});
test('expired session is not submitted', async () => {
  const { machine, api, ready, advance } = setup(); await ready(); advance(600001); await machine.submit('123456');
  expect(machine.getSnapshot().state.type).toBe('sessionClosed'); expect(api.checkin).not.toHaveBeenCalled();
});
test('network error while loading is retryable and never silently queues', async () => {
  const { machine, api } = setup(); api.openSessions.mockRejectedValue(new TypeError('fetch failed'));
  await machine.loadSessions();
  expect(machine.getSnapshot().state).toEqual({ type: 'networkError', retryable: true });
  expect(api.openSessions).toHaveBeenCalledTimes(1);
});
test('failed consent read cannot be bypassed by requesting GPS from the error state', async () => {
  const { machine, api, location } = setup();
  api.getConsent.mockRejectedValue(new TypeError('offline'));
  await machine.loadSessions(); await machine.selectSession(id); await machine.acquireLocation();
  expect(machine.getSnapshot().state.type).toBe('networkError');
  expect(location.ensurePermission).not.toHaveBeenCalled();
});
test('identity change discards a completed check-in response', async () => {
  const { machine, api, switchIdentity, ready } = setup();
  const pending = deferred<Awaited<ReturnType<AttendanceApi['checkin']>>>();
  api.checkin.mockReturnValue(pending.promise);
  await ready(); const submitting = machine.submit('123456');
  await Promise.resolve(); await Promise.resolve();
  switchIdentity(); pending.resolve({ decision: 'ACCEPTED', status: 'ATTENDED', message: '' });
  await submitting;
  expect(machine.getSnapshot()).toEqual({ state: { type: 'idle' }, sessions: [], selectedSession: null });
});
test('leaving during the submitting notification prevents physical dispatch', async () => {
  const { machine, api, ready } = setup();
  await ready();
  machine.subscribe(({ state }) => { if (state.type === 'submitting') machine.reset(); });
  await machine.submit('123456');
  expect(api.checkin).not.toHaveBeenCalled();
  expect(machine.getSnapshot().state.type).toBe('idle');
});
test('leaving during acquisition notification prevents GPS acquisition', async () => {
  const { machine, location } = setup();
  await machine.loadSessions(); await machine.selectSession(id);
  machine.subscribe(({ state }) => { if (state.type === 'acquiringFix') machine.reset(); });
  await machine.acquireLocation();
  expect(location.getFreshFix).not.toHaveBeenCalled();
});
