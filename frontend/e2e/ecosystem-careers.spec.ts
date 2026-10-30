import { expect, request as pwRequest, test, type Page } from '@playwright/test';

/**
 * P12 simulated careers spec (domain-contracts §9, phase-12 exit): the
 * full moderated-jobs journey draft → moderate → apply → review → offer /
 * withdraw on the e2e preview stack. Candidate, recruiter and reviewer
 * legs drive the REST surface on the API loopback (bearer tokens,
 * cookie-free request contexts); the browser legs land on /careers and
 * /careers/desk through the portal SSO lane.
 *
 * Contract coverage:
 *   - CAR-T01..T03: opportunity DRAFT → IN_REVIEW → PUBLISHED with the
 *     reviewer ≠ submitter separation; a self-moderation attempt gets
 *     SELF_PUBLISH_FORBIDDEN even when the actor holds both grants;
 *   - CAR-T04..T06: application SUBMITTED → REVIEWING → INTERVIEW → OFFER
 *     strictly forward (skip and backwards steps conflict), REJECTED with
 *     a moderation reason the candidate can see;
 *   - CAR-T07: owner withdraw of a pre-terminal application, idempotent
 *     replay (§1.3);
 *   - CAR-X01: organization isolation — the org-beta recruiter sees
 *     neither org-alpha postings nor applications;
 *   - CAR-X02: attachment ownership — owner + owning-org recruiter read,
 *     foreign candidate and cross-org recruiter do not;
 *   - authority: STAFF:careers:<org> / STAFF:careers reviewer grants are
 *     the sole domain authorities — ADMIN role alone gets 403 until it
 *     grants itself, a non-grantee stays denied;
 *   - XSS negative: an HTML-bearing title renders as text, never markup.
 *
 * Fixture facts (V142): org-alpha-demo and org-beta-demo are seeded;
 * grants are never seeded — the spec grants scopes through the API.
 *
 * Required env (ecosystem-careers-verify.mjs supplies them):
 *   SSO_PORTAL_BASE / CAREERS_API_BASE / E2E_*_PASSCODE / SSO_ID_BASE
 */

test.use({
  ignoreHTTPSErrors: true,
  launchOptions: {
    args: ['--host-resolver-rules=MAP *.localhost 127.0.0.1'],
  },
});

const PORTAL = process.env.SSO_PORTAL_BASE ?? 'https://portal.localhost:3102';
const API = process.env.CAREERS_API_BASE ?? 'http://127.0.0.1:4100';
const ID_BASE = process.env.SSO_ID_BASE ?? 'https://id.localhost:4443';
const CANDIDATE = { email: 'student@campuscore.edu', password: process.env.E2E_STUDENT_PASSCODE ?? 'password123' };
const OTHER = { email: 'student2@campuscore.edu', password: process.env.E2E_STUDENT2_PASSCODE ?? 'password123' };
const ADMIN = { email: 'admin@campuscore.edu', password: process.env.E2E_ADMIN_PASSCODE ?? 'password123' };
// Second seeded admin (V28 admin-user-002). It never receives a grant, so
// the "ADMIN role alone is not domain authority" leg stays deterministic
// even when Playwright re-runs beforeAll on a restarted worker.
const ADMIN_UNGRANTED = { email: 'admin002@campuscore.demo', password: process.env.E2E_ADMIN2_PASSCODE ?? 'password123' };

const RUN = Date.now().toString(36);
const ORG_ALPHA = 'org-alpha-demo';
const ORG_BETA = 'org-beta-demo';
const XSS_TITLE = `<img src=x onerror="window.__carXss=1"> Title ${RUN}`;

