import { expect, jest, test } from '@jest/globals';
import { createLocationProvider, type LocationSource } from '../../src/attendance-checkin/location-service';

const now = 1800000000000;
function raw(accuracy = 20, timestamp = now, mocked = false) {
  return { coords: { latitude: 10, longitude: 106, accuracy }, timestamp, mocked };
}
function setup(overrides: Partial<LocationSource> = {}, platform: 'android' | 'ios' = 'android') {
  const source: LocationSource = {
    permission: async () => ({ granted: true, canAskAgain: true }),
    requestPermission: async () => ({ granted: false, canAskAgain: true }),
    servicesEnabled: async () => true,
    currentPosition: jest.fn<LocationSource['currentPosition']>().mockResolvedValue(raw()),
    ...overrides,
  };
  return { source, provider: createLocationProvider(source, { platform, now: () => now }) };
}
test.each([now - 30001, now + 10001, NaN])('rejects stale/future/invalid timestamp %s', async (timestamp) => {
  await expect(setup({ currentPosition: async () => raw(10, timestamp) }).provider.getFreshFix())
    .rejects.toMatchObject({ code: 'STALE_FIX' });
});
test.each([now - 30000, now + 10000])('accepts the exact freshness boundary %s', async (timestamp) => {
  await expect(setup({ currentPosition: async () => raw(10, timestamp) }).provider.getFreshFix())
    .resolves.toMatchObject({ capturedAt: new Date(timestamp).toISOString() });
});
test('caller cannot increase the thirty-second age limit', async () => {
  await expect(setup({ currentPosition: async () => raw(10, now - 31000) }).provider.getFreshFix({ maxAgeMs: 60000 }))
    .rejects.toMatchObject({ code: 'STALE_FIX' });
});
test('three high-accuracy requests keep the best fix and mock signal across refinements', async () => {
  const currentPosition = jest.fn<LocationSource['currentPosition']>()
    .mockResolvedValueOnce(raw(95, now, true)).mockResolvedValueOnce(raw(60)).mockResolvedValueOnce(raw(80));
  const { provider } = setup({ currentPosition, providerStatus: async () => ({ gpsAvailable: true }) });
  await expect(provider.getFreshFix()).resolves.toMatchObject({ accuracyMeters: 60, mocked: true, provider: { gpsAvailable: true } });
  expect(currentPosition).toHaveBeenCalledTimes(3);
});
test('stops refinement when accuracy reaches fifty metres', async () => {
  const currentPosition = jest.fn<LocationSource['currentPosition']>().mockResolvedValueOnce(raw(80)).mockResolvedValue(raw(50));
  await setup({ currentPosition }).provider.getFreshFix();
  expect(currentPosition).toHaveBeenCalledTimes(2);
});
test('does not reuse a previous invocation position', async () => {
  const { provider, source } = setup();
  await provider.getFreshFix(); await provider.getFreshFix();
  expect(source.currentPosition).toHaveBeenCalledTimes(2);
});
test.each([101, null, -1])('rejects unusable accuracy %s after at most three fixes', async (accuracy) => {
  const currentPosition = jest.fn<LocationSource['currentPosition']>().mockResolvedValue({ ...raw(), coords: { latitude: 10, longitude: 106, accuracy } });
  await expect(setup({ currentPosition }).provider.getFreshFix()).rejects.toMatchObject({ code: 'LOW_ACCURACY' });
  expect(currentPosition).toHaveBeenCalledTimes(3);
});
test('iOS reports mocked false', async () => {
  await expect(setup({ currentPosition: async () => raw(10, now, true) }, 'ios').provider.getFreshFix())
    .resolves.toMatchObject({ mocked: false });
});
test.each<[string, boolean, string]>([
  ['denied-can-ask', true, 'PERMISSION_DENIED'], ['denied-blocked', false, 'PERMISSION_BLOCKED'],
])('exposes permission %s without acquiring a fix', async (state, canAskAgain, code) => {
  const { provider, source } = setup({ permission: async () => ({ granted: false, canAskAgain }) });
  expect(await provider.ensurePermission()).toBe(state);
  await expect(provider.getFreshFix()).rejects.toMatchObject({ code });
  expect(source.currentPosition).not.toHaveBeenCalled();
});
test('requests permission when possible and proceeds on grant', async () => {
  const requestPermission = jest.fn<LocationSource['requestPermission']>().mockResolvedValue({ granted: true, canAskAgain: true });
  const { provider } = setup({ permission: async () => ({ granted: false, canAskAgain: true }), requestPermission });
  expect(await provider.ensurePermission()).toBe('granted');
  expect(requestPermission).toHaveBeenCalledTimes(1);
});
test('services off is distinct from permission denied', async () => {
  const { provider, source } = setup({ servicesEnabled: async () => false });
  expect(await provider.isServicesEnabled()).toBe(false);
  await expect(provider.getFreshFix()).rejects.toMatchObject({ code: 'SERVICES_OFF' });
  expect(source.currentPosition).not.toHaveBeenCalled();
});
test('one overall timeout bounds a hung native provider', async () => {
  await expect(setup({ currentPosition: () => new Promise(() => {}) }).provider.getFreshFix({ timeoutMs: 5 }))
    .rejects.toMatchObject({ code: 'TIMEOUT' });
});
test('timeout during refinement returns a usable best fix', async () => {
  const currentPosition = jest.fn<LocationSource['currentPosition']>().mockResolvedValueOnce(raw(70))
    .mockImplementation(() => new Promise(() => {}));
  await expect(setup({ currentPosition }).provider.getFreshFix({ timeoutMs: 5 })).resolves.toMatchObject({ accuracyMeters: 70 });
});
test('timeout during poor refinement yields low accuracy', async () => {
  const currentPosition = jest.fn<LocationSource['currentPosition']>().mockResolvedValueOnce(raw(110))
    .mockImplementation(() => new Promise(() => {}));
  await expect(setup({ currentPosition }).provider.getFreshFix({ timeoutMs: 5 })).rejects.toMatchObject({ code: 'LOW_ACCURACY' });
});
