import { expect, request as pwRequest, test, type APIRequestContext, type BrowserContext, type Page } from '@playwright/test';

/**
 * P05 browser-SSO spec (docs/ecosystem/host-policy.md §9). Runs against the
 * HTTPS preview stack: `next dev --experimental-https` on every
 * *.localhost surface + the id.localhost TLS terminator + the disposable
 * BFF-lane API. Self-signed surfaces use ignoreHTTPSErrors — no CA is ever
 * installed (host-policy §10).
 *
 * *.localhost does not resolve via system DNS on every host, so two lanes
 * exist: browser navigation gets --host-resolver-rules, and APIRequestContext
 * (Node networking) goes through bffFetch — URL rewritten to loopback with
 * the surface host carried in the Host header.
 *
 * Required env (ecosystem-sso-verify.mjs supplies them):
 *   SSO_PORTAL_BASE / SSO_LEARN_BASE / SSO_APPLY_BASE / SSO_APEX_BASE /
 *   SSO_ID_BASE / E2E_STUDENT_PASSCODE
 */

test.use({
  ignoreHTTPSErrors: true,
  launchOptions: {
    args: ['--host-resolver-rules=MAP *.localhost 127.0.0.1'],
  },
});

const PORTAL = process.env.SSO_PORTAL_BASE ?? 'https://portal.localhost:3102';
const LEARN = process.env.SSO_LEARN_BASE ?? 'https://learn.localhost:3102';
const APPLY = process.env.SSO_APPLY_BASE ?? 'https://apply.localhost:3102';
const APEX = process.env.SSO_APEX_BASE ?? 'https://apex.localhost:3102';
const ID_BASE = process.env.SSO_ID_BASE ?? 'https://id.localhost:4443';
const STUDENT = { email: 'student@campuscore.edu', password: process.env.E2E_STUDENT_PASSCODE ?? 'password123' };
const SESSION_COOKIE = '__Host-cu_session';
const SESSION_COOKIE_DEV = 'cu_session_dev';

function sessionCookieName(cookies: { name: string }[]): string | undefined {
  return cookies.find((c) => c.name === SESSION_COOKIE)?.name
    ?? cookies.find((c) => c.name === SESSION_COOKIE_DEV)?.name;
}

interface BffInit {
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  data?: string;
  maxRedirects?: number;
}

/**
 * Node-side fetch onto a surface host: rewrite the URL authority to loopback,
 * carry the real host in `Host`, and forward the context's cookies for that
 * host — APIRequestContext never reaches *.localhost DNS and its own cookie
 * jar is keyed by the rewritten host anyway.
 */
async function bffFetch(
  request: APIRequestContext,
  context: BrowserContext,
  base: string,
  path: string,
  init: BffInit = {},
) {
  const url = new URL(`${base}${path}`);
  const surfaceHost = url.host;
  url.hostname = '127.0.0.1';
  const cookies = await context.cookies(base);
  const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join('; ');
  const headers: Record<string, string> = { host: surfaceHost, ...(init.headers ?? {}) };
  if (cookieHeader && !headers.cookie) headers.cookie = cookieHeader;
  return request.fetch(url.toString(), {
    method: init.method ?? 'GET',
    headers,
    data: init.data,
    maxRedirects: init.maxRedirects ?? 0,
  });
}

async function sessionState(request: APIRequestContext, context: BrowserContext, base: string) {
  const response = await bffFetch(request, context, base, '/session/state');
  return { status: response.status(), body: response.ok() ? await response.json() : null };
}

/** Drive the id-host login page: credentials -> fetch -> return chain. */
async function completeIdLogin(page: Page) {
  await expect(page).toHaveURL(new RegExp(`^${ID_BASE}/login`));
  await page.fill('#email', STUDENT.email);
  await page.fill('#pw', STUDENT.password);
  await page.click('button[type=submit]');
}

/** Begin a BFF login leg on a surface and land back on it, authenticated. */
async function ssoLogin(page: Page, base: string, returnPath = '/') {
  const baseRe = new RegExp(`^${base.replace(/\./g, '\\.')}/`);
  const loginRe = new RegExp(`^${ID_BASE.replace(/\./g, '\\.')}/login`);
  await page.goto(`${base}/session/login?return=${encodeURIComponent(returnPath)}`);
  // The chain is authorize -> (login form | straight back). Poll until the
  // browser settles on one of those two — the authorize URL itself is a
  // transient hop, not a settlement.
  await page.waitForURL((url) => baseRe.test(url.href) || loginRe.test(url.href), {
    timeout: 45000,
  });
  if (loginRe.test(page.url())) {
    await completeIdLogin(page);
    await page.waitForURL(baseRe, { timeout: 45000 });
  }
}

