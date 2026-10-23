import { expect, request as pwRequest, test, type Page } from '@playwright/test';

/**
 * P10 simulated admissions spec (domain-contracts §7, phase-10 exit): the
 * full journey draft → submit → claim → return → resubmit → decision on the
 * e2e preview stack. Applicant + staff legs drive the REST surface on the
 * API loopback (bearer tokens, cookie-free request contexts); the browser
 * legs land on /apply and /apply/review through the portal SSO lane.
 *
 * Contract coverage:
 *   - ADM-T01: full state machine DRAFT → SUBMITTED → IN_REVIEW → RETURNED
 *     → SUBMITTED → ACCEPTED, terminal immutability afterwards;
 *   - ADM-T02: applicant isolation — a foreign id answers the same
 *     APPLICATION_NOT_FOUND a missing id does (no existence oracle);
 *   - ADM-T03: checklist + reason history survive every transition;
 *   - ADM-T04: a second active application in the same cycle conflicts;
 *   - ADM-T05: the decision carries decisionLabel='SIMULATED' everywhere;
 *   - authority: STAFF:admissions is the sole domain authority — ADMIN role
 *     alone gets 403 until it grants itself, a non-grantee stays denied;
 *   - forbidden write: an ACCEPTED applicant never gains an academic
 *     Student profile (the JWT stays claim-free);
 *   - §1.3: same-key create/submit replays return the stored response.
 *
 * Fixture facts (V140 seed): applicant@campuscore.edu + applicant2@ are
 * synthetic auth users with NO academic Student row — proving the applicant
 * profile is separate from the academic authority.
 *
 * Required env (ecosystem-admissions-verify.mjs supplies them):
 *   SSO_PORTAL_BASE / ADMISSIONS_API_BASE / E2E_*_PASSCODE / SSO_ID_BASE
 */

test.use({
  ignoreHTTPSErrors: true,
  launchOptions: {
    args: ['--host-resolver-rules=MAP *.localhost 127.0.0.1'],
  },
});

const PORTAL = process.env.SSO_PORTAL_BASE ?? 'https://portal.localhost:3102';
const API = process.env.ADMISSIONS_API_BASE ?? 'http://127.0.0.1:4100';
const ID_BASE = process.env.SSO_ID_BASE ?? 'https://id.localhost:4443';
const APPLICANT = { email: 'applicant@campuscore.edu', password: process.env.E2E_APPLICANT_PASSCODE ?? 'password123' };
const APPLICANT2 = { email: 'applicant2@campuscore.edu', password: process.env.E2E_APPLICANT2_PASSCODE ?? 'password123' };
const ADMIN = { email: 'admin@campuscore.edu', password: process.env.E2E_ADMIN_PASSCODE ?? 'password123' };
// Second seeded admin (V28 admin-user-002). It never receives a grant, so the
// "ADMIN role alone is not domain authority" leg stays deterministic even when
// Playwright re-runs beforeAll on a restarted worker.
const ADMIN_UNGRANTED = { email: 'admin002@campuscore.demo', password: process.env.E2E_ADMIN2_PASSCODE ?? 'password123' };
const STUDENT = { email: 'student@campuscore.edu', password: process.env.E2E_STUDENT_PASSCODE ?? 'password123' };

const CYCLE = `E2E-${Date.now().toString(36)}`;

