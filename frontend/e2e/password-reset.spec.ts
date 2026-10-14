import { expect, test } from '@playwright/test';

/**
 * Self-service password recovery (anonymous). The web app's own /api/v1 proxy
 * is route-mocked so the run never depends on a live backend: the contract
 * under test is that the UI shows one generic banner for every accepted
 * forgot request, strips the reset token from the URL, gates weak passwords
 * client-side, and maps RESET_TOKEN_INVALID / success correctly.
 */

const GENERIC_200 = { message: 'If an account matches, a reset link has been sent.' };
const RESET_OK = { message: 'Password has been reset.' };
const VALID_TOKEN = 'aB3xK9mQ2wN7vR4tY8uI0oP1lZ6xC5vB3nM9qA2sD4f';

async function mockForgot(page: import('@playwright/test').Page, status = 200, body: unknown = GENERIC_200) {
  await page.route('**/api/v1/auth/forgot-password', (route) =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) }));
}

async function mockReset(
  page: import('@playwright/test').Page,
  status = 200,
  body: unknown = RESET_OK,
) {
  await page.route('**/api/v1/auth/reset-password', (route) =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) }));
}

test('forgot-password shows the same generic banner for known and unknown emails', async ({ page }) => {
  await mockForgot(page);
  await page.goto('/forgot-password');

  await page.locator('#forgot-email').fill('student@campuscore.edu');
  await page.getByRole('button', { name: 'Gửi liên kết đặt lại' }).click();
  await expect(page.locator('#forgot-sent-banner')).toBeVisible();
  await expect(page.locator('#forgot-sent-banner')).toContainText('student@campuscore.edu');

  // A second, unrelated mailbox must produce the identical banner shape.
  await page.locator('#forgot-email').fill('nobody@example.com');
  await page.getByRole('button', { name: 'Gửi liên kết đặt lại' }).click();
  await expect(page.locator('#forgot-sent-banner')).toBeVisible();
  await expect(page.locator('#forgot-sent-banner')).toContainText('nobody@example.com');
});

test('forgot-password shows a friendly message on 429', async ({ page }) => {
  await mockForgot(page, 429, { code: 'RATE_LIMIT_EXCEEDED' });
  await page.goto('/forgot-password');

  await page.locator('#forgot-email').fill('student@campuscore.edu');
  await page.getByRole('button', { name: 'Gửi liên kết đặt lại' }).click();
  await expect(page.locator('#forgot-error')).toBeVisible();
  await expect(page.locator('#forgot-error')).toContainText('quá nhiều lần');
});

test('reset-password without a token shows the invalid-link state', async ({ page }) => {
  await page.goto('/reset-password');
  await expect(page.getByRole('heading', { name: 'Liên kết đặt lại này không còn hợp lệ' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Yêu cầu liên kết mới' })).toHaveAttribute(
    'href',
    expect.stringContaining('/forgot-password'),
  );
  // The form must not render at all in the invalid state.
  await expect(page.locator('#new-password')).toHaveCount(0);
});

test('reset-password removes the token from the address bar on load', async ({ page }) => {
  await page.goto(`/reset-password?token=${VALID_TOKEN}`);
  await expect(page.locator('#new-password')).toBeVisible();
  await expect.poll(() => page.url()).not.toContain('token=');
  expect(page.url()).toContain('/reset-password');
});

test('a weak password is blocked client-side before any API call', async ({ page }) => {
  let apiCalls = 0;
  await page.route('**/api/v1/auth/reset-password', (route) => {
    apiCalls += 1;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(RESET_OK) });
  });
  await page.goto(`/reset-password?token=${VALID_TOKEN}`);

  await page.locator('#new-password').fill('khongcoso');
  await page.locator('#confirm-password').fill('khongcoso');
  await page.getByRole('button', { name: 'Đặt lại mật khẩu' }).click();

  await expect(page.locator('#reset-error')).toBeVisible();
  await expect(page.locator('#reset-error')).toContainText('một chữ cái và một chữ số');
  expect(apiCalls).toBe(0);
});

test('server RESET_TOKEN_INVALID switches to the invalid-link state', async ({ page }) => {
  await mockReset(page, 400, { code: 'RESET_TOKEN_INVALID' });
  await page.goto(`/reset-password?token=${VALID_TOKEN}`);

  await page.locator('#new-password').fill('MatKhauMoi9');
  await page.locator('#confirm-password').fill('MatKhauMoi9');
  await page.getByRole('button', { name: 'Đặt lại mật khẩu' }).click();

  await expect(page.getByRole('heading', { name: 'Liên kết đặt lại này không còn hợp lệ' })).toBeVisible();
  await expect(page.locator('#new-password')).toHaveCount(0);
});

test('a successful reset shows the toast then lands on /login?reset=1 with the banner', async ({ page }) => {
  await mockReset(page);
  await page.goto(`/reset-password?token=${VALID_TOKEN}`);

  await page.locator('#new-password').fill('MatKhauMoi9');
  await page.locator('#confirm-password').fill('MatKhauMoi9');
  await page.getByRole('button', { name: 'Đặt lại mật khẩu' }).click();

  await expect(page.locator('#reset-success-banner')).toBeVisible();
  await page.waitForURL('**/login?reset=1', { timeout: 10_000 });
  await expect(page.locator('text=Đã cập nhật mật khẩu')).toBeVisible();
});

for (const variant of [
  { prefix: '/vi', submitName: 'Đặt lại mật khẩu', bannerText: 'Đã cập nhật mật khẩu' },
  { prefix: '/en', submitName: 'Reset password', bannerText: 'Password updated' },
] as const) {
  test(`a successful reset on ${variant.prefix} lands on the localized login banner`, async ({ page }) => {
    await mockReset(page);
    await page.goto(`${variant.prefix}/reset-password?token=${VALID_TOKEN}`);

    await page.locator('#new-password').fill('MatKhauMoi9');
    await page.locator('#confirm-password').fill('MatKhauMoi9');
    await page.getByRole('button', { name: variant.submitName }).click();

    await expect(page.locator('#reset-success-banner')).toBeVisible();
    await page.waitForURL(`**${variant.prefix}/login?reset=1`, { timeout: 10_000 });
    await expect(page.locator(`text=${variant.bannerText}`)).toBeVisible();
  });
}

test('forgot and reset pages do not overflow horizontally at 390px and 1366px', async ({ page }) => {
  const noOverflow = async () =>
    page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    );

  for (const width of [390, 1366]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/forgot-password');
    expect(await noOverflow(), `forgot-password overflows at ${width}px`).toBe(true);

    await page.goto(`/reset-password?token=${VALID_TOKEN}`);
    expect(await noOverflow(), `reset-password overflows at ${width}px`).toBe(true);
  }
});
