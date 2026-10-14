import { expect, test, type Page } from '@playwright/test';

// The full journey compiles four routes cold on a dev server (login,
// dashboard, sign-out, then login and dashboard again) — the default 30s
// test budget can be consumed by compilation alone.
test.describe.configure({ timeout: 120_000 });

/**
 * Privacy regression: the React Query cache lives in a provider that stays
 * mounted across logout/login, and several keys carry no user id
 * (['registration','summary',semesterId] among them). Without the cache
 * clear on identity change, a second user signing into the same tab would
 * briefly render the previous user's cached data.
 *
 * Route-mocked like login-submit.spec.ts: user A signs in, sees
 * creditLimit 111 on the dashboard, signs out through the real UI link
 * (SPA navigation — the cache survives a soft nav), then user B signs in
 * and must NEVER render 111 while the dashboard loads; only 222 may appear.
 */

const NAV_TIMEOUT = { timeout: 30_000 };

const TERM = {
  id: 'term-cache-probe',
  name: 'Probe term',
  nameEn: 'Spring Term',
  nameVi: 'Học kỳ xuân',
  status: 'IN_PROGRESS',
};

const USER_A = {
  id: 'cache-probe-a',
  email: 'cache-a@example.test',
  firstName: 'Alpha',
  lastName: 'Student',
  status: 'ACTIVE',
  mustChangePassword: false,
  roles: ['STUDENT'],
  studentId: 'cache-probe-a',
};
const USER_B = { ...USER_A, id: 'cache-probe-b', email: 'cache-b@example.test', firstName: 'Beta', studentId: 'cache-probe-b' };

async function mockTwoStudentAccounts(page: Page) {
  let currentUser: typeof USER_A | null = null;
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

    if (path === '/api/v1/auth/login' && request.method() === 'POST') {
      const payload = JSON.parse(request.postData() ?? '{}') as { email?: string };
      currentUser = payload.email === USER_B.email ? USER_B : USER_A;
      return json({ user: currentUser, accessToken: 'stub-access', refreshToken: 'stub-refresh' });
    }
    if (path === '/api/v1/auth/me') {
      return currentUser ? json(currentUser) : json({ code: 'UNAUTHORIZED' }, 401);
    }
    if (path === '/api/v1/auth/logout') {
      currentUser = null;
      return json({});
    }
    if (path === '/api/v1/auth/refresh') {
      return json({ code: 'UNAUTHORIZED' }, 401);
    }
    if (path === '/api/v1/semesters') {
      return json({ data: [TERM], meta: { total: 1, page: 1, limit: 100, totalPages: 1 } });
    }
    if (path === '/api/v1/me/registration/summary') {
      const creditLimit = currentUser?.id === USER_B.id ? 222 : 111;
      return json({ creditLimit, creditsUsed: 0, creditsRemaining: creditLimit });
    }
    if (path === '/api/v1/enrollments/my') {
      return json([]);
    }
    if (path === '/api/v1/notifications/my') {
      return json({ data: [] });
    }
    if (path === '/api/v1/notifications/my/unread-count') {
      return json({ unreadCount: 0 });
    }
    return json({});
  });
}

async function signIn(page: Page, email: string) {
  await page.locator('#email').fill(email);
  await page.locator('#password').fill('password-irrelevant');
  await page.getByRole('button', { name: /sign in|đăng nhập/i }).click();
}

test('a second sign-in never renders the previous user cached registration summary', async ({ page }) => {
  await mockTwoStudentAccounts(page);

  await page.goto('/en/login?portal=student');
  await signIn(page, USER_A.email);
  await expect(page).toHaveURL(/\/en\/dashboard(\?|$)/, NAV_TIMEOUT);
  await expect(page.getByText(/up to 111 more credits/i)).toBeVisible(NAV_TIMEOUT);

  // SPA sign-out via the layout link keeps the document alive, so the
  // shared QueryClient — and any cache leak — survives the transition.
  await page.locator('a[href="/en/dashboard/sign-out"]').dispatchEvent('click');
  await expect(page).toHaveURL(/\/login/, NAV_TIMEOUT);

  // Flag any render of user A's figure during user B's whole load window.
  await page.evaluate(() => {
    const probe = { leaked: false };
    const scan = () => {
      if (/up to 111 more credits/i.test(document.body?.innerText ?? '')) {
        probe.leaked = true;
      }
    };
    const observer = new MutationObserver(scan);
    observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      characterData: true,
    });
    scan();
    (window as { __cacheProbe?: typeof probe }).__cacheProbe = probe;
  });

  await signIn(page, USER_B.email);
  await expect(page).toHaveURL(/\/en\/dashboard(\?|$)/, NAV_TIMEOUT);
  await expect(page.getByText(/up to 222 more credits/i)).toBeVisible(NAV_TIMEOUT);
  await page.waitForTimeout(1_000);

  const leaked = await page.evaluate(
    () => (window as { __cacheProbe?: { leaked: boolean } }).__cacheProbe?.leaked ?? true,
  );
  expect(leaked).toBe(false);
});

const STUDENT_A = {
  id: 'race-probe-a',
  email: 'race-a@example.test',
  firstName: 'Alpha',
  lastName: 'Student',
  status: 'ACTIVE',
  mustChangePassword: false,
  roles: ['STUDENT'],
  studentId: 'race-probe-a',
};
const LECTURER_B = {
  id: 'race-probe-b',
  email: 'race-b@example.test',
  firstName: 'Beta',
  lastName: 'Lecturer',
  status: 'ACTIVE',
  mustChangePassword: false,
  roles: ['LECTURER'],
  lecturerId: 'race-probe-b',
};

test('a held session-init /auth/me cannot displace a completed sign-in', async ({ page, context }) => {
  let meCalls = 0;
  let heldInitRoute: import('@playwright/test').Route | null = null;
  let signedInUser: typeof LECTURER_B | null = null;

  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

    if (path === '/api/v1/auth/me') {
      meCalls += 1;
      if (meCalls === 1) {
        heldInitRoute = route;
        return;
      }
      return signedInUser ? json(signedInUser) : json({ code: 'UNAUTHORIZED' }, 401);
    }
    if (path === '/api/v1/auth/login' && request.method() === 'POST') {
      signedInUser = LECTURER_B;
      return json({ user: LECTURER_B, accessToken: 'stub-access', refreshToken: 'stub-refresh' });
    }
    if (path === '/api/v1/auth/refresh' || path === '/api/v1/auth/logout') {
      return json({ code: 'UNAUTHORIZED' }, 401);
    }
    return json({});
  });

  await context.addCookies([
    { name: 'cc_csrf', value: 'race-hint-fixture', url: test.info().project.use.baseURL as string },
  ]);
  await page.goto('/en/login?portal=lecturer');
  await expect.poll(() => meCalls, NAV_TIMEOUT).toBe(1);

  await page.evaluate((firstName) => {
    const probe = { leaked: false };
    const scan = () => {
      if ((document.body?.innerText ?? '').includes(firstName)) {
        probe.leaked = true;
      }
    };
    const observer = new MutationObserver(scan);
    observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      characterData: true,
    });
    scan();
    (window as { __raceProbe?: typeof probe }).__raceProbe = probe;
  }, STUDENT_A.firstName);

  await signIn(page, LECTURER_B.email);
  await expect(page).toHaveURL(/\/en\/dashboard\/lecturer(\?|$)/, NAV_TIMEOUT);

  await heldInitRoute!.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(STUDENT_A),
  });

  await expect(page.getByText(LECTURER_B.firstName, { exact: false }).first()).toBeVisible(NAV_TIMEOUT);
  const leaked = await page.evaluate(
    () => (window as { __raceProbe?: { leaked: boolean } }).__raceProbe?.leaked ?? true,
  );
  expect(leaked).toBe(false);
  await expect(page).toHaveURL(/\/en\/dashboard\/lecturer(\?|$)/);
});

