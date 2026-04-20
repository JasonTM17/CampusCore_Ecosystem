import { expect, test } from '@playwright/test';
import {
  SEEDED_USERS,
  applySessionCookiesToPage,
  apiUrl,
  buildSessionArtifactsFromResponse,
  buildCookieHeaders,
  buildMutatingSessionHeaders,
  createSessionArtifacts,
  expectSessionCookies,
  expectOkResponse,
  frontendBaseURL,
  getSharedSessionArtifacts,
  publicRoutes,
} from './helpers';

test('public pages respond successfully', async ({ request }) => {
  for (const route of publicRoutes) {
    const response = await request.get(`${frontendBaseURL}${route}`);
    expect(response.ok()).toBeTruthy();
  }
});

test('backend API authenticates seeded student data with cookies and bearer tokens', async ({
  playwright,
}) => {
  const api = await playwright.request.newContext();

  try {
    const session = await getSharedSessionArtifacts(playwright, 'student');
    const loginData = session.authData;

    expect(loginData.accessToken).toBeTruthy();
    expect(loginData.refreshToken).toBeTruthy();
    expect(loginData.user.email).toBe(SEEDED_USERS.student.email);
    expect(loginData.user.roles).toContain('STUDENT');
    expect(session.setCookieHeaders.join('\n')).toContain('cc_access_token=');
    expect(session.setCookieHeaders.join('\n')).toContain('cc_refresh_token=');
    expect(session.setCookieHeaders.join('\n')).toContain('cc_csrf=');

    const cookieMeResponse = await api.get(apiUrl('/auth/me'), {
      headers: buildCookieHeaders(session),
    });
    await expectOkResponse(cookieMeResponse, 'GET /auth/me with cookies');

    const cookieMe = await cookieMeResponse.json();
    expect(cookieMe.email).toBe(SEEDED_USERS.student.email);
    expect(cookieMe.roles).toContain('STUDENT');
    expect(cookieMe.studentId).toBeTruthy();

    const bearerMeResponse = await api.get(apiUrl('/auth/me'), {
      headers: {
        Authorization: `Bearer ${loginData.accessToken}`,
      },
    });
    await expectOkResponse(bearerMeResponse, 'GET /auth/me with bearer');

    const bearerMe = await bearerMeResponse.json();
    expect(bearerMe.email).toBe(SEEDED_USERS.student.email);
    expect(bearerMe.roles).toContain('STUDENT');
    expect(bearerMe.studentId).toBeTruthy();
  } finally {
    await api.dispose();
  }
});

test('cookie session refresh and logout require CSRF and clear the browser session', async ({
  page,
  playwright,
}) => {
  const api = await playwright.request.newContext();

  try {
    const session = await createSessionArtifacts(api, 'student');
    expect(session.csrfToken).toBeTruthy();

    const refreshWithoutCsrf = await api.post(apiUrl('/auth/refresh'), {
      data: {},
      headers: buildCookieHeaders(session),
    });
    expect(refreshWithoutCsrf.status()).toBe(403);

    const refreshWithCsrf = await api.post(apiUrl('/auth/refresh'), {
      data: {},
      headers: buildMutatingSessionHeaders(session),
    });
    await expectOkResponse(refreshWithCsrf, 'POST /auth/refresh with CSRF');

    const nextSession = await buildSessionArtifactsFromResponse(refreshWithCsrf);

    const logoutWithoutCsrf = await api.post(apiUrl('/auth/logout'), {
      data: {},
      headers: buildCookieHeaders(nextSession),
    });
    expect(logoutWithoutCsrf.status()).toBe(403);

    await applySessionCookiesToPage(page, nextSession.setCookieHeaders);
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/dashboard$/);
    await expectSessionCookies(page);

    await page.reload();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole('heading', { name: /Welcome back/i })).toBeVisible();

  await page.getByRole('button', { name: 'Toggle profile menu' }).click();
    await page.getByRole('button', { name: 'Logout' }).click();
    await expect(page).toHaveURL(/\/login$/);
    await expect(
      page.getByRole('heading', { name: /Welcome Back/i }),
    ).toBeVisible();

    await expect
      .poll(async () => {
        const cookies = await page.context().cookies();
        return {
          hasAccessCookie: cookies.some(
            (cookie) => cookie.name === 'cc_access_token',
          ),
          hasRefreshCookie: cookies.some(
            (cookie) => cookie.name === 'cc_refresh_token',
          ),
        };
      })
      .toEqual({
        hasAccessCookie: false,
        hasRefreshCookie: false,
      });

    const refreshAfterLogout = await api.post(apiUrl('/auth/refresh'), {
      data: {},
      headers: buildMutatingSessionHeaders(nextSession),
    });
    expect(refreshAfterLogout.status()).toBe(401);
  } finally {
    await api.dispose();
  }
});
