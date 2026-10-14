import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import { submitLiveLogin } from './fixtures/live-login';

const RUN = process.env.E2E_ROLE_AUDIT_LIVE === '1';
const CREDENTIALS_PATH = process.env.E2E_ROLE_AUDIT_CREDENTIALS ?? '';
const API_BASE = process.env.E2E_API_URL ?? 'http://127.0.0.1:4100/api/v1';
const NAV_TIMEOUT = { timeout: 30_000 };
const submitName = /sign in|đăng nhập/i;

type AuditCreds = Record<string, { password: string }>;

const REQUIRED_CREDENTIAL_KEYS = ['audit-dean', 'audit-super'];

let credentialsLoadError = '';
function loadAuditCreds(): AuditCreds {
  if (!RUN) return {};
  if (!CREDENTIALS_PATH) {
    credentialsLoadError = 'E2E_ROLE_AUDIT_CREDENTIALS is not set';
    return {};
  }
  if (!fs.existsSync(CREDENTIALS_PATH)) {
    credentialsLoadError = 'E2E_ROLE_AUDIT_CREDENTIALS file does not exist';
    return {};
  }
  try {
    return JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8')) as AuditCreds;
  } catch {
    credentialsLoadError = 'E2E_ROLE_AUDIT_CREDENTIALS is not valid JSON';
    return {};
  }
}

const audit = loadAuditCreds();