test('a pending /auth/refresh completes before a sign-in can post', async ({ page, context }) => {
  let refreshCalls = 0;
  let loginPosted = false;
  let signedInUser: typeof LECTURER_B | null = null;
  let heldRefreshRoute: import('@playwright/test').Route | null = null;

  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (path === '/api/v1/auth/me') {
      return signedInUser ? json(signedInUser) : json({ code: 'UNAUTHORIZED' }, 401);
    }
    if (path === '/api/v1/auth/refresh' && request.method() === 'POST') {
      refreshCalls += 1;
      if (refreshCalls === 1) {
        heldRefreshRoute = route;
        return;
      }
      return json({ code: 'UNAUTHORIZED' }, 401);
    }
    if (path === '/api/v1/auth/login' && request.method() === 'POST') {
      loginPosted = true;
      signedInUser = LECTURER_B;
      return json({ user: LECTURER_B, accessToken: 'stub-access', refreshToken: 'stub-refresh' });
    }
    if (path === '/api/v1/auth/logout') {
      return json({ code: 'UNAUTHORIZED' }, 401);
    }
    if (path === '/api/v1/sections/my/schedule' || path === '/api/v1/sections/my/grading') {
      return json([]);
    }
    if (path === '/api/v1/announcements/my') {
      return json({ data: [], total: 0, page: 1, limit: 5 });
    }
    return json({});
  });

  await context.addCookies([
    { name: 'cc_csrf', value: 'race-hint-fixture', url: test.info().project.use.baseURL as string },
  ]);
  await page.goto('/en/login?portal=lecturer');
  await expect.poll(() => refreshCalls, NAV_TIMEOUT).toBe(1);

  await signIn(page, LECTURER_B.email);
  await expect(page.waitForRequest('**/api/v1/auth/login', { timeout: 1_500 })).rejects.toThrow();
  expect(loginPosted).toBe(false);

  const loginRequest = page.waitForRequest('**/api/v1/auth/login', NAV_TIMEOUT);
  await heldRefreshRoute!.fulfill({
    status: 200,
    contentType: 'application/json',
    headers: { 'set-cookie': 'cc_csrf=refresh-rotated; Path=/; SameSite=Lax' },
    body: JSON.stringify({ user: STUDENT_A, accessToken: 'stale-access', refreshToken: 'stale-refresh' }),
  });

  await loginRequest;
  await expect(page).toHaveURL(/\/en\/dashboard\/lecturer(\?|$)/, NAV_TIMEOUT);
  await expect(page.getByText(LECTURER_B.firstName, { exact: false }).first()).toBeVisible(NAV_TIMEOUT);
});

const SUPER_ADMIN_USER = {
  id: 'race-super-admin',
  email: 'race-admin@example.test',
  firstName: 'Root',
  lastName: 'Overseer',
  status: 'ACTIVE',
  mustChangePassword: false,
  roles: ['SUPER_ADMIN'],
};
const FACULTY_HEAD_USER = {
  id: 'race-dean',
  email: 'race-dean@example.test',
  firstName: 'Dana',
  lastName: 'Dean',
  status: 'ACTIVE',
  mustChangePassword: false,
  roles: ['TRUONG_KHOA'],
};

async function mockIdentitySession(
  page: Page,
  context: import('@playwright/test').BrowserContext,
  user: typeof SUPER_ADMIN_USER,
) {
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (path === '/api/v1/auth/me') {
      return json(user);
    }
    if (path === '/api/v1/auth/refresh' || path === '/api/v1/auth/logout') {
      return json({ code: 'UNAUTHORIZED' }, 401);
    }
    if (path === '/api/v1/notifications/my') {
      return json({ data: [] });
    }
    if (path === '/api/v1/notifications/my/unread-count') {
      return json({ unreadCount: 0 });
    }
    return json({});
  });
  await context.addCookies([
    { name: 'cc_csrf', value: 'role-hint-fixture', url: test.info().project.use.baseURL as string },
  ]);
}

test('a SUPER_ADMIN-only session gets admin chrome on the shared thesis page', async ({ page, context }) => {
  await mockIdentitySession(page, context, SUPER_ADMIN_USER);
  await page.goto('/en/dashboard/thesis');

  await expect(page.getByText('Super administrator').first()).toBeVisible(NAV_TIMEOUT);
  await expect(page.locator('a[href="/en/admin"]').first()).toBeVisible();
  await expect(page.locator('a[href="/en/admin/users"]').first()).toBeVisible();
  await expect(page.locator('a[href="/en/dashboard/register"]')).toHaveCount(0);
  await expect(page.locator('a[href="/en/dashboard/grades"]')).toHaveCount(0);
});

test('a TRUONG_KHOA-only session keeps the dean label without full admin menus', async ({ page, context }) => {
  await mockIdentitySession(page, context, FACULTY_HEAD_USER);
  await page.goto('/en/dashboard/thesis');

  await expect(page.getByText('Dean').first()).toBeVisible(NAV_TIMEOUT);
  await expect(page.locator('a[href="/en/admin/users"]')).toHaveCount(0);
  await expect(page.locator('a[href="/en/admin/departments"]')).toHaveCount(0);
  await expect(page.locator('a[href="/en/dashboard/thesis"]').first()).toBeVisible();
});

