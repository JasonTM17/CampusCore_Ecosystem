#!/usr/bin/env node
/**
 * Verifies the mobile sign-in flow against the LOCAL stack with the
 * docker-compose.mobile-local.yml overlay — the exact OIDC
 * authorization-code+PKCE sequence the app performs, without a browser.
 *
 *   node scripts/local-dev.mjs up --mobile
 *   node scripts/mobile-local-oidc-verify.mjs
 *
 * Env:
 *   MOBILE_LOCAL_BASE     — host view of the API (default http://127.0.0.1:4010)
 *   MOBILE_LOCAL_ISSUER   — issuer URI the client will use (default
 *                           http://10.0.2.2:4010, the emulator host alias)
 *   MOBILE_DEMO_EMAIL     — seeded demo account (default student@campuscore.edu)
 *   MOBILE_DEMO_PASSWORD  — its documented public demo password (never printed)
 */

import { createHash, randomBytes } from 'node:crypto';

const BASE = process.env.MOBILE_LOCAL_BASE || 'http://127.0.0.1:4010';
const ISSUER = process.env.MOBILE_LOCAL_ISSUER || 'http://10.0.2.2:4010';
const EMAIL = process.env.MOBILE_DEMO_EMAIL || 'student@campuscore.edu';
const PASSWORD = process.env.MOBILE_DEMO_PASSWORD || 'password123'; // documented public demo seed
const CLIENT_ID = 'cu-mobile';
const REDIRECT_URI = 'campuscore://auth/callback';
const SCOPES = 'openid profile email offline_access';

export function base64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function s256(verifier) {
  return base64url(createHash('sha256').update(verifier).digest());
}
export function authorizeQuery({ state, nonce, challenge }) {
  const p = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
    nonce,
  });
  return p.toString();
}
export function callbackParams(location) {
  const url = new URL(location);
  return {
    code: url.searchParams.get('code'),
    state: url.searchParams.get('state'),
    error: url.searchParams.get('error'),
  };
}
export function decodeJwtPayload(token) {
  const parts = String(token).split('.');
  if (parts.length !== 3) return null;
  return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
}
export function collectCookies(headers) {
  const raw = headers.getSetCookie ? headers.getSetCookie() : [headers.get('set-cookie')].filter(Boolean);
  return raw.map((c) => c.split(';')[0]).join('; ');
}

function fail(step, detail) {
  console.error(`FAIL [${step}] ${detail}`);
  process.exit(1);
}
function pass(step, detail) {
  console.log(`PASS [${step}] ${detail}`);
}
async function fetchJson(url, options = {}) {
  options.headers = { Connection: 'close', ...options.headers };
  const res = await fetch(url, options);
  let body = null;
  try { body = await res.json(); } catch { /* non-JSON */ }
  return { res, body };
}

