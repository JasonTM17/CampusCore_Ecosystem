import { expect, request as pwRequest, test, type Page } from '@playwright/test';

/**
 * P11 simulated library spec (domain-contracts §8, phase-11 exit): the full
 * circulation journey request → approve → issue → return → available on
 * the e2e preview stack. Patron + staff legs drive the REST surface on the
 * API loopback (bearer tokens, cookie-free request contexts); the browser
 * legs land on /library and /library/desk through the portal SSO lane.
 *
 * Contract coverage:
 *   - LIB-T01: REQUESTED → APPROVED → ISSUED → RETURNED; the copy walks
 *     AVAILABLE → RESERVED → ON_LOAN → AVAILABLE in the same transactions;
 *   - LIB-T02: patron isolation — a foreign request id answers the same
 *     REQUEST_NOT_FOUND a missing id does (no existence oracle);
 *   - LIB-T03: server-side availability changes with each transition and
 *     the seeded stock is fully restored after return;
 *   - LIB-T04: optimistic version on approve/issue/return — a stale retry
 *     conflicts instead of double-issuing or double-returning;
 *   - §1.3: same-key request replay returns the stored response;
 *   - authority: STAFF:library is the sole domain authority — ADMIN role
 *     alone gets 403 until it grants itself, a non-grantee stays denied.
 *
 * Fixture facts (V141 seed): title-algorithms-demo has copy-algo-1 and
 * copy-algo-2 AVAILABLE; staff grants are never seeded — the spec grants
 * STAFF:library to admin-user through the API (V137/V140 convention).
 *
 * Required env (ecosystem-library-verify.mjs supplies them):
 *   SSO_PORTAL_BASE / LIBRARY_API_BASE / E2E_*_PASSCODE / SSO_ID_BASE
 */

test.use({
  ignoreHTTPSErrors: true,
  launchOptions: {
    args: ['--host-resolver-rules=MAP *.localhost 127.0.0.1'],
  },
});

const PORTAL = process.env.SSO_PORTAL_BASE ?? 'https://portal.localhost:3102';
const API = process.env.LIBRARY_API_BASE ?? 'http://127.0.0.1:4100';
const ID_BASE = process.env.SSO_ID_BASE ?? 'https://id.localhost:4443';
const BORROWER = { email: 'student@campuscore.edu', password: process.env.E2E_STUDENT_PASSCODE ?? 'password123' };
const BORROWER2 = { email: 'student2@campuscore.edu', password: process.env.E2E_STUDENT2_PASSCODE ?? 'password123' };
const ADMIN = { email: 'admin@campuscore.edu', password: process.env.E2E_ADMIN_PASSCODE ?? 'password123' };
// Second seeded admin (V28 admin-user-002). It never receives a grant, so
// the "ADMIN role alone is not domain authority" leg stays deterministic
// even when Playwright re-runs beforeAll on a restarted worker.
const ADMIN_UNGRANTED = { email: 'admin002@campuscore.demo', password: process.env.E2E_ADMIN2_PASSCODE ?? 'password123' };

const RUN = Date.now().toString(36);
const TITLE_ID = 'title-algorithms-demo';
const COPY_ID = 'copy-algo-1';

interface Seed {
  requestId: string;
}

let seed: Seed;

async function login(email: string, password: string) {
  const request = await pwRequest.newContext();
  try {
    const response = await request.post(`${API}/api/v1/auth/login`, {
      data: { email, password },
    });
    expect(response.status(), `login ${email}`).toBe(200);
    const body = await response.json();
    return body.accessToken as string;
  } finally {
    await request.dispose();
  }
}