test('a refresh dispatched during a pending sign-in must not overwrite the new session cookie', async ({ page, context }) => {
  const arrivals: { path: string; method: string; actor: string }[] = [];
  let heldLogin: import('@playwright/test').Route | null = null;
  let heldRefresh: import('@playwright/test').Route | null = null;
  let heldRead: import('@playwright/test').Route | null = null;
  let readReleased = false;
  let refreshActor: string | null = null;
  const actorOf = (request: import('@playwright/test').Request) =>
    /cc_access_token=([^;]+)/.exec(request.headers()['cookie'] ?? '')?.[1] ?? 'none';
  const markerFor = (actor: string | null) => (actor === 'review-b' ? 'review-b' : 'review-a');

  await context.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const json = (body: unknown, status = 200, headers?: Record<string, string>) =>
      route.fulfill({ status, contentType: 'application/json', headers, body: JSON.stringify(body) });
    arrivals.push({ path, method: request.method(), actor: actorOf(request) });

    if (path === '/api/v1/auth/me') {
      const actor = actorOf(request);
      if (actor === 'review-b') return json(LECTURER_B);
      if (actor === 'review-a') return json(STUDENT_A);
      return json({ code: 'UNAUTHORIZED' }, 401);
    }
    if (path === '/api/v1/auth/login' && request.method() === 'POST') {
      heldLogin = route;
      return;
    }
    if (path === '/api/v1/auth/refresh' && request.method() === 'POST') {
      refreshActor = actorOf(request);
      heldRefresh = route;
      return;
    }
    if (path === '/api/v1/auth/logout') {
      return json({});
    }
    if (path.startsWith('/api/v1/notifications/') && !heldRead && !readReleased) {
      heldRead = route;
      return;
    }
    if (path === '/api/v1/notifications/my') {
      return json({ data: [] });
    }
    if (path === '/api/v1/notifications/my/unread-count') {
      return json({ unreadCount: 0 });
    }
    if (path === '/api/v1/semesters') {
      return json({ data: [TERM], meta: { total: 1, page: 1, limit: 100, totalPages: 1 } });
    }
    if (path === '/api/v1/sections/my/schedule' || path === '/api/v1/sections/my/grading') {
      return json([]);
    }
    if (path === '/api/v1/announcements/my') {
      return json({ data: [], total: 0, page: 1, limit: 5 });
    }
    return json({});
  });

  const baseURL = test.info().project.use.baseURL as string;
  await context.addCookies([
    { name: 'cc_csrf', value: 'review-hint', url: baseURL },
    { name: 'cc_access_token', value: 'review-a', url: baseURL },
  ]);

  const loginPage = await context.newPage();
  try {
    await page.goto('/en/dashboard');
    await expect.poll(() => heldRead !== null, NAV_TIMEOUT).toBe(true);
    const bootstrapMe = await page.evaluate(async () => {
      const res = await fetch('/api/v1/auth/me', { credentials: 'include' });
      return res.status === 200 ? ((await res.json()) as { id?: string }).id ?? null : null;
    });
    expect(bootstrapMe, 'the seeded cookie identifies actor A before the sign-in').toBe(STUDENT_A.id);

    await loginPage.goto('/en/login?portal=lecturer');
    await signIn(loginPage, LECTURER_B.email);
    await expect.poll(() => heldLogin !== null, NAV_TIMEOUT).toBe(true);

    const refreshArrived = page.waitForRequest('**/api/v1/auth/refresh', NAV_TIMEOUT);
    await heldRead!.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({ code: 'UNAUTHORIZED' }),
    });
    readReleased = true;
    // While the sign-in is still in flight, the 401-triggered refresh must
    // stay queued behind it instead of racing to dispatch.
    await page.waitForTimeout(300);
    expect(arrivals.filter((entry) => entry.path === '/api/v1/auth/refresh')).toHaveLength(0);

    await heldLogin!.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'set-cookie': 'cc_access_token=review-b; Path=/; SameSite=Lax' },
      body: JSON.stringify({ user: LECTURER_B, accessToken: 'stub-access', refreshToken: 'stub-refresh' }),
    });
    await refreshArrived;
    await expect.poll(() => heldRefresh !== null, NAV_TIMEOUT).toBe(true);
    expect(
      arrivals.findIndex((entry) => entry.path === '/api/v1/auth/login'),
    ).toBeLessThan(arrivals.findIndex((entry) => entry.path === '/api/v1/auth/refresh'));

    await expect(loginPage).toHaveURL(/\/en\/dashboard\/lecturer(\?|$)/, NAV_TIMEOUT);
    await expect(loginPage.getByText(LECTURER_B.firstName, { exact: false }).first()).toBeVisible(NAV_TIMEOUT);

    await heldRefresh!.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'set-cookie': `cc_access_token=${markerFor(refreshActor)}; Path=/; SameSite=Lax` },
      body: JSON.stringify({ user: STUDENT_A, accessToken: 'stub-access', refreshToken: 'stub-refresh' }),
    });
    await expect
      .poll(
        () => arrivals.filter((entry) => entry.path.startsWith('/api/v1/notifications/')).length,
        { timeout: 10_000 },
      )
      .toBeGreaterThanOrEqual(2);

    const meBody = await loginPage.evaluate(async () => {
      const res = await fetch('/api/v1/auth/me', { credentials: 'include' });
      return res.status === 200 ? ((await res.json()) as { id?: string }).id ?? null : null;
    });
    expect(meBody, 'the completed sign-in identity must survive a late refresh cookie').toBe(LECTURER_B.id);
    const marker = (await context.cookies()).find((cookie) => cookie.name === 'cc_access_token')?.value;
    expect(marker, 'the newest sign-in cookie must not be overwritten by a stale refresh').toBe('review-b');
  } finally {
    const heldReadRoute = heldRead as import('@playwright/test').Route | null;
    const heldLoginRoute = heldLogin as import('@playwright/test').Route | null;
    const heldRefreshRoute = heldRefresh as import('@playwright/test').Route | null;
    await heldReadRoute?.fulfill({ status: 503, contentType: 'application/json', body: '{}' }).catch(() => {});
    await heldLoginRoute?.fulfill({ status: 503, contentType: 'application/json', body: '{}' }).catch(() => {});
    await heldRefreshRoute?.fulfill({ status: 503, contentType: 'application/json', body: '{}' }).catch(() => {});
    await loginPage.close().catch(() => {});
  }
});

async function mockDashboardData(route: import('@playwright/test').Route, path: string) {
  const json = (body: unknown, status = 200) =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  if (path === '/api/v1/semesters') {
    return json({ data: [TERM], meta: { total: 1, page: 1, limit: 100, totalPages: 1 } });
  }
  if (path === '/api/v1/me/registration/summary') {
    return json({ creditLimit: 111, creditsUsed: 0, creditsRemaining: 111 });
  }
  if (path === '/api/v1/enrollments/my') {
    return json([]);
  }
  if (path === '/api/v1/sections/my/schedule' || path === '/api/v1/sections/my/grading') {
    return json([]);
  }
  if (path === '/api/v1/announcements/my') {
    return json({ data: [], total: 0, page: 1, limit: 5 });
  }
  if (path === '/api/v1/notifications/my') {
    return json({ data: [] });
  }
  if (path === '/api/v1/notifications/my/unread-count') {
    return json({ unreadCount: 0 });
  }
  return json({});
}

