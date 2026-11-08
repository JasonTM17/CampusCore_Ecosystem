import { afterEach, beforeEach, expect, jest, test } from '@jest/globals';

const mockSecure = new Map<string, string>();
const mockSandbox = new Map<string, string>();
let mockNetworkState: { isConnected?: boolean } = {};
let mockProbeCalls = 0;
jest.mock('expo-network', () => ({ getNetworkStateAsync: async () => {
  mockProbeCalls += 1;
  return mockNetworkState;
} }));
jest.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'device-only',
  getItemAsync: jest.fn(async (key: string) => mockSecure.get(key) ?? null),
  setItemAsync: jest.fn(async (key: string, value: string) => { mockSecure.set(key, value); }),
  deleteItemAsync: jest.fn(async (key: string) => { mockSecure.delete(key); }),
}));
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (key: string) => mockSandbox.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => { mockSandbox.set(key, value); }),
    removeItem: jest.fn(async (key: string) => { mockSandbox.delete(key); }),
  },
}));

import * as SecureStore from 'expo-secure-store';
import { signInWithOidc } from '../../src/auth/oidc-session';
import type { SessionStore } from '../../src/auth/session-store';

jest.mock('expo-auth-session/build/PKCE', () => ({
  buildCodeAsync: jest.fn(async () => ({ codeChallenge: 'challenge', codeVerifier: 'memory-verifier' })),
  generateRandom: () => 'state',
  generateHexStringAsync: async () => 'nonce',
}));
jest.mock('expo-web-browser', () => ({ openAuthSessionAsync: jest.fn() }));
import { buildCodeAsync } from 'expo-auth-session/build/PKCE';
import * as WebBrowser from 'expo-web-browser';

const originalIssuer = process.env.EXPO_PUBLIC_ISSUER_URL;
const originalLocal = process.env.EXPO_PUBLIC_ALLOW_CLEARTEXT_LOCAL;
const originalDev = __DEV__;
const originalFetch = global.fetch;

function binding(issuer: string): SessionStore {
  process.env.EXPO_PUBLIC_ISSUER_URL = issuer;
  let store!: SessionStore;
  jest.isolateModules(() => { store = require('../../src/auth/mobile-session-store').sessionStore; });
  return store;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSecure.clear();
  mockSandbox.clear();
  mockNetworkState = {};
  mockProbeCalls = 0;
  (globalThis as unknown as { __DEV__: boolean }).__DEV__ = false;
  delete process.env.EXPO_PUBLIC_ALLOW_CLEARTEXT_LOCAL;
  global.fetch = jest.fn(async () => new Response('{}', { status: 400 })) as typeof fetch;
});

afterEach(() => {
  (globalThis as unknown as { __DEV__: boolean }).__DEV__ = originalDev;
  global.fetch = originalFetch;
  if (originalIssuer === undefined) delete process.env.EXPO_PUBLIC_ISSUER_URL;
  else process.env.EXPO_PUBLIC_ISSUER_URL = originalIssuer;
  if (originalLocal === undefined) delete process.env.EXPO_PUBLIC_ALLOW_CLEARTEXT_LOCAL;
  else process.env.EXPO_PUBLIC_ALLOW_CLEARTEXT_LOCAL = originalLocal;
});

test('release native binding blocks remote HTTP before browser, PKCE, refresh and revoke dispatch', async () => {
  const store = binding('http://auth.example.com');
  expect(store.issuer).toBe('');
  await expect(signInWithOidc({ issuer: store.issuer })).resolves.toEqual({ kind: 'unavailable', code: 'issuer_not_configured' });
  expect(buildCodeAsync).not.toHaveBeenCalled();
  expect(WebBrowser.openAuthSessionAsync).not.toHaveBeenCalled();
  await store.saveRefresh('existing-refresh');
  await expect(store.refreshAccessToken()).resolves.toMatchObject({ kind: 'unavailable', reason: 'configuration' });
  expect(global.fetch).not.toHaveBeenCalled();
  await store.signOut();
  await Promise.resolve();
  expect(global.fetch).not.toHaveBeenCalled();
});

