import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { fileURLToPath, pathToFileURL } from 'node:url';

const mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'campus-push-native-config-'));
const tokenCalls = [];
const permissionCalls = [];
globalThis.__campusPushHarness = {
  constants: {},
  notifications: {
    getPermissionsAsync: async () => {
      permissionCalls.push('get');
      return { granted: true, canAskAgain: true };
    },
    requestPermissionsAsync: async () => {
      permissionCalls.push('request');
      return { granted: true, canAskAgain: true };
    },
    getExpoPushTokenAsync: async (options) => {
      tokenCalls.push(options);
      return { data: '' };
    },
    setNotificationHandler: () => undefined,
  },
};

function writeStubPackage(name, source) {
  const packagePath = path.join(tempRoot, 'node_modules', ...name.split('/'));
  fs.mkdirSync(packagePath, { recursive: true });
  fs.writeFileSync(path.join(packagePath, 'package.json'), JSON.stringify({
    name,
    type: 'module',
    exports: './index.js',
  }));
  fs.writeFileSync(path.join(packagePath, 'index.js'), source);
}

function transpileMobileSource(sourcePath, outputName) {
  const source = fs.readFileSync(path.join(mobileRoot, sourcePath), 'utf8');
  const result = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    fileName: path.basename(sourcePath),
  });
  const outputPath = path.join(tempRoot, outputName);
  fs.writeFileSync(outputPath, result.outputText);
  return outputPath;
}

writeStubPackage('@react-native-async-storage/async-storage', 'export default { getItem: async () => null };');
writeStubPackage('expo-secure-store', 'export const getItemAsync = async () => null;');
writeStubPackage('react-native', "export const Platform = { OS: 'android' };");
writeStubPackage('expo-constants', `
  const constants = new Proxy({}, {
    get: (_target, key) => globalThis.__campusPushHarness.constants[key],
  });
  export default constants;
`);
writeStubPackage('expo-notifications', `
  export const getPermissionsAsync = (...args) => globalThis.__campusPushHarness.notifications.getPermissionsAsync(...args);
  export const requestPermissionsAsync = (...args) => globalThis.__campusPushHarness.notifications.requestPermissionsAsync(...args);
  export const getExpoPushTokenAsync = (...args) => globalThis.__campusPushHarness.notifications.getExpoPushTokenAsync(...args);
  export const setNotificationHandler = (...args) => globalThis.__campusPushHarness.notifications.setNotificationHandler(...args);
`);

const platformModule = await import(pathToFileURL(
  transpileMobileSource('src/api/expo-push-platform.ts', 'expo-push-platform.mjs'),
).href);
const pushModule = await import(pathToFileURL(
  transpileMobileSource('src/api/push-notifications.ts', 'push-notifications.mjs'),
).href);

