import {
  buildCodeAsync,
  generateHexStringAsync,
  generateRandom,
} from 'expo-auth-session/build/PKCE';
import * as WebBrowser from 'expo-web-browser';

import type { UserRole } from '../navigation/routes';
import { APPLICANT_UI_ROLE, capabilityClaimsFromPayload } from './capabilities';
import {
  OIDC_REDIRECT_URI,
  buildAuthorizeUrl,
  buildTokenRequestBody,
  decodeJwtPayload,
  parseCallbackUrl,
  roleFromClaims,
  sessionEntryFromClaims,
  verifyIdToken,
} from './oidc-core';

/**
 * Native OIDC authorization-code + PKCE flow (mobile-policy §3). System
 * browser via `WebBrowser.openAuthSessionAsync` — never an embedded
 * WebView. All /oauth2/* traffic goes to the issuer host (KM-2). Pure
 * verification logic lives in `oidc-core.ts`; this file only wires the
 * expo-native surfaces (PKCE generation, system browser).
 */

export type OidcBlockedCode = 'no_mobile_surface' | 'password_change_required';

export type OidcOutcome =
  | { kind: 'signedIn'; accessToken: string; refreshToken: string; accountId: string; role: UserRole }
  | { kind: 'unavailable'; code: 'issuer_not_configured' }
  | { kind: 'blocked'; reason: string; code?: OidcBlockedCode }
  | { kind: 'cancelled' };

export interface OidcDeps {
  issuer: string;
  fetchImpl?: typeof fetch;
  /** App-level deadline for the code exchange; an abort surfaces as the sign-in failure state. */
  timeoutMs?: number;
  openSession?: (url: string, redirectUri: string) => Promise<WebBrowser.WebBrowserAuthSessionResult>;
  now?: () => number;
}

export { decodeJwtPayload, roleFromClaims };

/** App-level deadline for the code exchange, independent of the platform fetch timeout. */
const DEFAULT_TOKEN_TIMEOUT_MS = 10_000;

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
  const issuer = deps.issuer.trim().replace(/\/+$/, '');
  if (!issuer) {
    return { kind: 'unavailable', code: 'issuer_not_configured' };
  }
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
    return {
      kind: 'blocked',
      reason: callback.reason,
      ...(callback.code === 'PASSWORD_CHANGE_REQUIRED' ? { code: 'password_change_required' as const } : {}),
    };
  }

  const { ok, status, body } = await (async (): Promise<{
    ok: boolean;
    status: number;
    body: Record<string, unknown> | null;
  }> => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        const error = new Error('The token exchange timed out.');
        error.name = 'AbortError';
        reject(error);
      }, deps.timeoutMs ?? DEFAULT_TOKEN_TIMEOUT_MS);
    });
    try {
      return await Promise.race([
        (async () => {
          const response = await fetchImpl(`${issuer}/oauth2/token`, {
            method: 'POST',
            headers: {
              Accept: 'application/json',
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: buildTokenRequestBody(callback.code, codeVerifier),
            signal: controller.signal,
          });
          return { ok: response.ok, status: response.status, body: parseJson(await response.text()) };
        })(),
        deadline,
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  })();

  if (!ok) {
    const detail = typeof body?.error_description === 'string'
      ? body.error_description
      : typeof body?.error === 'string'
        ? body.error
        : `HTTP ${status}`;
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
  const entry = sessionEntryFromClaims(roleClaims, capabilityClaimsFromPayload(accessClaims));
  if (entry === null) {
    return {
      kind: 'blocked',
      code: 'no_mobile_surface',
      reason: 'This account has no mobile surface — sign in on the web portal.',
    };
  }

  return {
    kind: 'signedIn',
    accessToken,
    refreshToken,
    accountId: idCheck.accountId,
    // An applicant session has no UI role; it renders the least-privileged
    // surface selector while the `applicant.surface` capability — derived
    // from this same token — restricts it to the admissions routes.
    role: entry.kind === 'role' ? entry.role : APPLICANT_UI_ROLE,
  };
}
