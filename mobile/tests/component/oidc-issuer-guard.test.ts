import { beforeEach, expect, jest, test } from '@jest/globals';

jest.mock('expo-auth-session/build/PKCE', () => ({
  buildCodeAsync: jest.fn(async () => ({ codeChallenge: 'challenge', codeVerifier: 'verifier' })),
  generateHexStringAsync: jest.fn(async () => 'nonce'),
  generateRandom: jest.fn(() => 'state'),
}));
jest.mock('expo-web-browser', () => ({
  openAuthSessionAsync: jest.fn(async () => ({ type: 'cancel' })),
}));

import { buildCodeAsync } from 'expo-auth-session/build/PKCE';
import * as WebBrowser from 'expo-web-browser';
import { signInWithOidc } from '../../src/auth/oidc-session';

beforeEach(() => { jest.clearAllMocks(); });

test('a token exchange that never answers aborts at the app deadline', async () => {
  const fetchImpl = jest.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
  }));
  const pending = signInWithOidc({
    issuer: 'https://issuer.test',
    fetchImpl: fetchImpl as unknown as typeof fetch,
    timeoutMs: 20,
    openSession: async () => ({
      type: 'success',
      url: 'campuscore://auth/callback?code=abc&state=state',
    }) as never,
  });
  const settled = await Promise.race([
    pending.then(() => 'resolved', () => 'rejected'),
    new Promise((resolve) => setTimeout(() => resolve('pending'), 500)),
  ]);
  expect(settled).toBe('rejected');
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
});

test('an empty issuer returns the typed configuration outcome before opening native auth', async () => {
  await expect(signInWithOidc({ issuer: '' })).resolves.toEqual({
    kind: 'unavailable',
    code: 'issuer_not_configured',
  });
  expect(buildCodeAsync).not.toHaveBeenCalled();
  expect(WebBrowser.openAuthSessionAsync).not.toHaveBeenCalled();
});