after(() => {
  delete globalThis.__campusPushHarness;
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

test('push token getter rejects missing and malformed project IDs before token access', async () => {
  globalThis.__campusPushHarness.constants = {};
  await assert.rejects(platformModule.expoPushPlatform.getPushToken(), /EXPO_PROJECT_ID_MISSING/);
  assert.deepEqual(tokenCalls, []);

  globalThis.__campusPushHarness.constants = {
    expoConfig: { extra: { eas: { projectId: 'not-an-eas-project-id' } } },
  };
  await assert.rejects(platformModule.expoPushPlatform.getPushToken(), /EXPO_PROJECT_ID_INVALID/);
  assert.deepEqual(tokenCalls, []);
});

test('final permission denial reaches settings path without another prompt or push registration', async () => {
  permissionCalls.length = 0;
  globalThis.__campusPushHarness.notifications.getPermissionsAsync = async () => {
    permissionCalls.push('get');
    return { granted: false, canAskAgain: false };
  };
  const permission = await platformModule.expoPushPlatform.getPermissionsAsync();
  assert.deepEqual(permission, { granted: false, canAskAgain: false });

  const apiCalls = [];
  const client = pushModule.createPushNotificationClient(platformModule.expoPushPlatform, {
    registerPushDevice: async (...args) => apiCalls.push(args),
    unregisterPushDevice: async () => undefined,
  });
  assert.deepEqual(await client.register(true), { status: 'permission-denied' });
  assert.deepEqual(permissionCalls, ['get', 'get']);
  assert.deepEqual(apiCalls, []);
  assert.deepEqual(tokenCalls, []);

  const screen = fs.readFileSync(
    path.join(mobileRoot, 'src/screens/student/NotificationsScreen.tsx'),
    'utf8',
  );
  assert.match(screen, /setDenialBlocked\(permission\?\.canAskAgain === false\)/);
  assert.match(screen, /Linking\.openSettings\(\)/);
});

test('push stays disabled while the authenticated inbox target fallback remains available', async () => {
  const featureFlags = fs.readFileSync(path.join(mobileRoot, 'src/config/features.ts'), 'utf8');
  assert.match(featureFlags, /PUSH_OPT_IN_ENABLED = false/);

  const allowedPaths = ['/(app)/notifications/42'];
  const fetchedIds = [];
  assert.equal(await pushModule.resolveNotificationTarget(
    'inbox-entry-42',
    async (id) => {
      fetchedIds.push(id);
      return { targetPath: allowedPaths[0] };
    },
    allowedPaths,
  ), allowedPaths[0]);
  assert.deepEqual(fetchedIds, ['inbox-entry-42']);
  assert.equal(await pushModule.resolveNotificationTarget(
    'external-target',
    async () => ({ targetPath: 'https://example.invalid/path' }),
    allowedPaths,
  ), null);
});

test('notifications module manifest supplies Android POST_NOTIFICATIONS without app permission duplication', () => {
  const appConfig = JSON.parse(fs.readFileSync(path.join(mobileRoot, 'app.json'), 'utf8'));
  const moduleManifest = fs.readFileSync(
    path.join(mobileRoot, 'node_modules/expo-notifications/android/src/main/AndroidManifest.xml'),
    'utf8',
  );
  const appPermissions = appConfig.expo.android.permissions ?? [];
  const modulePermissionCount = moduleManifest.match(/android\.permission\.POST_NOTIFICATIONS/g)?.length ?? 0;

  assert.equal(modulePermissionCount, 1);
  assert.equal(appPermissions.includes('android.permission.POST_NOTIFICATIONS'), false);
});

test('Android cleartext manifest plugin is selected only by the explicit local profile', async () => {
  const require = createRequire(import.meta.url);
  const appConfig = require('../app.config.js');
  const withLocalCleartextTraffic = require('../plugins/with-local-cleartext-traffic.js');
  const appJson = JSON.parse(fs.readFileSync(path.join(mobileRoot, 'app.json'), 'utf8'));
  const eas = JSON.parse(fs.readFileSync(path.join(mobileRoot, 'eas.json'), 'utf8'));
  const localProfile = eas.build.local;
  assert.equal(localProfile.developmentClient, false);
  assert.equal(localProfile.distribution, 'internal');
  assert.equal(localProfile.android.buildType, 'apk');
  assert.equal(localProfile.env.CAMPUSUTE_MOBILE_PROFILE, 'local');
  assert.equal(localProfile.env.EXPO_PUBLIC_API_MODE, 'live');
  assert.equal(localProfile.env.EXPO_PUBLIC_API_URL, 'http://10.0.2.2:4010/api/v1');
  assert.equal(localProfile.env.EXPO_PUBLIC_ALLOW_CLEARTEXT_LOCAL, '1');
  assert.equal(eas.build.preview.env, undefined);
  assert.equal(eas.build.production.env, undefined);
  const previousProfile = process.env.CAMPUSUTE_MOBILE_PROFILE;
  const previousAllowCleartextLocal = process.env.EXPO_PUBLIC_ALLOW_CLEARTEXT_LOCAL;
  try {
    process.env.CAMPUSUTE_MOBILE_PROFILE = 'local';
    process.env.EXPO_PUBLIC_ALLOW_CLEARTEXT_LOCAL = '1';
    const localConfig = appConfig({ config: appJson.expo });
    assert.ok(localConfig.plugins.includes('./plugins/with-local-cleartext-traffic'));

    const manifestConfig = withLocalCleartextTraffic({ mods: {} });
    const result = await manifestConfig.mods.android.manifest({
      modResults: { manifest: { application: [{ $: {} }] } },
    });
    assert.equal(result.modResults.manifest.application[0].$['android:usesCleartextTraffic'], 'true');

    process.env.CAMPUSUTE_MOBILE_PROFILE = 'production';
    const productionConfig = appConfig({ config: appJson.expo });
    assert.equal(productionConfig.plugins.includes('./plugins/with-local-cleartext-traffic'), false);
    assert.equal(appJson.expo.android.usesCleartextTraffic, undefined);

    process.env.CAMPUSUTE_MOBILE_PROFILE = 'preview';
    const previewConfig = appConfig({ config: appJson.expo });
    assert.equal(previewConfig.plugins.includes('./plugins/with-local-cleartext-traffic'), false);

    process.env.CAMPUSUTE_MOBILE_PROFILE = 'local';
    delete process.env.EXPO_PUBLIC_ALLOW_CLEARTEXT_LOCAL;
    const unoptedLocalConfig = appConfig({ config: appJson.expo });
    assert.equal(unoptedLocalConfig.plugins.includes('./plugins/with-local-cleartext-traffic'), false);
  } finally {
    if (previousProfile === undefined) delete process.env.CAMPUSUTE_MOBILE_PROFILE;
    else process.env.CAMPUSUTE_MOBILE_PROFILE = previousProfile;
    if (previousAllowCleartextLocal === undefined) delete process.env.EXPO_PUBLIC_ALLOW_CLEARTEXT_LOCAL;
    else process.env.EXPO_PUBLIC_ALLOW_CLEARTEXT_LOCAL = previousAllowCleartextLocal;
  }
});
