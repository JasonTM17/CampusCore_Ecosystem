import {
  buildCodeAsync,
  generateHexStringAsync,
  generateRandom,
} from 'expo-auth-session/build/PKCE';
import * as WebBrowser from 'expo-web-browser';

import type { UserRole } from '../navigation/routes';
import {
  OIDC_REDIRECT_URI,
  buildAuthorizeUrl,
  buildTokenRequestBody,
  decodeJwtPayload,
  parseCallbackUrl,
  roleFromClaims,
  verifyIdToken,
} from './oidc-core';

/**
 * Native OIDC authorization-code + PKCE flow (mobile-policy §3). System
 * browser via `WebBrowser.openAuthSessionAsync` — never an embedded
 * WebView. All /oauth2/* traffic goes to the issuer host (KM-2). Pure
 * verification logic lives in `oidc-core.ts`; this file only wires the
 * expo-native surfaces (PKCE generation, system browser).
 */

export type OidcOutcome =
  | { kind: 'signedIn'; accessToken: string; refreshToken: string; accountId: string; role: UserRole }
  | { kind: 'blocked'; reason: string }
  | { kind: 'cancelled' };

export interface OidcDeps {
  issuer: string;
  fetchImpl?: typeof fetch;
  openSession?: (url: string, redirectUri: string) => Promise<WebBrowser.WebBrowserAuthSessionResult>;
  now?: () => number;
}

export { decodeJwtPayload, roleFromClaims };

function parseJson(raw: string | null): Record<string, unknown> | null {
  if (!raw) {
    return null;
  }
  try {
    const value = JSON.parse(raw);
    return value && typeof value === 'object' ? value : null;
  } catch {
    return null;
  }
}

export async function signInWithOidc(deps: OidcDeps): Promise<OidcOutcome> {
  const issuer = deps.issuer.replace(/\/+$/, '');
  const fetchImpl = deps.fetchImpl ?? fetch;
  const openSession = deps.openSession ?? WebBrowser.openAuthSessionAsync;
  const nowSeconds = Math.floor((deps.now?.() ?? Date.now()) / 1000);

  const { codeChallenge, codeVerifier } = await buildCodeAsync();
  const state = generateRandom(16);
  const nonce = await generateHexStringAsync(16);

  const result = await openSession(
    buildAuthorizeUrl({ issuer, codeChallenge, state, nonce }),
    OIDC_REDIRECT_URI,
  );
  if (result.type !== 'success') {
    // Dismiss/cancel is not an error — user backed out of the system browser.
    return { kind: 'cancelled' };
  }

  const callback = parseCallbackUrl(result.url, state);
  if (callback.kind === 'state-mismatch') {
    return { kind: 'blocked', reason: 'state mismatch — the sign-in response was rejected.' };
  }
  if (callback.kind === 'blocked') {
    return { kind: 'blocked', reason: callback.reason };
  }

  const tokenResponse = await fetchImpl(`${issuer}/oauth2/token`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: buildTokenRequestBody(callback.code, codeVerifier),
  });
  const body = parseJson(await tokenResponse.text());

  if (!tokenResponse.ok) {
    const detail = typeof body?.error_description === 'string'
      ? body.error_description
      : typeof body?.error === 'string'
        ? body.error
        : `HTTP ${tokenResponse.status}`;
    return { kind: 'blocked', reason: `Token exchange failed: ${detail}` };
  }

  const idCheck = verifyIdToken(body?.id_token, { nonce, issuer, nowSeconds });
  if ('error' in idCheck) {
    return { kind: 'blocked', reason: idCheck.error };
  }

  const accessToken = typeof body?.access_token === 'string' ? body.access_token : null;
  const refreshToken = typeof body?.refresh_token === 'string' ? body.refresh_token : null;
  if (!accessToken || !refreshToken) {
    return { kind: 'blocked', reason: 'Token response is missing access or refresh material.' };
  }

  const accessClaims = decodeJwtPayload(accessToken);
  const roleClaims = Array.isArray(accessClaims?.roles)
    ? accessClaims.roles.filter((role): role is string => typeof role === 'string')
    : [];
  const role = roleFromClaims(roleClaims);
  if (!role) {
    return {
      kind: 'blocked',
      reason: 'This account has no mobile surface — sign in on the web portal.',
    };
  }

  return {
    kind: 'signedIn',
    accessToken,
    refreshToken,
    accountId: idCheck.accountId,
    role,
  };
}
