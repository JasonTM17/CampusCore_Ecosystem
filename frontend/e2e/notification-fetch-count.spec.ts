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

const STUDENT_B = {
  ...STUDENT,
  id: 'count-probe-student-b',
  email: 'count-probe-b@example.test',
  studentId: 'count-probe-student-b',
};

const A_NOTIFICATIONS = { data: [{ id: 'n-a', title: 'A_PRIVATE_NOTIFICATION', content: 'a-body', isRead: false, createdAt: '2026-10-13T00:00:00Z' }] };
const B_NOTIFICATIONS = { data: [{ id: 'n-b', title: 'B_PRIVATE_NOTIFICATION', content: 'b-body', isRead: false, createdAt: '2026-10-13T00:00:00Z' }] };

async function mockIdentitySwitch(page: Page) {
  const counts = {
    notifications: 0,
    unreadCount: 0,
    authMe: 0,
    profilePut: 0,
    aDelivered: 0,
    markRead: 0,
    markReadDelivered: 0,
  };
  let listGate!: () => void;
  let countGate!: () => void;
  const listHeld = new Promise<void>((resolve) => (listGate = resolve));
  const countHeld = new Promise<void>((resolve) => (countGate = resolve));
  let aOutcome: 'ok' | 'error' = 'ok';
  let markReadGate!: () => void;
  const markReadHeld = new Promise<void>((resolve) => (markReadGate = resolve));
  let markReadOutcome: 'ok' | 'error' = 'ok';

  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

    if (path === '/api/v1/auth/me') {
      counts.authMe += 1;
      return json(counts.authMe === 1 ? STUDENT : STUDENT_B);
    }
    if (path === '/api/v1/auth/refresh') {
      return json({ code: 'UNAUTHORIZED' }, 401);
    }
    if (path === '/api/v1/auth/profile' && request.method() === 'PUT') {
      counts.profilePut += 1;
      return json({});
    }
    if (path === '/api/v1/notifications/my/unread-count') {
      counts.unreadCount += 1;
      if (counts.unreadCount === 1) {
        await countHeld;
        await (aOutcome === 'ok' ? json({ unreadCount: 3 }) : json({ code: 'UNAVAILABLE' }, 500));
        counts.aDelivered += 1;
        return;
      }
      return json({ unreadCount: 7 });
    }
    if (path === '/api/v1/notifications/my') {
      counts.notifications += 1;
      if (counts.notifications === 1) {
        await listHeld;
        await (aOutcome === 'ok' ? json(A_NOTIFICATIONS) : json({ code: 'UNAVAILABLE' }, 500));
        counts.aDelivered += 1;
        return;
      }
      return json(B_NOTIFICATIONS);
    }
    if (path === '/api/v1/notifications/my/n-a/read' && request.method() === 'PATCH') {
      counts.markRead += 1;
      await markReadHeld;
      await (markReadOutcome === 'ok' ? json({}) : json({ code: 'UNAVAILABLE' }, 500));
      counts.markReadDelivered += 1;
      return;
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

  return {
    counts,
    releaseA: (outcome: 'ok' | 'error') => {
      aOutcome = outcome;
      listGate();
      countGate();
    },
    releaseMarkRead: (outcome: 'ok' | 'error') => {
      markReadOutcome = outcome;
      markReadGate();
    },
  };
}

async function switchIdentityViaProfileForm(page: Page) {
  const toggle = page.getByRole('button', { name: 'Toggle profile menu', exact: true });
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  const menu = page.locator('#dashboard-profile-menu');
  await expect(menu).toBeVisible();
  await menu.getByRole('menuitem', { name: 'Profile', exact: true }).click();
  await expect(page.locator('#profile-phone')).toBeVisible({ timeout: 30_000 });
  await page.locator('#profile-phone').fill('0123456789');
  await page.getByRole('button', { name: 'Save changes' }).click();
}

test('a stale notification response cannot overwrite the switched identity', async ({ page, context }) => {
  const { counts, releaseA } = await mockIdentitySwitch(page);
  await context.addCookies([
    { name: 'cc_csrf', value: 'hint-fixture', url: test.info().project.use.baseURL as string },
  ]);

  await page.goto('/en/dashboard');
  const bell = page.getByRole('button', { name: 'Toggle notifications panel' });
  await expect(bell).toBeVisible({ timeout: 30_000 });

  await switchIdentityViaProfileForm(page);
  await expect(page.locator('#profile-email')).toHaveValue('count-probe-b@example.test', { timeout: 15_000 });
  expect(counts.profilePut).toBe(1);

  await bell.click();
  const panel = page.getByRole('dialog', { name: 'Notifications' });
  await expect(panel.getByText('B_PRIVATE_NOTIFICATION')).toBeVisible({ timeout: 15_000 });

  releaseA('ok');
  await expect.poll(() => counts.aDelivered, { timeout: 10_000 }).toBe(2);
  await expect(panel.getByText('A_PRIVATE_NOTIFICATION')).toHaveCount(0);
  await expect(panel.getByText('B_PRIVATE_NOTIFICATION')).toBeVisible();
  await expect(page.getByText('Notifications could not be loaded right now.')).toHaveCount(0);
});

test('a stale notification failure cannot wipe the switched identity', async ({ page, context }) => {
  const { counts, releaseA } = await mockIdentitySwitch(page);
  await context.addCookies([
    { name: 'cc_csrf', value: 'hint-fixture', url: test.info().project.use.baseURL as string },
  ]);

  await page.goto('/en/dashboard');
  const bell = page.getByRole('button', { name: 'Toggle notifications panel' });
  await expect(bell).toBeVisible({ timeout: 30_000 });

  await switchIdentityViaProfileForm(page);
  await expect(page.locator('#profile-email')).toHaveValue('count-probe-b@example.test', { timeout: 15_000 });

  await bell.click();
  const panel = page.getByRole('dialog', { name: 'Notifications' });
  await expect(panel.getByText('B_PRIVATE_NOTIFICATION')).toBeVisible({ timeout: 15_000 });

  releaseA('error');
  await expect.poll(() => counts.aDelivered, { timeout: 10_000 }).toBe(2);
  await expect(panel.getByText('B_PRIVATE_NOTIFICATION')).toBeVisible();
  await expect(panel.getByRole('alert')).toHaveCount(0);
});

test('a stale mark-read failure cannot restore rows under the switched identity', async ({ page, context }) => {
  const { counts, releaseA, releaseMarkRead } = await mockIdentitySwitch(page);
  await context.addCookies([
    { name: 'cc_csrf', value: 'hint-fixture', url: test.info().project.use.baseURL as string },
  ]);

  await page.goto('/en/dashboard');
  const bell = page.getByRole('button', { name: 'Toggle notifications panel' });
  await expect(bell).toBeVisible({ timeout: 30_000 });

  releaseA('ok');
  await bell.click();
  let panel = page.getByRole('dialog', { name: 'Notifications' });
  await expect(panel.getByText('A_PRIVATE_NOTIFICATION')).toBeVisible({ timeout: 15_000 });

  await panel.getByText('A_PRIVATE_NOTIFICATION').click();
  await expect.poll(() => counts.markRead, { timeout: 10_000 }).toBe(1);

  await switchIdentityViaProfileForm(page);
  await expect(page.locator('#profile-email')).toHaveValue('count-probe-b@example.test', { timeout: 15_000 });

  await bell.click();
  panel = page.getByRole('dialog', { name: 'Notifications' });
  await expect(panel.getByText('B_PRIVATE_NOTIFICATION')).toBeVisible({ timeout: 15_000 });

  releaseMarkRead('error');
  await expect.poll(() => counts.markReadDelivered, { timeout: 10_000 }).toBe(1);
  await expect(panel.getByText('A_PRIVATE_NOTIFICATION')).toHaveCount(0);
  await expect(panel.getByText('B_PRIVATE_NOTIFICATION')).toBeVisible();
  await expect(page.getByText('The notification could not be updated. Try again.')).toHaveCount(0);
});

test('a same-user mark-read failure still restores the row and badge', async ({ page, context }) => {
  const { counts, releaseA, releaseMarkRead } = await mockIdentitySwitch(page);
  await context.addCookies([
    { name: 'cc_csrf', value: 'hint-fixture', url: test.info().project.use.baseURL as string },
  ]);

  await page.goto('/en/dashboard');
  const bell = page.getByRole('button', { name: 'Toggle notifications panel' });
  await expect(bell).toBeVisible({ timeout: 30_000 });

  releaseA('ok');
  await bell.click();
  const panel = page.getByRole('dialog', { name: 'Notifications' });
  await expect(panel.getByText('A_PRIVATE_NOTIFICATION')).toBeVisible({ timeout: 15_000 });

  await panel.getByText('A_PRIVATE_NOTIFICATION').click();
  await expect.poll(() => counts.markRead, { timeout: 10_000 }).toBe(1);

  releaseMarkRead('error');
  await expect.poll(() => counts.markReadDelivered, { timeout: 10_000 }).toBe(1);
  await expect(page.getByText('The notification could not be updated. Try again.')).toBeVisible({ timeout: 10_000 });
  await bell.click();
  await expect(panel.getByText('A_PRIVATE_NOTIFICATION')).toBeVisible({ timeout: 15_000 });
});
