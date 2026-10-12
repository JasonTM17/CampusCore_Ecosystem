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
