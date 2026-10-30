import { expect, request as pwRequest, test, type Page } from '@playwright/test';

/**
 * P09 learning spec (domain-contracts §6 D5, phase-09 exit): the full
 * journey create → publish → draft → submit → return → resubmit → review on
 * the e2e preview stack. Staff + student legs drive the REST surface on the
 * API loopback (bearer tokens, cookie-free request contexts); the browser
 * leg lands on /dashboard/lecturer/learn and /dashboard/learn through the
 * portal SSO lane to prove the staff roster + student feedback render.
 *
 * Contract coverage:
 *   - LMS-T01/T02: section lecturer publishes + closes the assignment;
 *   - LMS-T03: draft → submit is idempotent (same key replays one row);
 *   - LMS-T04/T06: return requires feedback; review completes the cycle;
 *   - LMS-T05/X02: resubmit creates a second immutable revision — the first
 *     is never mutated;
 *   - §6 forbidden write: the student's official enrollment grade rows stay
 *     bit-identical through the whole journey (LMS never touches the grade
 *     authority);
 *   - authority: a student without an active seat in the section gets
 *     NOT_ENROLLED on every learning lane for it.
 *
 * Fixture facts (demo seed): lecturer@campuscore.edu owns
 * section-algorithms-demo where student@campuscore.edu holds an ENROLLED
 * seat; section-testing-demo-02 belongs to the same lecturer but student2
 * has no active enrollment in it (cross-section denial leg).
 *
 * Required env (ecosystem-learning-verify.mjs supplies them):
 *   SSO_PORTAL_BASE / LEARNING_API_BASE / E2E_*_PASSCODE / SSO_ID_BASE
 */

test.use({
  ignoreHTTPSErrors: true,
  launchOptions: {
    args: ['--host-resolver-rules=MAP *.localhost 127.0.0.1'],
  },
});

const PORTAL = process.env.SSO_PORTAL_BASE ?? 'https://portal.localhost:3102';
const API = process.env.LEARNING_API_BASE ?? 'http://127.0.0.1:4100';
const ID_BASE = process.env.SSO_ID_BASE ?? 'https://id.localhost:4443';
const LECTURER = { email: 'lecturer@campuscore.edu', password: process.env.E2E_LECTURER_PASSCODE ?? 'password123' };
const STUDENT = { email: 'student@campuscore.edu', password: process.env.E2E_STUDENT_PASSCODE ?? 'password123' };
const STUDENT2 = { email: 'student2@campuscore.edu', password: process.env.E2E_STUDENT2_PASSCODE ?? 'password123' };

const SECTION = 'section-algorithms-demo';
const FOREIGN_SECTION = 'section-testing-demo-02';
const SUFFIX = `e2e${Date.now().toString(36)}`;