const cases = [
  {
    key: 'student',
    email: 'student@campuscore.edu',
    password: 'password123',
    portal: 'student',
    url: /\/vi\/dashboard(?:$|[/?#])/,
    mePath: '/api/v1/auth/me',
    expectedRoles: ['STUDENT'],
    roleLabel: /Sinh viên|Truy cập sinh viên/i,
    businessPath: '/api/v1/enrollments/my',
    usersStatus: 403,
  },
  {
    key: 'lecturer',
    email: 'lecturer@campuscore.edu',
    password: 'password123',
    portal: 'lecturer',
    url: /\/vi\/dashboard\/lecturer(?:$|[/?#])/,
    mePath: '/api/v1/auth/me',
    expectedRoles: ['LECTURER'],
    roleLabel: /Giảng viên|Truy cập giảng viên/i,
    businessPath: '/api/v1/sections/my/grading',
    usersStatus: 403,
  },
  {
    key: 'admin',
    email: 'admin@campuscore.edu',
    password: 'password123',
    portal: 'student',
    url: /\/vi\/admin(?:$|[/?#])/,
    mePath: '/api/v1/auth/me',
    expectedRoles: ['ADMIN'],
    roleLabel: /Quản trị viên|Quản trị/i,
    businessPath: '/api/v1/courses',
    usersStatus: null,
  },
  {
    key: 'dean',
    email: 'audit-dean@campuscore.demo',
    password: audit['audit-dean']?.password ?? '',
    portal: 'student',
    url: /\/vi\/admin\/thesis(?:$|[/?#])/,
    labelPath: '/vi/dashboard',
    mePath: '/api/v1/auth/me',
    expectedRoles: ['LECTURER', 'TRUONG_KHOA'],
    roleLabel: /Trưởng khoa/,
    businessPath: '/api/v1/thesis/rounds',
    usersStatus: 403,
  },
  {
    key: 'super',
    email: 'audit-super@campuscore.demo',
    password: audit['audit-super']?.password ?? '',
    portal: 'student',
    url: /\/vi\/admin(?:$|[/?#])/,
    labelPath: '/vi/dashboard/thesis',
    mePath: '/api/v1/auth/me',
    expectedRoles: ['SUPER_ADMIN'],
    roleLabel: /Quản trị viên cấp cao/,
    businessPath: '/api/v1/courses',
    usersStatus: null,
  },
];

async function loginAs(page: Page, email: string, password: string, portal: string) {
  await page.goto(`/vi/login?portal=${portal}`);
  const submit = page.locator('form').getByRole('button', { name: submitName });
  await expect(submit).toBeEnabled(NAV_TIMEOUT);
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(password);
  await submitLiveLogin(page, submit);
}

async function me(page: Page) {
  const res = await page.request.get('/api/v1/auth/me');
  expect(res.status(), 'auth/me status for signed-in session').toBe(200);
  return res.json();
}

function expectRoles(meBody: { roles?: string[]; email?: string }, expected: string[]) {
  const roles = [...(meBody.roles ?? [])].sort();
  expect(roles).toEqual([...expected].sort());
}

test.beforeEach(() => {
  test.skip(!RUN, 'Opt-in only: set E2E_ROLE_AUDIT_LIVE=1 for the isolated live role audit.');
  const web = new URL(String(test.info().project.use.baseURL));
  const api = new URL(API_BASE);
  expect(['localhost', '127.0.0.1']).toContain(web.hostname);
  expect(web.port).toBe('3101');
  expect(['localhost', '127.0.0.1']).toContain(api.hostname);
  expect(api.port).toBe('4100');
  expect(credentialsLoadError).toBe('');
  for (const key of REQUIRED_CREDENTIAL_KEYS) {
    const password = audit[key]?.password;
    expect(
      typeof password === 'string' && password.length > 0,
      `missing credential entry for ${key} in the audit credentials file`,
    ).toBe(true);
  }
});

test.describe('live five-role business audit', () => {
  test.describe.configure({ timeout: 120_000 });

  for (const entry of cases) {
    test(`${entry.key} signs in through the real form and reaches the owned business surface`, async ({ page }) => {
      await loginAs(page, entry.email, entry.password, entry.portal);
      await expect(page).toHaveURL(entry.url, NAV_TIMEOUT);
      await expect(page.getByRole('main')).toBeVisible(NAV_TIMEOUT);
      if ('labelPath' in entry && entry.labelPath) {
        await page.goto(entry.labelPath);
        await expect(page.getByRole('main')).toBeVisible(NAV_TIMEOUT);
      }
      await expect(page.getByText(entry.roleLabel).first()).toBeVisible(NAV_TIMEOUT);

      const meBody = await me(page);
      expect(meBody.email).toBe(entry.email);
      expect(typeof meBody.id === 'string' && meBody.id.length > 0).toBeTruthy();
      expectRoles(meBody, entry.expectedRoles);

      const business = await page.request.get(entry.businessPath);
      expect(business.status(), `${entry.businessPath} for ${entry.key}`).toBe(200);
      const shape = await business.json();
      const rows = Array.isArray(shape) ? shape : (shape as { data?: unknown })?.data;
      expect(
        Array.isArray(rows),
        `${entry.businessPath} must return an array or a { data: [] } envelope`,
      ).toBeTruthy();
      expect((rows as unknown[]).length).toBeGreaterThan(0);
      const first = (rows as Array<{ id?: unknown }>)[0];
      expect(
        typeof first.id === 'string' && first.id.length > 0,
        `${entry.businessPath} first row must expose a non-empty id`,
      ).toBeTruthy();

      if (entry.usersStatus !== null) {
        const users = await page.request.get('/api/v1/users');
        expect(users.status(), 'directory users must reject non-admin roles').toBe(entry.usersStatus);
      }
    });
  }

  test('plain admin cannot read the super-admin user record but super admin can', async ({ page, browser }) => {
    await loginAs(page, 'admin@campuscore.edu', 'password123', 'student');
    await expect(page).toHaveURL(/\/vi\/admin(?:$|[/?#])/, NAV_TIMEOUT);
    const denied = await page.request.get('/api/v1/users/audit-super-user');
    expect(denied.status()).toBe(403);

    const superContext = await browser.newContext({ baseURL: String(test.info().project.use.baseURL) });
    try {
      const superPage = await superContext.newPage();
      await loginAs(superPage, 'audit-super@campuscore.demo', audit['audit-super'].password, 'student');
      const allowed = await superPage.request.get('/api/v1/users/audit-super-user');
      expect(allowed.status()).toBe(200);
      const allowedBody = await allowed.json();
      expect(allowedBody.id).toBe('audit-super-user');
    } finally {
      await superContext.close();
    }
  });

  test('another student cannot read a student-owned enrollment record', async ({ browser }) => {
    const context = await browser.newContext({ baseURL: String(test.info().project.use.baseURL) });
    try {
      const page = await context.newPage();
      await loginAs(page, 'student2@campuscore.edu', 'password123', 'student');
      await expect(page).toHaveURL(/\/vi\/dashboard(?:$|[/?#])/, NAV_TIMEOUT);
      const denied = await page.request.get('/api/v1/enrollments/enrollment-web-demo');
      expect(denied.status()).toBe(404);
    } finally {
      await context.close();
    }
  });

  test('logout clears the session and a same-context lecturer sign-in replaces the identity', async ({ page }) => {
    await loginAs(page, 'student@campuscore.edu', 'password123', 'student');
    await expect(page).toHaveURL(/\/vi\/dashboard(?:$|[/?#])/, NAV_TIMEOUT);
    const before = await me(page);
    expect(before.email).toBe('student@campuscore.edu');

    const openSidebar = page.getByRole('button', {
      name: /open sidebar|mở thanh điều hướng/i,
    }).first();
    if (await openSidebar.isVisible().catch(() => false)) {
      await openSidebar.click();
    }
    const signOut = page.locator('a[href="/vi/dashboard/sign-out"]');
    await expect(signOut).toBeVisible(NAV_TIMEOUT);
    await signOut.click();
    await expect(page).toHaveURL(/\/login(?:$|[/?#])/, NAV_TIMEOUT);

    await page.goBack();
    await expect(page).toHaveURL(/\/login(?:$|[/?#])/, NAV_TIMEOUT);
    await expect(page.locator('form')).toBeVisible(NAV_TIMEOUT);
    await expect(page.locator('[role="progressbar"], .animate-spin').first())
      .not.toBeVisible({ timeout: 15_000 });

    await loginAs(page, 'lecturer@campuscore.edu', 'password123', 'lecturer');
    await expect(page).toHaveURL(/\/vi\/dashboard\/lecturer(?:$|[/?#])/, NAV_TIMEOUT);
    const after = await me(page);
    expect(after.email).toBe('lecturer@campuscore.edu');
    expect(after.id).not.toBe(before.id);
    expect(after.roles ?? []).not.toContain('STUDENT');
    expect(after.roles ?? []).toContain('LECTURER');
  });
});
