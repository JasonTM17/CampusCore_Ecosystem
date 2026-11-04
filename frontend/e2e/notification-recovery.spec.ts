import { test, expect } from '@playwright/test';
import { submitLiveLogin } from './fixtures/live-login';

test('failed mark-read restores the preview row and unread badge without duplicates', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-390', 'This regression targets the mobile unread badge.');
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.name));
  await page.goto('/vi/login?portal=student');
  await page.locator('#email').fill('student@campuscore.edu');
  await page.locator('#password').fill('password123');
  const submit = page.locator('form').getByRole('button', { name: /đăng nhập|sign in/i });
  const loggedIn = await submitLiveLogin(page, submit);
  expect(loggedIn.status()).toBe(200);
  // The dev server compiles the dashboard on first use, which can outlast the default expect timeout.
  await expect(page).not.toHaveURL(/\/login/, { timeout: 30_000 });
  let writes = 0;
  let releaseWrite!: () => void;
  const writeGate = new Promise<void>(resolve => { releaseWrite = resolve; });
  await page.route('**/api/v1/notifications/my**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === 'PATCH' && path.endsWith('/read')) {
      writes += 1;
      await writeGate;
      return route.fulfill({ status: 503, contentType: 'application/json', body: '{"code":"UNAVAILABLE"}' });
    }
    if (path.endsWith('/unread-count')) {
      return route.fulfill({ json: { unreadCount: 1 } });
    }
    return route.fulfill({ json: { data: [{
      id: '55555555-5555-4555-8555-555555555555', title: 'Fixture cần đọc',
      content: 'Thông báo thử nghiệm', isRead: false, link: '/dashboard',
      createdAt: '2026-10-03T00:00:00Z',
    }], meta: { total: 1 } } });
  });
  await page.goto('/vi/dashboard');
  const menu = page.getByRole('navigation').getByRole('button', { name: 'Mở thanh điều hướng' });
  await expect(menu).toContainText('1');
  const bell = page.locator('button[aria-controls="dashboard-notifications-panel"]');
  await bell.click();
  const panel = page.locator('#dashboard-notifications-panel');
  const row = panel.getByRole('link', { name: /Fixture cần đọc/ });
  await expect(row).toHaveCount(1);
  await row.click();
  await expect.poll(() => writes).toBe(1);
  await expect(menu).not.toContainText('1');
  releaseWrite();
  const updateFailed = page.getByText('Không thể cập nhật thông báo này. Hãy thử lại.', { exact: true });
  await expect(updateFailed).toBeVisible();
  const toast = page.locator('[data-sonner-toast][data-type="error"]').filter({
    hasText: 'Không thể cập nhật thông báo này. Hãy thử lại.',
  });
  await toast.evaluate(async element => {
    await Promise.all(element.getAnimations().map(animation => animation.finished.catch(() => undefined)));
  });
  const toastBox = await toast.boundingBox();
  expect(toastBox, 'the error toast has a visible rectangle').not.toBeNull();
  if (!toastBox) throw new Error('The visible error toast has no bounding box.');
  const mobileNavBox = await page.locator('nav.fixed.bottom-0').boundingBox();
  expect(mobileNavBox, 'the mobile navigation has a visible rectangle').not.toBeNull();
  if (!mobileNavBox) throw new Error('The mobile navigation has no bounding box.');
  expect(toastBox.y + toastBox.height).toBeLessThanOrEqual(mobileNavBox.y);
  const controls = page.getByRole('banner').locator('a, button, [role="button"]');
  const overlaps: string[] = [];
  for (let index = 0; index < await controls.count(); index += 1) {
    const control = controls.nth(index);
    const controlBox = await control.boundingBox();
    if (!controlBox) continue;
    if (
      toastBox.x < controlBox.x + controlBox.width &&
      toastBox.x + toastBox.width > controlBox.x &&
      toastBox.y < controlBox.y + controlBox.height &&
      toastBox.y + toastBox.height > controlBox.y
    ) {
      const name = await control.getAttribute('aria-label') ?? await control.textContent() ?? 'unnamed control';
      overlaps.push(`${name.trim()} toast=${JSON.stringify(toastBox)} control=${JSON.stringify(controlBox)}`);
    }
  }
  expect(overlaps, 'the error toast must not overlap any dashboard header control').toEqual([]);
  await expect(menu).toContainText('1');
  // Keep the pointer off the toast so hover cannot pause its dismissal timer.
  await page.mouse.move(8, 400);
  await expect(updateFailed).toBeHidden({ timeout: 15_000 });
  await bell.click();
  await expect(row).toHaveCount(1);
  await expect(row).toBeVisible();
  expect(writes).toBe(1);
  expect(errors).toEqual([]);
});