test('a sign-in whose session cookie never arrives stays on the form with a visible error', async ({ page }) => {
  let loginCalls = 0;
  let meCalls = 0;
  let cookieDropped = true;

  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const json = (body: unknown, status = 200, headers?: Record<string, string>) =>
      route.fulfill({ status, contentType: 'application/json', headers, body: JSON.stringify(body) });

    if (path === '/api/v1/auth/login' && request.method() === 'POST') {
      loginCalls += 1;
      return json(
        { user: STUDENT_A, accessToken: 'stub-access', refreshToken: 'stub-refresh' },
        200,
        cookieDropped
          ? undefined
          : { 'set-cookie': 'cc_access_token=review-a; Path=/; SameSite=Lax' },
      );
    }
    if (path === '/api/v1/auth/me') {
      meCalls += 1;
      return cookieDropped ? json({ code: 'UNAUTHORIZED' }, 401) : json(STUDENT_A);
    }
    if (path === '/api/v1/auth/refresh' || path === '/api/v1/auth/logout') {
      return json({ code: 'UNAUTHORIZED' }, 401);
    }
    return mockDashboardData(route, path);
  });

  await page.goto('/en/login?portal=student');
  await signIn(page, STUDENT_A.email);

  await expect(page.locator('#login-error')).toBeVisible(NAV_TIMEOUT);
  await expect(page).toHaveURL(/\/en\/login/);
  const submit = page.getByRole('button', { name: /sign in|đăng nhập/i });
  await expect(submit).toBeEnabled();
  await expect(page.locator('#email')).toBeVisible();
  await expect(page.locator('a[href="/en/dashboard/sign-out"]')).toHaveCount(0);
  expect(meCalls).toBe(2);
  expect(loginCalls).toBe(2);

  cookieDropped = false;
  await submit.click();
  await expect(page).toHaveURL(/\/en\/dashboard(\?|$)/, NAV_TIMEOUT);
  expect(meCalls).toBe(3);
});

test('a stale-account /me probe followed by a dead probe never renders signed-in chrome', async ({ page }) => {
  let meCalls = 0;

  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const json = (body: unknown, status = 200, headers?: Record<string, string>) =>
      route.fulfill({ status, contentType: 'application/json', headers, body: JSON.stringify(body) });

    if (path === '/api/v1/auth/login' && request.method() === 'POST') {
      return json(
        { user: LECTURER_B, accessToken: 'stub-access', refreshToken: 'stub-refresh' },
        200,
        { 'set-cookie': 'cc_access_token=review-b; Path=/; SameSite=Lax' },
      );
    }
    if (path === '/api/v1/auth/me') {
      meCalls += 1;
      return meCalls === 1 ? json(STUDENT_A) : json({ code: 'UNAUTHORIZED' }, 401);
    }
    if (path === '/api/v1/auth/refresh' || path === '/api/v1/auth/logout') {
      return json({ code: 'UNAUTHORIZED' }, 401);
    }
    return json({});
  });

  await page.goto('/en/login?portal=lecturer');
  await page.evaluate((firstName) => {
    const probe = { leaked: false };
    const scan = () => {
      if ((document.body?.innerText ?? '').includes(firstName)) {
        probe.leaked = true;
      }
    };
    const observer = new MutationObserver(scan);
    observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      characterData: true,
    });
    scan();
    (window as { __raceProbe?: typeof probe }).__raceProbe = probe;
  }, LECTURER_B.firstName);

  await signIn(page, LECTURER_B.email);
  await expect(page.locator('#login-error')).toBeVisible(NAV_TIMEOUT);
  await expect(page).toHaveURL(/\/en\/login/);
  await expect(page.getByRole('button', { name: /sign in|đăng nhập/i })).toBeEnabled();
  await expect(page.locator('a[href="/en/dashboard/sign-out"]')).toHaveCount(0);
  expect(meCalls).toBe(2);

  const leaked = await page.evaluate(
    () => (window as { __raceProbe?: { leaked: boolean } }).__raceProbe?.leaked ?? true,
  );
  expect(leaked).toBe(false);
});

test('a two-factor verify whose /me probes die resets to the password step for a fresh challenge', async ({ page }) => {
  let loginCalls = 0;
  let meCalls = 0;
  const verifyChallenges: string[] = [];
  let sessionUser: typeof LECTURER_B | null = null;

  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const json = (body: unknown, status = 200, headers?: Record<string, string>) =>
      route.fulfill({ status, contentType: 'application/json', headers, body: JSON.stringify(body) });

    if (path === '/api/v1/auth/login' && request.method() === 'POST') {
      loginCalls += 1;
      return json({
        twoFactorRequired: true,
        challengeId: `ch-fixture-${loginCalls}`,
        email: LECTURER_B.email,
      });
    }
    if (path === '/api/v1/auth/two-factor/verify' && request.method() === 'POST') {
      const payload = JSON.parse(request.postData() ?? '{}') as { challengeId?: string };
      verifyChallenges.push(payload.challengeId ?? 'unknown');
      if (payload.challengeId === 'ch-fixture-2') {
        sessionUser = LECTURER_B;
      }
      return json(
        { user: LECTURER_B, accessToken: 'stub-access', refreshToken: 'stub-refresh' },
        200,
        { 'set-cookie': 'cc_access_token=review-b; Path=/; SameSite=Lax' },
      );
    }
    if (path === '/api/v1/auth/me') {
      meCalls += 1;
      return sessionUser ? json(sessionUser) : json({ code: 'UNAUTHORIZED' }, 401);
    }
    if (path === '/api/v1/auth/refresh' || path === '/api/v1/auth/logout') {
      return json({ code: 'UNAUTHORIZED' }, 401);
    }
    return mockDashboardData(route, path);
  });

  await page.goto('/en/login?portal=lecturer');
  await signIn(page, LECTURER_B.email);
  await page.locator('#otp-code').fill('123456');
  await page.getByRole('button', { name: /verify code|xác nhận mã/i }).click();

  await expect(page.locator('#login-error')).toBeVisible(NAV_TIMEOUT);
  await expect(page).toHaveURL(/\/en\/login/);
  await expect(page.locator('#otp-code')).toHaveCount(0);
  await expect(page.locator('#email')).toBeVisible();
  const password = page.locator('#password');
  await expect(password).toHaveValue('');
  const submit = page.getByRole('button', { name: /sign in|đăng nhập/i });
  await expect(submit).toBeEnabled();
  await expect(page.locator('a[href="/en/dashboard/sign-out"]')).toHaveCount(0);
  expect(verifyChallenges).toEqual(['ch-fixture-1']);
  expect(meCalls).toBe(2);

  await password.fill('password-irrelevant');
  await submit.click();
  await page.locator('#otp-code').fill('654321');
  await page.getByRole('button', { name: /verify code|xác nhận mã/i }).click();
  await expect(page).toHaveURL(/\/en\/dashboard\/lecturer(\?|$)/, NAV_TIMEOUT);
  await expect(page.getByText(LECTURER_B.firstName, { exact: false }).first()).toBeVisible(NAV_TIMEOUT);
  expect(verifyChallenges).toEqual(['ch-fixture-1', 'ch-fixture-2']);
  expect(loginCalls).toBe(2);
});

