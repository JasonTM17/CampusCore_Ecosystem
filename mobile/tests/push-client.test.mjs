import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import { fileURLToPath, pathToFileURL } from 'node:url';

const mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'campus-push-client-'));
const source = fs.readFileSync(path.join(mobileRoot, 'src/api/push-notifications.ts'), 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  fileName: 'push-notifications.ts',
});
fs.writeFileSync(path.join(tempRoot, 'push-notifications.mjs'), outputText);
const {
  createPushNotificationClient,
  resolveNotificationTarget,
  unregisterPushBestEffort,
} = await import(pathToFileURL(path.join(tempRoot, 'push-notifications.mjs')).href);

const INSTALLATION_ID = 'install-from-existing-marker';

function makePlatform(overrides = {}) {
  const calls = [];
  const platform = {
    provider: 'EXPO',
    platform: 'ANDROID',
    getInstallationId: async () => { calls.push('installation-id'); return INSTALLATION_ID; },
    getPermissionsAsync: async () => { calls.push('get-permission'); return { granted: true }; },
    requestPermissionsAsync: async () => { calls.push('request-permission'); return { granted: true }; },
    getPushToken: async () => { calls.push('get-token'); return 'ExponentPushToken[synthetic]'; },
    ...overrides,
  };
  return { platform, calls };
}

function makeApi(overrides = {}) {
  const calls = [];
  const api = {
    registerPushDevice: async (installationId, body) => {
      calls.push({ kind: 'register', installationId, body });
      return { installationId, provider: body.provider, platform: body.platform, status: 'ACTIVE' };
    },
    unregisterPushDevice: async (installationId, accessToken) => {
      calls.push({ kind: 'unregister', installationId, accessToken });
    },
    ...overrides,
  };
  return { api, calls };
}

test('push opt-in does not even inspect permission until user confirmation', async () => {
  const { platform, calls: platformCalls } = makePlatform();
  const { api, calls: apiCalls } = makeApi();
  const client = createPushNotificationClient(platform, api);
  assert.deepEqual(await client.register(false), { status: 'confirmation-required' });
  assert.deepEqual(platformCalls, []);
  assert.deepEqual(apiCalls, []);
});

test('permission denial stops before token access and registration', async () => {
  const { platform, calls } = makePlatform({
    getPermissionsAsync: async () => { calls.push('get-permission'); return { granted: false, canAskAgain: true }; },
    requestPermissionsAsync: async () => { calls.push('request-permission'); return { granted: false, canAskAgain: false }; },
  });
  const { api, calls: apiCalls } = makeApi();
  const client = createPushNotificationClient(platform, api);
  assert.deepEqual(await client.register(true), { status: 'permission-denied' });
  assert.deepEqual(calls, ['get-permission', 'request-permission']);
  assert.deepEqual(apiCalls, []);

  const unavailable = createPushNotificationClient({ ...platform, platform: null }, api);
  assert.deepEqual(await unavailable.register(true), { status: 'unavailable' });
});

test('registration and explicit unregistration use the existing installation id', async () => {
  const { platform, calls: platformCalls } = makePlatform();
  const { api, calls: apiCalls } = makeApi();
  const client = createPushNotificationClient(platform, api);
  assert.deepEqual(await client.register(true), { status: 'registered', installationId: INSTALLATION_ID });
  assert.equal(apiCalls[0].kind, 'register');
  assert.equal(apiCalls[0].installationId, INSTALLATION_ID);
  assert.deepEqual(apiCalls[0].body, {
    provider: 'EXPO',
    platform: 'ANDROID',
    token: 'ExponentPushToken[synthetic]',
  });
  assert.deepEqual(platformCalls, ['get-permission', 'installation-id', 'get-token']);
  assert.equal(await client.unregister(), true);
  assert.equal(apiCalls[1].kind, 'unregister');
  assert.equal(apiCalls[1].installationId, INSTALLATION_ID);
});

test('notification route is fetched from the inbox and exact allowlist matching fails closed', async () => {
  const calls = [];
  const fetchNotification = async (id) => {
    calls.push(id);
    return { targetPath: '/(app)/notifications/42' };
  };
  const allowed = ['/(app)/notifications/42'];
  assert.equal(await resolveNotificationTarget('notice-42', fetchNotification, allowed), allowed[0]);
  assert.deepEqual(calls, ['notice-42']);

  assert.equal(await resolveNotificationTarget(
    'forged-external',
    async () => ({ targetPath: 'https://evil.example/path' }),
    allowed,
  ), null);
  assert.equal(await resolveNotificationTarget(
    'not-allowed',
    async () => ({ targetPath: '/(app)/admin' }),
    allowed,
  ), null);
  assert.equal(await resolveNotificationTarget(
    'protocol-relative',
    async () => ({ targetPath: '//evil.example/path' }),
    ['//evil.example/path'],
  ), null);
  assert.equal(await resolveNotificationTarget(
    'backslash',
    async () => ({ targetPath: '/\\evil.example/path' }),
    ['/\\evil.example/path'],
  ), null);
  assert.equal(await resolveNotificationTarget('without-target', async () => ({}), allowed), null);
});

test('best-effort unregister passes the pre-wipe token snapshot and never throws', async () => {
  const { api, calls } = makeApi();
  assert.doesNotThrow(() => unregisterPushBestEffort(api, INSTALLATION_ID, 'access-token-snapshot'));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls[0], {
    kind: 'unregister',
    installationId: INSTALLATION_ID,
    accessToken: 'access-token-snapshot',
  });

  const throwingApi = {
    unregisterPushDevice() {
      throw new Error('opaque provider failure');
    },
  };
  assert.doesNotThrow(() => unregisterPushBestEffort(throwingApi, INSTALLATION_ID, 'snapshot'));
  const rejectingApi = { unregisterPushDevice: async () => { throw new Error('opaque provider failure'); } };
  assert.doesNotThrow(() => unregisterPushBestEffort(rejectingApi, INSTALLATION_ID, 'snapshot'));
  assert.doesNotThrow(() => unregisterPushBestEffort(api, INSTALLATION_ID, null));
});

test('adapter reads only the pre-existing install marker and does not add storage keys', () => {
  const adapter = fs.readFileSync(path.join(mobileRoot, 'src/api/expo-push-platform.ts'), 'utf8');
  const store = fs.readFileSync(path.join(mobileRoot, 'src/auth/session-store.ts'), 'utf8');
  const clientSource = fs.readFileSync(path.join(mobileRoot, 'src/api/client.ts'), 'utf8');
  assert.match(adapter, /await import\('expo-notifications'\)/);
  assert.match(adapter, /'cu\.install'/);
  assert.match(adapter, /'installMarker'/);
  assert.match(adapter, /secureId !== sandboxId/);
  assert.doesNotMatch(adapter, /setItemAsync|\.setItem\(|deleteItemAsync|\.removeItem\(/);
  assert.match(store, /const REFRESH_KEY = 'cu\.refresh'/);
  assert.match(store, /const INSTALL_KEY = 'cu\.install'/);
  assert.match(store, /const MARKER_KEY = 'installMarker'/);
  assert.match(clientSource, /registerPushDevice:[\s\S]*?apiClient\.put<PushDeviceRegistrationResponse>/);
  assert.match(clientSource, /unregisterPushDevice:[\s\S]*?apiClient\.delete<void>/);
  assert.equal((clientSource.match(/`\$\{apiRoutes\.notifications\}\/devices\/\$\{encodeURIComponent\(installationId\)\}`/g) ?? []).length, 2);
  assert.match(clientSource, /Authorization: `Bearer \$\{accessToken\}`/);
});