interface Seed {
  applicationId: string;
  attachmentId: string;
  fullName: string;
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

function decodeJwtPayload(token: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
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

test.beforeAll(async () => {
  const applicant = await login(APPLICANT.email, APPLICANT.password);
  const applicant2 = await login(APPLICANT2.email, APPLICANT2.password);
  const admin = await login(ADMIN.email, ADMIN.password);
  const student = await login(STUDENT.email, STUDENT.password);

  // The applicant token carries no studentId claim — the auth user has no
  // academic Student row (V140 seeds auth-only applicants).
  const applicantClaims = decodeJwtPayload(applicant);
  expect(applicantClaims.studentId).toBeUndefined();

  // §1.3: same-key create replays one row.
  const createKey = `e2e-adm-create-${CYCLE}`;
  const draft = await ok(applicant, 'POST', '/api/v1/admissions/applications',
    { cycle: CYCLE }, { 'Idempotency-Key': createKey });
  expect(draft.status).toBe('DRAFT');
  const replay = await ok(applicant, 'POST', '/api/v1/admissions/applications',
    { cycle: CYCLE }, { 'Idempotency-Key': createKey });
  expect(replay.id).toBe(draft.id);

  // ADM-T04: a second active application in the same cycle conflicts.
  const dup = await call(applicant, 'POST', '/api/v1/admissions/applications',
    { cycle: CYCLE }, { 'Idempotency-Key': `e2e-adm-dup-${CYCLE}` });
  expect(dup.status).toBe(409);
  expect(JSON.parse(dup.body).code).toBe('APPLICATION_CYCLE_ACTIVE');

  // ADM-T02: applicant2 gets indistinguishable 404 on the foreign id.
  const foreign = await call(applicant2, 'GET', `/api/v1/admissions/applications/${draft.id}`);
  expect(foreign.status).toBe(404);
  expect(JSON.parse(foreign.body).code).toBe('APPLICATION_NOT_FOUND');

  // Owner lane: save fields, attach evidence, submit.
  const saved = await ok(applicant, 'PUT', `/api/v1/admissions/applications/${draft.id}`, {
    fullName: 'E2E Applicant Demo',
    dateOfBirth: '2008-01-15',
    schoolName: 'THPT E2E',
    intendedMajor: 'CNTT',
    essay: 'synthetic e2e essay',
    expectedVersion: draft.version,
  });
  const withAttachment = await ok(applicant, 'POST',
    `/api/v1/admissions/applications/${draft.id}/attachments`, {
      fileName: 'e2e-score.pdf',
      contentType: 'application/pdf',
      dataBase64: Buffer.from('synthetic-e2e-score').toString('base64'),
    }, { 'Idempotency-Key': `e2e-adm-att-${CYCLE}` });
  expect(withAttachment.attachments.length).toBe(1);
  const attachmentId = withAttachment.attachments[0].id;

  const submitKey = `e2e-adm-submit-${CYCLE}`;
  const submitted = await ok(applicant, 'POST',
    `/api/v1/admissions/applications/${draft.id}/submit`,
    { expectedVersion: withAttachment.version }, { 'Idempotency-Key': submitKey });
  expect(submitted.status).toBe('SUBMITTED');
  const submitReplay = await ok(applicant, 'POST',
    `/api/v1/admissions/applications/${draft.id}/submit`,
    { expectedVersion: withAttachment.version }, { 'Idempotency-Key': submitKey });
  expect(submitReplay.version).toBe(submitted.version);

  // Authority: ADMIN role alone is NOT a staff grant. Proven on the second
  // seeded admin, which never receives one — safe under beforeAll re-runs.
  const ungranted = await login(ADMIN_UNGRANTED.email, ADMIN_UNGRANTED.password);
  const adminDenied = await call(ungranted, 'GET', '/api/v1/admissions/staff/queue');
  expect(adminDenied.status).toBe(403);
  expect(JSON.parse(adminDenied.body).code).toBe('ADMISSIONS_STAFF_REQUIRED');

  // Admin grants itself the scope — the queue opens.
  await ok(admin, 'POST', '/api/v1/admissions/staff/grants', { userId: 'admin-user' });
  const queue = await ok(admin, 'GET', '/api/v1/admissions/staff/queue?status=SUBMITTED');
  expect(queue.some((row: { id: string }) => row.id === draft.id)).toBe(true);

  // A non-grantee stays denied even with a valid session.
  const outsiderDenied = await call(student, 'GET', '/api/v1/admissions/staff/queue');
  expect(outsiderDenied.status).toBe(403);

  // Claim → return with checklist → resubmit → claim → decide.
  const claimed = await ok(admin, 'POST',
    `/api/v1/admissions/staff/applications/${draft.id}/claim`,
    { expectedVersion: submitted.version });
  expect(claimed.status).toBe('IN_REVIEW');
  expect(claimed.claimedBy).toBe('admin-user');

  const returned = await ok(admin, 'POST',
    `/api/v1/admissions/staff/applications/${draft.id}/return`, {
      checklist: [{ item: 'Bang diem', result: 'FAIL', note: 'can bo sung' }],
      note: 'Bo sung minh chung moi nhat',
      expectedVersion: claimed.version,
    });
  expect(returned.status).toBe('RETURNED');
  expect(returned.reviews.length).toBe(2);
  expect(returned.reviews[1].action).toBe('RETURN');

  const resubmitted = await ok(applicant, 'POST',
    `/api/v1/admissions/applications/${draft.id}/submit`,
    { expectedVersion: returned.version }, { 'Idempotency-Key': `e2e-adm-resubmit-${CYCLE}` });
  expect(resubmitted.status).toBe('SUBMITTED');

  const reclaimed = await ok(admin, 'POST',
    `/api/v1/admissions/staff/applications/${draft.id}/claim`,
    { expectedVersion: resubmitted.version });
  const decided = await ok(admin, 'POST',
    `/api/v1/admissions/staff/applications/${draft.id}/decision`, {
      decision: 'ACCEPTED',
      note: 'E2E simulated acceptance',
      expectedVersion: reclaimed.version,
    });
  expect(decided.status).toBe('ACCEPTED');
  expect(decided.decision).toBe('ACCEPTED');
  expect(decided.decisionLabel).toBe('SIMULATED');
  expect(decided.decisionAt).not.toBeNull();
  expect(decided.reviews.length).toBe(4);

  // Terminal immutability — owner and staff lanes both conflict now.
  const lateSave = await call(applicant, 'PUT', `/api/v1/admissions/applications/${draft.id}`, {
    fullName: 'Late edit', expectedVersion: decided.version,
  });
  expect(lateSave.status).toBe(409);
  expect(JSON.parse(lateSave.body).code).toBe('APPLICATION_TERMINAL');
  const reDecision = await call(admin, 'POST',
    `/api/v1/admissions/staff/applications/${draft.id}/decision`, {
      decision: 'REJECTED', expectedVersion: decided.version,
    });
  expect(reDecision.status).toBe(409);
  expect(JSON.parse(reDecision.body).code).toBe('APPLICATION_TERMINAL');

  // Forbidden write: the accepted applicant still carries no Student claim.
  const afterClaims = decodeJwtPayload(await login(APPLICANT.email, APPLICANT.password));
  expect(afterClaims.studentId).toBeUndefined();

  seed = {
    applicationId: draft.id,
    attachmentId,
    fullName: 'E2E Applicant Demo',
  };
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

test.describe('ecosystem-admissions (P10 §7)', () => {
  test.skip(({ browserName }) => browserName !== 'chromium');

  test('applicant portal shows the SIMULATED decision and review history', async ({ page }) => {
    test.setTimeout(90_000);
    await ssoLogin(page, APPLICANT, '/apply');
    await expect(page.getByTestId('admissions-apply-page')).toBeVisible({ timeout: 45000 });
    await expect(page.getByTestId('admissions-simulated-banner')).toBeVisible();

    const card = page.getByTestId(`admissions-application-${seed.applicationId}`);
    await expect(card).toBeVisible({ timeout: 30000 });
    await card.click();

    const detail = page.getByTestId('admissions-detail');
    await expect(detail).toBeVisible({ timeout: 15000 });
    await expect(detail.getByTestId('admissions-status')).toContainText(/Trúng tuyển|Accepted/);
    await expect(detail.getByTestId('admissions-decision-label')).toContainText('SIMULATED');
    // Locked: no edit/save/submit affordances on a terminal application.
    await expect(detail.getByTestId('admissions-save')).toHaveCount(0);
    const reviews = detail.getByTestId('admissions-reviews');
    await expect(reviews.locator('li')).toHaveCount(4);
    await expect(detail.getByTestId('admissions-attachments')).toContainText('e2e-score.pdf');
  });

  test('staff queue shows the decided application with the SIMULATED label', async ({ page }) => {
    test.setTimeout(90_000);
    await ssoLogin(page, ADMIN, '/apply/review');
    await expect(page.getByTestId('admissions-review-page')).toBeVisible({ timeout: 45000 });
    await expect(page.getByTestId('admissions-simulated-banner')).toBeVisible();

    const row = page.getByTestId(`admissions-queue-row-${seed.applicationId}`);
    await expect(row).toBeVisible({ timeout: 30000 });
    await row.click();

    const detail = page.getByTestId('admissions-review-detail');
    await expect(detail).toBeVisible({ timeout: 15000 });
    await expect(detail.getByTestId('admissions-review-status')).toContainText(/Trúng tuyển|Accepted/);
    await expect(detail.getByTestId('admissions-decision-label')).toContainText('SIMULATED');
    await expect(detail.getByTestId('admissions-reviews').locator('li')).toHaveCount(4);
    // Terminal: no review actions render.
    await expect(detail.getByTestId('admissions-claim')).toHaveCount(0);
    await expect(detail.getByTestId('admissions-accept')).toHaveCount(0);
  });

  test('applicant isolation holds in the browser lane too', async ({ page }) => {
    test.setTimeout(90_000);
    // applicant2 never sees the foreign application — even in its own list.
    await ssoLogin(page, APPLICANT2, '/apply');
    await expect(page.getByTestId('admissions-apply-page')).toBeVisible({ timeout: 45000 });
    await expect(page.getByTestId(`admissions-application-${seed.applicationId}`)).toHaveCount(0);
  });
});
