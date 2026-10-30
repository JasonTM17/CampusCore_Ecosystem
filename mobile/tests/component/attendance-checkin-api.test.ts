import { expect, jest, test } from '@jest/globals';
import { createAttendanceApi, createNativeAttendanceApi, createSingleAttemptRequest, normalizeAttendanceError, parseRetryAfter,
  type AttendanceRequest, type CheckinBody } from '../../src/attendance-checkin/attendance-api';
import { createInstallationIdStore, INSTALLATION_ID_KEY } from '../../src/attendance-checkin/installation-id';
import { apiClient } from '../../src/api/client';
import { sessionStore } from '../../src/auth/mobile-session-store';

jest.mock('../../src/auth/mobile-session-store', () => {
  const { jest } = require('@jest/globals');
  return { sessionStore: {
    getAccessToken: jest.fn(() => 'test-access'), sessionEpoch: jest.fn(() => 1),
    refreshAccessToken: jest.fn(), setAccessToken: jest.fn(),
  } };
});

const id = '12345678-1234-4abc-8def-123456789abc';
const body: CheckinBody = { code: '123456', latitude: 10, longitude: 106, accuracyMeters: 20,
  capturedAt: new Date(1800000000000).toISOString(), mockProvider: true, installationId: id };
test('thin facade calls exact endpoints and bodies without caching the POST', async () => {
  const request = jest.fn<AttendanceRequest>().mockResolvedValue(undefined);
  const transport: AttendanceRequest = async <T>(...args: Parameters<AttendanceRequest>) => await request(...args) as T;
  const api = createAttendanceApi({ request: transport }, transport);
  await api.openSessions(); await api.getConsent(); await api.acceptConsent('server-9'); await api.checkin(id, body);
  expect(request.mock.calls.map(([path]) => path)).toEqual(['/attendance/sessions/open',
    '/attendance/location-consent', '/attendance/location-consent', `/attendance/sessions/${id}/checkin`]);
  expect(request.mock.calls[2][1]?.body).toBe(JSON.stringify({ version: 'server-9' }));
  expect(request.mock.calls[3][1]).toMatchObject({ method: 'POST', body: JSON.stringify(body), cache: 'no-store' });
});
test('Retry-After parses seconds, HTTP dates and missing/invalid values', () => {
  expect(parseRetryAfter('125')).toBe(125);
  expect(parseRetryAfter('Thu, 29 Oct 2026 12:00:20 GMT', Date.parse('2026-10-29T12:00:00Z'))).toBe(20);
  expect(parseRetryAfter(null)).toBeNull(); expect(parseRetryAfter('nonsense')).toBeNull();
});
test('normalization never exposes raw provider text or private fields', () => {
  const error = normalizeAttendanceError({ code: 'OUTSIDE_AREA', status: 422, message: 'private diagnostic' });
  expect(error.code).toBe('OUTSIDE_AREA'); expect(error.message).toBe('OUTSIDE_AREA');
  expect(normalizeAttendanceError(new TypeError('private diagnostic')).code).toBe('NETWORK_ERROR');
});
test.each([401, 429, 503])('single attempt preserves failure %s without refresh or replay', async (status) => {
  const fetchImpl = jest.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
    code: status === 429 ? 'TOO_MANY_ATTEMPTS' : 'OTHER',
  }), { status, headers: { 'Retry-After': '47' } }));
  const request = createSingleAttemptRequest({ baseUrl: 'https://example.test/api/v1',
    getAccessToken: () => 'test-access', sessionEpoch: () => 1, fetchImpl });
  await expect(request('/attendance/sessions/example/checkin', { method: 'POST', body: JSON.stringify(body) }))
    .rejects.toMatchObject({ status, retryAfterSeconds: 47 });
  expect(fetchImpl).toHaveBeenCalledTimes(1);
  expect(fetchImpl.mock.calls[0][1]).toMatchObject({ redirect: 'error' });
});
test('single attempt never dispatches while signed out', async () => {
  const fetchImpl = jest.fn<typeof fetch>();
  const request = createSingleAttemptRequest({ baseUrl: 'https://example.test', getAccessToken: () => null, sessionEpoch: () => 1, fetchImpl });
  await expect(request('/checkin')).rejects.toMatchObject({ status: 401 });
  expect(fetchImpl).not.toHaveBeenCalled();
});
test('late responses from another account are discarded', async () => {
  let epoch = 1;
  const fetchImpl = jest.fn<typeof fetch>().mockImplementation(async () => {
    epoch += 1; return new Response(JSON.stringify({ decision: 'ACCEPTED' }));
  });
  const request = createSingleAttemptRequest({ baseUrl: 'https://example.test', getAccessToken: () => 'test-access', sessionEpoch: () => epoch, fetchImpl });
  await expect(request('/checkin')).rejects.toMatchObject({ code: 'UNKNOWN' });
});
test('installation UUID is single-flight, secure-store backed and stable across store instances', async () => {
  const memory = new Map<string, string>();
  const secure = { getItemAsync: async (key: string) => memory.get(key) ?? null,
    setItemAsync: jest.fn(async (key: string, value: string) => { memory.set(key, value); }) };
  const uuid = jest.fn(() => id);
  const store = createInstallationIdStore(secure, uuid);
  expect(await Promise.all([store.getInstallationId(), store.getInstallationId()])).toEqual([id, id]);
  expect(await createInstallationIdStore(secure, uuid).getInstallationId()).toBe(id);
  expect(memory.get(INSTALLATION_ID_KEY)).toBe(id); expect(uuid).toHaveBeenCalledTimes(1);
  expect(secure.setItemAsync).toHaveBeenCalledTimes(1);
});
test('installation ID fails closed when randomness is unavailable', async () => {
  const store = createInstallationIdStore({ getItemAsync: async () => null, setItemAsync: async () => {} }, () => 'weak-id');
  await expect(store.getInstallationId()).rejects.toThrow('INSTALLATION_ID_UNAVAILABLE');
});