async function call(token: string, method: string, path: string, data?: unknown, headers?: Record<string, string>) {
  const request = await pwRequest.newContext();
  try {
    const response = await request.fetch(`${API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(headers ?? {}),
      },
      data: data === undefined ? undefined : JSON.stringify(data),
    });
    return { status: response.status(), body: await response.text() };
  } finally {
    await request.dispose();
  }
}

async function ok(token: string, method: string, path: string, data?: unknown, headers?: Record<string, string>) {
  const response = await call(token, method, path, data, headers);
  expect(response.status, `${method} ${path}: ${response.body}`).toBeLessThan(300);
  return response.body ? JSON.parse(response.body) : null;
}

async function titleAvailability(token: string) {
  const title = await ok(token, 'GET', `/api/v1/library/catalogue/${TITLE_ID}`);
  return { available: title.availableCopies, total: title.totalCopies };
}

test.beforeAll(async () => {
  const borrower = await login(BORROWER.email, BORROWER.password);
  const borrower2 = await login(BORROWER2.email, BORROWER2.password);
  const admin = await login(ADMIN.email, ADMIN.password);

  // Seeded catalogue: two circulating copies of the algorithms title.
  const before = await titleAvailability(borrower);
  expect(before.total).toBe(2);

  // §1.3: same-key request replay returns the stored row, not a second hold.
  const requestKey = `e2e-lib-request-${RUN}`;
  const requested = await ok(borrower, 'POST', '/api/v1/library/requests',
    { copyId: COPY_ID }, { 'Idempotency-Key': requestKey });
  expect(requested.status).toBe('REQUESTED');
  expect(requested.borrowerEmail).toBe(BORROWER.email);
  const replay = await ok(borrower, 'POST', '/api/v1/library/requests',
    { copyId: COPY_ID }, { 'Idempotency-Key': requestKey });
  expect(replay.id).toBe(requested.id);

  // LIB-T02: borrower2 gets indistinguishable 404 on the foreign id.
  const foreign = await call(borrower2, 'GET', `/api/v1/library/requests/${requested.id}`);
  expect(foreign.status).toBe(404);
  expect(JSON.parse(foreign.body).code).toBe('REQUEST_NOT_FOUND');

  // Authority: ADMIN role alone is NOT a staff grant — proven on the
  // second seeded admin, which never receives one.
  const ungranted = await login(ADMIN_UNGRANTED.email, ADMIN_UNGRANTED.password);
  const adminDenied = await call(ungranted, 'GET', '/api/v1/library/staff/requests');
  expect(adminDenied.status).toBe(403);
  expect(JSON.parse(adminDenied.body).code).toBe('LIBRARY_STAFF_REQUIRED');
  const outsiderDenied = await call(borrower2, 'GET', '/api/v1/library/staff/requests');
  expect(outsiderDenied.status).toBe(403);

  // Admin grants itself the scope — the circulation queue opens.
  await ok(admin, 'POST', '/api/v1/library/staff/grants', { userId: 'admin-user' });
  const queue = await ok(admin, 'GET', '/api/v1/library/staff/requests?status=REQUESTED');
  expect(queue.some((row: { id: string }) => row.id === requested.id)).toBe(true);

  // Approve inside the server-clock window → copy flips to RESERVED.
  const approved = await ok(admin, 'POST',
    `/api/v1/library/staff/requests/${requested.id}/approve`,
    { expectedVersion: requested.version });
  expect(approved.status).toBe('APPROVED');
  expect(approved.approvedBy).toBe('admin-user');
  expect((await titleAvailability(borrower)).available).toBe(before.available - 1);

  // Issue → copy ON_LOAN, due date set server-side.
  const issued = await ok(admin, 'POST',
    `/api/v1/library/staff/requests/${requested.id}/issue`,
    { expectedVersion: approved.version, dueDays: 14 });
  expect(issued.status).toBe('ISSUED');
  expect(issued.dueAt).not.toBeNull();

  // LIB-T04: a stale-version retry conflicts — no double issue.
  const staleIssue = await call(admin, 'POST',
    `/api/v1/library/staff/requests/${requested.id}/issue`,
    { expectedVersion: approved.version, dueDays: 14 });
  expect(staleIssue.status).toBe(409);

  // Return → stock restored in the same transaction.
  const returned = await ok(admin, 'POST',
    `/api/v1/library/staff/requests/${requested.id}/return`,
    { expectedVersion: issued.version });
  expect(returned.status).toBe('RETURNED');
  expect(returned.returnedBy).toBe('admin-user');
  expect((await titleAvailability(borrower)).available).toBe(before.available);

  // Returning twice must not inflate inventory.
  const secondReturn = await call(admin, 'POST',
    `/api/v1/library/staff/requests/${requested.id}/return`,
    { expectedVersion: returned.version });
  expect(secondReturn.status).toBe(409);
  expect((await titleAvailability(borrower)).available).toBe(before.available);

  // Patron history shows the terminal row.
  const mine = await ok(borrower, 'GET', '/api/v1/library/requests/my');
  const row = mine.find((item: { id: string }) => item.id === requested.id);
  expect(row.status).toBe('RETURNED');

  seed = { requestId: requested.id };
});

/** Drive the id-host login page as a given user and land on the portal surface. */
async function ssoLogin(page: Page, user: { email: string; password: string }, returnPath: string) {
  const baseRe = new RegExp(`^${PORTAL.replace(/\./g, '\\.')}/`);
  const loginRe = new RegExp(`^${ID_BASE.replace(/\./g, '\\.')}/login`);
  await page.goto(`${PORTAL}/session/login?return=${encodeURIComponent(returnPath)}`);
  await page.waitForURL((url) => baseRe.test(url.href) || loginRe.test(url.href), {
    timeout: 45000,
  });
  if (loginRe.test(page.url())) {
    await page.fill('#email', user.email);
    await page.fill('#pw', user.password);
    await page.click('button[type=submit]');
    await page.waitForURL(baseRe, { timeout: 45000 });
  }
}

test.describe('ecosystem-library (P11 §8)', () => {
  test.skip(({ browserName }) => browserName !== 'chromium');

  test('patron catalogue shows seeded availability and the returned loan', async ({ page }) => {
    test.setTimeout(90_000);
    await ssoLogin(page, BORROWER, '/library');
    await expect(page.getByTestId('library-catalogue-page')).toBeVisible({ timeout: 45000 });
    await expect(page.getByTestId('library-simulated-banner')).toBeVisible();

    const title = page.getByTestId(`library-title-${TITLE_ID}`);
    await expect(title).toBeVisible({ timeout: 30000 });
    await expect(page.getByTestId(`library-availability-${TITLE_ID}`)).toContainText('2');

    const loan = page.getByTestId(`library-loan-${seed.requestId}`);
    await expect(loan).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId(`library-loan-status-${seed.requestId}`))
      .toContainText(/Đã trả|Returned/);
    // Terminal row: no cancel affordance.
    await expect(page.getByTestId(`library-cancel-${seed.requestId}`)).toHaveCount(0);
  });

  test('staff desk shows the completed circulation row', async ({ page }) => {
    test.setTimeout(90_000);
    await ssoLogin(page, ADMIN, '/library/desk');
    await expect(page.getByTestId('library-desk-page')).toBeVisible({ timeout: 45000 });
    await expect(page.getByTestId('library-simulated-banner')).toBeVisible();

    const row = page.getByTestId(`library-request-${seed.requestId}`);
    await expect(row).toBeVisible({ timeout: 30000 });
    await expect(page.getByTestId(`library-request-status-${seed.requestId}`))
      .toContainText(/Đã trả|Returned/);
    // Terminal: no desk actions render on a RETURNED row.
    await expect(page.getByTestId(`library-approve-${seed.requestId}`)).toHaveCount(0);
    await expect(page.getByTestId(`library-issue-${seed.requestId}`)).toHaveCount(0);
    await expect(page.getByTestId(`library-return-${seed.requestId}`)).toHaveCount(0);
  });

  test('patron isolation holds in the browser lane too', async ({ page }) => {
    test.setTimeout(90_000);
    // borrower2 never sees the foreign loan — even in its own history.
    await ssoLogin(page, BORROWER2, '/library');
    await expect(page.getByTestId('library-catalogue-page')).toBeVisible({ timeout: 45000 });
    await expect(page.getByTestId(`library-loan-${seed.requestId}`)).toHaveCount(0);
  });
});