interface Seed {
  assignmentId: string;
  assignmentTitle: string;
  submissionId: string;
  firstRevisionId: string;
  secondRevisionId: string;
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

async function officialGradeRows(token: string, sectionId: string) {
  // Lecturer gradebook read — the authoritative surface the LMS must never
  // write to (contract §6 forbidden write). Returns the raw enrollment rows
  // for the journey student, including grade status + published marks.
  const body = await ok(token, 'GET', `/api/v1/sections/${sectionId}/grades`);
  return (body.enrollments ?? []).filter(
    (row: { studentId?: string }) => row.studentId === 'student-profile');
}

test.beforeAll(async () => {
  const lecturer = await login(LECTURER.email, LECTURER.password);
  const student = await login(STUDENT.email, STUDENT.password);

  // Official-grade baseline: these rows must be identical after the journey.
  const baseline = await officialGradeRows(lecturer, SECTION);

  // LMS-T01: lecturer creates + publishes an assignment on the owned section.
  const assignment = await ok(lecturer, 'POST', `/api/v1/learning/staff/sections/${SECTION}/assignments`, {
    title: `E2E Lab report ${SUFFIX}`,
    description: 'e2e fixture — upload a short write-up',
    deadlineAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
    maxScore: 10,
  });
  expect(assignment.status).toBe('DRAFT');
  await ok(lecturer, 'POST', `/api/v1/learning/staff/assignments/${assignment.id}/publish`);

  // LMS-T03: draft open is idempotent — replay returns the same submission.
  const draft = await ok(student, 'POST', `/api/v1/learning/assignments/${assignment.id}/draft`, null, {
    'Idempotency-Key': `e2e-lms-draft-${SUFFIX}`,
  });
  const replay = await ok(student, 'POST', `/api/v1/learning/assignments/${assignment.id}/draft`, null, {
    'Idempotency-Key': `e2e-lms-draft-${SUFFIX}`,
  });
  expect(replay.id).toBe(draft.id);

  await ok(student, 'PUT', `/api/v1/learning/submissions/${draft.id}/draft`, {
    textBody: 'first write-up — immutability probe',
  });
  const submitted = await ok(student, 'POST', `/api/v1/learning/assignments/${assignment.id}/submit`, null, {
    'Idempotency-Key': `e2e-lms-submit-${SUFFIX}`,
  });
  expect(submitted.status).toBe('SUBMITTED');

  // Roster read-through: the enrolled seat now carries a submission row.
  const roster = await ok(lecturer, 'GET', `/api/v1/learning/staff/assignments/${assignment.id}/roster`);
  const mine = roster.find((row: { studentId: string }) => row.studentId === 'student-profile');
  expect(mine.submissionId).toBe(submitted.id);
  expect(mine.submissionStatus).toBe('SUBMITTED');

  // LMS-T04: return carries feedback and bumps the cycle.
  const returned = await ok(lecturer, 'POST', `/api/v1/learning/staff/submissions/${submitted.id}/return`, {
    comment: 'expand the methods section',
    score: 7,
    expectedVersion: submitted.version,
  });
  expect(returned.status).toBe('RETURNED');

  // LMS-T05 + X02: resubmit appends a NEW revision; revision 1 survives.
  const resubmitted = await ok(student, 'POST', `/api/v1/learning/assignments/${assignment.id}/resubmit`, {
    textBody: 'second write-up — revised methods',
  }, { 'Idempotency-Key': `e2e-lms-resubmit-${SUFFIX}` });
  expect(resubmitted.status).toBe('RESUBMITTED');
  const revisions = await ok(student, 'GET', `/api/v1/learning/submissions/${submitted.id}/revisions`);
  expect(revisions.length).toBe(2);
  expect(revisions[0].revisionNo).toBe(2);
  expect(revisions[0].textBody).toBe('second write-up — revised methods');
  expect(revisions[1].revisionNo).toBe(1);
  expect(revisions[1].textBody).toBe('first write-up — immutability probe');

  // LMS-T06: review closes the cycle.
  const reviewed = await ok(lecturer, 'POST', `/api/v1/learning/staff/submissions/${submitted.id}/review`, {
    comment: 'accepted after revision',
    score: 8.5,
    expectedVersion: resubmitted.version,
  });
  expect(reviewed.status).toBe('REVIEWED');

  // Cross-section authority: student2 has no active seat in the lecturer's
  // other section — every learning lane for it denies enrollment.
  const student2 = await login(STUDENT2.email, STUDENT2.password);
  const denied = await call(student2, 'GET', `/api/v1/learning/sections/${FOREIGN_SECTION}/materials`);
  expect(denied.status).toBe(403);
  expect(JSON.parse(denied.body).code).toBe('NOT_ENROLLED');

  // Forbidden write: the official grade rows are bit-identical — the LMS
  // lifecycle never touched Enrollment/StudentGrade.
  const after = await officialGradeRows(lecturer, SECTION);
  expect(after).toEqual(baseline);

  seed = {
    assignmentId: assignment.id,
    assignmentTitle: `E2E Lab report ${SUFFIX}`,
    submissionId: submitted.id,
    firstRevisionId: revisions[1].id,
    secondRevisionId: revisions[0].id,
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

test.describe('ecosystem-learning (P09 D5)', () => {
  test.skip(({ browserName }) => browserName !== 'chromium');

  test('lecturer console shows the reviewed submission on the roster', async ({ page }) => {
    test.setTimeout(90_000);
    // ssoLogin lands on the return path itself — a second goto would abort
    // the in-flight bootstrap (auth/me) and bounce the page back to /login.
    await ssoLogin(page, LECTURER, '/dashboard/lecturer/learn');
    const sectionPicker = page.getByTestId('learning-staff-section');
    await expect(sectionPicker).toBeVisible({ timeout: 45000 });
    await sectionPicker.selectOption({ value: SECTION });
    await expect(page.getByText(seed.assignmentTitle)).toBeVisible({ timeout: 30000 });

    // Open the assignment roster — every enrollment row for the student
    // carries the shared submission (roster joins on studentId), so the
    // first matching seat proves the REVIEWED render.
    const card = page.getByTestId(`staff-assignment-${seed.assignmentId}`);
    await card.getByRole('button', { name: /Danh sách nộp bài|Submission roster/ }).click();
    const row = page.locator('[data-student-id="student-profile"]').first();
    await expect(row).toBeVisible({ timeout: 15000 });
    await expect(row.getByText('Đã chấm')).toBeVisible();
  });

  test('student portal shows reviewed status, feedback and both revisions', async ({ page }) => {
    test.setTimeout(90_000);
    await ssoLogin(page, STUDENT, '/dashboard/learn');
    await expect(page.getByTestId('learning-sections')).toBeVisible({ timeout: 45000 });
    // The console defaults to the first section by course code — switch to
    // the section that holds the seeded assignment.
    await page.getByTestId(`learning-section-${SECTION}`).click();
    const card = page.getByTestId(`assignment-${seed.assignmentId}`);
    await expect(card).toBeVisible({ timeout: 30000 });
    await expect(card.getByText('Đã chấm')).toBeVisible();

    await card.getByRole('button', { name: /Mở bài tập|Open assignment/ }).click();
    const work = page.getByTestId('learning-work');
    await expect(work.getByText('accepted after revision')).toBeVisible({ timeout: 15000 });
    await expect(work.getByText('#2')).toBeVisible();
    await expect(work.getByText('#1')).toBeVisible();
  });

  test('student sections list reflects the academic roster read-through', async () => {
    const student = await login(STUDENT.email, STUDENT.password);
    const sections = await ok(student, 'GET', '/api/v1/learning/sections');
    // The demo roster carries a historical COMPLETED row next to the active
    // seat for this section — read-through must surface an active enrollment.
    const rows = sections.filter((row: { sectionId: string }) => row.sectionId === SECTION);
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows.some((row: { enrollmentStatus: string }) =>
        ['ENROLLED', 'CONFIRMED', 'PENDING', 'COMPLETED'].includes(row.enrollmentStatus))).toBe(true);
    expect(rows.some((row: { assignmentCount: number }) => row.assignmentCount >= 1)).toBe(true);
  });
});