test('an invalid two-factor code keeps the same challenge form open', async ({ page }) => {
  let loginCalls = 0;
  const verifyChallenges: string[] = [];

  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const json = (body: unknown, status = 200, headers?: Record<string, string>) =>
      route.fulfill({ status, contentType: 'application/json', headers, body: JSON.stringify(body) });

    if (path === '/api/v1/auth/login' && request.method() === 'POST') {
      loginCalls += 1;
      return json({ twoFactorRequired: true, challengeId: 'ch-fixture-1', email: LECTURER_B.email });
    }
    if (path === '/api/v1/auth/two-factor/verify' && request.method() === 'POST') {
      const payload = JSON.parse(request.postData() ?? '{}') as { challengeId?: string };
      verifyChallenges.push(payload.challengeId ?? 'unknown');
      return json({ code: 'TWO_FACTOR_CODE_INVALID' }, 401);
    }
    if (path === '/api/v1/auth/me' || path === '/api/v1/auth/refresh' || path === '/api/v1/auth/logout') {
      return json({ code: 'UNAUTHORIZED' }, 401);
    }
    return json({});
  });

  await page.goto('/en/login?portal=lecturer');
  await signIn(page, LECTURER_B.email);
  await page.locator('#otp-code').fill('123456');
  const verifyButton = page.getByRole('button', { name: /verify code|xác nhận mã/i });
  await verifyButton.click();

  await expect(page.locator('#login-error')).toBeVisible(NAV_TIMEOUT);
  await expect(page).toHaveURL(/\/en\/login/);
  await expect(page.locator('#otp-code')).toBeVisible();
  await expect(verifyButton).toBeEnabled();

  await page.locator('#otp-code').fill('654321');
  await verifyButton.click();
  await expect.poll(() => verifyChallenges.length, NAV_TIMEOUT).toBe(2);
  expect(verifyChallenges).toEqual(['ch-fixture-1', 'ch-fixture-1']);
  expect(loginCalls).toBe(1);
  await expect(page.locator('a[href="/en/dashboard/sign-out"]')).toHaveCount(0);
});

test('a hung /me probe times out and frees the submit button for a retry', async ({ page }) => {
  const heldProbes: import('@playwright/test').Route[] = [];
  let meCalls = 0;
  let loginCalls = 0;
  let releaseProbes = false;

  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const json = (body: unknown, status = 200, headers?: Record<string, string>) =>
      route.fulfill({ status, contentType: 'application/json', headers, body: JSON.stringify(body) });

    if (path === '/api/v1/auth/login' && request.method() === 'POST') {
      loginCalls += 1;
      return json(
        { user: STUDENT_A, accessToken: 'stub-access', refreshToken: 'stub-refresh' },
        200,
        { 'set-cookie': 'cc_access_token=review-a; Path=/; SameSite=Lax' },
      );
    }
    if (path === '/api/v1/auth/me') {
      meCalls += 1;
      if (!releaseProbes) {
        heldProbes.push(route);
        return;
      }
      return json(STUDENT_A);
    }
    if (path === '/api/v1/auth/refresh' || path === '/api/v1/auth/logout') {
      return json({ code: 'UNAUTHORIZED' }, 401);
    }
    return mockDashboardData(route, path);
  });

  try {
    await page.goto('/en/login?portal=student');
    await signIn(page, STUDENT_A.email);

    await expect(page.locator('#login-error')).toBeVisible({ timeout: 60_000 });
    await expect(page).toHaveURL(/\/en\/login/);
    const submit = page.getByRole('button', { name: /sign in|đăng nhập/i });
    await expect(submit).toBeEnabled();
    expect(meCalls).toBe(2);
    expect(loginCalls).toBe(2);

    releaseProbes = true;
    await submit.click();
    await expect(page).toHaveURL(/\/en\/dashboard(\?|$)/, NAV_TIMEOUT);
    expect(meCalls).toBe(3);
  } finally {
    for (const held of heldProbes) {
      await held
        .fulfill({ status: 503, contentType: 'application/json', body: '{}' })
        .catch(() => {});
    }
  }
});

const CROSS_A_COOKIE = 'cross-a';
const CROSS_B_COOKIE = 'cross-b';

interface CrossTabMockOptions {
  logoutStatus?: number;
  heldMeRoutes?: import('@playwright/test').Route[];
  lateMeRoutes?: { armed: boolean; routes: import('@playwright/test').Route[] };
  heldNotifications?: import('@playwright/test').Route[];
  heldLogins?: { route: import('@playwright/test').Route; isB: boolean }[];
  meCounter?: { count: number };
}

async function mockCrossTabAccounts(
  context: import('@playwright/test').BrowserContext,
  options: CrossTabMockOptions = {},
) {
  const actorOf = (request: import('@playwright/test').Request) =>
    /cc_access_token=([^;]+)/.exec(request.headers()['cookie'] ?? '')?.[1] ?? 'none';
  const userFor = (actor: string) =>
    actor === CROSS_B_COOKIE ? USER_B : actor === CROSS_A_COOKIE ? USER_A : null;

  await context.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const json = (body: unknown, status = 200, headers?: Record<string, string>) =>
      route.fulfill({ status, contentType: 'application/json', headers, body: JSON.stringify(body) });
    const actor = actorOf(request);

    if (path === '/api/v1/auth/login' && request.method() === 'POST') {
      const payload = JSON.parse(request.postData() ?? '{}') as { email?: string };
      const isB = payload.email === USER_B.email;
      if (options.heldLogins) {
        options.heldLogins.push({ route, isB });
        return;
      }
      return json(
        { user: isB ? USER_B : USER_A, accessToken: 'stub-access', refreshToken: 'stub-refresh' },
        200,
        { 'set-cookie': `cc_access_token=${isB ? CROSS_B_COOKIE : CROSS_A_COOKIE}; Path=/; SameSite=Lax` },
      );
    }
    if (path === '/api/v1/auth/me') {
      if (options.meCounter) {
        options.meCounter.count += 1;
      }
      if (options.heldMeRoutes && options.heldMeRoutes.length === 0) {
        options.heldMeRoutes.push(route);
        return;
      }
      if (options.lateMeRoutes?.armed) {
        options.lateMeRoutes.routes.push(route);
        return;
      }
      const user = userFor(actor);
      return user ? json(user) : json({ code: 'UNAUTHORIZED' }, 401);
    }
    if (path === '/api/v1/auth/logout') {
      if (options.logoutStatus && options.logoutStatus !== 200) {
        return json({ code: 'LOGOUT_FAILED' }, options.logoutStatus);
      }
      return json({}, 200, {
        'set-cookie': `cc_access_token=; Path=/; Max-Age=0; SameSite=Lax`,
      });
    }
    if (path === '/api/v1/auth/refresh') {
      return json({ code: 'UNAUTHORIZED' }, 401);
    }
    if (path === '/api/v1/me/registration/summary') {
      const creditLimit = actor === CROSS_B_COOKIE ? 222 : 111;
      return json({ creditLimit, creditsUsed: 0, creditsRemaining: creditLimit });
    }
    if (
      options.heldNotifications &&
      (path === '/api/v1/notifications/my' || path === '/api/v1/notifications/my/unread-count')
    ) {
      options.heldNotifications.push(route);
      return;
    }
    return mockDashboardData(route, path);
  });

  await context.addCookies([
    { name: 'cc_csrf', value: 'cross-hint', url: test.info().project.use.baseURL as string },
  ]);
}