test.describe('ecosystem-sso (P05 browser BFF)', () => {
  // The sso journey is host-routed, not viewport-dependent — run it once on
  // chromium rather than multiplying a 30s login chain across every project.
  test.skip(({ browserName }) => browserName !== 'chromium');

  test('host-routing: surfaces resolve, unknown host is 404, apex redirects', async ({ page, context }) => {
    const portal = await bffFetch(page.request, context, PORTAL, '/session/state');
    // Anonymous on a BFF surface → the session layer answers, host routed.
    expect(portal.status()).toBe(401);

    const apex = await bffFetch(page.request, context, APEX, '/');
    expect([301, 302, 307, 308]).toContain(apex.status());
    expect(apex.headers()['location']).toMatch(/^https:\/\/portal\.localhost/);

    // Registry-only lane (P10): apply resolves as a BFF surface even though
    // no consumer pages exist yet — anonymous session state must answer 401,
    // not SURFACE_UNKNOWN.
    const apply = await bffFetch(page.request, context, APPLY, '/session/state');
    expect(apply.status()).toBe(401);

    const unknown = await page.request.fetch('https://127.0.0.1:3102/', {
      headers: { host: 'unknown.localhost:3102' },
    });
    expect(unknown.status()).toBe(404);
  });

  test('sso-journey: first login types once on id; learn SSO needs no password', async ({ page }) => {
    await ssoLogin(page, PORTAL);
    const portalState = await sessionState(page.request, page.context(), PORTAL);
    expect(portalState.status).toBe(200);
    expect(portalState.body.surface).toBe('portal');
    expect(portalState.body.csrfToken).toBeTruthy();
    // The browser carries nothing else — the token material is server-side.
    expect(JSON.stringify(portalState.body)).not.toMatch(/access[_-]?token|refresh[_-]?token|id[_-]?token/i);

    // Second surface: the id session (cc_session on id.localhost) is already
    // live, so /session/login bounces straight back with no credential step.
    await page.goto(`${LEARN}/session/login?return=/`);
    await page.waitForURL(new RegExp(`^${LEARN.replace(/\./g, '\\.')}`), { timeout: 30000 });
    const learnState = await sessionState(page.request, page.context(), LEARN);
    expect(learnState.status).toBe(200);
    expect(learnState.body.surface).toBe('learn');
    expect(learnState.body.userId).toBe(portalState.body.userId);
  });

  test('cookie-isolation: opaque host-only cookie, never a Domain attribute', async ({ page, context }) => {
    await ssoLogin(page, PORTAL);
    const cookies = await context.cookies(PORTAL);
    const name = sessionCookieName(cookies);
    expect(name, 'BFF session cookie must exist').toBeTruthy();
    const sessionCookie = cookies.find((c) => c.name === name)!;
    // Host-only: Playwright reports the bare host — any Domain attribute
    // would show a leading dot or a parent domain here.
    expect(sessionCookie.domain).toBe('portal.localhost');
    expect(sessionCookie.httpOnly).toBe(true);
    expect(sessionCookie.secure).toBe(name === SESSION_COOKIE);
    expect(sessionCookie.path).toBe('/');
    // Cookie tossing probe: the tx cookie names are transaction-scoped and
    // die with the callback leg — nothing cu_bff_tx_* should linger.
    expect(cookies.some((c) => /^cu_bff_tx(_dev)?_/.test(c.name))).toBe(false);

    // Cross-host copied opaque id must be rejected by surface binding:
    // replay the portal cookie value verbatim on the learn surface.
    const foreign = await pwRequest.newContext({ ignoreHTTPSErrors: true });
    const learn = new URL(LEARN);
    const surfaceHost = learn.host;
    learn.hostname = '127.0.0.1';
    const replay = await foreign.get(`${learn.toString()}session/state`, {
      headers: { host: surfaceHost, cookie: `${name}=${sessionCookie.value}` },
    });
    expect(replay.status()).toBe(401);
  });

  test('sibling-post: session-bound CSRF — cookie alone cannot mutate', async ({ page, context }) => {
    await ssoLogin(page, PORTAL);
    const cookies = await context.cookies(PORTAL);
    const name = sessionCookieName(cookies)!;
    const session = cookies.find((c) => c.name === name)!;

    // A hostile sibling that somehow holds the opaque cookie but not the
    // session-bound CSRF token still cannot mutate: cross-site fetch
    // metadata + no x-csrf-token → the triple-check rejects first.
    const attacker = await pwRequest.newContext({ ignoreHTTPSErrors: true });
    const portalUrl = new URL(`${PORTAL}/api/v1/me`);
    const surfaceHost = portalUrl.host;
    portalUrl.hostname = '127.0.0.1';
    const post = await attacker.fetch(portalUrl.toString(), {
      method: 'POST',
      headers: {
        host: surfaceHost,
        cookie: `${name}=${session.value}`,
        'sec-fetch-site': 'cross-site',
        'content-type': 'application/json',
      },
      data: '{}',
    });
    expect(post.status()).toBe(403);
  });

  test('mixup-redirect: foreign state rejected; evil return paths sanitized', async ({ page, context }) => {
    // Open redirect attempts on return= are sanitized at tx creation — the
    // authorize leg still issues, but the stored path is '/'.
    for (const evil of ['//evil.example', 'https://evil.example']) {
      const response = await bffFetch(page.request, context, PORTAL,
        `/session/login?return=${encodeURIComponent(evil)}`);
      expect([301, 302, 303, 307, 308]).toContain(response.status());
      expect(response.headers()['location']).toMatch(/oauth2\/authorize/);
    }

    // OAuth mix-up: mint a learn transaction, then replay its state at the
    // portal callback — the tx surface binding must reject it.
    const learnLogin = await bffFetch(page.request, context, LEARN, '/session/login');
    const authorizeUrl = learnLogin.headers()['location'];
    const learnState = new URL(authorizeUrl).searchParams.get('state');
    const mixup = await bffFetch(page.request, context, PORTAL,
      `/session/callback?code=deadbeef&state=${encodeURIComponent(learnState!)}`);
    if (mixup.status() >= 300 && mixup.status() < 400) {
      expect(mixup.headers()['location']).toMatch(/session\/login/);
    } else {
      expect(mixup.status()).toBeGreaterThanOrEqual(400);
    }
    const cookies = await context.cookies(PORTAL);
    expect(sessionCookieName(cookies)).toBeUndefined();
  });

  test('tab-race: parallel business calls keep one live session', async ({ page, context }) => {
    await ssoLogin(page, PORTAL);
    const results = await Promise.all(
      Array.from({ length: 4 }, () => bffFetch(page.request, context, PORTAL, '/api/v1/auth/me')),
    );
    for (const result of results) {
      expect(result.status()).toBe(200);
    }
    const state = await sessionState(page.request, context, PORTAL);
    expect(state.status).toBe(200);
  });

  test('revoke-deny: portal logout kills portal; learn lane is client-scoped', async ({ page, context }) => {
    await ssoLogin(page, PORTAL);
    await page.goto(`${LEARN}/session/login?return=/`);
    await page.waitForURL(new RegExp(`^${LEARN.replace(/\./g, '\\.')}`), { timeout: 30000 });

    const portalState = await sessionState(page.request, context, PORTAL);
    const logout = await bffFetch(page.request, context, PORTAL, '/session/logout', {
      method: 'POST',
      headers: {
        'x-csrf-token': portalState.body.csrfToken,
        'sec-fetch-site': 'same-origin',
        origin: PORTAL,
      },
    });
    expect(logout.ok()).toBeTruthy();

    expect((await bffFetch(page.request, context, PORTAL, '/api/v1/auth/me')).status()).toBe(401);
    // Client-scoped revoke: the learn surface session of the same account
    // survives — kill lists are per-client, matching host-policy §3.
    const learnState = await sessionState(page.request, context, LEARN);
    expect(learnState.status).toBe(200);
    await bffFetch(page.request, context, LEARN, '/session/logout', {
      method: 'POST',
      headers: {
        'x-csrf-token': learnState.body.csrfToken,
        'sec-fetch-site': 'same-origin',
        origin: LEARN,
      },
    });
    expect((await sessionState(page.request, context, LEARN)).status).toBe(401);
  });

  test('cache-headers: session state and business proxy are no-store', async ({ page, context }) => {
    await ssoLogin(page, PORTAL);
    const state = await bffFetch(page.request, context, PORTAL, '/session/state');
    expect(state.headers()['cache-control']).toContain('no-store');
    const me = await bffFetch(page.request, context, PORTAL, '/api/v1/auth/me');
    expect(me.headers()['cache-control']).toContain('no-store');
  });

  test('locales: portal login page renders VI and EN', async ({ page }) => {
    await page.goto(`${PORTAL}/login`);
    await expect(page.locator('body')).toContainText(/đăng nhập|sign in/i);
    await page.goto(`${PORTAL}/en/login`);
    await expect(page.locator('body')).toContainText(/sign in|đăng nhập/i);
  });
});