test('native binding retains an existing secure session and writes only device-only refresh material', async () => {
  mockSecure.set('cu.install', JSON.stringify({ appInstanceId: 'existing' }));
  mockSecure.set('cu.refresh', 'existing-refresh');
  mockSandbox.set('installMarker', JSON.stringify({ appInstanceId: 'existing' }));
  const store = binding('https://issuer.test');
  await expect(store.loadBootstrap()).resolves.toEqual({ refreshToken: 'existing-refresh', wipedForReinstall: false });
  await store.saveRefresh('replacement-refresh');
  expect(SecureStore.setItemAsync).toHaveBeenCalledWith('cu.refresh', 'replacement-refresh', { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
  store.setAccessToken('memory-access');
  await store.signOut();
  expect(store.getAccessToken()).toBeNull();
  expect(mockSecure.has('cu.refresh')).toBe(false);
  expect([...mockSandbox.entries()]).toEqual([['installMarker', JSON.stringify({ appInstanceId: 'existing', signedOut: true })]]);
});

test('native binding clears refresh and memory on a rejected rotation without persisting response tokens', async () => {
  const store = binding('https://issuer.test');
  await store.saveRefresh('existing-refresh');
  store.setAccessToken('memory-access');
  await expect(store.refreshAccessToken()).resolves.toMatchObject({ kind: 'signedOut' });
  expect(mockSecure.has('cu.refresh')).toBe(false);
  expect(store.getAccessToken()).toBeNull();
  expect(mockSandbox.size).toBe(0);
});

test('native binding uses the default connectivity probe before consuming a saved credential', async () => {
  const store = binding('https://issuer.test');
  mockNetworkState = { isConnected: false };
  await store.saveRefresh('existing-refresh');
  store.setAccessToken('memory-access');
  await expect(store.refreshAccessToken()).resolves.toEqual({ kind: 'unavailable', reason: 'offline', accessToken: null });
  expect(mockProbeCalls).toBe(1);
  expect(global.fetch).not.toHaveBeenCalled();
  expect(mockSecure.get('cu.refresh')).toBe('existing-refresh');
  expect(store.getAccessToken()).toBe('memory-access');
});

test('code, verifier and ID token stay inside the exchange while only refresh survives restart', async () => {
  const store = binding('https://issuer.test');
  await store.loadBootstrap();
  const jwt = (claims: object) => `e30.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.synthetic`;
  const idToken = jwt({ nonce: 'nonce', iss: store.issuer, aud: 'cu-mobile', sub: 'account', exp: Math.floor(Date.now() / 1000) + 600 });
  const exchange = jest.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    const form = new URLSearchParams(String(init?.body));
    expect(form.get('code')).toBe('memory-code');
    expect(form.get('code_verifier')).toBe('memory-verifier');
    return new Response(JSON.stringify({
      id_token: idToken,
      access_token: jwt({ roles: ['STUDENT'] }),
      refresh_token: 'restart-refresh',
    }), { status: 200 });
  });
  const outcome = await signInWithOidc({
    issuer: store.issuer,
    fetchImpl: exchange as typeof fetch,
    openSession: async () => ({ type: 'success', url: 'campuscore://auth/callback?code=memory-code&state=state' }),
  });
  expect(outcome.kind).toBe('signedIn');
  expect(outcome).not.toHaveProperty('idToken');
  expect(outcome).not.toHaveProperty('id_token');
  expect(outcome).not.toHaveProperty('codeVerifier');
  if (outcome.kind !== 'signedIn') throw new Error('sign-in did not complete');
  await store.saveRefresh(outcome.refreshToken);
  expect([...mockSecure.keys()].sort()).toEqual(['cu.install', 'cu.refresh']);
  expect([...mockSandbox.keys()]).toEqual(['installMarker']);
  const persisted = JSON.stringify([...mockSecure.entries(), ...mockSandbox.entries()]);
  for (const transient of ['memory-code', 'memory-verifier', idToken, outcome.accessToken]) {
    expect(persisted).not.toContain(transient);
  }
});