test('an already-open tab follows a second tab sign-in to the newer identity', async ({ page, context }) => {
  await mockCrossTabAccounts(context);

  await page.goto('/en/login?portal=student');
  await signIn(page, USER_A.email);
  await expect(page).toHaveURL(/\/en\/dashboard(\?|$)/, NAV_TIMEOUT);
  await expect(page.getByText(/up to 111 more credits/i)).toBeVisible(NAV_TIMEOUT);

  const tabB = await context.newPage();
  try {
    await tabB.goto('/en/login?portal=student');
    await signIn(tabB, USER_B.email);
    await expect(tabB).toHaveURL(/\/en\/dashboard(\?|$)/, NAV_TIMEOUT);
    await expect(tabB.getByText(/up to 222 more credits/i)).toBeVisible(NAV_TIMEOUT);

    await expect(page.getByText(/up to 222 more credits/i)).toBeVisible(NAV_TIMEOUT);
    await expect(page.getByText(/up to 111 more credits/i)).toHaveCount(0);
    await expect(page.getByText(USER_A.firstName)).toHaveCount(0);
  } finally {
    await tabB.close().catch(() => {});
  }
});

test('an already-open tab drops its session when a second tab signs out', async ({ page, context }) => {
  await mockCrossTabAccounts(context);

  await page.goto('/en/login?portal=student');
  await signIn(page, USER_A.email);
  await expect(page).toHaveURL(/\/en\/dashboard(\?|$)/, NAV_TIMEOUT);
  await expect(page.getByText(/up to 111 more credits/i)).toBeVisible(NAV_TIMEOUT);

  const tabB = await context.newPage();
  try {
    await tabB.goto('/en/dashboard');
    await expect(tabB.getByText(/up to 111 more credits/i)).toBeVisible(NAV_TIMEOUT);
    await tabB.locator('a[href="/en/dashboard/sign-out"]').dispatchEvent('click');
    await expect(tabB).toHaveURL(/\/login/, NAV_TIMEOUT);

    await expect(page).toHaveURL(/\/login/, NAV_TIMEOUT);
    await expect(page.locator('#email')).toBeVisible();
    await expect(page.getByText(/up to 111 more credits/i)).toHaveCount(0);
    await expect(page.getByText(USER_A.firstName)).toHaveCount(0);
  } finally {
    await tabB.close().catch(() => {});
  }
});

test('an already-open tab follows a second tab sign-in without BroadcastChannel', async ({ page, context }) => {
  await context.addInitScript(blockBroadcastChannel);
  await mockCrossTabAccounts(context);

  await page.goto('/en/login?portal=student');
  await signIn(page, USER_A.email);
  await expect(page).toHaveURL(/\/en\/dashboard(\?|$)/, NAV_TIMEOUT);
  await expect(page.getByText(/up to 111 more credits/i)).toBeVisible(NAV_TIMEOUT);

  const tabB = await context.newPage();
  try {
    await tabB.goto('/en/login?portal=student');
    await signIn(tabB, USER_B.email);
    await expect(tabB).toHaveURL(/\/en\/dashboard(\?|$)/, NAV_TIMEOUT);
    await expect(tabB.getByText(/up to 222 more credits/i)).toBeVisible(NAV_TIMEOUT);

    await expect(page.getByText(/up to 222 more credits/i)).toBeVisible(NAV_TIMEOUT);
    await expect(page.getByText(/up to 111 more credits/i)).toHaveCount(0);
    await expect(page.getByText(USER_A.firstName)).toHaveCount(0);
  } finally {
    await tabB.close().catch(() => {});
  }
});

function blockLocalStorage() {
  const blocked = {
    getItem: () => null,
    setItem: () => {
      throw new Error('storage blocked by test');
    },
    removeItem: () => {},
    clear: () => {},
    key: () => null,
    length: 0,
  };
  try {
    Object.defineProperty(window, 'localStorage', { value: blocked, configurable: true });
  } catch {
    if (typeof Storage === 'function') {
      Object.defineProperty(Storage.prototype, 'setItem', {
        value() {
          throw new Error('storage blocked by test');
        },
        configurable: true,
      });
    }
  }
}

function blockBroadcastChannel() {
  Object.defineProperty(window, 'BroadcastChannel', {
    value: undefined,
    configurable: true,
    writable: true,
  });
}

test('an already-open tab follows a second tab sign-in when storage is blocked', async ({ page, context }) => {
  await context.addInitScript(blockLocalStorage);
  await mockCrossTabAccounts(context);

  await page.goto('/en/login?portal=student');
  await signIn(page, USER_A.email);
  await expect(page).toHaveURL(/\/en\/dashboard(\?|$)/, NAV_TIMEOUT);
  await expect(page.getByText(/up to 111 more credits/i)).toBeVisible(NAV_TIMEOUT);

  const tabB = await context.newPage();
  try {
    await tabB.goto('/en/login?portal=student');
    await signIn(tabB, USER_B.email);
    await expect(tabB).toHaveURL(/\/en\/dashboard(\?|$)/, NAV_TIMEOUT);
    await expect(tabB.getByText(/up to 222 more credits/i)).toBeVisible(NAV_TIMEOUT);

    await expect(page.getByText(/up to 222 more credits/i)).toBeVisible(NAV_TIMEOUT);
    await expect(page.getByText(/up to 111 more credits/i)).toHaveCount(0);
  } finally {
    await tabB.close().catch(() => {});
  }
});

test('an already-open tab resyncs to the real cookie on focus when both transports are blocked', async ({ page, context }) => {
  await context.addInitScript(blockLocalStorage);
  await context.addInitScript(blockBroadcastChannel);
  await mockCrossTabAccounts(context);

  await page.goto('/en/login?portal=student');
  await signIn(page, USER_A.email);
  await expect(page).toHaveURL(/\/en\/dashboard(\?|$)/, NAV_TIMEOUT);
  await expect(page.getByText(/up to 111 more credits/i)).toBeVisible(NAV_TIMEOUT);

  const tabB = await context.newPage();
  try {
    await tabB.goto('/en/login?portal=student');
    await signIn(tabB, USER_B.email);
    await expect(tabB).toHaveURL(/\/en\/dashboard(\?|$)/, NAV_TIMEOUT);
    await expect(tabB.getByText(/up to 222 more credits/i)).toBeVisible(NAV_TIMEOUT);

    await page.evaluate(() => {
      window.dispatchEvent(new Event('blur'));
      window.dispatchEvent(new Event('focus'));
    });

    await expect(page.getByText(/up to 222 more credits/i)).toBeVisible(NAV_TIMEOUT);
    await expect(page.getByText(/up to 111 more credits/i)).toHaveCount(0);
  } finally {
    await tabB.close().catch(() => {});
  }
});

test('a stale held /me probe cannot displace an external sign-in on the shared cookie', async ({ page, context }) => {
  const heldMe: import('@playwright/test').Route[] = [];
  await mockCrossTabAccounts(context, { heldMeRoutes: heldMe });
  await context.addCookies([
    {
      name: 'cc_access_token',
      value: CROSS_A_COOKIE,
      url: test.info().project.use.baseURL as string,
    },
  ]);

  await page.goto('/en/dashboard');
  await expect.poll(() => heldMe.length, NAV_TIMEOUT).toBe(1);

  const tabB = await context.newPage();
  try {
    await tabB.goto('/en/login?portal=student');
    await signIn(tabB, USER_B.email);
    await expect(tabB).toHaveURL(/\/en\/dashboard(\?|$)/, NAV_TIMEOUT);
    await expect(tabB.getByText(/up to 222 more credits/i)).toBeVisible(NAV_TIMEOUT);

    await expect(page.getByText(/up to 222 more credits/i)).toBeVisible(NAV_TIMEOUT);
    await expect(page.getByText(/up to 111 more credits/i)).toHaveCount(0);
    await expect(page.getByText(USER_A.firstName)).toHaveCount(0);
  } finally {
    await heldMe[0]
      ?.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(USER_A),
      })
      .catch(() => {});
    await tabB.close().catch(() => {});
  }
});

