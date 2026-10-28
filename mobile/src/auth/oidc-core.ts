import type { UserRole } from '../navigation/routes';

/**
 * Pure OIDC core (mobile-policy §3) — no expo/react-native imports so the
 * same logic runs in the app and under `node --test`. The expo-bound
 * orchestrator lives in `oidc-session.ts`.
 *
 * Security surface (contract §7.6/§7.7): authorize URL shape (PKCE S256,
 * state, nonce, exact redirect), callback param verification, and the
 * minimal id_token validation — nonce, aud, iss, exp, sub — because `sub`
 * becomes the per-account cache key (KM-16).
 */

export const OIDC_CLIENT_ID = 'cu-mobile';
export const OIDC_REDIRECT_URI = 'campuscore://auth/callback';
export const OIDC_SCOPES = 'openid profile email offline_access';

const BASE64_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * Hermes-safe base64url decode — `globalThis.atob` is not guaranteed on
 * every runtime the app ships on, so the decoder is implemented directly.
 */
function base64UrlDecode(input: string): string | null {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)) {
    return null;
  }
  const bytes: number[] = [];
  let accumulator = 0;
  let bits = 0;
  for (const char of normalized) {
    if (char === '=') {
      break;
    }
    const value = BASE64_ALPHABET.indexOf(char);
    if (value === -1) {
      return null;
    }
    accumulator = (accumulator << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((accumulator >> bits) & 0xff);
    }
  }
  try {
    return decodeURIComponent(
      bytes.map((byte) => `%${byte.toString(16).padStart(2, '0')}`).join(''),
    );
  } catch {
    return null;
  }
}

export function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length !== 3) {
    return null;
  }
  const decoded = base64UrlDecode(parts[1]);
  if (decoded === null) {
    return null;
  }
  try {
    const value = JSON.parse(decoded);
    return value && typeof value === 'object' ? value : null;
  } catch {
    return null;
  }
}

/**
 * Role precedence [LECTURER → STUDENT → ADMIN] (KM-8) picks the UI surface
 * only: ADMIN+LECTURER selects the lecturer lane, ADMIN+STUDENT the student
 * lane, and an admin-only account maps to `'admin'`, whose home is the
 * web-only hand-off panel. Native admin, dean and staff lanes are never
 * derived here — they come from `resolveCapabilities` (capabilities.ts) behind
 * the lane flags. Dean/department-head claims (`TRUONG_KHOA`, `TRUONG_BO_MON`)
 * do not select a lane: they sign in only through a lecturer claim.
 */
export function roleFromClaims(claims: readonly string[]): UserRole | null {
  const normalized = new Set(claims.map((role) => role.toUpperCase()));
  if (normalized.has('LECTURER') || normalized.has('FACULTY') || normalized.has('TEACHER')) {
    return 'lecturer';
  }
  if (normalized.has('STUDENT')) {
    return 'student';
  }
  if (normalized.has('ADMIN') || normalized.has('SUPER_ADMIN')) {
    return 'admin';
  }
  return null;
}

export interface AuthorizeRequest {
  issuer: string;
  codeChallenge: string;
  state: string;
  nonce: string;
}

/** Exact authorize URL the system browser opens — asserted field-by-field. */
export function buildAuthorizeUrl(request: AuthorizeRequest): string {
  const issuer = request.issuer.replace(/\/+$/, '');
  return (
    `${issuer}/oauth2/authorize?response_type=code` +
    `&client_id=${OIDC_CLIENT_ID}` +
    `&redirect_uri=${encodeURIComponent(OIDC_REDIRECT_URI)}` +
    `&scope=${encodeURIComponent(OIDC_SCOPES)}` +
    `&code_challenge=${request.codeChallenge}` +
    `&code_challenge_method=S256` +
    `&state=${request.state}` +
    `&nonce=${request.nonce}`
  );
}

export type CallbackParse =
  | { kind: 'code'; code: string }
  | { kind: 'blocked'; reason: string }
  | { kind: 'state-mismatch' };

/**
 * Callback URL → outcome. `state` equality is verified before the code is
 * ever read — a mismatched response is rejected even when it carries a
 * plausible code (contract §7.6).
 */
export function parseCallbackUrl(url: string, expectedState: string): CallbackParse {
  const params = new URLSearchParams(url.split('?')[1] ?? '');
  const errorParam = params.get('error');
  if (errorParam) {
    const detail = params.get('error_description');
    return {
      kind: 'blocked',
      reason: detail ? `${errorParam}: ${detail}` : `Authorization error: ${errorParam}`,
    };
  }
  if (params.get('state') !== expectedState) {
    return { kind: 'state-mismatch' };
  }
  const code = params.get('code');
  if (!code) {
    return { kind: 'blocked', reason: 'The authorization response did not include a code.' };
  }
  return { kind: 'code', code };
}

/** Form body for the code exchange — includes the PKCE verifier (§7.6). */
export function buildTokenRequestBody(code: string, codeVerifier: string): string {
  return [
    'grant_type=authorization_code',
    `code=${encodeURIComponent(code)}`,
    `redirect_uri=${encodeURIComponent(OIDC_REDIRECT_URI)}`,
    `client_id=${OIDC_CLIENT_ID}`,
    `code_verifier=${encodeURIComponent(codeVerifier)}`,
  ].join('&');
}

export function verifyIdToken(
  idToken: unknown,
  expected: { nonce: string; issuer: string; nowSeconds: number },
): { accountId: string } | { error: string } {
  if (typeof idToken !== 'string') {
    return { error: 'Token response did not include an id_token.' };
  }
  const claims = decodeJwtPayload(idToken);
  if (!claims) {
    return { error: 'id_token could not be decoded.' };
  }
  if (claims.nonce !== expected.nonce) {
    return { error: 'id_token nonce mismatch — session rejected.' };
  }
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audiences.includes(OIDC_CLIENT_ID)) {
    return { error: `id_token audience is not ${OIDC_CLIENT_ID}.` };
  }
  if (claims.iss !== expected.issuer) {
    return { error: 'id_token issuer mismatch.' };
  }
  if (typeof claims.exp !== 'number' || claims.exp <= expected.nowSeconds) {
    return { error: 'id_token is expired.' };
  }
  if (typeof claims.sub !== 'string' || claims.sub.length === 0) {
    return { error: 'id_token has no subject.' };
  }
  return { accountId: claims.sub };
}
