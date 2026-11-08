import { describe, expect, jest, test } from '@jest/globals';

jest.mock('expo-auth-session/build/PKCE', () => ({
  buildCodeAsync: async () => ({ codeChallenge: 'challenge', codeVerifier: 'verifier' }),
  generateHexStringAsync: async () => 'nonce',
  generateRandom: () => 'state',
}));
jest.mock('expo-web-browser', () => ({ openAuthSessionAsync: jest.fn() }));

import { OIDC_CLIENT_ID, OIDC_REDIRECT_URI } from '../../src/auth/oidc-core';
import { signInWithOidc } from '../../src/auth/oidc-session';

const b64url = (value: unknown) =>
  Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url');
const jwt = (payload: Record<string, unknown>) => `${b64url({ alg: 'none' })}.${b64url(payload)}.sig`;

const ISSUER = 'http://issuer.test';
const NOW = 1_800_000_000_000;

function completion(accessClaims: Record<string, unknown>) {
  let idToken = '';
  return {
    now: () => NOW,
    openSession: async (url: string) => {
      const authorize = new URL(url);
      const nonce = authorize.searchParams.get('nonce') ?? '';
      const state = authorize.searchParams.get('state') ?? '';
      idToken = jwt({ nonce, aud: OIDC_CLIENT_ID, iss: ISSUER, exp: Math.floor(NOW / 1000) + 600, sub: 'user-1' });
      return { type: 'success' as const, url: `${OIDC_REDIRECT_URI}?code=abc&state=${encodeURIComponent(state)}` };
    },
    fetchImpl: async () => new Response(JSON.stringify({
      id_token: idToken,
      access_token: jwt(accessClaims),
      refresh_token: 'refresh',
    }), { status: 200, headers: { 'content-type': 'application/json' } }),
  };
}

describe('OIDC surface outcome', () => {
  test('a callback with the wrong state is rejected before token exchange', async () => {
    const exchange = jest.fn(async () => new Response('{}', { status: 200 }));
    const outcome = await signInWithOidc({
      issuer: ISSUER,
      now: () => NOW,
      openSession: async () => ({
        type: 'success',
        url: `${OIDC_REDIRECT_URI}?code=stray-code&state=wrong-state`,
      }),
      fetchImpl: exchange as typeof fetch,
    });

    expect(outcome).toMatchObject({ kind: 'blocked', reason: expect.stringMatching(/state mismatch/i) });
    expect(exchange).not.toHaveBeenCalled();
  });

  test('a roleless account reports the missing mobile surface', async () => {
    const outcome = await signInWithOidc({
      issuer: ISSUER,
      ...completion({ sub: 'user-1', roles: [] }),
    });

    expect(outcome.kind).toBe('blocked');
    if (outcome.kind === 'blocked') {
      expect(outcome.code).toBe('no_mobile_surface');
      expect(outcome.reason).toMatch(/no mobile surface/i);
    }
  });

  test('a password-change authorize error maps to the safe blocked code', async () => {
    const outcome = await signInWithOidc({
      issuer: ISSUER,
      now: () => NOW,
      openSession: async () => ({
        type: 'success',
        url: `${OIDC_REDIRECT_URI}?error=PASSWORD_CHANGE_REQUIRED&error_description=private-detail&state=state`,
      }),
      fetchImpl: jest.fn(async () => new Response('{}', { status: 200 })),
    });

    expect(outcome).toMatchObject({ kind: 'blocked', code: 'password_change_required' });
    if (outcome.kind === 'blocked') {
      expect(outcome.reason).not.toContain('private-detail');
    }
  });

  test('an applicant grant and a student role still sign in', async () => {
    const applicant = await signInWithOidc({
      issuer: ISSUER,
      ...completion({ sub: 'user-1', roles: [], capabilities: ['admissions:self'] }),
    });
    expect(applicant).toMatchObject({ kind: 'signedIn', role: 'student', accountId: 'user-1' });

    const student = await signInWithOidc({
      issuer: ISSUER,
      ...completion({ sub: 'user-1', roles: ['STUDENT'] }),
    });
    expect(student).toMatchObject({ kind: 'signedIn', role: 'student' });
  });
});
