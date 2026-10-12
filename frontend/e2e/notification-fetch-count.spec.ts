import { expect, test, type Page } from '@playwright/test';

/**
 * Waterfall regression: on a hard page load with a valid session hint, the
 * dashboard layout used to fire /notifications/my + /unread-count TWICE —
 * once on the hint gate and again the moment /auth/me resolved, because the
 * identity-watch ref treated the normal null -> first-id transition as a
 * user switch. The ref must only re-arm on a real identity change
 * (A -> B, or sign-out), so each endpoint is requested exactly once.
 */

test.describe.configure({ timeout: 90_000 });

const TERM = {
  id: 'term-count-probe',
  name: 'Probe term',
  nameEn: 'Spring Term',
  nameVi: 'Học kỳ xuân',
  status: 'IN_PROGRESS',
};

const STUDENT = {
  id: 'count-probe-student',
  email: 'count-probe@example.test',
  firstName: 'Count',
  lastName: 'Student',
  status: 'ACTIVE',
  mustChangePassword: false,
  roles: ['STUDENT'],
  studentId: 'count-probe-student',
};

async function mockSession(page: Page, meDelayMs: number) {
  const counts = { notifications: 0, unreadCount: 0, authMe: 0 };
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

    if (path === '/api/v1/auth/me') {
      counts.authMe += 1;
      if (meDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, meDelayMs));
      }
      return json(STUDENT);
    }
    if (path === '/api/v1/auth/refresh') {
      return json({ code: 'UNAUTHORIZED' }, 401);
    }
    if (path === '/api/v1/notifications/my/unread-count') {
      counts.unreadCount += 1;
      return json({ unreadCount: 0 });
    }
    if (path === '/api/v1/notifications/my') {
      counts.notifications += 1;
      return json({ data: [] });
    }
    if (path === '/api/v1/semesters') {
      return json({ data: [TERM], meta: { total: 1, page: 1, limit: 100, totalPages: 1 } });
    }
    if (path === '/api/v1/me/registration/summary') {
      return json({ creditLimit: 18, creditsUsed: 0, creditsRemaining: 18 });
    }
    if (path === '/api/v1/enrollments/my') {
      return json([]);
    }
    return json({});
  });
  return counts;
}

test('a hinted first load requests each notification endpoint exactly once', async ({ page, context }) => {
  // cc_csrf is the session hint: the layout may fetch the bell while
  // /auth/me is still resolving. Delaying /me reproduces the production
  // waterfall where the second fire raced the first.
  const counts = await mockSession(page, 500);
  await context.addCookies([
    { name: 'cc_csrf', value: 'hint-fixture', url: test.info().project.use.baseURL as string },
  ]);

  await page.goto('/en/dashboard');
  await expect(page.getByText(/up to 18 more credits/i)).toBeVisible({
    timeout: 30_000,
  });
  // Let the post-/auth/me effects flush before counting.
  await page.waitForTimeout(1_000);

  expect(counts.authMe).toBe(1);
  expect(counts.notifications).toBe(1);
  expect(counts.unreadCount).toBe(1);
});