test('a BFCache-restored tab revalidates the shared cookie', async ({ page, context }) => {
  const meCounter = { count: 0 };
  await mockCrossTabAccounts(context, { meCounter });

  await page.goto('/en/login?portal=student');
  await signIn(page, USER_A.email);
  await expect(page).toHaveURL(/\/en\/dashboard(\?|$)/, NAV_TIMEOUT);
  await expect(page.getByText(/up to 111 more credits/i)).toBeVisible(NAV_TIMEOUT);
  const probesBefore = meCounter.count;

  await page.evaluate(() => {
    (window as { __bfcacheAlive?: boolean }).__bfcacheAlive = true;
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
  });

  await expect.poll(() => meCounter.count, NAV_TIMEOUT).toBeGreaterThan(probesBefore);
  const alive = await page.evaluate(
    () => (window as { __bfcacheAlive?: boolean }).__bfcacheAlive === true,
  );
  expect(alive, 'the restore must produce a fresh document').toBe(false);
  await expect(page.getByText(/up to 111 more credits/i)).toBeVisible(NAV_TIMEOUT);
});

test('overlapping tab sign-ins settle on the surviving shared cookie without a sender reload loop', async ({ page, context }) => {
  const heldLogins: { route: import('@playwright/test').Route; isB: boolean }[] = [];
  await mockCrossTabAccounts(context, { heldLogins });

  await page.goto('/en/login?portal=student');
  await expect(page.locator('#email')).toBeVisible(NAV_TIMEOUT);
  const tabB = await context.newPage();
  try {
    await tabB.goto('/en/login?portal=student');
    await expect(tabB.locator('#email')).toBeVisible(NAV_TIMEOUT);

    await page.evaluate(() => {
      (window as { __senderAlive?: boolean }).__senderAlive = true;
    });
    await tabB.evaluate(() => {
      (window as { __senderAlive?: boolean }).__senderAlive = true;
    });

    await signIn(page, USER_A.email);
    await signIn(tabB, USER_B.email);
    await expect.poll(() => heldLogins.length, NAV_TIMEOUT).toBe(1);
    await page.waitForTimeout(300);
    expect(
      heldLogins.length,
      'the shared session transport serializes cookie writes, so the second intent cannot dispatch while the first is held',
    ).toBe(1);

    const first = heldLogins[0];
    const firstUser = first.isB ? USER_B : USER_A;
    const firstMarker = first.isB ? CROSS_B_COOKIE : CROSS_A_COOKIE;
    const firstCredits = first.isB ? 222 : 111;
    const loserCredits = first.isB ? 111 : 222;
    const winnerPage = first.isB ? tabB : page;
    const loserPage = first.isB ? page : tabB;

    await first.route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'set-cookie': `cc_access_token=${firstMarker}; Path=/; SameSite=Lax` },
      body: JSON.stringify({ user: firstUser, accessToken: 'stub-access', refreshToken: 'stub-refresh' }),
    });
    await expect(winnerPage).toHaveURL(/\/en\/dashboard(\?|$)/, NAV_TIMEOUT);
    await expect(
      winnerPage.getByText(new RegExp(`up to ${firstCredits} more credits`, 'i')),
    ).toBeVisible(NAV_TIMEOUT);

    await expect(loserPage).toHaveURL(/\/login/, NAV_TIMEOUT);
    await expect(loserPage.locator('#email')).toBeVisible(NAV_TIMEOUT);
    const loserSentinel = await loserPage.evaluate(
      () => (window as { __senderAlive?: boolean }).__senderAlive === true,
    );
    expect(loserSentinel, 'the receiving document must reload after the external sign-in').toBe(false);
    await expect(
      loserPage.getByText(new RegExp(`up to ${loserCredits} more credits`, 'i')),
    ).toHaveCount(0);

    const marker = (await context.cookies()).find((cookie) => cookie.name === 'cc_access_token')?.value;
    expect(marker, 'the surviving sign-in cookie must be the fulfilled one').toBe(firstMarker);

    const senderAlive = await winnerPage.evaluate(
      () => (window as { __senderAlive?: boolean }).__senderAlive === true,
    );
    expect(senderAlive, 'the publishing document must not reload from its own message').toBe(true);
  } finally {
    await heldLogins[1]?.route
      .fulfill({ status: 503, contentType: 'application/json', body: '{}' })
      .catch(() => {});
    await tabB.close().catch(() => {});
  }
});

test('an already-open tab reaches the login form when a second tab logout fails upstream', async ({ page, context }) => {
  await mockCrossTabAccounts(context, { logoutStatus: 503 });

  await page.goto('/en/login?portal=student');
  await signIn(page, USER_A.email);
  await expect(page).toHaveURL(/\/en\/dashboard(\?|$)/, NAV_TIMEOUT);
  await expect(page.getByText(/up to 111 more credits/i)).toBeVisible(NAV_TIMEOUT);

  const tabB = await context.newPage();
  try {
    await tabB.goto('/en/dashboard');
    await expect(tabB.getByText(/up to 111 more credits/i)).toBeVisible(NAV_TIMEOUT);
    await tabB.locator('a[href="/en/dashboard/sign-out"]').dispatchEvent('click');
    await expect(tabB).toHaveURL(/\/login/, NAV_TIMEOUT);

    await expect(page).toHaveURL(/\/login/, NAV_TIMEOUT);
    await expect(page.locator('#email')).toBeVisible();
    await expect(page.getByText(/up to 111 more credits/i)).toHaveCount(0);
    await expect(page.getByText(USER_A.firstName)).toHaveCount(0);
  } finally {
    await tabB.close().catch(() => {});
  }
});

test('an already-open tab converges on the next poll tick when no transport delivers', async ({ page, context }) => {
  await context.addInitScript(blockBroadcastChannel);
  await mockCrossTabAccounts(context);
  await page.clock.install();

  await page.goto('/en/login?portal=student');
  await signIn(page, USER_A.email);
  await expect(page).toHaveURL(/\/en\/dashboard(\?|$)/, NAV_TIMEOUT);
  await expect(page.getByText(/up to 111 more credits/i)).toBeVisible(NAV_TIMEOUT);

  const tabB = await context.newPage();
  await tabB.addInitScript(blockLocalStorage);
  try {
    await tabB.goto('/en/login?portal=student');
    await signIn(tabB, USER_B.email);
    await expect(tabB).toHaveURL(/\/en\/dashboard(\?|$)/, NAV_TIMEOUT);
    await expect(tabB.getByText(/up to 222 more credits/i)).toBeVisible(NAV_TIMEOUT);

    await page.bringToFront();
    await expect(
      page.getByText(/up to 111 more credits/i),
      'no transport delivered the change, so the tab still shows the old identity before the tick',
    ).toBeVisible(NAV_TIMEOUT);

    await page.clock.runFor(30_000);
    await expect(page.getByText(/up to 222 more credits/i)).toBeVisible(NAV_TIMEOUT);
    await expect(page.getByText(/up to 111 more credits/i)).toHaveCount(0);
    await expect(page.getByText(USER_A.firstName)).toHaveCount(0);
  } finally {
    await tabB.close().catch(() => {});
  }
});