async function main() {
  // 1. Discovery — the endpoint that 404s without the overlay.
  const disc = await fetchJson(`${BASE}/.well-known/openid-configuration`);
  if (!disc.res.ok) {
    fail('discovery', `GET /.well-known/openid-configuration -> ${disc.res.status}. OIDC lane is off — start with node scripts/local-dev.mjs up --mobile`);
  }
  pass('discovery', `document fetched`);
  if (disc.body.issuer !== ISSUER) {
    fail('discovery', `issuer is "${disc.body.issuer}", expected "${ISSUER}" — set MOBILE_LOCAL_ISSUER`);
  }
  pass('discovery', `issuer = ${ISSUER}`);

  // 2. JWKS
  const jwks = await fetchJson(disc.body.jwks_uri?.startsWith('http') ? disc.body.jwks_uri.replace(/^https?:\/\/[^/]+/, BASE) : `${BASE}${disc.body.jwks_uri}`);
  if (!jwks.res.ok || !Array.isArray(jwks.body?.keys) || jwks.body.keys.length === 0) {
    fail('jwks', `GET ${disc.body.jwks_uri} -> ${jwks.res.status}, keys missing`);
  }
  pass('jwks', `${jwks.body.keys.length} key(s) published`);

  // 3. Password sign-in — same endpoint the SAS login page fetches.
  const login = await fetch(`${BASE}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Connection: 'close' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const loginBody = await login.json().catch(() => null);
  if (!login.ok || !loginBody?.accessToken) {
    fail('login', `POST /api/v1/auth/login -> ${login.ok ? 'twoFactorRequired or no token' : login.status} for ${EMAIL}`);
  }
  const cookies = collectCookies(login.headers);
  if (!cookies) fail('login', 'no auth cookies issued — authorize cannot see the session');
  pass('login', `${EMAIL} signed in, session cookie issued`);

  // 4. Authorize — code flow with PKCE S256, the app's client/redirect/scopes.
  const state = base64url(randomBytes(16));
  const nonce = base64url(randomBytes(16));
  const verifier = base64url(randomBytes(48));
  const authorize = await fetch(`${BASE}/oauth2/authorize?${authorizeQuery({ state, nonce, challenge: s256(verifier) })}`, {
    redirect: 'manual',
    headers: { Cookie: cookies, Connection: 'close' },
  });
  const location = authorize.headers.get('location');
  if (!location) {
    fail('authorize', `GET /oauth2/authorize -> ${authorize.status} without redirect (login page returned — session not recognized)`);
  }
  const cb = callbackParams(location);
  if (!location.startsWith(REDIRECT_URI)) {
    fail('authorize', `redirected to unexpected URI ${location.split('?')[0]}`);
  }
  if (cb.error) fail('authorize', `redirect carries error=${cb.error}`);
  if (!cb.code) fail('authorize', `redirect carries no code`);
  if (cb.state !== state) fail('authorize', 'state mismatch');
  pass('authorize', 'authorization code issued to campuscore:// callback');

  // 5. Token exchange
  const token = await fetchJson(`${BASE}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Connection: 'close' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: CLIENT_ID,
      code: cb.code,
      redirect_uri: REDIRECT_URI,
      code_verifier: verifier,
    }).toString(),
  });
  if (!token.res.ok || !token.body?.access_token) {
    fail('token', `POST /oauth2/token -> ${token.res.status} ${token.body?.error || ''}`);
  }
  if (!token.body.refresh_token) fail('token', 'no refresh_token minted (offline_access/native allowlist missing)');
  pass('token', 'access_token + refresh_token minted');

  // 6. Claims the mobile parser requires
  const payload = decodeJwtPayload(token.body.access_token);
  if (!payload) fail('claims', 'access_token is not a JWT');
  if (payload.iss !== ISSUER) fail('claims', `iss is "${payload.iss}", expected "${ISSUER}"`);
  if (!Array.isArray(payload.capabilities) || payload.capabilities.length === 0) {
    fail('claims', 'capabilities claim missing/empty — mobile parser requires it');
  }
  if (!Array.isArray(payload.roles)) fail('claims', 'roles claim missing');
  pass('claims', `iss=${payload.iss}; capabilities/roles present`);

  // 7. Resource calls — the first-load endpoints the student dashboard hits
  //    with the same token (mobile StudentDashboardScreen + client.ts).
  for (const path of ['/api/v1/enrollments/my', '/api/v1/announcements/my',
      '/api/v1/notifications/my', '/api/v1/attendance/my/summary']) {
    const res = await fetch(`${BASE}${path}`, {
      headers: { Authorization: `Bearer ${token.body.access_token}`, Connection: 'close' },
    });
    if (!res.ok) fail('resource', `GET ${path} -> ${res.status}`);
    pass('resource', `GET ${path} -> 200 with the minted token`);
  }

  // 8. Refresh rotation (native allowlist)
  const refresh = await fetchJson(`${BASE}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Connection: 'close' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: CLIENT_ID,
      refresh_token: token.body.refresh_token,
    }).toString(),
  });
  if (!refresh.res.ok || !refresh.body?.access_token) {
    fail('refresh', `POST /oauth2/token (refresh) -> ${refresh.res.status} ${refresh.body?.error || ''}`);
  }
  if (!refresh.body.refresh_token) fail('refresh', 'rotation returned no new refresh_token');
  pass('refresh', 'refresh-token rotation issued a new pair');

  console.log('mobile-local-oidc-verify: PASS');
}

const isMain = process.argv[1] && import.meta.url === new URL(`file:///${process.argv[1].replace(/\\/g, '/')}`).href;
if (isMain) main().catch((err) => fail('fatal', err.message));