interface Seed {
  opportunityId: string;
  applicationId: string;
  withdrawnId: string;
  closedOppId: string;
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

test.beforeAll(async () => {
  const candidate = await login(CANDIDATE.email, CANDIDATE.password);
  const other = await login(OTHER.email, OTHER.password);
  const admin = await login(ADMIN.email, ADMIN.password);

  // Authority: ADMIN role alone is NOT a careers grant — proven on the
  // second seeded admin, which never receives one.
  const ungranted = await login(ADMIN_UNGRANTED.email, ADMIN_UNGRANTED.password);
  const adminDenied = await call(ungranted, 'GET', '/api/v1/careers/staff/opportunities');
  expect(adminDenied.status).toBe(403);
  expect(JSON.parse(adminDenied.body).code).toBe('CAREERS_STAFF_REQUIRED');
  const reviewDenied = await call(ungranted, 'GET', '/api/v1/careers/staff/review-queue');
  expect(reviewDenied.status).toBe(403);
  expect(JSON.parse(reviewDenied.body).code).toBe('CAREERS_REVIEWER_REQUIRED');
  const candidateDenied = await call(candidate, 'GET', '/api/v1/careers/staff/applications');
  expect(candidateDenied.status).toBe(403);

  // Grants through the API (idempotent — safe under beforeAll re-runs):
  //   admin-user      → recruiter(org-alpha) + reviewer (self-moderation leg)
  //   student-user-2  → reviewer + recruiter(org-beta) (cross-org isolation)
  await ok(admin, 'POST', '/api/v1/careers/staff/grants',
    { userId: 'admin-user', organizationId: ORG_ALPHA });
  await ok(admin, 'POST', '/api/v1/careers/staff/grants',
    { userId: 'admin-user', organizationId: null });
  await ok(admin, 'POST', '/api/v1/careers/staff/grants',
    { userId: 'student-user-2', organizationId: null });
  await ok(admin, 'POST', '/api/v1/careers/staff/grants',
    { userId: 'student-user-2', organizationId: ORG_BETA });

  // CAR-T01: recruiter drafts an HTML-bearing title inside its own org.
  const draft = await ok(admin, 'POST', '/api/v1/careers/staff/opportunities', {
    organizationId: ORG_ALPHA,
    title: XSS_TITLE,
    description: 'Simulated internship posting.',
    location: 'HCMC',
    employmentType: 'INTERNSHIP',
    salaryText: 'negotiable',
  });
  expect(draft.status).toBe('DRAFT');
  const opportunityId = draft.id;

  // A draft is invisible to candidates.
  const draftBrowse = await ok(candidate, 'GET', '/api/v1/careers/opportunities');
  expect(draftBrowse.some((row: { id: string }) => row.id === opportunityId)).toBe(false);

  const inReview = await ok(admin, 'POST',
    `/api/v1/careers/staff/opportunities/${opportunityId}/submit-review`,
    { expectedVersion: draft.version });
  expect(inReview.status).toBe('IN_REVIEW');

  // CAR-T02: the submitter cannot self-publish even holding the reviewer
  // grant — a different reviewer must moderate.
  const selfPublish = await call(admin, 'POST',
    `/api/v1/careers/staff/opportunities/${opportunityId}/publish`,
    { expectedVersion: inReview.version });
  expect(selfPublish.status).toBe(403);
  expect(JSON.parse(selfPublish.body).code).toBe('SELF_PUBLISH_FORBIDDEN');

  // Reject without a moderation reason is itself rejected.
  const reasonless = await call(other, 'POST',
    `/api/v1/careers/staff/opportunities/${opportunityId}/reject`,
    { expectedVersion: inReview.version });
  expect(reasonless.status).toBe(400);
  expect(JSON.parse(reasonless.body).code).toBe('MODERATION_REASON_REQUIRED');

  const published = await ok(other, 'POST',
    `/api/v1/careers/staff/opportunities/${opportunityId}/publish`,
    { expectedVersion: inReview.version });
  expect(published.status).toBe('PUBLISHED');

  // CAR-T04 + §1.3: apply, and the same-key replay returns the same row.
  const applyKey = `e2e-car-apply-${RUN}`;
  const applied = await ok(candidate, 'POST', '/api/v1/careers/applications',
    { opportunityId, coverLetter: 'Synthetic cover letter' },
    { 'Idempotency-Key': applyKey });
  expect(applied.status).toBe('SUBMITTED');
  const applicationId = applied.id;
  const replay = await ok(candidate, 'POST', '/api/v1/careers/applications',
    { opportunityId, coverLetter: 'Synthetic cover letter' },
    { 'Idempotency-Key': applyKey });
  expect(replay.id).toBe(applicationId);

  // A second active application on the same posting conflicts.
  const dup = await call(candidate, 'POST', '/api/v1/careers/applications',
    { opportunityId }, { 'Idempotency-Key': `e2e-car-dup-${RUN}` });
  expect(dup.status).toBe(409);
  expect(JSON.parse(dup.body).code).toBe('APPLICATION_ACTIVE');

  // CAR-X02: attachment upload (sha256 verified), then ownership checks.
  const cvBytes = Buffer.from('simulated cv bytes');
  const checksum = (await import('node:crypto')).createHash('sha256')
    .update(cvBytes).digest('hex');
  const withFile = await ok(candidate, 'POST',
    `/api/v1/careers/applications/${applicationId}/attachments`,
    {
      fileName: 'cv.txt', contentType: 'text/plain',
      dataBase64: cvBytes.toString('base64'), checksum,
    },
    { 'Idempotency-Key': `e2e-car-att-${RUN}` });
  expect(withFile.attachments).toHaveLength(1);
  const attachmentId = withFile.attachments[0].id;

  const ownerFile = await call(candidate, 'GET',
    `/api/v1/careers/applications/${applicationId}/attachments/${attachmentId}/download`);
  expect(ownerFile.status).toBe(200);
  const staffFile = await call(admin, 'GET',
    `/api/v1/careers/staff/applications/${applicationId}/attachments/${attachmentId}/download`);
  expect(staffFile.status).toBe(200);
  // Foreign candidate: indistinguishable 404.
  const foreignFile = await call(other, 'GET',
    `/api/v1/careers/applications/${applicationId}/attachments/${attachmentId}/download`);
  expect(foreignFile.status).toBe(404);
  // Cross-org recruiter (org-beta): scope deny.
  const crossOrgFile = await call(other, 'GET',
    `/api/v1/careers/staff/applications/${applicationId}/attachments/${attachmentId}/download`);
  expect(crossOrgFile.status).toBe(403);

  // CAR-X01: the org-beta recruiter sees neither the posting nor the app.
  const betaOpps = await ok(other, 'GET', '/api/v1/careers/staff/opportunities');
  expect(betaOpps.some((row: { id: string }) => row.id === opportunityId)).toBe(false);
  const crossDetail = await call(other, 'GET',
    `/api/v1/careers/staff/applications/${applicationId}`);
  expect(crossDetail.status).toBe(403);
  const betaApps = await ok(other, 'GET', '/api/v1/careers/staff/applications');
  expect(betaApps.some((row: { id: string }) => row.id === applicationId)).toBe(false);

  // CAR-T05: strictly-forward progression — the skip step conflicts.
  const skip = await call(admin, 'POST',
    `/api/v1/careers/staff/applications/${applicationId}/transition`,
    { toStatus: 'INTERVIEW', expectedVersion: withFile.version });
  expect(skip.status).toBe(409);
  expect(JSON.parse(skip.body).code).toBe('APPLICATION_STATE_INVALID');

  let version = withFile.version;
  for (const to of ['REVIEWING', 'INTERVIEW', 'OFFER']) {
    const moved = await ok(admin, 'POST',
      `/api/v1/careers/staff/applications/${applicationId}/transition`,
      { toStatus: to, expectedVersion: version });
    expect(moved.status).toBe(to);
    version = moved.version;
  }

  // Candidate sees the OFFER state on its own history.
  const mine = await ok(candidate, 'GET', '/api/v1/careers/applications/my');
  const myApp = mine.find((row: { id: string }) => row.id === applicationId);
  expect(myApp.status).toBe('OFFER');

  // Second posting: apply → withdraw (CAR-T07) with idempotent replay,
  // then recruiter REJECTED with a visible reason (CAR-T06).
  const draft2 = await ok(admin, 'POST', '/api/v1/careers/staff/opportunities', {
    organizationId: ORG_ALPHA, title: `Withdraw + reject path ${RUN}`,
  });
  const inReview2 = await ok(admin, 'POST',
    `/api/v1/careers/staff/opportunities/${draft2.id}/submit-review`,
    { expectedVersion: draft2.version });
  const selfPublish2 = await call(admin, 'POST',
    `/api/v1/careers/staff/opportunities/${draft2.id}/publish`,
    { expectedVersion: inReview2.version });
  expect(selfPublish2.status).toBe(403); // still own submission
  await ok(other, 'POST',
    `/api/v1/careers/staff/opportunities/${draft2.id}/publish`,
    { expectedVersion: inReview2.version });

  const second = await ok(candidate, 'POST', '/api/v1/careers/applications',
    { opportunityId: draft2.id },
    { 'Idempotency-Key': `e2e-car-apply2-${RUN}` });
  const withdrawKey = `e2e-car-wd-${RUN}`;
  const withdrawn = await ok(candidate, 'POST',
    `/api/v1/careers/applications/${second.id}/withdraw`,
    { expectedVersion: second.version },
    { 'Idempotency-Key': withdrawKey });
  expect(withdrawn.status).toBe('WITHDRAWN');
  const wdReplay = await ok(candidate, 'POST',
    `/api/v1/careers/applications/${second.id}/withdraw`,
    { expectedVersion: second.version },
    { 'Idempotency-Key': withdrawKey });
  expect(wdReplay.id).toBe(second.id);
  expect(wdReplay.status).toBe('WITHDRAWN');

  // Re-apply after withdraw is allowed (only active states are unique).
  const third = await ok(candidate, 'POST', '/api/v1/careers/applications',
    { opportunityId: draft2.id },
    { 'Idempotency-Key': `e2e-car-apply3-${RUN}` });
  // CAR-T06: reject requires and surfaces a moderation reason.
  const appReasonless = await call(admin, 'POST',
    `/api/v1/careers/staff/applications/${third.id}/reject`,
    { expectedVersion: third.version });
  expect(appReasonless.status).toBe(400);
  const rejected = await ok(admin, 'POST',
    `/api/v1/careers/staff/applications/${third.id}/reject`,
    { expectedVersion: third.version, reason: 'synthetic reason' });
  expect(rejected.status).toBe('REJECTED');
  expect(rejected.moderationReason).toBe('synthetic reason');
  const visible = await ok(candidate, 'GET',
    `/api/v1/careers/applications/${third.id}`);
  expect(visible.moderationReason).toBe('synthetic reason');

  // A closed posting accepts no new applications (CAR-T03).
  const draft3 = await ok(admin, 'POST', '/api/v1/careers/staff/opportunities', {
    organizationId: ORG_ALPHA, title: `Closing ${RUN}`,
  });
  const inReview3 = await ok(admin, 'POST',
    `/api/v1/careers/staff/opportunities/${draft3.id}/submit-review`,
    { expectedVersion: draft3.version });
  await ok(other, 'POST',
    `/api/v1/careers/staff/opportunities/${draft3.id}/publish`,
    { expectedVersion: inReview3.version });
  const afterPublish = await ok(admin, 'GET',
    `/api/v1/careers/staff/opportunities/${draft3.id}`);
  const closed = await ok(admin, 'POST',
    `/api/v1/careers/staff/opportunities/${draft3.id}/close`,
    { expectedVersion: afterPublish.version, reason: 'intake filled' });
  expect(closed.status).toBe('CLOSED');
  const closedApply = await call(candidate, 'POST', '/api/v1/careers/applications',
    { opportunityId: draft3.id }, { 'Idempotency-Key': `e2e-car-closed-${RUN}` });
  expect(closedApply.status).toBe(409);
  expect(JSON.parse(closedApply.body).code).toBe('OPPORTUNITY_NOT_OPEN');

  seed = {
    opportunityId,
    applicationId,
    withdrawnId: second.id,
    closedOppId: draft3.id,
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

test.describe('ecosystem-careers (P12 §9)', () => {
  test.skip(({ browserName }) => browserName !== 'chromium');

  test('candidate board shows the published posting, offer and withdrawn rows', async ({ page }) => {
    test.setTimeout(90_000);
    await ssoLogin(page, CANDIDATE, '/careers');
    await expect(page.getByTestId('careers-board-page')).toBeVisible({ timeout: 45000 });
    await expect(page.getByTestId('careers-simulated-banner')).toBeVisible();

    // The published posting renders; the closed one is off the board.
    const posting = page.getByTestId(`careers-opp-${seed.opportunityId}`);
    await expect(posting).toBeVisible({ timeout: 30000 });
    await expect(page.getByTestId(`careers-opp-${seed.closedOppId}`)).toHaveCount(0);

    // XSS negative: the HTML-bearing title renders as text, never markup.
    await expect(posting).toContainText('<img src=x');
    const xss = await page.evaluate(() => (window as unknown as { __carXss?: boolean }).__carXss);
    expect(xss).toBeUndefined();

    // Application rows: OFFER + WITHDRAWN states visible with statuses.
    const offer = page.getByTestId(`careers-app-${seed.applicationId}`);
    await expect(offer).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId(`careers-app-status-${seed.applicationId}`))
      .toContainText(/Đề nghị|Offer/);
    const withdrawn = page.getByTestId(`careers-app-${seed.withdrawnId}`);
    await expect(withdrawn).toBeVisible();
    await expect(page.getByTestId(`careers-app-status-${seed.withdrawnId}`))
      .toContainText(/Đã rút|Withdrawn/);
    // Terminal rows carry no withdraw/upload affordance.
    await expect(page.getByTestId(`careers-withdraw-${seed.withdrawnId}`)).toHaveCount(0);
    // The rejection moderation reason is visible to the candidate (CAR-T06).
    await expect(page.getByTestId('careers-applications')).toContainText('synthetic reason');
  });

  test('recruiter desk shows org postings and the offer row', async ({ page }) => {
    test.setTimeout(90_000);
    await ssoLogin(page, ADMIN, '/careers/desk');
    await expect(page.getByTestId('careers-desk-page')).toBeVisible({ timeout: 45000 });
    await expect(page.getByTestId('careers-desk-simulated-banner')).toBeVisible();
    await expect(page.getByTestId('careers-my-orgs')).toContainText('UTE Tech Partners');

    const posting = page.getByTestId(`careers-staff-opp-${seed.opportunityId}`);
    await expect(posting).toBeVisible({ timeout: 30000 });
    await expect(page.getByTestId(`careers-staff-opp-status-${seed.opportunityId}`))
      .toContainText(/Đang đăng|Published/);

    const application = page.getByTestId(`careers-staff-app-${seed.applicationId}`);
    await expect(application).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId(`careers-staff-app-status-${seed.applicationId}`))
      .toContainText(/Đề nghị|Offer/);
    // OFFER is a forward-terminal step — no further advance button.
    await expect(page.getByTestId(`careers-advance-${seed.applicationId}`)).toHaveCount(0);
  });

  test('org-beta recruiter lane stays empty — no cross-org bleed in browser', async ({ page }) => {
    test.setTimeout(90_000);
    // student2 holds the reviewer + org-beta grants: the desk shows its
    // OWN org (beta) and never the org-alpha posting/application.
    await ssoLogin(page, OTHER, '/careers/desk');
    await expect(page.getByTestId('careers-desk-page')).toBeVisible({ timeout: 45000 });
    await expect(page.getByTestId('careers-my-orgs')).toContainText('Mekong Software House');
    await expect(page.getByTestId(`careers-staff-opp-${seed.opportunityId}`)).toHaveCount(0);
    await expect(page.getByTestId(`careers-staff-app-${seed.applicationId}`)).toHaveCount(0);
  });
});