test('a stable shared cookie survives poll ticks without reloading the document', async ({ page, context }) => {
  const meCounter = { count: 0 };
  await mockCrossTabAccounts(context, { meCounter });
  await page.clock.install();

  await page.goto('/en/login?portal=student');
  await signIn(page, USER_A.email);
  await expect(page).toHaveURL(/\/en\/dashboard(\?|$)/, NAV_TIMEOUT);
  await expect(page.getByText(/up to 111 more credits/i)).toBeVisible(NAV_TIMEOUT);
  await page.evaluate(() => {
    (window as { __pollDocAlive?: boolean }).__pollDocAlive = true;
  });
  const probesBefore = meCounter.count;

  await page.clock.runFor(30_000);
  await expect.poll(() => meCounter.count, NAV_TIMEOUT).toBe(probesBefore + 1);
  await page.clock.runFor(30_000);
  await expect.poll(() => meCounter.count, NAV_TIMEOUT).toBe(probesBefore + 2);

  const alive = await page.evaluate(
    () => (window as { __pollDocAlive?: boolean }).__pollDocAlive === true,
  );
  expect(alive, 'two stable poll ticks must not reload the document').toBe(true);
  await expect(page).toHaveURL(/\/en\/dashboard(\?|$)/);
  await expect(page.getByText(/up to 111 more credits/i)).toBeVisible(NAV_TIMEOUT);
});

test('a revoked session drives an already-open tab to login on the next poll', async ({ page, context }) => {
  await context.addInitScript(blockBroadcastChannel);
  await mockCrossTabAccounts(context);
  await page.clock.install();

  await page.goto('/en/login?portal=student');
  await signIn(page, USER_A.email);
  await expect(page).toHaveURL(/\/en\/dashboard(\?|$)/, NAV_TIMEOUT);
  await expect(page.getByText(/up to 111 more credits/i)).toBeVisible(NAV_TIMEOUT);

  const tabB = await context.newPage();
  await tabB.addInitScript(blockLocalStorage);
  try {
    await tabB.goto('/en/dashboard');
    await expect(tabB.getByText(/up to 111 more credits/i)).toBeVisible(NAV_TIMEOUT);
    await tabB.locator('a[href="/en/dashboard/sign-out"]').dispatchEvent('click');
    await expect(tabB).toHaveURL(/\/login/, NAV_TIMEOUT);

    await page.bringToFront();
    await expect(
      page.getByText(/up to 111 more credits/i),
      'no transport delivered the sign-out, so the tab still shows the old identity before the tick',
    ).toBeVisible(NAV_TIMEOUT);

    await page.clock.runFor(30_000);
    await expect(page).toHaveURL(/\/login/, NAV_TIMEOUT);
    await expect(page.locator('#email')).toBeVisible(NAV_TIMEOUT);
    await expect(page.getByText(/up to 111 more credits/i)).toHaveCount(0);
  } finally {
    await tabB.close().catch(() => {});
  }
});

test('a delayed 401 during a newer session never signs the tab out', async ({ page, context }) => {
  await context.addInitScript(blockBroadcastChannel);
  const heldNotifications: import('@playwright/test').Route[] = [];
  const lateMe = {
    armed: false,
    autoActor: false,
    routes: [] as import('@playwright/test').Route[],
  };
  await mockCrossTabAccounts(context, { heldNotifications });
  await page.clock.install();
  await page.route('**/api/v1/auth/me', async (route, request) => {
    const actor =
      /cc_access_token=([^;]+)/.exec(request.headers()['cookie'] ?? '')?.[1] ?? 'none';
    const user = actor === CROSS_B_COOKIE ? USER_B : actor === CROSS_A_COOKIE ? USER_A : null;
    const respond = () =>
      user
        ? route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(user),
          })
        : route.fulfill({
            status: 401,
            contentType: 'application/json',
            body: '{"code":"UNAUTHORIZED"}',
          });
    if (!lateMe.armed) {
      return respond();
    }
    lateMe.routes.push(route);
    if (lateMe.autoActor) {
      return respond();
    }
  });

  await page.goto('/en/login?portal=student');
  await signIn(page, USER_A.email);
  await expect(page).toHaveURL(/\/en\/dashboard(\?|$)/, NAV_TIMEOUT);
  await expect(page.getByText(/up to 111 more credits/i)).toBeVisible(NAV_TIMEOUT);
  await expect.poll(() => heldNotifications.length, NAV_TIMEOUT).toBe(2);

  const tabB = await context.newPage();
  await tabB.addInitScript(blockLocalStorage);
  try {
    await tabB.goto('/en/login?portal=student');
    await signIn(tabB, USER_B.email);
    await expect(tabB).toHaveURL(/\/en\/dashboard(\?|$)/, NAV_TIMEOUT);
    await expect(tabB.getByText(/up to 222 more credits/i)).toBeVisible(NAV_TIMEOUT);

    lateMe.armed = true;
    const unauthorized = {
      status: 401,
      contentType: 'application/json',
      body: '{"code":"UNAUTHORIZED"}',
    };
    await Promise.all(
      heldNotifications
        .slice(0, 2)
        .map((held) => held.fulfill(unauthorized).catch(() => {})),
    );

    await expect.poll(() => lateMe.routes.length, NAV_TIMEOUT).toBe(1);
    await context.addCookies([
      {
        name: 'cc_csrf',
        value: 'cross-hint-b',
        url: test.info().project.use.baseURL as string,
      },
    ]);
    await lateMe.routes[0].fulfill(unauthorized).catch(() => {});

    await page.waitForTimeout(400);
    await expect(
      page,
      'a session write mid-confirmation marks the 401 stale, not revoked',
    ).toHaveURL(/\/en\/dashboard(\?|$)/);
    await expect(page.getByText(/up to 111 more credits/i)).toBeVisible(NAV_TIMEOUT);

    await page.bringToFront();
    await page.clock.runFor(30_000);
    await expect.poll(() => lateMe.routes.length, NAV_TIMEOUT).toBe(2);
    lateMe.autoActor = true;
    await lateMe.routes[1].fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(USER_B),
    });
    await expect.poll(() => lateMe.routes.length, NAV_TIMEOUT).toBe(3);
    await expect(page.getByText(/up to 222 more credits/i)).toBeVisible(NAV_TIMEOUT);
    await expect(page.getByText(/up to 111 more credits/i)).toHaveCount(0);
  } finally {
    for (const held of heldNotifications.slice(2)) {
      await held
        .fulfill({ status: 200, contentType: 'application/json', body: '{"data":[]}' })
        .catch(() => {});
    }
    for (const held of lateMe.routes.slice(2)) {
      await held
        .fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(USER_B) })
        .catch(() => {});
    }
    await tabB.close().catch(() => {});
  }
});
