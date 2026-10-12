import { expect, test } from '@playwright/test';

/**
 * Roadmap 1.5 (a11y): a REAL pointer click on the login submit button and
 * Enter-in-password must both dispatch the form submit — no overlay, no
 * hydration-gated disabled state may swallow them.
 *
 * The probe account does not exist, so every accepted submit ends in the
 * invalid-credentials alert (or the backend-unavailable alert when no API is
 * reachable). An alert appearing is the proof that the submit went through the
 * React handler end to end; silence means a layer ate the interaction.
 *
 * Never run this against a real seeded account: failed attempts must not risk
 * lockout. `a11y-probe` cannot authenticate or lock anything.
 */

const PROBE_EMAIL = 'a11y-probe@campuscore.edu';
const PROBE_PASSWORD = 'probe-password-does-not-matter';

async function expectSubmitReaction(page: import('@playwright/test').Page) {
  const alert = page.locator('#login-error');
  await expect(alert).toBeVisible({ timeout: 15_000 });
}

test('a real pointer click on the submit button dispatches the login', async ({ page }) => {
  await page.goto('/login?portal=admin');
  await page.locator('#email').fill(PROBE_EMAIL);
  await page.locator('#password').fill(PROBE_PASSWORD);
  // getByRole + plain click: no force, no evaluate — the click must survive
  // the real hit-test path exactly like a user's pointer press.
  await page.getByRole('button', { name: 'Đăng nhập' }).click();
  await expectSubmitReaction(page);
});

test('Enter in the password field submits the form', async ({ page }) => {
  await page.goto('/login?portal=admin');
  await page.locator('#email').fill(PROBE_EMAIL);
  await page.locator('#password').fill(PROBE_PASSWORD);
  await page.locator('#password').press('Enter');
  await expectSubmitReaction(page);
});

/**
 * Portal-mismatch recovery: a valid account submitted on the wrong tab is
 * still refused (the session is dropped), but the alert now carries an
 * action link to the portal the account actually belongs to — and the
 * typed credentials must survive the portal switch.
 */

async function mockLoginAs(page: import('@playwright/test').Page, roles: string[]) {
  await page.route('**/api/v1/auth/login', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        user: {
          id: 'probe-user',
          email: PROBE_EMAIL,
          firstName: 'Probe',
          lastName: 'User',
          status: 'ACTIVE',
          mustChangePassword: false,
          roles,
        },
        accessToken: 'stub-access',
        refreshToken: 'stub-refresh',
      }),
    }),
  );
  // Session probes and the mismatch logout are allowed to fail/no-op; only
  // the login payload shapes the branch under test.
  await page.route('**/api/v1/auth/me', (route) => route.fulfill({ status: 401 }));
  await page.route('**/api/v1/auth/logout', (route) => route.fulfill({ status: 200 }));
}

async function fillAndSubmit(page: import('@playwright/test').Page) {
  await page.locator('#email').fill(PROBE_EMAIL);
  await page.locator('#password').fill(PROBE_PASSWORD);
  await page.getByRole('button', { name: 'Đăng nhập' }).click();
}

test('a student account on the admin tab links to the student portal', async ({ page }) => {
  await mockLoginAs(page, ['STUDENT']);
  await page.goto('/login?portal=admin');
  await fillAndSubmit(page);

  const alert = page.locator('#login-error');
  await expect(alert).toBeVisible({ timeout: 15_000 });
  const action = alert.getByRole('link');
  await expect(action).toBeVisible();
  await expect(action).toHaveAttribute('href', /portal=student/);

  await action.click();
  await expect(page).toHaveURL(/portal=student/);
  await expect(page.locator('#email')).toHaveValue(PROBE_EMAIL);
});

test('a lecturer account on the student tab links to the lecturer portal', async ({ page }) => {
  await mockLoginAs(page, ['LECTURER']);
  await page.goto('/login?portal=student');
  await fillAndSubmit(page);

  const alert = page.locator('#login-error');
  await expect(alert).toBeVisible({ timeout: 15_000 });
  const action = alert.getByRole('link');
  await expect(action).toBeVisible();
  await expect(action).toHaveAttribute('href', /portal=lecturer/);

  await action.click();
  await expect(page).toHaveURL(/portal=lecturer/);
  await expect(page.locator('#email')).toHaveValue(PROBE_EMAIL);
});

test('an admin account on the student tab links to the admin portal', async ({ page }) => {
  await mockLoginAs(page, ['ADMIN']);
  await page.goto('/login?portal=student');
  await fillAndSubmit(page);

  const alert = page.locator('#login-error');
  await expect(alert).toBeVisible({ timeout: 15_000 });
  const action = alert.getByRole('link');
  await expect(action).toBeVisible();
  await expect(action).toHaveAttribute('href', /portal=admin/);

  await action.click();
  await expect(page).toHaveURL(/portal=admin/);
  await expect(page.locator('#email')).toHaveValue(PROBE_EMAIL);
});
