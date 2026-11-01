import { expect, jest, test } from '@jest/globals';

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

test('an empty issuer returns the typed configuration outcome before opening native auth', async () => {
  await expect(signInWithOidc({ issuer: '' })).resolves.toEqual({
    kind: 'unavailable',
    code: 'issuer_not_configured',
  });
  expect(buildCodeAsync).not.toHaveBeenCalled();
  expect(WebBrowser.openAuthSessionAsync).not.toHaveBeenCalled();
});