test('consent version rejection retains its dedicated code', () => {
  expect(normalizeAttendanceError({ status: 400, code: 'INVALID_CONSENT_VERSION' }).code)
    .toBe('INVALID_CONSENT_VERSION');
});

test.each([true, false])('native POST 401 uses shared auth recovery (refresh succeeds: %s) without replay', async (refreshed) => {
  const originalFetch = globalThis.fetch;
  const expired = jest.fn();
  const refresh = jest.mocked(sessionStore.refreshAccessToken);
  refresh.mockResolvedValue({ accessToken: refreshed ? 'test-rotated' : null } as Awaited<ReturnType<typeof sessionStore.refreshAccessToken>>);
  const beforeRefresh = refresh.mock.calls.length;
  apiClient.setOnSessionExpired(expired);
  const fetchImpl = jest.fn<typeof fetch>()
    .mockResolvedValueOnce(new Response('{}', { status: 401 }))
    .mockResolvedValueOnce(new Response('{}', { status: 401 }))
    .mockResolvedValueOnce(new Response('{}', { status: 200 }));
  globalThis.fetch = fetchImpl;
  try {
    await expect(createNativeAttendanceApi().checkin(id, body))
      .rejects.toMatchObject({ code: 'AUTH_RECOVERY', status: 401 });
    expect(refresh.mock.calls.length - beforeRefresh).toBe(1);
    expect(expired).toHaveBeenCalledTimes(refreshed ? 0 : 1);
    expect(fetchImpl.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
    expect(fetchImpl.mock.calls.slice(1).every(([url, init]) =>
      String(url).endsWith('/auth/me') && init?.method === 'GET')).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(refreshed ? 3 : 2);
  } finally {
    globalThis.fetch = originalFetch;
    apiClient.setOnSessionExpired(undefined);
  }
});
